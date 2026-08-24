import { describe, expect, it } from "vitest";
import { buildOperationEvidenceProjection, type EvidenceInput } from "./operation-evidence.js";

function input(overrides: Partial<EvidenceInput> = {}): EvidenceInput {
  return {
    execution: {
      id: "execution-1",
      projectId: "project-1",
      operationId: "operation-1",
      correlationId: "operation-1",
      status: "completed",
      attempt: 1,
      checkpoint: JSON.stringify({
        stage: "completed",
        evidenceVerdict: "PROVEN",
        proofRequired: true,
      }),
      checkpointVersion: 2,
      request: JSON.stringify({ workspaceRevision: "revision-1", objective: "Ship the change" }),
      baseRevision: "revision-1",
      error: null,
      createdAt: new Date("2026-08-24T10:00:00Z"),
      startedAt: new Date("2026-08-24T10:00:01Z"),
      completedAt: new Date("2026-08-24T10:00:05Z"),
    },
    events: [{
      id: "event-1",
      type: "ValidationCompleted",
      severity: "success",
      message: "validated",
      timestamp: new Date("2026-08-24T10:00:04Z"),
      payload: { status: "passed", providerMessage: "secret must not escape" },
    }],
    audits: [],
    taskLogs: [],
    journal: [],
    proposal: null,
    ...overrides,
  };
}

describe("operation evidence projection", () => {
  it("correlates bounded receipts and reports a complete history", () => {
    const projection = buildOperationEvidenceProjection(input());
    expect(projection).toMatchObject({
      operationId: "operation-1",
      projectId: "project-1",
      revision: "revision-1",
      completeness: "complete",
      verified: false,
      counts: { checkpoints: 1, events: 1, receipts: 3 },
    });
    expect(projection.receipts.map((receipt) => receipt.kind)).toEqual(["process", "validation", "process"]);
  });

  it("retains an explicit gap and never upgrades incomplete evidence to verified", () => {
    const projection = buildOperationEvidenceProjection(input({
      events: [],
      execution: {
        ...input().execution,
        checkpoint: "{}",
        checkpointVersion: 0,
      },
    }));
    expect(projection.completeness).toBe("retained-with-gaps");
    expect(projection.verified).toBe(false);
    expect(projection.gaps).toEqual(expect.arrayContaining([
      expect.objectContaining({ source: "checkpoint" }),
      expect.objectContaining({ source: "event" }),
    ]));
  });

  it("preserves cancellation and revision mismatch as non-success states", () => {
    const cancelled = buildOperationEvidenceProjection(input({
      execution: { ...input().execution, status: "cancelled" },
    }));
    expect(cancelled.completeness).toBe("cancelled");

    const mismatched = buildOperationEvidenceProjection(input({
      proposal: {
        revision: 2,
        baseRevision: "revision-2",
        changeSetHash: "change-hash",
        committedHash: null,
      },
    }));
    expect(mismatched.completeness).toBe("uncertain");
    expect(mismatched.hashes.changeSet).toBe("change-hash");
    expect(mismatched.gaps).toEqual(expect.arrayContaining([
      expect.objectContaining({ kind: "mismatch" }),
    ]));
  });

  it("bounds and redacts provider-derived diagnostics", () => {
    const projection = buildOperationEvidenceProjection(input({
      events: Array.from({ length: 150 }, (_, index) => ({
        id: `event-${index}`,
        type: "ProviderFailed",
        severity: "error",
        message: `provider secret sk-live-${index}`,
        timestamp: new Date("2026-08-24T10:00:04Z"),
        payload: { status: "failed" },
      })),
    }));
    expect(projection.counts.events).toBe(120);
    expect(JSON.stringify(projection)).not.toContain("sk-live-");
  });
});