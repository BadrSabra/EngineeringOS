import { describe, expect, it, vi } from "vitest";
import type { PreviewBuildJob } from "@workspace/db";
import { transitionPreviewBuildJob } from "./preview-build-job-store.js";
import { reconcilePreviewBuildJobsOnce } from "./preview-build-reconciliation-worker.js";
import type { PreviewBuildObservation } from "./preview-build-observation-client.js";

const now = new Date("2026-11-12T13:00:00.000Z");
const taskArn =
  "arn:aws:ecs:eu-central-1:123456789012:task/preview/abcdef0123456789abcdef0123456789";
const jobId = "123e4567-e89b-42d3-a456-426614174000";
const buildId = "223e4567-e89b-42d3-a456-426614174001";
const outputDigest = "a".repeat(64);

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
    inputArtifactStoreId: null,
    inputArtifactRefId: null,
    inputArtifactSizeBytes: null,
    inputArtifactManifestDigest: null,
    inputArtifactRetentionPolicy: null,
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
    builderImageDigest: `sha256:${"f".repeat(64)}`,
    issuedAt: new Date(now.getTime() - 60_000),
    tokenExpiresAt: new Date(now.getTime() + 240_000),
    status: "launching",
    builderTaskArn: null,
    outputDigest: null,
    buildReceiptId: null,
    failureCode: null,
    stateVersion: 2,
    startedAt: null,
    completedAt: null,
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
}

function transitionMock() {
  return vi.fn(
    async (input: Parameters<typeof transitionPreviewBuildJob>[0]) => {
      const job = makeJob({
        status: input.nextStatus,
        builderTaskArn: input.builderTaskArn ?? null,
        outputDigest: input.outputDigest ?? null,
        failureCode: input.failureCode ?? null,
        stateVersion: input.expectedVersion + 1,
        startedAt: input.nextStatus === "running" ? now : null,
        completedAt:
          input.nextStatus === "failed" ||
          input.nextStatus === "builder_succeeded"
            ? now
            : null,
      });
      return job;
    },
  );
}

function run(input: {
  job: PreviewBuildJob;
  observation: PreviewBuildObservation;
}) {
  const transition = transitionMock();
  return {
    transition,
    result: reconcilePreviewBuildJobsOnce({
      config: {
        gatewayUrl: "https://gateway.example",
        privateKeyPem: "private key placeholder",
      },
      dependencies: {
        now: () => now,
        listJobs: vi.fn(async () => [input.job]),
        observe: vi.fn(async () => input.observation),
        transition,
      },
    }),
  };
}

