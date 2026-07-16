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
  index("idx_rules_severity").on(t.severity),
  index("idx_rules_enabled").on(t.enabled),
]);

export type InsertRule = typeof rulesTable.$inferInsert;
export type Rule = typeof rulesTable.$inferSelect;
