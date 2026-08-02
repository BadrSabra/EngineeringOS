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
 * Fallback discipline (STORY-03):
 *   The chain is ordered so the preferred quality tier comes first, followed
 *   by the same tier's alternatives, then the other tier as last-resort.
 *   openrouterCompleteWithFallback() in openai-compatible-client.ts consumes
 *   the chain — a MODEL_NOT_FOUND (404) on model[i] advances to model[i+1]
 *   before giving up.
 */
import { FREE_MODELS, type ModelCapability, type OpenRouterFreeModel } from "./model-catalog.js";

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
};

/** Emit a model-decision trace to stdout as a JSON log line. */
export function emitModelDecisionTrace(trace: ModelDecisionTrace): void {
  console.info(JSON.stringify({ scope: "model-resolver", ...trace }));
}

/**
 * Resolve an ordered fallback chain for a capability + quality intent.
 *
 * Index 0 is the primary (preferred) model. Subsequent entries are tried in
 * order when the primary returns MODEL_NOT_FOUND (STORY-03). The chain always
 * starts with the requested quality tier, then falls back to the other tier.
 *
 * Pure function — no logging. Call resolveModel() when you also want a trace.
 */
export function resolveFallbackChain(opts: ResolveModelOpts): ResolvedModel[] {
  const { capability, quality = "fast", requireTools = false } = opts;

  // Filter: must support the capability; if tools required, must support them.
  const capable = FREE_MODELS.filter(
    (m) =>
      (m.capabilities as readonly string[]).includes(capability) &&
      (!requireTools || m.supportsTools),
  );

  const pool: OpenRouterFreeModel[] =
    capable.length > 0
      ? [...capable]
      : // No exact capability match — degrade to tool-constraint-only filter.
        FREE_MODELS.filter((m) => !requireTools || m.supportsTools).slice() as OpenRouterFreeModel[];

  // Prefer the requested quality tier, then the other tier (stable within each).
  pool.sort((a, b) => {
    const aMatch = a.quality === quality ? 0 : 1;
    const bMatch = b.quality === quality ? 0 : 1;
    return aMatch - bMatch;
  });

  return pool.map((m) => ({ id: m.id, label: m.label, free: true, capability }));
}

/**
 * Resolve the single best model for a capability + quality (STORY-01, STORY-02).
 * Emits a structured decision trace (STORY-05).
 * Throws only when the catalog is completely empty — never in practice.
 */
export function resolveModel(opts: ResolveModelOpts): ResolvedModel {
  const chain = resolveFallbackChain(opts);
  const first = chain[0];
  if (!first) {
    throw new Error(
      `[model-resolver] No OpenRouter free model satisfies capability="${opts.capability}" requireTools=${opts.requireTools ?? false}`,
    );
  }

  emitModelDecisionTrace({
    provider: "openrouter",
    capability: opts.capability,
    quality: opts.quality ?? "fast",
    requireTools: opts.requireTools ?? false,
    preferFreeTier: opts.preferFreeTier ?? true,
    candidates: chain.map((m) => m.id),
    selected: first.id,
    fallbackChain: chain.slice(1).map((m) => m.id),
  });

  return first;
}

/**
 * Build an ordered fallback chain starting from an already-resolved model ID.
 *
 * Used by openrouterCompleteWithFallback to determine what to try next when
 * the initial model returns MODEL_NOT_FOUND. The initial model is placed first;
 * then same-quality peers; then the opposite quality tier as last resort.
 * If the model ID is not in the catalog (e.g. custom/paid), returns [id] with
 * no fallback — the caller retries once then fails cleanly.
 */
export function buildFallbackChainFromId(initialModelId: string): string[] {
  const initial = FREE_MODELS.find((m) => m.id === initialModelId);
  if (!initial) return [initialModelId];

  const quality = initial.quality;
  const sameQuality = FREE_MODELS
    .filter((m) => m.quality === quality && m.id !== initialModelId)
    .map((m) => m.id);
  const otherQuality = FREE_MODELS
    .filter((m) => m.quality !== quality)
    .map((m) => m.id);

  return [initialModelId, ...sameQuality, ...otherQuality];
}
