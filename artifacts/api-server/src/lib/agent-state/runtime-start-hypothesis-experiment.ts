import { createHash } from "node:crypto";
import { z } from "zod";
import { canonicalJsonHash } from "@workspace/ai-orchestrator";

export const RUNTIME_START_OBJECTIVE_CONTRACT_ID =
  "runtime.start.verified-serving-state.v1";
export const RUNTIME_START_HYPOTHESIS_SET_ID =
  "runtime.start.effect-outcome.v1";
export const RUNTIME_START_OBSERVATION_REF =
  "workspace-runtime.status-after-start.v1";
export const RUNTIME_START_CALIBRATION_POLICY_VERSION =
  "runtime-start-probe-semantics-v1";
export const RUNTIME_START_CALIBRATION_METHOD_VERSION =
  "runtime-start-classwise-ece10-mission-cluster-percentile95-v1";
export const RUNTIME_START_CALIBRATION_PARTITION =
  "runtime-start-fixed-policy-held-out-v1";

const HypothesisIdSchema = z.enum([
  "runtime_effect_not_applied",
  "runtime_effect_applied_but_not_observed",
  "OTHER_UNKNOWN",
]);

const OutcomeKeySchema = z.enum([
  "runtime_running",
  "runtime_not_running",
  "runtime_other",
  "runtime_unexpected",
]);
export type RuntimeStartOutcomeKey = z.infer<typeof OutcomeKeySchema>;

const ProbabilitySchema = z.number().finite().min(0).max(1);
const MarginalOutcomeDistributionSchema = z.array(z.object({
  outcomeKey: OutcomeKeySchema,
  probability: ProbabilitySchema,
}).strict()).length(4);

const ForecastSchema = z.object({
  hypothesisId: HypothesisIdSchema,
  observationRef: z.literal(RUNTIME_START_OBSERVATION_REF),
  outcomes: z.array(z.object({
    outcomeKey: OutcomeKeySchema,
    probability: ProbabilitySchema,
  }).strict()).min(1).max(4),
  provenance: z.literal("SERVER_DERIVED"),
  calibrationStatus: z.enum(["unvalidated", "validated_for_scope"]),
  calibrationScopeRef: z.string().regex(/^p75-runtime-start-calibration:[a-f0-9]{64}$/),
  calibrationPolicyVersion: z.literal(RUNTIME_START_CALIBRATION_POLICY_VERSION),
}).strict();

const OutcomeDecisionSchema = z.object({
  outcomeKey: OutcomeKeySchema,
  nextDecisionCode: z.enum([
    "runtime_verified",
    "runtime_start_not_verified",
    "runtime_start_unresolved",
    "runtime_start_unexpected_outcome",
  ]),
}).strict();

const CandidateAssessmentSchema = z.object({
  observationRef: z.literal(RUNTIME_START_OBSERVATION_REF),
  decisionRef: z.literal("runtime.start.verified-serving-state"),
  outcomeSpace: z.array(OutcomeKeySchema).length(4),
  outcomeDecisionMap: z.array(OutcomeDecisionSchema).length(4),
  decisionValueStatus: z.literal("not_computed_bootstrap"),
  forecasts: z.array(ForecastSchema).length(3),
  expectedInformationGain: z.number().finite().min(0),
  informationGainPolicyVersion: z.literal("runtime-start-eig-bits-v1"),
  estimatedCost: z.number().finite().nonnegative(),
  estimatedRisk: z.number().finite().min(0).max(1),
  estimatedTimeMs: z.number().int().nonnegative(),
  authorizationDecision: z.literal("allowed"),
}).strict();

const HypothesisSchema = z.object({
  hypothesisId: HypothesisIdSchema,
  beliefWeight: ProbabilitySchema,
  supportingObservationIds: z.array(z.string().min(1).max(256)).max(32),
  contradictingObservationIds: z.array(z.string().min(1).max(256)).max(32),
  confidence: ProbabilitySchema,
  affectedObjective: z.literal(RUNTIME_START_OBJECTIVE_CONTRACT_ID),
  freshness: z.literal("FRESH"),
  environmentScope: z.string().min(1).max(256),
  requiredObservations: z.array(z.string().min(1).max(256)).max(8),
}).strict();

