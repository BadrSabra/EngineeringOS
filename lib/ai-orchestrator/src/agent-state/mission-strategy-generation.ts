import { z } from "zod";
import { boundedString } from "./contract-utils.js";
import {
  MISSION_DECISION_SCHEMA_VERSION,
  MissionDecisionContextSchema,
  MissionStrategyAlternativeSchema,
  StrategyDifferenceSchema,
  type MissionDecisionContext,
  type MissionStrategyAlternative,
  type StrategyDifference,
} from "./mission-decision-contract.js";

const RuntimeGenerationInputSchema = z.object({
  scenario: z.literal("runtime_start_recovery"),
  context: MissionDecisionContextSchema,
  originalStrategy: MissionStrategyAlternativeSchema,
}).strict();

const ValidatorGenerationInputSchema = z.object({
  scenario: z.literal("validator_recovery"),
  context: MissionDecisionContextSchema,
  originalStrategy: MissionStrategyAlternativeSchema,
  affectedScope: z.object({
    pathCount: z.number().int().positive().max(16),
    claimCount: z.number().int().nonnegative().max(16),
    sourceEvidenceId: boundedString(200),
  }).strict(),
}).strict();

const StrategyGenerationInputSchema = z.discriminatedUnion("scenario", [
  RuntimeGenerationInputSchema,
  ValidatorGenerationInputSchema,
]);

export type StrategyGenerationInput = z.infer<typeof StrategyGenerationInputSchema>;

export type MissionStrategyGenerationResult =
  | {
      status: "generated";
      alternatives: MissionStrategyAlternative[];
      differences: StrategyDifference[];
      genuinelyDifferentPairs: Array<{ leftStrategyId: string; rightStrategyId: string }>;
    }
  | {
      status: "no_meaningful_alternative_available";
      reasonCode: "only_equivalent_or_partial_alternatives";
      alternatives: MissionStrategyAlternative[];
      differences: StrategyDifference[];
    }
  | {
      status: "blocked";
      reasonCode:
        | "invalid_input"
        | "initial_plan_not_supported"
        | "validator_evidence_missing"
        | "validator_scope_evidence_unbound"
        | "runtime_evidence_missing"
        | "strategy_identity_conflict";
    };

function sorted(values: readonly string[]): string[] {
  return [...values].sort((left, right) => left.localeCompare(right));
}

function normalizedActions(strategy: MissionStrategyAlternative): string[] {
  return strategy.expectedActions.map((action) => `${action.capabilityId}:${action.effectClass}`);
}

function normalizedDependencies(strategy: MissionStrategyAlternative): string[] {
  const stepOrder = new Map(strategy.expectedActions.map((action, index) => [action.planStepId, index]));
  return strategy.stepDependencies
    .map((dependency) => {
      const child = stepOrder.get(dependency.stepId);
      const parents = dependency.dependsOnStepIds
        .map((stepId) => stepOrder.get(stepId))
        .filter((index): index is number => index !== undefined)
        .sort((left, right) => left - right);
      return `${child ?? "unknown"}<-${parents.join(",")}`;
    })
    .sort((left, right) => left.localeCompare(right));
}

/**
 * Compare the plan semantics rather than IDs, titles, or score differences.
 * This function only classifies alternatives; it does not select or dispatch.
 */
