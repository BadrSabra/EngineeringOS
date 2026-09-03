/**
 * PR-002 — Dynamic OpenRouter Model Catalog
 *
 * Fetches the live model list from GET /models at startup (and periodically)
 * so the resolver never selects a model that OpenRouter no longer offers.
 *
 * Design:
 *   • Module-level singleton — one fetch per process, shared by all callers.
 *   • TTL of 10 minutes — cheap refresh, tolerates brief outages.
 *   • Never throws to the caller — on fetch failure the previous catalog is
 *     kept (or the static FREE_MODELS list is used as the fallback).
 *   • The loaded set is consumed by resolveFallbackChain() in model-resolver.ts
 *     to filter out stale or discontinued models before returning candidates.
 */

const CATALOG_TTL_MS   = 10 * 60 * 1_000; // 10 minutes
const OPENROUTER_MODELS_URL = "https://openrouter.ai/api/v1/models";
const FETCH_TIMEOUT_MS = 15_000;

type OpenRouterModelEntry = {
  id: string;
  name?: string;
  context_length?: number;
  pricing?: { prompt: string; completion: string };
};

let _availableIds: Set<string> | null = null;
let _lastFetchMs = 0;
let _inFlight: Promise<void> | null = null;
let _refreshAttempted = false;
let _lastRefreshStatus: "never" | "success" | "failed" | "empty" = "never";
let _lastRefreshError: string | null = null;

function classifyRefreshFailure(error: unknown): string {
  if (error instanceof DOMException && error.name === "AbortError") return "timeout";
  if (error instanceof Error && /abort|timeout/i.test(error.message)) return "timeout";
  if (error instanceof Error) {
    const status = error.message.match(/\b(?:status|HTTP)\s*[:=]?\s*(\d{3})\b/i)?.[1];
    if (status) return `http_${status}`;
  }
  return "network_error";
}

/**
 * Whether the dynamic catalog has been loaded at least once.
 * Used by the resolver to decide whether to apply the filter.
 */
export function isDynamicCatalogLoaded(): boolean {
  // Preserve the historical meaning of this telemetry helper: a refresh has
  // been attempted. Routing decisions must use getUsableDynamicModelIds()
  // instead, because failed/expired refreshes are not authoritative.
  return _refreshAttempted;
}

/**
 * Return the last successful set of model IDs. Consumers that make routing
 * decisions must use getUsableDynamicModelIds(), which applies the TTL.
 */
export function getDynamicModelIds(): Set<string> | null {
  return _availableIds;
}

/** IDs from the last successful refresh only when that snapshot is still valid. */
export function getUsableDynamicModelIds(): Set<string> | null {
  if (!_availableIds || Date.now() - _lastFetchMs >= CATALOG_TTL_MS) return null;
  return _availableIds;
}

export type DynamicCatalogStatus = {
  loaded: boolean;
  usable: boolean;
  ageMs: number | null;
  lastRefreshStatus: "never" | "success" | "failed" | "empty";
  lastRefreshError: string | null;
};

export function getDynamicCatalogStatus(): DynamicCatalogStatus {
  const ageMs = _lastFetchMs > 0 ? Math.max(0, Date.now() - _lastFetchMs) : null;
  return {
    loaded: _refreshAttempted,
    usable: getUsableDynamicModelIds() !== null,
    ageMs,
    lastRefreshStatus: _lastRefreshStatus,
    lastRefreshError: _lastRefreshError,
  };
}

/**
 * Fetch the live model list from OpenRouter and update the singleton.
 * Safe to call concurrently — only one HTTP request runs at a time.
 * Never throws; logs a warning on failure.
 *
 * @param apiKey  OpenRouter API key (Bearer). Optional; some endpoints allow
 *                unauthenticated access to GET /models.
 */
