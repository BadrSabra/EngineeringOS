import { z } from "zod";
import { canonicalJsonHash } from "@workspace/ai-orchestrator";
import {
  RUNTIME_START_OBSERVATION_REF,
  RuntimeStartHypothesisExperimentRegistrationSchema,
  type RuntimeStartHypothesisExperimentRegistration,
  type RuntimeStartOutcomeKey,
} from "./runtime-start-hypothesis-experiment.js";

export const RUNTIME_START_MEASUREMENT_CONTINUATION_POLICY_VERSION =
  "runtime-start-observe-only-continuation-v1";

const HashSchema = z.string().regex(/^[a-f0-9]{64}$/);
const ExperimentIdSchema = z.string().regex(/^p75-runtime-start:[a-f0-9]{64}$/);
const ContinuationIdSchema = z.string().regex(/^p75-runtime-start-continuation:[a-f0-9]{64}$/);
const OutcomeKeySchema = z.enum([
  "runtime_running",
  "runtime_not_running",
  "runtime_other",
  "runtime_unexpected",
]);
const MeasurementIdentitySchema = z.object({
  projectId: z.string().min(1).max(200),
  missionId: z.string().min(1).max(200),
  goalId: z.string().min(1).max(200),
  executionId: z.string().min(1).max(200),
  attempt: z.number().int().nonnegative(),
  episodeId: z.string().min(1).max(200),
  planRevision: z.string().min(1).max(256),
  projectRevision: z.string().min(1).max(200),
  environmentRevision: z.string().regex(/^env-v1:[a-f0-9]{64}$/),
}).strict();

const SourceIdentitySchema = z.object({
  experimentId: ExperimentIdSchema,
  registrationHash: HashSchema,
  projectId: z.string().min(1).max(200),
  missionId: z.string().min(1).max(200),
  goalId: z.string().min(1).max(200),
  executionId: z.string().min(1).max(200),
  attempt: z.number().int().nonnegative(),
  episodeId: z.string().min(1).max(200),
  actionId: z.string().min(1).max(200),
  planRevision: z.string().min(1).max(256),
  projectRevision: z.string().min(1).max(200),
  environmentRevision: z.string().regex(/^env-v1:[a-f0-9]{64}$/),
  calibrationScopeRef: z.string().regex(/^p75-runtime-start-calibration:[a-f0-9]{64}$/),
}).strict();

const ContinuationIdentitySchema = z.object({
  schemaVersion: z.literal(1),
  recordKind: z.literal("P75_HYPOTHESIS_MEASUREMENT_CONTINUATION_REQUESTED"),
  policyVersion: z.literal(RUNTIME_START_MEASUREMENT_CONTINUATION_POLICY_VERSION),
  source: SourceIdentitySchema,
  measurement: MeasurementIdentitySchema,
  operationKind: z.literal("server_owned_read_only_observation"),
  observationProfile: z.literal("runtime.status"),
  observationRef: z.literal(RUNTIME_START_OBSERVATION_REF),
  requestedAt: z.string().datetime(),
}).strict();

function continuationIdentityHash(identity: z.infer<typeof ContinuationIdentitySchema>): string {
  return canonicalJsonHash(identity);
}

export const RuntimeStartHypothesisMeasurementContinuationRequestSchema =
  ContinuationIdentitySchema.extend({
    continuationId: ContinuationIdSchema,
  }).strict().superRefine((request, context) => {
    const { continuationId, ...identity } = request;
    const expectedId = `p75-runtime-start-continuation:${continuationIdentityHash(identity)}`;
    if (continuationId !== expectedId) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Continuation identity must match both immutable source and observe-only measurement bindings.",
        path: ["continuationId"],
      });
    }
    if (
      request.measurement.projectId !== request.source.projectId
      || request.measurement.missionId !== request.source.missionId
      || request.measurement.goalId !== request.source.goalId
      || request.measurement.executionId !== request.source.executionId
      || request.measurement.attempt <= request.source.attempt
      || request.measurement.episodeId === request.source.episodeId
      || request.measurement.planRevision !== request.source.planRevision
      || request.measurement.projectRevision !== request.source.projectRevision
      || request.measurement.environmentRevision !== request.source.environmentRevision
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: "A continuation must use a later attempt and new Episode, with the original execution and unchanged project/environment scope.",
        path: ["measurement"],
      });
    }
  });

export type RuntimeStartHypothesisMeasurementContinuationRequest = z.infer<
  typeof RuntimeStartHypothesisMeasurementContinuationRequestSchema
>;

