#!/usr/bin/env node

/**
 * Opt-in, bounded OpenRouter free-tier smoke check.
 * It deliberately prints only policy-owned metadata, never provider bodies or
 * credentials. CI remains provider-free unless explicitly enabled.
 */
import path from "node:path";
import { fileURLToPath } from "node:url";

const MAX_ATTEMPTS = 4;
const DEFAULT_MAX_ATTEMPTS = 3;
const DEFAULT_TIMEOUT_MS = 12_000;
const MAX_TIMEOUT_MS = 15_000;
const SAFE_CATALOG_STATUSES = new Set(["never", "success", "failed", "empty"]);
const SAFE_FAILURE_CATEGORIES = new Set([
  "authentication",
  "quota",
  "rate-limit",
  "catalog",
  "empty-response",
  "network",
  "server",
  "request",
  "capability",
  "routing",
  "unknown",
]);
const SAFE_RATE_LIMIT_SCOPES = new Set([
  "upstream_shared_pool",
  "provider_credential",
  "account_quota",
  "unknown",
]);
const MAX_SAFE_RETRY_AFTER_MS = 24 * 60 * 60 * 1_000;
const SUPPRESSED_CONSOLE_METHODS = [
  "assert",
  "clear",
  "count",
  "countReset",
  "debug",
  "dir",
  "error",
  "group",
  "groupCollapsed",
  "groupEnd",
  "info",
  "log",
  "table",
  "time",
  "timeEnd",
  "timeLog",
  "trace",
  "warn",
];

function normalizeBoundedInteger(value, fallback, maximum) {
  const parsed = Number.parseInt(String(value ?? ""), 10);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(maximum, Math.max(1, parsed));
}

export function normalizeSmokeOptions(options = {}) {
  return {
    maxAttempts: normalizeBoundedInteger(
      options.maxAttempts,
      DEFAULT_MAX_ATTEMPTS,
      MAX_ATTEMPTS,
    ),
    timeoutMs: normalizeBoundedInteger(
      options.timeoutMs,
      DEFAULT_TIMEOUT_MS,
      MAX_TIMEOUT_MS,
    ),
  };
}

function safeCatalogStatus(value) {
  return SAFE_CATALOG_STATUSES.has(value) ? value : "failed";
}

function safeFailureCategory(value) {
  return SAFE_FAILURE_CATEGORIES.has(value) ? value : "unknown";
}

function safeRateLimitScope(value) {
  return SAFE_RATE_LIMIT_SCOPES.has(value) ? value : null;
}

function safeRetryAfterMs(value) {
  return Number.isSafeInteger(value) && value > 0
    ? Math.min(value, MAX_SAFE_RETRY_AFTER_MS)
    : null;
}

function safeModelId(value) {
  return typeof value === "string"
    && /^[A-Za-z0-9][A-Za-z0-9._:/+-]{0,127}$/.test(value)
    ? value
    : null;
}

function baseResult({
  status = "unavailable",
  catalogUsable = false,
  freeModelCount = 0,
  catalogStatus = "failed",
  selectedModel = null,
  actualModel = null,
  attemptedModels = [],
  maxAttempts,
  healthStatus = "unavailable",
  failureCategory = "unknown",
  reason = "provider_unavailable",
  rateLimitScope = null,
  retryAfterMs = null,
  responseValidation = "not_attempted",
  actualModelFreeVerified = null,
}) {
  const attempted = attemptedModels.slice(0, maxAttempts);
  return {
    provider: "openrouter",
    status,
    capability: "tool_calling",
    catalog: {
      usable: Boolean(catalogUsable),
      freeModelCount: Number.isFinite(freeModelCount) ? Math.max(0, freeModelCount) : 0,
    },
    catalogStatus: safeCatalogStatus(catalogStatus),
    selectedModel: typeof selectedModel === "string" ? selectedModel : null,
    actualModel: safeModelId(actualModel),
    attemptedModels: attempted,
    attemptCount: attempted.length,
    maxAttempts,
    freePolicy: attempted.length > 0 && actualModelFreeVerified !== false,
    paidFallbackEnabled: false,
    actualModelFreeVerified,
    healthStatus: healthStatus === "usable" ? "usable" : "unavailable",
    responseValidation,
    rateLimitScope: safeRateLimitScope(rateLimitScope),
    retryAfterMs: safeRetryAfterMs(retryAfterMs),
    failureCategory: failureCategory === null ? null : safeFailureCategory(failureCategory),
    reason: reason === null ? null : (
      reason === "catalog_unavailable" ||
      reason === "catalog_exhaustion" ||
      reason === "malformed_capability_output" ||
      reason === "provider_authentication_failure" ||
      reason === "provider_transport_failure" ||
              reason === "actual_model_unreported" ||
              reason === "actual_model_not_free_allowlisted" ||
      reason === "provider_unavailable"
        ? reason
        : "provider_unavailable"
    ),
  };
}

