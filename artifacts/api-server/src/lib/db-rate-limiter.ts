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
      logger.warn({ projectId, bucket }, "db-rate-limiter: upsert returned no row — failing open");
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
    logger.warn({ err, projectId }, "db-rate-limiter: unexpected error — failing open");
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
