/**
 * Workflow domain service — extracted from routes/workflows.ts (audit finding W-003).
 *
 * Contains the pure phase-advancement logic:
 *   - safe condition evaluation (uses condition-evaluator, not new Function)
 *   - phase ordering and next-phase computation
 *
 * No HTTP concerns, no DB writes, no Express types live here. The route
 * handler owns request parsing, DB reads/writes, event/audit emission, and
 * HTTP response shaping.
 */
import { evaluateCondition, type ConditionContext } from "../lib/condition-evaluator.js";

export type { ConditionContext };

// ── Condition evaluation ──────────────────────────────────────────────────────

/** Result of checking whether an advance condition is satisfied. */
export type ConditionCheckResult =
  | { allowed: true }
  | { allowed: false; reason: "condition_not_met"; condition: string; context: ConditionContext }
  | { allowed: false; reason: "condition_evaluation_error"; condition: string; detail: string };

/**
 * Check whether a workflow phase's advance condition is satisfied.
 *
 * Returns `{ allowed: true }` when:
 *   - `condition` is undefined / empty (unconditional advance), or
 *   - the condition expression evaluates to `true` against `ctx`.
 *
 * Returns `{ allowed: false, ... }` with enough detail for the route to
 * return a structured HTTP 400 or 409 without catching raw errors.
 */
export function checkAdvanceCondition(
  condition: string | undefined,
  ctx: ConditionContext,
): ConditionCheckResult {
  if (!condition || !condition.trim()) return { allowed: true };

  try {
    const met = evaluateCondition(condition, ctx);
    if (met) return { allowed: true };
    return { allowed: false, reason: "condition_not_met", condition, context: ctx };
  } catch (err) {
    return {
      allowed: false,
      reason: "condition_evaluation_error",
      condition,
      detail: err instanceof Error ? err.message : String(err),
    };
  }
}

// ── Phase advancement ─────────────────────────────────────────────────────────

export interface PhaseShape {
  name: string;
  condition?: string;
}

export interface PhaseAdvancement {
  /** `null` when the current phase is the last one (workflow completion). */
  nextPhase: string | null;
  /** Updated completed-phases list (includes the phase just finished). */
  completedPhases: string[];
  isLastPhase: boolean;
}

/**
 * Compute the phase transition for a workflow advance operation.
 *
 * Pure function — no DB access, safe to unit-test in isolation.
 *
 * @param phases             Ordered phase list from the workflow definition.
 * @param currentPhase       Name of the currently executing phase.
 * @param prevCompletedPhases Already-completed phases from the execution row.
 */
export function computePhaseAdvancement(
  phases: PhaseShape[],
  currentPhase: string,
  prevCompletedPhases: string[],
): PhaseAdvancement {
  const currentIndex = phases.findIndex((p) => p.name === currentPhase);
  const isLastPhase = currentIndex === -1 || currentIndex === phases.length - 1;
  const nextPhase = isLastPhase ? null : phases[currentIndex + 1].name;

  const completedPhases = [
    ...prevCompletedPhases,
    ...(currentPhase ? [currentPhase] : []),
  ];

  return { nextPhase, completedPhases, isLastPhase };
}
