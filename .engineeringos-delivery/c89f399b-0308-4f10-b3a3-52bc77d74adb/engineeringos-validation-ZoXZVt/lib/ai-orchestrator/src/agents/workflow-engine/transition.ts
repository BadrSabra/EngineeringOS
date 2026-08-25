import type { WorkflowDecision } from "../../schemas/workflow.schema.js";
import { advanceCompletedPhases, type WorkflowState } from "./state.js";

export function applyWorkflowTransition(decision: WorkflowDecision, state: WorkflowState): WorkflowState {
  if (decision.action === "advance") {
    return { ...state, currentPhase: decision.nextPhase, completedPhases: advanceCompletedPhases(state) };
  }

  if (decision.action === "complete") {
    return { ...state, currentPhase: null, completedPhases: advanceCompletedPhases(state) };
  }

  return state;
}
