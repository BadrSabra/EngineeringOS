import { redactUserFacingText } from "./ai-route-helpers.js";

export const AI_EXECUTION_PROJECTION_SCHEMA_VERSION = 2 as const;

export type AiExecutionProjectionAction =
  | "CANCEL"
  | "RESUME_CHECKPOINT"
  | "RETRY_CHECKPOINT"
  | "START_NEW_RUN"
  | "REVIEW_PROOF"
  | "REVIEW_DIFF"
  | "APPROVE_CHANGES";

export type AiExecutionProjection = {
  schemaVersion: typeof AI_EXECUTION_PROJECTION_SCHEMA_VERSION;
  kind: "CHAT" | "TASK" | "DELIVERY" | "RECIPE";
  phase: string;
  objective: string;
  progress: {
    percent: number | null;
    label: string;
    currentStep: string | null;
    completedSteps: number;
    totalSteps: number | null;
  };
  plan: {
    steps: Array<{
      id: string;
      title: string;
      status: "pending" | "active" | "completed" | "blocked" | "failed";
      action: string | null;
      files: string[];
    }>;
    currentStepId: string | null;
  };
  tools: {
    totalCalls: number;
    activeTool: string | null;
    recent: Array<{
      tool: string;
      status: "started" | "completed" | "failed";
      source: string | null;
    }>;
  };
  workspace: {
    changedFiles: string[];
    diffStatus: "available" | "not_available" | "not_applicable";
  };
  verification: {
    status: "pending" | "running" | "passed" | "failed" | "unavailable";
    evidenceVerdict: string;
    proofRequired: boolean;
  };
  orientation?: {
    complete: boolean;
    missingRoles: string[];
  };
  approval: {
    required: boolean;
    status: "NOT_REQUIRED" | "PENDING" | "APPROVED";
    proposalId: string | null;
  };
  stopped: {
    reason: string | null;
    outcome: "SUCCEEDED" | "FAILED" | "INTERRUPTED" | null;
  };
  timeline: Array<{
    id: "understand" | "investigate" | "plan" | "approval" | "build" | "validate" | "review" | "deliver";
    label: string;
    status: "pending" | "active" | "completed" | "blocked" | "not_applicable";
    detail: string | null;
  }>;
  allowedActions: AiExecutionProjectionAction[];
};

type ProjectionStep = Record<string, unknown>;

type ProjectionInput = {
  execution: {
    id: string;
    status: string;
    proposalId?: string | null;
    proposalApprovalRequired?: boolean;
    linkedTaskId?: string | null;
    buildPlanMessageId?: string | null;
    recipeReceipt?: unknown;
  };
  request: Record<string, unknown>;
  checkpoint: Record<string, unknown>;
  acceptance?: {
    nextActionCode?: string | null;
    resumable?: boolean;
    outcome?: string | null;
  };
  evidenceVerdict: string;
  proofRequired: boolean;
  terminalReason: string | null;
  hasAppliedChanges: boolean;
  hasCommittedChanges: boolean;
  hasPushedChanges: boolean;
};

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function boundedText(value: unknown, fallback: string, max = 240): string {
  if (typeof value !== "string" || !value.trim()) return fallback;
  return redactUserFacingText(value)
    .replace(/\b(?:provider|model|token|key|secret|credential|authorization|diagnostic)\s*[:=]\s*[^\s,;]+/gi, "[redacted]")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, max) || fallback;
}

function safeRelativePath(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const path = value.trim().replaceAll("\\", "/").replace(/^(\.\/)+/, "");
  if (
    !path
    || path.startsWith("/")
    || path.includes("..")
    || /^(?:home|tmp|private|runtime|workspace)(?:\/|$)/i.test(path)
  ) return undefined;
  return path.slice(0, 500);
}

function safeFiles(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return [...new Set(value
    .map(safeRelativePath)
    .filter((path): path is string => Boolean(path)))]
    .slice(0, 20);
}

function phaseMatches(phase: string, ...values: string[]): boolean {
  return values.some((value) => phase.includes(value));
}

function executionKind(input: ProjectionInput): AiExecutionProjection["kind"] {
  if (input.execution.linkedTaskId) return "TASK";
  if (input.execution.recipeReceipt) return "RECIPE";
  if (input.execution.proposalId || input.execution.buildPlanMessageId) return "DELIVERY";
  return "CHAT";
}

function stepStatus(step: ProjectionStep): AiExecutionProjection["plan"]["steps"][number]["status"] {
  const status = typeof step.status === "string" ? step.status.toLowerCase() : "";
  if (status === "active" || status === "running" || status === "in_progress") return "active";
  if (status === "done" || status === "completed" || status === "passed" || status === "succeeded") return "completed";
  if (status === "blocked") return "blocked";
  if (status === "failed" || status === "error") return "failed";
  return "pending";
}

