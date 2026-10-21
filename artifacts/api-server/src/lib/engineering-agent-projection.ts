export const engineeringAgentStates = [
  "PLANNING",
  "WORKING",
  "VERIFYING",
  "AWAITING_APPROVAL",
  "RECOVERING",
  "DELIVERING",
  "COMPLETE",
  "NEEDS_ATTENTION",
] as const;

export const engineeringAgentActions = [
  "START",
  "AUTO_CONTINUE",
  "RESUME",
  "RETRY",
  "APPROVE",
  "REPLAN",
  "REVIEW",
  "STOP",
  "NONE",
] as const;

export const engineeringAgentReasonCodes = [
  "mission_draft",
  "mission_cancelled",
  "mission_blocked",
  "mission_not_active",
  "plan_revision_mismatch",
  "approval_pending",
  "required_evidence_incomplete",
  "required_evidence_unavailable",
  "required_evidence_stale",
  "acceptance_blocked",
  "verification_in_progress",
  "execution_in_progress",
  "execution_queued",
  "goal_waiting_for_event",
  "continuation_authorized",
  "execution_resumable",
  "execution_retryable",
  "delivery_review_required",
  "mission_proven_complete",
  "no_active_goal",
  "goal_requires_replan",
  "state_unresolved",
] as const;

export type EngineeringAgentState = typeof engineeringAgentStates[number];
export type EngineeringAgentAction = typeof engineeringAgentActions[number];
export type EngineeringAgentReasonCode = typeof engineeringAgentReasonCodes[number];
export type EngineeringAgentTargetKind = "mission" | "goal" | "execution" | "proposal";
export type EngineeringAgentInterventionKind =
  | "none"
  | "approval"
  | "review"
  | "recovery"
  | "scope"
  | "delivery";

export type EngineeringAgentProjection = {
  schemaVersion: 2;
  state: EngineeringAgentState;
  nextAction: {
    kind: EngineeringAgentAction;
    target: { kind: EngineeringAgentTargetKind; id: string } | null;
    reasonCode: EngineeringAgentReasonCode;
  };
  availableCommands: Array<{
    kind: "STOP";
    target: { kind: "execution"; id: string };
    reasonCode: EngineeringAgentReasonCode;
  }>;
  intervention: {
    required: boolean;
    kind: EngineeringAgentInterventionKind;
    reasonCode: EngineeringAgentReasonCode | null;
  };
  autonomy: {
    mode: "assisted" | "autonomous";
    allowAutoContinue: boolean;
    allowAutoApply: boolean;
    allowAutoCommit: boolean;
    allowAutoPush: boolean;
    requireHumanForExternalDelivery: boolean;
    maxAutoReplans: number;
  };
  missionId: string;
  sessionId: string | null;
  goalId: string | null;
  executionId: string | null;
};

export type EngineeringAgentAcceptanceFact = {
  outcome: string;
  terminalStatus: string;
  nextActionCode: string;
  evidenceRequired: boolean;
  evidenceComplete: boolean;
  resumable: boolean;
};

export type EngineeringAgentGoalFact = {
  id: string;
  status: string;
  nextAction?: { kind: string; reason?: string } | null;
  currentExecution?: {
    id: string;
    status: string;
    cancelRequested?: boolean;
    acceptance: EngineeringAgentAcceptanceFact | null;
  } | null;
  canonicalProof?: {
    accepted: boolean;
    verdict: string;
    executionId: string | null;
    matchesCurrentAttempt: boolean;
    failureReasons: string[];
  } | null;
  approval?: {
    pending: boolean;
    proposalId: string | null;
  };
  delivery?: {
    required: boolean;
    receiptPresent: boolean;
  };
  runtimeContinuationAuthorized?: boolean;
};

export type EngineeringAgentProjectionContext = {
  missionId: string;
  sessionId: string | null;
  missionStatus: string;
  planBinding: string;
  /** The active plan's persisted topological order, used to select among Goals. */
  planGoalOrder?: string[];
  goals: EngineeringAgentGoalFact[];
  missionCompletionAccepted: boolean | null;
  autonomyPolicy: unknown;
};

