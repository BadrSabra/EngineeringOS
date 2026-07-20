/**
 * PR-02: DB-backed per-project LLM rate-limit windows.
 *
 * Replaces the process-local `Map<string, number[]>` in routes/ai.ts with a
 * shared PostgreSQL table so the limit is enforced consistently across all
 * server instances and survives restarts. Uses a fixed-window strategy:
 * each row tracks how many calls were made in one 60-second bucket.
 *
 * The composite primary key (project_id, window_bucket) allows an atomic
 * INSERT … ON CONFLICT DO UPDATE INCREMENT, which is safe under concurrent
 * requests without advisory locks.
 *
 * Old rows are swept periodically by db-rate-limiter.ts — no cron job
 * required; the sweep runs as a setInterval inside the process.
 */
import { pgTable, text, integer, bigint, timestamp, primaryKey } from "drizzle-orm/pg-core";

export const rateLimitWindowsTable = pgTable(
  "rate_limit_windows",
  {
    /** Owning project — scopes the limit per project, not per user. */
    projectId: text("project_id").notNull(),
    /**
     * Floor(unix_epoch_ms / window_duration_ms).
     * window_duration_ms defaults to 60 000 ms (1 minute).
     * bigint in JS "number" mode — safe up to 2^53, which covers ~285 million years.
     */
    windowBucket: bigint("window_bucket", { mode: "number" }).notNull(),
    /** Number of LLM calls made in this (project, bucket) pair. */
    callCount: integer("call_count").notNull().default(1),
    /** Updated on every increment — lets the cleanup query use an index. */
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.projectId, t.windowBucket] })],
);

export type RateLimitWindow = typeof rateLimitWindowsTable.$inferSelect;
