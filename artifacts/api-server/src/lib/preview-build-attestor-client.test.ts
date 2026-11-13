import { createHash, generateKeyPairSync } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import type { PreviewBuildJob } from "@workspace/db";
import { verifyPreviewBuildJob } from "./preview-build-job.js";
import { attestPreviewBuildJob } from "./preview-build-attestor-client.js";

const now = new Date("2026-11-12T13:00:00.000Z");
const jobId = "123e4567-e89b-42d3-a456-426614174000";
const buildId = "223e4567-e89b-42d3-a456-426614174001";
const builderTaskArn =
  "arn:aws:ecs:eu-central-1:123456789012:task/preview/abcdef0123456789abcdef0123456789";
const keyPair = generateKeyPairSync("ed25519");
const privateKeyPem = keyPair.privateKey.export({
  type: "pkcs8",
  format: "pem",
}) as string;
const publicKeyPem = keyPair.publicKey.export({
  type: "spki",
  format: "pem",
}) as string;

function makeJob(overrides: Partial<PreviewBuildJob> = {}): PreviewBuildJob {
  const projectId = "project-1";
  const proposalId = "proposal-1";
  const operationId = "operation-1";
  const sourceDigest = "a".repeat(64);
  const archiveDigest = "b".repeat(64);
  const candidateRevision = "c".repeat(64);
  const changeSetHash = "d".repeat(64);
  const inputBindingDigest = createHash("sha256")
    .update(
      JSON.stringify({
        projectId,
        proposalId,
        operationId,
        proposalRevision: 4,
        candidateRevision,
        changeSetHash,
        sourceDigest,
      }),
    )
    .digest("hex");
  return {
    jobId,
    buildId,
    projectId,
    proposalId,
    userId: "user-1",
    clientRequestId: "323e4567-e89b-42d3-a456-426614174002",
    operationId,
    proposalRevision: 4,
    candidateRevision,
    changeSetHash,
    sourceRoot: "client",
    sourceDigest,
    archiveDigest,
    inputArtifactKey: `build-inputs/${inputBindingDigest}/${archiveDigest}.zip`,
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
    outputArtifactKey: `preview-build-outputs/${buildId}/site.tar.gz`,
    outputArtifactProvider: "s3",
    outputArtifactStoreId: null,
    outputArtifactRefId: null,
    outputArtifactSizeBytes: null,
    outputArtifactManifestDigest: null,
    outputArtifactRetentionPolicy: null,
    outputArtifactGcState: "active",
    outputArtifactGcMarkedAt: null,
    builderImageDigest: `sha256:${"e".repeat(64)}`,
    issuedAt: now,
    tokenExpiresAt: new Date(now.getTime() - 1),
    status: "builder_succeeded",
    executionRef: builderTaskArn,
    outputDigest: "f".repeat(64),
    buildReceiptId: null,
    failureCode: null,
    dispatchGeneration: 1,
    stateVersion: 4,
    startedAt: now,
    completedAt: now,
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
}

describe("Preview Attestor Gateway client", () => {
  it("re-signs durable job claims and accepts only a matching receipt response", async () => {
    const job = makeJob();
    let requestUrl: URL | undefined;
    let requestBody: Record<string, unknown> | undefined;
    const fetcher = vi.fn(
      async (input: string | URL | Request, init?: RequestInit) => {
        requestUrl = new URL(String(input));
        requestBody = JSON.parse(String(init?.body)) as Record<string, unknown>;
        return Response.json({
          jobId,
          buildId,
          state: "ready",
          receiptToken: "receipt.payload",
        });
      },
    );

    await expect(
      attestPreviewBuildJob({
        gatewayUrl: "https://preview-gateway.example/",
        privateKeyPem,
        job,
        executionRef: builderTaskArn,
        now,
        fetcher,
      }),
    ).resolves.toEqual({
      jobId,
      buildId,
      state: "ready",
      receiptToken: "receipt.payload",
    });
    expect(requestUrl?.pathname).toBe("/internal/v1/preview/builds/attest");
    expect(requestBody?.builderTaskArn).toBe(builderTaskArn);
    const claims = verifyPreviewBuildJob({
      token: String(requestBody?.token),
      publicKeyPem,
      now,
    });
    expect(claims).toMatchObject({
      jobId,
      buildId,
      projectId: job.projectId,
      proposalRevision: job.proposalRevision,
      outputArtifactKey: job.outputArtifactKey,
      sourceDigest: job.sourceDigest,
    });
    expect(fetcher).toHaveBeenCalledWith(
      expect.any(URL),
      expect.objectContaining({
        method: "POST",
        redirect: "error",
        cache: "no-store",
      }),
    );
  });

  it("rejects a Gateway response for another durable job", async () => {
    await expect(
      attestPreviewBuildJob({
        gatewayUrl: "https://preview-gateway.example/",
        privateKeyPem,
        job: makeJob(),
        executionRef: builderTaskArn,
        now,
        fetcher: async () =>
          Response.json({
            jobId: "323e4567-e89b-42d3-a456-426614174002",
            buildId,
            state: "pending",
          }),
      }),
    ).rejects.toThrow("Preview Attestor is unavailable.");
  });

  it("rejects non-JSON Attestor responses", async () => {
    await expect(
      attestPreviewBuildJob({
        gatewayUrl: "https://preview-gateway.example/",
        privateKeyPem,
        job: makeJob(),
        executionRef: builderTaskArn,
        now,
        fetcher: async () =>
          new Response(JSON.stringify({ jobId, buildId, state: "pending" }), {
            headers: { "content-type": "text/plain" },
          }),
      }),
    ).rejects.toThrow("Preview Attestor is unavailable.");
  });

  it("does not sign or dispatch a token after the Builder task identity changes", async () => {
    const fetcher = vi.fn();
    await expect(
      attestPreviewBuildJob({
        gatewayUrl: "https://preview-gateway.example/",
        privateKeyPem,
        job: makeJob(),
        executionRef:
          "arn:aws:ecs:eu-central-1:123456789012:task/preview/11111111111111111111111111111111",
        now,
        fetcher,
      }),
    ).rejects.toThrow();
    expect(fetcher).not.toHaveBeenCalled();
  });

  it("keeps Local execution references out of the AWS Attestor adapter", async () => {
    const executionRef = "exec_local-node_0123456789abcdef";
    const fetcher = vi.fn();
    await expect(
      attestPreviewBuildJob({
        gatewayUrl: "https://preview-gateway.example/",
        privateKeyPem,
        job: makeJob({ executionRef }),
        executionRef,
        now,
        fetcher,
      }),
    ).rejects.toThrow("Preview Attestor is unavailable.");
    expect(fetcher).not.toHaveBeenCalled();
  });

  it("refuses non-HTTPS or path-scoped Gateway URLs", async () => {
    await expect(
      attestPreviewBuildJob({
        gatewayUrl: "http://preview-gateway.example/",
        privateKeyPem,
        job: makeJob(),
        executionRef: builderTaskArn,
        now,
        fetcher: vi.fn(),
      }),
    ).rejects.toThrow();
  });
});
