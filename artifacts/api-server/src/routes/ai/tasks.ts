/**
 * AI task execution routes + auto-trigger scheduler.
 *
 * POST /api/ai/tasks/:taskId/execute
 * export scheduleAiTaskExecution
 */
import { Router, type Response } from "express";
import { randomUUID } from "crypto";
import { db } from "@workspace/db";
import {
  tasksTable,
  eventsTable,
  aiExecutionsTable,
  aiExecutionAcceptancesTable,
} from "@workspace/db";
import { eq, and, inArray } from "drizzle-orm";
import { logger } from "../../lib/logger.js";
import { loadProjectByIdForUser } from "../../middlewares/requireProjectAccess.js";
import { checkProjectRateLimitDb, LLM_RATE_LIMIT } from "../../lib/db-rate-limiter.js";
import { heavyJobQueue } from "../../lib/job-queue.js";
import {
  requireProvider,
  resolveProvider,
  handleOrchestratorError,
} from "../../lib/ai-route-helpers.js";
import {
  executeTaskLifecycle,
  evaluateTaskExecutionRetryGate,
} from "../../lib/task-execution-service.js";
import {
  ExecutionDelegationBudgetSchema,
  type ExecutionDelegationBudget,
} from "../../lib/execution-lineage.js";

const router = Router();

function respondWithTaskRetryGate(
  res: Response,
  errorCode: string | undefined,
  retryAfterMs?: number,
) {
  if (errorCode === "execution_retry_after_rate_limit") {
    const safeRetryAfterMs = Number.isSafeInteger(retryAfterMs) && (retryAfterMs ?? 0) > 0
      ? retryAfterMs!
      : 1_000;
    return res
      .set("Retry-After", String(Math.max(1, Math.ceil(safeRetryAfterMs / 1_000))))
      .status(429)
      .json({
        error: "task_execution_rate_limited",
        code: errorCode,
        retryAfterMs: safeRetryAfterMs,
        hint: "The provider retry window is still active. The task has not resumed.",
      });
  }
  if (errorCode === "execution_retry_window_unavailable") {
    return res.status(503).json({
      error: "task_retry_window_unavailable",
      code: errorCode,
      hint: "The task retry window could not be verified. No provider request was started.",
    });
  }
  return undefined;
}

