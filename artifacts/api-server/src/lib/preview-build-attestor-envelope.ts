import { HeadObjectCommand, PutObjectCommand } from "@aws-sdk/client-s3";

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const TASK_ARN_PATTERN =
  /^arn:(aws|aws-us-gov|aws-cn):ecs:[a-z0-9-]+:\d{12}:task\/[A-Za-z0-9_-]+\/[a-f0-9]{32}$/i;
const MAX_ENVELOPE_BYTES = 32_768;
const MAX_VALUE_LENGTH = 8_192;

export type PreviewBuildAttestorEnvelopeStore = {
  put(input: {
    jobId: string;
    fingerprint: string;
    values: { token: string; builderTaskArn: string };
  }): Promise<{ value: string }>;
};

export class PreviewBuildAttestorEnvelopeError extends Error {
  constructor() {
    super("Preview Attestor command envelope is unavailable.");
    this.name = "PreviewBuildAttestorEnvelopeError";
  }
}

function isConditionalWriteConflict(error: unknown): boolean {
  return (
    !!error &&
    typeof error === "object" &&
    "name" in error &&
    (error.name === "PreconditionFailed" ||
      error.name === "ConditionalRequestConflict" ||
      ("$metadata" in error &&
        !!error.$metadata &&
        typeof error.$metadata === "object" &&
        "httpStatusCode" in error.$metadata &&
        (error.$metadata.httpStatusCode === 409 ||
          error.$metadata.httpStatusCode === 412)))
  );
}

export function createS3PreviewBuildAttestorEnvelopeStore(input: {
  client: { send(command: unknown): Promise<unknown> };
  bucketName: string;
  region: string;
}): PreviewBuildAttestorEnvelopeStore {
  const bucketName = input.bucketName.trim();
  const region = input.region.trim();
  if (
    !/^[a-z0-9][a-z0-9.-]{1,61}[a-z0-9]$/.test(bucketName) ||
    bucketName.includes("..") ||
    !/^[a-z0-9-]+$/i.test(region)
  ) {
    throw new PreviewBuildAttestorEnvelopeError();
  }
  const partition = region.startsWith("cn-")
    ? "aws-cn"
    : region.startsWith("us-gov-")
      ? "aws-us-gov"
      : "aws";

  return {
    async put({ jobId, fingerprint, values }) {
      if (
        !UUID_PATTERN.test(jobId) ||
        !/^[a-f0-9]{64}$/i.test(fingerprint) ||
        typeof values?.token !== "string" ||
        values.token.length < 1 ||
        values.token.length > MAX_VALUE_LENGTH ||
        typeof values.builderTaskArn !== "string" ||
        !TASK_ARN_PATTERN.test(values.builderTaskArn) ||
        [values.token, values.builderTaskArn].some(
          (value) => value.includes("\n") || value.includes("\r"),
        )
      ) {
        throw new PreviewBuildAttestorEnvelopeError();
      }

      const key = `attestor-command-envelopes/${jobId}.env`;
      const body = Buffer.from(
        [
          `PREVIEW_ATTESTOR_JOB_TOKEN=${values.token}`,
          `PREVIEW_ATTESTOR_BUILDER_TASK_ARN=${values.builderTaskArn}`,
          "",
        ].join("\n"),
        "utf8",
      );
      if (body.length > MAX_ENVELOPE_BYTES) {
        throw new PreviewBuildAttestorEnvelopeError();
      }

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
            Metadata: { "job-fingerprint": fingerprint.toLowerCase() },
            IfNoneMatch: "*",
          }),
        );
      } catch (error) {
        if (!isConditionalWriteConflict(error)) {
          throw new PreviewBuildAttestorEnvelopeError();
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
            existing.Metadata?.["job-fingerprint"] !==
              fingerprint.toLowerCase() ||
            !Number.isSafeInteger(existing.ContentLength) ||
            (existing.ContentLength ?? 0) < 1 ||
            (existing.ContentLength ?? 0) > MAX_ENVELOPE_BYTES ||
            existing.ServerSideEncryption !== "AES256"
          ) {
            throw new PreviewBuildAttestorEnvelopeError();
          }
        } catch {
          throw new PreviewBuildAttestorEnvelopeError();
        }
      }
      return {
        value: `arn:${partition}:s3:::${bucketName}/${key}`,
      };
    },
  };
}
