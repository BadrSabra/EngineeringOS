import {
  and,
  asc,
  count,
  eq,
  inArray,
  ne,
  sql,
} from "drizzle-orm";
import {
  aiAgentEffectBundlesTable,
  aiAgentEffectsTable,
  aiAgentObservationsTable,
  aiExecutionAcceptancesTable,
  aiExecutionsTable,
  aiMissionDecisionEventsTable,
  aiGoalsTable,
  aiMissionDecisionOutcomeSnapshotsTable,
  aiMissionDecisionTracesTable,
  aiMissionsTable,
  aiWorldFactsTable,
  db,
  tasksTable,
} from "@workspace/db";
import {
  canonicalJsonHash,
  classifyExpectedStateChanges,
  evaluateMissionStrategyPlanOutcome,
  MissionDecisionTraceSchema,
  MissionStrategyPlanOutcomeEvaluationSchema,
} from "@workspace/ai-orchestrator";
import type {
  EffectObservationEvidence,
  MissionStrategyPlanOutcomeEvaluation,
} from "@workspace/ai-orchestrator";
import {
  projectMissionActivePlan,
  projectedAcceptance,
} from "./mission-completion-gate.js";
import { loadCanonicalProof } from "./proof-foundation.js";
import { getProjectWorldState } from "./agent-state/world-state.js";
import {
  getMissionDecisionTraceInTransaction,
  getValidatedMissionPlanApprovalReceiptInTransaction,
  getValidatedMissionDecisionDispatchBatchInTransaction,
  eventHash,
  eventIdentity,
} from "./mission-decision-trace-store.js";
import type {
  DecisionEventStage,
  MissionDecisionTransaction,
} from "./mission-decision-trace-store.js";
import { missionOutcomeSnapshotId } from "./mission-outcome-snapshot-identity.js";
import { logger } from "./logger.js";

const MAX_WORLD_FACTS = 256;
const MAX_WORLD_OBSERVATIONS = 2_048;
const TERMINAL_GOAL_STATUSES = new Set(["completed", "failed", "cancelled"]);
const TERMINAL_TASK_STATUSES = new Set(["completed", "failed", "cancelled"]);
const TERMINAL_EXECUTION_STATUSES = new Set(["completed", "failed", "cancelled"]);
const MAX_MISSION_OUTCOME_RECONCILIATION_BATCH = 64;
const missionOutcomeReconciliationCursors = new Map<
  string,
  { occurredAt: Date; decisionId: string } | null
>();
let warnedOutcomeSchemaUnavailable = false;

function outcomeTransactionErrorCode(error: unknown): string | null {
  let current: unknown = error;
  for (let depth = 0; depth < 4 && current; depth += 1) {
    const value = record(current);
    if (typeof value.code === "string") return value.code;
    current = value.cause;
  }
  return null;
}

function isRetryableOutcomeTransactionConflict(error: unknown): boolean {
  const code = outcomeTransactionErrorCode(error);
  return code === "40001" || code === "40P01";
}

type PlanGoalRow = typeof aiGoalsTable.$inferSelect;
type PlanTaskRow = typeof tasksTable.$inferSelect;
type PlanExecutionRow = typeof aiExecutionsTable.$inferSelect;

function jsonStrings(value: unknown): string[] | null {
  if (!Array.isArray(value) || value.some((item) => typeof item !== "string")) return null;
  const items = value as string[];
  return new Set(items).size === items.length ? items : null;
}

function expectedCodes(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  const codes: string[] = [];
  for (const item of value) {
    if (typeof item === "string" && item.length > 0) {
      codes.push(item);
      continue;
    }
    if (!item || typeof item !== "object" || Array.isArray(item)) continue;
    const record = item as Record<string, unknown>;
    const code = typeof record.effectCode === "string"
      ? record.effectCode
      : typeof record.code === "string"
        ? record.code
        : typeof record.subject === "string"
            && typeof record.predicate === "string"
          ? `${record.subject}.${record.predicate}`
          : null;
    if (code) codes.push(code);
  }
  return [...new Set(codes)].sort((left, right) => left.localeCompare(right));
}

type PersistedExpectedStateChange = {
  subject: string;
  predicate: string;
  expectedValue?: EffectObservationEvidence["value"];
};

function persistedExpectedStateChanges(value: unknown): PersistedExpectedStateChange[] | null {
  if (!Array.isArray(value) || value.length === 0) return null;
  const changes: PersistedExpectedStateChange[] = [];
  const seen = new Set<string>();
  for (const item of value) {
    const change = record(item);
    if (
      typeof change.subject !== "string"
      || change.subject.length === 0
      || typeof change.predicate !== "string"
      || change.predicate.length === 0
    ) {
      return null;
    }
    const key = `${change.subject}\u0000${change.predicate}`;
    if (seen.has(key)) return null;
    seen.add(key);
    changes.push({
      subject: change.subject,
      predicate: change.predicate,
      ...(Object.hasOwn(change, "expectedValue")
        ? { expectedValue: change.expectedValue as EffectObservationEvidence["value"] }
        : {}),
    });
  }
  return changes;
}

