import { pgTable, text, timestamp } from "drizzle-orm/pg-core";

/**
 * Durable cursors for bounded startup/retention maintenance. Each maintenance
 * job advances its cursor in the same transaction as its data updates.
 */
export const startupMaintenanceStateTable = pgTable("startup_maintenance_state", {
  maintenanceKey: text("maintenance_key").primaryKey(),
  cursorAt: timestamp("cursor_at", { withTimezone: true }),
  cursorId: text("cursor_id"),
  completedAt: timestamp("completed_at", { withTimezone: true }),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});
