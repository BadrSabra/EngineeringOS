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