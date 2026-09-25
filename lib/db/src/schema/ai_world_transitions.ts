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
import { aiAgentEffectBundlesTable } from "./ai_agent_effect_bundles.js";
import { aiAgentObservationFreshnessEnum } from "./ai_agent_observations.js";

export const aiWorldTransitionStatusEnum = pgEnum("ai_world_transition_status", [
  "pending",
  "materialized",
  "retrying",
  "terminal_failed",
]);

export const aiWorldTransitionsTable = pgTable("ai_world_transitions", {
  id: text("id").primaryKey(),
  projectId: text("project_id").notNull().references(() => projectsTable.id, { onDelete: "cascade" }),
  executionId: text("execution_id").notNull().references(() => aiExecutionsTable.id, { onDelete: "cascade" }),
  attempt: integer("attempt").notNull(),
  episodeId: text("episode_id").notNull().references(() => aiAgentEpisodesTable.id, { onDelete: "cascade" }),
  actionId: text("action_id").notNull(),
  effectBundleId: text("effect_bundle_id").references(() => aiAgentEffectBundlesTable.id, { onDelete: "set null" }),
  parentWorldRevision: text("parent_world_revision").notNull(),
  resultingWorldRevision: text("resulting_world_revision"),
  taskScope: text("task_scope").notNull().default("project"),
  environmentRevisionKey: text("environment_revision_key").notNull().default("unknown"),
  environmentRevision: text("environment_revision"),
  freshness: aiAgentObservationFreshnessEnum("freshness").notNull().default("unknown"),
  beforeObservationIds: jsonb("before_observation_ids").notNull().default([]),
  afterObservationIds: jsonb("after_observation_ids").notNull().default([]),
  materializedObservationIds: jsonb("materialized_observation_ids").notNull().default([]),
  parentFactRefs: jsonb("parent_fact_refs").notNull().default([]),
  changedFactRefs: jsonb("changed_fact_refs").notNull().default([]),
  evidenceRefs: jsonb("evidence_refs").notNull().default([]),
  status: aiWorldTransitionStatusEnum("status").notNull().default("pending"),
  idempotencyKey: text("idempotency_key").notNull(),
  retryCount: integer("retry_count").notNull().default(0),
  failureCode: text("failure_code"),
  nextRetryAt: timestamp("next_retry_at"),
  materializedAt: timestamp("materialized_at"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
}, (t) => [
  uniqueIndex("uq_ai_world_transitions_action").on(
    t.projectId,
    t.executionId,
    t.attempt,
    t.episodeId,
    t.actionId,
  ),
  uniqueIndex("uq_ai_world_transitions_idempotency").on(t.projectId, t.idempotencyKey),
  index("idx_ai_world_transitions_recovery").on(t.projectId, t.status, t.nextRetryAt),
  check("ck_ai_world_transitions_attempt_nonnegative", sql`${t.attempt} >= 0`),
  check("ck_ai_world_transitions_retry_count_nonnegative", sql`${t.retryCount} >= 0`),
]);

export type InsertAiWorldTransition = typeof aiWorldTransitionsTable.$inferInsert;
export type AiWorldTransition = typeof aiWorldTransitionsTable.$inferSelect;