import {
  GetObjectCommand,
  HeadObjectCommand,
  PutObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { createHash } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import {
  createS3PreviewBuildTransferProvider,
  PreviewBuildTransferError,
} from "./preview-build-transfer-s3.js";

const bucketName = "engineeringos-preview-artifacts";
const region = "eu-central-1";
const buildId = "9c99a591-cf7f-4f18-8c4b-08e53ca1e4aa";
const inputDigest = "a".repeat(64);
const inputObjectKey = `build-inputs/${"b".repeat(64)}/${inputDigest}.zip`;
const outputObjectKey = `preview-build-outputs/${buildId}/site.tar.gz`;
const checksum = Buffer.from(inputDigest, "hex").toString("base64");
const outputBytes = Buffer.from("independently observed output");
const outputDigest = createHash("sha256").update(outputBytes).digest("hex");
const inputUrl =
  `https://${bucketName}.s3.${region}.amazonaws.com/${inputObjectKey}` +
  `?X-Amz-Algorithm=AWS4-HMAC-SHA256&X-Amz-Expires=300&` +
  `X-Amz-SignedHeaders=host&X-Amz-Signature=${"c".repeat(64)}`;
const outputUrl =
  `https://${bucketName}.s3.${region}.amazonaws.com/${outputObjectKey}` +
  `?X-Amz-Algorithm=AWS4-HMAC-SHA256&X-Amz-Expires=300&` +
  `X-Amz-SignedHeaders=host%3Bif-none-match&X-Amz-Signature=${"d".repeat(64)}`;

describe("Preview build transfer URLs", () => {
  it("hashes the exact bounded encrypted S3 output bytes independently", async () => {
    const send = vi.fn(async (command: unknown) => {
      if (command instanceof HeadObjectCommand) {
        return {
          ContentLength: outputBytes.length,
          ServerSideEncryption: "AES256",
        };
      }
      return {
        Body: (async function* () {
          yield outputBytes;
        })(),
      };
    });
    const provider = createS3PreviewBuildTransferProvider({
      client: { send },
      bucketName,
      region,
      presign: async () => inputUrl,
    });

    await expect(
      provider.inspectOutput?.({
        buildId,
        outputArtifactKey: outputObjectKey,
      }),
    ).resolves.toEqual({
      outputDigest,
      contentLength: outputBytes.length,
    });
    expect(send).toHaveBeenCalledTimes(2);
    expect(send.mock.calls[0]?.[0]).toBeInstanceOf(HeadObjectCommand);
    expect((send.mock.calls[0]?.[0] as HeadObjectCommand).input).toMatchObject({
      Bucket: bucketName,
      Key: outputObjectKey,
    });
    expect(send.mock.calls[1]?.[0]).toBeInstanceOf(GetObjectCommand);
  });

  it("does not treat a missing or incomplete output checksum as build success", async () => {
    const missing = createS3PreviewBuildTransferProvider({
      client: {
        send: async () => {
          throw Object.assign(new Error("missing"), {
            name: "NotFound",
            $metadata: { httpStatusCode: 404 },
          });
        },
      },
      bucketName,
      region,
      presign: async () => inputUrl,
    });
    await expect(
      missing.inspectOutput?.({
        buildId,
        outputArtifactKey: outputObjectKey,
      }),
    ).resolves.toBeNull();

    const incomplete = createS3PreviewBuildTransferProvider({
      client: {
        send: async () => ({
          ContentLength: outputBytes.length,
          ServerSideEncryption: "aws:kms",
        }),
      },
      bucketName,
      region,
      presign: async () => inputUrl,
    });
    await expect(
      incomplete.inspectOutput?.({
        buildId,
        outputArtifactKey: outputObjectKey,
      }),
    ).resolves.toBeNull();
  });

  it("verifies the immutable encrypted input before issuing one-shot transfer URLs", async () => {
    const send = vi.fn(async (_command: unknown) => ({
      ContentLength: 1024,
      ChecksumSHA256: checksum,
      ServerSideEncryption: "AES256",
    }));
    const presign = vi.fn(
      async (command: GetObjectCommand | PutObjectCommand) =>
        command instanceof GetObjectCommand ? inputUrl : outputUrl,
    );
    const provider = createS3PreviewBuildTransferProvider({
      client: { send },
      bucketName,
      region,
      presign,
    });

    await expect(
      provider.createTransfer({
        inputObjectKey,
        inputArchiveDigest: inputDigest,
        buildId,
      }),
    ).resolves.toEqual({
      inputDownloadUrl: inputUrl,
      outputUploadUrl: outputUrl,
      outputArtifactKey: outputObjectKey,
      outputUploadHeaders: { "If-None-Match": "*" },
    });
    expect(send).toHaveBeenCalledOnce();
    expect(send.mock.calls[0]?.[0]).toBeInstanceOf(HeadObjectCommand);
    expect((send.mock.calls[0]?.[0] as HeadObjectCommand).input).toMatchObject({
      Bucket: bucketName,
      Key: inputObjectKey,
      ChecksumMode: "ENABLED",
    });
    expect(presign).toHaveBeenCalledTimes(2);
    expect(presign.mock.calls[0]?.[0]).toBeInstanceOf(GetObjectCommand);
    expect(
      (presign.mock.calls[0]?.[0] as GetObjectCommand).input,
    ).toMatchObject({
      Bucket: bucketName,
      Key: inputObjectKey,
    });
    expect(presign.mock.calls[1]?.[0]).toBeInstanceOf(PutObjectCommand);
    expect(
      (presign.mock.calls[1]?.[0] as PutObjectCommand).input,
    ).toMatchObject({
      Bucket: bucketName,
      Key: outputObjectKey,
      IfNoneMatch: "*",
    });
  });

  it.each([
    {
      label: "checksum mismatch",
      head: {
        ContentLength: 10,
        ChecksumSHA256: "wrong",
        ServerSideEncryption: "AES256",
      },
    },
    {
      label: "unencrypted object",
      head: {
        ContentLength: 10,
        ChecksumSHA256: checksum,
        ServerSideEncryption: undefined,
      },
    },
    {
      label: "oversized object",
      head: {
        ContentLength: 55 * 1024 * 1024 + 1,
        ChecksumSHA256: checksum,
        ServerSideEncryption: "AES256",
      },
    },
  ])("fails closed on $label without issuing URLs", async ({ head }) => {
    const presign = vi.fn(async () => inputUrl);
    const provider = createS3PreviewBuildTransferProvider({
      client: { send: async () => head },
      bucketName,
      region,
      presign,
    });

    await expect(
      provider.createTransfer({
        inputObjectKey,
        inputArchiveDigest: inputDigest,
        buildId,
      }),
    ).rejects.toBeInstanceOf(PreviewBuildTransferError);
    expect(presign).not.toHaveBeenCalled();
  });

  it("rejects mismatched input digest and malformed output URLs", async () => {
    const presign = vi
      .fn()
      .mockResolvedValueOnce(inputUrl)
      .mockResolvedValueOnce(outputUrl.replace(outputObjectKey, "other.zip"));
    const provider = createS3PreviewBuildTransferProvider({
      client: {
        send: async () => ({
          ContentLength: 10,
          ChecksumSHA256: checksum,
          ServerSideEncryption: "AES256",
        }),
      },
      bucketName,
      region,
      presign,
    });

    await expect(
      provider.createTransfer({
        inputObjectKey,
        inputArchiveDigest: "e".repeat(64),
        buildId,
      }),
    ).rejects.toMatchObject({ code: "PREVIEW_BUILD_TRANSFER_INVALID" });
    expect(presign).not.toHaveBeenCalled();

    await expect(
      provider.createTransfer({
        inputObjectKey,
        inputArchiveDigest: inputDigest,
        buildId,
      }),
    ).rejects.toMatchObject({ code: "PREVIEW_BUILD_TRANSFER_UNAVAILABLE" });
  });

  it("produces AWS SDK signatures that bind the upload to If-None-Match", async () => {
    const signingClient = new S3Client({
      region,
      credentials: {
        accessKeyId: "test-access",
        secretAccessKey: "test-secret",
      },
    });
    try {
      const provider = createS3PreviewBuildTransferProvider({
        client: {
          send: async () => ({
            ContentLength: 10,
            ChecksumSHA256: checksum,
            ServerSideEncryption: "AES256",
          }),
        },
        bucketName,
        region,
        presign: (command, expiresInSeconds) =>
          getSignedUrl(signingClient, command, {
            expiresIn: expiresInSeconds,
          }),
      });

      const transfer = await provider.createTransfer({
        inputObjectKey,
        inputArchiveDigest: inputDigest,
        buildId,
      });
      const outputUrl = new URL(transfer.outputUploadUrl);
      expect(outputUrl.searchParams.get("X-Amz-SignedHeaders")).toContain(
        "if-none-match",
      );
      expect(outputUrl.searchParams.get("X-Amz-Expires")).toBe("300");
      expect(decodeURIComponent(outputUrl.pathname.slice(1))).toBe(
        outputObjectKey,
      );
    } finally {
      signingClient.destroy();
    }
  });
});
