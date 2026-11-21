import { describe, expect, it } from "vitest";
import {
  decideTaskContinuation,
  isTaskAutoExecutionIntentPending,
  isSamePlanTaskRecoveryPending,
} from "./task-recovery-contract.js";

const baseTask = {
  taskId: "task-1",
  taskProjectId: "project-1",
  taskStatus: "verifying",
  prompt: "Continue the existing task.",
  retryCount: 1,
  maxRetries: 3,
  taskCorrelationId: "generation-1",
};

const deferredOutbox = {
  eventType: "TaskAutoExecutionDeferred",
  eventProjectId: "project-1",
  eventTaskId: "task-1",
  eventPayload: {
    userId: "user-1",
    taskRetryCount: 1,
    taskCorrelationId: "generation-1",
    attemptCount: 2,
    nextAttemptAt: "2999-01-01T00:00:00.000Z",
  },
};

describe("shared Task continuation contract", () => {
  it("keeps a current accepted recovery pending while its retry window is in the future", () => {
    expect(isSamePlanTaskRecoveryPending({
      outcome: "FAILED",
      recoveryState: "REQUIRED",
      nextActionCode: "RETRY_AFTER_TIMEOUT",
      resumable: 0,
      retryAt: "2999-01-01T00:00:00.000Z",
      taskStatus: baseTask.taskStatus,
      prompt: baseTask.prompt,
      retryCount: baseTask.retryCount,
      maxRetries: baseTask.maxRetries,
      executionStatus: "failed",
      taskCorrelationId: baseTask.taskCorrelationId,
      executionCorrelationId: baseTask.taskCorrelationId,
    })).toBe(true);
  });

  it("recognizes Outbox intent only when its identity matches the current Task generation", () => {
    expect(isTaskAutoExecutionIntentPending({
      ...deferredOutbox,
      ...baseTask,
      taskRetryCount: baseTask.retryCount,
    })).toBe(true);

    expect(isTaskAutoExecutionIntentPending({
      ...deferredOutbox,
      ...baseTask,
      taskRetryCount: baseTask.retryCount,
      eventPayload: { ...deferredOutbox.eventPayload, taskCorrelationId: "old-generation" },
    })).toBe(false);

    expect(isTaskAutoExecutionIntentPending({
      ...deferredOutbox,
      ...baseTask,
      taskRetryCount: baseTask.retryCount,
      eventPayload: { ...deferredOutbox.eventPayload, taskRetryCount: 0 },
    })).toBe(false);
  });

  it("rejects provider-quota retries that require an operator action", () => {
    expect(isSamePlanTaskRecoveryPending({
      outcome: "FAILED",
      recoveryState: "REQUIRED",
      nextActionCode: "RETRY_AFTER_RATE_LIMIT",
      resumable: 0,
      retryAt: "2999-01-01T00:00:00.000Z",
      failureKind: "QUOTA_EXHAUSTED",
      retryAfterSource: "provider",
      rateLimitScope: "provider",
      taskStatus: baseTask.taskStatus,
      prompt: baseTask.prompt,
      retryCount: baseTask.retryCount,
      maxRetries: baseTask.maxRetries,
      executionStatus: "failed",
      taskCorrelationId: baseTask.taskCorrelationId,
      executionCorrelationId: baseTask.taskCorrelationId,
    })).toBe(false);
  });

  it("prioritizes a running Task, its active execution, or accepted recovery over replanning", () => {
    expect(decideTaskContinuation({
      task: { ...baseTask, taskStatus: "running" },
    })).toEqual({ kind: "continue", via: "active_task" });

    expect(decideTaskContinuation({
      task: baseTask,
      execution: { status: "running", correlationId: "generation-1" },
    })).toEqual({ kind: "continue", via: "active_execution" });

    expect(decideTaskContinuation({
      task: { ...baseTask, taskStatus: "failed" },
      execution: { status: "running", correlationId: "generation-1" },
    })).toEqual({ kind: "continue", via: "active_execution" });

    expect(decideTaskContinuation({
      task: baseTask,
      execution: { status: "failed", correlationId: "generation-1" },
      acceptance: {
        outcome: "FAILED",
        recoveryState: "REQUIRED",
        nextActionCode: "RESUME_ALLOWED",
        resumable: 1,
      },
    })).toEqual({ kind: "continue", via: "accepted_recovery" });
  });

  it("keeps a future deferred Outbox alive but allows replanning after generation mismatch", () => {
    expect(decideTaskContinuation({
      task: baseTask,
      outbox: deferredOutbox,
    })).toEqual({ kind: "continue", via: "task_outbox" });

    expect(decideTaskContinuation({
      task: baseTask,
      outbox: {
        ...deferredOutbox,
        eventPayload: {
          ...deferredOutbox.eventPayload,
          taskRetryCount: 0,
          taskCorrelationId: "old-generation",
        },
      },
    })).toEqual({ kind: "replan", reason: "no_current_task_continuation" });
  });
});
