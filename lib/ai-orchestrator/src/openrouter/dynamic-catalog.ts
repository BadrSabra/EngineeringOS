/**
 * PR-002 — Dynamic OpenRouter Model Catalog
 *
 * Fetches the live model list from GET /models at startup (and periodically)
 * so the resolver never selects a model that OpenRouter no longer offers.
 *
 * Design:
 *   • Module-level singleton — one fetch per process, shared by all callers.
 *   • TTL of 10 minutes and a bounded refresh timeout.
 *   • Provider failures retain the last snapshot for diagnostics, but inference
 *     admission separately requires a fresh live zero-price entry.
 *   • The loaded set is consumed by the resolver for candidate filtering and
 *     by the inference send boundary for current zero-price admission.
 */
import type { ModelCapability, OpenRouterPaidModel } from "./model-catalog.js";
import { isProviderEgressDisabled } from "../provider-egress.js";
import type {
  OpenRouterCatalogPersistence,
  OpenRouterCatalogSnapshot,
  OpenRouterCatalogSnapshotModel,
} from "./catalog-snapshot-store.js";
export type {
  OpenRouterCatalogPersistence,
  OpenRouterCatalogSnapshot,
  OpenRouterCatalogStoredState,
  OpenRouterCatalogRefreshLease,
} from "./catalog-snapshot-store.js";

const CATALOG_TTL_MS   = 10 * 60 * 1_000; // 10 minutes
const CATALOG_REFRESH_TIMEOUT_MS = 5_000;
const CATALOG_REFRESH_FAILURE_BACKOFF_MS = 15_000;
const OPENROUTER_MODELS_URL = "https://openrouter.ai/api/v1/models";

type OpenRouterModelEntry = {
  id: string;
  name?: string;
  context_length?: number;
  pricing?: { prompt: string; completion: string };
  supported_parameters?: unknown;
};

export type DynamicModelFormatSupport = {
  /** null means OpenRouter did not provide supported_parameters for this model. */
  supportsJsonObject: boolean | null;
  supportsJsonSchema: boolean | null;
};

let _availableIds: Set<string> | null = null;
let _availablePaidModels: OpenRouterPaidModel[] | null = null;
let _modelFormatSupport: Map<string, DynamicModelFormatSupport> | null = null;
let _lastFetchMs = 0;
let _snapshotExpiresAtMs = 0;
let _nextRefreshAt = 0;
let _inFlight: Promise<void> | null = null;
let _refreshAttempted = false;
let _lastRefreshStatus: "never" | "success" | "failed" | "empty" = "never";
let _paidPolicyFingerprint: string | null = null;
let _lastRefreshError: string | null = null;
let _catalogPersistence: OpenRouterCatalogPersistence | null = null;

const SAFE_MODEL_ID = /^[a-z0-9][a-z0-9._:/-]{0,199}$/i;
const ALL_CAPABILITIES: readonly ModelCapability[] = [
  "chat",
  "coding",
  "tool_calling",
  "reasoning",
  "json",
  "long_context",
];
const CATALOG_REFRESH_LEASE_WAIT_MS = 1_500;
const CATALOG_REFRESH_LEASE_DURATION_MS = 20_000;

/** Install the shared catalog store before the API begins accepting traffic. */
export function configureOpenRouterCatalogPersistence(
  persistence: OpenRouterCatalogPersistence,
): void {
  _catalogPersistence = persistence;
}

function isSnapshotModel(value: unknown): value is OpenRouterCatalogSnapshotModel {
  if (!value || typeof value !== "object") return false;
  const model = value as Partial<OpenRouterCatalogSnapshotModel>;
  return SAFE_MODEL_ID.test(model.id ?? "")
    && (model.supportsJsonObject === null || typeof model.supportsJsonObject === "boolean")
    && (model.supportsJsonSchema === null || typeof model.supportsJsonSchema === "boolean");
}

