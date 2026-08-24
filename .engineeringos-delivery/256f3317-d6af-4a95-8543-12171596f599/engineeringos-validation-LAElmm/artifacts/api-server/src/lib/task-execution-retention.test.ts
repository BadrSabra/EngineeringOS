import { describe, expect, it, vi } from "vitest";
import { eq } from "drizzle-orm";
import {
  aiExecutionsTable,
  db,
  pool,
  projectsTable,
  taskLogsTable,
  tasksTable,
} from "@workspace/db";
import { randomUUID } from "node:crypto";
import {
  AI_EXECUTION_RECEIPT_RETENTION_DAYS,
  TASK_HISTORY_RETENTION_BATCH_SIZE,
  TASK_LOG_RETENTION_DAYS,
  getTaskExecutionRetentionHealth,
  pruneTaskExecutionHistory,
} from "./task-execution-retention.js";

describe("task execution history retention", () => {
  it("uses bounded batches and reports removed terminal rows", async () => {
    const query = vi.spyOn(pool, "query")
      .mockResolvedValueOnce({ rows: [{ id: "log-1" }], rowCount: 1 } as never)
      .mockResolvedValueOnce({ rows: [], rowCount: 1 } as never)
      .mockResolvedValueOnce({ rows: [{ id: "execution-1" }], rowCount: 1 } as never)
      .mockResolvedValueOnce({ rows: [], rowCount: 1 } as never);
    const now = new Date("2026-08-23T00:00:00.000Z");

    await pruneTaskExecutionHistory(now);

    expect(query).toHaveBeenCalledTimes(4);
    expect(query.mock.calls[0]?.[1]).toEqual([
      new Date(now.getTime() - TASK_LOG_RETENTION_DAYS * 24 * 60 * 60 * 1000),
      TASK_HISTORY_RETENTION_BATCH_SIZE,
    ]);
    expect(query.mock.calls[2]?.[1]).toEqual([
      new Date(now.getTime() - AI_EXECUTION_RECEIPT_RETENTION_DAYS * 24 * 60 * 60 * 1000),
      TASK_HISTORY_RETENTION_BATCH_SIZE,
    ]);
    expect(getTaskExecutionRetentionHealth()).toEqual({
      status: "success",
      attemptedAt: now.toISOString(),
      completedAt: now.toISOString(),
      taskLogRowsScanned: 1,
      taskLogRowsRemoved: 1,
      receiptRowsScanned: 1,
      receiptRowsRemoved: 1,
    });
    query.mockRestore();
  });

  it("fails closed and keeps the next startup retryable when the database is unavailable", async () => {
    const query = vi.spyOn(pool, "query").mockRejectedValueOnce(new Error("database details"));
    const now = new Date("2026-08-23T01:00:00.000Z");

    await expect(pruneTaskExecutionHistory(now)).resolves.toBeUndefined();

    expect(getTaskExecutionRetentionHealth()).toMatchObject({
      status: "failed",
      attemptedAt: now.toISOString(),
      completedAt: null,
      taskLogRowsScanned: 0,
      taskLogRowsRemoved: 0,
      receiptRowsScanned: 0,
      receiptRowsRemoved: 0,
    });
    expect(JSON.stringify(getTaskExecutionRetentionHealth())).not.toContain("database details");
    query.mockRestore();
  });

  it("retains a log when its linked execution becomes active after selection", async () => {
    const projectId = randomUUID();
    const racingTaskId = randomUUID();
    const racingExecutionId = randomUUID();
    const eligibleTaskId = randomUUID();
    const racingLogId = randomUUID();
    const eligibleLogId = randomUUID();
    const oldTimestamp = new Date("2026-01-01T00:00:00.000Z");
    const now = new Date("2026-08-23T00:00:00.000Z");

    await db.insert(projectsTable).values({
      id: projectId,
      ownerId: "retention-concurrency-test-user",
      name: `retention-concurrency-${projectId.slice(0, 8)}`,
      rootPath: `/tmp/retention-concurrency-${projectId}`,
      language: "typescript",
      status: "active",
      createdAt: oldTimestamp,
      updatedAt: oldTimestamp,
    });
    await db.insert(tasksTable).values([
      {
        id: racingTaskId,
        projectId,
        title: "task whose execution is retried",
        status: "completed",
        createdAt: oldTimestamp,
        updatedAt: oldTimestamp,
      },
      {
        id: eligibleTaskId,
        projectId,
        title: "old terminal task",
        status: "completed",
        createdAt: oldTimestamp,
        updatedAt: oldTimestamp,
      },
    ]);
    await db.insert(aiExecutionsTable).values({
      id: racingExecutionId,
      projectId,
      linkedTaskId: racingTaskId,
      userId: "retention-concurrency-test-user",
      idempotencyKey: racingExecutionId,
      resumeTokenHash: "retention-concurrency-test-hash",
      request: "{}",
      checkpoint: "{}",
      status: "completed",
      createdAt: oldTimestamp,
      updatedAt: oldTimestamp,
      completedAt: oldTimestamp,
    });
    await db.insert(taskLogsTable).values([
      {
        id: racingLogId,
        taskId: racingTaskId,
        level: "info",
        message: "must remain available for the retry",
        timestamp: oldTimestamp,
      },
      {
        id: eligibleLogId,
        taskId: eligibleTaskId,
        level: "info",
        message: "eligible old history",
        timestamp: oldTimestamp,
      },
    ]);

    const originalQuery = pool.query.bind(pool) as (
      text: string,
      values?: unknown[],
    ) => Promise<{ rows: Array<{ id: string }>; rowCount: number }>;
    let promotedAfterSelection = false;
    const query = vi.spyOn(pool, "query").mockImplementation(async (text: any, values?: any) => {
      const result = await originalQuery(text, values);
      if (!promotedAfterSelection && text.includes("SELECT l.id")) {
        promotedAfterSelection = true;
        await db
          .update(aiExecutionsTable)
          .set({ status: "running", updatedAt: now })
          .where(eq(aiExecutionsTable.id, racingExecutionId));
      }
      return result as any;
    });

    try {
      await pruneTaskExecutionHistory(now);

      const remainingLogs = await db
        .select({ id: taskLogsTable.id })
        .from(taskLogsTable)
        .where(eq(taskLogsTable.taskId, racingTaskId));
      const eligibleLogs = await db
        .select({ id: taskLogsTable.id })
        .from(taskLogsTable)
        .where(eq(taskLogsTable.taskId, eligibleTaskId));
      const remainingExecution = await db
        .select({ id: aiExecutionsTable.id, status: aiExecutionsTable.status })
        .from(aiExecutionsTable)
        .where(eq(aiExecutionsTable.id, racingExecutionId));

      expect(promotedAfterSelection).toBe(true);
      expect(remainingLogs).toEqual([{ id: racingLogId }]);
      expect(eligibleLogs).toEqual([]);
      expect(remainingExecution).toEqual([{ id: racingExecutionId, status: "running" }]);
      expect(getTaskExecutionRetentionHealth()).toMatchObject({
        status: "success",
        taskLogRowsScanned: 2,
        taskLogRowsRemoved: 1,
        receiptRowsScanned: 0,
        receiptRowsRemoved: 0,
      });
    } finally {
      query.mockRestore();
      await db.delete(projectsTable).where(eq(projectsTable.id, projectId));
    }
  });

  it("retains a receipt when its execution becomes resumable after selection", async () => {
    const projectId = randomUUID();
    const racingTaskId = randomUUID();
    const racingExecutionId = randomUUID();
    const eligibleTaskId = randomUUID();
    const eligibleExecutionId = randomUUID();
    const oldTimestamp = new Date("2026-01-01T00:00:00.000Z");
    const now = new Date("2026-08-23T00:00:00.000Z");

    await db.insert(projectsTable).values({
      id: projectId,
      ownerId: "retention-receipt-concurrency-test-user",
      name: `retention-receipt-concurrency-${projectId.slice(0, 8)}`,
      rootPath: `/tmp/retention-receipt-concurrency-${projectId}`,
      language: "typescript",
      status: "active",
      createdAt: oldTimestamp,
      updatedAt: oldTimestamp,
    });
    await db.insert(tasksTable).values([
      {
        id: racingTaskId,
        projectId,
        title: "task whose receipt is needed for retry",
        status: "completed",
        createdAt: oldTimestamp,
        updatedAt: oldTimestamp,
      },
      {
        id: eligibleTaskId,
        projectId,
        title: "old terminal task",
        status: "completed",
        createdAt: oldTimestamp,
        updatedAt: oldTimestamp,
      },
    ]);
    await db.insert(aiExecutionsTable).values([
      {
        id: racingExecutionId,
        projectId,
        linkedTaskId: racingTaskId,
        userId: "retention-receipt-concurrency-test-user",
        idempotencyKey: racingExecutionId,
        resumeTokenHash: "retention-receipt-concurrency-test-racing-hash",
        request: "{}",
        checkpoint: "{}",
        status: "completed",
        createdAt: oldTimestamp,
        updatedAt: oldTimestamp,
        completedAt: oldTimestamp,
      },
      {
        id: eligibleExecutionId,
        projectId,
        linkedTaskId: eligibleTaskId,
        userId: "retention-receipt-concurrency-test-user",
        idempotencyKey: eligibleExecutionId,
        resumeTokenHash: "retention-receipt-concurrency-test-eligible-hash",
        request: "{}",
        checkpoint: "{}",
        status: "completed",
        createdAt: oldTimestamp,
        updatedAt: oldTimestamp,
        completedAt: oldTimestamp,
      },
    ]);

    const originalQuery = pool.query.bind(pool) as (
      text: string,
      values?: unknown[],
    ) => Promise<{ rows: Array<{ id: string }>; rowCount: number }>;
    let promotedAfterSelection = false;
    const query = vi.spyOn(pool, "query").mockImplementation(async (text: any, values?: any) => {
      const result = await originalQuery(text, values);
      if (!promotedAfterSelection && text.includes("SELECT e.id")) {
        promotedAfterSelection = true;
        await db
          .update(aiExecutionsTable)
          .set({ status: "running", updatedAt: now })
          .where(eq(aiExecutionsTable.id, racingExecutionId));
      }
      return result as any;
    });

    try {
      await pruneTaskExecutionHistory(now);

      const remainingExecutions = await db
        .select({ id: aiExecutionsTable.id, status: aiExecutionsTable.status })
        .from(aiExecutionsTable)
        .where(eq(aiExecutionsTable.projectId, projectId));

      expect(promotedAfterSelection).toBe(true);
      expect(remainingExecutions).toEqual([
        { id: racingExecutionId, status: "running" },
      ]);
      expect(getTaskExecutionRetentionHealth()).toMatchObject({
        status: "success",
        taskLogRowsScanned: 0,
        taskLogRowsRemoved: 0,
        receiptRowsScanned: 2,
        receiptRowsRemoved: 1,
      });
    } finally {
      query.mockRestore();
      await db.delete(projectsTable).where(eq(projectsTable.id, projectId));
    }
  });
});
