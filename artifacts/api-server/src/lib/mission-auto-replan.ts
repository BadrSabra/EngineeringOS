import { and, asc, eq } from "drizzle-orm";
import { createHash, randomUUID } from "node:crypto";
import {
  aiAgentEpisodesTable,
  aiAgentObservationsTable,
  aiExecutionAcceptancesTable,
  aiExecutionsTable,
  aiGoalsTable,
  aiMissionsTable,
  aiWorldTransitionsTable,
  db,
  eventsTable,
} from "@workspace/db";
import { inArray } from "drizzle-orm";
import {
  normalizeMissionAutonomyPolicy,
  writeCanonicalMissionAutonomyPolicy,
} from "./mission-autonomy-policy.js";
import {
  buildMissionPlanPreview,
  type MissionPlanPreview,
  type MissionWorldStatePlanningRead,
} from "@workspace/ai-orchestrator";
import {
  FailureDiagnosisSummarySchema,
  toFailureDiagnosisSummary,
  type FailureDiagnosisSummary,
} from "@workspace/ai-orchestrator";
import {
  createMissionPlanGoal,
  type MissionPlanMaterialization,
} from "../routes/ai/missions.js";
import {
  WorldStateFailureDiagnosisSchema,
  type WorldStateFailureDiagnosis,
} from "./world-state-failure-diagnosis.js";
import {
  loadRuntimeStartHypothesisReplanEvidence,
  type RuntimeStartHypothesisReplanEvidence,
} from "./agent-state/runtime-start-hypothesis-replan-context.js";
import {
  containsCandidateMarker,
  loadMissionWorldStatePlanningRead,
} from "./mission-world-state-planning-read.js";
import { taskScopeIdentity } from "./agent-state/observation-materializer.js";
import {
  selectAndApplyMissionStrategy,
  type MissionStrategyDecision,
  type MissionFailureSourceBinding,
} from "./mission-strategy-engine.js";
import { runMissionGoal, type MissionGoalRunResult } from "./mission-runtime.js";
import { buildMissionStrategyDecisionTraceInTransaction } from "./mission-strategy-decision-trace.js";
import {
  appendMissionDecisionLifecycleEventInTransaction,
  recordMissionDecisionDispatchBatchInTransaction,
  persistMissionDecisionTraceInTransaction,
} from "./mission-decision-trace-store.js";

type AutoReplanResult =
  | {
      status: "replanned";
      missionId: string;
      revision: string;
      plan: MissionPlanMaterialization;
      runs: Awaited<ReturnType<typeof runMissionGoal>>[];
    }
  | {
      status: "skipped";
      missionId: string;
      reason: string;
    };

const TERMINAL_REPLAN_FAILURES = new Set([
  "objective_no_longer_mission_eligible",
  "automatic_replan_budget_exhausted",
  "automatic_replan_already_attempted",
  "failure_diagnosis_invalid",
  "failure_requires_owner_approval",
  "failure_not_automatically_retryable",
  "empty_plan",
  "no_eligible_replan_root",
  "runtime_transition_target_unbound",
  "runtime_failure_evidence_unbound",
  "failure_source_evidence_unbound",
]);

function jsonRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function stringList(value: unknown, max: number, itemMax: number): string[] {
  return Array.isArray(value)
    ? value
      .filter((item): item is string => typeof item === "string" && item.trim().length > 0)
      .slice(0, max)
      .map((item) => item.replace(/[\u0000-\u001f\u007f]/g, "").trim().slice(0, itemMax))
      .filter(Boolean)
    : [];
}

function failureDiagnosisFromOutcome(outcome: unknown): FailureDiagnosisSummary | undefined {
  const outcomeRecord = jsonRecord(outcome);
  const acceptance = jsonRecord(outcomeRecord.acceptance);
  if (Object.prototype.hasOwnProperty.call(acceptance, "failureDiagnosis")) {
    const parsed = FailureDiagnosisSummarySchema.safeParse(acceptance.failureDiagnosis);
    return parsed.success ? parsed.data : undefined;
  }
  const worldStateDiagnosis = WorldStateFailureDiagnosisSchema.safeParse(
    outcomeRecord.worldStateFailureDiagnosis,
  );
  return worldStateDiagnosis.success
    ? toFailureDiagnosisSummary(worldStateDiagnosis.data.failureDiagnosis)
    : undefined;
}

function worldStateFailureDiagnosisFromOutcome(outcome: unknown): WorldStateFailureDiagnosis | undefined {
  const parsed = WorldStateFailureDiagnosisSchema.safeParse(
    jsonRecord(outcome).worldStateFailureDiagnosis,
  );
  return parsed.success ? parsed.data : undefined;
}

