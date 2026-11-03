import { describe, expect, it } from "vitest";
import {
  MISSION_DECISION_SCHEMA_VERSION,
  MissionDecisionContextSchema,
  MissionStrategyAlternativeSchema,
  type MissionDecisionContext,
  type MissionStrategyAlternative,
} from "./mission-decision-contract.js";
import {
  compareMissionStrategyAlternatives,
  generateMissionStrategyAlternatives,
} from "./mission-strategy-generation.js";

const unknownConfidence = { status: "unknown", value: null, calibrationRef: null } as const;
const contentHash = "a".repeat(64);

function evidence(
  evidenceId: string,
  kind: "acceptance" | "validation" | "world_transition",
): MissionDecisionContext["evidenceRefs"][number] {
  return {
    evidenceId,
    kind,
    knowledgeClass: "SERVER_DERIVED",
    provenanceCode: `${kind}_receipt`,
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
    contentHash,
  };
}

function contextFor(scenario: "runtime_start_recovery" | "validator_recovery"): MissionDecisionContext {
  const evidenceRefs = scenario === "runtime_start_recovery"
    ? [evidence("acceptance-1", "acceptance"), evidence("transition-1", "world_transition")]
    : [evidence("acceptance-1", "acceptance"), evidence("validation-1", "validation")];
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
    objectiveCode: scenario === "runtime_start_recovery"
      ? "reconcile_runtime_state_before_any_retry"
      : "repair_validator_failure",
    capturedAt: "2026-11-03T10:00:01.000Z",
    failureDiagnoses: [{
      kind: scenario === "runtime_start_recovery" ? "expected_effect_missing" : "validation_failure",
      code: scenario === "runtime_start_recovery" ? "runtime_effect_not_observed" : "validator_failed",
      knowledgeClass: "SERVER_DERIVED",
      evidenceIds: [scenario === "runtime_start_recovery" ? "transition-1" : "validation-1"],
      confidence: unknownConfidence,
    }],
    rootCauseHypotheses: [],
    evidenceRefs,
    authorization: { status: "allowed", policyRef: "policy-1", reasonCodes: [] },
    approval: {
      status: "not_required",
      approvalRef: null,
      approvedStrategyId: null,
      approvedStrategyHash: null,
      approvedPlanRevision: null,
    },
    preconditionFindings: [],
    availableCapabilities: ["repository.read", "runtime.status.read", "world_state.transition.read"],
    unavailableCapabilities: [],
    unknownCapabilities: [],
    unresolvedQuestionCodes: [],
    requiredObservationCodes: [],
  });
}

function baseline(strategyId = "original-plan"): MissionStrategyAlternative {
  return MissionStrategyAlternativeSchema.parse({
    schemaVersion: MISSION_DECISION_SCHEMA_VERSION,
    strategyId,
    version: 1,
    category: "baseline",
    source: "existing_plan",
    candidateRef: null,
    intendedObjectiveCode: "complete_goal",
    requiredCapabilities: ["task.execute"],
    requiredEvidenceKinds: ["acceptance"],
    preconditionCodes: ["source_execution_bound"],
    expectedActions: [{
      planStepId: "original.execute",
      capabilityId: "task.execute",
      effectClass: "unknown",
    }],
    expectedObservationCodes: ["goal_result"],
    expectedEffectCodes: ["goal_accepted"],
    validationProcedureCodes: ["canonical_acceptance"],
    stepDependencies: [{ stepId: "original.execute", dependsOnStepIds: [] }],
    resourceEstimate: { status: "unknown", value: null, unit: "none", confidence: unknownConfidence, evidenceRefIds: [] },
    durationEstimate: { status: "unknown", value: null, unit: "none", confidence: unknownConfidence, evidenceRefIds: [] },
    expectedExecutionCost: { status: "unknown", value: null, unit: "none", confidence: unknownConfidence, evidenceRefIds: [] },
    risk: "unknown",
    reversibility: "unknown",
    failureModeCodes: [],
    approvalRequirement: "unknown",
    assumptionCodes: [],
    limitationCodes: [],
  });
}

