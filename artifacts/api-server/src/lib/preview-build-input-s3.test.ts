import { createHash } from "node:crypto";
import { HeadObjectCommand, PutObjectCommand } from "@aws-sdk/client-s3";
import { describe, expect, it, vi } from "vitest";
import { createS3PreviewBuildInputObjectStore } from "./preview-build-input-s3.js";
import { previewBuildArtifactRefId } from "./preview-artifact-reference.js";

const bucketName = "engineeringos-preview-artifacts";
const jobId = "00000000-0000-8000-8000-000000000001";
const artifactRefId = previewBuildArtifactRefId(jobId, "input");

describe("Preview build-input S3 object store", () => {
  it("writes only content-addressed build inputs with a checksum and no overwrite", async () => {
    const archive = Buffer.from("immutable archive");
    const archiveDigest = createHash("sha256").update(archive).digest("hex");
    const send = vi.fn(async (_command: unknown) => ({}));
    const store = createS3PreviewBuildInputObjectStore({
      client: { send },
      bucketName,
    });

    await store.put({
      jobId,
      artifactRefId,
      objectKey: `build-inputs/${"a".repeat(64)}/${archiveDigest}.zip`,
      archive,
      archiveDigest,
      contentLength: archive.length,
    });

    expect(send).toHaveBeenCalledOnce();
    const command = send.mock.calls[0]?.[0] as PutObjectCommand;
    expect(command.input).toMatchObject({
      Bucket: bucketName,
      Key: `build-inputs/${"a".repeat(64)}/${archiveDigest}.zip`,
      Body: archive,
      ContentLength: archive.length,
      ContentType: "application/zip",
      ChecksumSHA256: Buffer.from(archiveDigest, "hex").toString("base64"),
      IfNoneMatch: "*",
      ServerSideEncryption: "AES256",
    });
  });

  it("accepts a retry only when the existing object has the exact length and checksum", async () => {
    const archive = Buffer.from("immutable archive");
    const archiveDigest = createHash("sha256").update(archive).digest("hex");
    const expectedChecksum = Buffer.from(archiveDigest, "hex").toString(
      "base64",
    );
    const send = vi
      .fn(async (_command: unknown) => ({}))
      .mockRejectedValueOnce(
        Object.assign(new Error("conditional write"), {
          $metadata: { httpStatusCode: 412 },
        }),
      )
      .mockResolvedValueOnce({
        ContentLength: archive.length,
        ChecksumSHA256: expectedChecksum,
      });
    const store = createS3PreviewBuildInputObjectStore({
      client: { send },
      bucketName,
    });

    await expect(
      store.put({
        jobId,
        artifactRefId,
        objectKey: `build-inputs/${"a".repeat(64)}/${archiveDigest}.zip`,
        archive,
        archiveDigest,
        contentLength: archive.length,
      }),
    ).resolves.toBeUndefined();
    expect(send).toHaveBeenCalledTimes(2);
    expect(send.mock.calls[1]?.[0]).toBeInstanceOf(HeadObjectCommand);
  });

  it("rejects invalid bucket names and keys before making AWS requests", async () => {
    const send = vi.fn(async (_command: unknown) => ({}));
    expect(() =>
      createS3PreviewBuildInputObjectStore({
        client: { send },
        bucketName: "bad..bucket",
      }),
    ).toThrow("bucket configuration is invalid");

    const store = createS3PreviewBuildInputObjectStore({
      client: { send },
      bucketName,
    });
    await expect(
      store.put({
        jobId,
        artifactRefId,
        objectKey: "build-inputs/../../other/object.zip",
        archive: Buffer.from("x"),
        archiveDigest: "0".repeat(64),
        contentLength: 1,
      }),
    ).rejects.toThrow("Preview build-input object is invalid.");
    expect(send).not.toHaveBeenCalled();
  });
});
