import { describe, expect, it } from "vitest";
import {
  MISSION_DECISION_SCHEMA_VERSION,
  MissionDecisionContextSchema,
  MissionStrategyAlternativeSchema,
  type MissionDecisionContext,
  type MissionStrategyAlternative,
} from "./mission-decision-contract.js";
import {
  evaluateMissionStrategies,
  MISSION_STRATEGY_EVALUATOR_VERSION,
} from "./mission-strategy-evaluation.js";

const unknownConfidence = { status: "unknown" as const, value: null, calibrationRef: null };

function evidence(evidenceId: string, kind: "acceptance" | "observation"): MissionDecisionContext["evidenceRefs"][number] {
  return {
    evidenceId,
    kind,
    knowledgeClass: "SERVER_DERIVED",
    provenanceCode: kind === "acceptance" ? "canonical_acceptance" : "world_state_revision_observation",
    scope: {
      projectId: "project-1",
      missionId: "mission-1",
      goalId: "goal-1",
      executionId: "execution-1",
      attempt: 2,
    },
    timestamp: "2026-11-03T10:00:00.000Z",
    freshness: "fresh",
    revisions: {
      project: "project-revision-1",
      worldState: "world-revision-1",
      environment: "environment-revision-1",
    },
    confidence: unknownConfidence,
    eligibility: "eligible",
    eligibilityReasonCodes: [],
    contentHash: "b".repeat(64),
  };
}

function context(overrides: Record<string, unknown> = {}): MissionDecisionContext {
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
      priorPlanRevision: "plan-revision-1",
      projectRevision: "project-revision-1",
      worldStateRevision: "world-revision-1",
      environmentRevision: "environment-revision-1",
    },
    objectiveCode: "recover_current_goal",
    capturedAt: "2026-11-03T10:00:01.000Z",
    failureDiagnoses: [{
      kind: "expected_effect_missing",
      code: "effect_not_observed",
      knowledgeClass: "SERVER_DERIVED",
      evidenceIds: ["acceptance-1"],
      confidence: unknownConfidence,
    }],
    rootCauseHypotheses: [],
    evidenceRefs: [evidence("acceptance-1", "acceptance"), evidence("world-1", "observation")],
    authorization: { status: "allowed", policyRef: "authorization-policy-1", reasonCodes: [] },
    approval: {
      status: "not_required",
      approvalRef: null,
      approvedStrategyId: null,
      approvedStrategyHash: null,
      approvedPlanRevision: null,
    },
    preconditionFindings: [
      { code: "source_execution_attempt_bound", status: "satisfied", evidenceRefIds: ["acceptance-1"] },
      { code: "world_state_revision_matches", status: "satisfied", evidenceRefIds: ["world-1"] },
    ],
    availableCapabilities: ["tool.read.one", "tool.read.two"],
    unavailableCapabilities: [],
    unknownCapabilities: [],
    unresolvedQuestionCodes: [],
    requiredObservationCodes: [],
    ...overrides,
  });
}

function strategy(
  strategyId: string,
  overrides: Partial<MissionStrategyAlternative> = {},
): MissionStrategyAlternative {
  return MissionStrategyAlternativeSchema.parse({
    schemaVersion: MISSION_DECISION_SCHEMA_VERSION,
    strategyId,
    version: 1,
    category: "verify_then_retry",
    source: "server_rule",
    candidateRef: null,
    intendedObjectiveCode: "recover_current_goal",
    requiredCapabilities: ["tool.read.one"],
    requiredEvidenceKinds: ["acceptance"],
    preconditionCodes: ["source_execution_attempt_bound", "world_state_revision_matches"],
    expectedActions: [{ planStepId: "inspect", capabilityId: "tool.read.one", effectClass: "read_only" }],
    expectedObservationCodes: ["runtime_status"],
    expectedEffectCodes: ["goal_accepted"],
    validationProcedureCodes: ["canonical_acceptance"],
    stepDependencies: [{ stepId: "inspect", dependsOnStepIds: [] }],
    resourceEstimate: { status: "unknown", value: null, unit: "none", confidence: unknownConfidence, evidenceRefIds: [] },
    durationEstimate: { status: "unknown", value: null, unit: "none", confidence: unknownConfidence, evidenceRefIds: [] },
    expectedExecutionCost: { status: "unknown", value: null, unit: "none", confidence: unknownConfidence, evidenceRefIds: [] },
    risk: "low",
    reversibility: "reversible",
    failureModeCodes: [],
    approvalRequirement: "not_required",
    assumptionCodes: [],
    limitationCodes: [],
    ...overrides,
  });
}

