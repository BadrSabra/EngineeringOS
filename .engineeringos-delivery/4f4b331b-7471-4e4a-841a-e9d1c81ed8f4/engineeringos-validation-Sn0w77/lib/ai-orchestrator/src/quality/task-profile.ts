import type { QualityProfile } from "../quality-engine.js";

export type TaskType = "chat" | "tool_chat" | "analysis" | "task_execution" | "code_review" | "workflow";

/** How much context to load into the prompt window. */
export type ContextIntensity = "lite" | "normal" | "deep";
/** How session memory is retrieved and injected. */
export type MemoryMode = "none" | "summary" | "episodic";
/** How the knowledge graph is included. */
export type GraphMode = "off" | "index" | "expanded";
/** How conversation history is replayed. */
export type HistoryMode = "none" | "recent" | "summarized";

export type TaskProfile = {
  taskType: TaskType;
  scope: string;
  qualityProfile: QualityProfile;
  useTools: boolean;
  retryOnParseFailure: boolean;
  retryOnLowQuality: boolean;
  /** Context policy — consumed by quality-planner and prompt-planner. */
  contextIntensity: ContextIntensity;
  memoryMode: MemoryMode;
  graphMode: GraphMode;
  historyMode: HistoryMode;
};

type ContextPolicy = Pick<TaskProfile, "contextIntensity" | "memoryMode" | "graphMode" | "historyMode">;

const CONTEXT_POLICY_BY_TASK: Record<TaskType, ContextPolicy> = {
  chat:           { contextIntensity: "lite",   memoryMode: "summary",  graphMode: "index",    historyMode: "recent" },
  tool_chat:      { contextIntensity: "normal", memoryMode: "summary",  graphMode: "index",    historyMode: "recent" },
  analysis:       { contextIntensity: "deep",   memoryMode: "none",     graphMode: "expanded", historyMode: "none" },
  task_execution: { contextIntensity: "normal", memoryMode: "summary",  graphMode: "index",    historyMode: "summarized" },
  code_review:    { contextIntensity: "deep",   memoryMode: "none",     graphMode: "expanded", historyMode: "none" },
  workflow:       { contextIntensity: "normal", memoryMode: "none",     graphMode: "index",    historyMode: "none" },
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
    ...CONTEXT_POLICY_BY_TASK[taskType],
  };
}
