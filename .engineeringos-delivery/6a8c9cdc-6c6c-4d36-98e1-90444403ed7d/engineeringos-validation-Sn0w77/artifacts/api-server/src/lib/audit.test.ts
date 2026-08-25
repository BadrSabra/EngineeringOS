import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { insertMock, selectMock, deleteMock, auditTable, pendingTable } = vi.hoisted(() => ({
  insertMock: vi.fn(),
  selectMock: vi.fn(),
  deleteMock: vi.fn(),
  auditTable: {},
  pendingTable: { id: {} },
}));

vi.mock("@workspace/db", () => ({
  db: {
    insert: insertMock,
    select: selectMock,
    delete: deleteMock,
  },
  auditLogsTable: auditTable,
  pendingAuditLogsTable: pendingTable,
  auditEntityTypeEnum: { enumValues: ["project", "task", "rule", "workflow", "plugin", "discovery_session"] },
  auditActionEnum: [
    "created", "updated", "deleted", "executed", "retried", "rolled_back",
    "started", "stopped", "advanced", "completed", "phase_failed",
    "phase_retried", "enabled", "disabled", "evaluated", "imported",
    "scanned", "ai_executed", "ai_analyzed", "ai_reviewed", "ai_orchestrated",
    "ai_auto_executed", "execution_failed", "ai_auto_execution_failed",
  ],
}));

import { drainPendingAudits, getPendingAuditCount, loadPendingAudits, recordAudit, recordAuditInTransaction } from "./audit.js";
import { getOperationalCounters, resetOperationalCounters } from "./operational-counters.js";

describe("audit write recovery", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    insertMock.mockReset();
    selectMock.mockReset().mockReturnValue({ from: vi.fn().mockResolvedValue([]) });
    deleteMock.mockReset().mockReturnValue({ where: vi.fn().mockResolvedValue(undefined) });
    resetOperationalCounters();
  });

  afterEach(() => {
    vi.clearAllTimers();
    vi.useRealTimers();
  });

  it("keeps the business operation successful and retries a failed audit row", async () => {
    insertMock
      .mockImplementationOnce((table) => table === auditTable
        ? { values: vi.fn().mockRejectedValue(new Error("database unavailable")) }
        : { values: vi.fn().mockReturnValue({ onConflictDoUpdate: vi.fn().mockResolvedValue(undefined) }) })
      .mockImplementationOnce((table) => table === pendingTable
        ? { values: vi.fn().mockReturnValue({ onConflictDoUpdate: vi.fn().mockResolvedValue(undefined) }) }
        : { values: vi.fn().mockReturnValue({ onConflictDoNothing: vi.fn().mockResolvedValue(undefined) }) })
      .mockImplementationOnce(() => ({
        values: vi.fn().mockReturnValue({ onConflictDoNothing: vi.fn().mockResolvedValue(undefined) }),
      }));

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
    expect(insertMock).toHaveBeenCalledTimes(3);
  });

  it("keeps a row pending when recovery also fails", async () => {
    insertMock.mockImplementation((table) => table === auditTable
      ? { values: vi.fn().mockRejectedValue(new Error("database still unavailable")) }
      : { values: vi.fn().mockReturnValue({ onConflictDoUpdate: vi.fn().mockResolvedValue(undefined) }) });

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

  it("reports when neither the audit destination nor durable outbox is available", async () => {
    await loadPendingAudits();
    insertMock.mockImplementation(() => ({
      values: vi.fn().mockRejectedValue(new Error("database unavailable")),
    }));

    await recordAudit({
      entityType: "project",
      entityId: "project-no-durable-audit",
      action: "updated",
    });

    expect(getPendingAuditCount()).toBe(1);
    expect(getOperationalCounters()).toMatchObject({
      auditPersistenceUnavailable: 1,
      mutationsWithoutAudit: 1,
    });
  });

  it("lets an authoritative transaction roll back when its audit insert fails", async () => {
    const transaction = {
      insert: vi.fn().mockReturnValue({
        values: vi.fn().mockReturnValue({
          onConflictDoNothing: vi.fn().mockRejectedValue(new Error("audit insert failed")),
        }),
      }),
    };

    await expect(recordAuditInTransaction(transaction, {
      entityType: "task",
      entityId: "task-transaction",
      action: "updated",
    })).rejects.toThrow("audit insert failed");
    expect(transaction.insert).toHaveBeenCalledWith(auditTable);
  });

  it("reloads a failed audit row from the durable outbox after restart", async () => {
    const row = {
      id: "audit-after-restart",
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
    selectMock.mockReturnValue({
      from: vi.fn().mockResolvedValue([{
        id: row.id,
        row,
        attempts: 2,
        nextAttemptAt: new Date(),
        createdAt: new Date(),
      }]),
    });
    insertMock.mockImplementation((table) => table === auditTable
      ? { values: vi.fn().mockReturnValue({ onConflictDoNothing: vi.fn().mockResolvedValue(undefined) }) }
      : { values: vi.fn().mockReturnValue({ onConflictDoUpdate: vi.fn().mockResolvedValue(undefined) }) });

    await loadPendingAudits();
    expect(getPendingAuditCount()).toBe(1);

    await drainPendingAudits();

    expect(getPendingAuditCount()).toBe(0);
    expect(getOperationalCounters().auditWritesRecovered).toBe(1);
    expect(deleteMock).toHaveBeenCalled();
  });
});