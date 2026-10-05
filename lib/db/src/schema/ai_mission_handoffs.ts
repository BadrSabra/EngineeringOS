import {
  index,
  jsonb,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
} from "drizzle-orm/pg-core";
import { aiChatMessagesTable, aiChatSessionsTable } from "./ai_chats.js";
import { aiMissionsTable } from "./ai_missions.js";
import { projectsTable } from "./projects.js";

export const aiMissionHandoffDispatchStatusEnum = pgEnum(
  "ai_mission_handoff_dispatch_status",
  ["pending", "dispatched"],
);

/**
 * Durable Chat-to-Mission identity link and dispatch outbox.
 *
 * The idempotency key represents one explicit user confirmation. The outbox
 * record is committed with the Mission plan, then consumed through the
 * existing Mission Goal runner; it is not a second execution runtime.
 */
export const aiMissionHandoffsTable = pgTable("ai_mission_handoffs", {
  id: text("id").primaryKey(),
  projectId: text("project_id")
    .notNull()
    .references(() => projectsTable.id, { onDelete: "cascade" }),
  userId: text("user_id").notNull(),
  missionId: text("mission_id")
    .notNull()
    .references(() => aiMissionsTable.id, { onDelete: "cascade" }),
  sessionId: text("session_id")
    .references(() => aiChatSessionsTable.id, { onDelete: "set null" }),
  messageId: text("message_id")
    .references(() => aiChatMessagesTable.id, { onDelete: "set null" }),
  assistantMessageId: text("assistant_message_id")
    .references(() => aiChatMessagesTable.id, { onDelete: "set null" }),
  idempotencyKey: text("idempotency_key").notNull(),
  requestHash: text("request_hash").notNull(),
  planHash: text("plan_hash").notNull(),
  preview: jsonb("preview").$type<Record<string, unknown>>().notNull(),
  activationPlan: jsonb("activation_plan")
    .$type<{
      revision: string;
      goals: Array<{
        stepId: string;
        goalId: string;
        taskId: string | null;
        dependencies: string[];
      }>;
      primary: {
        stepId: string;
        goalId: string;
        taskId: string | null;
        dependencies: string[];
      };
    }>()
    .notNull(),
  dispatchGoalIds: jsonb("dispatch_goal_ids").$type<string[]>().notNull(),
  dispatchStatus: aiMissionHandoffDispatchStatusEnum("dispatch_status")
    .notNull()
    .default("pending"),
  dispatchedAt: timestamp("dispatched_at"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
}, (t) => [
  uniqueIndex("uq_ai_mission_handoffs_mission_id").on(t.missionId),
  uniqueIndex("uq_ai_mission_handoffs_user_idempotency")
    .on(t.userId, t.idempotencyKey),
  index("idx_ai_mission_handoffs_session_id").on(t.sessionId),
  index("idx_ai_mission_handoffs_dispatch")
    .on(t.dispatchStatus, t.createdAt),
]);

export type InsertAiMissionHandoff = typeof aiMissionHandoffsTable.$inferInsert;
export type AiMissionHandoff = typeof aiMissionHandoffsTable.$inferSelect;
