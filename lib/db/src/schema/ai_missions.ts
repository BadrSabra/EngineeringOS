import {
  foreignKey,
  index,
  jsonb,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
} from "drizzle-orm/pg-core";
import { projectsTable } from "./projects.js";

export const aiMissionStatusEnum = pgEnum("ai_mission_status", [
  "draft",
  "active",
  "waiting",
  "blocked",
  "needs_replan",
  "completed",
  "failed",
  "cancelled",
]);

export const aiGoalStatusEnum = pgEnum("ai_goal_status", [
  "queued",
  "planning",
  "running",
  "waiting_for_event",
  "waiting_for_approval",
  "verifying",
  "needs_replan",
  "completed",
  "blocked",
  "failed",
  "cancelled",
]);

/**
 * Durable ownership for a long-lived user objective.
 *
 * A mission is intentionally project-scoped in this first slice. Existing
 * project authorization remains the security boundary; cross-project
 * missions can be added later without making projectId nullable.
 */
export const aiMissionsTable = pgTable("ai_missions", {
  id: text("id").primaryKey(),
  projectId: text("project_id")
    .notNull()
    .references(() => projectsTable.id, { onDelete: "cascade" }),
  userId: text("user_id").notNull(),
  title: text("title").notNull(),
  intent: text("intent").notNull(),
  status: aiMissionStatusEnum("status").notNull().default("draft"),
  scope: jsonb("scope")
    .$type<{ kind: "project"; projectId: string }>()
    .notNull(),
  autonomyPolicy: jsonb("autonomy_policy")
    .$type<Record<string, unknown>>()
    .notNull()
    .default({}),
  budget: jsonb("budget")
    .$type<Record<string, unknown>>()
    .notNull()
    .default({}),
  deadline: timestamp("deadline"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
  completedAt: timestamp("completed_at"),
}, (t) => [
  index("idx_ai_missions_project_status").on(t.projectId, t.status),
  index("idx_ai_missions_user_updated").on(t.userId, t.updatedAt),
]);

export const aiGoalsTable = pgTable("ai_goals", {
  id: text("id").primaryKey(),
  missionId: text("mission_id")
    .notNull()
    .references(() => aiMissionsTable.id, { onDelete: "cascade" }),
  projectId: text("project_id")
    .notNull()
    .references(() => projectsTable.id, { onDelete: "cascade" }),
  parentGoalId: text("parent_goal_id"),
  title: text("title").notNull(),
  description: text("description"),
  status: aiGoalStatusEnum("status").notNull().default("queued"),
  priority: text("priority").notNull().default("p2"),
  successCriteria: jsonb("success_criteria")
    .$type<Record<string, unknown>>()
    .notNull()
    .default({}),
  evidenceContract: jsonb("evidence_contract")
    .$type<Record<string, unknown>>()
    .notNull()
    .default({}),
  outcomeContract: jsonb("outcome_contract")
    .$type<Record<string, unknown>>()
    .notNull()
    .default({}),
  nextAction: jsonb("next_action")
    .$type<Record<string, unknown>>()
    .notNull()
    .default({}),
  blockedReason: text("blocked_reason"),
  nextWakeAt: timestamp("next_wake_at"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
  completedAt: timestamp("completed_at"),
}, (t) => [
  foreignKey({
    columns: [t.parentGoalId],
    foreignColumns: [t.id],
    name: "fk_ai_goals_parent_goal",
  }).onDelete("set null"),
  index("idx_ai_goals_mission_status").on(t.missionId, t.status),
  index("idx_ai_goals_project_status").on(t.projectId, t.status),
  index("idx_ai_goals_next_wake").on(t.status, t.nextWakeAt),
]);

/**
 * Server-owned completion dependencies between Goals in one Mission plan
 * revision. This is an execution prerequisite relation, not a general graph:
 * parentGoalId remains the hierarchy field and this table owns only
 * "must complete before" edges.
 */
export const aiGoalDependenciesTable = pgTable("ai_goal_dependencies", {
  id: text("id").primaryKey(),
  missionId: text("mission_id")
    .notNull()
    .references(() => aiMissionsTable.id, { onDelete: "cascade" }),
  projectId: text("project_id")
    .notNull()
    .references(() => projectsTable.id, { onDelete: "cascade" }),
  goalId: text("goal_id")
    .notNull()
    .references(() => aiGoalsTable.id, { onDelete: "cascade" }),
  dependsOnGoalId: text("depends_on_goal_id")
    .notNull()
    .references(() => aiGoalsTable.id, { onDelete: "cascade" }),
  planRevision: text("plan_revision").notNull(),
  createdAt: timestamp("created_at").notNull().defaultNow(),
}, (t) => [
  uniqueIndex("uq_ai_goal_dependency_edge").on(t.goalId, t.dependsOnGoalId, t.planRevision),
  index("idx_ai_goal_dependencies_goal").on(t.goalId, t.planRevision),
  index("idx_ai_goal_dependencies_depends_on").on(t.dependsOnGoalId, t.planRevision),
  index("idx_ai_goal_dependencies_mission_revision").on(t.missionId, t.planRevision),
]);

export type InsertAiMission = typeof aiMissionsTable.$inferInsert;
export type AiMission = typeof aiMissionsTable.$inferSelect;
export type InsertAiGoal = typeof aiGoalsTable.$inferInsert;
export type AiGoal = typeof aiGoalsTable.$inferSelect;
export type InsertAiGoalDependency = typeof aiGoalDependenciesTable.$inferInsert;
export type AiGoalDependency = typeof aiGoalDependenciesTable.$inferSelect;