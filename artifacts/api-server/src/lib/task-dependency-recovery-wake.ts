import { sql } from "drizzle-orm";
import { db } from "@workspace/db";

type TaskDependencyRecoveryWakeTransaction =
  Parameters<Parameters<typeof db.transaction>[0]>[0];

/**
 * Make dependency-blocked autonomous Task recoveries eligible immediately
 * after their last direct prerequisite completes.
 *
 * This changes only the durable recovery cooldown. The recovery coordinator
 * still validates the current Task/Execution/Acceptance binding, and its
 * dependency preflight remains the authority before provider admission.
 */
export async function wakeDeferredTaskRecoveryAcceptances(
  tx: TaskDependencyRecoveryWakeTransaction,
  input: {
    completedTaskId: string;
    projectId: string;
  },
): Promise<number> {
  const result = await tx.execute(sql`
    UPDATE ai_execution_acceptances AS acceptance
    SET disposition = jsonb_set(
      COALESCE(acceptance.disposition, '{}'::jsonb),
      '{dependencyRetryAt}',
      -- planTaskRecovery compares this marker with the application clock.
      -- A past sentinel avoids re-deferring a wake on a clock-skewed replica.
      to_jsonb('1970-01-01T00:00:00.000Z'::text),
      true
    )
    FROM ai_executions AS execution
    INNER JOIN tasks AS dependent
      ON dependent.id = execution.linked_task_id
    INNER JOIN tasks AS completed
      ON completed.id = ${input.completedTaskId}
    WHERE acceptance.execution_id = execution.id
      AND acceptance.attempt = execution.attempt
      AND acceptance.project_id = ${input.projectId}
      AND execution.project_id = ${input.projectId}
      AND execution.status IN ('paused', 'failed')
      AND dependent.project_id = ${input.projectId}
      AND dependent.id <> completed.id
      AND dependent.status IN ('pending', 'queued', 'verifying')
      AND dependent.prompt IS NOT NULL
      AND btrim(dependent.prompt) <> ''
      AND dependent.correlation_id IS NOT NULL
      AND execution.correlation_id = dependent.correlation_id
      AND completed.project_id = ${input.projectId}
      AND completed.status = 'completed'
      AND dependent.depends_on @> jsonb_build_array(completed.id)
      AND acceptance.outcome = 'FAILED'
      AND acceptance.next_action_code IN ('RETRY_AFTER_TIMEOUT', 'RETRY_AFTER_RATE_LIMIT')
      AND acceptance.resumable = 0
      AND acceptance.disposition->>'recoveryState' = 'REQUIRED'
      AND acceptance.disposition->>'dependencyRetryAt' IS NOT NULL
      AND pg_input_is_valid(
        acceptance.disposition->>'dependencyRetryAt',
        'timestamp with time zone'
      )
      AND (acceptance.disposition->>'dependencyRetryAt')::timestamptz > clock_timestamp()
      -- Wake only after every direct prerequisite is complete in this project.
      -- The recovery coordinator still revalidates the full transitive graph.
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
    RETURNING acceptance.id
  `);

  return result.rows.length;
}
