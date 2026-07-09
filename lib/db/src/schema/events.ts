import { pgTable, text, timestamp, jsonb, pgEnum } from "drizzle-orm/pg-core";
import { projectsTable } from "./projects.js";

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
  taskId: text("task_id"),
  workflowId: text("workflow_id"),
  payload: jsonb("payload").$type<Record<string, unknown>>(),
  severity: eventSeverityEnum("severity").notNull().default("info"),
  message: text("message"),
  timestamp: timestamp("timestamp").notNull().defaultNow(),
});

export type InsertEvent = typeof eventsTable.$inferInsert;
export type Event = typeof eventsTable.$inferSelect;
