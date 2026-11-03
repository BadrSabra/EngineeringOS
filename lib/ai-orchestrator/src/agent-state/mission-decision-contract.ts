import { z } from "zod";
import {
  boundedString,
  canonicalJsonHash,
} from "./contract-utils.js";

export const MISSION_DECISION_SCHEMA_VERSION = 1 as const;
const MAX_DECISION_BYTES = 96 * 1024;
const MAX_EVIDENCE_REFS = 64;
const MAX_STRATEGIES = 8;
const MAX_DECISION_ITEMS = 32;

function boundedDecisionContract<T extends z.ZodTypeAny>(
  schema: T,
  maxBytes: number,
): z.ZodEffects<T, z.output<T>, z.input<T>> {
  return schema.superRefine((value, ctx) => {
    const serialized = JSON.stringify(value);
    if (Buffer.byteLength(serialized, "utf8") > maxBytes) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: `decision contract exceeds ${maxBytes} bytes`,
      });
    }
  }) as z.ZodEffects<T, z.output<T>, z.input<T>>;
}

const isoTimestamp = z.string().min(20).max(64).refine(
  (value) => (
    /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/.test(value)
    && !Number.isNaN(Date.parse(value))
  ),
  "timestamp must be a parseable ISO date",
);

export const DecisionKnowledgeClassSchema = z.enum([
  "OBSERVED",
  "SERVER_DERIVED",
  "HISTORICAL",
  "PREDICTED",
  "HYPOTHETICAL",
  "UNKNOWN",
]);
export type DecisionKnowledgeClass = z.infer<typeof DecisionKnowledgeClassSchema>;

export const DecisionConfidenceSchema = z.object({
  status: z.enum(["calibrated", "heuristic", "uncalibrated", "unknown", "not_applicable"]),
  value: z.number().min(0).max(1).nullable(),
  calibrationRef: boundedString(200).nullable(),
}).strict().superRefine((value, ctx) => {
  if (value.status === "calibrated" && (value.value === null || value.calibrationRef === null)) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: "calibrated confidence requires a value and calibration reference",
    });
  }
  if (value.status !== "calibrated" && value.calibrationRef !== null) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: "only calibrated confidence may include a calibration reference",
    });
  }
  if (["unknown", "not_applicable"].includes(value.status) && value.value !== null) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: "unknown and not-applicable confidence cannot include a numeric value",
    });
  }
}).describe("Confidence provenance is explicit; heuristic scores are not probabilities.");
export type DecisionConfidence = z.infer<typeof DecisionConfidenceSchema>;

export const DecisionEvidenceRefSchema = z.object({
  evidenceId: boundedString(200),
  kind: z.enum([
    "acceptance",
    "execution",
    "episode",
    "observation",
    "validation",
    "effect",
    "world_transition",
    "world_state_fact",
    "plan",
    "capability",
    "approval",
    "historical_outcome",
  ]),
  knowledgeClass: DecisionKnowledgeClassSchema,
  provenanceCode: boundedString(120),
  scope: z.object({
    projectId: boundedString(200),
    missionId: boundedString(200).nullable(),
    goalId: boundedString(200).nullable(),
    executionId: boundedString(200).nullable(),
    attempt: z.number().int().nonnegative().nullable(),
  }).strict(),
  timestamp: isoTimestamp.nullable(),
  freshness: z.enum(["fresh", "stale", "unknown", "not_applicable"]),
  revisions: z.object({
    project: boundedString(200).nullable(),
    worldState: boundedString(200).nullable(),
    environment: boundedString(200).nullable(),
  }).strict(),
  confidence: DecisionConfidenceSchema,
  eligibility: z.enum(["eligible", "advisory", "rejected"]),
  eligibilityReasonCodes: z.array(boundedString(120)).max(16),
  contentHash: z.string().regex(/^[a-f0-9]{64}$/),
}).strict();
export type DecisionEvidenceRef = z.infer<typeof DecisionEvidenceRefSchema>;

const DecisionIdentitySchema = z.object({
  projectId: boundedString(200),
  missionId: boundedString(200),
  goalId: boundedString(200),
  trigger: z.enum(["initial_plan", "recovery", "replan"]),
  sourceExecutionId: boundedString(200).nullable(),
  sourceAttempt: z.number().int().nonnegative().nullable(),
  sourceAcceptanceId: boundedString(200).nullable(),
  priorPlanRevision: boundedString(200).nullable(),
  projectRevision: boundedString(200).nullable(),
  worldStateRevision: boundedString(200).nullable(),
  environmentRevision: boundedString(200).nullable(),
}).strict().superRefine((identity, ctx) => {
  const isRecovery = identity.trigger !== "initial_plan";
  if (isRecovery && (
    identity.sourceExecutionId === null
    || identity.sourceAttempt === null
    || identity.priorPlanRevision === null
    || identity.sourceAcceptanceId === null
  )) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: "recovery decisions require source execution, attempt, acceptance, and prior plan revision",
    });
  }
  if ((identity.sourceExecutionId === null) !== (identity.sourceAttempt === null)) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: "execution and attempt identity must be present together",
    });
  }
});

const RootCauseHypothesisSchema = z.object({
  hypothesisCode: boundedString(120),
  knowledgeClass: z.literal("HYPOTHETICAL"),
  confidence: DecisionConfidenceSchema,
  supportingEvidenceIds: z.array(boundedString(200)).max(MAX_EVIDENCE_REFS),
  contradictingEvidenceIds: z.array(boundedString(200)).max(MAX_EVIDENCE_REFS),
  unresolvedQuestionCodes: z.array(boundedString(120)).max(24),
  requiredObservationCodes: z.array(boundedString(120)).max(24),
}).strict();