// Resume is intentionally task-scoped. The operator never supplies an
// execution ID, attempt, revision, or token; all of those values come from
// the current server-owned task/execution/acceptance relationship.
router.post("/ai/tasks/:taskId/resume", async (req, res) => {
  const { taskId } = req.params;
  const [task] = await db
    .select()
    .from(tasksTable)
    .where(eq(tasksTable.id, taskId))
    .limit(1);
  if (!task) return res.status(404).json({ error: "Task not found" });

  const ownerProject = await loadProjectByIdForUser(task.projectId, req.userId, res);
  if (!ownerProject) return;
  if (!task.correlationId) {
    return res.status(409).json({
      error: "task_not_resumable",
      hint: "The task has no current execution identity to resume.",
    });
  }
  if (!["pending", "queued", "verifying"].includes(task.status)) {
    return res.status(409).json({
      error: "task_not_resumable",
      hint: "Refresh the task and use the current server-provided next action.",
    });
  }

  const matchingExecutions = await db
    .select({
      id: aiExecutionsTable.id,
      attempt: aiExecutionsTable.attempt,
    })
    .from(aiExecutionsTable)
    .where(and(
      eq(aiExecutionsTable.linkedTaskId, task.id),
      eq(aiExecutionsTable.projectId, task.projectId),
      eq(aiExecutionsTable.userId, req.userId),
      eq(aiExecutionsTable.correlationId, task.correlationId),
      inArray(aiExecutionsTable.status, ["paused", "failed"]),
    ))
    .limit(2);
  if (matchingExecutions.length !== 1) {
    return res.status(409).json({
      error: "task_not_resumable",
      hint: "The task has no current recoverable execution.",
    });
  }
  const execution = matchingExecutions[0]!;

  const [acceptance] = await db
    .select({
      resumable: aiExecutionAcceptancesTable.resumable,
      nextActionCode: aiExecutionAcceptancesTable.nextActionCode,
      disposition: aiExecutionAcceptancesTable.disposition,
    })
    .from(aiExecutionAcceptancesTable)
    .where(and(
      eq(aiExecutionAcceptancesTable.executionId, execution.id),
      eq(aiExecutionAcceptancesTable.attempt, execution.attempt),
    ))
    .limit(1);
  const recoveryState = acceptance?.disposition
    && typeof acceptance.disposition === "object"
    && acceptance.disposition !== null
    && (acceptance.disposition as { recoveryState?: unknown }).recoveryState;
  if (
    !acceptance
    || acceptance.resumable !== 1
    || acceptance.nextActionCode !== "RESUME_ALLOWED"
    || recoveryState !== "REQUIRED"
  ) {
    return res.status(409).json({
      error: "task_not_resumable",
      hint: "The current acceptance does not authorize resuming this task.",
    });
  }
  const acceptanceDisposition = acceptance.disposition
    && typeof acceptance.disposition === "object"
    ? acceptance.disposition as Record<string, unknown>
    : undefined;
  const retryGate = evaluateTaskExecutionRetryGate(acceptanceDisposition?.retryAt);
  if (!retryGate.ready) {
    return respondWithTaskRetryGate(
      res,
      retryGate.errorCode,
      "retryAfterMs" in retryGate ? retryGate.retryAfterMs : undefined,
    );
  }

  const providerResolved = await requireProvider(req.userId, res, {
    qualityProfile: "task_execution",
  });
  if (!providerResolved) return;
  const { provider, apiKey } = providerResolved;
  const rateLimit = await checkProjectRateLimitDb(task.projectId);
  if (!rateLimit.allowed) {
    return res.status(429).json({
      error: "task_execution_rate_limited",
      hint: `Try again in ${rateLimit.retryAfterSec}s.`,
    });
  }

  let lifecycle: Awaited<ReturnType<typeof executeTaskLifecycle>>;
  try {
    lifecycle = await executeTaskLifecycle({
      taskId,
      userId: req.userId,
      provider: { provider, apiKey },
      trigger: "manual",
      expectedStatuses: [task.status as "pending" | "queued" | "verifying"],
      expectedRetryCount: task.retryCount,
      expectedCorrelationId: task.correlationId,
      expectedResumeAttempt: execution.attempt,
      expectedProjectUpdatedAt: ownerProject.updatedAt?.toISOString(),
      resumeExecutionId: execution.id,
    });
  } catch (error) {
    logger.error({ err: error, taskId }, "task resume lifecycle failed");
    return res.status(500).json({
      error: "task_resume_failed",
      reason: "The task could not be resumed. Refresh the task activity for the current state.",
    });
  }
  if (lifecycle.status === "conflict") {
    const retryResponse = respondWithTaskRetryGate(
      res,
      lifecycle.errorCode,
      lifecycle.retryAfterMs,
    );
    if (retryResponse) return retryResponse;
    return res.status(409).json({
      error: "task_state_changed_concurrently",
      hint: "The task changed while resume was starting; refresh the task before trying again.",
    });
  }
  if (!lifecycle.ok) {
    if (lifecycle.errorCode === "model_output_invalid" || lifecycle.errorCode === "quality_review_low") {
      return res.status(422).json({
        error: "task_resume_incomplete",
        hint: "The resumed task did not produce an accepted result. Review the updated task activity.",
      });
    }
    return res.status(500).json({
      error: "task_resume_failed",
      reason: "The task could not be resumed. Refresh the task activity for the current state.",
    });
  }
  return res.status(202).json(lifecycle.task);
});

// ── POST /api/ai/tasks/:taskId/execute ───────────────────────────────────────

