import { z } from "zod";
import {
  MissionDecisionContextSchema,
  MissionStrategyAlternativeSchema,
  MissionStrategyEvaluationSchema,
  StrategyEvaluationDimensionSchema,
  type DecisionResult,
  type MissionDecisionContext,
  type MissionStrategyAlternative,
  type MissionStrategyEvaluation,
  type StrategyEvaluationDimension,
} from "./mission-decision-contract.js";
import {
  compareMissionStrategyAlternatives,
} from "./mission-strategy-generation.js";
import { hashMissionStrategyAlternative } from "./mission-decision-contract.js";

export const MISSION_STRATEGY_EVALUATOR_VERSION = "pareto-conservative-v1";
const MAX_STRATEGIES = 8;
const EMPTY_CONFIDENCE = { status: "not_applicable" as const, value: null, calibrationRef: null };
const UNKNOWN_CONFIDENCE = { status: "unknown" as const, value: null, calibrationRef: null };
const CRITICAL_DIMENSIONS: StrategyEvaluationDimension[] = [
  "objective_alignment",
  "evidence_strength",
  "preconditions_satisfaction",
  "capability_availability",
  "failure_risk",
  "reversibility",
  "side_effect_risk",
  "human_intervention",
  "validation_strength",
  "world_state_compatibility",
];

const EvaluationInputSchema = z.object({
  context: MissionDecisionContextSchema,
  alternatives: z.array(MissionStrategyAlternativeSchema).max(MAX_STRATEGIES),
  evaluatedAt: z.string().datetime({ offset: true }),
}).strict();

type Constraint = MissionStrategyEvaluation["hardConstraints"][number];
type Dimension = MissionStrategyEvaluation["dimensions"][number];
type Candidate = {
  strategy: MissionStrategyAlternative;
  constraints: Constraint[];
  eligibility: MissionStrategyEvaluation["eligibility"];
  dimensions: Dimension[];
};

export type StrategyPairwiseComparison = {
  leftStrategyId: string;
  rightStrategyId: string;
  relation: "left_dominates" | "right_dominates" | "equivalent" | "incomparable";
  comparedDimensions: StrategyEvaluationDimension[];
  unavailableDimensions: StrategyEvaluationDimension[];
};

export type MissionStrategyEvaluationResult = {
  policyVersion: typeof MISSION_STRATEGY_EVALUATOR_VERSION;
  evaluations: MissionStrategyEvaluation[];
  pairwiseComparisons: StrategyPairwiseComparison[];
  result: DecisionResult;
};

function makeConstraint(
  constraintCode: string,
  result: Constraint["result"],
  evidenceRefIds: string[] = [],
  reasonCodes: string[] = [],
): Constraint {
  return { constraintCode, result, evidenceRefIds, reasonCodes };
}

function currentEligibleEvidence(context: MissionDecisionContext, evidenceId: string): boolean {
  const ref = context.evidenceRefs.find(({ evidenceId: id }) => id === evidenceId);
  return Boolean(
    ref
      && ref.eligibility === "eligible"
      && ref.freshness === "fresh"
      && ref.scope.projectId === context.identity.projectId
      && (ref.scope.missionId === null || ref.scope.missionId === context.identity.missionId)
      && (ref.scope.goalId === null || ref.scope.goalId === context.identity.goalId)
      && (ref.scope.executionId === null || ref.scope.executionId === context.identity.sourceExecutionId)
      && (ref.scope.attempt === null || ref.scope.attempt === context.identity.sourceAttempt),
  );
}

function evidenceIdsForKind(context: MissionDecisionContext, kind: string): string[] {
  return context.evidenceRefs
    .filter((ref) => ref.kind === kind && currentEligibleEvidence(context, ref.evidenceId))
    .map(({ evidenceId }) => evidenceId)
    .sort();
}

function approvalMatchesStrategy(
  context: MissionDecisionContext,
  strategy: MissionStrategyAlternative,
): boolean {
  return context.approval.status === "granted"
    && context.approval.approvedStrategyId === strategy.strategyId
    && context.approval.approvedStrategyHash === hashMissionStrategyAlternative(strategy)
    && context.approval.approvedPlanRevision === context.identity.priorPlanRevision;
}

