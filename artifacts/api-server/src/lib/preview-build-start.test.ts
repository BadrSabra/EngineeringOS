import { generateKeyPairSync } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import type { PreviewBuildJob } from "@workspace/db";
import { previewBuildInputObjectKeyForArchive } from "./preview-build-upload.js";
import { previewBuildArtifactRefId } from "./preview-artifact-reference.js";
import {
  startOrResumePreviewBuild,
  type PreviewBuildCandidate,
} from "./preview-build-start.js";
import type { PreviewBuildInputArchive } from "./preview-build-input.js";
import type { PreviewBuildJobClaims } from "./preview-build-job.js";

const now = new Date("2026-11-12T12:00:00.000Z");
const keyPair = generateKeyPairSync("ed25519");
const buildJobPrivateKeyPem = keyPair.privateKey.export({
  type: "pkcs8",
  format: "pem",
}) as string;
const taskArn =
  "arn:aws:ecs:eu-central-1:123456789012:task/preview-builder/abcdef0123456789abcdef0123456789";
const candidate: PreviewBuildCandidate = {
  id: "proposal-1",
  projectId: "project-1",
  operationId: "operation-1",
  status: "pending",
  lifecycle: "isolated",
  revision: 4,
  candidateTreeHash: "b".repeat(64),
  changeSetHash: "c".repeat(64),
  workspaceRoot: "/managed/candidate",
};
const identity = {
  projectId: candidate.projectId,
  proposalId: candidate.id,
  operationId: candidate.operationId!,
  proposalRevision: candidate.revision,
  candidateRevision: candidate.candidateTreeHash!,
  changeSetHash: candidate.changeSetHash!,
};
const sourceDigest = "d".repeat(64);
const archiveDigest = "e".repeat(64);
const clientRequestId = "323e4567-e89b-42d3-a456-426614174002";
const jobId = "123e4567-e89b-42d3-a456-426614174000";
const buildId = "223e4567-e89b-42d3-a456-426614174001";
const outputArtifactKey = `preview-build-outputs/${buildId}/site.tar.gz`;
const inputArtifactKey = previewBuildInputObjectKeyForArchive({
  identity,
  sourceDigest,
  archiveDigest,
});
const builderImageDigest = `sha256:${"a".repeat(64)}`;
function makeJob(overrides: Partial<PreviewBuildJob> = {}): PreviewBuildJob {
  return {
    jobId,
    buildId,
    projectId: candidate.projectId,
    proposalId: candidate.id,
    userId: "user-1",
    clientRequestId,
    operationId: candidate.operationId!,
    proposalRevision: candidate.revision,
    candidateRevision: candidate.candidateTreeHash!,
    changeSetHash: candidate.changeSetHash!,
    sourceRoot: "web",
    sourceDigest,
    archiveDigest,
    inputArtifactKey,
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
    tokenExpiresAt: new Date(now.getTime() + 5 * 60_000),
    status: "queued",
    executionRef: null,
    outputDigest: null,
    buildReceiptId: null,
    failureCode: null,
    stateVersion: 0,
    startedAt: null,
    completedAt: null,
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
}

function makeBuildInput(): PreviewBuildInputArchive {
  return {
    archive: Buffer.from("verified candidate archive"),
    archiveDigest,
    totalBytes: 26,
    manifest: {
      version: 1,
      builderProfile: "vite-react-static-v1",
      ...identity,
      sourceRoot: "web",
      sourceDigest,
      files: [],
    },
  };
}

function config() {
  return {
    gatewayUrl: "https://gateway.example.com",
    buildInputUploadPrivateKeyPem: "upload-key-is-validated-by-the-client",
    buildJobPrivateKeyPem,
    builderImageDigest,
    sourceRoot: "web",
  };
}

function baseDependencies() {
  let current = makeJob();
  const archive = makeBuildInput();
  const dependencies = {
    now: () => now,
    findByRequest: vi.fn(async () => null as PreviewBuildJob | null),
    findActive: vi.fn(async () => null as PreviewBuildJob | null),
    findForOwner: vi.fn(async () => current),
    createArchive: vi.fn(async () => archive),
    uploadInput: vi.fn(async () => ({
      jobId,
      artifactRefId: previewBuildArtifactRefId(jobId, "input"),
      sourceDigest,
      archiveDigest,
      objectKey: previewBuildInputObjectKeyForArchive({
        identity,
        sourceDigest,
        archiveDigest,
      }),
    })),
    createJob: vi.fn(async () => {
      current = { ...current, inputArtifactReadyAt: null };
      return current;
    }),
    markInputReady: vi.fn(
      async (input: { now: Date }) => {
        current = {
          ...current,
          inputArtifactReadyAt: input.now,
          stateVersion: current.stateVersion + 1,
        };
        return current;
      },
    ),
    transitionJob: vi.fn(
      async (input: { nextStatus: string; executionRef?: string }) => {
        current = {
          ...current,
          status: input.nextStatus as PreviewBuildJob["status"],
          executionRef: input.executionRef ?? current.executionRef,
          stateVersion: current.stateVersion + 1,
        };
        return current;
      },
    ),
    dispatch: vi.fn(async (input: { claims: PreviewBuildJobClaims }) => ({
      jobId: input.claims.jobId,
      buildId: input.claims.buildId,
      executionRef: taskArn,
    })),
    getCurrent: () => current,
  };
  return dependencies;
}

describe("Preview build start orchestration", () => {
  it("archives, uploads, persists, and dispatches one current Candidate", async () => {
    const dependencies = baseDependencies();
    const result = await startOrResumePreviewBuild({
      candidate,
      projectId: candidate.projectId,
      userId: "user-1",
      clientRequestId,
      config: config(),
      dependencies,
    });

    expect(dependencies.createArchive).toHaveBeenCalledWith({
      workspaceRoot: candidate.workspaceRoot,
      sourceRoot: "web",
      identity,
    });
    expect(dependencies.uploadInput).toHaveBeenCalledTimes(1);
    expect(dependencies.uploadInput).toHaveBeenCalledWith(
      expect.objectContaining({ jobId }),
    );
    expect(dependencies.createJob).toHaveBeenCalledWith(
      expect.objectContaining({
        clientRequestId,
        projectId: candidate.projectId,
        proposalId: candidate.id,
        sourceDigest,
        archiveDigest,
        builderImageDigest,
      }),
      now,
    );
    expect(dependencies.createJob.mock.invocationCallOrder[0]).toBeLessThan(
      dependencies.uploadInput.mock.invocationCallOrder[0]!,
    );
    expect(dependencies.markInputReady).toHaveBeenCalledOnce();
    expect(dependencies.dispatch).toHaveBeenCalledWith(
      expect.objectContaining({
        gatewayUrl: "https://gateway.example.com",
        claims: expect.objectContaining({
          jobId,
          buildId,
          sourceDigest,
          archiveDigest,
          outputArtifactKey,
        }),
      }),
    );
    expect(result.job.status).toBe("running");
    expect(result.job.executionRef).toBe(taskArn);
    expect(result.launchPending).toBe(false);
    expect(JSON.stringify(result)).not.toContain("PrivateKey");
    expect(JSON.stringify(result)).not.toContain("upload-key");
  });

  it("retries the same durable launching claim after an ambiguous response", async () => {
    const dependencies = baseDependencies();
    const launchingJob = makeJob({
      status: "launching",
      stateVersion: 1,
      startedAt: now,
    });
    dependencies.findByRequest.mockResolvedValue(launchingJob);
    dependencies.dispatch
      .mockRejectedValueOnce(new Error("lost response"))
      .mockResolvedValueOnce({
        jobId,
        buildId,
        executionRef: taskArn,
      });

    const first = await startOrResumePreviewBuild({
      candidate,
      projectId: candidate.projectId,
      userId: "user-1",
      clientRequestId,
      config: config(),
      dependencies,
    });
    const second = await startOrResumePreviewBuild({
      candidate,
      projectId: candidate.projectId,
      userId: "user-1",
      clientRequestId,
      config: config(),
      dependencies,
    });

    expect(first.job.status).toBe("launching");
    expect(first.launchPending).toBe(true);
    expect(second.job.status).toBe("running");
    expect(second.launchPending).toBe(false);
    expect(dependencies.createArchive).not.toHaveBeenCalled();
    expect(dependencies.uploadInput).not.toHaveBeenCalled();
    expect(dependencies.createJob).not.toHaveBeenCalled();
    expect(dependencies.dispatch).toHaveBeenCalledTimes(2);
    expect(dependencies.dispatch.mock.calls[0]?.[0].claims).toEqual(
      dependencies.dispatch.mock.calls[1]?.[0].claims,
    );
  });

  it("retries an admitted job whose input upload failed before readiness", async () => {
    const dependencies = baseDependencies();
    dependencies.uploadInput.mockRejectedValueOnce(new Error("network lost"));
    await expect(
      startOrResumePreviewBuild({
        candidate,
        projectId: candidate.projectId,
        userId: "user-1",
        clientRequestId,
        config: config(),
        dependencies,
      }),
    ).rejects.toMatchObject({
      code: "PREVIEW_BUILD_JOB_UNAVAILABLE",
    });
    expect(dependencies.getCurrent().status).toBe("queued");
    expect(dependencies.getCurrent().inputArtifactReadyAt).toBeNull();
    expect(dependencies.dispatch).not.toHaveBeenCalled();

    dependencies.findByRequest.mockImplementation(async () =>
      dependencies.getCurrent(),
    );
    const resumed = await startOrResumePreviewBuild({
      candidate,
      projectId: candidate.projectId,
      userId: "user-1",
      clientRequestId,
      config: config(),
      dependencies,
    });

    expect(dependencies.createJob).toHaveBeenCalledOnce();
    expect(dependencies.uploadInput).toHaveBeenCalledTimes(2);
    expect(dependencies.markInputReady).toHaveBeenCalledOnce();
    expect(resumed.job.status).toBe("running");
    expect(resumed.job.inputArtifactReadyAt).toEqual(now);
  });

  it("does not relaunch an expired claim or replace its durable token", async () => {
    const dependencies = baseDependencies();
    const expiredJob = makeJob({
      status: "launching",
      stateVersion: 1,
      startedAt: now,
      tokenExpiresAt: new Date(now.getTime() - 1),
    });
    dependencies.findByRequest.mockResolvedValueOnce(expiredJob);

    const result = await startOrResumePreviewBuild({
      candidate,
      projectId: candidate.projectId,
      userId: "user-1",
      clientRequestId,
      config: config(),
      dependencies,
    });

    expect(result.job.status).toBe("launching");
    expect(result.launchPending).toBe(true);
    expect(dependencies.dispatch).not.toHaveBeenCalled();
  });

  it("rejects a retry when the current Candidate no longer matches", async () => {
    const dependencies = baseDependencies();
    dependencies.findByRequest.mockResolvedValueOnce(
      makeJob({ candidateRevision: "f".repeat(64) }),
    );

    await expect(
      startOrResumePreviewBuild({
        candidate,
        projectId: candidate.projectId,
        userId: "user-1",
        clientRequestId,
        config: config(),
        dependencies,
      }),
    ).rejects.toMatchObject({
      code: "PREVIEW_BUILD_IDEMPOTENCY_CONFLICT",
    });
    expect(dependencies.dispatch).not.toHaveBeenCalled();
    expect(dependencies.createArchive).not.toHaveBeenCalled();
  });

  it("rejects a second active build before archiving or transferring Candidate files", async () => {
    const dependencies = baseDependencies();
    dependencies.findActive.mockResolvedValueOnce(makeJob());

    await expect(
      startOrResumePreviewBuild({
        candidate,
        projectId: candidate.projectId,
        userId: "user-1",
        clientRequestId,
        config: config(),
        dependencies,
      }),
    ).rejects.toMatchObject({ code: "PREVIEW_BUILD_ALREADY_ACTIVE" });
    expect(dependencies.createArchive).not.toHaveBeenCalled();
    expect(dependencies.uploadInput).not.toHaveBeenCalled();
    expect(dependencies.createJob).not.toHaveBeenCalled();
  });
});
