/**
 * Provider-agnostic completion helper for single-shot agents.
 *
 * Wraps groq-client's `complete()`, deepseek-client's `deepseekCompleteRaw()`,
 * and openai-compatible-client's `openrouterCompleteRaw()` behind a single
 * interface so scan-analyst, code-reviewer, task-agent, and workflow-orchestrator
 * can support all providers without duplicating provider selection logic.
 *
 * Groq path:      uses the high-level `complete()` client — circuit-breaker,
 *                 exponential-backoff retries, and structured Message types included.
 * DeepSeek path:  uses `deepseekCompleteRaw()` — same GroqClientError union.
 * OpenRouter path: uses `openrouterCompleteRaw()` — OpenAI-compatible, same error union.
 */
import { complete, completeRaw, MODEL_POWERFUL } from "./groq-client.js";
import { deepseekCompleteRaw, DEEPSEEK_MODEL_POWERFUL } from "./deepseek-client.js";
import { openrouterCompleteRaw } from "./openai-compatible-client.js";
import { PROVIDER_REGISTRY } from "./provider-registry.js";
import { GroqClientError } from "./errors.js";
import type { Message } from "./groq-client.js";
import type { ProviderId } from "./provider-registry.js";

export type { ProviderId };

export type AgentCompleteOpts = {
  /** Per-user API key. Required for DeepSeek and OpenRouter; falls back to GROQ_API_KEY env for Groq. */
  apiKey?: string;
  /** Which AI provider to use. Defaults to "groq". */
  provider?: ProviderId;
};

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
  const testMessages: Message[] = [{ role: "user", content: "hi" }];
  try {
    if (provider === "deepseek") {
      await deepseekCompleteRaw(testMessages, { apiKey, maxTokens: 1, temperature: 0 });
    } else if (provider === "openrouter") {
      await openrouterCompleteRaw(testMessages, { apiKey, maxTokens: 1, temperature: 0 });
    } else {
      // groq — uses high-level client with 10s timeout for the probe
      await completeRaw(testMessages, { apiKey, maxTokens: 1, timeoutMs: 10_000 });
    }
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
  const provider = opts.provider ?? "groq";

  if (provider === "deepseek") {
    const apiKey = opts.apiKey;
    if (!apiKey) {
      throw new GroqClientError(
        "INVALID_CONFIG",
        "DeepSeek API key is required but was not provided",
      );
    }
    const result = await deepseekCompleteRaw(messages, {
      model: DEEPSEEK_MODEL_POWERFUL,
      apiKey,
    });
    const content = result.content;
    if (!content) {
      throw new GroqClientError("EMPTY_RESPONSE", "DeepSeek returned no content for this request");
    }
    return { content };
  }

  if (provider === "openrouter") {
    const apiKey = opts.apiKey;
    if (!apiKey) {
      throw new GroqClientError(
        "INVALID_CONFIG",
        "OpenRouter API key is required but was not provided",
      );
    }
    const config = PROVIDER_REGISTRY.openrouter;
    const result = await openrouterCompleteRaw(messages, {
      model: config.defaultModels.powerful,
      apiKey,
    });
    const content = result.content;
    if (!content) {
      throw new GroqClientError("EMPTY_RESPONSE", "OpenRouter returned no content for this request");
    }
    return { content };
  }

  // groq — full-featured client with circuit-breaker and retry.
  const result = await complete(messages, { model: MODEL_POWERFUL, apiKey: opts.apiKey });
  return { content: result.content };
}
