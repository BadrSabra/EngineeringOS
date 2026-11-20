export const TASK_RECOVERY_ACTION_CODES = [
  "WAIT_FOR_PROVIDER_WINDOW",
  "CHECK_PROVIDER_AND_RESUME",
  "REFRESH_CONTEXT_AND_RESUME",
  "REVIEW_TASK_INPUT_AND_RESUME",
  "REPAIR_AND_REVALIDATE",
  "REFRESH_REVISION_AND_REVALIDATE",
  "RECONCILE_TOOL_EFFECT",
  "RESTORE_ACCESS_AND_REAUTHORIZE",
  "SUPPLY_OBJECTIVE_EVIDENCE_OR_REPLAN",
  "RESTORE_VALIDATOR_AND_REVALIDATE",
  "INSPECT_EXECUTION_STATE",
  "DO_NOT_RETRY",
] as const;

export type TaskRecoveryActionCode = (typeof TASK_RECOVERY_ACTION_CODES)[number];

export type TaskRecoveryExecutionPolicy =
  | "NEVER_AUTOMATIC"
  | "SERVER_ACCEPTANCE_REQUIRED"
  | "WAIT_FOR_SERVER_WINDOW_AND_ACCEPTANCE"
  | "OPERATOR_REPAIR_THEN_SERVER_ACCEPTANCE"
  | "EVIDENCE_RECONCILIATION_THEN_SERVER_ACCEPTANCE";

export type TaskRecoveryEvidenceRequirement =
  | "NONE"
  | "SERVER_ACCEPTANCE"
  | "FRESH_CONTEXT"
  | "VALIDATION_RECEIPT"
  | "CURRENT_REVISION"
  | "TOOL_EFFECT_RECONCILIATION"
  | "CURRENT_AUTHORIZATION"
  | "OBJECTIVE_PROOF"
  | "VALIDATOR_AVAILABILITY";

export type TaskRecoveryDecision = {
  schemaVersion: 1;
  actionCode: TaskRecoveryActionCode;
  executionPolicy: TaskRecoveryExecutionPolicy;
  evidenceRequired: TaskRecoveryEvidenceRequirement;
  /** A recommendation only; it never grants permission to execute or resume. */
  authority: "ADVISORY_ONLY";
};

export type TaskRecoveryDecisionInput = {
  code: string;
  reasonCode?: string;
  failureClass?: string;
  retryable: boolean;
  cancelled?: boolean;
};

function normalizedCode(value: string | undefined): string {
  return value?.trim().toUpperCase() ?? "";
}

function decision(
  actionCode: TaskRecoveryActionCode,
  executionPolicy: TaskRecoveryExecutionPolicy,
  evidenceRequired: TaskRecoveryEvidenceRequirement,
): TaskRecoveryDecision {
  return {
    schemaVersion: 1,
    actionCode,
    executionPolicy,
    evidenceRequired,
    authority: "ADVISORY_ONLY",
  };
}

/**
 * Translate a server-classified Task failure into a bounded recovery recipe.
 *
 * This projection is descriptive, not an authorization decision. In
 * particular, "resume" actions remain subject to the current persisted
 * Acceptance, execution/attempt identity, project ownership, Task state,
 * lease/dependency fences, and retry window checked by the route.
 */