export function buildRuntimeStartHypothesisMeasurementContinuationRequest(input: {
  registration: RuntimeStartHypothesisExperimentRegistration;
  measurement: z.input<typeof MeasurementIdentitySchema>;
  requestedAt: string;
}): RuntimeStartHypothesisMeasurementContinuationRequest {
  const sourceRegistration = RuntimeStartHypothesisExperimentRegistrationSchema.parse(
    input.registration,
  );
  const measurement = MeasurementIdentitySchema.parse(input.measurement);
  const source = SourceIdentitySchema.parse({
    experimentId: sourceRegistration.experimentId,
    registrationHash: canonicalJsonHash(sourceRegistration),
    projectId: sourceRegistration.projectId,
    missionId: sourceRegistration.missionId,
    goalId: sourceRegistration.goalId,
    executionId: sourceRegistration.executionId,
    attempt: sourceRegistration.attempt,
    episodeId: sourceRegistration.episodeId,
    actionId: sourceRegistration.actionId,
    planRevision: sourceRegistration.planRevision,
    projectRevision: sourceRegistration.projectRevision,
    environmentRevision: sourceRegistration.environmentRevision,
    calibrationScopeRef: sourceRegistration.calibrationScopeRef,
  });
  const identity = ContinuationIdentitySchema.parse({
    schemaVersion: 1,
    recordKind: "P75_HYPOTHESIS_MEASUREMENT_CONTINUATION_REQUESTED",
    policyVersion: RUNTIME_START_MEASUREMENT_CONTINUATION_POLICY_VERSION,
    source,
    measurement,
    operationKind: "server_owned_read_only_observation",
    observationProfile: "runtime.status",
    observationRef: RUNTIME_START_OBSERVATION_REF,
    requestedAt: input.requestedAt,
  });

  return RuntimeStartHypothesisMeasurementContinuationRequestSchema.parse({
    ...identity,
    continuationId: `p75-runtime-start-continuation:${continuationIdentityHash(identity)}`,
  });
}

export function parseRuntimeStartHypothesisMeasurementContinuationRequest(
  value: unknown,
): RuntimeStartHypothesisMeasurementContinuationRequest {
  return RuntimeStartHypothesisMeasurementContinuationRequestSchema.parse(value);
}

export const RuntimeStartHypothesisMeasurementContinuationResultSchema = z.object({
  schemaVersion: z.literal(1),
  recordKind: z.literal("P75_HYPOTHESIS_MEASUREMENT_CONTINUATION_RESULT"),
  policyVersion: z.literal(RUNTIME_START_MEASUREMENT_CONTINUATION_POLICY_VERSION),
  continuationId: ContinuationIdSchema,
  continuationRequestHash: HashSchema,
  sourceExperimentId: ExperimentIdSchema,
  sourceRegistrationHash: HashSchema,
  measurement: MeasurementIdentitySchema,
  observationProfile: z.literal("runtime.status"),
  observationRef: z.literal(RUNTIME_START_OBSERVATION_REF),
  observationId: z.string().min(1).max(256).optional(),
  observedProjectRevision: z.string().min(1).max(200).optional(),
  observedEnvironmentRevision: z.string().regex(/^env-v1:[a-f0-9]{64}$/).optional(),
  observedAt: z.string().datetime().optional(),
  measurementValidity: z.enum([
    "complete_fresh",
    "partial",
    "stale",
    "failed",
    "unknown",
  ]),
  environmentStatus: z.enum(["same_scope", "changed", "unknown"]),
  actualOutcomeKey: OutcomeKeySchema.optional(),
  resultId: z.string().regex(/^p75-runtime-start-continuation-result:[a-f0-9]{64}$/),
  calibrationEligibility: z.literal("not_eligible_without_versioned_policy_review"),
  resolvedAt: z.string().datetime(),
}).strict().superRefine((result, context) => {
  const { resultId, ...identity } = result;
  const expectedResultId =
    `p75-runtime-start-continuation-result:${canonicalJsonHash(identity)}`;
  if (result.resultId !== expectedResultId) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      message: "Continuation result identity must match its source request and observation.",
      path: ["resultId"],
    });
  }
  const fresh = result.measurementValidity === "complete_fresh";
  if (fresh && (
    result.environmentStatus !== "same_scope"
    || !result.observationId
    || !result.observedAt
    || !result.observedProjectRevision
    || !result.observedEnvironmentRevision
    || !result.actualOutcomeKey
  )) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      message: "A fresh continuation measurement needs a retained runtime-status observation and matching scope.",
      path: ["measurementValidity"],
    });
  }
  if (!fresh && result.actualOutcomeKey !== undefined) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      message: "Incomplete, stale, failed, or unknown measurements cannot assert an outcome.",
      path: ["actualOutcomeKey"],
    });
  }
});

