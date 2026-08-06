/**
 * OpenRouter Model Resolver (STORY-01, STORY-02, STORY-03, STORY-05)
 *
 * Centralizes all OpenRouter model selection. Execution paths must call
 * resolveModel() or resolveFallbackChain() — never pick a model ID directly.
 *
 *   resolveModel(opts)          → best single model for a capability + quality
 *   resolveFallbackChain(opts)  → ordered list (primary + fallbacks)
 *   buildFallbackChainFromId()  → fallback chain starting from a known model ID
 *   emitModelDecisionTrace()    → structured trace log (STORY-05)
 *
 * PR-002: resolveFallbackChain and buildFallbackChainFromId now filter against
 * the dynamic catalog (getDynamicModelIds) when it has been loaded. Models that
 * are present in the static list but absent from OpenRouter's live /models
 * response are silently skipped — the fallback engine advances automatically.
 *
 * Fallback discipline (STORY-03):
 *   The chain is ordered so the preferred quality tier comes first, followed
 *   by the same tier's alternatives, then the other tier as last-resort.
 *   openrouterCompleteWithFallback() in openai-compatible-client.ts consumes
 *   the chain — a MODEL_NOT_FOUND on model[i] advances to model[i+1] before
 *   giving up.
 */
import { FREE_MODELS, type ModelCapability, type OpenRouterFreeModel } from "./model-catalog.js";
import { getDynamicModelIds, isDynamicCatalogLoaded } from "./dynamic-catalog.js";

export type { ModelCapability, OpenRouterFreeModel };

export type ResolvedModel = {
  id: string;
  label: string;
  free: boolean;
  capability: ModelCapability;
};

export type ResolveModelOpts = {
  capability: ModelCapability;
  quality?: "fast" | "powerful";
  requireTools?: boolean;
  /** Always true for this module — reserved for future paid-tier support. */
  preferFreeTier?: boolean;
};

/** Structured record emitted for every model selection decision (STORY-05). */
export type ModelDecisionTrace = {
  provider: "openrouter";
  capability: ModelCapability;
  quality: "fast" | "powerful";
  requireTools: boolean;
  preferFreeTier: boolean;
  candidates: string[];
  selected: string;
  fallbackChain: string[];
  /** PR-002: models skipped because they are absent from the live catalog. */
  skippedStale?: string[];
};

/** Emit a model-decision trace to stdout as a JSON log line. */
export function emitModelDecisionTrace(trace: ModelDecisionTrace): void {
  console.info(JSON.stringify({ scope: "model-resolver", ...trace }));
}

/**
 * PR-002: Filter the model pool against the live OpenRouter catalog.
 * Returns [live, stale] — models still available and models that are gone.
 */
function partitionByLiveCatalog(
  models: OpenRouterFreeModel[],
): { live: OpenRouterFreeModel[]; stale: OpenRouterFreeModel[] } {
  const dynamicIds = getDynamicModelIds();
  if (!dynamicIds) return { live: models, stale: [] }; // catalog not loaded yet

  const live:  OpenRouterFreeModel[] = [];
  const stale: OpenRouterFreeModel[] = [];
  for (const m of models) {
    if (dynamicIds.has(m.id)) live.push(m);
    else stale.push(m);
  }
  return { live, stale };
}

/**
 * Resolve an ordered fallback chain for a capability + quality intent.
 *
 * Index 0 is the primary (preferred) model. Subsequent entries are tried in
 * order when the primary returns MODEL_NOT_FOUND (STORY-03). The chain always
 * starts with the requested quality tier, then falls back to the other tier.
 *
 * PR-002: models absent from the live OpenRouter catalog are excluded from the
 * returned chain (they are logged in the decision trace as skippedStale).
 *
 * Pure function — no logging. Call resolveModel() when you also want a trace.
 */