function evaluateConstraints(
  context: MissionDecisionContext,
  strategy: MissionStrategyAlternative,
): Constraint[] {
  const constraints: Constraint[] = [];
  const add = (code: string, result: Constraint["result"], refs: string[] = [], reason?: string) =>
    constraints.push(makeConstraint(code, result, refs, reason ? [reason] : []));

  if (context.authorization.status === "allowed" && context.authorization.policyRef !== null) {
    add("authorization", "passed", [], "server_policy_allows");
  } else if (context.authorization.status === "denied") {
    add("authorization", "rejected", [], "authorization_denied");
  } else {
    add("authorization", "unknown", [], "authorization_not_proven");
  }

  add(
    "objective_alignment",
    strategy.intendedObjectiveCode === context.objectiveCode ? "passed" : "rejected",
    [],
    strategy.intendedObjectiveCode === context.objectiveCode ? "exact_objective_match" : "objective_mismatch",
  );

  if (context.approval.status === "denied") {
    add("approval", "rejected", [], "approval_denied");
  } else if (strategy.approvalRequirement === "required") {
    add(
      "approval",
      approvalMatchesStrategy(context, strategy)
        ? "passed"
        : context.approval.status === "granted"
          ? "rejected"
          : "unknown",
      [],
      approvalMatchesStrategy(context, strategy)
        ? "approval_reference_bound_to_strategy_and_plan"
        : context.approval.status === "granted"
          ? "approval_binding_mismatch"
          : "approval_not_granted",
    );
  } else if (strategy.approvalRequirement === "not_required") {
    add(
      "approval",
      context.approval.status === "not_required" || context.approval.status === "granted"
        ? "passed"
        : "unknown",
      [],
      "approval_policy_checked",
    );
  } else {
    add("approval", "unknown", [], "strategy_approval_requirement_unknown");
  }

  const capabilityResults = strategy.requiredCapabilities.map((capability) => {
    if (context.availableCapabilities.includes(capability)) return "passed" as const;
    if (context.unavailableCapabilities.includes(capability)) return "rejected" as const;
    return "unknown" as const;
  });
  add(
    "required_capabilities",
    capabilityResults.includes("rejected")
      ? "rejected"
      : capabilityResults.includes("unknown")
        ? "unknown"
        : "passed",
    [],
    capabilityResults.includes("rejected")
      ? "required_capability_unavailable"
      : capabilityResults.includes("unknown")
        ? "required_capability_not_verified"
        : "all_required_capabilities_available",
  );

  const requiredEvidence = strategy.requiredEvidenceKinds.map((kind) => ({
    kind,
    evidenceIds: evidenceIdsForKind(context, kind),
  }));
  add(
    "required_evidence",
    requiredEvidence.some(({ evidenceIds }) => evidenceIds.length === 0) ? "rejected" : "passed",
    [...new Set(requiredEvidence.flatMap(({ evidenceIds }) => evidenceIds))].sort(),
    requiredEvidence.some(({ evidenceIds }) => evidenceIds.length === 0)
      ? "required_evidence_missing_or_ineligible"
      : "required_evidence_current_and_scope_bound",
  );

  const preconditionFindings = new Map(context.preconditionFindings.map((finding) => [finding.code, finding]));
  const preconditionResults = strategy.preconditionCodes.map((code) => {
    const finding = preconditionFindings.get(code);
    if (!finding || finding.status === "unknown") return { result: "unknown" as const, refs: [] };
    const refs = finding.evidenceRefIds.filter((id) => currentEligibleEvidence(context, id));
    if (finding.status === "failed") return { result: "rejected" as const, refs };
    return refs.length > 0 ? { result: "passed" as const, refs } : { result: "unknown" as const, refs: [] };
  });
  add(
    "preconditions",
    preconditionResults.some(({ result }) => result === "rejected")
      ? "rejected"
      : preconditionResults.some(({ result }) => result === "unknown")
        ? "unknown"
        : "passed",
    [...new Set(preconditionResults.flatMap(({ refs }) => refs))].sort(),
    preconditionResults.some(({ result }) => result === "rejected")
      ? "precondition_failed"
      : preconditionResults.some(({ result }) => result === "unknown")
        ? "precondition_not_proven"
        : "all_preconditions_evidence_bound",
  );

  const worldStateFinding = preconditionFindings.get("world_state_revision_matches");
  const worldStateRefs = worldStateFinding?.evidenceRefIds.filter((id) => currentEligibleEvidence(context, id)) ?? [];
  add(
    "world_state_revision",
    context.identity.worldStateRevision === null || !worldStateFinding || worldStateFinding.status === "unknown"
      ? "unknown"
      : worldStateFinding.status === "failed"
        ? "rejected"
        : worldStateRefs.length > 0
          ? "passed"
          : "unknown",
    worldStateRefs,
    "world_state_revision_match_must_be_current_and_evidence_bound",
  );

  const unknownEffect = strategy.expectedActions.some(({ effectClass }) => effectClass === "unknown");
  add(
    "effect_classification",
    unknownEffect ? "unknown" : "passed",
    [],
    unknownEffect ? "effect_class_unknown" : "effect_class_server_declared",
  );

  add(
    "risk_classification",
    strategy.risk === "unknown" ? "unknown" : strategy.risk === "high" ? "rejected" : "passed",
    [],
    strategy.risk === "unknown"
      ? "risk_not_assessed"
      : strategy.risk === "high"
        ? "risk_requires_manual_review"
        : "risk_band_declared",
  );
  add(
    "reversibility",
    strategy.reversibility === "unknown" ? "unknown" : "passed",
    [],
    strategy.reversibility === "unknown" ? "reversibility_not_assessed" : "reversibility_declared",
  );
  add(
    "validation",
    strategy.validationProcedureCodes.length > 0 ? "passed" : "rejected",
    [],
    strategy.validationProcedureCodes.length > 0 ? "validation_procedure_present" : "validation_procedure_missing",
  );

  if (context.identity.trigger === "recovery") {
    const diagnosisEvidence = context.failureDiagnoses.flatMap(({ evidenceIds }) =>
      evidenceIds.filter((id) => currentEligibleEvidence(context, id)),
    );
    add(
      "failure_diagnosis_evidence",
      diagnosisEvidence.length > 0 ? "passed" : "rejected",
      diagnosisEvidence,
      diagnosisEvidence.length > 0 ? "diagnosis_bound_to_current_evidence" : "recovery_diagnosis_not_evidence_bound",
    );
  }
  if (context.failureDiagnoses.some(({ kind }) => kind === "contradictory_observations")) {
    add("contradictory_evidence", "unknown", [], "contradictions_require_resolution");
  }
  if (context.unresolvedQuestionCodes.length > 0) {
    add("unresolved_questions", "unknown", [], "decision_context_has_unresolved_questions");
  }
  const missingObservationCodes = context.requiredObservationCodes.filter((code) =>
    !context.evidenceRefs.some((ref) =>
      currentEligibleEvidence(context, ref.evidenceId)
      && (ref.kind === code || ref.provenanceCode === code),
    ),
  );
  if (context.requiredObservationCodes.length > 0) {
    add(
      "required_observations",
      missingObservationCodes.length === 0 ? "passed" : "unknown",
      context.evidenceRefs
        .filter((ref) => context.requiredObservationCodes.includes(ref.kind) || context.requiredObservationCodes.includes(ref.provenanceCode))
        .filter((ref) => currentEligibleEvidence(context, ref.evidenceId))
        .map(({ evidenceId }) => evidenceId),
      missingObservationCodes.length === 0 ? "required_observations_current" : "required_observation_missing",
    );
  }

  if (strategy.source === "strategy_candidate") {
    add("candidate_replay_status", "unknown", [], "candidate_requires_current_replay_gate");
  }
  return constraints;
}