function projectEffectObservation(
  row: typeof aiAgentObservationsTable.$inferSelect,
): EffectObservationEvidence | null {
  const evidenceRefs = jsonStrings(row.evidenceRefs);
  if (
    !evidenceRefs
    || row.provenance !== "DIRECT_OBSERVATION"
    || row.completeness !== "complete"
    || row.freshness !== "fresh"
  ) {
    return null;
  }
  return {
    observationId: row.id,
    subject: row.subject,
    predicate: row.predicate,
    value: row.value as EffectObservationEvidence["value"],
    evidenceRefs,
    provenance: "DIRECT_OBSERVATION",
    completeness: "complete",
    freshness: "fresh",
  };
}

function classifyPersistedEffect(
  effect: typeof aiAgentEffectsTable.$inferSelect,
  observationsById: ReadonlyMap<string, EffectObservationEvidence>,
): {
  valid: boolean;
  status: "observed" | "contradicted" | null;
  codes: string[];
  claims: Array<{ code: string; subject: string; predicate: string; observationId: string }>;
} {
  const changes = persistedExpectedStateChanges(effect.expectedEffects);
  const beforeIds = jsonStrings(effect.beforeObservationIds);
  const afterIds = jsonStrings(effect.afterObservationIds);
  if (!changes || !beforeIds?.length || !afterIds?.length) {
    return { valid: false, status: null, codes: [], claims: [] };
  }
  const before = beforeIds.map((id) => observationsById.get(id));
  const after = afterIds.map((id) => observationsById.get(id));
  if (before.some((observation) => !observation) || after.some((observation) => !observation)) {
    return { valid: false, status: null, codes: [], claims: [] };
  }
  const classification = classifyExpectedStateChanges({
    expectedStateChanges: changes,
    before: before as EffectObservationEvidence[],
    after: after as EffectObservationEvidence[],
  });
  const contradictionRefs = jsonStrings(effect.contradictionRefs);
  const evidenceRefs = jsonStrings(effect.evidenceRefs);
  const status = classification.status === "observed" || classification.status === "contradicted"
    ? classification.status
    : null;
  const codes = expectedCodes(effect.expectedEffects);
  const claims = status === "contradicted"
    ? changes.flatMap((change) => {
        const observation = after.find((candidate) =>
          candidate?.subject === change.subject
          && candidate.predicate === change.predicate
          && classification.contradictionRefs.includes(candidate.observationId));
        return observation
          ? [{
              code: `${change.subject}.${change.predicate}`,
              subject: change.subject,
              predicate: change.predicate,
              observationId: observation.observationId,
            }]
          : [];
      })
    : [];
  return {
    valid: status === effect.status
      && !!contradictionRefs
      && sameStrings(contradictionRefs, classification.contradictionRefs)
      && !!evidenceRefs
      && sameStrings(evidenceRefs, classification.evidenceRefs)
      && codes.length === changes.length,
    status,
    codes,
    claims,
  };
}

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function sameStrings(left: readonly string[], right: readonly string[]): boolean {
  return left.length === right.length
    && [...left].sort().join("\n") === [...right].sort().join("\n");
}

function hashJson(value: unknown): string {
  const serialized = JSON.stringify(value);
  if (serialized === undefined) throw new Error("mission outcome evidence is not JSON serializable");
  return canonicalJsonHash(
    JSON.parse(serialized) as Parameters<typeof canonicalJsonHash>[0],
  );
}

function stableEvaluationHash(evaluation: MissionStrategyPlanOutcomeEvaluation): string {
  const { evaluatedAt: _evaluatedAt, ...stableEvaluation } = evaluation;
  return hashJson(stableEvaluation);
}

export type MissionPlanOutcomeStoreResult =
  | {
      kind: "recorded" | "already_recorded";
      snapshotId: string;
      evaluation: MissionStrategyPlanOutcomeEvaluation;
    }
  | {
      kind: "not_ready";
      reason:
        | "decision_missing"
        | "mission_missing"
        | "trace_not_at_dispatch_boundary"
        | "plan_not_current"
        | "plan_outside_evaluator_bounds";
    };

/**
 * Rebuilds plan-outcome evidence exclusively from durable server-owned rows.
 * It records a content-addressed snapshot but deliberately does not advance
 * lifecycle events; a separate store gate must revalidate the snapshot first.
 */
