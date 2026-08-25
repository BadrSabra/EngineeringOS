/**
 * Provider Registry — single source of truth for AI provider metadata.
 *
 * The static registry remains the compatibility surface used by the rest of
 * the workspace, while the helper functions below provide a path toward a
 * more declarative capability-driven registry.
 *
 * `getStrategy(id)` maps a ProviderId to its ProviderStrategy implementation.
 * Adding a new provider requires:
 *   1. A new strategy file in `strategies/`.
 *   2. An entry in STRATEGY_MAP below.
 *   3. An entry in PROVIDER_REGISTRY and PROVIDER_PRIORITY.
 *   Nothing else changes.
 */

import { DEFAULT_PROVIDER_CAPABILITIES, providerMatchesHints, scoreProviderCapabilities, type ProviderCapabilityHints, type ProviderCapabilitySummary } from "./provider-capabilities.js";
import type { ProviderStrategy } from "./provider-strategy.js";
import { groqStrategy } from "./strategies/groq.strategy.js";
import { deepseekStrategy } from "./strategies/deepseek.strategy.js";
import { openrouterStrategy } from "./strategies/openrouter.strategy.js";
import { geminiStrategy } from "./strategies/gemini.strategy.js";
import { FREE_MODELS } from "./openrouter/model-catalog.js";
import { recordBehavioralModelCall } from "./behavioral-scorecard.js";
// RC-03: avoid hardcoding a dead OpenRouter model ID at module-load time.
// The emergency fallback is derived from the current static free-tier catalog
// so the registry never points at a model that the local codebase no longer
// considers valid.
const OR_EMERGENCY_FALLBACK =
  FREE_MODELS.find((m) => m.quality === "fast")?.id ??
  FREE_MODELS[0]?.id ??
  "liquid/lfm-2.5-2.6b:free";

export type ProviderId = "groq" | "deepseek" | "openrouter" | "gemini";

export type ProviderConfig = {
  providerId: ProviderId;
  /** Human-readable label used in error messages and UI hints. */
  label: string;
  /** Console / dashboard URL shown in error hints (no https:// prefix). */
  consoleUrl: string;
  /** Status page URL shown in 5xx hints (no https:// prefix). */
  statusUrl: string;
  supportsStreaming: boolean;
  supportsTools: boolean;
  supportsJsonMode: boolean;
  /** Default model slugs for fast (tool-loop) and powerful (single-shot) tasks. */
  defaultModels: { fast: string; powerful: string };
  /** Optional richer capability summary used by discovery helpers. */
  capabilities?: Partial<ProviderCapabilitySummary>;
};

/**
 * Fallback priority order: openrouter → gemini → deepseek → groq.
 *
 * resolveProvider() returns the first provider in this list whose key is
 * available. resolveFallbackProvider() skips the current provider and returns
 * the next one in this order.
 *
 * To change the ordering, edit this array — no if/else chains to update.
 */
export const PROVIDER_PRIORITY: ProviderId[] = ["openrouter", "gemini", "deepseek", "groq"];

export const PROVIDER_REGISTRY: Record<ProviderId, ProviderConfig> = {
  openrouter: {
    providerId: "openrouter",
    label: "OpenRouter",
    consoleUrl: "openrouter.ai/keys",
    statusUrl: "openrouter.ai",
    supportsStreaming: true,
    supportsTools: true,
    supportsJsonMode: true,
    defaultModels: {
      // RC-03: these are emergency last-resort IDs only — the smallest, most
      // reliably-free model in the static catalog.  Execution paths that
      // actually use OpenRouter must call resolveFallbackChain() at call time
      // (see agent-complete.ts RC-04 fix) so the live free-tier catalog is
      // consulted rather than a baked-in string from module-load time.
      fast: OR_EMERGENCY_FALLBACK,
      powerful: OR_EMERGENCY_FALLBACK,
    },
    capabilities: {
      supportsStreaming: true,
      supportsTools: true,
      supportsJsonMode: true,
      supportsVision: false,
      supportsReasoning: true,
      supportsFunctionCalling: true,
      supportsThinking: false,
      maxContext: 128_000,
      maxOutput: 32_000,
      costTier: "low",
    },
  },
  deepseek: {
    providerId: "deepseek",
    label: "DeepSeek",
    consoleUrl: "platform.deepseek.com",
    statusUrl: "platform.deepseek.com",
    supportsStreaming: true,
    supportsTools: true,
    supportsJsonMode: true,
    defaultModels: {
      fast: "deepseek-chat",
      powerful: "deepseek-chat",
    },
    capabilities: {
      supportsStreaming: true,
      supportsTools: true,
      supportsJsonMode: true,
      supportsVision: false,
      supportsReasoning: true,
      supportsFunctionCalling: true,
      supportsThinking: true,
      maxContext: 64_000,
      maxOutput: 8_000,
      costTier: "low",
    },
  },
  gemini: {
    providerId: "gemini",
    label: "Gemini",
    consoleUrl: "aistudio.google.com/apikey",
    statusUrl: "status.cloud.google.com",
    supportsStreaming: true,
    supportsTools: false,
    supportsJsonMode: true,
    defaultModels: {
      fast: "gemini-2.0-flash",
      powerful: "gemini-2.0-flash",
    },
    capabilities: {
      supportsStreaming: true,
      supportsTools: false,
      supportsJsonMode: true,
      supportsVision: true,
      supportsReasoning: true,
      supportsFunctionCalling: false,
      supportsThinking: false,
      maxContext: 128_000,
      maxOutput: 8_192,
      costTier: "medium",
    },
  },
  groq: {
    providerId: "groq",
    label: "Groq",
    consoleUrl: "console.groq.com",
    statusUrl: "status.groq.com",
    supportsStreaming: true,
    supportsTools: true,
    supportsJsonMode: true,
    defaultModels: {
      // Keep the resolver aligned with groq-client.ts. The older 8B slug can
      // return 404 on current Groq accounts, which otherwise turns a valid
      // Groq fallback lane into a hard provider failure.
      fast: "llama-3.3-70b-versatile",
      powerful: "llama-3.3-70b-versatile",
    },
    capabilities: {
      supportsStreaming: true,
      supportsTools: true,
      supportsJsonMode: true,
      supportsVision: false,
      supportsReasoning: true,
      supportsFunctionCalling: true,
      supportsThinking: false,
      maxContext: 128_000,
      maxOutput: 8_192,
      costTier: "low",
    },
  },
};

