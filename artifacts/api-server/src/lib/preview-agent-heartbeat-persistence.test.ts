import { generateKeyPairSync, randomUUID, sign } from "node:crypto";
import { eq } from "drizzle-orm";
import {
  db,
  previewAgentNodesTable,
  projectsTable,
} from "@workspace/db";
import { afterEach, describe, expect, it } from "vitest";
import {
  completePreviewAgentPairing,
  createPreviewAgentPairing,
  revokePreviewAgentNode,
} from "./preview-agent-pairing.js";
import {
  previewAgentHeartbeatChallengeRequestPayload,
  previewAgentPairingProofPayload,
  previewAgentHeartbeatProofPayload,
} from "./preview-agent-pairing-crypto.js";
import {
  acceptPreviewAgentHeartbeat,
  issuePreviewAgentHeartbeatChallenge,
  PREVIEW_AGENT_HEARTBEAT_CHALLENGE_TTL_MS,
  PreviewAgentHeartbeatError,
} from "./preview-agent-heartbeat.js";

const projectIds: string[] = [];

afterEach(async () => {
  for (const projectId of projectIds.splice(0)) {
    await db.delete(projectsTable).where(eq(projectsTable.id, projectId));
  }
});

function agentKeys() {
  const keys = generateKeyPairSync("ed25519");
  return {
    privateKeyPem: keys.privateKey
      .export({ type: "pkcs8", format: "pem" })
      .toString(),
    publicKeyPem: keys.publicKey
      .export({ type: "spki", format: "pem" })
      .toString(),
  };
}

async function createPairedAgent() {
  const projectId = crypto.randomUUID();
  const storeId = crypto.randomUUID();
  const now = new Date();
  projectIds.push(projectId);
  await db.insert(projectsTable).values({
    id: projectId,
    ownerId: "preview-agent-heartbeat-test",
    name: `preview-agent-heartbeat-${projectId.slice(0, 8)}`,
    rootPath: `/tmp/${projectId}`,
    language: "typescript",
    status: "active",
    createdAt: now,
    updatedAt: now,
  });
  const pairing = await createPreviewAgentPairing({
    projectId,
    userId: "preview-agent-heartbeat-test",
    storeId,
    now,
  });
  const keys = agentKeys();
  const proof = sign(
    null,
    previewAgentPairingProofPayload({
      pairingCode: pairing.pairingCode,
      nodeId: pairing.nodeId,
      storeId,
      expiresAt: pairing.expiresAt,
    }),
    keys.privateKeyPem,
  ).toString("base64url");
  await completePreviewAgentPairing({
    pairingCode: pairing.pairingCode,
    storeId,
    publicKeyPem: keys.publicKeyPem,
    proof,
    agentVersion: "1.2.3",
    platform: "linux",
    now,
  });
  return { projectId, pairing, keys, now };
}

function heartbeatProof(input: {
  nodeId: string;
  keyVersion: number;
  sequence: number;
  challenge: string;
  privateKeyPem: string;
}) {
  const proof = {
    version: 1 as const,
    action: "preview-agent-heartbeat" as const,
    nodeId: input.nodeId,
    keyVersion: input.keyVersion,
    sequence: input.sequence,
    challenge: input.challenge,
  };
  return {
    proof,
    signature: sign(
      null,
      previewAgentHeartbeatProofPayload(proof),
      input.privateKeyPem,
    ).toString("base64url"),
  };
}

function signedChallengeRequest(input: {
  nodeId: string;
  keyVersion: number;
  sequence: number;
  privateKeyPem: string;
}) {
  const proof = {
    version: 1 as const,
    action: "request-preview-agent-heartbeat-challenge" as const,
    nodeId: input.nodeId,
    keyVersion: input.keyVersion,
    sequence: input.sequence,
    nonce: randomUUID(),
  };
  return {
    proof,
    signature: sign(
      null,
      previewAgentHeartbeatChallengeRequestPayload(proof),
      input.privateKeyPem,
    ).toString("base64url"),
  };
}

async function issueChallenge(input: {
  nodeId: string;
  keyVersion: number;
  sequence: number;
  privateKeyPem: string;
  now?: Date;
}) {
  return issuePreviewAgentHeartbeatChallenge({
    ...signedChallengeRequest(input),
    now: input.now,
  });
}

