/**
 * The exact acceptance actions that the autonomous Task recovery coordinator
 * is authorized to continue on the same Task/Execution generation.
 *
 * Keep this contract shared with Mission projection so a recoverable Task
 * failure does not get converted into a fresh Mission plan before this path
 * has had its bounded recovery opportunity.
 */
export const TASK_RECOVERY_ACTION_CODES = [
  "RESUME_ALLOWED",
  "RETRY_AFTER_TIMEOUT",
  "RETRY_AFTER_RATE_LIMIT",
] as const;

export type TaskRecoveryActionCode = (typeof TASK_RECOVERY_ACTION_CODES)[number];

export function isSamePlanTaskRecoveryPending(input: {
  outcome: unknown;
  recoveryState: unknown;
  nextActionCode: unknown;
}): boolean {
  return input.outcome === "FAILED"
    && input.recoveryState === "REQUIRED"
    && typeof input.nextActionCode === "string"
    && (TASK_RECOVERY_ACTION_CODES as readonly string[]).includes(input.nextActionCode);
}
