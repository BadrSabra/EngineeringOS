import { pgTable, text, timestamp, jsonb, pgEnum, index, integer } from "drizzle-orm/pg-core";
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
  /** Publicly safe structured progress event kind. Null is retained for legacy log rows. */
  eventType: text("event_type"),
  /** Server-owned execution identity for structured progress events. */
  executionId: text("execution_id"),
  /** Immutable execution attempt associated with this event. */
  attempt: integer("attempt"),
  /** Monotonic per-task cursor used by REST and SSE replay across executions. */
  sequence: integer("sequence"),
  /** Public progress stage, never populated from model text. */
  progressStage: text("progress_stage"),
  /** Public lifecycle state for the progress stage. */
  progressStatus: text("progress_status"),
  /** Server-computed percentage; null means indeterminate. */
  progressPercent: integer("progress_percent"),
  /** Safe bounded progress message. */
  progressMessage: text("progress_message"),
  /** Stage timing for active/completed progress events. */
  startedAt: timestamp("started_at"),
  finishedAt: timestamp("finished_at"),
  /** Server-owned terminal outcome, present only on terminal events. */
  terminalOutcome: text("terminal_outcome"),
}, (t) => [
  // Covers: WHERE task_id = ?
  index("idx_task_logs_task_id").on(t.taskId),
  // Covers: WHERE task_id = ? ORDER BY timestamp DESC (paginated log reads)
  index("idx_task_logs_task_id_timestamp").on(t.taskId, t.timestamp),
  // Covers: WHERE correlation_id = ? (trace linking across tables)
  index("idx_task_logs_correlation_id").on(t.correlationId),
  index("idx_task_logs_task_execution_sequence").on(t.taskId, t.executionId, t.sequence),
]);

export type InsertTaskLog = typeof taskLogsTable.$inferInsert;
export type TaskLog = typeof taskLogsTable.$inferSelect;
