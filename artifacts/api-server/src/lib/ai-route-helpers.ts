/**
 * Shared helpers for AI route handlers.
 *
 * Extracted from routes/ai.ts to keep each subroute module small and testable.
 * Import from here rather than from the route file.
 *
 * Provider resolution uses PROVIDER_PRIORITY from the registry so the fallback
 * chain is driven by a single array — no if/else sprawl when adding providers.
 */
import { randomUUID } from "crypto";
import { db } from "@workspace/db";
import { aiProviderCredentialsTable, eventsTable } from "@workspace/db";
import { eq, and } from "drizzle-orm";
import {
  chat,
  buildProjectContext,
  GroqClientError,
  PROVIDER_PRIORITY,
  PROVIDER_REGISTRY,
} from "@workspace/ai-orchestrator";
import type { ProviderId } from "@workspace/ai-orchestrator";
import { logger } from "./logger.js";
import { decryptApiKey } from "./credentials-crypto.js";

export type { ProviderId };

// ── Per-provider key resolution ───────────────────────────────────────────────

/**
 * Generic: resolve the saved API key for any provider.
 *
 * Resolution order:
 *   1. User's own saved key (decrypted from DB).
 *   2. Server-wide env fallback: process.env.GROQ_API_KEY (groq only).
 *   3. undefined — caller MUST return 428 to the client.
 */
export async function resolveProviderKey(
  userId: string,
  provider: ProviderId,
): Promise<string | undefined> {
  const [row] = await db
    .select()
    .from(aiProviderCredentialsTable)
    .where(
      and(
        eq(aiProviderCredentialsTable.ownerId, userId),
        eq(aiProviderCredentialsTable.provider, provider),
      ),
    )
    .limit(1);

  if (row) {
    try {
      return decryptApiKey(row.encryptedApiKey);
    } catch (err) {
      const label = PROVIDER_REGISTRY[provider]?.label ?? provider;
      logger.error(
        { err, ownerId: userId, provider },
        `Failed to decrypt stored ${label} API key — falling back to env`,
      );
    }
  }

  // Server-wide env fallback — only supported for Groq.
  if (provider === "groq") {
    return process.env.GROQ_API_KEY || undefined;
  }

  return undefined;
}

// Backward-compat named wrappers (used by parity tests and older callers).
export async function resolveGroqApiKey(userId: string): Promise<string | undefined> {
  return resolveProviderKey(userId, "groq");
}
export async function resolveDeepSeekApiKey(userId: string): Promise<string | undefined> {
  return resolveProviderKey(userId, "deepseek");
}
export async function resolveOpenRouterApiKey(userId: string): Promise<string | undefined> {
  return resolveProviderKey(userId, "openrouter");
}

// ── Provider resolution (priority-ordered) ────────────────────────────────────

/**
 * Resolve which AI provider to use for a request.
 *
 * Iterates PROVIDER_PRIORITY ([openrouter, deepseek, groq]) and returns the
 * first provider whose key is available. This is the single place that controls
 * which provider wins — edit PROVIDER_PRIORITY in provider-registry.ts to reorder.
 */
export async function resolveProvider(
  userId: string,
): Promise<{ provider: ProviderId; apiKey: string } | undefined> {
  for (const provider of PROVIDER_PRIORITY) {
    const key = await resolveProviderKey(userId, provider);
    if (key) return { provider, apiKey: key };
  }
  return undefined;
}

/**
 * Resolve a fallback AI provider when the primary is experiencing errors.
 * Skips the current provider and returns the next available one in PROVIDER_PRIORITY order.
 */
export async function resolveFallbackProvider(
  userId: string,
  currentProvider: ProviderId,
): Promise<{ provider: ProviderId; apiKey: string } | undefined> {
  for (const provider of PROVIDER_PRIORITY) {
    if (provider === currentProvider) continue;
    const key = await resolveProviderKey(userId, provider);
    if (key) return { provider, apiKey: key };
  }
  return undefined;
}

/**
 * Error codes that should trigger a provider fallback rather than surfacing
 * the error directly to the caller.
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
 * Fallback is attempted for any error code in FALLBACK_TRIGGER_CODES.
 * Both primary and fallback providers support streaming via `onDelta`.
 */
export async function chatWithFallback(
  userId: string,
  baseParams: {
    message: string;
    history: { role: "user" | "assistant"; content: string }[];
    projectContext: Awaited<ReturnType<typeof buildProjectContext>>;
    rootPath: string | undefined;
  },
  initialProvider: { provider: ProviderId; apiKey: string },
  onDelta?: (delta: string) => void,
): Promise<{ result: Awaited<ReturnType<typeof chat>>; effectiveProvider: ProviderId }> {
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
): Promise<{ provider: ProviderId; apiKey: string } | null> {
  const resolved = await resolveProvider(userId);
  if (!resolved) {
    res.status(428).json({
      error: "AI provider not configured",
      hint: "Save an API key via PUT /api/ai/providers/:provider/key (openrouter, deepseek, or groq).",
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
      hint: "Save a Groq API key via PUT /api/ai/providers/groq/key or ask your administrator to set GROQ_API_KEY on the server.",
    });
    return null;
  }
  return key;
}

// ── Error mapping ─────────────────────────────────────────────────────────────

/**
 * Maps GroqClientError codes to typed HTTP responses so callers receive a
 * structured error body instead of a generic 500.
 *
 * @param ctx.provider  The provider that actually produced the error.
 *                      Uses the registry to build provider-accurate labels and URLs.
 */
export function handleOrchestratorError(
  err: unknown,
  res: import("express").Response,
  ctx?: { projectId?: string; operation?: string; provider?: ProviderId },
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

  // Build provider-specific labels and URLs from the registry.
  const providerId: ProviderId = ctx?.provider ?? "groq";
  const config = PROVIDER_REGISTRY[providerId];
  const providerLabel = config?.label ?? "AI provider";
  const providerConsole = config?.consoleUrl ?? "your provider's dashboard";
  const providerStatus = config?.statusUrl ?? "your provider's status page";

  const base = { code: err.code, provider: providerId };

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
