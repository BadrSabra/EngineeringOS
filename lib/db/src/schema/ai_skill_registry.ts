import {
  index,
  jsonb,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
} from "drizzle-orm/pg-core";
import { projectsTable } from "./projects.js";
import { aiChangeProposalsTable } from "./ai_change_proposals.js";
import { aiShadowReplaysTable } from "./ai_shadow_replays.js";

export const aiSkillRegistryPromotionStatusEnum = pgEnum("ai_skill_registry_promotion_status", [
  "pending",
  "promoted",
  "superseded",
  "rejected",
]);

export const aiSkillRegistryRevocationStatusEnum = pgEnum("ai_skill_registry_revocation_status", [
  "active",
  "revoked",
]);

/**
 * Server-owned registry for proof-carrying skills.
 *
 * A row is only created from a completed, isolated shadow replay whose Gate 3
 * paired baseline passed. Approval and revocation are separate durable actions
 * so an operator can immediately disable an otherwise promoted skill.
 */
export const aiSkillRegistryTable = pgTable("ai_skill_registry", {
  id: text("id").primaryKey(),
  projectId: text("project_id")
    .notNull()
    .references(() => projectsTable.id, { onDelete: "cascade" }),
  skillId: text("skill_id").notNull(),
  skillVersion: text("skill_version").notNull(),
  candidateId: text("candidate_id").notNull(),
  proposalId: text("proposal_id")
    .notNull()
    .references(() => aiChangeProposalsTable.id, { onDelete: "cascade" }),
  shadowReplayId: text("shadow_replay_id")
    .notNull()
    .references(() => aiShadowReplaysTable.id, { onDelete: "cascade" }),
  proofReceiptId: text("proof_receipt_id").notNull(),
  sourceRevision: text("source_revision").notNull(),
  candidateTreeHash: text("candidate_tree_hash").notNull(),
  /** Server-derived Gate 3 score; provider and client metrics never enter here. */
  shadowScore: jsonb("shadow_score").notNull(),
  promotionStatus: aiSkillRegistryPromotionStatusEnum("promotion_status")
    .notNull()
    .default("pending"),
  revocationStatus: aiSkillRegistryRevocationStatusEnum("revocation_status")
    .notNull()
    .default("active"),
  approvedBy: text("approved_by"),
  approvedAt: timestamp("approved_at"),
  revokedBy: text("revoked_by"),
  revokedAt: timestamp("revoked_at"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
}, (t) => [
  uniqueIndex("uq_ai_skill_registry_project_skill_version").on(
    t.projectId,
    t.skillId,
    t.skillVersion,
  ),
  uniqueIndex("uq_ai_skill_registry_candidate").on(t.projectId, t.candidateId),
  index("idx_ai_skill_registry_project_status").on(
    t.projectId,
    t.promotionStatus,
    t.revocationStatus,
  ),
]);

export type InsertAiSkillRegistry = typeof aiSkillRegistryTable.$inferInsert;
export type AiSkillRegistry = typeof aiSkillRegistryTable.$inferSelect;