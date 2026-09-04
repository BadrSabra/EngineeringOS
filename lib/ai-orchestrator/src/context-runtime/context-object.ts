/**
 * Context Runtime — Intermediate Representation (IR)
 *
 * Defines typed wrappers that carry context data between the DB layer
 * (context-loader), the admission engine (context-admission), and the
 * serialization layer (context-serializer / context-builder).
 *
 * Contract: no context data may travel between layers as raw strings or DB rows
 * without being wrapped in one of these types first.
 */

export type SliceId =
  | "project"
  | "recentTasks"
  | "latestMetrics"
  | "graphSummary"
  | "recentEvents"
  | "workflows";

/**
 * Admission decision produced by the Admission Engine for each slice.
 *
 * ADMIT     — include full content in the prompt window.
 * REFERENCE — include a short excerpt only (first ~400 chars) to save budget.
 * DEFER     — available for on-demand retrieval but excluded from this turn.
 * DROP      — excluded entirely; not relevant or too stale for this task type.
 */
export type AdmissionDecision = "ADMIT" | "REFERENCE" | "DEFER" | "DROP";
export type ContextSliceHealthStatus =
  | "not_requested"
  | "empty"
  | "loaded"
  | "load_failed";

export type ContextSlice = {
  id: SliceId;
  /** Origin label, e.g. "db:tasks", "db:graph_entities". */
  source: string;
  /** Serialized, prompt-ready string produced by context-serializer. */
  content: string;
  /** Approximate token count: Math.ceil(content.length / 4). */
  estimatedTokens: number;
  /** Freshness assessment from the loader. */
  freshness: "fresh" | "stale" | "missing";
  /** Load outcome retained alongside the serialized content. */
  healthStatus: ContextSliceHealthStatus;
  /** Safe bounded failure category, present only when healthStatus is load_failed. */
  failureCode?: string;
  /** Number of source rows represented by this slice. */
  rowCount: number;
  /** Unix ms timestamp when this slice was loaded from the DB. */
  loadedAt: number;
  /** Current lifetime stage, updated by applyLifetime(). */
  lifetimeStage: "fresh" | "stale" | "archived";
  /** Other slices whose full rendering depends on this slice being admitted. */
  dependencyHints: SliceId[];
  /** Set by the Admission Engine. Default before admission pass: "ADMIT". */
  admissionDecision: AdmissionDecision;
};

/** Full set of slices for one request plus their token budget constraints. */
export type ContextPlan = {
  projectId: string;
  slices: ContextSlice[];
  totalEstimatedTokens: number;
  /** Overall context budget in tokens (from ExecutionPlan.contextBudget). */
  budgetTokens: number;
  /** Graph-section budget in tokens (from ExecutionPlan.graphBudget). */
  graphBudgetTokens: number;
};

/** Output of the admission pass — slices partitioned by their decision. */
export type ContextObject = {
  plan: ContextPlan;
  admittedSlices:  ContextSlice[];
  referenceSlices: ContextSlice[];
  deferredSlices:  ContextSlice[];
  droppedSlices:   ContextSlice[];
};

/** Estimate token count for a string (~4 chars per token). */
export function estimateTokens(content: string): number {
  return Math.ceil(content.length / 4);
}

/**
 * Build a ContextSlice from a serialized string and its load metadata.
 * The admissionDecision defaults to "ADMIT" and is overwritten by the engine.
 */
export function buildSlice(
  id: SliceId,
  content: string,
  opts: {
    source: string;
    freshness?: ContextSlice["freshness"];
    healthStatus?: ContextSlice["healthStatus"];
    failureCode?: string;
    rowCount?: number;
    loadedAt?: number;
    lifetimeStage?: ContextSlice["lifetimeStage"];
    dependencyHints?: SliceId[];
  },
): ContextSlice {
  return {
    id,
    source: opts.source,
    content,
    estimatedTokens: estimateTokens(content),
    freshness: opts.freshness ?? "fresh",
    healthStatus: opts.healthStatus ?? "loaded",
    ...(opts.failureCode ? { failureCode: opts.failureCode } : {}),
    rowCount: opts.rowCount ?? 0,
    loadedAt: opts.loadedAt ?? Date.now(),
    lifetimeStage: opts.lifetimeStage ?? "fresh",
    dependencyHints: opts.dependencyHints ?? [],
    admissionDecision: "ADMIT",
  };
}
