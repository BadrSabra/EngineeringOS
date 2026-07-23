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
  taskLogsTable,
  eventsTable,
} from "@workspace/db";
import { eq, and } from "drizzle-orm";
import {
  buildProjectContext,
  invalidateContextCache,
  executeTask,
} from "@workspace/ai-orchestrator";
import { recordAudit } from "../../lib/audit.js";
import { logger } from "../../lib/logger.js";
import { loadProjectByIdForUser } from "../../middlewares/requireProjectAccess.js";
import { checkProjectRateLimitDb, LLM_RATE_LIMIT } from "../../lib/db-rate-limiter.js";
import { heavyJobQueue } from "../../lib/job-queue.js";
import {
  requireProvider,
  resolveProvider,
  handleOrchestratorError,
} from "../../lib/ai-route-helpers.js";

const router = Router();

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

  const providerResolved = await requireProvider(req.userId, res);
  if (!providerResolved) return;
  const { provider, apiKey } = providerResolved;

  const rlExecute = await checkProjectRateLimitDb(task.projectId);
  if (!rlExecute.allowed) {
    return res.status(429).json({
      error: `LLM rate limit exceeded — max ${LLM_RATE_LIMIT} calls per minute per project. Retry in ${rlExecute.retryAfterSec}s.`,
    });
  }

  const correlationId = randomUUID();
  const now = new Date();

  const [claimed] = await db
    .update(tasksTable)
    .set({ status: "running", updatedAt: now })
    .where(
      and(
        eq(tasksTable.id, taskId),
        eq(tasksTable.status, task.status),
      ),
    )
    .returning();
  if (!claimed) return res.status(409).json({ error: "Task state changed concurrently" });

  await db.insert(taskLogsTable).values({
    id: randomUUID(),
    taskId,
    level: "info",
    message: "AI agent execution started",
    metadata: { correlationId },
    correlationId,
  });

  const projectContext = await buildProjectContext(task.projectId);

  let agentResult: Awaited<ReturnType<typeof executeTask>>;
  try {
    agentResult = await executeTask({
      taskTitle: task.title,
      taskDescription: task.description,
      taskPrompt: task.prompt,
      taskPriority: task.priority,
      relatedFiles: (task.relatedFiles as string[]) ?? [],
      projectContext,
      apiKey,
      provider,
    });
  } catch (err) {
    await db
      .update(tasksTable)
      .set({ status: task.status, updatedAt: new Date() })
      .where(eq(tasksTable.id, taskId));
    await db.insert(taskLogsTable).values({
      id: randomUUID(),
      taskId,
      level: "error",
      message: err instanceof Error ? err.message : String(err),
      metadata: { error: String(err), correlationId },
      correlationId,
    });
    if (handleOrchestratorError(err, res, { projectId: task.projectId, operation: "task-execution", provider })) return;
    throw err;
  }

  if (agentResult._parseError) {
    await db
      .update(tasksTable)
      .set({ status: task.status, updatedAt: new Date() })
      .where(eq(tasksTable.id, taskId));
    await db.insert(taskLogsTable).values({
      id: randomUUID(),
      taskId,
      level: "error",
      message: `AI agent parse failure [${agentResult._parseError.code}]: ${agentResult._parseError.message}`,
      metadata: { parseError: agentResult._parseError, correlationId },
      correlationId,
    });
    return res.status(422).json({
      error: "model_output_invalid",
      code: "model_output_invalid",
      hint: "The AI model returned an unexpected response — try executing the task again.",
      raw: agentResult._parseError.raw.slice(0, 500),
      parseCode: agentResult._parseError.code,
    });
  }

  invalidateContextCache(task.projectId);

  const finalStatus = agentResult.needsHumanReview ? "verifying" : "completed";
  const agentResponseText = JSON.stringify(agentResult, null, 2);

  const [updated] = await db
    .update(tasksTable)
    .set({
      status: finalStatus,
      agentResponse: agentResponseText,
      verificationResult: {
        passed: !agentResult.needsHumanReview,
        steps: agentResult.steps.map((s: string) => ({
          name: s,
          passed: !agentResult.needsHumanReview,
        })),
      },
      updatedAt: new Date(),
      completedAt: finalStatus === "completed" ? new Date() : null,
    })
    .where(eq(tasksTable.id, taskId))
    .returning();

  await db.insert(taskLogsTable).values({
    id: randomUUID(),
    taskId,
    level: finalStatus === "completed" ? "info" : "warn",
    message: `AI agent: ${agentResult.summary} (confidence: ${agentResult.confidence})`,
    metadata: { agentResult, correlationId },
    correlationId,
  });

  await db.insert(eventsTable).values({
    id: randomUUID(),
    type: finalStatus === "completed" ? "TaskCompleted" : "TaskVerifying",
    projectId: task.projectId,
    taskId,
    severity: finalStatus === "completed" ? "success" : "warning",
    message: `AI executed "${task.title}" → ${finalStatus} (${agentResult.confidence} confidence)`,
    correlationId,
  });

  await recordAudit({
    entityType: "task",
    entityId: taskId,
    action: "ai_executed",
    projectId: task.projectId,
    stateBefore: { status: task.status },
    stateAfter: { status: finalStatus },
    correlationId,
  });

  return res.status(202).json(updated);
});

