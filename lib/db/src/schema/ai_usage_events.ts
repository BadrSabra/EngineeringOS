import { pgTable, text, timestamp, integer, index, uniqueIndex } from "drizzle-orm/pg-core";

export const AI_CONTRACT_OUTCOMES = [
  "not_applicable",
  "accepted",
  "malformed_but_recovered",
  "missing_claims",
  "citation_mismatch",
  "semantic_failure",
  "provider_empty",
] as const;
export type AiContractOutcome = (typeof AI_CONTRACT_OUTCOMES)[number];

export const AI_RECOVERY_OUTCOMES = [
  "not_attempted",
  "not_needed",
  "accepted",
  "failed",
] as const;
export type AiRecoveryOutcome = (typeof AI_RECOVERY_OUTCOMES)[number];

/**
 * Durable, content-free AI provider attempt telemetry.
 *
 * This is intentionally separate from ai_executions, audit logs, and proof:
 * it describes provider consumption and reliability only. Nullable token
 * counts are deliberate — providers that omit usage are represented as
 * unknown, never as a fabricated zero.
 */
export const aiUsageEventsTable = pgTable("ai_usage_events", {
  id: text("id").primaryKey(),
  schemaVersion: integer("schema_version").notNull().default(1),
  projectId: text("project_id"),
  userId: text("user_id").notNull(),
  executionId: text("execution_id"),
  operationId: text("operation_id"),
  correlationId: text("correlation_id").notNull(),
  attemptId: text("attempt_id").notNull(),
  provider: text("provider").notNull(),
  model: text("model"),
  outcome: text("outcome").notNull(),
  latencyMs: integer("latency_ms"),
  fallbackCount: integer("fallback_count").notNull().default(0),
  attemptNumber: integer("attempt_number").notNull().default(1),
  promptTokens: integer("prompt_tokens"),
  completionTokens: integer("completion_tokens"),
  usageStatus: text("usage_status").notNull().default("unknown"),
  /** Provider HTTP outcome and contract outcome are intentionally separate. */
  contractOutcome: text("contract_outcome").notNull().default("not_applicable"),
  recoveryOutcome: text("recovery_outcome").notNull().default("not_attempted"),
  contractClaimCount: integer("contract_claim_count").notNull().default(0),
  contractCitationMatchCount: integer("contract_citation_match_count").notNull().default(0),
  contractRecoveryLatencyMs: integer("contract_recovery_latency_ms"),
  contractFailureKind: text("contract_failure_kind"),
  occurredAt: timestamp("occurred_at").notNull().defaultNow(),
  expiresAt: timestamp("expires_at").notNull(),
}, (t) => [
  uniqueIndex("uq_ai_usage_events_attempt_id").on(t.attemptId),
  index("idx_ai_usage_events_project_occurred").on(t.projectId, t.occurredAt),
  index("idx_ai_usage_events_user_occurred").on(t.userId, t.occurredAt),
  index("idx_ai_usage_events_provider_occurred").on(t.provider, t.occurredAt),
  index("idx_ai_usage_events_correlation").on(t.correlationId),
]);

export type InsertAiUsageEvent = typeof aiUsageEventsTable.$inferInsert;
export type AiUsageEvent = typeof aiUsageEventsTable.$inferSelect;