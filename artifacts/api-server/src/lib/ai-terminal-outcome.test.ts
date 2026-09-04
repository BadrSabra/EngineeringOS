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