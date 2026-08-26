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
  runAgentWithFallback,
} from "../../lib/ai-route-helpers.js";
import { executeTaskLifecycle } from "../../lib/task-execution-service.js";
import { buildRuleVerificationChecks } from "../../lib/remediation-plan.js";

const router = Router();

class TaskStateConflictError extends Error {}

function pendingPlanVerificationSteps(
  plan: typeof tasksTable.$inferSelect["remediationPlan"],
) {
  if (!plan) return [];
  const checks = plan.verificationChecks?.length
    ? plan.verificationChecks
    : buildRuleVerificationChecks(plan.verificationSteps ?? []);
  return checks.map((check) => ({
    id: check.id,
    name: `Rule verification ${check.id.replace("rule-verification-", "#")}`,
    kind: check.kind,
    guidance: check.guidance,
    passed: false,
    output: "Not recorded — operator evidence is required",
  }));
}

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

  let projectContext: Awaited<ReturnType<typeof buildProjectContext>>;
  try {
    projectContext = await buildProjectContext(task.projectId, {
      sections: ["tasks", "metrics", "graphEntities", "graphRelationships", "events"],
    });
  } catch (err) {
    logger.error({ err, taskId, correlationId }, "AI execution failed while building project context");
    const [rolledBack] = await db
      .update(tasksTable)
      .set({ status: task.status, updatedAt: new Date() })
      .where(and(eq(tasksTable.id, taskId), eq(tasksTable.status, "running")))
      .returning();
    if (!rolledBack) {
      logger.warn({ taskId, correlationId }, "AI execution failed, but task state changed concurrently — rollback skipped");
    }
    await db.insert(taskLogsTable).values({
      id: randomUUID(),
      taskId,
      level: "error",
      message: "AI execution failed while building project context",
      metadata: { stage: "buildProjectContext", correlationId },
      correlationId,
    });
    if (handleOrchestratorError(err, res, { projectId: task.projectId, operation: "task-execution", provider })) return;
    return res.status(500).json({
      error: "Failed to build project context",
      hint: "Try executing the task again or refresh the project graph and metrics.",
    });
  }

  await db.insert(taskLogsTable).values({
    id: randomUUID(),
    taskId,
    level: "info",
    message: "Built project context — calling AI agent…",
    metadata: { stage: "buildProjectContext", correlationId },
    correlationId,
  });

  const writeProgress = async (msg: string) => {
    try {
      await db.insert(taskLogsTable).values({
        id: randomUUID(),
        taskId,
        level: "info",
        message: msg,
        metadata: { stage: "progress", correlationId },
        correlationId,
      });
    } catch { /* swallow — progress logs are best-effort */ }
  };

  let agentResult: Awaited<ReturnType<typeof executeTask>>;
  let effectiveProvider = provider;
  try {
    ({ result: agentResult, effectiveProvider } = await runAgentWithFallback(
      req.userId,
      { provider, apiKey },
      (opts) => executeTask({
        taskTitle: task.title,
        taskDescription: task.description,
        taskPrompt: task.prompt,
        taskPriority: task.priority,
        relatedFiles: (task.relatedFiles as string[]) ?? [],
        remediationPlan: task.remediationPlan ?? null,
        projectContext,
        ...opts,
      }, { onProgress: writeProgress }),
      { qualityProfile: "task_execution" },
    ));
  } catch (err) {
    logger.error({ err, taskId, correlationId }, "AI execution failed while running agent");

    const [execRolledBack] = await db
      .update(tasksTable)
      .set({ status: task.status, updatedAt: new Date() })
      .where(and(eq(tasksTable.id, taskId), eq(tasksTable.status, "running")))
      .returning();
    if (!execRolledBack) {
      logger.warn({ taskId, correlationId }, "AI execution failed, but task state changed concurrently — rollback skipped");
    }

    await db.insert(taskLogsTable).values({
      id: randomUUID(),
      taskId,
      level: "error",
      message: "AI execution failed while running agent",
      metadata: { stage: "runAgentWithFallback", correlationId },
      correlationId,
    });

    await db.insert(eventsTable).values({
      id: randomUUID(),
      type: "TaskExecutionFailed",
      projectId: task.projectId,
      taskId,
      severity: "error",
      message: `AI execution of "${task.title}" failed`,
      correlationId,
      payload: { status: task.status },
    });

    await recordAudit({
      entityType: "task",
      entityId: taskId,
      action: "execution_failed",
      projectId: task.projectId,
      stateBefore: { status: "running" },
      stateAfter: { status: task.status },
      correlationId,
    });

    invalidateContextCache(task.projectId);

    if (handleOrchestratorError(err, res, { projectId: task.projectId, operation: "task-execution", provider: effectiveProvider })) return;
    return res.status(500).json({
      error: "task_execution_failed",
      reason: "The AI task could not be completed. Try again in a moment.",
    });
  }

  if (agentResult._parseError) {
    const parseError = agentResult._parseError;
    const [parsedRolledBack] = await db
      .update(tasksTable)
      .set({ status: task.status, updatedAt: new Date() })
      .where(and(eq(tasksTable.id, taskId), eq(tasksTable.status, "running")))
      .returning();
    if (!parsedRolledBack) {
      logger.warn({ taskId, correlationId }, "AI parse failure occurred, but task state changed concurrently — rollback skipped");
    }
    await db.insert(taskLogsTable).values({
      id: randomUUID(),
      taskId,
      level: "error",
      message: `AI agent parse failure [${parseError!.code}]`,
      metadata: { parseCode: parseError!.code, correlationId },
      correlationId,
    });
    logger.error(
      { err: agentResult._parseError, taskId, correlationId },
      "AI agent output parsing failed",
    );
    return res.status(422).json({
      error: "model_output_invalid",
      code: "model_output_invalid",
      hint: "The AI model returned an unexpected response — try executing the task again.",
      parseCode: parseError!.code,
    });
  }

  invalidateContextCache(task.projectId);

  // A model response is not explicit remediation verification. Keep
  // rule-backed tasks reviewable until the verification endpoint passes.
  const finalStatus =
    agentResult.needsHumanReview || task.remediationPlan ? "verifying" : "completed";
  const agentResponseText = JSON.stringify(agentResult, null, 2);

  let updated: typeof tasksTable.$inferSelect;
  try {
    [updated] = await db.transaction(async (tx) => {
      const [row] = await tx
        .update(tasksTable)
        .set({
          status: finalStatus,
          agentResponse: agentResponseText,
          verificationResult: {
            passed: !agentResult.needsHumanReview && !task.remediationPlan,
            decision: agentResult.needsHumanReview || task.remediationPlan
              ? ("incomplete" as const)
              : ("verified" as const),
            steps: [
              ...agentResult.steps.map((s: string) => ({
                name: s,
                ...(task.remediationPlan ? {} : { kind: "automatic" as const }),
                passed: !agentResult.needsHumanReview && !task.remediationPlan,
              })),
              ...pendingPlanVerificationSteps(task.remediationPlan),
            ],
          },
          updatedAt: new Date(),
          completedAt: finalStatus === "completed" ? new Date() : null,
        })
        .where(and(eq(tasksTable.id, taskId), eq(tasksTable.status, "running")))
        .returning();
      if (!row) {
        throw new TaskStateConflictError("Task state changed before execution results could be finalized");
      }

      await tx.insert(taskLogsTable).values({
        id: randomUUID(),
        taskId,
        level: finalStatus === "completed" ? "info" : "warn",
        message: `AI agent: ${agentResult.summary} (confidence: ${agentResult.confidence})`,
        metadata: { agentResult, correlationId },
        correlationId,
      });

      await tx.insert(eventsTable).values({
        id: randomUUID(),
        type: finalStatus === "completed" ? "TaskCompleted" : "TaskVerifying",
        projectId: task.projectId,
        taskId,
        severity: finalStatus === "completed" ? "success" : "warning",
        message: `AI executed "${task.title}" → ${finalStatus} (${agentResult.confidence} confidence)`,
        correlationId,
      });

      return [row];
    });
  } catch (err) {
    if (err instanceof TaskStateConflictError) {
      logger.warn({ taskId, finalStatus }, "task execution finalization skipped due to concurrent state change");
      return res.status(409).json({ error: "task_state_changed_concurrently" });
    }
    throw err;
  }

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

      let projectContext: Awaited<ReturnType<typeof buildProjectContext>>;
      try {
        projectContext = await buildProjectContext(task.projectId, {
          sections: ["tasks", "metrics", "graphEntities", "graphRelationships", "events"],
        });
      } catch (execErr) {
        logger.error({ err: execErr, taskId, correlationId }, "AI auto-execution failed while building context");
        const [ctxRolledBack] = await db
          .update(tasksTable)
          .set({ status: "verifying", updatedAt: new Date() })
          .where(and(eq(tasksTable.id, taskId), eq(tasksTable.status, "running")))
          .returning();
        if (!ctxRolledBack) {
          logger.warn({ taskId, correlationId }, "AI auto-execution failed, but task state changed concurrently — rollback skipped");
        }
        await db.insert(taskLogsTable).values({
          id: randomUUID(),
          taskId,
          level: "error",
          message: "AI auto-execution failed while building context",
          correlationId,
        });
        throw execErr;
      }

      await db.insert(taskLogsTable).values({
        id: randomUUID(),
        taskId,
        level: "info",
        message: "Built project context — calling AI agent…",
        correlationId,
      });

      const writeAutoProgress = async (msg: string) => {
        try {
          await db.insert(taskLogsTable).values({
            id: randomUUID(),
            taskId,
            level: "info",
            message: msg,
            metadata: { stage: "progress", correlationId },
            correlationId,
          });
        } catch { /* best-effort */ }
      };

      let agentResult: Awaited<ReturnType<typeof executeTask>>;
      try {
        ({ result: agentResult } = await runAgentWithFallback(
          userId,
          { provider, apiKey },
          (opts) => executeTask({
            taskTitle: task.title,
            taskDescription: task.description,
            taskPrompt: task.prompt,
            taskPriority: task.priority,
            relatedFiles: (task.relatedFiles as string[]) ?? [],
            remediationPlan: task.remediationPlan ?? null,
            projectContext,
            ...opts,
          }, { onProgress: writeAutoProgress }),
          { qualityProfile: "task_execution" },
        ));
      } catch (execErr) {
        logger.error({ err: execErr, taskId, correlationId }, "AI auto-execution failed");

        const [autoRolledBack] = await db
          .update(tasksTable)
          .set({ status: "verifying", updatedAt: new Date() })
          .where(and(eq(tasksTable.id, taskId), eq(tasksTable.status, "running")))
          .returning();
        if (!autoRolledBack) {
          logger.warn({ taskId, correlationId }, "AI auto-execution failed, but task state changed concurrently — rollback skipped");
        }

        await db.insert(taskLogsTable).values({
          id: randomUUID(),
          taskId,
          level: "error",
          message: "AI auto-execution failed",
          correlationId,
        });

        await db.insert(eventsTable).values({
          id: randomUUID(),
          type: "TaskAutoExecutionFailed",
          projectId: task.projectId,
          taskId,
          severity: "error",
          message: `AI auto-execution of "${task.title}" failed`,
          correlationId,
          payload: { status: "verifying" },
        });

        await recordAudit({
          entityType: "task",
          entityId: taskId,
          action: "ai_auto_execution_failed",
          projectId: task.projectId,
          stateBefore: { status: "running" },
          stateAfter: { status: "verifying" },
          correlationId,
        });

        invalidateContextCache(task.projectId);
        throw execErr;
      }

      if (agentResult._parseError) {
        const parseError = agentResult._parseError;
        const [parseRolledBack] = await db
          .update(tasksTable)
          .set({ status: "verifying", updatedAt: new Date() })
          .where(and(eq(tasksTable.id, taskId), eq(tasksTable.status, "running")))
          .returning();
        if (!parseRolledBack) {
          logger.warn({ taskId, correlationId }, "AI auto-execution parse failure occurred, but task state changed concurrently — rollback skipped");
        }

        await db.insert(taskLogsTable).values({
          id: randomUUID(),
          taskId,
          level: "error",
          message: `AI auto-execution parse failure [${parseError!.code}]`,
          metadata: { parseCode: parseError!.code, correlationId },
          correlationId,
        });
        logger.error(
          { err: agentResult._parseError, taskId, correlationId },
          "AI auto-execution output parsing failed",
        );
        await db.insert(eventsTable).values({
          id: randomUUID(),
          type: "TaskAutoExecutionFailed",
          projectId: task.projectId,
          taskId,
          severity: "error",
          message: `AI auto-execution of "${task.title}" failed`,
          correlationId,
          payload: { status: "verifying", code: "model_output_invalid" },
        });
        await recordAudit({
          entityType: "task",
          entityId: taskId,
          action: "ai_auto_execution_failed",
          projectId: task.projectId,
          stateBefore: { status: "running" },
          stateAfter: { status: "verifying" },
          correlationId,
        });
        invalidateContextCache(task.projectId);
        return;
      }

      invalidateContextCache(task.projectId);

      const autoFinalStatus =
        agentResult.needsHumanReview || task.remediationPlan ? "verifying" : "completed";

      const [finalized] = await db
        .update(tasksTable)
        .set({
          status: autoFinalStatus,
          agentResponse: JSON.stringify(agentResult, null, 2),
          verificationResult: {
            passed: !agentResult.needsHumanReview,
            decision: agentResult.needsHumanReview
              || task.remediationPlan
              ? ("incomplete" as const)
              : ("verified" as const),
            steps: agentResult.steps.map((s: string) => ({
              name: s,
              ...(!task.remediationPlan ? { kind: "automatic" as const } : {}),
              passed: !agentResult.needsHumanReview && !task.remediationPlan,
            })),
          },
          updatedAt: new Date(),
          completedAt: autoFinalStatus === "completed" ? new Date() : null,
        })
        .where(and(eq(tasksTable.id, taskId), eq(tasksTable.status, "running")))
        .returning();

      if (!finalized) {
        logger.warn({ taskId, correlationId }, "AI auto-execution finished but task state changed concurrently — skipping final write");
        await db.insert(taskLogsTable).values({
          id: randomUUID(),
          taskId,
          level: "warn",
          message: "AI auto-execution finished but the task changed concurrently; final result was not persisted",
          metadata: { agentResult, correlationId },
          correlationId,
        });
        await db.insert(eventsTable).values({
          id: randomUUID(),
          type: "TaskExecutionConflict",
          projectId: task.projectId,
          taskId,
          severity: "warning",
          message: `AI auto-execution finished for "${task.title}" but the task state changed concurrently`,
          correlationId,
          payload: { expectedStatus: "running", attemptedStatus: autoFinalStatus },
        });
        return;
      }

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
