/**
 * Provider-agnostic completion helper for single-shot agents.
 *
 * This layer still delegates to the provider-specific transport clients, but
 * the provider configuration itself now flows through the registry helpers so
 * selection, defaults, and validation share one source of truth.
 */
import { complete, completeRaw, MODEL_POWERFUL } from "./groq-client.js";
import { deepseekCompleteRaw } from "./deepseek-client.js";
import { openrouterCompleteWithFallback, geminiCompleteRaw } from "./openai-compatible-client.js";
import { discoverProvider, loadProvider } from "./provider-registry.js";
import { buildQualityHints, type QualityProfile } from "./quality-engine.js";
import { GroqClientError } from "./errors.js";
import type { Message } from "./groq-client.js";
import type { ProviderConfig, ProviderId } from "./provider-registry.js";
import type { ProviderCapabilityHints } from "./provider-capabilities.js";

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

  switch (provider.providerId) {
    case "deepseek":
      await deepseekCompleteRaw(testMessages, { apiKey, maxTokens: 1, temperature: 0 });
      return;
    case "openrouter":
      // Use fallback-aware client; a 404 on the probe just means the default
      // model is gone — fallback confirms whether the key itself is valid.
      await openrouterCompleteWithFallback(testMessages, { apiKey, maxTokens: 1, temperature: 0 });
      return;
    case "gemini":
      await geminiCompleteRaw(testMessages, { apiKey, maxTokens: 1, temperature: 0 });
      return;
    default:
      // groq — uses high-level client with 10s timeout for the probe
      await completeRaw(testMessages, { apiKey, maxTokens: 1, timeoutMs: 10_000 });
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
  const providerId = opts.provider ?? (qualityHints ? discoverProvider(qualityHints)?.providerId ?? "groq" : "groq");
  const provider = loadProvider(providerId);
  const apiKey = requireApiKey(provider, opts.apiKey);

  switch (provider.providerId) {
    case "deepseek": {
      const result = await deepseekCompleteRaw(messages, {
        model: provider.defaultModels.powerful,
        apiKey,
      });
      return { content: assertContent(provider, result.content) };
    }

    case "openrouter": {
      // STORY-03: fallback-aware client automatically tries the next free model
      // if the primary returns MODEL_NOT_FOUND. Model ID comes from the resolver
      // via provider.defaultModels (STORY-07 — no hardcoded strings here).
      const result = await openrouterCompleteWithFallback(messages, {
        model: provider.defaultModels.powerful,
        apiKey,
      });
      return { content: assertContent(provider, result.content) };
    }

    case "gemini": {
      const result = await geminiCompleteRaw(messages, {
        model: provider.defaultModels.powerful,
        apiKey,
      });
      return { content: assertContent(provider, result.content) };
    }

    default: {
      const result = await complete(messages, { model: MODEL_POWERFUL, apiKey: apiKey || undefined });
      return { content: assertContent(provider, result.content) };
    }
  }
}
