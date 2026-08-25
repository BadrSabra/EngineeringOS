import { pgTable, text, timestamp, integer, jsonb, uniqueIndex, index } from "drizzle-orm/pg-core";
import { projectsTable } from "./projects.js";

/** A project-owned, server-executable browser contract. */
export const browserValidationProfilesTable = pgTable("browser_validation_profiles", {
  id: text("id").primaryKey(),
  projectId: text("project_id").notNull().references(() => projectsTable.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  revision: text("revision").notNull(),
  permittedOrigin: text("permitted_origin").notNull(),
  steps: jsonb("steps").notNull(),
  timeoutMs: integer("timeout_ms").notNull(),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
}, (t) => [
  uniqueIndex("uq_browser_validation_profiles_project_name").on(t.projectId, t.name),
  index("idx_browser_validation_profiles_project").on(t.projectId),
]);

export type BrowserValidationProfile = typeof browserValidationProfilesTable.$inferSelect;
export type InsertBrowserValidationProfile = typeof browserValidationProfilesTable.$inferInsert;