import { pool } from "@workspace/db";
import { logger } from "./logger.js";

/**
 * Operational history policy:
 * - Keep task logs for 30 days after the task reaches a terminal state.
 * - Keep terminal AI execution receipts for 90 days.
 * - Never delete an execution that can still be resumed, or logs belonging
 *   to a task with active/resumable execution.
 *
 * Audit logs and events are intentionally not part of this sweep. Their
 * correlation IDs continue to provide the durable audit trail after compact
 * operational rows are removed.
 */
export const TASK_LOG_RETENTION_DAYS = 30;
export const AI_EXECUTION_RECEIPT_RETENTION_DAYS = 90;
export const TASK_HISTORY_RETENTION_BATCH_SIZE = 250;

export type TaskExecutionRetentionHealth = {
  status: "success" | "failed";
  attemptedAt: string | null;
  completedAt: string | null;
  taskLogRowsScanned: number;
  taskLogRowsRemoved: number;
  receiptRowsScanned: number;
  receiptRowsRemoved: number;
};

const health: TaskExecutionRetentionHealth = {
  status: "failed",
  attemptedAt: null,
  completedAt: null,
  taskLogRowsScanned: 0,
  taskLogRowsRemoved: 0,
  receiptRowsScanned: 0,
  receiptRowsRemoved: 0,
};

export function getTaskExecutionRetentionHealth(): TaskExecutionRetentionHealth {
  return { ...health };
}

/**
 * Remove old, terminal operational rows using bounded ID batches. The
 * selection and deletion are separate statements by design: a concurrent
 * execution can only make a candidate safer to retain, never cause active
 * work to be deleted.
 */
export async function pruneTaskExecutionHistory(now = new Date()): Promise<void> {
  const attemptedAt = now.toISOString();
  let taskLogRowsScanned = 0;
  let taskLogRowsRemoved = 0;
  let receiptRowsScanned = 0;
  let receiptRowsRemoved = 0;
  health.status = "failed";
  health.attemptedAt = attemptedAt;
  health.completedAt = null;
  health.taskLogRowsScanned = 0;
  health.taskLogRowsRemoved = 0;
  health.receiptRowsScanned = 0;
  health.receiptRowsRemoved = 0;

  try {
    const logCutoff = new Date(now.getTime() - TASK_LOG_RETENTION_DAYS * 24 * 60 * 60 * 1000);
    const receiptCutoff = new Date(now.getTime() - AI_EXECUTION_RECEIPT_RETENTION_DAYS * 24 * 60 * 60 * 1000);

    // Delete logs only for terminal tasks with no active or resumable run.
    const logs = await pool.query<{ id: string }>(
      `SELECT l.id
       FROM task_logs l
       JOIN tasks t ON t.id = l.task_id
       WHERE l.timestamp < $1
         AND t.status IN ('completed', 'failed', 'cancelled')
         AND NOT EXISTS (
           SELECT 1 FROM ai_executions e
           WHERE e.linked_task_id = t.id
             AND e.status IN ('queued', 'running', 'paused', 'cancelling')
         )
       ORDER BY l.timestamp ASC, l.id ASC
       LIMIT $2`,
      [logCutoff, TASK_HISTORY_RETENTION_BATCH_SIZE],
    );
    taskLogRowsScanned = logs.rowCount ?? logs.rows.length;
    if (logs.rows.length > 0) {
      const removed = await pool.query(
        `DELETE FROM task_logs l
         USING tasks t
         WHERE l.id = ANY($1::text[])
           AND t.id = l.task_id
           AND t.status IN ('completed', 'failed', 'cancelled')
           AND NOT EXISTS (
             SELECT 1 FROM ai_executions e
             WHERE e.linked_task_id = t.id
               AND e.status IN ('queued', 'running', 'paused', 'cancelling')
           )`,
        [logs.rows.map((row) => row.id)],
      );
      taskLogRowsRemoved = removed.rowCount ?? 0;
    }

    // Terminal receipts are safe to remove only when no newer active/resumable
    // execution is attached to the same task. This also protects retry flows.
    const receipts = await pool.query<{ id: string }>(
      `SELECT e.id
       FROM ai_executions e
       WHERE e.updated_at < $1
         AND e.status IN ('cancelled', 'completed', 'failed')
         AND NOT EXISTS (
           SELECT 1 FROM ai_executions newer
           WHERE newer.linked_task_id = e.linked_task_id
             AND e.linked_task_id IS NOT NULL
             AND newer.status IN ('queued', 'running', 'paused', 'cancelling')
         )
       ORDER BY e.updated_at ASC, e.id ASC
       LIMIT $2`,
      [receiptCutoff, TASK_HISTORY_RETENTION_BATCH_SIZE],
    );
    receiptRowsScanned = receipts.rowCount ?? receipts.rows.length;
    if (receipts.rows.length > 0) {
      const removed = await pool.query(
        `DELETE FROM ai_executions e
         WHERE e.id = ANY($1::text[])
           AND e.status IN ('cancelled', 'completed', 'failed')
           AND NOT EXISTS (
             SELECT 1 FROM ai_executions newer
             WHERE newer.linked_task_id = e.linked_task_id
               AND e.linked_task_id IS NOT NULL
               AND newer.status IN ('queued', 'running', 'paused', 'cancelling')
           )`,
        [receipts.rows.map((row) => row.id)],
      );
      receiptRowsRemoved = removed.rowCount ?? 0;
    }

    health.status = "success";
    health.completedAt = attemptedAt;
    health.taskLogRowsScanned = taskLogRowsScanned;
    health.taskLogRowsRemoved = taskLogRowsRemoved;
    health.receiptRowsScanned = receiptRowsScanned;
    health.receiptRowsRemoved = receiptRowsRemoved;
    if (taskLogRowsRemoved > 0 || receiptRowsRemoved > 0) {
      logger.info({
        scope: "task-execution-retention",
        taskLogRowsScanned,
        taskLogRowsRemoved,
        receiptRowsScanned,
        receiptRowsRemoved,
        batchSize: TASK_HISTORY_RETENTION_BATCH_SIZE,
      }, "Task execution history retention sweep removed old terminal rows");
    }
  } catch (err) {
    health.taskLogRowsScanned = taskLogRowsScanned;
    health.taskLogRowsRemoved = taskLogRowsRemoved;
    health.receiptRowsScanned = receiptRowsScanned;
    health.receiptRowsRemoved = receiptRowsRemoved;
    logger.error({ scope: "task-execution-retention", err },
      "Task execution history retention sweep failed — will retry on the next startup");
  }
}