/**
 * Shared eligibility contract for continuing the current Mission Task
 * generation. Task recovery, the durable Task Outbox and Mission replanning
 * all consult these predicates so a new plan cannot race a valid continuation.
 */
export const TASK_RECOVERY_ACTION_CODES = [
  "RESUME_ALLOWED",
  "RETRY_AFTER_TIMEOUT",
  "RETRY_AFTER_RATE_LIMIT",
] as const;

export const TASK_RECOVERY_TASK_STATUSES = ["pending", "queued", "verifying"] as const;
export const TASK_RECOVERY_EXECUTION_STATUSES = ["paused", "failed"] as const;
export const TASK_ACTIVE_EXECUTION_STATUSES = ["queued", "running", "cancelling"] as const;

export type TaskRecoveryActionCode = (typeof TASK_RECOVERY_ACTION_CODES)[number];

type TaskRecord = {
  taskId: string;
  taskProjectId: string;
  taskStatus: string;
  prompt: string | null;
  retryCount: number;
  maxRetries: number;
  taskCorrelationId: string | null;
};

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

const PROVIDER_LIMIT_FAILURE_KINDS = new Set([
  "RATE_LIMITED",
  "QUOTA",
  "QUOTA_EXCEEDED",
  "QUOTA_EXHAUSTED",
]);

/** Shared classification for rate-limit failures that cannot be retried autonomously. */
export function isProviderLimitRecoveryManual(input: {
  action: unknown;
  failureKind?: unknown;
  retryAfterSource?: unknown;
  rateLimitScope?: unknown;
}): boolean {
  const retryAfterSource = typeof input.retryAfterSource === "string"
    ? input.retryAfterSource
    : undefined;
  const failureKind = typeof input.failureKind === "string"
    ? input.failureKind.trim().toUpperCase()
    : "";
  const rateLimitScope = typeof input.rateLimitScope === "string"
    ? input.rateLimitScope.trim().toLowerCase()
    : "";
  const hasNonLocalRateLimitScope = Boolean(rateLimitScope)
    && rateLimitScope !== "project"
    && rateLimitScope !== "local_admission";
  const hasProviderRetrySource = retryAfterSource === "provider"
    || retryAfterSource === "local_adaptive"
    || retryAfterSource === "adaptive_default"
    || retryAfterSource === "server_default";
  const hasProviderSpecificLimitFailure = failureKind !== "RATE_LIMIT"
    && PROVIDER_LIMIT_FAILURE_KINDS.has(failureKind);

  if (
    hasProviderSpecificLimitFailure
    || hasNonLocalRateLimitScope
    || hasProviderRetrySource
  ) {
    return true;
  }
  if (
    retryAfterSource === "project_rate_limit"
    || retryAfterSource === "local_admission"
    || rateLimitScope === "project"
    || rateLimitScope === "local_admission"
  ) {
    return false;
  }
  return input.action === "RETRY_AFTER_RATE_LIMIT"
    || PROVIDER_LIMIT_FAILURE_KINDS.has(failureKind);
}

/** A future retryAt remains pending; it is deferred, not abandoned. */
export function isSamePlanTaskRecoveryPending(input: {
  outcome: unknown;
  recoveryState: unknown;
  nextActionCode: unknown;
  resumable: unknown;
  retryAt?: unknown;
  taskStatus: unknown;
  prompt: unknown;
  retryCount: unknown;
  maxRetries: unknown;
  executionStatus: unknown;
  taskCorrelationId: unknown;
  executionCorrelationId: unknown;
}): boolean {
  return input.outcome === "FAILED"
    && input.recoveryState === "REQUIRED"
    && typeof input.nextActionCode === "string"
    && (TASK_RECOVERY_ACTION_CODES as readonly string[]).includes(input.nextActionCode)
    && (input.nextActionCode === "RESUME_ALLOWED" ? input.resumable === 1 : input.resumable === 0)
    && (
      input.nextActionCode !== "RETRY_AFTER_RATE_LIMIT"
      || (typeof input.retryAt === "string" && Number.isFinite(Date.parse(input.retryAt)))
    )
    && typeof input.taskStatus === "string"
    && (TASK_RECOVERY_TASK_STATUSES as readonly string[]).includes(input.taskStatus)
    && typeof input.prompt === "string"
    && input.prompt.trim().length > 0
    && Number.isSafeInteger(input.retryCount)
    && Number.isSafeInteger(input.maxRetries)
    && Number(input.retryCount) < Number(input.maxRetries)
    && typeof input.executionStatus === "string"
    && (TASK_RECOVERY_EXECUTION_STATUSES as readonly string[]).includes(input.executionStatus)
    && typeof input.taskCorrelationId === "string"
    && input.taskCorrelationId.length > 0
    && input.executionCorrelationId === input.taskCorrelationId
    && !isProviderLimitRecoveryManual({
      action: input.nextActionCode,
      failureKind: input.failureKind,
      retryAfterSource: input.retryAfterSource,
      rateLimitScope: input.rateLimitScope,
    });
}

