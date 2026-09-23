import {
  index,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
} from "drizzle-orm/pg-core";
import { projectsTable } from "./projects.js";
import { aiExecutionsTable } from "./ai_executions.js";
import { aiAgentEpisodesTable } from "./ai_agent_episodes.js";

export const aiAgentEffectBundlesTable = pgTable("ai_agent_effect_bundles", {
  id: text("id").primaryKey(),
  projectId: text("project_id").notNull().references(() => projectsTable.id, { onDelete: "cascade" }),
  executionId: text("execution_id").notNull().references(() => aiExecutionsTable.id, { onDelete: "cascade" }),
  attempt: integer("attempt").notNull(),
  episodeId: text("episode_id").notNull().references(() => aiAgentEpisodesTable.id, { onDelete: "cascade" }),
  effectIds: jsonb("effect_ids").notNull(),
  effectContractHashes: jsonb("effect_contract_hashes").notNull(),
  verdict: text("verdict").notNull(),
  worldRevision: text("world_revision"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
}, (t) => [
  uniqueIndex("uq_ai_agent_effect_bundles_execution_attempt").on(t.executionId, t.attempt),
  index("idx_ai_agent_effect_bundles_project_created").on(t.projectId, t.createdAt),
]);

export type InsertAiAgentEffectBundle = typeof aiAgentEffectBundlesTable.$inferInsert;
export type AiAgentEffectBundle = typeof aiAgentEffectBundlesTable.$inferSelect;