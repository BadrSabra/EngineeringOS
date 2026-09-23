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

export const aiStrategyEvaluationStatusEnum = pgEnum("ai_strategy_evaluation_status", [
  "discovered", "pending_replay", "replay_passed", "replay_failed",
  "canary", "promoted", "revoked", "superseded",
]);

export const aiStrategyCandidatesTable = pgTable("ai_strategy_candidates", {
  id: text("id").primaryKey(),
  projectId: text("project_id").notNull().references(() => projectsTable.id, { onDelete: "cascade" }),
  strategyKey: text("strategy_key").notNull(),
  version: integer("version").notNull(),
  candidate: jsonb("candidate").notNull(),
  candidateHash: text("candidate_hash").notNull(),
  confidence: text("confidence").notNull(),
  supportingEpisodeIds: jsonb("supporting_episode_ids").notNull().default([]),
  contradictingEpisodeIds: jsonb("contradicting_episode_ids").notNull().default([]),
  evaluationStatus: aiStrategyEvaluationStatusEnum("evaluation_status").notNull().default("discovered"),
  sourceRevision: text("source_revision").notNull(),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
}, (t) => [
  uniqueIndex("uq_ai_strategy_candidates_project_key_version").on(t.projectId, t.strategyKey, t.version),
  index("idx_ai_strategy_candidates_project_status").on(t.projectId, t.evaluationStatus),
  check("ck_ai_strategy_candidates_version_positive", sql`${t.version} >= 1`),
  check("ck_ai_strategy_candidates_confidence_range", sql`${t.confidence}::numeric >= 0 AND ${t.confidence}::numeric <= 1`),
]);

export type InsertAiStrategyCandidate = typeof aiStrategyCandidatesTable.$inferInsert;
export type AiStrategyCandidate = typeof aiStrategyCandidatesTable.$inferSelect;