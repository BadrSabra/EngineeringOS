import { describe, expect, it, vi } from "vitest";
import { pool } from "@workspace/db";
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
});