// ── scheduleAiTaskExecution ──────────────────────────────────────────────────

/**
 * Schedules an AI task execution job for a task that just entered `verifying`
 * status with a non-null prompt. Fire-and-forget: enqueued into the shared
 * heavyJobQueue so it never blocks the caller's HTTP response.
 */
export function scheduleAiTaskExecution(taskId: string, userId: string): void {
  // PR-D1: use enqueueWithId so concurrent calls for the same task (e.g.
  // from auto-trigger and a manual retry at the same moment) don't stack up
  // two closures and execute the AI agent twice for the same task ID.
  heavyJobQueue.enqueueWithId(taskId, async () => {
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

      const resolved = await resolveProvider(userId);
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

      const correlationId = randomUUID();

      // Claim the task first — write the event only after the claim succeeds to
      // avoid a phantom "triggered" log entry when a concurrent state change wins.
      const [claimed] = await db
        .update(tasksTable)
        .set({ status: "running", updatedAt: new Date() })
        .where(and(eq(tasksTable.id, taskId), eq(tasksTable.status, "verifying")))
        .returning();
      if (!claimed) {
        logger.info({ taskId }, "AI auto-trigger: concurrent state change won the claim — skipping");
        return;
      }

      await db.insert(eventsTable).values({
        id: randomUUID(),
        type: "TaskAutoTriggered",
        projectId: task.projectId,
        taskId,
        severity: "info",
        message: `AI auto-execution triggered for "${task.title}"`,
        correlationId,
        payload: { trigger: "verifying_state", before: { status: "verifying" }, after: { status: "running" } },
      });

      await db.insert(taskLogsTable).values({
        id: randomUUID(),
        taskId,
        level: "info",
        message: "AI auto-execution started (triggered by verifying state transition)",
        correlationId,
      });

      const projectContext = await buildProjectContext(task.projectId);

      let agentResult: Awaited<ReturnType<typeof executeTask>>;
      try {
        agentResult = await executeTask({
          taskTitle: task.title,
          taskDescription: task.description,
          taskPrompt: task.prompt,
          taskPriority: task.priority,
          relatedFiles: (task.relatedFiles as string[]) ?? [],
          projectContext,
          apiKey,
          provider,
        });
      } catch (execErr) {
        await db
          .update(tasksTable)
          .set({ status: "verifying", updatedAt: new Date() })
          .where(and(eq(tasksTable.id, taskId), eq(tasksTable.status, "running")));
        await db.insert(taskLogsTable).values({
          id: randomUUID(),
          taskId,
          level: "error",
          message: `AI auto-execution failed: ${execErr instanceof Error ? execErr.message : String(execErr)}`,
          correlationId,
        });
        throw execErr;
      }

      invalidateContextCache(task.projectId);

      const autoFinalStatus = agentResult.needsHumanReview ? "verifying" : "completed";

      await db
        .update(tasksTable)
        .set({
          status: autoFinalStatus,
          agentResponse: JSON.stringify(agentResult, null, 2),
          verificationResult: {
            passed: !agentResult.needsHumanReview,
            steps: agentResult.steps.map((s: string) => ({
              name: s,
              passed: !agentResult.needsHumanReview,
            })),
          },
          updatedAt: new Date(),
          completedAt: autoFinalStatus === "completed" ? new Date() : null,
        })
        .where(eq(tasksTable.id, taskId));

      await db.insert(taskLogsTable).values({
        id: randomUUID(),
        taskId,
        level: autoFinalStatus === "completed" ? "info" : "warn",
        message: `AI auto-execution: ${agentResult.summary} (confidence: ${agentResult.confidence})`,
        metadata: { agentResult, correlationId },
        correlationId,
      });

      await db.insert(eventsTable).values({
        id: randomUUID(),
        type: autoFinalStatus === "completed" ? "TaskCompleted" : "TaskVerifying",
        projectId: task.projectId,
        taskId,
        severity: autoFinalStatus === "completed" ? "success" : "warning",
        message: `AI auto-executed "${task.title}" → ${autoFinalStatus} (${agentResult.confidence} confidence)`,
        correlationId,
        payload: { before: { status: "running" }, after: { status: autoFinalStatus } },
      });

      await recordAudit({
        entityType: "task",
        entityId: taskId,
        action: "ai_auto_executed",
        projectId: task.projectId,
        stateBefore: { status: "verifying" },
        stateAfter: { status: autoFinalStatus },
        correlationId,
      });
    } catch (err) {
      logger.error({ err, taskId }, "AI auto-trigger: unhandled error in auto-execution job");
    }
  });
}

export default router;
