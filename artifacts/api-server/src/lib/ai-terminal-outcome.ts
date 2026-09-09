import type { AgentStep, ProviderId } from "@workspace/ai-orchestrator";
import {
  classifyProviderFailure,
  decideProviderFailurePolicy,
  type ProviderFailureCategory,
} from "./provider-failure-diagnostics.js";

export type AiTerminalFailureKind =
  | "QUALITY_REVIEW"
  | "TOOL_FAILURE"
  | "CANCELLATION"
  | "RECOVERY_FAILURE"
  | "INCOMPLETE";

export type AiTerminalOutcome = {
  outcome: "SUCCEEDED" | "FAILED" | "INTERRUPTED";
  failureKind?: AiTerminalFailureKind;
  providerFailureCategory?: ProviderFailureCategory;
  contractFailureCategory?: AiExecutionContractFailureCategory;
  retryable: boolean;
  code?: string;
  message?: string;
  recoveryState: "NONE" | "REQUIRED" | "INCOMPLETE";
  /** True only when the existing forensic evidence gates accepted the result. */
  evidenceAccepted: boolean;
};

/**
 * One public identity for a terminal operation across persistence, SSE, and
 * reconnect/history projections. Nullable fields are intentional for legacy
 * terminal rows created before the acceptance/message link was available.
 */
export type AiTerminalProjection = {
  executionId: string;
  sessionId: string;
  attempt: number;
  messageId: string | null;
  acceptanceId: string | null;
  operationId: string | null;
  correlationId: string;
  status: "completed" | "failed" | "cancelled" | "paused";
  outcome: "SUCCEEDED" | "FAILED" | "INTERRUPTED";
  reasonCode: string | null;
  nextActionCode: string | null;
  resumable: boolean;
};

/**
 * Small, server-owned summary of provider fallback activity. This is the
 * only attempt telemetry shape that may cross an operator-facing execution
 * boundary. It intentionally contains counts and bounded categories only:
 * model output, prompts, paths, credentials, and provider messages never
 * belong here.
 */
export const AI_EXECUTION_DIAGNOSTIC_PROVIDERS = [
  "groq",
  "deepseek",
  "openrouter",
  "gemini",
] as const satisfies readonly ProviderId[];
export type AiExecutionDiagnosticProvider = (typeof AI_EXECUTION_DIAGNOSTIC_PROVIDERS)[number];

export const AI_EXECUTION_PROVIDER_FAILURE_CATEGORIES = [
  "TIMEOUT",
  "MODEL_REJECTED",
  "MODEL_UNAVAILABLE",
  "RATE_LIMITED",
  "FALLBACK_EXHAUSTED",
  "TRANSPORT_FAILURE",
  "MALFORMED_RESPONSE",
  "UNKNOWN",
] as const;
export type AiExecutionProviderFailureCategory =
  (typeof AI_EXECUTION_PROVIDER_FAILURE_CATEGORIES)[number];

export const AI_EXECUTION_CONTRACT_FAILURE_CATEGORIES = [
  "MALFORMED_RESPONSE",
  "MISSING_CLAIMS",
  "CITATION_MISMATCH",
  "SEMANTIC_FAILURE",
  "PROVIDER_EMPTY",
  "UNKNOWN",
] as const;
export type AiExecutionContractFailureCategory =
  (typeof AI_EXECUTION_CONTRACT_FAILURE_CATEGORIES)[number];

export type AiExecutionDiagnostics = {
  schemaVersion: 1;
  attempts: number;
  failedAttempts: number;
  cancelledAttempts: number;
  fallbackAttempts: number;
  providers: Array<{
    provider: AiExecutionDiagnosticProvider;
    attempts: number;
    failedAttempts: number;
    fallbackAttempts: number;
  }>;
  failureCategories: {
    provider: Partial<Record<AiExecutionProviderFailureCategory, number>>;
    contract: Partial<Record<AiExecutionContractFailureCategory, number>>;
  };
};

