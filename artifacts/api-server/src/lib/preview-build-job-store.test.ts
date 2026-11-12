import { describe, expect, it } from "vitest";
import {
  createQueuedPreviewBuildJob,
  previewBuildCandidateMatchesJob,
  PreviewBuildJobStoreError,
  transitionPreviewBuildJob,
} from "./preview-build-job-store.js";
import type { PreviewBuildJob } from "@workspace/db";

const now = new Date("2026-11-11T12:00:00.000Z");

const validInput = {
  clientRequestId: "9c99a591-cf7f-4f18-8c4b-08e53ca1e4aa",
  projectId: "project-1",
  userId: "user-1",
  proposalId: "proposal-1",
  operationId: "operation-1",
  proposalRevision: 3,
  candidateRevision: "a".repeat(64),
  changeSetHash: "b".repeat(64),
  sourceRoot: "web",
  sourceDigest: "c".repeat(64),
  archiveDigest: "d".repeat(64),
  builderImageDigest: `sha256:${"e".repeat(64)}`,
  issuedAt: new Date(now.getTime() - 1_000),
  tokenExpiresAt: new Date(now.getTime() + 60_000),
};

describe("Preview build job durable store boundary", () => {
  it("requires the exact live owner and Candidate revision before accepting a receipt", () => {
    const job = {
      jobId: "123e4567-e89b-42d3-a456-426614174000",
      projectId: "project-1",
      proposalId: "proposal-1",
      userId: "user-1",
      operationId: "operation-1",
      proposalRevision: 3,
      candidateRevision: "a".repeat(64),
      changeSetHash: "b".repeat(64),
    } as PreviewBuildJob;
    const candidate = {
      id: job.proposalId,
      projectId: job.projectId,
      ownerId: job.userId,
      operationId: job.operationId,
      status: "pending",
      lifecycle: "isolated",
      revision: job.proposalRevision,
      candidateTreeHash: job.candidateRevision,
      changeSetHash: job.changeSetHash,
      workspaceRoot: "/managed/candidate",
    };

    expect(previewBuildCandidateMatchesJob(candidate, job)).toBe(true);
    expect(
      previewBuildCandidateMatchesJob(
        { ...candidate, ownerId: "another-user" },
        job,
      ),
    ).toBe(false);
    expect(
      previewBuildCandidateMatchesJob(
        { ...candidate, candidateTreeHash: "c".repeat(64) },
        job,
      ),
    ).toBe(false);
    expect(
      previewBuildCandidateMatchesJob({ ...candidate, status: "applied" }, job),
    ).toBe(false);
  });

  it("rejects unsafe source roots before attempting database admission", async () => {
    await expect(
      createQueuedPreviewBuildJob(
        { ...validInput, sourceRoot: "../secrets" },
        now,
      ),
    ).rejects.toMatchObject({
      code: "PREVIEW_BUILD_JOB_INPUT_INVALID",
    });
    await expect(
      createQueuedPreviewBuildJob(
        { ...validInput, sourceRoot: "/home/runner/workspace" },
        now,
      ),
    ).rejects.toBeInstanceOf(PreviewBuildJobStoreError);
  });

  it("rejects expired or overlong launch claims before database admission", async () => {
    await expect(
      createQueuedPreviewBuildJob(
        {
          ...validInput,
          tokenExpiresAt: new Date(now.getTime()),
        },
        now,
      ),
    ).rejects.toMatchObject({
      code: "PREVIEW_BUILD_JOB_INPUT_INVALID",
    });
    await expect(
      createQueuedPreviewBuildJob(
        {
          ...validInput,
          tokenExpiresAt: new Date(now.getTime() + 5 * 60_000 + 1),
        },
        now,
      ),
    ).rejects.toBeInstanceOf(PreviewBuildJobStoreError);
  });

  it("rejects a verified transition without trusted receipt fields", async () => {
    await expect(
      transitionPreviewBuildJob({
        jobId: validInput.clientRequestId,
        expectedStatus: "running",
        expectedVersion: 2,
        nextStatus: "verified",
        now,
      } as unknown as Parameters<typeof transitionPreviewBuildJob>[0]),
    ).rejects.toMatchObject({
      code: "PREVIEW_BUILD_JOB_TRANSITION_INVALID",
    });
  });
});
