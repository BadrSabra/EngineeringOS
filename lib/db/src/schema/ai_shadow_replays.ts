import {
  boolean,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
} from "drizzle-orm/pg-core";
import { projectsTable } from "./projects.js";
import { aiChangeProposalsTable } from "./ai_change_proposals.js";
import { aiExecutionsTable } from "./ai_executions.js";

export const aiShadowReplayStatusEnum = pgEnum("ai_shadow_replay_status", [
  "queued",
  "running",
  "completed",
  "failed",
  "cancelled",
]);

/**
 * Durable, non-production replay control plane.
 *
 * The replay row is separate from the candidate envelope so every attempt,
 * workspace identity, validator result, and terminal receipt remains
 * auditable without mutating proposal evidence.
 */
export const aiShadowReplaysTable = pgTable("ai_shadow_replays", {
  id: text("id").primaryKey(),
  executionId: text("execution_id")
    .notNull()
    .references(() => aiExecutionsTable.id, { onDelete: "cascade" }),
  projectId: text("project_id")
    .notNull()
    .references(() => projectsTable.id, { onDelete: "cascade" }),
  proposalId: text("proposal_id")
    .notNull()
    .references(() => aiChangeProposalsTable.id, { onDelete: "cascade" }),
  userId: text("user_id").notNull(),
  idempotencyKey: text("idempotency_key").notNull(),
  operationId: text("operation_id").notNull(),
  candidateId: text("candidate_id").notNull(),
  canonicalAcceptanceId: text("canonical_acceptance_id").notNull(),
  trajectoryDigest: text("trajectory_digest").notNull(),
  sourceRevision: text("source_revision").notNull(),
  candidateTreeHash: text("candidate_tree_hash").notNull(),
  changeSetHash: text("change_set_hash"),
  executionProfile: text("execution_profile").notNull().default("shadow-replay"),
  status: aiShadowReplayStatusEnum("status").notNull().default("queued"),
  attempt: integer("attempt").notNull().default(0),
  workerId: text("worker_id"),
  leaseUntil: timestamp("lease_until"),
  sourceWorkspaceRoot: text("source_workspace_root").notNull(),
  replayWorkspaceRoot: text("replay_workspace_root"),
  replayWorkspaceCleaned: boolean("replay_workspace_cleaned").notNull().default(false),
  preTreeHash: text("pre_tree_hash"),
  postTreeHash: text("post_tree_hash"),
  validatorResult: jsonb("validator_result"),
  receipt: jsonb("receipt"),
  error: text("error"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  startedAt: timestamp("started_at"),
  completedAt: timestamp("completed_at"),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
}, (t) => [
  uniqueIndex("uq_ai_shadow_replays_execution").on(t.executionId),
  uniqueIndex("uq_ai_shadow_replays_user_idempotency").on(t.userId, t.idempotencyKey),
  index("idx_ai_shadow_replays_status_lease").on(t.status, t.leaseUntil),
  index("idx_ai_shadow_replays_proposal").on(t.proposalId, t.createdAt),
]);

export type InsertAiShadowReplay = typeof aiShadowReplaysTable.$inferInsert;
export type AiShadowReplay = typeof aiShadowReplaysTable.$inferSelect;