export async function evaluateAndPersistMissionPlanOutcomeInTransaction(
  tx: MissionDecisionTransaction,
  decisionId: string,
  evaluatedAt = new Date(),
): Promise<MissionPlanOutcomeStoreResult> {
    const [candidate] = await tx.select().from(aiMissionDecisionTracesTable)
      .where(eq(aiMissionDecisionTracesTable.decisionId, decisionId));
    if (!candidate) return { kind: "not_ready", reason: "decision_missing" };
    const candidateTrace = MissionDecisionTraceSchema.parse(candidate.trace);
    const identity = candidateTrace.context.identity;

    const [mission] = await tx.select().from(aiMissionsTable)
      .where(and(
        eq(aiMissionsTable.id, identity.missionId),
        eq(aiMissionsTable.projectId, identity.projectId),
      ))
      .for("update");
    if (!mission) return { kind: "not_ready", reason: "mission_missing" };

    const allGoals = await tx.select().from(aiGoalsTable)
      .where(and(
        eq(aiGoalsTable.missionId, identity.missionId),
        eq(aiGoalsTable.projectId, identity.projectId),
      ))
      .orderBy(asc(aiGoalsTable.id))
      .for("update");
    const [decision] = await tx.select().from(aiMissionDecisionTracesTable)
      .where(eq(aiMissionDecisionTracesTable.decisionId, decisionId))
      .for("update");
    if (!decision) return { kind: "not_ready", reason: "decision_missing" };

    const storedTrace = await getMissionDecisionTraceInTransaction(tx, decisionId);
    if (!storedTrace) return { kind: "not_ready", reason: "decision_missing" };
    const events = storedTrace.events;
    const dispatchEvent = events.find(({ stage }) => stage === "DISPATCHED");
    const appliedEvent = events.find(({ stage }) => stage === "PLAN_APPLIED");
    if (
      !dispatchEvent?.referenceId
      || !appliedEvent?.referenceId
      || events.at(-1)?.stage !== "DISPATCHED"
    ) {
      return { kind: "not_ready", reason: "trace_not_at_dispatch_boundary" };
    }

    const activePlan = projectMissionActivePlan(mission, allGoals);
    if (
      activePlan.binding !== "active_revision"
      || activePlan.revision !== appliedEvent.referenceId
      || candidateTrace.newPlanRevision !== appliedEvent.referenceId
    ) {
      return { kind: "not_ready", reason: "plan_not_current" };
    }
    if (
      activePlan.goalIds.length === 0
      || activePlan.goalIds.length > 64
    ) {
      return { kind: "not_ready", reason: "plan_outside_evaluator_bounds" };
    }
    const planGoalIds = [...activePlan.goalIds].sort((left, right) => left.localeCompare(right));
    const planGoals = allGoals.filter((goal) => planGoalIds.includes(goal.id));
    if (planGoals.length !== planGoalIds.length) {
      return { kind: "not_ready", reason: "plan_not_current" };
    }

    const validatedBatch = await getValidatedMissionDecisionDispatchBatchInTransaction(
      tx,
      candidateTrace,
      { dispatchBatchId: dispatchEvent.referenceId, planRevision: appliedEvent.referenceId },
    );
    const taskRows = await tx.select().from(tasksTable)
      .where(and(
        eq(tasksTable.projectId, identity.projectId),
        inArray(tasksTable.goalId, planGoalIds),
      ))
      .orderBy(asc(tasksTable.goalId), asc(tasksTable.id))
      .for("update");
    if (taskRows.length > 256) {
      return { kind: "not_ready", reason: "plan_outside_evaluator_bounds" };
    }
    const boundTaskRows = taskRows.filter(
      (task): task is PlanTaskRow & { goalId: string } => typeof task.goalId === "string",
    );
    if (boundTaskRows.length !== taskRows.length) {
      return { kind: "not_ready", reason: "plan_not_current" };
    }

    const tasksByGoal = new Map<string, PlanTaskRow[]>();
    for (const task of boundTaskRows) {
      const rows = tasksByGoal.get(task.goalId) ?? [];
      rows.push(task);
      tasksByGoal.set(task.goalId, rows);
    }
    const rootExecutionByGoal = new Map(
      validatedBatch.items
        .filter((item) => item.executionId !== null)
        .map((item) => [item.goalId, item.executionId!] as const),
    );

    const selectedExecutions: Array<{
      goal: PlanGoalRow;
      execution: PlanExecutionRow;
      taskId: string | null;
    }> = [];
    for (const goal of planGoals) {
      const projected = projectedAcceptance(goal);
      const executionId = projected?.executionId ?? rootExecutionByGoal.get(goal.id) ?? null;
      if (!executionId) continue;
      const [execution] = await tx.select().from(aiExecutionsTable)
        .where(and(
          eq(aiExecutionsTable.id, executionId),
          eq(aiExecutionsTable.projectId, identity.projectId),
          eq(aiExecutionsTable.goalId, goal.id),
        ))
        .for("update");
      if (!execution) continue;
      const taskId = execution.linkedTaskId ?? null;
      if (taskId && !tasksByGoal.get(goal.id)?.some((task) => task.id === taskId)) continue;
      selectedExecutions.push({ goal, execution, taskId });
    }
    if (selectedExecutions.length > 512) {
      return { kind: "not_ready", reason: "plan_outside_evaluator_bounds" };
    }

    const executionEvidence: MissionStrategyPlanOutcomeEvaluation["executions"] = [];
    const observedCodes = new Set<string>();
    const contradictedWorldStateClaims = new Map<string, Array<{
      code: string;
      subject: string;
      predicate: string;
      observationId: string;
    }>>();
    let allAfterObservationsBound = true;

    for (const { goal, execution, taskId } of selectedExecutions) {
      const projected = projectedAcceptance(goal);
      const projectionScope = record(projected?.scope);
      const proof = await loadCanonicalProof({
        tx,
        executionId: execution.id,
        attempt: execution.attempt,
        scope: {
          projectId: identity.projectId,
          missionId: identity.missionId,
          goalId: goal.id,
          executionId: execution.id,
          operationId: typeof projectionScope.operationId === "string"
            ? projectionScope.operationId
            : null,
          planRevision: appliedEvent.referenceId,
          activePlanRevision: activePlan.revision,
          sourceRevisionBinding: projected?.sourceRevision == null ? "execution" : "scope",
          candidateIdentityBinding: projected?.candidateIdentity ? "required" : "not_applicable",
          sourceRevision: projected?.sourceRevision ?? null,
          candidateIdentity: projected?.candidateIdentity ?? null,
        },
        goalStatus: goal.status,
        deliveryRequired: record(goal.outcomeContract).deliveryRequired === true,
      });

      const [acceptance] = proof.acceptanceId
        ? await tx.select().from(aiExecutionAcceptancesTable)
            .where(and(
              eq(aiExecutionAcceptancesTable.id, proof.acceptanceId),
              eq(aiExecutionAcceptancesTable.executionId, execution.id),
              eq(aiExecutionAcceptancesTable.projectId, identity.projectId),
              eq(aiExecutionAcceptancesTable.attempt, execution.attempt),
            ))
            .for("update")
        : [];
      const [bundle] = acceptance?.effectBundleId
        ? await tx.select().from(aiAgentEffectBundlesTable)
            .where(and(
              eq(aiAgentEffectBundlesTable.id, acceptance.effectBundleId),
              eq(aiAgentEffectBundlesTable.projectId, identity.projectId),
              eq(aiAgentEffectBundlesTable.executionId, execution.id),
              eq(aiAgentEffectBundlesTable.attempt, execution.attempt),
            ))
            .for("update")
        : [];
      const effectIds = jsonStrings(bundle?.effectIds);
      const effectHashes = jsonStrings(bundle?.effectContractHashes);
      const effectRows = effectIds?.length
        ? await tx.select().from(aiAgentEffectsTable)
            .where(inArray(aiAgentEffectsTable.id, effectIds))
            .orderBy(asc(aiAgentEffectsTable.id))
            .for("update")
        : [];
      const effectRowsBound = !!bundle
        && !!effectIds?.length
        && !!effectHashes
        && effectRows.length === effectIds.length
        && effectRows.every((effect) =>
          effect.projectId === identity.projectId
          && effect.executionId === execution.id
          && effect.attempt === execution.attempt
          && effect.episodeId === bundle.episodeId
          && Array.isArray(effect.expectedEffects)
          && jsonStrings(bundle.effectIds)?.includes(effect.id),
        )
        && sameStrings(
          effectRows.map((effect) => effect.effectContractHash),
          effectHashes ?? [],
        );
      const effectsMatch = effectRowsBound
        && bundle?.verdict === "OBSERVED"
        && effectRows.every((effect) => effect.status === "observed");
      const effectsContradictedMatch = effectRowsBound
        && bundle?.verdict === "CONTRADICTED"
        && effectRows.every((effect) => effect.status === "contradicted");
      const observationIds = effectRowsBound
        ? [...new Set(effectRows.flatMap((effect) => [
            ...(jsonStrings(effect.beforeObservationIds) ?? []),
            ...(jsonStrings(effect.afterObservationIds) ?? []),
          ]))]
        : [];
      const observationRows = observationIds.length
        ? await tx.select().from(aiAgentObservationsTable)
            .where(inArray(aiAgentObservationsTable.id, observationIds))
            .orderBy(asc(aiAgentObservationsTable.id))
            .for("update")
        : [];
      const projectedObservations = observationRows
        .map(projectEffectObservation)
        .filter((observation): observation is EffectObservationEvidence => observation !== null);
      const projectedObservationsById = new Map(
        projectedObservations.map((observation) => [observation.observationId, observation] as const),
      );
      const observationsMatch = observationRows.length === observationIds.length
        && observationRows.length > 0
        && projectedObservations.length === observationRows.length
        && observationRows.every((observation) =>
          observation.projectId === identity.projectId
          && observation.executionId === execution.id
          && observation.episodeId === bundle?.episodeId
          && observation.provenance === "DIRECT_OBSERVATION"
          && observation.completeness === "complete"
          && observation.freshness === "fresh"
          && observation.environmentFreshness !== "stale"
          && observation.projectRevision !== null,
        )
        && effectRows.every((effect) => {
          const beforeIds = jsonStrings(effect.beforeObservationIds);
          const afterIds = jsonStrings(effect.afterObservationIds);
          return !!beforeIds?.length
            && !!afterIds?.length
            && beforeIds.every((id) =>
              observationRows.some((row) => row.id === id && row.observationRole === "before"))
            && afterIds.every((id) =>
              observationRows.some((row) => row.id === id && row.observationRole === "after"));
        });

      const effectClassifications = effectRowsBound && observationsMatch
        ? effectRows.map((effect) => classifyPersistedEffect(effect, projectedObservationsById))
        : [];
      const observedEffectsRevalidated = effectsMatch
        && effectClassifications.length === effectRows.length
        && effectClassifications.every((effect) => effect.valid && effect.status === "observed");
      const contradictedEffectsRevalidated = effectsContradictedMatch
        && effectClassifications.length === effectRows.length
        && effectClassifications.every((effect) => effect.valid && effect.status === "contradicted");
      const effectCodes = effectsMatch && observedEffectsRevalidated
        ? effectClassifications.flatMap((effect) => effect.codes)
        : [];
      const executionObservedCodes = proof.accepted
        && effectsMatch
        && observedEffectsRevalidated
        && observationsMatch
        ? [...new Set(effectCodes)].sort((left, right) => left.localeCompare(right))
        : [];
      const failureAcceptance = !!acceptance
        && proof.acceptanceId === acceptance.id
        && ["FAILED", "INCOMPLETE"].includes(acceptance.outcome.toUpperCase())
        && ["failed", "cancelled"].includes(acceptance.terminalStatus)
        && acceptance.terminalStatus === execution.status
        && acceptance.resumable === 0
        && acceptance.reasonCode.trim().length > 0;
      const executionContradictedCodes = failureAcceptance
        && effectsContradictedMatch
        && contradictedEffectsRevalidated
        && observationsMatch
        ? [...new Set(effectClassifications.flatMap((effect) => effect.codes))]
            .sort((left, right) => left.localeCompare(right))
        : [];
      if (executionContradictedCodes.length > 0) {
        for (const effect of effectClassifications) {
          for (const claim of effect.claims) {
            const rows = contradictedWorldStateClaims.get(claim.code) ?? [];
            rows.push(claim);
            contradictedWorldStateClaims.set(claim.code, rows);
          }
        }
      }
      executionObservedCodes.forEach((code) => observedCodes.add(code));
      if (!observationsMatch) allAfterObservationsBound = false;

      const proofHash = hashJson(proof);
      const evidenceHash = hashJson({
        goalId: goal.id,
        taskId,
        execution: {
          id: execution.id,
          attempt: execution.attempt,
          status: execution.status,
        },
        acceptance,
        proof,
        bundle,
        effects: effectRows,
        observations: observationRows.map((observation) => ({
          id: observation.id,
          projectId: observation.projectId,
          executionId: observation.executionId,
          episodeId: observation.episodeId,
          observationRole: observation.observationRole,
          provenance: observation.provenance,
          valueHash: observation.valueHash,
          projectRevision: observation.projectRevision,
          completeness: observation.completeness,
          freshness: observation.freshness,
          environmentFreshness: observation.environmentFreshness,
          sequence: observation.sequence,
        })),
      });
      const achieved = proof.accepted
        && !!proof.acceptanceId
        && !!bundle
        && effectsMatch
        && observedEffectsRevalidated
        && observationsMatch
        && effectCodes.length > 0;
      const notAchieved = failureAcceptance
        && !!proof.acceptanceId
        && !!bundle
        && effectsContradictedMatch
        && contradictedEffectsRevalidated
        && observationsMatch
        && executionContradictedCodes.length > 0;
      executionEvidence.push({
        goalId: goal.id,
        taskId,
        executionId: execution.id,
        attempt: execution.attempt,
        terminal: TERMINAL_EXECUTION_STATUSES.has(execution.status),
        acceptanceId: proof.acceptanceId,
        effectBundleId: bundle?.id ?? null,
        canonicalProofId: achieved ? proofHash : null,
        canonicalProofHash: achieved ? proofHash : null,
        worldStateRevision: bundle?.worldRevision ?? null,
        outcome: achieved ? "ACHIEVED" : notAchieved ? "NOT_ACHIEVED" : "INCONCLUSIVE",
        evidenceHash,
        observedEffectCodes: executionObservedCodes,
        contradictedEffectCodes: executionContradictedCodes,
      });
    }

    const [factCountRow] = await tx.select({ value: count() }).from(aiWorldFactsTable)
      .where(eq(aiWorldFactsTable.projectId, identity.projectId));
    const [observationCountRow] = await tx.select({ value: count() })
      .from(aiAgentObservationsTable)
      .where(and(
        eq(aiAgentObservationsTable.projectId, identity.projectId),
        eq(aiAgentObservationsTable.completeness, "complete"),
        eq(aiAgentObservationsTable.freshness, "fresh"),
        ne(aiAgentObservationsTable.environmentFreshness, "stale"),
      ));
    const worldState = await getProjectWorldState(identity.projectId, undefined, tx);
    const worldStateComplete = Number(factCountRow?.value ?? 0) <= MAX_WORLD_FACTS
      && Number(observationCountRow?.value ?? 0) <= MAX_WORLD_OBSERVATIONS
      && worldState.facts.length === Number(factCountRow?.value ?? 0)
      && allAfterObservationsBound;
    const worldStateEvidenceHash = worldStateComplete
      ? canonicalJsonHash({
          projectId: worldState.projectId,
          worldRevision: worldState.worldRevision,
          facts: worldState.facts,
          currentFacts: worldState.currentFacts,
          contradictions: worldState.contradictions,
        })
      : null;
    const contradictedWorldStateCodes = [...contradictedWorldStateClaims.entries()]
      .filter(([, claims]) => claims.length > 0 && claims.every((claim) =>
        worldState.contradictions.some((fact) =>
          fact.status === "contradicted"
          && fact.environmentFreshness === "fresh"
          && fact.subject === claim.subject
          && fact.predicate === claim.predicate
          && fact.sourceObservationIds.includes(claim.observationId),
        ),
      ))
      .map(([code]) => code)
      .sort((left, right) => left.localeCompare(right));

    const taskStates = boundTaskRows.map((task) => ({
      taskId: task.id,
      goalId: task.goalId,
      terminal: TERMINAL_TASK_STATUSES.has(task.status),
      executionIds: executionEvidence
        .filter((execution) => execution.taskId === task.id)
        .map((execution) => execution.executionId),
    }));
    const goalStates = planGoals.map((goal) => ({
      goalId: goal.id,
      terminal: TERMINAL_GOAL_STATUSES.has(goal.status),
      taskIds: (tasksByGoal.get(goal.id) ?? []).map((task) => task.id),
      executionIds: executionEvidence
        .filter((execution) => execution.goalId === goal.id && execution.taskId === null)
        .map((execution) => execution.executionId),
    }));

    const evaluation = evaluateMissionStrategyPlanOutcome({
      trace: storedTrace.trace,
      persistedLifecycle: events.map((event) => ({
        stage: event.stage,
        sequence: event.sequence,
        referenceId: event.referenceId,
      })),
      approvalReference: await getValidatedMissionPlanApprovalReceiptInTransaction(tx, decisionId),
      plan: {
        projectId: identity.projectId,
        missionId: identity.missionId,
        sourceGoalId: identity.goalId,
        revision: appliedEvent.referenceId,
        activeRevision: activePlan.revision,
        goalIds: planGoalIds,
        requiredGoalIds: planGoalIds,
        taskIds: taskRows.map((task) => task.id),
        rootGoalIds: validatedBatch.items.map((item) => item.goalId),
      },
      dispatchBatch: {
        decisionId: candidateTrace.decisionId,
        projectId: identity.projectId,
        missionId: identity.missionId,
        planRevision: appliedEvent.referenceId,
        id: validatedBatch.batch.dispatchBatchId,
        manifestHash: validatedBatch.batch.manifestHash,
        state: validatedBatch.batch.state,
        items: validatedBatch.items.map((item) => ({
          position: item.position,
          goalId: item.goalId,
          executionId: item.executionId,
          runStatus: item.runStatus as "scheduled" | "waiting" | "blocked" | "completed" | "conflict",
        })),
      },
      goalStates,
      taskStates,
      executions: executionEvidence,
      finalWorldState: {
        revision: worldStateComplete ? worldState.worldRevision : null,
        continuityVerified: worldStateComplete,
        evidenceHash: worldStateEvidenceHash,
        observedEffectCodes: [...observedCodes].sort((left, right) => left.localeCompare(right)),
        contradictedEffectCodes: contradictedWorldStateCodes,
      },
      evaluatedAt: evaluatedAt.toISOString(),
    });

    const snapshotId = missionOutcomeSnapshotId(decisionId, evaluation);
    const [inserted] = await tx.insert(aiMissionDecisionOutcomeSnapshotsTable).values({
      outcomeId: snapshotId,
      decisionId,
      projectId: identity.projectId,
      missionId: identity.missionId,
      sourceGoalId: identity.goalId,
      planRevision: evaluation.planRevision,
      selectedStrategyId: evaluation.selectedStrategyId,
      dispatchBatchId: evaluation.dispatchBatchId,
      dispatchManifestHash: evaluation.dispatchManifestHash,
      evidenceSetHash: evaluation.evidenceSetHash,
      worldStateRevision: evaluation.finalWorldState.revision,
      outcome: evaluation.outcome,
      evaluation: evaluation as unknown as Record<string, unknown>,
    }).onConflictDoNothing().returning({ outcomeId: aiMissionDecisionOutcomeSnapshotsTable.outcomeId });
    if (!inserted) {
      const [existing] = await tx.select().from(aiMissionDecisionOutcomeSnapshotsTable)
        .where(and(
          eq(aiMissionDecisionOutcomeSnapshotsTable.decisionId, decisionId),
          eq(aiMissionDecisionOutcomeSnapshotsTable.evidenceSetHash, evaluation.evidenceSetHash),
        ));
      if (
        !existing
        || existing.outcomeId !== snapshotId
        || existing.projectId !== identity.projectId
        || existing.missionId !== identity.missionId
        || existing.sourceGoalId !== identity.goalId
        || existing.planRevision !== evaluation.planRevision
        || existing.dispatchBatchId !== evaluation.dispatchBatchId
        || existing.dispatchManifestHash !== evaluation.dispatchManifestHash
        || existing.outcome !== evaluation.outcome
      ) {
        throw new Error("mission decision outcome snapshot conflict");
      }
      const persistedEvaluation = MissionStrategyPlanOutcomeEvaluationSchema.safeParse(
        existing.evaluation,
      );
      if (
        !persistedEvaluation.success
        || stableEvaluationHash(persistedEvaluation.data) !== stableEvaluationHash(evaluation)
      ) {
        throw new Error("mission decision outcome snapshot payload conflict");
      }
      return {
        kind: "already_recorded",
        snapshotId,
        evaluation: persistedEvaluation.data,
      };
    }
    return { kind: "recorded", snapshotId, evaluation };
}

