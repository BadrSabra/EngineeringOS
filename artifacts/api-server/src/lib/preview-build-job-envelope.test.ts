import { HeadObjectCommand, PutObjectCommand } from "@aws-sdk/client-s3";
import { describe, expect, it, vi } from "vitest";
import {
  createS3PreviewBuildJobEnvelopeStore,
  PreviewBuildJobEnvelopeError,
} from "./preview-build-job-envelope.js";

const jobId = "9c99a591-cf7f-4f18-8c4b-08e53ca1e4aa";
const values = {
  token: "header.payload.signature",
  inputDownloadUrl:
    "https://preview-artifacts.s3.eu-central-1.amazonaws.com/build-inputs/source.zip?X-Amz-Signature=abc%3D&X-Amz-Expires=300",
  outputUploadUrl:
    "https://preview-artifacts.s3.eu-central-1.amazonaws.com/preview-build-outputs/build/site.tar.gz?X-Amz-Signature=def%3D&X-Amz-Expires=300",
};

describe("S3 Builder job environment envelope", () => {
  it("writes one encrypted, conditional env file and returns only its opaque ARN", async () => {
    const send = vi.fn(async (_command: unknown) => ({}));
    const fingerprint = "a".repeat(64);
    const store = createS3PreviewBuildJobEnvelopeStore({
      client: { send },
      bucketName: "preview-artifacts",
      region: "eu-central-1",
    });

    await expect(store.put({ jobId, fingerprint, values })).resolves.toEqual({
      value: `arn:aws:s3:::preview-artifacts/builder-job-envelopes/${jobId}.env`,
    });
    const command = send.mock.calls[0]?.[0];
    expect(command).toBeInstanceOf(PutObjectCommand);
    expect((command as PutObjectCommand).input).toMatchObject({
      Bucket: "preview-artifacts",
      Key: `builder-job-envelopes/${jobId}.env`,
      ContentType: "text/plain; charset=utf-8",
      CacheControl: "no-store",
      ServerSideEncryption: "AES256",
      IfNoneMatch: "*",
      Metadata: { "job-fingerprint": fingerprint },
    });
    expect(
      ((command as PutObjectCommand).input.Body as Buffer).toString("utf8"),
    ).toBe(
      [
        `PREVIEW_BUILD_JOB_TOKEN=${values.token}`,
        `PREVIEW_BUILD_INPUT_URL=${values.inputDownloadUrl}`,
        `PREVIEW_BUILD_OUTPUT_URL=${values.outputUploadUrl}`,
        "",
      ].join("\n"),
    );
  });

  it("rejects newline injection before writing the envelope", async () => {
    const send = vi.fn(async (_command: unknown) => ({}));
    const store = createS3PreviewBuildJobEnvelopeStore({
      client: { send },
      bucketName: "preview-artifacts",
      region: "eu-central-1",
    });

    await expect(
      store.put({
        jobId,
        fingerprint: "a".repeat(64),
        values: { ...values, token: "valid\nINJECTED=value" },
      }),
    ).rejects.toBeInstanceOf(PreviewBuildJobEnvelopeError);
    expect(send).not.toHaveBeenCalled();
  });

  it("rejects oversized signed transfer values before writing", async () => {
    const send = vi.fn(async (_command: unknown) => ({}));
    const store = createS3PreviewBuildJobEnvelopeStore({
      client: { send },
      bucketName: "preview-artifacts",
      region: "eu-central-1",
    });

    await expect(
      store.put({
        jobId,
        fingerprint: "a".repeat(64),
        values: { ...values, inputDownloadUrl: `https://${"x".repeat(8_192)}` },
      }),
    ).rejects.toBeInstanceOf(PreviewBuildJobEnvelopeError);
    expect(send).not.toHaveBeenCalled();
  });

  it("rejects invalid job identities before writing", async () => {
    const send = vi.fn(async (_command: unknown) => ({}));
    const store = createS3PreviewBuildJobEnvelopeStore({
      client: { send },
      bucketName: "preview-artifacts",
      region: "eu-central-1",
    });

    await expect(
      store.put({
        jobId: "../other-job",
        fingerprint: "a".repeat(64),
        values,
      }),
    ).rejects.toBeInstanceOf(PreviewBuildJobEnvelopeError);
    expect(send).not.toHaveBeenCalled();
  });

  it("reuses an existing envelope only when its S3 metadata matches the job fingerprint", async () => {
    const fingerprint = "a".repeat(64);
    const send = vi
      .fn()
      .mockResolvedValueOnce({})
      .mockRejectedValueOnce(
        Object.assign(new Error("already exists"), {
          name: "PreconditionFailed",
        }),
      )
      .mockResolvedValueOnce({
        Metadata: { "job-fingerprint": fingerprint },
        ContentLength: 512,
        ServerSideEncryption: "AES256",
      });
    const store = createS3PreviewBuildJobEnvelopeStore({
      client: { send },
      bucketName: "preview-artifacts",
      region: "eu-central-1",
    });

    await store.put({ jobId, values, fingerprint });
    await expect(store.put({ jobId, values, fingerprint })).resolves.toEqual({
      value: `arn:aws:s3:::preview-artifacts/builder-job-envelopes/${jobId}.env`,
    });
    expect(send.mock.calls[0]?.[0]).toBeInstanceOf(PutObjectCommand);
    expect(
      (send.mock.calls[0]?.[0] as PutObjectCommand).input.Metadata,
    ).toEqual({ "job-fingerprint": fingerprint });
    expect(send.mock.calls[2]?.[0]).toBeInstanceOf(HeadObjectCommand);
  });

  it("rejects reuse if the existing envelope belongs to another job payload", async () => {
    const send = vi
      .fn()
      .mockRejectedValueOnce(
        Object.assign(new Error("already exists"), {
          name: "PreconditionFailed",
        }),
      )
      .mockResolvedValueOnce({
        Metadata: { "job-fingerprint": "b".repeat(64) },
        ContentLength: 512,
        ServerSideEncryption: "AES256",
      });
    const store = createS3PreviewBuildJobEnvelopeStore({
      client: { send },
      bucketName: "preview-artifacts",
      region: "eu-central-1",
    });

    await expect(
      store.put({ jobId, values, fingerprint: "a".repeat(64) }),
    ).rejects.toBeInstanceOf(PreviewBuildJobEnvelopeError);
  });
});
