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
import type { QualityProfile } from "./quality-engine.js";
import { GroqClientError } from "./errors.js";
import type { Message } from "./groq-client.js";
import { loadProvider, type ProviderConfig, type ProviderId } from "./provider-registry.js";
import type { ProviderCapabilityHints } from "./provider-capabilities.js";
import { resolveExecutionDecision } from "./model-selection/decision-engine.js";

export type { ProviderId };

export type AgentCompleteOpts = {
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

async function probeProviderKey(provider: ProviderConfig, apiKey: string): Promise<void> {
  const testMessages: Message[] = [{ role: "user", content: "hi" }];
  const probeDecision = resolveExecutionDecision({
    provider: provider.providerId,
    selectedQuality: "powerful",
    capability: provider.providerId === "openrouter" ? "coding" : "chat",
  });

  switch (provider.providerId) {
    case "deepseek":
      await deepseekCompleteRaw(testMessages, { apiKey, maxTokens: 1, temperature: 0, model: probeDecision.model });
      return;
    case "openrouter":
      // Use the same decision engine as the main call path so the validation
      // probe exercises the same model-selection rules.
      await openrouterCompleteWithFallback(testMessages, { apiKey, maxTokens: 1, temperature: 0, model: probeDecision.model });
      return;
    case "gemini":
      await geminiCompleteRaw(testMessages, { apiKey, maxTokens: 1, temperature: 0, model: probeDecision.model });
      return;
    default:
      // groq — uses high-level client with 10s timeout for the probe
      await completeRaw(testMessages, { apiKey, maxTokens: 1, timeoutMs: 10_000, model: probeDecision.model });
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
  const decision = resolveExecutionDecision({
    provider: opts.provider,
    qualityProfile: opts.qualityProfile,
    qualityHints: opts.qualityHints,
  });
  const provider = decision.provider;
  const apiKey = requireApiKey(provider, opts.apiKey);

  switch (provider.providerId) {
    case "deepseek": {
      const result = await deepseekCompleteRaw(messages, {
        model: decision.model,
        apiKey,
      });
      return { content: assertContent(provider, result.content) };
    }

    case "openrouter": {
      // RC-04: resolve model at call time from the live free-tier catalog via
      // the decision engine — quality/capability/tool hints are all handled there.
      const result = await openrouterCompleteWithFallback(messages, {
        apiKey,
        model: decision.model,
      });
      return { content: assertContent(provider, result.content) };
    }

    case "gemini": {
      const result = await geminiCompleteRaw(messages, {
        model: decision.model,
        apiKey,
      });
      return { content: assertContent(provider, result.content) };
    }

    default: {
      const result = await complete(messages, { model: decision.model, apiKey: apiKey || undefined });
      return { content: assertContent(provider, result.content) };
    }
  }
}