export const RuntimeStartHypothesisExperimentRegistrationSchema = z.object({
  schemaVersion: z.literal(1),
  recordKind: z.literal("P75_HYPOTHESIS_EXPERIMENT_REGISTERED"),
  experimentId: z.string().regex(/^p75-runtime-start:[a-f0-9]{64}$/),
  projectId: z.string().min(1).max(200),
  missionId: z.string().min(1).max(200),
  goalId: z.string().min(1).max(200),
  executionId: z.string().min(1).max(200),
  attempt: z.number().int().nonnegative(),
  episodeId: z.string().min(1).max(200),
  actionId: z.string().min(1).max(200),
  calibrationScopeRef: z.string().regex(/^p75-runtime-start-calibration:[a-f0-9]{64}$/),
  calibrationStatus: z.enum(["unvalidated", "validated_for_scope"]),
  calibrationAssessmentRef: z.string()
    .regex(/^p75-runtime-start-calibration:[a-f0-9]{64}$/)
    .optional(),
  calibrationPolicyVersion: z.literal(RUNTIME_START_CALIBRATION_POLICY_VERSION),
  evaluationPartition: z.literal(RUNTIME_START_CALIBRATION_PARTITION),
  planRevision: z.string().min(1).max(256),
  projectRevision: z.string().min(1).max(200),
  environmentRevision: z.string().regex(/^env-v1:[a-f0-9]{64}$/),
  parentWorldRevision: z.string().regex(/^[a-f0-9]{64}$/),
  contextObservationIds: z.array(z.string().min(1).max(256)).min(1).max(32),
  objectiveContractId: z.literal(RUNTIME_START_OBJECTIVE_CONTRACT_ID),
  beliefRevision: z.string().regex(/^runtime-start-belief:[a-f0-9]{64}$/),
  beliefPolicyVersion: z.literal("runtime-start-uniform-bootstrap-v1"),
  hypothesisSetId: z.literal(RUNTIME_START_HYPOTHESIS_SET_ID),
  hypothesisSetPolicyVersion: z.literal("runtime-start-exhaustive-outcome-set-v1"),
  hypotheses: z.array(HypothesisSchema).length(3),
  candidate: CandidateAssessmentSchema,
  selectedObservationRef: z.literal(RUNTIME_START_OBSERVATION_REF),
  selectionMode: z.literal("fixed_safe_probe"),
  selectionPolicyVersion: z.literal("runtime-start-fixed-safe-probe-v1"),
  predictionRegisteredAt: z.string().datetime(),
  measurementFailureOutcomes: z.array(z.enum([
    "partial",
    "stale",
    "failed",
    "unknown",
    "environment_changed",
    "scope_mismatch",
  ])).min(6).max(6),
}).strict().superRefine((registration, context) => {
  const expectedCalibrationScopeRef = runtimeStartHypothesisCalibrationScopeRef(registration);
  if (registration.calibrationScopeRef !== expectedCalibrationScopeRef) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      message: "Calibration scope must bind the project, source/environment revisions, and versioned policy.",
      path: ["calibrationScopeRef"],
    });
  }
  if (
    registration.calibrationStatus === "validated_for_scope"
    && !registration.calibrationAssessmentRef
  ) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      message: "Validated calibration must reference its server-owned assessment.",
      path: ["calibrationAssessmentRef"],
    });
  }
  if (registration.candidate.forecasts.some((forecastItem) =>
    forecastItem.calibrationStatus !== registration.calibrationStatus
    || forecastItem.calibrationScopeRef !== registration.calibrationScopeRef
    || forecastItem.calibrationPolicyVersion !== registration.calibrationPolicyVersion)
  ) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      message: "Forecast calibration status must match the registration's scoped assessment.",
      path: ["candidate", "forecasts"],
    });
  }
  const weightTotal = registration.hypotheses.reduce(
    (total, hypothesis) => total + hypothesis.beliefWeight,
    0,
  );
  if (Math.abs(weightTotal - 1) > 1e-9) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      message: "Runtime-start hypothesis weights must sum to one.",
      path: ["hypotheses"],
    });
  }
  for (const hypothesis of registration.hypotheses) {
    if (Math.abs(hypothesis.confidence - hypothesis.beliefWeight) > 1e-9) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Bootstrap confidence must equal the server-owned hypothesis weight.",
        path: ["hypotheses"],
      });
    }
  }
  for (const forecast of registration.candidate.forecasts) {
    const total = forecast.outcomes.reduce((sum, outcome) => sum + outcome.probability, 0);
    if (Math.abs(total - 1) > 1e-9) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Each runtime-start forecast distribution must sum to one.",
        path: ["candidate", "forecasts"],
      });
    }
    const forecastKeys = new Set(forecast.outcomes.map(({ outcomeKey }) => outcomeKey));
    if (
      forecast.outcomes.length !== registration.candidate.outcomeSpace.length
      || forecastKeys.size !== registration.candidate.outcomeSpace.length
      || registration.candidate.outcomeSpace.some((key) => !forecastKeys.has(key))
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Each forecast must cover the complete registered outcome space.",
        path: ["candidate", "forecasts"],
      });
    }
  }
  const expectedHypotheses = new Set(registration.hypotheses.map(({ hypothesisId }) => hypothesisId));
  const forecastHypotheses = new Set(
    registration.candidate.forecasts.map(({ hypothesisId }) => hypothesisId),
  );
  if (
    expectedHypotheses.size !== 3
    || forecastHypotheses.size !== 3
    || [...expectedHypotheses].some((id) => !forecastHypotheses.has(id))
  ) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      message: "The forecast must cover each mutually exclusive runtime-start hypothesis once.",
      path: ["candidate", "forecasts"],
    });
  }
  const mappedOutcomes = new Set(
    registration.candidate.outcomeDecisionMap.map(({ outcomeKey }) => outcomeKey),
  );
  if (
    mappedOutcomes.size !== registration.candidate.outcomeSpace.length
    || registration.candidate.outcomeSpace.some((key) => !mappedOutcomes.has(key))
  ) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      message: "Every runtime-start outcome must map to exactly one server-owned decision.",
      path: ["candidate", "outcomeDecisionMap"],
    });
  }
  if (new Set(registration.measurementFailureOutcomes).size !== 6) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      message: "Measurement failures and scope changes must be represented distinctly.",
      path: ["measurementFailureOutcomes"],
    });
  }
  const forecastByHypothesis = new Map(
    registration.candidate.forecasts.map((forecastItem) => [
      forecastItem.hypothesisId,
      forecastItem,
    ]),
  );
  const registeredGain = expectedInformationGain(
    registration.hypotheses.map(({ beliefWeight }) => beliefWeight),
    registration.hypotheses.map((hypothesis) =>
      registration.candidate.outcomeSpace.map((outcomeKey) =>
        forecastByHypothesis.get(hypothesis.hypothesisId)
          ?.outcomes.find((outcome) => outcome.outcomeKey === outcomeKey)?.probability ?? 0,
      ),
    ),
  );
  if (Math.abs(registeredGain - registration.candidate.expectedInformationGain) > 1e-9) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      message: "Expected information gain must be recomputed from the server-owned distributions.",
      path: ["candidate", "expectedInformationGain"],
    });
  }
});

