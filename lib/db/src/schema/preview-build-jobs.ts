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
import { projectsTable } from "./projects.js";

export const previewBuildJobStatusEnum = pgEnum("preview_build_job_status", [
  "queued",
  "launching",
  "running",
  "builder_succeeded",
  "verified",
  "failed",
  "expired",
  "cancelled",
]);

export const previewArtifactGcStateEnum = pgEnum(
  "preview_artifact_gc_state",
  ["active", "eligible_for_gc", "deleting", "deleted"],
);

/**
 * Durable build-attempt lifecycle, deliberately separate from Preview sessions.
 *
 * This row stores reconstructible signed-job claims and opaque artifact keys,
 * never the signed bearer token, presigned URLs, or provider credentials.
 * `builder_succeeded` is not proof: only an independent verifier may transition
 * a row to `verified` and attach a receipt.
 */
export const previewBuildJobsTable = pgTable(
  "preview_build_jobs",
  {
    jobId: uuid("job_id").primaryKey(),
    buildId: uuid("build_id").notNull(),
    projectId: text("project_id")
      .notNull()
      .references(() => projectsTable.id, { onDelete: "cascade" }),
    proposalId: text("proposal_id")
      .notNull()
      .references(() => aiChangeProposalsTable.id, { onDelete: "restrict" }),
    userId: text("user_id").notNull(),
    clientRequestId: uuid("client_request_id").notNull(),
    operationId: text("operation_id").notNull(),
    proposalRevision: integer("proposal_revision").notNull(),
    candidateRevision: text("candidate_revision").notNull(),
    changeSetHash: text("change_set_hash").notNull(),
    sourceRoot: text("source_root").notNull(),
    sourceDigest: text("source_digest").notNull(),
    archiveDigest: text("archive_digest").notNull(),
    inputArtifactKey: text("input_artifact_key").notNull(),
    inputArtifactReadyAt: timestamp("input_artifact_ready_at", {
      withTimezone: true,
    }),
    inputArtifactGcState: previewArtifactGcStateEnum("input_artifact_gc_state")
      .notNull()
      .default("active"),
    inputArtifactGcMarkedAt: timestamp("input_artifact_gc_marked_at", {
      withTimezone: true,
    }),
    outputArtifactKey: text("output_artifact_key").notNull(),
    outputArtifactGcState: previewArtifactGcStateEnum(
      "output_artifact_gc_state",
    )
      .notNull()
      .default("active"),
    outputArtifactGcMarkedAt: timestamp("output_artifact_gc_marked_at", {
      withTimezone: true,
    }),
    builderImageDigest: text("builder_image_digest").notNull(),
    issuedAt: timestamp("issued_at", { withTimezone: true }).notNull(),
    tokenExpiresAt: timestamp("token_expires_at", {
      withTimezone: true,
    }).notNull(),
    status: previewBuildJobStatusEnum("status").notNull().default("queued"),
    builderTaskArn: text("builder_task_arn"),
    outputDigest: text("output_digest"),
    buildReceiptId: uuid("build_receipt_id"),
    failureCode: text("failure_code"),
    stateVersion: integer("state_version").notNull().default(0),
    startedAt: timestamp("started_at", { withTimezone: true }),
    completedAt: timestamp("completed_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    uniqueIndex("uq_preview_build_jobs_build_id").on(table.buildId),
    uniqueIndex("uq_preview_build_jobs_request").on(
      table.projectId,
      table.userId,
      table.clientRequestId,
    ),
    uniqueIndex("uq_preview_build_jobs_task_arn").on(table.builderTaskArn),
    uniqueIndex("uq_preview_build_jobs_output_key").on(table.outputArtifactKey),
    uniqueIndex("uq_preview_build_jobs_receipt_id").on(table.buildReceiptId),
    index("idx_preview_build_jobs_project_status_created").on(
      table.projectId,
      table.status,
      table.createdAt,
    ),
    index("idx_preview_build_jobs_proposal_status").on(
      table.proposalId,
      table.status,
    ),
    index("idx_preview_build_jobs_token_expiry").on(table.tokenExpiresAt),
  ],
);

export const insertPreviewBuildJobSchema = createInsertSchema(
  previewBuildJobsTable,
).omit({
  status: true,
  inputArtifactReadyAt: true,
  inputArtifactGcState: true,
  inputArtifactGcMarkedAt: true,
  outputArtifactGcState: true,
  outputArtifactGcMarkedAt: true,
  builderTaskArn: true,
  outputDigest: true,
  buildReceiptId: true,
  failureCode: true,
  stateVersion: true,
  startedAt: true,
  completedAt: true,
  createdAt: true,
  updatedAt: true,
});

export type InsertPreviewBuildJob = z.infer<typeof insertPreviewBuildJobSchema>;
export type PreviewBuildJob = typeof previewBuildJobsTable.$inferSelect;
