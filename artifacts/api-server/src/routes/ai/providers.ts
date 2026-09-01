/**
 * AI provider key management routes.
 *
 * Canonical generic endpoint:
 *   GET/PUT/DELETE /api/ai/providers/:provider/key
 *
 * Backward-compatible aliases (delegate to the generic handler):
 *   GET/PUT/DELETE /api/ai/groq-key
 *   GET/PUT/DELETE /api/ai/deepseek-key
 *   GET/PUT/DELETE /api/ai/openrouter-key
 *
 *   GET /api/ai/active-provider
 */
import { Router } from "express";
import { randomUUID } from "crypto";
import { db } from "@workspace/db";
import { aiProviderCredentialsTable } from "@workspace/db";
import { eq, and } from "drizzle-orm";
import { decryptApiKey, encryptApiKey } from "../../lib/credentials-crypto.js";
import { logger } from "../../lib/logger.js";
import { resolveProvider } from "../../lib/ai-route-helpers.js";
import {
  validateProviderKey,
  PROVIDER_REGISTRY,
  PROVIDER_PRIORITY,
  getProviderMetrics,
  getBehavioralScorecards,
  getCircuitState,
  getProviderLifecycleSnapshot,
  invalidateProviderLifecycle,
  validateGroqDefaultModels,
  GroqClientError,
} from "@workspace/ai-orchestrator";
import { getDynamicCatalogStatus } from "@workspace/ai-orchestrator";
import type { ProviderId } from "@workspace/ai-orchestrator";
import type { Request, Response } from "express";

const router = Router();

// ── Helpers ───────────────────────────────────────────────────────────────────

const VALID_PROVIDERS = new Set<string>(Object.keys(PROVIDER_REGISTRY));

function isValidProvider(p: string): p is ProviderId {
  return VALID_PROVIDERS.has(p);
}

function publicLifecycle(snapshot: Awaited<ReturnType<typeof getProviderLifecycleSnapshot>>) {
  const { keyIdentity: _keyIdentity, ...safe } = snapshot;
  return safe;
}

type LegacyGroqAvailability = {
  status: "available" | "unavailable" | "check_unavailable" | "invalid_credential" | "not_configured";
  source: "personal" | "server" | "none";
  checkedModels: { fast: string; powerful: string };
  unavailableRoles: Array<"fast" | "powerful">;
  checkedAt: string;
};

async function getLegacyGroqAvailability(
  apiKey: string | undefined,
  source: LegacyGroqAvailability["source"],
): Promise<LegacyGroqAvailability> {
  const checkedModels = PROVIDER_REGISTRY.groq.defaultModels;
  const checkedAt = new Date().toISOString();
  if (!apiKey) {
    return { status: "not_configured", source: "none", checkedModels, unavailableRoles: [], checkedAt };
  }
  try {
    const validation = await validateGroqDefaultModels(apiKey, checkedModels);
    return {
      status: validation.valid ? "available" : "unavailable",
      source,
      checkedModels: validation.checkedModels,
      unavailableRoles: validation.missing,
      checkedAt,
    };
  } catch (error) {
    return {
      status: error instanceof GroqClientError && error.code === "AUTH_ERROR"
        ? "invalid_credential"
        : "check_unavailable",
      source,
      checkedModels,
      unavailableRoles: [],
      checkedAt,
    };
  }
}