function progressPercent(input: ProjectionInput, completedSteps: number, totalSteps: number): number | null {
  const checkpointPercent = input.checkpoint.progressPercent;
  if (typeof checkpointPercent === "number" && Number.isFinite(checkpointPercent)) {
    return Math.max(0, Math.min(100, Math.round(checkpointPercent)));
  }
  if (input.execution.status === "completed") return 100;
  if (totalSteps > 0 && completedSteps > 0) return Math.round((completedSteps / totalSteps) * 100);
  return null;
}

function orientationProjection(
  steps: ProjectionStep[],
): AiExecutionProjection["orientation"] {
  const sourceSelection = [...steps].reverse().find(
    (step) => step.kind === "project_query_source_selection",
  );
  const coverage = record(sourceSelection && sourceSelection.orientationCoverage);
  if (typeof coverage.complete !== "boolean") return undefined;
  const missingRoles = Array.isArray(coverage.missingRoles)
    ? coverage.missingRoles
      .filter((role): role is string => typeof role === "string")
      .slice(0, 4)
    : [];
  return { complete: coverage.complete, missingRoles };
}

type TimelineStatus = AiExecutionProjection["timeline"][number]["status"];

function timelineEntry(
  id: AiExecutionProjection["timeline"][number]["id"],
  label: string,
  status: TimelineStatus,
  detail: string | null = null,
): AiExecutionProjection["timeline"][number] {
  return { id, label, status, detail: detail ? boundedText(detail, "Recorded by the server.", 240) : null };
}

function timelineProjection(input: ProjectionInput, values: {
  phase: string;
  planLength: number;
  changedFiles: string[];
  approvalRequired: boolean;
  approvalStatus: "NOT_REQUIRED" | "PENDING" | "APPROVED";
  verificationStatus: AiExecutionProjection["verification"]["status"];
}): AiExecutionProjection["timeline"] {
  const { phase, planLength, changedFiles, approvalRequired, approvalStatus, verificationStatus } = values;
  const deliveryExecution = approvalRequired || Boolean(
    input.execution.proposalId || input.execution.buildPlanMessageId,
  );
  const validationExecution = deliveryExecution || input.proofRequired;
  const hasInvestigationEvidence = Array.isArray(input.checkpoint.recentSteps)
    && input.checkpoint.recentSteps.some((step) => {
      const value = record(step);
      return ["tool_call", "tool_result", "project_query_source_selection", "read_evidence"].includes(String(value.kind));
    });
  const hasPlanEvidence = planLength > 0 || phaseMatches(phase, "PLAN", "BUILD", "VALIDAT", "APPLY", "COMMIT", "PUSH");
  const buildActive = phaseMatches(phase, "BUILD", "REPAIR");
  const validationBlocked = verificationStatus === "failed" || verificationStatus === "unavailable";
  const reviewRequired = Boolean(input.execution.proposalId || input.execution.buildPlanMessageId);
  const reviewComplete = input.hasAppliedChanges || input.hasCommittedChanges || input.hasPushedChanges;
  const deliverStatus: TimelineStatus = !deliveryExecution
    ? "not_applicable"
    : input.hasPushedChanges
      ? "completed"
      : input.hasCommittedChanges || input.hasAppliedChanges
        ? "active"
        : validationBlocked
          ? "blocked"
          : "pending";

  return [
    timelineEntry(
      "understand",
      "Understand request",
      input.execution.status === "queued" ? "active" : "completed",
      input.execution.status === "queued" ? "The server is preparing the mission scope." : "The request is retained in the execution objective.",
    ),
    timelineEntry(
      "investigate",
      "Investigate project",
      phaseMatches(phase, "DISCOVER", "ORIENT", "EXPLORE", "READ", "SEARCH")
        ? "active"
        : hasInvestigationEvidence || hasPlanEvidence || input.execution.status === "completed" || input.execution.status === "failed"
          ? "completed"
          : "pending",
      hasInvestigationEvidence ? "Source reads and project evidence are retained for this execution." : null,
    ),
    timelineEntry(
      "plan",
      "Create bounded plan",
      !deliveryExecution && planLength === 0
        ? "not_applicable"
        : phaseMatches(phase, "PLAN") && planLength === 0
          ? "active"
          : planLength > 0 || hasPlanEvidence
            ? "completed"
            : "pending",
      planLength > 0 ? `${planLength} server-recorded plan step${planLength === 1 ? "" : "s"}.` : null,
    ),
    timelineEntry(
      "approval",
      "Approve change",
      !approvalRequired ? "not_applicable" : approvalStatus === "PENDING" ? "active" : "completed",
      approvalStatus === "PENDING" ? "Approval is required before the candidate can continue." : null,
    ),
    timelineEntry(
      "build",
      "Build candidate",
      !deliveryExecution
        ? "not_applicable"
        : buildActive
          ? "active"
          : changedFiles.length > 0 || input.hasAppliedChanges || input.hasCommittedChanges || input.hasPushedChanges
            ? "completed"
            : "pending",
      changedFiles.length > 0 ? `${changedFiles.length} scoped file${changedFiles.length === 1 ? "" : "s"} changed.` : null,
    ),
    timelineEntry(
      "validate",
      "Validate candidate",
      !validationExecution
        ? "not_applicable"
        : validationBlocked
          ? "blocked"
          : verificationStatus === "passed"
            ? "completed"
            : verificationStatus === "running"
              ? "active"
              : "pending",
      validationBlocked ? "Required server-owned validation or evidence is incomplete." : null,
    ),
    timelineEntry(
      "review",
      "Review changes",
      !reviewRequired
        ? "not_applicable"
        : reviewComplete
          ? "completed"
          : input.execution.proposalId
            ? "active"
            : "pending",
      approvalStatus === "PENDING" ? "Review the proposal before approval." : null,
    ),
    timelineEntry(
      "deliver",
      "Deliver to Git",
      deliverStatus,
      deliverStatus === "blocked"
        ? "Delivery is blocked until the validation issue is resolved."
        : input.hasPushedChanges
          ? "Apply, commit, and push receipts are recorded for this operation."
          : input.hasCommittedChanges
            ? "Commit is recorded; push remains pending."
            : input.hasAppliedChanges
              ? "Apply is recorded; commit and push remain pending."
              : null,
    ),
  ];
}

