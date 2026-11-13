import { GetObjectCommand, HeadObjectCommand } from "@aws-sdk/client-s3";
import { isPreviewBuildOutputArtifactKey } from "./preview-build-output-key.js";

const SHA256_PATTERN = /^[a-f0-9]{64}$/i;
const MAX_OUTPUT_BYTES = 32 * 1024 * 1024;
const SIGNED_URL_TTL_SECONDS = 300;

export type PreviewBuildOutputIdentity = {
  objectKey: string;
  sha256: string;
};

export type PreviewBuildOutputUrlProvider = {
  createDownloadUrl(identity: PreviewBuildOutputIdentity): Promise<string>;
};

export type PreviewBuildOutputS3Client = {
  send(command: unknown): Promise<unknown>;
};

export class PreviewBuildOutputError extends Error {
  constructor(
    readonly code:
      "PREVIEW_BUILD_OUTPUT_INVALID" | "PREVIEW_BUILD_OUTPUT_UNAVAILABLE",
  ) {
    super("Preview build output is invalid or unavailable.");
    this.name = "PreviewBuildOutputError";
  }
}

function bucketHost(bucketName: string, region: string): string {
  const suffix = region.startsWith("cn-")
    ? "amazonaws.com.cn"
    : "amazonaws.com";
  return `${bucketName}.s3.${region}.${suffix}`;
}

function validateIdentity(identity: PreviewBuildOutputIdentity): void {
  if (
    !isPreviewBuildOutputArtifactKey(identity.objectKey) ||
    !SHA256_PATTERN.test(identity.sha256)
  ) {
    throw new PreviewBuildOutputError("PREVIEW_BUILD_OUTPUT_INVALID");
  }
}

function validateSignedUrl(
  value: string,
  expectedBucketHost: string,
  objectKey: string,
): string {
  try {
    const url = new URL(value);
    const signedLifetime = Number(url.searchParams.get("X-Amz-Expires"));
    if (
      value.length > 8_192 ||
      url.protocol !== "https:" ||
      url.hostname !== expectedBucketHost ||
      url.username ||
      url.password ||
      url.hash ||
      decodeURIComponent(url.pathname.slice(1)) !== objectKey ||
      url.searchParams.get("X-Amz-Algorithm") !== "AWS4-HMAC-SHA256" ||
      !/^[a-f0-9]{64}$/i.test(url.searchParams.get("X-Amz-Signature") ?? "") ||
      !Number.isInteger(signedLifetime) ||
      signedLifetime < 1 ||
      signedLifetime > SIGNED_URL_TTL_SECONDS
    ) {
      throw new Error("Invalid presigned URL.");
    }
    return value;
  } catch {
    throw new PreviewBuildOutputError("PREVIEW_BUILD_OUTPUT_UNAVAILABLE");
  }
}

export function createS3PreviewBuildOutputUrlProvider(input: {
  client: PreviewBuildOutputS3Client;
  bucketName: string;
  region: string;
  presign(command: GetObjectCommand, expiresInSeconds: number): Promise<string>;
}): PreviewBuildOutputUrlProvider {
  const bucketName = input.bucketName.trim();
  const region = input.region.trim();
  if (
    !/^[a-z0-9][a-z0-9.-]{1,61}[a-z0-9]$/.test(bucketName) ||
    bucketName.includes("..") ||
    !/^[a-z0-9-]+$/.test(region)
  ) {
    throw new PreviewBuildOutputError("PREVIEW_BUILD_OUTPUT_INVALID");
  }

  return {
    async createDownloadUrl(identity) {
      validateIdentity(identity);
      let head: {
        ContentLength?: number;
        ChecksumSHA256?: string;
      };
      try {
        head = (await input.client.send(
          new HeadObjectCommand({
            Bucket: bucketName,
            Key: identity.objectKey,
            ChecksumMode: "ENABLED",
          }),
        )) as typeof head;
      } catch {
        throw new PreviewBuildOutputError("PREVIEW_BUILD_OUTPUT_UNAVAILABLE");
      }

      const expectedChecksum = Buffer.from(identity.sha256, "hex").toString(
        "base64",
      );
      if (
        !Number.isSafeInteger(head.ContentLength) ||
        (head.ContentLength as number) < 1 ||
        (head.ContentLength as number) > MAX_OUTPUT_BYTES ||
        head.ChecksumSHA256 !== expectedChecksum
      ) {
        throw new PreviewBuildOutputError("PREVIEW_BUILD_OUTPUT_UNAVAILABLE");
      }

      try {
        const signedUrl = await input.presign(
          new GetObjectCommand({
            Bucket: bucketName,
            Key: identity.objectKey,
          }),
          SIGNED_URL_TTL_SECONDS,
        );
        return validateSignedUrl(
          signedUrl,
          bucketHost(bucketName, region),
          identity.objectKey,
        );
      } catch (error) {
        if (error instanceof PreviewBuildOutputError) throw error;
        throw new PreviewBuildOutputError("PREVIEW_BUILD_OUTPUT_UNAVAILABLE");
      }
    },
  };
}
