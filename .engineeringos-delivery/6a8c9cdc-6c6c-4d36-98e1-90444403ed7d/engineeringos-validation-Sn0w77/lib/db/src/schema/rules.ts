import {
  pgTable,
  text,
  timestamp,
  integer,
  boolean,
  jsonb,
  pgEnum,
  index,
} from "drizzle-orm/pg-core";
import { projectsTable } from "./projects.js";

export const ruleSeverityEnum = pgEnum("rule_severity", [
  "critical",
  "high",
  "medium",
  "low",
  "info",
]);

export const rulesTable = pgTable("rules", {
  id: text("id").primaryKey(),
  projectId: text("project_id").references(() => projectsTable.id, { onDelete: "set null" }),
  code: text("code").notNull().unique(),
  title: text("title").notNull(),
  description: text("description"),
  severity: ruleSeverityEnum("severity").notNull().default("medium"),
  pattern: text("pattern"),
  fixDescription: text("fix_description"),
  verifySteps: jsonb("verify_steps").$type<string[]>().default([]),
  enabled: boolean("enabled").notNull().default(true),
  hitCount: integer("hit_count").notNull().default(0),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
}, (t) => [
  index("idx_rules_project_id").on(t.projectId),
  // Covers: WHERE project_id = ? ORDER BY hit_count DESC  (no severity filter)
  index("idx_rules_project_id_hit_count").on(t.projectId, t.hitCount),
  /**
   * DB-18: Covers the filtered list query in rules.ts:
   *   WHERE project_id = ? AND severity = ? ORDER BY hit_count DESC
   * The three-column composite lets PostgreSQL index-scan the (project, severity)
   * prefix and then return rows already ordered by hit_count — no post-sort needed.
   *
   * Note: global rules (project_id IS NULL) also use this query shape when a
   * severity filter is provided. PostgreSQL IS-NULL predicates can use btree
   * indexes, so this index covers that path too (NULL is a first-class btree value).
   */
  index("idx_rules_project_id_severity_hit_count").on(
    t.projectId,
    t.severity,
    t.hitCount,
  ),
  index("idx_rules_severity").on(t.severity),
  index("idx_rules_enabled").on(t.enabled),
]);

export type InsertRule = typeof rulesTable.$inferInsert;
export type Rule = typeof rulesTable.$inferSelect;