router.post("/ai/tasks/:taskId/execute", async (req, res) => {
  const { taskId } = req.params;

  const [task] = await db
    .select()
    .from(tasksTable)
    .where(eq(tasksTable.id, taskId))
    .limit(1);
  if (!task) return res.status(404).json({ error: "Task not found" });

  const ownerProject = await loadProjectByIdForUser(task.projectId, req.userId, res);
  if (!ownerProject) return;

  if (!["pending", "queued", "verifying"].includes(task.status)) {
    return res
      .status(409)
      .json({ error: `Cannot AI-execute task with status "${task.status}"` });
  }

  const providerResolved = await requireProvider(req.userId, res, {
    qualityProfile: "task_execution",
  });
  if (!providerResolved) return;
  const { provider, apiKey } = providerResolved;

  const rlExecute = await checkProjectRateLimitDb(task.projectId);
  if (!rlExecute.allowed) {
    return res.status(429).json({
      error: `LLM rate limit exceeded — max ${LLM_RATE_LIMIT} calls per minute per project. Retry in ${rlExecute.retryAfterSec}s.`,
    });
  }

  let lifecycle: Awaited<ReturnType<typeof executeTaskLifecycle>>;
  try {
    lifecycle = await executeTaskLifecycle({
      taskId,
      userId: req.userId,
      provider: { provider, apiKey },
      trigger: "manual",
      expectedStatuses: [task.status as "pending" | "queued" | "verifying"],
      expectedRetryCount: task.retryCount,
      expectedCorrelationId: task.correlationId,
      expectedProjectUpdatedAt: ownerProject.updatedAt?.toISOString(),
    });
  } catch (error) {
    const [currentTask] = await db
      .select({ status: tasksTable.status })
      .from(tasksTable)
      .where(eq(tasksTable.id, taskId))
      .limit(1);
    if (
      currentTask?.status !== task.status ||
      (error instanceof Error && /state changed|concurrent|claim/i.test(error.message))
    ) {
      return res.status(409).json({
        error: "task_state_changed_concurrently",
        code: "TASK_STATE_CHANGED_CONCURRENTLY",
        hint: "The task changed while this execution was finishing; refresh the task before retrying.",
      });
    }
    throw error;
  }
  if (lifecycle.status === "conflict") {
    const retryResponse = respondWithTaskRetryGate(
      res,
      lifecycle.errorCode,
      lifecycle.retryAfterMs,
    );
    if (retryResponse) return retryResponse;
    return res.status(409).json({
      error: "task_state_changed_concurrently",
      code: "TASK_STATE_CHANGED_CONCURRENTLY",
      hint: "The task changed while this execution was starting; refresh the task and retry if needed.",
    });
  }
  if (!lifecycle.ok) {
    const [currentTask] = await db
      .select({ status: tasksTable.status })
      .from(tasksTable)
      .where(eq(tasksTable.id, taskId))
      .limit(1);
    if (currentTask?.status !== task.status) {
      return res.status(409).json({
        error: "task_state_changed_concurrently",
        code: "TASK_STATE_CHANGED_CONCURRENTLY",
        hint: "The task changed while this execution was finishing; refresh the task before retrying.",
      });
    }
    if (lifecycle.errorCode === "model_output_invalid") {
      return res.status(422).json({
        error: "model_output_invalid",
        code: "model_output_invalid",
        parseCode: lifecycle.parseCode,
        hint: "The AI model returned an unexpected response — try executing the task again.",
      });
    }
    if (lifecycle.errorCode === "quality_review_low") {
      return res.status(422).json({
        error: "quality_review_low",
        code: "QUALITY_REVIEW_LOW",
        hint: "The AI task result did not meet the quality checks required for completion — try executing the task again.",
      });
    }
    if (handleOrchestratorError(lifecycle.error, res, {
      projectId: task.projectId,
      operation: "task-execution",
      provider,
    })) return;
    if (lifecycle.errorCode === "context_build_failed") {
      return res.status(500).json({
        error: "Failed to build project context",
        hint: "Try executing the task again or refresh the project graph and metrics.",
      });
    }
    return res.status(500).json({
      error: lifecycle.errorCode ?? "task_execution_failed",
      reason: "The AI task could not be completed. Try again in a moment.",
    });
  }
  return res.status(202).json(lifecycle.task);
});

// ── scheduleAiTaskExecution ──────────────────────────────────────────────────

const TASK_AUTO_EXECUTION_REQUESTED_EVENT_TYPE = "TaskAutoExecutionDispatchRequested";
const TASK_AUTO_EXECUTION_DEFERRED_EVENT_TYPE = "TaskAutoExecutionDeferred";

type AiTaskExecutionOptions = {
  parentExecutionId?: string | null;
  delegationBudget?: Partial<ExecutionDelegationBudget>;
};

type DeferredAiTaskExecution = {
  userId: string;
  options?: AiTaskExecutionOptions;
};

function deferredTaskExecutionEventId(taskId: string): string {
  return `task-auto-execution-deferred:${taskId}`;
}

function parseDeferredAiTaskExecution(payload: unknown): DeferredAiTaskExecution | null {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) return null;
  const record = payload as Record<string, unknown>;
  if (typeof record.userId !== "string" || record.userId.length === 0) return null;
  const options: AiTaskExecutionOptions = {};
  if (record.parentExecutionId !== undefined) {
    if (record.parentExecutionId !== null && typeof record.parentExecutionId !== "string") return null;
    options.parentExecutionId = record.parentExecutionId;
  }
  if (record.delegationBudget !== undefined) {
    const budget = ExecutionDelegationBudgetSchema.partial().strict().safeParse(record.delegationBudget);
    if (!budget.success) return null;
    options.delegationBudget = budget.data;
  }
  return {
    userId: record.userId,
    ...(Object.keys(options).length > 0 ? { options } : {}),
  };
}

