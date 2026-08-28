import type { AgentStep } from "@workspace/ai-orchestrator";

export type AiTerminalFailureKind =
  | "TOOL_FAILURE"
  | "CANCELLATION"
  | "RECOVERY_FAILURE"
  | "INCOMPLETE";

export type AiTerminalOutcome = {
  outcome: "SUCCEEDED" | "FAILED" | "INTERRUPTED";
  failureKind?: AiTerminalFailureKind;
  retryable: boolean;
  code?: string;
  message?: string;
  recoveryState: "NONE" | "REQUIRED" | "INCOMPLETE";
  /** True only when the existing forensic evidence gates accepted the result. */
  evidenceAccepted: boolean;
};

type TerminalClassifierInput = {
  result?: unknown;
  trace: readonly AgentStep[];
  cancelled?: boolean;
  transportInterrupted?: boolean;
  endedBeforeEvidence?: boolean;
  requiresEvidence?: boolean;
  /** Route intent, rather than response prose, determines forensic gates. */
  forensic?: boolean;
};

function record(step: AgentStep | undefined): Record<string, unknown> {
  if (!step || typeof step !== "object") return {};
  const value = step as unknown as Record<string, unknown>;
  const nested = value.trace ?? value.state;
  return nested && typeof nested === "object"
    ? { ...value, ...(nested as Record<string, unknown>) }
    : value;
}

function latest<T extends AgentStep["kind"]>(
  trace: readonly AgentStep[],
  kind: T,
): AgentStep | undefined {
  return [...trace].reverse().find((step) => step.kind === kind);
}

function isSafeCode(value: unknown): value is string {
  return typeof value === "string"
    && /^[A-Z][A-Z0-9_]{2,79}$/.test(value);
}

function safeToolCode(step: AgentStep | undefined): string {
  const code = record(step).diagnosticCode;
  return isSafeCode(code) && code.startsWith("TOOL_") ? code : "TOOL_EXECUTION_FAILED";
}

function safeToolMessage(step: AgentStep | undefined): string {
  // Tool summaries can contain repository text, paths, or provider diagnostics.
  // The public terminal contract needs a stable explanation, not a copy of
  // untrusted tool output.
  void step;
  return "The required project analysis tool did not complete.";
}

function responseText(result: unknown): string {
  if (!result || typeof result !== "object") return "";
  const response = (result as { response?: unknown }).response;
  return typeof response === "string" ? response : "";
}

function hasDiagnostic(
  trace: readonly AgentStep[],
  pattern: RegExp,
  includeDetails = false,
): boolean {
  return trace.some((step) => {
    const value = record(step);
    return pattern.test(String(value.code ?? ""))
      || (includeDetails
        && Array.isArray(value.details)
        && value.details.some((detail) => pattern.test(String(detail))));
  });
}

/**
 * Classify a completed orchestrator turn before it is persisted or projected.
 *
 * Precedence is intentionally strict:
 * cancellation/transport interruption > required tool failure > terminal
 * recovery failure > incomplete evidence > accepted evidence > success.
 * A blocked-looking report can never hide a cancellation or required failure,
 * and NO_FINDING is successful only when the forensic ledger and decision
 * gates have accepted it.
 */
