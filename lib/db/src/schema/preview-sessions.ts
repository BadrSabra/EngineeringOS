import { createInsertSchema } from "drizzle-zod";
import { sql } from "drizzle-orm";
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
  uuid,
} from "drizzle-orm/pg-core";
import { z } from "zod/v4";
import { aiChangeProposalsTable } from "./ai_change_proposals.js";
import { previewAgentNodesTable } from "./preview-agent-nodes.js";
import { previewBuildJobsTable } from "./preview-build-jobs.js";

export const previewSessionStatusEnum = pgEnum("preview_session_status", [
  "starting",
  "ready",
  "stopping",
  "stopped",
  "failed",
  "expired",
]);

/**
 * Durable Candidate Preview session identity.
 *
 * The row remains the authoritative Preview session lifecycle for every
 * execution provider. ECS fields remain for existing sessions; Local Agent
 * sessions use the provider-neutral execution and signed-message bindings.
 * Neither provider may persist a client-selected host or port.
 */
export const previewSessionsTable = pgTable(
  "preview_sessions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    proposalId: text("proposal_id")
      .notNull()
      .references(() => aiChangeProposalsTable.id, { onDelete: "restrict" }),
    userId: text("user_id").notNull(),
    proposalRevision: integer("proposal_revision").notNull(),
    candidateRevision: text("candidate_revision").notNull(),
    changeSetHash: text("change_set_hash").notNull(),
    imageDigest: text("image_digest").notNull(),
    taskDefinitionArn: text("task_definition_arn"),
    executionProvider: text("execution_provider").notNull().default("aws_ecs"),
    executionRef: text("execution_ref"),
    runnerNodeId: uuid("runner_node_id").references(
      () => previewAgentNodesTable.nodeId,
      { onDelete: "restrict" },
    ),
    runnerKeyVersion: integer("runner_key_version"),
    runtimeProfileId: text("runtime_profile_id"),
    runtimeProfileDigest: text("runtime_profile_digest"),
    channelRef: uuid("channel_ref"),
    executionGeneration: integer("execution_generation")
      .notNull()
      .default(1),
    fencingGeneration: integer("fencing_generation").notNull().default(1),
    runnerCommandId: uuid("runner_command_id"),
    runnerMessageId: uuid("runner_message_id"),
    runnerMessageDigest: text("runner_message_digest"),
    runnerMessageProjection: jsonb("runner_message_projection").$type<
      Record<string, unknown> | null
    >(),
    runnerLeaseOwner: text("runner_lease_owner"),
    runnerLeaseProofDigest: text("runner_lease_proof_digest"),
    runnerLeaseExpiresAt: timestamp("runner_lease_expires_at", {
      withTimezone: true,
    }),
    buildJobId: uuid("build_job_id").references(
      () => previewBuildJobsTable.jobId,
      { onDelete: "restrict" },
    ),
    buildReceiptId: uuid("build_receipt_id"),
    buildOutputArtifactKey: text("build_output_artifact_key"),
    buildOutputDigest: text("build_output_digest"),
    status: previewSessionStatusEnum("status").notNull().default("starting"),
    runnerTaskArn: text("runner_task_arn"),
    stateVersion: integer("state_version").notNull().default(0),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    readyAt: timestamp("ready_at", { withTimezone: true }),
    closedAt: timestamp("closed_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    index("idx_preview_sessions_proposal_status").on(
      table.proposalId,
      table.status,
    ),
    index("idx_preview_sessions_expires_at").on(table.expiresAt),
    uniqueIndex("uq_preview_sessions_runner_task_arn").on(table.runnerTaskArn),
    uniqueIndex("uq_preview_sessions_build_receipt_id").on(
      table.buildReceiptId,
    ),
    uniqueIndex("uq_preview_sessions_build_job_id").on(table.buildJobId),
    uniqueIndex("uq_preview_sessions_execution_provider_ref").on(
      table.executionProvider,
      table.executionRef,
    ),
    uniqueIndex("uq_preview_sessions_runner_command_id").on(
      table.runnerCommandId,
    ),
    uniqueIndex("uq_preview_sessions_runner_message_id").on(
      table.runnerMessageId,
    ),
    index("idx_preview_sessions_runner_lease").on(
      table.executionProvider,
      table.status,
      table.runnerLeaseExpiresAt,
    ),
    check(
      "chk_preview_sessions_execution_provider",
      sql`${table.executionProvider} IN ('aws_ecs', 'local_agent')`,
    ),
    check(
      "chk_preview_sessions_execution_generation_positive",
      sql`${table.executionGeneration} > 0 AND ${table.fencingGeneration} > 0`,
    ),
    check(
      "chk_preview_sessions_provider_binding",
      sql`(
        ${table.executionProvider} = 'aws_ecs'
        AND ${table.taskDefinitionArn} IS NOT NULL
      ) OR (
        ${table.executionProvider} = 'local_agent'
        AND ${table.taskDefinitionArn} IS NULL
        AND ${table.runnerNodeId} IS NOT NULL
        AND ${table.runnerKeyVersion} IS NOT NULL
        AND ${table.runnerKeyVersion} > 0
        AND ${table.runtimeProfileId} IS NOT NULL
        AND ${table.runtimeProfileDigest} IS NOT NULL
        AND ${table.runtimeProfileDigest} ~ '^[0-9a-f]{64}$'
        AND ${table.channelRef} IS NOT NULL
      )`,
    ),
    check(
      "chk_preview_sessions_local_execution_ref_ready",
      sql`${table.executionProvider} <> 'local_agent'
        OR ${table.status} <> 'ready'
        OR ${table.executionRef} IS NOT NULL`,
    ),
    check(
      "chk_preview_sessions_runner_message_pair",
      sql`(
        ${table.runnerMessageId} IS NULL
        AND ${table.runnerMessageDigest} IS NULL
        AND ${table.runnerMessageProjection} IS NULL
      ) OR (
        ${table.runnerCommandId} IS NOT NULL
        AND ${table.runnerMessageId} IS NOT NULL
        AND ${table.runnerMessageDigest} IS NOT NULL
        AND ${table.runnerMessageDigest} ~ '^[0-9a-f]{64}$'
        AND ${table.runnerMessageProjection} IS NOT NULL
      )`,
    ),
    check(
      "chk_preview_sessions_runner_lease_pair",
      sql`(
        ${table.runnerLeaseOwner} IS NULL
        AND ${table.runnerLeaseExpiresAt} IS NULL
        AND ${table.runnerLeaseProofDigest} IS NULL
      ) OR (
        ${table.runnerLeaseOwner} IS NOT NULL
        AND ${table.runnerLeaseExpiresAt} IS NOT NULL
        AND ${table.runnerLeaseProofDigest} IS NOT NULL
        AND ${table.runnerLeaseProofDigest} ~ '^[0-9a-f]{64}$'
      )`,
    ),
  ],
);

export const insertPreviewSessionSchema = createInsertSchema(
  previewSessionsTable,
).omit({
  id: true,
  taskDefinitionArn: true,
  status: true,
  runnerTaskArn: true,
  executionProvider: true,
  executionRef: true,
  runnerNodeId: true,
  runnerKeyVersion: true,
  runtimeProfileId: true,
  runtimeProfileDigest: true,
  channelRef: true,
  executionGeneration: true,
  fencingGeneration: true,
  runnerCommandId: true,
  runnerMessageId: true,
  runnerMessageDigest: true,
  runnerMessageProjection: true,
  runnerLeaseOwner: true,
  runnerLeaseProofDigest: true,
  runnerLeaseExpiresAt: true,
  stateVersion: true,
  readyAt: true,
  closedAt: true,
  createdAt: true,
  updatedAt: true,
});

export type InsertPreviewSession = z.infer<typeof insertPreviewSessionSchema>;
export type PreviewSession = typeof previewSessionsTable.$inferSelect;
