import { createHash } from "node:crypto";
import { and, eq } from "drizzle-orm";
import {
  aiAgentEpisodesTable,
  aiExecutionAcceptancesTable,
  aiExecutionsTable,
  db,
} from "@workspace/db";
import {
  compareMissionStrategyAlternatives,
  hashMissionDecisionContext,
  hashMissionDecisionTrace,
  hashMissionStrategyAlternative,
  MISSION_DECISION_SCHEMA_VERSION,
  MissionDecisionContextSchema,
  MissionDecisionTraceSchema,
  MissionStrategyAlternativeSchema,
} from "@workspace/ai-orchestrator";
import type {
  MissionDecisionContext,
  MissionDecisionTrace,
  MissionStrategyAlternative,
  MissionStrategyEvaluation,
} from "@workspace/ai-orchestrator";
import type { MissionStrategyDecision } from "./mission-strategy-engine.js";

type DecisionTransaction = Parameters<Parameters<typeof db.transaction>[0]>[0];

const unknownConfidence = {
  status: "unknown" as const,
  value: null,
  calibrationRef: null,
};

const evaluationDimensions = [
  "objective_alignment",
  "evidence_strength",
  "preconditions_satisfaction",
  "capability_availability",
  "expected_success_probability",
  "expected_execution_cost",
  "expected_duration",
  "failure_risk",
  "recovery_complexity",
  "reversibility",
  "side_effect_risk",
  "human_intervention",
  "validation_strength",
  "expected_information_gain",
  "world_state_compatibility",
] as const satisfies readonly MissionStrategyEvaluation["dimensions"][number]["dimension"][];

