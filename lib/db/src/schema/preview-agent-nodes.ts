import { createInsertSchema } from "drizzle-zod";
import {
  check,
  index,
  integer,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { z } from "zod/v4";
import { projectsTable } from "./projects.js";

export const previewAgentNodeStatusEnum = pgEnum(
  "preview_agent_node_status",
  ["pending", "active", "revoked"],
);

/**
 * Project-scoped registration and key lifecycle for a Local Agent. Pairing
 * codes are stored only as hashes; the private key never leaves the Agent.
 * This table is an identity registry, not a job queue or execution receipt.
 */
export const previewAgentNodesTable = pgTable(
  "preview_agent_nodes",
  {
    nodeId: uuid("node_id").primaryKey(),
    projectId: text("project_id")
      .notNull()
      .references(() => projectsTable.id, { onDelete: "cascade" }),
    userId: text("user_id").notNull(),
    storeId: uuid("store_id").notNull(),
    status: previewAgentNodeStatusEnum("status").notNull().default("pending"),
    pairingCodeHash: text("pairing_code_hash"),
    pairingExpiresAt: timestamp("pairing_expires_at", {
      withTimezone: true,
    }),
    publicKeyPem: text("public_key_pem"),
    publicKeyFingerprint: text("public_key_fingerprint"),
    agentVersion: text("agent_version"),
    platform: text("platform"),
    capabilityReportToken: text("capability_report_token"),
    capabilityExpiresAt: timestamp("capability_expires_at", {
      withTimezone: true,
    }),
    // Server stores only the digest; an unexpired challenge is never replaced.
    heartbeatChallengeHash: text("heartbeat_challenge_hash"),
    heartbeatChallengeExpiresAt: timestamp(
      "heartbeat_challenge_expires_at",
      { withTimezone: true },
    ),
    // High-water sequence is reserved by signed challenge requests; the hash
    // binds the latest accepted protocol request for safe exact retries.
    lastHeartbeatSequence: integer("last_heartbeat_sequence")
      .notNull()
      .default(0),
    lastHeartbeatRequestHash: text("last_heartbeat_request_hash"),
    keyVersion: integer("key_version").notNull().default(0),
    pairedAt: timestamp("paired_at", { withTimezone: true }),
    lastSeenAt: timestamp("last_seen_at", { withTimezone: true }),
    revokedAt: timestamp("revoked_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    uniqueIndex("uq_preview_agent_nodes_live_store")
      .on(table.storeId)
      .where(sql`${table.status} IN ('pending', 'active')`),
    uniqueIndex("uq_preview_agent_nodes_pairing_code_hash").on(
      table.pairingCodeHash,
    ),
    uniqueIndex("uq_preview_agent_nodes_public_key_fingerprint").on(
      table.publicKeyFingerprint,
    ),
    index("idx_preview_agent_nodes_project_status").on(
      table.projectId,
      table.status,
    ),
    index("idx_preview_agent_nodes_pairing_expiry").on(
      table.status,
      table.pairingExpiresAt,
    ),
    check(
      "chk_preview_agent_nodes_capability_pair",
      sql`(${table.capabilityReportToken} IS NULL) = (${table.capabilityExpiresAt} IS NULL)`,
    ),
    check(
      "chk_preview_agent_nodes_heartbeat_challenge_pair",
      sql`(${table.heartbeatChallengeHash} IS NULL) = (${table.heartbeatChallengeExpiresAt} IS NULL)`,
    ),
    check(
      "chk_preview_agent_nodes_heartbeat_request_pair",
      sql`(${table.lastHeartbeatSequence} = 0 AND ${table.lastHeartbeatRequestHash} IS NULL) OR (${table.lastHeartbeatSequence} > 0 AND ${table.lastHeartbeatRequestHash} IS NOT NULL)`,
    ),
  ],
);

export const insertPreviewAgentNodeSchema = createInsertSchema(
  previewAgentNodesTable,
).omit({
  status: true,
  pairingCodeHash: true,
  pairingExpiresAt: true,
  publicKeyPem: true,
  publicKeyFingerprint: true,
  agentVersion: true,
  platform: true,
  capabilityReportToken: true,
  capabilityExpiresAt: true,
  heartbeatChallengeHash: true,
  heartbeatChallengeExpiresAt: true,
  lastHeartbeatSequence: true,
  lastHeartbeatRequestHash: true,
  keyVersion: true,
  pairedAt: true,
  lastSeenAt: true,
  revokedAt: true,
  createdAt: true,
  updatedAt: true,
});

export type InsertPreviewAgentNode = z.infer<
  typeof insertPreviewAgentNodeSchema
>;
export type PreviewAgentNode = typeof previewAgentNodesTable.$inferSelect;
