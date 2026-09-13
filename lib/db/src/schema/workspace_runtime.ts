import {
  integer,
  index,
  jsonb,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
} from "drizzle-orm/pg-core";
import { projectsTable } from "./projects.js";

export const workspaceRuntimeStatusEnum = pgEnum("workspace_runtime_status", [
  "stopped",
  "starting",
  "running",
  "failed",
]);

/**
 * Durable ownership record for the project preview runtime. The process itself
 * remains outside PostgreSQL; this row is the recovery and ownership source of
 * truth when the API worker is replaced.
 */
export const workspaceRuntimeTable = pgTable("workspace_runtime", {
  id: text("id").primaryKey(),
  projectId: text("project_id")
    .notNull()
    .references(() => projectsTable.id, { onDelete: "cascade" }),
  sessionId: text("session_id").notNull(),
  status: workspaceRuntimeStatusEnum("status").notNull().default("stopped"),
  profile: text("profile").notNull().default("dev"),
  command: text("command").notNull().default("pnpm run dev"),
  projectRoot: text("project_root").notNull(),
  revision: text("revision"),
  port: integer("port"),
  pid: integer("pid"),
  workerId: text("worker_id"),
  leaseUntil: timestamp("lease_until"),
  lastHeartbeatAt: timestamp("last_heartbeat_at"),
  startedAt: timestamp("started_at"),
  stoppedAt: timestamp("stopped_at"),
  error: text("error"),
  logs: jsonb("logs").$type<string[]>().notNull().default([]),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
}, (t) => [
  uniqueIndex("uq_workspace_runtime_project_id").on(t.projectId),
  index("idx_workspace_runtime_status").on(t.status),
  index("idx_workspace_runtime_status_lease_until").on(t.status, t.leaseUntil),
]);

export type WorkspaceRuntime = typeof workspaceRuntimeTable.$inferSelect;
export type InsertWorkspaceRuntime = typeof workspaceRuntimeTable.$inferInsert;