const FailureDiagnosisItemSchema = z.object({
  kind: z.enum([
    "immediate_failure",
    "failed_precondition",
    "invalid_assumption",
    "missing_capability",
    "stale_environment",
    "external_dependency",
    "validation_failure",
    "expected_effect_missing",
    "contradictory_observations",
    "authorization_requirement",
    "insufficient_evidence",
  ]),
  code: boundedString(120),
  knowledgeClass: DecisionKnowledgeClassSchema,
  evidenceIds: z.array(boundedString(200)).max(MAX_EVIDENCE_REFS),
  confidence: DecisionConfidenceSchema,
}).strict();

export const MissionDecisionContextSchema = boundedDecisionContract(z.object({
  schemaVersion: z.literal(MISSION_DECISION_SCHEMA_VERSION),
  identity: DecisionIdentitySchema,
  objectiveCode: boundedString(160),
  capturedAt: isoTimestamp,
  failureDiagnoses: z.array(FailureDiagnosisItemSchema).max(24),
  rootCauseHypotheses: z.array(RootCauseHypothesisSchema).max(12),
  evidenceRefs: z.array(DecisionEvidenceRefSchema).max(MAX_EVIDENCE_REFS),
  authorization: z.object({
    status: z.enum(["allowed", "approval_required", "denied", "unknown"]),
    policyRef: boundedString(200).nullable(),
    reasonCodes: z.array(boundedString(120)).max(16),
  }).strict(),
  approval: z.object({
    status: z.enum(["not_required", "required", "granted", "denied", "unknown"]),
    approvalRef: boundedString(200).nullable(),
    approvedStrategyId: boundedString(200).nullable(),
    approvedStrategyHash: z.string().regex(/^[a-f0-9]{64}$/).nullable(),
    approvedPlanRevision: boundedString(200).nullable(),
  }).strict(),
  preconditionFindings: z.array(z.object({
    code: boundedString(120),
    status: z.enum(["satisfied", "failed", "unknown"]),
    evidenceRefIds: z.array(boundedString(200)).max(MAX_EVIDENCE_REFS),
  }).strict()).max(MAX_DECISION_ITEMS),
  availableCapabilities: z.array(boundedString(160)).max(64),
  unavailableCapabilities: z.array(boundedString(160)).max(64),
  unknownCapabilities: z.array(boundedString(160)).max(64),
  unresolvedQuestionCodes: z.array(boundedString(120)).max(32),
  requiredObservationCodes: z.array(boundedString(120)).max(32),
}).strict(), MAX_DECISION_BYTES).superRefine((context, ctx) => {
  const identity = context.identity;
  const refs = new Map(context.evidenceRefs.map((ref) => [ref.evidenceId, ref]));
  const preconditionCodes = context.preconditionFindings.map(({ code }) => code);
  if (refs.size !== context.evidenceRefs.length) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: "duplicate decision evidence identity" });
  }
  if (new Set(preconditionCodes).size !== preconditionCodes.length) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: "precondition findings must have unique codes" });
  }
  const hasApprovalBinding =
    context.approval.approvalRef !== null
    && context.approval.approvedStrategyId !== null
    && context.approval.approvedStrategyHash !== null
    && context.approval.approvedPlanRevision !== null;
  if (
    (context.approval.status === "granted") !== hasApprovalBinding
    || (context.approval.status !== "granted" && (
      context.approval.approvalRef !== null
      || context.approval.approvedStrategyId !== null
      || context.approval.approvedStrategyHash !== null
      || context.approval.approvedPlanRevision !== null
    ))
  ) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: "granted approval must bind one strategy hash and plan revision" });
  }
  if (context.authorization.status === "allowed" && context.authorization.policyRef === null) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: "allowed authorization requires a server policy reference" });
  }
  const capabilityDeclarations = [
    ...context.availableCapabilities,
    ...context.unavailableCapabilities,
    ...context.unknownCapabilities,
  ];
  if (new Set(capabilityDeclarations).size !== capabilityDeclarations.length) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: "capability states must be unique and mutually exclusive" });
  }
  for (const ref of context.evidenceRefs) {
    if (ref.scope.projectId !== identity.projectId && ref.eligibility === "eligible") {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: "cross-project evidence cannot be eligible" });
    }
    if (
      ref.scope.missionId !== null
      && ref.scope.missionId !== identity.missionId
      && ref.eligibility === "eligible"
    ) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: "cross-mission evidence cannot be eligible proof" });
    }
    if (
      ref.scope.goalId !== null
      && ref.scope.goalId !== identity.goalId
      && ref.knowledgeClass !== "HISTORICAL"
      && ref.eligibility === "eligible"
    ) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: "evidence from another Goal must be historical or downgraded" });
    }
    if (
      ref.scope.executionId !== null
      && ref.eligibility === "eligible"
      && (
        ref.scope.executionId !== identity.sourceExecutionId
        || ref.scope.attempt !== identity.sourceAttempt
      )
    ) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: "evidence from another execution attempt cannot be eligible proof" });
    }
    if (
      (ref.freshness === "stale" || ref.freshness === "unknown")
      && ref.eligibility === "eligible"
    ) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: "stale or unknown-freshness evidence cannot be eligible" });
    }
    if (
      ["PREDICTED", "HYPOTHETICAL", "UNKNOWN"].includes(ref.knowledgeClass)
      && ref.eligibility === "eligible"
    ) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: "predicted, hypothetical, or unknown evidence cannot be eligible proof" });
    }
  }
  for (const diagnosis of context.failureDiagnoses) {
    if (diagnosis.evidenceIds.some((id) => !refs.has(id))) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: "diagnosis references unknown evidence" });
    }
  }
  for (const precondition of context.preconditionFindings) {
    if (precondition.evidenceRefIds.some((id) => !refs.has(id))) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: "precondition references unknown evidence" });
    }
    if (precondition.status === "satisfied" && precondition.evidenceRefIds.length === 0) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: "satisfied preconditions require evidence" });
    }
  }
  for (const hypothesis of context.rootCauseHypotheses) {
    const referencedIds = [...hypothesis.supportingEvidenceIds, ...hypothesis.contradictingEvidenceIds];
    if (referencedIds.some((id) => !refs.has(id))) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: "root-cause hypothesis references unknown evidence" });
    }
  }
});
export type MissionDecisionContext = z.infer<typeof MissionDecisionContextSchema>;

