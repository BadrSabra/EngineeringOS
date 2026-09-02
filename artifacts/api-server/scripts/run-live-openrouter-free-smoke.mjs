#!/usr/bin/env node

/**
 * Opt-in, bounded OpenRouter free-tier smoke check.
 * It deliberately prints only policy-owned metadata, never provider bodies or
 * credentials. CI remains provider-free unless explicitly enabled.
 */
if (process.env.RUN_LIVE_OPENROUTER_FREE_SMOKE !== "1") {
  console.error("SKIP: live OpenRouter free smoke is opt-in. Set RUN_LIVE_OPENROUTER_FREE_SMOKE=1.");
  process.exit(0);
}

const apiKey = process.env.OPENROUTER_API_KEY?.trim();
if (!apiKey) {
  console.error("BLOCKED: OPENROUTER_API_KEY is required for the opt-in smoke check.");
  process.exit(2);
}

const {
  FREE_MODELS,
  getDynamicCatalogStatus,
  getDynamicModelIds,
  refreshDynamicCatalog,
  resolveFallbackChain,
  probeProviderHealth,
} = await import("@workspace/ai-orchestrator");

const maxAttempts = Math.min(
  4,
  Math.max(1, Number.parseInt(process.env.OPENROUTER_SMOKE_MAX_ATTEMPTS ?? "3", 10) || 3),
);
const timeoutMs = Math.min(
  15_000,
  Number.parseInt(process.env.OPENROUTER_SMOKE_TIMEOUT_MS ?? "12000", 10) || 12000,
);
await refreshDynamicCatalog(apiKey);
const status = getDynamicCatalogStatus();
const liveIds = getDynamicModelIds();
if (!status.usable || !liveIds) {
  console.error(JSON.stringify({
    status: "unavailable",
    reason: "catalog_unavailable",
    failureCategory: "catalog",
    catalogStatus: status.lastRefreshStatus,
  }));
  process.exit(2);
}

const staticById = new Map(FREE_MODELS.map((model) => [model.id, model]));
const isFreeToolCapableLiveModel = (modelId) => {
  const entry = staticById.get(modelId);
  return Boolean(
    entry?.free &&
      entry.supportsTools &&
      entry.capabilities.includes("tool_calling") &&
      liveIds.has(modelId),
  );
};
const chain = resolveFallbackChain({
  capability: "tool_calling",
  quality: "fast",
  requireTools: true,
})
  .map((model) => model.id)
  .filter(isFreeToolCapableLiveModel)
  .slice(0, maxAttempts);
if (chain.length === 0) {
  console.error(JSON.stringify({
    status: "unavailable",
    reason: "catalog_exhaustion",
    failureCategory: "catalog",
  }));
  process.exit(2);
}

const attempted = [];
const failureCategories = [];
let healthStatus = "unavailable";
let actualModel = null;

for (const model of chain) {
  attempted.push(model);
  const health = await probeProviderHealth({
    provider: "openrouter",
    apiKey,
    model,
    timeoutMs,
    // The smoke owns the candidate loop. Do not let one probe silently
    // consume the remaining candidates through provider-owned fallback.
    maxFallbackModels: 1,
  });
  healthStatus = health.status;

  if (health.status === "usable") {
    // Only echo a provider-reported model when it is still an allowlisted live
    // free/tool-capable ID. Otherwise use the server-owned requested candidate.
    actualModel = isFreeToolCapableLiveModel(health.model) ? health.model : model;
    break;
  }

  const category = health.report?.failureCategory;
  failureCategories.push(
    category === "authentication" ||
      category === "quota" ||
      category === "rate-limit" ||
      category === "catalog" ||
      category === "empty-response" ||
      category === "network" ||
      category === "server" ||
      category === "request" ||
      category === "capability" ||
      category === "unknown"
      ? category
      : "unknown",
  );
}

const allCapabilityFailures =
  attempted.length > 0 &&
  failureCategories.length === attempted.length &&
  failureCategories.every((category) => category === "capability");
const failureCategory = actualModel
  ? null
  : allCapabilityFailures
    ? "capability"
    : failureCategories.includes("authentication")
      ? "authentication"
      : failureCategories.includes("network")
        ? "network"
        : failureCategories[0] ?? "unknown";
const reason = actualModel
  ? null
  : allCapabilityFailures
    ? "malformed_capability_output"
    : failureCategories.includes("authentication")
      ? "provider_authentication_failure"
      : failureCategories.includes("network")
        ? "provider_transport_failure"
        : "provider_unavailable";
const passed = healthStatus === "usable" &&
  Boolean(actualModel) &&
  attempted.every(isFreeToolCapableLiveModel);

console.log(JSON.stringify({
  status: passed ? "passed" : "unavailable",
  capability: "tool_calling",
  catalog: { usable: status.usable, freeModelCount: liveIds.size },
  selectedModel: chain[0],
  actualModel: actualModel ?? null,
  attemptedModels: attempted,
  attemptCount: attempted.length,
  maxAttempts,
  freePolicy: attempted.length > 0 && attempted.every(isFreeToolCapableLiveModel),
  healthStatus,
  failureCategory,
  reason,
}));
process.exit(passed ? 0 : 2);