/**
 * Stable, public acceptance projection.  This deliberately contains no
 * validator prose, evidence identities, provider details, or workspace paths.
 * Keep this contract small because it is copied to the stream, message, and
 * durable execution projections.
 */
export const AI_ACCEPTANCE_REASON_CODES = [
  "EXECUTION_ACCEPTANCE_INCOMPLETE",
] as const;
export type AiAcceptanceReasonCode = (typeof AI_ACCEPTANCE_REASON_CODES)[number];
export const AI_ACCEPTANCE_OPERATOR_ACTIONS = [
  "START_NEW_RUN",
] as const;
export type AiAcceptanceOperatorAction = (typeof AI_ACCEPTANCE_OPERATOR_ACTIONS)[number];
export type AiAcceptanceDisposition = {
  reasonCodes: AiAcceptanceReasonCode[];
  outcome: "FAILED" | "INTERRUPTED";
  failureKind: "INCOMPLETE";
  recoveryState: "INCOMPLETE";
  operatorAction: AiAcceptanceOperatorAction;
  nextActionCode?: "NONE" | "RESUME_ALLOWED" | "START_NEW_PROBE" | "REVIEW_INCOMPLETE_EVIDENCE" | "ABANDON_EXECUTION" | "RETRY_AFTER_TIMEOUT";
};

const GENERIC_ACCEPTANCE_DISPOSITION: AiAcceptanceDisposition = {
  reasonCodes: ["EXECUTION_ACCEPTANCE_INCOMPLETE"],
  outcome: "FAILED",
  failureKind: "INCOMPLETE",
  recoveryState: "INCOMPLETE",
  operatorAction: "START_NEW_RUN",
};

/**
 * Accept only the server-owned acceptance shape, or derive the same safe
 * generic fallback for an older proof-required failed execution.
 */
export function publicAcceptanceDisposition(input: {
  value?: unknown;
  code?: unknown;
  outcome?: unknown;
  failureKind?: unknown;
  recoveryState?: unknown;
  status?: unknown;
  proofRequired?: boolean;
  evidenceVerdict?: unknown;
}): AiAcceptanceDisposition | undefined {
  const value = input.value;
  if (value && typeof value === "object" && !Array.isArray(value)) {
    const candidate = value as Record<string, unknown>;
    const reasonCodes = candidate.reasonCodes;
    if (
      Array.isArray(reasonCodes)
      && reasonCodes.length > 0
      && reasonCodes.every((code): code is AiAcceptanceReasonCode =>
        AI_ACCEPTANCE_REASON_CODES.includes(code as AiAcceptanceReasonCode),
      )
      && (candidate.outcome === "FAILED" || candidate.outcome === "INTERRUPTED")
      && candidate.failureKind === "INCOMPLETE"
      && candidate.recoveryState === "INCOMPLETE"
      && AI_ACCEPTANCE_OPERATOR_ACTIONS.includes(candidate.operatorAction as AiAcceptanceOperatorAction)
    ) {
      return {
        reasonCodes: [...new Set(reasonCodes)] as AiAcceptanceReasonCode[],
        outcome: candidate.outcome,
        failureKind: "INCOMPLETE",
        recoveryState: "INCOMPLETE",
        operatorAction: candidate.operatorAction as AiAcceptanceOperatorAction,
      };
    }
  }

  const explicitAcceptance = input.code === "EXECUTION_ACCEPTANCE_INCOMPLETE";
  const legacyProofFailure = input.proofRequired === true
    && (input.status === "failed" || input.outcome === "FAILED")
    && input.evidenceVerdict !== "PROVEN";
  if (!explicitAcceptance && !legacyProofFailure) return undefined;
  return { ...GENERIC_ACCEPTANCE_DISPOSITION };
}

