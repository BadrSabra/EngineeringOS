/**
 * Background scan jobs.
 *
 * Project scans (file walk + rule matching + graph extraction + metrics) are
 * heavy and used to run fully inline inside the HTTP request, blocking the
 * response until the whole project was processed. This table lets the scan
 * route enqueue the work and return immediately; the actual computation runs
 * out-of-band and reports its progress/result here.
 */
import { pgTable, text, timestamp, jsonb, integer, pgEnum, index } from "drizzle-orm/pg-core";
import { projectsTable } from "./projects.js";

export const scanJobStatusEnum = pgEnum("scan_job_status", [
  "queued",
  "running",
  "completed",
  "failed",
]);

export const scanJobsTable = pgTable("scan_jobs", {
  id: text("id").primaryKey(),
  projectId: text("project_id")
    .notNull()
    .references(() => projectsTable.id, { onDelete: "cascade" }),
  status: scanJobStatusEnum("status").notNull().default("queued"),
  /** Populated once the job finishes successfully — same shape as the old synchronous ScanResult. */
  result: jsonb("result").$type<Record<string, unknown>>(),
  /** Populated if the job fails. */
  error: text("error"),
  /**
   * PR-01: Number of times this job has been re-enqueued after a crash-restart
   * interrupted it mid-execution. Incremented by job-reconciliation before
   * re-enqueuing so the counter is accurate in the DB before the job runs.
   */
  retryCount: integer("retry_count").notNull().default(0),
  /**
   * PR-01: Maximum number of crash-restart retries allowed before the job is
   * permanently marked failed. Default is 2 — a scan should succeed within
   * three total attempts; more retries suggest a structural problem (OOM, bad
   * rootPath) rather than a transient crash.
   */
  maxRetries: integer("max_retries").notNull().default(2),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  startedAt: timestamp("started_at"),
  finishedAt: timestamp("finished_at"),
  /**
   * PR-01 (Durable Jobs): Worker ID that claimed and is executing this job.
   * Set atomically on claim; cleared to NULL on completion or failure.
   * Lets reconciliation distinguish "this instance owns the job" from
   * "job was abandoned by a crashed worker".
   */
  workerId: text("worker_id"),
  /**
   * PR-01: Wall-clock deadline for the current worker's lease. The executing
   * worker sends periodic heartbeats to extend this timestamp. If it falls
   * behind now() the job is considered abandoned and eligible for recovery.
   */
  leaseUntil: timestamp("lease_until"),
  /**
   * PR-01: Timestamp of the most recent successful heartbeat from the worker.
   * Useful for monitoring how stale a stuck job's last contact was.
   */
  lastHeartbeatAt: timestamp("last_heartbeat_at"),
  /**
   * PR-01: Stable idempotency key set at job creation. Allows deduplication
   * at the DB level across recovery paths (defaults to the job's own ID).
   */
  idempotencyKey: text("idempotency_key"),
}, (t) => [
  index("idx_scan_jobs_project_id").on(t.projectId),
  index("idx_scan_jobs_status").on(t.status),
  /**
   * DB-16: Covers failStaleRunningJobs (job-reconciliation.ts):
   *   WHERE status = 'running' AND started_at < cutoff
   * Without this, the sweep degrades to a full-table scan as the job table grows.
   */
  index("idx_scan_jobs_status_started_at").on(t.status, t.startedAt),
  /**
   * DB-16: Covers requeueStalePendingJobs (job-reconciliation.ts):
   *   WHERE status = 'queued' AND created_at < cutoff
   * Also covers startup reconciliation: WHERE status = 'queued' (leftmost-prefix scan).
   */
  index("idx_scan_jobs_status_created_at").on(t.status, t.createdAt),
  /**
   * PR-01: Covers lease-expiry detection in failStaleRunningJobs:
   *   WHERE status = 'running' AND lease_until IS NOT NULL AND lease_until < NOW()
   */
  index("idx_scan_jobs_status_lease_until").on(t.status, t.leaseUntil),
]);

export type InsertScanJob = typeof scanJobsTable.$inferInsert;
export type ScanJob = typeof scanJobsTable.$inferSelect;
