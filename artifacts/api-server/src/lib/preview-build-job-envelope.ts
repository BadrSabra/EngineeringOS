import { HeadObjectCommand, PutObjectCommand } from "@aws-sdk/client-s3";

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const MAX_VALUE_LENGTH = 8_192;
const MAX_ENVELOPE_BYTES = 32_768;

export type PreviewBuildJobEnvelopeValues = {
  token: string;
  inputDownloadUrl: string;
  outputUploadUrl: string;
};

export type PreviewBuildJobEnvelopeStore = {
  put(input: {
    jobId: string;
    fingerprint: string;
    values: PreviewBuildJobEnvelopeValues;
  }): Promise<{ value: string }>;
};

export class PreviewBuildJobEnvelopeError extends Error {
  constructor() {
    super("Preview build job envelope is unavailable.");
    this.name = "PreviewBuildJobEnvelopeError";
  }
}

function environmentFile(values: PreviewBuildJobEnvelopeValues): Buffer {
  for (const value of Object.values(values)) {
    if (
      !value ||
      value.length > MAX_VALUE_LENGTH ||
      value.includes("\n") ||
      value.includes("\r")
    ) {
      throw new PreviewBuildJobEnvelopeError();
    }
  }
  const body = Buffer.from(
    [
      `PREVIEW_BUILD_JOB_TOKEN=${values.token}`,
      `PREVIEW_BUILD_INPUT_URL=${values.inputDownloadUrl}`,
      `PREVIEW_BUILD_OUTPUT_URL=${values.outputUploadUrl}`,
      "",
    ].join("\n"),
    "utf8",
  );
  if (body.length > MAX_ENVELOPE_BYTES) {
    throw new PreviewBuildJobEnvelopeError();
  }
  return body;
}

function isConditionalWriteConflict(error: unknown): boolean {
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

export function createS3PreviewBuildJobEnvelopeStore(input: {
  client: { send(command: unknown): Promise<unknown> };
  bucketName: string;
  region: string;
}): PreviewBuildJobEnvelopeStore {
  const bucketName = input.bucketName.trim();
  const region = input.region.trim();
  if (
    !/^[a-z0-9][a-z0-9.-]{1,61}[a-z0-9]$/.test(bucketName) ||
    bucketName.includes("..") ||
    !/^[a-z0-9-]+$/i.test(region)
  ) {
    throw new PreviewBuildJobEnvelopeError();
  }
  const partition = region.startsWith("cn-")
    ? "aws-cn"
    : region.startsWith("us-gov-")
      ? "aws-us-gov"
      : "aws";

  return {
    async put({ jobId, fingerprint, values }) {
      if (!UUID_PATTERN.test(jobId) || !/^[a-f0-9]{64}$/i.test(fingerprint)) {
        throw new PreviewBuildJobEnvelopeError();
      }
      const key = `builder-job-envelopes/${jobId}.env`;
      const body = environmentFile(values);
      try {
        await input.client.send(
          new PutObjectCommand({
            Bucket: bucketName,
            Key: key,
            Body: body,
            ContentLength: body.length,
            ContentType: "text/plain; charset=utf-8",
            CacheControl: "no-store",
            ServerSideEncryption: "AES256",
            Metadata: { "job-fingerprint": fingerprint },
            IfNoneMatch: "*",
          }),
        );
      } catch (error) {
        if (!isConditionalWriteConflict(error)) {
          throw new PreviewBuildJobEnvelopeError();
        }
        try {
          const existing = (await input.client.send(
            new HeadObjectCommand({ Bucket: bucketName, Key: key }),
          )) as {
            Metadata?: Record<string, string>;
            ContentLength?: number;
            ServerSideEncryption?: string;
          };
          if (
            existing.Metadata?.["job-fingerprint"] !== fingerprint ||
            !Number.isSafeInteger(existing.ContentLength) ||
            (existing.ContentLength ?? 0) < 1 ||
            (existing.ContentLength ?? 0) > MAX_ENVELOPE_BYTES ||
            existing.ServerSideEncryption !== "AES256"
          ) {
            throw new PreviewBuildJobEnvelopeError();
          }
        } catch {
          throw new PreviewBuildJobEnvelopeError();
        }
      }
      return { value: `arn:${partition}:s3:::${bucketName}/${key}` };
    },
  };
}