export type RuntimeStartHypothesisExperimentRegistration = z.infer<
  typeof RuntimeStartHypothesisExperimentRegistrationSchema
>;

export const RuntimeStartHypothesisExperimentResultSchema = z.object({
  schemaVersion: z.literal(1),
  recordKind: z.literal("P75_HYPOTHESIS_EXPERIMENT_RESULT"),
  experimentId: z.string().regex(/^p75-runtime-start:[a-f0-9]{64}$/),
  missionId: z.string().min(1).max(200),
  calibrationScopeRef: z.string().regex(/^p75-runtime-start-calibration:[a-f0-9]{64}$/),
  evaluationPartition: z.literal(RUNTIME_START_CALIBRATION_PARTITION),
  resultId: z.string().regex(/^p75-runtime-start-result:[a-f0-9]{64}$/),
  observationRefs: z.array(z.string().min(1).max(256)).max(32),
  measurementValidity: z.enum([
    "complete_fresh",
    "partial",
    "stale",
    "failed",
    "unknown",
  ]),
  environmentStatus: z.enum(["same_scope", "changed", "unknown"]),
  actualOutcomeKey: OutcomeKeySchema.optional(),
  marginalOutcomeProbabilities: MarginalOutcomeDistributionSchema.optional(),
  predictionErrorScore: z.number().finite().min(0).max(2).optional(),
  verdict: z.enum(["matched", "contradicted", "inconclusive"]),
  supportingHypothesisIds: z.array(HypothesisIdSchema).max(3),
  contradictingHypothesisIds: z.array(HypothesisIdSchema).max(3),
  beliefUpdateStatus: z.literal("unresolved_unvalidated_forecast"),
  resultPolicyVersion: z.literal("runtime-start-observation-result-v1"),
  resolvedAt: z.string().datetime(),
}).strict().superRefine((result, context) => {
  const usable = result.measurementValidity === "complete_fresh"
    && result.environmentStatus === "same_scope";
  const stableResultId = createHash("sha256")
    .update(JSON.stringify({
      experimentId: result.experimentId,
      calibrationScopeRef: result.calibrationScopeRef,
      observationRefs: result.observationRefs,
      measurementValidity: result.measurementValidity,
      environmentStatus: result.environmentStatus,
      actualOutcomeKey: usable && result.actualOutcomeKey && result.observationRefs.length > 0
        ? result.actualOutcomeKey
        : undefined,
      marginalOutcomeProbabilities: result.marginalOutcomeProbabilities,
      predictionErrorScore: result.predictionErrorScore,
      verdict: result.verdict,
    }))
    .digest("hex");
  if (result.resultId !== `p75-runtime-start-result:${stableResultId}`) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      message: "Runtime-start result identity must match its registered measurement.",
      path: ["resultId"],
    });
  }
  if (usable && (
    !result.actualOutcomeKey
    || result.observationRefs.length === 0
    || !result.marginalOutcomeProbabilities
    || result.predictionErrorScore === undefined
  )) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      message: "A complete fresh result requires an outcome, retained observation, and scored forecast.",
      path: ["actualOutcomeKey"],
    });
  }
  if (result.marginalOutcomeProbabilities) {
    const probabilities = result.marginalOutcomeProbabilities;
    const keys = new Set(probabilities.map(({ outcomeKey }) => outcomeKey));
    const total = probabilities.reduce((sum, outcome) => sum + outcome.probability, 0);
    if (keys.size !== 4 || Math.abs(total - 1) > 1e-9) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Marginal outcome probabilities must cover the registered space and sum to one.",
        path: ["marginalOutcomeProbabilities"],
      });
    }
    if (result.actualOutcomeKey && result.predictionErrorScore !== undefined) {
      const expectedBrier = probabilities.reduce((sum, outcome) => (
        sum + (outcome.probability - Number(outcome.outcomeKey === result.actualOutcomeKey)) ** 2
      ), 0);
      if (Math.abs(expectedBrier - result.predictionErrorScore) > 1e-9) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          message: "Prediction error score must match the registered marginal forecast.",
          path: ["predictionErrorScore"],
        });
      }
    }
  }
  if (!usable && (
    result.actualOutcomeKey !== undefined
    || result.marginalOutcomeProbabilities !== undefined
    || result.predictionErrorScore !== undefined
    || result.verdict !== "inconclusive"
    || result.supportingHypothesisIds.length > 0
    || result.contradictingHypothesisIds.length > 0
  )) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      message: "Invalid or out-of-scope measurements must remain inconclusive.",
      path: ["verdict"],
    });
  }
});