export async function evaluateAndPersistMissionPlanOutcome(
  decisionId: string,
  evaluatedAt = new Date(),
): Promise<MissionPlanOutcomeStoreResult> {
  return db.transaction(
    (tx) => evaluateAndPersistMissionPlanOutcomeInTransaction(tx, decisionId, evaluatedAt),
    { isolationLevel: "serializable" },
  );
}

export type MissionPlanOutcomeFinalizationResult =
  | {
      kind: "appended" | "already_recorded";
      snapshotId: string;
      evaluation: MissionStrategyPlanOutcomeEvaluation;
    }
  | {
      kind: "not_achieved" | "inconclusive";
      snapshotId: string;
      evaluation: MissionStrategyPlanOutcomeEvaluation;
    }
  | Extract<MissionPlanOutcomeStoreResult, { kind: "not_ready" }>;

const ACHIEVED_OUTCOME_LIFECYCLE_STAGES = [
  "EXECUTED",
  "ACCEPTED",
  "VERIFIED",
  "EVALUATED_AFTER_EXECUTION",
] as const satisfies readonly DecisionEventStage[];

async function appendAchievedOutcomeLifecycleInTransaction(
  tx: MissionDecisionTransaction,
  input: {
    decisionId: string;
    snapshotId: string;
    evaluation: MissionStrategyPlanOutcomeEvaluation;
    occurredAt: Date;
  },
): Promise<void> {
  if (
    input.evaluation.outcome !== "ACHIEVED"
    || missionOutcomeSnapshotId(input.decisionId, input.evaluation) !== input.snapshotId
  ) {
    throw new Error("mission decision outcome is not eligible for lifecycle advancement");
  }
  const stored = await getMissionDecisionTraceInTransaction(tx, input.decisionId);
  if (!stored) throw new Error("mission decision trace missing during outcome finalization");
  const dispatchIndex = stored.events.findIndex(({ stage }) => stage === "DISPATCHED");
  const dispatchEvent = stored.events[dispatchIndex];
  if (
    !dispatchEvent?.referenceId?.startsWith("mission-dispatch-batch:")
    || stored.events.at(-1)?.stage !== "DISPATCHED"
  ) {
    throw new Error("mission decision outcome is not at the dispatch boundary");
  }
  const [snapshot] = await tx.select().from(aiMissionDecisionOutcomeSnapshotsTable)
    .where(eq(aiMissionDecisionOutcomeSnapshotsTable.outcomeId, input.snapshotId));
  if (!snapshot || snapshot.outcome !== "ACHIEVED") {
    throw new Error("mission decision achieved outcome snapshot missing");
  }
  const persistedEvaluation = MissionStrategyPlanOutcomeEvaluationSchema.parse(snapshot.evaluation);
  if (
    snapshot.decisionId !== input.decisionId
    || snapshot.evidenceSetHash !== input.evaluation.evidenceSetHash
    || hashJson(persistedEvaluation) !== hashJson(input.evaluation)
  ) {
    throw new Error("mission decision outcome snapshot changed during finalization");
  }
  const last = stored.events.at(-1)!;
  const occurredAt = new Date(Math.max(input.occurredAt.getTime(), last.occurredAt.getTime() + 1));
  let sequence = last.sequence;
  for (const stage of ACHIEVED_OUTCOME_LIFECYCLE_STAGES) {
    sequence += 1;
    const [inserted] = await tx.insert(aiMissionDecisionEventsTable).values({
      id: eventIdentity(input.decisionId, stage),
      decisionId: input.decisionId,
      sequence,
      stage,
      referenceId: input.snapshotId,
      eventHash: eventHash({
        decisionId: input.decisionId,
        stage,
        referenceId: input.snapshotId,
        occurredAt,
      }),
      occurredAt,
    }).onConflictDoNothing().returning({
      sequence: aiMissionDecisionEventsTable.sequence,
    });
    if (!inserted) throw new Error("mission decision outcome lifecycle append conflicted");
  }
}

