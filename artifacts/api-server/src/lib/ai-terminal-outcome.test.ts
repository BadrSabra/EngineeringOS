import { describe, expect, it } from "vitest";
import {
  classifyAiTerminalOutcome,
  publicAcceptanceDisposition,
  type AiTerminalOutcome,
} from "./ai-terminal-outcome.js";
import type { AgentStep } from "@workspace/ai-orchestrator";

const steps = (...value: Record<string, unknown>[]) => value as unknown as AgentStep[];

describe("classifyAiTerminalOutcome", () => {
  const classify = (
    trace: Record<string, unknown>[],
    extra: Record<string, unknown> = {},
  ): AiTerminalOutcome => classifyAiTerminalOutcome({
    trace: steps(...trace),
    forensic: true,
    requiresEvidence: true,
    ...extra,
  });

  it("gives cancellation precedence over a blocked recovery report", () => {
    expect(classify([
      { kind: "diagnostic", code: "FORENSIC_CONTRACT_RECOVERY_FAILED", details: ["AbortError"] },
      { kind: "decision_trace", trace: { finalState: "FAILED", recoveryFailureKind: "MODEL_TIMEOUT" } },
    ], { cancelled: true })).toMatchObject({
      outcome: "INTERRUPTED",
      failureKind: "CANCELLATION",
      retryable: true,
      recoveryState: "INCOMPLETE",
    });
  });

  it("projects a typed provider category without turning an incomplete forensic run into success", () => {
    expect(classify([
      { kind: "decision_trace", trace: { finalState: "FAILED", recoveryFailureKind: "PROVIDER_FAILURE" } },
    ], {
      providerError: { code: "RATE_LIMITED", providerStatus: 429 },
    })).toMatchObject({
      outcome: "FAILED",
      failureKind: "RECOVERY_FAILURE",
      providerFailureCategory: "RATE_LIMITED",
      retryable: true,
      recoveryState: "REQUIRED",
      evidenceAccepted: false,
    });
  });

  it("keeps a provider failure before recovery as incomplete instead of required recovery", () => {
    expect(classify([
      { kind: "iteration_start", iter: 0, maxIterations: 120 },
    ], {
      providerError: { code: "SERVER_ERROR", providerStatus: 502 },
    })).toMatchObject({
      outcome: "FAILED",
      failureKind: "INCOMPLETE",
      providerFailureCategory: "TRANSPORT_FAILURE",
      retryable: true,
      recoveryState: "INCOMPLETE",
      code: "AI_PROVIDER_FAILURE",
      evidenceAccepted: false,
    });
  });

  it("keeps retained source reads as an explicit incomplete result after provider failure", () => {
    expect(classify([
      { kind: "tool_result", tool: "read_file", source: "src/index.ts", readStatus: "READ_COMPLETE" },
    ], {
      providerError: { code: "TIMEOUT", fallbackExhausted: true },
      evidenceAttempted: true,
      completeEvidenceAvailable: true,
      requiredEvidencePending: true,
      nextRequiredPath: "src/next.ts",
    })).toMatchObject({
      outcome: "FAILED",
      failureKind: "INCOMPLETE",
      code: "INCOMPLETE_AFTER_PROVIDER_FAILURE",
      recoveryState: "INCOMPLETE",
      providerFailureCategory: "TIMEOUT",
      nextRequiredPath: "src/next.ts",
      evidenceAccepted: false,
    });
  });

  it("distinguishes a truncated-only evidence attempt from failure before evidence", () => {
    expect(classify([
      { kind: "forensic_status", sourceCoverage: "PARTIAL", behavioralAssessment: "INCOMPLETE" },
      { kind: "decision_trace", trace: { finalState: "NOT_PROVEN" } },
    ], {
      evidenceAttempted: true,
      incompleteEvidenceAvailable: true,
      requiredEvidencePending: true,
      nextRequiredPath: "src/large.ts",
    })).toMatchObject({
      outcome: "FAILED",
      failureKind: "INCOMPLETE",
      code: "INCOMPLETE_AFTER_EVIDENCE_ATTEMPT",
      recoveryState: "INCOMPLETE",
      evidenceAccepted: false,
    });
  });

  it("classifies complete evidence with unclosed objective claims as objective incomplete", () => {
    expect(classify([
      { kind: "forensic_status", sourceCoverage: "PARTIAL", behavioralAssessment: "INCOMPLETE" },
      { kind: "decision_trace", trace: { finalState: "NOT_PROVEN" } },
    ], {
      evidenceAttempted: true,
      completeEvidenceAvailable: true,
      requiredEvidencePending: true,
      nextRequiredPath: "src/behavior.ts",
    })).toMatchObject({
      outcome: "FAILED",
      failureKind: "INCOMPLETE",
      code: "OBJECTIVE_INCOMPLETE",
      recoveryState: "INCOMPLETE",
      evidenceAccepted: false,
    });
  });

  it("classifies a provider failure after an incomplete evidence attempt separately", () => {
    expect(classify([
      { kind: "tool_result", tool: "read_file", source: "src/large.ts", readStatus: "READ_TRUNCATED" },
    ], {
      providerError: { code: "TIMEOUT" },
      evidenceAttempted: true,
      incompleteEvidenceAvailable: true,
      requiredEvidencePending: true,
      nextRequiredPath: "src/behavior.ts",
    })).toMatchObject({
      outcome: "FAILED",
      failureKind: "INCOMPLETE",
      code: "INCOMPLETE_AFTER_PROVIDER_FAILURE",
      recoveryState: "INCOMPLETE",
      providerFailureCategory: "TIMEOUT",
      evidenceAccepted: false,
    });
  });

  it("classifies an empty provider response before the first read as an incomplete contract", () => {
    expect(classify([
      { kind: "iteration_start", iter: 0, maxIterations: 120 },
    ], {
      providerError: { code: "EMPTY_RESPONSE", fallbackExhausted: true },
      providerEmptyBeforeEvidence: true,
    })).toMatchObject({
      outcome: "FAILED",
      failureKind: "INCOMPLETE",
      contractFailureCategory: "PROVIDER_EMPTY",
      code: "INCOMPLETE_BEFORE_EVIDENCE",
      recoveryState: "INCOMPLETE",
      evidenceAccepted: false,
    });
  });

  it("keeps lease loss terminal even when the controller was also aborted", () => {
    expect(classify([], {
      cancelled: true,
      leaseLost: true,
    })).toMatchObject({
      outcome: "FAILED",
      failureKind: "INCOMPLETE",
      code: "EXECUTION_LEASE_EXPIRED",
      recoveryState: "REQUIRED",
    });
  });

  it("keeps capability-probe claim closure ahead of provider classification", () => {
    const outcome = classify([
      { kind: "diagnostic", code: "CAPABILITY_PROBE_CLAIM_UNCLOSED" },
    ], {
      providerError: { code: "TIMEOUT" },
    });
    expect(outcome).toMatchObject({
      outcome: "FAILED",
      failureKind: "INCOMPLETE",
      retryable: false,
      recoveryState: "INCOMPLETE",
    });
    expect(outcome).not.toHaveProperty("providerFailureCategory");
  });

  it("classifies a required tool failure as failed instead of successful", () => {
    expect(classify([
      { kind: "tool_result", resultKind: "failed", diagnosticCode: "TOOL_EXECUTION_FAILED", resultSummary: "Tool failed safely." },
      { kind: "done", stopReason: "tool_failure" },
    ])).toMatchObject({
      outcome: "FAILED",
      failureKind: "TOOL_FAILURE",
      code: "TOOL_EXECUTION_FAILED",
    });
  });

  it("keeps typed analysis timeout diagnostics in the safe terminal code", () => {
    expect(classify([
      {
        kind: "tool_result",
        resultKind: "failed",
        diagnosticCode: "TOOL_EXECUTION_FAILED",
        analysisFailureCategory: "timeout",
      },
      { kind: "done", stopReason: "tool_failure" },
    ])).toMatchObject({
      outcome: "FAILED",
      code: "TOOL_ANALYSIS_TIMEOUT",
    });
  });

  it("distinguishes terminal forensic recovery failure from ordinary incompleteness", () => {
    expect(classify([
      { kind: "decision_trace", trace: { finalState: "FAILED", recoveryFailureKind: "RECOVERY_CONTRACT_FAILED" } },
    ])).toMatchObject({
      outcome: "FAILED",
      failureKind: "RECOVERY_FAILURE",
      recoveryState: "REQUIRED",
    });
    expect(classify([
      { kind: "decision_trace", trace: { finalState: "NOT_PROVEN" } },
    ])).toMatchObject({
      outcome: "FAILED",
      failureKind: "INCOMPLETE",
      recoveryState: "INCOMPLETE",
    });
  });

  it("does not advertise resume for a capability probe with unclosed claims", () => {
    expect(classify([
      {
        kind: "diagnostic",
        code: "CAPABILITY_PROBE_CLAIM_UNCLOSED",
        details: ["retained source bodies did not close C1–C7"],
      },
      {
        kind: "decision_trace",
        trace: { finalState: "FAILED", recoveryFailureKind: "PROVIDER_FAILURE" },
      },
    ])).toMatchObject({
      outcome: "FAILED",
      failureKind: "INCOMPLETE",
      retryable: false,
      recoveryState: "INCOMPLETE",
      code: "FORENSIC_INCOMPLETE",
    });
  });

  it("accepts only evidence-gated NO_FINDING as a normal forensic success", () => {
    expect(classify([
      { kind: "forensic_status", sourceCoverage: "COMPLETE", behavioralAssessment: "COMPLETE", findingStatus: "NO_FINDING" },
      { kind: "decision_trace", trace: { finalState: "VERIFIED" } },
      { kind: "evidence_integrity", consistent: true },
    ])).toMatchObject({
      outcome: "SUCCEEDED",
      evidenceAccepted: true,
      recoveryState: "NONE",
    });
    expect(classify([
      { kind: "forensic_status", sourceCoverage: "PARTIAL", behavioralAssessment: "COMPLETE", findingStatus: "NO_FINDING" },
      { kind: "decision_trace", trace: { finalState: "VERIFIED" } },
    ])).toMatchObject({
      outcome: "FAILED",
      failureKind: "INCOMPLETE",
    });
  });

  it("accepts a deterministic no-finding fallback without claiming a proven Finding", () => {
    expect(classify([
      { kind: "diagnostic", code: "FORENSIC_STRUCTURED_RECOVERY_REJECTED" },
      { kind: "diagnostic", code: "FORENSIC_DETERMINISTIC_NO_FINDING" },
      { kind: "forensic_status", sourceCoverage: "COMPLETE", behavioralAssessment: "COMPLETE", findingStatus: "NO_FINDING" },
      { kind: "evidence_integrity", consistent: true, acceptedClaimCount: 0, acceptedEvidenceCount: 0 },
      { kind: "decision_trace", trace: { finalState: "VERIFIED" } },
    ])).toMatchObject({
      outcome: "SUCCEEDED",
      evidenceAccepted: true,
      recoveryState: "NONE",
    });
  });

  it("rejects forensic recovery failure when no deterministic fallback was accepted", () => {
    expect(classify([
      { kind: "diagnostic", code: "FORENSIC_STRUCTURED_RECOVERY_REJECTED" },
      { kind: "forensic_status", sourceCoverage: "COMPLETE", behavioralAssessment: "COMPLETE", findingStatus: "NO_FINDING" },
      { kind: "evidence_integrity", consistent: true, acceptedClaimCount: 0, acceptedEvidenceCount: 0 },
      { kind: "decision_trace", trace: { finalState: "VERIFIED" } },
    ])).toMatchObject({
      outcome: "FAILED",
      failureKind: "RECOVERY_FAILURE",
      code: "FORENSIC_RECOVERY_FAILED",
      evidenceAccepted: false,
    });
  });

  it("does not apply forensic prose gates to ordinary delivery turns", () => {
    expect(classify([
      { kind: "decision_trace", trace: { finalState: "NOT_PROVEN" } },
    ], { forensic: false, requiresEvidence: false, result: { response: "A normal delivery response." } })).toMatchObject({
      outcome: "SUCCEEDED",
    });
  });
});

describe("publicAcceptanceDisposition", () => {
  it("uses one safe generic projection for legacy failed proof records", () => {
    expect(publicAcceptanceDisposition({
      status: "failed",
      proofRequired: true,
      evidenceVerdict: "UNAVAILABLE",
    })).toEqual({
      reasonCodes: ["EXECUTION_ACCEPTANCE_INCOMPLETE"],
      outcome: "FAILED",
      failureKind: "INCOMPLETE",
      recoveryState: "INCOMPLETE",
      operatorAction: "START_NEW_RUN",
    });
  });

  it("drops untrusted acceptance fields instead of exposing them", () => {
    expect(publicAcceptanceDisposition({
      value: {
        reasonCodes: ["validator_internal_reason", "EXECUTION_ACCEPTANCE_INCOMPLETE"],
        outcome: "FAILED",
        failureKind: "INCOMPLETE",
        recoveryState: "INCOMPLETE",
        operatorAction: "run /workspace/private-command",
      },
    })).toBeUndefined();
  });
});