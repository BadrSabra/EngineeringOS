import {
  foreignKey,
  index,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
} from "drizzle-orm/pg-core";
import { projectsTable } from "./projects.js";
import { aiExecutionsTable } from "./ai_executions.js";

/**
 * Durable retry boundary for post-acceptance Observation/World State projection.
 * Acceptance remains authoritative and is not rolled back if this projection
 * is delayed or unavailable.
 */
export const taskExecutionObservationOutboxTable = pgTable(
  "task_execution_observation_outbox",
  {
    id: text("id").primaryKey(),
    projectId: text("project_id")
      .notNull()
      .references(() => projectsTable.id, { onDelete: "cascade" }),
    executionId: text("execution_id").notNull(),
    attempt: integer("attempt").notNull(),
    payload: jsonb("payload").$type<Record<string, unknown>>().notNull(),
    status: text("status").notNull().default("pending"),
    attemptCount: integer("attempt_count").notNull().default(0),
    nextAttemptAt: timestamp("next_attempt_at").notNull().defaultNow(),
    workerId: text("worker_id"),
    leaseUntil: timestamp("lease_until"),
    lastFailureCode: text("last_failure_code"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
  },
  (t) => [
    foreignKey({
      columns: [t.executionId],
      foreignColumns: [aiExecutionsTable.id],
      name: "fk_task_execution_observation_outbox_execution",
    }).onDelete("cascade"),
    uniqueIndex("uq_task_execution_observation_outbox_attempt")
      .on(t.executionId, t.attempt),
    index("idx_task_execution_observation_outbox_due")
      .on(t.status, t.nextAttemptAt),
    index("idx_task_execution_observation_outbox_project")
      .on(t.projectId, t.createdAt),
  ],
);
