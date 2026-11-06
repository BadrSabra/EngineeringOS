import { sql } from "drizzle-orm";
import { createInsertSchema } from "drizzle-zod";
import {
  check,
  index,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
} from "drizzle-orm/pg-core";
import { pluginsTable } from "./plugins.js";
import { projectsTable } from "./projects.js";
import { scanJobsTable } from "./scan_jobs.js";

/**
 * Durable input snapshot for one completed scan's built-in plugin hooks.
 * Its ID is the scan correlation ID, so plugin output remains traceable after
 * the scan worker exits or the API restarts.
 */
export const pluginDispatchBatchesTable = pgTable(
  "plugin_dispatch_batches",
  {
    id: text("id").primaryKey(),
    projectId: text("project_id")
      .notNull()
      .references(() => projectsTable.id, { onDelete: "cascade" }),
    scanJobId: text("scan_job_id").references(() => scanJobsTable.id, {
      onDelete: "set null",
    }),
    context: jsonb("context").$type<Record<string, unknown>>().notNull(),
    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (table) => [
    index("idx_plugin_dispatch_batches_project_created").on(
      table.projectId,
      table.createdAt,
    ),
  ],
);

/**
 * One leased, retryable execution for each plugin participating in a scan.
 * Event writes and the completed transition are committed atomically.
 */
export const pluginRunsTable = pgTable(
  "plugin_runs",
  {
    id: text("id").primaryKey(),
    dispatchId: text("dispatch_id")
      .notNull()
      .references(() => pluginDispatchBatchesTable.id, { onDelete: "cascade" }),
    pluginId: text("plugin_id")
      .notNull()
      .references(() => pluginsTable.id, { onDelete: "restrict" }),
    pluginVersion: text("plugin_version").notNull(),
    status: text("status").notNull().default("pending"),
    attemptCount: integer("attempt_count").notNull().default(0),
    maxAttempts: integer("max_attempts").notNull().default(3),
    nextAttemptAt: timestamp("next_attempt_at").notNull().defaultNow(),
    workerId: text("worker_id"),
    leaseUntil: timestamp("lease_until"),
    resultEvents: jsonb("result_events").$type<Record<string, unknown>[]>(),
    lastErrorCode: text("last_error_code"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
    startedAt: timestamp("started_at"),
    finishedAt: timestamp("finished_at"),
  },
  (table) => [
    uniqueIndex("uq_plugin_runs_dispatch_plugin").on(
      table.dispatchId,
      table.pluginId,
    ),
    index("idx_plugin_runs_pending").on(table.status, table.nextAttemptAt),
    index("idx_plugin_runs_expired_lease").on(table.status, table.leaseUntil),
    check(
      "chk_plugin_runs_status",
      sql`${table.status} IN ('pending', 'running', 'completed', 'failed')`,
    ),
    check(
      "chk_plugin_runs_attempt_budget",
      sql`${table.attemptCount} >= 0 AND ${table.maxAttempts} > 0 AND ${table.attemptCount} <= ${table.maxAttempts}`,
    ),
  ],
);

export type InsertPluginDispatchBatch =
  typeof pluginDispatchBatchesTable.$inferInsert;
export type PluginDispatchBatch =
  typeof pluginDispatchBatchesTable.$inferSelect;
export type InsertPluginRun = typeof pluginRunsTable.$inferInsert;
export type PluginRun = typeof pluginRunsTable.$inferSelect;
export const insertPluginDispatchBatchSchema = createInsertSchema(pluginDispatchBatchesTable);
export const insertPluginRunSchema = createInsertSchema(pluginRunsTable);
