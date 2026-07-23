/**
 * Shared helpers for AI route handlers.
 *
 * Extracted from routes/ai.ts to keep each subroute module small and testable.
 * Import from here rather than from the route file.
 */
import { randomUUID } from "crypto";
import { db } from "@workspace/db";
import { aiProviderCredentialsTable, eventsTable } from "@workspace/db";
import { eq, and } from "drizzle-orm";
import {
  chat,
  buildProjectContext,
  GroqClientError,
} from "@workspace/ai-orchestrator";
import { logger } from "./logger.js";
import { decryptApiKey } from "./credentials-crypto.js";

// ── Provider resolution ───────────────────────────────────────────────────────

/**
 * Resolve the Groq API key to use for a given user.
 *
 * Resolution order:
 *   1. User's own saved key (decrypted from DB).
 *   2. Server-wide fallback: process.env.GROQ_API_KEY.
 *   3. undefined — caller MUST return 428 to the client.
 */
export async function resolveGroqApiKey(userId: string): Promise<string | undefined> {
  const [row] = await db
    .select()
    .from(aiProviderCredentialsTable)
    .where(
      and(
        eq(aiProviderCredentialsTable.ownerId, userId),
        eq(aiProviderCredentialsTable.provider, "groq"),
      ),
    )
    .limit(1);

  if (row) {
    try {
      return decryptApiKey(row.encryptedApiKey);
    } catch (err) {
      logger.error({ err, ownerId: userId }, "Failed to decrypt stored Groq API key — falling back to env");
    }
  }

  return process.env.GROQ_API_KEY || undefined;
}

/**
 * Resolve the DeepSeek API key for a given user.
 * Priority: DB-stored key → process.env.DEEPSEEK_API_KEY.
 */
export async function resolveDeepSeekApiKey(userId: string): Promise<string | undefined> {
  const [row] = await db
    .select()
    .from(aiProviderCredentialsTable)
    .where(
      and(
        eq(aiProviderCredentialsTable.ownerId, userId),
        eq(aiProviderCredentialsTable.provider, "deepseek"),
      ),
    )
    .limit(1);

  if (row) {
    try {
      return decryptApiKey(row.encryptedApiKey);
    } catch (err) {
      logger.error({ err, ownerId: userId }, "Failed to decrypt stored DeepSeek API key — falling back to env");
    }
  }

  return process.env.DEEPSEEK_API_KEY || undefined;
}

/**
 * Resolve which AI provider to use for a request.
 *
 * Priority: DeepSeek (if key saved) → Groq (key or env fallback) → undefined.
 */
export async function resolveProvider(
  userId: string,
): Promise<{ provider: "groq" | "deepseek"; apiKey: string } | undefined> {
  const deepseekKey = await resolveDeepSeekApiKey(userId);
  if (deepseekKey) return { provider: "deepseek", apiKey: deepseekKey };

  const groqKey = await resolveGroqApiKey(userId);
  if (groqKey) return { provider: "groq", apiKey: groqKey };

  return undefined;
}

/**
 * Resolve a fallback AI provider when the primary is rate-limited.
 */
export async function resolveFallbackProvider(
  userId: string,
  currentProvider: "groq" | "deepseek",
): Promise<{ provider: "groq" | "deepseek"; apiKey: string } | undefined> {
  if (currentProvider === "groq") {
    const key = await resolveDeepSeekApiKey(userId);
    if (key) return { provider: "deepseek", apiKey: key };
  } else {
    const key = await resolveGroqApiKey(userId);
    if (key) return { provider: "groq", apiKey: key };
  }
  return undefined;
}

/**
 * Error codes that should trigger a provider fallback rather than surfacing
 * the error directly to the caller.
 *
 * RATE_LIMITED   — obvious: the provider is throttling us.
 * AUTH_ERROR     — an invalid/expired key should cause us to try the other
 *                  provider instead of failing immediately; the user can fix
 *                  the bad key in parallel.
 * NETWORK_ERROR  — transient connectivity issue; the fallback provider may be
 *                  reachable on a different path.
 * TIMEOUT        — request timed out; worth a single retry on the other provider.
 * NON_200        — unexpected non-200 from the primary (e.g. MODEL_FAST 503
 *                  under heavy load); fallback may succeed.
 * EMPTY_RESPONSE — provider returned nothing actionable; fallback is worth trying.
 * SERVER_ERROR   — 5xx from the primary; try the other provider.
 */
const FALLBACK_TRIGGER_CODES = new Set<string>([
  "RATE_LIMITED",
  "AUTH_ERROR",
  "NETWORK_ERROR",
  "TIMEOUT",
  "NON_200",
  "EMPTY_RESPONSE",
  "SERVER_ERROR",
]);

/**
 * Call `chat()` with automatic provider fallback on recoverable errors.
 *
 * Fallback is attempted for any error code in FALLBACK_TRIGGER_CODES —
 * not just RATE_LIMITED. This covers invalid/expired keys, transient network
 * issues, timeouts, unexpected non-200 responses, empty responses, and
 * server-side errors from the primary provider.
 *
 * @param onDelta  Optional streaming callback. When provided, the final
 *                 synthesis step uses real-time token streaming. Both Groq and
 *                 DeepSeek support streaming. If the primary falls back to the
 *                 other provider, streaming is attempted on that provider too.
 */
