import { describe, expect, it } from "vitest";
import {
  createMutationLifecyclePlan,
  decideMutationRepair,
  lifecycleStageAfterApproval,
} from "../mutation-lifecycle.js";

const result = (overrides: Record<string, unknown> = {}) => ({
  status: "failed" as const,
  terminalState: "failed" as const,
  reasonCode: undefined,
  detail: "candidate failed",
  exitCode: 1,
  ...overrides,
});

describe("mutation lifecycle", () => {
  it("keeps approval and validation as explicit stages", () => {
    const plan = createMutationLifecyclePlan({
      taskKind: "configuration",
      operationId: "operation-1",
      revision: "revision-1",
    });
    expect(plan.stage).toBe("READING");
    expect(lifecycleStageAfterApproval({ plan, approved: false })).toBe("BLOCKED");
    expect(lifecycleStageAfterApproval({ plan, approved: true })).toBe("APPLYING");
  });

  it("repairs only candidate failures within the bounded budget", () => {
    expect(decideMutationRepair({
      result: result({ failureKind: "candidate" }),
      attempt: 1,
      maxAttempts: 3,
    })).toMatchObject({
      action: "REPAIR_CANDIDATE",
      nextStage: "REPAIRING",
      retryable: true,
    });
  });

  it("retries validation, rather than mutating, after timeout", () => {
    expect(decideMutationRepair({
      result: result({
        failureKind: "timeout",
        terminalState: "timed_out",
        exitCode: null,
      }),
      attempt: 1,
      maxAttempts: 3,
    })).toMatchObject({
      action: "RETRY_VALIDATION",
      nextStage: "VALIDATING",
      retryable: true,
    });
  });

  it("blocks unavailable, scope, and exhausted failures", () => {
    expect(decideMutationRepair({
      result: result({ failureKind: "unavailable", exitCode: null }),
      attempt: 1,
      maxAttempts: 3,
    }).action).toBe("REVIEW");
    expect(decideMutationRepair({
      result: result({ failureKind: "candidate" }),
      attempt: 3,
      maxAttempts: 3,
    }).action).toBe("REVIEW");
  });
});