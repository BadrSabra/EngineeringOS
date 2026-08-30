/**
 * Canonical, approval-gateable validation evidence.
 *
 * This is the wire-independent contract shared by the registered validator,
 * the repair loop, the API trace serializer, and dashboard consumers.
 * `evidence` is deliberately part of the result: a passed status without a
 * persisted evidence reference is not sufficient to prove a repair.
 */
export type ValidationStatus = "passed" | "failed" | "skipped" | "unavailable" | "blocked";
export type ValidationTerminalState =
  | "running"
  | "passed"
  | "failed"
  | "blocked"
  | "unavailable"
  | "timed_out";
/** Safe, operator-facing reasons for a browser validation preflight block. */
export type BrowserValidationBlockReason =
  | "ownership"
  | "invalid_profile"
  | "resource_limit"
  | "stale_revision";

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
  /** Integrity identifiers for delivery validation, when validating a candidate. */
  operationId?: string;
  projectRevision?: string;
  treeDigestVersion?: string;
  baseTreeHash?: string;
  candidateHash?: string;
  changeSetHash?: string;
  promotedHash?: string;
  committedTreeHash?: string;
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
  reasonCode?: BrowserValidationBlockReason;
  /** Server-owned operator telemetry; never supplied by model output. */
  processBudgetMs?: number;
  overallBudgetMs?: number;
  elapsedMs?: number;
  remainingMs?: number;
  terminalState?: ValidationTerminalState;
  nextAction?: string;
};

/**
 * The only validation data safe to persist in chat history or expose to a
 * client. Command output and failure details can contain secrets, source
 * excerpts, and environment data, so they must never cross that boundary.
 */
export type PublicValidationResult = Pick<
  ValidationResult,
  | "profile" | "status" | "scenario" | "exitCode" | "evidence" | "reasonCode"
  | "processBudgetMs" | "overallBudgetMs" | "elapsedMs" | "remainingMs"
  | "terminalState" | "nextAction"
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
  const evidence = result.evidence;
  return {
    profile: result.profile,
    status: result.status,
    scenario: result.scenario,
    exitCode: result.exitCode,
    evidence: {
      evidenceId: evidence.evidenceId,
      observedAt: evidence.observedAt,
      artifactRef: evidence.artifactRef,
      ...(evidence.profileName ? { profileName: evidence.profileName } : {}),
      ...(evidence.permittedOrigin ? { permittedOrigin: evidence.permittedOrigin } : {}),
      ...(evidence.revision ? { revision: evidence.revision } : {}),
      ...(evidence.operationId ? { operationId: evidence.operationId } : {}),
      ...(evidence.projectRevision ? { projectRevision: evidence.projectRevision } : {}),
      ...(evidence.treeDigestVersion ? { treeDigestVersion: evidence.treeDigestVersion } : {}),
      ...(evidence.baseTreeHash ? { baseTreeHash: evidence.baseTreeHash } : {}),
      ...(evidence.candidateHash ? { candidateHash: evidence.candidateHash } : {}),
      ...(evidence.changeSetHash ? { changeSetHash: evidence.changeSetHash } : {}),
      ...(evidence.promotedHash ? { promotedHash: evidence.promotedHash } : {}),
      ...(evidence.committedTreeHash ? { committedTreeHash: evidence.committedTreeHash } : {}),
      ...(evidence.screenshotAvailable !== undefined ? { screenshotAvailable: evidence.screenshotAvailable } : {}),
      ...(evidence.consoleErrorCount !== undefined ? { consoleErrorCount: evidence.consoleErrorCount } : {}),
    },
    ...(result.reasonCode ? { reasonCode: result.reasonCode } : {}),
    ...(result.processBudgetMs !== undefined ? { processBudgetMs: result.processBudgetMs } : {}),
    ...(result.overallBudgetMs !== undefined ? { overallBudgetMs: result.overallBudgetMs } : {}),
    ...(result.elapsedMs !== undefined ? { elapsedMs: result.elapsedMs } : {}),
    ...(result.remainingMs !== undefined ? { remainingMs: result.remainingMs } : {}),
    ...(result.terminalState ? { terminalState: result.terminalState } : {}),
    ...(result.nextAction ? { nextAction: sanitizeValidationDetail(result.nextAction) } : {}),
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