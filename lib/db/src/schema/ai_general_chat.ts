import {
  bigint,
  index,
  integer,
  pgEnum,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
} from "drizzle-orm/pg-core";

export const aiGeneralChatMessageRoleEnum = pgEnum(
  "ai_general_chat_message_role",
  ["user", "assistant"],
);

export const aiGeneralChatMessageStatusEnum = pgEnum(
  "ai_general_chat_message_status",
  ["pending", "completed", "failed"],
);

/** General engineering conversations have no project, root, or tool scope. */
export const aiGeneralChatSessionsTable = pgTable(
  "ai_general_chat_sessions",
  {
    id: text("id").primaryKey(),
    ownerId: text("owner_id").notNull(),
    title: text("title").notNull().default("New conversation"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
  },
  (t) => [
    index("idx_ai_general_chat_sessions_owner_updated").on(
      t.ownerId,
      t.updatedAt,
    ),
    index("idx_ai_general_chat_sessions_owner_created").on(
      t.ownerId,
      t.createdAt,
    ),
  ],
);

export const aiGeneralChatMessagesTable = pgTable(
  "ai_general_chat_messages",
  {
    id: text("id").primaryKey(),
    sessionId: text("session_id")
      .notNull()
      .references(() => aiGeneralChatSessionsTable.id, { onDelete: "cascade" }),
    turnId: text("turn_id").notNull(),
    role: aiGeneralChatMessageRoleEnum("role").notNull(),
    content: text("content").notNull(),
    status: aiGeneralChatMessageStatusEnum("status")
      .notNull()
      .default("completed"),
    workerId: text("worker_id"),
    leaseUntil: timestamp("lease_until"),
    errorCode: text("error_code"),
    errorMessage: text("error_message"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("uq_ai_general_chat_messages_session_turn_role").on(
      t.sessionId,
      t.turnId,
      t.role,
    ),
    index("idx_ai_general_chat_messages_session_created").on(
      t.sessionId,
      t.createdAt,
    ),
  ],
);

/**
 * Persistent user-scoped fixed-window limiter for general chat. This is kept
 * separate from the project-scoped rate_limit_windows table.
 */
export const aiGeneralChatRateLimitsTable = pgTable(
  "ai_general_chat_rate_limits",
  {
    ownerId: text("owner_id").notNull(),
    windowBucket: bigint("window_bucket", { mode: "number" }).notNull(),
    callCount: integer("call_count").notNull().default(1),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.ownerId, t.windowBucket] })],
);

export type AiGeneralChatSession =
  typeof aiGeneralChatSessionsTable.$inferSelect;
export type InsertAiGeneralChatSession =
  typeof aiGeneralChatSessionsTable.$inferInsert;
export type AiGeneralChatMessage =
  typeof aiGeneralChatMessagesTable.$inferSelect;
export type InsertAiGeneralChatMessage =
  typeof aiGeneralChatMessagesTable.$inferInsert;
