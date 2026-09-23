import {
  check,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { projectsTable } from "./projects.js";

export const aiWorldFactStatusEnum = pgEnum("ai_world_fact_status", [
  "believed", "confirmed", "contradicted", "superseded", "retracted",
]);

export const aiWorldFactsTable = pgTable("ai_world_facts", {
  id: text("id").primaryKey(),
  projectId: text("project_id").notNull().references(() => projectsTable.id, { onDelete: "cascade" }),
  subject: text("subject").notNull(),
  predicate: text("predicate").notNull(),
  value: jsonb("value").notNull(),
  valueHash: text("value_hash").notNull(),
  version: integer("version").notNull(),
  status: aiWorldFactStatusEnum("status").notNull().default("believed"),
  sourceObservationIds: jsonb("source_observation_ids").notNull().default([]),
  projectRevision: text("project_revision").notNull(),
  environmentRevision: text("environment_revision"),
  supersedesFactId: text("supersedes_fact_id"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
}, (t) => [
  uniqueIndex("uq_ai_world_facts_project_key_version").on(t.projectId, t.subject, t.predicate, t.version),
  index("idx_ai_world_facts_project_key").on(t.projectId, t.subject, t.predicate, t.status),
  check("ck_ai_world_facts_version_positive", sql`${t.version} >= 1`),
]);

export type InsertAiWorldFact = typeof aiWorldFactsTable.$inferInsert;
export type AiWorldFact = typeof aiWorldFactsTable.$inferSelect;