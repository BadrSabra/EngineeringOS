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
  sortProviderIdsByQuality,
  isCircuitOpen,
} from "@workspace/ai-orchestrator";
import type {
  ProviderId,
  QualityProfile,
  AgentStep,
  ActiveTask,
  ActiveTaskState,
  ExecutionNode,
  ProductionTraceLink,
  ObjectiveContract,
  TurnIntent,
  ValidationRunner,
} from "@workspace/ai-orchestrator";
import { logger } from "./logger.js";
import { decryptApiKey } from "./credentials-crypto.js";

export type { ProviderId };

type ProviderSelectionOptions = {
  /** When true, skip providers that cannot handle the request's tool payloads. */
  requireTools?: boolean;
  /** Optional quality profile used to bias provider selection. */
  qualityProfile?: QualityProfile;
};

function providerCanHandleRequest(provider: ProviderId, options?: ProviderSelectionOptions): boolean {
  const config = PROVIDER_REGISTRY[provider];
  if (!config) return false;
  if (options?.requireTools && !config.supportsTools) return false;
  return true;
}

async function collectAvailableProviders(
  userId: string,
  options?: ProviderSelectionOptions,
): Promise<Array<{ provider: ProviderId; apiKey: string }>> {
  const available: Array<{ provider: ProviderId; apiKey: string }> = [];
  const skipped: Array<{ provider: ProviderId; reason: string }> = [];

  for (const provider of PROVIDER_PRIORITY) {
    const key = await resolveProviderKey(userId, provider);
    if (!key) {
      skipped.push({ provider, reason: "no_api_key" });
      continue;
    }
    if (!providerCanHandleRequest(provider, options)) {
      const reason = options?.requireTools ? "no_tool_support" : "capability_mismatch";
      logger.info(
        { provider, requireTools: !!options?.requireTools, reason },
        "Skipping provider that cannot satisfy the current request",
      );
      skipped.push({ provider, reason });
      continue;
    }
    // PR-07: skip providers whose circuit breaker is open (cooldown not elapsed).
    if (isCircuitOpen(provider)) {
      logger.warn(
        { provider, reason: "circuit_open" },
        "Skipping provider — circuit is open due to consecutive failures",
      );
      skipped.push({ provider, reason: "circuit_open" });
      continue;
    }
    available.push({ provider, apiKey: key });
  }

  if (options?.qualityProfile && available.length > 1) {
    const orderedIds = sortProviderIdsByQuality(
      available.map((candidate) => candidate.provider),
      options.qualityProfile,
      { requireTools: options.requireTools },
    );
    const byProvider = new Map(available.map((candidate) => [candidate.provider, candidate.apiKey]));
    const reordered = orderedIds
      .map((provider) => ({ provider, apiKey: byProvider.get(provider) }))
      .filter((candidate): candidate is { provider: ProviderId; apiKey: string } => Boolean(candidate?.apiKey));

    logger.info(
      {
        scope: "provider-selection",
        action: "collect_available_providers",
        qualityProfile: options.qualityProfile,
        requireTools: !!options?.requireTools,
        available: reordered.map((c) => c.provider),
        skipped,
        finalOrder: reordered.map((c) => c.provider),
      },
      "provider selection complete (quality-ordered)",
    );
    return reordered;
  }

  logger.info(
    {
      scope: "provider-selection",
      action: "collect_available_providers",
      qualityProfile: options?.qualityProfile ?? null,
      requireTools: !!options?.requireTools,
      available: available.map((c) => c.provider),
      skipped,
    },
    "provider selection complete",
  );
  return available;
}

// ── Per-provider key resolution ───────────────────────────────────────────────

/**
 * Generic: resolve the saved API key for any provider.
 *
 * Resolution order:
 *   1. User's own saved key (decrypted from DB).
 *   2. Server-wide env fallback: OPENROUTER_API_KEY / DEEPSEEK_API_KEY / GROQ_API_KEY.
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

  // Server-wide env fallback — supported for all providers via dedicated env vars.
  const ENV_FALLBACK: Record<ProviderId, string | undefined> = {
    openrouter: process.env.OPENROUTER_API_KEY,
    gemini: process.env.GEMINI_API_KEY,
    deepseek: process.env.DEEPSEEK_API_KEY,
    groq: process.env.GROQ_API_KEY,
  };
  return ENV_FALLBACK[provider] || undefined;
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
 * Iterates PROVIDER_PRIORITY ([openrouter, gemini, deepseek, groq]) and returns
 * the first provider whose key is available. This is the single place that
 * controls which provider wins — edit PROVIDER_PRIORITY in provider-registry.ts
 * to reorder.
 */
