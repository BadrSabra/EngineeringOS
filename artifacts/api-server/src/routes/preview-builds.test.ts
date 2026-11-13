import express, { type RequestHandler } from "express";
import request from "supertest";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { PreviewBuildJob } from "@workspace/db";
import {
  PreviewBuildStartError,
  type PreviewBuildCandidate,
} from "../lib/preview-build-start.js";
import { createPreviewBuildRouter } from "./preview-builds.js";

const candidate: PreviewBuildCandidate = {
  id: "proposal-1",
  projectId: "project-1",
  operationId: "operation-1",
  status: "pending",
  lifecycle: "isolated",
  revision: 2,
  candidateTreeHash: "a".repeat(64),
  changeSetHash: "b".repeat(64),
  workspaceRoot: "/managed/candidate",
};
const jobId = "123e4567-e89b-42d3-a456-426614174000";
const buildId = "223e4567-e89b-42d3-a456-426614174001";
const clientRequestId = "323e4567-e89b-42d3-a456-426614174002";
const taskArn =
  "arn:aws:ecs:eu-central-1:123456789012:task/preview-builder/abcdef0123456789abcdef0123456789";

function makeJob(overrides: Partial<PreviewBuildJob> = {}): PreviewBuildJob {
  const now = new Date("2026-11-12T12:00:00.000Z");
  return {
    jobId,
    buildId,
    projectId: candidate.projectId,
    proposalId: candidate.id,
    userId: "owner-1",
    clientRequestId,
    operationId: candidate.operationId!,
    proposalRevision: candidate.revision,
    candidateRevision: candidate.candidateTreeHash!,
    changeSetHash: candidate.changeSetHash!,
    sourceRoot: "web",
    sourceDigest: "c".repeat(64),
    archiveDigest: "d".repeat(64),
    inputArtifactKey: `build-inputs/${"c".repeat(64)}/${"d".repeat(64)}.zip`,
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
    tokenExpiresAt: new Date(now.getTime() + 5 * 60_000),
    status: "launching",
    executionRef: taskArn,
    outputDigest: null,
    buildReceiptId: null,
    failureCode: null,
    stateVersion: 2,
    startedAt: now,
    completedAt: null,
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
}

function makeRequestContext() {
  const access: RequestHandler = (req, _res, next) => {
    req.userId = "owner-1";
    next();
  };
  const config = {
    gatewayUrl: undefined,
    buildInputUploadPrivateKeyPem: undefined,
    buildJobPrivateKeyPem: undefined,
    builderImageDigest: undefined,
    sourceRoot: undefined,
  };
  const dependencies = {
    requireProjectAccess: access,
    requireProjectWriteAccess: access,
    loadCandidate: vi.fn(async () => candidate),
    startBuild: vi.fn(async () => ({
      job: makeJob(),
      launchPending: true,
    })),
    findForOwner: vi.fn(async () => makeJob() as PreviewBuildJob | null),
    serviceConfig: config,
  };
  const app = express();
  app.use(express.json());
  app.use(createPreviewBuildRouter(dependencies));
  return { app, dependencies };
}

describe("Preview build API routes", () => {
  beforeEach(() => vi.clearAllMocks());

  it("starts a Candidate build and returns only the safe job projection", async () => {
    const { app, dependencies } = makeRequestContext();
    const response = await request(app)
      .post(
        `/projects/${candidate.projectId}/proposals/${candidate.id}/preview-builds`,
      )
      .send({ clientRequestId });

    expect(response.status).toBe(202);
    expect(response.headers["cache-control"]).toBe("no-store");
    expect(response.body).toEqual({
      jobId,
      buildId,
      status: "launching",
      stateVersion: 2,
      createdAt: expect.any(String),
      updatedAt: expect.any(String),
      launchPending: true,
    });
    expect(JSON.stringify(response.body)).not.toContain("outputArtifactKey");
    expect(JSON.stringify(response.body)).not.toContain("archiveDigest");
    expect(dependencies.startBuild).toHaveBeenCalledWith(
      expect.objectContaining({
        candidate,
        projectId: candidate.projectId,
        userId: "owner-1",
        clientRequestId,
        config: dependencies.serviceConfig,
      }),
    );
  });

  it("rejects malformed and extra request fields before reading Candidate data", async () => {
    const { app, dependencies } = makeRequestContext();
    const response = await request(app)
      .post(
        `/projects/${candidate.projectId}/proposals/${candidate.id}/preview-builds`,
      )
      .send({ clientRequestId, sourceRoot: "../../outside" });

    expect(response.status).toBe(400);
    expect(response.body).toEqual({
      error: "invalid_preview_build_request",
    });
    expect(dependencies.loadCandidate).not.toHaveBeenCalled();
    expect(dependencies.startBuild).not.toHaveBeenCalled();
  });

  it("maps stale Candidate conflicts without exposing internal details", async () => {
    const { app, dependencies } = makeRequestContext();
    dependencies.startBuild.mockRejectedValueOnce(
      new PreviewBuildStartError("PREVIEW_BUILD_CANDIDATE_STALE"),
    );

    const response = await request(app)
      .post(
        `/projects/${candidate.projectId}/proposals/${candidate.id}/preview-builds`,
      )
      .send({ clientRequestId });

    expect(response.status).toBe(409);
    expect(response.body).toEqual({
      error: "preview_candidate_changed",
    });
    expect(JSON.stringify(response.body)).not.toContain("PREVIEW_BUILD");
  });

  it("prevents parallel builds for the same Candidate", async () => {
    const { app, dependencies } = makeRequestContext();
    dependencies.startBuild.mockRejectedValueOnce(
      new PreviewBuildStartError("PREVIEW_BUILD_ALREADY_ACTIVE"),
    );

    const response = await request(app)
      .post(
        `/projects/${candidate.projectId}/proposals/${candidate.id}/preview-builds`,
      )
      .send({ clientRequestId });

    expect(response.status).toBe(409);
    expect(response.body).toEqual({ error: "preview_build_already_active" });
  });

  it("loads a build status only for the authenticated project owner", async () => {
    const { app, dependencies } = makeRequestContext();
    const response = await request(app).get(
      `/projects/${candidate.projectId}/preview-builds/${jobId}`,
    );

    expect(response.status).toBe(200);
    expect(dependencies.findForOwner).toHaveBeenCalledWith({
      jobId,
      projectId: candidate.projectId,
      userId: "owner-1",
    });
    expect(response.headers["cache-control"]).toBe("no-store");
    expect(response.body.status).toBe("launching");
    expect(response.body.builderTaskArn).toBeUndefined();
    expect(response.body.inputArtifactKey).toBeUndefined();
    expect(response.body.outputArtifactKey).toBeUndefined();
    expect(response.body.sourceDigest).toBeUndefined();
  });

  it("returns the same not-found response for jobs outside the owner's scope", async () => {
    const { app, dependencies } = makeRequestContext();
    dependencies.findForOwner.mockResolvedValueOnce(null);

    const response = await request(app).get(
      `/projects/${candidate.projectId}/preview-builds/${jobId}`,
    );

    expect(response.status).toBe(404);
    expect(response.body).toEqual({ error: "preview_build_not_found" });
  });
});
