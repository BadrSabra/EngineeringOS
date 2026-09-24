import {
  index,
  integer,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
} from "drizzle-orm/pg-core";

export const aiAgentShadowCampaignOutcomeEnum = pgEnum("ai_agent_shadow_campaign_outcome", [
  "success",
  "failure",
]);

/**
 * Content-free, durable Shadow campaign evidence.
 *
 * This is telemetry only. It is intentionally not linked to acceptance,
 * planning, provider choice, or World State authority.
 */
export const aiAgentShadowCampaignEventsTable = pgTable("ai_agent_shadow_campaign_events", {
  id: text("id").primaryKey(),
  campaignId: text("campaign_id").notNull(),
  projectId: text("project_id").notNull(),
  executionId: text("execution_id").notNull(),
  attempt: integer("attempt").notNull(),
  idempotencyKeyHash: text("idempotency_key_hash").notNull(),
  outcome: aiAgentShadowCampaignOutcomeEnum("outcome").notNull(),
  failureCode: text("failure_code"),
  latencyMs: integer("latency_ms"),
  occurredAt: timestamp("occurred_at").notNull().defaultNow(),
}, (t) => [
  uniqueIndex("uq_ai_agent_shadow_campaign_event_identity")
    .on(t.campaignId, t.executionId, t.attempt, t.idempotencyKeyHash),
  index("idx_ai_agent_shadow_campaign_events_campaign_time").on(t.campaignId, t.occurredAt),
  index("idx_ai_agent_shadow_campaign_events_project_time").on(t.projectId, t.occurredAt),
]);

export type InsertAiAgentShadowCampaignEvent = typeof aiAgentShadowCampaignEventsTable.$inferInsert;
export type AiAgentShadowCampaignEvent = typeof aiAgentShadowCampaignEventsTable.$inferSelect;