import { createInsertSchema } from "drizzle-zod";
import { sql } from "drizzle-orm";
import {
  check,
  foreignKey,
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
import { previewAgentNodesTable } from "./preview-agent-nodes.js";
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
export const previewArtifactProviderEnum = pgEnum(
  "preview_artifact_provider",
  ["local", "s3"],
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
    inputArtifactProvider: previewArtifactProviderEnum(
      "input_artifact_provider",
    )
      .notNull()
      .default("s3"),
    inputArtifactStoreId: uuid("input_artifact_store_id"),
    inputArtifactRefId: uuid("input_artifact_ref_id"),
    inputArtifactSizeBytes: integer("input_artifact_size_bytes"),
    inputArtifactManifestDigest: text("input_artifact_manifest_digest"),
    inputArtifactRetentionPolicy: text("input_artifact_retention_policy"),
    inputArtifactOwnerNodeId: uuid("input_artifact_owner_node_id"),
    inputArtifactOwnerKeyVersion: integer(
      "input_artifact_owner_key_version",
    ),
    inputArtifactStoreCommandFingerprint: text(
      "input_artifact_store_command_fingerprint",
    ),
    inputArtifactStoreReceiptFingerprint: text(
      "input_artifact_store_receipt_fingerprint",
    ),
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
    outputArtifactProvider: previewArtifactProviderEnum(
      "output_artifact_provider",
    )
      .notNull()
      .default("s3"),
    outputArtifactStoreId: uuid("output_artifact_store_id"),
    outputArtifactRefId: uuid("output_artifact_ref_id"),
    outputArtifactSizeBytes: integer("output_artifact_size_bytes"),
    outputArtifactManifestDigest: text("output_artifact_manifest_digest"),
    outputArtifactRetentionPolicy: text("output_artifact_retention_policy"),
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
    dispatchGeneration: integer("dispatch_generation")
      .notNull()
      .default(1),
    // Legacy physical column retained to avoid a data migration; application code
    // treats this as an opaque execution reference.
    executionRef: text("builder_task_arn"),
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
    foreignKey({
      name: "fk_preview_build_jobs_input_agent_owner",
      columns: [table.inputArtifactOwnerNodeId],
      foreignColumns: [previewAgentNodesTable.nodeId],
    }).onDelete("restrict"),
    check(
      "chk_preview_build_jobs_input_local_metadata",
      sql`${table.inputArtifactProvider} <> 'local' OR (
        ${table.inputArtifactStoreId} IS NOT NULL
        AND ${table.inputArtifactRefId} IS NOT NULL
        AND ${table.inputArtifactSizeBytes} IS NOT NULL
        AND ${table.inputArtifactSizeBytes} > 0
        AND ${table.inputArtifactManifestDigest} IS NOT NULL
        AND ${table.inputArtifactManifestDigest} ~ '^[a-f0-9]{64}$'
        AND ${table.inputArtifactRetentionPolicy} IS NOT NULL
        AND length(${table.inputArtifactRetentionPolicy}) BETWEEN 1 AND 64
      )`,
    ),
    check(
      "chk_preview_build_jobs_input_local_owner_receipt",
      sql`${table.inputArtifactProvider} <> 'local' OR (
        ${table.inputArtifactOwnerNodeId} IS NOT NULL
        AND ${table.inputArtifactOwnerKeyVersion} IS NOT NULL
        AND ${table.inputArtifactOwnerKeyVersion} > 0
        AND ${table.inputArtifactStoreCommandFingerprint} IS NOT NULL
        AND ${table.inputArtifactStoreCommandFingerprint} ~ '^[a-f0-9]{64}$'
        AND (
          (${table.inputArtifactReadyAt} IS NULL
            AND ${table.inputArtifactStoreReceiptFingerprint} IS NULL)
          OR (
            ${table.inputArtifactReadyAt} IS NOT NULL
            AND ${table.inputArtifactStoreReceiptFingerprint} IS NOT NULL
            AND ${table.inputArtifactStoreReceiptFingerprint} ~ '^[a-f0-9]{64}$'
          )
        )
      )`,
    ),
    check(
      "chk_preview_build_jobs_output_local_metadata",
      sql`${table.outputArtifactProvider} <> 'local' OR (
        ${table.outputArtifactStoreId} IS NOT NULL
        AND ${table.outputArtifactRefId} IS NOT NULL
        AND ${table.outputArtifactRetentionPolicy} IS NOT NULL
        AND length(${table.outputArtifactRetentionPolicy}) BETWEEN 1 AND 64
        AND (
          ${table.status} NOT IN ('builder_succeeded', 'verified')
          OR (
            ${table.outputDigest} IS NOT NULL
            AND ${table.outputDigest} ~ '^[a-f0-9]{64}$'
            AND ${table.outputArtifactSizeBytes} IS NOT NULL
            AND ${table.outputArtifactSizeBytes} > 0
            AND ${table.outputArtifactManifestDigest} IS NOT NULL
            AND ${table.outputArtifactManifestDigest} ~ '^[a-f0-9]{64}$'
          )
        )
      )`,
    ),
    uniqueIndex("uq_preview_build_jobs_build_id").on(table.buildId),
    uniqueIndex("uq_preview_build_jobs_request").on(
      table.projectId,
      table.userId,
      table.clientRequestId,
    ),
    uniqueIndex("uq_preview_build_jobs_task_arn").on(table.executionRef),
    uniqueIndex("uq_preview_build_jobs_output_key").on(table.outputArtifactKey),
    uniqueIndex("uq_preview_build_jobs_receipt_id").on(table.buildReceiptId),
    uniqueIndex("uq_preview_build_jobs_input_artifact_ref").on(
      table.inputArtifactProvider,
      table.inputArtifactStoreId,
      table.inputArtifactRefId,
    ),
    uniqueIndex("uq_preview_build_jobs_output_artifact_ref").on(
      table.outputArtifactProvider,
      table.outputArtifactStoreId,
      table.outputArtifactRefId,
    ),
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
    index(
      "idx_preview_build_jobs_input_gc_due",
    ).on(
      table.inputArtifactProvider,
      table.inputArtifactGcState,
      table.inputArtifactGcMarkedAt,
    ),
    index(
      "idx_preview_build_jobs_output_gc_due",
    ).on(
      table.outputArtifactProvider,
      table.outputArtifactGcState,
      table.outputArtifactGcMarkedAt,
    ),
  ],
);