describe("deterministic Mission strategy evaluation", () => {
  it("selects a unique Pareto dominator without a weighted score or model success probability", () => {
    const result = evaluateMissionStrategies({
      context: context(),
      alternatives: [
        strategy("a-low-risk"),
        strategy("b-medium-risk", {
          category: "refresh_and_replan",
          expectedActions: [{ planStepId: "inspect", capabilityId: "tool.read.two", effectClass: "read_only" }],
          requiredCapabilities: ["tool.read.two"],
          expectedObservationCodes: ["transition_provenance"],
          risk: "medium",
        }),
      ],
      evaluatedAt: "2026-11-03T10:01:00.000Z",
    });

    expect(result.policyVersion).toBe(MISSION_STRATEGY_EVALUATOR_VERSION);
    expect(result.result).toEqual(expect.objectContaining({ kind: "SELECTED", selectedStrategyId: "a-low-risk" }));
    expect(result.pairwiseComparisons[0]?.relation).toBe("left_dominates");
    expect(result.evaluations.every(({ rankingScore }) => rankingScore === null)).toBe(true);
    for (const evaluation of result.evaluations) {
      expect(evaluation.dimensions.find(({ dimension }) => dimension === "expected_success_probability"))
        .toEqual(expect.objectContaining({ status: "unknown", normalizedValue: null, source: "unknown" }));
      expect(evaluation.dimensions.find(({ dimension }) => dimension === "expected_execution_cost"))
        .toEqual(expect.objectContaining({ status: "unknown", normalizedValue: null }));
    }
  });

  it("returns NO_DECISION when a potentially better alternative has unknown capability status", () => {
    const result = evaluateMissionStrategies({
      context: context(),
      alternatives: [
        strategy("a-unknown-capability", {
          expectedActions: [{ planStepId: "inspect", capabilityId: "tool.not_verified", effectClass: "read_only" }],
          requiredCapabilities: ["tool.not_verified"],
        }),
        strategy("b-known-capability", {
          category: "refresh_and_replan",
          expectedActions: [{ planStepId: "inspect", capabilityId: "tool.read.two", effectClass: "read_only" }],
          requiredCapabilities: ["tool.read.two"],
          expectedObservationCodes: ["transition_provenance"],
          risk: "medium",
        }),
      ],
      evaluatedAt: "2026-11-03T10:01:00.000Z",
    });

    expect(result.result).toEqual({
      kind: "NO_DECISION",
      selectedStrategyId: null,
      reasonCode: "evaluation_inconclusive",
    });
    expect(result.evaluations.find(({ strategyId }) => strategyId === "a-unknown-capability")?.eligibility)
      .toBe("unknown");
  });

  it("blocks an approval-gated mutation until the approval receipt exists", () => {
    const gated = strategy("a-gated-mutation", {
      category: "alternative_implementation",
      requiredCapabilities: ["tool.read.one"],
      expectedActions: [{ planStepId: "write", capabilityId: "tool.read.one", effectClass: "reversible_mutation" }],
      stepDependencies: [{ stepId: "write", dependsOnStepIds: [] }],
      risk: "medium",
      reversibility: "reversible",
      approvalRequirement: "required",
    });
    const alternate = strategy("b-read-only", {
      category: "refresh_and_replan",
      expectedActions: [{ planStepId: "inspect", capabilityId: "tool.read.two", effectClass: "read_only" }],
      requiredCapabilities: ["tool.read.two"],
      expectedObservationCodes: ["transition_provenance"],
      risk: "medium",
    });
    const result = evaluateMissionStrategies({
      context: context({
        approval: {
          status: "required",
          approvalRef: null,
          approvedStrategyId: null,
          approvedStrategyHash: null,
          approvedPlanRevision: null,
        },
      }),
      alternatives: [gated, alternate],
      evaluatedAt: "2026-11-03T10:01:00.000Z",
    });
    expect(result.result).toEqual({
      kind: "BLOCKED",
      selectedStrategyId: null,
      reasonCode: "approval_required",
    });
  });

  it("does not reuse an approval granted for another strategy or plan revision", () => {
    const gated = strategy("a-gated-mutation", {
      category: "alternative_implementation",
      expectedActions: [{ planStepId: "write", capabilityId: "tool.read.one", effectClass: "reversible_mutation" }],
      stepDependencies: [{ stepId: "write", dependsOnStepIds: [] }],
      risk: "medium",
      approvalRequirement: "required",
    });
    const alternate = strategy("b-read-only", {
      category: "refresh_and_replan",
      expectedActions: [{ planStepId: "inspect", capabilityId: "tool.read.two", effectClass: "read_only" }],
      requiredCapabilities: ["tool.read.two"],
      expectedObservationCodes: ["transition_provenance"],
      risk: "medium",
    });
    const result = evaluateMissionStrategies({
      context: context({
        approval: {
          status: "granted",
          approvalRef: "approval-for-another-plan",
          approvedStrategyId: "different-strategy",
          approvedStrategyHash: "c".repeat(64),
          approvedPlanRevision: "stale-plan-revision",
        },
      }),
      alternatives: [gated, alternate],
      evaluatedAt: "2026-11-03T10:01:00.000Z",
    });
    expect(result.result).toEqual(expect.objectContaining({ kind: "SELECTED", selectedStrategyId: "b-read-only" }));
    expect(result.evaluations.find(({ strategyId }) => strategyId === "a-gated-mutation")?.hardConstraints)
      .toContainEqual(expect.objectContaining({
        constraintCode: "approval",
        result: "rejected",
        reasonCodes: ["approval_binding_mismatch"],
      }));
  });

  it("does not let an unsafe high-risk strategy win on other dimensions", () => {
    const result = evaluateMissionStrategies({
      context: context(),
      alternatives: [
        strategy("a-low-risk"),
        strategy("b-high-risk", {
          category: "refresh_and_replan",
          expectedActions: [{ planStepId: "inspect", capabilityId: "tool.read.two", effectClass: "read_only" }],
          requiredCapabilities: ["tool.read.two"],
          expectedObservationCodes: ["transition_provenance"],
          risk: "high",
        }),
      ],
      evaluatedAt: "2026-11-03T10:01:00.000Z",
    });
    expect(result.result).toEqual(expect.objectContaining({ kind: "SELECTED", selectedStrategyId: "a-low-risk" }));
    expect(result.evaluations.find(({ strategyId }) => strategyId === "b-high-risk")?.eligibility)
      .toBe("ineligible");
  });

  it("uses only measured, evidence-bound cost estimates and normalizes them within the compared cohort", () => {
    const result = evaluateMissionStrategies({
      context: context(),
      alternatives: [
        strategy("a-cheaper", {
          expectedExecutionCost: {
            status: "measured",
            value: 1,
            unit: "tokens",
            confidence: unknownConfidence,
            evidenceRefIds: ["acceptance-1"],
          },
        }),
        strategy("b-costlier", {
          category: "refresh_and_replan",
          expectedActions: [{ planStepId: "inspect", capabilityId: "tool.read.two", effectClass: "read_only" }],
          requiredCapabilities: ["tool.read.two"],
          expectedObservationCodes: ["transition_provenance"],
          expectedExecutionCost: {
            status: "measured",
            value: 2,
            unit: "tokens",
            confidence: unknownConfidence,
            evidenceRefIds: ["acceptance-1"],
          },
        }),
      ],
      evaluatedAt: "2026-11-03T10:01:00.000Z",
    });
    const cheaperCost = result.evaluations.find(({ strategyId }) => strategyId === "a-cheaper")
      ?.dimensions.find(({ dimension }) => dimension === "expected_execution_cost");
    const costlierCost = result.evaluations.find(({ strategyId }) => strategyId === "b-costlier")
      ?.dimensions.find(({ dimension }) => dimension === "expected_execution_cost");
    expect(cheaperCost).toEqual(expect.objectContaining({ status: "measured", normalizedValue: 1, source: "measured_resource" }));
    expect(costlierCost).toEqual(expect.objectContaining({ status: "measured", normalizedValue: 0, source: "measured_resource" }));
    expect(result.result).toEqual(expect.objectContaining({ kind: "SELECTED", selectedStrategyId: "a-cheaper" }));
  });

  it("returns NO_DECISION for semantically equivalent strategies instead of using IDs as a tie-break", () => {
    const result = evaluateMissionStrategies({
      context: context(),
      alternatives: [
        strategy("a-id"),
        strategy("z-id"),
      ],
      evaluatedAt: "2026-11-03T10:01:00.000Z",
    });
    expect(result.result).toEqual({
      kind: "NO_DECISION",
      selectedStrategyId: null,
      reasonCode: "no_meaningful_alternative",
    });
  });

  it("does not substitute missing hard evidence or unresolved contradictions with scores", () => {
    const result = evaluateMissionStrategies({
      context: context({
        failureDiagnoses: [{
          kind: "contradictory_observations",
          code: "world_state_conflict",
          knowledgeClass: "SERVER_DERIVED",
          evidenceIds: ["world-1"],
          confidence: unknownConfidence,
        }],
        unresolvedQuestionCodes: ["which_world_revision_is_current"],
      }),
      alternatives: [
        strategy("a-low-risk"),
        strategy("b-medium-risk", {
          category: "refresh_and_replan",
          expectedActions: [{ planStepId: "inspect", capabilityId: "tool.read.two", effectClass: "read_only" }],
          requiredCapabilities: ["tool.read.two"],
          expectedObservationCodes: ["transition_provenance"],
          risk: "medium",
        }),
      ],
      evaluatedAt: "2026-11-03T10:01:00.000Z",
    });
    expect(result.result).toEqual({
      kind: "NO_DECISION",
      selectedStrategyId: null,
      reasonCode: "insufficient_evidence",
    });
  });
});
