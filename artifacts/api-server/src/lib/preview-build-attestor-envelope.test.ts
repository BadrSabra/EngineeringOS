import { HeadObjectCommand, PutObjectCommand } from "@aws-sdk/client-s3";
import { describe, expect, it, vi } from "vitest";
import {
  createS3PreviewBuildAttestorEnvelopeStore,
  PreviewBuildAttestorEnvelopeError,
} from "./preview-build-attestor-envelope.js";

const jobId = "9c99a591-cf7f-4f18-8c4b-08e53ca1e4aa";
const fingerprint = "a".repeat(64);
const builderTaskArn =
  "arn:aws:ecs:eu-central-1:123456789012:task/preview/abcdef0123456789abcdef0123456789";

describe("S3 Preview Attestor command envelope", () => {
  it("writes one encrypted conditional env file with only signed identity inputs", async () => {
    const send = vi.fn(async (_command: unknown) => ({}));
    const store = createS3PreviewBuildAttestorEnvelopeStore({
      client: { send },
      bucketName: "preview-artifacts",
      region: "eu-central-1",
    });
    await expect(
      store.put({
        jobId,
        fingerprint,
        values: { token: "signed.token", builderTaskArn },
      }),
    ).resolves.toEqual({
      value: `arn:aws:s3:::preview-artifacts/attestor-command-envelopes/${jobId}.env`,
    });
    const command = send.mock.calls[0]?.[0] as PutObjectCommand;
    expect(command).toBeInstanceOf(PutObjectCommand);
    expect(command.input).toMatchObject({
      Key: `attestor-command-envelopes/${jobId}.env`,
      ServerSideEncryption: "AES256",
      CacheControl: "no-store",
      IfNoneMatch: "*",
      Metadata: { "job-fingerprint": fingerprint },
    });
    expect((command.input.Body as Buffer).toString("utf8")).toBe(
      [
        "PREVIEW_ATTESTOR_JOB_TOKEN=signed.token",
        `PREVIEW_ATTESTOR_BUILDER_TASK_ARN=${builderTaskArn}`,
        "",
      ].join("\n"),
    );
  });

  it("reuses the immutable envelope only for the same launch fingerprint", async () => {
    const send = vi
      .fn()
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
    const store = createS3PreviewBuildAttestorEnvelopeStore({
      client: { send },
      bucketName: "preview-artifacts",
      region: "eu-central-1",
    });
    await expect(
      store.put({
        jobId,
        fingerprint,
        values: { token: "fresh.signature", builderTaskArn },
      }),
    ).resolves.toEqual({
      value: `arn:aws:s3:::preview-artifacts/attestor-command-envelopes/${jobId}.env`,
    });
    expect(send.mock.calls[1]?.[0]).toBeInstanceOf(HeadObjectCommand);
  });

  it("rejects newline injection and malformed Builder task identities", async () => {
    const send = vi.fn();
    const store = createS3PreviewBuildAttestorEnvelopeStore({
      client: { send },
      bucketName: "preview-artifacts",
      region: "eu-central-1",
    });
    for (const values of [
      { token: "signed\nINJECTED=x", builderTaskArn },
      { token: "signed.token", builderTaskArn: "not-an-arn" },
    ]) {
      await expect(
        store.put({ jobId, fingerprint, values }),
      ).rejects.toBeInstanceOf(PreviewBuildAttestorEnvelopeError);
    }
    expect(send).not.toHaveBeenCalled();
  });
});
