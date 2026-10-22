import {
  index,
  pgTable,
  text,
  timestamp,
} from "drizzle-orm/pg-core";
import { aiExecutionAcceptancesTable } from "./ai_execution_acceptances.js";
import { aiChangeProposalsTable } from "./ai_change_proposals.js";
import { aiExecutionsTable } from "./ai_executions.js";
import { aiGoalsTable, aiMissionsTable } from "./ai_missions.js";
import { projectsTable } from "./projects.js";

/**
 * Server-authored identity edge for a distinct Apply Mission.
 *
 * This is lineage metadata, not a second Mission or execution runtime. The
 * source Mission, exact accepted Execution, Proposal, and Apply Mission remain
 * their existing entities and are linked here with foreign keys.
 */
export const aiMissionLineagesTable = pgTable("ai_mission_lineages", {
  applyMissionId: text("apply_mission_id")
    .primaryKey()
    .references(() => aiMissionsTable.id, { onDelete: "cascade" }),
  canonicalMissionId: text("canonical_mission_id")
    .notNull()
    .references(() => aiMissionsTable.id, { onDelete: "cascade" }),
  sourceExecutionId: text("source_execution_id")
    .notNull()
    .references(() => aiExecutionsTable.id, { onDelete: "cascade" }),
  sourceGoalId: text("source_goal_id")
    .notNull()
    .references(() => aiGoalsTable.id, { onDelete: "cascade" }),
  sourceAcceptanceId: text("source_acceptance_id")
    .references(() => aiExecutionAcceptancesTable.id, { onDelete: "cascade" }),
  proposalId: text("proposal_id")
    .notNull()
    .references(() => aiChangeProposalsTable.id, { onDelete: "cascade" }),
  projectId: text("project_id")
    .notNull()
    .references(() => projectsTable.id, { onDelete: "cascade" }),
  createdAt: timestamp("created_at").notNull().defaultNow(),
}, (t) => [
  index("idx_ai_mission_lineages_canonical").on(t.canonicalMissionId, t.createdAt),
  index("idx_ai_mission_lineages_proposal").on(t.proposalId),
  index("idx_ai_mission_lineages_source_execution").on(t.sourceExecutionId),
]);

export type InsertAiMissionLineage = typeof aiMissionLineagesTable.$inferInsert;
export type AiMissionLineage = typeof aiMissionLineagesTable.$inferSelect;
