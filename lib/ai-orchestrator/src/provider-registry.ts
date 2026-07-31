/**
 * Provider Registry — single source of truth for AI provider metadata.
 *
 * The static registry remains the compatibility surface used by the rest of
 * the workspace, while the helper functions below provide a path toward a
 * more declarative capability-driven registry.
 */

import { DEFAULT_PROVIDER_CAPABILITIES, providerMatchesHints, scoreProviderCapabilities, type ProviderCapabilityHints, type ProviderCapabilitySummary } from "./provider-capabilities.js";

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
      fast: "google/gemma-4-31b-it:free",
      powerful: "nvidia/nemotron-3-ultra-550b-a55b:free",
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
      costTier: "medium",
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
      fast: "llama-3.1-8b-instant",
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
