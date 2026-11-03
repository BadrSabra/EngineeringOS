import {
  check,
  index,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { projectsTable } from "./projects.js";
import { aiMissionsTable, aiGoalsTable } from "./ai_missions.js";
import { aiExecutionsTable } from "./ai_executions.js";
import { aiExecutionAcceptancesTable } from "./ai_execution_acceptances.js";

/**
 * Immutable strategy decision snapshot. This records what the server evaluated;
 * it does not authorize approval, execution, acceptance, or delivery.
 */
export const aiMissionDecisionTracesTable = pgTable("ai_mission_decision_traces", {
  decisionId: text("decision_id").primaryKey(),
  projectId: text("project_id").notNull().references(() => projectsTable.id, { onDelete: "cascade" }),
  missionId: text("mission_id").notNull().references(() => aiMissionsTable.id, { onDelete: "cascade" }),
  goalId: text("goal_id").notNull().references(() => aiGoalsTable.id, { onDelete: "cascade" }),
  sourceExecutionId: text("source_execution_id").references(() => aiExecutionsTable.id, { onDelete: "cascade" }),
  sourceAcceptanceId: text("source_acceptance_id")
    .references(() => aiExecutionAcceptancesTable.id, { onDelete: "cascade" }),
  sourceAttempt: integer("source_attempt"),
  priorPlanRevision: text("prior_plan_revision"),
  projectRevision: text("project_revision"),
  worldStateRevision: text("world_state_revision"),
  environmentRevision: text("environment_revision"),
  contextHash: text("context_hash").notNull(),
  resultKind: text("result_kind").notNull(),
  selectedStrategyId: text("selected_strategy_id"),
  trace: jsonb("trace").$type<Record<string, unknown>>().notNull(),
  createdAt: timestamp("created_at").notNull().defaultNow(),
}, (t) => [
  index("idx_ai_mission_decision_traces_mission_goal_created").on(t.missionId, t.goalId, t.createdAt),
  index("idx_ai_mission_decision_traces_project_created").on(t.projectId, t.createdAt),
  index("idx_ai_mission_decision_traces_source_execution").on(t.sourceExecutionId, t.sourceAttempt),
  check(
    "ck_ai_mission_decision_trace_execution_attempt_pair",
    sql`(${t.sourceExecutionId} IS NULL) = (${t.sourceAttempt} IS NULL)`,
  ),
  check(
    "ck_ai_mission_decision_trace_acceptance_requires_execution",
    sql`${t.sourceAcceptanceId} IS NULL OR ${t.sourceExecutionId} IS NOT NULL`,
  ),
  check(
    "ck_ai_mission_decision_trace_attempt_nonnegative",
    sql`${t.sourceAttempt} IS NULL OR ${t.sourceAttempt} >= 0`,
  ),
  check(
    "ck_ai_mission_decision_trace_result_binding",
    sql`(
      (${t.resultKind} = 'SELECTED' AND ${t.selectedStrategyId} IS NOT NULL)
      OR (${t.resultKind} IN ('NO_DECISION', 'BLOCKED') AND ${t.selectedStrategyId} IS NULL)
    )`,
  ),
]);

/**
 * Append-only lifecycle events ordered while holding the parent trace row lock.
 * References are provenance pointers only; a consumer must independently
 * reload and verify the referenced approval/execution/acceptance/proof.
 */
export const aiMissionDecisionEventsTable = pgTable("ai_mission_decision_events", {
  id: text("id").primaryKey(),
  decisionId: text("decision_id")
    .notNull()
    .references(() => aiMissionDecisionTracesTable.decisionId, { onDelete: "cascade" }),
  sequence: integer("sequence").notNull(),
  stage: text("stage").notNull(),
  referenceId: text("reference_id"),
  eventHash: text("event_hash").notNull(),
  occurredAt: timestamp("occurred_at").notNull(),
  createdAt: timestamp("created_at").notNull().defaultNow(),
}, (t) => [
  uniqueIndex("uq_ai_mission_decision_events_stage").on(t.decisionId, t.stage),
  uniqueIndex("uq_ai_mission_decision_events_sequence").on(t.decisionId, t.sequence),
  index("idx_ai_mission_decision_events_decision_stage").on(t.decisionId, t.stage),
  check("ck_ai_mission_decision_events_sequence_positive", sql`${t.sequence} >= 1`),
  check(
    "ck_ai_mission_decision_events_stage",
    sql`${t.stage} IN (
      'PROPOSED', 'EVALUATED', 'SELECTED', 'APPROVED', 'PLAN_APPLIED',
      'DISPATCHED', 'EXECUTED', 'ACCEPTED', 'VERIFIED', 'EVALUATED_AFTER_EXECUTION'
    )`,
  ),
  check(
    "ck_ai_mission_decision_events_reference_required",
    sql`${t.stage} NOT IN ('APPROVED', 'PLAN_APPLIED', 'DISPATCHED', 'EXECUTED', 'ACCEPTED', 'VERIFIED')
      OR ${t.referenceId} IS NOT NULL`,
  ),
]);

export type InsertAiMissionDecisionTrace = typeof aiMissionDecisionTracesTable.$inferInsert;
export type AiMissionDecisionTrace = typeof aiMissionDecisionTracesTable.$inferSelect;
export type InsertAiMissionDecisionEvent = typeof aiMissionDecisionEventsTable.$inferInsert;
export type AiMissionDecisionEvent = typeof aiMissionDecisionEventsTable.$inferSelect;
