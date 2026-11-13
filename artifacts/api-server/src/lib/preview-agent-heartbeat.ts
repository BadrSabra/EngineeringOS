import { createHash } from "node:crypto";
import { and, eq, isNull } from "drizzle-orm";
import {
  db,
  previewAgentNodesTable,
  type PreviewAgentNode,
} from "@workspace/db";
import {
  createPreviewAgentHeartbeatChallenge,
  hashPreviewAgentHeartbeatChallenge,
  previewAgentPublicKeyFingerprint,
  previewAgentHeartbeatChallengeRequestPayload,
  previewAgentHeartbeatProofPayload,
  verifyPreviewAgentHeartbeatChallengeRequest,
  verifyPreviewAgentHeartbeatProof,
} from "./preview-agent-pairing-crypto.js";

export const PREVIEW_AGENT_HEARTBEAT_CHALLENGE_TTL_MS = 60_000;
const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const SIGNATURE_PATTERN = /^[A-Za-z0-9_-]{86}$/;

export class PreviewAgentHeartbeatError extends Error {
  constructor(
    readonly code:
      | "PREVIEW_AGENT_HEARTBEAT_INVALID"
      | "PREVIEW_AGENT_HEARTBEAT_CHALLENGE_PENDING"
      | "PREVIEW_AGENT_HEARTBEAT_REPLAY"
      | "PREVIEW_AGENT_HEARTBEAT_UNAVAILABLE",
  ) {
    super("Preview Agent heartbeat is invalid or unavailable.");
    this.name = "PreviewAgentHeartbeatError";
  }
}

export type PreviewAgentHeartbeatProof = {
  version: 1;
  action: "preview-agent-heartbeat";
  nodeId: string;
  keyVersion: number;
  sequence: number;
  challenge: string;
};

export type PreviewAgentHeartbeatChallengeRequestProof = {
  version: 1;
  action: "request-preview-agent-heartbeat-challenge";
  nodeId: string;
  keyVersion: number;
  sequence: number;
  nonce: string;
};

function signedRequestHash(
  payload: Buffer,
  signature: string,
): string {
  return createHash("sha256")
    .update(payload)
    .update(Buffer.from("\n", "ascii"))
    .update(signature, "ascii")
    .digest("hex");
}

function nodeHasValidRegisteredKey(
  node: PreviewAgentNode,
): node is PreviewAgentNode & {
  publicKeyPem: string;
  publicKeyFingerprint: string;
} {
  if (
    node.status !== "active" ||
    !node.publicKeyPem ||
    !node.publicKeyFingerprint ||
    !/^[a-f0-9]{64}$/i.test(node.publicKeyFingerprint)
  ) {
    return false;
  }
  try {
    return (
      previewAgentPublicKeyFingerprint(node.publicKeyPem) ===
      node.publicKeyFingerprint
    );
  } catch {
    return false;
  }
}

