import { describe, expect, it } from "vitest";
import {
  DecisionConfidenceSchema,
  MISSION_DECISION_SCHEMA_VERSION,
  MissionDecisionContextSchema,
  MissionDecisionTraceSchema,
  MissionStrategyAlternativeSchema,
  MissionStrategyEvaluationSchema,
  MissionStrategyOutcomeEvaluationSchema,
  StrategyDifferenceSchema,
  StrategyEvaluationDimensionSchema,
  hashMissionDecisionContext,
  hashMissionStrategyAlternative,
  hashMissionDecisionTrace,
  type MissionDecisionContext,
  type MissionDecisionTrace,
} from "./mission-decision-contract.js";

const unknownConfidence = {
  status: "unknown" as const,
  value: null,
  calibrationRef: null,
};

function buildContext(): MissionDecisionContext {
  return MissionDecisionContextSchema.parse({
    schemaVersion: MISSION_DECISION_SCHEMA_VERSION,
    identity: {
      projectId: "project-1",
      missionId: "mission-1",
      goalId: "goal-1",
      trigger: "recovery",
      sourceExecutionId: "execution-1",
      sourceAttempt: 2,
      sourceAcceptanceId: "acceptance-1",
      priorPlanRevision: "revision-1",
      projectRevision: "project-revision-1",
      worldStateRevision: "world-revision-1",
      environmentRevision: "environment-revision-1",
    },
    objectiveCode: "repair_validator_failure",
    capturedAt: "2026-11-03T10:00:00.000Z",
    failureDiagnoses: [{
      kind: "validation_failure",
      code: "validator_failed",
      knowledgeClass: "SERVER_DERIVED",
      evidenceIds: ["acceptance-1"],
      confidence: unknownConfidence,
    }],
    rootCauseHypotheses: [],
    evidenceRefs: [{
      evidenceId: "acceptance-1",
      kind: "acceptance",
      knowledgeClass: "SERVER_DERIVED",
      provenanceCode: "canonical_acceptance",
      scope: {
        projectId: "project-1",
        missionId: "mission-1",
        goalId: "goal-1",
        executionId: "execution-1",
        attempt: 2,
      },
      timestamp: "2026-11-03T09:59:00.000Z",
      freshness: "fresh",
      revisions: {
        project: "project-revision-1",
        worldState: "world-revision-1",
        environment: "environment-revision-1",
      },
      confidence: unknownConfidence,
      eligibility: "eligible",
      eligibilityReasonCodes: [],
      contentHash: "a".repeat(64),
    }],
    authorization: {
      status: "allowed",
      policyRef: "policy-1",
      reasonCodes: [],
    },
    approval: {
      status: "not_required",
      approvalRef: null,
      approvedStrategyId: null,
      approvedStrategyHash: null,
      approvedPlanRevision: null,
    },
    preconditionFindings: [],
    availableCapabilities: ["read_repository"],
    unavailableCapabilities: [],
    unknownCapabilities: [],
    unresolvedQuestionCodes: [],
    requiredObservationCodes: [],
  });
}

function buildAlternative() {
  return MissionStrategyAlternativeSchema.parse({
    schemaVersion: MISSION_DECISION_SCHEMA_VERSION,
    strategyId: "strategy.baseline",
    version: 1,
    category: "baseline",
    source: "existing_plan",
    candidateRef: null,
    intendedObjectiveCode: "complete_goal",
    requiredCapabilities: ["read_repository"],
    requiredEvidenceKinds: ["acceptance"],
    preconditionCodes: ["current_revision_matches"],
    expectedActions: [{
      planStepId: "inspect",
      capabilityId: "read_repository",
      effectClass: "read_only",
    }],
    expectedObservationCodes: ["validation_result"],
    expectedEffectCodes: ["goal_accepted"],
    validationProcedureCodes: ["canonical_acceptance"],
    stepDependencies: [{ stepId: "inspect", dependsOnStepIds: [] }],
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
      unit: "none",
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
    failureModeCodes: [],
    approvalRequirement: "unknown",
    assumptionCodes: [],
    limitationCodes: [],
  });
}

