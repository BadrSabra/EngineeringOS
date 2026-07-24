/**
 * Provider Registry — single source of truth for AI provider metadata.
 *
 * Adding a new provider requires only one entry here.
 * resolveProvider() and resolveFallbackProvider() in ai-route-helpers.ts
 * both iterate PROVIDER_PRIORITY so fallback ordering stays in one place.
 */

export type ProviderId = "groq" | "deepseek" | "openrouter";

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
};

/**
 * Fallback priority order: openrouter → deepseek → groq.
 *
 * resolveProvider() returns the first provider in this list whose key is
 * available. resolveFallbackProvider() skips the current provider and returns
 * the next one in this order.
 *
 * To change the ordering, edit this array — no if/else chains to update.
 */
export const PROVIDER_PRIORITY: ProviderId[] = ["openrouter", "deepseek", "groq"];

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
      fast: "deepseek/deepseek-v4-flash:free",
      powerful: "deepseek/deepseek-r1:free",
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
  },
};

export function getProvider(id: ProviderId): ProviderConfig {
  const cfg = PROVIDER_REGISTRY[id];
  if (!cfg) throw new Error(`Unknown provider: ${id}`);
  return cfg;
}
