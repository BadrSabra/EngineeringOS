import { index, pgTable, primaryKey, text, timestamp } from "drizzle-orm/pg-core";

/**
 * Shared credential-scoped OpenRouter Retry-After windows.
 * Only an HMAC fingerprint is stored; provider keys never enter this table.
 */
export const openrouterCredentialCooldownsTable = pgTable(
  "openrouter_credential_cooldowns",
  {
    credentialFingerprint: text("credential_fingerprint").notNull(),
    coolingUntil: timestamp("cooling_until", { withTimezone: true }).notNull(),
    errorCode: text("error_code").notNull(),
    scope: text("scope").notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    primaryKey({
      name: "openrouter_credential_cooldowns_pk",
      columns: [table.credentialFingerprint],
    }),
    index("idx_openrouter_credential_cooldowns_expiry").on(table.coolingUntil),
  ],
);

export type OpenRouterCredentialCooldown =
  typeof openrouterCredentialCooldownsTable.$inferSelect;
