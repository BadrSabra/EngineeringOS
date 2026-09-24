import { z } from "zod";
import {
  AGENT_STATE_LIMITS,
  AGENT_STATE_SCHEMA_VERSION,
  boundedContractSchema,
  boundedString,
} from "./contract-utils.js";

export const FailureKindSchema = z.enum([
  "NO_PROGRESS",
  "MISSING_REQUIRED_READ",
  "STALE_PROJECT_REVISION",
  "STALE_RUNTIME",
  "PRECONDITION_FAILED",
  "VALIDATOR_FAILED",
  "EXPECTED_EFFECT_MISSING",
  "CONTRADICTORY_STATE",
  "EXTERNAL_DRIFT",
  "AUTHORIZATION_REQUIRED",
  "EVIDENCE_INCOMPLETE",
  "TOOL_UNAVAILABLE",
]);
export type FailureKind = z.infer<typeof FailureKindSchema>;

export const FailureReasonCodeSchema = z.enum([
  "NO_PROGRESS",
  "REQUIRED_READ_MISSING",
  "PROJECT_REVISION_STALE",
  "RUNTIME_STALE",
  "PRECONDITIONS_FAILED",
  "VALIDATOR_FAILED",
  "EXPECTED_EFFECT_NOT_OBSERVED",
  "STATE_CONTRADICTED",
  "EXTERNAL_STATE_DRIFT",
  "OWNER_AUTHORIZATION_MISSING",
  "EVIDENCE_INCOMPLETE",
  "CAPABILITY_UNAVAILABLE",
  "EVIDENCE_REQUIRED",
]);
export type FailureReasonCode = z.infer<typeof FailureReasonCodeSchema>;

export const FailureNextActionCodeSchema = z.enum([
  "OBSERVE_PROGRESS",
  "READ_REQUIRED_SOURCE",
  "REFRESH_PROJECT_REVISION",
  "VERIFY_RUNTIME_REVISION",
  "RECHECK_PRECONDITIONS",
  "REPAIR_AND_REVALIDATE",
  "OBSERVE_EXPECTED_EFFECT",
  "RESOLVE_CONTRADICTION",
  "RECONCILE_EXTERNAL_STATE",
  "REQUEST_APPROVAL",
  "GATHER_REQUIRED_EVIDENCE",
  "RETRY_OR_REPLACE_CAPABILITY",
]);
export type FailureNextActionCode = z.infer<typeof FailureNextActionCodeSchema>;

export const FailureDiagnosisSchema = boundedContractSchema(z.object({
  schemaVersion: z.literal(AGENT_STATE_SCHEMA_VERSION),
  episodeId: boundedString(200).optional(),
  actionId: boundedString(200).optional(),
  kind: FailureKindSchema,
  failedAssumptions: z.array(boundedString(256)).max(32),
  affectedFacts: z.array(boundedString(256)).max(64),
  affectedClaims: z.array(boundedString(256)).max(64),
  requiredObservations: z.array(boundedString(256)).max(64),
  retryable: z.boolean(),
  requiresApproval: z.boolean(),
  reasonCode: FailureReasonCodeSchema.optional(),
  nextActionCode: FailureNextActionCodeSchema.optional(),
}).strict(), AGENT_STATE_LIMITS.failureDiagnosisBytes);
export type FailureDiagnosis = z.infer<typeof FailureDiagnosisSchema>;

export const FailureDiagnosisSummarySchema = z.object({
  kind: FailureKindSchema,
  reasonCode: FailureReasonCodeSchema,
  nextActionCode: FailureNextActionCodeSchema,
  retryable: z.boolean(),
  requiresApproval: z.boolean(),
}).strict();
export type FailureDiagnosisSummary = z.infer<typeof FailureDiagnosisSummarySchema>;

export function toFailureDiagnosisSummary(value: FailureDiagnosis): FailureDiagnosisSummary {
  return FailureDiagnosisSummarySchema.parse({
    kind: value.kind,
    reasonCode: value.reasonCode,
    nextActionCode: value.nextActionCode,
    retryable: value.retryable,
    requiresApproval: value.requiresApproval,
  });
}

export type PublicFailureDiagnosis = Pick<
  FailureDiagnosis,
  "schemaVersion" | "kind" | "retryable" | "requiresApproval"
> & {
  reasonCode?: FailureReasonCode;
  nextActionCode?: FailureNextActionCode;
  affectedClaimCount: number;
  requiredObservationCount: number;
};

export function toPublicFailureDiagnosis(value: FailureDiagnosis): PublicFailureDiagnosis {
  return {
    schemaVersion: value.schemaVersion,
    kind: value.kind,
    retryable: value.retryable,
    requiresApproval: value.requiresApproval,
    ...(value.reasonCode ? { reasonCode: value.reasonCode } : {}),
    ...(value.nextActionCode ? { nextActionCode: value.nextActionCode } : {}),
    affectedClaimCount: value.affectedClaims.length,
    requiredObservationCount: value.requiredObservations.length,
  };
}

export function parseFailureDiagnosis(value: unknown): FailureDiagnosis {
  return FailureDiagnosisSchema.parse(value);
}