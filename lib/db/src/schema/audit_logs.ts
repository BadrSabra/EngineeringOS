/**
 * Audit / Provenance store — tracks who did what, on which entity, and when.
 *
 * This is one of the critical gap fixes identified in the project assessment.
 * Every significant state change (task execute, project scan, rule evaluate,
 * workflow start/stop) should insert an audit record so the platform has a
 * verifiable history of all decisions.
 */
import { pgTable, text, timestamp, jsonb } from "drizzle-orm/pg-core";

export const auditLogsTable = pgTable("audit_logs", {
  id: text("id").primaryKey(),
  /** The type of entity that changed (project, task, rule, workflow, plugin). */
  entityType: text("entity_type").notNull(),
  /** The ID of the entity that changed. */
  entityId: text("entity_id").notNull(),
  /** The action performed (created, updated, deleted, executed, scanned, evaluated, started, stopped). */
  action: text("action").notNull(),
  /** Optional: the project context for the change. */
  projectId: text("project_id"),
  /** Who triggered the change (system, user, agent). */
  actor: text("actor").notNull().default("system"),
  /** Snapshot of the fields that changed (key → new value). */
  changedFields: jsonb("changed_fields").$type<Record<string, unknown>>(),
  /** State before the change (for reversibility). */
  stateBefore: jsonb("state_before").$type<Record<string, unknown>>(),
  /** State after the change (for traceability). */
  stateAfter: jsonb("state_after").$type<Record<string, unknown>>(),
  /** Optional: additional context about why this change was made. */
  reason: text("reason"),
  timestamp: timestamp("timestamp").notNull().defaultNow(),
});

export type InsertAuditLog = typeof auditLogsTable.$inferInsert;
export type AuditLog = typeof auditLogsTable.$inferSelect;
