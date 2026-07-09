import {
  pgTable,
  text,
  timestamp,
  integer,
  jsonb,
  pgEnum,
} from "drizzle-orm/pg-core";
import { projectsTable } from "./projects.js";

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
  phases: jsonb("phases")
    .$type<Array<{ name: string; steps: string[]; condition?: string }>>()
    .default([]),
  currentPhase: text("current_phase"),
  executionCount: integer("execution_count").notNull().default(0),
  lastExecutedAt: timestamp("last_executed_at"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

export const workflowExecutionsTable = pgTable("workflow_executions", {
  id: text("id").primaryKey(),
  workflowId: text("workflow_id")
    .notNull()
    .references(() => workflowsTable.id, { onDelete: "cascade" }),
  status: workflowStatusEnum("status").notNull().default("running"),
  currentPhase: text("current_phase"),
  completedPhases: jsonb("completed_phases").$type<string[]>().default([]),
  startedAt: timestamp("started_at").notNull().defaultNow(),
  completedAt: timestamp("completed_at"),
  errorMessage: text("error_message"),
});

export type InsertWorkflow = typeof workflowsTable.$inferInsert;
export type Workflow = typeof workflowsTable.$inferSelect;
export type WorkflowExecution = typeof workflowExecutionsTable.$inferSelect;