/** Shared GET handler — return key status (never the key itself). */
async function handleGetKey(req: Request, res: Response, provider: ProviderId) {
  const [row] = await db
    .select({
      encryptedApiKey: aiProviderCredentialsTable.encryptedApiKey,
      last4: aiProviderCredentialsTable.last4,
      updatedAt: aiProviderCredentialsTable.updatedAt,
    })
    .from(aiProviderCredentialsTable)
    .where(
      and(
        eq(aiProviderCredentialsTable.ownerId, req.userId),
        eq(aiProviderCredentialsTable.provider, provider),
      ),
    )
    .limit(1);

  if (!row) {
    const envKey = process.env[`${provider.toUpperCase()}_API_KEY`];
    const modelAvailability = provider === "groq"
      ? await getLegacyGroqAvailability(envKey, envKey ? "server" : "none")
      : undefined;
    const lifecycle = await getProviderLifecycleSnapshot({
      provider,
      apiKey: envKey,
      source: envKey ? "server" : undefined,
      check: provider !== "groq" && Boolean(envKey),
    });
    return res.json({
      configured: false,
      effectiveConfigured: Boolean(envKey),
      last4: null,
      updatedAt: null,
      lifecycle: publicLifecycle(lifecycle),
      ...(modelAvailability ? { modelAvailability } : {}),
    });
  }

  let apiKey: string | undefined;
  let source: "user" | "server" = "user";
  try {
    apiKey = decryptApiKey(row.encryptedApiKey);
  } catch (error) {
    logger.error({ err: error, provider }, "Failed to decrypt stored provider key for readiness check");
    invalidateProviderLifecycle(provider, "user");
    apiKey = process.env[`${provider.toUpperCase()}_API_KEY`];
    source = apiKey ? "server" : "user";
  }
  const lifecycle = await getProviderLifecycleSnapshot({
    provider,
    apiKey,
    source,
    check: provider !== "groq" && Boolean(apiKey),
  });
  const modelAvailability = provider === "groq"
    ? await getLegacyGroqAvailability(apiKey, source === "server" ? "server" : "personal")
    : undefined;
  return res.json({
    configured: true,
    last4: row.last4,
    updatedAt: row.updatedAt,
    lifecycle: publicLifecycle(lifecycle),
    ...(modelAvailability ? { modelAvailability } : {}),
  });
}

/** Shared PUT handler — validate and persist the API key. */
async function handlePutKey(req: Request, res: Response, provider: ProviderId) {
  const { apiKey } = req.body as { apiKey?: string };
  if (!apiKey || typeof apiKey !== "string" || apiKey.trim().length < 10) {
    return res.status(400).json({ error: "apiKey must be at least 10 characters" });
  }
  const trimmed = apiKey.trim();

  const config = PROVIDER_REGISTRY[provider];
  const label = config?.label ?? provider;
  const consoleUrl = config?.consoleUrl ?? "your provider's dashboard";

  const validation = await validateProviderKey(provider, trimmed);
  if (!validation.valid) {
    return res.status(422).json({
      error: `${label} API key is invalid or unauthorized`,
      hint: `Check your key at ${consoleUrl} — it was rejected by the ${label} API.`,
      reasonCode: validation.reason ?? "credentials_invalid",
    });
  }

  const last4 = trimmed.slice(-4);
  let encryptedApiKey: string;
  try {
    encryptedApiKey = encryptApiKey(trimmed);
  } catch (err) {
    logger.error({ err, provider }, "Key encryption failed");
    return res.status(500).json({ error: "Key storage unavailable — encryption not configured" });
  }

  const now = new Date();
  await db
    .insert(aiProviderCredentialsTable)
    .values({
      id: randomUUID(),
      ownerId: req.userId,
      provider,
      encryptedApiKey,
      last4,
      createdAt: now,
      updatedAt: now,
    })
    .onConflictDoUpdate({
      target: [aiProviderCredentialsTable.ownerId, aiProviderCredentialsTable.provider],
      set: { encryptedApiKey, last4, updatedAt: now },
    });

  invalidateProviderLifecycle(provider, "user");
  // Return the same readiness shape as GET so the settings card can show
  // model availability immediately, then refresh it on the next query read.
  return handleGetKey(req, res, provider);
}

