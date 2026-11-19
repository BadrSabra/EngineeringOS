import { sql } from "drizzle-orm";
import { db } from "@workspace/db";

function normalizeRetryDelay(retryAfterMs: unknown): number | undefined {
  if (typeof retryAfterMs !== "number" || !Number.isFinite(retryAfterMs) || retryAfterMs <= 0) {
    return undefined;
  }
  const normalized = Math.ceil(retryAfterMs);
  return Number.isSafeInteger(normalized) ? normalized : undefined;
}

/**
 * Build a durable retry deadline from an explicitly supplied database-clock
 * instant. This pure boundary keeps date arithmetic deterministic in tests.
 */
export function retryDeadlineFromDatabaseTime(
  databaseNow: Date,
  retryAfterMs: unknown,
): string | undefined {
  const delayMs = normalizeRetryDelay(retryAfterMs);
  const databaseNowMs = databaseNow instanceof Date ? databaseNow.getTime() : Number.NaN;
  if (delayMs === undefined || !Number.isFinite(databaseNowMs)) return undefined;

  const deadlineMs = databaseNowMs + delayMs;
  if (!Number.isFinite(deadlineMs) || Math.abs(deadlineMs) > 8.64e15) return undefined;
  return new Date(deadlineMs).toISOString();
}

/**
 * Derive a retry deadline using PostgreSQL's clock so API-host clock skew
 * cannot shorten or extend a provider cooldown before it is persisted.
 */
export async function resolveRetryDeadlineFromDatabaseClock(
  retryAfterMs: unknown,
): Promise<string | undefined> {
  const delayMs = normalizeRetryDelay(retryAfterMs);
  if (delayMs === undefined) return undefined;

  const result = await db.execute(sql`SELECT clock_timestamp() AS "databaseNow"`);
  const clockRow = result.rows[0] as { databaseNow?: unknown } | undefined;
  const databaseNow = clockRow?.databaseNow instanceof Date
    ? clockRow.databaseNow
    : clockRow?.databaseNow !== undefined
      ? new Date(String(clockRow.databaseNow))
      : new Date(Number.NaN);
  const retryAt = retryDeadlineFromDatabaseTime(databaseNow, delayMs);
  if (!retryAt) {
    throw new Error("DATABASE_CLOCK_UNAVAILABLE");
  }
  return retryAt;
}
