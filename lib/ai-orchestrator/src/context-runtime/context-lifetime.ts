/**
 * Context Runtime — Lifetime Management
 *
 * Defines per-slice TTL, decay rate, and archive thresholds so the Admission
 * Engine can downgrade stale slices without a full cache bust.
 *
 * Flow:
 *   After runAdmission() produces a ContextObject, callers may optionally
 *   pass it through applyLifetime() to further demote slices whose loadedAt
 *   timestamp has aged past the per-slice thresholds.
 *
 * Decay stages (applied in order when a slice is already ADMIT or REFERENCE):
 *   fresh    — age < ttlMs                   → no change
 *   stale    — age ≥ ttlMs * decayThreshold  → downgrade ADMIT → REFERENCE
 *   archived — age ≥ ttlMs * archiveThreshold → downgrade to DEFER
 */

import type { SliceId, ContextSlice, ContextObject, AdmissionDecision } from "./context-object.js";

// ─── Types ────────────────────────────────────────────────────────────────────

export type SliceLifetimePolicy = {
  /**
   * Maximum age in ms before a slice is considered stale.
   * After this, ADMIT → REFERENCE.
   */
  ttlMs: number;
  /**
   * Fraction of ttlMs at which decay begins.
   * E.g. 0.8 → decay starts at 80 % of ttlMs.
   */
  decayThreshold: number;
  /**
   * Fraction of ttlMs at which the slice is archived (DEFER forced).
   * Must be > decayThreshold.
   */
  archiveThreshold: number;
};

export type LifetimePolicy = Partial<Record<SliceId, SliceLifetimePolicy>>;

export type SliceLifetimeState = {
  sliceId: SliceId;
  ageMs: number;
  staleness: number;           // 0 → fresh, 1 → exactly at TTL, >1 → over TTL
  stage: "fresh" | "stale" | "archived";
  originalDecision: AdmissionDecision;
  effectiveDecision: AdmissionDecision;
};

export type LifetimeResult = {
  contextObject: ContextObject;
  states: SliceLifetimeState[];
  anyDemoted: boolean;
};

// ─── Default per-slice policies ───────────────────────────────────────────────

/**
 * Volatility-based defaults:
 *  - recentEvents / latestMetrics → very short TTL (change on every run)
 *  - recentTasks                  → short TTL
 *  - graphSummary / workflows     → medium TTL (change only on scans)
 *  - project                      → long TTL (metadata is nearly immutable)
 */
export const DEFAULT_LIFETIME_POLICY: Required<LifetimePolicy> = {
  project:       { ttlMs: 5 * 60_000,  decayThreshold: 0.85, archiveThreshold: 2.0  },
  recentTasks:   { ttlMs: 45_000,      decayThreshold: 0.80, archiveThreshold: 2.0  },
  latestMetrics: { ttlMs: 30_000,      decayThreshold: 0.75, archiveThreshold: 1.5  },
  graphSummary:  { ttlMs: 3 * 60_000,  decayThreshold: 0.80, archiveThreshold: 2.5  },
  recentEvents:  { ttlMs: 20_000,      decayThreshold: 0.70, archiveThreshold: 1.5  },
  workflows:     { ttlMs: 2 * 60_000,  decayThreshold: 0.80, archiveThreshold: 2.0  },
};

// ─── Helpers ──────────────────────────────────────────────────────────────────

function getStage(staleness: number, policy: SliceLifetimePolicy): "fresh" | "stale" | "archived" {
  const decayAt    = policy.decayThreshold;
  const archiveAt  = policy.archiveThreshold;
  if (staleness >= archiveAt) return "archived";
  if (staleness >= decayAt)   return "stale";
  return "fresh";
}