function buildEvaluation(
  strategyId = "strategy.baseline",
  strategyHash = hashMissionStrategyAlternative(buildAlternative()),
) {
  return MissionStrategyEvaluationSchema.parse({
    schemaVersion: MISSION_DECISION_SCHEMA_VERSION,
    strategyId,
    strategyHash,
    eligibility: "eligible",
    hardConstraints: [{
      constraintCode: "authorization",
      result: "passed",
      evidenceRefIds: ["acceptance-1"],
      reasonCodes: [],
    }],
    dimensions: StrategyEvaluationDimensionSchema.options.map((dimension) => ({
      dimension,
      status: "unknown",
      normalizedValue: null,
      source: "unknown",
      evidenceRefIds: [],
      confidence: unknownConfidence,
      reasonCodes: ["no_calibrated_history"],
    })),
    rankingScore: null,
    scorePolicyVersion: null,
    evaluatorVersion: "evaluator-v1",
    evaluatedAt: "2026-11-03T10:00:01.000Z",
  });
}

function buildTrace(
  result: MissionDecisionTrace["result"] = {
    kind: "SELECTED",
    selectedStrategyId: "strategy.baseline",
    rationaleCodes: ["only_existing_plan"],
    rejectedStrategyCodes: [],
  },
): MissionDecisionTrace {
  const context = buildContext();
  const traceBody = {
    schemaVersion: MISSION_DECISION_SCHEMA_VERSION,
    context,
    contextHash: hashMissionDecisionContext(context),
    alternatives: [buildAlternative()],
    differences: [],
    evaluations: [buildEvaluation()],
    result,
    lifecycle: [
      { stage: "PROPOSED", at: "2026-11-03T10:00:00.000Z", referenceId: null },
      { stage: "EVALUATED", at: "2026-11-03T10:00:01.000Z", referenceId: null },
      { stage: "SELECTED", at: "2026-11-03T10:00:02.000Z", referenceId: null },
    ],
    uncertaintyCodes: ["outcome_history_insufficient"],
    decisionConfidence: {
      status: "uncalibrated" as const,
      value: null,
      calibrationRef: null,
    },
    policyVersion: "policy-v1",
    evaluatorVersion: "evaluator-v1",
    modelProvenance: null,
    priorPlanRevision: "revision-1",
    newPlanRevision: "revision-2",
    dispatchRef: null,
    decidedAt: "2026-11-03T10:00:02.000Z",
  } satisfies Omit<MissionDecisionTrace, "decisionId">;
  return MissionDecisionTraceSchema.parse({
    ...traceBody,
    decisionId: hashMissionDecisionTrace(traceBody),
  });
}

