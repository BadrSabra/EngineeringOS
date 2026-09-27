import {
  boolean,
  index,
  jsonb,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
} from "drizzle-orm/pg-core";
import { pluginsTable } from "./plugins.js";
import { projectsTable } from "./projects.js";

/**
 * Project-owned activation for a globally governed plugin definition.
 * `plugins.enabled` remains the global availability ceiling; this binding
 * only authorizes the plugin's project-scoped scan hook for one project.
 */
export const projectPluginBindingsTable = pgTable(
  "project_plugin_bindings",
  {
    id: text("id").primaryKey(),
    projectId: text("project_id")
      .notNull()
      .references(() => projectsTable.id, { onDelete: "cascade" }),
    pluginId: text("plugin_id")
      .notNull()
      .references(() => pluginsTable.id, { onDelete: "cascade" }),
    enabled: boolean("enabled").notNull().default(false),
    configuration: jsonb("configuration")
      .$type<Record<string, unknown>>()
      .notNull()
      .default({}),
    approvedBy: text("approved_by"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("uq_project_plugin_bindings_project_plugin").on(
      table.projectId,
      table.pluginId,
    ),
    index("idx_project_plugin_bindings_project_enabled").on(
      table.projectId,
      table.enabled,
    ),
  ],
);

export type InsertProjectPluginBinding =
  typeof projectPluginBindingsTable.$inferInsert;
export type ProjectPluginBinding =
  typeof projectPluginBindingsTable.$inferSelect;