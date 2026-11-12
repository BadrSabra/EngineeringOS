import { describe, expect, it, vi } from "vitest";
import { createPreviewBuildAttestorHandler } from "./preview-build-attestor-handler.js";
import type { PreviewBuildAttestorHandlerDependencies } from "./preview-build-attestor-handler.js";
import type { PreviewBuildAttestorRunnerConfig } from "./preview-build-attestor-runner.js";

const jobId = "9c99a591-cf7f-4f18-8c4b-08e53ca1e4aa";
const buildId = "a9328405-57f6-44ce-8f4a-880647cd00dd";
const builderTaskArn =
  "arn:aws:ecs:eu-central-1:123456789012:task/preview/abcdef0123456789abcdef0123456789";
const requestUrl =
  "http://preview-gateway.internal/internal/v1/preview/builds/attest";

function makeDependencies(
  overrides: Partial<PreviewBuildAttestorHandlerDependencies> = {},
): PreviewBuildAttestorHandlerDependencies {
  return {
    ecs: {} as PreviewBuildAttestorHandlerDependencies["ecs"],
    fence: {} as PreviewBuildAttestorHandlerDependencies["fence"],
    envelopeStore:
      {} as PreviewBuildAttestorHandlerDependencies["envelopeStore"],
    receiptStore: { read: vi.fn(async () => null) },
    config: {} as PreviewBuildAttestorRunnerConfig,
    execute: vi.fn(async () => ({
      jobId,
      buildId,
      taskArn: builderTaskArn,
      state: "pending" as const,
    })),
    ...overrides,
  };
}

function request(body: unknown) {
  return new Request(requestUrl, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

describe("Preview Build Attestor Gateway handler", () => {
  it("returns only pending job identity while the isolated task is running", async () => {
    const dependencies = makeDependencies();
    const handler = createPreviewBuildAttestorHandler(dependencies);
    const response = await handler(
      request({ token: "signed.job.token", builderTaskArn }),
    );
    expect(response.status).toBe(202);
    await expect(response.json()).resolves.toEqual({
      jobId,
      buildId,
      state: "pending",
    });
    expect(dependencies.receiptStore.read).toHaveBeenCalledWith({
      jobId,
      buildId,
    });
  });

  it("transports a stored receipt only after Attestor task completion", async () => {
    const dependencies = makeDependencies({
      execute: vi.fn(async () => ({
        jobId,
        buildId,
        taskArn: builderTaskArn,
        state: "completed" as const,
      })),
      receiptStore: { read: vi.fn(async () => "signed.receipt.token") },
    });
    const handler = createPreviewBuildAttestorHandler(dependencies);
    const response = await handler(
      request({ token: "signed.job.token", builderTaskArn }),
    );
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      jobId,
      buildId,
      state: "ready",
      receiptToken: "signed.receipt.token",
    });
  });

  it("fails closed if a stopped successful Attestor task has no receipt", async () => {
    const dependencies = makeDependencies({
      execute: vi.fn(async () => ({
        jobId,
        buildId,
        taskArn: builderTaskArn,
        state: "completed" as const,
      })),
    });
    const handler = createPreviewBuildAttestorHandler(dependencies);
    const response = await handler(
      request({ token: "signed.job.token", builderTaskArn }),
    );
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      jobId,
      buildId,
      state: "failed",
    });
  });

  it("rejects extra command fields before launching any task", async () => {
    const dependencies = makeDependencies();
    const handler = createPreviewBuildAttestorHandler(dependencies);
    const response = await handler(
      request({
        token: "signed.job.token",
        builderTaskArn,
        arbitrary: "not-allowed",
      }),
    );
    expect(response.status).toBe(400);
    expect(dependencies.execute).not.toHaveBeenCalled();
  });
});