export function buildAiExecutionProjection(input: ProjectionInput): AiExecutionProjection {
  const steps = Array.isArray(input.checkpoint.recentSteps)
    ? input.checkpoint.recentSteps.filter((step): step is ProjectionStep => Boolean(record(step)))
    : [];
  const planSteps = steps
    .filter((step) => step.kind === "plan_activity")
    .map((step, index) => {
      const title = boundedText(step.stepTitle ?? step.resultSummary, `Step ${index + 1}`);
      return {
        id: `plan-${index + 1}`,
        title,
        status: stepStatus(step),
        action: typeof step.action === "string" ? step.action.slice(0, 40) : null,
        files: safeFiles(step.files),
      };
    })
    .slice(-20);
  const nodeSteps = Array.isArray(input.checkpoint.nodeStates)
    ? input.checkpoint.nodeStates
      .filter((node): node is ProjectionStep => Boolean(record(node)))
      .map((node, index) => ({
        id: boundedText(node.id ?? node.nodeId, `node-${index + 1}`, 80),
        title: boundedText(node.title ?? node.name, `Node ${index + 1}`),
        status: stepStatus(node),
        action: null,
        files: safeFiles(node.allowedFiles ?? node.files),
      }))
      .slice(-20)
    : [];
  const plan = planSteps.length > 0 ? planSteps : nodeSteps;
  const activePlanStep = [...plan].reverse().find((step) => step.status === "active");
  const completedSteps = plan.filter((step) => step.status === "completed").length;
  const currentActivity = [...steps].reverse().find((step) => step.kind === "plan_activity");
  const orientation = orientationProjection(steps);
  const phase = boundedText(
    input.checkpoint.stage ?? input.checkpoint.phase,
    input.execution.status.toUpperCase(),
    80,
  ).toUpperCase();

  const toolCalls = steps.filter((step) => step.kind === "tool_call");
  const toolResults = steps.filter((step) => step.kind === "tool_result");
  const recentTools = toolCalls.slice(-8).map((call) => {
    const tool = boundedText(call.tool, "tool", 80);
    const matchingResult = toolResults.find((result) => result.tool === call.tool);
    return {
      tool,
      status: matchingResult
        ? matchingResult.resultKind === "failed" ? "failed" as const : "completed" as const
        : "started" as const,
      source: safeRelativePath(call.args && record(call.args).path) ?? null,
    };
  });
  const latestValidation = [...steps].reverse().find((step) => step.kind === "validation");
  const validation = record(latestValidation && (latestValidation.validation ?? latestValidation.result));
  const validationStatus = typeof validation.status === "string"
    ? validation.status.toLowerCase()
    : undefined;
  const verificationStatus: AiExecutionProjection["verification"]["status"] =
    validationStatus === "passed" || input.evidenceVerdict === "PROVEN"
      ? "passed"
      : validationStatus === "failed" || validationStatus === "blocked" || input.evidenceVerdict === "BLOCKED"
        ? "failed"
        : input.execution.status === "running"
          ? "running"
          : input.evidenceVerdict === "UNAVAILABLE"
            ? "unavailable"
            : "pending";
  const changedFiles = [...new Set(steps.flatMap((step) =>
    safeFiles(record(step.validation).changedFiles ?? step.changedFiles ?? step.affectedFiles),
  ))].slice(0, 20);
  const approvalRequired = Boolean(input.execution.proposalId || input.execution.buildPlanMessageId);
  const approvalStatus = !approvalRequired
    ? "NOT_REQUIRED"
    : input.hasAppliedChanges || input.hasCommittedChanges || input.hasPushedChanges
      ? "APPROVED"
      : "PENDING";
  const timeline = timelineProjection(input, {
    phase,
    planLength: plan.length,
    changedFiles,
    approvalRequired,
    approvalStatus,
    verificationStatus,
  });
  const stopped = input.execution.status === "completed"
    || input.execution.status === "failed"
    || input.execution.status === "cancelled"
    || input.execution.status === "paused";
  const allowedActions: AiExecutionProjectionAction[] = [];
  if (input.execution.status === "queued" || input.execution.status === "running") {
    allowedActions.push("CANCEL");
  }
  if (input.acceptance?.resumable && input.acceptance.nextActionCode === "RESUME_ALLOWED") {
    allowedActions.push("RESUME_CHECKPOINT");
  }
  if (
    input.acceptance?.resumable !== false
    && (input.acceptance?.nextActionCode === "RETRY_AFTER_TIMEOUT"
      || input.acceptance?.nextActionCode === "RETRY_AFTER_RATE_LIMIT")
  ) {
    allowedActions.push("RETRY_CHECKPOINT");
  }
  if (input.execution.status === "failed" || input.execution.status === "cancelled") {
    allowedActions.push("START_NEW_RUN");
  }
  if (input.proofRequired && input.evidenceVerdict !== "PROVEN") {
    allowedActions.push("REVIEW_PROOF");
  }
  if (input.execution.proposalId && input.execution.proposalApprovalRequired === true) {
    allowedActions.push("REVIEW_DIFF");
    if (approvalStatus === "PENDING") allowedActions.push("APPROVE_CHANGES");
  } else if (input.execution.proposalId) {
    allowedActions.push("REVIEW_DIFF");
  }

  return {
    schemaVersion: AI_EXECUTION_PROJECTION_SCHEMA_VERSION,
    kind: executionKind(input),
    phase,
    objective: boundedText(
      record(input.request.objective).objective
        ?? record(input.request.objective).description
        ?? input.request.objective
        ?? input.request.message,
      "Engineering execution",
      500,
    ),
    progress: {
      percent: progressPercent(input, completedSteps, plan.length),
      label: boundedText(currentActivity?.resultSummary ?? input.checkpoint.detail, phase, 240),
      currentStep: activePlanStep?.title ?? (currentActivity ? boundedText(currentActivity.stepTitle, phase) : null),
      completedSteps,
      totalSteps: plan.length > 0 ? plan.length : null,
    },
    plan: {
      steps: plan,
      currentStepId: activePlanStep?.id ?? null,
    },
    tools: {
      totalCalls: toolCalls.length,
      activeTool: recentTools.at(-1)?.status === "started" ? recentTools.at(-1)?.tool ?? null : null,
      recent: recentTools,
    },
    workspace: {
      changedFiles,
      diffStatus: changedFiles.length > 0
        ? "available"
        : input.execution.proposalId || input.execution.buildPlanMessageId
          ? "not_available"
          : "not_applicable",
    },
    verification: {
      status: verificationStatus,
      evidenceVerdict: input.evidenceVerdict,
      proofRequired: input.proofRequired,
    },
    ...(orientation ? { orientation } : {}),
    approval: {
      required: approvalRequired,
      status: approvalStatus,
      proposalId: input.execution.proposalId ?? null,
    },
    stopped: {
      reason: stopped ? boundedText(input.terminalReason, "Execution stopped", 240) : null,
      outcome: stopped
        ? input.acceptance?.outcome === "SUCCEEDED"
          ? "SUCCEEDED"
          : input.execution.status === "cancelled"
            ? "INTERRUPTED"
            : input.execution.status === "completed"
              ? "SUCCEEDED"
              : input.acceptance?.outcome === "INTERRUPTED"
                ? "INTERRUPTED"
                : input.execution.status === "failed" || input.execution.status === "paused"
                  ? "FAILED"
                  : null
        : null,
    },
    timeline,
    allowedActions: [...new Set(allowedActions)],
  };
}