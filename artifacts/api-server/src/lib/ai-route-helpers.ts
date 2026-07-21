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
 * Resolve the DeepSeek API key for a given user (DB only, no env fallback).
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
      logger.error({ err, ownerId: userId }, "Failed to decrypt stored DeepSeek API key");
    }
  }

  return undefined;
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
 * Call `chat()` with automatic provider fallback on RATE_LIMITED.
 *
 * @param onDelta  Optional streaming callback. When provided (and provider is
 *                 Groq), the final synthesis step uses Groq token streaming and
 *                 each delta is forwarded to this callback in real time.
 *                 Not forwarded to the fallback provider if Groq is rate-limited
 *                 and DeepSeek takes over — DeepSeek falls back to non-streaming.
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
      onDelta: initialProvider.provider === "groq" ? onDelta : undefined,
    });
    return { result, effectiveProvider: initialProvider.provider };
  } catch (err) {
    if (err instanceof GroqClientError && err.code === "RATE_LIMITED") {
      const fallback = await resolveFallbackProvider(userId, initialProvider.provider);
      if (fallback) {
        logger.info(
          { primary: initialProvider.provider, fallback: fallback.provider },
          "primary provider rate-limited; retrying with fallback provider",
        );
        // Fallback runs without streaming (DeepSeek doesn't support it here).
        const result = await chat({
          ...baseParams,
          apiKey: fallback.apiKey,
          provider: fallback.provider,
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
 */
export function handleOrchestratorError(
  err: unknown,
  res: import("express").Response,
  ctx?: { projectId?: string; operation?: string },
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
        message: `AI request failed [${err.code}]${ctx.operation ? ` during ${ctx.operation}` : ""}: ${err.message.slice(0, 180)}`,
      })
      .catch(() => {});
  }

  const base = { code: err.code };
  switch (err.code) {
    case "TIMEOUT":
    case "NETWORK_ERROR":
      res.status(503).json({ ...base, error: "AI provider unreachable — try again in a moment." });
      return true;
    case "AUTH_ERROR":
      res.status(401).json({
        ...base,
        error: "Groq API key is invalid or unauthorized.",
        hint: "Delete your current key and save a valid one from console.groq.com.",
      });
      return true;
    case "RATE_LIMITED":
      res.status(429).json({
        ...base,
        error: "Groq rate limit reached — please wait a moment before retrying.",
        hint: "You've exceeded your Groq API quota. Wait 30–60 seconds or upgrade your Groq plan at console.groq.com.",
      });
      return true;
    case "SERVER_ERROR":
      res.status(502).json({
        ...base,
        error: "Groq server error — this is a temporary infrastructure issue.",
        hint: "Try again in a moment. If it persists, check status.groq.com.",
      });
      return true;
    case "NON_200":
      res.status(502).json({ ...base, error: "AI provider returned an unexpected error.", hint: "Check your Groq API key or try again." });
      return true;
    case "EMPTY_RESPONSE":
      res.status(502).json({ ...base, error: "AI provider returned an empty response.", hint: "This may be a transient Groq issue — try again." });
      return true;
    case "INVALID_CONFIG":
      res.status(422).json({ ...base, error: "AI provider configuration is invalid.", hint: "Re-save your Groq API key." });
      return true;
    default:
      res.status(502).json({ ...base, error: "AI provider error.", hint: err.message });
      return true;
  }
}
