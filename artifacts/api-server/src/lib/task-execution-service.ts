import { randomUUID } from "node:crypto";
import { and, eq, inArray } from "drizzle-orm";
import {
  db,
  aiExecutionsTable,
  eventsTable,
  taskLogsTable,
  tasksTable,
} from "@workspace/db";
import {
  buildProjectContext,
  executeTask,
  invalidateContextCache,
  PROVIDER_REGISTRY,
} from "@workspace/ai-orchestrator";
import {
  createAiExecution,
  checkpointAiExecution,
  claimAiExecution,
  failAiExecution,
  heartbeatAiExecution,
  AI_EXECUTION_LEASE_MS,
  registerAiExecutionController,
  unregisterAiExecutionController,
} from "./ai-execution-state.js";
import { redactUserFacingText, runAgentWithFallback } from "./ai-route-helpers.js";
import type { ProviderId } from "./ai-route-helpers.js";
import { recordAudit, recordAuditInTransaction } from "./audit.js";
import { logger } from "./logger.js";
import { taskTransitionConflict, type TaskStatus } from "./task-state.js";

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

const RECEIPT_MAX_BYTES = 8_000;
const RECEIPT_MAX_STAGES = 12;
const RECEIPT_MAX_STEPS = 24;
const RECEIPT_MAX_TEXT = 480;

export type AiTaskExecutionReceipt = {
  kind: "AI_TASK_EXECUTION_RECEIPT";
  operationId: string;
  correlationId: string;
  revision: string | null;
  provider: ProviderId;
  model: string;
  attempt: number;
  attempts: number;
  durationMs: number;
  stages: string[];
  terminalStatus: "SUCCEEDED" | "BLOCKED" | "FAILED" | "CANCELLED";
  terminalReason: string;
  summary?: string;
  confidence?: string;
  steps?: string[];
  evidenceRefs: string[];
};

function safeText(value: unknown, max = RECEIPT_MAX_TEXT): string {
  return redactUserFacingText(String(value ?? ""))
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, max);
}

function boundedReceipt(receiptValue: AiTaskExecutionReceipt): AiTaskExecutionReceipt {
  const bounded = {
    ...receiptValue,
    stages: receiptValue.stages.slice(0, RECEIPT_MAX_STAGES).map((stage) => safeText(stage, 80)),
    evidenceRefs: receiptValue.evidenceRefs.slice(0, 8).map((ref) => safeText(ref, 120)),
    ...(receiptValue.summary ? { summary: safeText(receiptValue.summary, 2_000) } : {}),
    ...(receiptValue.steps ? { steps: receiptValue.steps.slice(0, RECEIPT_MAX_STEPS).map((step) => safeText(step)) } : {}),
    terminalReason: safeText(receiptValue.terminalReason, 240),
  };
  // Keep this envelope bounded even if future fields are added to the contract.
  const serialized = JSON.stringify(bounded);
  return serialized.length <= RECEIPT_MAX_BYTES
    ? bounded
    : { ...bounded, summary: bounded.summary?.slice(0, 240), steps: bounded.steps?.slice(0, 8) };
}

export function buildAiTaskExecutionReceipt(params: {
  executionId: string;
  correlationId: string;
  revision?: string;
  provider: ProviderId;
  attempt: number;
  durationMs: number;
  stages: string[];
  attempts?: number;
  result: Awaited<ReturnType<typeof executeTask>>;
}): AiTaskExecutionReceipt {
  return boundedReceipt({
    kind: "AI_TASK_EXECUTION_RECEIPT",
    operationId: params.executionId,
    correlationId: params.correlationId,
    revision: params.revision ?? null,
    provider: params.provider,
    model: PROVIDER_REGISTRY[params.provider]?.defaultModels.powerful ?? "provider-default",
    attempt: params.attempt,
    attempts: Math.max(1, Math.min(params.attempts ?? 1, 8)),
    durationMs: Math.max(0, Math.min(Math.round(params.durationMs), 86_400_000)),
    stages: params.stages,
    terminalStatus: params.result.needsHumanReview ? "BLOCKED" : "SUCCEEDED",
    terminalReason: params.result.needsHumanReview ? "human_review_required" : "structured_result_verified",
    summary: params.result.summary,
    confidence: safeText(params.result.confidence, 40),
    steps: params.result.steps.map((step) => String(step)),
    evidenceRefs: [],
  });
}