export type RuntimeStartHypothesisExperimentResult = z.infer<
  typeof RuntimeStartHypothesisExperimentResultSchema
>;

export function parseRuntimeStartHypothesisExperimentResult(
  value: unknown,
): RuntimeStartHypothesisExperimentResult {
  return RuntimeStartHypothesisExperimentResultSchema.parse(value);
}

export type RuntimeStartHypothesisExperimentBinding = {
  projectId: string;
  missionId: string;
  goalId: string;
  executionId: string;
  attempt: number;
  episodeId: string;
  actionId: string;
  planRevision: string;
  projectRevision: string;
  environmentRevision: string;
  parentWorldRevision: string;
  beforeObservationIds: string[];
  predictionRegisteredAt: string;
  calibrationAssessment?: {
    status: "unvalidated" | "validated_for_scope";
    assessmentRef?: string;
  };
};

export function runtimeStartHypothesisCalibrationScopeRef(
  binding: Pick<
    RuntimeStartHypothesisExperimentBinding,
    "projectId" | "projectRevision" | "environmentRevision"
  >,
): string {
  return `p75-runtime-start-calibration:${canonicalJsonHash({
    projectId: binding.projectId,
    projectRevision: binding.projectRevision,
    environmentRevision: binding.environmentRevision,
    objectiveContractId: RUNTIME_START_OBJECTIVE_CONTRACT_ID,
    hypothesisSetId: RUNTIME_START_HYPOTHESIS_SET_ID,
    beliefPolicyVersion: "runtime-start-uniform-bootstrap-v1",
    hypothesisSetPolicyVersion: "runtime-start-exhaustive-outcome-set-v1",
    observationRef: RUNTIME_START_OBSERVATION_REF,
    calibrationPolicyVersion: RUNTIME_START_CALIBRATION_POLICY_VERSION,
    methodVersion: RUNTIME_START_CALIBRATION_METHOD_VERSION,
    evaluationPartition: RUNTIME_START_CALIBRATION_PARTITION,
  })}`;
}

