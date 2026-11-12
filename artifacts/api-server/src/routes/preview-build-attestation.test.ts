import express from "express";
import request from "supertest";
import { describe, expect, it, vi } from "vitest";
import type { PreviewBuildJob } from "@workspace/db";
import { PreviewBuildAttestationError } from "../lib/preview-build-attestor.js";
import { createPreviewBuildAttestationRouter } from "./preview-build-attestation.js";

const jobId = "123e4567-e89b-42d3-a456-426614174000";
const buildId = "223e4567-e89b-42d3-a456-426614174001";
const receiptId = "323e4567-e89b-42d3-a456-426614174002";

function makeJob(overrides: Partial<PreviewBuildJob> = {}): PreviewBuildJob {
  const now = new Date("2026-11-12T12:00:00.000Z");
  return {
    jobId,
    buildId,
    projectId: "project-1",
    proposalId: "proposal-1",
    userId: "user-1",
    clientRequestId: "423e4567-e89b-42d3-a456-426614174003",
    operationId: "operation-1",
    proposalRevision: 4,
    candidateRevision: "a".repeat(64),
    changeSetHash: "b".repeat(64),
    sourceRoot: "web",
    sourceDigest: "c".repeat(64),
    archiveDigest: "d".repeat(64),
    inputArtifactKey: `build-inputs/${"c".repeat(64)}/${"d".repeat(64)}.zip`,
    outputArtifactKey: `preview-build-outputs/${buildId}/site.tar.gz`,
    builderImageDigest: `sha256:${"e".repeat(64)}`,
    issuedAt: now,
    tokenExpiresAt: new Date(now.getTime() + 60_000),
    status: "verified",
    builderTaskArn: null,
    outputDigest: "f".repeat(64),
    buildReceiptId: receiptId,
    failureCode: null,
    stateVersion: 4,
    startedAt: now,
    completedAt: now,
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
}

function createApp(acceptReceipt: ReturnType<typeof vi.fn>) {
  const app = express();
  app.use(express.json());
  app.use(
    createPreviewBuildAttestationRouter({
      publicKeyPem: "public key remains server-side",
      acceptReceipt: acceptReceipt as never,
    }),
  );
  return app;
}

describe("Preview build Attestor callback API", () => {
  it("accepts the signed-receipt service result without returning receipt secrets", async () => {
    const acceptReceipt = vi.fn(async () => ({
      job: makeJob(),
      alreadyVerified: false,
    }));
    const app = createApp(acceptReceipt);
    const token = "attestor-signed-token";
    const response = await request(app)
      .post(`/internal/preview-build-jobs/${jobId}/receipt`)
      .send({ token });

    expect(response.status).toBe(200);
    expect(response.headers["cache-control"]).toBe("no-store");
    expect(response.body).toEqual({
      jobId,
      buildId,
      status: "verified",
      stateVersion: 4,
      alreadyVerified: false,
    });
    expect(JSON.stringify(response.body)).not.toContain(token);
    expect(acceptReceipt).toHaveBeenCalledWith({
      jobId,
      token,
      publicKeyPem: "public key remains server-side",
    });
  });

  it("rejects extra fields rather than accepting caller-selected evidence", async () => {
    const acceptReceipt = vi.fn();
    const app = createApp(acceptReceipt);
    const response = await request(app)
      .post(`/internal/preview-build-jobs/${jobId}/receipt`)
      .send({
        token: "signed",
        buildOutputDigest: "0".repeat(64),
        status: "verified",
      });

    expect(response.status).toBe(400);
    expect(response.body).toEqual({
      error: "invalid_attestation_request",
    });
    expect(acceptReceipt).not.toHaveBeenCalled();
  });

  it("maps invalid attestations to a generic non-disclosing response", async () => {
    const acceptReceipt = vi.fn(async () => {
      throw new PreviewBuildAttestationError(
        "PREVIEW_BUILD_ATTESTOR_RECEIPT_REJECTED",
      );
    });
    const app = createApp(acceptReceipt);
    const response = await request(app)
      .post(`/internal/preview-build-jobs/${jobId}/receipt`)
      .send({ token: "forged" });

    expect(response.status).toBe(403);
    expect(response.body).toEqual({
      error: "preview_attestation_rejected",
    });
    expect(JSON.stringify(response.body)).not.toContain("PREVIEW_BUILD");
  });
});