const EstimateSchema = z.object({
  status: z.enum(["measured", "estimated", "unknown", "not_applicable"]),
  value: z.number().finite().nonnegative().nullable(),
  unit: z.enum(["tokens", "milliseconds", "tool_calls", "count", "none"]),
  confidence: DecisionConfidenceSchema,
  evidenceRefIds: z.array(boundedString(200)).max(MAX_EVIDENCE_REFS),
}).strict().superRefine((estimate, ctx) => {
  if (["unknown", "not_applicable"].includes(estimate.status) && estimate.value !== null) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: "unknown and not-applicable estimates must not invent a value" });
  }
  if (["measured", "estimated"].includes(estimate.status) && estimate.value === null) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: "measured and estimated values require a value" });
  }
  if (estimate.status === "measured" && estimate.evidenceRefIds.length === 0) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: "measured estimates require evidence references" });
  }
  if (["unknown", "not_applicable"].includes(estimate.status) && estimate.evidenceRefIds.length > 0) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: "unknown estimates cannot claim supporting measurement evidence" });
  }
});

export const MissionStrategyAlternativeSchema = boundedDecisionContract(z.object({
  schemaVersion: z.literal(MISSION_DECISION_SCHEMA_VERSION),
  strategyId: boundedString(200),
  version: z.number().int().positive(),
  category: z.enum([
    "baseline",
    "verify_then_retry",
    "refresh_and_replan",
    "alternative_capability",
    "decompose",
    "resolve_dependency",
    "request_approval_or_information",
    "alternative_implementation",
    "stop_insufficient_evidence",
  ]),
  source: z.enum(["existing_plan", "server_rule", "strategy_candidate", "human"]),
  candidateRef: z.object({
    candidateId: boundedString(200),
    candidateHash: z.string().regex(/^[a-f0-9]{64}$/),
    sourceRevision: boundedString(200),
  }).strict().nullable(),
  intendedObjectiveCode: boundedString(160),
  requiredCapabilities: z.array(boundedString(160)).max(32),
  requiredEvidenceKinds: z.array(boundedString(120)).max(32),
  preconditionCodes: z.array(boundedString(120)).max(MAX_DECISION_ITEMS),
  expectedActions: z.array(z.object({
    planStepId: boundedString(200),
    capabilityId: boundedString(160),
    effectClass: z.enum(["read_only", "reversible_mutation", "irreversible_mutation", "external_effect", "unknown"]),
  }).strict()).max(MAX_DECISION_ITEMS),
  expectedObservationCodes: z.array(boundedString(120)).max(MAX_DECISION_ITEMS),
  expectedEffectCodes: z.array(boundedString(120)).max(MAX_DECISION_ITEMS),
  validationProcedureCodes: z.array(boundedString(120)).max(MAX_DECISION_ITEMS),
  stepDependencies: z.array(z.object({
    stepId: boundedString(200),
    dependsOnStepIds: z.array(boundedString(200)).max(MAX_DECISION_ITEMS),
  }).strict()).max(MAX_DECISION_ITEMS),
  resourceEstimate: EstimateSchema,
  durationEstimate: EstimateSchema,
  expectedExecutionCost: EstimateSchema,
  risk: z.enum(["low", "medium", "high", "unknown"]),
  reversibility: z.enum(["reversible", "partially_reversible", "irreversible", "unknown"]),
  failureModeCodes: z.array(boundedString(120)).max(MAX_DECISION_ITEMS),
  approvalRequirement: z.enum(["not_required", "required", "unknown"]),
  assumptionCodes: z.array(boundedString(120)).max(MAX_DECISION_ITEMS),
  limitationCodes: z.array(boundedString(120)).max(MAX_DECISION_ITEMS),
}).strict().superRefine((strategy, ctx) => {
  const actionIds = strategy.expectedActions.map(({ planStepId }) => planStepId);
  if (new Set(actionIds).size !== actionIds.length) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: "strategy action step identities must be unique" });
  }
  const actionIdSet = new Set(actionIds);
  const dependencies = new Map<string, string[]>();
  for (const dependency of strategy.stepDependencies) {
    if (!actionIdSet.has(dependency.stepId)) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: "dependency references an unknown action step" });
    }
    if (
      dependency.dependsOnStepIds.some((stepId) => !actionIdSet.has(stepId) || stepId === dependency.stepId)
    ) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: "dependency must reference distinct known action steps" });
    }
    if (dependencies.has(dependency.stepId)) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: "dependency graph contains duplicate step entries" });
    }
    dependencies.set(dependency.stepId, dependency.dependsOnStepIds);
  }
  if (dependencies.size !== actionIds.length) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: "every proposed action requires an explicit dependency entry" });
  }
  const visiting = new Set<string>();
  const visited = new Set<string>();
  const hasCycle = (stepId: string): boolean => {
    if (visiting.has(stepId)) return true;
    if (visited.has(stepId)) return false;
    visiting.add(stepId);
    for (const dependencyId of dependencies.get(stepId) ?? []) {
      if (hasCycle(dependencyId)) return true;
    }
    visiting.delete(stepId);
    visited.add(stepId);
    return false;
  };
  if (actionIds.some((stepId) => hasCycle(stepId))) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: "strategy dependency graph must be acyclic" });
  }
  const requiredCapabilities = new Set(strategy.requiredCapabilities);
  if (strategy.expectedActions.some(({ capabilityId }) => !requiredCapabilities.has(capabilityId))) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: "required capabilities must cover every proposed action" });
  }
  if (
    strategy.expectedActions.some(({ effectClass }) => effectClass === "irreversible_mutation")
    && strategy.approvalRequirement !== "required"
  ) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: "irreversible mutation proposals require approval" });
  }
  if (strategy.source === "strategy_candidate" && strategy.candidateRef === null) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: "strategy-candidate alternatives require a candidate identity" });
  }
  if (strategy.source !== "strategy_candidate" && strategy.candidateRef !== null) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: "non-candidate alternatives cannot claim a candidate identity" });
  }
}), MAX_DECISION_BYTES);
export type MissionStrategyAlternative = z.infer<typeof MissionStrategyAlternativeSchema>;

