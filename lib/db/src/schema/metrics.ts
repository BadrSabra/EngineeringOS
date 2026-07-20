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
  buildStatus: buildStatusEnum("build_status").default("unknown"),
  /** Ties this metrics snapshot to the scan operation that produced it. */
  correlationId: text("correlation_id"),
}, (t) => [
  index("idx_metrics_project_id").on(t.projectId),
  index("idx_metrics_timestamp").on(t.timestamp),
  index("idx_metrics_correlation_id").on(t.correlationId),
]);

export type InsertMetric = typeof metricsTable.$inferInsert;
export type MetricRecord = typeof metricsTable.$inferSelect;
