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
  /** Safe browser proof metadata; never contains a local file path. */
  profileName?: string;
  permittedOrigin?: string;
  revision?: string;
  screenshotAvailable?: boolean;
  consoleErrorCount?: number;
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

/**
 * The only validation data safe to persist in chat history or expose to a
 * client. Command output and failure details can contain secrets, source
 * excerpts, and environment data, so they must never cross that boundary.
 */
export type PublicValidationResult = Pick<
  ValidationResult,
  "profile" | "status" | "scenario" | "exitCode" | "evidence"
> & {
  detail?: string;
};

function sanitizeValidationDetail(value: string): string {
  return value
    .replace(/\s+/g, " ")
    .replace(/\/(?:home\/runner(?:\/workspace)?|workspace|tmp|app|srv|var\/task|mnt\/data)\/\S+/g, "[runtime path]")
    .replace(/\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi, "[redacted email]")
    .replace(/\b(?:bearer|token|secret|password|api[_ -]?key)\s*[:=]\s*\S+/gi, "[redacted credential]")
    .replace(/\beyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\b/g, "[redacted token]")
    .slice(0, 240);
}

export function toPublicValidationResult(result: ValidationResult): PublicValidationResult {
  return {
    profile: result.profile,
    status: result.status,
    scenario: result.scenario,
    exitCode: result.exitCode,
    evidence: result.evidence,
    ...(result.detail ? { detail: sanitizeValidationDetail(result.detail) } : {}),
  };
}

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