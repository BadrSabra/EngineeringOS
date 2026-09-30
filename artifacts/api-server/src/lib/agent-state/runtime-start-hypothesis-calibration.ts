import { createHash } from "node:crypto";
import { z } from "zod";
import { canonicalJsonHash } from "@workspace/ai-orchestrator";
import {
  RUNTIME_START_CALIBRATION_METHOD_VERSION,
  RUNTIME_START_CALIBRATION_PARTITION,
  RUNTIME_START_CALIBRATION_POLICY_VERSION,
  runtimeStartMarginalOutcomeDistribution,
  type RuntimeStartHypothesisExperimentRegistration,
  type RuntimeStartHypothesisExperimentResult,
  type RuntimeStartOutcomeKey,
} from "./runtime-start-hypothesis-experiment.js";

export const RUNTIME_START_CALIBRATION_MINIMUM_MISSIONS = 30;
export const RUNTIME_START_CALIBRATION_MAXIMUM_ECE = 0.15;
const BOOTSTRAP_REPLICATES = 2_000;
const ECE_BIN_COUNT = 10;
const OUTCOME_KEYS: readonly RuntimeStartOutcomeKey[] = [
  "runtime_running",
  "runtime_not_running",
  "runtime_other",
  "runtime_unexpected",
];

const HashSchema = z.string().regex(/^[a-f0-9]{64}$/);
const CalibrationRefSchema = z.string().regex(/^p75-runtime-start-calibration:[a-f0-9]{64}$/);

export const RuntimeStartHypothesisCalibrationAssessmentSchema = z.object({
  schemaVersion: z.literal(1),
  recordKind: z.literal("P75_HYPOTHESIS_CALIBRATION_ASSESSMENT"),
  assessmentRef: CalibrationRefSchema,
  calibrationScopeRef: CalibrationRefSchema,
  evaluationPartition: z.literal(RUNTIME_START_CALIBRATION_PARTITION),
  calibrationPolicyVersion: z.literal(RUNTIME_START_CALIBRATION_POLICY_VERSION),
  methodVersion: z.literal(RUNTIME_START_CALIBRATION_METHOD_VERSION),
  status: z.enum([
    "insufficient_data",
    "incomplete_measurements",
    "threshold_not_met",
    "thresholds_met_unverified",
    "validated_for_scope",
  ]),
  registeredExperimentCount: z.number().int().nonnegative(),
  usableOutcomeCount: z.number().int().nonnegative(),
  unresolvedExperimentCount: z.number().int().nonnegative(),
  independentMissionCount: z.number().int().nonnegative(),
  meanBrierScore: z.number().finite().min(0).max(2).nullable(),
  expectedCalibrationError: z.number().finite().min(0).max(1).nullable(),
  eceUpperBound95: z.number().finite().min(0).max(1).nullable(),
  sourceManifestHash: HashSchema,
}).strict().superRefine((assessment, context) => {
  if (assessment.usableOutcomeCount > assessment.registeredExperimentCount) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      message: "Usable calibration outcomes cannot exceed registered experiments.",
      path: ["usableOutcomeCount"],
    });
  }
  if (assessment.unresolvedExperimentCount > assessment.registeredExperimentCount) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      message: "Unresolved calibration experiments cannot exceed registered experiments.",
      path: ["unresolvedExperimentCount"],
    });
  }
  if (assessment.independentMissionCount > assessment.usableOutcomeCount) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      message: "Independent mission count cannot exceed usable outcomes.",
      path: ["independentMissionCount"],
    });
  }
  if (assessment.status === "incomplete_measurements" && assessment.unresolvedExperimentCount === 0) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      message: "Incomplete calibration requires unresolved registered experiments.",
      path: ["unresolvedExperimentCount"],
    });
  }
  if (
    assessment.status === "insufficient_data"
    && (
      assessment.unresolvedExperimentCount > 0
      || assessment.independentMissionCount >= RUNTIME_START_CALIBRATION_MINIMUM_MISSIONS
    )
  ) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      message: "Insufficient-data status requires a complete sample below the mission minimum.",
      path: ["status"],
    });
  }
  if (assessment.status === "threshold_not_met" && (
    assessment.unresolvedExperimentCount > 0
    || assessment.independentMissionCount < RUNTIME_START_CALIBRATION_MINIMUM_MISSIONS
    || assessment.expectedCalibrationError === null
    || assessment.eceUpperBound95 === null
  )) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      message: "Threshold failure requires a complete sample meeting the minimum size.",
      path: ["status"],
    });
  }
  if ((
    assessment.status === "thresholds_met_unverified"
    || assessment.status === "validated_for_scope"
  ) && (
    assessment.unresolvedExperimentCount > 0
    || assessment.independentMissionCount < RUNTIME_START_CALIBRATION_MINIMUM_MISSIONS
    || assessment.expectedCalibrationError === null
    || assessment.eceUpperBound95 === null
    || assessment.expectedCalibrationError > RUNTIME_START_CALIBRATION_MAXIMUM_ECE
    || assessment.eceUpperBound95 > RUNTIME_START_CALIBRATION_MAXIMUM_ECE
  )) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      message: "Threshold-passing calibration requires at least 30 complete missions and both ECE bounds at or below 0.15.",
      path: ["status"],
    });
  }

  const stableAssessmentRef = `p75-runtime-start-calibration:${canonicalJsonHash({
    calibrationScopeRef: assessment.calibrationScopeRef,
    evaluationPartition: assessment.evaluationPartition,
    calibrationPolicyVersion: assessment.calibrationPolicyVersion,
    methodVersion: assessment.methodVersion,
    status: assessment.status,
    registeredExperimentCount: assessment.registeredExperimentCount,
    usableOutcomeCount: assessment.usableOutcomeCount,
    unresolvedExperimentCount: assessment.unresolvedExperimentCount,
    independentMissionCount: assessment.independentMissionCount,
    meanBrierScore: assessment.meanBrierScore,
    expectedCalibrationError: assessment.expectedCalibrationError,
    eceUpperBound95: assessment.eceUpperBound95,
    sourceManifestHash: assessment.sourceManifestHash,
  })}`;
  if (assessment.assessmentRef !== stableAssessmentRef) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      message: "Calibration assessment identity must match its method, scope, evidence, and metrics.",
      path: ["assessmentRef"],
    });
  }
});

