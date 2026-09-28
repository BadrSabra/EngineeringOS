import { z } from "zod";
import { canonicalJsonHash } from "@workspace/ai-orchestrator";
import {
  RUNTIME_START_CALIBRATION_METHOD_VERSION,
  RUNTIME_START_CALIBRATION_PARTITION,
  RUNTIME_START_CALIBRATION_POLICY_VERSION,
  RuntimeStartHypothesisExperimentRegistrationSchema,
  RuntimeStartHypothesisExperimentResultSchema,
  runtimeStartHypothesisCalibrationScopeRef,
  runtimeStartMarginalOutcomeDistribution,
} from "./runtime-start-hypothesis-experiment.js";

export const RUNTIME_START_CALIBRATION_READINESS_VERSION = 1 as const;
export const RUNTIME_START_CALIBRATION_READINESS_MAX_EXPERIMENTS = 5_000;

const CandidateScopeSchema = z.object({
  projectId: z.string().min(1).max(200),
  projectRevision: z.string().min(1).max(200),
  environmentRevision: z.string().regex(/^env-v1:[a-f0-9]{64}$/),
}).strict();

const ReadinessExperimentSchema = z.object({
  experimentId: z.string().min(1).max(200),
  missionId: z.string().min(1).max(200),
  calibrationScopeRef: z.string().min(1).max(300),
  registration: z.unknown().optional(),
  result: z.unknown().optional(),
}).strip();

export type RuntimeStartCalibrationReadinessCheckStatus =
  | "passed"
  | "blocked"
  | "review_required";

export type RuntimeStartCalibrationReadinessCheck = {
  id: string;
  status: RuntimeStartCalibrationReadinessCheckStatus;
  detail: string;
};

export type RuntimeStartCalibrationReadinessReport = {
  kind: "p75-calibration-readiness-preflight";
  version: typeof RUNTIME_START_CALIBRATION_READINESS_VERSION;
  readinessRef: string;
  calibrationScopeRef: string | null;
  calibrationPolicyVersion: typeof RUNTIME_START_CALIBRATION_POLICY_VERSION;
  methodVersion: typeof RUNTIME_START_CALIBRATION_METHOD_VERSION;
  evaluationPartition: typeof RUNTIME_START_CALIBRATION_PARTITION;
  status: "blocked" | "review_required";
  collectionAuthorized: false;
  aggregateCalibrationAssessmentComputed: false;
  writesPerformed: false;
  selectionMode: "fixed_safe_probe";
  sourceManifestHash: string;
  inputExperimentCount: number;
  unprocessedExperimentCount: number;
  registeredExperimentCount: number;
  validMissionRegistrationCount: number;
  completeCalibrationV1OutcomeCount: number;
  unresolvedExperimentCount: number;
  excludedContinuationResultCount: number;
  duplicateRecordCount: number;
  conflictingRecordCount: number;
  distinctMissionIdCount: number;
  missionCountIsIndependenceProof: false;
  invalidRecordCount: number;
  invalidRegistrationCount: number;
  invalidResultCount: number;
  checks: RuntimeStartCalibrationReadinessCheck[];
  blockers: string[];
  reviewRequired: string[];
};

export type RuntimeStartCalibrationReadinessInput = {
  candidateScope: unknown;
  experiments: readonly unknown[];
};

function check(
  id: string,
  status: RuntimeStartCalibrationReadinessCheckStatus,
  detail: string,
): RuntimeStartCalibrationReadinessCheck {
  return { id, status, detail };
}

function recordKind(value: unknown): string | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  const kind = (value as Record<string, unknown>).recordKind;
  return typeof kind === "string" ? kind : undefined;
}

function hashOrNull(value: unknown): string | null {
  try {
    const serialized = JSON.stringify(value ?? null);
    return serialized === undefined
      ? null
      : canonicalJsonHash(JSON.parse(serialized));
  } catch {
    return null;
  }
}