type TerminalClassifierInput = {
  result?: unknown;
  trace: readonly AgentStep[];
  cancelled?: boolean;
  leaseLost?: boolean;
  transportInterrupted?: boolean;
  providerError?: {
    code?: unknown;
    providerCode?: unknown;
    providerStatus?: unknown;
    fallbackExhausted?: boolean;
    retryable?: boolean;
  };
  /** A provider returned no usable completion before any required evidence. */
  providerEmptyBeforeEvidence?: boolean;
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
  const category = record(step).analysisFailureCategory;
  if (category === "timeout") return "TOOL_ANALYSIS_TIMEOUT";
  if (category === "stale_revision") return "TOOL_ANALYSIS_STALE_REVISION";
  if (category === "root_unavailable") return "TOOL_ANALYSIS_ROOT_UNAVAILABLE";
  if (category === "unavailable_dependency") return "TOOL_UNAVAILABLE";
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
 * Recovery diagnostics are not all terminal failures: a server-owned
 * deterministic Finding/no-Finding fallback may intentionally replace a
 * rejected provider report.  Only treat the provider/contract recovery as
 * blocking when that authoritative fallback marker is absent.
 */
export function hasForensicRecoveryBlocker(trace: readonly AgentStep[]): boolean {
  const deterministicFallbackAccepted = hasDiagnostic(
    trace,
    /FORENSIC_DETERMINISTIC_(?:NO_FINDING|FINDING)/i,
  );
  if (deterministicFallbackAccepted) return false;
  return hasDiagnostic(
    trace,
    /FORENSIC_(?:CONTRACT_RECOVERY_(?:EXHAUSTED|FAILED|REJECTED|PARSE_FAILED)|STRUCTURED_RECOVERY_REJECTED|EVIDENCE_ONLY_FALLBACK)/i,
  );
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
  const cancelled = !input.leaseLost && (Boolean(input.cancelled || input.transportInterrupted)
    || doneRecord.stopReason === "cancelled"
    || toolRecord.resultKind === "cancelled"
    || hasDiagnostic(trace, /AbortError|cancel(?:lation|led).*user/i, true));

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

  if (input.leaseLost) {
    return {
      outcome: "FAILED",
      failureKind: "INCOMPLETE",
      retryable: true,
      code: "EXECUTION_LEASE_EXPIRED",
      message: "Execution ownership expired before completion.",
      recoveryState: "REQUIRED",
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
  ) || hasForensicRecoveryBlocker(trace);
  const recoveryAttempted = trace.some((step) =>
    step.kind === "forensic_recovery_start"
      || step.kind === "recovery_model_call",
  ) || recoveryFailure || recoveryDiagnostic;
  const capabilityProbeClaimUnclosed = hasDiagnostic(
    trace,
    /CAPABILITY_PROBE_(?:CLAIM_UNCLOSED|EVIDENCE_RECOVERY_REJECTED)/i,
  );

  // Execution evidence and forensic audit evidence are different contracts.
  // Only the authoritative route intent may activate forensic terminal rules;
  // delivery turns can require execution proof without becoming audits.
  const forensic = input.forensic === true;
  // A capability probe with retained source bodies but unclosed claims is a
  // terminal proof failure, not a resumable execution. The resume endpoint
  // deliberately rejects this checkpoint because replaying the same evidence
  // cannot establish the missing claim closure.
  if (forensic && capabilityProbeClaimUnclosed) {
    return {
      outcome: "FAILED",
      failureKind: "INCOMPLETE",
      retryable: false,
      code: "FORENSIC_INCOMPLETE",
      message: "The capability probe retained source evidence, but its required claims remain unclosed.",
      recoveryState: "INCOMPLETE",
      evidenceAccepted: false,
    };
  }
  const providerFailureCategory = input.providerError
    ? classifyProviderFailure({
        ...input.providerError,
        cancelled,
      })
    : undefined;
  if (forensic && input.providerEmptyBeforeEvidence) {
    return {
      outcome: "FAILED",
      failureKind: "INCOMPLETE",
      contractFailureCategory: "PROVIDER_EMPTY",
      retryable: true,
      code: "INCOMPLETE_BEFORE_EVIDENCE",
      message: "The result is incomplete because no source evidence was read.",
      recoveryState: "INCOMPLETE",
      evidenceAccepted: false,
    };
  }
  if (providerFailureCategory) {
    const providerPolicy = decideProviderFailurePolicy({
      category: providerFailureCategory,
      fallbackAttempted: input.providerError?.fallbackExhausted === true,
      synthesisAvailable: false,
      deterministicRecoveryAvailable: recoveryAttempted,
      attempt: input.providerError?.fallbackExhausted === true ? 2 : 1,
    });
    return {
      outcome: "FAILED",
      failureKind: recoveryAttempted ? "RECOVERY_FAILURE" : "INCOMPLETE",
      providerFailureCategory,
      retryable: input.providerError?.retryable ?? providerPolicy.retryable,
      code: recoveryAttempted ? "FORENSIC_RECOVERY_FAILED" : "AI_PROVIDER_FAILURE",
      message: "The AI provider could not complete the request.",
      recoveryState: recoveryAttempted ? "REQUIRED" : "INCOMPLETE",
      evidenceAccepted: false,
    };
  }
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
  const acceptedFinding = input.requiresEvidence === true
    && forensicStatus.findingStatus === "PROVEN"
    && forensicStatus.sourceCoverage === "COMPLETE"
    && forensicStatus.behavioralAssessment === "COMPLETE"
    && finalState === "VERIFIED"
    && evidenceIntegrity.consistent === true
    && Number(evidenceIntegrity.acceptedClaimCount ?? 0) > 0
    && Number(evidenceIntegrity.acceptedEvidenceCount ?? 0) > 0;
  const taskResult = input.result && typeof input.result === "object"
    ? (input.result as { taskResult?: unknown }).taskResult
    : undefined;
  const acceptedCapabilityProbe = input.requiresEvidence === true
    && taskResult
    && typeof taskResult === "object"
    && (taskResult as { kind?: unknown }).kind === "CAPABILITY_PROBE_RESULT"
    && (taskResult as { score?: unknown }).score === 7
    && (taskResult as { coverage?: { complete?: unknown } }).coverage?.complete === true;
  const missingForensicContract = forensic
    && input.requiresEvidence === true
    && !forensicStatus.sourceCoverage
    && !forensicStatus.findingStatus
    && !evidenceIntegrity.evidenceSourceCoverage
    && !finalState;

  if (forensic && input.requiresEvidence === true && !acceptedNoFinding && !acceptedFinding && !acceptedCapabilityProbe) {
    if (missingForensicContract) {
      // Let the durable completion gate publish the stable acceptance error.
      // This avoids turning a provider response with no server-owned contract
      // into a provider/recovery failure while still preventing completion.
      return {
        outcome: "SUCCEEDED",
        retryable: false,
        code: "FORENSIC_ACCEPTANCE_REQUIRED",
        message: "The forensic response has no server-owned acceptance contract.",
        recoveryState: "INCOMPLETE",
        evidenceAccepted: false,
      };
    }
    return {
      outcome: "FAILED",
      failureKind: "INCOMPLETE",
      retryable: !hasForensicRecoveryBlocker(trace),
      code: hasForensicRecoveryBlocker(trace)
        ? "FORENSIC_RECOVERY_FAILED"
        : "FORENSIC_EVIDENCE_NOT_ACCEPTED",
      message: hasForensicRecoveryBlocker(trace)
        ? "The forensic result could not be recovered into a complete, verified report."
        : "The forensic result did not pass the complete evidence gates.",
      recoveryState: "INCOMPLETE",
      evidenceAccepted: false,
    };
  }

  return {
    outcome: "SUCCEEDED",
    retryable: false,
    recoveryState: "NONE",
    evidenceAccepted: acceptedNoFinding || acceptedFinding || Boolean(acceptedCapabilityProbe) || input.requiresEvidence !== true,
  };
}