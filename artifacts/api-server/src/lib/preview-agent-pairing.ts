import { randomUUID } from "node:crypto";
import { and, eq, inArray } from "drizzle-orm";
import {
  db,
  previewAgentNodesTable,
  type PreviewAgentNode,
} from "@workspace/db";
import { sql } from "drizzle-orm";
import {
  canonicalPreviewAgentPublicKeyPem,
  createPreviewAgentPairingCode,
  hashPreviewAgentPairingCode,
  verifyPreviewAgentPairingProof,
} from "./preview-agent-pairing-crypto.js";

export const PREVIEW_AGENT_PAIRING_TTL_MS = 10 * 60_000;
const LIVE_NODE_STATUSES = ["pending", "active"] as const;

export class PreviewAgentPairingError extends Error {
  constructor(
    readonly code:
      | "PREVIEW_AGENT_PAIRING_INVALID"
      | "PREVIEW_AGENT_PAIRING_EXPIRED"
      | "PREVIEW_AGENT_PAIRING_NOT_FOUND"
      | "PREVIEW_AGENT_STORE_ALREADY_PAIRED"
      | "PREVIEW_AGENT_KEY_ALREADY_REGISTERED"
      | "PREVIEW_AGENT_PAIRING_CONFLICT"
      | "PREVIEW_AGENT_PAIRING_UNAVAILABLE",
  ) {
    super("Preview Agent pairing is invalid or unavailable.");
    this.name = "PreviewAgentPairingError";
  }
}

export type PreviewAgentNodeSummary = {
  nodeId: string;
  projectId: string;
  storeId: string;
  status: "pending" | "active" | "revoked";
  publicKeyFingerprint: string | null;
  agentVersion: string | null;
  platform: string | null;
  keyVersion: number;
  pairingExpiresAt: Date | null;
  pairedAt: Date | null;
  lastSeenAt: Date | null;
  revokedAt: Date | null;
  createdAt: Date;
};

function summarize(node: PreviewAgentNode): PreviewAgentNodeSummary {
  return {
    nodeId: node.nodeId,
    projectId: node.projectId,
    storeId: node.storeId,
    status: node.status,
    publicKeyFingerprint: node.publicKeyFingerprint,
    agentVersion: node.agentVersion,
    platform: node.platform,
    keyVersion: node.keyVersion,
    pairingExpiresAt: node.pairingExpiresAt,
    pairedAt: node.pairedAt,
    lastSeenAt: node.lastSeenAt,
    revokedAt: node.revokedAt,
    createdAt: node.createdAt,
  };
}

function isUniqueViolation(error: unknown): boolean {
  return Boolean(
    error &&
      typeof error === "object" &&
      "code" in error &&
      (error as { code?: unknown }).code === "23505",
  );
}

