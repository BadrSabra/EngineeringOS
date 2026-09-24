import {
  index,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
} from "drizzle-orm/pg-core";
import { aiAgentEpisodesTable } from "./ai_agent_episodes.js";
import { aiStrategyCandidatesTable } from "./ai_strategy_candidates.js";
import { aiStrategyReplayCasesTable } from "./ai_strategy_replay_cases.js";
import { projectsTable } from "./projects.js";

/**
 * One immutable replay attempt per registered held-out case. The row records
 * only bounded identities, hashes, and a proof-status receipt.
 */
export const aiStrategyReplayCaseRunsTable = pgTable("ai_strategy_replay_case_runs", {
  id: text("id").primaryKey(),
  projectId: text("project_id").notNull().references(() => projectsTable.id, { onDelete: "cascade" }),
  caseRegistrationId: text("case_registration_id").notNull()
    .references(() => aiStrategyReplayCasesTable.id, { onDelete: "cascade" }),
  candidateId: text("candidate_id").notNull()
    .references(() => aiStrategyCandidatesTable.id, { onDelete: "cascade" }),
  sourceEpisodeId: text("source_episode_id").notNull()
    .references(() => aiAgentEpisodesTable.id, { onDelete: "cascade" }),
  operationId: text("operation_id").notNull(),
  candidateHash: text("candidate_hash").notNull(),
  sourceCanonicalProofHash: text("source_canonical_proof_hash").notNull(),
  status: text("status").notNull(),
  replayExecutionId: text("replay_execution_id"),
  replayEpisodeId: text("replay_episode_id"),
  replayAttempt: integer("replay_attempt"),
  replayEffectBundleId: text("replay_effect_bundle_id"),
  replayCanonicalProofHash: text("replay_canonical_proof_hash"),
  workspaceTreeHash: text("workspace_tree_hash"),
  receipt: jsonb("receipt"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
}, (t) => [
  uniqueIndex("uq_ai_strategy_replay_case_runs_case")
    .on(t.caseRegistrationId),
  uniqueIndex("uq_ai_strategy_replay_case_runs_operation")
    .on(t.operationId),
  index("idx_ai_strategy_replay_case_runs_project_candidate_status")
    .on(t.projectId, t.candidateId, t.status),
]);

export type InsertAiStrategyReplayCaseRun = typeof aiStrategyReplayCaseRunsTable.$inferInsert;
export type AiStrategyReplayCaseRun = typeof aiStrategyReplayCaseRunsTable.$inferSelect;