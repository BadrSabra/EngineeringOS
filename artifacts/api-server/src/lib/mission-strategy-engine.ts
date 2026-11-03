import { createHash } from "node:crypto";
import {
  rehashGeneralTaskPlan,
  type GeneralTaskPlanStep,
  type MissionPlanPreview,
  type MissionWorldStatePlanningRead,
} from "@workspace/ai-orchestrator";
import {
  WorldStateFailureDiagnosisSchema,
  type WorldStateFailureDiagnosis,
} from "./world-state-failure-diagnosis.js";

const POLICY_VERSION = "mission-recovery-strategy-v1";
const MAX_STRATEGY_PATHS = 24;

type FailureSummary = {
  kind: string;
  reasonCode: string;
  nextActionCode: string;
  retryable: boolean;
  requiresApproval: boolean;
};

type CandidateEvaluation = {
  strategyId: string;
  eligible: boolean;
  utilityScore: number;
  criteria: {
    evidenceCoverage: number;
    diagnosisFit: number;
    extraReadOnlyGoals: number;
    mutationRequired: boolean;
  };
  reasonCode: string;
};

export type MissionStrategyDecision = {
  schemaVersion: 1;
  policyVersion: typeof POLICY_VERSION;
  decisionId: string;
  scenario: "runtime_start_recovery" | "validator_recovery";
  selectedStrategyId: string;
  source: {
    missionId: string;
    failedGoalId: string;
    priorPlanRevision: string;
    failureReasonCode: string;
    sourceAcceptanceId?: string;
    worldStatePlanningReadRevision?: string;
    sourceEpisodeId?: string;
    sourceExecutionId?: string;
    sourceAttempt?: number;
    transitionId?: string;
    evidenceRefs: string[];
  };
  candidates: CandidateEvaluation[];
  planDelta: {
    addedStepIds: string[];
    changedStepIds: string[];
    orderedStepIds: string[];
  };
};

export type RuntimeFailureSourceBinding = {
  acceptanceId: string;
  executionId: string;
  episodeId: string;
  attempt: number;
  transitionId?: string;
};

type StrategyInput = {
  preview: MissionPlanPreview;
  missionId: string;
  failedGoalId: string;
  priorPlanRevision: string;
  failureDiagnosis?: FailureSummary;
  worldStateFailureDiagnosis?: WorldStateFailureDiagnosis;
  runtimeStartTargetStepId?: string;
  runtimeSourceBinding?: RuntimeFailureSourceBinding;
  worldStatePlanningRead?: MissionWorldStatePlanningRead;
  evidenceRefs: string[];
  affectedPaths: string[];
  affectedClaims: string[];
};

export type MissionStrategySelection =
  | {
      status: "selected";
      preview: MissionPlanPreview & { strategyDecision: MissionStrategyDecision };
      decision: MissionStrategyDecision;
    }
  | {
      status: "not_applicable" | "blocked";
      reason:
        | "prior_revision_missing"
        | "runtime_transition_binding_missing"
        | "runtime_diagnosis_not_retryable"
        | "runtime_reason_unsupported"
        | "runtime_plan_step_missing"
        | "validator_diagnosis_not_retryable"
        | "validator_evidence_missing"
        | "validator_paths_invalid"
        | "validator_scope_too_broad"
        | "validator_plan_shape_unsupported"
        | "strategy_step_id_conflict";
    };