function eligibilityOf(constraints: Constraint[]): MissionStrategyEvaluation["eligibility"] {
  if (constraints.some(({ result }) => result === "rejected")) return "ineligible";
  if (constraints.some(({ result }) => result === "unknown")) return "unknown";
  return "eligible";
}

function confidenceFor(status: Dimension["status"]): Dimension["confidence"] {
  if (status === "unknown") return UNKNOWN_CONFIDENCE;
  if (status === "not_applicable") return EMPTY_CONFIDENCE;
  return { status: "not_applicable", value: null, calibrationRef: null };
}

function dimension(
  name: StrategyEvaluationDimension,
  status: Dimension["status"],
  normalizedValue: number | null,
  source: Dimension["source"],
  evidenceRefIds: string[] = [],
  reasonCodes: string[] = [],
): Dimension {
  return {
    dimension: name,
    status,
    normalizedValue,
    source,
    evidenceRefIds: [...new Set(evidenceRefIds)].sort(),
    confidence: confidenceFor(status),
    reasonCodes,
  };
}

function unknownDimension(name: StrategyEvaluationDimension, reasonCode: string): Dimension {
  return dimension(name, "unknown", null, "unknown", [], [reasonCode]);
}

function estimateCohortScores(
  candidates: Candidate[],
  field: "expectedExecutionCost" | "durationEstimate",
  context: MissionDecisionContext,
): Map<string, Dimension> {
  const scores = new Map<string, Dimension>();
  const eligible = candidates.filter(({ eligibility }) => eligibility === "eligible");
  const estimates = eligible.map(({ strategy }) => strategy[field]);
  if (
    eligible.length === 0
    || estimates.some((estimate) =>
      estimate.status !== "measured"
      || estimate.value === null
      || estimate.evidenceRefIds.length === 0
      || estimate.evidenceRefIds.some((id) => !currentEligibleEvidence(context, id)),
    )
    || new Set(estimates.map(({ unit }) => unit)).size !== 1
  ) {
    for (const candidate of candidates) {
      scores.set(candidate.strategy.strategyId, unknownDimension(
        field === "expectedExecutionCost" ? "expected_execution_cost" : "expected_duration",
        "comparable_measured_cohort_estimate_unavailable",
      ));
    }
    return scores;
  }
  const values = estimates.map(({ value }) => value!);
  const minimum = Math.min(...values);
  const maximum = Math.max(...values);
  for (let index = 0; index < eligible.length; index += 1) {
    const { strategy } = eligible[index]!;
    const estimate = strategy[field];
    const score = maximum === minimum ? 1 : 1 - ((estimate.value! - minimum) / (maximum - minimum));
    scores.set(
      strategy.strategyId,
      dimension(
        field === "expectedExecutionCost" ? "expected_execution_cost" : "expected_duration",
        "measured",
        score,
        "measured_resource",
        estimate.evidenceRefIds,
        ["cohort_relative_min_max_lower_is_better"],
      ),
    );
  }
  for (const candidate of candidates) {
    if (!scores.has(candidate.strategy.strategyId)) {
      scores.set(candidate.strategy.strategyId, unknownDimension(
        field === "expectedExecutionCost" ? "expected_execution_cost" : "expected_duration",
        "ineligible_strategy_not_compared",
      ));
    }
  }
  return scores;
}

