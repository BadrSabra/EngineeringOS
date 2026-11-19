/**
 * Database-authoritative clock helpers for the durable Shadow Replay lease.
 *
 * ai_shadow_replays timestamps are timestamp-without-time-zone columns. Keep
 * their values UTC-naive and evaluate ownership deadlines inside PostgreSQL so
 * an API replica's wall clock can neither steal nor prolong another worker's lease.
 */
import { and, gt, isNull, lte, or, sql } from "drizzle-orm";
import { aiShadowReplaysTable } from "@workspace/db";

export const shadowReplayDatabaseNow = () =>
  sql<Date>`clock_timestamp() AT TIME ZONE 'UTC'`;

export const shadowReplayDatabaseLeaseUntil = (leaseMs: number) =>
  sql<Date>`(clock_timestamp() AT TIME ZONE 'UTC') + (${leaseMs} * interval '1 millisecond')`;

export function shadowReplayLeaseIsLive() {
  return and(
    sql`${aiShadowReplaysTable.leaseUntil} IS NOT NULL`,
    gt(aiShadowReplaysTable.leaseUntil, shadowReplayDatabaseNow()),
  );
}

export function shadowReplayLeaseIsExpired() {
  return or(
    isNull(aiShadowReplaysTable.leaseUntil),
    lte(aiShadowReplaysTable.leaseUntil, shadowReplayDatabaseNow()),
  );
}