export type RuntimeStartHypothesisCalibrationAssessment = z.infer<
  typeof RuntimeStartHypothesisCalibrationAssessmentSchema
>;

export type RuntimeStartCalibrationExperiment = {
  experimentId: string;
  missionId: string;
  calibrationScopeRef: string;
  registration?: RuntimeStartHypothesisExperimentRegistration;
  result?: RuntimeStartHypothesisExperimentResult;
};

type CalibrationSample = {
  experimentId: string;
  missionId: string;
  resultId: string;
  actualOutcomeKey: RuntimeStartOutcomeKey;
  marginalOutcomeProbabilities: Array<{
    outcomeKey: RuntimeStartOutcomeKey;
    probability: number;
  }>;
  predictionErrorScore: number;
};

function classwiseEce(samples: readonly CalibrationSample[]): number {
  if (samples.length === 0) return 0;
  let totalClasswiseError = 0;
  for (const outcomeKey of OUTCOME_KEYS) {
    const counts = Array<number>(ECE_BIN_COUNT).fill(0);
    const predictionSums = Array<number>(ECE_BIN_COUNT).fill(0);
    const observedSums = Array<number>(ECE_BIN_COUNT).fill(0);
    for (const sample of samples) {
      const prediction = sample.marginalOutcomeProbabilities.find(
        (item) => item.outcomeKey === outcomeKey,
      )?.probability;
      if (prediction === undefined) continue;
      const binIndex = Math.min(ECE_BIN_COUNT - 1, Math.floor(prediction * ECE_BIN_COUNT));
      counts[binIndex] += 1;
      predictionSums[binIndex] += prediction;
      observedSums[binIndex] += Number(sample.actualOutcomeKey === outcomeKey);
    }
    let classError = 0;
    for (let binIndex = 0; binIndex < ECE_BIN_COUNT; binIndex += 1) {
      const count = counts[binIndex]!;
      if (count === 0) continue;
      const meanPrediction = predictionSums[binIndex]! / count;
      const observedRate = observedSums[binIndex]! / count;
      classError += (count / samples.length) * Math.abs(meanPrediction - observedRate);
    }
    totalClasswiseError += classError;
  }
  return totalClasswiseError / OUTCOME_KEYS.length;
}