export function compareMissionStrategyAlternatives(
  leftInput: MissionStrategyAlternative,
  rightInput: MissionStrategyAlternative,
): StrategyDifference {
  const left = MissionStrategyAlternativeSchema.parse(leftInput);
  const right = MissionStrategyAlternativeSchema.parse(rightInput);
  if (left.strategyId === right.strategyId) {
    throw new Error("strategy comparison requires distinct strategy identities");
  }

  const changedDimensions: StrategyDifference["changedDimensions"][number][] = [];
  const leftActions = normalizedActions(left);
  const rightActions = normalizedActions(right);
  if (JSON.stringify(leftActions) !== JSON.stringify(rightActions)) {
    changedDimensions.push("action_sequence");
  }
  if (JSON.stringify(sorted(left.expectedActions.map((action) => action.capabilityId)))
    !== JSON.stringify(sorted(right.expectedActions.map((action) => action.capabilityId)))) {
    changedDimensions.push("tool_selection");
  }
  if (JSON.stringify(normalizedDependencies(left)) !== JSON.stringify(normalizedDependencies(right))) {
    changedDimensions.push("dependency_structure");
  }
  if (JSON.stringify(sorted(left.preconditionCodes)) !== JSON.stringify(sorted(right.preconditionCodes))) {
    changedDimensions.push("preconditions");
  }
  if (left.category !== right.category) changedDimensions.push("execution_approach");
  if (JSON.stringify(sorted(left.validationProcedureCodes))
    !== JSON.stringify(sorted(right.validationProcedureCodes))) {
    changedDimensions.push("validation_approach");
  }
  if (JSON.stringify(sorted(left.expectedEffectCodes)) !== JSON.stringify(sorted(right.expectedEffectCodes))) {
    changedDimensions.push("expected_effects");
  }
  if (
    JSON.stringify(left.expectedObservationCodes) !== JSON.stringify(right.expectedObservationCodes)
    || JSON.stringify(sorted(left.failureModeCodes)) !== JSON.stringify(sorted(right.failureModeCodes))
  ) {
    changedDimensions.push("recovery_behavior");
  }
  if (
    left.risk !== right.risk
    || left.reversibility !== right.reversibility
    || left.approvalRequirement !== right.approvalRequirement
  ) {
    changedDimensions.push("risk_profile");
  }

  const coreChange = changedDimensions.some((dimension) => [
    "action_sequence",
    "tool_selection",
    "dependency_structure",
    "execution_approach",
  ].includes(dimension));
  const classification = changedDimensions.length === 0
    ? "SEMANTICALLY_EQUIVALENT"
    : coreChange ? "GENUINELY_DIFFERENT" : "PARTIALLY_DIFFERENT";
  return StrategyDifferenceSchema.parse({
    leftStrategyId: left.strategyId,
    rightStrategyId: right.strategyId,
    classification,
    changedDimensions,
    reasonCodes: changedDimensions.map((dimension) => `semantic_change:${dimension}`),
  });
}

function estimateUnknown() {
  return {
    status: "unknown" as const,
    value: null,
    unit: "none" as const,
    confidence: { status: "unknown" as const, value: null, calibrationRef: null },
    evidenceRefIds: [],
  };
}

function buildAlternative(params: {
  strategyId: string;
  category: MissionStrategyAlternative["category"];
  objectiveCode: string;
  requiredEvidenceKinds: string[];
  preconditionCodes: string[];
  actions: MissionStrategyAlternative["expectedActions"];
  observationCodes: string[];
  effectCodes: string[];
  validationCodes: string[];
  dependencies: MissionStrategyAlternative["stepDependencies"];
  approvalRequirement: MissionStrategyAlternative["approvalRequirement"];
}): MissionStrategyAlternative {
  return MissionStrategyAlternativeSchema.parse({
    schemaVersion: MISSION_DECISION_SCHEMA_VERSION,
    strategyId: params.strategyId,
    version: 1,
    category: params.category,
    source: "server_rule",
    candidateRef: null,
    intendedObjectiveCode: params.objectiveCode,
    requiredCapabilities: [...new Set(params.actions.map((action) => action.capabilityId))],
    requiredEvidenceKinds: params.requiredEvidenceKinds,
    preconditionCodes: params.preconditionCodes,
    expectedActions: params.actions,
    expectedObservationCodes: params.observationCodes,
    expectedEffectCodes: params.effectCodes,
    validationProcedureCodes: params.validationCodes,
    stepDependencies: params.dependencies,
    resourceEstimate: estimateUnknown(),
    durationEstimate: estimateUnknown(),
    expectedExecutionCost: estimateUnknown(),
    risk: "unknown",
    reversibility: "unknown",
    failureModeCodes: [],
    approvalRequirement: params.approvalRequirement,
    assumptionCodes: [],
    limitationCodes: ["proposal_only_no_dispatch"],
  });
}

function eligibleEvidence(
  context: MissionDecisionContext,
  kind: MissionDecisionContext["evidenceRefs"][number]["kind"],
): MissionDecisionContext["evidenceRefs"] {
  return context.evidenceRefs.filter((ref) =>
    ref.kind === kind
    && ref.eligibility === "eligible"
    && ref.freshness === "fresh"
    && ref.scope.projectId === context.identity.projectId
    && ref.scope.missionId === context.identity.missionId
    && ref.scope.goalId === context.identity.goalId
    && (
      ref.scope.executionId === null
      || (
        ref.scope.executionId === context.identity.sourceExecutionId
        && ref.scope.attempt === context.identity.sourceAttempt
      )
    ),
  );
}

function compareAll(alternatives: MissionStrategyAlternative[]): StrategyDifference[] {
  const differences: StrategyDifference[] = [];
  for (let left = 0; left < alternatives.length; left += 1) {
    for (let right = left + 1; right < alternatives.length; right += 1) {
      differences.push(compareMissionStrategyAlternatives(alternatives[left]!, alternatives[right]!));
    }
  }
  return differences;
}