export function resolveFallbackChain(opts: ResolveModelOpts): ResolvedModel[] {
  const { capability, quality = "fast", requireTools = false } = opts;
  // Emit resolution trace so stale catalog entries and empty chains are visible.

  // Filter: must support the capability; if tools required, must support them.
  const capable = FREE_MODELS.filter(
    (m) =>
      (m.capabilities as readonly string[]).includes(capability) &&
      (!requireTools || m.supportsTools),
  );

  const rawPool: OpenRouterFreeModel[] =
    capable.length > 0
      ? [...capable]
      : // No exact capability match — degrade to tool-constraint-only filter.
        FREE_MODELS.filter((m) => !requireTools || m.supportsTools).slice() as OpenRouterFreeModel[];

  // PR-002: remove models no longer available on OpenRouter (free tier only).
  const { live: pool } = partitionByLiveCatalog(rawPool);

  // RC-01: only fall back to rawPool when the catalog has NOT been loaded yet.
  // If the catalog IS loaded and filtered everything out, those models have moved
  // to paid — using rawPool would just replay the same "paid version" 404s.
  // Return an empty pool instead; the caller (openrouterCompleteWithFallback or
  // the outer provider chain) will handle it cleanly as "no candidates available".
  const catalogLoaded = isDynamicCatalogLoaded();
  const effectivePool = pool.length > 0
    ? pool
    : catalogLoaded
      ? []      // catalog loaded, all candidates are paid → fail fast
      : rawPool; // catalog not yet loaded → use static list as best-effort

  // Prefer the requested quality tier, then the other tier (stable within each).
  effectivePool.sort((a, b) => {
    const aMatch = a.quality === quality ? 0 : 1;
    const bMatch = b.quality === quality ? 0 : 1;
    return aMatch - bMatch;
  });

  const chain = effectivePool.map((m) => ({ id: m.id, label: m.label, free: true, capability }));

  // Compute stale list for trace.
  const { stale } = partitionByLiveCatalog(rawPool);

  console.info(
    JSON.stringify({
      scope: "model-resolver",
      action: "resolve_fallback_chain",
      capability,
      quality,
      requireTools,
      preferFreeTier: opts.preferFreeTier ?? true,
      catalogLoaded,
      candidates: chain.map((m) => m.id),
      chainLength: chain.length,
      skippedStale: stale.length > 0 ? stale.map((m) => m.id) : undefined,
      poolFallback: pool.length === 0 && !catalogLoaded ? "static_list" : null,
    }),
  );

  return chain;
}

/**
 * Resolve the single best model for a capability + quality (STORY-01, STORY-02).
 * Emits a structured decision trace (STORY-05).
 * Throws only when the catalog is completely empty — never in practice.
 */
export function resolveModel(opts: ResolveModelOpts): ResolvedModel {
  const { capability, quality = "fast", requireTools = false } = opts;

  // Compute stale list for trace (before filtering).
  const rawCapable = FREE_MODELS.filter(
    (m) =>
      (m.capabilities as readonly string[]).includes(capability) &&
      (!requireTools || m.supportsTools),
  );
  const rawPool = rawCapable.length > 0
    ? rawCapable
    : FREE_MODELS.filter((m) => !requireTools || m.supportsTools) as OpenRouterFreeModel[];
  const { stale } = partitionByLiveCatalog([...rawPool]);

  const chain = resolveFallbackChain(opts);
  const first = chain[0];
  if (!first) {
    throw new Error(
      `[model-resolver] No OpenRouter free model satisfies capability="${capability}" requireTools=${requireTools}`,
    );
  }

  emitModelDecisionTrace({
    provider: "openrouter",
    capability,
    quality,
    requireTools,
    preferFreeTier: opts.preferFreeTier ?? true,
    candidates: chain.map((m) => m.id),
    selected: first.id,
    fallbackChain: chain.slice(1).map((m) => m.id),
    skippedStale: stale.length > 0 ? stale.map((m) => m.id) : undefined,
  });

  return first;
}

/**
 * Build an ordered fallback chain starting from an already-resolved model ID.
 *
 * Used by openrouterCompleteWithFallback to determine what to try next when
 * the initial model returns MODEL_NOT_FOUND. The initial model is placed first;
 * then same-quality peers; then the opposite quality tier as last resort.
 *
 * PR-002: models absent from the live catalog are excluded from the chain
 * (except the initial model itself — we let the API confirm it is gone).
 *
 * If the model ID is not in the catalog (e.g. custom/paid), returns [id] with
 * no fallback — the caller retries once then fails cleanly.
 */
export function buildFallbackChainFromId(initialModelId: string): string[] {
  const initial = FREE_MODELS.find((m) => m.id === initialModelId);
  if (!initial) return [initialModelId];

  const quality = initial.quality;

  const sameQualityRaw = FREE_MODELS
    .filter((m) => m.quality === quality && m.id !== initialModelId);
  const otherQualityRaw = FREE_MODELS
    .filter((m) => m.quality !== quality);

  // PR-002 / RC-02: filter peers against dynamic catalog (free-tier only).
  // RC-02: if the catalog IS loaded but filtered a peer group to empty, don't
  // re-insert raw peers — those models have moved to paid and will only
  // generate "paid version available" 404s.  Only fall back to raw when the
  // catalog hasn't loaded yet (best-effort static list on first request).
  const { live: sameLive } = partitionByLiveCatalog(sameQualityRaw);
  const { live: otherLive } = partitionByLiveCatalog(otherQualityRaw);
  const catalogLoaded = isDynamicCatalogLoaded();

  const sameQuality = (sameLive.length > 0 ? sameLive : (catalogLoaded ? [] : sameQualityRaw)).map((m) => m.id);
  const otherQuality = (otherLive.length > 0 ? otherLive : (catalogLoaded ? [] : otherQualityRaw)).map((m) => m.id);

  return [initialModelId, ...sameQuality, ...otherQuality];
}
