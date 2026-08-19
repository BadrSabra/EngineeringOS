/**
 * Canonical, approval-gateable validation evidence.
 *
 * This is the wire-independent contract shared by the registered validator,
 * the repair loop, the API trace serializer, and dashboard consumers.
 * `evidence` is deliberately part of the result: a passed status without a
 * persisted evidence reference is not sufficient to prove a repair.
 */
export type ValidationStatus = "passed" | "failed" | "skipped" | "unavailable" | "blocked";

export type ValidationFailure = {
  name: string;
  file?: string;
  line?: number;
  message: string;
};

export type ValidationEvidence = {
  evidenceId: string;
  observedAt: string;
  /** Reference to the bounded command result carried by this validation record. */
  artifactRef: string;
};

export type ValidationResult = {
  profile: string;
  status: ValidationStatus;
  scenario: string;
  exitCode: number | null;
  command: string;
  stdout: string;
  stderr: string;
  failedTests: ValidationFailure[];
  changedFiles: string[];
  evidence: ValidationEvidence;
  detail?: string;
};

export function hasValidationEvidence(result: ValidationResult | null | undefined): boolean {
  return Boolean(
    result
    && result.evidence.evidenceId.trim().length > 0
    && result.evidence.observedAt.trim().length > 0
    && result.evidence.artifactRef.trim().length > 0,
  );
}

export function isProvenValidation(result: ValidationResult | null | undefined): boolean {
  return result?.status === "passed" && hasValidationEvidence(result);
}