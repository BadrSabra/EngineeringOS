import { describe, expect, it } from "vitest";
import {
  deriveAcceptanceNextAction,
  normalizeEvidenceSnapshot,
  projectExecutionAcceptance,
} from "./ai-execution-acceptance.js";

describe("server-owned execution acceptance", () => {
  it("fails closed when a required read is missing or truncated", () => {
    const missing = normalizeEvidenceSnapshot({ required: true });
    expect(missing.complete).toBe(false);
    expect(missing.reason).toMatch(/missing|incomplete|truncated/i);

    const truncated = normalizeEvidenceSnapshot({
      required: true,
      reads: [{ path: "src/index.ts", body: "partial", complete: false, truncated: true }],
    });
    expect(truncated.complete).toBe(false);
    expect(truncated.reads[0]?.truncated).toBe(true);
  });

  it("does not treat a required NOT_RECORDED verdict as complete", () => {
    const snapshot = normalizeEvidenceSnapshot({
      required: true,
      verdict: "NOT_RECORDED",
      reads: [{ path: "src/index.ts", body: "export const ok = true;" }],
    });

    expect(snapshot.complete).toBe(false);
    expect(snapshot.verdict).toBe("NOT_RECORDED");
  });

  it("rejects a body over the per-read limit instead of silently accepting a slice", () => {
    const snapshot = normalizeEvidenceSnapshot({
      required: true,
      reads: [{ path: "large.txt", body: "x".repeat(256 * 1024 + 1) }],
    });
    expect(snapshot.complete).toBe(false);
    expect(snapshot.reads[0]?.byteLength).toBe(256 * 1024 + 1);
    expect(snapshot.reads[0]?.body).toBe("");
  });

  it("derives bounded operator actions without exposing provider details", () => {
    expect(deriveAcceptanceNextAction({
      outcome: "FAILED",
      recoveryState: "REQUIRED",
      resumable: true,
      reasonCode: "EXECUTION_FAILED",
    })).toBe("RESUME_ALLOWED");
    expect(deriveAcceptanceNextAction({
      outcome: "FAILED",
      recoveryState: "INCOMPLETE",
      resumable: false,
      reasonCode: "CAPABILITY_PROBE_FINAL",
    })).toBe("START_NEW_PROBE");
    expect(deriveAcceptanceNextAction({
      outcome: "FAILED",
      recoveryState: "INCOMPLETE",
      resumable: false,
      reasonCode: "EVIDENCE_INCOMPLETE",
    })).toBe("REVIEW_INCOMPLETE_EVIDENCE");
    expect(deriveAcceptanceNextAction({
      outcome: "FAILED",
      recoveryState: "REQUIRED",
      resumable: false,
      reasonCode: "EXECUTION_PROVIDER_FAILURE",
      retryAfterMs: 15_000,
    })).toBe("RETRY_AFTER_RATE_LIMIT");
  });

  it("projects only the allowlisted current-attempt acceptance fields", () => {
    const projected = projectExecutionAcceptance({
      id: "acceptance",
      executionId: "execution",
      projectId: "project",
      attempt: 2,
      finalizationKey: "key",
      operationId: "operation",
      workerId: "worker",
      terminalStatus: "failed",
      outcome: "FAILED",
      reasonCode: "EVIDENCE_INCOMPLETE",
      nextActionCode: "REVIEW_INCOMPLETE_EVIDENCE",
      disposition: { providerPayload: "must not cross boundary" },
      evidenceSnapshotId: "snapshot",
      evidenceRequired: 1,
      evidenceComplete: 0,
      resumable: 0,
      messageId: "message",
      sourceRevision: "revision",
      candidateIdentity: "candidate",
      createdAt: new Date(),
    });
    expect(projected).toEqual({
      attempt: 2,
      terminalStatus: "failed",
      outcome: "FAILED",
      reasonCode: "EVIDENCE_INCOMPLETE",
      nextActionCode: "REVIEW_INCOMPLETE_EVIDENCE",
      evidenceComplete: false,
      evidenceRequired: true,
      resumable: false,
    });
  });

  it("projects a provider cooldown without leaking provider payloads", () => {
    const projected = projectExecutionAcceptance({
      id: "acceptance",
      executionId: "execution",
      projectId: "project",
      attempt: 3,
      finalizationKey: "key",
      operationId: "operation",
      workerId: "worker",
      terminalStatus: "failed",
      outcome: "FAILED",
      reasonCode: "EXECUTION_PROVIDER_FAILURE",
      nextActionCode: "RETRY_AFTER_RATE_LIMIT",
      disposition: {
        reasonCodes: ["EXECUTION_PROVIDER_FAILURE"],
        outcome: "FAILED",
        recoveryState: "REQUIRED",
        nextActionCode: "RETRY_AFTER_RATE_LIMIT",
        operatorAction: "RETRY_AFTER_RATE_LIMIT",
        providerPayload: "must not cross boundary",
        retryAfterMs: 15_000,
        retryAt: "2026-09-08T18:00:15.000Z",
      },
      evidenceSnapshotId: null,
      evidenceRequired: 0,
      evidenceComplete: 0,
      resumable: 0,
      messageId: "message",
      sourceRevision: "revision",
      candidateIdentity: "candidate",
      createdAt: new Date(),
    });

    expect(projected?.nextActionCode).toBe("RETRY_AFTER_RATE_LIMIT");
    expect(projected?.disposition).toEqual({
      reasonCodes: ["EXECUTION_PROVIDER_FAILURE"],
      outcome: "FAILED",
      recoveryState: "REQUIRED",
      nextActionCode: "RETRY_AFTER_RATE_LIMIT",
      operatorAction: "RETRY_AFTER_RATE_LIMIT",
      retryAfterMs: 15_000,
      retryAt: "2026-09-08T18:00:15.000Z",
    });
  });
});