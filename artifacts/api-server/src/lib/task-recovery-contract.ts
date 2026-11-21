/**
 * The exact acceptance actions and durable eligibility states that the
 * autonomous Task recovery coordinator owns on the current Task generation.
 *
 * Mission projection uses the same contract so a retryable Task failure does
 * not become a new Mission plan while this bounded recovery path is eligible.
 */
export const TASK_RECOVERY_ACTION_CODES = [
  "RESUME_ALLOWED",
  "RETRY_AFTER_TIMEOUT",
  "RETRY_AFTER_RATE_LIMIT",
] as const;

export const TASK_RECOVERY_TASK_STATUSES = ["pending", "queued", "verifying"] as const;
export const TASK_RECOVERY_EXECUTION_STATUSES = ["paused", "failed"] as const;

export type TaskRecoveryActionCode = (typeof TASK_RECOVERY_ACTION_CODES)[number];

export function isSamePlanTaskRecoveryPending(input: {
  outcome: unknown;
  recoveryState: unknown;
  nextActionCode: unknown;
  resumable: unknown;
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
    && input.executionCorrelationId === input.taskCorrelationId;
}