function digest(value: unknown): string {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

function iso(value: Date | null | undefined): string | null {
  return value instanceof Date && Number.isFinite(value.getTime()) ? value.toISOString() : null;
}

function unique(values: string[]): string[] {
  return [...new Set(values)].sort((left, right) => left.localeCompare(right));
}

function toAlternative(
  decision: MissionStrategyDecision,
  projection: MissionStrategyDecision["candidatePlanProjections"][number],
): MissionStrategyAlternative {
  const candidate = decision.candidates.find(({ strategyId }) => strategyId === projection.strategyId);
  if (!candidate) {
    throw new Error(`strategy projection has no matching candidate: ${projection.strategyId}`);
  }
  const requiredCapabilities = unique(projection.actions.map(({ capabilityId }) => capabilityId));
  const approvalRequirement = projection.actions.some(({ approvalRequired }) => approvalRequired)
    ? "required"
    : "not_required";
  return MissionStrategyAlternativeSchema.parse({
    schemaVersion: MISSION_DECISION_SCHEMA_VERSION,
    strategyId: projection.strategyId,
    version: 1,
    category: decision.scenario === "runtime_start_recovery" ? "verify_then_retry" : "refresh_and_replan",
    source: "server_rule",
    candidateRef: null,
    intendedObjectiveCode: "recover_current_goal",
    requiredCapabilities,
    requiredEvidenceKinds: ["acceptance", "execution"],
    preconditionCodes: ["source_acceptance_execution_attempt_bound"],
    expectedActions: projection.actions.map((action) => ({
      planStepId: action.stepId,
      capabilityId: action.capabilityId,
      effectClass: action.readOnly ? "read_only" : "unknown",
    })),
    expectedObservationCodes: unique(projection.expectedObservationCodes),
    expectedEffectCodes: [],
    validationProcedureCodes: [],
    stepDependencies: projection.actions.map((action) => ({
      stepId: action.stepId,
      dependsOnStepIds: unique(action.dependencies),
    })),
    resourceEstimate: {
      status: "unknown",
      value: null,
      unit: "none",
      confidence: unknownConfidence,
      evidenceRefIds: [],
    },
    durationEstimate: {
      status: "unknown",
      value: null,
      unit: "milliseconds",
      confidence: unknownConfidence,
      evidenceRefIds: [],
    },
    expectedExecutionCost: {
      status: "unknown",
      value: null,
      unit: "none",
      confidence: unknownConfidence,
      evidenceRefIds: [],
    },
    risk: "unknown",
    reversibility: "unknown",
    failureModeCodes: candidate.eligible ? [] : [candidate.reasonCode],
    approvalRequirement,
    assumptionCodes: [],
    limitationCodes: ["legacy_selector_heuristic_only"],
  });
}

function toEvaluation(
  alternative: MissionStrategyAlternative,
  projection: MissionStrategyDecision["candidatePlanProjections"][number],
  acceptanceId: string,
  evaluatedAt: string,
): MissionStrategyEvaluation {
  const dimensions: MissionStrategyEvaluation["dimensions"] = evaluationDimensions.map(
    (dimension) => ({
      dimension,
      status: "unknown",
      normalizedValue: null,
      source: "unknown",
      evidenceRefIds: [],
      confidence: unknownConfidence,
      reasonCodes: ["legacy_selector_did_not_measure_dimension"],
    }),
  );
  return {
    schemaVersion: MISSION_DECISION_SCHEMA_VERSION,
    strategyId: alternative.strategyId,
    strategyHash: hashMissionStrategyAlternative(alternative),
    eligibility: projection.eligible ? "eligible" : "ineligible",
    hardConstraints: [
      {
        constraintCode: "source_acceptance_execution_attempt_bound",
        result: "passed",
        evidenceRefIds: [acceptanceId],
        reasonCodes: [],
      },
      {
        constraintCode: "legacy_strategy_selector_eligibility",
        result: projection.eligible ? "passed" : "rejected",
        evidenceRefIds: [],
        reasonCodes: projection.eligible ? [] : [projection.reasonCode],
      },
    ],
    dimensions,
    rankingScore: null,
    scorePolicyVersion: null,
    evaluatorVersion: "legacy-selector-unscored",
    evaluatedAt,
  };
}

function evidenceRef(input: {
  evidenceId: string;
  kind: "acceptance" | "execution" | "episode";
  projectId: string;
  missionId: string;
  goalId: string;
  executionId: string;
  attempt: number;
  timestamp: string | null;
  projectRevision: string | null;
  contentHash: string;
  eligibility: "eligible" | "advisory";
  provenanceCode: string;
}) {
  return {
    evidenceId: input.evidenceId,
    kind: input.kind,
    knowledgeClass: "SERVER_DERIVED" as const,
    provenanceCode: input.provenanceCode,
    scope: {
      projectId: input.projectId,
      missionId: input.missionId,
      goalId: input.goalId,
      executionId: input.executionId,
      attempt: input.attempt,
    },
    timestamp: input.timestamp,
    freshness: input.timestamp === null ? "unknown" as const : "fresh" as const,
    revisions: {
      project: input.projectRevision,
      worldState: null,
      environment: null,
    },
    confidence: unknownConfidence,
    eligibility: input.eligibility,
    eligibilityReasonCodes: input.eligibility === "eligible" ? [] : ["context_only_not_proof"],
    contentHash: input.contentHash,
  };
}

export async function buildMissionStrategyDecisionTraceInTransaction(
  tx: DecisionTransaction,
  input: {
    decision: MissionStrategyDecision;
    projectId: string;
    proposedPlanRevision: string;
    decidedAt: Date;
  },
): Promise<MissionDecisionTrace> {
  const { decision, projectId, proposedPlanRevision, decidedAt } = input;
  const source = decision.source;
  const executionId = source.sourceExecutionId;
  const acceptanceId = source.sourceAcceptanceId;
  const attempt = source.sourceAttempt;
  const episodeId = source.sourceEpisodeId;
  if (!executionId || !acceptanceId || !Number.isInteger(attempt) || attempt === undefined || attempt < 0) {
    throw new Error("strategy decision lacks an exact source execution, acceptance, or attempt");
  }
  const [execution] = await tx.select().from(aiExecutionsTable)
    .where(and(
      eq(aiExecutionsTable.id, executionId),
      eq(aiExecutionsTable.projectId, projectId),
      eq(aiExecutionsTable.goalId, source.failedGoalId),
      eq(aiExecutionsTable.attempt, attempt),
    ));
  const [acceptance] = await tx.select().from(aiExecutionAcceptancesTable)
    .where(and(
      eq(aiExecutionAcceptancesTable.id, acceptanceId),
      eq(aiExecutionAcceptancesTable.projectId, projectId),
      eq(aiExecutionAcceptancesTable.executionId, executionId),
      eq(aiExecutionAcceptancesTable.attempt, attempt),
    ));
  const [episode] = episodeId
    ? await tx.select().from(aiAgentEpisodesTable)
      .where(and(
        eq(aiAgentEpisodesTable.id, episodeId),
        eq(aiAgentEpisodesTable.projectId, projectId),
        eq(aiAgentEpisodesTable.missionId, source.missionId),
        eq(aiAgentEpisodesTable.goalId, source.failedGoalId),
        eq(aiAgentEpisodesTable.executionId, executionId),
      ))
    : [];
  if (
    !execution
    || !acceptance
    || !episode
    || execution.status !== "failed"
    || acceptance.outcome !== "FAILED"
    || acceptance.terminalStatus !== "failed"
    || acceptance.reasonCode !== source.failureReasonCode
  ) {
    throw new Error("strategy trace source does not match durable failed execution evidence");
  }
  const projectRevision = execution.baseRevision ?? null;
  const evidenceRefs = [
    evidenceRef({
      evidenceId: acceptanceId,
      kind: "acceptance",
      projectId,
      missionId: source.missionId,
      goalId: source.failedGoalId,
      executionId,
      attempt,
      timestamp: iso(acceptance.createdAt),
      projectRevision,
      contentHash: digest({
        id: acceptance.id,
        projectId: acceptance.projectId,
        executionId: acceptance.executionId,
        attempt: acceptance.attempt,
        outcome: acceptance.outcome,
        reasonCode: acceptance.reasonCode,
      }),
      eligibility: "eligible",
      provenanceCode: "durable_failed_execution_acceptance",
    }),
    evidenceRef({
      evidenceId: executionId,
      kind: "execution",
      projectId,
      missionId: source.missionId,
      goalId: source.failedGoalId,
      executionId,
      attempt,
      timestamp: iso(execution.updatedAt),
      projectRevision,
      contentHash: digest({
        id: execution.id,
        projectId: execution.projectId,
        goalId: execution.goalId,
        attempt: execution.attempt,
        status: execution.status,
        baseRevision: execution.baseRevision,
      }),
      eligibility: "eligible",
      provenanceCode: "durable_failed_execution",
    }),
    evidenceRef({
      evidenceId: episodeId!,
      kind: "episode",
      projectId,
      missionId: source.missionId,
      goalId: source.failedGoalId,
      executionId,
      attempt,
      timestamp: iso(episode.closedAt ?? episode.updatedAt),
      projectRevision,
      contentHash: digest({
        id: episode.id,
        projectId: episode.projectId,
        missionId: episode.missionId,
        goalId: episode.goalId,
        executionId: episode.executionId,
        closedAt: episode.closedAt?.toISOString() ?? null,
      }),
      eligibility: "advisory",
      provenanceCode: "closed_episode_context",
    }),
  ];
  const alternatives = decision.candidatePlanProjections.map((projection) => toAlternative(decision, projection));
  const selectedProjection = decision.candidatePlanProjections.find(
    ({ strategyId }) => strategyId === decision.selectedStrategyId,
  );
  if (!selectedProjection?.eligible || alternatives.length === 0) {
    throw new Error("strategy decision has no eligible selected projection");
  }
  const selectedAlternative = alternatives.find(({ strategyId }) => strategyId === decision.selectedStrategyId);
  if (!selectedAlternative) throw new Error("selected strategy is missing from decision alternatives");
  const approvalRequired = selectedAlternative.approvalRequirement === "required";
  const capturedAt = decidedAt.toISOString();
  const context = MissionDecisionContextSchema.parse({
    schemaVersion: MISSION_DECISION_SCHEMA_VERSION,
    identity: {
      projectId,
      missionId: source.missionId,
      goalId: source.failedGoalId,
      trigger: "replan",
      sourceExecutionId: executionId,
      sourceAttempt: attempt,
      sourceAcceptanceId: acceptanceId,
      priorPlanRevision: source.priorPlanRevision,
      projectRevision,
      worldStateRevision: source.worldStatePlanningReadRevision ?? null,
      environmentRevision: null,
    },
    objectiveCode: "recover_current_goal",
    capturedAt,
    failureDiagnoses: [{
      kind: decision.scenario === "validator_recovery" ? "validation_failure" : "failed_precondition",
      code: source.failureReasonCode,
      knowledgeClass: "SERVER_DERIVED",
      evidenceIds: [acceptanceId],
      confidence: unknownConfidence,
    }],
    rootCauseHypotheses: [],
    evidenceRefs,
    authorization: {
      status: approvalRequired ? "approval_required" : "allowed",
      policyRef: `mission-strategy:${decision.policyVersion}`,
      reasonCodes: approvalRequired ? ["plan_step_approval_required"] : [],
    },
    approval: {
      status: approvalRequired ? "required" : "not_required",
      approvalRef: null,
      approvedStrategyId: null,
      approvedStrategyHash: null,
      approvedPlanRevision: null,
    },
    preconditionFindings: [{
      code: "source_acceptance_execution_attempt_bound",
      status: "satisfied",
      evidenceRefIds: [acceptanceId, executionId],
    }],
    availableCapabilities: [],
    unavailableCapabilities: [],
    unknownCapabilities: unique(selectedAlternative.requiredCapabilities),
    unresolvedQuestionCodes: ["legacy_formal_strategy_dimensions_unmeasured"],
    requiredObservationCodes: selectedProjection.expectedObservationCodes,
  } satisfies MissionDecisionContext);
  const evaluations = alternatives.map((alternative) => {
    const projection = decision.candidatePlanProjections.find(
      ({ strategyId }) => strategyId === alternative.strategyId,
    )!;
    return toEvaluation(alternative, projection, acceptanceId, capturedAt);
  });
  const differences = alternatives.flatMap((left, index) =>
    alternatives.slice(index + 1).map((right) => compareMissionStrategyAlternatives(left, right)),
  );
  const body = {
    schemaVersion: MISSION_DECISION_SCHEMA_VERSION,
    context,
    contextHash: hashMissionDecisionContext(context),
    alternatives,
    differences,
    evaluations,
    result: {
      kind: "SELECTED" as const,
      selectedStrategyId: selectedAlternative.strategyId,
      rationaleCodes: ["legacy_server_strategy_selected"],
      rejectedStrategyCodes: decision.candidates
        .filter(({ eligible, strategyId }) => !eligible && strategyId !== decision.selectedStrategyId)
        .map(({ reasonCode }) => reasonCode),
    },
    lifecycle: [
      { stage: "PROPOSED" as const, at: capturedAt, referenceId: null },
      { stage: "EVALUATED" as const, at: new Date(decidedAt.getTime() + 1).toISOString(), referenceId: null },
      { stage: "SELECTED" as const, at: new Date(decidedAt.getTime() + 2).toISOString(), referenceId: selectedAlternative.strategyId },
    ],
    uncertaintyCodes: ["legacy_heuristic_selector", "formal_dimension_scores_unknown"],
    decisionConfidence: unknownConfidence,
    policyVersion: decision.policyVersion,
    evaluatorVersion: "legacy-selector-unscored",
    modelProvenance: null,
    priorPlanRevision: source.priorPlanRevision,
    newPlanRevision: proposedPlanRevision,
    dispatchRef: null,
    decidedAt: new Date(decidedAt.getTime() + 2).toISOString(),
  };
  return MissionDecisionTraceSchema.parse({
    ...body,
    decisionId: hashMissionDecisionTrace(body),
  });
}
