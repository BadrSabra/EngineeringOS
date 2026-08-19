import { beforeEach, describe, expect, it, vi } from "vitest";

const { insertMock } = vi.hoisted(() => ({
  insertMock: vi.fn(),
}));

vi.mock("@workspace/db", () => ({
  db: { insert: insertMock },
  auditLogsTable: {},
  auditEntityTypeEnum: { enumValues: ["project", "task", "rule", "workflow", "plugin", "discovery_session"] },
  auditActionEnum: [
    "created", "updated", "deleted", "executed", "retried", "rolled_back",
    "started", "stopped", "advanced", "completed", "phase_failed",
    "phase_retried", "enabled", "disabled", "evaluated", "imported",
    "scanned", "ai_executed", "ai_analyzed", "ai_reviewed", "ai_orchestrated",
    "ai_auto_executed", "execution_failed", "ai_auto_execution_failed",
  ],
}));

import { drainPendingAudits, getPendingAuditCount, recordAudit } from "./audit.js";
import { getOperationalCounters, resetOperationalCounters } from "./operational-counters.js";

describe("audit write recovery", () => {
  beforeEach(() => {
    insertMock.mockReset();
    resetOperationalCounters();
  });

  it("keeps the business operation successful and retries a failed audit row", async () => {
    insertMock
      .mockImplementationOnce(() => ({ values: vi.fn().mockRejectedValue(new Error("database unavailable")) }))
      .mockImplementationOnce(() => ({ values: vi.fn().mockResolvedValue(undefined) }));

    await expect(recordAudit({
      entityType: "project",
      entityId: "project-1",
      action: "updated",
    })).resolves.toBeUndefined();

    expect(getPendingAuditCount()).toBe(1);
    expect(getOperationalCounters()).toMatchObject({
      auditWriteFailures: 1,
      auditWritesPending: 1,
      auditWritesRecovered: 0,
    });

    await drainPendingAudits();

    expect(getPendingAuditCount()).toBe(0);
    expect(getOperationalCounters()).toMatchObject({
      auditWriteFailures: 1,
      auditWritesPending: 0,
      auditWritesRecovered: 1,
    });
    expect(insertMock).toHaveBeenCalledTimes(2);
  });

  it("keeps a row pending when recovery also fails", async () => {
    insertMock.mockImplementation(() => ({
      values: vi.fn().mockRejectedValue(new Error("database still unavailable")),
    }));

    await recordAudit({
      entityType: "task",
      entityId: "task-1",
      action: "executed",
    });
    await drainPendingAudits();

    expect(getPendingAuditCount()).toBe(1);
    expect(getOperationalCounters().auditWritesPending).toBe(1);
    expect(getOperationalCounters().auditWriteFailures).toBe(2);
  });
});