/**
 * Re-evaluates and persists the plan outcome and, only for ACHIEVED, appends
 * the complete plan-level lifecycle suffix in the same serializable transaction.
 * Root dispatch, provider output, and INCONCLUSIVE/NOT_ACHIEVED snapshots never
 * advance the lifecycle.
 */
export async function finalizeMissionPlanOutcome(
  decisionId: string,
  evaluatedAt = new Date(),
): Promise<MissionPlanOutcomeFinalizationResult> {
  return db.transaction(async (tx) => {
    const current = await getMissionDecisionTraceInTransaction(tx, decisionId);
    if (!current) return { kind: "not_ready", reason: "decision_missing" };
    const dispatchIndex = current.events.findIndex(({ stage }) => stage === "DISPATCHED");
    if (dispatchIndex < 0) {
      return { kind: "not_ready", reason: "trace_not_at_dispatch_boundary" };
    }
    const suffix = current.events.slice(
      dispatchIndex + 1,
    );
    if (suffix.length) {
      const snapshotId = suffix[0]?.referenceId;
      if (
        suffix.length !== 4
        || !snapshotId
        || suffix.some((event) => event.referenceId !== snapshotId)
      ) {
        throw new Error("mission decision outcome lifecycle suffix conflict");
      }
      const [snapshot] = await tx.select().from(aiMissionDecisionOutcomeSnapshotsTable)
        .where(eq(aiMissionDecisionOutcomeSnapshotsTable.outcomeId, snapshotId));
      if (!snapshot || snapshot.outcome !== "ACHIEVED") {
        throw new Error("mission decision outcome snapshot unavailable");
      }
      const evaluation = MissionStrategyPlanOutcomeEvaluationSchema.parse(snapshot.evaluation);
      return { kind: "already_recorded", snapshotId, evaluation };
    }

    const stored = await evaluateAndPersistMissionPlanOutcomeInTransaction(
      tx,
      decisionId,
      evaluatedAt,
    );
    if (stored.kind === "not_ready") return stored;
    if (stored.evaluation.outcome !== "ACHIEVED") {
      return {
        kind: stored.evaluation.outcome === "NOT_ACHIEVED" ? "not_achieved" : "inconclusive",
        snapshotId: stored.snapshotId,
        evaluation: stored.evaluation,
      };
    }
    await appendAchievedOutcomeLifecycleInTransaction(tx, {
      decisionId,
      snapshotId: stored.snapshotId,
      evaluation: stored.evaluation,
      occurredAt: evaluatedAt,
    });
    return { kind: "appended", snapshotId: stored.snapshotId, evaluation: stored.evaluation };
  }, { isolationLevel: "serializable" });
}

