import { randomUUID, generateKeyPairSync } from "node:crypto";
import { eq } from "drizzle-orm";
import {
  aiChangeProposalsTable,
  aiChatMessagesTable,
  aiChatSessionsTable,
  db,
  previewAgentNodesTable,
  previewBuildJobsTable,
  projectsTable,
} from "@workspace/db";
import { afterEach, describe, expect, it } from "vitest";
import {
  previewAgentPublicKeyFingerprint,
} from "./preview-agent-pairing-crypto.js";
import {
  previewArtifactStoreCommandId,
  previewBuildArtifactRefId,
} from "./preview-artifact-reference.js";
import {
  previewArtifactStoreCommandFingerprint,
  previewArtifactStoreCommandPublicKeyPem,
  signPreviewArtifactStoreCommand,
  signPreviewArtifactStorePollProof,
  signPreviewArtifactStoreReceipt,
  type PreviewArtifactStoreCommandClaims,
  type PreviewArtifactStorePollProofClaims,
  type PreviewArtifactStoreReceiptClaims,
  verifyPreviewArtifactStoreCommand,
} from "./preview-artifact-store-command.js";
import {
  acceptPreviewBuildInputStoreReceipt,
  PreviewArtifactStoreAcceptanceError,
} from "./preview-artifact-store-acceptance.js";
import { issuePreviewBuildInputStoreCommand } from "./preview-artifact-store-issuer.js";

const NOW = new Date("2026-11-12T12:00:00.000Z");
const SOURCE_DIGEST = "a".repeat(64);
const CANDIDATE_REVISION = "b".repeat(64);
const CHANGE_SET_HASH = "c".repeat(64);
const ARCHIVE_DIGEST = "d".repeat(64);
const MANIFEST_DIGEST = "e".repeat(64);
const API_KEYS = generateKeyPairSync("ed25519");
const API_PRIVATE_KEY_PEM = API_KEYS.privateKey
  .export({ type: "pkcs8", format: "pem" })
  .toString();
const AGENT_KEYS = generateKeyPairSync("ed25519");
const AGENT_PRIVATE_KEY_PEM = AGENT_KEYS.privateKey
  .export({ type: "pkcs8", format: "pem" })
  .toString();
const AGENT_PUBLIC_KEY_PEM = AGENT_KEYS.publicKey
  .export({ type: "spki", format: "pem" })
  .toString();

const projectIds: string[] = [];

