import type { PromptContextProfile } from "../prompts/prompt-composer.js";
import { buildPromptPlan } from "../prompts/prompt-planner.js";
import { buildQualityPlan, type QualityProfile } from "../quality-engine.js";
import type { ProviderCapabilityHints } from "../provider-capabilities.js";
import { buildTaskProfile, type TaskProfile } from "./task-profile.js";

export type ExecutionPlan = {
  taskProfile: TaskProfile;
  qualityProfile: QualityProfile;
  promptProfile: PromptContextProfile;
  strictHints: ProviderCapabilityHints;
  relaxedHints: ProviderCapabilityHints;
  retryLimit: number;
};

export function buildExecutionPlan(
  scope: string,
  options?: {
    hasTools?: boolean;
    requireTools?: boolean;
    qualityProfile?: QualityProfile;
    retryLimit?: number;
  },
): ExecutionPlan {
  const taskProfile = buildTaskProfile(scope, { hasTools: options?.hasTools });
  const qualityProfile = options?.qualityProfile ?? taskProfile.qualityProfile;
  const qualityPlan = buildQualityPlan(qualityProfile, {
    requireTools: options?.requireTools ?? taskProfile.useTools,
  });
  const promptPlan = buildPromptPlan(taskProfile.taskType);

  return {
    taskProfile,
    qualityProfile,
    promptProfile: promptPlan.contextProfile,
    strictHints: qualityPlan.strictHints,
    relaxedHints: qualityPlan.relaxedHints,
    retryLimit: options?.retryLimit ?? (taskProfile.retryOnParseFailure || taskProfile.retryOnLowQuality ? 2 : 1),
  };
}
