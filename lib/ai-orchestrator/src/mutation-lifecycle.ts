import {
  classifyValidationFailure,
  type ValidationFailureKind,
  type ValidationResult,
} from "./validation-result.js";

export type MutationTaskKind =
  | "feature"
  | "repair"
  | "configuration"
  | "browser"
  | "runtime";

export type MutationLifecycleStage =
  | "READING"
  | "PLANNED"
  | "PROPOSED"
  | "AWAITING_APPROVAL"
  | "APPLYING"
  | "VALIDATING"
  | "REPAIRING"
  | "DELIVERED"
  | "BLOCKED"
  | "FAILED";

export type MutationRepairAction =
  | "DELIVER"
  | "REPAIR_CANDIDATE"
  | "RETRY_VALIDATION"
  | "REVIEW"
  | "STOP";

export type MutationRepairDecision = {
  action: MutationRepairAction;
  failureKind: ValidationFailureKind;
  nextStage: Extract<MutationLifecycleStage, "DELIVERED" | "REPAIRING" | "VALIDATING" | "BLOCKED" | "FAILED">;
  retryable: boolean;
  attempt: number;
  maxAttempts: number;
  reason: string;
};

export type MutationLifecyclePlan = {
  version: 1;
  taskKind: MutationTaskKind;
  operationId: string;
  revision: string;
  approvalRequired: boolean;
  validationRequired: boolean;
  stage: MutationLifecycleStage;
};

export function createMutationLifecyclePlan(input: {
  taskKind: MutationTaskKind;
  operationId: string;
  revision: string;
  approvalRequired?: boolean;
  validationRequired?: boolean;
}): MutationLifecyclePlan {
  return {
    version: 1,
    taskKind: input.taskKind,
    operationId: input.operationId,
    revision: input.revision,
    approvalRequired: input.approvalRequired ?? true,
    validationRequired: input.validationRequired ?? true,
    stage: "READING",
  };
}

export function decideMutationRepair(input: {
  result: Pick<
    ValidationResult,
    "status" | "terminalState" | "reasonCode" | "detail" | "exitCode" | "failureKind"
  >;
  attempt: number;
  maxAttempts: number;
}): MutationRepairDecision {
  const attempt = Math.max(0, Math.floor(input.attempt));
  const maxAttempts = Math.max(1, Math.floor(input.maxAttempts));
  const failureKind = input.result.failureKind ?? classifyValidationFailure(input.result);

  if (input.result.status === "passed") {
    return {
      action: "DELIVER",
      failureKind: "none",
      nextStage: "DELIVERED",
      retryable: false,
      attempt,
      maxAttempts,
      reason: "Server-owned validation passed with a complete result.",
    };
  }

  if (failureKind === "candidate" && attempt < maxAttempts) {
    return {
      action: "REPAIR_CANDIDATE",
      failureKind,
      nextStage: "REPAIRING",
      retryable: true,
      attempt,
      maxAttempts,
      reason: "The candidate failed a registered check and has remaining bounded repair attempts.",
    };
  }

  if (failureKind === "timeout" && attempt < maxAttempts) {
    return {
      action: "RETRY_VALIDATION",
      failureKind,
      nextStage: "VALIDATING",
      retryable: true,
      attempt,
      maxAttempts,
      reason: "Validation timed out; retry validation without changing the approved candidate.",
    };
  }

  if (failureKind === "cancelled") {
    return {
      action: "STOP",
      failureKind,
      nextStage: "FAILED",
      retryable: false,
      attempt,
      maxAttempts,
      reason: "Validation was cancelled and must not trigger an automatic repair.",
    };
  }

  return {
    action: "REVIEW",
    failureKind,
    nextStage: "BLOCKED",
    retryable: false,
    attempt,
    maxAttempts,
    reason: input.result.detail?.trim().slice(0, 240)
      || "Validation did not produce evidence that authorizes repair or delivery.",
  };
}

export function lifecycleStageAfterApproval(input: {
  plan: MutationLifecyclePlan;
  approved: boolean;
}): MutationLifecycleStage {
  if (!input.approved) return "BLOCKED";
  return input.plan.validationRequired ? "APPLYING" : "DELIVERED";
}