/**
 * Context Builder — pure coordinator.
 *
 * Pipeline:
 *   cache lookup → load (context-loader)
 *               → serialize (context-serializer)
 *               → wrap as ContextSlices
 *               → admit (context-admission)
 *               → assemble ProjectContext
 *               → cache
 *
 * This module owns NO ranking, sizing, or trimming rules.
 * All budget enforcement is delegated to the Admission Engine.
 */
import type { AgentContext } from "./schemas/context.schema.js";
import { buildContextCacheKey, getCachedContext, setCachedContext, hashExecutionPlan } from "./context-cache-manager.js";
import { loadProjectContext, type BuildProjectContextOptions, type ContextLoadSection } from "./context-loader.js";
import { buildProjectContextFromLoadedContext } from "./context-serializer.js";
import { resolveExecutionDecision } from "./model-selection/decision-engine.js";
import type { ExecutionPlan } from "./model-selection/execution-plan.js";
import {
  buildSlice,
  type ContextPlan,
  type SliceId,
  type AdmissionDecision,
} from "./context-runtime/context-object.js";
import { runAdmission } from "./context-runtime/context-admission.js";

export { invalidateContextCache, invalidateContextSlice, hashExecutionPlan, setInvalidationNotifier, startContextInvalidationChannel } from "./context-cache-manager.js";
export type { BuildProjectContextOptions, ContextLoadSection } from "./context-loader.js";

/** The context object every agent prompt is built from. Shape enforced by AgentContextSchema. */
export type ProjectContext = AgentContext;

/**
 * Extended options that add an optional ExecutionPlan for budget-aware admission.
 * Fully backward-compatible: existing callers that pass only { sections: [...] }
 * receive normal-intensity admission by default.
 */
export type BuildContextOptions = BuildProjectContextOptions & {
  /** Execution plan controlling context depth and token budgets. Defaults to normal intensity. */
  plan?: Readonly<ExecutionPlan>;
};

// ─── Slice configuration ──────────────────────────────────────────────────────

/** Maps a SliceId to the corresponding key in the loader's sliceMetadata map. */
const SLICE_TO_LOADER_KEY: Record<SliceId, ContextLoadSection | "project"> = {
  project:       "project",
  recentTasks:   "tasks",
  latestMetrics: "metrics",
  graphSummary:  "graphEntities",   // graph entities + relationships → one slice
  recentEvents:  "events",
  workflows:     "workflows",
};

/** Maps a loader ContextLoadSection to the SliceId it contributes to. */
const SECTION_TO_SLICE: Partial<Record<ContextLoadSection, SliceId>> = {
  tasks:              "recentTasks",
  metrics:            "latestMetrics",
  graphEntities:      "graphSummary",
  graphRelationships: "graphSummary",
  events:             "recentEvents",
  workflows:          "workflows",
};

/** Ordered list of string fields that become ContextSlices. */
const SLICE_FIELDS: Array<{ id: SliceId; key: keyof ProjectContext }> = [
  { id: "project",       key: "project" },
  { id: "recentTasks",   key: "recentTasks" },
  { id: "latestMetrics", key: "latestMetrics" },
  { id: "graphSummary",  key: "graphSummary" },
  { id: "recentEvents",  key: "recentEvents" },
  { id: "workflows",     key: "workflows" },
];

// ─── Admission assembly ───────────────────────────────────────────────────────

const REFERENCE_LIMIT = 400; // chars kept for REFERENCE decisions
const LABEL_DEFERRED  = "[section deferred — not included in this context budget]";
const LABEL_DROPPED   = "[section excluded — not relevant for this task type]";

function applyDecision(content: string, decision: AdmissionDecision): string {
  switch (decision) {
    case "ADMIT":
      return content;
    case "REFERENCE":
      return content.length <= REFERENCE_LIMIT
        ? content
        : `${content.slice(0, REFERENCE_LIMIT)}…[brief — see full context for details]`;
    case "DEFER":
      return LABEL_DEFERRED;
    case "DROP":
      return LABEL_DROPPED;
  }
}