function relativeStructuralScores(candidates: Candidate[]): Map<string, Dimension> {
  const eligible = candidates.filter(({ eligibility }) => eligibility === "eligible");
  const complexity = eligible.map(({ strategy }) => ({
    strategy,
    count: strategy.expectedActions.length
      + strategy.stepDependencies.reduce((sum, dependency) => sum + dependency.dependsOnStepIds.length, 0),
  }));
  const scores = new Map<string, Dimension>();
  const minimum = Math.min(...complexity.map(({ count }) => count));
  const maximum = Math.max(...complexity.map(({ count }) => count));
  for (const { strategy, count } of complexity) {
    scores.set(strategy.strategyId, dimension(
      "recovery_complexity",
      "measured",
      maximum === minimum ? 1 : 1 - ((count - minimum) / (maximum - minimum)),
      "deterministic_rule",
      [],
      ["cohort_relative_action_and_dependency_count_lower_is_simpler"],
    ));
  }
  for (const candidate of candidates) {
    if (!scores.has(candidate.strategy.strategyId)) {
      scores.set(candidate.strategy.strategyId, unknownDimension("recovery_complexity", "ineligible_strategy_not_compared"));
    }
  }
  return scores;
}

function riskScore(risk: MissionStrategyAlternative["risk"]): number | null {
  return risk === "low" ? 1 : risk === "medium" ? 0.5 : risk === "high" ? 0 : null;
}

