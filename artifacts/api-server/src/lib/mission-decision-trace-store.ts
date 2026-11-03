import { createHash } from "node:crypto";
import { and, asc, eq, sql } from "drizzle-orm";
import {
  aiAgentEffectsTable,
  aiAgentEpisodesTable,
  aiAgentObservationsTable,
  eventsTable,
  aiExecutionAcceptancesTable,
  aiExecutionsTable,
  aiGoalDependenciesTable,
  aiGoalsTable,
  aiMissionDecisionDispatchBatchesTable,
  aiMissionDecisionDispatchItemsTable,
  aiMissionDecisionEventsTable,
  aiMissionDecisionTracesTable,
  aiMissionDecisionOutcomeSnapshotsTable,
  aiMissionsTable,
  aiWorldFactsTable,
  aiWorldTransitionsTable,
  db,
  projectsTable,
} from "@workspace/db";
import {
  hashMissionDecisionTrace,
  hashMissionStrategyAlternative,
  MissionStrategyPlanOutcomeEvaluationSchema,
  MissionDecisionTraceSchema,
} from "@workspace/ai-orchestrator";
import type { MissionDecisionTrace } from "@workspace/ai-orchestrator";
import { getProjectWorldState } from "./agent-state/world-state.js";
import { missionOutcomeSnapshotId } from "./mission-outcome-snapshot-identity.js";

export type MissionDecisionTransaction = Parameters<Parameters<typeof db.transaction>[0]>[0];
export type DecisionEventStage = MissionDecisionTrace["lifecycle"][number]["stage"];

const INITIAL_STAGES = ["PROPOSED", "EVALUATED", "SELECTED"] as const;
const LIFECYCLE_ORDER: readonly DecisionEventStage[] = [
  "PROPOSED",
  "EVALUATED",
  "SELECTED",
  "APPROVED",
  "PLAN_APPLIED",
  "DISPATCHED",
  "EXECUTED",
  "ACCEPTED",
  "VERIFIED",
  "EVALUATED_AFTER_EXECUTION",
];

export class MissionDecisionTraceStoreError extends Error {
  constructor(
    readonly code:
      | "invalid_initial_trace"
      | "decision_identity_conflict"
      | "decision_project_missing"
      | "decision_mission_mismatch"
      | "decision_goal_mismatch"
      | "decision_execution_mismatch"
      | "decision_acceptance_mismatch"
      | "decision_plan_revision_stale"
      | "decision_project_revision_mismatch"
      | "decision_world_state_revision_stale"
      | "decision_evidence_unverified"
      | "decision_trace_missing"
      | "decision_event_order_invalid"
      | "decision_event_reference_invalid"
      | "decision_event_conflict"
      | "decision_approval_binding_invalid"
      | "decision_dispatch_batch_invalid"
      | "decision_dispatch_batch_conflict"
      | "decision_dispatch_batch_empty"
      | "decision_dispatch_roots_mismatch",
  ) {
    super(code);
    this.name = "MissionDecisionTraceStoreError";
  }
}