function runtimeStartTargetStepIdFromGoal(
  goal: { outcomeContract: unknown; successCriteria: unknown },
  expectedPlanRevision: string,
): string | undefined {
  const snapshots = [
    jsonRecord(jsonRecord(goal.outcomeContract).planRevision),
    jsonRecord(jsonRecord(goal.successCriteria).planRevision),
  ];
  for (const snapshot of snapshots) {
    if (
      snapshot.hash !== expectedPlanRevision
      || !Array.isArray(snapshot.steps)
      || !Array.isArray(snapshot.transitionRequirements)
    ) {
      continue;
    }
    const steps = snapshot.steps.filter((step): step is Record<string, unknown> =>
      typeof step === "object" && step !== null && !Array.isArray(step),
    );
    const targetExists = (targetStepId: string) => steps.some((step) =>
      jsonRecord(step).id === targetStepId,
    );
    const requirements = snapshot.transitionRequirements.filter((requirement):
      requirement is Record<string, unknown> =>
        typeof requirement === "object"
        && requirement !== null
        && !Array.isArray(requirement),
    );
    const requirement = requirements
      .map(jsonRecord)
      .find((candidate) =>
        candidate.kind === "runtime.start"
        && candidate.version === 1
        && candidate.sourceStepId === "runtime-start"
        && typeof candidate.targetStepId === "string"
        && /^[a-z0-9][a-z0-9-]{0,79}$/.test(candidate.targetStepId)
        && targetExists(candidate.targetStepId),
      );
    if (requirement && typeof requirement.targetStepId === "string") {
      return requirement.targetStepId;
    }
  }
  return undefined;
}

async function hasBoundValidatorFailureSourceEvidence(
  tx: Parameters<Parameters<typeof db.transaction>[0]>[0],
  input: {
    missionId: string;
    projectId: string;
    goalId: string;
    priorPlanRevision: string;
    outcomeContract: unknown;
    failureDiagnosis: FailureDiagnosisSummary;
  },
): Promise<MissionFailureSourceBinding | undefined> {
  const acceptanceProjection = jsonRecord(jsonRecord(input.outcomeContract).acceptance);
  const executionId = typeof acceptanceProjection.executionId === "string"
    ? acceptanceProjection.executionId
    : undefined;
  const acceptanceId = typeof acceptanceProjection.acceptanceId === "string"
    ? acceptanceProjection.acceptanceId
    : jsonRecord(acceptanceProjection.receipt).kind === "execution_acceptance"
      && typeof jsonRecord(acceptanceProjection.receipt).id === "string"
      ? jsonRecord(acceptanceProjection.receipt).id as string
      : undefined;
  const projectedOutcome = acceptanceProjection.outcome;
  if (
    !executionId
    || !acceptanceId
    || (projectedOutcome !== "FAILED" && projectedOutcome !== "INTERRUPTED")
  ) {
    return undefined;
  }

  const [acceptance] = await tx.select().from(aiExecutionAcceptancesTable)
    .where(and(
      eq(aiExecutionAcceptancesTable.id, acceptanceId),
      eq(aiExecutionAcceptancesTable.executionId, executionId),
      eq(aiExecutionAcceptancesTable.projectId, input.projectId),
    ));
  const [execution] = await tx.select().from(aiExecutionsTable)
    .where(and(
      eq(aiExecutionsTable.id, executionId),
      eq(aiExecutionsTable.projectId, input.projectId),
      eq(aiExecutionsTable.goalId, input.goalId),
    ));
  if (
    !acceptance
    || !execution
    || acceptance.outcome !== projectedOutcome
    || acceptance.candidateIdentity != null
    || !["failed", "interrupted"].includes(acceptance.terminalStatus)
    || acceptance.reasonCode !== input.failureDiagnosis.reasonCode
    || acceptance.nextActionCode !== input.failureDiagnosis.nextActionCode
    || (typeof acceptanceProjection.attempt === "number"
      && acceptanceProjection.attempt !== acceptance.attempt)
    || execution.attempt !== acceptance.attempt
    || !["failed", "interrupted"].includes(execution.status)
    || (acceptance.operationId && acceptance.operationId !== execution.operationId)
    || (typeof acceptanceProjection.sourceRevision === "string"
      && acceptance.sourceRevision !== acceptanceProjection.sourceRevision)
    || (execution.baseRevision
      && acceptance.sourceRevision
      && execution.baseRevision !== acceptance.sourceRevision)
  ) {
    return undefined;
  }

  const episodes = await tx.select().from(aiAgentEpisodesTable)
    .where(and(
      eq(aiAgentEpisodesTable.projectId, input.projectId),
      eq(aiAgentEpisodesTable.executionId, executionId),
      eq(aiAgentEpisodesTable.attempt, acceptance.attempt),
      eq(aiAgentEpisodesTable.missionId, input.missionId),
      eq(aiAgentEpisodesTable.goalId, input.goalId),
      eq(aiAgentEpisodesTable.planRevision, input.priorPlanRevision),
    ));
  if (episodes.length !== 1) return undefined;
  const [episode] = episodes;
  if (
    !episode
    || episode.state !== "failed"
    || episode.verdict !== "failed"
    || !episode.closedAt
    || !episode.projectRevision
    || !episode.environmentRevision
    || episode.projectRevision !== acceptance.sourceRevision
    || episode.reasonCode !== acceptance.reasonCode
    || episode.nextActionCode !== acceptance.nextActionCode
    || containsCandidateMarker(episode.projectRevision)
    || containsCandidateMarker(episode.environmentRevision)
  ) {
    return undefined;
  }
  return {
    acceptanceId,
    executionId,
    episodeId: episode.id,
    attempt: acceptance.attempt,
  };
}

