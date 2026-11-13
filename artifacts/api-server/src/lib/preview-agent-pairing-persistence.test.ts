import { generateKeyPairSync, sign } from "node:crypto";
import { and, eq } from "drizzle-orm";
import {
  db,
  previewAgentNodesTable,
  projectsTable,
} from "@workspace/db";
import { afterEach, describe, expect, it } from "vitest";
import {
  completePreviewAgentPairing,
  createPreviewAgentPairing,
  PREVIEW_AGENT_PAIRING_TTL_MS,
  PreviewAgentPairingError,
} from "./preview-agent-pairing.js";
import {
  hashPreviewAgentPairingCode,
  previewAgentPairingProofPayload,
} from "./preview-agent-pairing-crypto.js";

const projectIds: string[] = [];

afterEach(async () => {
  for (const projectId of projectIds.splice(0)) {
    await db.delete(projectsTable).where(eq(projectsTable.id, projectId));
  }
});

async function createProject(ownerId: string): Promise<string> {
  const projectId = crypto.randomUUID();
  const now = new Date();
  projectIds.push(projectId);
  await db.insert(projectsTable).values({
    id: projectId,
    ownerId,
    name: `preview-agent-pairing-${projectId.slice(0, 8)}`,
    rootPath: `/tmp/${projectId}`,
    language: "typescript",
    status: "active",
    createdAt: now,
    updatedAt: now,
  });
  return projectId;
}

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

function pairingProof(input: {
  pairingCode: string;
  nodeId: string;
  storeId: string;
  expiresAt: Date;
  privateKeyPem: string;
}): string {
  return sign(
    null,
    previewAgentPairingProofPayload(input),
    input.privateKeyPem,
  ).toString("base64url");
}

async function insertPairing(input: {
  projectId: string;
  userId: string;
  storeId: string;
  now?: Date;
}) {
  return createPreviewAgentPairing(input);
}

describe("Preview Agent pairing PostgreSQL lifecycle", () => {
  it("persists only the pairing-code hash and makes proof completion idempotent for the same key", async () => {
    const projectId = await createProject("pairing-owner-a");
    const storeId = crypto.randomUUID();
    const created = await insertPairing({
      projectId,
      userId: "pairing-owner-a",
      storeId,
    });
    const [pending] = await db
      .select()
      .from(previewAgentNodesTable)
      .where(eq(previewAgentNodesTable.nodeId, created.nodeId));

    expect(pending?.status).toBe("pending");
    expect(pending?.pairingCodeHash).toBe(
      hashPreviewAgentPairingCode(created.pairingCode),
    );
    expect(pending?.pairingCodeHash).not.toBe(created.pairingCode);

    const keys = agentKeys();
    const proof = pairingProof({
      ...created,
      storeId,
      privateKeyPem: keys.privateKeyPem,
    });
    const completion = {
      pairingCode: created.pairingCode,
      storeId,
      publicKeyPem: keys.publicKeyPem,
      proof,
      agentVersion: "1.2.3",
      platform: "linux" as const,
    };
    const paired = await completePreviewAgentPairing(completion);
    const retry = await completePreviewAgentPairing(completion);

    expect(paired.status).toBe("active");
    expect(paired.publicKeyFingerprint).toMatch(/^[a-f0-9]{64}$/);
    expect(retry.nodeId).toBe(paired.nodeId);
    expect(retry.publicKeyFingerprint).toBe(paired.publicKeyFingerprint);

    const replacementKeys = agentKeys();
    const replacementProof = pairingProof({
      ...created,
      storeId,
      privateKeyPem: replacementKeys.privateKeyPem,
    });
    await expect(
      completePreviewAgentPairing({
        ...completion,
        publicKeyPem: replacementKeys.publicKeyPem,
        proof: replacementProof,
      }),
    ).rejects.toMatchObject({
      code: "PREVIEW_AGENT_PAIRING_CONFLICT",
    });
  });

  it("invalidates an older pending code when the same project renews pairing", async () => {
    const projectId = await createProject("pairing-owner-b");
    const storeId = crypto.randomUUID();
    const firstNow = new Date();
    const first = await insertPairing({
      projectId,
      userId: "pairing-owner-b",
      storeId,
      now: firstNow,
    });
    const renewed = await insertPairing({
      projectId,
      userId: "pairing-owner-b",
      storeId,
      now: new Date(firstNow.getTime() + 1_000),
    });

    expect(renewed.nodeId).toBe(first.nodeId);
    expect(renewed.pairingCode).not.toBe(first.pairingCode);
    expect(renewed.expiresAt.getTime()).toBe(
      firstNow.getTime() + 1_000 + PREVIEW_AGENT_PAIRING_TTL_MS,
    );
    await expect(
      completePreviewAgentPairing({
        pairingCode: first.pairingCode,
        storeId,
        ...agentKeys(),
        proof: "A".repeat(86),
        agentVersion: "1.2.3",
        platform: "linux",
      }),
    ).rejects.toMatchObject({
      code: "PREVIEW_AGENT_PAIRING_NOT_FOUND",
    });
  });

  it("serializes concurrent pairing attempts so one store cannot be claimed by two projects", async () => {
    const projectA = await createProject("pairing-owner-c");
    const projectB = await createProject("pairing-owner-d");
    const storeId = crypto.randomUUID();
    const results = await Promise.allSettled([
      insertPairing({
        projectId: projectA,
        userId: "pairing-owner-c",
        storeId,
      }),
      insertPairing({
        projectId: projectB,
        userId: "pairing-owner-d",
        storeId,
      }),
    ]);

    expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(1);
    const rejected = results.find(
      (result): result is PromiseRejectedResult => result.status === "rejected",
    );
    expect(rejected?.reason).toBeInstanceOf(PreviewAgentPairingError);
    expect(rejected?.reason.code).toBe("PREVIEW_AGENT_PAIRING_CONFLICT");

    const nodes = await db
      .select()
      .from(previewAgentNodesTable)
      .where(
        and(
          eq(previewAgentNodesTable.storeId, storeId),
          eq(previewAgentNodesTable.status, "pending"),
        ),
      );
    expect(nodes).toHaveLength(1);
    expect([projectA, projectB]).toContain(nodes[0]?.projectId);
  });
});
