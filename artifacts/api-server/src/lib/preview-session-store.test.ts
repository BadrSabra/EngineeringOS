import { describe, expect, it } from "vitest";
import { createStartingPreviewSession } from "./preview-session-store.js";
import type { VerifiedPreviewBuildReceipt } from "./preview-build-receipt.js";
import type { VerifiedPreviewRuntimeProfile } from "./preview-runtime-profile.js";

describe("Preview session build admission", () => {
  it("rejects caller-shaped image and task-definition claims without verified receipt identity", async () => {
    const unverifiedReceipt = {
      version: 1,
      action: "preview-build-ready",
      receiptId: "123e4567-e89b-42d3-a456-426614174000",
      projectId: "project-1",
      proposalId: "proposal-1",
      operationId: "operation-1",
      proposalRevision: 1,
      candidateRevision: "a".repeat(64),
      changeSetHash: "b".repeat(64),
      outputArtifactKey:
        "preview-build-outputs/9c99a591-cf7f-4f18-8c4b-08e53ca1e4aa/site.tar.gz",
      sourceDigest: "c".repeat(64),
      archiveDigest: "d".repeat(64),
      buildOutputDigest: "e".repeat(64),
      builderProfile: "vite-react-static-v1",
      builderImageDigest: `sha256:${"f".repeat(64)}`,
      imageRepositoryUri: "example.invalid/repository",
      imageDigest: `sha256:${"1".repeat(64)}`,
      taskDefinitionArn:
        "arn:aws:ecs:us-east-1:123456789012:task-definition/preview:1",
      issuedAt: "2026-11-11T12:00:00.000Z",
      expiresAt: "2026-11-11T12:02:00.000Z",
    } as unknown as VerifiedPreviewBuildReceipt;

    await expect(
      createStartingPreviewSession({
        projectId: "project-1",
        userId: "user-1",
        buildReceipt: unverifiedReceipt,
        runtimeProfile: {} as unknown as VerifiedPreviewRuntimeProfile,
        expiresAt: new Date("2026-11-11T12:20:00.000Z"),
      }),
    ).rejects.toMatchObject({
      code: "PREVIEW_SESSION_INPUT_INVALID",
    });
  });
});