async function hasBoundRuntimeFailureEvidence(
  tx: Parameters<Parameters<typeof db.transaction>[0]>[0],
  input: {
    missionId: string;
    projectId: string;
    goalId: string;
    priorPlanRevision: string;
    outcomeContract: unknown;
    diagnosis: WorldStateFailureDiagnosis;
  },
): Promise<MissionFailureSourceBinding | undefined> {
  const transition = input.diagnosis.transition;
  const acceptanceProjection = jsonRecord(jsonRecord(input.outcomeContract).acceptance);
  const executionId = typeof acceptanceProjection.executionId === "string"
    ? acceptanceProjection.executionId
    : undefined;
  if (
    !executionId
    || (transition && acceptanceProjection.executionId !== transition.executionId)
    || (
      acceptanceProjection.attempt != null
      && transition
      && acceptanceProjection.attempt !== transition.attempt
    )
    || (acceptanceProjection.outcome !== "FAILED"
      && acceptanceProjection.outcome !== "INTERRUPTED")
  ) {
    return undefined;
  }
  const acceptanceId = typeof acceptanceProjection.acceptanceId === "string"
    ? acceptanceProjection.acceptanceId
    : jsonRecord(acceptanceProjection.receipt).kind === "execution_acceptance"
      && typeof jsonRecord(acceptanceProjection.receipt).id === "string"
      ? jsonRecord(acceptanceProjection.receipt).id as string
      : undefined;
  if (!acceptanceId) return undefined;
  const [acceptance] = await tx.select().from(aiExecutionAcceptancesTable).where(and(
    eq(aiExecutionAcceptancesTable.id, acceptanceId),
    eq(aiExecutionAcceptancesTable.projectId, input.projectId),
    eq(aiExecutionAcceptancesTable.executionId, executionId),
  ));
  if (
    !acceptance
    || acceptance.candidateIdentity != null
    || acceptance.outcome !== acceptanceProjection.outcome
    || (acceptance.terminalStatus !== "failed" && acceptance.terminalStatus !== "interrupted")
    || (
      acceptanceProjection.attempt != null
      && acceptance.attempt !== acceptanceProjection.attempt
    )
    || (transition && acceptance.attempt !== transition.attempt)
  ) {
    return undefined;
  }
  const [execution] = await tx.select().from(aiExecutionsTable).where(and(
    eq(aiExecutionsTable.id, executionId),
    eq(aiExecutionsTable.projectId, input.projectId),
    eq(aiExecutionsTable.goalId, input.goalId),
  ));
  if (
    !execution
    || execution.attempt !== acceptance.attempt
    || (execution.status !== "failed" && execution.status !== "completed")
  ) {
    return undefined;
  }
  const episodeRows = await tx.select().from(aiAgentEpisodesTable).where(and(
    ...(transition ? [eq(aiAgentEpisodesTable.id, transition.episodeId)] : []),
    eq(aiAgentEpisodesTable.projectId, input.projectId),
    eq(aiAgentEpisodesTable.executionId, executionId),
    eq(aiAgentEpisodesTable.attempt, acceptance.attempt),
    eq(aiAgentEpisodesTable.missionId, input.missionId),
    eq(aiAgentEpisodesTable.goalId, input.goalId),
    eq(aiAgentEpisodesTable.planRevision, input.priorPlanRevision),
  )).limit(2);
  if (episodeRows.length !== 1) return undefined;
  const episode = episodeRows[0];
  if (
    !episode
    || (transition && (
      episode.id !== transition.episodeId
      || episode.executionId !== transition.executionId
      || episode.attempt !== transition.attempt
    ))
    || !episode.closedAt
    || episode.verdict !== "failed"
    || !episode.environmentRevision
    || !episode.projectRevision
    || containsCandidateMarker(episode.scope)
  ) {
    return undefined;
  }
  const diagnosisObservationIds = [
    ...input.diagnosis.supportingObservationIds,
    ...input.diagnosis.contradictingObservationIds,
  ];
  if (transition) {
    const [persistedTransition] = await tx.select().from(aiWorldTransitionsTable).where(and(
      eq(aiWorldTransitionsTable.id, transition.id),
      eq(aiWorldTransitionsTable.projectId, input.projectId),
      eq(aiWorldTransitionsTable.executionId, executionId),
      eq(aiWorldTransitionsTable.attempt, acceptance.attempt),
      eq(aiWorldTransitionsTable.episodeId, episode.id),
      eq(aiWorldTransitionsTable.actionId, transition.actionId),
    ));
    if (
      !persistedTransition
      || persistedTransition.status !== transition.status
      || persistedTransition.parentWorldRevision !== transition.parentWorldRevision
      || persistedTransition.resultingWorldRevision !== transition.resultingWorldRevision
      || persistedTransition.environmentRevision !== transition.environmentRevision
    ) {
      return undefined;
    }
    const persistedObservationIds = new Set([
      ...stringList(persistedTransition.beforeObservationIds, 512, 200),
      ...stringList(persistedTransition.afterObservationIds, 512, 200),
      ...stringList(persistedTransition.materializedObservationIds, 512, 200),
    ]);
    if (diagnosisObservationIds.some((id) => !persistedObservationIds.has(id))) {
      return undefined;
    }
  } else {
    if (input.diagnosis.reasonCode !== "accepted_transition_missing") return undefined;
    const existingTransitions = await tx.select({ id: aiWorldTransitionsTable.id })
      .from(aiWorldTransitionsTable)
      .where(and(
        eq(aiWorldTransitionsTable.projectId, input.projectId),
        eq(aiWorldTransitionsTable.executionId, executionId),
        eq(aiWorldTransitionsTable.attempt, acceptance.attempt),
        eq(aiWorldTransitionsTable.episodeId, episode.id),
      ))
      .limit(1);
    if (existingTransitions.length > 0) return undefined;
  }
  const taskScope = taskScopeIdentity(episode);
  const observationIds = [...new Set([
    ...input.diagnosis.supportingObservationIds,
    ...input.diagnosis.contradictingObservationIds,
  ])];
  if (!taskScope || taskScope.startsWith("unscoped:")) {
    return undefined;
  }
  const missingTransitionCases = new Set([
    "accepted_transition_missing",
    "transition_observation_set_missing",
  ]);
  if (
    observationIds.length === 0
    && !missingTransitionCases.has(input.diagnosis.reasonCode)
  ) {
    return undefined;
  }
  if (observationIds.length > 0) {
    const observations = await tx.select().from(aiAgentObservationsTable).where(and(
      eq(aiAgentObservationsTable.projectId, input.projectId),
      inArray(aiAgentObservationsTable.id, observationIds),
    ));
    if (observations.length !== observationIds.length) return undefined;
    const allowedPredicates = new Set(
      input.diagnosis.distinguishingObservationCodes.flatMap((code) => {
        switch (code) {
          case "runtime:direct_status":
          case "runtime:status":
            return ["runtime.status"];
          case "runtime:before_state":
          case "world_transition:before_observations":
            return ["runtime.before_state"];
          case "runtime:after_state":
          case "world_transition:after_observations":
            return ["runtime.after_state"];
          case "runtime:session_evidence":
            return ["runtime.session_evidence", "runtime.child_process_environment"];
          case "project:current_revision":
            return ["project.revision", "repository.revision"];
          case "runtime:environment_revision":
            return ["runtime.environment_revision"];
          default:
            return [];
        }
      }),
    );
    if (
      allowedPredicates.size === 0
      || observations.some((observation) =>
        observation.executionId !== executionId
        || observation.episodeId !== episode.id
        || observation.taskScope !== taskScope
        || observation.projectRevision !== episode.projectRevision
        || observation.environmentRevision !== episode.environmentRevision
        || observation.kind !== "direct_observation"
        || observation.provenance !== "DIRECT_OBSERVATION"
        || observation.completeness !== "complete"
        || observation.freshness !== "fresh"
        || observation.environmentFreshness !== "fresh"
        || (allowedPredicates.size > 0 && !allowedPredicates.has(observation.predicate))
      )
    ) {
      return undefined;
    }
  }
  return {
    acceptanceId,
    executionId,
    episodeId: episode.id,
    attempt: acceptance.attempt,
    ...(transition ? { transitionId: transition.id } : {}),
  };
}