function finishGeneration(
  alternatives: MissionStrategyAlternative[],
): MissionStrategyGenerationResult {
  const ids = alternatives.map(({ strategyId }) => strategyId);
  if (new Set(ids).size !== ids.length) {
    return { status: "blocked", reasonCode: "strategy_identity_conflict" };
  }
  const differences = compareAll(alternatives);
  const genuinelyDifferentPairs = differences
    .filter(({ classification }) => classification === "GENUINELY_DIFFERENT")
    .map(({ leftStrategyId, rightStrategyId }) => ({ leftStrategyId, rightStrategyId }));
  if (genuinelyDifferentPairs.length === 0) {
    return {
      status: "no_meaningful_alternative_available",
      reasonCode: "only_equivalent_or_partial_alternatives",
      alternatives,
      differences,
    };
  }
  return { status: "generated", alternatives, differences, genuinelyDifferentPairs };
}

function generateRuntimeAlternatives(
  context: MissionDecisionContext,
  originalStrategy: MissionStrategyAlternative,
): MissionStrategyGenerationResult {
  const eligibleAcceptance = eligibleEvidence(context, "acceptance")
    .some((ref) => ref.evidenceId === context.identity.sourceAcceptanceId);
  const eligibleTransitionEvidence = [
    ...eligibleEvidence(context, "world_transition"),
    ...eligibleEvidence(context, "observation"),
  ];
  const diagnosis = context.failureDiagnoses.some((item) =>
    ["expected_effect_missing", "stale_environment", "external_dependency"].includes(item.kind)
    && item.evidenceIds.some((id) => eligibleTransitionEvidence.some((ref) => ref.evidenceId === id)),
  );
  if (!eligibleAcceptance || eligibleTransitionEvidence.length === 0 || !diagnosis) {
    return { status: "blocked", reasonCode: "runtime_evidence_missing" };
  }

  const actions = {
    runtimeStatus: {
      planStepId: "decision.read-runtime-status",
      capabilityId: "runtime.status.read",
      effectClass: "read_only" as const,
    },
    transition: {
      planStepId: "decision.read-transition-provenance",
      capabilityId: "world_state.transition.read",
      effectClass: "read_only" as const,
    },
  };
  const shared = {
    category: "verify_then_retry" as const,
    objectiveCode: "reconcile_runtime_state_before_any_retry",
    requiredEvidenceKinds: ["acceptance", "world_transition", "observation"],
    preconditionCodes: ["source_execution_attempt_bound", "current_goal_scope"],
    effectCodes: ["diagnostic_evidence_reconciled"],
    validationCodes: ["server_world_state_reconciliation"],
    approvalRequirement: "not_required" as const,
  };
  const statusFirst = buildAlternative({
    strategyId: "runtime.verify-status-first.v1",
    ...shared,
    actions: [actions.runtimeStatus, actions.transition],
    observationCodes: ["runtime_status", "transition_identity", "transition_effects"],
    dependencies: [
      { stepId: actions.runtimeStatus.planStepId, dependsOnStepIds: [] },
      { stepId: actions.transition.planStepId, dependsOnStepIds: [actions.runtimeStatus.planStepId] },
    ],
  });
  const transitionFirst = buildAlternative({
    strategyId: "runtime.verify-transition-first.v1",
    ...shared,
    actions: [actions.transition, actions.runtimeStatus],
    observationCodes: ["transition_identity", "transition_effects", "runtime_status"],
    dependencies: [
      { stepId: actions.transition.planStepId, dependsOnStepIds: [] },
      { stepId: actions.runtimeStatus.planStepId, dependsOnStepIds: [actions.transition.planStepId] },
    ],
  });
  return finishGeneration([originalStrategy, statusFirst, transitionFirst]);
}