function bootstrapUpperBound95(
  samples: readonly CalibrationSample[],
  scopeRef: string,
  sampleManifestHash: string,
): number | null {
  const missionGroups = new Map<string, CalibrationSample[]>();
  for (const sample of samples) {
    const group = missionGroups.get(sample.missionId) ?? [];
    group.push(sample);
    missionGroups.set(sample.missionId, group);
  }
  const groups = [...missionGroups.values()];
  if (groups.length < 2) return null;

  const seedBytes = createHash("sha256")
    .update(`${scopeRef}:${sampleManifestHash}:${RUNTIME_START_CALIBRATION_METHOD_VERSION}`)
    .digest();
  let seed = seedBytes.readUInt32BE(0) || 0x9e3779b9;
  const nextRandom = () => {
    seed ^= seed << 13;
    seed ^= seed >>> 17;
    seed ^= seed << 5;
    return (seed >>> 0) / 0x1_0000_0000;
  };
  const estimates: number[] = [];
  for (let replicate = 0; replicate < BOOTSTRAP_REPLICATES; replicate += 1) {
    const resample: CalibrationSample[] = [];
    for (let draw = 0; draw < groups.length; draw += 1) {
      const group = groups[Math.floor(nextRandom() * groups.length)]!;
      resample.push(...group);
    }
    estimates.push(classwiseEce(resample));
  }
  estimates.sort((left, right) => left - right);
  return estimates[Math.ceil(0.95 * (estimates.length - 1))] ?? null;
}

