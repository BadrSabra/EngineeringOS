import { randomUUID } from "node:crypto";
import { and, eq, inArray } from "drizzle-orm";
import {
  db,
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
import {
  finalizeExecutionAcceptance,
  type TaskExecutionFinalization,
} from "./ai-execution-acceptance.js";
import { redactUserFacingText, runAgentWithFallback } from "./ai-route-helpers.js";
import type { ProviderId } from "./ai-route-helpers.js";
import { logger } from "./logger.js";
import { taskTransitionConflict, type TaskStatus } from "./task-state.js";
import {
  buildRuleVerificationChecks,
  markRemediationPlanVerified,
} from "./remediation-plan.js";

const CONTEXT_SECTIONS = ["tasks", "metrics", "graphEntities", "graphRelationships", "events"] as const;

function pendingPlanVerificationSteps(plan: typeof tasksTable.$inferSelect["remediationPlan"]) {
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

function taskVerificationResult(params: {
  receipt: AiTaskExecutionReceipt;
  remediationPlan: typeof tasksTable.$inferSelect["remediationPlan"];
}) {
  const passed = params.receipt.terminalStatus === "SUCCEEDED" && !params.remediationPlan;
  const incomplete = Boolean(params.remediationPlan) || params.receipt.terminalStatus === "BLOCKED";
  return {
    passed,
    decision: incomplete
      ? ("incomplete" as const)
      : passed
        ? ("verified" as const)
        : params.receipt.terminalStatus === "CANCELLED"
          ? ("cancelled" as const)
          : ("failed" as const),
    steps: [
      ...(params.receipt.steps ?? []).map((name) => ({
        name,
        ...(!params.remediationPlan ? { kind: "automatic" as const } : {}),
        passed,
      })),
      ...(params.remediationPlan ? pendingPlanVerificationSteps(params.remediationPlan) : []),
    ],
  };
}

async function finalizeTaskExecutionAcceptance(params: {
  executionId: string;
  workerId: string;
  task: typeof tasksTable.$inferSelect;
  receipt: AiTaskExecutionReceipt;
  outcome: "SUCCEEDED" | "FAILED" | "INTERRUPTED";
  terminalStatus: "completed" | "failed" | "cancelled";
  reasonCode: string;
  retryable: boolean;
  trigger: TaskExecutionTrigger;
  finalStatus: "pending" | "queued" | "verifying" | "completed" | "failed" | "cancelled";
  error?: string | null;
  logLevel: "info" | "warn" | "error";
  logMessage: string;
  logMetadata?: Record<string, unknown>;
}): Promise<{ accepted: boolean; duplicate: boolean }> {
  const taskFinalization: TaskExecutionFinalization = {
    taskId: params.task.id,
    workerId: params.workerId,
    status: params.finalStatus,
    agentResponse: JSON.stringify(params.receipt),
    remediationPlan: markRemediationPlanVerified(
      params.task.remediationPlan,
      false,
    ),
    verificationResult: taskVerificationResult({
      receipt: params.receipt,
      remediationPlan: params.task.remediationPlan,
    }),
    completedAt: params.finalStatus === "completed" ? new Date() : null,
    correlationId: params.receipt.correlationId,
    log: {
      level: params.logLevel,
      message: params.logMessage,
      metadata: params.logMetadata,
    },
    event: {
      type: params.outcome === "SUCCEEDED"
        ? params.finalStatus === "completed" ? "TaskCompleted" : "TaskVerifying"
        : params.trigger === "automatic" ? "TaskAutoExecutionFailed" : "TaskExecutionFailed",
      severity: params.outcome === "SUCCEEDED"
        ? params.finalStatus === "completed" ? "success" : "warning"
        : "error",
      message: params.outcome === "SUCCEEDED"
        ? `AI executed "${params.task.title}" → ${params.finalStatus}`
        : `AI execution of "${params.task.title}" failed`,
      payload: {
        executionId: params.executionId,
        operationId: params.executionId,
        revision: params.receipt.revision,
        provider: params.receipt.provider,
        model: params.receipt.model,
        attempt: params.receipt.attempt,
        attempts: params.receipt.attempts,
        durationMs: params.receipt.durationMs,
        terminalStatus: params.receipt.terminalStatus,
        terminalReason: params.receipt.terminalReason,
        trigger: params.trigger,
        retryable: params.retryable,
      },
    },
    audit: {
      action: params.outcome === "SUCCEEDED"
        ? params.trigger === "automatic" ? "ai_auto_executed" : "ai_executed"
        : params.trigger === "automatic" ? "ai_auto_execution_failed" : "execution_failed",
      stateBefore: { status: params.task.status },
      stateAfter: {
        status: params.finalStatus,
        executionId: params.executionId,
        operationId: params.executionId,
        revision: params.receipt.revision,
        terminalStatus: params.receipt.terminalStatus,
        terminalReason: params.receipt.terminalReason,
      },
    },
  };
  const finalized = await finalizeExecutionAcceptance({
    executionId: params.executionId,
    workerId: params.workerId,
    finalizationKey: `execution:${params.executionId}:attempt:${params.receipt.attempt}:${params.reasonCode}`,
    outcome: params.outcome,
    terminalStatus: params.terminalStatus,
    reasonCode: params.reasonCode,
    recoveryState: params.outcome === "SUCCEEDED" ? "NONE" : params.outcome === "INTERRUPTED" ? "INCOMPLETE" : "REQUIRED",
    resumable: params.retryable,
    error: params.error,
    recipeReceipt: params.receipt,
    sourceRevision: params.receipt.revision,
    taskFinalization,
  });
  if (finalized.duplicate) {
    const [projectedTask] = await db
      .select({ status: tasksTable.status, workerId: tasksTable.workerId })
      .from(tasksTable)
      .where(eq(tasksTable.id, params.task.id))
      .limit(1);
    return {
      accepted: finalized.accepted
        && projectedTask?.status === params.finalStatus
        && projectedTask.workerId === null,
      duplicate: true,
    };
  }
  return { accepted: finalized.accepted, duplicate: false };
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
  const rollbackStatus = before.status === "running" ? "verifying" : before.status;
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
  const initialCheckpointed = await checkpointAiExecution({
    executionId, workerId,
    checkpoint: { stage: "running", sequence: 1, detail: "Task claimed.", updatedAt: new Date().toISOString() },
  });
  if (!initialCheckpointed) {
    const failure = failureReceipt({
      executionId,
      correlationId,
      revision: params.workspaceRevision,
      provider: executionProvider,
      attempt: before.retryCount,
      durationMs: Date.now() - startedAt,
      stages,
      code: "checkpoint_persistence_failed",
    });
    await finalizeTaskExecutionAcceptance({
      executionId,
      workerId,
      task: before,
      receipt: failure,
      outcome: "FAILED",
      terminalStatus: "failed",
      reasonCode: "CHECKPOINT_PERSISTENCE_FAILED",
      retryable: true,
      trigger: params.trigger,
      finalStatus: rollbackStatus,
      error: "Execution checkpoint could not be persisted after claim.",
      logLevel: "error",
      logMessage: "AI task execution could not persist its initial checkpoint",
      logMetadata: { stage: "claim", code: "checkpoint_persistence_failed" },
    });
    return { ok: false, status: "failed", executionId, errorCode: "checkpoint_persistence_failed" };
  }
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
        remediationPlan: before.remediationPlan ?? null,
        projectContext,
        ...opts,
      }, { onProgress: progress, signal: executionAbortController.signal }),
      {
        qualityProfile: "task_execution",
        signal: executionAbortController.signal,
        telemetryContext: {
          projectId: before.projectId,
          userId: params.userId,
          operationId: correlationId,
          correlationId,
        },
      },
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
      await finalizeTaskExecutionAcceptance({
        executionId,
        workerId,
        task: before,
        receipt: parseReceipt,
        outcome: "FAILED",
        terminalStatus: "failed",
        reasonCode: "MODEL_OUTPUT_INVALID",
        retryable: true,
        trigger: params.trigger,
        finalStatus: rollbackStatus,
        error,
        logLevel: "error",
        logMessage: "AI task output was invalid",
        logMetadata: { stage: "parse", code: result._parseError.code },
      });
      return {
        ok: false,
        status: "failed",
        executionId,
        errorCode: "model_output_invalid",
        parseCode: result._parseError.code,
      };
    }

    if (result._qualityError) {
      stage = "quality";
      stages.push("quality");
      const quality = result._qualityError;
      const qualityReceipt = failureReceipt({
        executionId,
        correlationId,
        revision: params.workspaceRevision,
        provider: effectiveProvider,
        attempt: before.retryCount,
        durationMs: Date.now() - startedAt,
        stages,
        code: quality.code,
      });
      await finalizeTaskExecutionAcceptance({
        executionId,
        workerId,
        task: before,
        receipt: qualityReceipt,
        outcome: "FAILED",
        terminalStatus: "failed",
        reasonCode: "QUALITY_REVIEW_LOW",
        retryable: true,
        trigger: params.trigger,
        finalStatus: rollbackStatus,
        error: quality.code,
        logLevel: "error",
        logMessage: "AI task output failed the quality gate",
        logMetadata: {
          stage: "quality",
          code: quality.code,
          score: quality.score,
          threshold: quality.threshold,
          reasons: quality.reasons,
        },
      });
      return {
        ok: false,
        status: "failed",
        executionId,
        errorCode: "quality_review_low",
      };
    }

    // An AI report is not proof that a remediation was applied. Rule-backed
    // tasks remain in verification until the explicit verification path passes.
    const finalStatus =
      result.needsHumanReview || before.remediationPlan ? "verifying" : "completed";
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
    const finalized = await finalizeTaskExecutionAcceptance({
      executionId,
      workerId,
      task: before,
      receipt: taskReceipt,
      outcome: "SUCCEEDED",
      terminalStatus: "completed",
      reasonCode: finalStatus === "completed" ? "ACCEPTED" : "HUMAN_REVIEW_REQUIRED",
      retryable: false,
      trigger: params.trigger,
      finalStatus,
      logLevel: finalStatus === "completed" ? "info" : "warn",
      logMessage: `AI task ${finalStatus}: ${safeText(taskReceipt.summary)}`,
      logMetadata: { receipt: taskReceipt, executionId, trigger: params.trigger },
    });
    if (!finalized.accepted) {
      throw Object.assign(new Error("task_state_changed_during_finalize"), { name: "AbortError" });
    }
    const [updated] = await db
      .select()
      .from(tasksTable)
      .where(eq(tasksTable.id, before.id))
      .limit(1);
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
    await finalizeTaskExecutionAcceptance({
      executionId,
      workerId,
      task: before,
      receipt: failure,
      outcome: cancelled ? "INTERRUPTED" : "FAILED",
      terminalStatus: cancelled ? "cancelled" : "failed",
      reasonCode: cancelled
        ? "EXECUTION_CANCELLED"
        : stage === "context" ? "CONTEXT_BUILD_FAILED" : "EXECUTION_FAILED",
      retryable: !cancelled,
      trigger: params.trigger,
      finalStatus: rollbackStatus,
      error: message,
      logLevel: "error",
      logMessage: stage === "context"
        ? "AI execution failed while building project context"
        : "AI task execution failed",
      logMetadata: { stage, code: "provider_or_context_failure" },
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