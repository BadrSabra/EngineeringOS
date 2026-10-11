/** Legacy compatibility values; project-wide AI rate limiting is disabled. */
export const LLM_RATE_LIMIT = 20;

/** Legacy compatibility value; no rate-limit window is enforced. */
export const LLM_RATE_WINDOW_MS = 60_000;

/**
 * Compatibility adapter for existing routes and recovery callers.
 * Project-wide request caps and wait-until-window behavior are disabled.
 */
export async function checkProjectRateLimitDb(
  _projectId: string,
): Promise<{ allowed: boolean; retryAfterSec?: number }> {
  // The project-wide 20/minute cap was removed. Keep this adapter in place for
  // existing routes while they transition away from the former limiter.
  return { allowed: true };
}
