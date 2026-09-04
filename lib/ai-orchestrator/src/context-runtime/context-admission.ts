/**
 * Context Admission Engine
 *
 * Classifies each ContextSlice as ADMIT / REFERENCE / DEFER / DROP based on
 * the ExecutionPlan's context/graph policy and the available token budget.
 *
 * Decision rules (evaluated per-slice, in importance order):
 *  1. "project"        — always ADMIT; it is the baseline non-negotiable context.
 *  2. "graphSummary"   — graphMode="off" → DROP; uses graphBudgetTokens cap:
 *                         index:    fits within graphBudgetTokens → ADMIT, else REFERENCE.
 *                         expanded: always ADMIT (full graph requested).
 *  3. Lite intensity   — "workflows" and "recentEvents" → DEFER.
 *  4. Missing + low importance (score < 6) → DROP.
 *  5. Budget overflow  — slices processed in descending importance order;
 *                         REFERENCE for medium-importance (≥ 6), DEFER for low.
 */

import type { ExecutionPlan } from "../model-selection/execution-plan.js";
import type {
  ContextSlice,
  SliceId,
  AdmissionDecision,
  ContextObject,
  ContextPlan,
  ContextAdmissionIdentity,
} from "./context-object.js";

/** Importance score (higher = more critical; used when budget is constrained). */
const SLICE_IMPORTANCE: Record<SliceId, number> = {
  project:       10,
  recentTasks:    8,
  latestMetrics:  6,
  graphSummary:   5,
  recentEvents:   4,
  workflows:      3,
};

function decideSlice(
  slice: ContextSlice,
  plan: ExecutionPlan,
  budget: { remaining: number },
): AdmissionDecision {
  const { contextIntensity, graphMode } = plan.taskProfile;

  // Rule 1 — project is non-negotiable
  if (slice.id === "project") {
    budget.remaining = Math.max(0, budget.remaining - slice.estimatedTokens);
    return "ADMIT";
  }

  // Rule 2 — graph policy
  if (slice.id === "graphSummary") {
    if (graphMode === "off") return "DROP";
    if (graphMode === "index") {
      if (slice.estimatedTokens <= plan.graphBudget) {
        budget.remaining = Math.max(0, budget.remaining - slice.estimatedTokens);
        return "ADMIT";
      }
      return "REFERENCE";
    }
    // graphMode === "expanded": always admit the full graph
    budget.remaining = Math.max(0, budget.remaining - slice.estimatedTokens);
    return "ADMIT";
  }

  // Rule 3 — lite intensity defers low-value sections
  if (contextIntensity === "lite") {
    if (slice.id === "workflows" || slice.id === "recentEvents") return "DEFER";
  }

  // Rule 4 — missing content with low importance is just noise
  if (slice.freshness === "missing" && SLICE_IMPORTANCE[slice.id] < 6) return "DROP";

  // Rule 5 — budget enforcement
  if (slice.estimatedTokens > budget.remaining) {
    return SLICE_IMPORTANCE[slice.id] >= 6 ? "REFERENCE" : "DEFER";
  }

  budget.remaining = Math.max(0, budget.remaining - slice.estimatedTokens);
  return "ADMIT";
}

/**
 * Run the admission engine over a ContextPlan.
 *
 * Slices are evaluated in descending importance order so the token budget is
 * spent on the most critical sections first. The original slice ordering is
 * restored before returning so the assembler can iterate predictably.
 *
 * Returns a ContextObject with every slice carrying its final decision.
 */
export function runAdmission(plan: ContextPlan, executionPlan: ExecutionPlan): ContextObject {
  const identityBound =
    plan.admissionIdentity.projectId === plan.projectId &&
    plan.admissionIdentity.projectRevision.length > 0 &&
    plan.admissionIdentity.sourceRoot.length > 0 &&
    plan.admissionIdentity.scanCorrelationId.length > 0;
  const sorted = [...plan.slices].sort(
    (a, b) => SLICE_IMPORTANCE[b.id] - SLICE_IMPORTANCE[a.id],
  );

  const budget = { remaining: plan.budgetTokens };
  const decisionMap = new Map<SliceId, AdmissionDecision>();

  for (const slice of sorted) {
    decisionMap.set(slice.id, decideSlice(slice, executionPlan, budget));
  }

  // Restore original ordering for deterministic assembly.
  const classified: ContextSlice[] = plan.slices.map((s) => ({
    ...s,
    admissionDecision: decisionMap.get(s.id) ?? "ADMIT",
  }));

  return {
    plan: {
      ...plan,
      // An unbound identity is never allowed to present an admitted slice.
      // Keeping the slices in the plan preserves bounded diagnostics without
      // allowing them into the assembled prompt.
      slices: classified.map((slice) => ({
        ...slice,
        admissionDecision: identityBound ? slice.admissionDecision : "DROP",
      })),
    },
    admittedSlices:  classified.filter((s) => identityBound && s.admissionDecision === "ADMIT"),
    referenceSlices: classified.filter((s) => identityBound && s.admissionDecision === "REFERENCE"),
    deferredSlices:  classified.filter((s) => identityBound && s.admissionDecision === "DEFER"),
    droppedSlices:   classified.filter((s) => !identityBound || s.admissionDecision === "DROP"),
  };
}
