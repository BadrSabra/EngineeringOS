import {
  pgTable,
  text,
  timestamp,
  integer,
  jsonb,
  pgEnum,
  index,
} from "drizzle-orm/pg-core";
import { projectsTable } from "./projects.js";
import { rulesTable } from "./rules.js";
import { workflowsTable } from "./workflows.js";

export const taskStatusEnum = pgEnum("task_status", [
  "pending",
  "queued",
  "running",
  "verifying",
  "completed",
  "failed",
  "cancelled",
]);

export const taskPriorityEnum = pgEnum("task_priority", [
  "p0",
  "p1",
  "p2",
  "p3",
]);

export const tasksTable = pgTable("tasks", {
  id: text("id").primaryKey(),
  projectId: text("project_id")
    .notNull()
    .references(() => projectsTable.id, { onDelete: "cascade" }),
  ruleId: text("rule_id").references(() => rulesTable.id, { onDelete: "set null" }),
  workflowId: text("workflow_id").references(() => workflowsTable.id, { onDelete: "set null" }),
  title: text("title").notNull(),
  description: text("description"),
  status: taskStatusEnum("status").notNull().default("pending"),
  priority: taskPriorityEnum("priority").notNull().default("p2"),
  relatedFiles: jsonb("related_files").$type<string[]>().default([]),
  dependsOn: jsonb("depends_on").$type<string[]>().default([]),
  retryCount: integer("retry_count").notNull().default(0),
  maxRetries: integer("max_retries").notNull().default(3),
  phase: text("phase"),
  prompt: text("prompt"),
  agentResponse: text("agent_response"),
  verificationResult: jsonb("verification_result").$type<{
    passed: boolean;
    steps: Array<{ name: string; passed: boolean; output?: string }>;
  }>(),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
  completedAt: timestamp("completed_at"),
  /** Ties a task created by a scan/discovery run to that operation's trace
   *  (same value as the corresponding events/metrics/audit_logs rows). */
  correlationId: text("correlation_id"),
}, (t) => [
  index("idx_tasks_project_id").on(t.projectId),
  index("idx_tasks_status").on(t.status),
  index("idx_tasks_priority").on(t.priority),
  index("idx_tasks_correlation_id").on(t.correlationId),
]);

export type InsertTask = typeof tasksTable.$inferInsert;
export type Task = typeof tasksTable.$inferSelect;
