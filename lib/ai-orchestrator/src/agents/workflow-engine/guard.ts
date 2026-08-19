import type { WorkflowDecision } from "../../schemas/workflow.schema.js";
import { getKnownPhaseNames, getPhaseNames, type WorkflowState } from "./state.js";

function rejectedDecision(reasoning: string): WorkflowDecision {
  return { action: "wait", reasoning, blockers: [reasoning] };
}

export function validateWorkflowDecision(
  decision: WorkflowDecision,
  state: Pick<WorkflowState, "phases" | "currentPhase">,
): WorkflowDecision {
  const knownPhaseNames = getKnownPhaseNames(state);

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

    const phaseNames = getPhaseNames(state.phases);
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
