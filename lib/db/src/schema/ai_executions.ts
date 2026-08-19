import { pgEnum, pgTable, text, timestamp, integer, index, uniqueIndex } from "drizzle-orm/pg-core";
import { projectsTable } from "./projects.js";
import { aiChatMessagesTable, aiChatSessionsTable } from "./ai_chats.js";
import { tasksTable } from "./tasks.js";

export const aiExecutionStatusEnum = pgEnum("ai_execution_status", [
  "queued",
  "running",
  "paused",
  "cancelling",
  "cancelled",
  "completed",
  "failed",
]);

/**
 * Durable control-plane state for a long-running chat/tool execution.
 *
 * The model/provider call is still performed by the orchestrator, but the
 * ownership, request binding, checkpoints, and terminal result identity live
 * here so an SSE connection is only a subscriber and not the source of truth.
 */
export const aiExecutionsTable = pgTable("ai_executions", {
  id: text("id").primaryKey(),
  projectId: text("project_id")
    .notNull()
    .references(() => projectsTable.id, { onDelete: "cascade" }),
  sessionId: text("session_id")
    .notNull()
    .references(() => aiChatSessionsTable.id, { onDelete: "cascade" }),
  /** Stable server-owned Plan → Build → Apply operation identity. */
  operationId: text("operation_id"),
  linkedTaskId: text("linked_task_id")
    .references(() => tasksTable.id, { onDelete: "set null" }),
  buildPlanMessageId: text("build_plan_message_id")
    .references(() => aiChatMessagesTable.id, { onDelete: "set null" }),
  /** Clerk user id; intentionally not a DB foreign key. */
  userId: text("user_id").notNull(),
  /** Client retry key. A retry with the same key must reuse this execution. */
  idempotencyKey: text("idempotency_key").notNull(),
  /** SHA-256 of the opaque token returned once in execution_started. */
  resumeTokenHash: text("resume_token_hash").notNull(),
  /** Immutable, server-validated request envelope used for explicit resume. */
  request: text("request").notNull(),
  /** Bounded, content-minimized checkpoint/telemetry envelope. */
  checkpoint: text("checkpoint").notNull().default("{}"),
  checkpointVersion: integer("checkpoint_version").notNull().default(0),
  status: aiExecutionStatusEnum("status").notNull().default("queued"),
  workerId: text("worker_id"),
  leaseUntil: timestamp("lease_until"),
  lastHeartbeatAt: timestamp("last_heartbeat_at"),
  cancelRequestedAt: timestamp("cancel_requested_at"),
  error: text("error"),
  finalMessageId: text("final_message_id"),
  proposalId: text("proposal_id"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
  startedAt: timestamp("started_at"),
  completedAt: timestamp("completed_at"),
}, (t) => [
  index("idx_ai_executions_project_status").on(t.projectId, t.status),
  index("idx_ai_executions_session_status").on(t.sessionId, t.status),
  index("idx_ai_executions_status_lease").on(t.status, t.leaseUntil),
  index("idx_ai_executions_linked_task").on(t.linkedTaskId),
  uniqueIndex("uq_ai_executions_user_idempotency").on(t.userId, t.idempotencyKey),
]);

export type InsertAiExecution = typeof aiExecutionsTable.$inferInsert;
export type AiExecution = typeof aiExecutionsTable.$inferSelect;