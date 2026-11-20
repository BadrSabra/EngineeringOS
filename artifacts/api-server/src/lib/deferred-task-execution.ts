/**
 * Durable wait-and-resume for explicitly requested Task verification.
 *
 * The request is stored in eventsTable while prerequisites are incomplete.
 * The dispatcher never executes prerequisites; it rechecks the full dependency
 * graph before claiming the requested Task and running the normal local
 * verification pipeline.
 */
import { randomUUID } from "node:crypto";
import { and, asc, eq, gt, inArray, lte, or, sql } from "drizzle-orm";
import {
  db,
  eventsTable,
  projectsTable,
  taskLogsTable,
  tasksTable,
} from "@workspace/db";
import { heavyJobQueue } from "./job-queue.js";
import { logger } from "./logger.js";
import { recordAuditInTransaction } from "./audit.js";
import {
  AI_TASK_HEARTBEAT_INTERVAL_MS,
  AI_TASK_LEASE_MS,
  databaseLeaseUntil,
  databaseNow,
} from "./job-lease.js";
import { getTaskDependencyBlockers } from "./task-dependencies.js";
import { runTaskVerification } from "../services/task-service.js";
import { markRemediationPlanVerified } from "./remediation-plan.js";
import { insertTaskAutoExecutionIntent } from "./task-auto-execution-outbox.js";
import { scheduleAiTaskExecution } from "../routes/ai/tasks.js";

export const TASK_EXECUTION_WAITING_FOR_DEPENDENCIES =
  "TaskExecutionWaitingForDependencies";
export const TASK_EXECUTION_DEFERRED_FAILED = "TaskExecutionDeferredFailed";

const TASK_EXECUTION_WAIT_INTENT_PREFIX = "task-execution-wait:";
const MAX_DEFERRED_VERIFICATION_ATTEMPTS = 3;
const DEFERRED_VERIFICATION_RETRY_MS = 60_000;

type DeferredTaskStatus = "pending" | "queued";

type DeferredTaskExecutionPayload = {
  userId: string;
  taskRetryCount: number;
  taskCorrelationId: string | null;
  originalStatus: DeferredTaskStatus;
  attemptCount: number;
  nextAttemptAt?: string;
  lastFailureCode?: string;
};

type DeferredTaskSnapshot = {
  intentId: string;
  taskId: string;
  projectId: string;
  payload: unknown;
  timestampKey?: string;
};

export function taskExecutionWaitIntentId(taskId: string): string {
  return `${TASK_EXECUTION_WAIT_INTENT_PREFIX}${taskId}`;
}

function parseDeferredTaskExecutionPayload(
  value: unknown,
): DeferredTaskExecutionPayload | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const record = value as Record<string, unknown>;
  if (typeof record.userId !== "string" || record.userId.length === 0) return null;
  if (!Number.isSafeInteger(record.taskRetryCount) || Number(record.taskRetryCount) < 0) return null;
  if (
    record.taskCorrelationId !== null
    && typeof record.taskCorrelationId !== "string"
  ) return null;
  if (record.originalStatus !== "pending" && record.originalStatus !== "queued") return null;
  const attemptCount = record.attemptCount ?? 0;
  if (!Number.isSafeInteger(attemptCount) || Number(attemptCount) < 0) return null;
  if (
    record.nextAttemptAt !== undefined
    && (typeof record.nextAttemptAt !== "string" || !Number.isFinite(Date.parse(record.nextAttemptAt)))
  ) return null;
  if (
    record.lastFailureCode !== undefined
    && (typeof record.lastFailureCode !== "string" || !/^[A-Za-z0-9_.-]{1,64}$/.test(record.lastFailureCode))
  ) return null;
  return {
    userId: record.userId,
    taskRetryCount: Number(record.taskRetryCount),
    taskCorrelationId: record.taskCorrelationId as string | null,
    originalStatus: record.originalStatus,
    attemptCount: Number(attemptCount),
    ...(typeof record.nextAttemptAt === "string" ? { nextAttemptAt: record.nextAttemptAt } : {}),
    ...(typeof record.lastFailureCode === "string" ? { lastFailureCode: record.lastFailureCode } : {}),
  };
}