export const StrategyDifferenceSchema = z.object({
  leftStrategyId: boundedString(200),
  rightStrategyId: boundedString(200),
  classification: z.enum(["GENUINELY_DIFFERENT", "PARTIALLY_DIFFERENT", "SEMANTICALLY_EQUIVALENT"]),
  changedDimensions: z.array(z.enum([
    "action_sequence",
    "tool_selection",
    "dependency_structure",
    "preconditions",
    "execution_approach",
    "validation_approach",
    "expected_effects",
    "recovery_behavior",
    "risk_profile",
  ])).max(9),
  reasonCodes: z.array(boundedString(120)).max(16),
}).strict().superRefine((difference, ctx) => {
  if (difference.classification === "SEMANTICALLY_EQUIVALENT" && difference.changedDimensions.length > 0) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: "semantically equivalent strategies cannot claim meaningful changed dimensions",
    });
  }
  if (difference.classification === "GENUINELY_DIFFERENT" && difference.changedDimensions.length === 0) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: "genuine strategy differences require at least one changed dimension",
    });
  }
  if (difference.classification === "PARTIALLY_DIFFERENT" && difference.changedDimensions.length === 0) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: "partially different strategies require at least one changed dimension",
    });
  }
});
export type StrategyDifference = z.infer<typeof StrategyDifferenceSchema>;

export const StrategyEvaluationDimensionSchema = z.enum([
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
]);
export type StrategyEvaluationDimension = z.infer<typeof StrategyEvaluationDimensionSchema>;

const EvaluationDimensionSchema = z.object({
  dimension: StrategyEvaluationDimensionSchema,
  status: z.enum(["measured", "estimated", "unknown", "not_applicable"]),
  normalizedValue: z.number().min(0).max(1).nullable(),
  source: z.enum([
    "deterministic_rule",
    "accepted_evidence",
    "measured_resource",
    "calibrated_history",
    "advisory_model",
    "unknown",
    "not_applicable",
  ]),
  evidenceRefIds: z.array(boundedString(200)).max(MAX_EVIDENCE_REFS),
  confidence: DecisionConfidenceSchema,
  reasonCodes: z.array(boundedString(120)).max(16),
}).strict().superRefine((dimension, ctx) => {
  if (["unknown", "not_applicable"].includes(dimension.status) && dimension.normalizedValue !== null) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: "unknown evaluation dimensions cannot have a score" });
  }
  if (["measured", "estimated"].includes(dimension.status) && dimension.normalizedValue === null) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: "measured and estimated dimensions require a normalized value" });
  }
  if (["unknown", "not_applicable"].includes(dimension.status) && dimension.source !== dimension.status) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: "unknown and not-applicable dimensions require matching source status" });
  }
  if (dimension.status === "measured" && dimension.source === "advisory_model") {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: "model advice cannot be recorded as a measured dimension" });
  }
  if (dimension.source === "calibrated_history" && dimension.confidence.status !== "calibrated") {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: "historical calibration requires calibrated confidence provenance" });
  }
});

export const MissionStrategyEvaluationSchema = boundedDecisionContract(z.object({
  schemaVersion: z.literal(MISSION_DECISION_SCHEMA_VERSION),
  strategyId: boundedString(200),
  strategyHash: z.string().regex(/^[a-f0-9]{64}$/),
  eligibility: z.enum(["eligible", "ineligible", "unknown"]),
  hardConstraints: z.array(z.object({
    constraintCode: boundedString(120),
    result: z.enum(["passed", "rejected", "unknown"]),
    evidenceRefIds: z.array(boundedString(200)).max(MAX_EVIDENCE_REFS),
    reasonCodes: z.array(boundedString(120)).max(16),
  }).strict()).max(MAX_DECISION_ITEMS),
  dimensions: z.array(EvaluationDimensionSchema).length(15),
  rankingScore: z.number().min(0).max(1).nullable(),
  scorePolicyVersion: boundedString(120).nullable(),
  evaluatorVersion: boundedString(120),
  evaluatedAt: isoTimestamp,
}).strict(), MAX_DECISION_BYTES).superRefine((evaluation, ctx) => {
  const names = evaluation.dimensions.map(({ dimension }) => dimension);
  if (new Set(names).size !== names.length) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: "evaluation dimensions must be unique" });
  }
  const rejectedConstraint = evaluation.hardConstraints.some(({ result }) => result === "rejected");
  const unknownConstraint = evaluation.hardConstraints.some(({ result }) => result === "unknown");
  if (evaluation.eligibility === "eligible" && (rejectedConstraint || unknownConstraint)) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: "eligible strategies require all hard constraints to pass" });
  }
  if (evaluation.eligibility === "ineligible" && !rejectedConstraint) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: "ineligible strategies require a rejected hard constraint" });
  }
  if (evaluation.eligibility === "unknown" && !unknownConstraint) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: "unknown eligibility requires an unknown hard constraint" });
  }
  if (evaluation.rankingScore !== null && evaluation.scorePolicyVersion === null) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: "ranked score requires an explicit policy version" });
  }
});
export type MissionStrategyEvaluation = z.infer<typeof MissionStrategyEvaluationSchema>;