/** Only an exact, parseable Outbox row for the current Task generation continues work. */
export function isTaskAutoExecutionIntentPending(input: {
  eventType: unknown;
  eventProjectId: unknown;
  eventTaskId: unknown;
  eventPayload: unknown;
  taskId: unknown;
  taskProjectId: unknown;
  taskStatus: unknown;
  prompt: unknown;
  taskRetryCount: unknown;
  taskCorrelationId: unknown;
}): boolean {
  const payload = asRecord(input.eventPayload);
  const payloadCorrelationId = payload.taskCorrelationId;
  const correlationMatches = payloadCorrelationId === input.taskCorrelationId
    || (payloadCorrelationId === undefined && input.taskCorrelationId === null);
  const attemptCount = payload.attemptCount ?? 0;

  return (input.eventType === "TaskAutoExecutionDispatchRequested"
      || input.eventType === "TaskAutoExecutionDeferred")
    && input.eventProjectId === input.taskProjectId
    && input.eventTaskId === input.taskId
    && typeof input.taskId === "string"
    && input.taskId.length > 0
    && input.taskStatus === "verifying"
    && typeof input.prompt === "string"
    && input.prompt.trim().length > 0
    && Number.isSafeInteger(input.taskRetryCount)
    && input.taskRetryCount === payload.taskRetryCount
    && correlationMatches
    && typeof payload.userId === "string"
    && payload.userId.length > 0
    && Number.isSafeInteger(attemptCount)
    && Number(attemptCount) >= 0
    && (
      payload.nextAttemptAt === undefined
      || (typeof payload.nextAttemptAt === "string"
        && Number.isFinite(Date.parse(payload.nextAttemptAt)))
    )
    && (
      payload.parentExecutionId === undefined
      || payload.parentExecutionId === null
      || typeof payload.parentExecutionId === "string"
    );
}

export type TaskContinuationDecision =
  | { kind: "continue"; via: "active_task" | "active_execution" | "accepted_recovery" | "task_outbox" }
  | { kind: "replan"; reason: "no_current_task_continuation" };

/** Shared Mission gate over one snapshot of Task, acceptance/execution and Outbox. */
export function decideTaskContinuation(input: {
  task: TaskRecord;
  execution?: { status: unknown; correlationId: unknown };
  acceptance?: {
    outcome: unknown;
    recoveryState: unknown;
    nextActionCode: unknown;
    resumable: unknown;
    retryAt?: unknown;
    failureKind?: unknown;
    retryAfterSource?: unknown;
    rateLimitScope?: unknown;
  };
  outbox?: {
    eventType: unknown;
    eventProjectId: unknown;
    eventTaskId: unknown;
    eventPayload: unknown;
  };
}): TaskContinuationDecision {
  const { task } = input;

  // A running Task stays authoritative until its worker lease is reconciled.
  if (task.taskStatus === "running") {
    return { kind: "continue", via: "active_task" };
  }

  if (
    input.execution
    && (TASK_ACTIVE_EXECUTION_STATUSES as readonly string[]).includes(String(input.execution.status))
    && typeof task.taskCorrelationId === "string"
    && task.taskCorrelationId.length > 0
    && input.execution.correlationId === task.taskCorrelationId
    && ["pending", "queued", "verifying"].includes(task.taskStatus)
  ) {
    return { kind: "continue", via: "active_execution" };
  }

  if (
    input.acceptance
    && isSamePlanTaskRecoveryPending({
      ...input.acceptance,
      taskStatus: task.taskStatus,
      prompt: task.prompt,
      retryCount: task.retryCount,
      maxRetries: task.maxRetries,
      executionStatus: input.execution?.status,
      taskCorrelationId: task.taskCorrelationId,
      executionCorrelationId: input.execution?.correlationId,
    })
  ) {
    return { kind: "continue", via: "accepted_recovery" };
  }

  if (
    input.outbox
    && isTaskAutoExecutionIntentPending({
      ...input.outbox,
      taskId: task.taskId,
      taskProjectId: task.taskProjectId,
      taskStatus: task.taskStatus,
      prompt: task.prompt,
      taskRetryCount: task.retryCount,
      taskCorrelationId: task.taskCorrelationId,
    })
  ) {
    return { kind: "continue", via: "task_outbox" };
  }

  return { kind: "replan", reason: "no_current_task_continuation" };
}
