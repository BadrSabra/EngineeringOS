import { pgTable, text, timestamp, jsonb, pgEnum } from "drizzle-orm/pg-core";
import { projectsTable } from "./projects.js";

export const entityTypeEnum = pgEnum("entity_type", [
  "file",
  "function",
  "class",
  "api",
  "task",
  "rule",
  "phase",
  "module",
]);

export const graphEntitiesTable = pgTable("graph_entities", {
  id: text("id").primaryKey(),
  projectId: text("project_id")
    .notNull()
    .references(() => projectsTable.id, { onDelete: "cascade" }),
  type: entityTypeEnum("type").notNull(),
  name: text("name").notNull(),
  path: text("path"),
  metadata: jsonb("metadata").$type<Record<string, unknown>>(),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export const graphRelationshipsTable = pgTable("graph_relationships", {
  id: text("id").primaryKey(),
  sourceId: text("source_id")
    .notNull()
    .references(() => graphEntitiesTable.id, { onDelete: "cascade" }),
  targetId: text("target_id")
    .notNull()
    .references(() => graphEntitiesTable.id, { onDelete: "cascade" }),
  relation: text("relation").notNull(),
  metadata: jsonb("metadata").$type<Record<string, unknown>>(),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export type InsertGraphEntity = typeof graphEntitiesTable.$inferInsert;
export type GraphEntity = typeof graphEntitiesTable.$inferSelect;
export type InsertGraphRelationship =
  typeof graphRelationshipsTable.$inferInsert;
export type GraphRelationship = typeof graphRelationshipsTable.$inferSelect;