async function persistDeferredAiTaskExecution(
  taskId: string,
  userId: string,
  options?: AiTaskExecutionOptions,
): Promise<boolean> {
  const eventId = deferredTaskExecutionEventId(taskId);
  return db.transaction(async (tx) => {
    const [task] = await tx
      .select({
        projectId: tasksTable.projectId,
        status: tasksTable.status,
        prompt: tasksTable.prompt,
      })
      .from(tasksTable)
      .where(eq(tasksTable.id, taskId))
      .for("update")
      .limit(1);
    if (!task || task.status !== "verifying" || !task.prompt) return false;

    await tx.insert(eventsTable).values({
      id: eventId,
      type: TASK_AUTO_EXECUTION_REQUESTED_EVENT_TYPE,
      projectId: task.projectId,
      taskId,
      severity: "info",
      message: "Automatic AI task execution was requested.",
      payload: {
        userId,
        ...(options?.parentExecutionId !== undefined
          ? { parentExecutionId: options.parentExecutionId }
          : {}),
        ...(options?.delegationBudget !== undefined
          ? { delegationBudget: options.delegationBudget }
          : {}),
      },
    }).onConflictDoNothing();
    return true;
  });
}

async function clearDeferredAiTaskExecution(taskId: string): Promise<void> {
  await db.delete(eventsTable).where(eq(eventsTable.id, deferredTaskExecutionEventId(taskId)));
}

async function markDeferredAiTaskExecution(taskId: string): Promise<void> {
  await db.update(eventsTable)
    .set({
      type: TASK_AUTO_EXECUTION_DEFERRED_EVENT_TYPE,
      severity: "warning",
      message: "AI task execution was deferred because the worker queue is full.",
    })
    .where(eq(eventsTable.id, deferredTaskExecutionEventId(taskId)));
}

async function runAiTaskExecution(
  taskId: string,
  userId: string,
  options?: AiTaskExecutionOptions,
): Promise<void> {
  try {
    const [task] = await db
      .select()
      .from(tasksTable)
      .where(eq(tasksTable.id, taskId))
      .limit(1);

    if (!task || task.status !== "verifying" || !task.prompt) {
      await clearDeferredAiTaskExecution(taskId);
      logger.info(
        { taskId, status: task?.status ?? "gone", hasPrompt: !!task?.prompt },
        "AI auto-trigger: task no longer eligible — skipping",
      );
      return;
    }

    const resolved = await resolveProvider(userId, {
      qualityProfile: "task_execution",
    });
    if (!resolved) {
      logger.warn({ taskId }, "AI auto-trigger: no AI provider configured — task stays in verifying");
      await db.insert(eventsTable).values({
        id: randomUUID(),
        type: "TaskAutoTriggered",
        projectId: task.projectId,
        taskId,
        severity: "warning",
        message: `AI auto-trigger skipped for "${task.title}": no AI provider configured`,
        payload: { skipped: true, reason: "no_api_key" },
      });
      await clearDeferredAiTaskExecution(taskId);
      return;
    }
    const { provider, apiKey } = resolved;

    const rl = await checkProjectRateLimitDb(task.projectId);
    if (!rl.allowed) {
      logger.warn(
        { taskId, retryAfterSec: rl.retryAfterSec },
        "AI auto-trigger: rate limited — task stays in verifying",
      );
      await clearDeferredAiTaskExecution(taskId);
      return;
    }

    const lifecycle = await executeTaskLifecycle({
      taskId,
      userId,
      provider: { provider, apiKey },
      trigger: "automatic",
      expectedStatuses: ["verifying"],
      parentExecutionId: options?.parentExecutionId,
      delegationBudget: options?.delegationBudget,
    });
    if (lifecycle.status === "conflict") {
      await clearDeferredAiTaskExecution(taskId);
      logger.info({ taskId, reason: lifecycle.errorCode }, "AI auto-trigger: lifecycle claim skipped");
      return;
    }
    if (!lifecycle.ok) {
      await clearDeferredAiTaskExecution(taskId);
      logger.warn(
        { taskId, executionId: lifecycle.executionId, code: lifecycle.errorCode },
        "AI auto-trigger: lifecycle failed",
      );
    }
  } catch (err) {
    await clearDeferredAiTaskExecution(taskId).catch((clearError) => {
      logger.error({ err: clearError, taskId }, "AI auto-trigger: could not clear deferred dispatch intent");
    });
    logger.error({ err, taskId }, "AI auto-trigger: unhandled error in auto-execution job");
  }
}

/**
 * Persists dispatch intent before enqueuing an AI task execution job. Resolves
 * after durable intent and local enqueue, not after the AI execution finishes.
 */
const scheduledAiTaskCompletions = new Map<string, Promise<void>>();
const schedulingAiTaskExecutions = new Map<string, Promise<void>>();