export function buildReplanContext(goal: {
  id: string;
  blockedReason: string | null;
  nextAction: unknown;
  outcomeContract: unknown;
  successCriteria: unknown;
}, runtimeStartHypothesisEvidence?: RuntimeStartHypothesisReplanEvidence,
worldStatePlanningRead?: MissionWorldStatePlanningRead) {
  const outcome = jsonRecord(goal.outcomeContract);
  const acceptance = jsonRecord(outcome.acceptance);
  const receipt = jsonRecord(acceptance.receipt);
  const stateProjection = jsonRecord(acceptance.stateProjection);
  const failureDiagnosis = failureDiagnosisFromOutcome(goal.outcomeContract);
  const worldStateDiagnosis = worldStateFailureDiagnosisFromOutcome(goal.outcomeContract);
  const success = jsonRecord(goal.successCriteria);
  const planRevision = jsonRecord(outcome.planRevision).hash ?? jsonRecord(success.planRevision).hash;
  const nextActionReason = jsonRecord(goal.nextAction).reason;
  return {
    failedGoalId: goal.id,
    ...(failureDiagnosis
      ? { failureDiagnosis, failureClass: failureDiagnosis.kind }
      : typeof receipt.failureClass === "string"
        ? { failureClass: receipt.failureClass }
        : {}),
    ...(failureDiagnosis
      ? { failureCode: failureDiagnosis.reasonCode }
      : typeof acceptance.reasonCode === "string"
        ? { failureCode: acceptance.reasonCode }
        : {}),
    affectedPaths: stringList(
      acceptance.affectedPaths ?? receipt.affectedPaths ?? outcome.affectedPaths,
      24,
      500,
    ),
    ...(worldStateDiagnosis
      ? { affectedFacts: stringList(worldStateDiagnosis.affectedFactRefs, 24, 240) }
      : {}),
    affectedClaims: stringList(
      acceptance.affectedClaims ?? stateProjection.proofObligations ?? stateProjection.contradictions,
      24,
      240,
    ),
    evidenceRefs: stringList([
      ...(Array.isArray(acceptance.acceptedRefs) ? acceptance.acceptedRefs : []),
      ...(Array.isArray(receipt.evidenceRefs) ? receipt.evidenceRefs : []),
      ...(Array.isArray(outcome.evidenceRefs) ? outcome.evidenceRefs : []),
      ...(worldStateDiagnosis?.transition?.id
        ? [`world-transition:${worldStateDiagnosis.transition.id}`]
        : []),
      ...(worldStateDiagnosis?.supportingObservationIds.map((id) => `observation:${id}`) ?? []),
      ...(worldStateDiagnosis?.contradictingObservationIds.map((id) => `observation:${id}`) ?? []),
    ],
      16,
      500,
    ),
    ...(worldStateDiagnosis
      ? {
          hypothesisImpact: [
            `assumption=${worldStateDiagnosis.failedAssumptionCode}`,
            `expectedEffect=${worldStateDiagnosis.expectedEffectCode}`,
            `disposition=${worldStateDiagnosis.recommendedDisposition}`,
            `remaining=${worldStateDiagnosis.remainingHypotheses.join(",")}`,
          ].join(";").slice(0, 500),
        }
      : typeof outcome.hypothesisImpact === "string"
      ? { hypothesisImpact: outcome.hypothesisImpact.slice(0, 500) }
      : {}),
    ...(runtimeStartHypothesisEvidence
      ? { runtimeStartHypothesisEvidence }
      : {}),
    ...(worldStatePlanningRead ? { worldStatePlanningRead } : {}),
    nextActions: [
      ...(failureDiagnosis ? [failureDiagnosis.nextActionCode] : []),
      ...(worldStateDiagnosis
        ? [
            `world-state:${worldStateDiagnosis.reasonCode}`,
            `world-state-assumption:${worldStateDiagnosis.failedAssumptionCode}`,
            `world-state-expected-effect:${worldStateDiagnosis.expectedEffectCode}`,
            `world-state-disposition:${worldStateDiagnosis.recommendedDisposition}`,
            ...worldStateDiagnosis.distinguishingObservationCodes,
          ]
        : []),
      ...(goal.blockedReason ? [goal.blockedReason] : []),
      ...(typeof nextActionReason === "string" ? [nextActionReason.slice(0, 240)] : []),
      ...stringList(outcome.nextActions, 4, 240),
    ].slice(0, 8),
    ...(typeof planRevision === "string" ? { priorPlanRevision: planRevision.slice(0, 200) } : {}),
  };
}