export async function chatWithFallback(
  userId: string,
  baseParams: {
    message: string;
    history: { role: "user" | "assistant"; content: string }[];
    projectContext: Awaited<ReturnType<typeof buildProjectContext>>;
    rootPath: string | undefined;
  },
  initialProvider: { provider: "groq" | "deepseek"; apiKey: string },
  onDelta?: (delta: string) => void,
): Promise<{ result: Awaited<ReturnType<typeof chat>>; effectiveProvider: "groq" | "deepseek" }> {
  try {
    const result = await chat({
      ...baseParams,
      apiKey: initialProvider.apiKey,
      provider: initialProvider.provider,
      onDelta,
    });
    return { result, effectiveProvider: initialProvider.provider };
  } catch (err) {
    if (err instanceof GroqClientError && FALLBACK_TRIGGER_CODES.has(err.code)) {
      const fallback = await resolveFallbackProvider(userId, initialProvider.provider);
      if (fallback) {
        logger.info(
          { primary: initialProvider.provider, fallback: fallback.provider, errorCode: err.code },
          "primary provider error; retrying with fallback provider",
        );
        const result = await chat({
          ...baseParams,
          apiKey: fallback.apiKey,
          provider: fallback.provider,
          onDelta,
        });
        return { result, effectiveProvider: fallback.provider };
      }
    }
    throw err;
  }
}

/**
 * Rejects the request with 428 if no provider key can be resolved.
 * Returns { provider, apiKey } on success, null on failure (response already sent).
 */
export async function requireProvider(
  userId: string,
  res: import("express").Response,
): Promise<{ provider: "groq" | "deepseek"; apiKey: string } | null> {
  const resolved = await resolveProvider(userId);
  if (!resolved) {
    res.status(428).json({
      error: "AI provider not configured",
      hint: "Save a DeepSeek API key via PUT /api/ai/deepseek-key or a Groq API key via PUT /api/ai/groq-key.",
    });
    return null;
  }
  return resolved;
}

/**
 * Rejects the request with 428 if no Groq API key can be resolved.
 * Kept for backward-compatibility with non-chat routes that only support Groq.
 */
export async function requireGroqApiKey(
  userId: string,
  res: import("express").Response,
): Promise<string | null> {
  const key = await resolveGroqApiKey(userId);
  if (!key) {
    res.status(428).json({
      error: "AI provider not configured",
      hint: "Save a Groq API key via PUT /api/ai/groq-key or ask your administrator to set GROQ_API_KEY on the server.",
    });
    return null;
  }
  return key;
}

// ── Error mapping ─────────────────────────────────────────────────────────────

/**
 * Maps GroqClientError codes to typed HTTP responses so callers receive a
 * structured error body instead of a generic 500. Returns true when a response
 * was sent; false when the error is not a known provider error (caller should
 * rethrow to the central error handler).
 *
 * @param ctx.provider  The provider that actually produced the error (e.g.
 *                      "deepseek" or "groq"). When omitted the error message
 *                      refers to the AI provider generically. Passing the real
 *                      provider avoids misleading the user (e.g. a DeepSeek
 *                      AUTH_ERROR message that mentions Groq).
 */
export function handleOrchestratorError(
  err: unknown,
  res: import("express").Response,
  ctx?: { projectId?: string; operation?: string; provider?: "groq" | "deepseek" },
): boolean {
  if (!(err instanceof GroqClientError)) return false;

  if (ctx?.projectId) {
    void db
      .insert(eventsTable)
      .values({
        id: randomUUID(),
        type: "AiOrchestratorError",
        projectId: ctx.projectId,
        severity: "error",
        message: `AI request failed [${err.code}]${ctx.operation ? ` during ${ctx.operation}` : ""}${ctx.provider ? ` (provider: ${ctx.provider})` : ""}: ${err.message.slice(0, 180)}`,
      })
      .catch(() => {});
  }

  // Build provider-specific labels and console links for error messages.
  const provider = ctx?.provider ?? "groq";
  const providerLabel = provider === "deepseek" ? "DeepSeek" : "Groq";
  const providerConsole =
    provider === "deepseek" ? "platform.deepseek.com" : "console.groq.com";
  const providerStatus =
    provider === "deepseek" ? "platform.deepseek.com" : "status.groq.com";

  const base = { code: err.code, provider };
  switch (err.code) {
    case "TIMEOUT":
    case "NETWORK_ERROR":
      res.status(503).json({ ...base, error: `${providerLabel} is unreachable — try again in a moment.` });
      return true;
    case "AUTH_ERROR":
      res.status(401).json({
        ...base,
        error: `${providerLabel} API key is invalid or unauthorized.`,
        hint: `Delete your current key and save a valid one from ${providerConsole}.`,
      });
      return true;
    case "RATE_LIMITED":
      res.status(429).json({
        ...base,
        error: `${providerLabel} rate limit reached — please wait a moment before retrying.`,
        hint: `You've exceeded your ${providerLabel} API quota. Wait 30–60 seconds or upgrade your plan at ${providerConsole}.`,
      });
      return true;
    case "SERVER_ERROR":
      res.status(502).json({
        ...base,
        error: `${providerLabel} server error — this is a temporary infrastructure issue.`,
        hint: `Try again in a moment. If it persists, check ${providerStatus}.`,
      });
      return true;
    case "NON_200":
      res.status(502).json({
        ...base,
        error: `${providerLabel} returned an unexpected error.`,
        hint: `Check your ${providerLabel} API key or try again.`,
      });
      return true;
    case "EMPTY_RESPONSE":
      res.status(502).json({
        ...base,
        error: `${providerLabel} returned an empty response.`,
        hint: `This may be a transient ${providerLabel} issue — try again.`,
      });
      return true;
    case "INVALID_CONFIG":
      res.status(422).json({
        ...base,
        error: "AI provider configuration is invalid.",
        hint: `Re-save your ${providerLabel} API key.`,
      });
      return true;
    default:
      res.status(502).json({ ...base, error: `${providerLabel} provider error.`, hint: err.message });
      return true;
  }
}
