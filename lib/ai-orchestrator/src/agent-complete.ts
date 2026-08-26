/**
 * Provider-agnostic completion helper for single-shot agents.
 *
 * This layer still delegates to the provider-specific transport clients, but
 * the provider configuration itself now flows through the registry helpers so
 * selection, defaults, and validation share one source of truth.
 */
import { complete, completeRaw } from "./groq-client.js";
import { deepseekCompleteRaw } from "./deepseek-client.js";
import { openrouterCompleteWithFallback, geminiCompleteRaw } from "./openai-compatible-client.js";
import { loadProvider } from "./provider-registry.js";
import { buildQualityHints, type QualityProfile } from "./quality-engine.js";
import { GroqClientError } from "./errors.js";
import type { Message } from "./groq-client.js";
import type { ProviderConfig, ProviderId } from "./provider-registry.js";
import type { ProviderCapabilityHints } from "./provider-capabilities.js";
import { resolveExecutionDecision } from "./model-selection/decision-engine.js";
import { resolveExecutionProvider } from "./model-selection/provider-strategy.js";
import { resolveExecutionModel } from "./model-selection/model-resolver.js";
import { refreshDynamicCatalog } from "./openrouter/dynamic-catalog.js";

export type { ProviderId };

export type AgentCompleteOpts = {
  /** Caller-owned cancellation signal for the complete request and retries. */
  signal?: AbortSignal;
  /** Per-user API key. Required for DeepSeek and OpenRouter; falls back to GROQ_API_KEY env for Groq. */
  apiKey?: string;
  /** Which AI provider to use. Defaults to the quality-aware best available provider. */
  provider?: ProviderId;
  /**
   * Optional quality profile used to bias provider selection toward the
   * strongest available runtime for this task type.
   */
  qualityProfile?: QualityProfile;
  /** Optional explicit capability hints override. */
  qualityHints?: ProviderCapabilityHints;
  /**
   * Optional progress callback. Called at key execution milestones (model call,
   * retry) so callers can stream status updates to the user in real-time.
   * The callback may be async; errors are silently swallowed to keep the agent
   * pipeline stable.
   */
  onProgress?: (msg: string) => void | Promise<void>;
  /**
   * Maximum number of OpenRouter models to try for this request. Structured
   * agents use this to keep a provider outage bounded instead of walking the
   * entire free catalog.
   */
  maxFallbackModels?: number;
  /** For OpenRouter, advance to another model instead of retrying transient errors. */
  retryTransient?: boolean;
};

function requireApiKey(provider: ProviderConfig, apiKey?: string): string {
  if (provider.providerId === "groq") {
    return apiKey ?? "";
  }
  if (!apiKey) {
    throw new GroqClientError(
      "INVALID_CONFIG",
      `${provider.label} API key is required but was not provided`,
    );
  }
  return apiKey;
}

function assertContent(provider: ProviderConfig, content: string | null | undefined): string {
  if (content) return content;
  throw new GroqClientError("EMPTY_RESPONSE", `${provider.label} returned no content for this request`);
}

function inferExecutionScope(
  qualityProfile?: QualityProfile,
  qualityHints?: ProviderCapabilityHints,
): QualityProfile {
  if (qualityProfile) return qualityProfile;
  if (qualityHints?.requireTools) return "tool_chat";
  if (
    qualityHints?.requireThinking ||
    qualityHints?.requireReasoning ||
    (qualityHints?.minimumContext ?? 0) >= 16_000
  ) {
    return "analysis";
  }
  return "chat";
}

async function probeProviderKey(provider: ProviderConfig, apiKey: string): Promise<void> {
  const testMessages: Message[] = [{ role: "user", content: "hi" }];
  const probePlan = resolveExecutionDecision(
    provider.providerId === "openrouter" ? "task_execution" : "chat",
  );
  const probeModelDecision = resolveExecutionModel(provider.providerId, probePlan);

  switch (provider.providerId) {
    case "deepseek":
      await deepseekCompleteRaw(testMessages, { apiKey, maxTokens: 1, temperature: 0, model: probeModelDecision.model });
      return;
    case "openrouter":
      // Use the same decision engine as the main call path so the validation
      // probe exercises the same model-selection rules.
      await openrouterCompleteWithFallback(testMessages, {
        apiKey,
        maxTokens: 1,
        temperature: 0,
        model: probeModelDecision.model,
        capability: probeModelDecision.capability,
        quality: probeModelDecision.quality,
        requireTools: probePlan.strictHints.requireTools ?? false,
      });
      return;
    case "gemini":
      await geminiCompleteRaw(testMessages, { apiKey, maxTokens: 1, temperature: 0, model: probeModelDecision.model });
      return;
    default:
      // groq — uses high-level client with 10s timeout for the probe
      await completeRaw(testMessages, { apiKey, maxTokens: 1, timeoutMs: 10_000, model: probeModelDecision.model });
      return;
  }
}