/** Shared DELETE handler — remove the saved key. */
async function handleDeleteKey(req: Request, res: Response, provider: ProviderId) {
  await db
    .delete(aiProviderCredentialsTable)
    .where(
      and(
        eq(aiProviderCredentialsTable.ownerId, req.userId),
        eq(aiProviderCredentialsTable.provider, provider),
      ),
    );
  invalidateProviderLifecycle(provider, "user");
  return res.json({ configured: false });
}

// ── Generic routes (:provider param) ─────────────────────────────────────────

router.get("/ai/providers/:provider/key", async (req, res) => {
  const { provider } = req.params;
  if (!isValidProvider(provider)) {
    return res.status(400).json({
      error: `Unknown provider "${provider}". Valid values: ${[...VALID_PROVIDERS].join(", ")}`,
    });
  }
  return handleGetKey(req, res, provider);
});

router.put("/ai/providers/:provider/key", async (req, res) => {
  const { provider } = req.params;
  if (!isValidProvider(provider)) {
    return res.status(400).json({
      error: `Unknown provider "${provider}". Valid values: ${[...VALID_PROVIDERS].join(", ")}`,
    });
  }
  return handlePutKey(req, res, provider);
});

router.delete("/ai/providers/:provider/key", async (req, res) => {
  const { provider } = req.params;
  if (!isValidProvider(provider)) {
    return res.status(400).json({
      error: `Unknown provider "${provider}". Valid values: ${[...VALID_PROVIDERS].join(", ")}`,
    });
  }
  return handleDeleteKey(req, res, provider);
});

// ── Active provider ───────────────────────────────────────────────────────────

/** GET /api/ai/active-provider — which provider will be used for this user */
router.get("/ai/active-provider", async (req, res) => {
  const resolved = await resolveProvider(req.userId);
  if (!resolved) return res.json({ provider: null, configured: false });
  return res.json({ provider: resolved.provider, configured: true });
});

// ── PR-011: Provider metrics ──────────────────────────────────────────────────

/**
 * GET /api/ai/metrics
 *
 * PR-05/PR-06: Returns in-memory provider reliability metrics merged with
 * circuit-breaker state so the dashboard can show per-provider runtime health.
 *
 * Shape per entry:
 *   requests, failures, fallbackSuccesses, invalidModels, latency percentiles,
 *   successRate, lastSuccessAt, lastFailureAt, consecutiveFailures   (PR-05)
 *   circuitOpen, cooldownRemainingMs                                 (PR-07)
 *
 * Resets on process restart — for runtime observability, not persistent analytics.
 */
