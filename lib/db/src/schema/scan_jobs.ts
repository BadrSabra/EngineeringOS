/**
 * Background scan jobs.
 *
 * Project scans (file walk + rule matching + graph extraction + metrics) are
 * heavy and used to run fully inline inside the HTTP request, blocking the
 * response until the whole project was processed. This table lets the scan
 * route enqueue the work and return immediately; the actual computation runs
 * out-of-band and reports its progress/result here.
 */
import { pgTable, text, timestamp, jsonb, pgEnum } from "drizzle-orm/pg-core";

export const scanJobStatusEnum = pgEnum("scan_job_status", [
  "queued",
  "running",
  "completed",
  "failed",
]);

export const scanJobsTable = pgTable("scan_jobs", {
  id: text("id").primaryKey(),
  projectId: text("project_id").notNull(),
  status: scanJobStatusEnum("status").notNull().default("queued"),
  /** Populated once the job finishes successfully — same shape as the old synchronous ScanResult. */
  result: jsonb("result").$type<Record<string, unknown>>(),
  /** Populated if the job fails. */
  error: text("error"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  startedAt: timestamp("started_at"),
  finishedAt: timestamp("finished_at"),
});

export type InsertScanJob = typeof scanJobsTable.$inferInsert;
export type ScanJob = typeof scanJobsTable.$inferSelect;
