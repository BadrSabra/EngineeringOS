import { pgTable, text, timestamp, integer, jsonb, index, uniqueIndex } from "drizzle-orm/pg-core";
import { projectsTable } from "./projects.js";
import { aiChangeProposalsTable } from "./ai_change_proposals.js";

/**
 * Append-only server journal for approval-gated file apply operations.
 *
 * operationId is stable across the Plan -> Apply -> Commit -> Push lifecycle.
 * attemptId distinguishes retries of the same logical operation, while sequence
 * preserves the order of durable apply stages within one attempt.
 */
export const aiApplyJournalTable = pgTable("ai_apply_journal", {
  id: text("id").primaryKey(),
  operationId: text("operation_id").notNull(),
  attemptId: text("attempt_id").notNull(),
  projectId: text("project_id")
    .notNull()
    .references(() => projectsTable.id, { onDelete: "cascade" }),
  proposalId: text("proposal_id")
    .notNull()
    .references(() => aiChangeProposalsTable.id, { onDelete: "cascade" }),
  stage: text("stage").notNull(),
  sequence: integer("sequence").notNull(),
  payload: jsonb("payload").$type<Record<string, unknown>>().notNull(),
  createdAt: timestamp("created_at").notNull().defaultNow(),
}, (t) => [
  index("idx_ai_apply_journal_operation_created").on(t.operationId, t.createdAt),
  index("idx_ai_apply_journal_project_created").on(t.projectId, t.createdAt),
  index("idx_ai_apply_journal_proposal_sequence").on(t.proposalId, t.sequence),
  uniqueIndex("uq_ai_apply_journal_attempt_sequence").on(t.attemptId, t.sequence),
]);

export type InsertAiApplyJournal = typeof aiApplyJournalTable.$inferInsert;
export type AiApplyJournal = typeof aiApplyJournalTable.$inferSelect;