const OUTCOME_KEYS = [
  "runtime_running",
  "runtime_not_running",
  "runtime_other",
  "runtime_unexpected",
] as const;

function normalizedWeights(): Array<{
  hypothesisId: z.infer<typeof HypothesisIdSchema>;
  beliefWeight: number;
}> {
  const prior = 1 / 3;
  return [
    { hypothesisId: "runtime_effect_not_applied", beliefWeight: prior },
    { hypothesisId: "runtime_effect_applied_but_not_observed", beliefWeight: prior },
    { hypothesisId: "OTHER_UNKNOWN", beliefWeight: 1 - 2 * prior },
  ];
}

function forecast(
  hypothesisId: z.infer<typeof HypothesisIdSchema>,
  probabilities: readonly number[],
  calibrationStatus: "unvalidated" | "validated_for_scope",
  calibrationScopeRef: string,
) {
  return {
    hypothesisId,
    observationRef: RUNTIME_START_OBSERVATION_REF,
    outcomes: OUTCOME_KEYS.map((outcomeKey, index) => ({
      outcomeKey,
      probability: probabilities[index]!,
    })),
    provenance: "SERVER_DERIVED" as const,
    calibrationStatus,
    calibrationScopeRef,
    calibrationPolicyVersion: RUNTIME_START_CALIBRATION_POLICY_VERSION,
  };
}

function entropy(probabilities: readonly number[]): number {
  return -probabilities.reduce((sum, probability) => (
    probability > 0 ? sum + probability * Math.log2(probability) : sum
  ), 0);
}

