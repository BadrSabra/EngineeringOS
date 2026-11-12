import { createHash } from "node:crypto";
import {
  GetObjectCommand,
  HeadObjectCommand,
  PutObjectCommand,
} from "@aws-sdk/client-s3";

const INPUT_KEY_PATTERN =
  /^build-inputs\/([a-f0-9]{64})\/([a-f0-9]{64})\.zip$/i;
const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const SHA256_PATTERN = /^[a-f0-9]{64}$/i;
const MAX_INPUT_BYTES = 55 * 1024 * 1024;
const MAX_OUTPUT_BYTES = 32 * 1024 * 1024;
const SIGNED_URL_TTL_SECONDS = 300;

export type PreviewBuildTransferIdentity = {
  inputObjectKey: string;
  inputArchiveDigest: string;
  buildId: string;
};

export type PreviewBuildTransfer = {
  inputDownloadUrl: string;
  outputUploadUrl: string;
  outputArtifactKey: string;
  outputUploadHeaders: { "If-None-Match": "*" };
};

export type PreviewBuildTransferProvider = {
  createTransfer(
    identity: PreviewBuildTransferIdentity,
  ): Promise<PreviewBuildTransfer>;
  inspectOutput?(identity: {
    buildId: string;
    outputArtifactKey: string;
  }): Promise<{ outputDigest: string; contentLength: number } | null>;
};

export type PreviewBuildTransferS3Client = {
  send(command: unknown): Promise<unknown>;
};

export class PreviewBuildTransferError extends Error {
  constructor(
    readonly code:
      "PREVIEW_BUILD_TRANSFER_INVALID" | "PREVIEW_BUILD_TRANSFER_UNAVAILABLE",
  ) {
    super("Preview build transfer is invalid or unavailable.");
    this.name = "PreviewBuildTransferError";
  }
}

function bucketHost(bucketName: string, region: string): string {
  const suffix = region.startsWith("cn-")
    ? "amazonaws.com.cn"
    : "amazonaws.com";
  return `${bucketName}.s3.${region}.${suffix}`;
}

function validateIdentity(identity: PreviewBuildTransferIdentity): void {
  const keyMatch = INPUT_KEY_PATTERN.exec(identity.inputObjectKey);
  if (
    !keyMatch ||
    !SHA256_PATTERN.test(identity.inputArchiveDigest) ||
    keyMatch[2]?.toLowerCase() !== identity.inputArchiveDigest.toLowerCase() ||
    !UUID_PATTERN.test(identity.buildId)
  ) {
    throw new PreviewBuildTransferError("PREVIEW_BUILD_TRANSFER_INVALID");
  }
}

function validatePresignedUrl(input: {
  value: string;
  bucketName: string;
  region: string;
  objectKey: string;
  method: "GET" | "PUT";
}): void {
  try {
    const url = new URL(input.value);
    const signedHeaders = url.searchParams
      .get("X-Amz-SignedHeaders")
      ?.toLowerCase()
      .split(";");
    const expiry = Number(url.searchParams.get("X-Amz-Expires"));
    if (
      url.protocol !== "https:" ||
      url.hostname !== bucketHost(input.bucketName, input.region) ||
      decodeURIComponent(url.pathname.slice(1)) !== input.objectKey ||
      url.searchParams.get("X-Amz-Algorithm") !== "AWS4-HMAC-SHA256" ||
      !/^[a-f0-9]{64}$/i.test(url.searchParams.get("X-Amz-Signature") ?? "") ||
      !Number.isInteger(expiry) ||
      expiry < 1 ||
      expiry > SIGNED_URL_TTL_SECONDS ||
      !signedHeaders?.includes("host") ||
      (input.method === "PUT" && !signedHeaders.includes("if-none-match"))
    ) {
      throw new Error("Invalid scoped S3 URL.");
    }
  } catch {
    throw new PreviewBuildTransferError("PREVIEW_BUILD_TRANSFER_UNAVAILABLE");
  }
}

