import {
  pgEnum,
  pgTable,
  index,
  integer,
  text,
  timestamp,
  uniqueIndex,
} from "drizzle-orm/pg-core";
import { projectsTable } from "./projects.js";

export const projectBootstrapStatusEnum = pgEnum("project_bootstrap_status", [
  "queued",
  "running",
  "completed",
  "failed",
]);

/**
 * Durable, owner-scoped requests to create a project from a server-owned
 * template. A project is inserted only after the template has been materialized
 * and its locked dependencies have installed successfully.
 */
export const projectBootstrapJobsTable = pgTable(
  "project_bootstrap_jobs",
  {
    id: text("id").primaryKey(),
    ownerId: text("owner_id").notNull(),
    idempotencyKey: text("idempotency_key").notNull(),
    name: text("name").notNull(),
    description: text("description").notNull(),
    templateVersion: text("template_version").notNull(),
    status: projectBootstrapStatusEnum("status").notNull().default("queued"),
    attempt: integer("attempt").notNull().default(0),
    maxAttempts: integer("max_attempts").notNull().default(3),
    workerId: text("worker_id"),
    leaseUntil: timestamp("lease_until"),
    lastHeartbeatAt: timestamp("last_heartbeat_at"),
    workingRootPath: text("working_root_path"),
    projectId: text("project_id").references(() => projectsTable.id, {
      onDelete: "set null",
    }),
    errorCode: text("error_code"),
    errorMessage: text("error_message"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
    startedAt: timestamp("started_at"),
    finishedAt: timestamp("finished_at"),
  },
  (t) => [
    uniqueIndex("uq_project_bootstrap_jobs_owner_idempotency").on(
      t.ownerId,
      t.idempotencyKey,
    ),
    index("idx_project_bootstrap_jobs_status_created").on(t.status, t.createdAt),
    index("idx_project_bootstrap_jobs_status_lease").on(t.status, t.leaseUntil),
    index("idx_project_bootstrap_jobs_owner_created").on(t.ownerId, t.createdAt),
  ],
);

export type ProjectBootstrapJob =
  typeof projectBootstrapJobsTable.$inferSelect;
export type InsertProjectBootstrapJob =
  typeof projectBootstrapJobsTable.$inferInsert;
