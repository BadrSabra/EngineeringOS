/**
 * AI provider key management routes.
 *
 * GET/PUT/DELETE /api/ai/deepseek-key
 * GET/PUT/DELETE /api/ai/groq-key
 * GET            /api/ai/active-provider
 */
import { Router } from "express";
import { randomUUID } from "crypto";
import { db } from "@workspace/db";
import { aiProviderCredentialsTable } from "@workspace/db";
import { eq, and } from "drizzle-orm";
import { encryptApiKey } from "../../lib/credentials-crypto.js";
import { logger } from "../../lib/logger.js";
import { resolveProvider } from "../../lib/ai-route-helpers.js";

const router = Router();

// ── DeepSeek key management ──────────────────────────────────────────────────

/** GET /api/ai/deepseek-key — return DeepSeek key status (never the key itself) */
router.get("/ai/deepseek-key", async (req, res) => {
  const [row] = await db
    .select({ last4: aiProviderCredentialsTable.last4, updatedAt: aiProviderCredentialsTable.updatedAt })
    .from(aiProviderCredentialsTable)
    .where(and(
      eq(aiProviderCredentialsTable.ownerId, req.userId),
      eq(aiProviderCredentialsTable.provider, "deepseek"),
    ))
    .limit(1);
  if (!row) return res.json({ configured: false, last4: null, updatedAt: null });
  return res.json({ configured: true, last4: row.last4, updatedAt: row.updatedAt });
});

/** PUT /api/ai/deepseek-key — save or update the user's DeepSeek API key */
router.put("/ai/deepseek-key", async (req, res) => {
  const { apiKey } = req.body as { apiKey?: string };
  if (!apiKey || typeof apiKey !== "string" || apiKey.trim().length < 10) {
    return res.status(400).json({ error: "apiKey must be at least 10 characters" });
  }
  const trimmed = apiKey.trim();
  const last4 = trimmed.slice(-4);
  let encryptedApiKey: string;
  try {
    encryptedApiKey = encryptApiKey(trimmed);
  } catch (err) {
    logger.error({ err }, "DeepSeek key encryption failed");
    return res.status(500).json({ error: "Key storage unavailable — encryption not configured" });
  }
  const now = new Date();
  await db
    .insert(aiProviderCredentialsTable)
    .values({ id: randomUUID(), ownerId: req.userId, provider: "deepseek", encryptedApiKey, last4, createdAt: now, updatedAt: now })
    .onConflictDoUpdate({
      target: [aiProviderCredentialsTable.ownerId, aiProviderCredentialsTable.provider],
      set: { encryptedApiKey, last4, updatedAt: now },
    });
  return res.json({ configured: true, last4, updatedAt: now });
});

/** DELETE /api/ai/deepseek-key — remove the user's saved DeepSeek API key */
router.delete("/ai/deepseek-key", async (req, res) => {
  await db
    .delete(aiProviderCredentialsTable)
    .where(and(
      eq(aiProviderCredentialsTable.ownerId, req.userId),
      eq(aiProviderCredentialsTable.provider, "deepseek"),
    ));
  return res.json({ configured: false });
});

/** GET /api/ai/active-provider — which provider will be used for this user */
router.get("/ai/active-provider", async (req, res) => {
  const resolved = await resolveProvider(req.userId);
  if (!resolved) return res.json({ provider: null, configured: false });
  return res.json({ provider: resolved.provider, configured: true });
});

// ── Groq key management ──────────────────────────────────────────────────────

/** GET /api/ai/groq-key — return key status (never the key itself) */
router.get("/ai/groq-key", async (req, res) => {
  const [row] = await db
    .select({
      last4: aiProviderCredentialsTable.last4,
      updatedAt: aiProviderCredentialsTable.updatedAt,
    })
    .from(aiProviderCredentialsTable)
    .where(
      and(
        eq(aiProviderCredentialsTable.ownerId, req.userId),
        eq(aiProviderCredentialsTable.provider, "groq"),
      ),
    )
    .limit(1);

  if (!row) {
    return res.json({ configured: false, last4: null, updatedAt: null });
  }
  return res.json({ configured: true, last4: row.last4, updatedAt: row.updatedAt });
});

/** PUT /api/ai/groq-key — save or update the user's Groq API key */
router.put("/ai/groq-key", async (req, res) => {
  const { apiKey } = req.body as { apiKey?: string };

  if (!apiKey || typeof apiKey !== "string" || apiKey.trim().length < 10) {
    return res.status(400).json({ error: "apiKey must be at least 10 characters" });
  }

  const trimmed = apiKey.trim();
  const last4 = trimmed.slice(-4);
  let encryptedApiKey: string;

  try {
    encryptedApiKey = encryptApiKey(trimmed);
  } catch (err) {
    logger.error({ err }, "Groq key encryption failed");
    return res.status(500).json({ error: "Key storage unavailable — encryption not configured" });
  }

  const now = new Date();

  await db
    .insert(aiProviderCredentialsTable)
    .values({
      id: randomUUID(),
      ownerId: req.userId,
      provider: "groq",
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
});

/** DELETE /api/ai/groq-key — remove the user's saved Groq API key */
router.delete("/ai/groq-key", async (req, res) => {
  await db
    .delete(aiProviderCredentialsTable)
    .where(
      and(
        eq(aiProviderCredentialsTable.ownerId, req.userId),
        eq(aiProviderCredentialsTable.provider, "groq"),
      ),
    );

  return res.json({ configured: false });
});

export default router;