export const DecisionResultSchema = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("SELECTED"),
    selectedStrategyId: boundedString(200),
    rationaleCodes: z.array(boundedString(120)).min(1).max(24),
    rejectedStrategyCodes: z.array(boundedString(120)).max(MAX_STRATEGIES),
  }).strict(),
  z.object({
    kind: z.literal("NO_DECISION"),
    selectedStrategyId: z.null(),
    reasonCode: z.enum([
      "insufficient_evidence",
      "no_meaningful_alternative",
      "all_strategies_ineligible",
      "unresolved_contradiction",
      "unknown_capability",
      "evaluation_inconclusive",
    ]),
  }).strict(),
  z.object({
    kind: z.literal("BLOCKED"),
    selectedStrategyId: z.null(),
    reasonCode: z.enum([
      "approval_required",
      "authorization_denied",
      "stale_context",
      "identity_mismatch",
      "unsupported_scenario",
    ]),
  }).strict(),
]);
export type DecisionResult = z.infer<typeof DecisionResultSchema>;

const DecisionLifecycleEventSchema = z.object({
  stage: z.enum([
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
  ]),
  at: isoTimestamp,
  referenceId: boundedString(200).nullable(),
}).strict();

const DECISION_LIFECYCLE_ORDER = [
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
] as const;

export const MissionDecisionTraceSchema = boundedDecisionContract(z.object({
  schemaVersion: z.literal(MISSION_DECISION_SCHEMA_VERSION),
  decisionId: z.string().regex(/^[a-f0-9]{64}$/),
  context: MissionDecisionContextSchema,
  contextHash: z.string().regex(/^[a-f0-9]{64}$/),
  alternatives: z.array(MissionStrategyAlternativeSchema).max(MAX_STRATEGIES),
  differences: z.array(StrategyDifferenceSchema).max((MAX_STRATEGIES * (MAX_STRATEGIES - 1)) / 2),
  evaluations: z.array(MissionStrategyEvaluationSchema).max(MAX_STRATEGIES),
  result: DecisionResultSchema,
  lifecycle: z.array(DecisionLifecycleEventSchema).min(1).max(DECISION_LIFECYCLE_ORDER.length),
  uncertaintyCodes: z.array(boundedString(120)).max(32),
  decisionConfidence: DecisionConfidenceSchema,
  policyVersion: boundedString(120),
  evaluatorVersion: boundedString(120),
  modelProvenance: z.object({
    providerId: boundedString(120),
    modelId: boundedString(200),
    outputHash: z.string().regex(/^[a-f0-9]{64}$/),
  }).strict().nullable(),
  priorPlanRevision: boundedString(200).nullable(),
  newPlanRevision: boundedString(200).nullable(),
  dispatchRef: boundedString(200).nullable(),
  decidedAt: isoTimestamp,
}).strict(), MAX_DECISION_BYTES).superRefine((trace, ctx) => {
  const { decisionId, ...traceBody } = trace;
  if (canonicalJsonHash(traceBody as Parameters<typeof canonicalJsonHash>[0]) !== decisionId) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: "decision trace ID does not match its contents" });
  }
  const contextHash = hashMissionDecisionContext(trace.context);
  if (contextHash !== trace.contextHash) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: "decision context hash mismatch" });
  }
  const strategyIds = trace.alternatives.map(({ strategyId }) => strategyId);
  if (new Set(strategyIds).size !== strategyIds.length) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: "duplicate strategy identity in decision trace" });
  }
  const alternativeById = new Map(trace.alternatives.map((alternative) => [alternative.strategyId, alternative]));
  const evaluationIds = trace.evaluations.map(({ strategyId }) => strategyId);
  if (new Set(evaluationIds).size !== evaluationIds.length || evaluationIds.some((id) => !strategyIds.includes(id))) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: "decision evaluation references an unknown or duplicate strategy" });
  }
  if (evaluationIds.length !== strategyIds.length) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: "every trace alternative requires one evaluation" });
  }
  for (const evaluation of trace.evaluations) {
    const alternative = alternativeById.get(evaluation.strategyId);
    if (alternative && hashMissionStrategyAlternative(alternative) !== evaluation.strategyHash) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: "evaluation strategy hash does not match its alternative" });
    }
  }
  if (trace.result.kind === "SELECTED") {
    const selectedEvaluation = trace.evaluations.find(({ strategyId }) => strategyId === trace.result.selectedStrategyId);
    if (!strategyIds.includes(trace.result.selectedStrategyId) || selectedEvaluation?.eligibility !== "eligible") {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: "selected strategy must exist and satisfy hard constraints" });
    }
  }
  const lifecycleStages = trace.lifecycle.map(({ stage }) => stage);
  const lifecycleOrder = lifecycleStages.map((stage) => DECISION_LIFECYCLE_ORDER.indexOf(stage));
  if (
    new Set(lifecycleStages).size !== lifecycleStages.length
    || lifecycleOrder.some((order, index) => index > 0 && order <= lifecycleOrder[index - 1]!)
  ) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: "decision lifecycle stages must be unique and ordered" });
  }
  for (const event of trace.lifecycle) {
    if (
      ["APPROVED", "PLAN_APPLIED", "DISPATCHED", "EXECUTED", "ACCEPTED", "VERIFIED"].includes(event.stage)
      && event.referenceId === null
    ) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: "approval and execution lifecycle stages require a durable reference" });
    }
  }
  if (trace.result.kind === "SELECTED" && !lifecycleStages.includes("SELECTED")) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: "selected result requires a SELECTED lifecycle event" });
  }
  if (trace.result.kind !== "SELECTED" && lifecycleStages.some((stage) =>
    ["SELECTED", "APPROVED", "PLAN_APPLIED", "DISPATCHED", "EXECUTED", "ACCEPTED", "VERIFIED", "EVALUATED_AFTER_EXECUTION"].includes(stage),
  )) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: "unselected results cannot claim later lifecycle stages" });
  }
  const dispatchEvent = trace.lifecycle.find(({ stage }) => stage === "DISPATCHED");
  if ((dispatchEvent?.referenceId ?? null) !== trace.dispatchRef) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: "dispatch reference must match the DISPATCHED lifecycle event" });
  }
  for (const difference of trace.differences) {
    if (!strategyIds.includes(difference.leftStrategyId) || !strategyIds.includes(difference.rightStrategyId)) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: "strategy difference references an unknown alternative" });
    }
  }
  if (trace.priorPlanRevision !== trace.context.identity.priorPlanRevision) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: "trace prior plan revision must match context identity" });
  }
});
export type MissionDecisionTrace = z.infer<typeof MissionDecisionTraceSchema>;

