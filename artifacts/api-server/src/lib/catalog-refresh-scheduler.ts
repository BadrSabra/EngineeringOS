/**
 * Background OpenRouter Free-Model Catalog Refresh Scheduler
 *
 * OpenRouter's GET /models endpoint is public. This shared maintenance task
 * therefore refreshes anonymously and must never borrow a per-user credential.
 * Authenticated inference paths can still refresh through their own request key.
 *
 * Keeps the dynamic free-tier model catalog warm so the first chat request of
 * any session — even after hours of idle time — never hits a stale model list.
 *
 * Why a server-side scheduler instead of per-request fire-and-forget?
 *   The per-request refresh (10-min TTL, fire-and-forget) only runs when a
 *   user is actively chatting.  If a user leaves the dashboard open overnight,
 *   the next morning's first request still starts from the static catalog
 *   (which may contain models that moved from free→paid while the server was
 *   idle).  A background interval that runs regardless of traffic pre-warms the
 *   catalog continuously.
 *
 * Key resolution order (no userId available here):
 *   1. OPENROUTER_API_KEY environment variable (server-wide key)
 *   2. First OpenRouter key stored in the database (any user's key — all user
 *      keys hit the same public /models endpoint; pricing info is not user-
 *      specific so any valid key suffices for the catalog refresh).
 *   3. If no key is available, the refresh is skipped — the catalog will be
 *      populated when the first authenticated user makes a chat request.
 *
 * Usage:
 *   const { stop } = await startCatalogRefreshScheduler();
 *   process.once('SIGTERM', stop);
 */

import {
  refreshDynamicCatalog,
  auditStaticCatalog,
  isProviderEgressDisabled,
} from "@workspace/ai-orchestrator";
import { FREE_MODELS } from "@workspace/ai-orchestrator";
import { logger } from "./logger.js";

export const CATALOG_REFRESH_INTERVAL_MS = 5 * 60 * 1_000; // 5 minutes

/**
 * Run one anonymous catalog refresh cycle and audit the resulting snapshot.
 * Returns true when the refresh was attempted.
 */
export async function runCatalogRefresh(): Promise<boolean> {
  // Fixture release validation must not resolve credentials (including from
  // the database) or attempt provider traffic.
  if (isProviderEgressDisabled()) {
    logger.debug("catalog-refresh: provider egress disabled — skipping refresh");
    return false;
  }
  try {
    await refreshDynamicCatalog();
    // Audit the static catalog against the freshly-loaded live list and log
    // any stale entries (models that have moved from free→paid).
    const stale = auditStaticCatalog(FREE_MODELS.map((m) => m.id));
    logger.info(
      { staleModelCount: stale.length, staleModels: stale.length > 0 ? stale : undefined },
      "catalog-refresh: OpenRouter free-model catalog refreshed",
    );
    return true;
  } catch (err) {
    // refreshDynamicCatalog never throws itself — this guards the key resolution
    // and audit path.
    logger.warn({ err }, "catalog-refresh: refresh cycle failed — will retry next interval");
    return false;
  }
}

export type CatalogRefreshScheduler = {
  /** Cancel the interval and prevent any further refreshes. */
  stop: () => void;
};

/**
 * Start the periodic background catalog refresh scheduler.
 *
 * Performs an immediate first refresh (so the catalog is warm before traffic
 * arrives), then repeats every `intervalMs` (default 5 min).
 *
 * @param opts.intervalMs   Override the refresh interval (default 5 min). Useful in tests.
 * @returns { stop }        Call stop() on SIGTERM/SIGINT for clean shutdown.
 */
export function startCatalogRefreshScheduler(opts?: {
  intervalMs?: number;
}): CatalogRefreshScheduler {
  const intervalMs = opts?.intervalMs ?? CATALOG_REFRESH_INTERVAL_MS;

  // Immediate first run — fire-and-forget, errors are caught inside runCatalogRefresh.
  void runCatalogRefresh();

  const handle = setInterval(() => {
    void runCatalogRefresh();
  }, intervalMs);

  // Prevent the interval from keeping the Node.js process alive when
  // everything else has shut down (e.g. in tests using fake timers).
  if (typeof handle.unref === "function") handle.unref();

  const stop = () => {
    clearInterval(handle);
    logger.info("catalog-refresh: scheduler stopped");
  };

  logger.info(
    { intervalMs },
    "catalog-refresh: background free-model catalog refresh scheduler started",
  );

  return { stop };
}
