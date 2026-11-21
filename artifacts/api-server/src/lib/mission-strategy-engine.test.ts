import { describe, expect, it } from "vitest";
import type {
  GeneralTaskPlan,
  GeneralTaskPlanStep,
  MissionPlanPreview,
} from "@workspace/ai-orchestrator";
import { diagnoseRuntimeStartWorldStateFailure } from "./world-state-failure-diagnosis.js";
import { selectAndApplyMissionStrategy } from "./mission-strategy-engine.js";

function planPreview(
  steps: GeneralTaskPlanStep[],
  transitionRequirements?: GeneralTaskPlan["transitionRequirements"],
): MissionPlanPreview {
  const objective = "Repair the project and verify the result.";
  const plan: GeneralTaskPlan = {
    version: 1,
    objective,
    turnKind: "DELIVERY",
    executionTaskType: "task_execution",
    profile: "default",
    decision: "CREATE",
    source: "new",
    planHash: "source-plan-hash",
    steps,
    ...(transitionRequirements ? { transitionRequirements } : {}),
    conflicts: [],
    skipQueryPlanner: false,
  };
  return {
    version: 1,
    objective,
    admission: "mission",
    admissionReason: "multi_step_or_mutating_objective",
    turnIntent: {
      kind: "DELIVERY",
      executionTaskType: "task_execution",
      requiresTools: true,
      requiresEvidence: true,
      allowsBuildHandoff: false,
      compoundExecution: true,
      compoundWrite: true,
      phases: ["proposal", "execution", "validation"],
    },
    plan,
  };
}

function runtimePreview(): MissionPlanPreview {
  return planPreview([
    {
      id: "runtime-start",
      title: "Start the workspace runtime",
      kind: "execute",
      dependencies: [],
      files: [],
      readOnly: false,
      approvalRequired: false,
      recipe: { recipeId: "runtime.start", recipeVersion: 1 },
    },
    {
      id: "deliver",
      title: "Verify the started runtime",
      kind: "validate",
      dependencies: ["runtime-start"],
      files: [],
      readOnly: true,
      approvalRequired: false,
    },
  ], [{
    kind: "runtime.start",
    version: 1,
    sourceStepId: "runtime-start",
    targetStepId: "deliver",
    from: "stopped",
    to: "running",
  }]);
}

function runtimePreviewWithExistingInspection(
  overrides: Partial<GeneralTaskPlanStep> = {},
): MissionPlanPreview {
  const preview = runtimePreview();
  const inspection: GeneralTaskPlanStep = {
    id: "existing-inspect",
    title: "Inspect the existing workspace",
    objective: "Inspect the workspace state before retrying runtime startup.",
    kind: "inspect",
    dependencies: [],
    files: ["runtime.config"],
    readOnly: true,
    approvalRequired: false,
    ...overrides,
  };
  return {
    ...preview,
    plan: {
      ...preview.plan,
      steps: [inspection, ...preview.plan.steps],
    },
  };
}

function validatorPreview(): MissionPlanPreview {
  return planPreview([
    {
      id: "inspect",
      title: "Inspect the project",
      kind: "inspect",
      dependencies: [],
      files: [],
      readOnly: true,
      approvalRequired: false,
    },
    {
      id: "execute",
      title: "Execute the approved change plan",
      kind: "execute",
      dependencies: ["inspect"],
      files: [],
      readOnly: false,
      approvalRequired: true,
    },
    {
      id: "validate",
      title: "Validate the resulting workspace",
      kind: "validate",
      dependencies: ["execute"],
      files: [],
      readOnly: true,
      approvalRequired: false,
    },
    {
      id: "deliver",
      title: "Deliver the verified result",
      kind: "deliver",
      dependencies: ["validate"],
      files: [],
      readOnly: true,
      approvalRequired: false,
    },
  ]);
}

const sourceIdentity = {
  missionId: "mission-1",
  failedGoalId: "goal-1",
  priorPlanRevision: "prior-revision-1",
};

const runtimeTransition = {
  id: "transition-1",
  executionId: "execution-1",
  attempt: 2,
  episodeId: "episode-1",
  actionId: "runtime-start",
  status: "materialized" as const,
  parentWorldRevision: "world-2",
  resultingWorldRevision: "world-3",
  environmentRevision: "environment-revision",
};