export function resolveTaskRecoveryDecision(
  input: TaskRecoveryDecisionInput,
): TaskRecoveryDecision {
  const code = normalizedCode(input.code);
  const reasonCode = normalizedCode(input.reasonCode);
  const failureClass = normalizedCode(input.failureClass);

  if (
    input.cancelled === true
    || code === "CANCELLED"
    || reasonCode === "EXECUTION_CANCELLED"
  ) {
    return decision("DO_NOT_RETRY", "NEVER_AUTOMATIC", "NONE");
  }

  if (
    code === "MISSION_TOOL_OUTCOME_UNCERTAIN"
    || reasonCode === "MISSION_TOOL_OUTCOME_UNCERTAIN"
    || failureClass === "TOOL"
  ) {
    return decision(
      "RECONCILE_TOOL_EFFECT",
      "EVIDENCE_RECONCILIATION_THEN_SERVER_ACCEPTANCE",
      "TOOL_EFFECT_RECONCILIATION",
    );
  }

  if (
    code === "MISSION_VALIDATOR_UNAVAILABLE"
    || reasonCode === "MISSION_VALIDATOR_UNAVAILABLE"
  ) {
    return decision(
      "RESTORE_VALIDATOR_AND_REVALIDATE",
      "OPERATOR_REPAIR_THEN_SERVER_ACCEPTANCE",
      "VALIDATOR_AVAILABILITY",
    );
  }

  if (
    code === "MISSION_OBJECTIVE_NOT_PROVEN"
    || reasonCode === "MISSION_OBJECTIVE_NOT_PROVEN"
    || failureClass === "OBJECTIVE_INCOMPLETE"
  ) {
    return decision(
      "SUPPLY_OBJECTIVE_EVIDENCE_OR_REPLAN",
      "OPERATOR_REPAIR_THEN_SERVER_ACCEPTANCE",
      "OBJECTIVE_PROOF",
    );
  }

  if (failureClass === "PERMISSION" || failureClass === "OWNERSHIP") {
    return decision(
      "RESTORE_ACCESS_AND_REAUTHORIZE",
      "OPERATOR_REPAIR_THEN_SERVER_ACCEPTANCE",
      "CURRENT_AUTHORIZATION",
    );
  }

  if (failureClass === "REVISION_CONFLICT" || code.includes("REVISION_CONFLICT")) {
    return decision(
      "REFRESH_REVISION_AND_REVALIDATE",
      "OPERATOR_REPAIR_THEN_SERVER_ACCEPTANCE",
      "CURRENT_REVISION",
    );
  }

  if (failureClass === "QUALITY_GATE" || failureClass === "VALIDATION") {
    return decision(
      "REPAIR_AND_REVALIDATE",
      "OPERATOR_REPAIR_THEN_SERVER_ACCEPTANCE",
      "VALIDATION_RECEIPT",
    );
  }

  if (
    code === "PROVIDER_RATE_LIMITED"
    || code === "PROVIDER_QUOTA_LIMITED"
  ) {
    return input.retryable
      ? decision(
          "WAIT_FOR_PROVIDER_WINDOW",
          "WAIT_FOR_SERVER_WINDOW_AND_ACCEPTANCE",
          "SERVER_ACCEPTANCE",
        )
      : decision("INSPECT_EXECUTION_STATE", "NEVER_AUTOMATIC", "SERVER_ACCEPTANCE");
  }

  if (!input.retryable) {
    return decision("INSPECT_EXECUTION_STATE", "NEVER_AUTOMATIC", "SERVER_ACCEPTANCE");
  }

  if (failureClass === "MALFORMED_OUTPUT" || code === "MODEL_OUTPUT_INVALID") {
    return decision(
      "REVIEW_TASK_INPUT_AND_RESUME",
      "OPERATOR_REPAIR_THEN_SERVER_ACCEPTANCE",
      "SERVER_ACCEPTANCE",
    );
  }

  if (failureClass === "CONTEXT" || code === "CONTEXT_BUILD_FAILED") {
    return decision(
      "REFRESH_CONTEXT_AND_RESUME",
      "SERVER_ACCEPTANCE_REQUIRED",
      "FRESH_CONTEXT",
    );
  }

  if (failureClass === "PROVIDER" || code === "PROVIDER_CALL_FAILED") {
    return decision(
      "CHECK_PROVIDER_AND_RESUME",
      "SERVER_ACCEPTANCE_REQUIRED",
      "SERVER_ACCEPTANCE",
    );
  }

  return decision("INSPECT_EXECUTION_STATE", "SERVER_ACCEPTANCE_REQUIRED", "SERVER_ACCEPTANCE");
}