/**
 * A replan request is durable work, not a retry loop. If the coordinator
 * cannot produce or dispatch a new bounded plan, leave the Mission in an
 * operator-visible terminal state instead of polling needs_replan forever.
 */
async function terminalizeAutomaticReplanFailure(
  missionId: string,
  reason: string,
): Promise<boolean> {
  if (!TERMINAL_REPLAN_FAILURES.has(reason) && !reason.startsWith("strategy_")) return false;

  return db.transaction(async (tx) => {
    const [mission] = await tx
      .select()
      .from(aiMissionsTable)
      .where(eq(aiMissionsTable.id, missionId))
      .for("update");
    if (!mission || mission.status !== "needs_replan") return false;

    const now = new Date();
    await tx
      .update(aiMissionsTable)
      .set({
        status: "blocked",
        completedAt: null,
        updatedAt: now,
      })
      .where(and(
        eq(aiMissionsTable.id, missionId),
        eq(aiMissionsTable.status, "needs_replan"),
      ));
    await tx.insert(eventsTable).values({
      id: randomUUID(),
      type: "AiMissionReplanBlocked",
      projectId: mission.projectId,
      severity: "warning",
      message: "AI Mission could not produce or dispatch a bounded automatic replan",
      correlationId: missionId,
      payload: {
        missionId,
        reason,
        previousStatus: "needs_replan",
        nextStatus: "blocked",
      },
    });
    return true;
  });
}

/**
 * Converts a durable needs_replan Mission into one fresh server-owned plan.
 *
 * The acceptance transaction only records the authoritative failure. This
 * coordinator runs after that commit, under the Mission row lock, so planning
 * and materialization cannot make terminal acceptance less reliable.
 */
