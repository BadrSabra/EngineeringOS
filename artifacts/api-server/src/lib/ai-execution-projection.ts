import { redactUserFacingText } from "./ai-route-helpers.js";

export const AI_EXECUTION_PROJECTION_SCHEMA_VERSION = 1 as const;

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
  approval: {
    required: boolean;
    status: "NOT_REQUIRED" | "PENDING" | "APPROVED";
    proposalId: string | null;
  };
  stopped: {
    reason: string | null;
    outcome: "SUCCEEDED" | "FAILED" | "INTERRUPTED" | null;
  };
  allowedActions: AiExecutionProjectionAction[];
};

type ProjectionStep = Record<string, unknown>;

type ProjectionInput = {
  execution: {
    id: string;
    status: string;
    proposalId?: string | null;
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
  return redactUserFacingText(value).replace(/\s+/g, " ").trim().slice(0, max) || fallback;
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
  if (input.acceptance?.nextActionCode === "RETRY_AFTER_TIMEOUT" || input.acceptance?.nextActionCode === "RETRY_AFTER_RATE_LIMIT") {
    allowedActions.push("RETRY_CHECKPOINT");
  }
  if (input.execution.status === "failed" || input.execution.status === "cancelled") {
    allowedActions.push("START_NEW_RUN");
  }
  if (input.proofRequired && input.evidenceVerdict !== "PROVEN") {
    allowedActions.push("REVIEW_PROOF");
  }
  if (input.execution.proposalId) {
    allowedActions.push("REVIEW_DIFF");
    if (approvalStatus === "PENDING") allowedActions.push("APPROVE_CHANGES");
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
    approval: {
      required: approvalRequired,
      status: approvalStatus,
      proposalId: input.execution.proposalId ?? null,
    },
    stopped: {
      reason: stopped ? input.terminalReason : null,
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
    allowedActions: [...new Set(allowedActions)],
  };
}