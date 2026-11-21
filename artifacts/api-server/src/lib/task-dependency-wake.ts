import { sql } from "drizzle-orm";
import { db, eventsTable } from "@workspace/db";
import { TASK_AUTO_EXECUTION_DEFERRED_EVENT_TYPE } from "./task-auto-execution-outbox.js";

export const TASK_DEPENDENCY_WAKE_FAILURE_CODE = "task_dependencies_not_completed";
export const MAX_TASK_DEPENDENCY_WAKE_BATCH_SIZE = 100;

type TaskDependencyWakeTransaction = Parameters<Parameters<typeof db.transaction>[0]>[0];

export type TaskDependencyWakeTarget = {
  taskId: string;
  userId: string;
  retryCount: number;
  correlationId: string | null;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

/**
 * Pull forward only a current-generation child Task intent that was deferred
 * because a prerequisite was incomplete. The accepted parent and the child's
 * durable scheduling request are observed in the same transaction.
 *
 * This is a scheduling hint only. executeTaskLifecycle still locks the child
 * and revalidates its complete transitive dependency graph before an Execution
 * can be created.
 */
export async function wakeDeferredTaskDependencyIntents(
  tx: TaskDependencyWakeTransaction,
  input: {
    completedTaskId: string;
    projectId: string;
  },
): Promise<TaskDependencyWakeTarget[]> {
  const candidatesResult = await tx.execute(sql`
    SELECT
      intent.id AS "intentId",
      dependent.id AS "taskId",
      dependent.retry_count AS "retryCount",
      dependent.correlation_id AS "correlationId",
      intent.payload AS "payload"
    FROM events AS intent
    INNER JOIN tasks AS dependent
      ON dependent.id = intent.task_id
    INNER JOIN tasks AS completed
      ON completed.id = ${input.completedTaskId}
    WHERE completed.project_id = ${input.projectId}
      AND completed.status = 'completed'
      AND dependent.project_id = ${input.projectId}
      AND dependent.status = 'verifying'
      AND dependent.prompt IS NOT NULL
      AND btrim(dependent.prompt) <> ''
      AND dependent.depends_on @> jsonb_build_array(completed.id)
      -- Only release a child once every direct prerequisite is complete.
      AND NOT EXISTS (
        SELECT 1
        FROM jsonb_array_elements_text(
          COALESCE(dependent.depends_on, '[]'::jsonb)
        ) AS prerequisite_ref(task_id)
        LEFT JOIN tasks AS prerequisite
          ON prerequisite.id = prerequisite_ref.task_id
        WHERE prerequisite.id IS NULL
          OR prerequisite.project_id <> dependent.project_id
          OR prerequisite.status <> 'completed'
      )
      AND intent.id = 'task-auto-execution-deferred:' || dependent.id
      AND intent.task_id = dependent.id
      AND intent.project_id = dependent.project_id
      AND intent.type = ${TASK_AUTO_EXECUTION_DEFERRED_EVENT_TYPE}
      AND intent.payload->>'lastFailureCode' = ${TASK_DEPENDENCY_WAKE_FAILURE_CODE}
      AND intent.payload->>'taskRetryCount' = dependent.retry_count::text
      AND intent.payload->>'taskCorrelationId' IS NOT DISTINCT FROM dependent.correlation_id
      AND NULLIF(BTRIM(intent.payload->>'userId'), '') IS NOT NULL
    ORDER BY dependent.id
    LIMIT ${MAX_TASK_DEPENDENCY_WAKE_BATCH_SIZE}
    FOR UPDATE OF intent
  `);

  const candidates = candidatesResult.rows as Array<{
    intentId: string;
    taskId: string;
    retryCount: number;
    correlationId: string | null;
    payload: unknown;
  }>;
  if (candidates.length === 0) return [];

  // Use the database clock so the durable retry timestamp is consistent with
  // the Outbox dispatcher, even when API hosts have clock skew.
  const clockResult = await tx.execute(sql`SELECT clock_timestamp() AS now`);
  const rawNow = (clockResult.rows as Array<{ now: Date | string }>)[0]?.now;
  const now = rawNow instanceof Date ? rawNow : new Date(String(rawNow ?? ""));
  if (!rawNow || !Number.isFinite(now.getTime())) return [];

  const nextAttemptAt = now.toISOString();
  const targets: TaskDependencyWakeTarget[] = [];
  for (const candidate of candidates) {
    const payload = isRecord(candidate.payload) ? candidate.payload : null;
    if (
      !payload
      || payload.lastFailureCode !== TASK_DEPENDENCY_WAKE_FAILURE_CODE
      || payload.taskRetryCount !== candidate.retryCount
      || typeof payload.userId !== "string"
      || payload.userId.trim().length === 0
    ) continue;

    const [updated] = await tx.update(eventsTable)
      .set({
        payload: { ...payload, nextAttemptAt },
      })
      .where(sql`${eventsTable.id} = ${candidate.intentId}
        AND ${eventsTable.type} = ${TASK_AUTO_EXECUTION_DEFERRED_EVENT_TYPE}
        AND ${eventsTable.projectId} = ${input.projectId}
        AND ${eventsTable.taskId} = ${candidate.taskId}`)
      .returning({ taskId: eventsTable.taskId });

    if (updated?.taskId) {
      targets.push({
        taskId: updated.taskId,
        userId: payload.userId,
        retryCount: candidate.retryCount,
        correlationId: candidate.correlationId,
      });
    }
  }

  return targets;
}
