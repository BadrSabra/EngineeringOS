import { buildExecutionPlan, type ExecutionPlan, type ExecutionPlanOptions } from "./execution-plan.js";

export type ResolveExecutionDecisionOptions = ExecutionPlanOptions;

/**
 * The single authoritative entry point for producing a frozen ExecutionPlan.
 *
 * Every agent and route MUST call this function — never call buildExecutionPlan
 * from quality/quality-planner.ts directly. Centralising here ensures all
 * policy decisions (quality, context, memory, graph, history) originate from
 * one place and cannot be reconstructed piecemeal downstream.
 *
 * Context policy overrides (contextIntensityOverride, memoryModeOverride,
 * graphModeOverride, historyModeOverride) are accepted via the options object
 * and applied on top of the task-type defaults inside buildExecutionPlan.
 *
 * Returns a readonly view of the plan — callers must not mutate it.
 */
export function resolveExecutionDecision(
  scope: string,
  options?: ResolveExecutionDecisionOptions,
): Readonly<ExecutionPlan> {
  const plan = buildExecutionPlan(scope, options);
  return Object.freeze(plan) as Readonly<ExecutionPlan>;
}