function payloadMatchesTask(
  payload: DeferredTaskExecutionPayload,
  task: { retryCount: number; correlationId: string | null },
): boolean {
  return payload.taskRetryCount === task.retryCount
    && payload.taskCorrelationId === task.correlationId;
}

type TaskExecutionTransaction = Parameters<Parameters<typeof db.transaction>[0]>[0];

async function databaseClock(tx: TaskExecutionTransaction | typeof db): Promise<Date | null> {
  const result = await tx.execute(sql`SELECT clock_timestamp() AS now`);
  const value = (result.rows as Array<{ now: Date | string }>)[0]?.now;
  const date = value instanceof Date ? value : new Date(String(value ?? ""));
  return value && Number.isFinite(date.getTime()) ? date : null;
}

/**
 * Save an explicit Execute request when its only blockers are prerequisites
 * that have not completed yet. Invalid, missing, cyclic, or oversized graphs
 * remain hard failures.
 *
 * The caller holds the Task row and dependency rows locked in this
 * transaction, so the captured dependency result and intent commit together.
 */
export async function persistDeferredTaskVerificationIntent(
  tx: Parameters<Parameters<typeof db.transaction>[0]>[0],
  input: {
    taskId: string;
    userId: string;
    retryCount: number;
    taskCorrelationId: string | null;
    originalStatus: DeferredTaskStatus;
    blockers: Array<{ reason: string }>;
  },
): Promise<boolean> {
  if (
    input.blockers.length === 0
    || input.blockers.some((blocker) => blocker.reason !== "dependency_not_completed")
  ) return false;

  const [task] = await tx
    .select({
      id: tasksTable.id,
      projectId: tasksTable.projectId,
      status: tasksTable.status,
      retryCount: tasksTable.retryCount,
      correlationId: tasksTable.correlationId,
    })
    .from(tasksTable)
    .where(eq(tasksTable.id, input.taskId))
    .for("update")
    .limit(1);
  if (
    !task
    || task.status !== input.originalStatus
    || task.retryCount !== input.retryCount
    || task.correlationId !== input.taskCorrelationId
  ) return false;

  const intentId = taskExecutionWaitIntentId(input.taskId);
  const [existing] = await tx
    .select({ type: eventsTable.type, payload: eventsTable.payload })
    .from(eventsTable)
    .where(eq(eventsTable.id, intentId))
    .for("update")
    .limit(1);

  const currentPayload = parseDeferredTaskExecutionPayload(existing?.payload);
  if (
    existing?.type === TASK_EXECUTION_WAITING_FOR_DEPENDENCIES
    && currentPayload
    && payloadMatchesTask(currentPayload, task)
    && currentPayload.userId === input.userId
  ) {
    return true;
  }

  const now = await databaseClock(tx);
  if (!now) return false;
  const payload: DeferredTaskExecutionPayload = {
    userId: input.userId,
    taskRetryCount: task.retryCount,
    taskCorrelationId: task.correlationId,
    originalStatus: input.originalStatus,
    attemptCount: 0,
    nextAttemptAt: now.toISOString(),
  };
  const values = {
    type: TASK_EXECUTION_WAITING_FOR_DEPENDENCIES,
    projectId: task.projectId,
    taskId: task.id,
    severity: "warning" as const,
    message: "Task execution is queued until its prerequisites are completed.",
    correlationId: task.correlationId ?? undefined,
    payload,
  };
  if (existing) {
    await tx.update(eventsTable).set(values).where(eq(eventsTable.id, intentId));
  } else {
    await tx.insert(eventsTable).values({
      id: intentId,
      ...values,
    });
  }
  await tx.insert(taskLogsTable).values({
    id: randomUUID(),
    taskId: task.id,
    level: "warn",
    message: "Task execution queued — waiting for prerequisite tasks to complete.",
    metadata: {
      stage: "waiting_for_dependencies",
      blockedDependencyCount: input.blockers.length,
    },
    correlationId: task.correlationId ?? undefined,
  });
  return true;
}

