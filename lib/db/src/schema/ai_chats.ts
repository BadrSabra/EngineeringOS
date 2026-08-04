import { pgTable, text, timestamp, pgEnum, index, real } from "drizzle-orm/pg-core";
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
}, (t) => [
  // Covers: WHERE project_id = ? (session list for a project)
  index("idx_ai_chat_sessions_project_id").on(t.projectId),
  // Covers: WHERE project_id = ? ORDER BY updated_at DESC (most-recent sessions)
  index("idx_ai_chat_sessions_project_id_updated_at").on(t.projectId, t.updatedAt),
]);

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
}, (t) => [
  // Covers: WHERE session_id = ? (load all messages for a session)
  index("idx_ai_chat_messages_session_id").on(t.sessionId),
  // Covers: WHERE session_id = ? ORDER BY created_at ASC (chronological thread)
  index("idx_ai_chat_messages_session_id_created_at").on(t.sessionId, t.createdAt),
]);

export type InsertAiChatSession = typeof aiChatSessionsTable.$inferInsert;
export type AiChatSession = typeof aiChatSessionsTable.$inferSelect;
export type InsertAiChatMessage = typeof aiChatMessagesTable.$inferInsert;
export type AiChatMessage = typeof aiChatMessagesTable.$inferSelect;

// ── AI Session Memories ───────────────────────────────────────────────────────

export const aiMemoryTypeEnum = pgEnum("ai_memory_type", [
  "file_summary",
  "entity_fact",
  "session_summary",
  "key_finding",
]);

/**
 * Cross-session memory: stores summaries of files accessed and key findings
 * from each chat session so subsequent sessions can skip re-discovery.
 *
 * Populated at the end of every successful chat exchange; injected into the
 * system prompt at the start of the next session for the same project.
 *
 * Relevance decays 10% per day on each sweep cycle; rows are pruned when
 * relevance drops below 0.1 or when expires_at passes (default 30 days).
 */
export const aiSessionMemoriesTable = pgTable("ai_session_memories", {
  id: text("id").primaryKey(),
  projectId: text("project_id")
    .notNull()
    .references(() => projectsTable.id, { onDelete: "cascade" }),
  sessionId: text("session_id")
    .notNull()
    .references(() => aiChatSessionsTable.id, { onDelete: "cascade" }),
  memoryType: aiMemoryTypeEnum("memory_type").notNull(),
  content: text("content").notNull(),
  /** Absolute or project-relative path for file_summary / entity_fact rows. */
  sourcePath: text("source_path"),
  /** 0.0 – 1.0: decays over time; rows below 0.1 are pruned on sweep. */
  relevance: real("relevance").notNull().default(1.0),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  /** Hard expiry — null means never expires. Default: createdAt + 30 days. */
  expiresAt: timestamp("expires_at"),
}, (t) => [
  // Covers: WHERE project_id = ? ORDER BY relevance DESC (context fetch)
  index("idx_ai_session_memories_project_rel").on(t.projectId, t.relevance),
  // Covers: WHERE session_id = ? (write-back by session)
  index("idx_ai_session_memories_session_id").on(t.sessionId),
  // Covers: WHERE expires_at < NOW() (daily sweep)
  index("idx_ai_session_memories_expires_at").on(t.expiresAt),
]);

export type InsertAiSessionMemory = typeof aiSessionMemoriesTable.$inferInsert;
export type AiSessionMemory = typeof aiSessionMemoriesTable.$inferSelect;
