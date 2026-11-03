import { describe, expect, it } from "vitest";
import {
  MISSION_DECISION_SCHEMA_VERSION,
  MissionDecisionContextSchema,
  MissionDecisionTraceSchema,
  MissionStrategyAlternativeSchema,
  MissionStrategyEvaluationSchema,
  StrategyEvaluationDimensionSchema,
  hashMissionDecisionContext,
  hashMissionDecisionTrace,
  hashMissionStrategyAlternative,
} from "./mission-decision-contract.js";
import type { MissionDecisionTrace } from "./mission-decision-contract.js";
import {
  evaluateMissionStrategyOutcome,
  type MissionStrategyOutcomeEvidence,
} from "./mission-strategy-outcome-evaluation.js";
import {
  evaluateMissionStrategyPlanOutcome,
  type MissionStrategyPlanOutcomeEvidence,
} from "./mission-strategy-plan-outcome-evaluation.js";

const at = "2026-11-03T10:00:00.000Z";
const unknownConfidence = { status: "unknown" as const, value: null, calibrationRef: null };
const projectId = "project-1";
const missionId = "mission-1";
const goalId = "goal-1";
const effectContractHash = "a".repeat(64);
const proofHash = "b".repeat(64);

function makeTrace(): MissionDecisionTrace {
  const context = MissionDecisionContextSchema.parse({
    schemaVersion: MISSION_DECISION_SCHEMA_VERSION,
    identity: {
      projectId,
      missionId,
      goalId,
      trigger: "recovery",
      sourceExecutionId: "source-execution",
      sourceAttempt: 2,
      sourceAcceptanceId: "source-acceptance",
      priorPlanRevision: "prior-plan",
      projectRevision: "project-revision",
      worldStateRevision: "source-world-revision",
      environmentRevision: null,
    },
    objectiveCode: "recover_goal",
    capturedAt: at,
    failureDiagnoses: [],
    rootCauseHypotheses: [],
    evidenceRefs: [{
      evidenceId: "source-acceptance",
      kind: "acceptance",
      knowledgeClass: "SERVER_DERIVED",
      provenanceCode: "canonical_acceptance",
      scope: { projectId, missionId, goalId, executionId: "source-execution", attempt: 2 },
      timestamp: at,
      freshness: "fresh",
      revisions: { project: "project-revision", worldState: "source-world-revision", environment: null },
      confidence: unknownConfidence,
      eligibility: "eligible",
      eligibilityReasonCodes: [],
      contentHash: "c".repeat(64),
    }],
    authorization: { status: "allowed", policyRef: "policy-1", reasonCodes: [] },
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
  const alternative = MissionStrategyAlternativeSchema.parse({
    schemaVersion: MISSION_DECISION_SCHEMA_VERSION,
    strategyId: "strategy.verify-change",
    version: 1,
    category: "verify_then_retry",
    source: "server_rule",
    candidateRef: null,
    intendedObjectiveCode: "recover_goal",
    requiredCapabilities: ["read_repository"],
    requiredEvidenceKinds: ["acceptance"],
    preconditionCodes: ["source_execution_attempt_bound"],
    expectedActions: [{ planStepId: "verify", capabilityId: "read_repository", effectClass: "read_only" }],
    expectedObservationCodes: ["goal_state"],
    expectedEffectCodes: ["effect.changed"],
    validationProcedureCodes: ["canonical_acceptance"],
    stepDependencies: [{ stepId: "verify", dependsOnStepIds: [] }],
    resourceEstimate: { status: "unknown", value: null, unit: "none", confidence: unknownConfidence, evidenceRefIds: [] },
    durationEstimate: { status: "unknown", value: null, unit: "none", confidence: unknownConfidence, evidenceRefIds: [] },
    expectedExecutionCost: { status: "unknown", value: null, unit: "none", confidence: unknownConfidence, evidenceRefIds: [] },
    risk: "low",
    reversibility: "reversible",
    failureModeCodes: [],
    approvalRequirement: "not_required",
    assumptionCodes: [],
    limitationCodes: [],
  });
  const strategyHash = hashMissionStrategyAlternative(alternative);
  const evaluation = MissionStrategyEvaluationSchema.parse({
    schemaVersion: MISSION_DECISION_SCHEMA_VERSION,
    strategyId: alternative.strategyId,
    strategyHash,
    eligibility: "eligible",
    hardConstraints: [],
    dimensions: StrategyEvaluationDimensionSchema.options.map((dimension) => ({
      dimension,
      status: "unknown",
      normalizedValue: null,
      source: "unknown",
      evidenceRefIds: [],
      confidence: unknownConfidence,
      reasonCodes: ["baseline_unavailable"],
    })),
    rankingScore: null,
    scorePolicyVersion: null,
    evaluatorVersion: "pareto-conservative-v1",
    evaluatedAt: at,
  });
  const body = {
    schemaVersion: MISSION_DECISION_SCHEMA_VERSION,
    context,
    contextHash: hashMissionDecisionContext(context),
    alternatives: [alternative],
    differences: [],
    evaluations: [evaluation],
    result: {
      kind: "SELECTED" as const,
      selectedStrategyId: alternative.strategyId,
      rationaleCodes: ["unique_eligible_strategy"],
      rejectedStrategyCodes: [],
    },
    lifecycle: [
      { stage: "PROPOSED" as const, at, referenceId: null },
      { stage: "EVALUATED" as const, at, referenceId: null },
      { stage: "SELECTED" as const, at, referenceId: alternative.strategyId },
    ],
    uncertaintyCodes: ["uncalibrated_success_probability"],
    decisionConfidence: unknownConfidence,
    policyVersion: "pareto-conservative-v1",
    evaluatorVersion: "pareto-conservative-v1",
    modelProvenance: null,
    priorPlanRevision: "prior-plan",
    newPlanRevision: null,
    dispatchRef: null,
    decidedAt: at,
  };
  return MissionDecisionTraceSchema.parse({
    ...body,
    decisionId: hashMissionDecisionTrace(body),
  });
}

function makeEvidence(): MissionStrategyOutcomeEvidence {
  const trace = makeTrace();
  return {
    trace,
    lifecycleEvents: [
      { stage: "PROPOSED", sequence: 1, referenceId: null },
      { stage: "EVALUATED", sequence: 2, referenceId: null },
      { stage: "SELECTED", sequence: 3, referenceId: "strategy.verify-change" },
      { stage: "PLAN_APPLIED", sequence: 4, referenceId: "applied-plan" },
      { stage: "DISPATCHED", sequence: 5, referenceId: "execution-1" },
      { stage: "EXECUTED", sequence: 6, referenceId: "execution-1" },
      { stage: "ACCEPTED", sequence: 7, referenceId: "acceptance-1" },
      { stage: "VERIFIED", sequence: 8, referenceId: "proof-1" },
    ],
    execution: {
      id: "execution-1",
      projectId,
      missionId,
      goalId,
      attempt: 3,
      planRevision: "applied-plan",
    },
    acceptance: {
      id: "acceptance-1",
      projectId,
      executionId: "execution-1",
      attempt: 3,
      terminalStatus: "completed",
      outcome: "success",
      evidenceComplete: true,
      effectBundleId: "bundle-1",
    },
    effectBundle: {
      id: "bundle-1",
      projectId,
      executionId: "execution-1",
      attempt: 3,
      verdict: "observed",
      effectIds: ["effect-1"],
      effectContractHashes: [effectContractHash],
      worldStateRevision: "world-after",
    },
    effects: [{
      id: "effect-1",
      projectId,
      executionId: "execution-1",
      attempt: 3,
      actionId: "action-1",
      effectContractHash,
      status: "observed",
      expectedEffects: ["effect.changed"],
      missingEffects: [],
      beforeObservationIds: ["observation-before"],
      afterObservationIds: ["observation-after"],
    }],
    observations: [
      {
        id: "observation-before",
        projectId,
        executionId: "execution-1",
        attempt: 3,
        completeness: "complete",
        freshness: "fresh",
        worldStateRevision: "world-before",
      },
      {
        id: "observation-after",
        projectId,
        executionId: "execution-1",
        attempt: 3,
        completeness: "complete",
        freshness: "fresh",
        worldStateRevision: "world-after",
      },
    ],
    canonicalProof: {
      status: "PROVEN",
      verifiedOutcome: "ACHIEVED",
      proofId: "proof-1",
      proofHash,
      projectId,
      missionId,
      goalId,
      executionId: "execution-1",
      acceptanceId: "acceptance-1",
      attempt: 3,
      planRevision: "applied-plan",
      worldStateRevision: "world-after",
    },
    currentWorldStateRevision: "world-after",
    evaluatedAt: at,
  };
}

describe("Mission strategy outcome evaluation", () => {
  it("reports ACHIEVED only with exact lifecycle, acceptance, effect, observation, and proof bindings", () => {
    const result = evaluateMissionStrategyOutcome(makeEvidence());
    expect(result).toMatchObject({
      outcome: "ACHIEVED",
      decisionId: makeEvidence().trace.decisionId,
      executionId: "execution-1",
      acceptanceId: "acceptance-1",
      effectBundleId: "bundle-1",
      observedEffectCodes: ["effect.changed"],
      worldStateRevision: "world-after",
      limitationCodes: [],
    });
  });

  it("fails closed when the Acceptance evidence or fresh before/after observations are incomplete", () => {
    const incomplete = makeEvidence();
    incomplete.acceptance.evidenceComplete = false;
    const result = evaluateMissionStrategyOutcome(incomplete);
    expect(result.outcome).toBe("INCONCLUSIVE");
    expect(result.limitationCodes).toContain("acceptance_evidence_incomplete");

    const stale = makeEvidence();
    stale.observations[1]!.freshness = "stale";
    expect(evaluateMissionStrategyOutcome(stale)).toMatchObject({
      outcome: "INCONCLUSIVE",
      limitationCodes: expect.arrayContaining(["fresh_before_after_effect_evidence_missing"]),
    });
  });

  it("rejects cross-attempt acceptance and mismatched dispatched execution", () => {
    const wrongAttempt = makeEvidence();
    wrongAttempt.acceptance.attempt = 2;
    expect(evaluateMissionStrategyOutcome(wrongAttempt)).toMatchObject({
      outcome: "INCONCLUSIVE",
      limitationCodes: ["outcome_lifecycle_identity_mismatch"],
    });

    const wrongExecution = makeEvidence();
    wrongExecution.lifecycleEvents[4]!.referenceId = "other-execution";
    expect(evaluateMissionStrategyOutcome(wrongExecution)).toMatchObject({
      outcome: "INCONCLUSIVE",
      limitationCodes: ["outcome_lifecycle_identity_mismatch"],
    });
  });

  it("reports NOT_ACHIEVED only with a canonical failure acceptance and direct contradictions", () => {
    const evidence = makeEvidence();
    evidence.acceptance.terminalStatus = "failed";
    evidence.acceptance.outcome = "failure";
    evidence.effectBundle.verdict = "contradicted";
    evidence.effects[0]!.status = "contradicted";
    evidence.effects[0]!.missingEffects = ["effect.changed"];
    evidence.canonicalProof = null;
    const result = evaluateMissionStrategyOutcome(evidence);
    expect(result).toMatchObject({
      outcome: "NOT_ACHIEVED",
      contradictingEvidenceIds: expect.arrayContaining(["effect-1", "observation-after"]),
      limitationCodes: [],
    });
  });

  it("keeps conflicting proven success and direct failure evidence inconclusive", () => {
    const evidence = makeEvidence();
    evidence.acceptance.terminalStatus = "failed";
    evidence.acceptance.outcome = "failure";
    evidence.effectBundle.verdict = "contradicted";
    evidence.effects[0]!.status = "contradicted";
    evidence.effects[0]!.missingEffects = ["effect.changed"];
    expect(evaluateMissionStrategyOutcome(evidence)).toMatchObject({
      outcome: "INCONCLUSIVE",
      limitationCodes: expect.arrayContaining(["canonical_proof_outcome_conflict"]),
    });
  });

  it("does not infer success from a provider or acceptance claim without independently bound proof", () => {
    const evidence = makeEvidence();
    evidence.canonicalProof = null;
    expect(evaluateMissionStrategyOutcome(evidence)).toMatchObject({
      outcome: "INCONCLUSIVE",
      limitationCodes: expect.arrayContaining(["canonical_proof_not_revalidated"]),
    });
  });

  it("returns an inconclusive result for malformed effect evidence instead of trusting it", () => {
    const evidence = makeEvidence();
    (evidence.effects[0] as unknown as Record<string, unknown>).effectContractHash = "not-a-hash";
    expect(evaluateMissionStrategyOutcome(evidence)).toMatchObject({
      outcome: "INCONCLUSIVE",
      limitationCodes: ["outcome_evidence_schema_invalid"],
    });
  });
});

function makePlanOutcomeEvidence(): MissionStrategyPlanOutcomeEvidence {
  const baseTrace = makeTrace();
  const { decisionId: _oldDecisionId, ...baseBody } = baseTrace;
  const planRevision = "applied-plan";
  const dispatchBatchId = "dispatch-batch-1";
  const lifecycle = [
    { stage: "PROPOSED" as const, at, referenceId: null },
    { stage: "EVALUATED" as const, at, referenceId: null },
    { stage: "SELECTED" as const, at, referenceId: "strategy.verify-change" },
    { stage: "PLAN_APPLIED" as const, at, referenceId: planRevision },
    { stage: "DISPATCHED" as const, at, referenceId: dispatchBatchId },
  ];
  const traceBody = {
    ...baseBody,
    lifecycle,
    newPlanRevision: planRevision,
    dispatchRef: dispatchBatchId,
  };
  const trace = MissionDecisionTraceSchema.parse({
    ...traceBody,
    decisionId: hashMissionDecisionTrace(traceBody),
  });
  const expectedProof = {
    attempt: 1,
    terminal: true,
    acceptanceId: "acceptance-successor",
    effectBundleId: "bundle-successor",
    canonicalProofId: "proof-successor",
    canonicalProofHash: proofHash,
    worldStateRevision: "final-world",
    outcome: "ACHIEVED" as const,
    evidenceHash: "d".repeat(64),
    observedEffectCodes: ["effect.changed"],
    contradictedEffectCodes: [],
  };
  return {
    trace,
    persistedLifecycle: lifecycle.map((event, index) => ({
      stage: event.stage,
      sequence: index + 1,
      referenceId: event.referenceId,
    })),
    plan: {
      projectId,
      missionId,
      sourceGoalId: goalId,
      revision: planRevision,
      activeRevision: planRevision,
      goalIds: ["successor-root", "successor-dependent"],
      requiredGoalIds: ["successor-root", "successor-dependent"],
      taskIds: ["successor-task"],
      rootGoalIds: ["successor-root"],
    },
    dispatchBatch: {
      decisionId: trace.decisionId,
      projectId,
      missionId,
      planRevision,
      id: dispatchBatchId,
      manifestHash: "e".repeat(64),
      state: "dispatched",
      items: [{
        position: 0,
        goalId: "successor-root",
        executionId: "execution-root",
        runStatus: "completed",
      }],
    },
    goalStates: [
      {
        goalId: "successor-root",
        terminal: true,
        taskIds: [],
        executionIds: ["execution-root"],
      },
      {
        goalId: "successor-dependent",
        terminal: true,
        taskIds: ["successor-task"],
        executionIds: [],
      },
    ],
    taskStates: [{
      taskId: "successor-task",
      goalId: "successor-dependent",
      terminal: true,
      executionIds: ["execution-task"],
    }],
    executions: [
      {
        goalId: "successor-root",
        taskId: null,
        executionId: "execution-root",
        ...expectedProof,
      },
      {
        goalId: "successor-dependent",
        taskId: "successor-task",
        executionId: "execution-task",
        ...expectedProof,
        acceptanceId: "acceptance-task",
        effectBundleId: "bundle-task",
        canonicalProofId: "proof-task",
        evidenceHash: "f".repeat(64),
      },
    ],
    finalWorldState: {
      revision: "final-world",
      continuityVerified: true,
      evidenceHash: "9".repeat(64),
      observedEffectCodes: ["effect.changed"],
      contradictedEffectCodes: [],
    },
    evaluatedAt: at,
  };
}

describe("Mission strategy plan outcome evaluation", () => {
  it("aggregates successor Goals under the source decision without conflating their identities", () => {
    const evidence = makePlanOutcomeEvidence();
    const result = evaluateMissionStrategyPlanOutcome(evidence);
    expect(result).toMatchObject({
      outcome: "ACHIEVED",
      sourceGoalId: "goal-1",
      planGoalIds: ["successor-dependent", "successor-root"],
      rootGoalIds: ["successor-root"],
      dispatchBatchId: "dispatch-batch-1",
      finalWorldState: {
        continuityVerified: true,
        revision: "final-world",
      },
    });
    expect(result.evidenceSetHash).toMatch(/^[a-f0-9]{64}$/);
  });

  it("keeps partial task completion inconclusive", () => {
    const evidence = makePlanOutcomeEvidence();
    evidence.taskStates[0]!.terminal = false;
    expect(evaluateMissionStrategyPlanOutcome(evidence)).toMatchObject({
      outcome: "INCONCLUSIVE",
      limitationCodes: expect.arrayContaining(["plan_task_nonterminal"]),
    });
  });

  it("keeps an unverified final World State inconclusive even when individual executions claim success", () => {
    const evidence = makePlanOutcomeEvidence();
    evidence.finalWorldState.continuityVerified = false;
    evidence.finalWorldState.evidenceHash = null;
    expect(evaluateMissionStrategyPlanOutcome(evidence)).toMatchObject({
      outcome: "INCONCLUSIVE",
      limitationCodes: expect.arrayContaining(["final_world_state_unverified"]),
    });
  });

  it("records a fully contradicted terminal plan as not achieved", () => {
    const evidence = makePlanOutcomeEvidence();
    for (const execution of evidence.executions) {
      execution.outcome = "NOT_ACHIEVED";
      execution.canonicalProofId = null;
      execution.canonicalProofHash = null;
      execution.observedEffectCodes = [];
      execution.contradictedEffectCodes = ["effect.changed"];
    }
    evidence.finalWorldState.observedEffectCodes = [];
    evidence.finalWorldState.contradictedEffectCodes = ["effect.changed"];
    expect(evaluateMissionStrategyPlanOutcome(evidence)).toMatchObject({
      outcome: "NOT_ACHIEVED",
      contradictedEffectCodes: ["effect.changed"],
    });
  });

  it("keeps a dispatch-root execution mismatch inconclusive", () => {
    const evidence = makePlanOutcomeEvidence();
    evidence.dispatchBatch.items[0]!.executionId = "execution-other";
    expect(evaluateMissionStrategyPlanOutcome(evidence)).toMatchObject({
      outcome: "INCONCLUSIVE",
      limitationCodes: expect.arrayContaining(["dispatch_root_execution_incomplete"]),
    });
  });

  it("does not conflate the failed source Goal with successor Goal identities", () => {
    const evidence = makePlanOutcomeEvidence();
    evidence.plan.sourceGoalId = "different-source-goal";
    expect(evaluateMissionStrategyPlanOutcome(evidence)).toMatchObject({
      outcome: "INCONCLUSIVE",
      limitationCodes: expect.arrayContaining(["plan_identity_mismatch"]),
    });
  });

  it("does not trust an achieved label without its Canonical Proof bindings", () => {
    const evidence = makePlanOutcomeEvidence();
    evidence.executions[0]!.canonicalProofId = null;
    evidence.executions[0]!.canonicalProofHash = null;
    expect(evaluateMissionStrategyPlanOutcome(evidence)).toMatchObject({
      outcome: "INCONCLUSIVE",
      limitationCodes: expect.arrayContaining(["execution_proof_binding_missing"]),
    });
  });

  it("requires the persisted lifecycle pointers to match the selected plan and dispatch batch", () => {
    const evidence = makePlanOutcomeEvidence();
    evidence.persistedLifecycle[4]!.referenceId = "different-batch";
    expect(evaluateMissionStrategyPlanOutcome(evidence)).toMatchObject({
      outcome: "INCONCLUSIVE",
      limitationCodes: expect.arrayContaining([
        "lifecycle_not_at_dispatch_boundary",
        "lifecycle_reference_mismatch",
      ]),
    });
  });
});
