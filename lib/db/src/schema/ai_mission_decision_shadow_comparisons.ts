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
import { aiMissionDecisionTracesTable } from "./ai_mission_decision_traces.js";

/**
 * Non-authoritative comparison produced from an immutable applied decision trace.
 * It does not authorize or mutate any Mission lifecycle state.
 */
export const aiMissionDecisionShadowComparisonsTable = pgTable(
  "ai_mission_decision_shadow_comparisons",
  {
    comparisonId: text("comparison_id").primaryKey(),
    decisionId: text("decision_id")
      .notNull()
      .references(() => aiMissionDecisionTracesTable.decisionId, { onDelete: "cascade" }),
    projectId: text("project_id").notNull().references(() => projectsTable.id, { onDelete: "cascade" }),
    missionId: text("mission_id").notNull().references(() => aiMissionsTable.id, { onDelete: "cascade" }),
    goalId: text("goal_id").notNull().references(() => aiGoalsTable.id, { onDelete: "cascade" }),
    sourceExecutionId: text("source_execution_id").references(() => aiExecutionsTable.id, { onDelete: "cascade" }),
    sourceAcceptanceId: text("source_acceptance_id")
      .references(() => aiExecutionAcceptancesTable.id, { onDelete: "cascade" }),
    sourceAttempt: integer("source_attempt"),
    appliedPlanRevision: text("applied_plan_revision").notNull(),
    contextHash: text("context_hash").notNull(),
    baselineStrategyId: text("baseline_strategy_id").notNull(),
    shadowPolicyVersion: text("shadow_policy_version").notNull(),
    evaluatorVersion: text("evaluator_version").notNull(),
    comparisonKind: text("comparison_kind").notNull(),
    shadowResultKind: text("shadow_result_kind").notNull(),
    shadowStrategyId: text("shadow_strategy_id"),
    comparisonHash: text("comparison_hash").notNull(),
    comparison: jsonb("comparison").$type<Record<string, unknown>>().notNull(),
    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("uq_ai_mission_decision_shadow_policy")
      .on(t.decisionId, t.shadowPolicyVersion, t.evaluatorVersion),
    index("idx_ai_mission_decision_shadow_project_created").on(t.projectId, t.createdAt),
    check(
      "ck_ai_mission_decision_shadow_execution_attempt_pair",
      sql`(${t.sourceExecutionId} IS NULL) = (${t.sourceAttempt} IS NULL)`,
    ),
    check(
      "ck_ai_mission_decision_shadow_acceptance_requires_execution",
      sql`${t.sourceAcceptanceId} IS NULL OR ${t.sourceExecutionId} IS NOT NULL`,
    ),
    check(
      "ck_ai_mission_decision_shadow_attempt_nonnegative",
      sql`${t.sourceAttempt} IS NULL OR ${t.sourceAttempt} >= 0`,
    ),
    check("ck_ai_mission_decision_shadow_context_hash", sql`${t.contextHash} ~ '^[a-f0-9]{64}$'`),
    check("ck_ai_mission_decision_shadow_comparison_hash", sql`${t.comparisonHash} ~ '^[a-f0-9]{64}$'`),
    check(
      "ck_ai_mission_decision_shadow_result_binding",
      sql`(
        (${t.shadowResultKind} = 'SELECTED' AND ${t.shadowStrategyId} IS NOT NULL AND
          ${t.comparisonKind} IN ('AGREES', 'DIVERGES'))
        OR (${t.shadowResultKind} = 'NO_DECISION' AND ${t.shadowStrategyId} IS NULL AND
          ${t.comparisonKind} = 'NO_DECISION')
        OR (${t.shadowResultKind} = 'BLOCKED' AND ${t.shadowStrategyId} IS NULL AND
          ${t.comparisonKind} = 'BLOCKED')
      )`,
    ),
  ],
);

export type InsertAiMissionDecisionShadowComparison =
  typeof aiMissionDecisionShadowComparisonsTable.$inferInsert;
export type AiMissionDecisionShadowComparison =
  typeof aiMissionDecisionShadowComparisonsTable.$inferSelect;