export const insertPreviewBuildJobSchema = createInsertSchema(
  previewBuildJobsTable,
).omit({
  status: true,
  inputArtifactReadyAt: true,
  inputArtifactProvider: true,
  inputArtifactStoreId: true,
  inputArtifactRefId: true,
  inputArtifactSizeBytes: true,
  inputArtifactManifestDigest: true,
  inputArtifactRetentionPolicy: true,
  inputArtifactOwnerNodeId: true,
  inputArtifactOwnerKeyVersion: true,
  inputArtifactStoreCommandFingerprint: true,
  inputArtifactStoreReceiptFingerprint: true,
  inputArtifactGcState: true,
  inputArtifactGcMarkedAt: true,
  outputArtifactGcState: true,
  outputArtifactProvider: true,
  outputArtifactStoreId: true,
  outputArtifactRefId: true,
  outputArtifactSizeBytes: true,
  outputArtifactManifestDigest: true,
  outputArtifactRetentionPolicy: true,
  outputArtifactGcMarkedAt: true,
  executionRef: true,
  outputDigest: true,
  buildReceiptId: true,
  failureCode: true,
  dispatchGeneration: true,
  stateVersion: true,
  startedAt: true,
  completedAt: true,
  createdAt: true,
  updatedAt: true,
});

export type InsertPreviewBuildJob = z.infer<typeof insertPreviewBuildJobSchema>;
export type PreviewBuildJob = typeof previewBuildJobsTable.$inferSelect;
