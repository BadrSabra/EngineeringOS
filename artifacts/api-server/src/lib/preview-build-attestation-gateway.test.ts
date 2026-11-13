import { beforeEach, describe, expect, it, vi } from "vitest";
import type { PreviewBuildJob } from "@workspace/db";

const { attestPreviewBuildJob } = vi.hoisted(() => ({
  attestPreviewBuildJob: vi.fn(),
}));

vi.mock("./preview-build-attestor-client.js", () => ({
  attestPreviewBuildJob,
}));

import { createPreviewBuildGatewayAttestationService } from "./preview-build-attestation-gateway.js";

describe("Preview Gateway Attestation adapter", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("keeps Gateway credentials inside the adapter and forwards the execution identity", async () => {
    const job = {
      jobId: "9a2f4fb6-9c3c-4c6a-8b87-9b1d0b1876d2",
      buildId: "build-1",
    } as PreviewBuildJob;
    const now = new Date("2026-11-13T04:00:00.000Z");
    const result = {
      jobId: job.jobId,
      buildId: job.buildId,
      state: "pending",
    };
    attestPreviewBuildJob.mockResolvedValue(result);

    const service = createPreviewBuildGatewayAttestationService({
      gatewayUrl: "https://gateway.example",
      privateKeyPem: "private key stays in the adapter",
    });
    await expect(
      service.attest({
        job,
        executionRef: "opaque-execution:attempt-1",
        now,
      }),
    ).resolves.toBe(result);

    expect(attestPreviewBuildJob).toHaveBeenCalledWith({
      gatewayUrl: "https://gateway.example",
      privateKeyPem: "private key stays in the adapter",
      job,
      executionRef: "opaque-execution:attempt-1",
      now,
    });
  });
});
