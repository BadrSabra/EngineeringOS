/**
 * Durable outbox for audit rows whose initial write failed.
 *
 * This is intentionally separate from audit_logs: the audit write can be
 * retried without requiring the destination table write to have succeeded.
 */
import { pgTable, integer, jsonb, timestamp, index, text } from "drizzle-orm/pg-core";

export const pendingAuditLogsTable = pgTable("pending_audit_logs", {
  id: text("id").primaryKey(),
  row: jsonb("row").$type<Record<string, unknown>>().notNull(),
  attempts: integer("attempts").notNull().default(0),
  nextAttemptAt: timestamp("next_attempt_at").notNull(),
  createdAt: timestamp("created_at").notNull().defaultNow(),
}, (t) => [
  index("idx_pending_audit_logs_next_attempt_at").on(t.nextAttemptAt),
]);

export type PendingAuditLog = typeof pendingAuditLogsTable.$inferSelect;