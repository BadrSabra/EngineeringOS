import { z } from "zod";

export const WorkflowPhaseSchema = z
  .object({
    name: z.string().min(1),
    steps: z.array(z.string().min(1)).min(1),
    condition: z.string().optional(),
  })
  .strict();

/**
 * Parse and validate a raw `phases` value from the DB.
 *
 * Enforces:
 *   1. Every phase matches WorkflowPhaseSchema (name, steps[≥1], optional condition).
 *   2. Phase names are unique within the workflow — duplicate names break
 *      validateDecision(), which relies on linear name-based lookups.
 *
 * Returns `{ ok: true, phases }` on success or `{ ok: false, error }` on failure
 * so callers can decide whether to abort or fall back gracefully.
 */
export function parseWorkflowPhases(
  raw: unknown,
): { ok: true; phases: WorkflowPhase[] } | { ok: false; error: string } {
  const parsed = z.array(WorkflowPhaseSchema).safeParse(raw);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues.map((i) => i.message).join("; ") };
  }
  const names = parsed.data.map((p) => p.name);
  const seen = new Set<string>();
  for (const name of names) {
    if (seen.has(name)) {
      return { ok: false, error: `Duplicate phase name: "${name}". Phase names must be unique within a workflow.` };
    }
    seen.add(name);
  }
  return { ok: true, phases: parsed.data };
}

export const WorkflowActionSchema = z.enum(["advance", "wait", "fail", "complete"]);

// ── Action-specific decision shapes ──────────────────────────────────────────
//
// Each variant is kept strict so extra keys (e.g. nextPhase on a wait/fail,
// blockers on an advance/complete) are rejected rather than silently stripped.
// This prevents a confused model response from slipping through validation
// with cross-contaminated fields that contradict the declared action.
//
// Shared optional field: suggestions is allowed on every action.
// Individual suggestion strings must be non-empty.

/** advance — must name the phase to move to; blockers are not applicable. */
const AdvanceDecisionSchema = z.object({
  action: z.literal("advance"),
  reasoning: z.string().min(1),
  /** Required and non-empty. The agent's validateDecision() further checks
   *  that this value is an actual phase name defined in the workflow. */
  nextPhase: z.string().min(1),
  suggestions: z.array(z.string().min(1)).optional(),
}).strict();

/** wait — may carry blockers explaining the hold; nextPhase is not applicable.
 *
 *  blockers is optional at the type level to stay compatible with the agent's
 *  fallbackDecision(), which emits { action: "wait", ... } without blockers
 *  as a safe degradation path. However, when blockers IS provided it must
 *  contain at least one non-empty entry — an empty array means "waiting for
 *  nothing", which is invalid. */
const WaitDecisionSchema = z.object({
  action: z.literal("wait"),
  reasoning: z.string().min(1),
  blockers: z.array(z.string().min(1)).min(1).optional(),
  suggestions: z.array(z.string().min(1)).optional(),
}).strict();

/** fail — terminal failure; no phase to advance to, no blockers (the failure
 *  IS the blocker — reasoning must explain it). */
const FailDecisionSchema = z.object({
  action: z.literal("fail"),
  reasoning: z.string().min(1),
  suggestions: z.array(z.string().min(1)).optional(),
}).strict();

/** complete — workflow finished; no further transition is possible. */
const CompleteDecisionSchema = z.object({
  action: z.literal("complete"),
  reasoning: z.string().min(1),
  suggestions: z.array(z.string().min(1)).optional(),
}).strict();

// ── Union ─────────────────────────────────────────────────────────────────────

export const WorkflowDecisionSchema = z.discriminatedUnion("action", [
  AdvanceDecisionSchema,
  WaitDecisionSchema,
  FailDecisionSchema,
  CompleteDecisionSchema,
]);

export type WorkflowPhase = z.infer<typeof WorkflowPhaseSchema>;
export type WorkflowAction = z.infer<typeof WorkflowActionSchema>;
export type WorkflowDecision = z.infer<typeof WorkflowDecisionSchema>;