const PROVIDER_CATALOG = new Map<ProviderId, ProviderConfig>(
  Object.values(PROVIDER_REGISTRY).map((provider) => [provider.providerId, provider]),
);

function mergeCapabilities(config: ProviderConfig): ProviderCapabilitySummary {
  return {
    ...DEFAULT_PROVIDER_CAPABILITIES,
    supportsStreaming: config.supportsStreaming,
    supportsTools: config.supportsTools,
    supportsJsonMode: config.supportsJsonMode,
    ...config.capabilities,
  };
}

export function getProviderCapabilities(id: ProviderId): ProviderCapabilitySummary {
  const cfg = loadProvider(id);
  return mergeCapabilities(cfg);
}

export function registerProvider(config: ProviderConfig): ProviderConfig {
  PROVIDER_CATALOG.set(config.providerId, config);
  return config;
}

export function loadProvider(id: ProviderId): ProviderConfig {
  const cfg = PROVIDER_CATALOG.get(id);
  if (!cfg) throw new Error(`Unknown provider: ${id}`);
  return cfg;
}

export function discoverProviders(hints?: ProviderCapabilityHints): ProviderConfig[] {
  const ordered = [...PROVIDER_CATALOG.values()];
  const priorityIndex = new Map<ProviderId, number>(PROVIDER_PRIORITY.map((providerId, index) => [providerId, index]));

  return ordered
    .filter((provider) => providerMatchesHints(mergeCapabilities(provider), hints))
    .sort((a, b) => {
      const scoreA = scoreProviderCapabilities(mergeCapabilities(a), hints);
      const scoreB = scoreProviderCapabilities(mergeCapabilities(b), hints);
      if (scoreA !== scoreB) return scoreB - scoreA;
      const priorityA = priorityIndex.get(a.providerId) ?? Number.MAX_SAFE_INTEGER;
      const priorityB = priorityIndex.get(b.providerId) ?? Number.MAX_SAFE_INTEGER;
      if (priorityA !== priorityB) return priorityA - priorityB;
      return a.label.localeCompare(b.label);
    });
}

export function discoverProvider(hints?: ProviderCapabilityHints): ProviderConfig | undefined {
  return discoverProviders(hints)[0];
}

export function getProvider(id: ProviderId): ProviderConfig {
  return loadProvider(id);
}

// ─── Strategy registry ────────────────────────────────────────────────────────

const STRATEGY_MAP = new Map<ProviderId, ProviderStrategy>([
  ["groq",       groqStrategy],
  ["deepseek",   deepseekStrategy],
  ["openrouter", openrouterStrategy],
  ["gemini",     geminiStrategy],
]);

/**
 * Return the `ProviderStrategy` for `id`.
 * Throws if no strategy is registered (only possible for providers added to
 * PROVIDER_REGISTRY without a corresponding strategy entry — caught at dev time).
 */
export function getStrategy(id: ProviderId): ProviderStrategy {
  const strategy = STRATEGY_MAP.get(id);
  if (!strategy) throw new Error(`No ProviderStrategy registered for provider: ${id}`);
  return strategy;
}

// ─── Provider telemetry (OR-007) ──────────────────────────────────────────────

/**
 * Structured record emitted after every model API call.
 * Written to stdout as a JSON line so it can be ingested by any log processor.
 */
export type ProviderTelemetry = {
  /** Provider that handled this request. */
  provider: ProviderId;
  /** Exact model slug used. */
  model: string;
  /** GroqErrorCode that triggered a model fallback, if any. */
  fallbackReason?: string;
  /** Total number of API attempts (1 = first try succeeded, 2 = one retry). */
  attemptCount: number;
  /** Prompt token count from usage metadata (0 when unavailable). */
  promptTokens: number;
  /** Completion token count from usage metadata (0 when unavailable). */
  completionTokens: number;
  /** Wall-clock time in ms from first attempt start to final response. */
  durationMs: number;
};

/**
 * Emit a single telemetry record to stdout.
 * The scope field makes these log lines easy to grep or stream to analytics.
 */
export function recordProviderTelemetry(entry: ProviderTelemetry): void {
  recordBehavioralModelCall(entry.model);
  console.info(JSON.stringify({ scope: "provider-telemetry", ...entry }));
}