function isPaidModel(value: unknown): value is OpenRouterPaidModel {
  if (!value || typeof value !== "object") return false;
  const model = value as Partial<OpenRouterPaidModel>;
  return SAFE_MODEL_ID.test(model.id ?? "")
    && typeof model.label === "string"
    && model.label.length <= 300
    && Array.isArray(model.capabilities)
    && model.capabilities.every((capability) => ALL_CAPABILITIES.includes(capability))
    && Number.isSafeInteger(model.context)
    && (model.context ?? -1) >= 0
    && typeof model.supportsTools === "boolean"
    && typeof model.supportsJson === "boolean"
    && typeof model.supportsStreaming === "boolean"
    && model.free === false
    && (model.quality === "fast" || model.quality === "powerful");
}

function isCatalogSnapshot(value: unknown): value is OpenRouterCatalogSnapshot {
  if (!value || typeof value !== "object") return false;
  const snapshot = value as Partial<OpenRouterCatalogSnapshot>;
  return snapshot.version === 1
    && Array.isArray(snapshot.freeModels)
    && snapshot.freeModels.length > 0
    && snapshot.freeModels.length <= 10_000
    && snapshot.freeModels.every(isSnapshotModel)
    && new Set(snapshot.freeModels.map((model) => model.id)).size === snapshot.freeModels.length
    && Array.isArray(snapshot.paidModels)
    && snapshot.paidModels.length <= 1
    && snapshot.paidModels.every(isPaidModel)
    && typeof snapshot.paidPolicyFingerprint === "string"
    && snapshot.paidPolicyFingerprint.length <= 1_000;
}

function applySnapshot(
  snapshot: OpenRouterCatalogSnapshot,
  fetchedAtMs: number,
  expiresAtMs: number,
): void {
  _availableIds = new Set(snapshot.freeModels.map((model) => model.id));
  _modelFormatSupport = new Map(snapshot.freeModels.map((model) => [
    model.id,
    {
      supportsJsonObject: model.supportsJsonObject,
      supportsJsonSchema: model.supportsJsonSchema,
    },
  ]));
  _availablePaidModels = snapshot.paidPolicyFingerprint === paidPolicyFingerprint()
    ? [...snapshot.paidModels]
    : [];
  _paidPolicyFingerprint = paidPolicyFingerprint();
  _lastFetchMs = fetchedAtMs;
  _snapshotExpiresAtMs = expiresAtMs;
  _refreshAttempted = true;
  _lastRefreshStatus = "success";
  _lastRefreshError = null;
  _nextRefreshAt = 0;
}

function configuredPaidModelId(): string | undefined {
  if (process.env.OPENROUTER_ALLOW_PAID_FALLBACK !== "1") return undefined;
  const model = process.env.OPENROUTER_PAID_MODEL?.trim();
  return model && SAFE_MODEL_ID.test(model) ? model : undefined;
}

function configuredPaidCapabilities(): Set<ModelCapability> {
  return new Set(
    (process.env.OPENROUTER_PAID_MODEL_CAPABILITIES ?? "chat")
      .split(",")
      .map((value) => value.trim() as ModelCapability)
      .filter((value): value is ModelCapability => ALL_CAPABILITIES.includes(value)),
  );
}

function paidPolicyFingerprint(): string {
  return [
    process.env.OPENROUTER_ALLOW_PAID_FALLBACK === "1" ? "enabled" : "disabled",
    process.env.OPENROUTER_PAID_MODEL?.trim() ?? "",
    process.env.OPENROUTER_PAID_MODEL_CAPABILITIES?.trim() ?? "chat",
  ].join("|");
}

function supportsParameter(entry: OpenRouterModelEntry, names: readonly string[]): boolean {
  const supported = Array.isArray(entry.supported_parameters)
    ? entry.supported_parameters.filter((value): value is string => typeof value === "string")
    : [];
  return names.some((name) => supported.includes(name));
}