function resultMatchesRegistration(
  registration: z.infer<typeof RuntimeStartHypothesisExperimentRegistrationSchema>,
  result: z.infer<typeof RuntimeStartHypothesisExperimentResultSchema>,
): boolean {
  if (
    result.experimentId !== registration.experimentId
    || result.missionId !== registration.missionId
    || result.calibrationScopeRef !== registration.calibrationScopeRef
    || result.evaluationPartition !== registration.evaluationPartition
    || result.measurementValidity !== "complete_fresh"
    || result.environmentStatus !== "same_scope"
    || !result.actualOutcomeKey
    || !result.marginalOutcomeProbabilities
    || result.predictionErrorScore === undefined
    || result.observationRefs.length === 0
  ) {
    return false;
  }

  const expectedForecast = runtimeStartMarginalOutcomeDistribution(registration);
  const observedForecast = new Map(
    result.marginalOutcomeProbabilities.map(({ outcomeKey, probability }) => [
      outcomeKey,
      probability,
    ]),
  );
  const forecastMatches = expectedForecast.length === observedForecast.size
    && expectedForecast.every(({ outcomeKey, probability }) => (
      Math.abs(probability - (observedForecast.get(outcomeKey) ?? Number.NaN)) <= 1e-9
    ));
  if (!forecastMatches) return false;

  const expectedBrierScore = expectedForecast.reduce((total, item) => (
    total + (item.probability - Number(item.outcomeKey === result.actualOutcomeKey)) ** 2
  ), 0);
  return Math.abs(expectedBrierScore - result.predictionErrorScore) <= 1e-9;
}

/**
 * Produces a read-only pre-collection report. It checks stored results against
 * their immutable registrations but does not run the aggregate calibration
 * evaluator, persist an assessment, or authorize collection. Human-governance
 * requirements remain review_required even when every machine-checkable record
 * is internally consistent.
 */
