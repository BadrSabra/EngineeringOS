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
  index("idx_events_timestamp").on(t.timestamp),
  index("idx_events_correlation_id").on(t.correlationId),
]);

export type InsertEvent = typeof eventsTable.$inferInsert;
export type Event = typeof eventsTable.$inferSelect;