describe("Mission decision contracts", () => {
  it("requires approval receipts to bind an exact strategy hash and prior plan revision", () => {
    const context = buildContext();
    expect(MissionDecisionContextSchema.safeParse({
      ...context,
      approval: { ...context.approval, status: "granted", approvalRef: "approval-1" },
    }).success).toBe(false);
  });

  it("keeps source identity, provenance, freshness, revisions, and epistemic class explicit", () => {
    const context = buildContext();
    expect(context.identity).toMatchObject({
      missionId: "mission-1",
      goalId: "goal-1",
      sourceExecutionId: "execution-1",
      sourceAttempt: 2,
      priorPlanRevision: "revision-1",
    });
    expect(context.evidenceRefs[0]).toMatchObject({
      knowledgeClass: "SERVER_DERIVED",
      freshness: "fresh",
      eligibility: "eligible",
      scope: { projectId: "project-1", missionId: "mission-1", goalId: "goal-1" },
    });
  });

  it("requires recovery decisions to identify the durable source acceptance", () => {
    const context = buildContext();
    expect(MissionDecisionContextSchema.safeParse({
      ...context,
      identity: { ...context.identity, sourceAcceptanceId: null },
    }).success).toBe(false);
  });

  it("rejects stale, hypothetical, cross-project, or unrelated-attempt evidence as eligible proof", () => {
    const context = buildContext();
    const invalidRefs = [
      { ...context.evidenceRefs[0]!, freshness: "stale" },
      { ...context.evidenceRefs[0]!, knowledgeClass: "HYPOTHETICAL" },
      { ...context.evidenceRefs[0]!, scope: { ...context.evidenceRefs[0]!.scope, projectId: "other-project" } },
      { ...context.evidenceRefs[0]!, scope: { ...context.evidenceRefs[0]!.scope, attempt: 1 } },
    ];
    for (const evidence of invalidRefs) {
      expect(MissionDecisionContextSchema.safeParse({
        ...context,
        evidenceRefs: [evidence],
      }).success).toBe(false);
    }
  });

  it("does not allow a rule-derived root-cause hypothesis to be recorded as proven", () => {
    const context = buildContext();
    expect(MissionDecisionContextSchema.safeParse({
      ...context,
      rootCauseHypotheses: [{
        hypothesisCode: "assumption_failed",
        knowledgeClass: "SERVER_DERIVED",
        confidence: unknownConfidence,
        supportingEvidenceIds: ["acceptance-1"],
        contradictingEvidenceIds: [],
        unresolvedQuestionCodes: [],
        requiredObservationCodes: [],
      }],
    }).success).toBe(false);
  });

  it("requires a calibrated reference before confidence can be called calibrated", () => {
    expect(DecisionConfidenceSchema.safeParse({
      status: "calibrated",
      value: 0.8,
      calibrationRef: null,
    }).success).toBe(false);
    expect(DecisionConfidenceSchema.parse({
      status: "heuristic",
      value: 0.8,
      calibrationRef: null,
    }).status).toBe("heuristic");
  });

  it("requires every evaluation dimension and rejects invented unknown scores", () => {
    const evaluation = buildEvaluation();
    expect(evaluation.dimensions).toHaveLength(15);
    expect(MissionStrategyEvaluationSchema.safeParse({
      ...evaluation,
      dimensions: evaluation.dimensions.slice(1),
    }).success).toBe(false);
    expect(MissionStrategyEvaluationSchema.safeParse({
      ...evaluation,
      dimensions: evaluation.dimensions.map((dimension, index) => (
        index === 0 ? { ...dimension, normalizedValue: 0.7 } : dimension
      )),
    }).success).toBe(false);
  });

  it("rejects ranked scores without a versioned policy and eligibility with unknown hard constraints", () => {
    const evaluation = buildEvaluation();
    expect(MissionStrategyEvaluationSchema.safeParse({
      ...evaluation,
      rankingScore: 0.9,
      scorePolicyVersion: null,
    }).success).toBe(false);
    expect(MissionStrategyEvaluationSchema.safeParse({
      ...evaluation,
      hardConstraints: [{
        constraintCode: "approval",
        result: "unknown",
        evidenceRefIds: [],
        reasonCodes: ["approval_state_unknown"],
      }],
    }).success).toBe(false);
  });

  it("binds trace IDs to content and refuses selection of an ineligible strategy", () => {
    const trace = buildTrace();
    expect(MissionDecisionTraceSchema.parse(trace).decisionId).toBe(trace.decisionId);
    expect(trace.lifecycle.at(-1)?.stage).toBe("SELECTED");
    expect(trace.dispatchRef).toBeNull();
    expect(MissionDecisionTraceSchema.safeParse({
      ...trace,
      result: {
        kind: "SELECTED",
        selectedStrategyId: "missing-strategy",
        rationaleCodes: ["test"],
        rejectedStrategyCodes: [],
      },
    }).success).toBe(false);
    expect(MissionDecisionTraceSchema.safeParse({
      ...trace,
      decisionId: "c".repeat(64),
    }).success).toBe(false);
  });

  it("represents NO_DECISION explicitly without inventing a winner", () => {
    const context = buildContext();
    const body = {
      schemaVersion: MISSION_DECISION_SCHEMA_VERSION,
      context,
      contextHash: hashMissionDecisionContext(context),
      alternatives: [],
      differences: [],
      evaluations: [],
      result: { kind: "NO_DECISION", selectedStrategyId: null, reasonCode: "insufficient_evidence" },
      lifecycle: [
        { stage: "PROPOSED", at: "2026-11-03T10:00:00.000Z", referenceId: null },
        { stage: "EVALUATED", at: "2026-11-03T10:00:01.000Z", referenceId: null },
      ],
      uncertaintyCodes: ["insufficient_evidence"],
      decisionConfidence: { status: "unknown", value: null, calibrationRef: null },
      policyVersion: "policy-v1",
      evaluatorVersion: "evaluator-v1",
      modelProvenance: null,
      priorPlanRevision: "revision-1",
      newPlanRevision: null,
      dispatchRef: null,
      decidedAt: "2026-11-03T10:00:02.000Z",
    } satisfies Omit<MissionDecisionTrace, "decisionId">;
    const trace = MissionDecisionTraceSchema.parse({
      ...body,
      decisionId: hashMissionDecisionTrace(body),
    });
    expect(trace.result).toEqual({
      kind: "NO_DECISION",
      selectedStrategyId: null,
      reasonCode: "insufficient_evidence",
    });
  });

  it("requires candidate identity when an alternative comes from the existing candidate registry", () => {
    const alternative = buildAlternative();
    expect(MissionStrategyAlternativeSchema.safeParse({
      ...alternative,
      source: "strategy_candidate",
      candidateRef: null,
    }).success).toBe(false);
  });

  it("rejects incomplete or cyclic action dependencies", () => {
    const alternative = buildAlternative();
    expect(MissionStrategyAlternativeSchema.safeParse({
      ...alternative,
      stepDependencies: [],
    }).success).toBe(false);
    expect(MissionStrategyAlternativeSchema.safeParse({
      ...alternative,
      expectedActions: [
        { planStepId: "one", capabilityId: "read.one", effectClass: "read_only" },
        { planStepId: "two", capabilityId: "read.two", effectClass: "read_only" },
      ],
      requiredCapabilities: ["read.one", "read.two"],
      stepDependencies: [
        { stepId: "one", dependsOnStepIds: ["two"] },
        { stepId: "two", dependsOnStepIds: ["one"] },
      ],
    }).success).toBe(false);
  });

  it("keeps selected and dispatched lifecycle stages distinct and ordered", () => {
    const trace = buildTrace();
    const { decisionId: _decisionId, ...traceBody } = trace;
    const outOfOrder = {
      ...traceBody,
      lifecycle: [...trace.lifecycle].reverse(),
    } satisfies Omit<MissionDecisionTrace, "decisionId">;
    expect(MissionDecisionTraceSchema.safeParse({
      ...outOfOrder,
      decisionId: hashMissionDecisionTrace(outOfOrder),
    }).success).toBe(false);
    expect(trace.lifecycle.map(({ stage }) => stage)).toEqual(["PROPOSED", "EVALUATED", "SELECTED"]);
    expect(trace.dispatchRef).toBeNull();
  });

  it("requires evidence-bound acceptance and effect identities for an achieved outcome", () => {
    expect(MissionStrategyOutcomeEvaluationSchema.safeParse({
      schemaVersion: MISSION_DECISION_SCHEMA_VERSION,
      decisionId: "d".repeat(64),
      missionId: "mission-1",
      goalId: "goal-1",
      executionId: "execution-1",
      attempt: 2,
      planRevision: "revision-2",
      selectedStrategyId: "strategy.baseline",
      outcome: "ACHIEVED",
      acceptanceId: null,
      effectBundleId: null,
      observedEffectCodes: [],
      supportingEvidenceIds: [],
      contradictingEvidenceIds: [],
      worldStateRevision: "world-revision-2",
      evaluatedAt: "2026-11-03T10:01:00.000Z",
      limitationCodes: [],
    }).success).toBe(false);
  });

  it("does not treat names as proof of meaningful strategy difference", () => {
    expect(StrategyDifferenceSchema.safeParse({
      leftStrategyId: "strategy.a",
      rightStrategyId: "strategy.b",
      classification: "GENUINELY_DIFFERENT",
      changedDimensions: [],
      reasonCodes: [],
    }).success).toBe(false);
    expect(StrategyDifferenceSchema.safeParse({
      leftStrategyId: "strategy.a",
      rightStrategyId: "strategy.b",
      classification: "SEMANTICALLY_EQUIVALENT",
      changedDimensions: ["action_sequence"],
      reasonCodes: [],
    }).success).toBe(false);
  });
});
