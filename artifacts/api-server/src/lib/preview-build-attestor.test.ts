import { generateKeyPairSync, sign as signBytes } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import type { PreviewBuildJob } from "@workspace/db";
import {
  canonicalPreviewBuildReceiptPayload,
  type PreviewBuildReceiptClaims,
} from "./preview-build-receipt.js";
import {
  acceptPreviewBuildReceipt,
  PreviewBuildAttestationError,
} from "./preview-build-attestor.js";

const now = new Date("2026-11-12T12:00:00.000Z");
const keyPair = generateKeyPairSync("ed25519");
const privateKeyPem = keyPair.privateKey.export({
  type: "pkcs8",
  format: "pem",
}) as string;
const publicKeyPem = keyPair.publicKey.export({
  type: "spki",
  format: "pem",
}) as string;
const jobId = "123e4567-e89b-42d3-a456-426614174000";
const buildId = "223e4567-e89b-42d3-a456-426614174001";
const receiptId = "323e4567-e89b-42d3-a456-426614174002";
const sourceDigest = "a".repeat(64);
const archiveDigest = "b".repeat(64);
const candidateRevision = "c".repeat(64);
const changeSetHash = "d".repeat(64);
const builderImageDigest = `sha256:${"e".repeat(64)}`;
const outputDigest = "f".repeat(64);
const outputArtifactKey = `preview-build-outputs/${buildId}/site.tar.gz`;
const builderTaskArn =
  "arn:aws:ecs:eu-central-1:123456789012:task/preview-builder/abcdef0123456789abcdef0123456789";

