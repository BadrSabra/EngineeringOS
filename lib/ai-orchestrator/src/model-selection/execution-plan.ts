/**
 * Canonical re-export point for the ExecutionPlan contract.
 *
 * All layers outside lib/ai-orchestrator/src/quality/ must import the
 * ExecutionPlan type and its builder from here — never directly from
 * quality/quality-planner.ts. This makes model-selection/execution-plan.ts
 * the single stable import surface for the plan and all its policy types.
 */
export type {
  ExecutionPlan,
  ExecutionPlanOptions,
  CacheMode,
  ExecutionContextSection,
} from "../quality/quality-planner.js";

export type {
  ContextIntensity,
  MemoryMode,
  GraphMode,
  HistoryMode,
} from "../quality/task-profile.js";
export {
  EXECUTION_PHASES,
  PHASE_BUDGETS,
  PHASE_TOOL_POLICY,
  getPhaseBudget,
  isToolAllowedInPhase,
  createExecutionPhaseState,
  transitionExecutionPhase,
} from "../quality/execution-phases.js";
export type {
  ExecutionPhase,
  PhaseBudget,
  ExecutionPhaseState,
  PhaseTransitionResult,
  ValidationEvidenceStatus,
} from "../quality/execution-phases.js";

export { buildExecutionPlan } from "../quality/quality-planner.js";
export { getExecutionPlanContextSections } from "../quality/quality-planner.js";
