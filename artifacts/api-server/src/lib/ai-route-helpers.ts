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
  createExecutionLedger,
  validateGroqDefaultModels,
  toPublicExecutionLedgerSnapshot,
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
  GroqErrorCode,
  ExecutionLedgerPublicSnapshot,
  ExecutionLedgerSnapshot,
} from "@workspace/ai-orchestrator";
import type { ExecutionLedger } from "@workspace/ai-orchestrator";
import { logger } from "./logger.js";
import { decryptApiKey } from "./credentials-crypto.js";

export type { ProviderId };
/**
 * Remove deployment details from values that cross an AI route's user-facing
 * boundary. Keep the original provider output for server-side diagnostics,
 * but never persist or stream it verbatim.
 */
export function redactUserFacingText(value: string): string {
  return value
    .replace(/\/(?:home\/runner(?:\/workspace)?|workspace|tmp|app|srv|var\/task|mnt\/data)\/[^\s`"'<>),;]+/g, "[runtime path]")
    .replace(/\b[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\b/gi, "[internal id]")
    .replace(/\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi, "[redacted email]")
    .replace(/\b(?:bearer|token|secret|password|api[_ -]?key)\s*[:=]\s*\S+/gi, "[redacted credential]")
    .replace(/\beyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\b/g, "[redacted token]");
}

/** Redact strings in user-facing JSON while preserving its shape. */
export function redactUserFacingValue<T>(value: T): T {
  if (typeof value === "string") return redactUserFacingText(value) as T;
  if (Array.isArray(value)) return value.map((item) => redactUserFacingValue(item)) as T;
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value).map(([key, item]) => [key, redactUserFacingValue(item)]),
    ) as T;
  }
  return value;
}

type ProviderSelectionOptions = {
  /** When true, skip providers that cannot handle the request's tool payloads. */
  requireTools?: boolean;
  /** Optional quality profile used to bias provider selection. */
  qualityProfile?: QualityProfile;
};

const GROQ_MODEL_VALIDATION_TTL_MS = 5 * 60 * 1_000;
const groqModelValidationCache = new Map<
  string,
  { expiresAt: number; valid: boolean }
>();

async function groqCanUseConfiguredModels(apiKey: string): Promise<boolean> {
  const now = Date.now();
  const cached = groqModelValidationCache.get(apiKey);
  if (cached && cached.expiresAt > now) return cached.valid;

  try {
    const validation = await validateGroqDefaultModels(apiKey);
    groqModelValidationCache.set(apiKey, {
      expiresAt: now + GROQ_MODEL_VALIDATION_TTL_MS,
      valid: validation.valid,
    });
    if (!validation.valid) {
      logger.warn(
        {
          provider: "groq",
          modelCheck: "missing",
          missingRoles: validation.missing,
        },
        "Skipping Groq: configured model is not present in the live catalog",
      );
    }
    return validation.valid;
  } catch (error) {
    // A temporary catalog outage must not turn a usable provider into a
    // permanent configuration failure. The completion path still classifies
    // MODEL_NOT_FOUND and can fall back if the request proves unusable.
    logger.warn(
      {
        provider: "groq",
        modelCheck: "unavailable",
        reason: error instanceof GroqClientError ? error.code : "UNKNOWN",
      },
      "Groq model catalog unavailable; retaining provider as a best-effort candidate",
    );
    return true;
  }
}

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
    if (provider === "groq" && !(await groqCanUseConfiguredModels(key))) {
      skipped.push({ provider, reason: "model_not_found" });
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
 * Normalize SDK/parser failures that escaped without the typed provider
 * error. The original error remains available as a non-serialized cause,
 * while fallback receives a safe, known error code.
 */
export function normalizeProviderFailure(error: unknown): GroqClientError {
  if (error instanceof GroqClientError) return error;

  const candidate = error as { status?: unknown; code?: unknown; name?: unknown } | null;
  const status = typeof candidate?.status === "number" ? candidate.status : undefined;
  let code: GroqErrorCode = "NETWORK_ERROR";

  if (status === 401 || status === 403) code = "AUTH_ERROR";
  else if (status === 404) code = "MODEL_NOT_FOUND";
  else if (status === 429) code = "RATE_LIMITED";
  else if (status !== undefined && status >= 500) code = "SERVER_ERROR";
  else if (status !== undefined) code = "NON_200";
  else if (candidate?.code === "INVALID_TOOL_CALL") code = "INVALID_TOOL_CALL";

  return new GroqClientError(code, "AI provider request failed", {
    cause: error,
    context: {
      providerStatus: status,
      providerCode: typeof candidate?.code === "string" ? candidate.code : undefined,
      providerName: typeof candidate?.name === "string" ? candidate.name : undefined,
    },
  });
}

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
  run: (opts: { provider: ProviderId; apiKey: string; signal?: AbortSignal }) => Promise<T>,
  options?: ProviderSelectionOptions & { signal?: AbortSignal },
): Promise<{ result: T; effectiveProvider: ProviderId }> {
  const orderedProviders = await collectAvailableProviders(userId, options);
  if (!orderedProviders.some((candidate) => candidate.provider === initialProvider.provider)) {
    orderedProviders.unshift(initialProvider);
  }

  let lastErr: GroqClientError | undefined;

  for (const providerEntry of orderedProviders) {
    if (options?.signal?.aborted) {
      throw Object.assign(new Error("Execution cancelled"), { name: "AbortError" });
    }
    if (lastErr) {
      logger.info(
        { primary: initialProvider.provider, fallback: providerEntry.provider, errorCode: lastErr.code },
        "primary provider error; retrying agent with fallback provider",
      );
    }
    try {
      const result = await run({ ...providerEntry, signal: options?.signal });
      return { result, effectiveProvider: providerEntry.provider };
    } catch (err) {
      if (options?.signal?.aborted) {
        throw Object.assign(new Error("Execution cancelled"), { name: "AbortError", cause: err });
      }
      const providerError = normalizeProviderFailure(err);
      if (FALLBACK_TRIGGER_CODES.has(providerError.code)) {
        logger.warn(
          { provider: providerEntry.provider, code: providerError.code, message: providerError.message },
          "provider failed — trying next in chain",
        );
        lastErr = providerError;
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
  /** Request-scoped read evidence shared across provider retries. */
  retainedEvidence?: Map<string, string>;
    /** Enabled only after the route validates an approved implementation plan. */
    allowValidationTools?: boolean;
    /** Server-owned validation callback; never derived from model arguments. */
    validationRunner?: ValidationRunner;
    browserValidationRunner?: import("@workspace/ai-orchestrator").BrowserValidationRunner;
    browserValidationContext?: { operationId?: string; revision?: string };
    approvedValidationProfiles?: readonly string[];
     commandProfiles?: readonly import("@workspace/ai-orchestrator").CommandProfile[];
     commandRunner?: import("@workspace/ai-orchestrator").CommandRunner;
     commandContext?: { operationId?: string; revision?: string; targetPaths?: readonly string[]; operation?: string };
    /** Server-owned read-only scanner/graph/discovery callback. */
    allowAnalysisTools?: boolean;
    analysisToolRunner?: import("@workspace/ai-orchestrator").AnalysisToolRunner;
    analysisCorrelation?: import("@workspace/ai-orchestrator").AnalysisCorrelation;
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
     /** Shared budget across provider attempts and nested agent phases. */
     executionLedger?: ExecutionLedger;
     /** Server-owned capability catalog registry for an active operation. */
     capabilityRegistry?: import("@workspace/ai-orchestrator").CapabilityRegistry;
  },
  initialProvider: { provider: ProviderId; apiKey: string },
  onDelta?: (delta: string) => void,
  options?: ProviderSelectionOptions,
  onStreamReset?: () => void,
  onStep?: (step: AgentStep) => void,
): Promise<{
  result: Awaited<ReturnType<typeof chat>>;
  effectiveProvider: ProviderId;
  executionLedger?: ExecutionLedger;
}> {
  const executionLedger =
    baseParams.executionLedger ??
    createExecutionLedger({ mode: "tool_chat", signal: baseParams.signal });
  const orderedProviders = await collectAvailableProviders(userId, options);
  if (!orderedProviders.some((candidate) => candidate.provider === initialProvider.provider)) {
    orderedProviders.unshift(initialProvider);
  }

  if (orderedProviders.length === 0) {
    executionLedger.setTerminal("provider_exhausted");
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
  // Keep completed source reads when a provider fails after a tool call. This
  // is deliberately request-scoped and contains no runtime/session metadata.
  // The route may seed this map when resuming a request; do not replace it or
  // the text-only fallback will lose evidence acquired by the prior attempt.
  const retainedEvidence = baseParams.retainedEvidence ?? new Map<string, string>();

  for (const [providerIndex, providerEntry] of orderedProviders.entries()) {
    if (providerIndex > 0 && !executionLedger.admit("provider_change", { provider: providerEntry.provider })) {
      break;
    }
    if (lastErr) {
      logger.info(
        { primary: initialProvider.provider, fallback: providerEntry.provider, errorCode: lastErr.code },
        "primary provider error; retrying with fallback provider",
      );
    }
    try {
      // The API package can briefly consume an older workspace declaration
      // while the orchestrator adds this request-scoped additive option.
      // Keep the compatibility cast at this package boundary only.
      const result = await chat({
        ...baseParams,
        apiKey: providerEntry.apiKey,
        provider: providerEntry.provider,
        onDelta,
        onStreamReset,
        onStep,
        allowValidationTools: baseParams.allowValidationTools,
        validationRunner: baseParams.validationRunner,
        browserValidationRunner: baseParams.browserValidationRunner,
        browserValidationContext: baseParams.browserValidationContext,
        approvedValidationProfiles: baseParams.approvedValidationProfiles,
         commandProfiles: baseParams.commandProfiles,
         commandRunner: baseParams.commandRunner,
         commandContext: baseParams.commandContext,
        allowAnalysisTools: baseParams.allowAnalysisTools,
        analysisToolRunner: baseParams.analysisToolRunner,
        analysisCorrelation: baseParams.analysisCorrelation,
        validationTargetPaths: baseParams.validationTargetPaths,
        executionPlanOverride: baseParams.executionPlanOverride,
        buildHandoff: baseParams.buildHandoff,
        onExecutionNodes: baseParams.onExecutionNodes,
        signal: baseParams.signal,
        turnIntent: baseParams.turnIntent,
        retainedEvidence,
         executionLedger,
         capabilityRegistry: baseParams.capabilityRegistry,
      } as Parameters<typeof chat>[0]);
      return { result, effectiveProvider: providerEntry.provider, executionLedger };
    } catch (err) {
      const providerError = normalizeProviderFailure(err);
      if (FALLBACK_TRIGGER_CODES.has(providerError.code)) {
        logger.warn(
          { provider: providerEntry.provider, code: providerError.code, message: providerError.message },
          "provider failed — trying next in chain",
        );
        providerErrors.push({
          provider: providerEntry.provider,
          code: providerError.code,
          message: providerError.message,
        });
        lastErr = providerError;
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
  executionLedger.setTerminal("provider_exhausted");
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
      availabilityState: "missing_credentials",
      operatorAction: "Save an API key for at least one supported provider, then retry.",
      correlationId: randomUUID(),
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
      availabilityState: "missing_credentials",
      operatorAction: "Save an API key for at least one supported provider, then retry.",
      correlationId: randomUUID(),
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
  ctx?: {
    projectId?: string;
    operation?: string;
    provider?: ProviderId;
    incompleteReview?: { sessionId?: string; failureKind?: string };
    /** Chat routes use the strict public contract instead of provider UI metadata. */
    publicContract?: "chat";
    executionLedger?: ExecutionLedger;
  },
): boolean {
  if (!(err instanceof GroqClientError)) return false;

  logger.error(
    { err, projectId: ctx?.projectId, operation: ctx?.operation, provider: ctx?.provider },
    "AI orchestrator request failed",
  );

  if (ctx?.publicContract === "chat") {
    if (ctx.executionLedger) {
      ctx.executionLedger.setTerminal(
        err.code === "TIMEOUT" ? "deadline" : "provider_exhausted",
      );
    }
    const retryable = err.code === "TIMEOUT"
      || err.code === "NETWORK_ERROR"
      || err.code === "SERVER_ERROR"
      || err.code === "RATE_LIMITED";
    const status = err.code === "AUTH_ERROR"
      ? 401
      : err.code === "RATE_LIMITED"
        ? 429
        : err.code === "QUOTA" || err.code === "PLAN_RESTRICTED"
          ? 402
            : err.code === "INVALID_CONFIG" && err.providerCode === "NO_COMPATIBLE_FREE_MODEL"
              ? 503
          : err.code === "MODEL_NOT_FOUND" || err.code === "MODEL_UNAVAILABLE" ||
                err.code === "INVALID_CONFIG"
            ? 422
            : retryable ? 503 : 502;
    res.status(status).json({
      code: /^[A-Z][A-Z0-9_]{2,79}$/.test(err.code) ? err.code : "AI_PROVIDER_FAILURE",
      error: retryable
        ? "The AI request could not complete. Please retry."
        : "The AI request was not completed because the provider configuration could not satisfy it.",
      outcome: "FAILED",
      retryable,
      recoveryState: "REQUIRED",
      correlationId: randomUUID(),
      ...(ctx.executionLedger
        ? { executionLedger: toPublicExecutionLedgerSnapshot(ctx.executionLedger.snapshot()) }
        : {}),
      ...(ctx.incompleteReview?.sessionId ? { sessionId: ctx.incompleteReview.sessionId } : {}),
    });
    return true;
  }

  if (ctx?.projectId) {
    void db
      .insert(eventsTable)
      .values({
        id: randomUUID(),
        type: "AiOrchestratorError",
        projectId: ctx.projectId,
        severity: "error",
        // Provider details stay in the server log below. Events are exposed
        // through the user-facing activity feed and must not contain raw
        // provider messages, request IDs, or runtime paths.
        message: `AI request failed [${err.code}]${ctx.operation ? ` during ${ctx.operation}` : ""}${ctx.provider ? ` (provider: ${ctx.provider})` : ""}`,
      })
      .catch(() => {});
  }

  // Build provider-specific labels and URLs from the registry.
  const providerId: ProviderId = ctx?.provider ?? "groq";
  const config = PROVIDER_REGISTRY[providerId];
  const providerLabel = config?.label ?? "AI provider";
  const providerConsole = config?.consoleUrl ?? "your provider's dashboard";
  const providerStatus = config?.statusUrl ?? "your provider's status page";

  const correlationId = randomUUID();
  const base = {
    code: err.code,
    provider: providerId,
    correlationId,
    incomplete: true,
    outcomeClass: "terminal-incomplete" as const,
    terminalStatus: "INCOMPLETE" as const,
    ...(ctx?.incompleteReview?.sessionId ? { sessionId: ctx.incompleteReview.sessionId } : {}),
    ...(ctx?.incompleteReview?.failureKind ? { failureKind: ctx.incompleteReview.failureKind } : {}),
    ...providerAvailabilityProjection(err, providerId, providerConsole, providerStatus),
  };

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
      if (err.retryAfterMs !== undefined) {
        res.setHeader("Retry-After", String(Math.ceil(err.retryAfterMs / 1000)));
      }
      res.status(429).json({
        ...base,
        error: `${providerLabel} rate limit reached — retry after ${Math.max(1, Math.ceil((err.retryAfterMs ?? 30_000) / 1000))} seconds.`,
        retryAfterMs: err.retryAfterMs,
        hint: `You've exceeded your ${providerLabel} API quota. Retry after the indicated delay or configure another provider at ${providerConsole}.`,
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
      if (providerId === "openrouter" && err.providerCode === "NO_COMPATIBLE_FREE_MODEL") {
        res.status(503).json({
          ...base,
          error: "No compatible free OpenRouter model is currently available.",
          hint: err.catalogStatus === "failed" || err.catalogStatus === "empty"
            ? "OpenRouter's model catalog could not be refreshed. Try again shortly."
            : "OpenRouter currently has no free model matching this request. Try again later or configure another provider.",
        });
        return true;
      }
      if (providerId === "openrouter" && err.providerCode === "MODEL_CAPABILITY_MISMATCH") {
        res.status(422).json({
          ...base,
          error: "The selected OpenRouter model no longer supports this request.",
          hint: "The model catalog changed while this request was starting. Retry to select a current compatible model.",
        });
        return true;
      }
      if (providerId === "openrouter" && err.providerCode === "STALE_CONFIGURED_MODEL") {
        res.status(422).json({
          ...base,
          error: "The configured OpenRouter model is no longer available.",
          hint: "Select a current free model or clear the stale model override.",
        });
        return true;
      }
      res.status(422).json({
        ...base,
        error: "AI provider configuration is invalid.",
        hint: `Re-save your ${providerLabel} API key.`,
      });
      return true;
    default:
      res.status(502).json({ ...base, error: `${providerLabel} provider error.`, hint: "Try again in a moment." });
      return true;
  }
}

type ProviderAvailabilityState =
  | "missing_credentials"
  | "authentication_failed"
  | "incompatible_model"
  | "no_compatible_free_model"
  | "catalog_stale"
  | "quota_exhausted"
  | "rate_limited"
  | "circuit_open"
  | "provider_outage";

export function providerAvailabilityProjection(
  err: GroqClientError,
  providerId: ProviderId,
  providerConsole: string,
  providerStatus: string,
): {
  availabilityState: ProviderAvailabilityState;
  operatorAction: string;
  catalogStatus?: string;
} {
  if (err.code === "AUTH_ERROR") {
    return {
      availabilityState: "authentication_failed",
      operatorAction: `Replace the ${providerId} API key with a valid key from ${providerConsole}, then retry.`,
    };
  }
  if (err.providerCode === "CIRCUIT_OPEN") {
    return {
      availabilityState: "circuit_open",
      operatorAction: "Wait for the provider cooldown to finish, then retry or configure another provider.",
    };
  }
  if (
    err.code === "MODEL_NOT_FOUND" ||
    err.code === "MODEL_UNAVAILABLE" ||
    err.providerCode === "MODEL_CAPABILITY_MISMATCH" ||
    err.providerCode === "STALE_CONFIGURED_MODEL"
  ) {
    return {
      availabilityState: "incompatible_model",
      operatorAction: "Choose a compatible current model or configure another provider, then retry.",
    };
  }
  if (err.code === "RATE_LIMITED") {
    return {
      availabilityState: "rate_limited",
      operatorAction: "Wait for the rate-limit window to reset, then retry or configure another provider.",
    };
  }
  if (err.code === "QUOTA" || err.code === "PLAN_RESTRICTED") {
    return {
      availabilityState: "quota_exhausted",
      operatorAction: `Add provider credits at ${providerConsole}, or configure another provider.`,
    };
  }
  if (
    providerId === "openrouter" &&
    err.providerCode === "NO_COMPATIBLE_FREE_MODEL" &&
    (err.catalogStatus === "failed" || err.catalogStatus === "empty" || err.catalogUsable === false)
  ) {
    return {
      availabilityState: "catalog_stale",
      operatorAction: "Retry shortly so OpenRouter can refresh its model catalog; configure another provider if it persists.",
      catalogStatus: err.catalogStatus,
    };
  }
  if (providerId === "openrouter" && err.providerCode === "NO_COMPATIBLE_FREE_MODEL") {
    return {
      availabilityState: "no_compatible_free_model",
      operatorAction: "Select another compatible model or configure another provider, then retry.",
      catalogStatus: err.catalogStatus,
    };
  }
  if (err.code === "TIMEOUT" || err.code === "NETWORK_ERROR" || err.code === "SERVER_ERROR") {
    return {
      availabilityState: "provider_outage",
      operatorAction: `Retry in a moment; if the issue continues, check ${providerStatus} or configure another provider.`,
    };
  }
  return {
    availabilityState: "provider_outage",
    operatorAction: `Retry in a moment or configure another provider. Check ${providerStatus} if it persists.`,
  };
}

/**
 * Keep the durable trace record distinct from tool activity so consumers can
 * recover the exact request budget summary after an SSE reconnect.
 */
const EXECUTION_LEDGER_TRACE_KIND = "execution_ledger";

export function appendExecutionLedgerToTrace(
  serializedTrace: string | null | undefined,
  snapshot: ExecutionLedgerPublicSnapshot,
): string {
  let entries: unknown[] = [];
  if (serializedTrace) {
    try {
      const parsed: unknown = JSON.parse(serializedTrace);
      if (Array.isArray(parsed)) entries = parsed;
    } catch {
      entries = [];
    }
  }
  return JSON.stringify([
    ...entries,
    { kind: EXECUTION_LEDGER_TRACE_KIND, ...snapshot },
  ]);
}

export function executionLedgerFromTrace(value: string | null | undefined): ExecutionLedgerPublicSnapshot | undefined {
  if (!value) return undefined;
  try {
    const parsed: unknown = JSON.parse(value);
    if (!Array.isArray(parsed)) return undefined;
    const entry = [...parsed].reverse().find(
      (candidate) => candidate && typeof candidate === "object"
        && (candidate as Record<string, unknown>).kind === EXECUTION_LEDGER_TRACE_KIND,
    );
    if (!entry || typeof entry !== "object") return undefined;
    const candidate = { ...(entry as Record<string, unknown>) };
    delete candidate.kind;
    const modes = new Set(["simple_chat", "tool_chat", "forensic", "repair_plan", "hierarchical"]);
    const terminalReasons = new Set([
      "completed", "cancelled", "deadline", "model_budget", "tool_budget",
      "recovery_budget", "provider_exhausted", "failed",
    ]);
    if (
      typeof candidate.id !== "string"
      || typeof candidate.mode !== "string"
      || !modes.has(candidate.mode)
      || typeof candidate.startedAt !== "number"
      || typeof candidate.deadlineAt !== "number"
      || typeof candidate.elapsedMs !== "number"
      || typeof candidate.remainingMs !== "number"
      || !candidate.budget
      || typeof candidate.budget !== "object"
      || !candidate.counts
      || typeof candidate.counts !== "object"
      || !Array.isArray(candidate.providers)
      || !Array.isArray(candidate.models)
      || (candidate.terminalReason !== undefined
        && (typeof candidate.terminalReason !== "string" || !terminalReasons.has(candidate.terminalReason)))
    ) return undefined;
    const snapshot = candidate as unknown as ExecutionLedgerSnapshot;
    return toPublicExecutionLedgerSnapshot({
      ...snapshot,
      events: [],
    });
  } catch {
    return undefined;
  }
}
