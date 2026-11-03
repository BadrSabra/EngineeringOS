import {
  check,
  index,
  jsonb,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { projectsTable } from "./projects.js";
import { aiMissionsTable, aiGoalsTable } from "./ai_missions.js";
import { aiMissionDecisionTracesTable } from "./ai_mission_decision_traces.js";
import { aiMissionDecisionDispatchBatchesTable } from "./ai_mission_decision_dispatch_batches.js";

/**
 * Immutable-by-store-contract snapshot of one server-evaluated plan outcome.
 * The dispatch batch remains provenance only; this record carries the exact
 * aggregated evidence identity and does not itself authorize lifecycle stages.
 */
export const aiMissionDecisionOutcomeSnapshotsTable = pgTable(
  "ai_mission_decision_outcome_snapshots",
  {
    outcomeId: text("outcome_id").primaryKey(),
    decisionId: text("decision_id")
      .notNull()
      .references(() => aiMissionDecisionTracesTable.decisionId, { onDelete: "cascade" }),
    projectId: text("project_id")
      .notNull()
      .references(() => projectsTable.id, { onDelete: "cascade" }),
    missionId: text("mission_id")
      .notNull()
      .references(() => aiMissionsTable.id, { onDelete: "cascade" }),
    sourceGoalId: text("source_goal_id")
      .notNull()
      .references(() => aiGoalsTable.id, { onDelete: "cascade" }),
    planRevision: text("plan_revision").notNull(),
    selectedStrategyId: text("selected_strategy_id").notNull(),
    dispatchBatchId: text("dispatch_batch_id")
      .notNull()
      .references(() => aiMissionDecisionDispatchBatchesTable.dispatchBatchId, { onDelete: "cascade" }),
    dispatchManifestHash: text("dispatch_manifest_hash").notNull(),
    evidenceSetHash: text("evidence_set_hash").notNull(),
    worldStateRevision: text("world_state_revision"),
    outcome: text("outcome").notNull(),
    evaluation: jsonb("evaluation").$type<Record<string, unknown>>().notNull(),
    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("uq_ai_mission_decision_outcome_evidence")
      .on(t.decisionId, t.evidenceSetHash),
    index("idx_ai_mission_decision_outcome_mission_created")
      .on(t.missionId, t.createdAt),
    check("ck_ai_mission_decision_outcome_kind", sql`${t.outcome} IN ('ACHIEVED', 'NOT_ACHIEVED', 'INCONCLUSIVE')`),
    check("ck_ai_mission_decision_outcome_evidence_hash", sql`${t.evidenceSetHash} ~ '^[a-f0-9]{64}$'`),
    check("ck_ai_mission_decision_outcome_dispatch_hash", sql`${t.dispatchManifestHash} ~ '^[a-f0-9]{64}$'`),
  ],
);

export type InsertAiMissionDecisionOutcomeSnapshot =
  typeof aiMissionDecisionOutcomeSnapshotsTable.$inferInsert;
export type AiMissionDecisionOutcomeSnapshot =
  typeof aiMissionDecisionOutcomeSnapshotsTable.$inferSelect;