function buildPaidCandidate(entry: OpenRouterModelEntry): OpenRouterPaidModel | null {
  const configuredId = configuredPaidModelId();
  if (!configuredId || entry.id !== configuredId) return null;
  if (entry.pricing?.prompt === "0" && entry.pricing?.completion === "0") return null;

  const configuredCapabilities = configuredPaidCapabilities();
  const supportsTools = supportsParameter(entry, ["tools", "tool_choice", "parallel_tool_calls"]);
  const supportsJson = supportsParameter(entry, ["response_format", "structured_outputs"]);
  const capabilities = new Set<ModelCapability>(["chat"]);
  for (const capability of configuredCapabilities) capabilities.add(capability);
  if (!supportsTools) capabilities.delete("tool_calling");
  if (!supportsJson) capabilities.delete("json");

  return {
    id: entry.id,
    label: entry.name?.trim() || entry.id,
    capabilities: [...capabilities],
    context: typeof entry.context_length === "number" ? entry.context_length : 0,
    supportsTools,
    supportsJson,
    supportsStreaming: true,
    free: false,
    quality: configuredCapabilities.has("reasoning") || configuredCapabilities.has("long_context")
      ? "powerful"
      : "fast",
  };
}

function classifyRefreshFailure(error: unknown): string {
  if (error instanceof DOMException && error.name === "AbortError") return "timeout";
  if (
    error instanceof Error &&
    (error.name === "TimeoutError" || /abort|time[\s_-]?out/i.test(error.message))
  ) return "timeout";
  if (error instanceof Error) {
    if (/shared catalog store|catalog refresh lease/i.test(error.message)) {
      return "shared_store_unavailable";
    }
    const status = error.message.match(/\b(?:status|HTTP)\s*[:=]?\s*(\d{3})\b/i)?.[1];
    if (status) return `http_${status}`;
  }
  return "network_error";
}

function callerAbortError(signal: AbortSignal): Error {
  if (signal.reason instanceof Error) return signal.reason;
  const error = new Error("OpenRouter catalog refresh wait was aborted");
  error.name = "AbortError";
  return error;
}

/**
 * Stop one caller waiting without cancelling the shared catalog request used
 * by other callers. The shared request has its own bounded timeout.
 */
function waitForRefreshOrCallerAbort(
  refresh: Promise<void>,
  signal?: AbortSignal,
): Promise<void> {
  if (!signal) return refresh;
  if (signal.aborted) return Promise.reject(callerAbortError(signal));

  return new Promise<void>((resolve, reject) => {
    let settled = false;
    const cleanup = () => signal.removeEventListener("abort", onAbort);
    const onAbort = () => {
      if (settled) return;
      settled = true;
      cleanup();
      reject(callerAbortError(signal));
    };
    signal.addEventListener("abort", onAbort, { once: true });
    if (signal.aborted) {
      onAbort();
      return;
    }
    void refresh.then(
      () => {
        if (settled) return;
        settled = true;
        cleanup();
        resolve();
      },
      (error) => {
        if (settled) return;
        settled = true;
        cleanup();
        reject(error);
      },
    );
  });
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
  if (
    !_availableIds ||
    Date.now() - _lastFetchMs >= CATALOG_TTL_MS ||
    Date.now() >= _snapshotExpiresAtMs
  ) return null;
  return _availableIds;
}

/** Live JSON-object support for a model in the current free-model snapshot. */
export function getUsableDynamicModelFormatSupport(id: string): DynamicModelFormatSupport | null {
  if (!getUsableDynamicModelIds() || !_modelFormatSupport) return null;
  return _modelFormatSupport.get(id) ?? null;
}

/** Configured paid candidates from the last successful live catalog refresh. */
export function getUsablePaidModelCandidates(): OpenRouterPaidModel[] {
  if (
    !_availablePaidModels ||
    !_availableIds ||
    _paidPolicyFingerprint !== paidPolicyFingerprint() ||
    Date.now() - _lastFetchMs >= CATALOG_TTL_MS ||
    Date.now() >= _snapshotExpiresAtMs
  ) {
    return [];
  }
  return [..._availablePaidModels];
}

