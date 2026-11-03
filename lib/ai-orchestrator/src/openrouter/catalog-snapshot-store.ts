import type { OpenRouterPaidModel } from "./model-catalog.js";

export type OpenRouterCatalogSnapshotModel = {
  id: string;
  supportsJsonObject: boolean | null;
  supportsJsonSchema: boolean | null;
};

/** Normalized, non-secret data needed by free-model routing. */
export type OpenRouterCatalogSnapshot = {
  version: 1;
  freeModels: OpenRouterCatalogSnapshotModel[];
  paidModels: OpenRouterPaidModel[];
  paidPolicyFingerprint: string;
};

export type OpenRouterCatalogStoredState = {
  snapshot: OpenRouterCatalogSnapshot | null;
  refreshedAtMs: number | null;
  expiresAtMs: number | null;
  failureBackoffUntilMs: number | null;
  lastFailureCode: string | null;
};

export type OpenRouterCatalogRefreshLease = {
  commitSnapshot(
    snapshot: OpenRouterCatalogSnapshot,
    ttlMs: number,
  ): Promise<OpenRouterCatalogStoredState>;
  recordFailure(failureCode: string, backoffMs: number): Promise<void>;
  release(): Promise<void>;
};

/**
 * Cross-process catalog coordination. Implementations must ensure an expired
 * or malformed snapshot is never represented as current, and lease writes are
 * fenced by their lease token.
 */
export type OpenRouterCatalogPersistence = {
  read(): Promise<OpenRouterCatalogStoredState | null>;
  acquireRefreshLease(
    maxWaitMs: number,
    leaseDurationMs: number,
  ): Promise<OpenRouterCatalogRefreshLease | undefined>;
};
