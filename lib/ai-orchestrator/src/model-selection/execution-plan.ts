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
} from "../quality/quality-planner.js";

export type {
  ContextIntensity,
  MemoryMode,
  GraphMode,
  HistoryMode,
} from "../quality/task-profile.js";

export { buildExecutionPlan } from "../quality/quality-planner.js";
