/**
 * Audit / Provenance store — tracks who did what, on which entity, and when.
 *
 * This is one of the critical gap fixes identified in the project assessment.
 * Every significant state change (task execute, project scan, rule evaluate,
 * workflow start/stop) should insert an audit record so the platform has a
 * verifiable history of all decisions.
 */
import { pgTable, text, timestamp, jsonb, pgEnum, index } from "drizzle-orm/pg-core";
import { projectsTable } from "./projects.js";

export const auditEntityTypeEnum = pgEnum("audit_entity_type", [
  "project",
  "task",
  "rule",
  "workflow",
  "plugin",
  "discovery_session",
]);

export const auditActionEnum = pgEnum("audit_action", [
  "created",
  "updated",
  "deleted",
  "executed",
  "retried",
  "rolled_back",
  "started",
  "stopped",
  "advanced",
  "completed",
  "phase_failed",
  "phase_retried",
  "enabled",
  "disabled",
  "evaluated",
  "imported",
  "scanned",
  "ai_executed",
  "ai_analyzed",
  "ai_reviewed",
  "ai_orchestrated",
  "ai_auto_executed",
  "execution_failed",
  "ai_auto_execution_failed",
]);

export const auditLogsTable = pgTable("audit_logs", {
  id: text("id").primaryKey(),
  /** The type of entity that changed. */
  entityType: auditEntityTypeEnum("entity_type").notNull(),
  /** The ID of the entity that changed. */
  entityId: text("entity_id").notNull(),
  /** The action performed on the entity. */
  action: auditActionEnum("action").notNull(),
  /**
   * Optional: the project context for the change.
   * FK with onDelete: "set null" — audit records must survive project deletion
   * to preserve the historical trail.
   */
  projectId: text("project_id").references(() => projectsTable.id, {
    onDelete: "set null",
  }),
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
  /** Ties this audit record to a logical operation — same value as the
   *  corresponding events/task_logs/metrics rows for the same operation. */
  correlationId: text("correlation_id"),
}, (t) => [
  index("idx_audit_logs_entity_id").on(t.entityId),
  index("idx_audit_logs_project_id").on(t.projectId),
  index("idx_audit_logs_timestamp").on(t.timestamp),
  index("idx_audit_logs_correlation_id").on(t.correlationId),
]);

export type InsertAuditLog = typeof auditLogsTable.$inferInsert;
export type AuditLog = typeof auditLogsTable.$inferSelect;