export const MissionStrategyOutcomeEvaluationSchema = boundedDecisionContract(z.object({
  schemaVersion: z.literal(MISSION_DECISION_SCHEMA_VERSION),
  decisionId: z.string().regex(/^[a-f0-9]{64}$/),
  missionId: boundedString(200),
  goalId: boundedString(200),
  executionId: boundedString(200),
  attempt: z.number().int().nonnegative(),
  planRevision: boundedString(200),
  selectedStrategyId: boundedString(200),
  outcome: z.enum(["ACHIEVED", "NOT_ACHIEVED", "INCONCLUSIVE"]),
  acceptanceId: boundedString(200).nullable(),
  effectBundleId: boundedString(200).nullable(),
  observedEffectCodes: z.array(boundedString(120)).max(MAX_DECISION_ITEMS),
  supportingEvidenceIds: z.array(boundedString(200)).max(MAX_EVIDENCE_REFS),
  contradictingEvidenceIds: z.array(boundedString(200)).max(MAX_EVIDENCE_REFS),
  worldStateRevision: boundedString(200).nullable(),
  evaluatedAt: isoTimestamp,
  limitationCodes: z.array(boundedString(120)).max(24),
}).strict(), MAX_DECISION_BYTES).superRefine((evaluation, ctx) => {
  if (
    evaluation.outcome === "ACHIEVED"
    && (
      evaluation.acceptanceId === null
      || evaluation.effectBundleId === null
      || evaluation.supportingEvidenceIds.length === 0
      || evaluation.observedEffectCodes.length === 0
    )
  ) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: "achieved outcome requires acceptance, effect, and supporting evidence identities",
    });
  }
  if (evaluation.outcome === "NOT_ACHIEVED" && evaluation.contradictingEvidenceIds.length === 0) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: "not-achieved outcome requires contradicting evidence",
    });
  }
});
export type MissionStrategyOutcomeEvaluation = z.infer<typeof MissionStrategyOutcomeEvaluationSchema>;

const MissionStrategyPlanOutcomeExecutionSchema = z.object({
  goalId: boundedString(200),
  taskId: boundedString(200).nullable(),
  executionId: boundedString(200),
  attempt: z.number().int().nonnegative(),
  terminal: z.boolean(),
  acceptanceId: boundedString(200).nullable(),
  effectBundleId: boundedString(200).nullable(),
  canonicalProofId: boundedString(200).nullable(),
  canonicalProofHash: z.string().regex(/^[a-f0-9]{64}$/).nullable(),
  worldStateRevision: boundedString(200).nullable(),
  outcome: z.enum(["ACHIEVED", "NOT_ACHIEVED", "INCONCLUSIVE"]),
  evidenceHash: z.string().regex(/^[a-f0-9]{64}$/),
  observedEffectCodes: z.array(boundedString(120)).max(MAX_DECISION_ITEMS),
  contradictedEffectCodes: z.array(boundedString(120)).max(MAX_DECISION_ITEMS),
}).strict();

