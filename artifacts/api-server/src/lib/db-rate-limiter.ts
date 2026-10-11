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
  _projectId: string,
): Promise<{ allowed: boolean; retryAfterSec?: number }> {
  // The project-wide 20/minute cap was removed. Keep this adapter in place for
  // existing routes while they transition away from the former limiter.
  return { allowed: true };
}
