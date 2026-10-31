import { index, pgTable, primaryKey, text, timestamp } from "drizzle-orm/pg-core";

/**
 * Shared cooldowns for exact OpenRouter models and confidently matched
 * upstream-provider namespaces. Rows expire by cooling_until; the composite
 * key makes updates atomic across API instances without blocking unrelated
 * models or providers.
 */
export const openrouterModelCooldownsTable = pgTable(
  "openrouter_model_cooldowns",
  {
    provider: text("provider").notNull(),
    model: text("model").notNull(),
    coolingUntil: timestamp("cooling_until", { withTimezone: true }).notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    primaryKey({ columns: [table.provider, table.model] }),
    index("idx_openrouter_model_cooldowns_expiry").on(table.coolingUntil),
  ],
);

export type OpenRouterModelCooldown =
  typeof openrouterModelCooldownsTable.$inferSelect;