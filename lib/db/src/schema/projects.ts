import { pgTable, text, timestamp, real, pgEnum } from "drizzle-orm/pg-core";

export const projectStatusEnum = pgEnum("project_status", [
  "active",
  "scanning",
  "paused",
  "archived",
]);

export const projectsTable = pgTable("projects", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  description: text("description"),
  rootPath: text("root_path").notNull(),
  language: text("language").notNull(),
  framework: text("framework"),
  status: projectStatusEnum("status").notNull().default("active"),
  qualityScore: real("quality_score"),
  lastScanAt: timestamp("last_scan_at"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

export type InsertProject = typeof projectsTable.$inferInsert;
export type Project = typeof projectsTable.$inferSelect;