function demoteDecision(current: AdmissionDecision, stage: "fresh" | "stale" | "archived"): AdmissionDecision {
  if (stage === "fresh") return current;
  if (stage === "archived") {
    // archived: force to DEFER unless already lower
    if (current === "ADMIT" || current === "REFERENCE") return "DEFER";
    return current;
  }
  // stale: downgrade ADMIT → REFERENCE; everything else unchanged
  if (current === "ADMIT") return "REFERENCE";
  return current;
}

function applyLifetimeToSlice(
  slice: ContextSlice,
  nowMs: number,
  policy: SliceLifetimePolicy,
): SliceLifetimeState {
  const ageMs     = Math.max(0, nowMs - slice.loadedAt);
  const staleness = ageMs / policy.ttlMs;
  const stage     = getStage(staleness, policy);
  const effective = demoteDecision(slice.admissionDecision, stage);
  return {
    sliceId:           slice.id,
    ageMs,
    staleness,
    stage,
    originalDecision:  slice.admissionDecision,
    effectiveDecision: effective,
  };
}

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Apply lifetime policy to a ContextObject.
 *
 * Returns a new ContextObject with mutated admissionDecisions for slices that
 * have aged past their decay or archive threshold, plus a states array for
 * observability and the `anyDemoted` flag for fast short-circuiting.
 *
 * The original ContextObject is never mutated.
 *
 * @param contextObject - Output of runAdmission().
 * @param policy        - Per-slice lifetime policy; defaults to DEFAULT_LIFETIME_POLICY.
 * @param nowMs         - Current timestamp in ms; defaults to Date.now().
 */
export function applyLifetime(
  contextObject: ContextObject,
  policy: LifetimePolicy = DEFAULT_LIFETIME_POLICY,
  nowMs: number = Date.now(),
): LifetimeResult {
  const states: SliceLifetimeState[] = [];
  let anyDemoted = false;

  function processSlice(slice: ContextSlice): ContextSlice {
    const slicePolicy = policy[slice.id] ?? DEFAULT_LIFETIME_POLICY[slice.id];
    if (!slicePolicy) return slice; // no policy → no change

    const state = applyLifetimeToSlice(slice, nowMs, slicePolicy);
    states.push(state);

    if (state.effectiveDecision === state.originalDecision) {
      return { ...slice, lifetimeStage: state.stage };
    }

    anyDemoted = true;
    return {
      ...slice,
      admissionDecision: state.effectiveDecision,
      lifetimeStage: state.stage,
    };
  }

  const newAdmitted:   ContextSlice[] = [];
  const newReferenced: ContextSlice[] = [];
  const newDeferred:   ContextSlice[] = [];
  const dropped: ContextSlice[]       = contextObject.droppedSlices.map(processSlice);

  // Re-bucket slices whose decision was demoted.
  for (const slice of contextObject.admittedSlices) {
    const updated = processSlice(slice);
    if (updated.admissionDecision === "ADMIT")     newAdmitted.push(updated);
    else if (updated.admissionDecision === "REFERENCE") newReferenced.push(updated);
    else newDeferred.push(updated);
  }
  for (const slice of contextObject.referenceSlices) {
    const updated = processSlice(slice);
    if (updated.admissionDecision === "REFERENCE") newReferenced.push(updated);
    else newDeferred.push(updated);
  }
  for (const slice of contextObject.deferredSlices) {
    newDeferred.push(processSlice(slice));
  }

  // Rebuild plan.slices to reflect updated decisions.
  const allUpdated = [...newAdmitted, ...newReferenced, ...newDeferred, ...dropped];
  const sliceMap = new Map(allUpdated.map((s) => [s.id, s]));
  const updatedPlanSlices = contextObject.plan.slices.map((s) => sliceMap.get(s.id) ?? s);

  return {
    contextObject: {
      plan: { ...contextObject.plan, slices: updatedPlanSlices },
      admittedSlices:  newAdmitted,
      referenceSlices: newReferenced,
      deferredSlices:  newDeferred,
      droppedSlices:   dropped,
    },
    states,
    anyDemoted,
  };
}
