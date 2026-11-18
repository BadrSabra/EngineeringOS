import { LockNamespace, tryAdvisoryLock, type LockAcquired } from "./advisory-lock.js";

/**
 * Keep the combined scan ceiling aligned with the existing per-process
 * heavy-job limit while enforcing it across all API-server instances.
 */
export const GLOBAL_SCAN_CONCURRENCY = 2;

/**
 * Acquires one database-backed slot. Session advisory locks are released if
 * the owning process exits, so durable scan rows remain eligible for dispatch.
 * The optional namespace is a test seam for isolated PostgreSQL lock fixtures.
 */
export async function acquireGlobalScanSlot(
  namespace: number = LockNamespace.SCAN_GLOBAL_SLOT,
): Promise<LockAcquired | undefined> {
  for (let slot = 0; slot < GLOBAL_SCAN_CONCURRENCY; slot += 1) {
    const lock = await tryAdvisoryLock(namespace, `scan-slot-${slot}`);
    if (lock.acquired) return lock;
  }
  return undefined;
}