export async function refreshDynamicCatalog(apiKey?: string): Promise<void> {
  const now = Date.now();
  if (now - _lastFetchMs < CATALOG_TTL_MS && _availableIds !== null) return;

  // Deduplicate concurrent calls — only one fetch in flight at a time.
  if (_inFlight) return _inFlight;

  _inFlight = (async () => {
    _refreshAttempted = true;
    _lastRefreshStatus = "failed";
    _lastRefreshError = null;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
    try {
      const headers: Record<string, string> = {
        "Content-Type": "application/json",
      };
      if (apiKey) headers["Authorization"] = `Bearer ${apiKey}`;

      const res = await fetch(OPENROUTER_MODELS_URL, {
        headers,
        signal: controller.signal,
      });

      if (!res.ok) {
        _lastRefreshError = `http_${res.status}`;
        console.warn(
          JSON.stringify({
            scope: "dynamic-catalog",
            code: "FETCH_FAILED",
            status: res.status,
            hint: "OpenRouter /models returned non-200 — keeping previous catalog",
          }),
        );
        return;
      }

      const data = (await res.json()) as { data?: OpenRouterModelEntry[] };
      const models = data?.data ?? [];

      if (models.length === 0) {
        _lastRefreshStatus = "empty";
        _lastRefreshError = "empty_response";
        console.warn(
          JSON.stringify({
            scope: "dynamic-catalog",
            code: "EMPTY_RESPONSE",
            hint: "OpenRouter /models returned 0 models — keeping previous catalog",
          }),
        );
        return;
      }

      // PR-01 (root-cause fix): only keep models that are CURRENTLY FREE.
      // A model is free when both prompt and completion pricing are "0".
      // Without this filter we collected ALL model IDs (including paid ones),
      // so models that moved from free → paid still passed the live-catalog
      // check and were tried — causing chains of 404 "paid version available"
      // errors until every model was exhausted.
      const freeModels = models.filter(
        (m) => m.pricing?.prompt === "0" && m.pricing?.completion === "0",
      );

      const ids = new Set(freeModels.map((m) => m.id));

      if (ids.size === 0) {
        _lastRefreshStatus = "empty";
        _lastRefreshError = "no_free_models";
        // OpenRouter occasionally returns no free models (e.g. API auth issue
        // or a temporary catalog gap) — keep previous catalog in that case.
        console.warn(
          JSON.stringify({
            scope: "dynamic-catalog",
            code: "NO_FREE_MODELS",
            totalModels: models.length,
            hint: "OpenRouter returned no free-priced models — keeping previous catalog",
          }),
        );
        return;
      }

      _availableIds = ids;
      _lastFetchMs  = Date.now();
      _lastRefreshStatus = "success";
      _lastRefreshError = null;

      console.info(
        JSON.stringify({
          scope: "dynamic-catalog",
          code: "REFRESHED",
          freeModelCount: ids.size,
          totalModelCount: models.length,
        }),
      );
    } catch (err) {
      const failureCode = classifyRefreshFailure(err);
      _lastRefreshStatus = "failed";
      _lastRefreshError = failureCode;
      console.warn(
        JSON.stringify({
          scope: "dynamic-catalog",
          code: "FETCH_ERROR",
          failureCode,
          hint: "Keeping previous catalog",
        }),
      );
    } finally {
      clearTimeout(timer);
      _inFlight = null;
    }
  })();

  return _inFlight;
}

/**
 * PR-006 / PR-002 helper: validate static FREE_MODELS against the dynamic
 * catalog and log any that are no longer available.
 * Returns model IDs that are in FREE_MODELS but missing from OpenRouter.
 */
export function auditStaticCatalog(staticModelIds: readonly string[]): string[] {
  if (!_availableIds) return [];
  const stale = staticModelIds.filter((id) => !_availableIds!.has(id));
  if (stale.length > 0) {
    console.warn(
      JSON.stringify({
        scope: "dynamic-catalog",
        code: "STALE_MODELS_DETECTED",
        staleModels: stale,
        hint:
          "These models are in model-catalog.ts but no longer listed on OpenRouter. " +
          "They will be skipped during resolution and fallback will proceed automatically.",
      }),
    );
  }
  return stale;
}

/** Force-reset state (test helper only). */
export function _resetForTest(): void {
  _availableIds = null;
  _lastFetchMs  = 0;
  _inFlight     = null;
  _refreshAttempted = false;
  _lastRefreshStatus = "never";
  _lastRefreshError = null;
}
