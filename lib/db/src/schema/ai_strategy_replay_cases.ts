import {
  index,
  jsonb,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
} from "drizzle-orm/pg-core";
import { aiAgentEpisodesTable } from "./ai_agent_episodes.js";
import { aiStrategyCandidatesTable } from "./ai_strategy_candidates.js";
import { projectsTable } from "./projects.js";

/**
 * Immutable, proof-bound source cases registered after a pending-replay
 * candidate is frozen. This table intentionally has no prompt or file-content
 * columns; the JSON definition contains bounded identities and hashes only.
 */
export const aiStrategyReplayCasesTable = pgTable("ai_strategy_replay_cases", {
  id: text("id").primaryKey(),
  projectId: text("project_id").notNull().references(() => projectsTable.id, { onDelete: "cascade" }),
  candidateId: text("candidate_id").notNull().references(() => aiStrategyCandidatesTable.id, { onDelete: "cascade" }),
  sourceEpisodeId: text("source_episode_id").notNull().references(() => aiAgentEpisodesTable.id, { onDelete: "cascade" }),
  caseDefinition: jsonb("case_definition").notNull(),
  createdAt: timestamp("created_at").notNull().defaultNow(),
}, (t) => [
  uniqueIndex("uq_ai_strategy_replay_cases_candidate_episode")
    .on(t.candidateId, t.sourceEpisodeId),
  index("idx_ai_strategy_replay_cases_project_candidate")
    .on(t.projectId, t.candidateId),
]);

export type InsertAiStrategyReplayCase = typeof aiStrategyReplayCasesTable.$inferInsert;
export type AiStrategyReplayCase = typeof aiStrategyReplayCasesTable.$inferSelect;