/**
 * PR-006 — Startup Health Validation
 *
 * Validates AI providers before the server starts accepting traffic.
 * Checks:
 *   1. API key presence for each configured provider.
 *   2. Dynamic OpenRouter catalog refresh (if OPENROUTER_API_KEY is present).
 *   3. Audits the static FREE_MODELS list against the live catalog.
 *
 * Never throws — a validation failure disables the provider and logs an
 * actionable warning rather than blocking startup entirely.
 */

import { PROVIDER_PRIORITY, type ProviderId } from "./provider-registry.js";
import { FREE_MODELS } from "./openrouter/model-catalog.js";
import {
  refreshDynamicCatalog,
  auditStaticCatalog,
} from "./openrouter/dynamic-catalog.js";

export type ProviderValidationResult = {
  provider: ProviderId;
  valid: boolean;
  reason?: string;
  /** True when the key is absent but the provider is optional. */
  skipped?: boolean;
};

/** Environment variable names for each provider's API key. */
const PROVIDER_KEY_ENV: Record<ProviderId, string> = {
  openrouter: "OPENROUTER_API_KEY",
  gemini:     "GEMINI_API_KEY",
  deepseek:   "DEEPSEEK_API_KEY",
  groq:       "GROQ_API_KEY",
};

/**
 * Run pre-flight validation for all registered providers.
 * Results are logged at INFO/WARN level; the array is returned for
 * callers that want to surface the status in /api/healthz or /api/ai/providers.
 */
export async function validateAiProvidersAtStartup(): Promise<ProviderValidationResult[]> {
  const results: ProviderValidationResult[] = [];

  // Track whether any provider is usable at all.
  let anyValid = false;

  for (const providerId of PROVIDER_PRIORITY) {
    const keyEnv = PROVIDER_KEY_ENV[providerId];
    const keyValue = process.env[keyEnv];

    if (!keyValue) {
      results.push({
        provider: providerId,
        valid: false,
        skipped: true,
        reason: `${keyEnv} is not set — provider will be unavailable`,
      });
      console.info(
        JSON.stringify({
          scope: "startup-validator",
          provider: providerId,
          status: "skipped",
          reason: `${keyEnv} not set`,
        }),
      );
      continue;
    }

    if (keyValue.trim().length < 10) {
      results.push({
        provider: providerId,
        valid: false,
        reason: `${keyEnv} is too short — may not be a valid API key`,
      });
      console.warn(
        JSON.stringify({
          scope: "startup-validator",
          provider: providerId,
          status: "invalid",
          reason: `${keyEnv} value is suspiciously short`,
        }),
      );
      continue;
    }

    results.push({ provider: providerId, valid: true });
    anyValid = true;

    console.info(
      JSON.stringify({
        scope: "startup-validator",
        provider: providerId,
        status: "ok",
        keyEnv,
      }),
    );
  }

  // PR-002 integration: refresh the dynamic OpenRouter catalog at startup so
  // the resolver knows which models are currently available.
  const openrouterKey = process.env["OPENROUTER_API_KEY"];
  if (openrouterKey) {
    try {
      await refreshDynamicCatalog(openrouterKey);
      // Audit the static catalog — log any stale model IDs.
      auditStaticCatalog(FREE_MODELS.map((m) => m.id));
    } catch {
      // refreshDynamicCatalog never throws — this is defensive only.
    }
  }

  if (!anyValid) {
    console.warn(
      JSON.stringify({
        scope: "startup-validator",
        status: "NO_PROVIDERS_CONFIGURED",
        hint:
          "No AI provider API keys are configured. " +
          "AI features will return 428 until at least one provider key is saved via the dashboard.",
      }),
    );
  }

  return results;
}
