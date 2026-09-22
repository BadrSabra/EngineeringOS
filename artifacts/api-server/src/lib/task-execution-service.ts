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
  getAiExecutionForUser,
  checkpointAiExecution,
  claimAiExecution,
  failAiExecution,
  heartbeatAiExecution,
  AI_EXECUTION_LEASE_MS,
  buildAiExecutionResumeContext,
  parseAiExecutionCheckpoint,
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
import { createTaskProgressEmitter } from "./task-progress.js";

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
  failureClass?: AiTaskFailureClass;
  retryable?: boolean;
};

export type AiTaskFailureClass =
  | "checkpoint"
  | "context"
  | "provider"
  | "malformed_output"
  | "quality_gate"
  | "tool"
  | "validation"
  | "revision_conflict"
  | "permission"
  | "objective_incomplete"
  | "ownership"
  | "internal";

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
  failureClass: AiTaskFailureClass;
  retryable: boolean;
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
    failureClass: params.failureClass,
    retryable: params.retryable,
  });
}

export function classifyTaskExecutionFailure(params: {
  stage: string;
  cancelled: boolean;
}): {
  code: string;
  failureClass: AiTaskFailureClass;
  reasonCode: string;
  retryable: boolean;
} {
  if (params.cancelled) {
    return {
      code: "cancelled",
      failureClass: "internal",
      reasonCode: "EXECUTION_CANCELLED",
      retryable: false,
    };
  }
  if (params.stage === "context") {
    return {
      code: "context_build_failed",
      failureClass: "context",
      reasonCode: "CONTEXT_BUILD_FAILED",
      retryable: true,
    };
  }
  if (params.stage === "provider_call" || params.stage === "provider_fallback") {
    return {
      code: "provider_call_failed",
      failureClass: "provider",
      reasonCode: "EXECUTION_PROVIDER_FAILURE",
      retryable: true,
    };
  }
  if (params.stage === "finalize") {
    return {
      code: "execution_finalize_failed",
      failureClass: "ownership",
      reasonCode: "EXECUTION_FINALIZATION_FAILED",
      retryable: true,
    };
  }
  return {
    code: "task_execution_failed",
    failureClass: "internal",
    reasonCode: "EXECUTION_FAILED",
    retryable: true,
  };
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
    expectedAttempt: params.receipt.attempt,
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
  resumeExecutionId?: string;
  resumeToken?: string;
}): Promise<TaskExecutionOutcome> {
  const [before] = await db.select().from(tasksTable).where(eq(tasksTable.id, params.taskId)).limit(1);
  if (!before) return { ok: false, status: "conflict", errorCode: "task_not_found" };
  const allowed = params.expectedStatuses ?? ["pending", "queued", "verifying"];
  const initialStatus = before.status as TaskStatus;
  const rollbackStatus = before.status === "running" ? "verifying" : before.status;
  const initialCorrelationId = randomUUID();
  const workerId = `task-worker:${randomUUID()}`;
  const idempotencyKey = `${before.id}:attempt:${before.retryCount}`;
  const request = {
    projectId: before.projectId,
    message: before.prompt ?? before.title,
    modelMessage: before.prompt ?? before.title,
    workspaceRevision: params.workspaceRevision,
    linkedTaskId: before.id,
    correlationId: initialCorrelationId,
    attempt: before.retryCount,
    validationTargetPaths: Array.isArray(before.relatedFiles) ? before.relatedFiles : [],
  };
  let stage = "claim";
  const startedAt = Date.now();
  const stages: string[] = ["claim"];
  let executionProvider = params.provider.provider;

  // A resume continues the existing durable execution. It must not re-enter
  // createAiExecution with the original task idempotency key: that key belongs
  // to the original user turn, while resumeToken authorizes a new auditable
  // assistant attempt on the same execution.
  const durable = params.resumeExecutionId
    ? await (async () => {
        if (!params.resumeToken) return undefined;
        const existing = await getAiExecutionForUser(params.resumeExecutionId!, params.userId);
        if (
          !existing
          || existing.linkedTaskId !== before.id
          || existing.projectId !== before.projectId
        ) {
          return undefined;
        }
        return { execution: existing, created: false as const };
      })()
    : await createAiExecution({
        userId: params.userId,
        request,
        idempotencyKey,
        correlationId: initialCorrelationId,
        attempt: before.retryCount,
        projectId: before.projectId,
        linkedTaskId: before.id,
        goalId: before.goalId ?? undefined,
      });
  if (!durable) {
    return {
      ok: false,
      status: "conflict",
      errorCode: "execution_identity_changed",
    };
  }
  const executionId = durable.execution.id;
  if (params.resumeExecutionId && executionId !== params.resumeExecutionId) {
    return {
      ok: false,
      status: "conflict",
      executionId,
      errorCode: "execution_identity_changed",
    };
  }
  const correlationId = durable.execution.correlationId ?? initialCorrelationId;
  const claimedExecution = durable.created
    ? await claimAiExecution({
        executionId,
        userId: params.userId,
        workerId,
        ...(params.resumeToken ? { resumeToken: params.resumeToken } : {}),
      })
    : durable.execution.status === "running"
      ? undefined
      : await claimAiExecution({
          executionId,
          userId: params.userId,
          workerId,
          ...(params.resumeToken ? { resumeToken: params.resumeToken } : {}),
        });
  if (!claimedExecution) {
    return { ok: false, status: "conflict", executionId, errorCode: "execution_already_claimed" };
  }
  const executionAttempt = claimedExecution.attempt;
  const claimedCheckpoint = parseAiExecutionCheckpoint(claimedExecution.checkpoint);
  const initialCheckpointSequence = Math.max(
    1,
    claimedCheckpoint?.sequence ?? 0,
    claimedExecution.checkpointVersion ?? 0,
  ) + 1;
  const resumeContext = params.resumeToken
    ? buildAiExecutionResumeContext(claimedCheckpoint)
    : "";

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
  const progress = createTaskProgressEmitter({
    taskId: before.id,
    executionId,
    attempt: executionAttempt,
    workerId,
    correlationId,
    trigger: params.trigger,
  });
  await log("info", "AI task execution claimed", { stage: "claim", workerId });
  await progress.start("acquisition", "Execution acquired.", 8, 1);
  await progress.finish("acquisition", "completed", "Execution is owned by the active worker.", 12, 1);
  const initialCheckpointed = await checkpointAiExecution({
    executionId, expectedAttempt: executionAttempt, workerId,
    checkpoint: {
      stage: "running",
      sequence: initialCheckpointSequence,
      detail: "Task claimed.",
      updatedAt: new Date().toISOString(),
    },
  });
  if (!initialCheckpointed) {
    const failure = failureReceipt({
      executionId,
      correlationId,
      revision: params.workspaceRevision,
      provider: executionProvider,
      attempt: executionAttempt,
      durationMs: Date.now() - startedAt,
      stages,
      code: "checkpoint_persistence_failed",
       failureClass: "checkpoint",
       retryable: true,
    });
    const finalized = await finalizeTaskExecutionAcceptance({
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
    if (finalized.accepted) {
      await progress.finish("finalization", "failed", "Saving the execution checkpoint failed.", 92, 7);
      await progress.terminal("FAILED", "Task execution failed before model work began.");
    }
    return { ok: false, status: "failed", executionId, errorCode: "checkpoint_persistence_failed" };
  }
  const heartbeat = setInterval(() => {
    void heartbeatAiExecution({ executionId, expectedAttempt: executionAttempt, workerId });
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
  await registerAiExecutionController(executionId, executionAbortController);

  try {
    stage = "context";
    stages.push("context");
    await progress.start("context", "Building project context.", 16, 2);
    await log("info", "Building project context", { stage: "context" });
    if (executionAbortController.signal.aborted) throw Object.assign(new Error("Execution cancelled"), { name: "AbortError" });
    const projectContext = await buildProjectContext(before.projectId, { sections: [...CONTEXT_SECTIONS] });
    await progress.finish("context", "completed", "Project context is ready.", 24, 2);
    await checkpointAiExecution({
      executionId, expectedAttempt: executionAttempt, workerId,
      checkpoint: { stage: "model_call", sequence: 2, detail: "Project context built.", updatedAt: new Date().toISOString() },
    });
    const progressMessage = async (message: string) => log("info", message, { stage: "progress" });
    stage = "provider_call";
    stages.push("provider_call");
    await progress.start("model", "Calling the AI model.", 32, 3);
    const { result, effectiveProvider } = await runAgentWithFallback<Awaited<ReturnType<typeof executeTask>>>(
      params.userId,
      params.provider,
      (opts) => executeTask({
        taskTitle: before.title,
        taskDescription: before.description,
        taskPrompt: [before.prompt ?? before.title, resumeContext].filter(Boolean).join("\n\n"),
        taskPriority: before.priority,
        relatedFiles: before.relatedFiles ?? [],
        remediationPlan: before.remediationPlan ?? null,
        projectContext,
        ...opts,
      }, {
        onProgress: progressMessage,
        signal: executionAbortController.signal,
        onModelAttempt: async (attempt) => {
          const isRetry = attempt.outcome !== "success" || attempt.contractOutcome === "malformed_but_recovered";
          if (isRetry) {
            await progress.start("attempt", "Retrying the model attempt.", 40, 4);
          }
          await progress.finish(
            "attempt",
            attempt.outcome === "success" ? "completed" : "failed",
            attempt.outcome === "success" ? "Model attempt completed." : "Model attempt needs recovery.",
            44,
            4,
          );
        },
      }),
      {
        qualityProfile: "task_execution",
        onProviderAttempt: async (attempt) => {
          if (attempt.fallbackCount > 0) {
            await progress.start("attempt", "Trying a server-selected recovery attempt.", 42, 4);
          }
          if (attempt.outcome === "failure" || attempt.outcome === "cancelled") {
            await progress.finish(
              "attempt",
              attempt.outcome === "cancelled" ? "cancelled" : "failed",
              attempt.outcome === "cancelled" ? "Execution was cancelled." : "The model attempt did not complete.",
              44,
              4,
            );
          }
        },
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
    if (effectiveProvider !== params.provider.provider) {
      stages.push("provider_fallback");
      await progress.finish("attempt", "completed", "A recovery attempt completed.", 48, 4);
    }
    await progress.finish("model", "completed", "The model response was received.", 56, 3);
    if (executionAbortController.signal.aborted) {
      throw Object.assign(new Error("Execution cancelled"), { name: "AbortError" });
    }

    if (result._parseError) {
      stage = "parse";
      stages.push("parse");
      await progress.start("analysis", "Analyzing the model response.", 64, 5);
      await progress.finish("analysis", "failed", "The model response could not be accepted.", 68, 5);
      await progress.start("finalization", "Recording the failed execution.", 84, 7);
      const parseReceipt = failureReceipt({
        executionId, correlationId, revision: params.workspaceRevision,
        provider: effectiveProvider, attempt: executionAttempt,
        durationMs: Date.now() - startedAt, stages, code: "model_output_invalid",
        failureClass: "malformed_output",
        retryable: true,
      });
      const error = `model_output_invalid:${result._parseError.code}`;
      const finalized = await finalizeTaskExecutionAcceptance({
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
      if (finalized.accepted) {
        await progress.finish("finalization", "completed", "The failed execution was recorded.", 92, 7);
        await progress.terminal("FAILED", "Task execution failed validation.");
      }
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
      await progress.start("analysis", "Analyzing the model response.", 64, 5);
      await progress.finish("analysis", "completed", "The model response was parsed.", 72, 5);
      await progress.start("verification", "Running the server quality gate.", 76, 6);
      await progress.finish("verification", "failed", "The result did not pass the quality gate.", 80, 6);
      await progress.start("finalization", "Recording the failed execution.", 84, 7);
      const quality = result._qualityError;
      const qualityReceipt = failureReceipt({
        executionId,
        correlationId,
        revision: params.workspaceRevision,
        provider: effectiveProvider,
        attempt: executionAttempt,
        durationMs: Date.now() - startedAt,
        stages,
        code: quality.code,
        failureClass: "quality_gate",
        retryable: true,
      });
      const finalized = await finalizeTaskExecutionAcceptance({
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
      if (finalized.accepted) {
        await progress.finish("finalization", "completed", "The failed execution was recorded.", 92, 7);
        await progress.terminal("FAILED", "Task execution did not pass quality checks.");
      }
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
    await progress.start("analysis", "Analyzing the model response.", 64, 5);
    await progress.finish("analysis", "completed", "The model response was parsed.", 72, 5);
    await progress.start("verification", "Running server-owned verification.", 76, 6);
    await progress.finish(
      "verification",
      "completed",
      finalStatus === "verifying" ? "Operator verification is required." : "Server verification completed.",
      80,
      6,
    );
    await progress.start("finalization", "Recording the execution outcome.", 84, 7);
    const taskReceipt = buildAiTaskExecutionReceipt({
      executionId, correlationId, revision: params.workspaceRevision,
       provider: executionProvider, attempt: executionAttempt,
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
    await progress.finish(
      "finalization",
      "completed",
      finalStatus === "verifying" ? "Execution accepted; review remains open." : "Execution accepted.",
      92,
      7,
    );
    await progress.terminal(
      "SUCCEEDED",
      finalStatus === "verifying" ? "Task finished and is awaiting verification." : "Task completed successfully.",
    );
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
    const classification = classifyTaskExecutionFailure({ stage, cancelled });
    const failure = failureReceipt({
      executionId, correlationId, revision: params.workspaceRevision,
      provider: executionProvider, attempt: executionAttempt,
      durationMs: Date.now() - startedAt,
      stages,
      code: classification.code,
      failureClass: classification.failureClass,
      retryable: classification.retryable,
      cancelled,
    });
    const message = safeText(classification.code, 120);
    await progress.finish(
      stage === "context" ? "context" : "finalization",
      cancelled ? "cancelled" : "failed",
      cancelled ? "Execution was cancelled." : "Recording the execution failure.",
      stage === "context" ? 24 : 92,
      stage === "context" ? 2 : 7,
    );
    const finalized = await finalizeTaskExecutionAcceptance({
      executionId,
      workerId,
      task: before,
      receipt: failure,
      outcome: cancelled ? "INTERRUPTED" : "FAILED",
      terminalStatus: cancelled ? "cancelled" : "failed",
      reasonCode: classification.reasonCode,
      retryable: classification.retryable,
      trigger: params.trigger,
      finalStatus: rollbackStatus,
      error: message,
      logLevel: "error",
      logMessage: cancelled
        ? "AI task execution was cancelled"
        : "AI task execution failed",
      logMetadata: {
        stage,
        code: classification.code,
        failureClass: classification.failureClass,
        reasonCode: classification.reasonCode,
      },
    });
    if (finalized.accepted) {
      await progress.terminal(
        cancelled ? "INTERRUPTED" : "FAILED",
        cancelled ? "Task execution was cancelled." : "Task execution failed.",
      );
    }
    invalidateContextCache(before.projectId);
    return {
      ok: false,
      status: "failed",
      executionId,
      errorCode: classification.code,
      error: message,
    };
  } finally {
    clearInterval(heartbeat);
    unregisterAiExecutionController(executionId, executionAbortController);
  }
}