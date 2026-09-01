/**
 * Server-owned display diagnostics for forensic audits.
 *
 * This is deliberately a projection, not an evidence gate. The gate remains
 * authoritative; this module only turns its already-authoritative signals into
 * a bounded, safe explanation that can be shared by SSE, history, and UI.
 */

export const FORENSIC_DIAGNOSTIC_VERSION = 1 as const;
export const FORENSIC_DIAGNOSTIC_MAX_FILES = 12;

export type ForensicDiagnosticVerdict =
  | "FINDING_PROVEN"
  | "NO_VERIFIED_FINDING"
  | "ANALYSIS_INCOMPLETE";

export type ForensicDiagnosticReason =
  | "COMPLETE_NO_FINDING"
  | "COMPLETE_FINDING"
  | "TIMEOUT"
  | "SCOPE_BLOCKED_READ"
  | "BUDGET_EXHAUSTED"
  | "TOOL_FAILURE"
  | "RECOVERY_BLOCKED"
  | "CLAIM_UNCLOSED"
  | "NO_EVIDENCE_REACHED"
  | "CANCELLED";

export type ForensicDiagnosticNextAction =
  | "NONE"
  | "RETRY_AUDIT"
  | "REVIEW_SCOPE"
  | "RETRY_AFTER_TIMEOUT"
  | "RETRY_WITH_NARROWER_SCOPE";

export type ForensicDiagnostic = {
  version: typeof FORENSIC_DIAGNOSTIC_VERSION;
  verdict: ForensicDiagnosticVerdict;
  reasonCode: ForensicDiagnosticReason;
  explanation: string;
  nextActionCode: ForensicDiagnosticNextAction;
  nextAction: string;
  unreadFiles: string[];
  unreadFileCount: number;
  truncatedFiles: string[];
  truncatedFileCount: number;
};

type DiagnosticRootCoverage = {
  root?: unknown;
  discoveredFiles?: unknown;
  readFiles?: unknown;
  unreadFiles?: unknown;
  status?: unknown;
  unreadPaths?: unknown;
  truncatedPaths?: unknown;
};

type DiagnosticTraceEntry = Record<string, unknown>;

