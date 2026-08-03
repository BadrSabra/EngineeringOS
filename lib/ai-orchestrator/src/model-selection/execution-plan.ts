import type { ExecutionPlan as QualityExecutionPlan } from "../quality/quality-planner.js";
import { buildExecutionPlan as buildQualityExecutionPlan } from "../quality/quality-planner.js";
import type { QualityProfile } from "../quality-engine.js";
import type { TaskProfile } from "../quality/task-profile.js";
import type { ProviderCapabilityHints } from "../provider-capabilities.js";

export type ExecutionPlan = QualityExecutionPlan;

export type ExecutionPlanOptions = {
  hasTools?: boolean;
  requireTools?: boolean;
  qualityProfile?: QualityProfile;
  retryLimit?: number;
};

export type ExecutionPlanContext = {
  taskProfile: TaskProfile;
  qualityProfile: QualityProfile;
  promptProfile: QualityExecutionPlan["promptProfile"];
  strictHints: ProviderCapabilityHints;
  relaxedHints: ProviderCapabilityHints;
  retryLimit: number;
};

export function buildExecutionPlan(
  scope: string,
  options?: ExecutionPlanOptions,
): ExecutionPlan {
  return buildQualityExecutionPlan(scope, options);
}
