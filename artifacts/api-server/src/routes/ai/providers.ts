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
import { encryptApiKey } from "../../lib/credentials-crypto.js";
import { logger } from "../../lib/logger.js";
import { resolveProvider } from "../../lib/ai-route-helpers.js";
import { validateProviderKey, PROVIDER_REGISTRY } from "@workspace/ai-orchestrator";
import type { ProviderId } from "@workspace/ai-orchestrator";
import type { Request, Response } from "express";

const router = Router();

// ── Helpers ───────────────────────────────────────────────────────────────────

const VALID_PROVIDERS = new Set<string>(Object.keys(PROVIDER_REGISTRY));

function isValidProvider(p: string): p is ProviderId {
  return VALID_PROVIDERS.has(p);
}

/** Shared GET handler — return key status (never the key itself). */
async function handleGetKey(req: Request, res: Response, provider: ProviderId) {
  const [row] = await db
    .select({
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

  if (!row) return res.json({ configured: false, last4: null, updatedAt: null });
  return res.json({ configured: true, last4: row.last4, updatedAt: row.updatedAt });
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
      detail: validation.reason,
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

  return res.json({ configured: true, last4, updatedAt: now });
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

export default router;