async function withSuppressedConsole(operation) {
  const originals = new Map();
  try {
    for (const method of SUPPRESSED_CONSOLE_METHODS) {
      if (typeof console[method] === "function") {
        originals.set(method, console[method]);
        console[method] = () => {};
      }
    }
    return await operation();
  } finally {
    for (const [method, original] of originals) {
      console[method] = original;
    }
  }
}

function liveModelPolicy(FREE_MODELS, liveIds) {
  const staticById = new Map(
    Array.isArray(FREE_MODELS)
      ? FREE_MODELS
        .filter((model) => model && typeof model.id === "string")
        .map((model) => [model.id, model])
      : [],
  );
  return (modelId) => {
    if (typeof modelId !== "string") return false;
    const entry = staticById.get(modelId);
    return Boolean(
      entry?.free &&
        entry.supportsTools &&
        Array.isArray(entry.capabilities) &&
        entry.capabilities.includes("tool_calling") &&
        liveIds.has(modelId),
    );
  };
}

function catalogUnavailableResult(status, maxAttempts) {
  return baseResult({
    maxAttempts,
    catalogStatus: status?.lastRefreshStatus,
    reason: "catalog_unavailable",
    failureCategory: "catalog",
  });
}

/**
 * Run the smoke orchestration without process exit or live-provider imports.
 *
 * Every dependency is injectable so tests can exercise the complete policy
 * without making a catalog or provider request.
 */
export async function runOpenRouterFreeSmoke({
  apiKey,
  maxAttempts,
  timeoutMs,
  dependencies,
} = {}) {
  const options = normalizeSmokeOptions({ maxAttempts, timeoutMs });
  const execute = async () => {
    let status;
    let liveIds;
    try {
      await dependencies.refreshDynamicCatalog(apiKey);
      status = dependencies.getDynamicCatalogStatus();
      const candidateIds = dependencies.getDynamicModelIds();
      liveIds = candidateIds instanceof Set ? candidateIds : null;
    } catch {
      return catalogUnavailableResult({ lastRefreshStatus: "failed" }, options.maxAttempts);
    }

    if (!status?.usable || !liveIds) {
      return catalogUnavailableResult(status, options.maxAttempts);
    }

    const isFreeToolCapableLiveModel = liveModelPolicy(dependencies.FREE_MODELS, liveIds);
    const catalog = {
      catalogUsable: true,
      freeModelCount: liveIds.size,
    };

    try {
      const resolved = dependencies.resolveFallbackChain({
        capability: "tool_calling",
        quality: "fast",
        requireTools: true,
      });
      const chain = (Array.isArray(resolved) ? resolved : [])
        .map((model) => model?.id)
        .filter(isFreeToolCapableLiveModel)
        .slice(0, options.maxAttempts);

      if (chain.length === 0) {
        return baseResult({
          ...catalog,
          catalogStatus: status.lastRefreshStatus,
          maxAttempts: options.maxAttempts,
          reason: "catalog_exhaustion",
          failureCategory: "catalog",
        });
      }

      const attempted = [];
      const failureCategories = [];
      let healthStatus = "unavailable";
      let actualModel = null;
      let rateLimitScope = null;
      let retryAfterMs = null;
      let actualModelFreeVerified = null;

      for (const model of chain) {
        attempted.push(model);
        let health;
        try {
          health = await dependencies.probeProviderHealth({
            provider: "openrouter",
            apiKey,
            model,
            timeoutMs: options.timeoutMs,
            // The smoke owns the candidate loop. Do not let one probe silently
            // consume the remaining candidates through provider-owned fallback.
            maxFallbackModels: 1,
          });
        } catch {
          health = { status: "unavailable", report: { failureCategory: "network" } };
        }
        healthStatus = health?.status === "usable" ? "usable" : "unavailable";
        const report = health?.report;
        rateLimitScope = safeRateLimitScope(report?.rateLimitScope) ?? rateLimitScope;
        retryAfterMs = safeRetryAfterMs(report?.retryAfterMs) ?? retryAfterMs;

        if (healthStatus === "usable") {
          // Never report the requested candidate as the actual model. The
          // provider must identify the response model and it must be allowlisted.
          const reportedModel = safeModelId(health?.model);
          actualModelFreeVerified = reportedModel
            ? isFreeToolCapableLiveModel(reportedModel)
            : false;
          actualModel = reportedModel;
          break;
        }

        failureCategories.push(safeFailureCategory(health?.report?.failureCategory));
      }

      const allCapabilityFailures =
        attempted.length > 0 &&
        failureCategories.length === attempted.length &&
        failureCategories.every((category) => category === "capability");
      const actualModelAllowed = Boolean(
        healthStatus === "usable"
        && actualModel
        && actualModelFreeVerified,
      );
      const failureCategory = actualModelAllowed
        ? null
        : allCapabilityFailures
          ? "capability"
          : healthStatus === "usable"
            ? "routing"
          : failureCategories.includes("authentication")
            ? "authentication"
            : failureCategories.includes("network")
              ? "network"
              : failureCategories[0] ?? "unknown";
      const reason = actualModelAllowed
        ? null
        : allCapabilityFailures
          ? "malformed_capability_output"
          : healthStatus === "usable"
            ? actualModel
              ? "actual_model_not_free_allowlisted"
              : "actual_model_unreported"
          : failureCategories.includes("authentication")
            ? "provider_authentication_failure"
            : failureCategories.includes("network")
              ? "provider_transport_failure"
              : "provider_unavailable";
      const passed = healthStatus === "usable" &&
        actualModelAllowed &&
        attempted.every(isFreeToolCapableLiveModel);

      return baseResult({
        ...catalog,
        catalogStatus: status.lastRefreshStatus,
        status: passed ? "passed" : "unavailable",
        selectedModel: chain[0],
        actualModel,
        attemptedModels: attempted,
        maxAttempts: options.maxAttempts,
        healthStatus,
        failureCategory,
        reason,
        rateLimitScope,
        retryAfterMs,
        responseValidation: healthStatus === "usable"
          ? passed ? "passed" : "failed"
          : "not_verified",
        actualModelFreeVerified,
      });
    } catch {
      return baseResult({
        ...catalog,
        catalogStatus: status.lastRefreshStatus,
        maxAttempts: options.maxAttempts,
        reason: "provider_unavailable",
        failureCategory: "unknown",
      });
    }
  };

  return withSuppressedConsole(execute);
}