const SAFE_RELATIVE_PATH = /^(?!\.{2}(?:\/|$))(?!\/)(?![A-Za-z]:[\\/])[A-Za-z0-9._~@%+=,:;(){}[\]#&!$' -]+(?:\/[A-Za-z0-9._~@%+=,:;(){}[\]#&!$' -]+)*$/;

function safePath(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const normalized = value.trim().replace(/\\/g, "/").replace(/^\.\/+/, "");
  if (
    normalized.length === 0 ||
    normalized.length > 180 ||
    normalized.includes(":") ||
    normalized.includes("..") ||
    !SAFE_RELATIVE_PATH.test(normalized)
  ) return null;
  return normalized;
}

function boundedPaths(values: unknown): string[] {
  if (!Array.isArray(values)) return [];
  return [...new Set(values.map(safePath).filter((value): value is string => Boolean(value)))]
    .slice(0, FORENSIC_DIAGNOSTIC_MAX_FILES);
}

function latest(trace: readonly DiagnosticTraceEntry[], kind: string): DiagnosticTraceEntry | undefined {
  return [...trace].reverse().find((entry) => entry.kind === kind);
}

function record(value: DiagnosticTraceEntry | undefined): DiagnosticTraceEntry {
  if (!value) return {};
  const nested = value.trace ?? value.state;
  return nested && typeof nested === "object"
    ? { ...value, ...(nested as Record<string, unknown>) }
    : value;
}

function hasCode(trace: readonly DiagnosticTraceEntry[], pattern: RegExp): boolean {
  return trace.some((entry) => pattern.test(String(entry.code ?? entry.diagnosticCode ?? "")));
}

function fromCoverage(status: DiagnosticTraceEntry, integrity: DiagnosticTraceEntry): {
  unread: string[];
  truncated: string[];
  unreadCount: number;
  truncatedCount: number;
} {
  const unread: string[] = [];
  const truncated: string[] = [];
  let scalarUnreadCount = 0;
  const roots = Array.isArray(status.rootCoverage) ? status.rootCoverage : [];
  for (const root of roots.filter((value): value is DiagnosticRootCoverage =>
    Boolean(value) && typeof value === "object" && !Array.isArray(value),
  )) {
    if (typeof root.unreadFiles === "number" && Number.isFinite(root.unreadFiles)) {
      scalarUnreadCount += Math.max(0, Math.floor(root.unreadFiles));
    }
    unread.push(...boundedPaths(root.unreadPaths));
    truncated.push(...boundedPaths(root.truncatedPaths));
  }
  const coverage = integrity.evidenceSourceCoverage;
  if (coverage && typeof coverage === "object") {
    const coverageRecord = coverage as Record<string, unknown>;
    for (const root of (Array.isArray(coverageRecord.roots) ? coverageRecord.roots : [])
      .filter((value): value is DiagnosticRootCoverage =>
        Boolean(value) && typeof value === "object" && !Array.isArray(value),
      )) {
      if (typeof root.unreadFiles === "number" && Number.isFinite(root.unreadFiles)) {
        scalarUnreadCount += Math.max(0, Math.floor(root.unreadFiles));
      }
      unread.push(...boundedPaths(root.unreadPaths));
      truncated.push(...boundedPaths(root.truncatedPaths));
    }
  }
  const unreadUnique = [...new Set(unread)];
  const truncatedUnique = [...new Set(truncated)];
  return {
    unread: unreadUnique.slice(0, FORENSIC_DIAGNOSTIC_MAX_FILES),
    truncated: truncatedUnique.slice(0, FORENSIC_DIAGNOSTIC_MAX_FILES),
    unreadCount: Math.max(unreadUnique.length, scalarUnreadCount),
    truncatedCount: truncatedUnique.length,
  };
}

function actionFor(reasonCode: ForensicDiagnosticReason): Pick<ForensicDiagnostic, "nextActionCode" | "nextAction"> {
  switch (reasonCode) {
    case "COMPLETE_NO_FINDING":
    case "COMPLETE_FINDING":
      return { nextActionCode: "NONE", nextAction: "No further action is needed." };
    case "SCOPE_BLOCKED_READ":
      return { nextActionCode: "REVIEW_SCOPE", nextAction: "Review the requested scope and run the audit again." };
    case "TIMEOUT":
      return { nextActionCode: "RETRY_AFTER_TIMEOUT", nextAction: "Retry the audit after the current analysis window has cleared." };
    case "BUDGET_EXHAUSTED":
      return { nextActionCode: "RETRY_WITH_NARROWER_SCOPE", nextAction: "Retry with a narrower, explicit scope." };
    case "CLAIM_UNCLOSED":
      return { nextActionCode: "RETRY_AUDIT", nextAction: "Retry the audit so the retained evidence can be reconciled into a closed claim." };
    case "RECOVERY_BLOCKED":
      return { nextActionCode: "RETRY_AUDIT", nextAction: "Retry the audit to start a fresh bounded recovery." };
    case "TOOL_FAILURE":
      return { nextActionCode: "RETRY_AUDIT", nextAction: "Retry the audit after the analysis tool is available." };
    case "CANCELLED":
      return { nextActionCode: "RETRY_AUDIT", nextAction: "Start the audit again when you are ready." };
    default:
      return { nextActionCode: "RETRY_AUDIT", nextAction: "Retry the audit with a clear target scope." };
  }
}

function diagnostic(
  verdict: ForensicDiagnosticVerdict,
  reasonCode: ForensicDiagnosticReason,
  unread: string[],
  truncated: string[],
  unreadCount = unread.length,
  truncatedCount = truncated.length,
): ForensicDiagnostic {
  const explanation = verdict === "FINDING_PROVEN"
    ? "A defect was verified against the accepted forensic evidence."
    : reasonCode === "COMPLETE_NO_FINDING"
      ? "No defect was verified after complete coverage of the requested scope."
      : reasonCode === "SCOPE_BLOCKED_READ"
        ? "The requested scope could not be read completely, so the result is incomplete."
        : reasonCode === "TIMEOUT"
          ? "The analysis timed out before complete coverage and verification were established."
          : reasonCode === "BUDGET_EXHAUSTED"
            ? "The bounded analysis budget ended before complete coverage and verification were established."
            : reasonCode === "TOOL_FAILURE"
              ? "A required project analysis tool did not complete, so the result is incomplete."
              : reasonCode === "RECOVERY_BLOCKED"
                ? "Bounded recovery did not produce a complete, verified forensic report."
                : reasonCode === "CLAIM_UNCLOSED"
                  ? "Source evidence was retained, but the required forensic claim was not closed."
                  : reasonCode === "CANCELLED"
                    ? "The audit was cancelled before a complete, verified result was established."
                    : "The audit did not reach enough source evidence to establish a complete result.";
  return {
    version: FORENSIC_DIAGNOSTIC_VERSION,
    verdict,
    reasonCode,
    explanation,
    ...actionFor(reasonCode),
    unreadFiles: unread,
    unreadFileCount: unreadCount,
    truncatedFiles: truncated,
    truncatedFileCount: truncatedCount,
  };
}

/**
 * Derive the only public forensic diagnostic from server-owned trace fields.
 * Never inspect report prose or expose provider/tool diagnostics here.
 */
export function deriveForensicDiagnostic(trace: readonly unknown[]): ForensicDiagnostic | null {
  const entries = trace.filter(
    (entry): entry is DiagnosticTraceEntry => Boolean(entry) && typeof entry === "object" && !Array.isArray(entry),
  );
  const status = record(latest(entries, "forensic_status"));
  if (
    !status.sourceCoverage &&
    !status.findingStatus &&
    !latest(entries, "forensic_terminal") &&
    !latest(entries, "audit_state")
  ) return null;
  const audit = record(latest(entries, "audit_state"));
  const integrity = record(latest(entries, "evidence_integrity"));
  const terminal = record(latest(entries, "forensic_terminal"));
  const done = record(latest(entries, "done"));
  const outcome = record(latest(entries, "terminal_outcome"));
  const toolFailure = [...entries].reverse().find((entry) =>
    entry.kind === "tool_result" && ["failed", "unavailable", "cancelled"].includes(String(entry.resultKind)),
  );
  const coverage = String(status.sourceCoverage ?? audit.sourceCoverage ?? "NONE");
  const finding = String(status.findingStatus ?? audit.findingStatus ?? "NOT_PROVEN");
  const behavior = String(status.behavioralAssessment ?? audit.behaviorAssessment ?? "NOT_STARTED");
  const finalState = String(record(latest(entries, "decision_trace")).finalState ?? "");
  const evidenceConsistent = integrity.consistent === true;
  const scope = fromCoverage(status, integrity);
  const cancelled = outcome.failureKind === "CANCELLATION"
    || done.stopReason === "cancelled"
    || toolFailure?.resultKind === "cancelled";
  const acceptedNoFinding =
    finding === "NO_FINDING" &&
    coverage === "COMPLETE" &&
    behavior === "COMPLETE" &&
    finalState === "VERIFIED" &&
    evidenceConsistent;
  if (acceptedNoFinding && !cancelled) {
    return diagnostic("NO_VERIFIED_FINDING", "COMPLETE_NO_FINDING", scope.unread, scope.truncated, scope.unreadCount, scope.truncatedCount);
  }
  if (finding === "PROVEN" && coverage === "COMPLETE" && !cancelled && finalState === "VERIFIED" && evidenceConsistent) {
    return diagnostic("FINDING_PROVEN", "COMPLETE_FINDING", scope.unread, scope.truncated, scope.unreadCount, scope.truncatedCount);
  }

  let reasonCode: ForensicDiagnosticReason = "NO_EVIDENCE_REACHED";
  const terminalKind = String(terminal.terminalKind ?? "");
  const analysisCategory = String(toolFailure?.analysisFailureCategory ?? "");
  if (cancelled) reasonCode = "CANCELLED";
  else if (analysisCategory === "timeout" || done.stopReason === "provider_timeout") reasonCode = "TIMEOUT";
  else if (analysisCategory === "root_unavailable" || analysisCategory === "stale_revision" || String(toolFailure?.diagnosticCode ?? "").includes("SCOPE")) {
    reasonCode = "SCOPE_BLOCKED_READ";
  } else if (toolFailure) reasonCode = "TOOL_FAILURE";
  else if (terminalKind === "NO_RESPONSE_RECOVERY_BLOCKED" || outcome.failureKind === "RECOVERY_FAILURE" || hasCode(entries, /RECOVERY.*(?:FAILED|BLOCKED)|CORRECTION_FAILED/i)) {
    reasonCode = "RECOVERY_BLOCKED";
  } else if (terminalKind === "EVIDENCE_AVAILABLE_BUT_CLAIM_UNCLOSED" || done.stopReason === "claim_unclosed") {
    reasonCode = "CLAIM_UNCLOSED";
  } else if (coverage === "PARTIAL" && (scope.unreadCount > 0 || scope.truncatedCount > 0)) {
    reasonCode = "SCOPE_BLOCKED_READ";
  } else if (terminalKind === "INVESTIGATION_BUDGET_EXHAUSTED" || done.stopReason === "iteration_budget" || done.stopReason === "soft_limit" || coverage === "PARTIAL") {
    reasonCode = "BUDGET_EXHAUSTED";
  } else if (terminalKind === "INVESTIGATION_NOT_STARTED" || terminalKind === "NO_EVIDENCE_FOUND" || coverage === "NONE") {
    reasonCode = "NO_EVIDENCE_REACHED";
  }
  return diagnostic("ANALYSIS_INCOMPLETE", reasonCode, scope.unread, scope.truncated, scope.unreadCount, scope.truncatedCount);
}