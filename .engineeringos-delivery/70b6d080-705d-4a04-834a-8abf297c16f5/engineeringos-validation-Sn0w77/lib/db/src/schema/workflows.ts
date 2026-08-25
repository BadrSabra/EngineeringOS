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

/**
 * DB-09: All status columns in this file use pgEnum, which PostgreSQL enforces
 * at the DB level. Inserting a value outside the declared set raises a
 * "invalid input value for enum" error before the row is written. Any new
 * status value requires an explicit schema change (enum alteration + push).
 */
export const workflowStatusEnum = pgEnum("workflow_status", [
  "idle",
  "running",
  "completed",
  "failed",
  "stopped",
]);

export const workflowsTable = pgTable("workflows", {
  id: text("id").primaryKey(),
  projectId: text("project_id")
    .notNull()
    .references(() => projectsTable.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  description: text("description"),
  status: workflowStatusEnum("status").notNull().default("idle"),
  /**
   * DB-15: notNull + default([]) — the phases array is always present even
   * when empty; NULL would indicate corrupt/incomplete data.
   */
  phases: jsonb("phases")
    .$type<Array<{ name: string; steps: string[]; condition?: string }>>()
    .notNull()
    .default([]),
  currentPhase: text("current_phase"),
  executionCount: integer("execution_count").notNull().default(0),
  lastExecutedAt: timestamp("last_executed_at"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
}, (t) => [
  // Covers: WHERE project_id = ? ORDER BY created_at DESC
  index("idx_workflows_project_id_created_at").on(t.projectId, t.createdAt),
  index("idx_workflows_status").on(t.status),
]);

export const workflowExecutionsTable = pgTable("workflow_executions", {
  id: text("id").primaryKey(),
  workflowId: text("workflow_id")
    .notNull()
    .references(() => workflowsTable.id, { onDelete: "cascade" }),
  status: workflowStatusEnum("status").notNull().default("running"),
  currentPhase: text("current_phase"),
  /**
   * DB-15: notNull + default([]) — always an array, never NULL; NULL would
   * mean "unknown phases completed" which is different from "none completed".
   */
  completedPhases: jsonb("completed_phases").$type<string[]>().notNull().default([]),
  startedAt: timestamp("started_at").notNull().defaultNow(),
  completedAt: timestamp("completed_at"),
  errorMessage: text("error_message"),
}, (t) => [
  // Covers: WHERE workflow_id = ? (fetch all executions for a workflow)
  index("idx_wf_executions_workflow_id").on(t.workflowId),
  // Covers: WHERE workflow_id = ? ORDER BY started_at DESC (latest execution lookup)
  index("idx_wf_executions_workflow_id_started_at").on(t.workflowId, t.startedAt),
  // Covers: WHERE status = ? (e.g. find all running executions for reconciliation)
  index("idx_wf_executions_status").on(t.status),
  // Covers: WHERE workflow_id = ? AND status = ? (start/stop/retry guards)
  index("idx_wf_executions_workflow_id_status").on(t.workflowId, t.status),
]);

export type InsertWorkflow = typeof workflowsTable.$inferInsert;
export type Workflow = typeof workflowsTable.$inferSelect;
export type WorkflowExecution = typeof workflowExecutionsTable.$inferSelect;
