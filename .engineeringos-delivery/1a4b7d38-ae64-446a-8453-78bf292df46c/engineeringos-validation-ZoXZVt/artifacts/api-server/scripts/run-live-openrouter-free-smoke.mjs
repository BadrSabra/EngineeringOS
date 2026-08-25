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
await refreshDynamicCatalog(apiKey);
const status = getDynamicCatalogStatus();
const liveIds = getDynamicModelIds();
if (!status.usable || !liveIds) {
  console.error(JSON.stringify({
    status: "unavailable",
    reason: "catalog_unavailable",
    catalogStatus: status.lastRefreshStatus,
  }));
  process.exit(2);
}

const chain = resolveFallbackChain({
  capability: "tool_calling",
  quality: "fast",
  requireTools: true,
}).slice(0, maxAttempts).map((model) => model.id);
if (chain.length === 0) {
  console.error(JSON.stringify({ status: "unavailable", reason: "no_free_tool_capable_model" }));
  process.exit(2);
}

const health = await probeProviderHealth({
  provider: "openrouter",
  apiKey,
  model: chain[0],
  timeoutMs: Math.min(15_000, Number.parseInt(process.env.OPENROUTER_SMOKE_TIMEOUT_MS ?? "12000", 10) || 12000),
});
const attempted = health.report?.attemptedModels ?? (health.model ? [health.model] : []);
const staticById = new Map(FREE_MODELS.map((model) => [model.id, model]));
const allFreeAndCapable = attempted.length > 0 && attempted.every((model) => {
  const entry = staticById.get(model);
  return Boolean(entry?.free && entry.supportsTools && entry.capabilities.includes("tool_calling") && liveIds.has(model));
});
const actualModel = health.model;
const passed = health.status === "usable" &&
  allFreeAndCapable &&
  Boolean(actualModel && liveIds.has(actualModel)) &&
  attempted.length <= maxAttempts;

console.log(JSON.stringify({
  status: passed ? "passed" : "unavailable",
  capability: "tool_calling",
  catalog: { usable: status.usable, freeModelCount: liveIds.size },
  selectedModel: chain[0],
  actualModel: actualModel ?? null,
  attemptedModels: attempted,
  attemptCount: attempted.length,
  maxAttempts,
  freePolicy: allFreeAndCapable,
  healthStatus: health.status,
}));
process.exit(passed ? 0 : 2);