async function updateDeferredIntent(
  tx: Parameters<Parameters<typeof db.transaction>[0]>[0],
  intentId: string,
  payload: DeferredTaskExecutionPayload,
  reasonCode: string,
  delayMs: number,
): Promise<void> {
  const now = await databaseClock(tx);
  if (!now) return;
  const nextAttemptCount = payload.attemptCount + (reasonCode === "DEPENDENCIES_PENDING" ? 0 : 1);
  const failed = reasonCode !== "DEPENDENCIES_PENDING"
    && nextAttemptCount >= MAX_DEFERRED_VERIFICATION_ATTEMPTS;
  const nextPayload: DeferredTaskExecutionPayload = {
    ...payload,
    attemptCount: nextAttemptCount,
    lastFailureCode: reasonCode,
    nextAttemptAt: new Date(now.getTime() + Math.max(1, delayMs)).toISOString(),
  };
  await tx.update(eventsTable)
    .set({
      type: failed ? TASK_EXECUTION_DEFERRED_FAILED : TASK_EXECUTION_WAITING_FOR_DEPENDENCIES,
      severity: failed ? "error" : "warning",
      message: failed
        ? "Deferred task verification stopped after repeated failures. Execute the task again to retry."
        : reasonCode === "DEPENDENCIES_PENDING"
          ? "Task execution is still waiting for prerequisite completion."
          : "Deferred task verification failed and will be retried.",
      payload: nextPayload,
    })
    .where(eq(eventsTable.id, intentId));
}

async function retireDeferredIntent(snapshot: DeferredTaskSnapshot): Promise<boolean> {
  return db.transaction(async (tx) => {
    const [intent] = await tx.select({
      type: eventsTable.type,
      payload: eventsTable.payload,
      projectId: eventsTable.projectId,
      taskId: eventsTable.taskId,
    }).from(eventsTable)
      .where(eq(eventsTable.id, snapshot.intentId))
      .for("update")
      .limit(1);
    if (
      !intent
      || intent.type !== TASK_EXECUTION_WAITING_FOR_DEPENDENCIES
      || intent.projectId !== snapshot.projectId
      || intent.taskId !== snapshot.taskId
      || JSON.stringify(intent.payload) !== JSON.stringify(snapshot.payload)
    ) return false;
    const [deleted] = await tx.delete(eventsTable)
      .where(and(
        eq(eventsTable.id, snapshot.intentId),
        eq(eventsTable.type, TASK_EXECUTION_WAITING_FOR_DEPENDENCIES),
      ))
      .returning({ id: eventsTable.id });
    return Boolean(deleted);
  });
}

async function recheckDeferredTaskReadiness(
  snapshot: DeferredTaskSnapshot,
): Promise<"ready" | "blocked" | "retired"> {
  return db.transaction(async (tx) => {
    const [task] = await tx.select({
      id: tasksTable.id,
      projectId: tasksTable.projectId,
      status: tasksTable.status,
      retryCount: tasksTable.retryCount,
      correlationId: tasksTable.correlationId,
      dependsOn: tasksTable.dependsOn,
    }).from(tasksTable)
      .where(eq(tasksTable.id, snapshot.taskId))
      .for("update")
      .limit(1);
    const [intent] = await tx.select({
      type: eventsTable.type,
      payload: eventsTable.payload,
      projectId: eventsTable.projectId,
      taskId: eventsTable.taskId,
    }).from(eventsTable)
      .where(eq(eventsTable.id, snapshot.intentId))
      .for("update")
      .limit(1);

    const payload = parseDeferredTaskExecutionPayload(intent?.payload);
    if (
      !task
      || !intent
      || intent.type !== TASK_EXECUTION_WAITING_FOR_DEPENDENCIES
      || intent.projectId !== snapshot.projectId
      || intent.taskId !== snapshot.taskId
      || !payload
      || !payloadMatchesTask(payload, task)
      || task.status !== payload.originalStatus
      || task.status !== "pending" && task.status !== "queued"
    ) {
      if (intent?.type === TASK_EXECUTION_WAITING_FOR_DEPENDENCIES) {
        await tx.delete(eventsTable).where(eq(eventsTable.id, snapshot.intentId));
      }
      return "retired";
    }

    const blockers = await getTaskDependencyBlockers(tx, task);
    if (blockers.length > 0) {
      if (blockers.some((blocker) => blocker.reason !== "dependency_not_completed")) {
        await tx.update(eventsTable)
          .set({
            type: TASK_EXECUTION_DEFERRED_FAILED,
            severity: "error",
            message: "Deferred execution was stopped because the prerequisite graph is invalid.",
            payload: { ...payload, lastFailureCode: "INVALID_DEPENDENCY_GRAPH" },
          })
          .where(eq(eventsTable.id, snapshot.intentId));
        return "retired";
      }
      await updateDeferredIntent(
        tx,
        snapshot.intentId,
        payload,
        "DEPENDENCIES_PENDING",
        30_000,
      );
      return "blocked";
    }
    return "ready";
  });
}

