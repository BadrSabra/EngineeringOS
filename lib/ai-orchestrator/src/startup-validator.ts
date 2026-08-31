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

import {
  loadProvider,
  PROVIDER_PRIORITY,
  type ProviderId,
} from "./provider-registry.js";
import {
  validateGroqDefaultModels,
  type GroqDefaultModelValidation,
} from "./groq-client.js";
import { GroqClientError } from "./errors.js";
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
  /** Whether Groq's configured defaults were confirmed by its live catalog. */
  modelCheck?: "passed" | "missing" | "unavailable";
};

export type StartupValidatorOptions = {
  onGroqModelCatalogDrift?: (input: {
    role: GroqDefaultModelValidation["missing"][number];
    modelId: string;
  }) => void | Promise<void>;
  onGroqModelCatalogUnavailable?: () => void | Promise<void>;
  onGroqModelCatalogHealthy?: () => void | Promise<void>;
  onGroqModelCatalogNotConfigured?: () => void | Promise<void>;
};

async function notifyStartupValidator(
  callback: (() => void | Promise<void>) | undefined,
): Promise<void> {
  if (!callback) return;
  try {
    await callback();
  } catch (error) {
    console.warn(
      JSON.stringify({
        scope: "startup-validator",
        status: "alert_persistence_failed",
        error: error instanceof Error ? error.message : "unknown error",
      }),
    );
  }
}

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
export async function validateAiProvidersAtStartup(
  options: StartupValidatorOptions = {},
): Promise<ProviderValidationResult[]> {
  const results: ProviderValidationResult[] = [];

  // Track whether any provider is usable at all.
  let anyValid = false;
  let anyConfigured = false;

  for (const providerId of PROVIDER_PRIORITY) {
    const keyEnv = PROVIDER_KEY_ENV[providerId];
    const keyValue = process.env[keyEnv];

    if (!keyValue) {
      if (providerId === "groq") {
        await notifyStartupValidator(options.onGroqModelCatalogNotConfigured);
      }
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

    anyConfigured = true;
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

    if (providerId === "groq") {
      let modelValidation: GroqDefaultModelValidation;
      try {
        modelValidation = await validateGroqDefaultModels(
          keyValue,
          loadProvider("groq").defaultModels,
        );
      } catch (error) {
        const code = error instanceof GroqClientError ? error.code : "UNKNOWN";
        const reason =
          code === "AUTH_ERROR"
            ? "GROQ_API_KEY was rejected while checking the live model catalog — verify the key."
            : `Groq model catalog could not be checked (${code}) — rerun startup or release validation before relying on Groq.`;
        results.push({
          provider: providerId,
          valid: code === "AUTH_ERROR" ? false : true,
          modelCheck: "unavailable",
          reason,
        });
        console.warn(
          JSON.stringify({
            scope: "startup-validator",
            provider: providerId,
            status: code === "AUTH_ERROR" ? "invalid" : "degraded",
            modelCheck: "unavailable",
            reason,
          }),
        );
        if (code === "AUTH_ERROR") continue;
        await notifyStartupValidator(options.onGroqModelCatalogUnavailable);
        anyValid = true;
        continue;
      }

      if (!modelValidation.valid) {
        const reason =
          modelValidation.reason ??
          "Groq model catalog is missing one or more configured default models.";
        results.push({
          provider: providerId,
          valid: false,
          modelCheck: "missing",
          reason,
        });
        console.warn(
          JSON.stringify({
            scope: "startup-validator",
            provider: providerId,
            status: "invalid",
            modelCheck: "missing",
            missing: modelValidation.missing,
            reason,
          }),
        );
        for (const role of modelValidation.missing) {
          await notifyStartupValidator(() =>
            options.onGroqModelCatalogDrift?.({
              role,
              modelId: modelValidation.checkedModels[role],
            }),
          );
        }
        continue;
      }

      await notifyStartupValidator(options.onGroqModelCatalogHealthy);
      results.push({
        provider: providerId,
        valid: true,
        modelCheck: "passed",
      });
    } else {
      results.push({ provider: providerId, valid: true });
    }
    anyValid = true;

    console.info(
      JSON.stringify({
        scope: "startup-validator",
        provider: providerId,
        status: "ok",
        keyEnv,
        ...(providerId === "groq" ? { modelCheck: "passed" } : {}),
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
    const status = anyConfigured
      ? "NO_USABLE_PROVIDERS"
      : "NO_PROVIDERS_CONFIGURED";
    console.warn(
      JSON.stringify({
        scope: "startup-validator",
        status,
        hint:
          status === "NO_USABLE_PROVIDERS"
            ? "Configured AI provider credentials failed startup checks. Review the preceding provider reason and correct the key or model defaults before relying on AI."
            : "No AI provider API keys are configured. " +
              "AI features will return 428 until at least one provider key is saved via the dashboard.",
      }),
    );
  }

  return results;
}
