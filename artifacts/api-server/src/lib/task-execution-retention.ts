import { pool } from "@workspace/db";
import { logger } from "./logger.js";

/**
 * Operational history policy:
 * - Keep task logs for 30 days after the task reaches a terminal state.
 * - Keep terminal AI execution receipts for at least 90 days; retain receipts
 *   that anchor proof or operational history for longer.
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

const RETAIN_EXECUTIONS_WITH_DEPENDENCIES_SQL = `
         AND NOT EXISTS (SELECT 1 FROM ai_execution_acceptances d WHERE d.execution_id = e.id)
         AND NOT EXISTS (SELECT 1 FROM ai_execution_evidence_snapshots d WHERE d.execution_id = e.id)
         AND NOT EXISTS (SELECT 1 FROM ai_agent_episodes d WHERE d.execution_id = e.id)
         AND NOT EXISTS (SELECT 1 FROM ai_agent_episode_events d WHERE d.execution_id = e.id)
         AND NOT EXISTS (SELECT 1 FROM ai_agent_observations d WHERE d.execution_id = e.id)
         AND NOT EXISTS (SELECT 1 FROM ai_agent_effects d WHERE d.execution_id = e.id)
         AND NOT EXISTS (SELECT 1 FROM ai_agent_effect_bundles d WHERE d.execution_id = e.id)
         AND NOT EXISTS (SELECT 1 FROM ai_world_transitions d WHERE d.execution_id = e.id)
         AND NOT EXISTS (SELECT 1 FROM ai_mission_decision_dispatch_items d WHERE d.execution_id = e.id)
         AND NOT EXISTS (SELECT 1 FROM ai_mission_decision_shadow_comparisons d WHERE d.source_execution_id = e.id)
         AND NOT EXISTS (SELECT 1 FROM ai_mission_decision_traces d WHERE d.source_execution_id = e.id)
         AND NOT EXISTS (SELECT 1 FROM ai_mission_lineages d WHERE d.source_execution_id = e.id)
         AND NOT EXISTS (SELECT 1 FROM ai_shadow_replays d WHERE d.execution_id = e.id)
         AND NOT EXISTS (SELECT 1 FROM ai_executions child WHERE child.parent_execution_id = e.id)`;

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

    // Keep execution rows that anchor durable proof, world-state, mission,
    // episode, or dispatch records; deleting them would cascade that history.
    const receipts = await pool.query<{ id: string }>(
      `SELECT e.id
       FROM ai_executions e
       WHERE e.updated_at < $1
         ${RETAIN_EXECUTIONS_WITH_DEPENDENCIES_SQL}
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
           AND e.updated_at < $2
           ${RETAIN_EXECUTIONS_WITH_DEPENDENCIES_SQL}
           AND e.status IN ('cancelled', 'completed', 'failed')
           AND NOT EXISTS (
             SELECT 1 FROM ai_executions newer
             WHERE newer.linked_task_id = e.linked_task_id
               AND e.linked_task_id IS NOT NULL
               AND newer.status IN ('queued', 'running', 'paused', 'cancelling')
           )`,
        [receipts.rows.map((row) => row.id), receiptCutoff],
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