export type DynamicCatalogStatus = {
  loaded: boolean;
  usable: boolean;
  ageMs: number | null;
  lastRefreshStatus: "never" | "success" | "failed" | "empty";
  lastRefreshError: string | null;
  paidModelCount: number;
};

export function getDynamicCatalogStatus(): DynamicCatalogStatus {
  const ageMs = _lastFetchMs > 0 ? Math.max(0, Date.now() - _lastFetchMs) : null;
  return {
    loaded: _refreshAttempted,
    usable: getUsableDynamicModelIds() !== null,
    ageMs,
    lastRefreshStatus: _lastRefreshStatus,
    lastRefreshError: _lastRefreshError,
    paidModelCount: getUsablePaidModelCandidates().length,
  };
}

function buildSnapshot(models: OpenRouterModelEntry[]): OpenRouterCatalogSnapshot {
  const freeModels = models
    .filter((model) =>
      SAFE_MODEL_ID.test(model.id) &&
      model.pricing?.prompt === "0" &&
      model.pricing?.completion === "0"
    )
    .map((model) => {
      const supportedParameters = Array.isArray(model.supported_parameters)
        ? model.supported_parameters.filter((value): value is string => typeof value === "string")
        : null;
      return {
        id: model.id,
        supportsJsonObject: supportedParameters?.includes("response_format") ?? null,
        supportsJsonSchema: supportedParameters?.includes("structured_outputs") ?? null,
      };
    });

  return {
    version: 1,
    freeModels,
    paidModels: models
      .map(buildPaidCandidate)
      .filter((model): model is OpenRouterPaidModel => Boolean(model)),
    paidPolicyFingerprint: paidPolicyFingerprint(),
  };
}

function applyPersistedState(
  state: {
    snapshot: OpenRouterCatalogSnapshot | null;
    refreshedAtMs: number | null;
    expiresAtMs: number | null;
    failureBackoffUntilMs: number | null;
    lastFailureCode: string | null;
  } | null,
): "fresh" | "backoff" | "missing" {
  const now = Date.now();
  if (
    state?.snapshot &&
    isCatalogSnapshot(state.snapshot) &&
    state.refreshedAtMs !== null &&
    state.expiresAtMs !== null &&
    state.expiresAtMs > now &&
    state.refreshedAtMs <= now + 60_000 &&
    state.expiresAtMs - state.refreshedAtMs <= CATALOG_TTL_MS + 60_000
  ) {
    applySnapshot(state.snapshot, state.refreshedAtMs, state.expiresAtMs);
    return "fresh";
  }
  if (state?.failureBackoffUntilMs && state.failureBackoffUntilMs > now) {
    _refreshAttempted = true;
    _lastRefreshStatus = "failed";
    _lastRefreshError = state.lastFailureCode ?? "provider_failure";
    _nextRefreshAt = state.failureBackoffUntilMs;
    return "backoff";
  }
  return "missing";
}

type CatalogFetchOutcome =
  | {
      kind: "snapshot";
      snapshot: OpenRouterCatalogSnapshot;
      totalModelCount: number;
    }
  | { kind: "http_error"; status: number }
  | { kind: "empty_response" }
  | { kind: "no_free_models"; totalModels: number };

async function fetchCatalogSnapshot(apiKey?: string): Promise<CatalogFetchOutcome> {
  const controller = new AbortController();
  let timeoutHandle: ReturnType<typeof setTimeout> | undefined;
  try {
    const headers: Record<string, string> = { "Content-Type": "application/json" };
    if (apiKey) headers["Authorization"] = `Bearer ${apiKey}`;
    const fetchAndParse = async (): Promise<
      | { kind: "http_error"; status: number }
      | { kind: "models"; models: OpenRouterModelEntry[] }
    > => {
      const res = await fetch(OPENROUTER_MODELS_URL, {
        headers,
        signal: controller.signal,
      });
      if (!res.ok) return { kind: "http_error", status: res.status };
      const data = (await res.json()) as { data?: OpenRouterModelEntry[] };
      return {
        kind: "models",
        models: Array.isArray(data?.data) ? data.data : [],
      };
    };
    const timeout = new Promise<never>((_resolve, reject) => {
      timeoutHandle = setTimeout(() => {
        const error = new Error("OpenRouter model catalog refresh timed out");
        error.name = "TimeoutError";
        controller.abort(error);
        reject(error);
      }, CATALOG_REFRESH_TIMEOUT_MS);
    });
    const result = await Promise.race([fetchAndParse(), timeout]);
    if (result.kind === "http_error") return result;
    if (result.models.length === 0) return { kind: "empty_response" };
    const snapshot = buildSnapshot(result.models);
    if (snapshot.freeModels.length === 0) {
      return { kind: "no_free_models", totalModels: result.models.length };
    }
    return {
      kind: "snapshot",
      snapshot,
      totalModelCount: result.models.length,
    };
  } finally {
    if (timeoutHandle) clearTimeout(timeoutHandle);
  }
}