function expectedInformationGain(
  weights: readonly number[],
  distributions: readonly (readonly number[])[],
): number {
  const outcomeMarginals = OUTCOME_KEYS.map((_, outcomeIndex) => (
    weights.reduce(
      (total, weight, hypothesisIndex) =>
        total + weight * (distributions[hypothesisIndex]?.[outcomeIndex] ?? 0),
      0,
    )
  ));
  const expectedPosteriorEntropy = outcomeMarginals.reduce((total, probability, outcomeIndex) => {
    if (probability <= 0) return total;
    const posterior = weights.map((weight, hypothesisIndex) => (
      weight * (distributions[hypothesisIndex]?.[outcomeIndex] ?? 0) / probability
    ));
    return total + probability * entropy(posterior);
  }, 0);
  return Math.max(0, entropy(weights) - expectedPosteriorEntropy);
}

export function buildRuntimeStartHypothesisExperimentRegistration(
  binding: RuntimeStartHypothesisExperimentBinding,
): RuntimeStartHypothesisExperimentRegistration {
  if (binding.beforeObservationIds.length === 0) {
    throw new Error("Runtime-start hypothesis registration requires retained pre-state evidence.");
  }
  const calibrationScopeRef = runtimeStartHypothesisCalibrationScopeRef(binding);
  const calibrationStatus = binding.calibrationAssessment?.status ?? "unvalidated";
  const calibrationAssessmentRef = binding.calibrationAssessment?.assessmentRef;
  const weights = normalizedWeights();
  const distributions = [
    [0, 1, 0, 0],
    [1, 0, 0, 0],
    [1 / 3, 1 / 3, 1 / 3, 0],
  ] as const;
  const experimentHash = canonicalJsonHash({
    projectId: binding.projectId,
    missionId: binding.missionId,
    goalId: binding.goalId,
    executionId: binding.executionId,
    attempt: binding.attempt,
    episodeId: binding.episodeId,
    actionId: binding.actionId,
    planRevision: binding.planRevision,
    projectRevision: binding.projectRevision,
    environmentRevision: binding.environmentRevision,
    parentWorldRevision: binding.parentWorldRevision,
    contextObservationIds: binding.beforeObservationIds,
    calibrationScopeRef,
    calibrationPolicyVersion: RUNTIME_START_CALIBRATION_POLICY_VERSION,
    evaluationPartition: RUNTIME_START_CALIBRATION_PARTITION,
    objectiveContractId: RUNTIME_START_OBJECTIVE_CONTRACT_ID,
    hypothesisSetId: RUNTIME_START_HYPOTHESIS_SET_ID,
  });
  const beliefHash = canonicalJsonHash({
    priorPolicyVersion: "runtime-start-uniform-bootstrap-v1",
    hypothesisSetId: RUNTIME_START_HYPOTHESIS_SET_ID,
    weights,
  });
  const candidateForecasts = [
    forecast(
      "runtime_effect_not_applied",
      distributions[0],
      calibrationStatus,
      calibrationScopeRef,
    ),
    forecast(
      "runtime_effect_applied_but_not_observed",
      distributions[1],
      calibrationStatus,
      calibrationScopeRef,
    ),
    forecast("OTHER_UNKNOWN", distributions[2], calibrationStatus, calibrationScopeRef),
  ];
  const result = RuntimeStartHypothesisExperimentRegistrationSchema.parse({
    schemaVersion: 1,
    recordKind: "P75_HYPOTHESIS_EXPERIMENT_REGISTERED",
    experimentId: `p75-runtime-start:${experimentHash}`,
    projectId: binding.projectId,
    missionId: binding.missionId,
    goalId: binding.goalId,
    executionId: binding.executionId,
    attempt: binding.attempt,
    episodeId: binding.episodeId,
    actionId: binding.actionId,
    calibrationScopeRef,
    calibrationStatus,
    ...(calibrationAssessmentRef ? { calibrationAssessmentRef } : {}),
    calibrationPolicyVersion: RUNTIME_START_CALIBRATION_POLICY_VERSION,
    evaluationPartition: RUNTIME_START_CALIBRATION_PARTITION,
    planRevision: binding.planRevision,
    projectRevision: binding.projectRevision,
    environmentRevision: binding.environmentRevision,
    parentWorldRevision: binding.parentWorldRevision,
    contextObservationIds: binding.beforeObservationIds,
    objectiveContractId: RUNTIME_START_OBJECTIVE_CONTRACT_ID,
    beliefRevision: `runtime-start-belief:${beliefHash}`,
    beliefPolicyVersion: "runtime-start-uniform-bootstrap-v1",
    hypothesisSetId: RUNTIME_START_HYPOTHESIS_SET_ID,
    hypothesisSetPolicyVersion: "runtime-start-exhaustive-outcome-set-v1",
    hypotheses: weights.map(({ hypothesisId, beliefWeight }) => ({
      hypothesisId,
      beliefWeight,
      supportingObservationIds: [],
      contradictingObservationIds: [],
      confidence: beliefWeight,
      affectedObjective: RUNTIME_START_OBJECTIVE_CONTRACT_ID,
      freshness: "FRESH",
      environmentScope: binding.environmentRevision,
      requiredObservations: [RUNTIME_START_OBSERVATION_REF],
    })),
    candidate: {
      observationRef: RUNTIME_START_OBSERVATION_REF,
      decisionRef: "runtime.start.verified-serving-state",
      outcomeSpace: [...OUTCOME_KEYS],
      outcomeDecisionMap: [
        { outcomeKey: "runtime_running", nextDecisionCode: "runtime_verified" },
        { outcomeKey: "runtime_not_running", nextDecisionCode: "runtime_start_not_verified" },
        { outcomeKey: "runtime_other", nextDecisionCode: "runtime_start_unresolved" },
        { outcomeKey: "runtime_unexpected", nextDecisionCode: "runtime_start_unexpected_outcome" },
      ],
      decisionValueStatus: "not_computed_bootstrap",
      forecasts: candidateForecasts,
      expectedInformationGain: expectedInformationGain(
        weights.map(({ beliefWeight }) => beliefWeight),
        distributions,
      ),
      informationGainPolicyVersion: "runtime-start-eig-bits-v1",
      estimatedCost: 1,
      estimatedRisk: 0,
      estimatedTimeMs: 10_000,
      authorizationDecision: "allowed",
    },
    selectedObservationRef: RUNTIME_START_OBSERVATION_REF,
    selectionMode: "fixed_safe_probe",
    selectionPolicyVersion: "runtime-start-fixed-safe-probe-v1",
    predictionRegisteredAt: binding.predictionRegisteredAt,
    measurementFailureOutcomes: [
      "partial",
      "stale",
      "failed",
      "unknown",
      "environment_changed",
      "scope_mismatch",
    ],
  });
  return result;
}

