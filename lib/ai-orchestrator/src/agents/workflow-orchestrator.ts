/**
 * Workflow Orchestrator — given a workflow definition and current execution
 * state, decides the next action: advance, wait, fail, or complete.
 *
 * Split into three explicit stages so the model can only ever *propose* a
 * transition, never force one through:
 *   decide()          — ask the model for a proposed decision
 *   validateDecision() — reject any decision inconsistent with real state
 *   executeDecision()  — pure state transition for a decision already
 *                        validated (callers persist the result themselves)
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
 */
export function executeDecision(decision: WorkflowDecision, state: WorkflowState): WorkflowState {
  const advanceCompletedPhases = () =>
    state.currentPhase && !state.completedPhases.includes(state.currentPhase)
      ? [...state.completedPhases, state.currentPhase]
      : state.completedPhases;

  if (decision.action === "advance" && decision.nextPhase) {
    return { ...state, currentPhase: decision.nextPhase, completedPhases: advanceCompletedPhases() };
  }
  if (decision.action === "complete") {
    return { ...state, currentPhase: null, completedPhases: advanceCompletedPhases() };
  }
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
  return validateDecision(proposed, { phases: opts.phases, currentPhase: opts.currentPhase });
}
