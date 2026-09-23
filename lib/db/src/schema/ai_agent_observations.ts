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
import { aiExecutionsTable } from "./ai_executions.js";
import { aiAgentEpisodesTable } from "./ai_agent_episodes.js";

export const aiAgentObservationCompletenessEnum = pgEnum("ai_agent_observation_completeness", [
  "complete", "partial", "failed",
]);
export const aiAgentObservationFreshnessEnum = pgEnum("ai_agent_observation_freshness", [
  "fresh", "stale", "unknown",
]);

export const aiAgentObservationsTable = pgTable("ai_agent_observations", {
  id: text("id").primaryKey(),
  projectId: text("project_id").notNull().references(() => projectsTable.id, { onDelete: "cascade" }),
  executionId: text("execution_id").notNull().references(() => aiExecutionsTable.id, { onDelete: "cascade" }),
  episodeId: text("episode_id").notNull().references(() => aiAgentEpisodesTable.id, { onDelete: "cascade" }),
  kind: text("kind").notNull(),
  observationRole: text("observation_role").notNull(),
  sourceType: text("source_type").notNull(),
  sourceId: text("source_id").notNull(),
  sourceVersion: text("source_version"),
  subject: text("subject").notNull(),
  predicate: text("predicate").notNull(),
  value: jsonb("value").notNull(),
  valueHash: text("value_hash").notNull(),
  sourceRefs: jsonb("source_refs").notNull().default([]),
  observedAt: timestamp("observed_at").notNull(),
  projectRevision: text("project_revision"),
  environmentRevision: text("environment_revision"),
  completeness: aiAgentObservationCompletenessEnum("completeness").notNull(),
  freshness: aiAgentObservationFreshnessEnum("freshness").notNull(),
  evidenceRefs: jsonb("evidence_refs").notNull().default([]),
  sequence: integer("sequence").notNull(),
  createdAt: timestamp("created_at").notNull().defaultNow(),
}, (t) => [
  uniqueIndex("uq_ai_agent_observations_identity").on(t.projectId, t.sourceType, t.sourceId, t.sourceVersion, t.predicate, t.valueHash),
  index("idx_ai_agent_observations_episode_sequence").on(t.episodeId, t.sequence),
  index("idx_ai_agent_observations_project_subject").on(t.projectId, t.subject, t.predicate),
  check("ck_ai_agent_observations_sequence_nonnegative", sql`${t.sequence} >= 0`),
]);

export type InsertAiAgentObservation = typeof aiAgentObservationsTable.$inferInsert;
export type AiAgentObservation = typeof aiAgentObservationsTable.$inferSelect;