// ─── Public API ───────────────────────────────────────────────────────────────

export async function buildProjectContext(
  projectId: string,
  options: BuildContextOptions = {},
): Promise<ProjectContext> {
  // Resolve execution plan first — its hash is part of the cache key so plan
  // changes (e.g. switching context intensity) produce distinct cache entries.
  const effectivePlan = options.plan ?? resolveExecutionDecision("chat-agent", {
    contextIntensityOverride: "normal",
  });

  const planHash = hashExecutionPlan(effectivePlan);
  const cacheKey = buildContextCacheKey(projectId, options.sections, planHash);
  const now = Date.now();
  const cached = getCachedContext(cacheKey);
  if (cached && cached.expiresAt > now) return cached.data;

  // Load raw DB rows and serialize to prompt strings.
  const loaded = await loadProjectContext(projectId, options);
  const raw = buildProjectContextFromLoadedContext(loaded);

  // Wrap each string field as a ContextSlice with load metadata.
  const slices = SLICE_FIELDS.map(({ id, key }) => {
    const content = String(raw[key] ?? "");
    const loaderKey = SLICE_TO_LOADER_KEY[id];
    const meta = loaded.sliceMetadata.get(loaderKey);

    const dependencyHints: SliceId[] = (meta?.dependencyHints ?? [])
      .map((h) => SECTION_TO_SLICE[h])
      .filter((s): s is SliceId => s !== undefined);

    return buildSlice(id, content, {
      source:          meta?.source ?? `db:${id}`,
      freshness:       meta?.freshness ?? (content.startsWith("[") ? "missing" : "fresh"),
      loadedAt:        meta?.loadedAt ?? now,
      dependencyHints,
    });
  });

  const contextPlan: ContextPlan = {
    projectId,
    slices,
    totalEstimatedTokens: slices.reduce((s, sl) => s + sl.estimatedTokens, 0),
    budgetTokens:      effectivePlan.contextBudget,
    graphBudgetTokens: effectivePlan.graphBudget,
  };

  // Run admission: every slice receives an explicit ADMIT/REFERENCE/DEFER/DROP.
  const contextObject = runAdmission(contextPlan, effectivePlan);
  const sliceMap = new Map(contextObject.plan.slices.map((s) => [s.id, s]));

  // Trace context admission decisions for diagnostics.
  console.info(
    JSON.stringify({
      scope: "context-builder",
      action: "admission_trace",
      projectId,
      totalEstimatedTokens: contextPlan.totalEstimatedTokens,
      budgetTokens: contextPlan.budgetTokens,
      graphBudgetTokens: contextPlan.graphBudgetTokens,
      sliceCount: contextPlan.slices.length,
      sections: options.sections ?? null,
      decisions: contextObject.plan.slices.map((s) => ({
        id: s.id,
        decision: s.admissionDecision,
        estimatedTokens: s.estimatedTokens,
        freshness: s.freshness,
      })),
    }),
  );

  // Assemble the final ProjectContext from admission decisions.
  const result: ProjectContext = {
    project:        applyDecision(sliceMap.get("project")!.content,       sliceMap.get("project")!.admissionDecision),
    recentTasks:    applyDecision(sliceMap.get("recentTasks")!.content,   sliceMap.get("recentTasks")!.admissionDecision),
    latestMetrics:  applyDecision(sliceMap.get("latestMetrics")!.content, sliceMap.get("latestMetrics")!.admissionDecision),
    graphSummary:   applyDecision(sliceMap.get("graphSummary")!.content,  sliceMap.get("graphSummary")!.admissionDecision),
    recentEvents:   applyDecision(sliceMap.get("recentEvents")!.content,  sliceMap.get("recentEvents")!.admissionDecision),
    workflows:      applyDecision(sliceMap.get("workflows")!.content,     sliceMap.get("workflows")!.admissionDecision),
    metricsVerified: loaded.scanVerified,
    contextManifest: loaded.contextManifest,
    ...(raw.sessionMemories !== undefined && { sessionMemories: raw.sessionMemories }),
  };

  setCachedContext(cacheKey, result);
  return result;
}