export function evaluateRuntimeStartHypothesisCalibrationReadiness(
  input: RuntimeStartCalibrationReadinessInput,
): RuntimeStartCalibrationReadinessReport {
  const scopeResult = CandidateScopeSchema.safeParse(input.candidateScope);
  const candidateScope = scopeResult.success ? scopeResult.data : undefined;
  const calibrationScopeRef = candidateScope
    ? runtimeStartHypothesisCalibrationScopeRef(candidateScope)
    : null;
  const checks: RuntimeStartCalibrationReadinessCheck[] = [];
  const inputExperimentCount = input.experiments.length;
  const boundedExperiments = input.experiments.slice(
    0,
    RUNTIME_START_CALIBRATION_READINESS_MAX_EXPERIMENTS,
  );
  const unprocessedExperimentCount = Math.max(
    0,
    inputExperimentCount - boundedExperiments.length,
  );
  let invalidRecordCount = 0;
  let duplicateRecordCount = 0;
  let conflictingRecordCount = 0;
  let validMissionRegistrationCount = 0;
  let completeCalibrationV1OutcomeCount = 0;
  let unresolvedExperimentCount = 0;
  let excludedContinuationResultCount = 0;
  let scopeMismatchCount = 0;
  let invalidRegistrationCount = 0;
  let invalidResultCount = 0;
  const missionIds = new Set<string>();
  const parsedRecords: Array<z.infer<typeof ReadinessExperimentSchema>> = [];

  for (const value of boundedExperiments) {
    const parsed = ReadinessExperimentSchema.safeParse(value);
    if (!parsed.success) {
      invalidRecordCount += 1;
      continue;
    }
    parsedRecords.push(parsed.data);
  }

  const recordGroups = new Map<string, Array<{
    record: z.infer<typeof ReadinessExperimentSchema>;
    fingerprint: string | null;
  }>>();
  for (const record of parsedRecords) {
    const group = recordGroups.get(record.experimentId) ?? [];
    group.push({
      record,
      fingerprint: hashOrNull({
        missionId: record.missionId,
        calibrationScopeRef: record.calibrationScopeRef,
        registration: record.registration,
        result: record.result,
      }),
    });
    recordGroups.set(record.experimentId, group);
  }

  const uniqueRecords: Array<z.infer<typeof ReadinessExperimentSchema>> = [];
  for (const group of recordGroups.values()) {
    const fingerprints = new Set(group.map((item) => item.fingerprint));
    if (group.length > 1 && fingerprints.size === 1 && !fingerprints.has(null)) {
      duplicateRecordCount += group.length - 1;
      uniqueRecords.push(group[0]!.record);
      continue;
    }
    if (group.length > 1) {
      conflictingRecordCount += 1;
      unresolvedExperimentCount += 1;
      continue;
    }
    uniqueRecords.push(group[0]!.record);
  }

  for (const record of uniqueRecords) {
    let experimentIsUnresolved = false;
    let registrationBoundToCandidateScope = false;
    const recordScopeMatches = Boolean(
      calibrationScopeRef && record.calibrationScopeRef === calibrationScopeRef,
    );
    if (!recordScopeMatches) {
      scopeMismatchCount += 1;
      experimentIsUnresolved = true;
    }

    const registrationParse = RuntimeStartHypothesisExperimentRegistrationSchema.safeParse(
      record.registration,
    );
    const registration = registrationParse.success ? registrationParse.data : undefined;
    if (!registration) {
      invalidRegistrationCount += 1;
      experimentIsUnresolved = true;
    } else {
      registrationBoundToCandidateScope = Boolean(
        candidateScope
        && calibrationScopeRef
        && registration.experimentId === record.experimentId
        && registration.missionId === record.missionId
        && recordScopeMatches
        && registration.calibrationScopeRef === calibrationScopeRef
        && registration.projectId === candidateScope.projectId
        && registration.projectRevision === candidateScope.projectRevision
        && registration.environmentRevision === candidateScope.environmentRevision
        && registration.selectionMode === "fixed_safe_probe"
        && registration.candidate.decisionValueStatus === "not_computed_bootstrap",
      );
      if (registrationBoundToCandidateScope) {
        validMissionRegistrationCount += 1;
        missionIds.add(registration.missionId);
      } else {
        scopeMismatchCount += 1;
        experimentIsUnresolved = true;
      }
    }

    if (recordKind(record.result) === "P75_HYPOTHESIS_MEASUREMENT_CONTINUATION_RESULT") {
      excludedContinuationResultCount += 1;
      experimentIsUnresolved = true;
    } else if (record.result === undefined || record.result === null) {
      experimentIsUnresolved = true;
    } else {
      const resultParse = RuntimeStartHypothesisExperimentResultSchema.safeParse(record.result);
      const result = resultParse.success ? resultParse.data : undefined;
      if (!result) {
        invalidResultCount += 1;
        experimentIsUnresolved = true;
      } else if (
        !registration
        || !registrationBoundToCandidateScope
        || !resultMatchesRegistration(registration, result)
      ) {
        experimentIsUnresolved = true;
      } else {
        completeCalibrationV1OutcomeCount += 1;
      }
    }

    if (experimentIsUnresolved) unresolvedExperimentCount += 1;
  }

  const sourceManifestHash = canonicalJsonHash({
    calibrationScopeRef,
    inputExperimentCount,
    unprocessedExperimentCount,
    records: uniqueRecords.map((record) => ({
      experimentId: record.experimentId,
      missionId: record.missionId,
      registrationHash: hashOrNull(record.registration),
      resultHash: hashOrNull(record.result),
    })).sort((left, right) => (
      left.experimentId.localeCompare(right.experimentId)
    )),
    invalidRecordCount,
    conflictingRecordCount,
  });

  checks.push(check(
    "candidate-scope",
    candidateScope ? "passed" : "blocked",
    candidateScope
      ? "Candidate project, source revision, and environment revision form a valid scoped identity."
      : "A valid project, source revision, and environment revision are required.",
  ));
  checks.push(check(
    "bounded-input",
    unprocessedExperimentCount === 0 ? "passed" : "blocked",
    unprocessedExperimentCount === 0
      ? `The complete snapshot is within the ${RUNTIME_START_CALIBRATION_READINESS_MAX_EXPERIMENTS}-record review bound.`
      : `${unprocessedExperimentCount} record(s) exceed the ${RUNTIME_START_CALIBRATION_READINESS_MAX_EXPERIMENTS}-record review bound and were not inspected.`,
  ));
  checks.push(check(
    "mission-registration-channel",
    uniqueRecords.length === 0
      ? "review_required"
      : validMissionRegistrationCount === uniqueRecords.length
        ? "passed"
        : "blocked",
    uniqueRecords.length === 0
      ? "No durable Mission registration is available to verify the collection channel."
      : validMissionRegistrationCount === uniqueRecords.length
        ? "Every registration is bound to Mission, Goal, plan, execution, Episode, and the candidate scope."
        : "One or more registrations are malformed or do not match the candidate Mission scope.",
  ));
  checks.push(check(
    "scope-and-record-integrity",
    invalidRecordCount === 0
      && conflictingRecordCount === 0
      && scopeMismatchCount === 0
      && Boolean(candidateScope)
      ? "passed"
      : "blocked",
    invalidRecordCount > 0
      ? "One or more experiment records do not match the required metadata contract."
      : conflictingRecordCount > 0
        ? "Conflicting records reuse an experiment identity."
        : scopeMismatchCount > 0
          ? "One or more records do not match the candidate project or revision scope."
          : candidateScope
            ? "Available records match one candidate calibration scope."
            : "Candidate scope could not be validated.",
  ));
  checks.push(check(
    "unresolved-registrations",
    unresolvedExperimentCount === 0 ? "passed" : "blocked",
    unresolvedExperimentCount === 0
      ? "No unresolved or invalid registered experiment is present in this snapshot."
      : `${unresolvedExperimentCount} registered experiment record(s) remain unresolved or invalid.`,
  ));
  checks.push(check(
    "continuation-exclusion",
    excludedContinuationResultCount === 0 ? "passed" : "blocked",
    excludedContinuationResultCount === 0
      ? "No continuation receipt is admitted as a calibration-v1 result."
      : `${excludedContinuationResultCount} continuation receipt(s) were found and remain ineligible for calibration v1.`,
  ));
  checks.push(check(
    "controlled-environment-reset",
    "review_required",
    "An operator-reviewed repeatable reset procedure is still required; the agent receives no stop or restart authority.",
  ));
  checks.push(check(
    "independent-sampling-definition",
    "review_required",
    `Distinct Mission IDs (${missionIds.size}) are descriptive only and do not establish independent samples.`,
  ));
  checks.push(check(
    "held-out-provenance",
    "review_required",
    "A reviewed declaration must establish that the held-out partition was not used to tune the forecast.",
  ));
  checks.push(check(
    "forecast-and-policy-freeze",
    "review_required",
    "The versioned forecast policy and scope must be reviewed as frozen before the first outcome is observed.",
  ));
  checks.push(check(
    "evaluator-applicability",
    "review_required",
    "Reference tests cover hand-calculated ECE and Mission-cluster bootstrap; a reviewer must still confirm sample sufficiency and that aggregate ECE does not hide an outcome important to the objective.",
  ));
  checks.push(check(
    "advisory-only-authority",
    "passed",
    "This report performs no aggregate calibration assessment or writes, authorizes no collection, and leaves fixed_safe_probe unchanged.",
  ));

  const blockers = checks
    .filter((item) => item.status === "blocked")
    .map((item) => item.id);
  const reviewRequired = checks
    .filter((item) => item.status === "review_required")
    .map((item) => item.id);
  const status = blockers.length > 0 ? "blocked" : "review_required";
  const reportIdentity: Omit<
    RuntimeStartCalibrationReadinessReport,
    | "readinessRef"
    | "collectionAuthorized"
    | "aggregateCalibrationAssessmentComputed"
    | "writesPerformed"
    | "selectionMode"
    | "missionCountIsIndependenceProof"
  > = {
    kind: "p75-calibration-readiness-preflight" as const,
    version: RUNTIME_START_CALIBRATION_READINESS_VERSION,
    calibrationScopeRef,
    calibrationPolicyVersion: RUNTIME_START_CALIBRATION_POLICY_VERSION,
    methodVersion: RUNTIME_START_CALIBRATION_METHOD_VERSION,
    evaluationPartition: RUNTIME_START_CALIBRATION_PARTITION,
    status,
    sourceManifestHash,
    inputExperimentCount,
    unprocessedExperimentCount,
    registeredExperimentCount: uniqueRecords.length,
    validMissionRegistrationCount,
    completeCalibrationV1OutcomeCount,
    unresolvedExperimentCount,
    excludedContinuationResultCount,
    duplicateRecordCount,
    conflictingRecordCount,
    distinctMissionIdCount: missionIds.size,
    invalidRecordCount,
    invalidRegistrationCount,
    invalidResultCount,
    checks,
    blockers,
    reviewRequired,
  };

  return {
    ...reportIdentity,
    readinessRef: `p75-runtime-start-readiness:${canonicalJsonHash(reportIdentity)}`,
    collectionAuthorized: false,
    aggregateCalibrationAssessmentComputed: false,
    writesPerformed: false,
    selectionMode: "fixed_safe_probe",
    missionCountIsIndependenceProof: false,
  };
}