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
}, (t) => [
  index("idx_scan_jobs_project_id").on(t.projectId),
  index("idx_scan_jobs_status").on(t.status),
]);

export type InsertScanJob = typeof scanJobsTable.$inferInsert;
export type ScanJob = typeof scanJobsTable.$inferSelect;
