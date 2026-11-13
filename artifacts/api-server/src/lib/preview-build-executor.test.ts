import { beforeEach, describe, expect, it, vi } from "vitest";
import type { PreviewBuildJob } from "@workspace/db";
import type { PreviewBuildJobClaims } from "./preview-build-job.js";

const clients = vi.hoisted(() => ({
  launch: vi.fn(),
  observe: vi.fn(),
  upload: vi.fn(),
}));

vi.mock("./preview-builder-gateway-client.js", () => ({
  dispatchPreviewBuilderJob: clients.launch,
}));
vi.mock("./preview-build-observation-client.js", () => ({
  observePreviewBuildJob: clients.observe,
}));
vi.mock("./preview-build-input-client.js", () => ({
  uploadPreviewBuildInput: clients.upload,
}));

import {
  createPreviewBuildGatewayExecutor,
  createPreviewBuildGatewayInputArtifactStore,
} from "./preview-build-executor-gateway.js";

describe("Preview build executor provider boundary", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("keeps Gateway settings inside adapters for storage, launch, and observation", async () => {
    const job = { jobId: "job-1" } as PreviewBuildJob;
    const claims = { jobId: "job-1" } as PreviewBuildJobClaims;
    const identity = { proposalId: "proposal-1" };
    const buildInput = { archiveDigest: "digest" };
    const now = new Date("2026-11-13T00:00:00.000Z");
    const launched = {
      jobId: "job-1",
      buildId: "build-1",
      executionRef: "opaque-ecs-reference",
    };
    const stored = { jobId: "job-1", objectKey: "logical-artifact-key" };
    const observed = {
      jobId: "job-1",
      buildId: "build-1",
      state: "running" as const,
    };
    clients.launch.mockResolvedValue(launched);
    clients.observe.mockResolvedValue(observed);
    clients.upload.mockResolvedValue(stored);

    const executor = createPreviewBuildGatewayExecutor({
      gatewayUrl: "https://gateway.example",
      privateKeyPem: "private-key",
    });
    const artifactStore = createPreviewBuildGatewayInputArtifactStore({
      gatewayUrl: "https://gateway.example",
      privateKeyPem: "upload-key",
    });

    await expect(executor.launch({ claims, now })).resolves.toEqual(launched);
    await expect(executor.observe({ job, now })).resolves.toEqual(observed);
    await expect(
      artifactStore.storeInput({
        jobId: "job-1",
        identity: identity as never,
        buildInput: buildInput as never,
        now,
      }),
    ).resolves.toEqual(stored);

    expect(clients.launch).toHaveBeenCalledWith({
      gatewayUrl: "https://gateway.example",
      privateKeyPem: "private-key",
      claims,
      now,
    });
    expect(clients.observe).toHaveBeenCalledWith({
      gatewayUrl: "https://gateway.example",
      privateKeyPem: "private-key",
      job,
      now,
    });
    expect(clients.upload).toHaveBeenCalledWith({
      gatewayUrl: "https://gateway.example",
      privateKeyPem: "upload-key",
      jobId: "job-1",
      identity,
      buildInput,
      now,
    });
  });
});