router.get("/ai/metrics", async (req, res) => {
  const metricsMap = new Map(getProviderMetrics().map((m) => [m.provider, m]));
  const configuredRows = await db
    .select({
      provider: aiProviderCredentialsTable.provider,
      encryptedApiKey: aiProviderCredentialsTable.encryptedApiKey,
    })
    .from(aiProviderCredentialsTable)
    .where(eq(aiProviderCredentialsTable.ownerId, req.userId));
  const configured = new Set(configuredRows.map((row) => row.provider));
  // Server-managed keys are intentionally represented only as booleans.
  // Never include their values, prefixes, or lengths in the response.
  const serverConfigured = new Set(
    (["openrouter", "gemini", "deepseek", "groq"] as const).filter((provider) =>
      Boolean(process.env[`${provider.toUpperCase()}_API_KEY`]),
    ),
  );
  const catalog = getDynamicCatalogStatus();

  // Merge circuit state into each metric snapshot; include all known providers
  // even if no requests have been recorded yet (so the UI always has an entry).
  const enriched = PROVIDER_PRIORITY.map((provider) => {
    const metric = metricsMap.get(provider) ?? {
      provider,
      requests: 0, failures: 0, fallbackSuccesses: 0, invalidModels: 0,
      p50LatencyMs: null, p95LatencyMs: null, avgLatencyMs: null,
      successRate: null, lastSuccessAt: null, lastFailureAt: null,
      consecutiveFailures: 0,
    };
    const circuit = getCircuitState(provider);
    const isConfigured = configured.has(provider) || serverConfigured.has(provider);
    const personalRow = configuredRows.find((row) => row.provider === provider);
    let lifecycleKey: string | undefined;
    let lifecycleSource: "user" | "server" | undefined;
    if (personalRow) {
      try {
        lifecycleKey = decryptApiKey(personalRow.encryptedApiKey);
        lifecycleSource = "user";
      } catch {
        lifecycleKey = undefined;
      }
    } else {
      lifecycleKey = process.env[`${provider.toUpperCase()}_API_KEY`];
      lifecycleSource = lifecycleKey ? "server" : undefined;
    }
    const lifecyclePromise = lifecycleKey
      ? getProviderLifecycleSnapshot({ provider, apiKey: lifecycleKey, source: lifecycleSource, check: false })
      : Promise.resolve(getProviderLifecycleSnapshot({ provider, check: false }));
    const isCatalogStale =
      provider === "openrouter" &&
      isConfigured &&
      catalog.loaded &&
      (!catalog.usable || catalog.lastRefreshStatus === "failed" || catalog.lastRefreshStatus === "empty");
    const availabilityState = !isConfigured
      ? "missing_credentials"
      : circuit.open
        ? "circuit_open"
        : isCatalogStale
          ? "catalog_stale"
          : metric.requests === 0
            ? "unknown"
            : metric.consecutiveFailures > 0 || (metric.successRate !== null && metric.successRate < 0.8)
              ? "degraded"
              : "healthy";
    return {
      ...metric,
      configured: isConfigured,
      availabilityState,
      operatorAction: !isConfigured
        ? "Save an API key for this provider to enable it."
        : circuit.open
          ? "Wait for the cooldown to finish, then retry or configure another provider."
          : isCatalogStale
            ? "Retry shortly so the model catalog can refresh; configure another provider if it persists."
            : null,
      correlationId: randomUUID(),
      circuitOpen:         circuit.open,
      circuitHalfOpen:     circuit.halfOpen,
      cooldownRemainingMs: circuit.cooldownRemainingMs,
      lifecycle: lifecyclePromise.then(publicLifecycle),
    };
  });

  return res.json({
    metrics: await Promise.all(enriched),
    catalog: {
      loaded: catalog.loaded,
      usable: catalog.usable,
      ageMs: catalog.ageMs,
      lastRefreshStatus: catalog.lastRefreshStatus,
    },
    behavioralScorecards: getBehavioralScorecards(),
  });
});

// ── Backward-compat aliases ───────────────────────────────────────────────────
// Delegates to the generic handlers — preserves existing clients without change.

router.get("/ai/groq-key",        (req, res) => handleGetKey(req, res, "groq"));
router.put("/ai/groq-key",        (req, res) => handlePutKey(req, res, "groq"));
router.delete("/ai/groq-key",     (req, res) => handleDeleteKey(req, res, "groq"));

router.get("/ai/deepseek-key",    (req, res) => handleGetKey(req, res, "deepseek"));
router.put("/ai/deepseek-key",    (req, res) => handlePutKey(req, res, "deepseek"));
router.delete("/ai/deepseek-key", (req, res) => handleDeleteKey(req, res, "deepseek"));

router.get("/ai/openrouter-key",    (req, res) => handleGetKey(req, res, "openrouter"));
router.put("/ai/openrouter-key",    (req, res) => handlePutKey(req, res, "openrouter"));
router.delete("/ai/openrouter-key", (req, res) => handleDeleteKey(req, res, "openrouter"));

router.get("/ai/gemini-key",    (req, res) => handleGetKey(req, res, "gemini"));
router.put("/ai/gemini-key",    (req, res) => handlePutKey(req, res, "gemini"));
router.delete("/ai/gemini-key", (req, res) => handleDeleteKey(req, res, "gemini"));

export default router;
