import { generateKeyPairSync } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  PreviewArtifactStoreCommandError,
  previewArtifactStoreCommandFingerprint,
  signPreviewArtifactStorePollProof,
  signPreviewArtifactStoreCommand,
  signPreviewArtifactStoreReceipt,
  verifyPreviewArtifactStorePollProof,
  verifyPreviewArtifactStoreCommand,
  verifyPreviewArtifactStoreReceipt,
  type PreviewArtifactStoreCommandClaims,
  type PreviewArtifactStorePollProofClaims,
  type PreviewArtifactStoreReceiptClaims,
} from "./preview-artifact-store-command.js";

const NOW = new Date("2026-11-12T12:00:00.000Z");
const UUID_A = "11111111-1111-4111-8111-111111111111";
const UUID_B = "22222222-2222-4222-8222-222222222222";
const UUID_C = "33333333-3333-4333-8333-333333333333";
const UUID_D = "44444444-4444-4444-8444-444444444444";
const HASH_A = "a".repeat(64);
const HASH_B = "b".repeat(64);
const HASH_C = "c".repeat(64);
const HASH_D = "d".repeat(64);

const apiKeys = generateKeyPairSync("ed25519");
const apiPrivateKeyPem = apiKeys.privateKey
  .export({ type: "pkcs8", format: "pem" })
  .toString();
const apiPublicKeyPem = apiKeys.publicKey
  .export({ type: "spki", format: "pem" })
  .toString();
const agentKeys = generateKeyPairSync("ed25519");
const agentPrivateKeyPem = agentKeys.privateKey
  .export({ type: "pkcs8", format: "pem" })
  .toString();
const agentPublicKeyPem = agentKeys.publicKey
  .export({ type: "spki", format: "pem" })
  .toString();
const otherAgentKeys = generateKeyPairSync("ed25519");
const otherAgentPublicKeyPem = otherAgentKeys.publicKey
  .export({ type: "spki", format: "pem" })
  .toString();

function command(
  overrides: Partial<PreviewArtifactStoreCommandClaims> = {},
  now = NOW,
): PreviewArtifactStoreCommandClaims {
  return {
    version: 1,
    action: "store-artifact",
    commandId: UUID_A,
    nodeId: UUID_B,
    keyVersion: 1,
    storeId: UUID_C,
    artifactRefId: UUID_D,
    jobId: "55555555-5555-4555-8555-555555555555",
    projectId: "project-1",
    proposalId: "proposal-1",
    operationId: "operation-1",
    proposalRevision: 3,
    candidateRevision: HASH_A,
    changeSetHash: HASH_B,
    artifactKind: "preview-build-input",
    sourceDigest: HASH_C,
    artifactDigest: HASH_D,
    sizeBytes: 1_024,
    manifestDigest: HASH_A,
    retentionPolicy: "preview-build-input-24h-v1",
    issuedAt: now.toISOString(),
    expiresAt: new Date(now.getTime() + 30_000).toISOString(),
    ...overrides,
  };
}

function receipt(
  claims: PreviewArtifactStoreCommandClaims,
  overrides: Partial<PreviewArtifactStoreReceiptClaims> = {},
): PreviewArtifactStoreReceiptClaims {
  return {
    version: 1,
    action: "artifact-store-receipt",
    commandId: claims.commandId,
    commandFingerprint: previewArtifactStoreCommandFingerprint(claims),
    nodeId: claims.nodeId,
    keyVersion: claims.keyVersion,
    storeId: claims.storeId,
    artifactRefId: claims.artifactRefId,
    artifactDigest: claims.artifactDigest,
    sizeBytes: claims.sizeBytes,
    manifestDigest: claims.manifestDigest,
    result: "stored",
    completedAt: new Date(NOW.getTime() + 2_000).toISOString(),
    ...overrides,
  };
}

function verifiedCommand(
  claims: PreviewArtifactStoreCommandClaims = command(),
) {
  const token = signPreviewArtifactStoreCommand({
    command: claims,
    privateKeyPem: apiPrivateKeyPem,
    now: NOW,
  });
  return verifyPreviewArtifactStoreCommand({
    token,
    publicKeyPem: apiPublicKeyPem,
    now: NOW,
  });
}