describe("Preview Agent heartbeat PostgreSQL lifecycle", () => {
  it("consumes a hashed challenge once and makes only an identical retry idempotent", async () => {
    const { pairing, keys, now } = await createPairedAgent();
    const challengeRequest = signedChallengeRequest({
      nodeId: pairing.nodeId,
      keyVersion: 1,
      sequence: 1,
      privateKeyPem: keys.privateKeyPem,
    });
    const issued = await issuePreviewAgentHeartbeatChallenge({
      ...challengeRequest,
      now,
    });
    const [pending] = await db
      .select({
        heartbeatChallengeHash: previewAgentNodesTable.heartbeatChallengeHash,
        heartbeatChallengeExpiresAt:
          previewAgentNodesTable.heartbeatChallengeExpiresAt,
        lastHeartbeatSequence: previewAgentNodesTable.lastHeartbeatSequence,
        lastHeartbeatRequestHash:
          previewAgentNodesTable.lastHeartbeatRequestHash,
      })
      .from(previewAgentNodesTable)
      .where(eq(previewAgentNodesTable.nodeId, pairing.nodeId));

    expect(issued.challenge).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(pending?.heartbeatChallengeHash).toMatch(/^[a-f0-9]{64}$/);
    expect(pending?.heartbeatChallengeHash).not.toBe(issued.challenge);
    expect(pending?.heartbeatChallengeExpiresAt?.getTime()).toBe(
      now.getTime() + PREVIEW_AGENT_HEARTBEAT_CHALLENGE_TTL_MS,
    );
    expect(pending?.lastHeartbeatSequence).toBe(1);
    expect(pending?.lastHeartbeatRequestHash).toMatch(/^[a-f0-9]{64}$/);

    const signed = heartbeatProof({
      nodeId: pairing.nodeId,
      keyVersion: issued.keyVersion,
      sequence: 1,
      challenge: issued.challenge,
      privateKeyPem: keys.privateKeyPem,
    });
    const accepted = await acceptPreviewAgentHeartbeat({
      ...signed,
      now: new Date(now.getTime() + 1_000),
    });
    const retry = await acceptPreviewAgentHeartbeat({
      ...signed,
      now: new Date(now.getTime() + 2_000),
    });
    const [stored] = await db
      .select({
        heartbeatChallengeHash: previewAgentNodesTable.heartbeatChallengeHash,
        heartbeatChallengeExpiresAt:
          previewAgentNodesTable.heartbeatChallengeExpiresAt,
        lastHeartbeatSequence: previewAgentNodesTable.lastHeartbeatSequence,
        lastHeartbeatRequestHash:
          previewAgentNodesTable.lastHeartbeatRequestHash,
        lastSeenAt: previewAgentNodesTable.lastSeenAt,
      })
      .from(previewAgentNodesTable)
      .where(eq(previewAgentNodesTable.nodeId, pairing.nodeId));

    expect(accepted).toMatchObject({
      nodeId: pairing.nodeId,
      sequence: 1,
      alreadyAccepted: false,
      lastSeenAt: new Date(now.getTime() + 1_000),
    });
    expect(retry).toEqual({
      ...accepted,
      alreadyAccepted: true,
    });
    expect(stored?.heartbeatChallengeHash).toBeNull();
    expect(stored?.heartbeatChallengeExpiresAt).toBeNull();
    expect(stored?.lastHeartbeatSequence).toBe(1);
    expect(stored?.lastHeartbeatRequestHash).toMatch(/^[a-f0-9]{64}$/);
    expect(stored?.lastSeenAt?.getTime()).toBe(now.getTime() + 1_000);
    await expect(
      issuePreviewAgentHeartbeatChallenge({
        ...challengeRequest,
        now: new Date(now.getTime() + 3_000),
      }),
    ).rejects.toMatchObject({
      code: "PREVIEW_AGENT_HEARTBEAT_REPLAY",
    });

    const alteredReplay = heartbeatProof({
      nodeId: pairing.nodeId,
      keyVersion: issued.keyVersion,
      sequence: 1,
      challenge: "B".repeat(43),
      privateKeyPem: keys.privateKeyPem,
    });
    await expect(
      acceptPreviewAgentHeartbeat({
        ...alteredReplay,
        now: new Date(now.getTime() + 3_000),
      }),
    ).rejects.toMatchObject({
      code: "PREVIEW_AGENT_HEARTBEAT_REPLAY",
    });
  });

  it("does not reserve a sequence for a challenge signed by another key", async () => {
    const { pairing, now } = await createPairedAgent();
    const unrelatedKeys = agentKeys();
    const forgedRequest = signedChallengeRequest({
      nodeId: pairing.nodeId,
      keyVersion: 1,
      sequence: 1,
      privateKeyPem: unrelatedKeys.privateKeyPem,
    });

    await expect(
      issuePreviewAgentHeartbeatChallenge({
        ...forgedRequest,
        now,
      }),
    ).rejects.toMatchObject({
      code: "PREVIEW_AGENT_HEARTBEAT_INVALID",
    });
    const [stored] = await db
      .select({
        heartbeatChallengeHash: previewAgentNodesTable.heartbeatChallengeHash,
        lastHeartbeatSequence: previewAgentNodesTable.lastHeartbeatSequence,
        lastHeartbeatRequestHash:
          previewAgentNodesTable.lastHeartbeatRequestHash,
      })
      .from(previewAgentNodesTable)
      .where(eq(previewAgentNodesTable.nodeId, pairing.nodeId));

    expect(stored?.heartbeatChallengeHash).toBeNull();
    expect(stored?.lastHeartbeatSequence).toBe(0);
    expect(stored?.lastHeartbeatRequestHash).toBeNull();
  });

  it("serializes concurrent copies of the same heartbeat without extending presence twice", async () => {
    const { pairing, keys, now } = await createPairedAgent();
    const issued = await issueChallenge({
      nodeId: pairing.nodeId,
      keyVersion: 1,
      sequence: 1,
      privateKeyPem: keys.privateKeyPem,
      now,
    });
    const signed = heartbeatProof({
      nodeId: pairing.nodeId,
      keyVersion: issued.keyVersion,
      sequence: 1,
      challenge: issued.challenge,
      privateKeyPem: keys.privateKeyPem,
    });
    const requestNow = new Date(now.getTime() + 1_000);
    const results = await Promise.all([
      acceptPreviewAgentHeartbeat({ ...signed, now: requestNow }),
      acceptPreviewAgentHeartbeat({ ...signed, now: requestNow }),
    ]);
    const [stored] = await db
      .select({
        lastHeartbeatSequence: previewAgentNodesTable.lastHeartbeatSequence,
        lastSeenAt: previewAgentNodesTable.lastSeenAt,
      })
      .from(previewAgentNodesTable)
      .where(eq(previewAgentNodesTable.nodeId, pairing.nodeId));

    expect(results.filter((result) => !result.alreadyAccepted)).toHaveLength(1);
    expect(results.filter((result) => result.alreadyAccepted)).toHaveLength(1);
    expect(stored?.lastHeartbeatSequence).toBe(1);
    expect(stored?.lastSeenAt?.getTime()).toBe(requestNow.getTime());
  });

  it("expires an unused challenge and accepts a replacement only with a newer proof", async () => {
    const { pairing, keys, now } = await createPairedAgent();
    const firstChallenge = await issueChallenge({
      nodeId: pairing.nodeId,
      keyVersion: 1,
      sequence: 1,
      privateKeyPem: keys.privateKeyPem,
      now,
    });
    const expiredAt = new Date(
      now.getTime() + PREVIEW_AGENT_HEARTBEAT_CHALLENGE_TTL_MS + 1,
    );
    const expiredProof = heartbeatProof({
      nodeId: pairing.nodeId,
      keyVersion: firstChallenge.keyVersion,
      sequence: 1,
      challenge: firstChallenge.challenge,
      privateKeyPem: keys.privateKeyPem,
    });
    await expect(
      acceptPreviewAgentHeartbeat({
        ...expiredProof,
        now: expiredAt,
      }),
    ).rejects.toMatchObject({
      code: "PREVIEW_AGENT_HEARTBEAT_INVALID",
    });

    const replacement = await issueChallenge({
      nodeId: pairing.nodeId,
      keyVersion: 1,
      sequence: 2,
      privateKeyPem: keys.privateKeyPem,
      now: new Date(expiredAt.getTime() + 1),
    });
    expect(replacement.challenge).not.toBe(firstChallenge.challenge);
    const replacementProof = heartbeatProof({
      nodeId: pairing.nodeId,
      keyVersion: replacement.keyVersion,
      sequence: 2,
      challenge: replacement.challenge,
      privateKeyPem: keys.privateKeyPem,
    });
    await expect(
      acceptPreviewAgentHeartbeat({
        ...replacementProof,
        now: new Date(expiredAt.getTime() + 2),
      }),
    ).resolves.toMatchObject({
      sequence: 2,
      alreadyAccepted: false,
    });
  });

  it("does not replace a live challenge and rejects heartbeat after revocation", async () => {
    const { projectId, pairing, keys, now } = await createPairedAgent();
    const issued = await issueChallenge({
      nodeId: pairing.nodeId,
      keyVersion: 1,
      sequence: 1,
      privateKeyPem: keys.privateKeyPem,
      now,
    });
    await expect(
      issueChallenge({
        nodeId: pairing.nodeId,
        keyVersion: 1,
        sequence: 2,
        privateKeyPem: keys.privateKeyPem,
        now: new Date(now.getTime() + 1_000),
      }),
    ).rejects.toMatchObject({
      code: "PREVIEW_AGENT_HEARTBEAT_CHALLENGE_PENDING",
    });
    const signed = heartbeatProof({
      nodeId: pairing.nodeId,
      keyVersion: issued.keyVersion,
      sequence: 1,
      challenge: issued.challenge,
      privateKeyPem: keys.privateKeyPem,
    });
    await revokePreviewAgentNode({
      projectId,
      nodeId: pairing.nodeId,
      now: new Date(now.getTime() + 2_000),
    });
    await expect(
      acceptPreviewAgentHeartbeat({
        ...signed,
        now: new Date(now.getTime() + 3_000),
      }),
    ).rejects.toBeInstanceOf(PreviewAgentHeartbeatError);
  });
});