type Decision = {
  state: EngineeringAgentState;
  action: EngineeringAgentAction;
  reasonCode: EngineeringAgentReasonCode;
  interventionKind: EngineeringAgentInterventionKind;
  target: { kind: EngineeringAgentTargetKind; id: string } | null;
  goal?: EngineeringAgentGoalFact;
  interventionRequired?: boolean;
};

const MAX_AUTO_REPLANS = 10;

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function normalizeAutonomyPolicy(value: unknown): EngineeringAgentProjection["autonomy"] {
  const policy = isRecord(value) ? value : {};
  const validMode = policy.mode === "assisted" || policy.mode === "autonomous";
  const mode = policy.mode === "autonomous" ? "autonomous" : "assisted";
  const automatic = validMode && mode === "autonomous";
  const rawReplans = policy.maxAutoReplans;

  return {
    mode,
    allowAutoContinue: automatic && policy.allowAutoContinue === true,
    allowAutoApply: automatic && policy.allowAutoApply === true,
    allowAutoCommit: automatic && policy.allowAutoCommit === true,
    allowAutoPush: false,
    requireHumanForExternalDelivery: true,
    maxAutoReplans: automatic
      && typeof rawReplans === "number"
      && Number.isInteger(rawReplans)
      && rawReplans >= 0
      && rawReplans <= MAX_AUTO_REPLANS
      ? rawReplans
      : 0,
  };
}

function normalized(value: string | null | undefined): string {
  return (value ?? "").toLowerCase();
}

function goalTarget(goal: EngineeringAgentGoalFact): Decision["target"] {
  return { kind: "goal", id: goal.id };
}

function executionTarget(goal: EngineeringAgentGoalFact): Decision["target"] {
  return goal.currentExecution
    ? { kind: "execution", id: goal.currentExecution.id }
    : goalTarget(goal);
}

function isApprovalPending(goal: EngineeringAgentGoalFact): boolean {
  return normalized(goal.status) === "waiting_for_approval"
    || (goal.nextAction?.kind === "wait" && goal.nextAction.reason === "approval")
    || goal.approval?.pending === true;
}

function isSuccessfulTerminal(goal: EngineeringAgentGoalFact): boolean {
  return normalized(goal.status) === "completed"
    || (
      normalized(goal.currentExecution?.status) === "completed"
      && normalized(goal.status) !== "verifying"
    );
}

function hasCurrentAcceptedProof(goal: EngineeringAgentGoalFact): boolean {
  const acceptance = goal.currentExecution?.acceptance;
  return Boolean(
    normalized(goal.currentExecution?.status) === "completed"
    && acceptance
    && acceptance.outcome === "SUCCEEDED"
    && acceptance.terminalStatus === "completed"
    && goal.canonicalProof?.accepted === true
    && goal.canonicalProof.matchesCurrentAttempt === true
    && goal.canonicalProof.executionId === goal.currentExecution?.id,
  );
}

function hasAcceptanceEvidenceBlocker(goal: EngineeringAgentGoalFact): boolean {
  if (!isSuccessfulTerminal(goal)) return false;

  const acceptance = goal.currentExecution?.acceptance;
  if (!acceptance) return true;
  if (
    acceptance.outcome !== "SUCCEEDED"
    || acceptance.terminalStatus !== "completed"
  ) {
    return true;
  }
  return acceptance.evidenceRequired && !acceptance.evidenceComplete;
}

function hasCanonicalProofBlocker(goal: EngineeringAgentGoalFact): boolean {
  return isSuccessfulTerminal(goal) && !hasCurrentAcceptedProof(goal);
}

