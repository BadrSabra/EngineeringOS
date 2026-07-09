import { pgTable, text, timestamp, boolean, jsonb } from "drizzle-orm/pg-core";

export const pluginsTable = pgTable("plugins", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  description: text("description"),
  version: text("version").notNull(),
  enabled: boolean("enabled").notNull().default(true),
  capabilities: jsonb("capabilities").$type<string[]>().default([]),
  supportedLanguages: jsonb("supported_languages").$type<string[]>().default([]),
  config: jsonb("config").$type<Record<string, unknown>>(),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

export type InsertPlugin = typeof pluginsTable.$inferInsert;
export type Plugin = typeof pluginsTable.$inferSelect;