describe("durable Preview build reconciliation", () => {
  it("recovers a lost launch response by recording the exact running task", async () => {
    const { result, transition } = run({
      job: makeJob(),
      observation: { jobId, buildId, state: "running", taskArn },
    });
    await expect(result).resolves.toMatchObject({
      inspected: 1,
      advanced: 1,
      failed: 0,
    });
    expect(transition).toHaveBeenCalledWith(
      expect.objectContaining({
        expectedStatus: "launching",
        expectedVersion: 2,
        nextStatus: "running",
        builderTaskArn: taskArn,
      }),
    );
  });

  it("records a failed ECS exit, not a successful build", async () => {
    const { result, transition } = run({
      job: makeJob({
        status: "running",
        builderTaskArn: taskArn,
        stateVersion: 3,
      }),
      observation: {
        jobId,
        buildId,
        state: "stopped",
        taskArn,
        exitCode: 7,
      },
    });
    await expect(result).resolves.toMatchObject({ failed: 1 });
    expect(transition).toHaveBeenCalledWith(
      expect.objectContaining({
        expectedStatus: "running",
        nextStatus: "failed",
        failureCode: "BUILDER_EXIT_NONZERO",
      }),
    );
  });

  it("fails a stopped task whose Builder exit status is unavailable", async () => {
    const { result, transition } = run({
      job: makeJob({
        status: "running",
        builderTaskArn: taskArn,
        stateVersion: 3,
      }),
      observation: { jobId, buildId, state: "stopped", taskArn },
    });
    await expect(result).resolves.toMatchObject({ failed: 1 });
    expect(transition).toHaveBeenCalledWith(
      expect.objectContaining({
        expectedStatus: "running",
        nextStatus: "failed",
        failureCode: "BUILDER_EXIT_UNAVAILABLE",
      }),
    );
  });

  it("records builder_succeeded only when stopped successfully with a verified S3 digest", async () => {
    const { result, transition } = run({
      job: makeJob({
        status: "running",
        builderTaskArn: taskArn,
        stateVersion: 3,
      }),
      observation: {
        jobId,
        buildId,
        state: "stopped",
        taskArn,
        exitCode: 0,
        outputDigest,
      },
    });
    await expect(result).resolves.toMatchObject({ advanced: 1 });
    expect(transition).toHaveBeenCalledWith(
      expect.objectContaining({
        expectedStatus: "running",
        nextStatus: "builder_succeeded",
        builderTaskArn: taskArn,
        outputDigest,
      }),
    );
  });

  it("does not mark exit-zero jobs successful when S3 has no verified digest", async () => {
    const { result, transition } = run({
      job: makeJob({
        status: "running",
        builderTaskArn: taskArn,
        stateVersion: 3,
      }),
      observation: {
        jobId,
        buildId,
        state: "stopped",
        taskArn,
        exitCode: 0,
      },
    });
    await expect(result).resolves.toMatchObject({
      awaitingOutput: 1,
      advanced: 0,
    });
    expect(transition).not.toHaveBeenCalled();
  });

  it("fails an ambiguous launch only after its token expiry plus grace period", async () => {
    const staleJob = makeJob({
      tokenExpiresAt: new Date(now.getTime() - 3 * 60_000),
    });
    const { result, transition } = run({
      job: staleJob,
      observation: { jobId, buildId, state: "not_found" },
    });
    await expect(result).resolves.toMatchObject({ failed: 1 });
    expect(transition).toHaveBeenCalledWith(
      expect.objectContaining({
        expectedStatus: "launching",
        nextStatus: "failed",
        failureCode: "BUILDER_TASK_NOT_FOUND",
      }),
    );
  });

  it("expires an orphaned queued row after its signed launch token expires", async () => {
    const transition = transitionMock();
    const observe = vi.fn();
    await expect(
      reconcilePreviewBuildJobsOnce({
        config: {
          gatewayUrl: "https://gateway.example",
          privateKeyPem: "private key placeholder",
        },
        dependencies: {
          now: () => now,
          listJobs: vi.fn(async () => [
            makeJob({
              status: "queued",
              tokenExpiresAt: new Date(now.getTime() - 1),
            }),
          ]),
          observe: observe as never,
          transition,
        },
      }),
    ).resolves.toMatchObject({ expired: 1, inspected: 1 });
    expect(observe).not.toHaveBeenCalled();
    expect(transition).toHaveBeenCalledWith(
      expect.objectContaining({
        expectedStatus: "queued",
        nextStatus: "expired",
      }),
    );
  });

  it("dispatches a successful Builder result to Attestor and waits for its receipt", async () => {
    const transition = transitionMock();
    const attest = vi.fn(async () => ({
      jobId,
      buildId,
      state: "pending" as const,
    }));
    const acceptReceipt = vi.fn();
    await expect(
      reconcilePreviewBuildJobsOnce({
        config: {
          gatewayUrl: "https://gateway.example",
          privateKeyPem: "private key placeholder",
          receiptPublicKeyPem: "receipt public key",
        },
        dependencies: {
          now: () => now,
          listJobs: vi.fn(async () => [
            makeJob({
              status: "builder_succeeded",
              builderTaskArn: taskArn,
              outputDigest,
              stateVersion: 4,
              updatedAt: now,
            }),
          ]),
          attest,
          acceptReceipt,
          transition,
        },
      }),
    ).resolves.toMatchObject({ inspected: 1, unchanged: 1 });
    expect(attest).toHaveBeenCalledWith(
      expect.objectContaining({
        gatewayUrl: "https://gateway.example",
        builderTaskArn: taskArn,
      }),
    );
    expect(acceptReceipt).not.toHaveBeenCalled();
    expect(transition).not.toHaveBeenCalled();
  });

  it("does not launch Attestor until the API receipt-verification key is configured", async () => {
    const attest = vi.fn();
    await expect(
      reconcilePreviewBuildJobsOnce({
        config: {
          gatewayUrl: "https://gateway.example",
          privateKeyPem: "private key placeholder",
        },
        dependencies: {
          now: () => now,
          listJobs: vi.fn(async () => [
            makeJob({
              status: "builder_succeeded",
              builderTaskArn: taskArn,
              outputDigest,
              stateVersion: 4,
            }),
          ]),
          attest: attest as never,
        },
      }),
    ).resolves.toMatchObject({ inspected: 1, unchanged: 1 });
    expect(attest).not.toHaveBeenCalled();
  });

  it("accepts the returned receipt through API verification before advancing", async () => {
    const transition = transitionMock();
    const attest = vi.fn(async () => ({
      jobId,
      buildId,
      state: "ready" as const,
      receiptToken: "signed.receipt",
    }));
    const acceptReceipt = vi.fn(async () => ({
      job: makeJob(),
      alreadyVerified: false,
    }));
    await expect(
      reconcilePreviewBuildJobsOnce({
        config: {
          gatewayUrl: "https://gateway.example",
          privateKeyPem: "private key placeholder",
          receiptPublicKeyPem: "receipt public key",
        },
        dependencies: {
          now: () => now,
          listJobs: vi.fn(async () => [
            makeJob({
              status: "builder_succeeded",
              builderTaskArn: taskArn,
              outputDigest,
              stateVersion: 4,
              updatedAt: now,
            }),
          ]),
          attest,
          acceptReceipt,
          transition,
        },
      }),
    ).resolves.toMatchObject({ inspected: 1, advanced: 1 });
    expect(acceptReceipt).toHaveBeenCalledWith(
      expect.objectContaining({
        jobId,
        token: "signed.receipt",
        publicKeyPem: "receipt public key",
      }),
    );
    expect(transition).not.toHaveBeenCalled();
  });

  it("fails attestation only after the bounded receipt deadline", async () => {
    const transition = transitionMock();
    const attest = vi.fn();
    await expect(
      reconcilePreviewBuildJobsOnce({
        config: {
          gatewayUrl: "https://gateway.example",
          privateKeyPem: "private key placeholder",
          receiptPublicKeyPem: "receipt public key",
        },
        dependencies: {
          now: () => now,
          listJobs: vi.fn(async () => [
            makeJob({
              status: "builder_succeeded",
              builderTaskArn: taskArn,
              outputDigest,
              stateVersion: 4,
              updatedAt: new Date(now.getTime() - 31 * 60_000),
            }),
          ]),
          attest: attest as never,
          transition,
        },
      }),
    ).resolves.toMatchObject({ inspected: 1, failed: 1 });
    expect(attest).not.toHaveBeenCalled();
    expect(transition).toHaveBeenCalledWith(
      expect.objectContaining({
        expectedStatus: "builder_succeeded",
        nextStatus: "failed",
        failureCode: "PREVIEW_ATTESTOR_TIMEOUT",
      }),
    );
  });
});