async function renewDeferredTaskLease(taskId: string, workerId: string): Promise<boolean> {
  const [updated] = await db.update(tasksTable).set({
    leaseUntil: databaseLeaseUntil(AI_TASK_LEASE_MS),
    lastHeartbeatAt: databaseNow(),
    updatedAt: databaseNow(),
  }).where(and(
    eq(tasksTable.id, taskId),
    eq(tasksTable.status, "running"),
    eq(tasksTable.workerId, workerId),
    gt(tasksTable.leaseUntil, databaseNow()),
  )).returning({ id: tasksTable.id });
  return Boolean(updated);
}

function startDeferredTaskHeartbeat(taskId: string, workerId: string) {
  let stopped = false;
  let lostLease = false;
  let pending: Promise<void> = Promise.resolve();
  const queueHeartbeat = () => {
    if (stopped || lostLease) return pending;
    pending = pending.then(async () => {
      if (stopped || lostLease) return;
      try {
        if (!await renewDeferredTaskLease(taskId, workerId)) lostLease = true;
      } catch (error) {
        lostLease = true;
        logger.error({ err: error, taskId }, "deferred Task verification heartbeat failed");
      }
    });
    return pending;
  };
  const timer = setInterval(() => { void queueHeartbeat(); }, AI_TASK_HEARTBEAT_INTERVAL_MS);
  return {
    renewNow: async () => { await queueHeartbeat(); return !lostLease; },
    stop: async () => {
      stopped = true;
      clearInterval(timer);
      await pending;
      return !lostLease;
    },
  };
}

/**
 * Execute one deferred verification. The database claim and dependency recheck
 * happen immediately before the local verifier runs; duplicate dispatchers
 * therefore cannot execute the same Task concurrently.
 */