async function createFixture() {
  const projectId = randomUUID();
  const proposalId = `proposal-${randomUUID()}`;
  const sessionId = `session-${randomUUID()}`;
  const messageId = `message-${randomUUID()}`;
  const jobId = randomUUID();
  const buildId = randomUUID();
  const clientRequestId = randomUUID();
  const nodeId = randomUUID();
  const storeId = randomUUID();
  const ownerId = `preview-owner-${randomUUID()}`;
  const operationId = `operation-${randomUUID()}`;
  const now = NOW;
  projectIds.push(projectId);

  await db.insert(projectsTable).values({
    id: projectId,
    ownerId,
    name: `preview-store-${projectId.slice(0, 8)}`,
    rootPath: `/tmp/${projectId}`,
    language: "typescript",
    status: "active",
    createdAt: now,
    updatedAt: now,
  });
  await db.insert(aiChatSessionsTable).values({
    id: sessionId,
    projectId,
    title: "Preview artifact acceptance test",
    createdAt: now,
    updatedAt: now,
  });
  await db.insert(aiChatMessagesTable).values({
    id: messageId,
    sessionId,
    role: "assistant",
    content: "Fixture",
    createdAt: now,
  });
  await db.insert(aiChangeProposalsTable).values({
    id: proposalId,
    projectId,
    sessionId,
    messageId,
    changes: "[]",
    status: "pending",
    revision: 2,
    operationId,
    workspaceRoot: `/tmp/candidate-${projectId}`,
    candidateTreeHash: CANDIDATE_REVISION,
    changeSetHash: CHANGE_SET_HASH,
    lifecycle: "isolated",
    createdAt: now,
  });
  await db.insert(previewAgentNodesTable).values({
    nodeId,
    projectId,
    userId: ownerId,
    storeId,
    status: "active",
    publicKeyPem: AGENT_PUBLIC_KEY_PEM,
    publicKeyFingerprint: previewAgentPublicKeyFingerprint(
      AGENT_PUBLIC_KEY_PEM,
    ),
    agentVersion: "1.0.0",
    platform: "linux",
    keyVersion: 1,
    pairedAt: now,
    createdAt: now,
    updatedAt: now,
  });

  const inputArtifactRefId = previewBuildArtifactRefId(jobId, "input");
  const outputArtifactKey = `preview-build-outputs/${buildId}/site.tar.gz`;
  const command: PreviewArtifactStoreCommandClaims = {
    version: 1,
    action: "store-artifact",
    commandId: previewArtifactStoreCommandId(jobId),
    nodeId,
    keyVersion: 1,
    storeId,
    artifactRefId: inputArtifactRefId,
    jobId,
    projectId,
    proposalId,
    operationId,
    proposalRevision: 2,
    candidateRevision: CANDIDATE_REVISION,
    changeSetHash: CHANGE_SET_HASH,
    artifactKind: "preview-build-input",
    sourceDigest: SOURCE_DIGEST,
    artifactDigest: ARCHIVE_DIGEST,
    sizeBytes: 2048,
    manifestDigest: MANIFEST_DIGEST,
    retentionPolicy: "preview-build-input-24h-v1",
    issuedAt: now.toISOString(),
    expiresAt: new Date(now.getTime() + 30_000).toISOString(),
  };
  const commandToken = signPreviewArtifactStoreCommand({
    command,
    privateKeyPem: API_PRIVATE_KEY_PEM,
    now,
  });
  await db.insert(previewBuildJobsTable).values({
    jobId,
    buildId,
    projectId,
    proposalId,
    userId: ownerId,
    clientRequestId,
    operationId,
    proposalRevision: 2,
    candidateRevision: CANDIDATE_REVISION,
    changeSetHash: CHANGE_SET_HASH,
    sourceRoot: "web",
    sourceDigest: SOURCE_DIGEST,
    archiveDigest: ARCHIVE_DIGEST,
    inputArtifactKey: `preview-build-inputs/${jobId}.zip`,
    inputArtifactProvider: "local",
    inputArtifactStoreId: storeId,
    inputArtifactRefId,
    inputArtifactSizeBytes: 2048,
    inputArtifactManifestDigest: MANIFEST_DIGEST,
    inputArtifactRetentionPolicy: "preview-build-input-24h-v1",
    inputArtifactOwnerNodeId: nodeId,
    inputArtifactOwnerKeyVersion: 1,
    inputArtifactStoreCommandFingerprint:
      previewArtifactStoreCommandFingerprint(command),
    inputArtifactStoreReceiptFingerprint: null,
    inputArtifactReadyAt: null,
    inputArtifactGcState: "active",
    outputArtifactKey,
    outputArtifactProvider: "s3",
    outputArtifactGcState: "active",
    builderImageDigest: `sha256:${"f".repeat(64)}`,
    issuedAt: new Date(now.getTime() - 1_000),
    tokenExpiresAt: new Date(now.getTime() + 4 * 60_000),
    status: "queued",
    stateVersion: 0,
    createdAt: now,
    updatedAt: now,
  });

  const receipt: PreviewArtifactStoreReceiptClaims = {
    version: 1,
    action: "artifact-store-receipt",
    commandId: command.commandId,
    commandFingerprint: previewArtifactStoreCommandFingerprint(command),
    nodeId,
    keyVersion: 1,
    storeId,
    artifactRefId: inputArtifactRefId,
    artifactDigest: ARCHIVE_DIGEST,
    sizeBytes: 2048,
    manifestDigest: MANIFEST_DIGEST,
    result: "stored",
    completedAt: new Date(now.getTime() + 2_000).toISOString(),
  };
  const receiptToken = signPreviewArtifactStoreReceipt({
    receipt,
    privateKeyPem: AGENT_PRIVATE_KEY_PEM,
    now,
  });
  return {
    projectId,
    proposalId,
    jobId,
    nodeId,
    storeId,
    commandToken,
    receiptToken,
    command,
    receipt,
  };
}

function createPollProof(
  jobId: string,
  nodeId: string,
  now: Date,
) {
  const proof: PreviewArtifactStorePollProofClaims = {
    version: 1,
    action: "poll-artifact-store-command",
    nodeId,
    keyVersion: 1,
    jobId,
    issuedAt: now.toISOString(),
    nonce: randomUUID(),
  };
  return {
    proof,
    signature: signPreviewArtifactStorePollProof({
      proof,
      privateKeyPem: AGENT_PRIVATE_KEY_PEM,
      now,
    }),
  };
}

afterEach(async () => {
  for (const projectId of projectIds.splice(0)) {
    await db.delete(projectsTable).where(eq(projectsTable.id, projectId));
  }
});