export async function resolveProvider(
  userId: string,
  options?: ProviderSelectionOptions,
): Promise<{ provider: ProviderId; apiKey: string } | undefined> {
  const available = await collectAvailableProviders(userId, options);
  const selected = available[0];
  logger.info(
    {
      scope: "provider-selection",
      action: "resolve_provider",
      selected: selected?.provider ?? null,
      requireTools: !!options?.requireTools,
      qualityProfile: options?.qualityProfile ?? null,
    },
    selected ? `resolved primary provider: ${selected.provider}` : "no provider available",
  );
  return selected;
}

/**
 * Resolve a fallback AI provider when the primary is experiencing errors.
 * Skips the current provider and returns the next available one in PROVIDER_PRIORITY order.
 */
export async function resolveFallbackProvider(
  userId: string,
  currentProvider: ProviderId,
  options?: ProviderSelectionOptions,
): Promise<{ provider: ProviderId; apiKey: string } | undefined> {
  const available = (await collectAvailableProviders(userId, options)).filter((candidate) => candidate.provider !== currentProvider);
  const selected = available[0];
  logger.info(
    {
      scope: "provider-selection",
      action: "resolve_fallback_provider",
      skipping: currentProvider,
      selected: selected?.provider ?? null,
      requireTools: !!options?.requireTools,
      qualityProfile: options?.qualityProfile ?? null,
    },
    selected ? `resolved fallback provider: ${selected.provider}` : "no fallback provider available",
  );
  return selected;
}

const TOOL_REQUEST_PATTERNS = [
  /\b(analy[sz]e|inspect|review|debug|test|run|scan|read|list|search|find|open|show|trace|explain|compare|fix|patch|implement|modify|change)\b/i,
  // Arabic: \b does not match non-ASCII word boundaries; use bare alternation
  // so prefixed forms like بتحليل and وافحص are matched correctly.
  /فحص|تحليل|راجع|اعرض|افتح|شغّل|شغل|نفّذ|نفذ|اختبر|ابحث|استخرج|قارن|صلّح|عدّل|غيّر/i,
];

export function requestLooksToolBound(message: string): boolean {
  return TOOL_REQUEST_PATTERNS.some((pattern) => pattern.test(message));
}

/**
 * Error codes that should trigger a provider fallback rather than surfacing
 * the error directly to the caller.
 *
 * PR-03: MODEL_UNAVAILABLE (410/422) and PLAN_RESTRICTED (402 free-tier) are
 * now fallback-worthy — they mean the model is gone on THIS provider but
 * another provider may succeed.  QUOTA is also included: if a provider's
 * credits are exhausted we should try the next one.
 */
const FALLBACK_TRIGGER_CODES = new Set<string>([
  "RATE_LIMITED",
  "AUTH_ERROR",
  "NETWORK_ERROR",
  "TIMEOUT",
  "NON_200",
  "EMPTY_RESPONSE",
  "SERVER_ERROR",
  "MODEL_NOT_FOUND",
  "MODEL_UNAVAILABLE",   // PR-03: 410/422 — model temporarily offline
  "PLAN_RESTRICTED",     // PR-03/PR-04: 402 — free-tier restriction
  "QUOTA",               // PR-03: credits/billing exhausted on this provider
]);

/**
 * Run any single-shot agent function with automatic provider fallback.
 *
 * Accepts a `run` closure that receives `{ provider, apiKey }` and returns a
 * result.  On any error code in FALLBACK_TRIGGER_CODES the next provider in
 * PROVIDER_PRIORITY order is tried.  Use this for scan-analysis, code-review,
 * task-execution — any route that calls an agent but doesn't use chat streaming.
 */
export async function runAgentWithFallback<T>(
  userId: string,
  initialProvider: { provider: ProviderId; apiKey: string },
  run: (opts: { provider: ProviderId; apiKey: string }) => Promise<T>,
  options?: ProviderSelectionOptions,
): Promise<{ result: T; effectiveProvider: ProviderId }> {
  const orderedProviders = await collectAvailableProviders(userId, options);
  if (!orderedProviders.some((candidate) => candidate.provider === initialProvider.provider)) {
    orderedProviders.unshift(initialProvider);
  }

  let lastErr: GroqClientError | undefined;

  for (const providerEntry of orderedProviders) {
    if (lastErr) {
      logger.info(
        { primary: initialProvider.provider, fallback: providerEntry.provider, errorCode: lastErr.code },
        "primary provider error; retrying agent with fallback provider",
      );
    }
    try {
      const result = await run(providerEntry);
      return { result, effectiveProvider: providerEntry.provider };
    } catch (err) {
      if (err instanceof GroqClientError && FALLBACK_TRIGGER_CODES.has(err.code)) {
        logger.warn(
          { provider: providerEntry.provider, code: err.code, message: err.message },
          "provider failed — trying next in chain",
        );
        lastErr = err;
        continue;
      }
      throw err;
    }
  }

  throw lastErr ?? new GroqClientError("EMPTY_RESPONSE", "No AI provider returned a response");
}