async function loadLiveDependencies() {
  return import("@workspace/ai-orchestrator");
}

function writeLine(stream, line) {
  stream.write(`${line}\n`);
}

/**
 * CLI boundary shared by the executable and provider-free tests.
 * Dependency loading happens only after the explicit opt-in and key checks.
 */
export async function runOpenRouterFreeSmokeCli({
  env = process.env,
  loadDependencies = loadLiveDependencies,
  stdout = process.stdout,
  stderr = process.stderr,
} = {}) {
  if (env.RUN_LIVE_OPENROUTER_FREE_SMOKE !== "1") {
    writeLine(
      stderr,
      "SKIP: live OpenRouter free smoke is opt-in. Set RUN_LIVE_OPENROUTER_FREE_SMOKE=1.",
    );
    return 0;
  }

  const apiKey = env.OPENROUTER_API_KEY?.trim();
  if (!apiKey) {
    writeLine(stderr, "BLOCKED: OPENROUTER_API_KEY is required for the opt-in smoke check.");
    return 2;
  }

  let dependencies;
  try {
    dependencies = await loadDependencies();
  } catch {
    writeLine(
      stdout,
      JSON.stringify(baseResult({
        maxAttempts: normalizeSmokeOptions({
          maxAttempts: env.OPENROUTER_SMOKE_MAX_ATTEMPTS,
        }).maxAttempts,
        reason: "provider_unavailable",
        failureCategory: "unknown",
      })),
    );
    return 2;
  }

  const result = await runOpenRouterFreeSmoke({
    apiKey,
    maxAttempts: env.OPENROUTER_SMOKE_MAX_ATTEMPTS,
    timeoutMs: env.OPENROUTER_SMOKE_TIMEOUT_MS,
    dependencies,
  });
  writeLine(stdout, JSON.stringify(result));
  return result.status === "passed" ? 0 : 2;
}

const isMainModule =
  process.argv[1] &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);

if (isMainModule) {
  process.exitCode = await runOpenRouterFreeSmokeCli();
}