export type RuntimeStartHypothesisMeasurementContinuationResult = z.infer<
  typeof RuntimeStartHypothesisMeasurementContinuationResultSchema
>;

export function buildRuntimeStartHypothesisMeasurementContinuationResult(input: {
  request: RuntimeStartHypothesisMeasurementContinuationRequest;
  observation?: {
    id: string;
    predicate: "runtime.status";
    projectRevision: string | null;
    environmentRevision: string | null;
    freshness: "fresh" | "stale";
    environmentFreshness: "fresh" | "stale";
    outcomeKey?: RuntimeStartOutcomeKey;
    observedAt: string;
  };
  unavailableAs?: "partial" | "failed" | "unknown";
  resolvedAt: string;
}): RuntimeStartHypothesisMeasurementContinuationResult {
  const request = RuntimeStartHypothesisMeasurementContinuationRequestSchema.parse(
    input.request,
  );
  const observation = input.observation;
  if (observation && observation.predicate !== "runtime.status") {
    throw new Error("P7.5 continuation accepts only the server-owned runtime.status observation.");
  }
  const observedProjectRevision = observation?.projectRevision ?? undefined;
  const observedEnvironmentRevision = observation?.environmentRevision ?? undefined;
  const environmentStatus = !observation
    || !observedProjectRevision
    || !observedEnvironmentRevision
    ? "unknown"
    : observedProjectRevision === request.measurement.projectRevision
      && observedEnvironmentRevision === request.measurement.environmentRevision
      ? "same_scope"
      : "changed";
  const measurementValidity = !observation
    ? input.unavailableAs ?? "unknown"
    : environmentStatus === "changed"
      || observation.freshness === "stale"
      || observation.environmentFreshness === "stale"
      ? "stale"
      : environmentStatus === "same_scope" && observation.outcomeKey
        ? "complete_fresh"
        : "partial";
  const actualOutcomeKey = measurementValidity === "complete_fresh"
    ? observation?.outcomeKey
    : undefined;
  const base = {
    schemaVersion: 1 as const,
    recordKind: "P75_HYPOTHESIS_MEASUREMENT_CONTINUATION_RESULT" as const,
    policyVersion: RUNTIME_START_MEASUREMENT_CONTINUATION_POLICY_VERSION,
    continuationId: request.continuationId,
    continuationRequestHash: canonicalJsonHash(request),
    sourceExperimentId: request.source.experimentId,
    sourceRegistrationHash: request.source.registrationHash,
    measurement: request.measurement,
    observationProfile: request.observationProfile,
    observationRef: request.observationRef,
    ...(observation ? {
      observationId: observation.id,
      ...(observedProjectRevision ? { observedProjectRevision } : {}),
      ...(observedEnvironmentRevision ? { observedEnvironmentRevision } : {}),
      observedAt: observation.observedAt,
    } : {}),
    measurementValidity,
    environmentStatus,
    ...(actualOutcomeKey ? { actualOutcomeKey } : {}),
    calibrationEligibility: "not_eligible_without_versioned_policy_review" as const,
    resolvedAt: input.resolvedAt,
  };
  const result = RuntimeStartHypothesisMeasurementContinuationResultSchema.parse({
    ...base,
    resultId: `p75-runtime-start-continuation-result:${canonicalJsonHash(base)}`,
  });
  return parseRuntimeStartHypothesisMeasurementContinuationResult(result, request);
}

export function parseRuntimeStartHypothesisMeasurementContinuationResult(
  value: unknown,
  requestValue: unknown,
): RuntimeStartHypothesisMeasurementContinuationResult {
  const request = RuntimeStartHypothesisMeasurementContinuationRequestSchema.parse(requestValue);
  const result = RuntimeStartHypothesisMeasurementContinuationResultSchema.parse(value);
  if (
    result.continuationId !== request.continuationId
    || result.continuationRequestHash !== canonicalJsonHash(request)
    || result.sourceExperimentId !== request.source.experimentId
    || result.sourceRegistrationHash !== request.source.registrationHash
    || canonicalJsonHash(result.measurement) !== canonicalJsonHash(request.measurement)
    || Date.parse(result.resolvedAt) < Date.parse(request.requestedAt)
    || (result.observedAt !== undefined && (
      Date.parse(result.observedAt) < Date.parse(request.requestedAt)
      || Date.parse(result.observedAt) > Date.parse(result.resolvedAt)
    ))
    || (result.measurementValidity === "complete_fresh" && (
      result.observedProjectRevision !== request.measurement.projectRevision
      || result.observedEnvironmentRevision !== request.measurement.environmentRevision
    ))
  ) {
    throw new Error("Continuation result does not match its immutable source request.");
  }
  return result;
}