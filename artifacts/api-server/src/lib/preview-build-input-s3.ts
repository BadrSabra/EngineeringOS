import { HeadObjectCommand, PutObjectCommand } from "@aws-sdk/client-s3";
import type { PreviewBuildInputObjectStore } from "./preview-build-upload.js";

export type PreviewS3CommandClient = {
  send(command: unknown): Promise<unknown>;
};

function sendCommand(
  client: PreviewS3CommandClient,
  command: unknown,
): Promise<unknown> {
  return client.send(command as never);
}

function conditionalWriteConflict(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  const record = error as {
    name?: unknown;
    $metadata?: { httpStatusCode?: unknown };
  };
  return (
    record.name === "PreconditionFailed" ||
    record.name === "ConditionalRequestConflict" ||
    record.$metadata?.httpStatusCode === 409 ||
    record.$metadata?.httpStatusCode === 412
  );
}

export function createS3PreviewBuildInputObjectStore(input: {
  client: PreviewS3CommandClient;
  bucketName: string;
}): PreviewBuildInputObjectStore {
  const expectedBucket = input.bucketName.trim();
  if (
    !/^[a-z0-9][a-z0-9.-]{1,61}[a-z0-9]$/.test(expectedBucket) ||
    expectedBucket.includes("..")
  ) {
    throw new Error("Preview build-input bucket configuration is invalid.");
  }
  return {
    async put({ objectKey, archive, archiveDigest, contentLength }) {
      if (
        !/^build-inputs\/[a-f0-9]{64}\/[a-f0-9]{64}\.zip$/i.test(objectKey) ||
        !/^[a-f0-9]{64}$/i.test(archiveDigest) ||
        !Buffer.isBuffer(archive) ||
        archive.length !== contentLength
      ) {
        throw new Error("Preview build-input object is invalid.");
      }
      const checksumSha256 = Buffer.from(archiveDigest, "hex").toString(
        "base64",
      );
      try {
        await sendCommand(
          input.client,
          new PutObjectCommand({
            Bucket: expectedBucket,
            Key: objectKey,
            Body: archive,
            ContentLength: contentLength,
            ContentType: "application/zip",
            ChecksumSHA256: checksumSha256,
            IfNoneMatch: "*",
            ServerSideEncryption: "AES256",
          }),
        );
      } catch (error) {
        if (!conditionalWriteConflict(error)) throw error;
        const response = (await sendCommand(
          input.client,
          new HeadObjectCommand({
            Bucket: expectedBucket,
            Key: objectKey,
            ChecksumMode: "ENABLED",
          }),
        )) as {
          ContentLength?: number;
          ChecksumSHA256?: string;
        };
        if (
          response.ContentLength !== contentLength ||
          response.ChecksumSHA256 !== checksumSha256
        ) {
          throw new Error("Preview build-input object binding conflicts.");
        }
      }
    },
  };
}
