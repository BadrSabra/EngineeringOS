import { pgTable, text, timestamp, jsonb, pgEnum, index } from "drizzle-orm/pg-core";
import { tasksTable } from "./tasks.js";

export const logLevelEnum = pgEnum("log_level", [
  "debug",
  "info",
  "warn",
  "error",
]);

export const taskLogsTable = pgTable("task_logs", {
  id: text("id").primaryKey(),
  taskId: text("task_id")
    .notNull()
    .references(() => tasksTable.id, { onDelete: "cascade" }),
  level: logLevelEnum("level").notNull().default("info"),
  message: text("message").notNull(),
  metadata: jsonb("metadata").$type<Record<string, unknown>>(),
  timestamp: timestamp("timestamp").notNull().defaultNow(),
  /** Ties this log line to the logical operation that produced it. */
  correlationId: text("correlation_id"),
}, (t) => [
  // Covers: WHERE task_id = ?
  index("idx_task_logs_task_id").on(t.taskId),
  // Covers: WHERE task_id = ? ORDER BY timestamp DESC (paginated log reads)
  index("idx_task_logs_task_id_timestamp").on(t.taskId, t.timestamp),
  // Covers: WHERE correlation_id = ? (trace linking across tables)
  index("idx_task_logs_correlation_id").on(t.correlationId),
]);

export type InsertTaskLog = typeof taskLogsTable.$inferInsert;
export type TaskLog = typeof taskLogsTable.$inferSelect;
