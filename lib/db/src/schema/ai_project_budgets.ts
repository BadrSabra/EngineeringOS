import { pgTable, text, timestamp, integer, real, uniqueIndex, index } from "drizzle-orm/pg-core";
import { projectsTable } from "./projects.js";

/**
 * Project-owned daily AI budget configuration. This table is deliberately
 * separate from execution/evidence state: it governs provider admission only.
 */
export const aiProjectBudgetsTable = pgTable("ai_project_budgets", {
  id: text("id").primaryKey(),
  schemaVersion: integer("schema_version").notNull().default(1),
  projectId: text("project_id").notNull().references(() => projectsTable.id, { onDelete: "cascade" }),
  ownerId: text("owner_id").notNull(),
  dailyAttemptLimit: integer("daily_attempt_limit").notNull().default(100),
  dailyTokenLimit: integer("daily_token_limit").notNull().default(100000),
  warningThreshold: real("warning_threshold").notNull().default(0.8),
  resetAt: timestamp("reset_at").notNull(),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
}, (t) => [
  uniqueIndex("uq_ai_project_budgets_project").on(t.projectId),
  index("idx_ai_project_budgets_owner").on(t.ownerId),
]);

export const aiBudgetReservationStatusEnum = ["reserved", "consumed"] as const;
export type AiBudgetReservationStatus = (typeof aiBudgetReservationStatusEnum)[number];

/**
 * Short-lived admission ledger. One attemptId may reserve exactly one provider
 * call, including fallback calls, and is reconciled when telemetry is written.
 */
export const aiBudgetReservationsTable = pgTable("ai_budget_reservations", {
  id: text("id").primaryKey(),
  projectId: text("project_id").notNull().references(() => projectsTable.id, { onDelete: "cascade" }),
  ownerId: text("owner_id").notNull(),
  attemptId: text("attempt_id").notNull(),
  utcDay: text("utc_day").notNull(),
  status: text("status").notNull().default("reserved"),
  reservedAt: timestamp("reserved_at").notNull().defaultNow(),
  reconciledAt: timestamp("reconciled_at"),
}, (t) => [
  uniqueIndex("uq_ai_budget_reservations_attempt").on(t.attemptId),
  index("idx_ai_budget_reservations_project_day").on(t.projectId, t.utcDay),
]);

export type AiProjectBudget = typeof aiProjectBudgetsTable.$inferSelect;
export type InsertAiProjectBudget = typeof aiProjectBudgetsTable.$inferInsert;
export type AiBudgetReservation = typeof aiBudgetReservationsTable.$inferSelect;