/**
 * Call `chat()` with automatic provider fallback on recoverable errors.
 *
 * Iterates through ALL configured providers in PROVIDER_PRIORITY order until
 * one succeeds.  Fallback is triggered for any error code in FALLBACK_TRIGGER_CODES.
 * Both primary and fallback providers support streaming via `onDelta`.
 */
export async function chatWithFallback(
  userId: string,
  baseParams: {
    message: string;
    history: {
      role: "user" | "assistant";
      content: string;
      repairPlan?: import("@workspace/ai-orchestrator").RepairPlanMetadata[];
    }[];
    projectContext: Awaited<ReturnType<typeof buildProjectContext>>;
    rootPath: string | undefined;
    /** When provided (with a scanned project), enables knowledge-graph query planning. */
    projectId?: string;
    /** AI-TASK-004: When present, switches the agent into task-aware mode. */
    activeTask?: ActiveTask;
    /** Verified session task contract used to resume short continuation messages. */
    activeTaskState?: ActiveTaskState | null;
    /** Runtime-observed route/orchestrator provenance for the audit trace. */
    productionTraceLinks?: ProductionTraceLink[];
    /**
     * AI-OBJ-005: a validated Objective Completion contract from the request.
     * Threaded straight into chat() so the Objective Completion Gate runs on the
     * actual chat entry points, not just direct library calls.
     */
    objective?: ObjectiveContract;
    /** Route-owned decision derived from the unaugmented user message. */
    turnIntent?: TurnIntent;
    /** Enabled only after the route validates an approved implementation plan. */
    allowValidationTools?: boolean;
    /** Server-owned validation callback; never derived from model arguments. */
    validationRunner?: ValidationRunner;
    /** Server-owned files covered by the approved implementation plan. */
    validationTargetPaths?: string[];
    /** Server-owned execution plan for the current durable Build handoff. */
    executionPlanOverride?: import("@workspace/ai-orchestrator").ActiveTaskExecutionPlan;
    /**
     * True only for a route-validated approved implementation-plan Build
     * handoff. This overrides the natural-language plan classifier.
     */
    buildHandoff?: boolean;
    /** Server-owned execution-node updates from the repair executor. */
    onExecutionNodes?: (nodes: ExecutionNode[]) => void;
    /** Abort signal owned by the durable execution controller. */
    signal?: AbortSignal;
  },
  initialProvider: { provider: ProviderId; apiKey: string },
  onDelta?: (delta: string) => void,
  options?: ProviderSelectionOptions,
  onStreamReset?: () => void,
  onStep?: (step: AgentStep) => void,
): Promise<{ result: Awaited<ReturnType<typeof chat>>; effectiveProvider: ProviderId }> {
  const orderedProviders = await collectAvailableProviders(userId, options);
  if (!orderedProviders.some((candidate) => candidate.provider === initialProvider.provider)) {
    orderedProviders.unshift(initialProvider);
  }

  if (orderedProviders.length === 0) {
    throw new GroqClientError(
      "INVALID_CONFIG",
      options?.requireTools
        ? "No tool-capable AI provider is configured"
        : "No AI provider returned a response",
    );
  }

  let lastErr: GroqClientError | undefined;
  // GAP-C1: collect every provider failure so the final error message shows
  // the full cascade, not just the last attempt.
  const providerErrors: Array<{ provider: string; code: string; message: string }> = [];

  for (const providerEntry of orderedProviders) {
    if (lastErr) {
      logger.info(
        { primary: initialProvider.provider, fallback: providerEntry.provider, errorCode: lastErr.code },
        "primary provider error; retrying with fallback provider",
      );
    }
    try {
      const result = await chat({
        ...baseParams,
        apiKey: providerEntry.apiKey,
        provider: providerEntry.provider,
        onDelta,
        onStreamReset,
        onStep,
        allowValidationTools: baseParams.allowValidationTools,
        validationRunner: baseParams.validationRunner,
        validationTargetPaths: baseParams.validationTargetPaths,
        executionPlanOverride: baseParams.executionPlanOverride,
        buildHandoff: baseParams.buildHandoff,
        onExecutionNodes: baseParams.onExecutionNodes,
        signal: baseParams.signal,
        turnIntent: baseParams.turnIntent,
      });
      return { result, effectiveProvider: providerEntry.provider };
    } catch (err) {
      if (err instanceof GroqClientError && FALLBACK_TRIGGER_CODES.has(err.code)) {
        logger.warn(
          { provider: providerEntry.provider, code: err.code, message: err.message },
          "provider failed — trying next in chain",
        );
        providerErrors.push({ provider: providerEntry.provider, code: err.code, message: err.message });
        lastErr = err;
        continue;
      }
      // Non-recoverable error — surface immediately.
      throw err;
    }
  }

  // GAP-C1: All providers exhausted — surface the full cascade so the caller
  // (and the user) can see which providers were tried and why each failed,
  // instead of only seeing the last provider's error code.
  const cascade = providerErrors.map((e) => `${e.provider}: [${e.code}] ${e.message.slice(0, 120)}`).join(" | ");
  const exhaustedMsg = cascade
    ? `All providers failed — ${cascade}`
    : "No AI provider returned a response";
  throw lastErr
    ? new GroqClientError(lastErr.code, exhaustedMsg)
    : new GroqClientError("EMPTY_RESPONSE", exhaustedMsg);
}