function makeJob(overrides: Partial<PreviewBuildJob> = {}): PreviewBuildJob {
  return {
    jobId,
    buildId,
    projectId: "project-1",
    proposalId: "proposal-1",
    userId: "user-1",
    clientRequestId: "423e4567-e89b-42d3-a456-426614174003",
    operationId: "operation-1",
    proposalRevision: 4,
    candidateRevision,
    changeSetHash,
    sourceRoot: "web",
    sourceDigest,
    archiveDigest,
    inputArtifactKey: `build-inputs/${sourceDigest}/${archiveDigest}.zip`,
    inputArtifactProvider: "s3",
    inputArtifactStoreId: null,
    inputArtifactRefId: null,
    inputArtifactSizeBytes: null,
    inputArtifactManifestDigest: null,
    inputArtifactRetentionPolicy: null,
    inputArtifactOwnerNodeId: null,
    inputArtifactOwnerKeyVersion: null,
    inputArtifactStoreCommandFingerprint: null,
    inputArtifactStoreReceiptFingerprint: null,
    inputArtifactReadyAt: now,
    inputArtifactGcState: "active",
    inputArtifactGcMarkedAt: null,
    outputArtifactKey,
    outputArtifactProvider: "s3",
    outputArtifactStoreId: null,
    outputArtifactRefId: null,
    outputArtifactSizeBytes: null,
    outputArtifactManifestDigest: null,
    outputArtifactRetentionPolicy: null,
    outputArtifactGcState: "active",
    outputArtifactGcMarkedAt: null,
    builderImageDigest,
    issuedAt: now,
    tokenExpiresAt: new Date(now.getTime() + 60_000),
    status: "builder_succeeded",
    builderTaskArn,
    outputDigest,
    buildReceiptId: null,
    failureCode: null,
    stateVersion: 3,
    startedAt: now,
    completedAt: null,
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
}

function signReceipt(
  overrides: Partial<PreviewBuildReceiptClaims> = {},
): string {
  const claims: PreviewBuildReceiptClaims = {
    version: 1,
    action: "preview-build-ready",
    receiptId,
    buildId,
    builderProfile: "vite-react-static-v1",
    builderImageDigest,
    projectId: "project-1",
    proposalId: "proposal-1",
    operationId: "operation-1",
    proposalRevision: 4,
    candidateRevision,
    changeSetHash,
    sourceDigest,
    archiveDigest,
    buildOutputDigest: outputDigest,
    outputArtifactKey,
    issuedAt: now.toISOString(),
    expiresAt: new Date(now.getTime() + 60_000).toISOString(),
    ...overrides,
  };
  const payload = Buffer.from(
    canonicalPreviewBuildReceiptPayload(claims),
    "utf8",
  );
  const signature = signBytes(
    null,
    Buffer.concat([
      Buffer.from("EngineeringOS Preview Build Receipt v1\n", "utf8"),
      payload,
    ]),
    privateKeyPem,
  );
  return `${payload.toString("base64url")}.${signature.toString("base64url")}`;
}

describe("Preview build attestation boundary", () => {
  it("accepts a fresh signed receipt only after a durable Builder success", async () => {
    const job = makeJob();
    const transition = vi.fn(async () =>
      makeJob({
        status: "verified",
        buildReceiptId: receiptId,
        stateVersion: 4,
        completedAt: now,
      }),
    );

    const result = await acceptPreviewBuildReceipt({
      jobId,
      token: signReceipt(),
      publicKeyPem,
      dependencies: {
        now: () => now,
        findJob: vi.fn(async () => job),
        transition,
      },
    });

    expect(result.alreadyVerified).toBe(false);
    expect(result.job.status).toBe("verified");
    expect(transition).toHaveBeenCalledWith(
      expect.objectContaining({
        jobId,
        expectedStatus: "builder_succeeded",
        expectedVersion: 3,
        nextStatus: "verified",
        builderTaskArn,
        now,
        verifiedReceipt: expect.objectContaining({
          receiptId,
          buildOutputDigest: outputDigest,
        }),
      }),
    );
  });

  it("rejects a receipt that does not attest the stored output digest", async () => {
    const transition = vi.fn();
    await expect(
      acceptPreviewBuildReceipt({
        jobId,
        token: signReceipt({ buildOutputDigest: "1".repeat(64) }),
        publicKeyPem,
        dependencies: {
          now: () => now,
          findJob: vi.fn(async () => makeJob()),
          transition: transition as never,
        },
      }),
    ).rejects.toMatchObject({
      code: "PREVIEW_BUILD_ATTESTOR_RECEIPT_REJECTED",
    });
    expect(transition).not.toHaveBeenCalled();
  });

  it("does not accept an unsigned or incorrectly signed receipt", async () => {
    const otherPair = generateKeyPairSync("ed25519");
    const otherPrivateKey = otherPair.privateKey.export({
      type: "pkcs8",
      format: "pem",
    }) as string;
    const original = signReceipt();
    const [payload] = original.split(".");
    const wrongSignature = signBytes(
      null,
      Buffer.concat([
        Buffer.from("EngineeringOS Preview Build Receipt v1\n", "utf8"),
        Buffer.from(payload!, "base64url"),
      ]),
      otherPrivateKey,
    ).toString("base64url");
    const transition = vi.fn();

    await expect(
      acceptPreviewBuildReceipt({
        jobId,
        token: `${payload}.${wrongSignature}`,
        publicKeyPem,
        dependencies: {
          now: () => now,
          findJob: vi.fn(async () => makeJob()),
          transition: transition as never,
        },
      }),
    ).rejects.toBeInstanceOf(PreviewBuildAttestationError);
    expect(transition).not.toHaveBeenCalled();
  });

  it("rejects before cryptographic processing when Builder has not succeeded", async () => {
    const transition = vi.fn();
    await expect(
      acceptPreviewBuildReceipt({
        jobId,
        token: signReceipt(),
        publicKeyPem,
        dependencies: {
          now: () => now,
          findJob: vi.fn(async () => makeJob({ status: "running" })),
          transition: transition as never,
        },
      }),
    ).rejects.toMatchObject({
      code: "PREVIEW_BUILD_ATTESTOR_JOB_NOT_READY",
    });
    expect(transition).not.toHaveBeenCalled();
  });

  it("fails closed when no independent Attestor public key is configured", async () => {
    await expect(
      acceptPreviewBuildReceipt({
        jobId,
        token: signReceipt(),
        publicKeyPem: undefined,
        dependencies: {
          findJob: vi.fn(async () => makeJob()),
        },
      }),
    ).rejects.toMatchObject({
      code: "PREVIEW_BUILD_ATTESTOR_NOT_CONFIGURED",
    });
  });
});
