import {
  GetObjectCommand,
  HeadObjectCommand,
  ListObjectsV2Command,
} from "@aws-sdk/client-s3";
import { Readable } from "node:stream";
import { describe, expect, it, vi } from "vitest";
import { createS3PreviewBuildAttestorReceiptStore } from "./preview-build-attestor-receipt-store.js";

const jobId = "9c99a591-cf7f-4f18-8c4b-08e53ca1e4aa";
const buildId = "a9328405-57f6-44ce-8f4a-880647cd00dd";
const receiptId = "b9328405-57f6-44ce-8f4a-880647cd00ee";
const token = "eyJ4IjoxfQ.signature";
const key = `preview-build-receipts/${jobId}/${receiptId}.json`;
const body = Buffer.from(JSON.stringify({ jobId, buildId, receiptId, token }));

describe("S3 Preview Attestor receipt transport", () => {
  it("returns only one encrypted receipt token for the exact job and build", async () => {
    const send = vi
      .fn()
      .mockResolvedValueOnce({ Contents: [{ Key: key }], IsTruncated: false })
      .mockResolvedValueOnce({
        ContentLength: body.length,
        ServerSideEncryption: "AES256",
      })
      .mockResolvedValueOnce({ Body: Readable.from([body]) });
    const store = createS3PreviewBuildAttestorReceiptStore({
      client: { send },
      bucketName: "preview-artifacts",
    });

    await expect(store.read({ jobId, buildId })).resolves.toBe(token);
    expect(send.mock.calls[0]?.[0]).toBeInstanceOf(ListObjectsV2Command);
    expect(
      (send.mock.calls[0]?.[0] as ListObjectsV2Command).input,
    ).toMatchObject({
      Bucket: "preview-artifacts",
      Prefix: `preview-build-receipts/${jobId}/`,
      MaxKeys: 2,
    });
    expect(send.mock.calls[1]?.[0]).toBeInstanceOf(HeadObjectCommand);
    expect(send.mock.calls[2]?.[0]).toBeInstanceOf(GetObjectCommand);
  });

  it("returns null when no receipt exists", async () => {
    const send = vi.fn(async () => ({ Contents: [] }));
    const store = createS3PreviewBuildAttestorReceiptStore({
      client: { send },
      bucketName: "preview-artifacts",
    });
    await expect(store.read({ jobId, buildId })).resolves.toBeNull();
    expect(send).toHaveBeenCalledOnce();
  });

  it("fails closed when multiple, unencrypted, oversized, or mismatched receipts exist", async () => {
    const invalidCases: Array<{
      listing: unknown;
      head?: unknown;
      get?: unknown;
    }> = [
      {
        listing: { Contents: [{ Key: key }, { Key: `${key}.extra` }] },
      },
      {
        listing: { Contents: [{ Key: key }] },
        head: {
          ContentLength: body.length,
          ServerSideEncryption: "aws:kms",
        },
      },
      {
        listing: { Contents: [{ Key: key }] },
        head: {
          ContentLength: 20_000,
          ServerSideEncryption: "AES256",
        },
      },
      {
        listing: { Contents: [{ Key: key }] },
        head: {
          ContentLength: body.length,
          ServerSideEncryption: "AES256",
        },
        get: {
          Body: Readable.from([
            Buffer.from(
              JSON.stringify({ jobId, buildId: "other", receiptId, token }),
            ),
          ]),
        },
      },
    ];
    for (const invalid of invalidCases) {
      const send = vi
        .fn()
        .mockResolvedValueOnce(invalid.listing)
        .mockResolvedValueOnce(invalid.head)
        .mockResolvedValueOnce(invalid.get);
      const store = createS3PreviewBuildAttestorReceiptStore({
        client: { send },
        bucketName: "preview-artifacts",
      });
      await expect(store.read({ jobId, buildId })).rejects.toThrow(
        "Preview Attestor receipt is unavailable.",
      );
    }
  });
});
