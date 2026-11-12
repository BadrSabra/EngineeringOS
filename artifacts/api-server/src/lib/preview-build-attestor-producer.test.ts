import { generateKeyPairSync } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  isVerifiedPreviewBuildReceipt,
  verifyPreviewBuildReceipt,
} from "./preview-build-receipt.js";
import { signPreviewBuildReceipt } from "../../../../infra/aws-preview/attestor/receipt.mjs";

const now = new Date("2026-11-12T13:00:00.000Z");

describe("independent Preview Attestor receipt compatibility", () => {
  it("produces a receipt accepted by the API's independent verification gate", () => {
    const { privateKey, publicKey } = generateKeyPairSync("ed25519");
    const privateKeyPem = privateKey
      .export({
        type: "pkcs8",
        format: "pem",
      })
      .toString();
    const publicKeyPem = publicKey
      .export({
        type: "spki",
        format: "pem",
      })
      .toString();
    const identity = {
      projectId: "project-1",
      proposalId: "proposal-1",
      operationId: "operation-1",
      proposalRevision: 4,
      candidateRevision: "a".repeat(64),
      changeSetHash: "b".repeat(64),
    };
    const sourceDigest = "c".repeat(64);
    const archiveDigest = "d".repeat(64);
    const buildId = "223e4567-e89b-42d3-a456-426614174001";
    const builderImageDigest = `sha256:${"e".repeat(64)}`;
    const outputArtifactKey = `preview-build-outputs/${buildId}/site.tar.gz`;
    const { token } = signPreviewBuildReceipt({
      claims: {
        action: "preview-build",
        buildId,
        builderProfile: "vite-react-static-v1",
        builderImageDigest,
        ...identity,
        sourceDigest,
        archiveDigest,
        outputArtifactKey,
      },
      buildOutputDigest: "f".repeat(64),
      privateKeyPem,
      now,
    });

    const receipt = verifyPreviewBuildReceipt({
      token,
      publicKeyPem,
      expected: {
        identity,
        sourceDigest,
        archiveDigest,
        builderImageDigest,
        buildId,
        outputArtifactKey,
      },
      now,
    });
    expect(receipt.buildOutputDigest).toBe("f".repeat(64));
    expect(isVerifiedPreviewBuildReceipt(receipt)).toBe(true);
  });
});
