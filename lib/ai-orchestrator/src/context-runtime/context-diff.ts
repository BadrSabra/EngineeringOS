/**
 * Context Runtime — Snapshot & Diff
 *
 * Enables delta-aware cache invalidation: instead of busting the entire cache
 * whenever any DB row changes, callers can compare two ContextObject snapshots
 * and invalidate only the slices that actually changed.
 *
 * Usage:
 *   const snap1 = takeSnapshot(contextObject1);
 *   // … time passes, context reloaded …
 *   const snap2 = takeSnapshot(contextObject2);
 *   const delta = diffSnapshots(snap1, snap2);
 *   if (delta.changedSlices.length > 0) { ... }
 */

import type {
  SliceId,
  ContextObject,
  AdmissionDecision,
  ContextSliceHealthStatus,
} from "./context-object.js";

// ─── Types ────────────────────────────────────────────────────────────────────

export type SliceFingerprint = {
  sliceId:           SliceId;
  contentLength:     number;
  /** First 64 chars of content — cheap change detector. */
  contentHead:       string;
  /** Last 64 chars of content — catches tail-only edits. */
  contentTail:       string;
  estimatedTokens:   number;
  admissionDecision: AdmissionDecision;
  healthStatus:       ContextSliceHealthStatus;
  failureCode?:       string;
  freshness:         "fresh" | "stale" | "missing";
  loadedAt:          number;
};

export type ContextSnapshot = {
  projectId:   string;
  takenAt:     number;
  fingerprints: Map<SliceId, SliceFingerprint>;
  totalEstimatedTokens: number;
  budgetTokens:         number;
};

export type SliceChangeKind =
  | "added"      // present in next, absent in prev
  | "removed"    // present in prev, absent in next
  | "content"    // content changed (length or head/tail differ)
  | "decision"   // only admissionDecision changed
  | "health"     // load outcome or failure category changed
  | "freshness"  // only freshness changed
  | "unchanged";

export type SliceDelta = {
  sliceId:  SliceId;
  kind:     SliceChangeKind;
  prev:     SliceFingerprint | null;
  next:     SliceFingerprint | null;
};

export type ContextDelta = {
  prevTakenAt:     number;
  nextTakenAt:     number;
  deltas:          SliceDelta[];
  /** Slices with kind !== "unchanged". */
  changedSlices:   SliceId[];
  /** True if any content changed (not just decision/freshness). */
  contentChanged:  boolean;
  /** Approximate token delta (next total − prev total). */
  tokenDelta:      number;
};

// ─── Helpers ──────────────────────────────────────────────────────────────────

const HEAD_TAIL_LEN = 64;

function fingerprint(
  sliceId: SliceId,
  content: string,
  tokens: number,
  decision: AdmissionDecision,
  healthStatus: ContextSliceHealthStatus,
  failureCode: string | undefined,
  freshness: "fresh" | "stale" | "missing",
  loadedAt: number,
): SliceFingerprint {
  return {
    sliceId,
    contentLength:     content.length,
    contentHead:       content.slice(0, HEAD_TAIL_LEN),
    contentTail:       content.length > HEAD_TAIL_LEN ? content.slice(-HEAD_TAIL_LEN) : "",
    estimatedTokens:   tokens,
    admissionDecision: decision,
    healthStatus,
    ...(failureCode ? { failureCode } : {}),
    freshness,
    loadedAt,
  };
}

function contentEqual(a: SliceFingerprint, b: SliceFingerprint): boolean {
  return (
    a.contentLength === b.contentLength &&
    a.contentHead   === b.contentHead   &&
    a.contentTail   === b.contentTail
  );
}

function classifyChange(prev: SliceFingerprint, next: SliceFingerprint): SliceChangeKind {
  if (!contentEqual(prev, next))                    return "content";
  if (prev.admissionDecision !== next.admissionDecision) return "decision";
  if (prev.healthStatus !== next.healthStatus || prev.failureCode !== next.failureCode) return "health";
  if (prev.freshness         !== next.freshness)    return "freshness";
  return "unchanged";
}

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Capture a lightweight fingerprint snapshot of every slice in a ContextObject.
 * O(n) in the number of slices; allocates only primitive fields (no full content copies).
 */
export function takeSnapshot(contextObject: ContextObject): ContextSnapshot {
  const all = [
    ...contextObject.admittedSlices,
    ...contextObject.referenceSlices,
    ...contextObject.deferredSlices,
    ...contextObject.droppedSlices,
  ];

  const prints = new Map<SliceId, SliceFingerprint>();
  for (const slice of all) {
    prints.set(
      slice.id,
      fingerprint(
        slice.id,
        slice.content,
        slice.estimatedTokens,
        slice.admissionDecision,
        slice.healthStatus,
        slice.failureCode,
        slice.freshness,
        slice.loadedAt,
      ),
    );
  }

  return {
    projectId:            contextObject.plan.projectId,
    takenAt:              Date.now(),
    fingerprints:         prints,
    totalEstimatedTokens: contextObject.plan.totalEstimatedTokens,
    budgetTokens:         contextObject.plan.budgetTokens,
  };
}

/**
 * Diff two ContextSnapshots and return a ContextDelta.
 *
 * - Slices present in `next` but not `prev` → "added"
 * - Slices present in `prev` but not `next` → "removed"
 * - All others → classified by contentEqual / decision / freshness
 */
export function diffSnapshots(prev: ContextSnapshot, next: ContextSnapshot): ContextDelta {
  const deltas: SliceDelta[] = [];
  const allIds = new Set<SliceId>([
    ...prev.fingerprints.keys(),
    ...next.fingerprints.keys(),
  ]);

  for (const id of allIds) {
    const p = prev.fingerprints.get(id) ?? null;
    const n = next.fingerprints.get(id) ?? null;

    if (p === null) {
      deltas.push({ sliceId: id, kind: "added",   prev: null, next: n });
    } else if (n === null) {
      deltas.push({ sliceId: id, kind: "removed",  prev: p,   next: null });
    } else {
      deltas.push({ sliceId: id, kind: classifyChange(p, n), prev: p, next: n });
    }
  }

  const changedSlices = deltas
    .filter((d) => d.kind !== "unchanged")
    .map((d) => d.sliceId);

  return {
    prevTakenAt:    prev.takenAt,
    nextTakenAt:    next.takenAt,
    deltas,
    changedSlices,
    contentChanged: deltas.some((d) => d.kind === "content" || d.kind === "added" || d.kind === "removed"),
    tokenDelta:     next.totalEstimatedTokens - prev.totalEstimatedTokens,
  };
}

/**
 * Quick check: returns true if the two snapshots share the same content
 * fingerprints for all slices (decisions and freshness may differ).
 */
export function snapshotsContentEqual(prev: ContextSnapshot, next: ContextSnapshot): boolean {
  if (prev.fingerprints.size !== next.fingerprints.size) return false;
  for (const [id, pf] of prev.fingerprints) {
    const nf = next.fingerprints.get(id);
    if (!nf || !contentEqual(pf, nf)) return false;
  }
  return true;
}
