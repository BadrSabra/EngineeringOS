import type { ModelCapability } from "../openrouter/model-catalog.js";
import { resolveFallbackChain } from "../openrouter/model-resolver.js";
import { loadProvider, type ProviderId } from "../provider-registry.js";
import type { ExecutionPlan } from "./execution-plan.js";

export type ExecutionModelDecision = {
  providerId: ProviderId;
  model: string;
  powerModel: string;
  fallbackChain: string[];
  capability: ModelCapability;
  source: "openrouter-catalog" | "provider-registry";
};

function wantsPowerfulModel(plan: ExecutionPlan): boolean {
  const taskType = plan.taskProfile.taskType;
  return (
    taskType === "analysis" ||
    taskType === "code_review" ||
    taskType === "task_execution" ||
    taskType === "workflow" ||
    plan.strictHints.requireThinking === true ||
    plan.strictHints.requireReasoning === true ||
    plan.strictHints.requireTools === true ||
    (plan.strictHints.minimumContext ?? 0) >= 16_000
  );
}

function selectCapability(plan: ExecutionPlan): ModelCapability {
  if (plan.strictHints.requireTools || plan.taskProfile.useTools) {
    return "tool_calling";
  }
  if (
    plan.taskProfile.taskType === "analysis" ||
    plan.taskProfile.taskType === "code_review" ||
    plan.taskProfile.taskType === "workflow" ||
    plan.strictHints.requireThinking ||
    plan.strictHints.requireReasoning
  ) {
    return "reasoning";
  }
  if ((plan.strictHints.minimumContext ?? 0) >= 16_000) {
    return "long_context";
  }
  return plan.taskProfile.taskType === "task_execution" ? "coding" : "chat";
}

export function resolveExecutionModel(
  providerId: ProviderId,
  plan: ExecutionPlan,
): ExecutionModelDecision {
  const provider = loadProvider(providerId);
  const wantPowerful = wantsPowerfulModel(plan);
  const capability = selectCapability(plan);

  let decision: ExecutionModelDecision;

  if (providerId === "openrouter") {
    const fallbackChain = resolveFallbackChain({
      capability,
      quality: wantPowerful ? "powerful" : "fast",
      requireTools: plan.strictHints.requireTools ?? false,
    }).map((model) => model.id);

    const model = fallbackChain[0] ?? provider.defaultModels.fast;
    const powerModel = fallbackChain[1] ?? fallbackChain[0] ?? provider.defaultModels.powerful;

    decision = {
      providerId,
      model,
      powerModel,
      fallbackChain,
      capability,
      source: "openrouter-catalog",
    };
  } else {
    const model = wantPowerful ? provider.defaultModels.powerful : provider.defaultModels.fast;

    decision = {
      providerId,
      model,
      powerModel: provider.defaultModels.powerful,
      fallbackChain: [provider.defaultModels.fast, provider.defaultModels.powerful].filter((m, i, arr) => arr.indexOf(m) === i),
      capability,
      source: "provider-registry",
    };
  }

  console.info(
    JSON.stringify({
      scope: "model-resolver",
      action: "resolve_execution_model",
      providerId,
      capability,
      wantPowerful,
      model: decision.model,
      powerModel: decision.powerModel,
      fallbackChain: decision.fallbackChain,
      source: decision.source,
      taskType: plan.taskProfile.taskType,
      requireTools: plan.strictHints.requireTools ?? false,
      requireThinking: plan.strictHints.requireThinking ?? false,
      requireReasoning: plan.strictHints.requireReasoning ?? false,
      minimumContext: plan.strictHints.minimumContext ?? 0,
    }),
  );

  return decision;
}
