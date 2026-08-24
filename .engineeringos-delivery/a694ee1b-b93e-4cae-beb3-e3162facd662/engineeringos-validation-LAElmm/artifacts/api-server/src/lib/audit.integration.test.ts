/**
 * Integration-style coverage for the durable audit outbox.
 *
 * The database adapter below keeps both tables in one durable store while
 * allowing the audit_logs destination to be unavailable independently. This
 * exercises the same insert/select/delete contract as PostgreSQL and reloads
 * the audit module to model a process restart.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const database = vi.hoisted(() => ({
  auditRows: new Map<string, Record<string, unknown>>(),
  pendingRows: new Map<string, {
    id: string;
    row: Record<string, unknown>;
    attempts: number;
    nextAttemptAt: Date;
  }>(),
  auditAvailable: false,
}));

const tables = vi.hoisted(() => ({
  audit: { name: "audit_logs" },
  pending: { name: "pending_audit_logs", id: { column: "id" } },
}));

vi.mock("@workspace/db", () => ({
  db: {
    insert: (table: { name: string }) => ({
      values: (value: Record<string, unknown>) => ({
        onConflictDoNothing: async () => {
          if (table === tables.audit) {
            if (!database.auditAvailable) {
              throw new Error("temporary audit_logs outage");
            }
            const id = String(value.id);
            if (!database.auditRows.has(id)) database.auditRows.set(id, value);
            return;
          }

          const id = String(value.id);
          database.pendingRows.set(id, {
            id,
            row: value.row as Record<string, unknown>,
            attempts: Number(value.attempts),
            nextAttemptAt: value.nextAttemptAt as Date,
          });
        },
        onConflictDoUpdate: async () => {
          const id = String(value.id);
          database.pendingRows.set(id, {
            id,
            row: value.row as Record<string, unknown>,
            attempts: Number(value.attempts),
            nextAttemptAt: value.nextAttemptAt as Date,
          });
        },
      }),
    }),
    select: () => ({
      from: async () => [...database.pendingRows.values()].map((entry) => ({
        ...entry,
        createdAt: new Date(),
      })),
    }),
    delete: () => ({
      where: async () => {
        // The real query supplies the id predicate. This fixture has one
        // pending row in the scenario and removes it after recovery.
        for (const [id, pending] of database.pendingRows) {
          if (database.auditRows.has(id) || pending.id === id) {
            database.pendingRows.delete(id);
          }
        }
      },
    }),
  },
  auditLogsTable: tables.audit,
  pendingAuditLogsTable: tables.pending,
  auditEntityTypeEnum: { enumValues: ["project", "task"] },
  auditActionEnum: { enumValues: ["updated", "executed"] },
}));

describe("durable audit recovery across a service restart", () => {
  beforeEach(() => {
    database.auditRows.clear();
    database.pendingRows.clear();
    database.auditAvailable = false;
    vi.resetModules();
  });

  it("keeps the operation successful, survives an outage, and writes once after restart", async () => {
    const firstProcess = await import("./audit.js");
    const { getOperationalCounters: firstCounters } = await import("./operational-counters.js");

    // The business mutation is represented by this successful call. Audit
    // storage is unavailable only for the initial destination insert.
    await expect(firstProcess.recordAudit({
      entityType: "project",
      entityId: "project-integration-1",
      action: "updated",
      reason: "integration outage",
    })).resolves.toBeUndefined();

    expect(database.auditRows.size).toBe(0);
    expect(database.pendingRows.size).toBe(1);
    expect(firstProcess.getPendingAuditCount()).toBe(1);
    expect(firstCounters().auditWriteFailures).toBe(1);
    expect(firstCounters().auditWritesPending).toBe(1);

    // A new process has no in-memory queue, but it can reload the durable row.
    vi.resetModules();
    database.auditAvailable = true;
    const restartedProcess = await import("./audit.js");
    const { getOperationalCounters: restartedCounters } = await import("./operational-counters.js");

    await restartedProcess.loadPendingAudits();
    expect(restartedProcess.getPendingAuditCount()).toBe(1);
    expect(restartedCounters().auditWritesPending).toBe(1);

    await restartedProcess.drainPendingAudits();

    expect(database.auditRows.size).toBe(1);
    expect(database.pendingRows.size).toBe(0);
    expect(restartedProcess.getPendingAuditCount()).toBe(0);
    expect(restartedCounters()).toMatchObject({
      auditWriteFailures: 0,
      auditWritesPending: 0,
      auditWritesRecovered: 1,
    });
  });
});