function evidenceReason(goal: EngineeringAgentGoalFact): EngineeringAgentReasonCode {
  if (!goal.currentExecution?.acceptance || !goal.canonicalProof) {
    return "required_evidence_unavailable";
  }
  if (goal.canonicalProof.failureReasons.includes("plan_revision_mismatch")) {
    return "plan_revision_mismatch";
  }
  if (goal.canonicalProof.failureReasons.some((reason) => reason.toLowerCase().includes("stale"))) {
    return "required_evidence_stale";
  }
  if (goal.canonicalProof.verdict === "UNAVAILABLE") {
    return "required_evidence_unavailable";
  }
  return goal.currentExecution.acceptance.evidenceComplete
    ? "acceptance_blocked"
    : "required_evidence_incomplete";
}

function deliveryPending(goal: EngineeringAgentGoalFact): boolean {
  return goal.delivery?.required === true
    && goal.delivery.receiptPresent !== true
    && isSuccessfulTerminal(goal);
}

function recoveryDecision(goal: EngineeringAgentGoalFact): Decision | null {
  const execution = goal.currentExecution;
  const acceptance = execution?.acceptance;
  if (!execution || !acceptance || acceptance.terminalStatus !== execution.status) return null;

  if (
    acceptance.nextActionCode === "RESUME_ALLOWED"
    && acceptance.resumable
    && ["paused", "cancelled"].includes(normalized(execution.status))
  ) {
    return {
      state: "RECOVERING",
      action: "RESUME",
      reasonCode: "execution_resumable",
      interventionKind: "recovery",
      interventionRequired: true,
      target: executionTarget(goal),
      goal,
    };
  }

  if (
    acceptance.resumable === false
    && ["RETRY_AFTER_TIMEOUT", "RETRY_AFTER_RATE_LIMIT"].includes(acceptance.nextActionCode)
    && ["failed", "cancelled"].includes(normalized(execution.status))
  ) {
    return {
      state: "RECOVERING",
      action: "RETRY",
      reasonCode: "execution_retryable",
      interventionKind: "recovery",
      interventionRequired: true,
      target: executionTarget(goal),
      goal,
    };
  }
  return null;
}

function decision(
  state: EngineeringAgentState,
  action: EngineeringAgentAction,
  reasonCode: EngineeringAgentReasonCode,
  target: Decision["target"],
  options: {
    interventionKind?: EngineeringAgentInterventionKind;
    interventionRequired?: boolean;
    goal?: EngineeringAgentGoalFact;
  } = {},
): Decision {
  return {
    state,
    action,
    reasonCode,
    target,
    interventionKind: options.interventionKind ?? "none",
    interventionRequired: options.interventionRequired ?? false,
    ...(options.goal ? { goal: options.goal } : {}),
  };
}

/**
 * Pure state reducer for the read-only Engineering Agent projection.
 *
 * Precedence is fail-closed: plan/proof binding, terminal Mission state,
 * approval, acceptance evidence, delivery, and completion gates are resolved
 * before ordinary runtime state. Within an active plan, verification/running
 * execution and an explicitly authorized recovery take precedence over
 * replanning; queued work is considered only after those gates.
 *
 * It interprets only supplied server-owned facts and never starts runtime work.
 */
