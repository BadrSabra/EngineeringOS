import {
  pgTable,
  text,
  timestamp,
  index,
  real,
  integer,
  pgEnum,
} from "drizzle-orm/pg-core";
import { projectsTable } from "./projects.js";

export const buildStatusEnum = pgEnum("build_status", [
  "passing",
  "failing",
  "unknown",
]);

/**
 * DB-10: Design intent — time-series snapshots.
 *
 * `metrics` is an append-only time-series log, NOT a single-row-per-project
 * record. Every scan produces a new row for that project. This is intentional:
 *
 *   - GET /metrics returns the full history for a project (optionally filtered
 *     by `from`/`to` query params) so callers can chart score evolution.
 *   - GET /metrics/latest returns only the most recent row per project using
 *     ORDER BY timestamp DESC LIMIT 1.
 *
 * No UNIQUE constraint on (project_id, timestamp) — duplicate timestamps are
 * possible if two scans finish in the same millisecond, but that is harmless
 * since "latest" still returns the first of the two and historical queries
 * include both. The composite index (project_id, timestamp) (added in DB-04)
 * makes both query patterns efficient.
 *
 * Do NOT add a uniqueness constraint here without a migration plan for the
 * existing time-series rows.
 */
export const metricsTable = pgTable("metrics", {
  id: text("id").primaryKey(),
  projectId: text("project_id")
    .notNull()
    .references(() => projectsTable.id, { onDelete: "cascade" }),
  timestamp: timestamp("timestamp").notNull().defaultNow(),
  overallScore: real("overall_score").notNull().default(0),
  architectureScore: real("architecture_score"),
  securityScore: real("security_score"),
  performanceScore: real("performance_score"),
  reliabilityScore: real("reliability_score"),
  maintainabilityScore: real("maintainability_score"),
  /** Structural heuristic — NOT measured branch/line coverage. See metrics-calc.ts. */
  structuralTestEstimate: real("test_coverage"),
  lintIssues: integer("lint_issues"),
  testsPassed: integer("tests_passed"),
  testsTotal: integer("tests_total"),
  technicalDebt: real("technical_debt"),
  avgFileSizeKb: real("avg_file_size_kb"),
  codeToTestRatio: real("code_to_test_ratio"),
  buildStatus: buildStatusEnum("build_status").default("unknown"),
  /** Ties this metrics snapshot to the scan operation that produced it. */
  correlationId: text("correlation_id"),
}, (t) => [
  index("idx_metrics_project_id").on(t.projectId),
  // Covers: WHERE project_id = ? ORDER BY timestamp DESC LIMIT 1 (latest metric)
  index("idx_metrics_project_id_timestamp").on(t.projectId, t.timestamp),
  index("idx_metrics_timestamp").on(t.timestamp),
  index("idx_metrics_correlation_id").on(t.correlationId),
]);

export type InsertMetric = typeof metricsTable.$inferInsert;
export type MetricRecord = typeof metricsTable.$inferSelect;
