import { db, eventsTable, tasksTable } from "@workspace/db";
import { eq } from "drizzle-orm";

export const TASK_AUTO_EXECUTION_REQUESTED_EVENT_TYPE =
  "TaskAutoExecutionDispatchRequested";
export const TASK_AUTO_EXECUTION_DEFERRED_EVENT_TYPE =
  "TaskAutoExecutionDeferred";

export type TaskAutoExecutionOutboxTransaction =
  Parameters<Parameters<typeof db.transaction>[0]>[0];

export type TaskAutoExecutionOutboxOptions = {
  parentExecutionId?: string | null;
  delegationBudget?: Record<string, unknown>;
};

export function taskAutoExecutionIntentId(taskId: string): string {
  // Keep the historical event key stable. The retry count and correlation ID
  // bind the payload to one Task generation and are checked before dispatch/claim.
  return `task-auto-execution-deferred:${taskId}`;
}

function stableJson(value: unknown): string {
  if (value === null || typeof value !== "object") {
    return JSON.stringify(value) ?? "undefined";
  }
  if (Array.isArray(value)) {
    return `[${value.map(stableJson).join(",")}]`;
  }
  const record = value as Record<string, unknown>;
  return `{${Object.keys(record)
    .filter((key) => record[key] !== undefined)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${stableJson(record[key])}`)
    .join(",")}}`;
}

/**
 * Persist the automatic dispatch request under the same Task row lock and
 * transaction that moves the Task into verifying. The queue remains only a
 * local wake-up mechanism; this event is the durable request.
 */
export async function insertTaskAutoExecutionIntent(
  tx: TaskAutoExecutionOutboxTransaction,
  input: {
    taskId: string;
    userId: string;
    retryCount: number;
    options?: TaskAutoExecutionOutboxOptions;
  },
): Promise<boolean> {
  const [task] = await tx
    .select({
      projectId: tasksTable.projectId,
      status: tasksTable.status,
      prompt: tasksTable.prompt,
      retryCount: tasksTable.retryCount,
      correlationId: tasksTable.correlationId,
    })
    .from(tasksTable)
    .where(eq(tasksTable.id, input.taskId))
    .for("update")
    .limit(1);

  if (
    !task
    || task.status !== "verifying"
    || !task.prompt
    || task.retryCount !== input.retryCount
  ) {
    return false;
  }

  const id = taskAutoExecutionIntentId(input.taskId);
  const [existing] = await tx
    .select({
      type: eventsTable.type,
      payload: eventsTable.payload,
      projectId: eventsTable.projectId,
      taskId: eventsTable.taskId,
    })
    .from(eventsTable)
    .where(eq(eventsTable.id, id))
    .for("update")
    .limit(1);
  const existingPayload = existing?.payload ?? {};
  const existingRetryCount = existingPayload.taskRetryCount;
  const existingTaskCorrelationId = existingPayload.taskCorrelationId;
  const correlationMatches = existingTaskCorrelationId === task.correlationId
    || (existingTaskCorrelationId === undefined && task.correlationId === null);
  if (
    existing
    && existingRetryCount === input.retryCount
    && correlationMatches
  ) {
    const existingParentExecutionId = existingPayload.parentExecutionId ?? null;
    const requestedParentExecutionId = input.options?.parentExecutionId;
    const parentExecutionMatches = requestedParentExecutionId === undefined
      || existingParentExecutionId === requestedParentExecutionId;
    const requestedDelegationBudget = input.options?.delegationBudget;
    const budgetMatches = requestedDelegationBudget === undefined
      || stableJson(existingPayload.delegationBudget) === stableJson(requestedDelegationBudget);
    const identityMatches = (
      existing.type === TASK_AUTO_EXECUTION_REQUESTED_EVENT_TYPE
      || existing.type === TASK_AUTO_EXECUTION_DEFERRED_EVENT_TYPE
    )
      && existing.projectId === task.projectId
      && existing.taskId === input.taskId
      && existingPayload.userId === input.userId
      && parentExecutionMatches
      && budgetMatches;
    if (!identityMatches) return false;

    // Upgrade the legacy null-correlation shape in place. Without this,
    // subsequent deferral updates would compare undefined to null and leave
    // the pre-claim failure unrecorded.
    if (existingTaskCorrelationId === undefined) {
      await tx.update(eventsTable)
        .set({
          payload: {
            ...existingPayload,
            taskCorrelationId: task.correlationId,
          },
        })
        .where(eq(eventsTable.id, id));
    }
    return true;
  }

  const payload = {
    userId: input.userId,
    taskRetryCount: input.retryCount,
    taskCorrelationId: task.correlationId,
    attemptCount: 0,
    ...(input.options?.parentExecutionId !== undefined
      ? { parentExecutionId: input.options.parentExecutionId }
      : {}),
    ...(input.options?.delegationBudget !== undefined
      ? { delegationBudget: input.options.delegationBudget }
      : {}),
  };
  if (existing) {
    await tx.update(eventsTable)
      .set({
        type: TASK_AUTO_EXECUTION_REQUESTED_EVENT_TYPE,
        severity: "info",
        message: "Automatic AI task execution was requested.",
        timestamp: new Date(),
        payload,
      })
      .where(eq(eventsTable.id, id));
  } else {
    await tx.insert(eventsTable).values({
      id,
      type: TASK_AUTO_EXECUTION_REQUESTED_EVENT_TYPE,
      projectId: task.projectId,
      taskId: input.taskId,
      severity: "info",
      message: "Automatic AI task execution was requested.",
      payload,
    }).onConflictDoNothing();
  }
  return true;
}