export function reduceEngineeringAgentProjection(
  context: EngineeringAgentProjectionContext,
): EngineeringAgentProjection {
  const autonomy = normalizeAutonomyPolicy(context.autonomyPolicy);
  const planOrder = new Map(
    (context.planGoalOrder ?? []).map((goalId, index) => [goalId, index]),
  );
  const activeGoals = context.goals
    .filter((goal) => context.planBinding === "legacy_unversioned"
      || context.planBinding === "active_revision")
    .slice()
    .sort((left, right) => {
      const leftOrder = planOrder.get(left.id);
      const rightOrder = planOrder.get(right.id);
      if (leftOrder !== undefined || rightOrder !== undefined) {
        if (leftOrder === undefined) return 1;
        if (rightOrder === undefined) return -1;
        if (leftOrder !== rightOrder) return leftOrder - rightOrder;
      }
      return left.id.localeCompare(right.id);
    });
  const missionTarget = { kind: "mission" as const, id: context.missionId };
  let result: Decision;

  const staleProofGoal = activeGoals.find((goal) =>
    goal.canonicalProof?.failureReasons.includes("plan_revision_mismatch"),
  );
  if (context.planBinding === "revision_mismatch" || staleProofGoal) {
    result = decision(
      "NEEDS_ATTENTION",
      "REVIEW",
      "plan_revision_mismatch",
      staleProofGoal ? goalTarget(staleProofGoal) : missionTarget,
      { interventionKind: "scope", interventionRequired: true, goal: staleProofGoal },
    );
  } else if (context.missionStatus === "cancelled") {
    result = decision("NEEDS_ATTENTION", "NONE", "mission_cancelled", null);
  } else {
    const approvalGoal = activeGoals.find(isApprovalPending);
    if (approvalGoal) {
      const proposalId = approvalGoal.approval?.pending
        ? approvalGoal.approval.proposalId
        : null;
      result = decision(
        "AWAITING_APPROVAL",
        "APPROVE",
        "approval_pending",
        proposalId ? { kind: "proposal", id: proposalId } : goalTarget(approvalGoal),
        { interventionKind: "approval", interventionRequired: true, goal: approvalGoal },
      );
    } else {
      const evidenceGoal = activeGoals.find(hasAcceptanceEvidenceBlocker);
      if (evidenceGoal) {
        const reasonCode = evidenceReason(evidenceGoal);
        result = decision(
          "NEEDS_ATTENTION",
          "REVIEW",
          reasonCode,
          goalTarget(evidenceGoal),
          { interventionKind: "review", interventionRequired: true, goal: evidenceGoal },
        );
      } else {
        const deliveryGoal = activeGoals.find(deliveryPending);
        if (deliveryGoal) {
          result = decision(
            "DELIVERING",
            "REVIEW",
            "delivery_review_required",
            goalTarget(deliveryGoal),
            { interventionKind: "delivery", interventionRequired: true, goal: deliveryGoal },
          );
        } else if (activeGoals.some(hasCanonicalProofBlocker)) {
          const proofGoal = activeGoals.find(hasCanonicalProofBlocker)!;
          result = decision(
            "NEEDS_ATTENTION",
            "REVIEW",
            evidenceReason(proofGoal),
            goalTarget(proofGoal),
            { interventionKind: "review", interventionRequired: true, goal: proofGoal },
          );
        } else if (context.missionStatus === "completed") {
          result = activeGoals.length > 0 && context.missionCompletionAccepted === true
            ? decision(
                "COMPLETE",
                "NONE",
                "mission_proven_complete",
                null,
              )
            : decision(
                "NEEDS_ATTENTION",
                "REVIEW",
                activeGoals.length === 0 ? "no_active_goal" : "acceptance_blocked",
                activeGoals[0] ? goalTarget(activeGoals[0]) : missionTarget,
                { interventionKind: "review", interventionRequired: true, goal: activeGoals[0] },
              );
        } else if (context.missionStatus === "draft") {
          result = decision("PLANNING", "START", "mission_draft", missionTarget);
        } else if (context.missionStatus === "needs_replan") {
          const replanGoal = activeGoals.find((goal) =>
            ["blocked", "failed", "needs_replan"].includes(normalized(goal.status)),
          );
          result = decision(
            "NEEDS_ATTENTION",
            "REPLAN",
            "goal_requires_replan",
            replanGoal ? goalTarget(replanGoal) : missionTarget,
            {
              interventionKind: "review",
              interventionRequired: true,
              goal: replanGoal,
            },
          );
        } else if (["blocked", "failed"].includes(context.missionStatus)) {
          result = decision(
            "NEEDS_ATTENTION",
            "REVIEW",
            context.missionStatus === "needs_replan" ? "goal_requires_replan" : "mission_blocked",
            missionTarget,
            { interventionKind: "review", interventionRequired: true },
          );
        } else if (!["active", "waiting"].includes(context.missionStatus)) {
          result = decision(
            "NEEDS_ATTENTION",
            "REVIEW",
            "mission_not_active",
            missionTarget,
            { interventionKind: "review", interventionRequired: true },
          );
        } else if (activeGoals.length === 0) {
          result = decision(
            "NEEDS_ATTENTION",
            "REVIEW",
            "no_active_goal",
            missionTarget,
            { interventionKind: "review", interventionRequired: true },
          );
        } else {
          const replanGoal = activeGoals.find((goal) =>
            ["blocked", "needs_replan"].includes(normalized(goal.status)),
          );
          const resumable = activeGoals
            .map(recoveryDecision)
            .find((candidate): candidate is Decision => candidate !== null);
          const verificationGoal = activeGoals.find((goal) =>
            normalized(goal.status) === "verifying",
          );
          const runningGoal = activeGoals.find((goal) =>
            normalized(goal.status) === "running"
              || normalized(goal.currentExecution?.status) === "running",
          );
          const waitingEventGoal = activeGoals.find((goal) =>
            normalized(goal.status) === "waiting_for_event"
              || (goal.nextAction?.kind === "wait"
                && ["event", "schedule"].includes(goal.nextAction.reason ?? "")),
          );
          const queuedGoal = activeGoals.find((goal) =>
            ["queued", "planning"].includes(normalized(goal.status)),
          );
          const allCompleted = activeGoals.every((goal) => normalized(goal.status) === "completed");

          if (verificationGoal) {
            result = decision(
              "VERIFYING",
              "NONE",
              "verification_in_progress",
              null,
              { goal: verificationGoal },
            );
          } else if (runningGoal) {
            result = decision(
              "WORKING",
              "NONE",
              "execution_in_progress",
              null,
              { goal: runningGoal },
            );
          } else if (resumable) {
            result = resumable;
          } else if (replanGoal) {
            result = decision(
              "NEEDS_ATTENTION",
              "REPLAN",
              "goal_requires_replan",
              goalTarget(replanGoal),
              { interventionKind: "review", interventionRequired: true, goal: replanGoal },
            );
          } else if (waitingEventGoal) {
            result = decision(
              "PLANNING",
              "NONE",
              "goal_waiting_for_event",
              null,
              { goal: waitingEventGoal },
            );
          } else if (queuedGoal) {
            const canContinue = context.missionStatus === "active"
              && autonomy.allowAutoContinue
              && queuedGoal.runtimeContinuationAuthorized === true;
            result = canContinue
              ? decision(
                  "PLANNING",
                  "AUTO_CONTINUE",
                  "continuation_authorized",
                  goalTarget(queuedGoal),
                  { goal: queuedGoal },
                )
              : decision(
                  "PLANNING",
                  "NONE",
                  "execution_queued",
                  null,
                  { goal: queuedGoal },
                );
          } else if (allCompleted) {
            result = decision(
              "NEEDS_ATTENTION",
              "REVIEW",
              "acceptance_blocked",
              missionTarget,
              { interventionKind: "review", interventionRequired: true },
            );
          } else {
            result = decision(
              "NEEDS_ATTENTION",
              "REVIEW",
              "state_unresolved",
              missionTarget,
              { interventionKind: "review", interventionRequired: true },
            );
          }
        }
      }
    }
  }

  const goal = result.goal;
  const executionId = goal?.currentExecution?.id ?? null;
  const availableCommands = ["active", "waiting"].includes(context.missionStatus)
    ? activeGoals.flatMap((candidate) => {
        const execution = candidate.currentExecution;
        if (
          !execution
          || execution.cancelRequested
          || !["queued", "running", "paused"].includes(normalized(execution.status))
        ) {
          return [];
        }
        return [{
          kind: "STOP" as const,
          target: { kind: "execution" as const, id: execution.id },
          reasonCode: "execution_in_progress" as const,
        }];
      })
    : [];
  return {
    schemaVersion: 2,
    state: result.state,
    nextAction: {
      kind: result.action,
      target: result.target,
      reasonCode: result.reasonCode,
    },
    availableCommands,
    intervention: {
      required: result.interventionRequired ?? false,
      kind: result.interventionKind,
      reasonCode: result.interventionRequired ? result.reasonCode : null,
    },
    autonomy,
    missionId: context.missionId,
    sessionId: context.sessionId,
    goalId: goal?.id ?? null,
    executionId,
  };
}
