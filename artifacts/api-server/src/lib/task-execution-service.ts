import { randomUUID } from "node:crypto";
import { and, eq, inArray } from "drizzle-orm";
import {
  db,
  eventsTable,
  taskLogsTable,
  tasksTable,
} from "@workspace/db";
import {
  buildProjectContext,
  executeTask,
  invalidateContextCache,
} from "@workspace/ai-orchestrator";
import {
  createAiExecution,
  checkpointAiExecution,
  claimAiExecution,
  completeAiExecution,
  failAiExecution,
  heartbeatAiExecution,
  AI_EXECUTION_LEASE_MS,
} from "./ai-execution-state.js";
import { runAgentWithFallback } from "./ai-route-helpers.js";
import type { ProviderId } from "./ai-route-helpers.js";
import { recordAudit } from "./audit.js";
import { logger } from "./logger.js";

const CONTEXT_SECTIONS = ["tasks", "metrics", "graphEntities", "graphRelationships", "events"] as const;

export type TaskExecutionTrigger = "manual" | "automatic" | "reconciliation";
export type TaskExecutionOutcome = {
  ok: boolean;
  status: "completed" | "verifying" | "failed" | "conflict";
  task?: typeof tasksTable.$inferSelect;
  executionId?: string;
  errorCode?: string;
  parseCode?: string;
  error?: unknown;
};

type Provider = { provider: ProviderId; apiKey: string };

function safeError(error: unknown): string {
  return error instanceof Error ? error.message.slice(0, 500) : "AI task execution failed";
}

function receipt(result: Awaited<ReturnType<typeof executeTask>>) {
  return {
    kind: "AI_TASK_EXECUTION_RECEIPT",
    summary: result.summary.slice(0, 2000),
    confidence: result.confidence,
    needsHumanReview: result.needsHumanReview,
    steps: result.steps.slice(0, 24).map((step) => String(step).slice(0, 500)),
    verified: !result.needsHumanReview,
  };
}

/**
 * The single task execution state machine used by HTTP and queue callers.
 * The queue is only a concurrency limiter; ai_executions and the task lease
 * are the source of truth for ownership and recovery.
 */
