import { pgTable, text, timestamp, integer, pgEnum, index, unique } from "drizzle-orm/pg-core";

export const operatorAlertStatusEnum = pgEnum("operator_alert_status", [
  "open",
  "resolved",
]);

export const operatorAlertKindEnum = pgEnum("operator_alert_kind", [
  "groq_model_catalog_drift",
]);

/**
 * Deployment-wide operator alerts. These intentionally have no project
 * foreign key: provider startup health is a system concern and must remain
 * visible even when no project exists.
 */
export const operatorAlertsTable = pgTable("operator_alerts", {
  id: text("id").primaryKey(),
  fingerprint: text("fingerprint").notNull(),
  kind: operatorAlertKindEnum("kind").notNull(),
  status: operatorAlertStatusEnum("status").notNull().default("open"),
  provider: text("provider").notNull(),
  modelRole: text("model_role").notNull(),
  modelId: text("model_id").notNull(),
  title: text("title").notNull(),
  message: text("message").notNull(),
  remediation: text("remediation").notNull(),
  occurrenceCount: integer("occurrence_count").notNull().default(1),
  firstSeenAt: timestamp("first_seen_at").notNull().defaultNow(),
  lastSeenAt: timestamp("last_seen_at").notNull().defaultNow(),
  resolvedAt: timestamp("resolved_at"),
}, (t) => [
  unique("operator_alerts_fingerprint_unique").on(t.fingerprint),
  index("idx_operator_alerts_status_last_seen").on(t.status, t.lastSeenAt),
  index("idx_operator_alerts_provider").on(t.provider),
]);

export type InsertOperatorAlert = typeof operatorAlertsTable.$inferInsert;
export type OperatorAlert = typeof operatorAlertsTable.$inferSelect;