function stableHash(value: unknown): string {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

function uniqueBounded(values: readonly string[], maximum: number, length: number): string[] {
  return [...new Set(values
    .map((value) => value.trim().slice(0, length))
    .filter(Boolean))]
    .slice(0, maximum);
}

function safeRelativePaths(values: readonly string[]): string[] | undefined {
  const paths = uniqueBounded(values, MAX_STRATEGY_PATHS, 500);
  if (
    paths.length === 0
    || paths.some((path) =>
      path.startsWith("/")
      || /^[A-Za-z]:/.test(path)
      || path.includes("\0")
      || path.split(/[\\/]/).some((segment) => !segment || segment === "." || segment === "..")
    )
  ) {
    return undefined;
  }
  return paths.map((path) => path.replaceAll("\\", "/"));
}

function decisionSource(input: StrategyInput, reasonCode: string): MissionStrategyDecision["source"] {
  const read = input.worldStatePlanningRead;
  const diagnosis = input.worldStateFailureDiagnosis;
  const binding = input.runtimeSourceBinding;
  return {
    missionId: input.missionId,
    failedGoalId: input.failedGoalId,
    priorPlanRevision: input.priorPlanRevision,
    failureReasonCode: reasonCode.slice(0, 120),
    ...(binding ? {
      sourceAcceptanceId: binding.acceptanceId,
      sourceEpisodeId: binding.episodeId,
      sourceExecutionId: binding.executionId,
      sourceAttempt: binding.attempt,
    } : {}),
    ...(read ? {
      worldStatePlanningReadRevision: read.planningReadRevision,
      ...(binding ? {} : {
        sourceEpisodeId: read.sourceEpisodeId,
        sourceExecutionId: read.sourceExecutionId,
        sourceAttempt: read.sourceAttempt,
      }),
    } : {}),
    ...(diagnosis?.transition ? {
      transitionId: diagnosis.transition.id,
    } : {}),
    evidenceRefs: uniqueBounded([
      ...input.evidenceRefs,
      ...(binding ? [
        `acceptance:${binding.acceptanceId}`,
        `execution:${binding.executionId}`,
        `episode:${binding.episodeId}`,
      ] : []),
    ], 16, 500),
  };
}

function selectedDecision(
  input: StrategyInput,
  params: {
    scenario: MissionStrategyDecision["scenario"];
    selectedStrategyId: string;
    candidates: CandidateEvaluation[];
    addedStepIds: string[];
    changedStepIds: string[];
    reasonCode: string;
    steps: GeneralTaskPlanStep[];
  },
): MissionStrategySelection {
  const source = decisionSource(input, params.reasonCode);
  const orderedStepIds = params.steps.map((step) => step.id);
  const decisionBody = {
    schemaVersion: 1 as const,
    policyVersion: POLICY_VERSION as typeof POLICY_VERSION,
    scenario: params.scenario,
    selectedStrategyId: params.selectedStrategyId,
    source,
    candidates: params.candidates,
    planDelta: {
      addedStepIds: params.addedStepIds,
      changedStepIds: params.changedStepIds,
      orderedStepIds,
    },
  };
  const decision: MissionStrategyDecision = {
    ...decisionBody,
    decisionId: stableHash(decisionBody),
  };
  const preview = {
    ...input.preview,
    strategyDecision: decision,
    plan: rehashGeneralTaskPlan(input.preview.plan, params.steps),
  };
  return { status: "selected", preview, decision };
}

function runtimeStrategy(input: StrategyInput): MissionStrategySelection {
  const parsed = WorldStateFailureDiagnosisSchema.safeParse(input.worldStateFailureDiagnosis);
  if (!parsed.success) return { status: "not_applicable", reason: "runtime_reason_unsupported" };
  const diagnosis = parsed.data;
  if (
    !diagnosis.failureDiagnosis.retryable
    || diagnosis.failureDiagnosis.requiresApproval
    || diagnosis.recommendedDisposition !== "observe"
  ) {
    return { status: "blocked", reason: "runtime_diagnosis_not_retryable" };
  }
  const binding = input.runtimeSourceBinding;
  if (!binding) {
    return { status: "blocked", reason: "runtime_transition_binding_missing" };
  }
  if (
    !diagnosis.transition
    && diagnosis.reasonCode !== "accepted_transition_missing"
  ) {
    return { status: "blocked", reason: "runtime_transition_binding_missing" };
  }
  if (
    diagnosis.transition
    && (
      binding.episodeId !== diagnosis.transition.episodeId
      || binding.executionId !== diagnosis.transition.executionId
      || binding.attempt !== diagnosis.transition.attempt
      || (binding.transitionId != null && binding.transitionId !== diagnosis.transition.id)
    )
  ) {
    return { status: "blocked", reason: "runtime_transition_binding_missing" };
  }
  const targetStepId = input.runtimeStartTargetStepId;
  const transitionRequirement = input.preview.plan.transitionRequirements?.find((requirement) =>
    requirement.kind === "runtime.start"
    && requirement.sourceStepId === "runtime-start"
    && requirement.targetStepId === targetStepId,
  );
  const startStep = input.preview.plan.steps.find((step) =>
    step.id === "runtime-start"
    && step.recipe?.recipeId === "runtime.start"
    && step.recipe.recipeVersion === 1,
  );
  if (
    !targetStepId
    || !transitionRequirement
    || !startStep
    || !input.preview.plan.steps.some((step) => step.id === targetStepId)
  ) {
    return { status: "blocked", reason: "runtime_transition_binding_missing" };
  }
  const preflightStepId = "strategy-runtime-preflight";
  if (input.preview.plan.steps.some((step) => step.id === preflightStepId)) {
    return { status: "blocked", reason: "strategy_step_id_conflict" };
  }

  const directStatusReasons = new Set([
    "accepted_execution_missing",
    "runtime_status_missing",
    "runtime_status_contradicted",
    "session_evidence_missing",
    "after_state_missing",
    "after_state_contradicted",
  ]);
  const transitionReasons = new Set([
    "accepted_transition_missing",
    "transition_terminal_failure",
    "transition_identity_invalid",
    "transition_observation_set_missing",
    "observation_rows_invalid",
    "before_state_missing",
    "before_state_contradicted",
    "project_revision_mismatch",
    "environment_revision_mismatch",
  ]);
  const reasonCode = diagnosis.reasonCode;
  const statusFit = directStatusReasons.has(reasonCode) ? 1 : 0.35;
  const transitionFit = transitionReasons.has(reasonCode) ? 1 : 0.35;
  if (statusFit === 0.35 && transitionFit === 0.35) {
    return { status: "not_applicable", reason: "runtime_reason_unsupported" };
  }

  const candidates: CandidateEvaluation[] = [
    {
      strategyId: "runtime.direct-status-first",
      eligible: true,
      utilityScore: 100 + statusFit * 25 - 5,
      criteria: {
        evidenceCoverage: 1,
        diagnosisFit: statusFit,
        extraReadOnlyGoals: 1,
        mutationRequired: false,
      },
      reasonCode: "read_all_required_observations_status_first",
    },
    {
      strategyId: "runtime.transition-provenance-first",
      eligible: true,
      utilityScore: 100 + transitionFit * 25 - 5,
      criteria: {
        evidenceCoverage: 1,
        diagnosisFit: transitionFit,
        extraReadOnlyGoals: 1,
        mutationRequired: false,
      },
      reasonCode: "read_all_required_observations_provenance_first",
    },
  ];
  candidates.sort((left, right) =>
    right.utilityScore - left.utilityScore
    || left.strategyId.localeCompare(right.strategyId),
  );
  const selected = candidates[0]!;
  const observationOrder = [...diagnosis.distinguishingObservationCodes].sort((left, right) => {
    const isStatus = (code: string) => /direct_status|after_state|runtime_status/i.test(code);
    const leftPriority = selected.strategyId === "runtime.direct-status-first"
      ? (isStatus(left) ? 0 : 1)
      : (isStatus(left) ? 1 : 0);
    const rightPriority = selected.strategyId === "runtime.direct-status-first"
      ? (isStatus(right) ? 0 : 1)
      : (isStatus(right) ? 1 : 0);
    return leftPriority - rightPriority || left.localeCompare(right);
  });
  const selectedTitle = selected.strategyId === "runtime.direct-status-first"
    ? "Refresh direct runtime status before retry"
    : "Reconcile runtime transition identity before retry";
  const requiredCodes = observationOrder.join(", ");
  const preflightStep: GeneralTaskPlanStep = {
    id: preflightStepId,
    title: selectedTitle,
    objective: `Read only the server-required runtime evidence in this order: ${requiredCodes}. Do not start, stop, or otherwise mutate the runtime during this step.`,
    kind: "inspect",
    dependencies: [],
    files: [],
    readOnly: true,
    approvalRequired: false,
  };
  const steps = input.preview.plan.steps.map((step) =>
    step.id === startStep.id
      ? { ...step, dependencies: [...new Set([...step.dependencies, preflightStepId])] }
      : step,
  );
  const startIndex = steps.findIndex((step) => step.id === startStep.id);
  steps.splice(startIndex, 0, preflightStep);

  return selectedDecision(input, {
    scenario: "runtime_start_recovery",
    selectedStrategyId: selected.strategyId,
    candidates,
    addedStepIds: [preflightStepId],
    changedStepIds: [startStep.id],
    reasonCode,
    steps,
  });
}

function validatorStrategy(input: StrategyInput): MissionStrategySelection {
  const failure = input.failureDiagnosis;
  if (
    !failure
    || failure.kind !== "VALIDATOR_FAILED"
    || failure.reasonCode !== "VALIDATOR_FAILED"
    || failure.nextActionCode !== "REPAIR_AND_REVALIDATE"
    || !failure.retryable
    || failure.requiresApproval
  ) {
    return { status: "blocked", reason: "validator_diagnosis_not_retryable" };
  }
  const paths = safeRelativePaths(input.affectedPaths);
  if (!paths) return { status: "blocked", reason: "validator_paths_invalid" };
  if (paths.length > MAX_STRATEGY_PATHS) {
    return { status: "blocked", reason: "validator_scope_too_broad" };
  }
  const validationRefs = uniqueBounded(input.evidenceRefs, 16, 500)
    .filter((ref) => /^(?:validation|validator|test):[A-Za-z0-9._:-]+$/i.test(ref));
  if (validationRefs.length === 0) {
    return { status: "blocked", reason: "validator_evidence_missing" };
  }
  const executeStep = input.preview.plan.steps.find((step) => step.kind === "execute");
  const validateStep = input.preview.plan.steps.find((step) => step.kind === "validate");
  if (!executeStep || !validateStep) {
    return { status: "blocked", reason: "validator_plan_shape_unsupported" };
  }
  const targetedStepId = "strategy-validator-scope";
  const evidenceStepId = "strategy-validator-reconstruction";
  if (input.preview.plan.steps.some((step) =>
    step.id === targetedStepId || step.id === evidenceStepId,
  )) {
    return { status: "blocked", reason: "strategy_step_id_conflict" };
  }

  const targetedEligible = paths.length <= 4;
  const evidenceFirstEligible = paths.length > 4 || input.affectedClaims.length > 1;
  const candidates: CandidateEvaluation[] = [
    {
      strategyId: "code.targeted-repair",
      eligible: targetedEligible,
      utilityScore: targetedEligible ? 100 + 25 - 5 : 0,
      criteria: {
        evidenceCoverage: 1,
        diagnosisFit: targetedEligible ? 1 : 0,
        extraReadOnlyGoals: 1,
        mutationRequired: true,
      },
      reasonCode: targetedEligible
        ? "validator_evidence_and_narrow_file_scope"
        : "targeted_scope_exceeds_four_paths",
    },
    {
      strategyId: "code.reconstruct-then-repair",
      eligible: evidenceFirstEligible,
      utilityScore: evidenceFirstEligible
        ? 100 + Math.min(input.affectedClaims.length, 4) * 5 + 15 - 10
        : 0,
      criteria: {
        evidenceCoverage: 1,
        diagnosisFit: evidenceFirstEligible ? 0.8 : 0,
        extraReadOnlyGoals: 2,
        mutationRequired: true,
      },
      reasonCode: evidenceFirstEligible
        ? "broad_or_multi_claim_scope_needs_reconstruction"
        : "evidence_scope_is_narrow",
    },
  ];
  const eligibleCandidates = candidates.filter((candidate) => candidate.eligible);
  if (eligibleCandidates.length === 0) {
    return { status: "blocked", reason: "validator_plan_shape_unsupported" };
  }
  eligibleCandidates.sort((left, right) =>
    right.utilityScore - left.utilityScore
    || left.strategyId.localeCompare(right.strategyId),
  );
  const selected = eligibleCandidates[0]!;
  const inspection = input.preview.plan.steps.find((step) => step.id === "inspect");
  let insertedStep: GeneralTaskPlanStep;
  let changedStepIds = [executeStep.id];
  let steps: GeneralTaskPlanStep[];
  if (selected.strategyId === "code.targeted-repair") {
    insertedStep = {
      id: targetedStepId,
      title: "Re-read the exact validator failure scope",
      objective: `Inspect only the evidence-bound files ${paths.join(", ")} and reproduce the recorded failure ${validationRefs.join(", ")} before making a minimal repair.`,
      kind: "inspect",
      dependencies: inspection ? [inspection.id] : [],
      files: paths,
      readOnly: true,
      approvalRequired: false,
    };
  } else {
    insertedStep = {
      id: evidenceStepId,
      title: "Reconstruct validator failure across affected claims",
      objective: `Compare the recorded validator evidence ${validationRefs.join(", ")} against affected claims ${input.affectedClaims.slice(0, 12).join(", ") || "not recorded"} before repair.`,
      kind: "analyze",
      dependencies: inspection ? [inspection.id] : [],
      files: paths,
      readOnly: true,
      approvalRequired: false,
    };
    changedStepIds = [executeStep.id, validateStep.id];
  }
  steps = input.preview.plan.steps.map((step) => {
    if (step.id === executeStep.id) {
      return {
        ...step,
        title: selected.strategyId === "code.targeted-repair"
          ? "Repair only the evidence-bound validator scope"
          : "Repair after reconstructing validator evidence",
        objective: "Make the smallest repair justified by the accepted failure evidence; retain the existing approval and validation requirements.",
        files: paths,
        dependencies: [...new Set([...step.dependencies, insertedStep.id])],
      };
    }
    if (selected.strategyId === "code.reconstruct-then-repair" && step.id === validateStep.id) {
      return {
        ...step,
        title: "Re-run the validator against the reconstructed failure scope",
        files: paths,
      };
    }
    return step;
  });
  const executeIndex = steps.findIndex((step) => step.id === executeStep.id);
  steps.splice(executeIndex, 0, insertedStep);
  return selectedDecision(input, {
    scenario: "validator_recovery",
    selectedStrategyId: selected.strategyId,
    candidates,
    addedStepIds: [insertedStep.id],
    changedStepIds,
    reasonCode: failure.reasonCode,
    steps,
  });
}

/**
 * Selects only from two server-owned recovery families. It consumes already
 * validated diagnosis/evidence; it does not call a model, grant approval, or
 * treat a prior model answer as proof.
 */
export function selectAndApplyMissionStrategy(input: StrategyInput): MissionStrategySelection {
  if (!input.priorPlanRevision.trim()) {
    return { status: "blocked", reason: "prior_revision_missing" };
  }
  if (input.worldStateFailureDiagnosis) return runtimeStrategy(input);
  if (input.failureDiagnosis?.kind === "VALIDATOR_FAILED") return validatorStrategy(input);
  return { status: "not_applicable", reason: "validator_diagnosis_not_retryable" };
}
