import type { PromptContextProfile } from "../prompts/prompt-composer.js";
import { buildPromptPlan } from "../prompts/prompt-planner.js";
import { buildQualityPlan, type QualityProfile } from "../quality-engine.js";
import type { ProviderCapabilityHints } from "../provider-capabilities.js";
import {
  buildTaskProfile,
  type TaskProfile,
  type ContextIntensity,
  type MemoryMode,
  type GraphMode,
  type HistoryMode,
} from "./task-profile.js";
import { getPhaseBudget, type ExecutionPhase, type PhaseBudget } from "./execution-phases.js";

export type CacheMode = "aggressive" | "normal" | "bypass";
export type ExecutionContextSection =
  | "tasks"
  | "metrics"
  | "graphEntities"
  | "graphRelationships"
  | "events"
  | "workflows";

export type ExecutionPlan = {
  taskProfile: TaskProfile;
  qualityProfile: QualityProfile;
  promptProfile: PromptContextProfile;
  strictHints: ProviderCapabilityHints;
  relaxedHints: ProviderCapabilityHints;
  retryLimit: number;
  /** Maximum tokens budgeted for the full context block. */
  contextBudget: number;
  /** Maximum tokens budgeted for the graph summary section. */
  graphBudget: number;
  /** Number of raw history messages to replay verbatim. */
  historyDepth: number;
  /** Number of memory entries to retrieve from session memory. */
  memoryDepth: number;
  /** Cache aggressiveness driven by context intensity. */
  cacheMode: CacheMode;
  /** Database context sections selected by this plan. */
  contextSections: readonly ExecutionContextSection[];
  /** Server-owned phase contract; phase budgets cannot be shared by loops. */
  phases: Readonly<Record<ExecutionPhase, PhaseBudget>>;
};

export type ExecutionPlanOptions = {
  hasTools?: boolean;
  requireTools?: boolean;
  qualityProfile?: QualityProfile;
  retryLimit?: number;
  /** Override the context intensity inferred from task type. */
  contextIntensityOverride?: ContextIntensity;
  /** Override the memory mode inferred from task type. */
  memoryModeOverride?: MemoryMode;
  /** Override the graph mode inferred from task type. */
  graphModeOverride?: GraphMode;
  /** Override the history mode inferred from task type. */
  historyModeOverride?: HistoryMode;
};

// Budget tables — all values are in approximate tokens.
const CONTEXT_BUDGET: Record<ContextIntensity, number> = { lite: 3000, normal: 6000, deep: 12000 };
const GRAPH_BUDGET: Record<GraphMode, number>           = { off: 0, index: 800, expanded: 3200 };
const HISTORY_DEPTH: Record<HistoryMode, number>        = { none: 0, recent: 4, summarized: 2 };
const MEMORY_DEPTH: Record<MemoryMode, number>          = { none: 0, summary: 5, episodic: 8 };
const CACHE_MODE_BY_INTENSITY: Record<ContextIntensity, CacheMode> = {
  lite:   "aggressive",
  normal: "normal",
  deep:   "bypass",
};

const CONTEXT_SECTIONS_BY_PROFILE: Record<string, readonly ExecutionContextSection[]> = {
  "chat-lite": ["tasks"],
  "chat-normal": ["tasks", "metrics"],
  "chat-deep": ["tasks", "metrics", "graphEntities", "graphRelationships", "events", "workflows"],
  task: ["tasks", "metrics", "graphEntities", "graphRelationships", "events"],
  scan: ["tasks", "metrics", "graphEntities", "graphRelationships", "events", "workflows"],
  review: ["tasks", "metrics", "graphEntities", "graphRelationships", "events"],
  workflow: ["tasks", "metrics", "events", "workflows"],
  full: ["tasks", "metrics", "graphEntities", "graphRelationships", "events", "workflows"],
  chat: ["tasks", "metrics"],
};

function normalizeExecutionScope(scope: string): string {
  switch (scope.trim().toLowerCase()) {
    case "analysis":
      return "scan-runner";
    case "task_execution":
      return "task-runner";
    case "code_review":
      return "review-agent";
    case "workflow":
      return "workflow-orchestrator";
    case "tool_chat":
      return "chat-agent";
    default:
      return scope;
  }
}

/**
 * Return the section manifest owned by an execution plan.
 *
 * Graph mode is applied here, rather than by individual callers, so a plan
 * with graph disabled never loads or displays graph data and indexed/expanded
 * graph requests are visible in the final prompt.
 */
export function getExecutionPlanContextSections(
  plan: Pick<ExecutionPlan, "promptProfile" | "taskProfile">,
): readonly ExecutionContextSection[] {
  const base = CONTEXT_SECTIONS_BY_PROFILE[plan.promptProfile] ??
    CONTEXT_SECTIONS_BY_PROFILE["chat-normal"];
  const sections = new Set(base);
  if (plan.taskProfile.graphMode === "off") {
    sections.delete("graphEntities");
    sections.delete("graphRelationships");
  } else {
    sections.add("graphEntities");
    sections.add("graphRelationships");
  }
  return [...sections];
}

export function buildExecutionPlan(
  scope: string,
  options?: ExecutionPlanOptions,
): ExecutionPlan {
  const baseProfile = buildTaskProfile(normalizeExecutionScope(scope), { hasTools: options?.hasTools });

  // Apply any caller overrides on top of the task-type defaults.
  const taskProfile: TaskProfile = {
    ...baseProfile,
    ...(options?.contextIntensityOverride !== undefined && { contextIntensity: options.contextIntensityOverride }),
    ...(options?.memoryModeOverride       !== undefined && { memoryMode:       options.memoryModeOverride }),
    ...(options?.graphModeOverride        !== undefined && { graphMode:        options.graphModeOverride }),
    ...(options?.historyModeOverride      !== undefined && { historyMode:      options.historyModeOverride }),
  };

  const qualityProfile = options?.qualityProfile ?? taskProfile.qualityProfile;
  const qualityPlan = buildQualityPlan(qualityProfile, {
    requireTools: options?.requireTools ?? taskProfile.useTools,
  });
  const promptPlan = buildPromptPlan(taskProfile);

  const { contextIntensity, graphMode, historyMode, memoryMode } = taskProfile;

  return {
    taskProfile,
    qualityProfile,
    promptProfile: promptPlan.contextProfile,
    strictHints: qualityPlan.strictHints,
    relaxedHints: qualityPlan.relaxedHints,
    retryLimit: options?.retryLimit ?? (taskProfile.retryOnParseFailure || taskProfile.retryOnLowQuality ? 3 : 1),
    contextBudget: CONTEXT_BUDGET[contextIntensity],
    graphBudget:   GRAPH_BUDGET[graphMode],
    historyDepth:  HISTORY_DEPTH[historyMode],
    memoryDepth:   MEMORY_DEPTH[memoryMode],
    cacheMode:     CACHE_MODE_BY_INTENSITY[contextIntensity],
    contextSections: getExecutionPlanContextSections({
      promptProfile: promptPlan.contextProfile,
      taskProfile,
    }),
    phases: {
      localization: getPhaseBudget("localization"),
      evidence: getPhaseBudget("evidence"),
      patch_proposal: getPhaseBudget("patch_proposal"),
      validation: getPhaseBudget("validation"),
      repair_recovery: getPhaseBudget("repair_recovery"),
      report: getPhaseBudget("report"),
    },
  };
}