/**
 * Fetch the live model list from OpenRouter and update the singleton.
 * Safe to call concurrently — only one HTTP request runs at a time.
 * Provider failures are logged and absorbed; caller cancellation rejects only
 * that caller's wait and does not cancel the shared refresh.
 *
 * @param apiKey  OpenRouter API key (Bearer). Optional; some endpoints allow
 *                unauthenticated access to GET /models.
 * @param signal  Optional caller signal. It does not own the shared fetch.
 */
export async function refreshDynamicCatalog(
  apiKey?: string,
  signal?: AbortSignal,
): Promise<void> {
  if (signal?.aborted) throw callerAbortError(signal);
  if (isProviderEgressDisabled()) return;
  if (getUsableDynamicModelIds() !== null) return;

  // Deduplicate concurrent calls — only one fetch in flight at a time.
  if (_inFlight) return waitForRefreshOrCallerAbort(_inFlight, signal);

  _inFlight = (async () => {
    _refreshAttempted = true;
    _lastRefreshStatus = "failed";
    _lastRefreshError = null;
    let refreshSucceeded = false;
    let lease: Awaited<ReturnType<OpenRouterCatalogPersistence["acquireRefreshLease"]>>;
    const persistence = _catalogPersistence;

    const readSharedState = async () => {
      if (!persistence) return "missing" as const;
      try {
        return applyPersistedState(await persistence.read());
      } catch {
        throw new Error("shared catalog store read unavailable");
      }
    };

    const recordFailure = async (failureCode: string) => {
      _lastRefreshStatus = failureCode === "empty_response" || failureCode === "no_free_models"
        ? "empty"
        : "failed";
      _lastRefreshError = failureCode;
      if (lease) {
        try {
          await lease.recordFailure(failureCode, CATALOG_REFRESH_FAILURE_BACKOFF_MS);
        } catch {
          console.warn(JSON.stringify({
            scope: "dynamic-catalog",
            code: "SHARED_BACKOFF_WRITE_FAILED",
          }));
        }
      }
    };

    try {
      if (persistence) {
        const state = await readSharedState();
        if (state === "fresh" || state === "backoff") {
          refreshSucceeded = state === "fresh";
          return;
        }
        if (Date.now() < _nextRefreshAt) return;

        try {
          lease = await persistence.acquireRefreshLease(
            CATALOG_REFRESH_LEASE_WAIT_MS,
            CATALOG_REFRESH_LEASE_DURATION_MS,
          );
        } catch {
          throw new Error("catalog refresh lease unavailable");
        }
        if (!lease) {
          const afterWait = await readSharedState();
          if (afterWait === "fresh" || afterWait === "backoff") {
            refreshSucceeded = afterWait === "fresh";
            return;
          }
          throw new Error("catalog refresh lease busy");
        }

        const stateAfterLease = await readSharedState();
        if (stateAfterLease === "fresh" || stateAfterLease === "backoff") {
          refreshSucceeded = stateAfterLease === "fresh";
          return;
        }
      } else if (Date.now() < _nextRefreshAt) {
        return;
      }

      const result = await fetchCatalogSnapshot(apiKey);
      if (result.kind === "http_error") {
        await recordFailure(`http_${result.status}`);
        console.warn(JSON.stringify({
          scope: "dynamic-catalog",
          code: "FETCH_FAILED",
          status: result.status,
          hint: "OpenRouter /models returned non-200 — keeping previous catalog",
        }));
        return;
      }
      if (result.kind === "empty_response") {
        await recordFailure("empty_response");
        console.warn(JSON.stringify({
          scope: "dynamic-catalog",
          code: "EMPTY_RESPONSE",
          hint: "OpenRouter /models returned 0 models — keeping previous catalog",
        }));
        return;
      }
      if (result.kind === "no_free_models") {
        await recordFailure("no_free_models");
        console.warn(JSON.stringify({
          scope: "dynamic-catalog",
          code: "NO_FREE_MODELS",
          totalModels: result.totalModels,
          hint: "OpenRouter returned no free-priced models — keeping previous catalog",
        }));
        return;
      }

      if (lease) {
        let storedState;
        try {
          storedState = await lease.commitSnapshot(result.snapshot, CATALOG_TTL_MS);
        } catch {
          throw new Error("shared catalog store snapshot write unavailable");
        }
        if (applyPersistedState(storedState) !== "fresh") {
          throw new Error("shared catalog store returned an invalid snapshot");
        }
        refreshSucceeded = true;
      } else {
        const fetchedAtMs = Date.now();
        applySnapshot(result.snapshot, fetchedAtMs, fetchedAtMs + CATALOG_TTL_MS);
        refreshSucceeded = true;
      }

      console.info(JSON.stringify({
        scope: "dynamic-catalog",
        code: "REFRESHED",
        freeModelCount: result.snapshot.freeModels.length,
        paidModelCount: result.snapshot.paidModels.length,
        totalModelCount: result.totalModelCount,
        shared: Boolean(lease),
      }));
    } catch (err) {
      const failureCode = classifyRefreshFailure(err);
      await recordFailure(failureCode);
      console.warn(JSON.stringify({
        scope: "dynamic-catalog",
        code: "FETCH_ERROR",
        failureCode,
        hint: "Catalog admission remains fail-closed until a fresh shared snapshot is available",
      }));
    } finally {
      if (lease) {
        try {
          await lease.release();
        } catch {
          console.warn(JSON.stringify({
            scope: "dynamic-catalog",
            code: "SHARED_REFRESH_LEASE_RELEASE_FAILED",
          }));
        }
      }
      if (refreshSucceeded) {
        _nextRefreshAt = 0;
      } else if (_nextRefreshAt <= Date.now()) {
        _nextRefreshAt = Date.now() + CATALOG_REFRESH_FAILURE_BACKOFF_MS;
      }
      _inFlight = null;
    }
  })();

  return waitForRefreshOrCallerAbort(_inFlight, signal);
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
  _availablePaidModels = null;
  _modelFormatSupport = null;
  _paidPolicyFingerprint = null;
  _lastFetchMs  = 0;
  _snapshotExpiresAtMs = 0;
  _nextRefreshAt = 0;
  _inFlight     = null;
  _refreshAttempted = false;
  _lastRefreshStatus = "never";
  _lastRefreshError = null;
  _catalogPersistence = null;
}

/** Seed an explicit live-price snapshot for deterministic unit tests only. */
export function _setSnapshotForTest(modelIds: readonly string[]): void {
  _availableIds = new Set(modelIds);
  _availablePaidModels = [];
  _modelFormatSupport = new Map(
    modelIds.map((id) => [
      id,
      { supportsJsonObject: null, supportsJsonSchema: null },
    ]),
  );
  _paidPolicyFingerprint = paidPolicyFingerprint();
  _lastFetchMs = Date.now();
  _snapshotExpiresAtMs = _lastFetchMs + CATALOG_TTL_MS;
  _nextRefreshAt = 0;
  _inFlight = null;
  _refreshAttempted = true;
  _lastRefreshStatus = "success";
  _lastRefreshError = null;
}