function sideEffectScore(strategy: MissionStrategyAlternative): number | null {
  const scores = strategy.expectedActions.map(({ effectClass }) => {
    if (effectClass === "read_only") return 1;
    if (effectClass === "reversible_mutation") return 0.5;
    if (effectClass === "irreversible_mutation" || effectClass === "external_effect") return 0;
    return null;
  });
  return scores.length === 0 || scores.some((score) => score === null)
    ? null
    : Math.min(...scores as number[]);
}

function buildDimensions(
  context: MissionDecisionContext,
  candidate: Candidate,
  costScores: Map<string, Dimension>,
  durationScores: Map<string, Dimension>,
  complexityScores: Map<string, Dimension>,
): Dimension[] {
  const { strategy } = candidate;
  const requiredEvidence = strategy.requiredEvidenceKinds;
  const evidencePairs = requiredEvidence.map((kind) => ({ kind, ids: evidenceIdsForKind(context, kind) }));
  const evidenceScore = requiredEvidence.length === 0
    ? null
    : evidencePairs.filter(({ ids }) => ids.length > 0).length / requiredEvidence.length;
  const preconditionFindings = new Map(context.preconditionFindings.map((finding) => [finding.code, finding]));
  const preconditionValues = strategy.preconditionCodes.map((code) => {
    const finding = preconditionFindings.get(code);
    if (!finding || finding.status === "unknown") return null;
    const validEvidence = finding.evidenceRefIds.some((id) => currentEligibleEvidence(context, id));
    return validEvidence ? (finding.status === "satisfied" ? 1 : 0) : null;
  });
  const preconditionScore = strategy.preconditionCodes.length === 0
    ? 1
    : preconditionValues.some((value) => value === null)
      ? null
      : preconditionValues.reduce<number>((sum, value) => sum + value!, 0) / preconditionValues.length;
  const capabilityResults = strategy.requiredCapabilities.map((capability) =>
    context.availableCapabilities.includes(capability)
      ? 1
      : context.unavailableCapabilities.includes(capability)
        ? 0
        : null,
  );
  const capabilityScore = strategy.requiredCapabilities.length === 0
    ? null
    : capabilityResults.some((value) => value === null)
      ? null
      : capabilityResults.reduce<number>((sum, value) => sum + value!, 0) / capabilityResults.length;
  const worldFinding = preconditionFindings.get("world_state_revision_matches");
  const worldEvidenceValid = worldFinding?.evidenceRefIds.some((id) => currentEligibleEvidence(context, id)) ?? false;
  const worldScore = context.identity.worldStateRevision === null || !worldFinding || !worldEvidenceValid
    ? null
    : worldFinding.status === "satisfied"
      ? 1
      : worldFinding.status === "failed"
        ? 0
        : null;
  const sideEffects = sideEffectScore(strategy);
  const risk = riskScore(strategy.risk);
  const reversibility = strategy.reversibility === "reversible"
    ? 1
    : strategy.reversibility === "partially_reversible"
      ? 0.5
      : strategy.reversibility === "irreversible"
        ? 0
        : null;
  const validation = strategy.validationProcedureCodes.length > 0 ? 1 : 0;
  const approvalScore = strategy.approvalRequirement === "not_required"
    || (strategy.approvalRequirement === "required" && approvalMatchesStrategy(context, strategy))
    ? 1
    : strategy.approvalRequirement === "required"
      ? 0
      : null;
  const evidenceRefs = evidencePairs.flatMap(({ ids }) => ids);
  const preconditionRefs = strategy.preconditionCodes.flatMap((code) =>
    preconditionFindings.get(code)?.evidenceRefIds.filter((id) => currentEligibleEvidence(context, id)) ?? [],
  );
  const result = [
    dimension("objective_alignment", "measured", strategy.intendedObjectiveCode === context.objectiveCode ? 1 : 0, "deterministic_rule", [], ["exact_objective_code_match"]),
    requiredEvidence.length === 0
      ? dimension("evidence_strength", "not_applicable", null, "not_applicable", [], ["no_evidence_kinds_required"])
      : dimension("evidence_strength", "measured", evidenceScore, "accepted_evidence", evidenceRefs, ["current_scope_bound_required_evidence_coverage"]),
    preconditionScore === null
      ? unknownDimension("preconditions_satisfaction", "precondition_state_or_evidence_unknown")
      : dimension("preconditions_satisfaction", "measured", preconditionScore, "accepted_evidence", preconditionRefs, ["evidence_bound_precondition_coverage"]),
    capabilityScore === null
      ? (strategy.requiredCapabilities.length === 0
        ? dimension("capability_availability", "not_applicable", null, "not_applicable", [], ["no_capabilities_required"])
        : unknownDimension("capability_availability", "required_capability_status_unknown"))
      : dimension("capability_availability", "measured", capabilityScore, "deterministic_rule", [], ["server_capability_registry_coverage"]),
    unknownDimension("expected_success_probability", "no_calibrated_outcome_probability"),
    costScores.get(strategy.strategyId) ?? unknownDimension("expected_execution_cost", "estimate_unavailable"),
    durationScores.get(strategy.strategyId) ?? unknownDimension("expected_duration", "estimate_unavailable"),
    risk === null
      ? unknownDimension("failure_risk", "risk_band_unknown")
      : dimension("failure_risk", "estimated", risk, "deterministic_rule", [], ["ordinal_risk_band_score_not_a_probability"]),
    complexityScores.get(strategy.strategyId) ?? unknownDimension("recovery_complexity", "structural_complexity_unavailable"),
    reversibility === null
      ? unknownDimension("reversibility", "reversibility_unknown")
      : dimension("reversibility", "measured", reversibility, "deterministic_rule", [], ["ordinal_reversibility_mapping"]),
    sideEffects === null
      ? unknownDimension("side_effect_risk", "effect_class_unknown")
      : dimension("side_effect_risk", "estimated", sideEffects, "deterministic_rule", [], ["worst_effect_class_ordinal_safety_score"]),
    approvalScore === null
      ? unknownDimension("human_intervention", "approval_requirement_unknown")
      : dimension("human_intervention", "measured", approvalScore, "deterministic_rule", [], ["future_human_intervention_requirement"]),
    dimension("validation_strength", "measured", validation, "deterministic_rule", [], ["validation_procedure_presence_only"]),
    unknownDimension("expected_information_gain", "no_observation_outcome_calibration"),
    worldScore === null
      ? unknownDimension("world_state_compatibility", "current_world_revision_match_unproven")
      : dimension("world_state_compatibility", "measured", worldScore, "accepted_evidence", worldFinding?.evidenceRefIds ?? [], ["explicit_current_world_revision_precondition"]),
  ];
  return StrategyEvaluationDimensionSchema.options.map((name) =>
    result.find((item) => item.dimension === name)!,
  );
}