/**
 * Validates an API key by sending a minimal 1-token probe to the provider.
 *
 * Returns `{ valid: true }` on success.
 * Returns `{ valid: false, reason }` only on AUTH_ERROR — the key is definitively
 * rejected by the provider.
 * On any transient error (NETWORK_ERROR, TIMEOUT, SERVER_ERROR, NON_200) returns
 * `{ valid: true }` so a connectivity blip never prevents the user from saving a
 * key that might be perfectly valid.
 */
export async function validateProviderKey(
  provider: ProviderId,
  apiKey: string,
): Promise<{ valid: boolean; reason?: string }> {
  const config = loadProvider(provider);
  try {
    await probeProviderKey(config, apiKey);
    return { valid: true };
  } catch (err) {
    if (err instanceof GroqClientError && err.code === "AUTH_ERROR") {
      return { valid: false, reason: err.message };
    }
    // Transient error — allow the save; the next real request has provider fallback.
    return { valid: true };
  }
}

/**
 * Send a single-shot chat completion to the configured provider.
 *
 * Always returns `{ content: string }` — content is guaranteed non-empty.
 * Throws `GroqClientError` on any provider error so callers handle the same
 * error union regardless of which provider is active.
 */
export async function agentComplete(
  messages: Message[],
  opts: AgentCompleteOpts,
): Promise<{ content: string }> {
  const qualityHints = opts.qualityHints ?? (opts.qualityProfile ? buildQualityHints(opts.qualityProfile) : undefined);
  const executionScope = inferExecutionScope(opts.qualityProfile, qualityHints);
  const executionPlan = resolveExecutionDecision(executionScope, {
    hasTools: !!qualityHints?.requireTools,
    requireTools: !!qualityHints?.requireTools,
    qualityProfile: opts.qualityProfile ?? executionScope,
  });
  const providerDecision = resolveExecutionProvider(executionPlan, opts.provider);
  const providerId = providerDecision.providerId;
  const provider = loadProvider(providerId);
  const apiKey = requireApiKey(provider, opts.apiKey);

  switch (provider.providerId) {
    case "deepseek": {
      const modelDecision = resolveExecutionModel(providerId, executionPlan);
      const result = await deepseekCompleteRaw(messages, {
        model: modelDecision.model,
        apiKey,
        responseFormat: qualityHints?.requireJsonMode ? { type: "json_object" } : undefined,
        signal: opts.signal,
      });
      return { content: assertContent(provider, result.content) };
    }

    case "openrouter": {
      // Refresh before resolving the first model, not only inside the
      // transport. This keeps the initial model and its bounded fallback
      // chain aligned with the currently usable free catalog.
      await refreshDynamicCatalog(apiKey);
      const modelDecision = resolveExecutionModel(providerId, executionPlan);
      const result = await openrouterCompleteWithFallback(messages, {
        model: modelDecision.model,
        apiKey,
        capability: modelDecision.capability,
        quality: modelDecision.quality,
        requireTools: qualityHints?.requireTools ?? false,
        maxFallbackModels: opts.maxFallbackModels,
        retryTransient: opts.retryTransient,
        responseFormat: qualityHints?.requireJsonMode ? { type: "json_object" } : undefined,
        signal: opts.signal,
      });
      return { content: assertContent(provider, result.content) };
    }

    case "gemini": {
      const modelDecision = resolveExecutionModel(providerId, executionPlan);
      const result = await geminiCompleteRaw(messages, {
        model: modelDecision.model,
        apiKey,
        responseFormat: qualityHints?.requireJsonMode ? { type: "json_object" } : undefined,
        signal: opts.signal,
      });
      return { content: assertContent(provider, result.content) };
    }

    default: {
      const modelDecision = resolveExecutionModel(providerId, executionPlan);
      const result = await complete(messages, {
        model: modelDecision.model,
        apiKey: apiKey || undefined,
        responseFormat: qualityHints?.requireJsonMode ? { type: "json_object" } : undefined,
        signal: opts.signal,
      });
      return { content: assertContent(provider, result.content) };
    }
  }
}
