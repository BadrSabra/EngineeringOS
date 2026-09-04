import type { ModelCapability } from "../openrouter/model-catalog.js";
import {
  isCatalogFreeModel,
  isCatalogFreeModelForCapability,
  resolveFallbackChain,
  type FreeModelCapabilityOptions,
} from "../openrouter/model-resolver.js";
import { loadProvider, type ProviderId } from "../provider-registry.js";
import { getDynamicCatalogStatus } from "../openrouter/dynamic-catalog.js";
import { GroqClientError } from "../errors.js";
import type { ExecutionPlan } from "./execution-plan.js";

export type ExecutionModelDecision = {
  providerId: ProviderId;
  model: string;
  powerModel: string;
  fallbackChain: string[];
  capability: ModelCapability;
  quality: "fast" | "powerful";
  source: "openrouter-catalog" | "provider-registry";
};

export function isFreeOpenRouterModel(modelId: string): boolean {
  return isCatalogFreeModel(modelId);
}

export function resolveFreeModelOverride(
  modelId: string,
  options: ModelCapability | FreeModelCapabilityOptions = {},
): string {
  const normalized = modelId.trim();
  const capabilityOptions = typeof options === "string" ? { capability: options } : options;
  if (!isCatalogFreeModelForCapability(normalized, capabilityOptions)) {
    const detail = capabilityOptions.capability
      ? `; missing capability="${capabilityOptions.capability}"`
      : "";
    throw new Error(`OpenRouter model override is not a currently-free catalog model: ${normalized}${detail}`);
  }
  return normalized;
}

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
  if (plan.qualityProfile === "capability_probe") {
    return "tool_calling";
  }
  if (plan.strictHints.requireTools || plan.taskProfile.useTools) {
    return "tool_calling";
  }
  // Structured single-shot reviewers need a model that can reliably emit the
  // declared JSON contract. Requiring a reasoning-capable model here is
  // counterproductive on OpenRouter: several free reasoning models place the
  // useful work in reasoning_content and leave message.content empty.
  if (
    plan.taskProfile.taskType === "code_review" ||
    plan.strictHints.requireJsonMode
  ) {
    return "json";
  }
  if (
    plan.taskProfile.taskType === "analysis" ||
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
  // Capability probes are deliberately a fast, tool-capable contract. They
  // need exact source quoting, not a long reasoning trace or a large synthesis
  // envelope. Keeping this exception in model resolution prevents a probe
  // from inheriting task_execution's paid/reasoning-oriented tier merely
  // because its read-only tool loop lives inside chat-agent.
  const isCapabilityProbe = plan.qualityProfile === "capability_probe";
  const wantPowerful = isCapabilityProbe ? false : wantsPowerfulModel(plan);
  const capability = selectCapability(plan);
  const requireTools = isCapabilityProbe ? true : plan.strictHints.requireTools ?? false;

  let decision: ExecutionModelDecision;

  if (providerId === "openrouter") {
    const fallbackChain = resolveFallbackChain({
      capability,
      quality: wantPowerful ? "powerful" : "fast",
      requireTools,
    }).map((model) => model.id);

    // Controlled live checks may opt into a known paid OpenRouter model. Keep
    // this override environment-only so ordinary provider-free validation and
    // normal free-tier routing retain the catalog-driven fallback chain.
    const configuredModel = process.env.OPENROUTER_MODEL?.trim() || undefined;
    let liveModel: string | undefined;
    if (configuredModel) {
      try {
        liveModel = resolveFreeModelOverride(configuredModel, {
          capability,
          requireTools,
        });
      } catch (error) {
        // An environment-pinned model can become paid, retired, or lose the
        // requested capability between deploys. Treat it as a stale hint and
        // use the already-resolved live fallback chain instead of making a
        // review fail before the provider is contacted.
        console.warn(
          JSON.stringify({
            scope: "model-resolver",
            action: "ignore_unusable_configured_model",
            configuredModel,
            capability,
            reason: error instanceof Error ? error.message : "model is not currently usable",
          }),
        );
      }
    }
    if (fallbackChain.length === 0 && !liveModel) {
      const catalog = getDynamicCatalogStatus();
      throw new GroqClientError(
        "INVALID_CONFIG",
        `No compatible free OpenRouter model is available for capability="${capability}"`,
        {
          context: {
            providerName: "OpenRouter",
            providerCode: "NO_COMPATIBLE_FREE_MODEL",
            catalogLoaded: catalog.loaded,
            catalogUsable: catalog.usable,
            catalogStatus: catalog.lastRefreshStatus,
            catalogError: catalog.lastRefreshError ?? undefined,
          },
        },
      );
    }
    const model = liveModel ?? fallbackChain[0]!;
    const powerModel = liveModel ?? fallbackChain[1] ?? fallbackChain[0]!;

    decision = {
      providerId,
      model,
      powerModel,
      fallbackChain: liveModel ? [liveModel] : fallbackChain,
      capability,
      quality: wantPowerful ? "powerful" : "fast",
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
      quality: wantPowerful ? "powerful" : "fast",
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
      requireTools,
      requireThinking: isCapabilityProbe ? false : plan.strictHints.requireThinking ?? false,
      requireReasoning: isCapabilityProbe ? false : plan.strictHints.requireReasoning ?? false,
      minimumContext: plan.strictHints.minimumContext ?? 0,
      ...(isCapabilityProbe ? { selectionMode: "fast_tool_calling" } : {}),
    }),
  );

  return decision;
}
