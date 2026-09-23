import {
  check,
  foreignKey,
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
import { aiMissionsTable, aiGoalsTable } from "./ai_missions.js";

export const aiAgentEpisodeStateEnum = pgEnum("ai_agent_episode_state", [
  "created", "running", "paused", "effect_pending", "verifying",
  "waiting_approval", "needs_replan", "completed", "blocked", "failed",
  "cancelling", "cancelled",
]);

export const aiAgentEpisodeVerdictEnum = pgEnum("ai_agent_episode_verdict", [
  "achieved", "incomplete", "blocked", "replan_required", "world_changed",
  "needs_approval", "unsafe", "failed", "cancelled",
]);

export const aiAgentEpisodeEventTypeEnum = pgEnum("ai_agent_episode_event_type", [
  "EPISODE_CREATED", "OBSERVATION_REQUESTED", "OBSERVATION_RECORDED",
  "PLAN_SELECTED", "ACTION_REQUESTED", "ACTION_COMMITTED", "EFFECT_PENDING",
  "EFFECT_CLASSIFIED", "CLAIM_UPDATED", "REPLAN_REQUESTED", "ACCEPTANCE_LINKED",
  "EPISODE_PAUSED", "EPISODE_RESUMED", "EPISODE_CANCELLED", "EPISODE_TERMINAL",
]);

export const aiAgentEpisodeActorTypeEnum = pgEnum("ai_agent_episode_actor_type", [
  "server", "worker", "user", "system",
]);

export const aiAgentEpisodesTable = pgTable("ai_agent_episodes", {
  id: text("id").primaryKey(),
  projectId: text("project_id").notNull().references(() => projectsTable.id, { onDelete: "cascade" }),
  executionId: text("execution_id").notNull().references(() => aiExecutionsTable.id, { onDelete: "cascade" }),
  attempt: integer("attempt").notNull(),
  missionId: text("mission_id").references(() => aiMissionsTable.id, { onDelete: "set null" }),
  goalId: text("goal_id").references(() => aiGoalsTable.id, { onDelete: "set null" }),
  parentEpisodeId: text("parent_episode_id"),
  projectRevision: text("project_revision").notNull(),
  worldRevision: text("world_revision"),
  beliefRevision: text("belief_revision"),
  planRevision: text("plan_revision"),
  intentKind: text("intent_kind").notNull(),
  scope: jsonb("scope").notNull(),
  objectiveContractId: text("objective_contract_id"),
  observationRefs: jsonb("observation_refs").notNull().default([]),
  actionRefs: jsonb("action_refs").notNull().default([]),
  expectedEffectRefs: jsonb("expected_effect_refs").notNull().default([]),
  observedEffectRefs: jsonb("observed_effect_refs").notNull().default([]),
  evidenceRefs: jsonb("evidence_refs").notNull().default([]),
  state: aiAgentEpisodeStateEnum("state").notNull().default("created"),
  verdict: aiAgentEpisodeVerdictEnum("verdict"),
  reasonCode: text("reason_code"),
  nextActionCode: text("next_action_code"),
  workerId: text("worker_id").notNull(),
  leaseUntil: timestamp("lease_until").notNull(),
  idempotencyKey: text("idempotency_key").notNull(),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
  closedAt: timestamp("closed_at"),
}, (t) => [
  uniqueIndex("uq_ai_agent_episodes_execution_attempt").on(t.executionId, t.attempt),
  uniqueIndex("uq_ai_agent_episodes_idempotency").on(t.executionId, t.idempotencyKey),
  index("idx_ai_agent_episodes_project_created").on(t.projectId, t.createdAt),
  index("idx_ai_agent_episodes_worker_lease").on(t.workerId, t.leaseUntil),
  foreignKey({
    columns: [t.parentEpisodeId],
    foreignColumns: [t.id],
    name: "fk_ai_agent_episodes_parent",
  }).onDelete("set null"),
  check("ck_ai_agent_episodes_attempt_nonnegative", sql`${t.attempt} >= 0`),
]);

export const aiAgentEpisodeEventsTable = pgTable("ai_agent_episode_events", {
  id: text("id").primaryKey(),
  episodeId: text("episode_id").notNull().references(() => aiAgentEpisodesTable.id, { onDelete: "cascade" }),
  projectId: text("project_id").notNull().references(() => projectsTable.id, { onDelete: "cascade" }),
  executionId: text("execution_id").notNull().references(() => aiExecutionsTable.id, { onDelete: "cascade" }),
  attempt: integer("attempt").notNull(),
  sequence: integer("sequence").notNull(),
  eventType: aiAgentEpisodeEventTypeEnum("event_type").notNull(),
  payload: jsonb("payload").notNull(),
  payloadHash: text("payload_hash").notNull(),
  actorType: aiAgentEpisodeActorTypeEnum("actor_type").notNull(),
  actorId: text("actor_id"),
  correlationId: text("correlation_id"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
}, (t) => [
  uniqueIndex("uq_ai_agent_episode_events_sequence").on(t.episodeId, t.sequence),
  uniqueIndex("uq_ai_agent_episode_events_idempotency").on(t.episodeId, t.eventType, t.payloadHash),
  index("idx_ai_agent_episode_events_execution").on(t.executionId, t.attempt, t.sequence),
  check("ck_ai_agent_episode_events_attempt_nonnegative", sql`${t.attempt} >= 0`),
  check("ck_ai_agent_episode_events_sequence_nonnegative", sql`${t.sequence} >= 0`),
]);

export type InsertAiAgentEpisode = typeof aiAgentEpisodesTable.$inferInsert;
export type AiAgentEpisode = typeof aiAgentEpisodesTable.$inferSelect;
export type InsertAiAgentEpisodeEvent = typeof aiAgentEpisodeEventsTable.$inferInsert;
export type AiAgentEpisodeEvent = typeof aiAgentEpisodeEventsTable.$inferSelect;