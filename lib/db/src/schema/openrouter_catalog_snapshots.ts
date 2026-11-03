import { createInsertSchema } from "drizzle-zod";
import { jsonb, pgTable, text, timestamp } from "drizzle-orm/pg-core";
import { z } from "zod/v4";

/**
 * One shared, non-secret OpenRouter catalog snapshot and refresh lease.
 * The snapshot contains only server-normalized model IDs and capability flags;
 * provider credentials and raw catalog payloads are never stored here.
 */
export const openrouterCatalogSnapshotsTable = pgTable(
  "openrouter_catalog_snapshots",
  {
    catalogKey: text("catalog_key").primaryKey(),
    snapshot: jsonb("snapshot").$type<unknown>(),
    refreshedAt: timestamp("refreshed_at", { withTimezone: true }),
    expiresAt: timestamp("expires_at", { withTimezone: true }),
    failureBackoffUntil: timestamp("failure_backoff_until", { withTimezone: true }),
    lastFailureCode: text("last_failure_code"),
    leaseToken: text("lease_token"),
    leaseExpiresAt: timestamp("lease_expires_at", { withTimezone: true }),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
);

export const insertOpenRouterCatalogSnapshotSchema = createInsertSchema(
  openrouterCatalogSnapshotsTable,
).omit({ updatedAt: true });

export type InsertOpenRouterCatalogSnapshot =
  z.infer<typeof insertOpenRouterCatalogSnapshotSchema>;
export type OpenRouterCatalogSnapshotRow =
  typeof openrouterCatalogSnapshotsTable.$inferSelect;
