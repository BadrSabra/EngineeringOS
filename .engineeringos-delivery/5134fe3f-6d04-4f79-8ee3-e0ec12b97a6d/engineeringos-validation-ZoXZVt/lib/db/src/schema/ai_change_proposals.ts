import { pgEnum, pgTable, text, timestamp, integer, boolean, index } from "drizzle-orm/pg-core";
import { projectsTable } from "./projects.js";
import { aiChatMessagesTable, aiChatSessionsTable } from "./ai_chats.js";

export const aiChangeProposalStatusEnum = pgEnum("ai_change_proposal_status", [
  "pending",
  "applied",
  "rejected",
]);
export const aiDeliveryLifecycleEnum = pgEnum("ai_delivery_lifecycle", [
  "proposed",
  "isolated",
  "validated",
  "applied",
  "conflicted",
  "committed",
  "cancelled",
  "abandoned",
  "blocked",
]);

/**
 * Server-owned approval envelope for AI file changes.
 *
 * The dashboard may display and submit a copy of the changes, but the API
 * applies only the exact payload persisted here after the user approves it.
 */
export const aiChangeProposalsTable = pgTable("ai_change_proposals", {
  id: text("id").primaryKey(),
  projectId: text("project_id")
    .notNull()
    .references(() => projectsTable.id, { onDelete: "cascade" }),
  sessionId: text("session_id")
    .notNull()
    .references(() => aiChatSessionsTable.id, { onDelete: "cascade" }),
  messageId: text("message_id")
    .notNull()
    .references(() => aiChatMessagesTable.id, { onDelete: "cascade" }),
  /** JSON-serialized server-produced PendingChange[] */
  changes: text("changes").notNull(),
  status: aiChangeProposalStatusEnum("status").notNull().default("pending"),
  /** Incremented whenever a stale patch is rebased onto new source content. */
  revision: integer("revision").notNull().default(0),
  /** Server gate raised by rebase; applying requires explicit re-approval. */
  approvalRequired: boolean("approval_required").notNull().default(false),
  /** Stable operation identity shared by workspace, evidence, commit, and push. */
  operationId: text("operation_id"),
  /** Server-owned isolated workspace; never supplied by the client. */
  workspaceRoot: text("workspace_root"),
  /** Git/tree revision from which this change set was produced. */
  baseRevision: text("base_revision"),
  changeSetHash: text("change_set_hash"),
  lifecycle: aiDeliveryLifecycleEnum("lifecycle").notNull().default("proposed"),
  conflictReason: text("conflict_reason"),
  validationEvidence: text("validation_evidence"),
  committedHash: text("committed_hash"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  consumedAt: timestamp("consumed_at"),
}, (t) => [
  index("idx_ai_change_proposals_project_status").on(t.projectId, t.status),
  index("idx_ai_change_proposals_session_id").on(t.sessionId),
  index("idx_ai_change_proposals_message_id").on(t.messageId),
]);

export type InsertAiChangeProposal = typeof aiChangeProposalsTable.$inferInsert;
export type AiChangeProposal = typeof aiChangeProposalsTable.$inferSelect;