export const MissionStrategyPlanOutcomeEvaluationSchema = boundedDecisionContract(z.object({
  schemaVersion: z.literal(MISSION_DECISION_SCHEMA_VERSION),
  decisionId: z.string().regex(/^[a-f0-9]{64}$/),
  projectId: boundedString(200),
  missionId: boundedString(200),
  sourceGoalId: boundedString(200),
  planRevision: boundedString(200),
  selectedStrategyId: boundedString(200),
  dispatchBatchId: boundedString(200),
  dispatchManifestHash: z.string().regex(/^[a-f0-9]{64}$/),
  dispatchBatchState: z.enum(["dispatched", "partial"]),
  outcome: z.enum(["ACHIEVED", "NOT_ACHIEVED", "INCONCLUSIVE"]),
  planGoalIds: z.array(boundedString(200)).max(64),
  requiredGoalIds: z.array(boundedString(200)).max(64),
  planTaskIds: z.array(boundedString(200)).max(256),
  rootGoalIds: z.array(boundedString(200)).max(64),
  goalStates: z.array(z.object({
    goalId: boundedString(200),
    terminal: z.boolean(),
    taskIds: z.array(boundedString(200)).max(256),
    executionIds: z.array(boundedString(200)).max(128),
  }).strict()).max(64),
  taskStates: z.array(z.object({
    taskId: boundedString(200),
    goalId: boundedString(200),
    terminal: z.boolean(),
    executionIds: z.array(boundedString(200)).max(128),
  }).strict()).max(256),
  dispatchItems: z.array(z.object({
    position: z.number().int().nonnegative(),
    goalId: boundedString(200),
    executionId: boundedString(200).nullable(),
    runStatus: z.enum(["scheduled", "waiting", "blocked", "completed", "conflict"]),
  }).strict()).max(64),
  executions: z.array(MissionStrategyPlanOutcomeExecutionSchema).max(512),
  expectedEffectCodes: z.array(boundedString(120)).max(MAX_DECISION_ITEMS),
  observedEffectCodes: z.array(boundedString(120)).max(MAX_DECISION_ITEMS),
  contradictedEffectCodes: z.array(boundedString(120)).max(MAX_DECISION_ITEMS),
  finalWorldState: z.object({
    revision: boundedString(200).nullable(),
    continuityVerified: z.boolean(),
    evidenceHash: z.string().regex(/^[a-f0-9]{64}$/).nullable(),
    observedEffectCodes: z.array(boundedString(120)).max(MAX_DECISION_ITEMS),
    contradictedEffectCodes: z.array(boundedString(120)).max(MAX_DECISION_ITEMS),
  }).strict(),
  evidenceSetHash: z.string().regex(/^[a-f0-9]{64}$/),
  evaluatedAt: isoTimestamp,
  limitationCodes: z.array(boundedString(120)).max(24),
}).strict(), MAX_DECISION_BYTES).superRefine((evaluation, ctx) => {
  const unique = (values: readonly string[]) => new Set(values).size === values.length;
  const sortedUnique = (values: readonly string[]) =>
    unique(values) && values.every((value, index) => index === 0 || values[index - 1].localeCompare(value) < 0);
  const goalIds = new Set(evaluation.planGoalIds);
  const requiredGoalIds = new Set(evaluation.requiredGoalIds);
  const taskIds = new Set(evaluation.planTaskIds);
  const goalStateIds = evaluation.goalStates.map(({ goalId }) => goalId);
  const taskStateIds = evaluation.taskStates.map(({ taskId }) => taskId);
  const executionIdentities = evaluation.executions.map(({ executionId, attempt }) =>
    `${executionId}\n${attempt}`);
  const rootIdsFromDispatch = evaluation.dispatchItems.map(({ goalId }) => goalId);
  if (
    !sortedUnique(evaluation.planGoalIds)
    || !sortedUnique(evaluation.requiredGoalIds)
    || !sortedUnique(evaluation.planTaskIds)
    || !sortedUnique(evaluation.rootGoalIds)
    || !unique(goalStateIds)
    || !unique(taskStateIds)
    || !unique(executionIdentities)
    || !unique(rootIdsFromDispatch)
    || evaluation.dispatchItems.some(({ position }, index) => position !== index)
    || evaluation.goalStates.some((goal) => !unique(goal.taskIds) || !unique(goal.executionIds))
    || evaluation.taskStates.some((task) => !unique(task.executionIds))
    || (evaluation.outcome !== "INCONCLUSIVE" && (
      goalStateIds.length !== evaluation.planGoalIds.length
      || evaluation.planGoalIds.some((goalId) => !goalStateIds.includes(goalId))
      || evaluation.requiredGoalIds.some((goalId) => !goalIds.has(goalId))
      || evaluation.rootGoalIds.some((goalId) => !goalIds.has(goalId))
      || taskStateIds.length !== evaluation.planTaskIds.length
      || evaluation.planTaskIds.some((taskId) => !taskStateIds.includes(taskId))
      || rootIdsFromDispatch.length !== evaluation.rootGoalIds.length
      || evaluation.rootGoalIds.some((goalId) => !rootIdsFromDispatch.includes(goalId))
      || evaluation.goalStates.some((goal) =>
        !goalIds.has(goal.goalId)
        || goal.taskIds.some((taskId) => !taskIds.has(taskId)))
      || evaluation.taskStates.some((task) =>
        !taskIds.has(task.taskId)
        || !goalIds.has(task.goalId))
      || evaluation.executions.some((execution) =>
        !goalIds.has(execution.goalId)
        || (execution.taskId !== null && (
          !taskIds.has(execution.taskId)
          || evaluation.taskStates.find(({ taskId }) => taskId === execution.taskId)?.goalId
            !== execution.goalId
        )))
    ))
  ) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: "plan outcome must bind unique Goal, Task, root, and Execution identities",
    });
  }
  if (evaluation.outcome !== "INCONCLUSIVE") {
    for (const goal of evaluation.goalStates) {
      const expectedTaskIds = evaluation.taskStates
        .filter((task) => task.goalId === goal.goalId)
        .map(({ taskId }) => taskId)
        .sort();
      if ([...goal.taskIds].sort().join("\n") !== expectedTaskIds.join("\n")) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: "Goal Task set must exactly match the plan outcome Task rows",
        });
      }
    }
    for (const task of evaluation.taskStates) {
      const expectedExecutionIds = evaluation.executions
        .filter((execution) => execution.taskId === task.taskId)
        .map(({ executionId }) => executionId)
        .sort();
      if ([...task.executionIds].sort().join("\n") !== expectedExecutionIds.join("\n")) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: "Task Execution set must exactly match the plan outcome Execution rows",
        });
      }
    }
    for (const goal of evaluation.goalStates) {
      const expectedExecutionIds = evaluation.executions
        .filter((execution) => execution.goalId === goal.goalId && execution.taskId === null)
        .map(({ executionId }) => executionId)
        .sort();
      if ([...goal.executionIds].sort().join("\n") !== expectedExecutionIds.join("\n")) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: "Goal Execution set must exactly match the plan outcome Execution rows",
        });
      }
    }
    for (const item of evaluation.dispatchItems) {
      if (
        item.executionId !== null
        && !evaluation.executions.some((execution) =>
          execution.goalId === item.goalId && execution.executionId === item.executionId)
      ) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: "dispatch root Execution must match its plan outcome identity",
        });
      }
    }
  }
  if (evaluation.outcome === "ACHIEVED") {
    const requiredExecutions = evaluation.executions.filter((execution) =>
      requiredGoalIds.has(execution.goalId));
    if (
      evaluation.planGoalIds.length === 0
      || evaluation.rootGoalIds.length === 0
      || evaluation.dispatchBatchState !== "dispatched"
      || evaluation.dispatchItems.some(({ executionId }) => executionId === null)
      || evaluation.goalStates.some(({ terminal }) => !terminal)
      || evaluation.taskStates.some(({ terminal }) => !terminal)
      || evaluation.executions.some(({ terminal }) => !terminal)
      || !evaluation.finalWorldState.continuityVerified
      || !evaluation.finalWorldState.revision
      || !evaluation.finalWorldState.evidenceHash
      || evaluation.requiredGoalIds.some((goalId) =>
        !requiredExecutions.some((execution) => execution.goalId === goalId))
      || requiredExecutions.length === 0
      || requiredExecutions.some((execution) =>
        execution.outcome !== "ACHIEVED"
        || !execution.acceptanceId
        || !execution.effectBundleId
        || !execution.canonicalProofId
        || !execution.canonicalProofHash
        || !execution.worldStateRevision)
      || evaluation.expectedEffectCodes.length === 0
      || evaluation.expectedEffectCodes.some((code) =>
        !evaluation.finalWorldState.observedEffectCodes.includes(code))
      || evaluation.expectedEffectCodes.some((code) =>
        !evaluation.observedEffectCodes.includes(code))
      || evaluation.expectedEffectCodes.some((code) => evaluation.contradictedEffectCodes.includes(code))
      || evaluation.expectedEffectCodes.some((code) =>
        evaluation.finalWorldState.contradictedEffectCodes.includes(code))
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "ACHIEVED requires terminal plan scope, exact proof-bound executions, and all expected effects",
      });
    }
  }
  if (
    evaluation.outcome === "NOT_ACHIEVED"
    && (
      evaluation.planGoalIds.length === 0
      || evaluation.rootGoalIds.length === 0
      || evaluation.dispatchBatchState !== "dispatched"
      || evaluation.dispatchItems.some(({ executionId }) => executionId === null)
      || evaluation.goalStates.some(({ terminal }) => !terminal)
      || evaluation.taskStates.some(({ terminal }) => !terminal)
      || evaluation.executions.some(({ terminal }) => !terminal)
      || !evaluation.finalWorldState.continuityVerified
      || !evaluation.finalWorldState.revision
      || !evaluation.finalWorldState.evidenceHash
      || evaluation.expectedEffectCodes.length === 0
      || !evaluation.executions.some((execution) =>
        requiredGoalIds.has(execution.goalId)
        && execution.outcome === "NOT_ACHIEVED"
        && Boolean(execution.acceptanceId)
        && Boolean(execution.effectBundleId))
      || evaluation.expectedEffectCodes.some((code) => !evaluation.contradictedEffectCodes.includes(code))
      || evaluation.expectedEffectCodes.some((code) => evaluation.observedEffectCodes.includes(code))
      || evaluation.expectedEffectCodes.some((code) =>
        !evaluation.finalWorldState.contradictedEffectCodes.includes(code))
      || evaluation.expectedEffectCodes.some((code) =>
        evaluation.finalWorldState.observedEffectCodes.includes(code))
    )
  ) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: "NOT_ACHIEVED requires terminal scope and direct contradiction of every expected effect",
    });
  }
  if (evaluation.outcome === "INCONCLUSIVE" && evaluation.limitationCodes.length === 0) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: "INCONCLUSIVE requires an explicit limitation",
    });
  }
});
export type MissionStrategyPlanOutcomeEvaluation =
  z.infer<typeof MissionStrategyPlanOutcomeEvaluationSchema>;

export function hashMissionDecisionContext(context: MissionDecisionContext): string {
  return canonicalJsonHash(context as Parameters<typeof canonicalJsonHash>[0]);
}

export function hashMissionStrategyAlternative(strategy: MissionStrategyAlternative): string {
  return canonicalJsonHash(strategy as Parameters<typeof canonicalJsonHash>[0]);
}

export function hashMissionDecisionTrace(trace: Omit<MissionDecisionTrace, "decisionId">): string {
  return canonicalJsonHash(trace as Parameters<typeof canonicalJsonHash>[0]);
}
