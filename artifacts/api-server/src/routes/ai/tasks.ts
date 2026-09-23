/**
 * AI task execution routes + auto-trigger scheduler.
 *
 * POST /api/ai/tasks/:taskId/execute
 * export scheduleAiTaskExecution
 */
import { Router } from "express";
import { randomUUID } from "crypto";
import { db } from "@workspace/db";
import {
  tasksTable,
  eventsTable,
  aiExecutionsTable,
  aiExecutionAcceptancesTable,
} from "@workspace/db";
import { eq, and, desc, inArray } from "drizzle-orm";
import { logger } from "../../lib/logger.js";
import { loadProjectByIdForUser } from "../../middlewares/requireProjectAccess.js";
import { checkProjectRateLimitDb, LLM_RATE_LIMIT } from "../../lib/db-rate-limiter.js";
import { heavyJobQueue } from "../../lib/job-queue.js";
import {
  requireProvider,
  resolveProvider,
  handleOrchestratorError,
} from "../../lib/ai-route-helpers.js";
import { executeTaskLifecycle } from "../../lib/task-execution-service.js";
import { recoverAiExecutionResumeToken } from "../../lib/ai-execution-state.js";
import type { ExecutionDelegationBudget } from "../../lib/execution-lineage.js";

const router = Router();

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
  if (!["pending", "queued", "verifying"].includes(task.status)) {
    return res.status(409).json({
      error: "task_not_resumable",
      hint: "Refresh the task and use the current server-provided next action.",
    });
  }

  const [execution] = await db
    .select({
      id: aiExecutionsTable.id,
      attempt: aiExecutionsTable.attempt,
    })
    .from(aiExecutionsTable)
    .where(and(
      eq(aiExecutionsTable.linkedTaskId, task.id),
      eq(aiExecutionsTable.projectId, task.projectId),
      eq(aiExecutionsTable.userId, req.userId),
      inArray(aiExecutionsTable.status, ["paused", "failed"]),
    ))
    .orderBy(desc(aiExecutionsTable.attempt), desc(aiExecutionsTable.updatedAt), desc(aiExecutionsTable.id))
    .limit(1);
  if (!execution) {
    return res.status(409).json({
      error: "task_not_resumable",
      hint: "The task has no current recoverable execution.",
    });
  }

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

  const recovered = await recoverAiExecutionResumeToken({
    executionId: execution.id,
    userId: req.userId,
    linkedTaskId: task.id,
    expectedAttempt: execution.attempt,
  });
  if (!recovered) {
    return res.status(409).json({
      error: "task_state_changed_concurrently",
      hint: "The task changed while resume was being authorized; refresh before trying again.",
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
      workspaceRevision: ownerProject.updatedAt?.toISOString(),
      resumeExecutionId: execution.id,
      resumeToken: recovered.resumeToken,
    });
  } catch (error) {
    logger.error({ err: error, taskId }, "task resume lifecycle failed");
    return res.status(500).json({
      error: "task_resume_failed",
      reason: "The task could not be resumed. Refresh the task activity for the current state.",
    });
  }
  if (lifecycle.status === "conflict") {
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
      workspaceRevision: ownerProject.updatedAt?.toISOString(),
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

/**
 * Schedules an AI task execution job for a task that just entered `verifying`
 * status with a non-null prompt. Fire-and-forget: enqueued into the shared
 * heavyJobQueue so it never blocks the caller's HTTP response.
 */
const scheduledAiTaskCompletions = new Map<string, Promise<void>>();

export function scheduleAiTaskExecution(
  taskId: string,
  userId: string,
  options?: {
    parentExecutionId?: string | null;
    delegationBudget?: Partial<ExecutionDelegationBudget>;
  },
): void {
  if (scheduledAiTaskCompletions.has(taskId)) return;
  let resolveCompletion!: () => void;
  const completion = new Promise<void>((resolve) => {
    resolveCompletion = resolve;
  });
  scheduledAiTaskCompletions.set(taskId, completion);
  // PR-D1: use enqueueWithId so concurrent calls for the same task (e.g.
  // from auto-trigger and a manual retry at the same moment) don't stack up
  // two closures and execute the AI agent twice for the same task ID.
  const enqueued = heavyJobQueue.enqueueWithId(taskId, async () => {
    try {
      const [task] = await db
        .select()
        .from(tasksTable)
        .where(eq(tasksTable.id, taskId))
        .limit(1);

      if (!task || task.status !== "verifying" || !task.prompt) {
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
        return;
      }
      const { provider, apiKey } = resolved;

      const rl = await checkProjectRateLimitDb(task.projectId);
      if (!rl.allowed) {
        logger.warn(
          { taskId, retryAfterSec: rl.retryAfterSec },
          "AI auto-trigger: rate limited — task stays in verifying",
        );
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
        logger.info({ taskId, reason: lifecycle.errorCode }, "AI auto-trigger: lifecycle claim skipped");
        return;
      }
      if (!lifecycle.ok) {
        logger.warn({ taskId, executionId: lifecycle.executionId, code: lifecycle.errorCode }, "AI auto-trigger: lifecycle failed");
        return;
      }
      return;
    } catch (err) {
      logger.error({ err, taskId }, "AI auto-trigger: unhandled error in auto-execution job");
    } finally {
      resolveCompletion();
    }
  });
  if (!enqueued) {
    resolveCompletion();
    scheduledAiTaskCompletions.delete(taskId);
  } else {
    void completion.finally(() => {
      scheduledAiTaskCompletions.delete(taskId);
    });
  }
}

/** Test/process-shutdown barrier for already scheduled task jobs. */
export async function waitForScheduledAiTaskExecutions(): Promise<void> {
  await Promise.allSettled([...scheduledAiTaskCompletions.values()]);
}

export default router;