export async function scheduleAiTaskExecution(
  taskId: string,
  userId: string,
  options?: AiTaskExecutionOptions,
): Promise<void> {
  const inFlightScheduling = schedulingAiTaskExecutions.get(taskId);
  if (inFlightScheduling) return inFlightScheduling;
  if (scheduledAiTaskCompletions.has(taskId)) return;

  let resolveCompletion!: () => void;
  const completion = new Promise<void>((resolve) => {
    resolveCompletion = resolve;
  });
  scheduledAiTaskCompletions.set(taskId, completion);

  let scheduling!: Promise<void>;
  scheduling = (async () => {
    try {
      // Persist the dispatch intent before attempting local enqueue. The event
      // remains until an atomic Task claim consumes it, covering both queue
      // backpressure and a process stop before the worker starts.
      const persisted = await persistDeferredAiTaskExecution(taskId, userId, options);
      if (!persisted) {
        resolveCompletion();
        scheduledAiTaskCompletions.delete(taskId);
        return;
      }

      // ID-based queue deduplication plus the DB Task claim protect repeated
      // calls in this process and dispatches from other API instances.
      const enqueueResult = heavyJobQueue.enqueueWithIdDetailed(taskId, async () => {
        try {
          await runAiTaskExecution(taskId, userId, options);
        } finally {
          resolveCompletion();
        }
      });
      if (enqueueResult !== "enqueued") {
        resolveCompletion();
        scheduledAiTaskCompletions.delete(taskId);
        if (enqueueResult === "full") {
          await markDeferredAiTaskExecution(taskId).catch((err) => {
            // The requested event remains a valid durable outbox entry even
            // if its user-facing deferred label cannot be updated.
            logger.error({ err, taskId }, "AI auto-trigger: could not label deferred dispatch intent");
          });
          logger.warn(
            { taskId },
            "AI task execution was deferred because the local worker queue is full",
          );
        }
        return;
      }

      void completion.finally(() => {
        scheduledAiTaskCompletions.delete(taskId);
      });
    } catch (err) {
      resolveCompletion();
      scheduledAiTaskCompletions.delete(taskId);
      logger.error({ err, taskId }, "AI auto-trigger: failed to persist dispatch intent");
      throw err;
    } finally {
      if (schedulingAiTaskExecutions.get(taskId) === scheduling) {
        schedulingAiTaskExecutions.delete(taskId);
      }
    }
  })();
  schedulingAiTaskExecutions.set(taskId, scheduling);
  await scheduling;
}

/**
 * Re-dispatch queue-full intents from the durable event outbox. The event is
 * removed in the same transaction that claims the Task, so a crash before
 * claim remains recoverable while an acquired task cannot be auto-run twice.
 */
export async function dispatchDeferredAiTaskExecutions(limit = 100): Promise<number> {
  const deferred = await db
    .select({
      taskId: eventsTable.taskId,
      payload: eventsTable.payload,
      status: tasksTable.status,
      prompt: tasksTable.prompt,
    })
    .from(eventsTable)
    .innerJoin(tasksTable, eq(eventsTable.taskId, tasksTable.id))
    .where(and(
      inArray(eventsTable.type, [
        TASK_AUTO_EXECUTION_REQUESTED_EVENT_TYPE,
        TASK_AUTO_EXECUTION_DEFERRED_EVENT_TYPE,
      ]),
      eq(tasksTable.status, "verifying"),
    ))
    .orderBy(eventsTable.timestamp, eventsTable.id)
    .limit(limit);

  let dispatched = 0;
  for (const intent of deferred) {
    if (!intent.taskId || !intent.prompt) {
      if (intent.taskId) await clearDeferredAiTaskExecution(intent.taskId);
      continue;
    }
    const parsed = parseDeferredAiTaskExecution(intent.payload);
    if (!parsed) {
      logger.warn({ taskId: intent.taskId }, "AI auto-trigger: invalid deferred dispatch intent discarded");
      await clearDeferredAiTaskExecution(intent.taskId);
      continue;
    }

    const before = scheduledAiTaskCompletions.size;
    await scheduleAiTaskExecution(intent.taskId, parsed.userId, parsed.options);
    if (scheduledAiTaskCompletions.size > before) dispatched++;
    if (heavyJobQueue.availablePendingCapacity === 0) break;
  }
  return dispatched;
}

/** Test/process-shutdown barrier for already scheduled task jobs. */
export async function waitForScheduledAiTaskExecutions(): Promise<void> {
  await Promise.allSettled([
    ...schedulingAiTaskExecutions.values(),
    ...scheduledAiTaskCompletions.values(),
  ]);
}

export default router;