export async function createPreviewAgentPairing(input: {
  projectId: string;
  userId: string;
  storeId: string;
  now?: Date;
}): Promise<{
  nodeId: string;
  storeId: string;
  pairingCode: string;
  expiresAt: Date;
}> {
  const now = input.now ?? new Date();
  if (
    !Number.isFinite(now.getTime()) ||
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
      input.storeId,
    ) ||
    !input.projectId.trim() ||
    !input.userId.trim()
  ) {
    throw new PreviewAgentPairingError("PREVIEW_AGENT_PAIRING_INVALID");
  }
  const pairingCode = createPreviewAgentPairingCode();
  const pairingCodeHash = hashPreviewAgentPairingCode(pairingCode);
  const expiresAt = new Date(now.getTime() + PREVIEW_AGENT_PAIRING_TTL_MS);
  const proposedNodeId = randomUUID();

  try {
    const node = await db.transaction(async (tx) => {
      await tx.execute(sql`
        SELECT pg_advisory_xact_lock(
          hashtextextended(${`preview-agent-store:${input.storeId}`}, 0)
        )
      `);
      const existing = await tx
        .select()
        .from(previewAgentNodesTable)
        .where(
          and(
            eq(previewAgentNodesTable.storeId, input.storeId),
            inArray(previewAgentNodesTable.status, [...LIVE_NODE_STATUSES]),
          ),
        )
        .for("update")
        .limit(1);
      const current = existing[0];
      if (current?.status === "active") {
        throw new PreviewAgentPairingError(
          "PREVIEW_AGENT_STORE_ALREADY_PAIRED",
        );
      }
      if (
        current?.status === "pending" &&
        current.projectId !== input.projectId
      ) {
        throw new PreviewAgentPairingError(
          "PREVIEW_AGENT_PAIRING_CONFLICT",
        );
      }
      if (current?.status === "pending") {
        const [updated] = await tx
          .update(previewAgentNodesTable)
          .set({
            userId: input.userId,
            pairingCodeHash,
            pairingExpiresAt: expiresAt,
            updatedAt: now,
          })
          .where(
            and(
              eq(previewAgentNodesTable.nodeId, current.nodeId),
              eq(previewAgentNodesTable.status, "pending"),
            ),
          )
          .returning();
        if (!updated) {
          throw new PreviewAgentPairingError(
            "PREVIEW_AGENT_PAIRING_CONFLICT",
          );
        }
        return updated;
      }

      const [created] = await tx
        .insert(previewAgentNodesTable)
        .values({
          nodeId: proposedNodeId,
          projectId: input.projectId,
          userId: input.userId,
          storeId: input.storeId,
          status: "pending",
          pairingCodeHash,
          pairingExpiresAt: expiresAt,
          keyVersion: 0,
          updatedAt: now,
        })
        .returning();
      if (!created) {
        throw new PreviewAgentPairingError(
          "PREVIEW_AGENT_PAIRING_UNAVAILABLE",
        );
      }
      return created;
    });
    return {
      nodeId: node.nodeId,
      storeId: node.storeId,
      pairingCode,
      expiresAt,
    };
  } catch (error) {
    if (error instanceof PreviewAgentPairingError) throw error;
    if (isUniqueViolation(error)) {
      throw new PreviewAgentPairingError(
        "PREVIEW_AGENT_KEY_ALREADY_REGISTERED",
      );
    }
    throw new PreviewAgentPairingError(
      "PREVIEW_AGENT_PAIRING_UNAVAILABLE",
    );
  }
}

export async function completePreviewAgentPairing(input: {
  pairingCode: string;
  storeId: string;
  publicKeyPem: string;
  proof: string;
  agentVersion: string;
  platform: "linux";
  now?: Date;
}): Promise<PreviewAgentNodeSummary> {
  const now = input.now ?? new Date();
  let codeHash: string;
  try {
    codeHash = hashPreviewAgentPairingCode(input.pairingCode);
  } catch {
    throw new PreviewAgentPairingError("PREVIEW_AGENT_PAIRING_NOT_FOUND");
  }

  try {
    return await db.transaction(async (tx) => {
      const rows = await tx
        .select()
        .from(previewAgentNodesTable)
        .where(eq(previewAgentNodesTable.pairingCodeHash, codeHash))
        .for("update")
        .limit(1);
      const node = rows[0];
      if (!node || node.storeId !== input.storeId) {
        throw new PreviewAgentPairingError(
          "PREVIEW_AGENT_PAIRING_NOT_FOUND",
        );
      }
      if (
        node.status === "pending" &&
        (!node.pairingExpiresAt || node.pairingExpiresAt <= now)
      ) {
        throw new PreviewAgentPairingError("PREVIEW_AGENT_PAIRING_EXPIRED");
      }
      if (node.status === "revoked") {
        throw new PreviewAgentPairingError(
          "PREVIEW_AGENT_PAIRING_NOT_FOUND",
        );
      }

      let fingerprint: string;
      let canonicalPublicKeyPem: string;
      try {
        fingerprint = verifyPreviewAgentPairingProof({
          pairingCode: input.pairingCode,
          nodeId: node.nodeId,
          storeId: node.storeId,
          expiresAt: node.pairingExpiresAt ?? now,
          publicKeyPem: input.publicKeyPem,
          proof: input.proof,
        });
        canonicalPublicKeyPem = canonicalPreviewAgentPublicKeyPem(
          input.publicKeyPem,
        );
      } catch {
        throw new PreviewAgentPairingError(
          "PREVIEW_AGENT_PAIRING_INVALID",
        );
      }

      if (node.status === "active") {
        if (node.publicKeyFingerprint !== fingerprint) {
          throw new PreviewAgentPairingError(
            "PREVIEW_AGENT_PAIRING_CONFLICT",
          );
        }
        return summarize(node);
      }

      const [paired] = await tx
        .update(previewAgentNodesTable)
        .set({
          status: "active",
          publicKeyPem: canonicalPublicKeyPem,
          publicKeyFingerprint: fingerprint,
          agentVersion: input.agentVersion,
          platform: input.platform,
          keyVersion: 1,
          pairedAt: now,
          updatedAt: now,
        })
        .where(
          and(
            eq(previewAgentNodesTable.nodeId, node.nodeId),
            eq(previewAgentNodesTable.status, "pending"),
            eq(previewAgentNodesTable.pairingCodeHash, codeHash),
          ),
        )
        .returning();
      if (!paired) {
        throw new PreviewAgentPairingError(
          "PREVIEW_AGENT_PAIRING_CONFLICT",
        );
      }
      return summarize(paired);
    });
  } catch (error) {
    if (error instanceof PreviewAgentPairingError) throw error;
    if (isUniqueViolation(error)) {
      throw new PreviewAgentPairingError(
        "PREVIEW_AGENT_KEY_ALREADY_REGISTERED",
      );
    }
    throw new PreviewAgentPairingError(
      "PREVIEW_AGENT_PAIRING_UNAVAILABLE",
    );
  }
}