function generateValidatorAlternatives(
  context: MissionDecisionContext,
  originalStrategy: MissionStrategyAlternative,
  affectedScope: z.infer<typeof ValidatorGenerationInputSchema>["affectedScope"],
): MissionStrategyGenerationResult {
  const eligibleValidationEvidence = eligibleEvidence(context, "validation");
  const supportedDiagnosis = context.failureDiagnoses.some((item) =>
    item.kind === "validation_failure"
    && item.knowledgeClass === "SERVER_DERIVED"
    && item.evidenceIds.some((id) => eligibleValidationEvidence.some((ref) => ref.evidenceId === id)),
  );
  if (!supportedDiagnosis || eligibleValidationEvidence.length === 0) {
    return { status: "blocked", reasonCode: "validator_evidence_missing" };
  }
  if (!eligibleValidationEvidence.some((ref) => ref.evidenceId === affectedScope.sourceEvidenceId)) {
    return { status: "blocked", reasonCode: "validator_scope_evidence_unbound" };
  }

  const targetedActions = [
    {
      planStepId: "decision.inspect-targeted-validator-failure",
      capabilityId: "repository.read",
      effectClass: "read_only" as const,
    },
    {
      planStepId: "decision.propose-targeted-repair",
      capabilityId: "task.mutation.request",
      effectClass: "unknown" as const,
    },
    {
      planStepId: "decision.validate-targeted-repair",
      capabilityId: "validator.run",
      effectClass: "unknown" as const,
    },
  ];
  const broadActions = [
    {
      planStepId: "decision.inspect-cross-claim-evidence",
      capabilityId: "repository.read",
      effectClass: "read_only" as const,
    },
    {
      planStepId: "decision.reconstruct-claim-failure",
      capabilityId: "evidence.reconstruct",
      effectClass: "read_only" as const,
    },
    {
      planStepId: "decision.propose-evidence-bound-repair",
      capabilityId: "task.mutation.request",
      effectClass: "unknown" as const,
    },
    {
      planStepId: "decision.validate-reconstructed-scope",
      capabilityId: "validator.run",
      effectClass: "unknown" as const,
    },
  ];
  const shared = {
    category: "alternative_implementation" as const,
    requiredEvidenceKinds: ["validation"],
    effectCodes: ["validator_failure_addressed"],
    validationCodes: ["canonical_acceptance", "original_validator_profile"],
    approvalRequirement: "required" as const,
  };
  const targeted = buildAlternative({
    strategyId: "validator.targeted-repair.v1",
    ...shared,
    objectiveCode: "repair_only_evidence_bound_scope",
    preconditionCodes: ["failure_evidence_current", "affected_scope_bound"],
    actions: targetedActions,
    observationCodes: ["exact_validator_failure", "post_repair_validator_result"],
    dependencies: [
      { stepId: targetedActions[0]!.planStepId, dependsOnStepIds: [] },
      { stepId: targetedActions[1]!.planStepId, dependsOnStepIds: [targetedActions[0]!.planStepId] },
      { stepId: targetedActions[2]!.planStepId, dependsOnStepIds: [targetedActions[1]!.planStepId] },
    ],
  });
  const alternatives = [originalStrategy, targeted];

  if (affectedScope.pathCount > 4 || affectedScope.claimCount > 1) {
    alternatives.push(buildAlternative({
      strategyId: "validator.reconstruct-then-repair.v1",
      ...shared,
      objectiveCode: "reconstruct_related_claims_before_repair",
      preconditionCodes: ["failure_evidence_current", "affected_scope_bound", "claim_relationships_observed"],
      actions: broadActions,
      observationCodes: [
        "validator_failure",
        "affected_claim_relationships",
        "post_repair_validator_result",
      ],
      dependencies: [
        { stepId: broadActions[0]!.planStepId, dependsOnStepIds: [] },
        { stepId: broadActions[1]!.planStepId, dependsOnStepIds: [broadActions[0]!.planStepId] },
        { stepId: broadActions[2]!.planStepId, dependsOnStepIds: [broadActions[1]!.planStepId] },
        { stepId: broadActions[3]!.planStepId, dependsOnStepIds: [broadActions[2]!.planStepId] },
      ],
    }));
  }
  return finishGeneration(alternatives);
}

/**
 * Generates bounded, server-owned proposal templates for the two currently
 * evidenced Mission recovery families. It never selects, mutates a plan,
 * dispatches work, creates approval, or treats a prediction as an observation.
 */
export function generateMissionStrategyAlternatives(
  input: unknown,
): MissionStrategyGenerationResult {
  const parsed = StrategyGenerationInputSchema.safeParse(input);
  if (!parsed.success) return { status: "blocked", reasonCode: "invalid_input" };
  if (parsed.data.context.identity.trigger === "initial_plan") {
    return { status: "blocked", reasonCode: "initial_plan_not_supported" };
  }
  if (parsed.data.scenario === "runtime_start_recovery") {
    return generateRuntimeAlternatives(parsed.data.context, parsed.data.originalStrategy);
  }
  return generateValidatorAlternatives(
    parsed.data.context,
    parsed.data.originalStrategy,
    parsed.data.affectedScope,
  );
}