/**
 * Rebuilds pending plan-outcome work from the durable DISPATCHED event journal.
 * The journal remains the source of truth; the in-memory cursor only spreads
 * bounded polling across the ordered rows and may be discarded on restart.
 * Finalization itself is serializable and idempotent, and never replays tools.
 */
export async function reconcilePendingMissionPlanOutcomes(
  limit = 16,
  projectId?: string,
): Promise<number> {
  const batchSize = Number.isInteger(limit)
    ? Math.max(1, Math.min(MAX_MISSION_OUTCOME_RECONCILIATION_BATCH, limit))
    : 16;
  const cursorKey = projectId ?? "*";
  const cursor = missionOutcomeReconciliationCursors.get(cursorKey) ?? null;
  const [schema] = (await db.execute(sql`
    SELECT to_regclass('public.ai_mission_decision_outcome_snapshots') IS NOT NULL AS available
  `)).rows as Array<{ available?: unknown }>;
  if (schema?.available !== true) {
    if (!warnedOutcomeSchemaUnavailable) {
      warnedOutcomeSchemaUnavailable = true;
      logger.warn(
        { scope: "mission-outcome-reconciliation" },
        "outcome reconciliation is waiting for the required snapshot schema",
      );
    }
    return 0;
  }
  warnedOutcomeSchemaUnavailable = false;

  const cursorCondition = cursor
    ? sql`AND (event.occurred_at, event.decision_id) > (${cursor.occurredAt}::timestamp, ${cursor.decisionId})`
    : sql``;
  const projectCondition = projectId
    ? sql`AND trace.project_id = ${projectId}`
    : sql``;
  const rows = await db.execute(sql`
    SELECT event.decision_id AS "decisionId", event.occurred_at AS "occurredAt"
    FROM public.ai_mission_decision_events AS event
    JOIN public.ai_mission_decision_traces AS trace
      ON trace.decision_id = event.decision_id
    WHERE event.stage = 'DISPATCHED'
      AND trace.result_kind = 'SELECTED'
      AND NOT EXISTS (
        SELECT 1
        FROM public.ai_mission_decision_events AS later
        WHERE later.decision_id = event.decision_id
          AND later.sequence > event.sequence
      )
      ${projectCondition}
      ${cursorCondition}
    ORDER BY event.occurred_at ASC, event.decision_id ASC
    LIMIT ${batchSize}
  `);
  const candidates = rows.rows.flatMap((row) => {
    const item = record(row);
    if (typeof item.decisionId !== "string" || !item.decisionId) return [];
    const occurredAt = item.occurredAt instanceof Date
      ? item.occurredAt
      : new Date(String(item.occurredAt));
    return Number.isFinite(occurredAt.getTime())
      ? [{ decisionId: item.decisionId, occurredAt }]
      : [];
  });
  if (candidates.length === 0) {
    missionOutcomeReconciliationCursors.set(cursorKey, null);
    return 0;
  }

  const last = candidates.at(-1)!;
  missionOutcomeReconciliationCursors.set(cursorKey, {
    occurredAt: last.occurredAt,
    decisionId: last.decisionId,
  });

  let reconciled = 0;
  for (const candidate of candidates) {
    for (let attempt = 0; attempt < 2; attempt += 1) {
      try {
        await finalizeMissionPlanOutcome(candidate.decisionId);
        reconciled += 1;
        break;
      } catch (error) {
        if (attempt === 0 && isRetryableOutcomeTransactionConflict(error)) {
          await new Promise((resolve) => setTimeout(resolve, 20));
          continue;
        }
        logger.warn(
          {
            decisionId: candidate.decisionId,
            errorCode: outcomeTransactionErrorCode(error) ?? "unknown",
            retryCount: attempt,
            scope: "mission-outcome-reconciliation",
          },
          "Mission plan outcome reconciliation remains pending in durable dispatch evidence",
        );
        break;
      }
    }
  }
  return reconciled;
}