export async function listPreviewAgentNodes(input: {
  projectId: string;
}): Promise<PreviewAgentNodeSummary[]> {
  try {
    const nodes = await db
      .select()
      .from(previewAgentNodesTable)
      .where(eq(previewAgentNodesTable.projectId, input.projectId))
      .orderBy(previewAgentNodesTable.createdAt);
    return nodes.map(summarize);
  } catch {
    throw new PreviewAgentPairingError(
      "PREVIEW_AGENT_PAIRING_UNAVAILABLE",
    );
  }
}

export async function revokePreviewAgentNode(input: {
  projectId: string;
  nodeId: string;
  now?: Date;
}): Promise<PreviewAgentNodeSummary | null> {
  const now = input.now ?? new Date();
  try {
    return await db.transaction(async (tx) => {
      const [node] = await tx
        .select()
        .from(previewAgentNodesTable)
        .where(
          and(
            eq(previewAgentNodesTable.nodeId, input.nodeId),
            eq(previewAgentNodesTable.projectId, input.projectId),
          ),
        )
        .for("update")
        .limit(1);
      if (!node) return null;
      if (node.status === "revoked") {
        if (!node.capabilityReportToken && !node.capabilityExpiresAt) {
          return summarize(node);
        }
        const [cleared] = await tx
          .update(previewAgentNodesTable)
          .set({
            capabilityReportToken: null,
            capabilityExpiresAt: null,
            updatedAt: now,
          })
          .where(
            and(
              eq(previewAgentNodesTable.nodeId, node.nodeId),
              eq(previewAgentNodesTable.status, "revoked"),
            ),
          )
          .returning();
        return cleared ? summarize(cleared) : summarize(node);
      }
      const [revoked] = await tx
        .update(previewAgentNodesTable)
        .set({
          status: "revoked",
          pairingCodeHash: null,
          pairingExpiresAt: null,
          capabilityReportToken: null,
          capabilityExpiresAt: null,
          revokedAt: now,
          updatedAt: now,
        })
        .where(
          and(
            eq(previewAgentNodesTable.nodeId, node.nodeId),
            inArray(previewAgentNodesTable.status, [...LIVE_NODE_STATUSES]),
          ),
        )
        .returning();
      return revoked ? summarize(revoked) : null;
    });
  } catch {
    throw new PreviewAgentPairingError(
      "PREVIEW_AGENT_PAIRING_UNAVAILABLE",
    );
  }
}