export async function executeTaskLifecycle(params: {
  taskId: string;
  userId: string;
  provider: Provider;
  trigger: TaskExecutionTrigger;
  expectedStatuses?: Array<"pending" | "queued" | "verifying">;
  workspaceRevision?: string;
}): Promise<TaskExecutionOutcome> {
  const [before] = await db.select().from(tasksTable).where(eq(tasksTable.id, params.taskId)).limit(1);
  if (!before) return { ok: false, status: "conflict", errorCode: "task_not_found" };
  const allowed = params.expectedStatuses ?? ["pending", "queued", "verifying"];
  const correlationId = randomUUID();
  const workerId = `task-worker:${randomUUID()}`;
  const idempotencyKey = `${before.id}:attempt:${before.retryCount}`;
  const request = {
    projectId: before.projectId,
    message: before.prompt ?? before.title,
    modelMessage: before.prompt ?? before.title,
    workspaceRevision: params.workspaceRevision,
    linkedTaskId: before.id,
    correlationId,
    attempt: before.retryCount,
    validationTargetPaths: Array.isArray(before.relatedFiles) ? before.relatedFiles : [],
  };
  let stage = "claim";

  const durable = await createAiExecution({
    userId: params.userId,
    request,
    idempotencyKey,
    correlationId,
    attempt: before.retryCount,
    projectId: before.projectId,
    linkedTaskId: before.id,
  });
  const executionId = durable.execution.id;
  const claimedExecution = durable.created
    ? await claimAiExecution({ executionId, userId: params.userId, workerId })
    : durable.execution.status === "running"
      ? undefined
      : await claimAiExecution({ executionId, userId: params.userId, workerId });
  if (!claimedExecution) {
    return { ok: false, status: "conflict", executionId, errorCode: "execution_already_claimed" };
  }

  const [claimedTask] = await db.update(tasksTable)
    .set({
      status: "running",
      workerId,
      leaseUntil: new Date(Date.now() + AI_EXECUTION_LEASE_MS),
      lastHeartbeatAt: new Date(),
      correlationId,
      idempotencyKey,
      updatedAt: new Date(),
    })
    .where(and(eq(tasksTable.id, before.id), inArray(tasksTable.status, allowed)))
    .returning();
  if (!claimedTask) {
    await failAiExecution({ executionId, workerId, error: "Task state changed before claim." });
    return { ok: false, status: "conflict", executionId, errorCode: "task_state_changed" };
  }

  const log = async (level: "info" | "warn" | "error", message: string, metadata?: Record<string, unknown>) => {
    await db.insert(taskLogsTable).values({
      id: randomUUID(), taskId: before.id, level, message,
      metadata: metadata ? { ...metadata, executionId, trigger: params.trigger } : { executionId, trigger: params.trigger },
      correlationId,
    }).catch((error) => logger.warn({ error, taskId: before.id }, "task execution log write failed"));
  };
  await log("info", "AI task execution claimed", { stage: "claim", workerId });
  await checkpointAiExecution({
    executionId, workerId,
    checkpoint: { stage: "running", sequence: 1, detail: "Task claimed.", updatedAt: new Date().toISOString() },
  });
  const heartbeat = setInterval(() => {
    void heartbeatAiExecution({ executionId, workerId });
    void db.update(tasksTable).set({
      leaseUntil: new Date(Date.now() + AI_EXECUTION_LEASE_MS),
      lastHeartbeatAt: new Date(),
      updatedAt: new Date(),
    }).where(and(
      eq(tasksTable.id, before.id),
      eq(tasksTable.workerId, workerId),
      eq(tasksTable.status, "running"),
    ));
  }, Math.max(1_000, Math.floor(AI_EXECUTION_LEASE_MS / 3)));

  try {
    stage = "context";
    await log("info", "Building project context", { stage: "context" });
    const projectContext = await buildProjectContext(before.projectId, { sections: [...CONTEXT_SECTIONS] });
    await checkpointAiExecution({
      executionId, workerId,
      checkpoint: { stage: "model_call", sequence: 2, detail: "Project context built.", updatedAt: new Date().toISOString() },
    });
    const progress = async (message: string) => log("info", message, { stage: "progress" });
    stage = "provider_call";
    const { result } = await runAgentWithFallback<Awaited<ReturnType<typeof executeTask>>>(
      params.userId,
      params.provider,
      (opts) => executeTask({
        taskTitle: before.title,
        taskDescription: before.description,
        taskPrompt: before.prompt,
        taskPriority: before.priority,
        relatedFiles: before.relatedFiles ?? [],
        projectContext,
        ...opts,
      }, { onProgress: progress }),
      { qualityProfile: "task_execution" },
    );

    if (result._parseError) {
      stage = "parse";
      const error = `model_output_invalid:${result._parseError.code}`;
      await failAiExecution({ executionId, workerId, error });
      await db.update(tasksTable).set({
        status: before.status, workerId: null, leaseUntil: null, lastHeartbeatAt: null,
        updatedAt: new Date(), agentResponse: null,
      }).where(and(eq(tasksTable.id, before.id), eq(tasksTable.workerId, workerId), eq(tasksTable.status, "running")));
      await log("error", "AI task output was invalid", { stage: "parse", code: result._parseError.code });
      await db.insert(eventsTable).values({
        id: randomUUID(),
        type: params.trigger === "automatic" ? "TaskAutoExecutionFailed" : "TaskExecutionFailed",
        projectId: before.projectId,
        taskId: before.id,
        severity: "error",
        message: `AI execution of "${before.title}" failed`,
        correlationId,
        payload: { executionId, stage: "parse", code: "model_output_invalid", retryable: true },
      }).catch((eventError) => logger.warn({ eventError, taskId: before.id }, "task parse failure event write failed"));
      return {
        ok: false,
        status: "failed",
        executionId,
        errorCode: "model_output_invalid",
        parseCode: result._parseError.code,
      };
    }

    const finalStatus = result.needsHumanReview ? "verifying" : "completed";
    stage = "finalize";
    const taskReceipt = receipt(result);
    const [updated] = await db.transaction(async (tx) => {
      const [row] = await tx.update(tasksTable).set({
        status: finalStatus,
        workerId: null,
        leaseUntil: null,
        lastHeartbeatAt: null,
        agentResponse: JSON.stringify(taskReceipt),
        verificationResult: {
          passed: taskReceipt.verified,
          steps: taskReceipt.steps.map((name) => ({ name, passed: taskReceipt.verified })),
        },
        completedAt: finalStatus === "completed" ? new Date() : null,
        updatedAt: new Date(),
      }).where(and(eq(tasksTable.id, before.id), eq(tasksTable.workerId, workerId), eq(tasksTable.status, "running"))).returning();
      if (!row) throw new Error("task_state_changed_during_finalize");
      await tx.insert(taskLogsTable).values({
        id: randomUUID(), taskId: before.id,
        level: finalStatus === "completed" ? "info" : "warn",
        message: `AI task ${finalStatus}: ${taskReceipt.summary}`,
        metadata: { receipt: taskReceipt, executionId, trigger: params.trigger }, correlationId,
      });
      await tx.insert(eventsTable).values({
        id: randomUUID(), type: finalStatus === "completed" ? "TaskCompleted" : "TaskVerifying",
        projectId: before.projectId, taskId: before.id,
        severity: finalStatus === "completed" ? "success" : "warning",
        message: `AI executed "${before.title}" → ${finalStatus}`,
        correlationId, payload: { executionId, trigger: params.trigger },
      });
      return [row];
    });
    await completeAiExecution({
      executionId, workerId, finalMessageId: executionId,
      evidenceVerdict: finalStatus === "completed" ? "PROVEN" : "NOT_RECORDED",
      evidenceReason: finalStatus === "completed" ? "Structured task receipt verified." : "Human review remains required.",
    });
    await recordAudit({
      entityType: "task", entityId: before.id, action: "ai_executed",
      projectId: before.projectId, stateBefore: { status: before.status },
      stateAfter: { status: finalStatus }, correlationId,
    });
    invalidateContextCache(before.projectId);
    return { ok: true, status: finalStatus, task: updated, executionId };
  } catch (error) {
    const message = safeError(error);
    await failAiExecution({ executionId, workerId, error: message });
    await db.update(tasksTable).set({
      status: before.status, workerId: null, leaseUntil: null, lastHeartbeatAt: null, updatedAt: new Date(),
    }).where(and(eq(tasksTable.id, before.id), eq(tasksTable.workerId, workerId), eq(tasksTable.status, "running")));
    await log("error", stage === "context"
      ? "AI execution failed while building project context"
      : "AI task execution failed", { stage, code: "provider_or_context_failure" });
    await db.insert(eventsTable).values({
      id: randomUUID(),
      type: params.trigger === "automatic" ? "TaskAutoExecutionFailed" : "TaskExecutionFailed",
      projectId: before.projectId,
      taskId: before.id,
      severity: "error",
      message: `AI execution of "${before.title}" failed`,
      correlationId,
      payload: { executionId, stage, retryable: true },
    }).catch((eventError) => logger.warn({ eventError, taskId: before.id }, "task failure event write failed"));
    await recordAudit({
      entityType: "task", entityId: before.id, action: "execution_failed",
      projectId: before.projectId, stateBefore: { status: "running" },
      stateAfter: { status: "failed" }, correlationId,
    });
    invalidateContextCache(before.projectId);
    return {
      ok: false,
      status: "failed",
      executionId,
      errorCode: stage === "context" ? "context_build_failed" : "task_execution_failed",
      error,
    };
  } finally {
    clearInterval(heartbeat);
  }
}