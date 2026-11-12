import { createInsertSchema } from "drizzle-zod";
import {
  index,
  integer,
  pgTable,
  text,
  timestamp,
  uuid,
} from "drizzle-orm/pg-core";
import { z } from "zod/v4";
import { projectsTable } from "./projects.js";
import { aiChangeProposalsTable } from "./ai_change_proposals.js";
import { previewSessionsTable } from "./preview-sessions.js";

/**
 * One-time redemption ledger for signed Preview access tickets.
 *
 * This is not a Preview session registry: it stores only the ticket digest,
 * its server-verified binding, and redemption/expiry timestamps.
 */
export const previewAccessTicketsTable = pgTable(
  "preview_access_tickets",
  {
    ticketDigest: text("ticket_digest").primaryKey(),
    projectId: text("project_id")
      .notNull()
      .references(() => projectsTable.id, { onDelete: "cascade" }),
    userId: text("user_id").notNull(),
    previewSessionId: uuid("preview_session_id")
      .notNull()
      .references(() => previewSessionsTable.id, { onDelete: "cascade" }),
    proposalId: text("proposal_id")
      .notNull()
      .references(() => aiChangeProposalsTable.id, { onDelete: "restrict" }),
    proposalRevision: integer("proposal_revision").notNull(),
    candidateRevision: text("candidate_revision").notNull(),
    changeSetHash: text("change_set_hash").notNull(),
    issuedAt: timestamp("issued_at", { withTimezone: true }).notNull(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    consumedAt: timestamp("consumed_at", { withTimezone: true }),
  },
  (table) => [
    index("idx_preview_access_tickets_expires_at").on(table.expiresAt),
  ],
);

export const insertPreviewAccessTicketSchema = createInsertSchema(
  previewAccessTicketsTable,
).omit({
  consumedAt: true,
});

export type InsertPreviewAccessTicket = z.infer<
  typeof insertPreviewAccessTicketSchema
>;
export type PreviewAccessTicket = typeof previewAccessTicketsTable.$inferSelect;
