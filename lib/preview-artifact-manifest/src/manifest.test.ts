import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  PreviewArtifactManifestError,
  validatePreviewArtifactManifest,
} from "./manifest.js";

const storeId = "fcebc599-15a8-47a1-a772-4f53bc5ee98f";
const jobId = "2d4e3485-c254-421e-96b7-59ec11b773a1";
const artifactRefId = "a74706e9-e4ba-4c85-9f94-7827036ad0e8";
const digest = "a".repeat(64);
const objectKey = `build-inputs/${digest}/${digest}.zip`;
const retentionPolicy = "preview-build-input-24h-v1" as const;

function manifestBytes(overrides: Record<string, unknown> = {}): Buffer {
  return Buffer.from(
    JSON.stringify({
      version: 3,
      objectKey,
      storeId,
      jobId,
      artifactRefId,
      archiveDigest: digest,
      contentLength: 17,
      retentionPolicy,
      ...overrides,
    }),
  );
}

describe("Preview artifact manifest validation", () => {
  it("returns the stable metadata for an exact canonical manifest", () => {
    const bytes = manifestBytes();
    const expectedManifestDigest = createHash("sha256")
      .update(bytes)
      .digest("hex");

    expect(
      validatePreviewArtifactManifest({
        manifestBytes: bytes,
        objectKey,
        expectedStoreId: storeId,
        expectedJobId: jobId,
        expectedArtifactRefId: artifactRefId,
        expectedDigest: digest,
        expectedSizeBytes: 17,
        expectedManifestDigest,
        maxBytes: 1_024,
        retentionPolicy,
      }),
    ).toEqual({
      storeId,
      jobId,
      artifactRefId,
      digest,
      sizeBytes: 17,
      manifestDigest: expectedManifestDigest,
      retentionPolicy,
    });
  });

  it("rejects a manifest whose job, reference, content, or store differs", () => {
    for (const input of [
      { expectedJobId: "fcebc599-15a8-47a1-a772-4f53bc5ee98f" },
      { expectedArtifactRefId: "fcebc599-15a8-47a1-a772-4f53bc5ee98f" },
      { expectedDigest: "b".repeat(64) },
      { expectedSizeBytes: 18 },
      { expectedStoreId: "94cc6266-181a-44f9-90f8-bdd21ebcc748" },
    ]) {
      expect(() =>
        validatePreviewArtifactManifest({
          manifestBytes: manifestBytes(),
          objectKey,
          expectedStoreId: storeId,
          maxBytes: 1_024,
          retentionPolicy,
          ...input,
        }),
      ).toThrow(PreviewArtifactManifestError);
    }
  });

  it("rejects noncanonical or oversized manifests", () => {
    const extraProperty = manifestBytes({ unexpected: true });
    const overLimit = manifestBytes();
    expect(() =>
      validatePreviewArtifactManifest({
        manifestBytes: extraProperty,
        objectKey,
        expectedStoreId: storeId,
        maxBytes: 1_024,
        retentionPolicy,
      }),
    ).toThrow(PreviewArtifactManifestError);
    expect(() =>
      validatePreviewArtifactManifest({
        manifestBytes: overLimit,
        objectKey,
        expectedStoreId: storeId,
        maxBytes: 16,
        retentionPolicy,
      }),
    ).toThrow(PreviewArtifactManifestError);
  });
});