describe("Preview Artifact Store command and owner receipt", () => {
  it("binds a signed owner receipt to the exact Job, store, artifact and command", () => {
    const claims = command();
    const token = signPreviewArtifactStoreCommand({
      command: claims,
      privateKeyPem: apiPrivateKeyPem,
      now: NOW,
    });
    const verified = verifyPreviewArtifactStoreCommand({
      token,
      publicKeyPem: apiPublicKeyPem,
      now: NOW,
    });
    const receiptToken = signPreviewArtifactStoreReceipt({
      receipt: receipt(claims, { result: "already_stored" }),
      privateKeyPem: agentPrivateKeyPem,
      now: NOW,
    });

    expect(
      verifyPreviewArtifactStoreReceipt({
        token: receiptToken,
        publicKeyPem: agentPublicKeyPem,
        command: verified,
        now: NOW,
      }),
    ).toMatchObject({
      commandId: claims.commandId,
      nodeId: claims.nodeId,
      storeId: claims.storeId,
      artifactRefId: claims.artifactRefId,
      result: "already_stored",
    });
  });

  it("keeps semantic command identity stable across a lost-response retry", () => {
    const original = command();
    const retry = command({
      issuedAt: new Date(NOW.getTime() + 1_000).toISOString(),
      expiresAt: new Date(NOW.getTime() + 31_000).toISOString(),
    });

    expect(previewArtifactStoreCommandFingerprint(retry)).toBe(
      previewArtifactStoreCommandFingerprint(original),
    );
  });

  it("requires a fresh Agent-signed poll proof bound to its node, key and Job", () => {
    const proof: PreviewArtifactStorePollProofClaims = {
      version: 1,
      action: "poll-artifact-store-command",
      nodeId: UUID_B,
      keyVersion: 2,
      jobId: "55555555-5555-4555-8555-555555555555",
      issuedAt: NOW.toISOString(),
      nonce: UUID_D,
    };
    const signature = signPreviewArtifactStorePollProof({
      proof,
      privateKeyPem: agentPrivateKeyPem,
      now: NOW,
    });

    expect(
      verifyPreviewArtifactStorePollProof({
        proof,
        signature,
        publicKeyPem: agentPublicKeyPem,
        now: new Date(NOW.getTime() + 1_000),
      }),
    ).toEqual(proof);
    expect(() =>
      verifyPreviewArtifactStorePollProof({
        proof: { ...proof, jobId: UUID_A },
        signature,
        publicKeyPem: agentPublicKeyPem,
        now: new Date(NOW.getTime() + 1_000),
      }),
    ).toThrow(
      expect.objectContaining({
        code: "PREVIEW_ARTIFACT_STORE_POLL_PROOF_SIGNATURE_INVALID",
      }),
    );
    expect(() =>
      verifyPreviewArtifactStorePollProof({
        proof,
        signature,
        publicKeyPem: agentPublicKeyPem,
        now: new Date(NOW.getTime() + 31_000),
      }),
    ).toThrow(
      expect.objectContaining({
        code: "PREVIEW_ARTIFACT_STORE_POLL_PROOF_EXPIRED",
      }),
    );
  });

  it("rejects altered commands and commands signed by a different authority", () => {
    const claims = command();
    const token = signPreviewArtifactStoreCommand({
      command: claims,
      privateKeyPem: apiPrivateKeyPem,
      now: NOW,
    });
    const [payload, signature] = token.split(".");
    const changedPayload = Buffer.from(payload!, "base64url")
      .toString("utf8")
      .replace('"project-1"', '"project-2"');
    const tampered = `${Buffer.from(changedPayload).toString("base64url")}.${signature}`;

    expect(() =>
      verifyPreviewArtifactStoreCommand({
        token: tampered,
        publicKeyPem: apiPublicKeyPem,
        now: NOW,
      }),
    ).toThrow(PreviewArtifactStoreCommandError);
    expect(() =>
      verifyPreviewArtifactStoreCommand({
        token,
        publicKeyPem: otherAgentPublicKeyPem,
        now: NOW,
      }),
    ).toThrow(
      expect.objectContaining({
        code: "PREVIEW_ARTIFACT_STORE_COMMAND_SIGNATURE_INVALID",
      }),
    );
  });

  it("rejects a receipt signed by another node key", () => {
    const claims = command();
    const token = signPreviewArtifactStoreReceipt({
      receipt: receipt(claims),
      privateKeyPem: agentPrivateKeyPem,
      now: NOW,
    });

    expect(() =>
      verifyPreviewArtifactStoreReceipt({
        token,
        publicKeyPem: otherAgentPublicKeyPem,
        command: verifiedCommand(claims),
        now: NOW,
      }),
    ).toThrow(
      expect.objectContaining({
        code: "PREVIEW_ARTIFACT_STORE_RECEIPT_SIGNATURE_INVALID",
      }),
    );
  });

  it("rejects receipt replay against another Job even with the same artifact bytes", () => {
    const authorized = command();
    const otherJob = command({
      commandId: "66666666-6666-4666-8666-666666666666",
      jobId: "77777777-7777-4777-8777-777777777777",
      artifactRefId: "88888888-8888-4888-8888-888888888888",
    });
    const token = signPreviewArtifactStoreReceipt({
      receipt: receipt(authorized),
      privateKeyPem: agentPrivateKeyPem,
      now: NOW,
    });

    expect(() =>
      verifyPreviewArtifactStoreReceipt({
        token,
        publicKeyPem: agentPublicKeyPem,
        command: verifiedCommand(otherJob),
        now: NOW,
      }),
    ).toThrow(PreviewArtifactStoreCommandError);
  });

  it("rejects receipts outside the command lifetime and stale receipt windows", () => {
    const claims = command();
    const verified = verifiedCommand(claims);
    const lateToken = signPreviewArtifactStoreReceipt({
      receipt: receipt(claims, {
        completedAt: new Date(NOW.getTime() + 40_000).toISOString(),
      }),
      privateKeyPem: agentPrivateKeyPem,
      now: new Date(NOW.getTime() + 40_000),
    });
    expect(() =>
      verifyPreviewArtifactStoreReceipt({
        token: lateToken,
        publicKeyPem: agentPublicKeyPem,
        command: verified,
        now: NOW,
      }),
    ).toThrow(PreviewArtifactStoreCommandError);

    const staleToken = signPreviewArtifactStoreReceipt({
      receipt: receipt(claims, {
        completedAt: new Date(NOW.getTime() + 2_000).toISOString(),
      }),
      privateKeyPem: agentPrivateKeyPem,
      now: NOW,
    });
    expect(() =>
      verifyPreviewArtifactStoreReceipt({
        token: staleToken,
        publicKeyPem: agentPublicKeyPem,
        command: verified,
        now: new Date(NOW.getTime() + 7 * 60_000),
      }),
    ).toThrow(PreviewArtifactStoreCommandError);
  });

  it("does not accept a structurally similar but unverified command object", () => {
    const claims = command();
    const token = signPreviewArtifactStoreReceipt({
      receipt: receipt(claims),
      privateKeyPem: agentPrivateKeyPem,
      now: NOW,
    });

    expect(() =>
      verifyPreviewArtifactStoreReceipt({
        token,
        publicKeyPem: agentPublicKeyPem,
        command: claims as never,
        now: NOW,
      }),
    ).toThrow(
      expect.objectContaining({
        code: "PREVIEW_ARTIFACT_STORE_RECEIPT_INVALID",
      }),
    );
  });

  it("rejects oversized or incomplete store claims before signing", () => {
    expect(() =>
      signPreviewArtifactStoreCommand({
        command: command({ sizeBytes: 0 }),
        privateKeyPem: apiPrivateKeyPem,
        now: NOW,
      }),
    ).toThrow(PreviewArtifactStoreCommandError);
    expect(() =>
      signPreviewArtifactStoreCommand({
        command: { ...command(), unscopedPath: "/tmp/private" } as never,
        privateKeyPem: apiPrivateKeyPem,
        now: NOW,
      }),
    ).toThrow(PreviewArtifactStoreCommandError);
  });
});