export function evaluateRuntimeStartHypothesisCalibration(input: {
  calibrationScopeRef: string;
  experiments: readonly RuntimeStartCalibrationExperiment[];
}): RuntimeStartHypothesisCalibrationAssessment {
  const uniqueExperiments = new Map<string, RuntimeStartCalibrationExperiment>();
  for (const experiment of input.experiments) {
    if (experiment.calibrationScopeRef !== input.calibrationScopeRef) {
      throw new Error("Calibration evaluator received an experiment from another scope.");
    }
    const prior = uniqueExperiments.get(experiment.experimentId);
    if (prior) {
      if (
        prior.missionId !== experiment.missionId
        || canonicalJsonHash(prior.registration ?? null)
          !== canonicalJsonHash(experiment.registration ?? null)
        || prior.result?.resultId !== experiment.result?.resultId
      ) {
        throw new Error("Calibration evaluator received conflicting records for one experiment.");
      }
      continue;
    }
    uniqueExperiments.set(experiment.experimentId, experiment);
  }

  const orderedExperiments = [...uniqueExperiments.values()]
    .sort((left, right) => left.experimentId.localeCompare(right.experimentId));
  const samples: CalibrationSample[] = [];
  let unresolvedExperimentCount = 0;
  for (const experiment of orderedExperiments) {
    const result = experiment.result;
    const registration = experiment.registration;
    if (
      !registration
      || registration.experimentId !== experiment.experimentId
      || registration.missionId !== experiment.missionId
      || registration.calibrationScopeRef !== input.calibrationScopeRef
      || registration.evaluationPartition !== RUNTIME_START_CALIBRATION_PARTITION
      || registration.calibrationPolicyVersion !== RUNTIME_START_CALIBRATION_POLICY_VERSION
      || !result
      || result.experimentId !== experiment.experimentId
      || result.missionId !== experiment.missionId
      || result.calibrationScopeRef !== input.calibrationScopeRef
      || result.evaluationPartition !== RUNTIME_START_CALIBRATION_PARTITION
      || result.measurementValidity !== "complete_fresh"
      || result.environmentStatus !== "same_scope"
      || !result.actualOutcomeKey
      || !result.marginalOutcomeProbabilities
      || result.predictionErrorScore === undefined
    ) {
      unresolvedExperimentCount += 1;
      continue;
    }
    const expectedMarginal = runtimeStartMarginalOutcomeDistribution(registration);
    const storedProbabilities = new Map(
      result.marginalOutcomeProbabilities.map((item) => [item.outcomeKey, item.probability]),
    );
    const forecastMatchesRegistration = expectedMarginal.every((item) => (
      Math.abs(item.probability - (storedProbabilities.get(item.outcomeKey) ?? Number.NaN)) <= 1e-9
    ));
    const expectedBrier = expectedMarginal.reduce((total, item) => (
      total + (item.probability - Number(item.outcomeKey === result.actualOutcomeKey)) ** 2
    ), 0);
    if (
      !forecastMatchesRegistration
      || Math.abs(expectedBrier - result.predictionErrorScore) > 1e-9
    ) {
      unresolvedExperimentCount += 1;
      continue;
    }
    samples.push({
      experimentId: experiment.experimentId,
      missionId: experiment.missionId,
      resultId: result.resultId,
      actualOutcomeKey: result.actualOutcomeKey,
      marginalOutcomeProbabilities: result.marginalOutcomeProbabilities,
      predictionErrorScore: result.predictionErrorScore,
    });
  }

  const sampleManifestHash = canonicalJsonHash(orderedExperiments.map((experiment) => ({
    experimentId: experiment.experimentId,
    missionId: experiment.missionId,
    registrationHash: experiment.registration
      ? canonicalJsonHash(experiment.registration)
      : null,
    resultId: experiment.result?.resultId ?? null,
  })));
  // Retain the v1 metric name for historical assessments. Distinct Mission IDs
  // are only a numerical cluster count, not proof of independent sampling.
  const independentMissionCount = new Set(samples.map((sample) => sample.missionId)).size;
  const meanBrierScore = samples.length > 0
    ? samples.reduce((total, sample) => total + sample.predictionErrorScore, 0) / samples.length
    : null;
  const expectedCalibrationError = samples.length > 0 ? classwiseEce(samples) : null;
  const eceUpperBound95 = samples.length > 0
    ? bootstrapUpperBound95(samples, input.calibrationScopeRef, sampleManifestHash)
    : null;

  let status: RuntimeStartHypothesisCalibrationAssessment["status"];
  if (unresolvedExperimentCount > 0) {
    status = "incomplete_measurements";
  } else if (
    independentMissionCount < RUNTIME_START_CALIBRATION_MINIMUM_MISSIONS
    || expectedCalibrationError === null
    || eceUpperBound95 === null
  ) {
    status = "insufficient_data";
  } else if (
    expectedCalibrationError <= RUNTIME_START_CALIBRATION_MAXIMUM_ECE
    && eceUpperBound95 <= RUNTIME_START_CALIBRATION_MAXIMUM_ECE
  ) {
    // No qualified sampling/held-out evidence source or authority verifier is
    // available yet. Passing numerical thresholds cannot validate the scope.
    status = "thresholds_met_unverified";
  } else {
    status = "threshold_not_met";
  }

  const assessmentBase = {
    schemaVersion: 1 as const,
    recordKind: "P75_HYPOTHESIS_CALIBRATION_ASSESSMENT" as const,
    calibrationScopeRef: input.calibrationScopeRef,
    evaluationPartition: RUNTIME_START_CALIBRATION_PARTITION,
    calibrationPolicyVersion: RUNTIME_START_CALIBRATION_POLICY_VERSION,
    methodVersion: RUNTIME_START_CALIBRATION_METHOD_VERSION,
    status,
    registeredExperimentCount: orderedExperiments.length,
    usableOutcomeCount: samples.length,
    unresolvedExperimentCount,
    independentMissionCount,
    meanBrierScore,
    expectedCalibrationError,
    eceUpperBound95,
    sourceManifestHash: sampleManifestHash,
  };
  const assessmentRef = `p75-runtime-start-calibration:${canonicalJsonHash({
    calibrationScopeRef: assessmentBase.calibrationScopeRef,
    evaluationPartition: assessmentBase.evaluationPartition,
    calibrationPolicyVersion: assessmentBase.calibrationPolicyVersion,
    methodVersion: assessmentBase.methodVersion,
    status: assessmentBase.status,
    registeredExperimentCount: assessmentBase.registeredExperimentCount,
    usableOutcomeCount: assessmentBase.usableOutcomeCount,
    unresolvedExperimentCount: assessmentBase.unresolvedExperimentCount,
    independentMissionCount: assessmentBase.independentMissionCount,
    meanBrierScore: assessmentBase.meanBrierScore,
    expectedCalibrationError: assessmentBase.expectedCalibrationError,
    eceUpperBound95: assessmentBase.eceUpperBound95,
    sourceManifestHash: assessmentBase.sourceManifestHash,
  })}`;

  return RuntimeStartHypothesisCalibrationAssessmentSchema.parse({
    ...assessmentBase,
    assessmentRef,
  });
}