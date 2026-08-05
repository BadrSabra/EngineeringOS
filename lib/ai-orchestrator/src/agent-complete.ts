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
  /**
   * Optional progress callback. Called at key execution milestones (model call,
   * retry) so callers can stream status updates to the user in real-time.
   * The callback may be async; errors are silently swallowed to keep the agent
   * pipeline stable.
   */
  onProgress?: (msg: string) => void | Promise<void>;
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
      await openrouterCompleteWithFallback(testMessages, { apiKey, maxTokens: 1, temperature: 0, model: probeModelDecision.model });
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
  const modelDecision = resolveExecutionModel(providerId, executionPlan);
  const apiKey = requireApiKey(provider, opts.apiKey);

  switch (provider.providerId) {
    case "deepseek": {
      const result = await deepseekCompleteRaw(messages, {
        model: modelDecision.model,
        apiKey,
      });
      return { content: assertContent(provider, result.content) };
    }

    case "openrouter": {
      const result = await openrouterCompleteWithFallback(messages, {
        model: modelDecision.model,
        apiKey,
      });
      return { content: assertContent(provider, result.content) };
    }

    case "gemini": {
      const result = await geminiCompleteRaw(messages, {
        model: modelDecision.model,
        apiKey,
      });
      return { content: assertContent(provider, result.content) };
    }

    default: {
      const result = await complete(messages, { model: modelDecision.model, apiKey: apiKey || undefined });
      return { content: assertContent(provider, result.content) };
    }
  }
}
