import { pgTable, text, timestamp, jsonb, pgEnum, index } from "drizzle-orm/pg-core";
import { projectsTable } from "./projects.js";
import { tasksTable } from "./tasks.js";
import { workflowsTable } from "./workflows.js";

export const eventSeverityEnum = pgEnum("event_severity", [
  "info",
  "warning",
  "error",
  "success",
]);

export const eventsTable = pgTable("events", {
  id: text("id").primaryKey(),
  type: text("type").notNull(),
  projectId: text("project_id")
    .notNull()
    .references(() => projectsTable.id, { onDelete: "cascade" }),
  taskId: text("task_id").references(() => tasksTable.id, { onDelete: "set null" }),
  workflowId: text("workflow_id").references(() => workflowsTable.id, { onDelete: "set null" }),
  payload: jsonb("payload").$type<Record<string, unknown>>(),
  severity: eventSeverityEnum("severity").notNull().default("info"),
  message: text("message").notNull().default(""),
  timestamp: timestamp("timestamp").notNull().defaultNow(),
  /**
   * Soft link to a logical operation (scan, task execute, workflow advance,
   * etc.). All records sharing the same correlationId were produced by one
   * call. Nullable: older rows and operations that span no secondary tables
   * (e.g. a plain project update) carry no correlationId.
   */
  correlationId: text("correlation_id"),
}, (t) => [
  index("idx_events_project_id").on(t.projectId),
  // Covers: WHERE project_id = ? ORDER BY timestamp DESC LIMIT n  (no type filter)
  index("idx_events_project_id_timestamp").on(t.projectId, t.timestamp),
  /**
   * DB-17: Covers the most common filtered query in events.ts:
   *   WHERE project_id = ? AND type = ? ORDER BY timestamp DESC
   * PostgreSQL uses a backward index scan on timestamp, so DESC ordering is
   * served efficiently without a separate sort step.
   */
  index("idx_events_project_id_type_timestamp").on(t.projectId, t.type, t.timestamp),
  /**
   * DB-17: Covers the correlationId scoped lookup in events.ts:
   *   WHERE project_id = ? AND correlation_id = ?
   * The project_id leading column means this index is scoped — a correlationId
   * from a different project cannot accidentally match.
   */
  index("idx_events_project_id_correlation_id").on(t.projectId, t.correlationId),
  // Global timestamp index — kept for admin/dashboard time-range queries
  // that do not have a project_id filter (e.g. system-wide event feed).
  index("idx_events_timestamp").on(t.timestamp),
  // Single-column correlationId index — kept for cross-project audit trail
  // lookups (e.g. "show me everything from correlation X regardless of project").
  index("idx_events_correlation_id").on(t.correlationId),
]);

export type InsertEvent = typeof eventsTable.$inferInsert;
export type Event = typeof eventsTable.$inferSelect;
