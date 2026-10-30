import { index, integer, pgTable, primaryKey, text, timestamp } from "drizzle-orm/pg-core";

/**
 * Shared fair-rotation positions for unpinned OpenRouter free-model requests.
 * Keys are opaque hashes of server-owned lane dimensions and eligible models;
 * this table must never contain prompts, credentials, or project identifiers.
 */
export const openrouterLaneCursorsTable = pgTable(
  "openrouter_lane_cursors",
  {
    cursorKey: text("cursor_key").notNull(),
    candidateSetHash: text("candidate_set_hash").notNull(),
    nextSlot: integer("next_slot").notNull().default(0),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    primaryKey({
      name: "openrouter_lane_cursors_pk",
      columns: [table.cursorKey, table.candidateSetHash],
    }),
    index("idx_openrouter_lane_cursors_updated_at").on(table.updatedAt),
  ],
);

export type OpenRouterLaneCursor = typeof openrouterLaneCursorsTable.$inferSelect;
