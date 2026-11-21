import { sql } from "drizzle-orm";
import { db } from "@workspace/db";
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
  const wakeResult = await tx.execute(sql`
    WITH candidates AS MATERIALIZED (
      SELECT
        intent.id AS "intentId",
        dependent.id AS "taskId",
        dependent.retry_count AS "retryCount",
        dependent.correlation_id AS "correlationId"
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
        AND jsonb_typeof(intent.payload) = 'object'
        AND jsonb_typeof(intent.payload->'taskRetryCount') = 'number'
        AND jsonb_typeof(intent.payload->'userId') = 'string'
        AND intent.payload->>'lastFailureCode' = ${TASK_DEPENDENCY_WAKE_FAILURE_CODE}
        AND intent.payload->>'taskRetryCount' = dependent.retry_count::text
        AND intent.payload->>'taskCorrelationId' IS NOT DISTINCT FROM dependent.correlation_id
        AND NULLIF(BTRIM(intent.payload->>'userId'), '') IS NOT NULL
      ORDER BY dependent.id
      LIMIT ${MAX_TASK_DEPENDENCY_WAKE_BATCH_SIZE}
      FOR UPDATE OF intent
    ),
    wake_clock AS MATERIALIZED (
      SELECT to_char(
        clock_timestamp() AT TIME ZONE 'UTC',
        'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'
      ) AS "nextAttemptAt"
    ),
    updated AS (
      UPDATE events AS intent
      SET payload = jsonb_set(
        COALESCE(intent.payload, '{}'::jsonb),
        '{nextAttemptAt}',
        to_jsonb(wake_clock."nextAttemptAt"),
        true
      )
      FROM candidates
      CROSS JOIN wake_clock
      WHERE intent.id = candidates."intentId"
        AND intent.type = ${TASK_AUTO_EXECUTION_DEFERRED_EVENT_TYPE}
        AND intent.project_id = ${input.projectId}
        AND intent.task_id = candidates."taskId"
      RETURNING
        intent.task_id AS "taskId",
        intent.payload AS "payload",
        candidates."retryCount" AS "retryCount",
        candidates."correlationId" AS "correlationId"
    )
    SELECT "taskId", "payload", "retryCount", "correlationId"
    FROM updated
    ORDER BY "taskId"
  `);

  const rows = wakeResult.rows as Array<{
    taskId: string;
    payload: unknown;
    retryCount: number;
    correlationId: string | null;
  }>;

  return rows.flatMap((row) => {
    const payload = isRecord(row.payload) ? row.payload : null;
    if (
      !payload
      || payload.lastFailureCode !== TASK_DEPENDENCY_WAKE_FAILURE_CODE
      || payload.taskRetryCount !== row.retryCount
      || typeof payload.userId !== "string"
      || payload.userId.trim().length === 0
    ) {
      return [];
    }

    return [{
      taskId: row.taskId,
      userId: payload.userId,
      retryCount: row.retryCount,
      correlationId: row.correlationId,
    }];
  });
}
