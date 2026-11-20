import { describe, expect, it } from "vitest";
import {
  resolveTaskRecoveryDecision,
  type TaskRecoveryDecisionInput,
} from "./task-recovery-decision.js";

function resolve(overrides: Partial<TaskRecoveryDecisionInput> = {}) {
  return resolveTaskRecoveryDecision({
    code: "task_execution_failed",
    failureClass: "internal",
    retryable: true,
    ...overrides,
  });
}

describe("Task recovery decision projection", () => {
  it.each([
    {
      name: "waits for the provider window and the server acceptance gate",
      input: { code: "provider_rate_limited", failureClass: "provider" },
      actionCode: "WAIT_FOR_PROVIDER_WINDOW",
      executionPolicy: "WAIT_FOR_SERVER_WINDOW_AND_ACCEPTANCE",
      evidenceRequired: "SERVER_ACCEPTANCE",
    },
    {
      name: "does not translate quota exhaustion into provider switching",
      input: { code: "provider_quota_limited", failureClass: "provider" },
      actionCode: "WAIT_FOR_PROVIDER_WINDOW",
      executionPolicy: "WAIT_FOR_SERVER_WINDOW_AND_ACCEPTANCE",
      evidenceRequired: "SERVER_ACCEPTANCE",
    },
    {
      name: "refreshes context before an acceptance-gated resume",
      input: { code: "context_build_failed", failureClass: "context" },
      actionCode: "REFRESH_CONTEXT_AND_RESUME",
      executionPolicy: "SERVER_ACCEPTANCE_REQUIRED",
      evidenceRequired: "FRESH_CONTEXT",
    },
    {
      name: "routes malformed output through operator review and acceptance",
      input: { code: "model_output_invalid", failureClass: "malformed_output" },
      actionCode: "REVIEW_TASK_INPUT_AND_RESUME",
      executionPolicy: "OPERATOR_REPAIR_THEN_SERVER_ACCEPTANCE",
      evidenceRequired: "SERVER_ACCEPTANCE",
    },
    {
      name: "requires a validation receipt after a quality failure",
      input: { code: "quality_review_low", failureClass: "quality_gate" },
      actionCode: "REPAIR_AND_REVALIDATE",
      executionPolicy: "OPERATOR_REPAIR_THEN_SERVER_ACCEPTANCE",
      evidenceRequired: "VALIDATION_RECEIPT",
    },
    {
      name: "refreshes the current revision before revalidation",
      input: { code: "workspace_revision_conflict", failureClass: "revision_conflict" },
      actionCode: "REFRESH_REVISION_AND_REVALIDATE",
      executionPolicy: "OPERATOR_REPAIR_THEN_SERVER_ACCEPTANCE",
      evidenceRequired: "CURRENT_REVISION",
    },
    {
      name: "requires current authorization after permission failures",
      input: { code: "task_permission_denied", failureClass: "permission" },
      actionCode: "RESTORE_ACCESS_AND_REAUTHORIZE",
      executionPolicy: "OPERATOR_REPAIR_THEN_SERVER_ACCEPTANCE",
      evidenceRequired: "CURRENT_AUTHORIZATION",
    },
    {
      name: "requires proof or replanning when the objective is incomplete",
      input: {
        code: "task_execution_failed",
        reasonCode: "MISSION_OBJECTIVE_NOT_PROVEN",
        failureClass: "objective_incomplete",
      },
      actionCode: "SUPPLY_OBJECTIVE_EVIDENCE_OR_REPLAN",
      executionPolicy: "OPERATOR_REPAIR_THEN_SERVER_ACCEPTANCE",
      evidenceRequired: "OBJECTIVE_PROOF",
    },
    {
      name: "restores an unavailable validator before revalidation",
      input: { code: "mission_validator_unavailable", failureClass: "objective_incomplete" },
      actionCode: "RESTORE_VALIDATOR_AND_REVALIDATE",
      executionPolicy: "OPERATOR_REPAIR_THEN_SERVER_ACCEPTANCE",
      evidenceRequired: "VALIDATOR_AVAILABILITY",
    },
    {
      name: "reconciles uncertain tool effects before any successor attempt",
      input: { code: "mission_tool_outcome_uncertain", failureClass: "tool", retryable: false },
      actionCode: "RECONCILE_TOOL_EFFECT",
      executionPolicy: "EVIDENCE_RECONCILIATION_THEN_SERVER_ACCEPTANCE",
      evidenceRequired: "TOOL_EFFECT_RECONCILIATION",
    },
  ] as const)(
    "$name",
    ({ input, actionCode, executionPolicy, evidenceRequired }) => {
      const result = resolve(input);

      expect(result).toEqual({
        schemaVersion: 1,
        actionCode,
        executionPolicy,
        evidenceRequired,
        authority: "ADVISORY_ONLY",
      });
    },
  );

  it("never recommends a retry for a cancellation", () => {
    expect(resolve({
      code: "cancelled",
      reasonCode: "EXECUTION_CANCELLED",
      cancelled: true,
      retryable: false,
    })).toEqual({
      schemaVersion: 1,
      actionCode: "DO_NOT_RETRY",
      executionPolicy: "NEVER_AUTOMATIC",
      evidenceRequired: "NONE",
      authority: "ADVISORY_ONLY",
    });
  });

  it("fails closed when a failure is not retryable", () => {
    expect(resolve({
      code: "provider_call_failed",
      failureClass: "provider",
      retryable: false,
    })).toMatchObject({
      actionCode: "INSPECT_EXECUTION_STATE",
      executionPolicy: "NEVER_AUTOMATIC",
      evidenceRequired: "SERVER_ACCEPTANCE",
      authority: "ADVISORY_ONLY",
    });

    expect(resolve({
      code: "context_build_failed",
      failureClass: "context",
      retryable: false,
    })).toMatchObject({
      actionCode: "INSPECT_EXECUTION_STATE",
      executionPolicy: "NEVER_AUTOMATIC",
    });
  });

  it("does not make retryable failures self-authorizing", () => {
    const result = resolve({
      code: "provider_call_failed",
      failureClass: "provider",
      retryable: true,
    });

    expect(result.authority).toBe("ADVISORY_ONLY");
    expect(result.executionPolicy).toBe("SERVER_ACCEPTANCE_REQUIRED");
    expect(result).not.toHaveProperty("canExecute");
    expect(result).not.toHaveProperty("resumeAllowed");
  });

  it("uses a safe inspection fallback for unknown failure categories", () => {
    expect(resolve({
      code: "new_unclassified_failure",
      failureClass: "future_class",
      retryable: true,
    })).toMatchObject({
      actionCode: "INSPECT_EXECUTION_STATE",
      executionPolicy: "SERVER_ACCEPTANCE_REQUIRED",
      evidenceRequired: "SERVER_ACCEPTANCE",
      authority: "ADVISORY_ONLY",
    });
  });
});
