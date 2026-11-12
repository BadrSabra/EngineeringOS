import { generateKeyPairSync } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import type { PreviewBuildJob } from "@workspace/db";
import {
  observePreviewBuildJob,
  PreviewBuildObservationClientError,
} from "./preview-build-observation-client.js";

const now = new Date("2026-11-12T13:00:00.000Z");
const jobId = "123e4567-e89b-42d3-a456-426614174000";
const buildId = "223e4567-e89b-42d3-a456-426614174001";
const taskArn =
  "arn:aws:ecs:eu-central-1:123456789012:task/preview/abcdef0123456789abcdef0123456789";
const outputDigest = "a".repeat(64);
const { privateKey } = generateKeyPairSync("ed25519");
const privateKeyPem = privateKey.export({
  type: "pkcs8",
  format: "pem",
}) as string;

function makeJob(overrides: Partial<PreviewBuildJob> = {}): PreviewBuildJob {
  return {
    jobId,
    buildId,
    projectId: "project-1",
    proposalId: "proposal-1",
    userId: "user-1",
    clientRequestId: "323e4567-e89b-42d3-a456-426614174002",
    operationId: "operation-1",
    proposalRevision: 1,
    candidateRevision: "b".repeat(64),
    changeSetHash: "c".repeat(64),
    sourceRoot: "web",
    sourceDigest: "d".repeat(64),
    archiveDigest: "e".repeat(64),
    inputArtifactKey: `build-inputs/${"d".repeat(64)}/${"e".repeat(64)}.zip`,
    inputArtifactProvider: "s3",
    inputArtifactReadyAt: now,
    inputArtifactGcState: "active",
    inputArtifactGcMarkedAt: null,
    outputArtifactKey: `preview-build-outputs/${buildId}/site.tar.gz`,
    outputArtifactProvider: "s3",
    outputArtifactGcState: "active",
    outputArtifactGcMarkedAt: null,
    builderImageDigest: `sha256:${"f".repeat(64)}`,
    issuedAt: now,
    tokenExpiresAt: new Date(now.getTime() + 60_000),
    status: "running",
    builderTaskArn: taskArn,
    outputDigest: null,
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

describe("Preview build observation client", () => {
  it("sends a signed no-store request and validates task and build bindings", async () => {
    const fetcher = vi.fn(async (url: URL, init?: RequestInit) => {
      expect(url.href).toBe(
        "https://gateway.example/internal/v1/preview/builds/reconcile",
      );
      expect(init?.cache).toBe("no-store");
      expect(init?.redirect).toBe("error");
      const body = JSON.parse(String(init?.body));
      expect(body.token).toEqual(expect.any(String));
      return Response.json({
        jobId,
        buildId,
        state: "stopped",
        taskArn,
        exitCode: 0,
        outputDigest,
      });
    });
    await expect(
      observePreviewBuildJob({
        gatewayUrl: "https://gateway.example",
        privateKeyPem,
        job: makeJob(),
        fetcher: fetcher as typeof fetch,
        now,
      }),
    ).resolves.toEqual({
      jobId,
      buildId,
      state: "stopped",
      taskArn,
      exitCode: 0,
      outputDigest,
    });
    expect(fetcher).toHaveBeenCalledOnce();
  });

  it("rejects mismatched identities and digest outside a successful stop", async () => {
    const badIdentity = vi.fn(async () =>
      Response.json({
        jobId,
        buildId: "323e4567-e89b-42d3-a456-426614174002",
        state: "running",
        taskArn,
      }),
    );
    await expect(
      observePreviewBuildJob({
        gatewayUrl: "https://gateway.example",
        privateKeyPem,
        job: makeJob(),
        fetcher: badIdentity as typeof fetch,
        now,
      }),
    ).rejects.toBeInstanceOf(PreviewBuildObservationClientError);

    const invalidDigest = vi.fn(async () =>
      Response.json({
        jobId,
        buildId,
        state: "running",
        taskArn,
        outputDigest,
      }),
    );
    await expect(
      observePreviewBuildJob({
        gatewayUrl: "https://gateway.example",
        privateKeyPem,
        job: makeJob(),
        fetcher: invalidDigest as typeof fetch,
        now,
      }),
    ).rejects.toMatchObject({
      code: "PREVIEW_BUILD_OBSERVATION_RESPONSE_INVALID",
    });

    const impossibleNotFound = vi.fn(async () =>
      Response.json({ jobId, buildId, state: "not_found", taskArn }),
    );
    await expect(
      observePreviewBuildJob({
        gatewayUrl: "https://gateway.example",
        privateKeyPem,
        job: makeJob({ builderTaskArn: null }),
        fetcher: impossibleNotFound as typeof fetch,
        now,
      }),
    ).rejects.toMatchObject({
      code: "PREVIEW_BUILD_OBSERVATION_RESPONSE_INVALID",
    });
  });

  it("refuses local or plaintext Gateway endpoints before sending", async () => {
    const fetcher = vi.fn();
    await expect(
      observePreviewBuildJob({
        gatewayUrl: "http://localhost:8080",
        privateKeyPem,
        job: makeJob(),
        fetcher: fetcher as typeof fetch,
        now,
      }),
    ).rejects.toMatchObject({
      code: "PREVIEW_BUILD_OBSERVATION_GATEWAY_INVALID",
    });
    expect(fetcher).not.toHaveBeenCalled();
  });
});
