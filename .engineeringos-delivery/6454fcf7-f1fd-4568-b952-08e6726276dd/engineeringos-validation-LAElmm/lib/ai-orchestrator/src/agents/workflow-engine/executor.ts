import type { WorkflowDecision } from "../../schemas/workflow.schema.js";
import { validateWorkflowDecision } from "./guard.js";
import { applyWorkflowTransition } from "./transition.js";
import type { WorkflowState } from "./state.js";

export function executeWorkflowDecision(decision: WorkflowDecision, state: WorkflowState): WorkflowState {
  const advanceCompletedPhases = (): string[] =>
    state.currentPhase && !state.completedPhases.includes(state.currentPhase)
      ? [...state.completedPhases, state.currentPhase]
      : state.completedPhases;

  if (decision.action === "advance") {
    const safe = validateWorkflowDecision(decision, state);
    if (safe.action !== "advance") {
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
    return { ...state, currentPhase: safe.nextPhase, completedPhases: advanceCompletedPhases() };
  }

  if (decision.action === "complete") {
    const safe = validateWorkflowDecision(decision, state);
    if (safe.action !== "complete") {
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

  return applyWorkflowTransition(decision, state);
}
