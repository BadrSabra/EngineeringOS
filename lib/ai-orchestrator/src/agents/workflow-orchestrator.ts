/**
 * Workflow Orchestrator — given a workflow definition and current execution
 * state, decides the next action: advance, wait, fail, or complete.
 *
 * Three explicit stages ensure the model can only ever *propose* a transition,
 * never force one through:
 *   decide()           — ask the model for a proposed decision
 *   validateDecision() — reject any decision inconsistent with real state
 *   executeDecision()  — apply a state transition; validates internally so
 *                        no caller can bypass the guard by calling this
 *                        function directly with an unvalidated decision
 */
import { complete, MODEL_POWERFUL, type Message } from "../groq-client.js";
import type { ProjectContext } from "../context-builder.js";
import { buildWorkflowSystemPrompt, buildWorkflowUserPrompt } from "../prompts/workflow.prompt.js";
import { WorkflowDecisionSchema, type WorkflowDecision, type WorkflowPhase } from "../schemas/workflow.schema.js";
import { parseAgentResponse } from "../parsing.js";

export type { WorkflowPhase };
/** @deprecated use `WorkflowDecision` from "../schemas/workflow.schema.js" */
export type OrchestrationDecision = WorkflowDecision;

export type WorkflowState = {
  phases: WorkflowPhase[];
  currentPhase: string | null;
  completedPhases: string[];
};

function fallbackDecision(raw: string): WorkflowDecision {
  return {
    action: "wait",
    reasoning: raw.trim() || "Model did not return a usable decision; holding at current phase for manual review.",
    suggestions: ["Review workflow state manually"],
  };
}

function rejectedDecision(reasoning: string): WorkflowDecision {
  return { action: "wait", reasoning, blockers: [reasoning] };
}

/**
 * Asks the model for a proposed decision. Never throws on bad model output —
 * parse/schema failures degrade to a "wait" fallback (see `parseAgentResponse`).
 */
export async function decide(opts: {
  workflowName: string;
  phases: WorkflowPhase[];
  currentPhase: string | null;
  completedPhases: string[];
  projectContext: ProjectContext;
  additionalContext?: string;
  /** Optional per-user Groq API key. Falls back to process.env.GROQ_API_KEY. */
  apiKey?: string;
}): Promise<WorkflowDecision> {
  const messages: Message[] = [
    { role: "system", content: buildWorkflowSystemPrompt() },
    { role: "user", content: buildWorkflowUserPrompt(opts) },
  ];

  const response = await complete(messages, { model: MODEL_POWERFUL, apiKey: opts.apiKey });
  const parsed = parseAgentResponse(response.content, WorkflowDecisionSchema, fallbackDecision);
  if (!parsed.ok) {
    console.warn(JSON.stringify({ scope: "workflow-orchestrator", stage: "decide", code: parsed.code, message: parsed.message }));
  }
  return parsed.data;
}

/**
 * Guards a proposed decision against the actual workflow state. The model
 * proposing an unknown phase, a no-op transition, or completing before the
 * final phase gets downgraded to a safe "wait" — an invalid transition can
 * never reach `executeDecision()`.
 */
export function validateDecision(
  decision: WorkflowDecision,
  state: Pick<WorkflowState, "phases" | "currentPhase">,
): WorkflowDecision {
  const knownPhaseNames = new Set(state.phases.map((p) => p.name));

  if (decision.action === "advance") {
    if (!decision.nextPhase) {
      return rejectedDecision(`Rejected "advance" decision: no nextPhase was specified.`);
    }
    if (!knownPhaseNames.has(decision.nextPhase)) {
      return rejectedDecision(
        `Rejected "advance" decision: nextPhase "${decision.nextPhase}" is not a defined phase of this workflow.`,
      );
    }
    if (decision.nextPhase === state.currentPhase) {
      return rejectedDecision(
        `Rejected "advance" decision: nextPhase "${decision.nextPhase}" is already the current phase.`,
      );
    }

    // Linear ordering: the model may only advance to the immediate successor.
    // When currentPhase is null (workflow not yet started) the guard is skipped
    // so the first phase can be freely selected. When currentPhase is present
    // but not found in the phases list (corrupted state), the guard is also
    // skipped rather than erroneously blocking a valid decision.
    const phaseNames = state.phases.map((p) => p.name);
    const currentIdx = state.currentPhase === null ? -1 : phaseNames.indexOf(state.currentPhase);
    const nextIdx = phaseNames.indexOf(decision.nextPhase);
    if (currentIdx !== -1 && nextIdx !== currentIdx + 1) {
      return rejectedDecision(
        `Rejected "advance" decision: phase "${decision.nextPhase}" is not the immediate successor of "${state.currentPhase}".`,
      );
    }
  }

  if (decision.action === "complete" && state.phases.length > 0) {
    const lastPhase = state.phases[state.phases.length - 1];
    if (state.currentPhase !== lastPhase.name) {
      return rejectedDecision(
        `Rejected "complete" decision: workflow is at phase "${state.currentPhase ?? "none"}", not its final phase "${lastPhase.name}".`,
      );
    }
  }

  return decision;
}