describe("Preview Agent artifact receipt database binding", () => {
  it("issues a stable storage command across lost-response poll retries", async () => {
    const fixture = await createFixture();
    const firstNow = new Date(NOW.getTime() + 1_000);
    const first = await issuePreviewBuildInputStoreCommand({
      jobId: fixture.jobId,
      ...createPollProof(fixture.jobId, fixture.nodeId, firstNow),
      buildJobPrivateKeyPem: API_PRIVATE_KEY_PEM,
      now: firstNow,
    });
    const retryNow = new Date(NOW.getTime() + 2_000);
    const retry = await issuePreviewBuildInputStoreCommand({
      jobId: fixture.jobId,
      ...createPollProof(fixture.jobId, fixture.nodeId, retryNow),
      buildJobPrivateKeyPem: API_PRIVATE_KEY_PEM,
      now: retryNow,
    });
    const publicKeyPem =
      previewArtifactStoreCommandPublicKeyPem(API_PRIVATE_KEY_PEM);
    const firstCommand = verifyPreviewArtifactStoreCommand({
      token: first.commandToken,
      publicKeyPem,
      now: new Date(NOW.getTime() + 3_000),
    });
    const retryCommand = verifyPreviewArtifactStoreCommand({
      token: retry.commandToken,
      publicKeyPem,
      now: new Date(NOW.getTime() + 3_000),
    });
    const [job] = await db
      .select({
        stateVersion: previewBuildJobsTable.stateVersion,
        readyAt: previewBuildJobsTable.inputArtifactReadyAt,
      })
      .from(previewBuildJobsTable)
      .where(eq(previewBuildJobsTable.jobId, fixture.jobId));

    expect(first.commandId).toBe(previewArtifactStoreCommandId(fixture.jobId));
    expect(retry.commandId).toBe(first.commandId);
    expect(retry.commandFingerprint).toBe(first.commandFingerprint);
    expect(firstCommand).toMatchObject({
      jobId: fixture.jobId,
      nodeId: fixture.nodeId,
      artifactRefId: previewBuildArtifactRefId(fixture.jobId, "input"),
    });
    expect(previewArtifactStoreCommandFingerprint(retryCommand)).toBe(
      first.commandFingerprint,
    );
    expect(first.commandToken).not.toBe(retry.commandToken);
    expect(job).toEqual({ stateVersion: 0, readyAt: null });
  });

  it("records the exact owner artifact once and treats the same signed receipt as a retry", async () => {
    const fixture = await createFixture();
    const first = await acceptPreviewBuildInputStoreReceipt({
      jobId: fixture.jobId,
      commandToken: fixture.commandToken,
      receiptToken: fixture.receiptToken,
      buildJobPrivateKeyPem: API_PRIVATE_KEY_PEM,
      now: new Date(NOW.getTime() + 3_000),
    });
    const second = await acceptPreviewBuildInputStoreReceipt({
      jobId: fixture.jobId,
      commandToken: fixture.commandToken,
      receiptToken: fixture.receiptToken,
      buildJobPrivateKeyPem: API_PRIVATE_KEY_PEM,
      now: new Date(NOW.getTime() + 4_000),
    });
    const [stored] = await db
      .select({
        readyAt: previewBuildJobsTable.inputArtifactReadyAt,
        stateVersion: previewBuildJobsTable.stateVersion,
        storeId: previewBuildJobsTable.inputArtifactStoreId,
        artifactRefId: previewBuildJobsTable.inputArtifactRefId,
        ownerNodeId: previewBuildJobsTable.inputArtifactOwnerNodeId,
        ownerKeyVersion: previewBuildJobsTable.inputArtifactOwnerKeyVersion,
        commandFingerprint:
          previewBuildJobsTable.inputArtifactStoreCommandFingerprint,
        receiptFingerprint:
          previewBuildJobsTable.inputArtifactStoreReceiptFingerprint,
      })
      .from(previewBuildJobsTable)
      .where(eq(previewBuildJobsTable.jobId, fixture.jobId));

    expect(first.alreadyAccepted).toBe(false);
    expect(first.job.inputArtifactReadyAt).toEqual(
      new Date(NOW.getTime() + 3_000),
    );
    expect(second.alreadyAccepted).toBe(true);
    expect(second.job.stateVersion).toBe(first.job.stateVersion);
    expect(stored).toEqual({
      readyAt: new Date(NOW.getTime() + 3_000),
      stateVersion: 1,
      storeId: fixture.storeId,
      artifactRefId: previewBuildArtifactRefId(fixture.jobId, "input"),
      ownerNodeId: fixture.nodeId,
      ownerKeyVersion: 1,
      commandFingerprint: previewArtifactStoreCommandFingerprint(
        fixture.command,
      ),
      receiptFingerprint: expect.stringMatching(/^[a-f0-9]{64}$/),
    });
  });

  it("rejects a different valid receipt for an already accepted command", async () => {
    const fixture = await createFixture();
    await acceptPreviewBuildInputStoreReceipt({
      jobId: fixture.jobId,
      commandToken: fixture.commandToken,
      receiptToken: fixture.receiptToken,
      buildJobPrivateKeyPem: API_PRIVATE_KEY_PEM,
      now: new Date(NOW.getTime() + 3_000),
    });
    const [accepted] = await db
      .select({
        fingerprint:
          previewBuildJobsTable.inputArtifactStoreReceiptFingerprint,
      })
      .from(previewBuildJobsTable)
      .where(eq(previewBuildJobsTable.jobId, fixture.jobId));
    const alternateReceiptToken = signPreviewArtifactStoreReceipt({
      receipt: { ...fixture.receipt, result: "already_stored" },
      privateKeyPem: AGENT_PRIVATE_KEY_PEM,
      now: new Date(NOW.getTime() + 3_000),
    });

    await expect(
      acceptPreviewBuildInputStoreReceipt({
        jobId: fixture.jobId,
        commandToken: fixture.commandToken,
        receiptToken: alternateReceiptToken,
        buildJobPrivateKeyPem: API_PRIVATE_KEY_PEM,
        now: new Date(NOW.getTime() + 4_000),
      }),
    ).rejects.toMatchObject({
      code: "PREVIEW_ARTIFACT_STORE_ACCEPTANCE_CONFLICT",
    });

    const [job] = await db
      .select({
        stateVersion: previewBuildJobsTable.stateVersion,
        receiptFingerprint:
          previewBuildJobsTable.inputArtifactStoreReceiptFingerprint,
      })
      .from(previewBuildJobsTable)
      .where(eq(previewBuildJobsTable.jobId, fixture.jobId));
    expect(job?.stateVersion).toBe(1);
    expect(job?.receiptFingerprint).toBe(accepted?.fingerprint);
  });

  it("rejects an owner receipt after the Agent key is revoked", async () => {
    const fixture = await createFixture();
    await db
      .update(previewAgentNodesTable)
      .set({ status: "revoked", revokedAt: NOW, updatedAt: NOW })
      .where(eq(previewAgentNodesTable.nodeId, fixture.nodeId));

    await expect(
      acceptPreviewBuildInputStoreReceipt({
        jobId: fixture.jobId,
        commandToken: fixture.commandToken,
        receiptToken: fixture.receiptToken,
        buildJobPrivateKeyPem: API_PRIVATE_KEY_PEM,
        now: new Date(NOW.getTime() + 3_000),
      }),
    ).rejects.toBeInstanceOf(PreviewArtifactStoreAcceptanceError);

    const [job] = await db
      .select({
        readyAt: previewBuildJobsTable.inputArtifactReadyAt,
        stateVersion: previewBuildJobsTable.stateVersion,
      })
      .from(previewBuildJobsTable)
      .where(eq(previewBuildJobsTable.jobId, fixture.jobId));
    expect(job).toEqual({ readyAt: null, stateVersion: 0 });
  });

  it("rejects receipts when the Candidate revision has changed", async () => {
    const fixture = await createFixture();
    await db
      .update(aiChangeProposalsTable)
      .set({ candidateTreeHash: "9".repeat(64) })
      .where(eq(aiChangeProposalsTable.id, fixture.proposalId));

    await expect(
      acceptPreviewBuildInputStoreReceipt({
        jobId: fixture.jobId,
        commandToken: fixture.commandToken,
        receiptToken: fixture.receiptToken,
        buildJobPrivateKeyPem: API_PRIVATE_KEY_PEM,
        now: new Date(NOW.getTime() + 3_000),
      }),
    ).rejects.toBeInstanceOf(PreviewArtifactStoreAcceptanceError);

    const [job] = await db
      .select({
        readyAt: previewBuildJobsTable.inputArtifactReadyAt,
        stateVersion: previewBuildJobsTable.stateVersion,
      })
      .from(previewBuildJobsTable)
      .where(eq(previewBuildJobsTable.jobId, fixture.jobId));
    expect(job).toEqual({ readyAt: null, stateVersion: 0 });
  });
});
