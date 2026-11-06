import { integer, pgTable, text, timestamp } from "drizzle-orm/pg-core";

/**
 * Last durable reconciliation outcome per dispatcher stage. This is operational
 * health only; it does not grant or change ownership of any queued work.
 */
export const durableDispatchStageHealthTable = pgTable("durable_dispatch_stage_health", {
  stageName: text("stage_name").primaryKey(),
  lastOutcome: text("last_outcome").notNull().default("unknown"),
  lastRunAt: timestamp("last_run_at").notNull().defaultNow(),
  lastSuccessAt: timestamp("last_success_at"),
  lastFailureAt: timestamp("last_failure_at"),
  consecutiveFailures: integer("consecutive_failures").notNull().default(0),
  lastErrorCode: text("last_error_code"),
  lastDispatchedCount: integer("last_dispatched_count").notNull().default(0),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

export type DurableDispatchStageHealth =
  typeof durableDispatchStageHealthTable.$inferSelect;