export async function autoReplanMission(
  missionId: string,
  runGoal: typeof runMissionGoal = runMissionGoal,
): Promise<AutoReplanResult> {
  const prepared = await db.transaction(async (tx) => {
    const [mission] = await tx
      .select()
      .from(aiMissionsTable)
      .where(eq(aiMissionsTable.id, missionId))
      .for("update");
    if (!mission || mission.status !== "needs_replan") {
      return {
        status: "skipped" as const,
        missionId,
        reason: mission ? "mission_not_ready" : "mission_not_found",
      };
    }
    const autonomy = normalizeMissionAutonomyPolicy(mission.autonomyPolicy);
    if (autonomy.mode !== "autonomous") {
      return {
        status: "skipped" as const,
        missionId,
        reason: "automatic_replan_not_enabled",
      };
    }
    const [failedGoal] = await tx
      .select({
        id: aiGoalsTable.id,
        blockedReason: aiGoalsTable.blockedReason,
        nextAction: aiGoalsTable.nextAction,
        outcomeContract: aiGoalsTable.outcomeContract,
        successCriteria: aiGoalsTable.successCriteria,
      })
      .from(aiGoalsTable)
      .where(and(
        eq(aiGoalsTable.missionId, mission.id),
        eq(aiGoalsTable.projectId, mission.projectId),
        eq(aiGoalsTable.status, "needs_replan"),
      ))
      .orderBy(asc(aiGoalsTable.updatedAt), asc(aiGoalsTable.id))
      .limit(1);
    const failedOutcome = jsonRecord(failedGoal?.outcomeContract);
    const acceptance = jsonRecord(failedOutcome.acceptance);
    const hasAcceptanceFailureDiagnosis = Object.prototype.hasOwnProperty.call(
      acceptance,
      "failureDiagnosis",
    );
    const hasWorldStateFailureDiagnosis = Object.prototype.hasOwnProperty.call(
      failedOutcome,
      "worldStateFailureDiagnosis",
    );
    const parsedAcceptanceDiagnosis = hasAcceptanceFailureDiagnosis
      ? FailureDiagnosisSummarySchema.safeParse(acceptance.failureDiagnosis)
      : undefined;
    const worldStateDiagnosis = failedGoal
      ? worldStateFailureDiagnosisFromOutcome(failedGoal.outcomeContract)
      : undefined;
    const failureDiagnosis = failedGoal
      ? failureDiagnosisFromOutcome(failedGoal.outcomeContract)
      : undefined;
    if (
      (hasAcceptanceFailureDiagnosis && !parsedAcceptanceDiagnosis?.success)
      || (hasWorldStateFailureDiagnosis && !worldStateDiagnosis)
    ) {
      return {
        status: "skipped" as const,
        missionId,
        reason: "failure_diagnosis_invalid",
      };
    }
    if (failureDiagnosis?.requiresApproval) {
      return {
        status: "skipped" as const,
        missionId,
        reason: "failure_requires_owner_approval",
      };
    }
    if (failureDiagnosis && !failureDiagnosis.retryable) {
      return {
        status: "skipped" as const,
        missionId,
        reason: "failure_not_automatically_retryable",
      };
    }
    const priorPlanRevision = failedGoal
      ? jsonRecord(jsonRecord(failedGoal.outcomeContract).planRevision).hash
        ?? jsonRecord(jsonRecord(failedGoal.successCriteria).planRevision).hash
      : undefined;
    const runtimeStartTargetStepId = failedGoal
      && worldStateDiagnosis
      && typeof priorPlanRevision === "string"
      ? runtimeStartTargetStepIdFromGoal(failedGoal, priorPlanRevision)
      : undefined;
    if (worldStateDiagnosis && !runtimeStartTargetStepId) {
      return {
        status: "skipped" as const,
        missionId,
        reason: "runtime_transition_target_unbound",
      };
    }
    let runtimeSourceBinding: MissionFailureSourceBinding | undefined;
    let validatorSourceBinding: MissionFailureSourceBinding | undefined;
    if (failureDiagnosis?.kind === "VALIDATOR_FAILED") {
      validatorSourceBinding = failedGoal && typeof priorPlanRevision === "string"
        ? await hasBoundValidatorFailureSourceEvidence(tx, {
            missionId: mission.id,
            projectId: mission.projectId,
            goalId: failedGoal.id,
            priorPlanRevision,
            outcomeContract: failedGoal.outcomeContract,
            failureDiagnosis,
          })
        : undefined;
      if (!validatorSourceBinding) {
        return {
          status: "skipped" as const,
          missionId,
          reason: "failure_source_evidence_unbound",
        };
      }
    }
    if (
      failedGoal
      && worldStateDiagnosis
      && typeof priorPlanRevision === "string"
    ) {
      runtimeSourceBinding = await hasBoundRuntimeFailureEvidence(tx, {
        missionId: mission.id,
        projectId: mission.projectId,
        goalId: failedGoal.id,
        priorPlanRevision,
        outcomeContract: failedGoal.outcomeContract,
        diagnosis: worldStateDiagnosis,
      });
      if (!runtimeSourceBinding) {
        return {
          status: "skipped" as const,
          missionId,
          reason: "runtime_failure_evidence_unbound",
        };
      }
    }
    const runtimeStartHypothesisEvidence = failedGoal && typeof priorPlanRevision === "string"
      ? await loadRuntimeStartHypothesisReplanEvidence(tx, {
          projectId: mission.projectId,
          missionId: mission.id,
          goalId: failedGoal.id,
          planRevision: priorPlanRevision,
        })
      : undefined;
    const worldStatePlanningRead = failedGoal
      ? await loadMissionWorldStatePlanningRead(tx, {
          missionId: mission.id,
          projectId: mission.projectId,
          goalId: failedGoal.id,
          outcomeContract: failedGoal.outcomeContract,
          nextAction: failedGoal.nextAction,
          successCriteria: failedGoal.successCriteria,
        })
      : undefined;
    const replanContext = failedGoal
      ? buildReplanContext(
          failedGoal,
          runtimeStartHypothesisEvidence,
          worldStatePlanningRead,
        )
      : undefined;
    let preview: MissionPlanPreview & { strategyDecision?: MissionStrategyDecision } =
      buildMissionPlanPreview({
      message: mission.intent,
      objective: mission.intent,
      ...(runtimeStartTargetStepId ? { runtimeStartTargetStepId } : {}),
      ...(replanContext ? { replanContext } : {}),
    });
    if (preview.admission !== "mission") {
      return { status: "skipped" as const, missionId, reason: "objective_no_longer_mission_eligible" };
    }
    if (
      failedGoal
      && (worldStateDiagnosis || failureDiagnosis?.kind === "VALIDATOR_FAILED")
    ) {
      const selection = selectAndApplyMissionStrategy({
        preview,
        missionId: mission.id,
        failedGoalId: failedGoal.id,
        priorPlanRevision: typeof priorPlanRevision === "string" ? priorPlanRevision : "",
        failureDiagnosis,
        worldStateFailureDiagnosis: worldStateDiagnosis,
        runtimeStartTargetStepId,
        failureSourceBinding: runtimeSourceBinding ?? validatorSourceBinding,
        worldStatePlanningRead: preview.replanContext?.worldStatePlanningRead,
        evidenceRefs: replanContext?.evidenceRefs ?? [],
        affectedPaths: replanContext?.affectedPaths ?? [],
        affectedClaims: replanContext?.affectedClaims ?? [],
      });
      if (selection.status !== "selected") {
        return {
          status: "skipped" as const,
          missionId,
          reason: `strategy_${selection.reason}`,
        };
      }
      preview = selection.preview;
    }

    const persistedWorldStatePlanningRead = preview.replanContext?.worldStatePlanningRead;
    const revisionInput = {
      sourcePlanHash: preview.plan.planHash,
      ...(runtimeStartHypothesisEvidence
        ? { runtimeStartHypothesisEvidence }
        : {}),
      ...(persistedWorldStatePlanningRead
        ? { worldStatePlanningReadRevision: persistedWorldStatePlanningRead.planningReadRevision }
        : {}),
      ...(preview.strategyDecision
        ? { strategyDecisionId: preview.strategyDecision.decisionId }
        : {}),
    };
    const planHash = persistedWorldStatePlanningRead
      || runtimeStartHypothesisEvidence
      || preview.strategyDecision
      ? createHash("sha256").update(JSON.stringify(revisionInput)).digest("hex")
      : preview.plan.planHash;
    const revision = `auto:${failedGoal?.id ?? mission.id}:${planHash}`;
    const alreadyReserved = autonomy.automaticReplanCount > 0
      && jsonRecord(mission.autonomyPolicy).lastAutomaticReplanRevision === revision;
    if (!alreadyReserved && autonomy.automaticReplanCount >= autonomy.maxAutoReplans) {
      return { status: "skipped" as const, missionId, reason: "automatic_replan_budget_exhausted" };
    }
    const decisionTrace = preview.strategyDecision
      ? await buildMissionStrategyDecisionTraceInTransaction(tx, {
        decision: preview.strategyDecision,
        projectId: mission.projectId,
        proposedPlanRevision: revision,
        decidedAt: new Date(),
      })
      : null;
    if (decisionTrace) {
      await persistMissionDecisionTraceInTransaction(tx, decisionTrace);
    }
    const plan = await createMissionPlanGoal(
      tx,
      mission,
      new Date(),
      preview,
      "execution",
      revision,
      decisionTrace?.decisionId,
    );
    if (!plan) {
      return { status: "skipped" as const, missionId, reason: "empty_plan" };
    }
    const nextReplanCount = autonomy.automaticReplanCount + (alreadyReserved ? 0 : 1);
    const [updatedMission] = await tx.update(aiMissionsTable)
      .set({
        autonomyPolicy: {
          ...writeCanonicalMissionAutonomyPolicy(
            mission.autonomyPolicy,
            nextReplanCount,
          ),
          activePlanRevision: revision,
          lastAutomaticReplanRevision: revision,
        },
        updatedAt: new Date(),
      })
      .where(and(
        eq(aiMissionsTable.id, mission.id),
        eq(aiMissionsTable.status, "needs_replan"),
      ))
      .returning({ id: aiMissionsTable.id });
    if (!updatedMission) {
      throw new Error("mission state changed while applying the automatic replan");
    }
    const selectedAlternative = decisionTrace?.result.kind === "SELECTED"
      ? decisionTrace.alternatives.find(
        ({ strategyId }) => strategyId === decisionTrace.result.selectedStrategyId,
      )
      : undefined;
    if (decisionTrace && selectedAlternative?.approvalRequirement === "not_required") {
      await appendMissionDecisionLifecycleEventInTransaction(tx, {
        decisionId: decisionTrace.decisionId,
        stage: "PLAN_APPLIED",
        referenceId: revision,
        occurredAt: new Date(),
      });
    }
    return {
      status: "prepared" as const,
      missionId,
      userId: mission.userId,
      projectId: mission.projectId,
      revision,
      plan,
      failedGoalId: failedGoal?.id ?? null,
      decisionTraceId: decisionTrace?.decisionId ?? null,
      decisionTraceCanDispatch: selectedAlternative?.approvalRequirement === "not_required",
    };
  });

  if (prepared.status !== "prepared") {
    await terminalizeAutomaticReplanFailure(prepared.missionId, prepared.reason);
    return prepared;
  }

  const runs: MissionGoalRunResult[] = [];
  const rootGoals = prepared.plan.goals.filter((goal) => goal.dependencies.length === 0);
  for (const planGoal of rootGoals) {
    const run = await runGoal({
      goalId: planGoal.goalId,
      userId: prepared.userId,
      trigger: "replan",
    });
    if (run.goalId !== planGoal.goalId) {
      return {
        status: "skipped",
        missionId,
        reason: "replan_root_goal_identity_mismatch",
      };
    }
    runs.push(run);
  }
  const dispatchSucceeded = runs.some((run) =>
    run.status === "scheduled" || run.status === "waiting" || run.status === "completed",
  );
  if (!dispatchSucceeded) {
    await terminalizeAutomaticReplanFailure(missionId, "no_eligible_replan_root");
    return {
      status: "skipped",
      missionId,
      reason: "no_eligible_replan_root",
    };
  }

  const dispatchItems = rootGoals.map((planGoal, position) => {
    const run = runs[position];
    if (!run || run.goalId !== planGoal.goalId) {
      throw new Error("mission_replan_dispatch_root_result_missing");
    }
    return {
      position,
      goalId: planGoal.goalId,
      executionId: run.executionId ?? null,
      runStatus: run.status,
    };
  });
  const canRecordDispatchBatch = Boolean(prepared.decisionTraceId)
    && prepared.decisionTraceCanDispatch
    && dispatchItems.some(({ executionId }) => executionId !== null)
    && dispatchItems.every(({ runStatus, executionId }) =>
      !["scheduled", "completed"].includes(runStatus) || executionId !== null,
    );
  let dispatchBatchId: string | null = null;
  await db.transaction(async (tx) => {
    const [current] = await tx
      .select({ autonomyPolicy: aiMissionsTable.autonomyPolicy })
      .from(aiMissionsTable)
      .where(and(
        eq(aiMissionsTable.id, missionId),
        eq(aiMissionsTable.status, "needs_replan"),
      ))
      .for("update");
    if (!current) return;
    const currentAutonomy = normalizeMissionAutonomyPolicy(current.autonomyPolicy);
    const [updated] = await tx.update(aiMissionsTable)
      .set({
        status: "active",
        autonomyPolicy: {
          ...writeCanonicalMissionAutonomyPolicy(
            current.autonomyPolicy,
            currentAutonomy.automaticReplanCount,
          ),
          activePlanRevision: prepared.revision,
          lastAutomaticReplanRevision: prepared.revision,
        },
        updatedAt: new Date(),
      })
      .where(and(
        eq(aiMissionsTable.id, missionId),
        eq(aiMissionsTable.status, "needs_replan"),
      ))
      .returning({ id: aiMissionsTable.id });
    if (!updated) return;
    if (canRecordDispatchBatch && prepared.decisionTraceId) {
      for (const item of dispatchItems) {
        if (!item.executionId) continue;
        const [execution] = await tx.select({ id: aiExecutionsTable.id })
          .from(aiExecutionsTable)
          .where(and(
            eq(aiExecutionsTable.id, item.executionId),
            eq(aiExecutionsTable.projectId, prepared.projectId),
            eq(aiExecutionsTable.goalId, item.goalId),
            eq(aiExecutionsTable.userId, prepared.userId),
          ))
          .for("update");
        if (!execution) {
          throw new Error("mission_replan_dispatch_execution_unbound");
        }
      }
      const recorded = await recordMissionDecisionDispatchBatchInTransaction(tx, {
        decisionId: prepared.decisionTraceId,
        planRevision: prepared.revision,
        occurredAt: new Date(),
        items: dispatchItems,
      });
      dispatchBatchId = recorded.batch.dispatchBatchId;
    }
    await tx.insert(eventsTable).values({
      id: randomUUID(),
      type: "AiMissionReplannedAutomatically",
      projectId: prepared.projectId,
      severity: "info",
      message: "AI Mission automatically received a new plan revision after a recoverable failure",
      correlationId: prepared.plan.primary.goalId,
      payload: {
        missionId,
        failedGoalId: prepared.failedGoalId,
        planRevision: prepared.revision,
        planHash: prepared.revision,
        decisionTraceId: prepared.decisionTraceId,
        dispatchBatchId,
        runs: runs.map((run) => ({ goalId: run.goalId, status: run.status, reason: run.reason })),
      },
    });
  });

  return {
    status: "replanned",
    missionId,
    revision: prepared.revision,
    plan: prepared.plan,
    runs,
  };
}

export async function reconcileAutomaticMissionReplans(
  limit = 16,
  scopeProjectId?: string,
): Promise<number> {
  const candidates = await db
    .select({ id: aiMissionsTable.id })
    .from(aiMissionsTable)
    .where(and(
      eq(aiMissionsTable.status, "needs_replan"),
      scopeProjectId ? eq(aiMissionsTable.projectId, scopeProjectId) : undefined,
    ))
    .orderBy(asc(aiMissionsTable.updatedAt), asc(aiMissionsTable.id))
    .limit(Math.max(1, Math.min(limit, 64)));
  let replanned = 0;
  for (const candidate of candidates) {
    const result = await autoReplanMission(candidate.id);
    if (result.status === "replanned") replanned++;
  }
  return replanned;
}