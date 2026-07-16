import { pgTable, text, timestamp, pgEnum } from "drizzle-orm/pg-core";
import { projectsTable } from "./projects.js";

export const aiMessageRoleEnum = pgEnum("ai_message_role", [
  "user",
  "assistant",
  "system",
]);

export const aiChatSessionsTable = pgTable("ai_chat_sessions", {
  id: text("id").primaryKey(),
  projectId: text("project_id")
    .notNull()
    .references(() => projectsTable.id, { onDelete: "cascade" }),
  title: text("title").notNull().default("New Chat"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

export const aiChatMessagesTable = pgTable("ai_chat_messages", {
  id: text("id").primaryKey(),
  sessionId: text("session_id")
    .notNull()
    .references(() => aiChatSessionsTable.id, { onDelete: "cascade" }),
  role: aiMessageRoleEnum("role").notNull(),
  content: text("content").notNull(),
  /** JSON array of source strings (file paths, node names, etc.) */
  sources: text("sources"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export type InsertAiChatSession = typeof aiChatSessionsTable.$inferInsert;
export type AiChatSession = typeof aiChatSessionsTable.$inferSelect;
export type InsertAiChatMessage = typeof aiChatMessagesTable.$inferInsert;
export type AiChatMessage = typeof aiChatMessagesTable.$inferSelect;