function compareEvaluations(
  left: MissionStrategyEvaluation,
  right: MissionStrategyEvaluation,
): StrategyPairwiseComparison {
  const leftMap = new Map(left.dimensions.map((item) => [item.dimension, item]));
  const rightMap = new Map(right.dimensions.map((item) => [item.dimension, item]));
  const comparedDimensions: StrategyEvaluationDimension[] = [];
  const unavailableDimensions: StrategyEvaluationDimension[] = [];
  let leftBetter = false;
  let rightBetter = false;
  for (const name of StrategyEvaluationDimensionSchema.options) {
    const a = leftMap.get(name)!;
    const b = rightMap.get(name)!;
    if (
      !["measured", "estimated"].includes(a.status)
      || !["measured", "estimated"].includes(b.status)
      || a.normalizedValue === null
      || b.normalizedValue === null
      || a.source === "advisory_model"
      || b.source === "advisory_model"
    ) {
      unavailableDimensions.push(name);
      continue;
    }
    comparedDimensions.push(name);
    if (a.normalizedValue > b.normalizedValue) leftBetter = true;
    if (a.normalizedValue < b.normalizedValue) rightBetter = true;
  }
  const relation = leftBetter && !rightBetter
    ? "left_dominates"
    : rightBetter && !leftBetter
      ? "right_dominates"
      : leftBetter && rightBetter
        ? "incomparable"
        : unavailableDimensions.length === 0
          ? "equivalent"
          : "incomparable";
  return {
    leftStrategyId: left.strategyId,
    rightStrategyId: right.strategyId,
    relation,
    comparedDimensions,
    unavailableDimensions,
  };
}

