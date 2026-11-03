import {
  check,
  integer,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { aiExecutionsTable } from "./ai_executions.js";
import {
  aiGoalsTable,
  aiMissionsTable,
} from "./ai_missions.js";
import { aiMissionDecisionTracesTable } from "./ai_mission_decision_traces.js";
import { projectsTable } from "./projects.js";

/**
 * Append-only-by-store-contract manifest of root Goal dispatches for one applied strategy plan.
 * DISPATCHED references this batch identity when a plan has multiple roots;
 * it is provenance and does not authorize or prove downstream completion.
 */
export const aiMissionDecisionDispatchBatchesTable = pgTable(
  "ai_mission_decision_dispatch_batches",
  {
    dispatchBatchId: text("dispatch_batch_id").primaryKey(),
    decisionId: text("decision_id")
      .notNull()
      .references(() => aiMissionDecisionTracesTable.decisionId, { onDelete: "cascade" }),
    projectId: text("project_id")
      .notNull()
      .references(() => projectsTable.id, { onDelete: "cascade" }),
    missionId: text("mission_id")
      .notNull()
      .references(() => aiMissionsTable.id, { onDelete: "cascade" }),
    planRevision: text("plan_revision").notNull(),
    manifestHash: text("manifest_hash").notNull(),
    state: text("state").notNull(),
    rootCount: integer("root_count").notNull(),
    createdAt: timestamp("created_at").notNull(),
  },
  (t) => [
    uniqueIndex("uq_ai_mission_decision_dispatch_batch_decision_revision")
      .on(t.decisionId, t.planRevision),
    check(
      "ck_ai_mission_decision_dispatch_batch_state",
      sql`${t.state} IN ('dispatched', 'partial', 'no_dispatch')`,
    ),
    check("ck_ai_mission_decision_dispatch_batch_root_count", sql`${t.rootCount} > 0`),
    check(
      "ck_ai_mission_decision_dispatch_batch_manifest_hash",
      sql`${t.manifestHash} ~ '^[a-f0-9]{64}$'`,
    ),
  ],
);

/**
 * Per-root dispatch outcomes captured by the immutable batch manifest.
 * Execution identity is optional only for non-dispatched outcomes such as
 * blocked/conflict; the store validates every non-null Execution against its
 * exact project, Mission, Goal, and plan revision.
 */
export const aiMissionDecisionDispatchItemsTable = pgTable(
  "ai_mission_decision_dispatch_items",
  {
    dispatchBatchId: text("dispatch_batch_id")
      .notNull()
      .references(() => aiMissionDecisionDispatchBatchesTable.dispatchBatchId, { onDelete: "cascade" }),
    position: integer("position").notNull(),
    goalId: text("goal_id")
      .notNull()
      .references(() => aiGoalsTable.id, { onDelete: "no action" }),
    executionId: text("execution_id")
      .references(() => aiExecutionsTable.id, { onDelete: "no action" }),
    runStatus: text("run_status").notNull(),
  },
  (t) => [
    primaryKey({
      name: "pk_ai_mission_decision_dispatch_items",
      columns: [t.dispatchBatchId, t.position],
    }),
    uniqueIndex("uq_ai_mission_decision_dispatch_item_goal")
      .on(t.dispatchBatchId, t.goalId),
    uniqueIndex("uq_ai_mission_decision_dispatch_item_execution")
      .on(t.dispatchBatchId, t.executionId),
    check("ck_ai_mission_decision_dispatch_item_position", sql`${t.position} >= 0`),
    check(
      "ck_ai_mission_decision_dispatch_item_status",
      sql`${t.runStatus} IN ('scheduled', 'waiting', 'blocked', 'completed', 'conflict')`,
    ),
    check(
      "ck_ai_mission_decision_dispatch_item_execution_required",
      sql`${t.runStatus} NOT IN ('scheduled', 'completed') OR ${t.executionId} IS NOT NULL`,
    ),
  ],
);

export type InsertAiMissionDecisionDispatchBatch =
  typeof aiMissionDecisionDispatchBatchesTable.$inferInsert;
export type AiMissionDecisionDispatchBatch =
  typeof aiMissionDecisionDispatchBatchesTable.$inferSelect;
export type InsertAiMissionDecisionDispatchItem =
  typeof aiMissionDecisionDispatchItemsTable.$inferInsert;
export type AiMissionDecisionDispatchItem =
  typeof aiMissionDecisionDispatchItemsTable.$inferSelect;
