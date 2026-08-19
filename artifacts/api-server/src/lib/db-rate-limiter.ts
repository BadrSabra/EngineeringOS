/**
 * PR-02: DB-backed per-project LLM rate limiter.
 *
 * Replaces the process-local sliding-window Map in routes/ai.ts so the limit
 * is enforced correctly across restarts and multiple instances.
 *
 * Strategy: fixed window (1 minute bucket). Each call atomically increments
 * the call count for (project_id, current_bucket) using an INSERT …
 * ON CONFLICT DO UPDATE increment. The returned count is compared against the
 * limit synchronously — no second round-trip needed.
 *
 * Trade-off vs. sliding window: a burst at the end of one bucket + start of
 * the next can briefly exceed 2 × LLM_RATE_LIMIT. In practice, 20 calls/min
 * is already generous and the burst window is only ~2 seconds, so this is an
 * acceptable approximation for a single-instance guard. Upgrade to a Redis
 * sliding window when this becomes a scaling concern.
 */
import { db, rateLimitWindowsTable } from "@workspace/db";
import { lt, sql } from "drizzle-orm";
import { logger } from "./logger.js";
import { incrementRateLimiterFailOpen } from "./operational-counters.js";

/** Maximum LLM calls allowed per project per rate-limit window. */
export const LLM_RATE_LIMIT = 20;

/** Window length in milliseconds (1 minute). */
export const LLM_RATE_WINDOW_MS = 60_000;

/**
 * Check and record one LLM call for `projectId`.
 *
 * Atomically increments the call count for the current window bucket and
 * returns whether the call is allowed. If the limit is exceeded, also returns
 * `retryAfterSec` — the number of seconds until the current window expires.
 */
export async function checkProjectRateLimitDb(
  projectId: string,
): Promise<{ allowed: boolean; retryAfterSec?: number }> {
  const now = Date.now();
  const bucket = Math.floor(now / LLM_RATE_WINDOW_MS);

  try {
    // Atomic upsert: first caller inserts count=1; subsequent callers
    // increment. RETURNING gives us the post-increment count in one trip.
    const [row] = await db
      .insert(rateLimitWindowsTable)
      .values({ projectId, windowBucket: bucket, callCount: 1, updatedAt: new Date() })
      .onConflictDoUpdate({
        target: [rateLimitWindowsTable.projectId, rateLimitWindowsTable.windowBucket],
        set: {
          callCount: sql`${rateLimitWindowsTable.callCount} + 1`,
          updatedAt: new Date(),
        },
      })
      .returning({ callCount: rateLimitWindowsTable.callCount });

    if (!row) {
      // Unexpected — fail open so a DB hiccup doesn't block all AI calls.
      // PR-2: log at ERROR (not warn) and increment the operational counter so
      // GET /api/healthz surfaces this degradation without requiring log search.
      incrementRateLimiterFailOpen();
      logger.error(
        { projectId, bucket },
        "db-rate-limiter: upsert returned no row — rate limit NOT enforced for this call",
      );
      return { allowed: true };
    }

    if (row.callCount > LLM_RATE_LIMIT) {
      const windowEnd = (bucket + 1) * LLM_RATE_WINDOW_MS;
      return {
        allowed: false,
        retryAfterSec: Math.ceil((windowEnd - now) / 1_000),
      };
    }

    return { allowed: true };
  } catch (err) {
    // Fail open on unexpected DB errors — a broken rate limiter should not
    // block legitimate requests.
    // PR-2: log at ERROR and increment the operational counter so healthz
    // surfaces this as a degraded subsystem requiring investigation.
    incrementRateLimiterFailOpen();
    logger.error(
      { err, projectId },
      "db-rate-limiter: unexpected DB error — rate limit NOT enforced for this call",
    );
    return { allowed: true };
  }
}

// ── Periodic cleanup ─────────────────────────────────────────────────────────
// Remove rate-limit rows older than 2 windows. Runs every hour in the
// background — .unref() ensures this timer doesn't prevent clean shutdown.
setInterval(async () => {
  const cutoffBucket = Math.floor(Date.now() / LLM_RATE_WINDOW_MS) - 2;
  try {
    await db
      .delete(rateLimitWindowsTable)
      .where(lt(rateLimitWindowsTable.windowBucket, cutoffBucket));
  } catch {
    // Non-critical background task — swallow errors silently.
  }
}, 60 * 60_000 /* 1 hour */).unref();
