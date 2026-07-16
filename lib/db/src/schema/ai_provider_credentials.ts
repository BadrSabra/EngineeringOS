import { pgTable, text, timestamp, unique } from "drizzle-orm/pg-core";

/**
 * Stores per-user AI provider API keys, encrypted at rest.
 * The server never returns the raw key — callers see `configured`, `last4`, and `updatedAt` only.
 */
export const aiProviderCredentialsTable = pgTable(
  "ai_provider_credentials",
  {
    id: text("id").primaryKey(),
    /** Clerk user ID — single owner, no sharing. */
    ownerId: text("owner_id").notNull(),
    /** Provider identifier — currently only "groq". */
    provider: text("provider").notNull(),
    /**
     * AES-256-GCM ciphertext encoded as "iv:authTag:ciphertext" (all hex).
     * Encrypted with AI_CREDENTIALS_ENCRYPTION_KEY on the server.
     */
    encryptedApiKey: text("encrypted_api_key").notNull(),
    /** Last 4 characters of the plaintext key — shown in UI to confirm which key is saved. */
    last4: text("last4").notNull(),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
  },
  (t) => [unique("ai_creds_owner_provider").on(t.ownerId, t.provider)],
);

export type AiProviderCredential = typeof aiProviderCredentialsTable.$inferSelect;
export type InsertAiProviderCredential = typeof aiProviderCredentialsTable.$inferInsert;