export function parseRuntimeStartHypothesisExperimentRegistration(
  value: unknown,
): RuntimeStartHypothesisExperimentRegistration {
  return RuntimeStartHypothesisExperimentRegistrationSchema.parse(value);
}

export type RuntimeStartMarginalOutcomeProbability = {
  outcomeKey: RuntimeStartOutcomeKey;
  probability: number;
};

export function runtimeStartMarginalOutcomeDistribution(
  value: RuntimeStartHypothesisExperimentRegistration,
): RuntimeStartMarginalOutcomeProbability[] {
  const registration = parseRuntimeStartHypothesisExperimentRegistration(value);
  return registration.candidate.outcomeSpace.map((outcomeKey) => ({
    outcomeKey,
    probability: registration.hypotheses.reduce((total, hypothesis) => {
      const forecastItem = registration.candidate.forecasts.find(
        (item) => item.hypothesisId === hypothesis.hypothesisId,
      );
      const probability = forecastItem?.outcomes.find(
        (outcome) => outcome.outcomeKey === outcomeKey,
      )?.probability ?? 0;
      return total + hypothesis.beliefWeight * probability;
    }, 0),
  }));
}

export function buildRuntimeStartHypothesisExperimentResult(input: {
  registration: RuntimeStartHypothesisExperimentRegistration;
  observationRefs: string[];
  measurementValidity: RuntimeStartHypothesisExperimentResult["measurementValidity"];
  environmentStatus: RuntimeStartHypothesisExperimentResult["environmentStatus"];
  actualOutcomeKey?: z.infer<typeof OutcomeKeySchema>;
  resolvedAt: string;
}): RuntimeStartHypothesisExperimentResult {
  const registration = parseRuntimeStartHypothesisExperimentRegistration(input.registration);
  const usable = input.measurementValidity === "complete_fresh"
    && input.environmentStatus === "same_scope"
    && input.actualOutcomeKey !== undefined
    && input.observationRefs.length > 0;
  const marginalOutcomeProbabilities = usable
    ? runtimeStartMarginalOutcomeDistribution(registration)
    : undefined;
  const predictionErrorScore = usable && marginalOutcomeProbabilities
    ? marginalOutcomeProbabilities.reduce((sum, outcome) => (
        sum + (outcome.probability - Number(outcome.outcomeKey === input.actualOutcomeKey)) ** 2
      ), 0)
    : undefined;
  let verdict: RuntimeStartHypothesisExperimentResult["verdict"] = "inconclusive";
  let supportingHypothesisIds: RuntimeStartHypothesisExperimentResult["supportingHypothesisIds"] = [];
  let contradictingHypothesisIds: RuntimeStartHypothesisExperimentResult["contradictingHypothesisIds"] = [];
  if (usable) {
    supportingHypothesisIds = registration.candidate.forecasts
      .filter((forecastItem) => forecastItem.outcomes.some(
        (outcome) => outcome.outcomeKey === input.actualOutcomeKey && outcome.probability > 0,
      ))
      .map(({ hypothesisId }) => hypothesisId);
    contradictingHypothesisIds = registration.candidate.forecasts
      .filter((forecastItem) => forecastItem.outcomes.every(
        (outcome) => outcome.outcomeKey !== input.actualOutcomeKey || outcome.probability === 0,
      ))
      .map(({ hypothesisId }) => hypothesisId);
    verdict = supportingHypothesisIds.length > 0 ? "matched" : "contradicted";
  }
  const resolvedAt = new Date(input.resolvedAt).toISOString();
  const stableResultId = createHash("sha256")
    .update(JSON.stringify({
      experimentId: registration.experimentId,
      calibrationScopeRef: registration.calibrationScopeRef,
      observationRefs: input.observationRefs,
      measurementValidity: input.measurementValidity,
      environmentStatus: input.environmentStatus,
      actualOutcomeKey: usable ? input.actualOutcomeKey : undefined,
      marginalOutcomeProbabilities: usable ? marginalOutcomeProbabilities : undefined,
      predictionErrorScore: usable ? predictionErrorScore : undefined,
      verdict,
    }))
    .digest("hex");
  return RuntimeStartHypothesisExperimentResultSchema.parse({
    schemaVersion: 1,
    recordKind: "P75_HYPOTHESIS_EXPERIMENT_RESULT",
    experimentId: registration.experimentId,
    missionId: registration.missionId,
    calibrationScopeRef: registration.calibrationScopeRef,
    evaluationPartition: RUNTIME_START_CALIBRATION_PARTITION,
    resultId: `p75-runtime-start-result:${stableResultId}`,
    observationRefs: input.observationRefs,
    measurementValidity: input.measurementValidity,
    environmentStatus: input.environmentStatus,
    ...(usable ? { actualOutcomeKey: input.actualOutcomeKey } : {}),
    ...(usable && marginalOutcomeProbabilities && predictionErrorScore !== undefined ? {
      marginalOutcomeProbabilities,
      predictionErrorScore,
    } : {}),
    verdict,
    supportingHypothesisIds,
    contradictingHypothesisIds,
    beliefUpdateStatus: "unresolved_unvalidated_forecast",
    resultPolicyVersion: "runtime-start-observation-result-v1",
    resolvedAt,
  });
}