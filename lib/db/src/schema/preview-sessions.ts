import { createInsertSchema } from "drizzle-zod";
import {
  index,
  integer,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { z } from "zod/v4";
import { aiChangeProposalsTable } from "./ai_change_proposals.js";
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
 * The row stores the ECS task ARN, never a client-selected host or port. A
 * Gateway must resolve the private task target from AWS and re-check this row
 * before serving any request.
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
    taskDefinitionArn: text("task_definition_arn").notNull(),
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
  ],
);

export const insertPreviewSessionSchema = createInsertSchema(
  previewSessionsTable,
).omit({
  id: true,
  status: true,
  runnerTaskArn: true,
  stateVersion: true,
  readyAt: true,
  closedAt: true,
  createdAt: true,
  updatedAt: true,
});

export type InsertPreviewSession = z.infer<typeof insertPreviewSessionSchema>;
export type PreviewSession = typeof previewSessionsTable.$inferSelect;
