/**
 * Server-owned phases for repair and analysis work.
 *
 * A model may suggest work, but it cannot choose the phase or borrow another
 * phase's budget. Keeping this contract data-only makes it usable by the
 * tool loop, prompt composer, and deterministic benchmarks.
 */
export type ExecutionPhase =
  | "localization"
  | "evidence"
  | "patch_proposal"
  | "validation"
  | "repair_recovery"
  | "report";

export type PhaseBudget = {
  maxModelCalls: number;
  maxToolCalls: number;
  maxOutputTokens: number;
};

export type ValidationEvidenceStatus = "passed" | "failed" | "unavailable";

export type ExecutionPhaseState = {
  phase: ExecutionPhase;
  completed: readonly ExecutionPhase[];
  validationEvidence?: ValidationEvidenceStatus;
  repairAttempts: number;
};

export type PhaseTransitionResult =
  | { ok: true; state: ExecutionPhaseState }
  | { ok: false; reason: string; state: ExecutionPhaseState };

export const MAX_PHASE_REPAIR_ATTEMPTS = 3;

export const EXECUTION_PHASES: readonly ExecutionPhase[] = [
  "localization",
  "evidence",
  "patch_proposal",
  "validation",
  "repair_recovery",
  "report",
];

export const PHASE_BUDGETS: Readonly<Record<ExecutionPhase, PhaseBudget>> = {
  localization: { maxModelCalls: 2, maxToolCalls: 8, maxOutputTokens: 768 },
  evidence: { maxModelCalls: 3, maxToolCalls: 20, maxOutputTokens: 1_024 },
  patch_proposal: { maxModelCalls: 2, maxToolCalls: 8, maxOutputTokens: 1_536 },
  validation: { maxModelCalls: 2, maxToolCalls: 6, maxOutputTokens: 768 },
  repair_recovery: { maxModelCalls: 2, maxToolCalls: 10, maxOutputTokens: 1_024 },
  report: { maxModelCalls: 1, maxToolCalls: 0, maxOutputTokens: 1_536 },
};

export const PHASE_TOOL_POLICY: Readonly<Record<ExecutionPhase, readonly string[]>> = {
  localization: ["search_code", "list_directory"],
  evidence: ["read_file", "read_file_range", "search_code", "list_directory"],
  patch_proposal: ["read_file", "read_file_range", "replace_text", "write_file"],
  validation: ["run_validation"],
  repair_recovery: ["read_file", "read_file_range", "replace_text", "write_file", "run_validation"],
  report: [],
};

export function getPhaseBudget(phase: ExecutionPhase): PhaseBudget {
  return PHASE_BUDGETS[phase];
}

export function isToolAllowedInPhase(phase: ExecutionPhase, toolName: string): boolean {
  return PHASE_TOOL_POLICY[phase].includes(toolName);
}

export function createExecutionPhaseState(): ExecutionPhaseState {
  return { phase: "localization", completed: [], repairAttempts: 0 };
}

/**
 * Advance the server-owned repair journey. The model can provide evidence,
 * but it cannot skip a phase or turn an unvalidated repair into a report.
 */
export function transitionExecutionPhase(
  state: ExecutionPhaseState,
  nextPhase: ExecutionPhase,
  validationEvidence?: ValidationEvidenceStatus,
): PhaseTransitionResult {
  const currentIndex = EXECUTION_PHASES.indexOf(state.phase);
  const nextIndex = EXECUTION_PHASES.indexOf(nextPhase);
  const sequential = nextIndex === currentIndex + 1;
  const validationToReport =
    state.phase === "validation" && nextPhase === "report";
  const recoveryToValidation =
    state.phase === "repair_recovery" && nextPhase === "validation";
  if (!sequential && !validationToReport && !recoveryToValidation) {
    return {
      ok: false,
      reason: `Cannot transition from ${state.phase} to ${nextPhase}; phases must advance in order.`,
      state,
    };
  }

  if (state.phase === "validation" && !validationEvidence) {
    return {
      ok: false,
      reason: "Validation evidence is required before leaving the validation phase.",
      state,
    };
  }
  if (nextPhase === "repair_recovery" && validationEvidence === "passed") {
    return {
      ok: false,
      reason: "Passed validation cannot enter repair recovery.",
      state,
    };
  }
  if (nextPhase === "repair_recovery" && state.repairAttempts >= MAX_PHASE_REPAIR_ATTEMPTS) {
    return {
      ok: false,
      reason: "The bounded repair recovery budget has been exhausted.",
      state,
    };
  }
  if (nextPhase === "report" && (state.phase !== "validation" || validationEvidence !== "passed")) {
    return {
      ok: false,
      reason: "A report requires passed validation evidence.",
      state,
    };
  }

  const completed = [...state.completed, state.phase];
  return {
    ok: true,
    state: {
      phase: nextPhase,
      completed,
      ...(validationEvidence ? { validationEvidence } : {}),
      repairAttempts: state.repairAttempts + (nextPhase === "repair_recovery" ? 1 : 0),
    },
  };
}