import { generateKeyPairSync } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import {
  dispatchPreviewBuilderJob,
  PreviewBuilderGatewayClientError,
} from "./preview-builder-gateway-client.js";
import type { PreviewBuildJobClaims } from "./preview-build-job.js";

const now = new Date("2026-11-12T12:00:00.000Z");
const keyPair = generateKeyPairSync("ed25519");
const privateKeyPem = keyPair.privateKey.export({
  type: "pkcs8",
  format: "pem",
}) as string;
const claims: PreviewBuildJobClaims = {
  version: 2,
  action: "preview-build",
  jobId: "123e4567-e89b-42d3-a456-426614174000",
  attemptId: "123e4567-e89b-42d3-a456-426614174000",
  idempotencyKey: "323e4567-e89b-42d3-a456-426614174002",
  dispatchGeneration: 1,
  buildId: "223e4567-e89b-42d3-a456-426614174001",
  builderProfile: "vite-react-static-v1",
  builderImageDigest: `sha256:${"a".repeat(64)}`,
  projectId: "project-1",
  proposalId: "proposal-1",
  operationId: "operation-1",
  proposalRevision: 4,
  candidateRevision: "b".repeat(64),
  changeSetHash: "c".repeat(64),
  sourceRoot: "web",
  sourceDigest: "d".repeat(64),
  inputArtifactKey: `build-inputs/${"d".repeat(64)}/${"e".repeat(64)}.zip`,
  archiveDigest: "e".repeat(64),
  outputArtifactKey:
    "preview-build-outputs/223e4567-e89b-42d3-a456-426614174001/site.tar.gz",
  issuedAt: now.toISOString(),
  expiresAt: new Date(now.getTime() + 60_000).toISOString(),
};
const taskArn =
  "arn:aws:ecs:eu-central-1:123456789012:task/preview-builder/abcdef0123456789abcdef0123456789";

function response(status: number, value: unknown): Response {
  return new Response(JSON.stringify(value), {
    status,
    headers: { "content-type": "application/json" },
  });
}

describe("Preview Builder Gateway client", () => {
  it("sends one signed launch request and accepts only the matching task", async () => {
    let capturedUrl: URL | undefined;
    let capturedInit: RequestInit | undefined;
    const fetcher = vi.fn(
      async (input: Parameters<typeof fetch>[0], init?: RequestInit) => {
        capturedUrl = new URL(String(input));
        capturedInit = init;
        return response(202, {
          jobId: claims.jobId,
          buildId: claims.buildId,
          taskArn,
        });
      },
    );

    await expect(
      dispatchPreviewBuilderJob({
        gatewayUrl: "https://gateway.example.com/",
        privateKeyPem,
        claims,
        fetcher,
        now,
      }),
    ).resolves.toEqual({
      jobId: claims.jobId,
      buildId: claims.buildId,
      executionRef: taskArn,
    });

    expect(capturedUrl?.pathname).toBe("/internal/v1/preview/builds");
    expect(capturedInit?.method).toBe("POST");
    expect(capturedInit?.redirect).toBe("error");
    expect(capturedInit?.credentials).toBe("omit");
    const body = JSON.parse(String(capturedInit?.body)) as { token: string };
    expect(body.token).toMatch(/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/);
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it.each([
    "http://gateway.example.com",
    "https://localhost",
    "https://127.0.0.1",
    "https://gateway.example.com/path",
    "https://user:password@gateway.example.com",
  ])("rejects an unsafe Gateway URL before sending: %s", async (gatewayUrl) => {
    const fetcher = vi.fn();
    await expect(
      dispatchPreviewBuilderJob({
        gatewayUrl,
        privateKeyPem,
        claims,
        fetcher,
        now,
      }),
    ).rejects.toMatchObject({
      code: "PREVIEW_BUILDER_GATEWAY_URL_INVALID",
    } satisfies Partial<PreviewBuilderGatewayClientError>);
    expect(fetcher).not.toHaveBeenCalled();
  });

  it("rejects a launch response bound to another job or task", async () => {
    const fetcher = vi.fn(async () =>
      response(202, {
        jobId: "323e4567-e89b-42d3-a456-426614174002",
        buildId: claims.buildId,
        taskArn,
      }),
    );

    await expect(
      dispatchPreviewBuilderJob({
        gatewayUrl: "https://gateway.example.com",
        privateKeyPem,
        claims,
        fetcher,
        now,
      }),
    ).rejects.toMatchObject({
      code: "PREVIEW_BUILDER_GATEWAY_RESPONSE_INVALID",
    } satisfies Partial<PreviewBuilderGatewayClientError>);
  });

  it("treats Gateway rejection and network ambiguity as unavailable", async () => {
    const rejectedFetch = vi.fn(async () =>
      response(409, { error: "rejected" }),
    );
    await expect(
      dispatchPreviewBuilderJob({
        gatewayUrl: "https://gateway.example.com",
        privateKeyPem,
        claims,
        fetcher: rejectedFetch,
        now,
      }),
    ).rejects.toMatchObject({
      code: "PREVIEW_BUILDER_GATEWAY_UNAVAILABLE",
    });

    const unavailableFetch = vi.fn(async () => {
      throw new Error("transport details must not escape");
    });
    await expect(
      dispatchPreviewBuilderJob({
        gatewayUrl: "https://gateway.example.com",
        privateKeyPem,
        claims,
        fetcher: unavailableFetch,
        now,
      }),
    ).rejects.toMatchObject({
      code: "PREVIEW_BUILDER_GATEWAY_UNAVAILABLE",
    });
  });

  it("rejects a missing signing key without sending the request", async () => {
    const fetcher = vi.fn();
    await expect(
      dispatchPreviewBuilderJob({
        gatewayUrl: "https://gateway.example.com",
        privateKeyPem: undefined,
        claims,
        fetcher,
        now,
      }),
    ).rejects.toMatchObject({
      code: "PREVIEW_BUILDER_GATEWAY_KEY_MISSING",
    });
    expect(fetcher).not.toHaveBeenCalled();
  });
});
