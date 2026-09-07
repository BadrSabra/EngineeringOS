import {
  integer,
  index,
  jsonb,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
} from "drizzle-orm/pg-core";
import { projectsTable } from "./projects.js";
import { aiExecutionsTable } from "./ai_executions.js";
import { aiChatMessagesTable } from "./ai_chats.js";

/**
 * Server-owned source evidence retained before an execution worker is
 * released.  The body is deliberately not part of toolTrace or any public
 * projection.  A missing, incomplete, or truncated read can therefore never
 * be mistaken for proof.
 */
export const aiExecutionEvidenceSnapshotsTable = pgTable("ai_execution_evidence_snapshots", {
  id: text("id").primaryKey(),
  executionId: text("execution_id")
    .notNull()
    .references(() => aiExecutionsTable.id, { onDelete: "cascade" }),
  projectId: text("project_id")
    .notNull()
    .references(() => projectsTable.id, { onDelete: "cascade" }),
  attempt: integer("attempt").notNull(),
  operationId: text("operation_id"),
  sourceRevision: text("source_revision"),
  candidateIdentity: text("candidate_identity"),
  verdict: text("verdict").notNull(),
  complete: integer("complete").notNull().default(0),
  readCount: integer("read_count").notNull().default(0),
  totalBytes: integer("total_bytes").notNull().default(0),
  createdAt: timestamp("created_at").notNull().defaultNow(),
}, (t) => [
  uniqueIndex("uq_ai_execution_evidence_snapshots_attempt").on(t.executionId, t.attempt),
  index("idx_ai_execution_evidence_snapshots_operation").on(t.projectId, t.operationId),
]);

export const aiExecutionEvidenceReadsTable = pgTable("ai_execution_evidence_reads", {
  id: text("id").primaryKey(),
  snapshotId: text("snapshot_id")
    .notNull()
    .references(() => aiExecutionEvidenceSnapshotsTable.id, { onDelete: "cascade" }),
  path: text("path").notNull(),
  readType: text("read_type").notNull().default("source"),
  lineStart: integer("line_start"),
  lineEnd: integer("line_end"),
  contentHash: text("content_hash").notNull(),
  byteLength: integer("byte_length").notNull(),
  complete: integer("complete").notNull().default(1),
  truncated: integer("truncated").notNull().default(0),
  /** Private server evidence. Never serialize this column into public output. */
  body: text("body").notNull(),
  createdAt: timestamp("created_at").notNull().defaultNow(),
}, (t) => [
  index("idx_ai_execution_evidence_reads_snapshot").on(t.snapshotId),
]);

export const aiExecutionAcceptancesTable = pgTable("ai_execution_acceptances", {
  id: text("id").primaryKey(),
  executionId: text("execution_id")
    .notNull()
    .references(() => aiExecutionsTable.id, { onDelete: "cascade" }),
  projectId: text("project_id")
    .notNull()
    .references(() => projectsTable.id, { onDelete: "cascade" }),
  attempt: integer("attempt").notNull(),
  /** Stable key for a terminal decision; retries return this row. */
  finalizationKey: text("finalization_key").notNull(),
  operationId: text("operation_id"),
  workerId: text("worker_id"),
  terminalStatus: text("terminal_status").notNull(),
  outcome: text("outcome").notNull(),
  reasonCode: text("reason_code").notNull(),
  nextActionCode: text("next_action_code").notNull(),
  disposition: jsonb("disposition"),
  evidenceSnapshotId: text("evidence_snapshot_id")
    .references(() => aiExecutionEvidenceSnapshotsTable.id, { onDelete: "set null" }),
  evidenceRequired: integer("evidence_required").notNull().default(0),
  evidenceComplete: integer("evidence_complete").notNull().default(0),
  resumable: integer("resumable").notNull().default(0),
  messageId: text("message_id")
    .references(() => aiChatMessagesTable.id, { onDelete: "set null" }),
  sourceRevision: text("source_revision"),
  candidateIdentity: text("candidate_identity"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
}, (t) => [
  uniqueIndex("uq_ai_execution_acceptances_execution_attempt").on(t.executionId, t.attempt),
  uniqueIndex("uq_ai_execution_acceptances_finalization_key").on(t.finalizationKey),
  index("idx_ai_execution_acceptances_project_created").on(t.projectId, t.createdAt),
]);

export type InsertAiExecutionEvidenceSnapshot =
  typeof aiExecutionEvidenceSnapshotsTable.$inferInsert;
export type AiExecutionEvidenceSnapshot =
  typeof aiExecutionEvidenceSnapshotsTable.$inferSelect;
export type InsertAiExecutionEvidenceRead =
  typeof aiExecutionEvidenceReadsTable.$inferInsert;
export type AiExecutionEvidenceRead =
  typeof aiExecutionEvidenceReadsTable.$inferSelect;
export type InsertAiExecutionAcceptance =
  typeof aiExecutionAcceptancesTable.$inferInsert;
export type AiExecutionAcceptance =
  typeof aiExecutionAcceptancesTable.$inferSelect;