export function classifyAiTerminalOutcome(input: TerminalClassifierInput): AiTerminalOutcome {
  const trace = input.trace;
  const done = latest(trace, "done");
  const toolResult = [...trace].reverse().find((step) =>
    step.kind === "tool_result"
    && ["failed", "unavailable", "cancelled"].includes(String(record(step).resultKind)),
  );
  const doneRecord = record(done);
  const toolRecord = record(toolResult);
  const cancelled = Boolean(input.cancelled || input.transportInterrupted)
    || doneRecord.stopReason === "cancelled"
    || toolRecord.resultKind === "cancelled"
    || hasDiagnostic(trace, /AbortError|cancel(?:lation|led).*user/i, true);

  if (cancelled) {
    return {
      outcome: "INTERRUPTED",
      failureKind: "CANCELLATION",
      retryable: true,
      code: "EXECUTION_CANCELLED",
      message: "Execution was cancelled before completion.",
      recoveryState: "INCOMPLETE",
      evidenceAccepted: false,
    };
  }

  if (doneRecord.stopReason === "tool_failure" || toolResult) {
    const toolWasCancelled = toolRecord.resultKind === "cancelled";
    return {
      outcome: toolWasCancelled ? "INTERRUPTED" : "FAILED",
      failureKind: toolWasCancelled ? "CANCELLATION" : "TOOL_FAILURE",
      retryable: true,
      code: toolWasCancelled ? "TOOL_CANCELLED" : safeToolCode(toolResult),
      message: toolWasCancelled
        ? "The required project analysis was cancelled before completion."
        : safeToolMessage(toolResult),
      recoveryState: "INCOMPLETE",
      evidenceAccepted: false,
    };
  }

  const decision = record(latest(trace, "decision_trace"));
  const auditState = record(latest(trace, "audit_state"));
  const forensicStatus = {
    ...auditState,
    ...record(latest(trace, "forensic_status")),
  };
  const evidenceIntegrity = record(latest(trace, "evidence_integrity"));
  const finalState = decision.finalState;
  const recoveryFailure = typeof decision.recoveryFailureKind === "string"
    && decision.recoveryFailureKind.length > 0;
  const recoveryDiagnostic = hasDiagnostic(
    trace,
    /(?:RECOVERY_FAILED|RECOVERY_REQUIRED|CORRECTION_FAILED|CONTRACT_.*FAILED)/i,
  );

  // Execution evidence and forensic audit evidence are different contracts.
  // Only the authoritative route intent may activate forensic terminal rules;
  // delivery turns can require execution proof without becoming audits.
  const forensic = input.forensic === true;
  if (forensic && (
    finalState === "FAILED"
    || recoveryFailure
    || recoveryDiagnostic
  )) {
    return {
      outcome: "FAILED",
      failureKind: "RECOVERY_FAILURE",
      retryable: true,
      code: "FORENSIC_RECOVERY_FAILED",
      message: "The forensic result could not be recovered into a complete, verified report.",
      recoveryState: "REQUIRED",
      evidenceAccepted: false,
    };
  }

  const text = responseText(input.result);
  const explicitIncomplete = forensic && (
    Boolean(input.endedBeforeEvidence)
      || hasDiagnostic(trace, /INCOMPLETE_BEFORE_EVIDENCE/i)
      || /\bANALYSIS_INCOMPLETE\b/i.test(text)
      || finalState === "NOT_PROVEN"
      || finalState === "RECOVERY_REQUIRED"
      || forensicStatus.behavioralAssessment === "INCOMPLETE"
      || forensicStatus.sourceCoverage === "PARTIAL"
      || forensicStatus.sourceCoverage === "NONE"
      || auditState.behaviorAssessment === "INCOMPLETE"
      || evidenceIntegrity.consistent === false
  );

  if (explicitIncomplete) {
    return {
      outcome: "FAILED",
      failureKind: "INCOMPLETE",
      retryable: true,
      code: input.endedBeforeEvidence ? "INCOMPLETE_BEFORE_EVIDENCE" : "FORENSIC_INCOMPLETE",
      message: input.endedBeforeEvidence
        ? "The result is incomplete because no source evidence was read."
        : "The forensic result is incomplete and is not proven.",
      recoveryState: "INCOMPLETE",
      evidenceAccepted: false,
    };
  }

  const acceptedNoFinding = input.requiresEvidence === true
    && forensicStatus.findingStatus === "NO_FINDING"
    && forensicStatus.sourceCoverage === "COMPLETE"
    && forensicStatus.behavioralAssessment === "COMPLETE"
    && finalState === "VERIFIED"
    && evidenceIntegrity.consistent === true;

  if (forensic && forensicStatus.findingStatus === "NO_FINDING" && !acceptedNoFinding) {
    return {
      outcome: "FAILED",
      failureKind: "INCOMPLETE",
      retryable: true,
      code: "FORENSIC_EVIDENCE_NOT_ACCEPTED",
      message: "The no-finding result did not pass the complete evidence gates.",
      recoveryState: "INCOMPLETE",
      evidenceAccepted: false,
    };
  }

  return {
    outcome: "SUCCEEDED",
    retryable: false,
    recoveryState: "NONE",
    evidenceAccepted: acceptedNoFinding || input.requiresEvidence !== true,
  };
}