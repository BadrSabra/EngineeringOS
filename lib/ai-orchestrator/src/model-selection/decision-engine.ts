import { buildExecutionPlan, type ExecutionPlan, type ExecutionPlanOptions } from "./execution-plan.js";

export type ResolveExecutionDecisionOptions = ExecutionPlanOptions;

export function resolveExecutionDecision(
  scope: string,
  options?: ResolveExecutionDecisionOptions,
): ExecutionPlan {
  return buildExecutionPlan(scope, options);
}
