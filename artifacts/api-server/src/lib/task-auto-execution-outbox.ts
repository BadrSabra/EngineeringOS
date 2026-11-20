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


export const TASK_AUTO_EXECUTION_DISPATCH_LEASE_MS = 2 * 60_000;
export const TASK_AUTO_EXECUTION_DISPATCH_HEARTBEAT_MS = 30_000;

export type TaskAutoExecutionDispatchLease = {
  token: string;
  expiresAt: string;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

async function readDispatchDatabaseNow(
  tx: TaskAutoExecutionOutboxTransaction,
): Promise<Date | null> {
  const result = await tx.execute(
    // Use the database clock so replicas agree on lease ownership.
    // Timestamp values in the event payload are stored as ISO UTC strings.
    // eslint-disable-next-line no-template-curly-in-string
    (await import("drizzle-orm")).sql`SELECT clock_timestamp() AS now`,
  );
  const raw = (result.rows as Array<{ now: Date | string }>)[0]?.now;
  const now = raw instanceof Date ? raw : new Date(String(raw ?? ""));
  return raw && Number.isFinite(now.getTime()) ? now : null;
}

/**
 * Claim one exact Task generation before enqueueing it in a process-local
 * queue. The row lock serializes competing API replicas; the expiry lets
 * another replica reclaim the intent after a process exits.
 *
 * This lease is dispatch coordination only. executeTaskLifecycle still
 * performs the authoritative Task/Execution claim and consumes the intent.
 */
export async function claimTaskAutoExecutionDispatchLease(input: {
  taskId: string;
  userId: string;
  retryCount: number;
  correlationId: string | null;
}): Promise<TaskAutoExecutionDispatchLease | null> {
  return db.transaction(async (tx) => {
    const [intent] = await tx.select({
      type: eventsTable.type,
      taskId: eventsTable.taskId,
      payload: eventsTable.payload,
    })
      .from(eventsTable)
      .where(eq(eventsTable.id, taskAutoExecutionIntentId(input.taskId)))
      .for("update")
      .limit(1);

    if (
      !intent
      || intent.taskId !== input.taskId
      || ![
        TASK_AUTO_EXECUTION_REQUESTED_EVENT_TYPE,
        TASK_AUTO_EXECUTION_DEFERRED_EVENT_TYPE,
      ].includes(intent.type)
      || !isRecord(intent.payload)
    ) return null;

    const payload = intent.payload;
    const correlationMatches = payload.taskCorrelationId === input.correlationId
      || (payload.taskCorrelationId === undefined && input.correlationId === null);
    if (
      payload.userId !== input.userId
      || payload.taskRetryCount !== input.retryCount
      || !correlationMatches
    ) return null;

    const now = await readDispatchDatabaseNow(tx);
    if (!now) return null;

    const nextAttemptAt = typeof payload.nextAttemptAt === "string"
      ? Date.parse(payload.nextAttemptAt)
      : Number.NaN;
    if (Number.isFinite(nextAttemptAt) && nextAttemptAt > now.getTime()) return null;

    const currentLease = isRecord(payload.dispatchLease)
      ? payload.dispatchLease
      : undefined;
    const currentExpiry = typeof currentLease?.expiresAt === "string"
      ? Date.parse(currentLease.expiresAt)
      : Number.NaN;
    if (Number.isFinite(currentExpiry) && currentExpiry > now.getTime()) return null;

    const lease: TaskAutoExecutionDispatchLease = {
      token: randomUUID(),
      expiresAt: new Date(now.getTime() + TASK_AUTO_EXECUTION_DISPATCH_LEASE_MS).toISOString(),
    };
    await tx.update(eventsTable)
      .set({ payload: { ...payload, dispatchLease: lease } })
      .where(eq(eventsTable.id, taskAutoExecutionIntentId(input.taskId)));
    return lease;
  });
}

/**
 * Extend only a still-live lease owned by the exact token. An expired worker
 * cannot resurrect its lease after another replica becomes eligible to claim.
 */
export async function renewTaskAutoExecutionDispatchLease(input: {
  taskId: string;
  token: string;
}): Promise<boolean> {
  return db.transaction(async (tx) => {
    const id = taskAutoExecutionIntentId(input.taskId);
    const [intent] = await tx.select({
      type: eventsTable.type,
      taskId: eventsTable.taskId,
      payload: eventsTable.payload,
    })
      .from(eventsTable)
      .where(eq(eventsTable.id, id))
      .for("update")
      .limit(1);
    if (
      !intent
      || intent.taskId !== input.taskId
      || ![
        TASK_AUTO_EXECUTION_REQUESTED_EVENT_TYPE,
        TASK_AUTO_EXECUTION_DEFERRED_EVENT_TYPE,
      ].includes(intent.type)
      || !isRecord(intent.payload)
      || !isRecord(intent.payload.dispatchLease)
      || intent.payload.dispatchLease.token !== input.token
    ) return false;

    const now = await readDispatchDatabaseNow(tx);
    const currentExpiry = typeof intent.payload.dispatchLease.expiresAt === "string"
      ? Date.parse(intent.payload.dispatchLease.expiresAt)
      : Number.NaN;
    if (!now || !Number.isFinite(currentExpiry) || currentExpiry <= now.getTime()) {
      return false;
    }

    const lease: TaskAutoExecutionDispatchLease = {
      token: input.token,
      expiresAt: new Date(now.getTime() + TASK_AUTO_EXECUTION_DISPATCH_LEASE_MS).toISOString(),
    };
    await tx.update(eventsTable)
      .set({ payload: { ...intent.payload, dispatchLease: lease } })
      .where(eq(eventsTable.id, id));
    return true;
  });
}