function failureReceipt(params: {
  executionId: string;
  correlationId: string;
  revision?: string;
  provider: ProviderId;
  attempt: number;
  durationMs: number;
  stages: string[];
  code: string;
  cancelled?: boolean;
}): AiTaskExecutionReceipt {
  const cancelled = Boolean(params.cancelled);
  return boundedReceipt({
    kind: "AI_TASK_EXECUTION_RECEIPT",
    operationId: params.executionId,
    correlationId: params.correlationId,
    revision: params.revision ?? null,
    provider: params.provider,
    model: PROVIDER_REGISTRY[params.provider]?.defaultModels.powerful ?? "provider-default",
    attempt: params.attempt,
    attempts: 1,
    durationMs: Math.max(0, Math.min(Math.round(params.durationMs), 86_400_000)),
    stages: params.stages,
    terminalStatus: cancelled ? "CANCELLED" : "FAILED",
    terminalReason: safeText(params.code, 120),
    evidenceRefs: [],
  });
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
  const initialStatus = before.status as TaskStatus;
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
  const startedAt = Date.now();
  const stages: string[] = ["claim"];
  let executionProvider = params.provider.provider;

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
  const claimConflict = taskTransitionConflict(initialStatus, "running", "execution");
  if (claimConflict) {
    await failAiExecution({ executionId, workerId, error: claimConflict });
    return { ok: false, status: "conflict", executionId, errorCode: "invalid_task_transition" };
  }

  const log = async (level: "info" | "warn" | "error", message: string, metadata?: Record<string, unknown>) => {
    const safeMetadata = Object.fromEntries(
      Object.entries(metadata ?? {})
        .filter(([key]) => key !== "workerId")
        .map(([key, value]) => [key, typeof value === "string" ? safeText(value, 240) : value]),
    );
    await db.insert(taskLogsTable).values({
      id: randomUUID(), taskId: before.id, level, message: safeText(message, 500),
      metadata: { ...safeMetadata, executionId, trigger: params.trigger },
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
  const executionAbortController = new AbortController();
  registerAiExecutionController(executionId, executionAbortController);

  try {
    stage = "context";
    stages.push("context");
    await log("info", "Building project context", { stage: "context" });
    if (executionAbortController.signal.aborted) throw Object.assign(new Error("Execution cancelled"), { name: "AbortError" });
    const projectContext = await buildProjectContext(before.projectId, { sections: [...CONTEXT_SECTIONS] });
    await checkpointAiExecution({
      executionId, workerId,
      checkpoint: { stage: "model_call", sequence: 2, detail: "Project context built.", updatedAt: new Date().toISOString() },
    });
    const progress = async (message: string) => log("info", message, { stage: "progress" });
    stage = "provider_call";
    stages.push("provider_call");
    const { result, effectiveProvider } = await runAgentWithFallback<Awaited<ReturnType<typeof executeTask>>>(
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
      }, { onProgress: progress, signal: executionAbortController.signal }),
      { qualityProfile: "task_execution", signal: executionAbortController.signal },
    );
    executionProvider = effectiveProvider;
    if (effectiveProvider !== params.provider.provider) stages.push("provider_fallback");
    if (executionAbortController.signal.aborted) {
      throw Object.assign(new Error("Execution cancelled"), { name: "AbortError" });
    }

    if (result._parseError) {
      stage = "parse";
      stages.push("parse");
      const parseReceipt = failureReceipt({
        executionId, correlationId, revision: params.workspaceRevision,
        provider: effectiveProvider, attempt: before.retryCount,
        durationMs: Date.now() - startedAt, stages, code: "model_output_invalid",
      });
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
        payload: {
          executionId,
          operationId: executionId,
          revision: params.workspaceRevision ?? null,
          attempt: before.retryCount,
          stage: "parse",
          code: "model_output_invalid",
          retryable: true,
        },
      }).catch((eventError) => logger.warn({ eventError, taskId: before.id }, "task parse failure event write failed"));
      await db.update(tasksTable).set({ agentResponse: JSON.stringify(parseReceipt) })
        .where(and(eq(tasksTable.id, before.id), eq(tasksTable.correlationId, correlationId)));
      return {
        ok: false,
        status: "failed",
        executionId,
        errorCode: "model_output_invalid",
        parseCode: result._parseError.code,
      };
    }

    const finalStatus = result.needsHumanReview ? "verifying" : "completed";
    const finalConflict = taskTransitionConflict("running", finalStatus, "execution");
    if (finalConflict) throw new Error(finalConflict);
    stage = "finalize";
    stages.push("finalize");
    const taskReceipt = buildAiTaskExecutionReceipt({
      executionId, correlationId, revision: params.workspaceRevision,
      provider: executionProvider, attempt: before.retryCount,
      durationMs: Date.now() - startedAt, stages,
      attempts: effectiveProvider === params.provider.provider ? 1 : 2, result,
    });
    const [updated] = await db.transaction(async (tx) => {
      // Lock the durable execution before touching the task. Cancellation
      // updates this row first, so a cancelling worker cannot publish a
      // success after cancellation has won the race.
      const [execution] = await tx
        .select({ status: aiExecutionsTable.status })
        .from(aiExecutionsTable)
        .where(and(
          eq(aiExecutionsTable.id, executionId),
          eq(aiExecutionsTable.workerId, workerId),
        ))
        .for("update");
      if (!execution || execution.status !== "running" || executionAbortController.signal.aborted) {
        throw Object.assign(new Error("Execution cancelled"), { name: "AbortError" });
      }
      const [row] = await tx.update(tasksTable).set({
        status: finalStatus,
        workerId: null,
        leaseUntil: null,
        lastHeartbeatAt: null,
        agentResponse: JSON.stringify(taskReceipt),
        verificationResult: {
          passed: taskReceipt.terminalStatus === "SUCCEEDED",
          steps: (taskReceipt.steps ?? []).map((name) => ({
            name,
            passed: taskReceipt.terminalStatus === "SUCCEEDED",
          })),
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
        correlationId,
        payload: {
          executionId,
          operationId: executionId,
          revision: taskReceipt.revision,
          provider: taskReceipt.provider,
          model: taskReceipt.model,
          attempt: taskReceipt.attempt,
          attempts: taskReceipt.attempts,
          durationMs: taskReceipt.durationMs,
          terminalStatus: taskReceipt.terminalStatus,
          terminalReason: taskReceipt.terminalReason,
          trigger: params.trigger,
        },
      });
      await recordAuditInTransaction(tx, {
        entityType: "task", entityId: before.id, action: "ai_executed",
        projectId: before.projectId, stateBefore: { status: before.status },
        stateAfter: {
          status: finalStatus, executionId, operationId: executionId,
          revision: taskReceipt.revision, terminalStatus: taskReceipt.terminalStatus,
          terminalReason: taskReceipt.terminalReason,
        },
        correlationId,
      });
      await tx.update(aiExecutionsTable).set({
        status: "completed",
        finalMessageId: executionId,
        completedAt: new Date(),
        updatedAt: new Date(),
        leaseUntil: null,
        lastHeartbeatAt: null,
        checkpoint: JSON.stringify({
          stage: "completed",
          sequence: Date.now(),
          evidenceVerdict: finalStatus === "completed" ? "PROVEN" : "NOT_RECORDED",
          evidenceReason: finalStatus === "completed" ? "Structured task receipt verified." : "Human review remains required.",
          updatedAt: new Date().toISOString(),
        }),
      }).where(and(
        eq(aiExecutionsTable.id, executionId),
        eq(aiExecutionsTable.workerId, workerId),
        eq(aiExecutionsTable.status, "running"),
      ));
      return [row];
    });
    invalidateContextCache(before.projectId);
    return { ok: true, status: finalStatus, task: updated, executionId };
  } catch (error) {
    const cancelled = executionAbortController.signal.aborted
      || (error instanceof Error && error.name === "AbortError");
    const code = cancelled ? "cancelled" : stage === "context" ? "context_build_failed" : "task_execution_failed";
    const failure = failureReceipt({
      executionId, correlationId, revision: params.workspaceRevision,
      provider: executionProvider, attempt: before.retryCount,
      durationMs: Date.now() - startedAt, stages, code, cancelled,
    });
    const message = safeText(code, 120);
    await failAiExecution({ executionId, workerId, error: message, cancelled });
    await db.update(tasksTable).set({
      status: before.status, workerId: null, leaseUntil: null, lastHeartbeatAt: null,
      agentResponse: JSON.stringify(failure), updatedAt: new Date(),
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
      payload: {
        executionId,
        operationId: executionId,
        revision: params.workspaceRevision ?? null,
        provider: failure.provider,
        model: failure.model,
        attempt: failure.attempt,
        durationMs: failure.durationMs,
        terminalStatus: failure.terminalStatus,
        terminalReason: failure.terminalReason,
        stage,
        retryable: !cancelled,
      },
    }).catch((eventError) => logger.warn({ eventError, taskId: before.id }, "task failure event write failed"));
    await recordAudit({
      entityType: "task", entityId: before.id, action: "execution_failed",
      projectId: before.projectId, stateBefore: { status: "running" },
      stateAfter: {
        status: "failed",
        executionId,
        operationId: executionId,
        revision: params.workspaceRevision ?? null,
        terminalStatus: failure.terminalStatus,
        terminalReason: failure.terminalReason,
      }, correlationId,
    });
    invalidateContextCache(before.projectId);
    return {
      ok: false,
      status: "failed",
      executionId,
      errorCode: code,
      error,
    };
  } finally {
    clearInterval(heartbeat);
    unregisterAiExecutionController(executionId, executionAbortController);
  }
}