describe("Mission recovery strategy engine", () => {
  it("compares distinct runtime recovery orders and binds the selected preflight to runtime.start", () => {
    const result = selectAndApplyMissionStrategy({
      preview: runtimePreview(),
      ...sourceIdentity,
      worldStateFailureDiagnosis: diagnoseRuntimeStartWorldStateFailure({
        reasonCode: "runtime_status_missing",
        transition: runtimeTransition,
        supportingObservationIds: ["observation-1"],
      }),
      runtimeStartTargetStepId: "deliver",
      runtimeSourceBinding: {
        acceptanceId: "acceptance-1",
        executionId: runtimeTransition.executionId,
        episodeId: runtimeTransition.episodeId,
        attempt: runtimeTransition.attempt,
        transitionId: runtimeTransition.id,
      },
      evidenceRefs: ["world-transition:transition-1", "observation:status-1"],
      affectedPaths: [],
      affectedClaims: [],
    });

    expect(result.status).toBe("selected");
    if (result.status !== "selected") return;
    expect(result.decision.scenario).toBe("runtime_start_recovery");
    expect(result.decision.candidates.map((candidate) => candidate.strategyId)).toEqual([
      "runtime.direct-status-first",
      "runtime.transition-provenance-first",
    ]);
    expect(result.decision.candidates[0]?.utilityScore)
      .toBeGreaterThan(result.decision.candidates[1]?.utilityScore ?? 0);
    expect(result.decision.selectedStrategyId).toBe("runtime.direct-status-first");
    expect(result.decision.candidatePlanProjections).toHaveLength(2);
    expect(result.decision.candidatePlanProjections[0]?.expectedObservationCodes)
      .not.toEqual(result.decision.candidatePlanProjections[1]?.expectedObservationCodes);
    expect(result.decision.candidatePlanProjections[0]?.actions.map(({ stepId }) => stepId))
      .toEqual(result.decision.candidatePlanProjections[1]?.actions.map(({ stepId }) => stepId));
    expect(result.preview.plan.steps.map((step) => step.id)).toEqual([
      "strategy-runtime-preflight",
      "runtime-start",
      "deliver",
    ]);
    expect(result.preview.plan.steps[1]).toMatchObject({
      id: "runtime-start",
      dependencies: ["strategy-runtime-preflight"],
      recipe: { recipeId: "runtime.start", recipeVersion: 1 },
    });
    expect(result.preview.plan.transitionRequirements).toEqual([
      expect.objectContaining({ targetStepId: "deliver", sourceStepId: "runtime-start" }),
    ]);
    expect(result.preview.plan.planHash).not.toBe("source-plan-hash");
    expect(result.decision.source).toMatchObject({
      failedGoalId: "goal-1",
      priorPlanRevision: "prior-revision-1",
    });
  });

  it("reuses the last safe inspection before runtime.start instead of adding another Goal", () => {
    const result = selectAndApplyMissionStrategy({
      preview: runtimePreviewWithExistingInspection(),
      ...sourceIdentity,
      worldStateFailureDiagnosis: diagnoseRuntimeStartWorldStateFailure({
        reasonCode: "runtime_status_missing",
        transition: runtimeTransition,
        supportingObservationIds: ["observation-1"],
      }),
      runtimeStartTargetStepId: "deliver",
      runtimeSourceBinding: {
        acceptanceId: "acceptance-1",
        executionId: runtimeTransition.executionId,
        episodeId: runtimeTransition.episodeId,
        attempt: runtimeTransition.attempt,
        transitionId: runtimeTransition.id,
      },
      evidenceRefs: ["world-transition:transition-1", "observation:status-1"],
      affectedPaths: [],
      affectedClaims: [],
    });

    expect(result.status).toBe("selected");
    if (result.status !== "selected") return;
    expect(result.preview.plan.steps.map((step) => step.id)).toEqual([
      "existing-inspect",
      "runtime-start",
      "deliver",
    ]);
    expect(result.preview.plan.steps[0]).toMatchObject({
      id: "existing-inspect",
      kind: "inspect",
      readOnly: true,
      approvalRequired: false,
      files: ["runtime.config"],
    });
    expect(result.preview.plan.steps[0]?.objective).toContain(
      "Inspect the workspace state before retrying runtime startup.",
    );
    for (const code of result.decision.candidatePlanProjections[0]?.expectedObservationCodes ?? []) {
      expect(result.preview.plan.steps[0]?.objective).toContain(code);
    }
    expect(result.preview.plan.steps[1]?.dependencies).toContain("existing-inspect");
    expect(result.decision.planDelta.addedStepIds).toEqual([]);
    expect(result.decision.planDelta.changedStepIds).toEqual(["existing-inspect", "runtime-start"]);
    expect(result.decision.candidatePlanProjections[0]?.addedStepIds).toEqual([]);
  });

  it("keeps a dedicated runtime preflight when the existing inspection is not read-only", () => {
    const result = selectAndApplyMissionStrategy({
      preview: runtimePreviewWithExistingInspection({ readOnly: false }),
      ...sourceIdentity,
      worldStateFailureDiagnosis: diagnoseRuntimeStartWorldStateFailure({
        reasonCode: "runtime_status_missing",
        transition: runtimeTransition,
        supportingObservationIds: ["observation-1"],
      }),
      runtimeStartTargetStepId: "deliver",
      runtimeSourceBinding: {
        acceptanceId: "acceptance-1",
        executionId: runtimeTransition.executionId,
        episodeId: runtimeTransition.episodeId,
        attempt: runtimeTransition.attempt,
        transitionId: runtimeTransition.id,
      },
      evidenceRefs: ["world-transition:transition-1", "observation:status-1"],
      affectedPaths: [],
      affectedClaims: [],
    });

    expect(result.status).toBe("selected");
    if (result.status !== "selected") return;
    expect(result.preview.plan.steps.map((step) => step.id)).toEqual([
      "existing-inspect",
      "strategy-runtime-preflight",
      "runtime-start",
      "deliver",
    ]);
    expect(result.preview.plan.steps[0]?.readOnly).toBe(false);
    expect(result.preview.plan.steps[2]?.dependencies).toContain("strategy-runtime-preflight");
    expect(result.decision.planDelta.addedStepIds).toEqual(["strategy-runtime-preflight"]);
  });

  it("does not reuse an approval-gated inspection as runtime preflight", () => {
    const result = selectAndApplyMissionStrategy({
      preview: runtimePreviewWithExistingInspection({ approvalRequired: true }),
      ...sourceIdentity,
      worldStateFailureDiagnosis: diagnoseRuntimeStartWorldStateFailure({
        reasonCode: "runtime_status_missing",
        transition: runtimeTransition,
        supportingObservationIds: ["observation-1"],
      }),
      runtimeStartTargetStepId: "deliver",
      runtimeSourceBinding: {
        acceptanceId: "acceptance-1",
        executionId: runtimeTransition.executionId,
        episodeId: runtimeTransition.episodeId,
        attempt: runtimeTransition.attempt,
        transitionId: runtimeTransition.id,
      },
      evidenceRefs: ["world-transition:transition-1", "observation:status-1"],
      affectedPaths: [],
      affectedClaims: [],
    });

    expect(result.status).toBe("selected");
    if (result.status !== "selected") return;
    expect(result.preview.plan.steps.map((step) => step.id)).toEqual([
      "existing-inspect",
      "strategy-runtime-preflight",
      "runtime-start",
      "deliver",
    ]);
    expect(result.preview.plan.steps[0]?.approvalRequired).toBe(true);
    expect(result.preview.plan.steps[2]?.dependencies).toContain("strategy-runtime-preflight");
  });

  it("selects transition-provenance-first when the bound failure is a missing transition", () => {
    const result = selectAndApplyMissionStrategy({
      preview: runtimePreview(),
      ...sourceIdentity,
      worldStateFailureDiagnosis: diagnoseRuntimeStartWorldStateFailure({
        reasonCode: "accepted_transition_missing",
      }),
      runtimeStartTargetStepId: "deliver",
      runtimeSourceBinding: {
        acceptanceId: "acceptance-1",
        executionId: runtimeTransition.executionId,
        episodeId: runtimeTransition.episodeId,
        attempt: runtimeTransition.attempt,
      },
      evidenceRefs: ["world-transition:missing"],
      affectedPaths: [],
      affectedClaims: [],
    });

    expect(result.status).toBe("selected");
    if (result.status !== "selected") return;
    expect(result.decision.selectedStrategyId).toBe("runtime.transition-provenance-first");
    expect(result.decision.candidates.every((candidate) => candidate.eligible)).toBe(true);
    expect(result.preview.plan.steps[0]?.objective).toContain("world_transition:materialization");
  });

  it("blocks runtime selection when both eligible candidates produce the same evidence plan", () => {
    const diagnosis = diagnoseRuntimeStartWorldStateFailure({
      reasonCode: "accepted_transition_missing",
    });
    const result = selectAndApplyMissionStrategy({
      preview: runtimePreview(),
      ...sourceIdentity,
      worldStateFailureDiagnosis: {
        ...diagnosis,
        failureDiagnosis: {
          ...diagnosis.failureDiagnosis,
          requiredObservations: ["world_transition:materialization"],
        },
        distinguishingObservationCodes: ["world_transition:materialization"],
      },
      runtimeStartTargetStepId: "deliver",
      runtimeSourceBinding: {
        acceptanceId: "acceptance-1",
        executionId: runtimeTransition.executionId,
        episodeId: runtimeTransition.episodeId,
        attempt: runtimeTransition.attempt,
      },
      evidenceRefs: ["world-transition:missing"],
      affectedPaths: [],
      affectedClaims: [],
    });

    expect(result).toEqual({
      status: "blocked",
      reason: "runtime_no_meaningful_alternative",
    });
  });

  it("builds a targeted code-repair plan from validator evidence without weakening approval", () => {
    const result = selectAndApplyMissionStrategy({
      preview: validatorPreview(),
      ...sourceIdentity,
      failureDiagnosis: {
        kind: "VALIDATOR_FAILED",
        reasonCode: "VALIDATOR_FAILED",
        nextActionCode: "REPAIR_AND_REVALIDATE",
        retryable: true,
        requiresApproval: false,
      },
      evidenceRefs: ["validation:run-12"],
      affectedPaths: ["src/auth/session.ts"],
      affectedClaims: ["claim:session-refresh"],
      worldStatePlanningRead: undefined,
    });

    expect(result.status).toBe("selected");
    if (result.status !== "selected") return;
    expect(result.decision.scenario).toBe("validator_recovery");
    expect(result.decision.selectedStrategyId).toBe("code.targeted-repair");
    expect(result.decision.candidates).toHaveLength(2);
    const targetedProjection = result.decision.candidatePlanProjections.find(
      ({ strategyId }) => strategyId === "code.targeted-repair",
    );
    const reconstructProjection = result.decision.candidatePlanProjections.find(
      ({ strategyId }) => strategyId === "code.reconstruct-then-repair",
    );
    expect(targetedProjection?.orderedStepIds).not.toEqual(reconstructProjection?.orderedStepIds);
    expect(targetedProjection?.actions.find(({ stepId }) => stepId === "strategy-validator-scope")?.kind)
      .toBe("inspect");
    expect(reconstructProjection?.actions.find(({ stepId }) => stepId === "strategy-validator-reconstruction")?.kind)
      .toBe("analyze");
    expect(result.preview.plan.steps.map((step) => step.id)).toEqual([
      "inspect",
      "strategy-validator-scope",
      "execute",
      "validate",
      "deliver",
    ]);
    expect(result.preview.plan.steps.find((step) => step.id === "execute")).toMatchObject({
      files: ["src/auth/session.ts"],
      dependencies: ["inspect", "strategy-validator-scope"],
      approvalRequired: true,
    });
    expect(result.preview.plan.steps.find((step) => step.id === "validate")?.dependencies)
      .toContain("execute");
    expect(result.decision.source.evidenceRefs).toEqual(["validation:run-12"]);
  });

  it("uses evidence reconstruction for broad multi-claim validator failures", () => {
    const affectedPaths = [
      "src/auth/a.ts",
      "src/auth/b.ts",
      "src/auth/c.ts",
      "src/auth/d.ts",
      "src/auth/e.ts",
    ];
    const result = selectAndApplyMissionStrategy({
      preview: validatorPreview(),
      ...sourceIdentity,
      failureDiagnosis: {
        kind: "VALIDATOR_FAILED",
        reasonCode: "VALIDATOR_FAILED",
        nextActionCode: "REPAIR_AND_REVALIDATE",
        retryable: true,
        requiresApproval: false,
      },
      evidenceRefs: ["test:run-18"],
      affectedPaths,
      affectedClaims: ["claim:a", "claim:b"],
    });

    expect(result.status).toBe("selected");
    if (result.status !== "selected") return;
    expect(result.decision.selectedStrategyId).toBe("code.reconstruct-then-repair");
    expect(result.preview.plan.steps.map((step) => step.id)).toEqual([
      "inspect",
      "strategy-validator-reconstruction",
      "execute",
      "validate",
      "deliver",
    ]);
    expect(result.preview.plan.steps.find((step) => step.id === "validate")).toMatchObject({
      title: "Re-run the validator against the reconstructed failure scope",
      files: affectedPaths,
    });
  });

  it("blocks a validator repair when accepted validator evidence is absent", () => {
    const result = selectAndApplyMissionStrategy({
      preview: validatorPreview(),
      ...sourceIdentity,
      failureDiagnosis: {
        kind: "VALIDATOR_FAILED",
        reasonCode: "VALIDATOR_FAILED",
        nextActionCode: "REPAIR_AND_REVALIDATE",
        retryable: true,
        requiresApproval: false,
      },
      evidenceRefs: ["log:untrusted-provider-text"],
      affectedPaths: ["src/auth/session.ts"],
      affectedClaims: [],
    });

    expect(result).toEqual({ status: "blocked", reason: "validator_evidence_missing" });
  });
});
