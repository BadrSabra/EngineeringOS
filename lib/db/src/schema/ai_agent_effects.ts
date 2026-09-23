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

export const aiAgentEffectStatusEnum = pgEnum("ai_agent_effect_status", [
  "pending", "observed", "partial", "not_observed", "contradicted", "unknown",
]);

export const aiAgentEffectsTable = pgTable("ai_agent_effects", {
  id: text("id").primaryKey(),
  projectId: text("project_id").notNull().references(() => projectsTable.id, { onDelete: "cascade" }),
  executionId: text("execution_id").notNull().references(() => aiExecutionsTable.id, { onDelete: "cascade" }),
  episodeId: text("episode_id").notNull().references(() => aiAgentEpisodesTable.id, { onDelete: "cascade" }),
  attempt: integer("attempt").notNull(),
  actionId: text("action_id").notNull(),
  capabilityId: text("capability_id").notNull(),
  effectContractHash: text("effect_contract_hash").notNull(),
  beforeObservationIds: jsonb("before_observation_ids").notNull().default([]),
  afterObservationIds: jsonb("after_observation_ids").notNull().default([]),
  expectedEffects: jsonb("expected_effects").notNull(),
  status: aiAgentEffectStatusEnum("status").notNull().default("pending"),
  missingEffects: jsonb("missing_effects").notNull().default([]),
  contradictionRefs: jsonb("contradiction_refs").notNull().default([]),
  evidenceRefs: jsonb("evidence_refs").notNull().default([]),
  createdAt: timestamp("created_at").notNull().defaultNow(),
}, (t) => [
  uniqueIndex("uq_ai_agent_effects_execution_attempt_action").on(t.executionId, t.attempt, t.actionId, t.effectContractHash),
  index("idx_ai_agent_effects_episode").on(t.episodeId, t.createdAt),
  index("idx_ai_agent_effects_project_status").on(t.projectId, t.status),
  check("ck_ai_agent_effects_attempt_nonnegative", sql`${t.attempt} >= 0`),
]);

export type InsertAiAgentEffect = typeof aiAgentEffectsTable.$inferInsert;
export type AiAgentEffect = typeof aiAgentEffectsTable.$inferSelect;