/**
 * Applies an already-validated decision to workflow state. Pure function —
 * callers persist the returned state. Only "advance" and "complete" mutate it.
 *
 * Validation is enforced internally for both mutating actions: a caller that
 * skips validateDecision() and calls this function directly cannot produce an
 * illegal transition. For callers that already validated (the normal path
 * through orchestrateWorkflow), the re-check is idempotent — a valid decision
 * passes through unchanged.
 *
 * When an unvalidated illegal decision reaches this function, the decision is
 * downgraded to "wait", a warning is logged, and the original state is
 * returned without modification.
 */
export function executeDecision(decision: WorkflowDecision, state: WorkflowState): WorkflowState {
  const advanceCompletedPhases = (): string[] =>
    state.currentPhase && !state.completedPhases.includes(state.currentPhase)
      ? [...state.completedPhases, state.currentPhase]
      : state.completedPhases;

  if (decision.action === "advance") {
    const safe = validateDecision(decision, state);
    if (safe.action !== "advance") {
      // Decision was illegal (unknown phase, no-op, etc.) — reject it here
      // rather than writing corrupt state. This branch is only reachable when
      // a caller bypasses validateDecision(); the normal orchestrateWorkflow()
      // path never reaches it.
      console.warn(
        JSON.stringify({
          scope: "workflow-orchestrator",
          stage: "executeDecision",
          code: "DECISION_REJECTED_AT_EXECUTE",
          originalAction: "advance",
          reasoning: safe.reasoning,
        }),
      );
      return state;
    }
    // safe.nextPhase is string (guaranteed by the advance schema variant and
    // confirmed by validateDecision passing it through).
    return { ...state, currentPhase: safe.nextPhase, completedPhases: advanceCompletedPhases() };
  }

  if (decision.action === "complete") {
    const safe = validateDecision(decision, state);
    if (safe.action !== "complete") {
      // Premature completion — not at the final phase.
      console.warn(
        JSON.stringify({
          scope: "workflow-orchestrator",
          stage: "executeDecision",
          code: "DECISION_REJECTED_AT_EXECUTE",
          originalAction: "complete",
          reasoning: safe.reasoning,
        }),
      );
      return state;
    }
    return { ...state, currentPhase: null, completedPhases: advanceCompletedPhases() };
  }

  // "wait" and "fail" never mutate state — no validation needed.
  return state;
}

/** Back-compat convenience for callers that just want a validated decision (decide → validate). */
export async function orchestrateWorkflow(opts: {
  workflowName: string;
  phases: WorkflowPhase[];
  currentPhase: string | null;
  completedPhases: string[];
  projectContext: ProjectContext;
  additionalContext?: string;
  /** Optional per-user Groq API key. Falls back to process.env.GROQ_API_KEY. */
  apiKey?: string;
}): Promise<WorkflowDecision> {
  const proposed = await decide(opts);

  // G-08: metrics gate — if the context carries unverified metrics (no
  // successful scan has run), block "advance" and "complete" decisions.
  // The prompt already instructs the model to emit "wait" in this case, but
  // the instruction is text-only; this guard enforces it in code regardless
  // of whether the model obeyed.
  const metricsUnverified = opts.projectContext.latestMetrics.includes("⚠ WARNING:");
  if (metricsUnverified && (proposed.action === "advance" || proposed.action === "complete")) {
    const reason =
      `Metrics gate: workflow cannot advance while project metrics are unverified. ` +
      `Run a scan first so the orchestrator has reliable data to base its decision on.`;
    console.warn(
      JSON.stringify({
        scope: "workflow-orchestrator",
        code: "METRICS_GATE_BLOCKED",
        proposedAction: proposed.action,
        nextPhase: "nextPhase" in proposed ? proposed.nextPhase : undefined,
      }),
    );
    return { action: "wait", reasoning: reason, blockers: [reason] };
  }

  const validated = validateDecision(proposed, { phases: opts.phases, currentPhase: opts.currentPhase });

  // G-10: log a distinguishable warning when validateDecision silently
  // changes the action, so callers (and the eventsTable entry that follows)
  // can tell the difference between "AI chose wait" and "AI tried to advance
  // but was rejected".
  if (validated.action !== proposed.action) {
    console.warn(
      JSON.stringify({
        scope: "workflow-orchestrator",
        code: "DECISION_DOWNGRADED",
        originalAction: proposed.action,
        downgradedTo: validated.action,
        reason: validated.reasoning,
        nextPhase: "nextPhase" in proposed ? proposed.nextPhase : undefined,
      }),
    );
  }

  return validated;
}
