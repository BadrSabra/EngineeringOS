import { z } from "zod";
import {
  AGENT_STATE_LIMITS,
  AGENT_STATE_SCHEMA_VERSION,
  boundedContractSchema,
  boundedString,
  safePublicString,
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

export const FailureDiagnosisSchema = boundedContractSchema(z.object({
  schemaVersion: z.literal(AGENT_STATE_SCHEMA_VERSION),
  kind: FailureKindSchema,
  failedAssumptions: z.array(boundedString(256)).max(32),
  affectedFacts: z.array(boundedString(256)).max(64),
  affectedClaims: z.array(boundedString(256)).max(64),
  requiredObservations: z.array(boundedString(256)).max(64),
  retryable: z.boolean(),
  requiresApproval: z.boolean(),
  reasonCode: boundedString(120).optional(),
}).strict(), AGENT_STATE_LIMITS.failureDiagnosisBytes);
export type FailureDiagnosis = z.infer<typeof FailureDiagnosisSchema>;

export type PublicFailureDiagnosis = Pick<
  FailureDiagnosis,
  "schemaVersion" | "kind" | "retryable" | "requiresApproval"
> & {
  reasonCode?: string;
  affectedClaimCount: number;
  requiredObservationCount: number;
};

export function toPublicFailureDiagnosis(value: FailureDiagnosis): PublicFailureDiagnosis {
  return {
    schemaVersion: value.schemaVersion,
    kind: value.kind,
    retryable: value.retryable,
    requiresApproval: value.requiresApproval,
    ...(value.reasonCode ? { reasonCode: safePublicString(value.reasonCode, 120) } : {}),
    affectedClaimCount: value.affectedClaims.length,
    requiredObservationCount: value.requiredObservations.length,
  };
}

export function parseFailureDiagnosis(value: unknown): FailureDiagnosis {
  return FailureDiagnosisSchema.parse(value);
}