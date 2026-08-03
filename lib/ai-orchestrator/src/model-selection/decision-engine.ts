/**
 * Execution Decision Engine — single source of truth for provider/model choice.
 *
 * Callers pass their intent (provider preference, quality profile, capability
 * hints, tool requirement). The engine resolves:
 *   • which provider to use
 *   • which model to run for the selected quality tier
 *   • which fallback chain is valid for OpenRouter
 *
 * This keeps provider selection, model selection, and fallback policy in one
 * place so the rest of the orchestrator no longer re-implements those rules.
 */
import { discoverProvider, loadProvider, type ProviderConfig, type ProviderId } from "../provider-registry.js";
import { buildQualityHints, type QualityProfile } from "../quality-engine.js";
import type { ProviderCapabilityHints } from "../provider-capabilities.js";
import type { ModelCapability } from "../openrouter/model-catalog.js";
import { resolveFallbackChain } from "../openrouter/model-resolver.js";

export type ExecutionModelQuality = "fast" | "powerful";

export type ExecutionModelDecision = {
  providerId: ProviderId;
  provider: ProviderConfig;
  selectedQuality: ExecutionModelQuality;
  capability: ModelCapability;
  model: string;
  fastModel: string;
  powerfulModel: string;
  fastFallbackChain: string[];
  powerfulFallbackChain: string[];
  source: "provider-registry" | "openrouter-model-resolver";
};

export type ResolveExecutionDecisionOptions = {
  provider?: ProviderId;
  qualityProfile?: QualityProfile;
  qualityHints?: ProviderCapabilityHints;
  selectedQuality?: ExecutionModelQuality;
  capability?: ModelCapability;
  requireTools?: boolean;
};

function inferSelectedQuality(
  explicitQuality: ExecutionModelQuality | undefined,
  qualityProfile: QualityProfile | undefined,
  qualityHints: ProviderCapabilityHints | undefined,
): ExecutionModelQuality {
  if (explicitQuality) return explicitQuality;

  switch (qualityProfile) {
    case "analysis":
    case "code_review":
    case "task_execution":
    case "workflow":
      return "powerful";
    case "tool_chat":
      return qualityHints?.requireReasoning || qualityHints?.requireThinking ? "powerful" : "fast";
    case "chat":
    default:
      if (qualityHints?.requireReasoning || qualityHints?.requireThinking) return "powerful";
      if (qualityHints?.minimumContext != null && qualityHints.minimumContext >= 32_000) return "powerful";
      return "fast";
  }
}

function resolveOpenRouterTier(
  capability: ModelCapability,
  quality: ExecutionModelQuality,
  requireTools: boolean,
): { model: string; fallbackChain: string[] } {
  const chain = resolveFallbackChain({ capability, quality, requireTools });
  const model = chain[0]?.id;
  if (!model) {
    throw new Error(
      `[decision-engine] No OpenRouter free model satisfies capability="${capability}" quality="${quality}" requireTools=${requireTools}`,
    );
  }
  return {
    model,
    fallbackChain: chain.map((entry) => entry.id),
  };
}

function resolveNonOpenRouterTier(provider: ProviderConfig): { fastModel: string; powerfulModel: string } {
  return {
    fastModel: provider.defaultModels.fast,
    powerfulModel: provider.defaultModels.powerful,
  };
}

export function resolveExecutionDecision(opts: ResolveExecutionDecisionOptions): ExecutionModelDecision {
  const qualityHints = opts.qualityHints ?? (opts.qualityProfile ? buildQualityHints(opts.qualityProfile, { requireTools: opts.requireTools }) : undefined);
  const provider = opts.provider
    ? loadProvider(opts.provider)
    : (qualityHints ? discoverProvider(qualityHints) ?? loadProvider("groq") : loadProvider("groq"));

  const selectedQuality = inferSelectedQuality(opts.selectedQuality, opts.qualityProfile, qualityHints);
  const capability = opts.capability ?? (qualityHints?.requireReasoning ? "reasoning" : qualityHints?.requireThinking ? "reasoning" : "coding");

  if (provider.providerId === "openrouter") {
    const fast = resolveOpenRouterTier(capability, "fast", !!opts.requireTools);
    const powerful = resolveOpenRouterTier(capability, "powerful", !!opts.requireTools);

    return {
      providerId: provider.providerId,
      provider,
      selectedQuality,
      capability,
      model: selectedQuality === "powerful" ? powerful.model : fast.model,
      fastModel: fast.model,
      powerfulModel: powerful.model,
      fastFallbackChain: fast.fallbackChain,
      powerfulFallbackChain: powerful.fallbackChain,
      source: "openrouter-model-resolver",
    };
  }

  const { fastModel, powerfulModel } = resolveNonOpenRouterTier(provider);
  return {
    providerId: provider.providerId,
    provider,
    selectedQuality,
    capability,
    model: selectedQuality === "powerful" ? powerfulModel : fastModel,
    fastModel,
    powerfulModel,
    fastFallbackChain: [fastModel],
    powerfulFallbackChain: [powerfulModel],
    source: "provider-registry",
  };
}

export function resolveExecutionModel(opts: ResolveExecutionDecisionOptions): string {
  return resolveExecutionDecision(opts).model;
}