/**
 * Rejects the request with 428 if no provider key can be resolved.
 * Returns { provider, apiKey } on success, null on failure (response already sent).
 */
export async function requireProvider(
  userId: string,
  res: import("express").Response,
  options?: ProviderSelectionOptions,
): Promise<{ provider: ProviderId; apiKey: string } | null> {
  const resolved = await resolveProvider(userId, options);
  if (!resolved) {
    const hint = options?.requireTools
      ? "Save a tool-capable API key via PUT /api/ai/providers/:provider/key (openrouter, deepseek, or groq). Gemini is available for text-only requests."
      : "Save an API key via PUT /api/ai/providers/:provider/key (openrouter, deepseek, groq, or gemini).";
    res.status(428).json({
      error: "AI provider not configured",
      hint,
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
      hint: "Save a Groq API key via PUT /api/ai/providers/groq/key or ask your administrator to set GROQ_API_KEY on the server. OpenRouter and DeepSeek are also supported via OPENROUTER_API_KEY and DEEPSEEK_API_KEY.",
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
    case "MODEL_NOT_FOUND": {
      const isOpenRouter = providerId === "openrouter";
      res.status(422).json({
        ...base,
        error: `${providerLabel} model has been discontinued or removed.`,
        hint: isOpenRouter
          ? `All OpenRouter free-tier models are currently unavailable — the model may have been discontinued. Try a different provider (Groq, DeepSeek, or Gemini) by saving another API key.`
          : `The configured model slug is no longer accepted by ${providerLabel}. Re-save the provider key or try again after the model catalog refreshes.`,
      });
      return true;
    }
    // PR-04: plan-restricted models (402 — free-tier limitation)
    case "PLAN_RESTRICTED": {
      const isOpenRouter = providerId === "openrouter";
      res.status(402).json({
        ...base,
        error: `${providerLabel} model requires a paid plan or credit balance.`,
        hint: isOpenRouter
          ? `The selected OpenRouter model is only available on paid plans. Add a small credit balance at ${providerConsole}, or save a Groq or Gemini API key as a free fallback.`
          : `${providerLabel} requires a paid plan for this model. Check your plan at ${providerConsole}.`,
      });
      return true;
    }
    // PR-04: model temporarily offline (410/422)
    case "MODEL_UNAVAILABLE": {
      res.status(503).json({
        ...base,
        error: `${providerLabel} model is temporarily unavailable.`,
        hint: `The model is temporarily offline or being retired. Try again in a moment, or save a fallback provider key (Groq, DeepSeek, or Gemini) for automatic retry.`,
      });
      return true;
    }
    // PR-04: billing quota / credits exhausted
    case "QUOTA": {
      res.status(402).json({
        ...base,
        error: `${providerLabel} billing quota or credits are exhausted.`,
        hint: `Replenish your ${providerLabel} credits at ${providerConsole}, or save a Groq or Gemini API key as a free fallback.`,
      });
      return true;
    }
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
