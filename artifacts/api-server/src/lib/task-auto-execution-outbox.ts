import { randomUUID } from "crypto";
import { db, eventsTable, tasksTable } from "@workspace/db";
import { eq, sql } from "drizzle-orm";

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
      id: tasksTable.id,
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

  // This row records durable dispatch intent, not execution authorization.
  // Keep it even while prerequisites are pending so the scheduler can retry
  // without requiring another operator action. executeTaskLifecycle rechecks
  // the complete dependency graph under the Task lock before any Execution
  // can be created; blocked automatic attempts retain this intent as Deferred.
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
        projectId: task.projectId,
        taskId: input.taskId,
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


/**
 * A dispatcher lease prevents multiple API replicas from enqueueing the same
 * durable Task intent at once. It is scheduling metadata only: the Task
 * lifecycle claim remains the authority to create an Execution.
 */
export const TASK_AUTO_EXECUTION_DISPATCH_LEASE_MS = 10 * 60_000;

export type TaskAutoExecutionDispatchLeaseClaim =
  | { acquired: true; token: string; expiresAt: string }
  | {
      acquired: false;
      reason: "task_not_runnable" | "intent_mismatch" | "retry_not_due" | "already_leased";
    };

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

export async function claimTaskAutoExecutionDispatchLease(
  tx: TaskAutoExecutionOutboxTransaction,
  input: {
    taskId: string;
    userId: string;
    retryCount: number;
    correlationId: string | null;
  },
): Promise<TaskAutoExecutionDispatchLeaseClaim> {
  // Keep the same Task -> Outbox lock order used by producers and the final
  // execution claim. This serializes contenders across API processes.
  const [task] = await tx
    .select({
      id: tasksTable.id,
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
    || task.correlationId !== input.correlationId
  ) {
    return { acquired: false, reason: "task_not_runnable" };
  }

  const intentId = taskAutoExecutionIntentId(input.taskId);
  const [intent] = await tx
    .select({
      type: eventsTable.type,
      projectId: eventsTable.projectId,
      taskId: eventsTable.taskId,
      payload: eventsTable.payload,
    })
    .from(eventsTable)
    .where(eq(eventsTable.id, intentId))
    .for("update")
    .limit(1);

  const payload = intent?.payload;
  const correlationMatches = payload?.taskCorrelationId === task.correlationId
    || (payload?.taskCorrelationId === undefined && task.correlationId === null);
  if (
    !intent
    || (
      intent.type !== TASK_AUTO_EXECUTION_REQUESTED_EVENT_TYPE
      && intent.type !== TASK_AUTO_EXECUTION_DEFERRED_EVENT_TYPE
    )
    || intent.projectId !== task.projectId
    || intent.taskId !== task.id
    || !payload
    || payload.userId !== input.userId
    || payload.taskRetryCount !== input.retryCount
    || !correlationMatches
  ) {
    return { acquired: false, reason: "intent_mismatch" };
  }

  const clockResult = await tx.execute(sql`SELECT clock_timestamp() AS now`);
  const clockValue = (clockResult.rows as Array<{ now: Date | string }>)[0]?.now;
  const databaseNow = clockValue instanceof Date ? clockValue : new Date(String(clockValue ?? ""));
  if (!clockValue || !Number.isFinite(databaseNow.getTime())) {
    return { acquired: false, reason: "intent_mismatch" };
  }

  const nextAttemptAt = typeof payload.nextAttemptAt === "string"
    ? Date.parse(payload.nextAttemptAt)
    : Number.NaN;
  if (Number.isFinite(nextAttemptAt) && nextAttemptAt > databaseNow.getTime()) {
    return { acquired: false, reason: "retry_not_due" };
  }

  const currentLease = isRecord(payload.dispatchLease) ? payload.dispatchLease : undefined;
  const currentLeaseExpiry = typeof currentLease?.expiresAt === "string"
    ? Date.parse(currentLease.expiresAt)
    : Number.NaN;
  if (Number.isFinite(currentLeaseExpiry) && currentLeaseExpiry > databaseNow.getTime()) {
    return { acquired: false, reason: "already_leased" };
  }

  const token = randomUUID();
  const expiresAt = new Date(
    databaseNow.getTime() + TASK_AUTO_EXECUTION_DISPATCH_LEASE_MS,
  ).toISOString();
  await tx.update(eventsTable)
    .set({
      payload: {
        ...payload,
        dispatchLease: { token, expiresAt },
      },
    })
    .where(eq(eventsTable.id, intentId));

  return { acquired: true, token, expiresAt };
}

/** Release only the lease owned by this exact dispatcher token. */
export async function releaseTaskAutoExecutionDispatchLease(
  tx: TaskAutoExecutionOutboxTransaction,
  input: { taskId: string; token: string },
): Promise<boolean> {
  const intentId = taskAutoExecutionIntentId(input.taskId);
  const [intent] = await tx
    .select({ payload: eventsTable.payload })
    .from(eventsTable)
    .where(eq(eventsTable.id, intentId))
    .for("update")
    .limit(1);
  const payload = intent?.payload;
  const lease = payload && isRecord(payload.dispatchLease)
    ? payload.dispatchLease
    : undefined;
  if (!payload || lease?.token !== input.token) return false;

  const { dispatchLease: _dispatchLease, ...nextPayload } = payload;
  await tx.update(eventsTable)
    .set({ payload: nextPayload })
    .where(eq(eventsTable.id, intentId));
  return true;
}
