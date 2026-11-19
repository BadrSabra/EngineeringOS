import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { selectMock } = vi.hoisted(() => ({
  selectMock: vi.fn(),
}));

vi.mock("@workspace/db", () => ({
  db: {
    select: selectMock,
    insert: vi.fn(),
    delete: vi.fn(),
  },
  auditLogsTable: {},
  pendingAuditLogsTable: { id: {} },
  auditEntityTypeEnum: {
    enumValues: ["project", "task", "rule", "workflow", "plugin", "discovery_session"],
  },
  auditActionEnum: {
    enumValues: [
      "created", "updated", "deleted", "executed", "retried", "rolled_back",
      "started", "stopped", "advanced", "completed", "phase_failed",
      "phase_retried", "enabled", "disabled", "evaluated", "imported",
      "scanned", "ai_executed", "ai_analyzed", "ai_reviewed", "ai_orchestrated",
      "ai_auto_executed", "execution_failed", "ai_auto_execution_failed",
    ],
  },
}));

describe("durable audit outbox recovery", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    selectMock.mockReset();
  });

  afterEach(() => {
    vi.clearAllTimers();
    vi.useRealTimers();
  });

  it("retries loading persisted audits after a transient startup database outage", async () => {
    vi.resetModules();
    const audit = await import("./audit.js");
    const counters = await import("./operational-counters.js");
    counters.resetOperationalCounters();

    const row = {
      id: "audit-reloaded-after-startup-outage",
      entityType: "project",
      entityId: "project-1",
      action: "updated",
      actor: "system",
      projectId: null,
      changedFields: null,
      stateBefore: null,
      stateAfter: null,
      reason: null,
      correlationId: null,
    };
    const persisted = {
      id: row.id,
      row,
      attempts: 1,
      nextAttemptAt: new Date(Date.now() + 60_000),
      createdAt: new Date(),
    };
    const fromMock = vi.fn()
      .mockRejectedValueOnce(new Error("temporary database outage"))
      .mockResolvedValueOnce([persisted]);
    selectMock.mockReturnValue({ from: fromMock });

    await audit.loadPendingAudits();

    expect(selectMock).toHaveBeenCalledTimes(1);
    expect(audit.getPendingAuditCount()).toBe(0);
    expect(counters.getOperationalCounters().auditPersistenceUnavailable).toBe(1);

    await vi.advanceTimersByTimeAsync(999);
    expect(selectMock).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(1);

    expect(selectMock).toHaveBeenCalledTimes(2);
    expect(audit.getPendingAuditCount()).toBe(1);
    expect(counters.getOperationalCounters()).toMatchObject({
      auditPersistenceUnavailable: 1,
      auditWritesPending: 1,
    });
  });
});
