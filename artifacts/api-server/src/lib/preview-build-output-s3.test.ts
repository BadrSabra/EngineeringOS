import { createHash } from "node:crypto";
import { GetObjectCommand, HeadObjectCommand } from "@aws-sdk/client-s3";
import { describe, expect, it, vi } from "vitest";
import {
  createS3PreviewBuildOutputUrlProvider,
  PreviewBuildOutputError,
} from "./preview-build-output-s3.js";

const bucketName = "engineeringos-preview-artifacts";
const region = "eu-central-1";
const objectKey =
  "preview-build-outputs/9c99a591-cf7f-4f18-8c4b-08e53ca1e4aa/g1/site.tar.gz";
const bytes = Buffer.from("static output archive");
const sha256 = createHash("sha256").update(bytes).digest("hex");
const checksum = Buffer.from(sha256, "hex").toString("base64");
const signedUrl = `https://${bucketName}.s3.${region}.amazonaws.com/${objectKey}?X-Amz-Algorithm=AWS4-HMAC-SHA256&X-Amz-Expires=300&X-Amz-Signature=${"a".repeat(64)}`;

describe("Preview build-output URL provider", () => {
  it("checks the immutable output checksum and size before presigning only that object", async () => {
    const send = vi.fn(async (_command: unknown) => ({
      ContentLength: bytes.length,
      ChecksumSHA256: checksum,
    }));
    const presign = vi.fn(
      async (_command: GetObjectCommand, _expiresInSeconds: number) =>
        signedUrl,
    );
    const provider = createS3PreviewBuildOutputUrlProvider({
      client: { send },
      bucketName,
      region,
      presign,
    });

    await expect(
      provider.createDownloadUrl({ objectKey, sha256 }),
    ).resolves.toBe(signedUrl);
    expect(send).toHaveBeenCalledOnce();
    expect(send.mock.calls[0]?.[0]).toBeInstanceOf(HeadObjectCommand);
    expect((send.mock.calls[0]?.[0] as HeadObjectCommand).input).toMatchObject({
      Bucket: bucketName,
      Key: objectKey,
      ChecksumMode: "ENABLED",
    });
    expect(presign).toHaveBeenCalledOnce();
    expect(presign.mock.calls[0]?.[0]).toBeInstanceOf(GetObjectCommand);
    expect(
      (presign.mock.calls[0]?.[0] as GetObjectCommand).input,
    ).toMatchObject({
      Bucket: bucketName,
      Key: objectKey,
    });
    expect(presign.mock.calls[0]?.[1]).toBe(300);
  });

  it("fails closed on a missing, oversized, or checksum-mismatched object", async () => {
    for (const head of [
      {},
      { ContentLength: 50 * 1024 * 1024 + 1, ChecksumSHA256: checksum },
      { ContentLength: bytes.length, ChecksumSHA256: "wrong" },
    ]) {
      const presign = vi.fn(async () => signedUrl);
      const provider = createS3PreviewBuildOutputUrlProvider({
        client: { send: async () => head },
        bucketName,
        region,
        presign,
      });
      await expect(
        provider.createDownloadUrl({ objectKey, sha256 }),
      ).rejects.toMatchObject({
        code: "PREVIEW_BUILD_OUTPUT_UNAVAILABLE",
      });
      expect(presign).not.toHaveBeenCalled();
    }
  });

  it("rejects invalid object scope and any presigned URL outside the exact S3 host", async () => {
    const presign = vi.fn(async () =>
      signedUrl.replace(
        `${bucketName}.s3.${region}.amazonaws.com`,
        "169.254.169.254",
      ),
    );
    const provider = createS3PreviewBuildOutputUrlProvider({
      client: {
        send: async () => ({
          ContentLength: bytes.length,
          ChecksumSHA256: checksum,
        }),
      },
      bucketName,
      region,
      presign,
    });

    await expect(
      provider.createDownloadUrl({
        objectKey: "build-inputs/other.zip",
        sha256,
      }),
    ).rejects.toBeInstanceOf(PreviewBuildOutputError);
    expect(presign).not.toHaveBeenCalled();

    await expect(
      provider.createDownloadUrl({ objectKey, sha256 }),
    ).rejects.toMatchObject({ code: "PREVIEW_BUILD_OUTPUT_UNAVAILABLE" });
  });
});
