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
import type { RuleVerificationCheck } from "./rules.js";

export type RemediationPlanStatus = "needs_review" | "ready" | "verified";

export interface RemediationEvidence {
  file: string;
  line: number;
  snippet: string;
  occurrences: number;
}

/**
 * Evidence-backed remediation context produced by a scan or discovery run.
 * This is intentionally optional on Task so pre-existing generic tasks remain
 * valid and readable.
 */
export interface RemediationPlan {
  version: 1;
  ruleId: string | null;
  ruleCode: string;
  ruleTitle: string;
  severity: string;
  occurrenceCount: number;
  evidence: RemediationEvidence[];
  relatedFiles: string[];
  fixDescription: string | null;
  verificationSteps: string[];
  /** Server-owned checks derived from verificationSteps. */
  verificationChecks?: RuleVerificationCheck[];
  source: {
    type: "scan" | "discovery";
    correlationId: string | null;
    revision: string | null;
    completeness: "COMPLETE" | "PARTIAL" | null;
  };
  status: RemediationPlanStatus;
}

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
  /** DB-15: notNull + default([]) — always an array, never NULL. */
  relatedFiles: jsonb("related_files").$type<string[]>().notNull().default([]),
  /** DB-15: notNull + default([]) — always an array, never NULL. */
  dependsOn: jsonb("depends_on").$type<string[]>().notNull().default([]),
  retryCount: integer("retry_count").notNull().default(0),
  maxRetries: integer("max_retries").notNull().default(3),
  phase: text("phase"),
  prompt: text("prompt"),
  agentResponse: text("agent_response"),
  verificationResult: jsonb("verification_result").$type<{
    passed: boolean;
    decision?: "verified" | "incomplete" | "failed" | "cancelled";
    steps: Array<{
      id?: string;
      name: string;
      kind?: "automatic" | "operator_attestation";
      guidance?: string;
      passed: boolean;
      evidence?: string;
      output?: string;
    }>;
  }>(),
  /** Optional structured context for tasks created from rule violations. */
  remediationPlan: jsonb("remediation_plan").$type<RemediationPlan>(),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
  completedAt: timestamp("completed_at"),
  /** Ties a task created by a scan/discovery run to that operation's trace
   *  (same value as the corresponding events/metrics/audit_logs rows). */
  correlationId: text("correlation_id"),
  /**
   * PR-01 (Durable Jobs): Worker ID that claimed and is executing this task.
   * Set atomically when AI execution starts; cleared on completion/failure.
   */
  workerId: text("worker_id"),
  /**
   * PR-01: Lease deadline for the executing worker. Heartbeated during long
   * AI agent calls; if it falls behind now() the task is considered abandoned.
   */
  leaseUntil: timestamp("lease_until"),
  /** PR-01: Timestamp of the last successful heartbeat from the worker. */
  lastHeartbeatAt: timestamp("last_heartbeat_at"),
  /** PR-01: Stable idempotency key (defaults to task ID) set at creation. */
  idempotencyKey: text("idempotency_key"),
}, (t) => [
  index("idx_tasks_project_id").on(t.projectId),
  // Covers: WHERE project_id = ? ORDER BY created_at DESC (task list per project)
  index("idx_tasks_project_id_created_at").on(t.projectId, t.createdAt),
  index("idx_tasks_status").on(t.status),
  index("idx_tasks_priority").on(t.priority),
  index("idx_tasks_correlation_id").on(t.correlationId),
  // PR-01: Covers lease-expiry detection: WHERE status='running' AND lease_until < NOW()
  index("idx_tasks_status_lease_until").on(t.status, t.leaseUntil),
]);

export type InsertTask = typeof tasksTable.$inferInsert;
export type Task = typeof tasksTable.$inferSelect;
