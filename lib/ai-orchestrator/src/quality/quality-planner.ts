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

export type CacheMode = "aggressive" | "normal" | "bypass";

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

export function buildExecutionPlan(
  scope: string,
  options?: ExecutionPlanOptions,
): ExecutionPlan {
  const baseProfile = buildTaskProfile(scope, { hasTools: options?.hasTools });

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
  };
}