export function createS3PreviewBuildTransferProvider(input: {
  client: PreviewBuildTransferS3Client;
  bucketName: string;
  region: string;
  presign(
    command: GetObjectCommand | PutObjectCommand,
    expiresInSeconds: number,
  ): Promise<string>;
}): PreviewBuildTransferProvider {
  const bucketName = input.bucketName.trim();
  const region = input.region.trim();
  if (
    !/^[a-z0-9][a-z0-9.-]{1,61}[a-z0-9]$/.test(bucketName) ||
    bucketName.includes("..") ||
    !/^[a-z0-9-]+$/i.test(region)
  ) {
    throw new PreviewBuildTransferError("PREVIEW_BUILD_TRANSFER_INVALID");
  }

  return {
    async inspectOutput(identity) {
      if (
        !UUID_PATTERN.test(identity.buildId) ||
        identity.outputArtifactKey !==
          `preview-build-outputs/${identity.buildId}/site.tar.gz`
      ) {
        throw new PreviewBuildTransferError("PREVIEW_BUILD_TRANSFER_INVALID");
      }
      let head: {
        ContentLength?: number;
        ServerSideEncryption?: string;
      };
      try {
        head = (await input.client.send(
          new HeadObjectCommand({
            Bucket: bucketName,
            Key: identity.outputArtifactKey,
          }),
        )) as typeof head;
      } catch (error) {
        const record = error as {
          name?: string;
          $metadata?: { httpStatusCode?: number };
        };
        if (
          record.$metadata?.httpStatusCode === 404 ||
          record.name === "NotFound" ||
          record.name === "NoSuchKey"
        ) {
          return null;
        }
        throw new PreviewBuildTransferError(
          "PREVIEW_BUILD_TRANSFER_UNAVAILABLE",
        );
      }
      if (
        !Number.isSafeInteger(head.ContentLength) ||
        (head.ContentLength ?? 0) < 1 ||
        (head.ContentLength ?? 0) > MAX_OUTPUT_BYTES ||
        head.ServerSideEncryption !== "AES256"
      ) {
        return null;
      }
      let output: unknown;
      try {
        output = await input.client.send(
          new GetObjectCommand({
            Bucket: bucketName,
            Key: identity.outputArtifactKey,
          }),
        );
      } catch (error) {
        const record = error as {
          name?: string;
          $metadata?: { httpStatusCode?: number };
        };
        if (
          record.$metadata?.httpStatusCode === 404 ||
          record.name === "NotFound" ||
          record.name === "NoSuchKey"
        ) {
          return null;
        }
        throw new PreviewBuildTransferError(
          "PREVIEW_BUILD_TRANSFER_UNAVAILABLE",
        );
      }
      const body =
        output && typeof output === "object"
          ? (output as Record<string, unknown>).Body
          : undefined;
      if (
        !body ||
        typeof body !== "object" ||
        !(Symbol.asyncIterator in body)
      ) {
        return null;
      }
      const hash = createHash("sha256");
      let contentLength = 0;
      try {
        for await (const chunk of body as AsyncIterable<Uint8Array>) {
          if (!(chunk instanceof Uint8Array)) return null;
          contentLength += chunk.byteLength;
          if (contentLength > MAX_OUTPUT_BYTES) {
            const destroy = (body as { destroy?: () => void }).destroy;
            destroy?.call(body);
            return null;
          }
          hash.update(chunk);
        }
      } catch {
        throw new PreviewBuildTransferError(
          "PREVIEW_BUILD_TRANSFER_UNAVAILABLE",
        );
      }
      if (contentLength !== head.ContentLength) return null;
      return {
        outputDigest: hash.digest("hex"),
        contentLength,
      };
    },
    async createTransfer(identity) {
      validateIdentity(identity);
      const outputArtifactKey = `preview-build-outputs/${identity.buildId}/site.tar.gz`;
      try {
        const head = (await input.client.send(
          new HeadObjectCommand({
            Bucket: bucketName,
            Key: identity.inputObjectKey,
            ChecksumMode: "ENABLED",
          }),
        )) as {
          ContentLength?: number;
          ChecksumSHA256?: string;
          ServerSideEncryption?: string;
        };
        const expectedChecksum = Buffer.from(
          identity.inputArchiveDigest,
          "hex",
        ).toString("base64");
        if (
          !Number.isSafeInteger(head.ContentLength) ||
          (head.ContentLength ?? 0) < 1 ||
          (head.ContentLength ?? 0) > MAX_INPUT_BYTES ||
          head.ChecksumSHA256 !== expectedChecksum ||
          head.ServerSideEncryption !== "AES256"
        ) {
          throw new PreviewBuildTransferError(
            "PREVIEW_BUILD_TRANSFER_UNAVAILABLE",
          );
        }

        const inputDownloadUrl = await input.presign(
          new GetObjectCommand({
            Bucket: bucketName,
            Key: identity.inputObjectKey,
          }),
          SIGNED_URL_TTL_SECONDS,
        );
        validatePresignedUrl({
          value: inputDownloadUrl,
          bucketName,
          region,
          objectKey: identity.inputObjectKey,
          method: "GET",
        });

        const outputUploadUrl = await input.presign(
          new PutObjectCommand({
            Bucket: bucketName,
            Key: outputArtifactKey,
            IfNoneMatch: "*",
          }),
          SIGNED_URL_TTL_SECONDS,
        );
        validatePresignedUrl({
          value: outputUploadUrl,
          bucketName,
          region,
          objectKey: outputArtifactKey,
          method: "PUT",
        });
        return {
          inputDownloadUrl,
          outputUploadUrl,
          outputArtifactKey,
          outputUploadHeaders: { "If-None-Match": "*" },
        };
      } catch (error) {
        if (error instanceof PreviewBuildTransferError) throw error;
        throw new PreviewBuildTransferError(
          "PREVIEW_BUILD_TRANSFER_UNAVAILABLE",
        );
      }
    },
  };
}
