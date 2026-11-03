import { createHash } from "node:crypto";
import { and, asc, eq, sql } from "drizzle-orm";
import {
  aiAgentEffectsTable,
  aiAgentEpisodesTable,
  aiAgentObservationsTable,
  aiExecutionAcceptancesTable,
  aiExecutionsTable,
  aiGoalsTable,
  aiMissionDecisionEventsTable,
  aiMissionDecisionTracesTable,
  aiMissionsTable,
  aiWorldFactsTable,
  aiWorldTransitionsTable,
  db,
  projectsTable,
} from "@workspace/db";
import {
  hashMissionDecisionTrace,
  hashMissionStrategyAlternative,
  MissionDecisionTraceSchema,
} from "@workspace/ai-orchestrator";
import type { MissionDecisionTrace } from "@workspace/ai-orchestrator";
import { getProjectWorldState } from "./agent-state/world-state.js";

type MissionDecisionTransaction = Parameters<Parameters<typeof db.transaction>[0]>[0];
type DecisionEventStage = MissionDecisionTrace["lifecycle"][number]["stage"];

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
      | "decision_approval_binding_invalid",
  ) {
    super(code);
    this.name = "MissionDecisionTraceStoreError";
  }
}

function deterministicHash(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function eventIdentity(decisionId: string, stage: DecisionEventStage): string {
  return `mission-decision-event:${deterministicHash(`${decisionId}:${stage}`)}`;
}

function eventHash(input: {
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

function record(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function planRevisionHash(value: unknown): string | null {
  const hash = record(record(value).planRevision).hash;
  return typeof hash === "string" ? hash : null;
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
    || trace.newPlanRevision !== null
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
      const approval = trace.context.approval;
      const approvalMatches =
        selectedStrategy?.approvalRequirement === "required"
        && approval.status === "granted"
        && approval.approvalRef === input.referenceId
        && approval.approvedStrategyId === selectedStrategy.strategyId
        && approval.approvedStrategyHash === hashMissionStrategyAlternative(selectedStrategy)
        && approval.approvedPlanRevision === trace.context.identity.priorPlanRevision;
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
        || !appliedPlanExists
        || (typeof activePlan === "string" && activePlan !== input.referenceId)
      ) {
        throw new MissionDecisionTraceStoreError("decision_event_reference_invalid");
      }
    }
    if (input.stage === "DISPATCHED") {
      const identity = trace.context.identity;
      const appliedPlanRevision = events.find(({ stage }) => stage === "PLAN_APPLIED")?.referenceId;
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
    if (input.stage === "EXECUTED" && input.referenceId !== last.referenceId) {
      throw new MissionDecisionTraceStoreError("decision_event_reference_invalid");
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

export async function appendMissionDecisionLifecycleEvent(input: AppendMissionDecisionLifecycleEventInput): Promise<{
  kind: "appended" | "already_recorded";
  sequence: number;
}> {
  return db.transaction((tx) => appendMissionDecisionLifecycleEventInTransaction(tx, input));
}

export async function getMissionDecisionTrace(
  decisionId: string,
): Promise<{ trace: MissionDecisionTrace; events: Array<{
  id: string;
  sequence: number;
  stage: string;
  referenceId: string | null;
  eventHash: string;
  occurredAt: Date;
}> } | null> {
  const [stored] = await db.select().from(aiMissionDecisionTracesTable)
    .where(eq(aiMissionDecisionTracesTable.decisionId, decisionId));
  if (!stored) return null;
  const trace = MissionDecisionTraceSchema.parse(stored.trace);
  const events = await db.select({
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
      const approval = trace.context.approval;
      if (
        selectedStrategy?.approvalRequirement !== "required"
        || approval.status !== "granted"
        || approval.approvalRef !== current.referenceId
        || approval.approvedStrategyId !== selectedStrategy.strategyId
        || approval.approvedStrategyHash !== hashMissionStrategyAlternative(selectedStrategy)
        || approval.approvedPlanRevision !== trace.context.identity.priorPlanRevision
      ) {
        throw new MissionDecisionTraceStoreError("decision_approval_binding_invalid");
      }
    }
    if (
      current.stage === "EXECUTED"
      && current.referenceId !== previous.referenceId
    ) {
      throw new MissionDecisionTraceStoreError("decision_event_reference_invalid");
    }
  }
  return { trace, events };
}