export async function runDeferredTaskVerification(taskId: string): Promise<boolean> {
  const workerId = randomUUID();
  const correlationId = randomUUID();
  const claimed = await db.transaction(async (tx) => {
    const intentId = taskExecutionWaitIntentId(taskId);
    const [task] = await tx.select().from(tasksTable)
      .where(eq(tasksTable.id, taskId))
      .for("update")
      .limit(1);
    const [intent] = await tx.select({
      type: eventsTable.type,
      payload: eventsTable.payload,
    }).from(eventsTable)
      .where(eq(eventsTable.id, intentId))
      .for("update")
      .limit(1);
    const payload = parseDeferredTaskExecutionPayload(intent?.payload);
    if (
      !task
      || !intent
      || intent.type !== TASK_EXECUTION_WAITING_FOR_DEPENDENCIES
      || !payload
      || !payloadMatchesTask(payload, task)
      || task.status !== payload.originalStatus
      || (task.status !== "pending" && task.status !== "queued")
    ) return null;

    const blockers = await getTaskDependencyBlockers(tx, task);
    if (blockers.length > 0) return null;
    const [project] = await tx.select({
      rootPath: projectsTable.rootPath,
    }).from(projectsTable)
      .where(eq(projectsTable.id, task.projectId))
      .limit(1);
    if (!project?.rootPath) return null;

    const [row] = await tx.update(tasksTable).set({
      status: "running",
      workerId,
      leaseUntil: databaseLeaseUntil(AI_TASK_LEASE_MS),
      lastHeartbeatAt: databaseNow(),
      updatedAt: databaseNow(),
    }).where(and(
      eq(tasksTable.id, taskId),
      inArray(tasksTable.status, ["pending", "queued"]),
      isNull(tasksTable.workerId),
    )).returning();
    if (!row) return null;

    await tx.insert(taskLogsTable).values({
      id: randomUUID(),
      taskId,
      level: "info",
      message: "Deferred task execution started after all prerequisites completed.",
      metadata: { stage: "dependency_wait_released" },
      correlationId,
    });
    await tx.insert(eventsTable).values({
      id: randomUUID(),
      type: "TaskExecutionStarted",
      projectId: row.projectId,
      taskId,
      severity: "info",
      message: `Executing task "${row.title}" after prerequisite completion.`,
      correlationId,
      payload: { before: { status: task.status }, after: { status: "running" } },
    });
    return {
      task: row,
      rootPath: project.rootPath,
      originalStatus: payload.originalStatus,
      userId: payload.userId,
    };
  });
  if (!claimed) return false;

  const heartbeat = startDeferredTaskHeartbeat(taskId, workerId);
  try {
    if (!await heartbeat.renewNow()) {
      await heartbeat.stop();
      return false;
    }
    const verification = await runTaskVerification(claimed.task, claimed.rootPath);
    if (!await heartbeat.stop()) return false;

    const { finalStatus, steps } = verification;
    const verificationResult = {
      passed: finalStatus === "completed",
      decision: finalStatus === "completed"
        ? ("verified" as const)
        : finalStatus === "failed"
          ? ("failed" as const)
          : ("incomplete" as const),
      steps: steps.map((step) => ({ ...step, kind: step.kind ?? ("automatic" as const) })),
    };
    const finalized = await db.transaction(async (tx) => {
      const [row] = await tx.update(tasksTable).set({
        status: finalStatus,
        verificationResult,
        remediationPlan: markRemediationPlanVerified(
          claimed.task.remediationPlan,
          finalStatus === "completed",
        ),
        updatedAt: databaseNow(),
        completedAt: finalStatus === "completed" ? databaseNow() : null,
        workerId: null,
        leaseUntil: null,
        lastHeartbeatAt: null,
      }).where(and(
        eq(tasksTable.id, taskId),
        eq(tasksTable.status, "running"),
        eq(tasksTable.workerId, workerId),
        gt(tasksTable.leaseUntil, databaseNow()),
      )).returning();
      if (!row) return { updated: false, aiDispatch: false };

      await tx.insert(taskLogsTable).values({
        id: randomUUID(),
        taskId,
        level: finalStatus === "completed" ? "info" : finalStatus === "failed" ? "error" : "warn",
        message: `Verification ${finalStatus}: ${steps[0]?.output ?? verification.summary ?? "no details"}`,
        metadata: { verificationResult, stage: "deferred_verification_completed" },
        correlationId,
      });
      await tx.insert(eventsTable).values({
        id: randomUUID(),
        type: finalStatus === "completed"
          ? "TaskCompleted"
          : finalStatus === "failed"
            ? "TaskFailed"
            : "TaskVerifying",
        projectId: claimed.task.projectId,
        taskId,
        severity: finalStatus === "completed"
          ? "success"
          : finalStatus === "failed"
            ? "error"
            : "warning",
        message: `Task "${claimed.task.title}" → ${finalStatus}`,
        correlationId,
        payload: { before: { status: "running" }, after: { status: finalStatus } },
      });
      await recordAuditInTransaction(tx, {
        entityType: "task",
        entityId: taskId,
        action: "executed",
        projectId: claimed.task.projectId,
        actor: undefined,
        stateBefore: { status: claimed.originalStatus },
        stateAfter: { status: finalStatus },
        changedFields: { verificationResult },
        correlationId,
      });

      let aiDispatch = false;
      if (finalStatus === "verifying" && row.prompt) {
        aiDispatch = await insertTaskAutoExecutionIntent(tx, {
          taskId,
          userId: claimed.userId,
          retryCount: row.retryCount,
        });
      }
      await tx.delete(eventsTable)
        .where(and(
          eq(eventsTable.id, taskExecutionWaitIntentId(taskId)),
          eq(eventsTable.type, TASK_EXECUTION_WAITING_FOR_DEPENDENCIES),
        ));
      return { updated: true, aiDispatch };
    });
    if (!finalized.updated) return false;

    if (finalized.aiDispatch && claimed.task.prompt) {
      await scheduleAiTaskExecution(
        taskId,
        claimed.userId,
        undefined,
        claimed.task.retryCount,
        claimed.task.correlationId,
      );
    }
    return true;
  } catch (error) {
    await heartbeat.stop();
    await recordDeferredVerificationFailure(
      taskId,
      workerId,
      claimed.originalStatus,
      correlationId,
      error,
    );
    return false;
  }
}