function noDecisionReason(
  evaluations: MissionStrategyEvaluation[],
  pairs: StrategyPairwiseComparison[],
): Extract<DecisionResult, { kind: "NO_DECISION" }>["reasonCode"] {
  if (evaluations.some(({ hardConstraints }) => hardConstraints.some(({ constraintCode }) =>
    constraintCode === "required_capabilities",
  ))) {
    if (evaluations.some(({ hardConstraints }) => hardConstraints.some(({ constraintCode, result }) =>
      constraintCode === "required_capabilities" && result === "unknown",
    ))) return "unknown_capability";
  }
  if (evaluations.every(({ eligibility }) => eligibility === "ineligible")) return "all_strategies_ineligible";
  if (evaluations.some(({ eligibility }) => eligibility === "unknown")) return "insufficient_evidence";
  if (pairs.length === 0) return "no_meaningful_alternative";
  return "evaluation_inconclusive";
}

export function evaluateMissionStrategies(input: unknown): MissionStrategyEvaluationResult {
  const parsed = EvaluationInputSchema.parse(input);
  const context = parsed.context;
  const alternatives = [...parsed.alternatives].sort((a, b) => a.strategyId.localeCompare(b.strategyId));
  if (new Set(alternatives.map(({ strategyId }) => strategyId)).size !== alternatives.length) {
    throw new Error("strategy identities must be unique before evaluation");
  }
  const candidates: Candidate[] = alternatives.map((strategy) => {
    const constraints = evaluateConstraints(context, strategy);
    return { strategy, constraints, eligibility: eligibilityOf(constraints), dimensions: [] };
  });
  const costScores = estimateCohortScores(candidates, "expectedExecutionCost", context);
  const durationScores = estimateCohortScores(candidates, "durationEstimate", context);
  const complexityScores = relativeStructuralScores(candidates);

  for (const candidate of candidates) {
    candidate.dimensions = buildDimensions(context, candidate, costScores, durationScores, complexityScores);
    const missingCritical = candidate.dimensions.filter(({ dimension: name, status, normalizedValue }) => {
      const notRequired =
        (name === "evidence_strength" && candidate.strategy.requiredEvidenceKinds.length === 0)
        || (name === "capability_availability" && candidate.strategy.requiredCapabilities.length === 0);
      return CRITICAL_DIMENSIONS.includes(name)
        && !notRequired
        && (!["measured", "estimated"].includes(status) || normalizedValue === null);
    });
    if (missingCritical.length > 0) {
      candidate.constraints.push(makeConstraint(
        "critical_metrics_complete",
        "unknown",
        [],
        ["critical_metrics_unavailable"],
      ));
    } else {
      candidate.constraints.push(makeConstraint("critical_metrics_complete", "passed", [], ["critical_metrics_complete"]));
    }
    candidate.eligibility = eligibilityOf(candidate.constraints);
  }

  const evaluations = candidates.map(({ strategy, constraints, eligibility, dimensions }) =>
    MissionStrategyEvaluationSchema.parse({
      schemaVersion: strategy.schemaVersion,
      strategyId: strategy.strategyId,
      strategyHash: hashMissionStrategyAlternative(strategy),
      eligibility,
      hardConstraints: constraints,
      dimensions,
      rankingScore: null,
      scorePolicyVersion: null,
      evaluatorVersion: MISSION_STRATEGY_EVALUATOR_VERSION,
      evaluatedAt: parsed.evaluatedAt,
    }),
  );
  const pairs: StrategyPairwiseComparison[] = [];
  for (let leftIndex = 0; leftIndex < evaluations.length; leftIndex += 1) {
    for (let rightIndex = leftIndex + 1; rightIndex < evaluations.length; rightIndex += 1) {
      pairs.push(compareEvaluations(evaluations[leftIndex]!, evaluations[rightIndex]!));
    }
  }

  if (context.authorization.status === "denied") {
    return {
      policyVersion: MISSION_STRATEGY_EVALUATOR_VERSION,
      evaluations,
      pairwiseComparisons: pairs,
      result: { kind: "BLOCKED", selectedStrategyId: null, reasonCode: "authorization_denied" },
    };
  }
  if (context.authorization.status === "approval_required") {
    return {
      policyVersion: MISSION_STRATEGY_EVALUATOR_VERSION,
      evaluations,
      pairwiseComparisons: pairs,
      result: { kind: "BLOCKED", selectedStrategyId: null, reasonCode: "approval_required" },
    };
  }
  if (
    context.approval.status === "required"
    && alternatives.some(({ approvalRequirement }) => approvalRequirement === "required")
  ) {
    return {
      policyVersion: MISSION_STRATEGY_EVALUATOR_VERSION,
      evaluations,
      pairwiseComparisons: pairs,
      result: { kind: "BLOCKED", selectedStrategyId: null, reasonCode: "approval_required" },
    };
  }
  if (context.authorization.status === "unknown") {
    return {
      policyVersion: MISSION_STRATEGY_EVALUATOR_VERSION,
      evaluations,
      pairwiseComparisons: pairs,
      result: { kind: "NO_DECISION", selectedStrategyId: null, reasonCode: "insufficient_evidence" },
    };
  }

  const meaningful = alternatives.some((left, leftIndex) =>
    alternatives.slice(leftIndex + 1).some((right) =>
      compareMissionStrategyAlternatives(left, right).classification === "GENUINELY_DIFFERENT",
    ),
  );
  if (!meaningful) {
    return {
      policyVersion: MISSION_STRATEGY_EVALUATOR_VERSION,
      evaluations,
      pairwiseComparisons: pairs,
      result: { kind: "NO_DECISION", selectedStrategyId: null, reasonCode: "no_meaningful_alternative" },
    };
  }

  const eligible = evaluations.filter(({ eligibility }) => eligibility === "eligible");
  if (eligible.length === 1) {
    if (evaluations.some(({ eligibility }) => eligibility === "unknown")) {
      return {
        policyVersion: MISSION_STRATEGY_EVALUATOR_VERSION,
        evaluations,
        pairwiseComparisons: pairs,
        result: { kind: "NO_DECISION", selectedStrategyId: null, reasonCode: "evaluation_inconclusive" },
      };
    }
    return {
      policyVersion: MISSION_STRATEGY_EVALUATOR_VERSION,
      evaluations,
      pairwiseComparisons: pairs,
      result: {
        kind: "SELECTED",
        selectedStrategyId: eligible[0]!.strategyId,
        rationaleCodes: ["only_hard_constraint_eligible_strategy", "unweighted_conservative_policy"],
        rejectedStrategyCodes: evaluations.filter(({ eligibility }) => eligibility !== "eligible").map(() => "strategy_not_eligible"),
      },
    };
  }

  const dominators = eligible.filter((candidate) =>
    eligible.every((other) => {
      if (candidate.strategyId === other.strategyId) return true;
      return pairs.some((pair) =>
        pair.leftStrategyId === candidate.strategyId
        && pair.rightStrategyId === other.strategyId
        && pair.relation === "left_dominates",
      ) || pairs.some((pair) =>
        pair.rightStrategyId === candidate.strategyId
        && pair.leftStrategyId === other.strategyId
        && pair.relation === "right_dominates",
      );
    }),
  );
  if (dominators.length === 1) {
    return {
      policyVersion: MISSION_STRATEGY_EVALUATOR_VERSION,
      evaluations,
      pairwiseComparisons: pairs,
      result: {
        kind: "SELECTED",
        selectedStrategyId: dominators[0]!.strategyId,
        rationaleCodes: ["unique_pareto_dominator", "hard_constraints_passed", "no_weighted_score"],
        rejectedStrategyCodes: evaluations.filter(({ eligibility }) => eligibility !== "eligible").map(() => "strategy_not_eligible"),
      },
    };
  }
  return {
    policyVersion: MISSION_STRATEGY_EVALUATOR_VERSION,
    evaluations,
    pairwiseComparisons: pairs,
    result: { kind: "NO_DECISION", selectedStrategyId: null, reasonCode: noDecisionReason(evaluations, pairs) },
  };
}