export async function issuePreviewAgentHeartbeatChallenge(input: {
  proof: PreviewAgentHeartbeatChallengeRequestProof;
  signature: string;
  now?: Date;
}): Promise<{
  nodeId: string;
  keyVersion: number;
  challenge: string;
  expiresAt: Date;
}> {
  const now = input.now ?? new Date();
  const { proof, signature } = input;
  if (
    proof.version !== 1 ||
    proof.action !== "request-preview-agent-heartbeat-challenge" ||
    !UUID_PATTERN.test(proof.nodeId) ||
    !UUID_PATTERN.test(proof.nonce) ||
    !Number.isSafeInteger(proof.keyVersion) ||
    proof.keyVersion <= 0 ||
    proof.keyVersion > 1_000_000 ||
    !Number.isSafeInteger(proof.sequence) ||
    proof.sequence <= 0 ||
    proof.sequence > 2_147_483_647 ||
    typeof signature !== "string" ||
    !SIGNATURE_PATTERN.test(signature) ||
    !Number.isFinite(now.getTime())
  ) {
    throw new PreviewAgentHeartbeatError("PREVIEW_AGENT_HEARTBEAT_INVALID");
  }
  let requestHash: string;
  try {
    const payload = previewAgentHeartbeatChallengeRequestPayload(proof);
    requestHash = signedRequestHash(payload, signature);
  } catch {
    throw new PreviewAgentHeartbeatError("PREVIEW_AGENT_HEARTBEAT_INVALID");
  }
  const challenge = createPreviewAgentHeartbeatChallenge();
  const challengeHash = hashPreviewAgentHeartbeatChallenge(challenge);
  const expiresAt = new Date(
    now.getTime() + PREVIEW_AGENT_HEARTBEAT_CHALLENGE_TTL_MS,
  );

  try {
    return await db.transaction(async (tx) => {
      const [node] = await tx
        .select()
        .from(previewAgentNodesTable)
        .where(eq(previewAgentNodesTable.nodeId, proof.nodeId))
        .for("update")
        .limit(1);
      if (
        !node ||
        !nodeHasValidRegisteredKey(node) ||
        node.keyVersion !== proof.keyVersion
      ) {
        throw new PreviewAgentHeartbeatError(
          "PREVIEW_AGENT_HEARTBEAT_INVALID",
        );
      }
      let fingerprint: string;
      try {
        fingerprint = verifyPreviewAgentHeartbeatChallengeRequest({
          ...proof,
          publicKeyPem: node.publicKeyPem,
          signature,
        });
      } catch {
        throw new PreviewAgentHeartbeatError(
          "PREVIEW_AGENT_HEARTBEAT_INVALID",
        );
      }
      if (fingerprint !== node.publicKeyFingerprint) {
        throw new PreviewAgentHeartbeatError(
          "PREVIEW_AGENT_HEARTBEAT_INVALID",
        );
      }
      if (
        node.heartbeatChallengeHash &&
        node.heartbeatChallengeExpiresAt &&
        node.heartbeatChallengeExpiresAt > now
      ) {
        throw new PreviewAgentHeartbeatError(
          "PREVIEW_AGENT_HEARTBEAT_CHALLENGE_PENDING",
        );
      }
      if (proof.sequence <= node.lastHeartbeatSequence) {
        throw new PreviewAgentHeartbeatError(
          "PREVIEW_AGENT_HEARTBEAT_REPLAY",
        );
      }
      const [updated] = await tx
        .update(previewAgentNodesTable)
        .set({
          heartbeatChallengeHash: challengeHash,
          heartbeatChallengeExpiresAt: expiresAt,
          lastHeartbeatSequence: proof.sequence,
          lastHeartbeatRequestHash: requestHash,
          updatedAt: now,
        })
        .where(
          and(
            eq(previewAgentNodesTable.nodeId, node.nodeId),
            eq(previewAgentNodesTable.status, "active"),
            eq(previewAgentNodesTable.keyVersion, node.keyVersion),
            eq(
              previewAgentNodesTable.lastHeartbeatSequence,
              node.lastHeartbeatSequence,
            ),
            eq(
              previewAgentNodesTable.publicKeyFingerprint,
              node.publicKeyFingerprint,
            ),
          ),
        )
        .returning({ nodeId: previewAgentNodesTable.nodeId });
      if (!updated) {
        throw new PreviewAgentHeartbeatError(
          "PREVIEW_AGENT_HEARTBEAT_INVALID",
        );
      }
      return {
        nodeId: node.nodeId,
        keyVersion: node.keyVersion,
        challenge,
        expiresAt,
      };
    });
  } catch (error) {
    if (error instanceof PreviewAgentHeartbeatError) throw error;
    throw new PreviewAgentHeartbeatError(
      "PREVIEW_AGENT_HEARTBEAT_UNAVAILABLE",
    );
  }
}