async function recordDeferredVerificationFailure(
  taskId: string,
  workerId: string,
  originalStatus: DeferredTaskStatus,
  correlationId: string,
  error: unknown,
): Promise<void> {
  const message = error instanceof Error ? error.message : String(error);
  await db.transaction(async (tx) => {
    const intentId = taskExecutionWaitIntentId(taskId);
    const [intent] = await tx.select({ type: eventsTable.type, payload: eventsTable.payload })
      .from(eventsTable)
      .where(eq(eventsTable.id, intentId))
      .for("update")
      .limit(1);
    const payload = parseDeferredTaskExecutionPayload(intent?.payload);
    const [restored] = await tx.update(tasksTable).set({
      status: originalStatus,
      workerId: null,
      leaseUntil: null,
      lastHeartbeatAt: null,
      updatedAt: databaseNow(),
    }).where(and(
      eq(tasksTable.id, taskId),
      eq(tasksTable.status, "running"),
      eq(tasksTable.workerId, workerId),
      gt(tasksTable.leaseUntil, databaseNow()),
    )).returning({ id: tasksTable.id, projectId: tasksTable.projectId });
    if (!restored) return;

    if (intent?.type === TASK_EXECUTION_WAITING_FOR_DEPENDENCIES && payload) {
      await updateDeferredIntent(
        tx,
        intentId,
        payload,
        "DEFERRED_VERIFICATION_FAILED",
        DEFERRED_VERIFICATION_RETRY_MS * (payload.attemptCount + 1),
      );
    }
    await tx.insert(taskLogsTable).values({
      id: randomUUID(),
      taskId,
      level: "error",
      message: "Deferred task verification failed; the task was returned to its original state.",
      metadata: { code: "DEFERRED_VERIFICATION_FAILED", detail: message.slice(0, 300) },
      correlationId,
    });
    await tx.insert(eventsTable).values({
      id: randomUUID(),
      type: "TaskExecutionFailed",
      projectId: restored.projectId,
      taskId,
      severity: "error",
      message: "Deferred task verification failed; retry will be bounded.",
      correlationId,
      payload: { before: { status: "running" }, after: { status: originalStatus } },
    });
    await recordAuditInTransaction(tx, {
      entityType: "task",
      entityId: taskId,
      action: "execution_failed",
      projectId: restored.projectId,
      stateBefore: { status: "running" },
      stateAfter: { status: originalStatus },
      changedFields: { error: message.slice(0, 300) },
      correlationId,
    });
  });
}

/**
 * Enqueue due, durable requests. The worker claims and rechecks the Task; this
 * method is intentionally safe to call from every API replica and scheduler
 * pass.
 */
export async function dispatchDeferredTaskVerifications(limit = 100): Promise<number> {
  const now = await databaseClock(db);
  if (!now) return 0;
  const intents = await db.select({
    intentId: eventsTable.id,
    projectId: eventsTable.projectId,
    taskId: eventsTable.taskId,
    payload: eventsTable.payload,
    timestampKey: sql<string>`to_char(${eventsTable.timestamp}, 'YYYY-MM-DD"T"HH24:MI:SS.US')`,
  }).from(eventsTable)
    .where(and(
      eq(eventsTable.type, TASK_EXECUTION_WAITING_FOR_DEPENDENCIES),
      sql`(
        ${eventsTable.payload}->>'nextAttemptAt' IS NULL
        OR ${eventsTable.payload}->>'nextAttemptAt' !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}T'
        OR ${eventsTable.payload}->>'nextAttemptAt' <= ${now.toISOString()}
      )`,
    ))
    .orderBy(asc(eventsTable.timestamp), asc(eventsTable.id))
    .limit(limit);

  let enqueued = 0;
  for (const intent of intents) {
    if (!intent.taskId || !intent.projectId) {
      await retireDeferredIntent({
        intentId: intent.intentId,
        taskId: intent.taskId ?? "",
        projectId: intent.projectId ?? "",
        payload: intent.payload,
      });
      continue;
    }
    const payload = parseDeferredTaskExecutionPayload(intent.payload);
    if (!payload) {
      await retireDeferredIntent({
        intentId: intent.intentId,
        taskId: intent.taskId,
        projectId: intent.projectId,
        payload: intent.payload,
      });
      continue;
    }
    const readiness = await recheckDeferredTaskReadiness({
      intentId: intent.intentId,
      taskId: intent.taskId,
      projectId: intent.projectId,
      payload: intent.payload,
    });
    if (readiness !== "ready") continue;

    const result = heavyJobQueue.enqueueWithIdDetailed(intent.taskId, async () => {
      await runDeferredTaskVerification(intent.taskId!);
    });
    if (result === "enqueued") enqueued++;
  }
  return enqueued;
}