function deterministicHash(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

export function eventIdentity(decisionId: string, stage: DecisionEventStage): string {
  return `mission-decision-event:${deterministicHash(`${decisionId}:${stage}`)}`;
}

export function eventHash(input: {
  decisionId: string;
  stage: DecisionEventStage;
  referenceId: string | null;
  occurredAt: Date;
}): string {
  return deterministicHash(JSON.stringify({
    decisionId: input.decisionId,
    stage: input.stage,
    referenceId: input.referenceId,
    occurredAt: input.occurredAt.toISOString(),
  }));
}

const PLAN_OUTCOME_LIFECYCLE_SUFFIX = [
  "EXECUTED",
  "ACCEPTED",
  "VERIFIED",
  "EVALUATED_AFTER_EXECUTION",
] as const satisfies readonly DecisionEventStage[];

async function assertMissionPlanOutcomeSnapshot(
  tx: MissionDecisionTransaction,
  input: {
    trace: MissionDecisionTrace;
    snapshotId: string;
    dispatchBatchId: string;
    planRevision: string;
  },
): Promise<typeof aiMissionDecisionOutcomeSnapshotsTable.$inferSelect> {
  const [snapshot] = await tx.select().from(aiMissionDecisionOutcomeSnapshotsTable)
    .where(eq(aiMissionDecisionOutcomeSnapshotsTable.outcomeId, input.snapshotId));
  const [batch] = await tx.select({
    manifestHash: aiMissionDecisionDispatchBatchesTable.manifestHash,
  }).from(aiMissionDecisionDispatchBatchesTable)
    .where(eq(aiMissionDecisionDispatchBatchesTable.dispatchBatchId, input.dispatchBatchId));
  const evaluationResult = snapshot
    ? MissionStrategyPlanOutcomeEvaluationSchema.safeParse(snapshot.evaluation)
    : null;
  const evaluation = evaluationResult?.success ? evaluationResult.data : null;
  const identity = input.trace.context.identity;
  const selectedStrategyId = input.trace.result.kind === "SELECTED"
    ? input.trace.result.selectedStrategyId
    : null;
  const expectedSnapshotId = evaluation
    ? missionOutcomeSnapshotId(input.trace.decisionId, evaluation)
    : null;
  if (
    !snapshot
    || !batch
    || !evaluation
    || snapshot.outcomeId !== expectedSnapshotId
    || snapshot.decisionId !== input.trace.decisionId
    || snapshot.projectId !== identity.projectId
    || snapshot.missionId !== identity.missionId
    || snapshot.sourceGoalId !== identity.goalId
    || snapshot.planRevision !== input.planRevision
    || snapshot.selectedStrategyId !== selectedStrategyId
    || snapshot.dispatchBatchId !== input.dispatchBatchId
    || snapshot.dispatchManifestHash !== batch.manifestHash
    || snapshot.evidenceSetHash !== evaluation.evidenceSetHash
    || snapshot.outcome !== "ACHIEVED"
    || snapshot.worldStateRevision === null
    || input.trace.newPlanRevision !== input.planRevision
    || evaluation.decisionId !== snapshot.decisionId
    || evaluation.projectId !== snapshot.projectId
    || evaluation.missionId !== snapshot.missionId
    || evaluation.sourceGoalId !== snapshot.sourceGoalId
    || evaluation.planRevision !== snapshot.planRevision
    || evaluation.selectedStrategyId !== snapshot.selectedStrategyId
    || evaluation.dispatchBatchId !== snapshot.dispatchBatchId
    || evaluation.dispatchManifestHash !== snapshot.dispatchManifestHash
    || evaluation.outcome !== "ACHIEVED"
    || evaluation.finalWorldState.revision !== snapshot.worldStateRevision
    || !evaluation.finalWorldState.continuityVerified
  ) {
    throw new MissionDecisionTraceStoreError("decision_event_reference_invalid");
  }
  return snapshot;
}

async function validateMissionPlanOutcomeLifecycleSuffix(
  tx: MissionDecisionTransaction,
  trace: MissionDecisionTrace,
  events: Array<{
    stage: string;
    referenceId: string | null;
  }>,
): Promise<void> {
  const dispatchIndex = events.findIndex(({ stage }) => stage === "DISPATCHED");
  const dispatchEvent = events[dispatchIndex];
  if (!dispatchEvent?.referenceId?.startsWith("mission-dispatch-batch:")) return;
  const suffix = events.slice(dispatchIndex + 1);
  if (suffix.length === 0) return;
  const snapshotId = suffix[0]?.referenceId;
  if (
    suffix.length !== PLAN_OUTCOME_LIFECYCLE_SUFFIX.length
    || !snapshotId
    || suffix.some((event, index) =>
      event.stage !== PLAN_OUTCOME_LIFECYCLE_SUFFIX[index]
      || event.referenceId !== snapshotId)
  ) {
    throw new MissionDecisionTraceStoreError("decision_event_order_invalid");
  }
  const planRevision = events.find(({ stage }) => stage === "PLAN_APPLIED")?.referenceId;
  if (!planRevision) throw new MissionDecisionTraceStoreError("decision_event_reference_invalid");
  await assertMissionPlanOutcomeSnapshot(tx, {
    trace,
    snapshotId,
    dispatchBatchId: dispatchEvent.referenceId,
    planRevision,
  });
}

const MISSION_GOAL_RUN_STATUSES = [
  "scheduled",
  "waiting",
  "blocked",
  "completed",
  "conflict",
] as const;

export type MissionDecisionDispatchRunStatus = typeof MISSION_GOAL_RUN_STATUSES[number];

export type MissionDecisionDispatchBatchItemInput = {
  position: number;
  goalId: string;
  executionId: string | null;
  runStatus: MissionDecisionDispatchRunStatus;
};

export type PersistMissionDecisionDispatchBatchInput = {
  decisionId: string;
  planRevision: string;
  occurredAt: Date;
  items: MissionDecisionDispatchBatchItemInput[];
};

function orderedDispatchItems(
  items: readonly MissionDecisionDispatchBatchItemInput[],
): MissionDecisionDispatchBatchItemInput[] {
  return [...items].sort((left, right) => left.position - right.position);
}

function dispatchBatchId(
  decisionId: string,
  planRevision: string,
  items: readonly MissionDecisionDispatchBatchItemInput[],
): string {
  const rootGoalIds = orderedDispatchItems(items).map(({ goalId }) => goalId);
  return `mission-dispatch-batch:${deterministicHash(JSON.stringify({
    decisionId,
    planRevision,
    rootGoalIds,
  }))}`;
}

function dispatchBatchManifestHash(input: {
  decisionId: string;
  projectId: string;
  missionId: string;
  planRevision: string;
  items: readonly MissionDecisionDispatchBatchItemInput[];
}): string {
  return deterministicHash(JSON.stringify({
    decisionId: input.decisionId,
    projectId: input.projectId,
    missionId: input.missionId,
    planRevision: input.planRevision,
    items: orderedDispatchItems(input.items),
  }));
}

function record(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function planRevisionHash(value: unknown): string | null {
  const hash = record(record(value).planRevision).hash;
  return typeof hash === "string" ? hash : null;
}

async function missionPlanApprovalReceipt(
  tx: MissionDecisionTransaction,
  trace: MissionDecisionTrace,
): Promise<string | null> {
  if (trace.result.kind !== "SELECTED" || !trace.newPlanRevision) return null;
  const selectedStrategy = trace.alternatives.find(
    ({ strategyId }) => strategyId === trace.result.selectedStrategyId,
  );
  if (
    !selectedStrategy
    || selectedStrategy.approvalRequirement !== "required"
    || trace.context.approval.status !== "required"
  ) {
    return null;
  }
  const planSelector = JSON.stringify({
    planRevision: {
      hash: trace.newPlanRevision,
      decisionTraceId: trace.decisionId,
    },
  });
  const goals = await tx.select().from(aiGoalsTable)
    .where(and(
      eq(aiGoalsTable.missionId, trace.context.identity.missionId),
      eq(aiGoalsTable.projectId, trace.context.identity.projectId),
      sql`${aiGoalsTable.outcomeContract} @> ${planSelector}::jsonb`,
      sql`${aiGoalsTable.successCriteria} @> ${planSelector}::jsonb`,
    ))
    .for("update");
  const snapshots = goals.map((goal) => record(record(goal.outcomeContract).planRevision));
  const planSnapshot = snapshots.find((snapshot) =>
    snapshot.hash === trace.newPlanRevision
    && snapshot.decisionTraceId === trace.decisionId
    && Array.isArray(snapshot.steps),
  );
  const steps = Array.isArray(planSnapshot?.steps) ? planSnapshot.steps.map(record) : [];
  const requiredStepIds = steps
    .filter((step) => step.approvalRequired === true && step.readOnly === false && step.kind === "execute")
    .map((step) => typeof step.id === "string" ? step.id : "")
    .filter(Boolean)
    .sort((left, right) => left.localeCompare(right));
  if (requiredStepIds.length === 0) return null;

  const approvalIdentity = hashMissionStrategyAlternative(selectedStrategy);
  const approvalRows: Array<{
    goalId: string;
    stepId: string;
    approvedBy: string;
    approvedAt: string;
    approvalEventId: string;
  }> = [];
  for (const stepId of requiredStepIds) {
    const goal = goals.find((candidate) =>
      record(candidate.successCriteria).stepId === stepId
      && record(candidate.outcomeContract).stepId === stepId,
    );
    if (!goal) return null;
    const approval = record(record(goal.outcomeContract).planApproval);
    if (
      approval.kind !== "mission_plan_step"
      || approval.state !== "APPROVED"
      || approval.planRevision !== trace.newPlanRevision
      || approval.stepId !== stepId
      || approval.decisionTraceId !== trace.decisionId
      || approval.approvedStrategyId !== selectedStrategy.strategyId
      || approval.approvedStrategyHash !== approvalIdentity
      || typeof approval.approvedBy !== "string"
      || !approval.approvedBy
      || typeof approval.approvedAt !== "string"
      || Number.isNaN(Date.parse(approval.approvedAt))
      || typeof approval.approvalEventId !== "string"
      || !approval.approvalEventId
    ) {
      return null;
    }
    const [approvalEvent] = await tx.select().from(eventsTable)
      .where(eq(eventsTable.id, approval.approvalEventId))
      .for("update");
    const eventPayload = record(approvalEvent?.payload);
    if (
      !approvalEvent
      || approvalEvent.type !== "AiGoalApprovalGranted"
      || approvalEvent.projectId !== trace.context.identity.projectId
      || approvalEvent.goalId !== goal.id
      || eventPayload.missionId !== trace.context.identity.missionId
      || eventPayload.goalId !== goal.id
      || eventPayload.approvalKind !== "mission_plan_step"
      || eventPayload.planRevision !== trace.newPlanRevision
      || eventPayload.stepId !== stepId
      || eventPayload.decisionTraceId !== trace.decisionId
      || eventPayload.approvedStrategyId !== selectedStrategy.strategyId
      || eventPayload.approvedStrategyHash !== approvalIdentity
    ) {
      return null;
    }
    approvalRows.push({
      goalId: goal.id,
      stepId,
      approvedBy: approval.approvedBy,
      approvedAt: approval.approvedAt,
      approvalEventId: approval.approvalEventId,
    });
  }
  const approvalSetHash = createHash("sha256")
    .update(JSON.stringify(approvalRows.sort((left, right) => left.stepId.localeCompare(right.stepId))))
    .digest("hex");
  return `mission-plan-approvals:${approvalSetHash}`;
}

function assertInitialTrace(trace: MissionDecisionTrace): void {
  const expectedStages = trace.result.kind === "SELECTED"
    ? INITIAL_STAGES
    : INITIAL_STAGES.slice(0, 2);
  const actualStages = trace.lifecycle.map(({ stage }) => stage);
  if (
    actualStages.length !== expectedStages.length
    || actualStages.some((stage, index) => stage !== expectedStages[index])
    || trace.dispatchRef !== null
    || (trace.result.kind !== "SELECTED" && trace.newPlanRevision !== null)
  ) {
    throw new MissionDecisionTraceStoreError("invalid_initial_trace");
  }
  const { decisionId, ...body } = trace;
  if (hashMissionDecisionTrace(body) !== decisionId) {
    throw new MissionDecisionTraceStoreError("invalid_initial_trace");
  }
}

async function assertCurrentIdentity(
  tx: MissionDecisionTransaction,
  trace: MissionDecisionTrace,
): Promise<void> {
  const identity = trace.context.identity;
  const [mission] = await tx.select().from(aiMissionsTable)
    .where(eq(aiMissionsTable.id, identity.missionId))
    .for("update");
  if (!mission || mission.projectId !== identity.projectId) {
    throw new MissionDecisionTraceStoreError("decision_mission_mismatch");
  }
  const [goal] = await tx.select().from(aiGoalsTable)
    .where(eq(aiGoalsTable.id, identity.goalId))
    .for("update");
  if (!goal || goal.missionId !== identity.missionId || goal.projectId !== identity.projectId) {
    throw new MissionDecisionTraceStoreError("decision_goal_mismatch");
  }

  if (identity.priorPlanRevision !== null) {
    const outcomePlan = planRevisionHash(goal.outcomeContract);
    const criteriaPlan = planRevisionHash(goal.successCriteria);
    const activePlan = record(mission.autonomyPolicy).activePlanRevision;
    if (
      outcomePlan !== identity.priorPlanRevision
      || criteriaPlan !== identity.priorPlanRevision
      || (typeof activePlan === "string" && activePlan !== identity.priorPlanRevision)
    ) {
      throw new MissionDecisionTraceStoreError("decision_plan_revision_stale");
    }
  }

  let sourceExecution: typeof aiExecutionsTable.$inferSelect | undefined;
  if (identity.sourceExecutionId !== null && identity.sourceAttempt !== null) {
    [sourceExecution] = await tx.select().from(aiExecutionsTable)
      .where(eq(aiExecutionsTable.id, identity.sourceExecutionId))
      .for("update");
    if (
      !sourceExecution
      || sourceExecution.projectId !== identity.projectId
      || sourceExecution.goalId !== identity.goalId
      || sourceExecution.attempt !== identity.sourceAttempt
    ) {
      throw new MissionDecisionTraceStoreError("decision_execution_mismatch");
    }
    if (
      identity.projectRevision !== null
      && sourceExecution.baseRevision !== identity.projectRevision
    ) {
      throw new MissionDecisionTraceStoreError("decision_project_revision_mismatch");
    }
  }

  if (identity.sourceAcceptanceId !== null) {
    const [acceptance] = await tx.select().from(aiExecutionAcceptancesTable)
      .where(eq(aiExecutionAcceptancesTable.id, identity.sourceAcceptanceId))
      .for("update");
    if (
      !acceptance
      || !sourceExecution
      || acceptance.executionId !== sourceExecution.id
      || acceptance.projectId !== identity.projectId
      || acceptance.attempt !== identity.sourceAttempt
    ) {
      throw new MissionDecisionTraceStoreError("decision_acceptance_mismatch");
    }
  }

  if (identity.worldStateRevision !== null) {
    const [project] = await tx.select({ id: projectsTable.id }).from(projectsTable)
      .where(eq(projectsTable.id, identity.projectId))
      .for("update");
    if (!project) throw new MissionDecisionTraceStoreError("decision_project_missing");
    const world = await getProjectWorldState(identity.projectId, undefined, tx);
    if (world.worldRevision !== identity.worldStateRevision) {
      throw new MissionDecisionTraceStoreError("decision_world_state_revision_stale");
    }
  }
  await assertEligibleEvidenceBindings(tx, trace);
}

async function assertEligibleEvidenceBindings(
  tx: MissionDecisionTransaction,
  trace: MissionDecisionTrace,
): Promise<void> {
  const identity = trace.context.identity;
  const eligibleRefs = trace.context.evidenceRefs.filter(({ eligibility }) => eligibility === "eligible");
  if (
    identity.sourceAcceptanceId !== null
    && !eligibleRefs.some(({ evidenceId, kind }) =>
      kind === "acceptance" && evidenceId === identity.sourceAcceptanceId,
    )
  ) {
    throw new MissionDecisionTraceStoreError("decision_evidence_unverified");
  }
  if (
    identity.worldStateRevision !== null
    && !eligibleRefs.some(({ kind }) =>
      kind === "world_state_fact" || kind === "world_transition" || kind === "observation",
    )
  ) {
    throw new MissionDecisionTraceStoreError("decision_evidence_unverified");
  }

  for (const ref of eligibleRefs) {
    if (
      ref.scope.projectId !== identity.projectId
      || (ref.scope.missionId !== null && ref.scope.missionId !== identity.missionId)
      || (ref.scope.goalId !== null && ref.scope.goalId !== identity.goalId)
    ) {
      throw new MissionDecisionTraceStoreError("decision_evidence_unverified");
    }
    if (ref.kind === "acceptance") {
      const [acceptance] = await tx.select().from(aiExecutionAcceptancesTable)
        .where(eq(aiExecutionAcceptancesTable.id, ref.evidenceId));
      const [execution] = acceptance
        ? await tx.select().from(aiExecutionsTable)
            .where(eq(aiExecutionsTable.id, acceptance.executionId))
        : [];
      if (
        !acceptance
        || !execution
        || acceptance.projectId !== identity.projectId
        || execution.goalId !== identity.goalId
        || acceptance.attempt !== ref.scope.attempt
        || (ref.scope.executionId !== null && acceptance.executionId !== ref.scope.executionId)
        || (ref.revisions.project !== null && acceptance.sourceRevision !== ref.revisions.project)
      ) {
        throw new MissionDecisionTraceStoreError("decision_evidence_unverified");
      }
      continue;
    }
    if (ref.kind === "execution") {
      const [execution] = await tx.select().from(aiExecutionsTable)
        .where(eq(aiExecutionsTable.id, ref.evidenceId));
      if (
        !execution
        || execution.projectId !== identity.projectId
        || execution.goalId !== identity.goalId
        || (ref.scope.attempt !== null && execution.attempt !== ref.scope.attempt)
      ) {
        throw new MissionDecisionTraceStoreError("decision_evidence_unverified");
      }
      continue;
    }
    if (ref.kind === "world_state_fact") {
      const [fact] = await tx.select().from(aiWorldFactsTable)
        .where(eq(aiWorldFactsTable.id, ref.evidenceId));
      if (
        !fact
        || fact.projectId !== identity.projectId
        || fact.status !== "confirmed"
        || fact.environmentFreshness !== "fresh"
        || (identity.projectRevision !== null && fact.projectRevision !== identity.projectRevision)
        || (ref.revisions.project !== null && fact.projectRevision !== ref.revisions.project)
        || (identity.environmentRevision !== null && fact.environmentRevision !== identity.environmentRevision)
        || (ref.revisions.environment !== null && fact.environmentRevision !== ref.revisions.environment)
        || fact.valueHash !== ref.contentHash
      ) {
        throw new MissionDecisionTraceStoreError("decision_evidence_unverified");
      }
      continue;
    }
    if (ref.kind === "world_transition") {
      const [transition] = await tx.select().from(aiWorldTransitionsTable)
        .where(eq(aiWorldTransitionsTable.id, ref.evidenceId));
      if (
        !transition
        || transition.projectId !== identity.projectId
        || transition.status !== "materialized"
        || transition.freshness !== "fresh"
        || transition.resultingWorldRevision !== identity.worldStateRevision
        || (ref.scope.executionId !== null && transition.executionId !== ref.scope.executionId)
        || (ref.scope.attempt !== null && transition.attempt !== ref.scope.attempt)
      ) {
        throw new MissionDecisionTraceStoreError("decision_evidence_unverified");
      }
      continue;
    }
    if (ref.kind === "observation") {
      const [observation] = await tx.select().from(aiAgentObservationsTable)
        .where(eq(aiAgentObservationsTable.id, ref.evidenceId));
      const [episode] = observation
        ? await tx.select().from(aiAgentEpisodesTable)
            .where(eq(aiAgentEpisodesTable.id, observation.episodeId))
        : [];
      const [execution] = observation
        ? await tx.select().from(aiExecutionsTable)
            .where(eq(aiExecutionsTable.id, observation.executionId))
        : [];
      if (
        !observation
        || !episode
        || !execution
        || observation.projectId !== identity.projectId
        || observation.completeness !== "complete"
        || observation.freshness !== "fresh"
        || observation.valueHash !== ref.contentHash
        || episode.projectId !== identity.projectId
        || episode.missionId !== identity.missionId
        || episode.goalId !== identity.goalId
        || execution.goalId !== identity.goalId
        || (ref.scope.executionId !== null && observation.executionId !== ref.scope.executionId)
        || (ref.scope.attempt !== null && episode.attempt !== ref.scope.attempt)
        || (identity.projectRevision !== null && observation.projectRevision !== identity.projectRevision)
        || (identity.environmentRevision !== null && observation.environmentRevision !== identity.environmentRevision)
      ) {
        throw new MissionDecisionTraceStoreError("decision_evidence_unverified");
      }
      continue;
    }
    if (ref.kind === "episode") {
      const [episode] = await tx.select().from(aiAgentEpisodesTable)
        .where(eq(aiAgentEpisodesTable.id, ref.evidenceId));
      if (
        !episode
        || episode.projectId !== identity.projectId
        || episode.missionId !== identity.missionId
        || episode.goalId !== identity.goalId
        || (ref.scope.executionId !== null && episode.executionId !== ref.scope.executionId)
        || (ref.scope.attempt !== null && episode.attempt !== ref.scope.attempt)
      ) {
        throw new MissionDecisionTraceStoreError("decision_evidence_unverified");
      }
      continue;
    }
    if (ref.kind === "effect") {
      const [effect] = await tx.select().from(aiAgentEffectsTable)
        .where(eq(aiAgentEffectsTable.id, ref.evidenceId));
      if (
        !effect
        || effect.projectId !== identity.projectId
        || effect.status !== "observed"
        || (ref.scope.executionId !== null && effect.executionId !== ref.scope.executionId)
        || (ref.scope.attempt !== null && effect.attempt !== ref.scope.attempt)
      ) {
        throw new MissionDecisionTraceStoreError("decision_evidence_unverified");
      }
      continue;
    }
    if (
      ref.kind === "plan"
      && identity.priorPlanRevision !== null
      && ref.evidenceId === identity.priorPlanRevision
    ) {
      continue;
    }
    throw new MissionDecisionTraceStoreError("decision_evidence_unverified");
  }
}

async function insertInitialEvents(
  tx: MissionDecisionTransaction,
  trace: MissionDecisionTrace,
): Promise<void> {
  const rows = trace.lifecycle.map((event, index) => {
    const occurredAt = new Date(event.at);
    return {
      id: eventIdentity(trace.decisionId, event.stage),
      decisionId: trace.decisionId,
      sequence: index + 1,
      stage: event.stage,
      referenceId: event.referenceId,
      eventHash: eventHash({
        decisionId: trace.decisionId,
        stage: event.stage,
        referenceId: event.referenceId,
        occurredAt,
      }),
      occurredAt,
    };
  });
  await tx.insert(aiMissionDecisionEventsTable).values(rows).onConflictDoNothing();
  const stored = await tx.select().from(aiMissionDecisionEventsTable)
    .where(eq(aiMissionDecisionEventsTable.decisionId, trace.decisionId))
    .orderBy(asc(aiMissionDecisionEventsTable.sequence));
  if (
    stored.length !== rows.length
    || stored.some((event, index) => event.id !== rows[index]!.id || event.eventHash !== rows[index]!.eventHash)
  ) {
    throw new MissionDecisionTraceStoreError("decision_event_conflict");
  }
}

/**
 * Persist a canonical pre-dispatch trace only after the server reloads and
 * verifies its Mission/Goal/Execution/Acceptance and current plan/world
 * bindings. This helper is intentionally not an API route or dispatch path.
 */
export async function persistMissionDecisionTraceInTransaction(
  tx: MissionDecisionTransaction,
  input: unknown,
): Promise<{ kind: "inserted" | "already_recorded"; decisionId: string }> {
  const trace = MissionDecisionTraceSchema.parse(input);
  assertInitialTrace(trace);

  await assertCurrentIdentity(tx, trace);
  const identity = trace.context.identity;
  const [inserted] = await tx.insert(aiMissionDecisionTracesTable).values({
    decisionId: trace.decisionId,
    projectId: identity.projectId,
    missionId: identity.missionId,
    goalId: identity.goalId,
    sourceExecutionId: identity.sourceExecutionId,
    sourceAcceptanceId: identity.sourceAcceptanceId,
    sourceAttempt: identity.sourceAttempt,
    priorPlanRevision: identity.priorPlanRevision,
    projectRevision: identity.projectRevision,
    worldStateRevision: identity.worldStateRevision,
    environmentRevision: identity.environmentRevision,
    contextHash: trace.contextHash,
    resultKind: trace.result.kind,
    selectedStrategyId: trace.result.kind === "SELECTED" ? trace.result.selectedStrategyId : null,
    trace: trace as unknown as Record<string, unknown>,
    createdAt: new Date(trace.decidedAt),
  }).onConflictDoNothing().returning({ decisionId: aiMissionDecisionTracesTable.decisionId });

  if (!inserted) {
    const [existing] = await tx.select().from(aiMissionDecisionTracesTable)
      .where(eq(aiMissionDecisionTracesTable.decisionId, trace.decisionId))
      .for("update");
    if (!existing) throw new MissionDecisionTraceStoreError("decision_identity_conflict");
    const existingTrace = MissionDecisionTraceSchema.safeParse(existing.trace);
    if (
      !existingTrace.success
      || existingTrace.data.decisionId !== trace.decisionId
      || existing.contextHash !== trace.contextHash
    ) {
      throw new MissionDecisionTraceStoreError("decision_identity_conflict");
    }
    await insertInitialEvents(tx, trace);
    return { kind: "already_recorded", decisionId: trace.decisionId };
  }

  await insertInitialEvents(tx, trace);
  return { kind: "inserted", decisionId: trace.decisionId };
}

export async function persistMissionDecisionTrace(
  input: unknown,
): Promise<{ kind: "inserted" | "already_recorded"; decisionId: string }> {
  return db.transaction((tx) => persistMissionDecisionTraceInTransaction(tx, input));
}

async function planRootGoalIds(
  tx: MissionDecisionTransaction,
  input: { missionId: string; projectId: string; planRevision: string },
): Promise<string[]> {
  const planRevisionJson = JSON.stringify({ planRevision: { hash: input.planRevision } });
  const planGoals = await tx.select({
    id: aiGoalsTable.id,
  }).from(aiGoalsTable)
    .where(and(
      eq(aiGoalsTable.missionId, input.missionId),
      eq(aiGoalsTable.projectId, input.projectId),
      sql`${aiGoalsTable.outcomeContract} @> ${planRevisionJson}::jsonb`,
      sql`${aiGoalsTable.successCriteria} @> ${planRevisionJson}::jsonb`,
    ))
    .orderBy(asc(aiGoalsTable.id))
    .for("update");
  const dependencies = await tx.select({
    goalId: aiGoalDependenciesTable.goalId,
  }).from(aiGoalDependenciesTable)
    .where(and(
      eq(aiGoalDependenciesTable.missionId, input.missionId),
      eq(aiGoalDependenciesTable.projectId, input.projectId),
      eq(aiGoalDependenciesTable.planRevision, input.planRevision),
    ))
    .orderBy(asc(aiGoalDependenciesTable.goalId), asc(aiGoalDependenciesTable.dependsOnGoalId))
    .for("update");
  const dependentGoalIds = new Set(dependencies.map(({ goalId }) => goalId));
  return planGoals.filter(({ id }) => !dependentGoalIds.has(id)).map(({ id }) => id);
}

async function assertStoredMissionDecisionDispatchBatch(
  tx: MissionDecisionTransaction,
  trace: MissionDecisionTrace,
  input: { dispatchBatchId: string; planRevision: string },
): Promise<{
  dispatchBatchId: string;
  state: "dispatched" | "partial";
  rootCount: number;
  manifestHash: string;
  createdAt: Date;
}> {
  const identity = trace.context.identity;
  const [batch] = await tx.select().from(aiMissionDecisionDispatchBatchesTable)
    .where(eq(aiMissionDecisionDispatchBatchesTable.dispatchBatchId, input.dispatchBatchId))
    .for("update");
  if (
    !batch
    || batch.decisionId !== trace.decisionId
    || batch.projectId !== identity.projectId
    || batch.missionId !== identity.missionId
    || batch.planRevision !== input.planRevision
    || !["dispatched", "partial"].includes(batch.state)
  ) {
    throw new MissionDecisionTraceStoreError("decision_dispatch_batch_invalid");
  }
  const items = await tx.select().from(aiMissionDecisionDispatchItemsTable)
    .where(eq(aiMissionDecisionDispatchItemsTable.dispatchBatchId, batch.dispatchBatchId))
    .orderBy(asc(aiMissionDecisionDispatchItemsTable.position))
    .for("update");
  if (items.length !== batch.rootCount || items.some(({ position }, index) => position !== index)) {
    throw new MissionDecisionTraceStoreError("decision_dispatch_batch_invalid");
  }
  const expectedRoots = await planRootGoalIds(tx, {
    missionId: identity.missionId,
    projectId: identity.projectId,
    planRevision: input.planRevision,
  });
  const itemGoalIds = items.map(({ goalId }) => goalId);
  if (
    expectedRoots.length !== itemGoalIds.length
    || expectedRoots.some((goalId) => !itemGoalIds.includes(goalId))
  ) {
    throw new MissionDecisionTraceStoreError("decision_dispatch_roots_mismatch");
  }
  const normalizedItems: MissionDecisionDispatchBatchItemInput[] = items.map((item) => ({
    position: item.position,
    goalId: item.goalId,
    executionId: item.executionId,
    runStatus: item.runStatus as MissionDecisionDispatchRunStatus,
  }));
  const expectedId = dispatchBatchId(trace.decisionId, input.planRevision, normalizedItems);
  const expectedHash = dispatchBatchManifestHash({
    decisionId: trace.decisionId,
    projectId: identity.projectId,
    missionId: identity.missionId,
    planRevision: input.planRevision,
    items: normalizedItems,
  });
  const dispatchedCount = items.filter(({ executionId }) => executionId !== null).length;
  if (
    expectedId !== batch.dispatchBatchId
    || expectedHash !== batch.manifestHash
    || batch.state !== (dispatchedCount === items.length ? "dispatched" : "partial")
    || dispatchedCount === 0
  ) {
    throw new MissionDecisionTraceStoreError("decision_dispatch_batch_invalid");
  }
  for (const item of items) {
    if (!item.executionId) continue;
    const [execution] = await tx.select().from(aiExecutionsTable)
      .where(and(
        eq(aiExecutionsTable.id, item.executionId),
        eq(aiExecutionsTable.projectId, identity.projectId),
        eq(aiExecutionsTable.goalId, item.goalId),
      ))
      .for("update");
    if (!execution || execution.id === identity.sourceExecutionId) {
      throw new MissionDecisionTraceStoreError("decision_dispatch_batch_invalid");
    }
  }
  return {
    dispatchBatchId: batch.dispatchBatchId,
    state: batch.state as "dispatched" | "partial",
    rootCount: batch.rootCount,
    manifestHash: batch.manifestHash,
    createdAt: batch.createdAt,
  };
}

export async function getValidatedMissionDecisionDispatchBatchInTransaction(
  tx: MissionDecisionTransaction,
  trace: MissionDecisionTrace,
  input: { dispatchBatchId: string; planRevision: string },
): Promise<{
  batch: Awaited<ReturnType<typeof assertStoredMissionDecisionDispatchBatch>>;
  items: Array<typeof aiMissionDecisionDispatchItemsTable.$inferSelect>;
}> {
  const batch = await assertStoredMissionDecisionDispatchBatch(tx, trace, input);
  const items = await tx.select().from(aiMissionDecisionDispatchItemsTable)
    .where(eq(aiMissionDecisionDispatchItemsTable.dispatchBatchId, batch.dispatchBatchId))
    .orderBy(asc(aiMissionDecisionDispatchItemsTable.position));
  return { batch, items };
}

/**
 * Persist one immutable dispatch manifest for every root Goal in the applied
 * revision. A successful root must name the exact persisted Execution; labels
 * and Goal IDs alone are never treated as dispatch proof.
 */
export async function persistMissionDecisionDispatchBatchInTransaction(
  tx: MissionDecisionTransaction,
  input: PersistMissionDecisionDispatchBatchInput,
): Promise<{
  kind: "inserted" | "already_recorded";
  dispatchBatchId: string;
  state: "dispatched" | "partial";
  rootCount: number;
  manifestHash: string;
  createdAt: Date;
}> {
  const [candidateDecision] = await tx.select().from(aiMissionDecisionTracesTable)
    .where(eq(aiMissionDecisionTracesTable.decisionId, input.decisionId));
  if (!candidateDecision) throw new MissionDecisionTraceStoreError("decision_trace_missing");
  const candidateTrace = MissionDecisionTraceSchema.parse(candidateDecision.trace);
  if (candidateTrace.result.kind !== "SELECTED") {
    throw new MissionDecisionTraceStoreError("decision_event_order_invalid");
  }
  const identity = candidateTrace.context.identity;
  const [mission] = await tx.select().from(aiMissionsTable)
    .where(and(
      eq(aiMissionsTable.id, identity.missionId),
      eq(aiMissionsTable.projectId, identity.projectId),
    ))
    .for("update");
  if (!mission) throw new MissionDecisionTraceStoreError("decision_mission_mismatch");
  const [sourceGoal] = await tx.select().from(aiGoalsTable)
    .where(and(
      eq(aiGoalsTable.id, identity.goalId),
      eq(aiGoalsTable.missionId, identity.missionId),
      eq(aiGoalsTable.projectId, identity.projectId),
    ))
    .for("update");
  if (!sourceGoal) throw new MissionDecisionTraceStoreError("decision_goal_mismatch");
  const [decision] = await tx.select().from(aiMissionDecisionTracesTable)
    .where(eq(aiMissionDecisionTracesTable.decisionId, input.decisionId))
    .for("update");
  if (!decision) throw new MissionDecisionTraceStoreError("decision_trace_missing");
  const trace = MissionDecisionTraceSchema.parse(decision.trace);
  if (
    trace.result.kind !== "SELECTED"
    || trace.context.identity.missionId !== identity.missionId
    || trace.context.identity.goalId !== identity.goalId
    || trace.context.identity.projectId !== identity.projectId
  ) {
    throw new MissionDecisionTraceStoreError("decision_identity_conflict");
  }
  const events = await tx.select().from(aiMissionDecisionEventsTable)
    .where(eq(aiMissionDecisionEventsTable.decisionId, input.decisionId))
    .orderBy(asc(aiMissionDecisionEventsTable.sequence));
  const appliedPlanRevision = events.find(({ stage }) => stage === "PLAN_APPLIED")?.referenceId;
  if (
    !appliedPlanRevision
    || appliedPlanRevision !== input.planRevision
    || record(mission.autonomyPolicy).activePlanRevision !== input.planRevision
  ) {
    throw new MissionDecisionTraceStoreError("decision_event_reference_invalid");
  }

  const items = orderedDispatchItems(input.items);
  if (
    items.length === 0
    || items.length > 64
    || items.some((item, index) =>
      item.position !== index
      || !item.goalId.trim()
      || !MISSION_GOAL_RUN_STATUSES.includes(item.runStatus)
      || ((item.runStatus === "scheduled" || item.runStatus === "completed") && !item.executionId)
    )
    || new Set(items.map(({ goalId }) => goalId)).size !== items.length
    || new Set(items.flatMap(({ executionId }) => executionId ? [executionId] : [])).size
      !== items.filter(({ executionId }) => executionId !== null).length
  ) {
    throw new MissionDecisionTraceStoreError("decision_dispatch_batch_invalid");
  }
  const expectedRoots = await planRootGoalIds(tx, {
    missionId: identity.missionId,
    projectId: identity.projectId,
    planRevision: input.planRevision,
  });
  if (
    expectedRoots.length !== items.length
    || expectedRoots.some((goalId) => !items.some((item) => item.goalId === goalId))
  ) {
    throw new MissionDecisionTraceStoreError("decision_dispatch_roots_mismatch");
  }
  const dispatchedCount = items.filter(({ executionId }) => executionId !== null).length;
  if (dispatchedCount === 0) {
    throw new MissionDecisionTraceStoreError("decision_dispatch_batch_empty");
  }
  for (const item of items) {
    if (!item.executionId) continue;
    const [execution] = await tx.select().from(aiExecutionsTable)
      .where(and(
        eq(aiExecutionsTable.id, item.executionId),
        eq(aiExecutionsTable.projectId, identity.projectId),
        eq(aiExecutionsTable.goalId, item.goalId),
      ))
      .for("update");
    if (!execution || execution.id === identity.sourceExecutionId) {
      throw new MissionDecisionTraceStoreError("decision_dispatch_batch_invalid");
    }
  }

  const state = dispatchedCount === items.length ? "dispatched" as const : "partial" as const;
  const createdAt = input.occurredAt;
  const batchId = dispatchBatchId(trace.decisionId, input.planRevision, items);
  const manifestHash = dispatchBatchManifestHash({
    decisionId: trace.decisionId,
    projectId: identity.projectId,
    missionId: identity.missionId,
    planRevision: input.planRevision,
    items,
  });
  const [inserted] = await tx.insert(aiMissionDecisionDispatchBatchesTable).values({
    dispatchBatchId: batchId,
    decisionId: trace.decisionId,
    projectId: identity.projectId,
    missionId: identity.missionId,
    planRevision: input.planRevision,
    manifestHash,
    state,
    rootCount: items.length,
    createdAt,
  }).onConflictDoNothing()
    .returning({ dispatchBatchId: aiMissionDecisionDispatchBatchesTable.dispatchBatchId });
  if (inserted) {
    await tx.insert(aiMissionDecisionDispatchItemsTable).values(items.map((item) => ({
      dispatchBatchId: batchId,
      position: item.position,
      goalId: item.goalId,
      executionId: item.executionId,
      runStatus: item.runStatus,
    })));
  } else {
    const [existing] = await tx.select().from(aiMissionDecisionDispatchBatchesTable)
      .where(and(
        eq(aiMissionDecisionDispatchBatchesTable.decisionId, trace.decisionId),
        eq(aiMissionDecisionDispatchBatchesTable.planRevision, input.planRevision),
      ))
      .for("update");
    if (
      !existing
      || existing.dispatchBatchId !== batchId
      || existing.manifestHash !== manifestHash
    ) {
      throw new MissionDecisionTraceStoreError("decision_dispatch_batch_conflict");
    }
  }
  const persisted = await assertStoredMissionDecisionDispatchBatch(tx, trace, {
    dispatchBatchId: batchId,
    planRevision: input.planRevision,
  });
  return {
    kind: inserted ? "inserted" : "already_recorded",
    ...persisted,
  };
}

export async function persistMissionDecisionDispatchBatch(
  input: PersistMissionDecisionDispatchBatchInput,
): Promise<{
  kind: "inserted" | "already_recorded";
  dispatchBatchId: string;
  state: "dispatched" | "partial";
  rootCount: number;
  manifestHash: string;
  createdAt: Date;
}> {
  return db.transaction((tx) => persistMissionDecisionDispatchBatchInTransaction(tx, input));
}

export async function getMissionDecisionDispatchBatch(dispatchBatchId: string): Promise<{
  batch: typeof aiMissionDecisionDispatchBatchesTable.$inferSelect;
  items: Array<typeof aiMissionDecisionDispatchItemsTable.$inferSelect>;
} | null> {
  const [batch] = await db.select().from(aiMissionDecisionDispatchBatchesTable)
    .where(eq(aiMissionDecisionDispatchBatchesTable.dispatchBatchId, dispatchBatchId));
  if (!batch) return null;
  const items = await db.select().from(aiMissionDecisionDispatchItemsTable)
    .where(eq(aiMissionDecisionDispatchItemsTable.dispatchBatchId, dispatchBatchId))
    .orderBy(asc(aiMissionDecisionDispatchItemsTable.position));
  return { batch, items };
}

/**
 * Append a lifecycle pointer under Mission -> Goal -> Decision locks. Event
 * references are provenance only and never satisfy a proof, authorization, or
 * dispatch gate.
 */
export type AppendMissionDecisionLifecycleEventInput = {
  decisionId: string;
  stage: DecisionEventStage;
  referenceId: string | null;
  occurredAt: Date;
};

export async function appendMissionDecisionLifecycleEventInTransaction(
  tx: MissionDecisionTransaction,
  input: AppendMissionDecisionLifecycleEventInput,
): Promise<{ kind: "appended" | "already_recorded"; sequence: number }> {
    const [candidateDecision] = await tx.select().from(aiMissionDecisionTracesTable)
      .where(eq(aiMissionDecisionTracesTable.decisionId, input.decisionId))
    if (!candidateDecision) throw new MissionDecisionTraceStoreError("decision_trace_missing");
    const candidateTrace = MissionDecisionTraceSchema.parse(candidateDecision.trace);
    const identity = candidateTrace.context.identity;
    const [mission] = await tx.select().from(aiMissionsTable)
      .where(and(
        eq(aiMissionsTable.id, identity.missionId),
        eq(aiMissionsTable.projectId, identity.projectId),
      ))
      .for("update");
    if (!mission) throw new MissionDecisionTraceStoreError("decision_mission_mismatch");
    const [goal] = await tx.select().from(aiGoalsTable)
      .where(and(
        eq(aiGoalsTable.id, identity.goalId),
        eq(aiGoalsTable.missionId, identity.missionId),
        eq(aiGoalsTable.projectId, identity.projectId),
      ))
      .for("update");
    if (!goal) throw new MissionDecisionTraceStoreError("decision_goal_mismatch");
    const [decision] = await tx.select().from(aiMissionDecisionTracesTable)
      .where(eq(aiMissionDecisionTracesTable.decisionId, input.decisionId))
      .for("update");
    if (!decision) throw new MissionDecisionTraceStoreError("decision_trace_missing");
    const trace = MissionDecisionTraceSchema.parse(decision.trace);
    if (
      trace.context.identity.missionId !== identity.missionId
      || trace.context.identity.goalId !== identity.goalId
      || trace.context.identity.projectId !== identity.projectId
    ) {
      throw new MissionDecisionTraceStoreError("decision_identity_conflict");
    }
    if (trace.result.kind !== "SELECTED") {
      throw new MissionDecisionTraceStoreError("decision_event_order_invalid");
    }
    if (
      ["APPROVED", "PLAN_APPLIED", "DISPATCHED", "EXECUTED", "ACCEPTED", "VERIFIED"].includes(input.stage)
      && !input.referenceId
    ) {
      throw new MissionDecisionTraceStoreError("decision_event_reference_invalid");
    }
    const events = await tx.select().from(aiMissionDecisionEventsTable)
      .where(eq(aiMissionDecisionEventsTable.decisionId, input.decisionId))
      .orderBy(asc(aiMissionDecisionEventsTable.sequence));
    const duplicate = events.find(({ stage }) => stage === input.stage);
    const occurredAt = input.occurredAt;
    const calculatedHash = eventHash({
      decisionId: input.decisionId,
      stage: input.stage,
      referenceId: input.referenceId,
      occurredAt,
    });
    if (duplicate) {
      if (
        duplicate.eventHash === calculatedHash
        && duplicate.referenceId === input.referenceId
      ) {
        return { kind: "already_recorded", sequence: duplicate.sequence };
      }
      throw new MissionDecisionTraceStoreError("decision_event_conflict");
    }

    const last = events.at(-1);
    const lastIndex = last ? LIFECYCLE_ORDER.indexOf(last.stage as DecisionEventStage) : -1;
    const nextIndex = LIFECYCLE_ORDER.indexOf(input.stage);
    const canSkipApproval =
      input.stage === "PLAN_APPLIED"
      && last?.stage === "SELECTED"
      && trace.alternatives.find(({ strategyId }) =>
        strategyId === trace.result.selectedStrategyId,
      )?.approvalRequirement === "not_required";
    if (
      !last
      || nextIndex < 0
      || (nextIndex !== lastIndex + 1 && !canSkipApproval)
      || occurredAt.getTime() < last.occurredAt.getTime()
    ) {
      throw new MissionDecisionTraceStoreError("decision_event_order_invalid");
    }

    const selectedStrategy = trace.alternatives.find(({ strategyId }) =>
      strategyId === trace.result.selectedStrategyId,
    );
    if (input.stage === "APPROVED") {
      const approvalReceipt = await missionPlanApprovalReceipt(tx, trace);
      const approvalMatches =
        selectedStrategy?.approvalRequirement === "required"
        && approvalReceipt === input.referenceId;
      if (!approvalMatches) {
        throw new MissionDecisionTraceStoreError("decision_approval_binding_invalid");
      }
    }
    if (input.stage === "PLAN_APPLIED") {
      const activePlan = mission ? record(mission.autonomyPolicy).activePlanRevision : null;
      if (!input.referenceId) {
        throw new MissionDecisionTraceStoreError("decision_event_reference_invalid");
      }
      const planRevisionJson = JSON.stringify({ planRevision: { hash: input.referenceId } });
      const missionGoals = await tx.select().from(aiGoalsTable)
        .where(and(
          eq(aiGoalsTable.missionId, identity.missionId),
          eq(aiGoalsTable.projectId, identity.projectId),
          sql`${aiGoalsTable.outcomeContract} @> ${planRevisionJson}::jsonb`,
          sql`${aiGoalsTable.successCriteria} @> ${planRevisionJson}::jsonb`,
        ))
        .for("update");
      const appliedPlanExists = missionGoals.some((candidateGoal) =>
        planRevisionHash(candidateGoal.outcomeContract) === input.referenceId
        && planRevisionHash(candidateGoal.successCriteria) === input.referenceId,
      );
      if (
        !input.referenceId
        || input.referenceId === trace.priorPlanRevision
        || (
          trace.newPlanRevision !== null
          && input.referenceId !== trace.newPlanRevision
        )
        || !appliedPlanExists
        || (typeof activePlan === "string" && activePlan !== input.referenceId)
      ) {
        throw new MissionDecisionTraceStoreError("decision_event_reference_invalid");
      }
    }
    if (input.stage === "DISPATCHED") {
      const identity = trace.context.identity;
      const appliedPlanRevision = events.find(({ stage }) => stage === "PLAN_APPLIED")?.referenceId;
      if (input.referenceId!.startsWith("mission-dispatch-batch:")) {
        await assertStoredMissionDecisionDispatchBatch(tx, trace, {
          dispatchBatchId: input.referenceId!,
          planRevision: appliedPlanRevision ?? "",
        });
      } else {
        const [candidateExecution] = await tx.select({
          goalId: aiExecutionsTable.goalId,
        }).from(aiExecutionsTable)
          .where(and(
            eq(aiExecutionsTable.id, input.referenceId!),
            eq(aiExecutionsTable.projectId, identity.projectId),
          ));
        const targetGoalId = candidateExecution?.goalId;
        const [targetGoal] = targetGoalId
          ? await tx.select().from(aiGoalsTable)
              .where(and(
                eq(aiGoalsTable.id, targetGoalId),
                eq(aiGoalsTable.missionId, identity.missionId),
                eq(aiGoalsTable.projectId, identity.projectId),
              ))
              .for("update")
          : [];
        const [execution] = targetGoalId && targetGoal
          ? await tx.select().from(aiExecutionsTable)
              .where(and(
                eq(aiExecutionsTable.id, input.referenceId!),
                eq(aiExecutionsTable.projectId, identity.projectId),
                eq(aiExecutionsTable.goalId, targetGoal.id),
              ))
              .for("update")
          : [];
        if (
          !execution
          || execution.id === identity.sourceExecutionId
          || !targetGoal
          || !appliedPlanRevision
          || planRevisionHash(targetGoal.outcomeContract) !== appliedPlanRevision
          || planRevisionHash(targetGoal.successCriteria) !== appliedPlanRevision
        ) {
          throw new MissionDecisionTraceStoreError("decision_event_reference_invalid");
        }
      }
    }
    if (input.stage === "EXECUTED") {
      if (last.stage === "DISPATCHED" && last.referenceId?.startsWith("mission-dispatch-batch:")) {
        // A root dispatch batch is not a full-plan completion manifest. Do not
        // let its aggregate pointer stand in for every later Goal outcome.
        throw new MissionDecisionTraceStoreError("decision_event_order_invalid");
      }
      if (input.referenceId !== last.referenceId) {
        throw new MissionDecisionTraceStoreError("decision_event_reference_invalid");
      }
    }
    if (input.stage === "ACCEPTED") {
      const executedExecutionId = last?.stage === "EXECUTED" ? last.referenceId : null;
      const appliedPlanRevision = events.find(({ stage }) => stage === "PLAN_APPLIED")?.referenceId;
      const [candidateExecution] = executedExecutionId
        ? await tx.select({ goalId: aiExecutionsTable.goalId }).from(aiExecutionsTable)
            .where(and(
              eq(aiExecutionsTable.id, executedExecutionId),
              eq(aiExecutionsTable.projectId, trace.context.identity.projectId),
            ))
        : [];
      const targetGoalId = candidateExecution?.goalId;
      const [targetGoal] = targetGoalId
        ? await tx.select().from(aiGoalsTable)
            .where(and(
              eq(aiGoalsTable.id, targetGoalId),
              eq(aiGoalsTable.missionId, trace.context.identity.missionId),
              eq(aiGoalsTable.projectId, trace.context.identity.projectId),
            ))
            .for("update")
        : [];
      const [executedExecution] = targetGoalId && targetGoal
        ? await tx.select().from(aiExecutionsTable)
            .where(and(
              eq(aiExecutionsTable.id, executedExecutionId!),
              eq(aiExecutionsTable.projectId, trace.context.identity.projectId),
              eq(aiExecutionsTable.goalId, targetGoal.id),
            ))
            .for("update")
        : [];
      const [acceptance] = await tx.select().from(aiExecutionAcceptancesTable)
        .where(eq(aiExecutionAcceptancesTable.id, input.referenceId!))
        .for("update");
      if (
        !executedExecution
        || !acceptance
        || !targetGoal
        || !appliedPlanRevision
        || planRevisionHash(targetGoal.outcomeContract) !== appliedPlanRevision
        || planRevisionHash(targetGoal.successCriteria) !== appliedPlanRevision
        || acceptance.executionId !== executedExecution.id
        || acceptance.projectId !== trace.context.identity.projectId
        || acceptance.attempt !== executedExecution.attempt
      ) {
        throw new MissionDecisionTraceStoreError("decision_event_reference_invalid");
      }
    }

    const sequence = (last?.sequence ?? 0) + 1;
    const [inserted] = await tx.insert(aiMissionDecisionEventsTable).values({
      id: eventIdentity(input.decisionId, input.stage),
      decisionId: input.decisionId,
      sequence,
      stage: input.stage,
      referenceId: input.referenceId,
      eventHash: calculatedHash,
      occurredAt,
    }).onConflictDoNothing().returning({ sequence: aiMissionDecisionEventsTable.sequence });
    if (!inserted) throw new MissionDecisionTraceStoreError("decision_event_conflict");
    return { kind: "appended", sequence: inserted.sequence };
}

export async function appendMissionDecisionApprovalLifecycleEventsInTransaction(
  tx: MissionDecisionTransaction,
  decisionId: string,
  occurredAt: Date,
): Promise<"pending" | "not_required" | "appended" | "already_recorded"> {
  const [decision] = await tx.select().from(aiMissionDecisionTracesTable)
    .where(eq(aiMissionDecisionTracesTable.decisionId, decisionId))
    .for("update");
  if (!decision) throw new MissionDecisionTraceStoreError("decision_trace_missing");
  const trace = MissionDecisionTraceSchema.parse(decision.trace);
  const selectedStrategy = trace.result.kind === "SELECTED"
    ? trace.alternatives.find(({ strategyId }) => strategyId === trace.result.selectedStrategyId)
    : undefined;
  if (selectedStrategy?.approvalRequirement !== "required") return "not_required";
  const approvalReference = await missionPlanApprovalReceipt(tx, trace);
  if (!approvalReference) return "pending";
  if (!trace.newPlanRevision) {
    throw new MissionDecisionTraceStoreError("decision_event_reference_invalid");
  }

  const events = await tx.select().from(aiMissionDecisionEventsTable)
    .where(eq(aiMissionDecisionEventsTable.decisionId, decisionId))
    .orderBy(asc(aiMissionDecisionEventsTable.sequence));
  const approvalEvent = events.find(({ stage }) => stage === "APPROVED");
  const appliedEvent = events.find(({ stage }) => stage === "PLAN_APPLIED");
  if (approvalEvent || appliedEvent) {
    if (
      approvalEvent?.referenceId === approvalReference
      && appliedEvent?.referenceId === trace.newPlanRevision
    ) {
      return "already_recorded";
    }
    throw new MissionDecisionTraceStoreError("decision_event_conflict");
  }
  const last = events.at(-1);
  if (!last || last.stage !== "SELECTED") {
    throw new MissionDecisionTraceStoreError("decision_event_order_invalid");
  }
  const approvedAt = new Date(Math.max(
    occurredAt.getTime(),
    last.occurredAt.getTime() + 1,
  ));
  await appendMissionDecisionLifecycleEventInTransaction(tx, {
    decisionId,
    stage: "APPROVED",
    referenceId: approvalReference,
    occurredAt: approvedAt,
  });
  await appendMissionDecisionLifecycleEventInTransaction(tx, {
    decisionId,
    stage: "PLAN_APPLIED",
    referenceId: trace.newPlanRevision,
    occurredAt: new Date(approvedAt.getTime() + 1),
  });
  return "appended";
}

export async function appendMissionDecisionLifecycleEvent(input: AppendMissionDecisionLifecycleEventInput): Promise<{
  kind: "appended" | "already_recorded";
  sequence: number;
}> {
  return db.transaction((tx) => appendMissionDecisionLifecycleEventInTransaction(tx, input));
}

/**
 * Atomically persists a multi-root dispatch manifest and its DISPATCHED
 * lifecycle pointer. The event points to a manifest, never to an arbitrary
 * first Execution; later EXECUTED/ACCEPTED events remain blocked until a
 * separate aggregate outcome contract exists.
 */
export async function recordMissionDecisionDispatchBatchInTransaction(
  tx: MissionDecisionTransaction,
  input: PersistMissionDecisionDispatchBatchInput,
): Promise<{
  batch: Awaited<ReturnType<typeof persistMissionDecisionDispatchBatchInTransaction>>;
  event: { kind: "appended" | "already_recorded"; sequence: number };
}> {
  const batch = await persistMissionDecisionDispatchBatchInTransaction(tx, input);
  const event = await appendMissionDecisionLifecycleEventInTransaction(tx, {
    decisionId: input.decisionId,
    stage: "DISPATCHED",
    referenceId: batch.dispatchBatchId,
    occurredAt: batch.createdAt,
  });
  return { batch, event };
}

export async function recordMissionDecisionDispatchBatch(
  input: PersistMissionDecisionDispatchBatchInput,
): Promise<{
  batch: Awaited<ReturnType<typeof persistMissionDecisionDispatchBatchInTransaction>>;
  event: { kind: "appended" | "already_recorded"; sequence: number };
}> {
  return db.transaction((tx) => recordMissionDecisionDispatchBatchInTransaction(tx, input));
}

export async function getMissionDecisionTraceInTransaction(
  tx: MissionDecisionTransaction,
  decisionId: string,
): Promise<{ trace: MissionDecisionTrace; events: Array<{
  id: string;
  sequence: number;
  stage: string;
  referenceId: string | null;
  eventHash: string;
  occurredAt: Date;
}> } | null> {
  const [stored] = await tx.select().from(aiMissionDecisionTracesTable)
    .where(eq(aiMissionDecisionTracesTable.decisionId, decisionId));
  if (!stored) return null;
  const trace = MissionDecisionTraceSchema.parse(stored.trace);
  const events = await tx.select({
    id: aiMissionDecisionEventsTable.id,
    sequence: aiMissionDecisionEventsTable.sequence,
    stage: aiMissionDecisionEventsTable.stage,
    referenceId: aiMissionDecisionEventsTable.referenceId,
    eventHash: aiMissionDecisionEventsTable.eventHash,
    occurredAt: aiMissionDecisionEventsTable.occurredAt,
  }).from(aiMissionDecisionEventsTable)
    .where(eq(aiMissionDecisionEventsTable.decisionId, decisionId))
    .orderBy(asc(aiMissionDecisionEventsTable.sequence));
  if (
    events.length < trace.lifecycle.length
    || events.some((event, index) => {
      const occurredAt = event.occurredAt;
      return event.sequence !== index + 1
        || event.id !== eventIdentity(decisionId, event.stage as DecisionEventStage)
        || event.eventHash !== eventHash({
          decisionId,
          stage: event.stage as DecisionEventStage,
          referenceId: event.referenceId,
          occurredAt,
        })
        || (index < trace.lifecycle.length && (
          event.stage !== trace.lifecycle[index]!.stage
          || event.referenceId !== trace.lifecycle[index]!.referenceId
          || event.occurredAt.toISOString() !== new Date(trace.lifecycle[index]!.at).toISOString()
        ));
    })
  ) {
    throw new MissionDecisionTraceStoreError("decision_event_conflict");
  }
  const selectedStrategy = trace.result.kind === "SELECTED"
    ? trace.alternatives.find(({ strategyId }) => strategyId === trace.result.selectedStrategyId)
    : undefined;
  for (let index = 1; index < events.length; index++) {
    const previous = events[index - 1]!;
    const current = events[index]!;
    const previousIndex = LIFECYCLE_ORDER.indexOf(previous.stage as DecisionEventStage);
    const currentIndex = LIFECYCLE_ORDER.indexOf(current.stage as DecisionEventStage);
    const validSkip = previous.stage === "SELECTED"
      && current.stage === "PLAN_APPLIED"
      && selectedStrategy?.approvalRequirement === "not_required";
    if (
      currentIndex < 0
      || (currentIndex !== previousIndex + 1 && !validSkip)
      || current.occurredAt.getTime() < previous.occurredAt.getTime()
    ) {
      throw new MissionDecisionTraceStoreError("decision_event_order_invalid");
    }
    if (current.stage === "APPROVED") {
      const approvalReceipt = await missionPlanApprovalReceipt(tx, trace);
      if (
        selectedStrategy?.approvalRequirement !== "required"
        || approvalReceipt !== current.referenceId
      ) {
        throw new MissionDecisionTraceStoreError("decision_approval_binding_invalid");
      }
    }
    if (
      current.stage === "PLAN_APPLIED"
      && trace.newPlanRevision !== null
      && current.referenceId !== trace.newPlanRevision
    ) {
      throw new MissionDecisionTraceStoreError("decision_event_reference_invalid");
    }
    const planOutcomeExecution =
      previous.stage === "DISPATCHED"
      && previous.referenceId?.startsWith("mission-dispatch-batch:") === true;
    if (
      current.stage === "EXECUTED"
      && !planOutcomeExecution
      && current.referenceId !== previous.referenceId
    ) {
      throw new MissionDecisionTraceStoreError("decision_event_reference_invalid");
    }
  }
  await validateMissionPlanOutcomeLifecycleSuffix(tx, trace, events);
  return { trace, events };
}

export async function getMissionDecisionTrace(
  decisionId: string,
): Promise<{
  trace: MissionDecisionTrace;
  events: Array<{
    id: string;
    sequence: number;
    stage: string;
    referenceId: string | null;
    eventHash: string;
    occurredAt: Date;
  }>;
} | null> {
  return db.transaction(
    (tx) => getMissionDecisionTraceInTransaction(tx, decisionId),
    { isolationLevel: "repeatable read" },
  );
}

export async function getApprovedMissionDecisionDispatchPlan(
  decisionId: string,
): Promise<{
  decisionId: string;
  projectId: string;
  missionId: string;
  userId: string;
  planRevision: string;
  rootGoalIds: string[];
} | null> {
  const snapshot = await getMissionDecisionTrace(decisionId);
  if (!snapshot || snapshot.trace.result.kind !== "SELECTED") return null;

  const selectedAlternative = snapshot.trace.alternatives.find(
    ({ strategyId }) => strategyId === snapshot.trace.result.selectedStrategyId,
  );
  const approvedIndex = snapshot.events.findIndex(({ stage }) => stage === "APPROVED");
  const appliedEvent = snapshot.events.find(({ stage }) => stage === "PLAN_APPLIED");
  if (
    selectedAlternative?.approvalRequirement !== "required"
    || approvedIndex < 0
    || !appliedEvent?.referenceId
    || approvedIndex >= snapshot.events.findIndex(({ stage }) => stage === "PLAN_APPLIED")
    || snapshot.events.some(({ stage }) => stage === "DISPATCHED")
  ) {
    return null;
  }

  const planRevision = appliedEvent.referenceId;
  const identity = snapshot.trace.context.identity;
  return db.transaction(async (tx) => {
    const [mission] = await tx.select({
      id: aiMissionsTable.id,
      projectId: aiMissionsTable.projectId,
      userId: aiMissionsTable.userId,
      status: aiMissionsTable.status,
      autonomyPolicy: aiMissionsTable.autonomyPolicy,
    }).from(aiMissionsTable)
      .where(and(
        eq(aiMissionsTable.id, identity.missionId),
        eq(aiMissionsTable.projectId, identity.projectId),
      ))
      .for("update");
    if (
      !mission
      || mission.status !== "active"
      || record(mission.autonomyPolicy).activePlanRevision !== planRevision
    ) {
      return null;
    }

    const events = await tx.select({
      stage: aiMissionDecisionEventsTable.stage,
      referenceId: aiMissionDecisionEventsTable.referenceId,
    }).from(aiMissionDecisionEventsTable)
      .where(eq(aiMissionDecisionEventsTable.decisionId, decisionId))
      .orderBy(asc(aiMissionDecisionEventsTable.sequence));
    if (
      events.some(({ stage }) => stage === "DISPATCHED")
      || events.find(({ stage }) => stage === "APPROVED")?.referenceId
        !== snapshot.events[approvedIndex]?.referenceId
      || events.find(({ stage }) => stage === "PLAN_APPLIED")?.referenceId !== planRevision
    ) {
      return null;
    }

    const rootGoalIds = await planRootGoalIds(tx, {
      missionId: identity.missionId,
      projectId: identity.projectId,
      planRevision,
    });
    if (rootGoalIds.length === 0) return null;

    return {
      decisionId,
      projectId: mission.projectId,
      missionId: mission.id,
      userId: mission.userId,
      planRevision,
      rootGoalIds,
    };
  });
}
