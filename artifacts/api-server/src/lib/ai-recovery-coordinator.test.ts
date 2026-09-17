import { describe, expect, it } from "vitest";
import {
  planChatRecovery,
  planTaskRecovery,
  type ChatRecoveryCandidate,
  type TaskRecoveryCandidate,
} from "./ai-recovery-coordinator.js";

function candidate(overrides: Partial<TaskRecoveryCandidate> = {}): TaskRecoveryCandidate {
  return {
    taskId: "task-1",
    taskProjectId: "project-1",
    taskStatus: "verifying",
    prompt: "Review the task",
    retryCount: 0,
    maxRetries: 3,
    executionId: "execution-1",
    executionProjectId: "project-1",
    executionLinkedTaskId: "task-1",
    executionStatus: "failed",
    executionAttempt: 2,
    userId: "user-1",
    action: "RETRY_AFTER_TIMEOUT",
    resumable: 0,
    disposition: { recoveryState: "REQUIRED" },
    sourceRevision: "revision-1",
    projectRevision: "revision-1",
    ...overrides,
  };
}

function chatCandidate(overrides: Partial<ChatRecoveryCandidate> = {}): ChatRecoveryCandidate {
  return {
    executionId: "execution-chat-1",
    executionProjectId: "project-1",
    executionStatus: "failed",
    executionAttempt: 0,
    userId: "user-1",
    action: "RESUME_ALLOWED",
    reasonCode: "MODEL_OUTPUT_INVALID",
    resumable: 1,
    disposition: { recoveryState: "REQUIRED" },
    sourceRevision: "revision-1",
    projectRevision: "revision-1",
    request: JSON.stringify({
      projectId: "project-1",
      turnIntent: "CHAT",
      sessionId: "session-1",
      message: "Explain this",
      modelMessage: "Explain this",
      validationTargetPaths: [],
    }),
    ...overrides,
  };
}

describe("automatic task recovery admission", () => {
  it("creates a stable retry identity and preserves the retry budget fence", () => {
    const first = planTaskRecovery(candidate(), 1_000);
    const second = planTaskRecovery(candidate(), 1_000);

    expect(first).toEqual(second);
    expect(first).toMatchObject({
      kind: "retry",
      expectedRetryCount: 0,
      queueKey: "ai-recovery:task-1:execution-1:2:retry:0",
    });
  });

  it("rejects cross-project or cross-task execution scope", () => {
    expect(planTaskRecovery(candidate({ executionProjectId: "other-project" }))).toEqual({
      kind: "skip",
      reason: "invalid_scope",
    });
    expect(planTaskRecovery(candidate({ executionLinkedTaskId: "other-task" }))).toEqual({
      kind: "skip",
      reason: "invalid_scope",
    });
  });

  it("rejects an exhausted task before scheduling a provider call", () => {
    expect(planTaskRecovery(candidate({ retryCount: 3, maxRetries: 3 }))).toEqual({
      kind: "skip",
      reason: "budget_exhausted",
    });
  });

  it("does not schedule a rate-limit retry before its durable retryAt", () => {
    expect(planTaskRecovery(candidate({
      action: "RETRY_AFTER_RATE_LIMIT",
      disposition: {
        recoveryState: "REQUIRED",
        retryAt: "2026-09-17T12:00:10.000Z",
      },
    }), Date.parse("2026-09-17T12:00:00.000Z"))).toEqual({
      kind: "skip",
      reason: "retry_not_due",
    });

    expect(planTaskRecovery(candidate({
      action: "RETRY_AFTER_RATE_LIMIT",
      disposition: {
        recoveryState: "REQUIRED",
        retryAt: "2026-09-17T12:00:10.000Z",
      },
    }), Date.parse("2026-09-17T12:00:10.000Z"))).toMatchObject({
      kind: "retry",
      action: "RETRY_AFTER_RATE_LIMIT",
    });
  });

  it("allows resume only for an authorized, same-revision execution", () => {
    expect(planTaskRecovery(candidate({
      action: "RESUME_ALLOWED",
      resumable: 1,
      executionStatus: "paused",
    }))).toMatchObject({
      kind: "resume",
      queueKey: "ai-recovery:task-1:execution-1:2:resume",
    });

    expect(planTaskRecovery(candidate({
      action: "RESUME_ALLOWED",
      resumable: 1,
      sourceRevision: "old-revision",
    }))).toEqual({
      kind: "skip",
      reason: "revision_changed",
    });
  });

  it("keeps resumable project-query recovery bound to its persisted revision", () => {
    const request = {
      projectId: "project-1",
      turnIntent: "PROJECT_QUERY",
      message: "Explain the project flow",
      modelMessage: "Explain the project flow",
      sessionId: "session-1",
      workspaceRevision: "revision-1",
      validationTargetPaths: [],
      proofRequired: true,
      resumeContract: {
        taskType: "BEHAVIOR_QUERY",
        outputContract: "BEHAVIOR_ANSWER",
        contextProfile: "project_query",
        sessionId: "session-1",
        projectRevision: "revision-1",
        requiresEvidence: true,
        scope: {
          projectId: "project-1",
          rootPath: null,
          linkedTaskId: null,
        },
      },
    };
    const base = {
      executionId: "execution-chat-1",
      executionProjectId: "project-1",
      executionStatus: "failed",
      executionAttempt: 1,
      userId: "user-1",
      action: "RESUME_ALLOWED",
      reasonCode: "EXECUTION_PROVIDER_FAILURE",
      resumable: 1,
      disposition: { recoveryState: "REQUIRED" },
      sourceRevision: "revision-1",
      projectRevision: "revision-1",
      request: JSON.stringify(request),
    } as const;

    expect(planChatRecovery(base)).toEqual({
      kind: "resume",
      action: "RESUME_ALLOWED",
      executionId: "execution-chat-1",
      executionAttempt: 1,
      delayMs: 0,
      queueKey: "ai-recovery:chat:execution-chat-1:1:resume",
    });
    expect(planChatRecovery({
      ...base,
      projectRevision: "revision-2",
    })).toEqual({
      kind: "skip",
      reason: "revision_changed",
    });

    expect(planChatRecovery({
      ...base,
      action: "RETRY_AFTER_TIMEOUT",
      resumable: 0,
      disposition: {
        recoveryState: "REQUIRED",
        retryAt: "2020-01-01T00:00:00.000Z",
      },
    })).toEqual({
      kind: "retry",
      action: "RETRY_AFTER_TIMEOUT",
      executionId: "execution-chat-1",
      executionAttempt: 1,
      delayMs: 0,
      queueKey: "ai-recovery:chat:execution-chat-1:1:retry",
    });
  });

  it("automatically recovers only ordinary chat parser failures", () => {
    expect(planChatRecovery(chatCandidate())).toMatchObject({
      kind: "resume",
      action: "RESUME_ALLOWED",
      queueKey: "ai-recovery:chat:execution-chat-1:0:resume",
    });

    expect(planChatRecovery(chatCandidate({
      reasonCode: "EXECUTION_PROVIDER_FAILURE",
    })).kind).toBe("skip");
    const blocked = planChatRecovery(chatCandidate({
      reasonCode: "MODEL_OUTPUT_INVALID",
      resumable: 0,
    }));
    expect(blocked).toMatchObject({
      kind: "skip",
      reason: "not_a_resumable_turn",
    });
    expect(planChatRecovery(chatCandidate({
      executionAttempt: 1,
    }))).toMatchObject({
      kind: "skip",
      reason: "not_a_resumable_turn",
    });
  });
});