describe("Mission strategy generation and semantic differentiation", () => {
  it("generates two distinct, read-only runtime evidence orders without selecting or dispatching", () => {
    const result = generateMissionStrategyAlternatives({
      scenario: "runtime_start_recovery",
      context: contextFor("runtime_start_recovery"),
      originalStrategy: baseline(),
    });
    expect(result.status).toBe("generated");
    if (result.status !== "generated") return;
    const statusFirst = result.alternatives.find(({ strategyId }) =>
      strategyId === "runtime.verify-status-first.v1");
    const transitionFirst = result.alternatives.find(({ strategyId }) =>
      strategyId === "runtime.verify-transition-first.v1");
    expect(statusFirst?.expectedActions.map(({ capabilityId }) => capabilityId)).toEqual([
      "runtime.status.read",
      "world_state.transition.read",
    ]);
    expect(transitionFirst?.expectedActions.map(({ capabilityId }) => capabilityId)).toEqual([
      "world_state.transition.read",
      "runtime.status.read",
    ]);
    expect(result.genuinelyDifferentPairs).toContainEqual({
      leftStrategyId: "runtime.verify-status-first.v1",
      rightStrategyId: "runtime.verify-transition-first.v1",
    });
    expect(result.alternatives
      .filter(({ strategyId }) => strategyId.startsWith("runtime.verify-"))
      .flatMap(({ expectedActions }) => expectedActions)
      .every(({ effectClass }) => effectClass === "read_only")).toBe(true);
    expect("selectedStrategyId" in result).toBe(false);
  });

  it("requires current, execution-bound validation evidence and a bound affected scope", () => {
    const context = contextFor("validator_recovery");
    const validInput = {
      scenario: "validator_recovery" as const,
      context,
      originalStrategy: baseline(),
      affectedScope: { pathCount: 2, claimCount: 1, sourceEvidenceId: "validation-1" },
    };
    expect(generateMissionStrategyAlternatives(validInput).status).toBe("generated");
    expect(generateMissionStrategyAlternatives({
      ...validInput,
      affectedScope: { ...validInput.affectedScope, sourceEvidenceId: "unrelated-evidence" },
    })).toEqual({ status: "blocked", reasonCode: "validator_scope_evidence_unbound" });
  });

  it("generates targeted repair and reconstruct-then-repair only for broad or multi-claim scope", () => {
    const context = contextFor("validator_recovery");
    const narrow = generateMissionStrategyAlternatives({
      scenario: "validator_recovery",
      context,
      originalStrategy: baseline(),
      affectedScope: { pathCount: 2, claimCount: 1, sourceEvidenceId: "validation-1" },
    });
    const broad = generateMissionStrategyAlternatives({
      scenario: "validator_recovery",
      context,
      originalStrategy: baseline(),
      affectedScope: { pathCount: 2, claimCount: 2, sourceEvidenceId: "validation-1" },
    });
    expect(narrow.status).toBe("generated");
    if (narrow.status === "generated") {
      expect(narrow.alternatives.map(({ strategyId }) => strategyId))
        .not.toContain("validator.reconstruct-then-repair.v1");
      expect(narrow.alternatives.find(({ strategyId }) =>
        strategyId === "validator.targeted-repair.v1")?.approvalRequirement).toBe("required");
    }
    expect(broad.status).toBe("generated");
    if (broad.status === "generated") {
      expect(broad.alternatives.map(({ strategyId }) => strategyId))
        .toContain("validator.reconstruct-then-repair.v1");
      expect(broad.genuinelyDifferentPairs.length).toBeGreaterThan(0);
    }
  });

  it("returns no meaningful alternative when a generated plan is only renamed", () => {
    const context = contextFor("validator_recovery");
    const generated = generateMissionStrategyAlternatives({
      scenario: "validator_recovery",
      context,
      originalStrategy: baseline(),
      affectedScope: { pathCount: 1, claimCount: 1, sourceEvidenceId: "validation-1" },
    });
    expect(generated.status).toBe("generated");
    if (generated.status !== "generated") return;
    const targeted = generated.alternatives.find(({ strategyId }) =>
      strategyId === "validator.targeted-repair.v1")!;
    const renamedTarget = MissionStrategyAlternativeSchema.parse({
      ...targeted,
      strategyId: "original-plan",
      source: "existing_plan",
    });
    const duplicateOnly = generateMissionStrategyAlternatives({
      scenario: "validator_recovery",
      context,
      originalStrategy: renamedTarget,
      affectedScope: { pathCount: 1, claimCount: 1, sourceEvidenceId: "validation-1" },
    });
    expect(duplicateOnly.status).toBe("no_meaningful_alternative_available");
    if (duplicateOnly.status === "no_meaningful_alternative_available") {
      expect(duplicateOnly.differences).toHaveLength(1);
      expect(duplicateOnly.differences[0]?.classification).toBe("SEMANTICALLY_EQUIVALENT");
    }
  });

  it("blocks unsupported families and runtime recovery without bound transition evidence", () => {
    const runtimeContext = contextFor("runtime_start_recovery");
    expect(generateMissionStrategyAlternatives({
      scenario: "runtime_start_recovery",
      context: MissionDecisionContextSchema.parse({
        ...runtimeContext,
        evidenceRefs: runtimeContext.evidenceRefs.filter(({ kind }) => kind === "acceptance"),
        failureDiagnoses: [{
          ...runtimeContext.failureDiagnoses[0]!,
          evidenceIds: ["acceptance-1"],
        }],
      }),
      originalStrategy: baseline(),
    })).toEqual({ status: "blocked", reasonCode: "runtime_evidence_missing" });
    expect(generateMissionStrategyAlternatives({ scenario: "unsupported" })).toEqual({
      status: "blocked",
      reasonCode: "invalid_input",
    });
  });

  it("compares semantic action order and ignores strategy IDs", () => {
    const left = MissionStrategyAlternativeSchema.parse({
      ...baseline("left"),
      requiredCapabilities: ["read.one", "read.two"],
      expectedActions: [
        { planStepId: "a", capabilityId: "read.one", effectClass: "read_only" },
        { planStepId: "b", capabilityId: "read.two", effectClass: "read_only" },
      ],
      stepDependencies: [
        { stepId: "a", dependsOnStepIds: [] },
        { stepId: "b", dependsOnStepIds: ["a"] },
      ],
    });
    const right = MissionStrategyAlternativeSchema.parse({
      ...left,
      strategyId: "right",
      expectedActions: [...left.expectedActions].reverse(),
      stepDependencies: [
        { stepId: "b", dependsOnStepIds: [] },
        { stepId: "a", dependsOnStepIds: [] },
      ],
    });
    expect(compareMissionStrategyAlternatives(left, right)).toMatchObject({
      classification: "GENUINELY_DIFFERENT",
      changedDimensions: expect.arrayContaining(["action_sequence", "dependency_structure"]),
    });
  });
});