export async function acceptPreviewAgentHeartbeat(input: {
  proof: PreviewAgentHeartbeatProof;
  signature: string;
  now?: Date;
}): Promise<{
  nodeId: string;
  sequence: number;
  lastSeenAt: Date;
  alreadyAccepted: boolean;
}> {
  const now = input.now ?? new Date();
  const { proof, signature } = input;
  if (
    !UUID_PATTERN.test(proof.nodeId) ||
    !Number.isSafeInteger(proof.keyVersion) ||
    proof.keyVersion <= 0 ||
    proof.keyVersion > 1_000_000 ||
    !Number.isSafeInteger(proof.sequence) ||
    proof.sequence <= 0 ||
    proof.sequence > 2_147_483_647 ||
    typeof signature !== "string" ||
    !SIGNATURE_PATTERN.test(signature) ||
    !Number.isFinite(now.getTime())
  ) {
    throw new PreviewAgentHeartbeatError(
      "PREVIEW_AGENT_HEARTBEAT_INVALID",
    );
  }

  let challengeHash: string;
  let requestHash: string;
  try {
    challengeHash = hashPreviewAgentHeartbeatChallenge(proof.challenge);
    requestHash = signedRequestHash(
      previewAgentHeartbeatProofPayload(proof),
      signature,
    );
  } catch {
    throw new PreviewAgentHeartbeatError(
      "PREVIEW_AGENT_HEARTBEAT_INVALID",
    );
  }

  try {
    return await db.transaction(async (tx) => {
      const [node] = await tx
        .select()
        .from(previewAgentNodesTable)
        .where(eq(previewAgentNodesTable.nodeId, proof.nodeId))
        .for("update")
        .limit(1);
      if (
        !node ||
        !nodeHasValidRegisteredKey(node) ||
        node.keyVersion !== proof.keyVersion
      ) {
        throw new PreviewAgentHeartbeatError(
          "PREVIEW_AGENT_HEARTBEAT_INVALID",
        );
      }

      let fingerprint: string;
      try {
        fingerprint = verifyPreviewAgentHeartbeatProof({
          ...proof,
          publicKeyPem: node.publicKeyPem,
          signature,
        });
      } catch {
        throw new PreviewAgentHeartbeatError(
          "PREVIEW_AGENT_HEARTBEAT_INVALID",
        );
      }
      if (fingerprint !== node.publicKeyFingerprint) {
        throw new PreviewAgentHeartbeatError(
          "PREVIEW_AGENT_HEARTBEAT_INVALID",
        );
      }

      if (proof.sequence === node.lastHeartbeatSequence) {
        if (
          node.lastHeartbeatRequestHash === requestHash &&
          node.lastSeenAt
        ) {
          return {
            nodeId: node.nodeId,
            sequence: node.lastHeartbeatSequence,
            lastSeenAt: node.lastSeenAt,
            alreadyAccepted: true,
          };
        }
        if (
          !node.heartbeatChallengeHash ||
          !node.heartbeatChallengeExpiresAt
        ) {
          throw new PreviewAgentHeartbeatError(
            "PREVIEW_AGENT_HEARTBEAT_REPLAY",
          );
        }
      } else {
        throw new PreviewAgentHeartbeatError(
          "PREVIEW_AGENT_HEARTBEAT_REPLAY",
        );
      }

      if (
        !node.heartbeatChallengeHash ||
        !node.heartbeatChallengeExpiresAt ||
        node.heartbeatChallengeExpiresAt <= now ||
        node.heartbeatChallengeHash !== challengeHash
      ) {
        throw new PreviewAgentHeartbeatError(
          "PREVIEW_AGENT_HEARTBEAT_INVALID",
        );
      }

      const [updated] = await tx
        .update(previewAgentNodesTable)
        .set({
          heartbeatChallengeHash: null,
          heartbeatChallengeExpiresAt: null,
          lastHeartbeatSequence: proof.sequence,
          lastHeartbeatRequestHash: requestHash,
          lastSeenAt: now,
          updatedAt: now,
        })
        .where(
          and(
            eq(previewAgentNodesTable.nodeId, node.nodeId),
            eq(previewAgentNodesTable.status, "active"),
            eq(previewAgentNodesTable.keyVersion, node.keyVersion),
            eq(
              previewAgentNodesTable.publicKeyFingerprint,
              node.publicKeyFingerprint,
            ),
            eq(
              previewAgentNodesTable.lastHeartbeatSequence,
              node.lastHeartbeatSequence,
            ),
            node.lastHeartbeatRequestHash === null
              ? isNull(previewAgentNodesTable.lastHeartbeatRequestHash)
              : eq(
                  previewAgentNodesTable.lastHeartbeatRequestHash,
                  node.lastHeartbeatRequestHash,
                ),
            eq(
              previewAgentNodesTable.heartbeatChallengeHash,
              challengeHash,
            ),
          ),
        )
        .returning({
          nodeId: previewAgentNodesTable.nodeId,
          lastHeartbeatSequence: previewAgentNodesTable.lastHeartbeatSequence,
          lastSeenAt: previewAgentNodesTable.lastSeenAt,
        });
      if (!updated?.lastSeenAt) {
        throw new PreviewAgentHeartbeatError(
          "PREVIEW_AGENT_HEARTBEAT_REPLAY",
        );
      }
      return {
        nodeId: updated.nodeId,
        sequence: updated.lastHeartbeatSequence,
        lastSeenAt: updated.lastSeenAt,
        alreadyAccepted: false,
      };
    });
  } catch (error) {
    if (error instanceof PreviewAgentHeartbeatError) throw error;
    throw new PreviewAgentHeartbeatError(
      "PREVIEW_AGENT_HEARTBEAT_UNAVAILABLE",
    );
  }
}