/**
 * The generic Task lease reconciler must not turn a crashed local-verification
 * worker into an AI-verifying Task. Restore its original state while retaining
 * the explicit wait intent so the next dispatcher pass can safely retry.
 */
export async function recoverExpiredDeferredTaskVerifications(): Promise<number> {
  const now = await databaseClock(db);
  if (!now) return 0;
  const stale = await db.select({
    taskId: tasksTable.id,
    workerId: tasksTable.workerId,
    projectId: tasksTable.projectId,
    retryCount: tasksTable.retryCount,
    correlationId: tasksTable.correlationId,
    intentId: eventsTable.id,
    payload: eventsTable.payload,
  }).from(tasksTable)
    .innerJoin(eventsTable, and(
      eq(eventsTable.taskId, tasksTable.id),
      eq(eventsTable.type, TASK_EXECUTION_WAITING_FOR_DEPENDENCIES),
    ))
    .where(and(
      eq(tasksTable.status, "running"),
      or(isNull(tasksTable.leaseUntil), lte(tasksTable.leaseUntil, now)),
    ))
    .orderBy(asc(tasksTable.id))
    .limit(100);

  let recovered = 0;
  for (const item of stale) {
    await db.transaction(async (tx) => {
      const [task] = await tx.select({
        status: tasksTable.status,
        workerId: tasksTable.workerId,
        leaseUntil: tasksTable.leaseUntil,
      }).from(tasksTable)
        .where(eq(tasksTable.id, item.taskId))
        .for("update")
        .limit(1);
      const [intent] = await tx.select({
        type: eventsTable.type,
        payload: eventsTable.payload,
      }).from(eventsTable)
        .where(eq(eventsTable.id, item.intentId))
        .for("update")
        .limit(1);
      const payload = parseDeferredTaskExecutionPayload(intent?.payload);
      if (
        !task
        || task.status !== "running"
        || task.workerId !== item.workerId
        || intent?.type !== TASK_EXECUTION_WAITING_FOR_DEPENDENCIES
        || !payload
      ) return;
      const [restored] = await tx.update(tasksTable).set({
        status: payload.originalStatus,
        workerId: null,
        leaseUntil: null,
        lastHeartbeatAt: null,
        updatedAt: databaseNow(),
      }).where(and(
        eq(tasksTable.id, item.taskId),
        eq(tasksTable.status, "running"),
        eq(tasksTable.workerId, item.workerId!),
        or(isNull(tasksTable.leaseUntil), lte(tasksTable.leaseUntil, databaseNow())),
      )).returning({ id: tasksTable.id });
      if (!restored) return;
      await updateDeferredIntent(
        tx,
        item.intentId,
        payload,
        "DEFERRED_VERIFICATION_WORKER_LOST",
        DEFERRED_VERIFICATION_RETRY_MS,
      );
      await tx.insert(taskLogsTable).values({
        id: randomUUID(),
        taskId: item.taskId,
        level: "warn",
        message: "Deferred verification worker lease expired; the request was preserved for retry.",
        metadata: { code: "DEFERRED_VERIFICATION_WORKER_LOST" },
      });
      recovered++;
    });
  }
  return recovered;
}
