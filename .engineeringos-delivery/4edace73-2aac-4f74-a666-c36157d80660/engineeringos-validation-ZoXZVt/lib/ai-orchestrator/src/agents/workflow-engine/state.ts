import type { WorkflowPhase } from "../../schemas/workflow.schema.js";

export type WorkflowState = {
  phases: WorkflowPhase[];
  currentPhase: string | null;
  completedPhases: string[];
};

export function getPhaseNames(phases: WorkflowPhase[]): string[] {
  return phases.map((phase) => phase.name);
}

export function getKnownPhaseNames(state: Pick<WorkflowState, "phases">): Set<string> {
  return new Set(getPhaseNames(state.phases));
}

export function advanceCompletedPhases(state: WorkflowState): string[] {
  return state.currentPhase && !state.completedPhases.includes(state.currentPhase)
    ? [...state.completedPhases, state.currentPhase]
    : state.completedPhases;
}
