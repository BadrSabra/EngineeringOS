import type { QualityProfile } from "../quality-engine.js";

export type TaskType = "chat" | "tool_chat" | "analysis" | "task_execution" | "code_review" | "workflow";

export type TaskProfile = {
  taskType: TaskType;
  scope: string;
  qualityProfile: QualityProfile;
  useTools: boolean;
  retryOnParseFailure: boolean;
  retryOnLowQuality: boolean;
};

function normalizeScope(scope: string): string {
  return scope.trim().toLowerCase();
}

export function inferTaskType(scope: string, hasTools = false): TaskType {
  const normalized = normalizeScope(scope);
  if (normalized.includes("workflow")) return "workflow";
  if (normalized.includes("review")) return "code_review";
  if (normalized.includes("scan")) return "analysis";
  if (normalized.includes("task")) return "task_execution";
  if (normalized.includes("chat")) return hasTools ? "tool_chat" : "chat";
  return hasTools ? "tool_chat" : "chat";
}

export function buildTaskProfile(scope: string, options?: { hasTools?: boolean }): TaskProfile {
  const hasTools = options?.hasTools ?? false;
  const taskType = inferTaskType(scope, hasTools);
  return {
    taskType,
    scope,
    qualityProfile: taskType,
    useTools: hasTools,
    retryOnParseFailure: taskType !== "chat" || hasTools,
    retryOnLowQuality: taskType !== "chat",
  };
}
