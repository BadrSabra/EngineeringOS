import type { PreviewBuildJob } from "@workspace/db";
import {
  signPreviewBuildJob,
  type PreviewBuildJobClaims,
} from "./preview-build-job.js";

const MAX_REQUEST_BYTES = 16_384;
const MAX_RESPONSE_BYTES = 16_384;
const ATTEST_PATH = "/internal/v1/preview/builds/attest";

export type PreviewBuildAttestorResult =
  | { jobId: string; buildId: string; state: "pending" }
  | { jobId: string; buildId: string; state: "failed" }
  | {
      jobId: string;
      buildId: string;
      state: "ready";
      receiptToken: string;
    };

export class PreviewBuildAttestorClientError extends Error {
  constructor() {
    super("Preview Attestor is unavailable.");
    this.name = "PreviewBuildAttestorClientError";
  }
}

function parseResponse(
  value: unknown,
  expected: { jobId: string; buildId: string },
): PreviewBuildAttestorResult {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new PreviewBuildAttestorClientError();
  }
  const record = value as Record<string, unknown>;
  if (
    record.jobId !== expected.jobId ||
    record.buildId !== expected.buildId ||
    (record.state !== "pending" &&
      record.state !== "ready" &&
      record.state !== "failed")
  ) {
    throw new PreviewBuildAttestorClientError();
  }
  if (record.state === "ready") {
    if (
      Object.keys(record).length !== 4 ||
      typeof record.receiptToken !== "string" ||
      record.receiptToken.length < 1 ||
      record.receiptToken.length > 8_192 ||
      !/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/.test(record.receiptToken)
    ) {
      throw new PreviewBuildAttestorClientError();
    }
    return {
      jobId: expected.jobId,
      buildId: expected.buildId,
      state: "ready",
      receiptToken: record.receiptToken,
    };
  }
  if (Object.keys(record).length !== 3 || "receiptToken" in record) {
    throw new PreviewBuildAttestorClientError();
  }
  return {
    jobId: expected.jobId,
    buildId: expected.buildId,
    state: record.state,
  };
}

async function readBoundedResponseText(response: Response): Promise<string> {
  const contentLength = Number(response.headers.get("content-length"));
  if (Number.isFinite(contentLength) && contentLength > MAX_RESPONSE_BYTES) {
    throw new PreviewBuildAttestorClientError();
  }
  if (!response.body) throw new PreviewBuildAttestorClientError();
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > MAX_RESPONSE_BYTES) {
        await reader.cancel();
        throw new PreviewBuildAttestorClientError();
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  return Buffer.concat(chunks).toString("utf8");
}

function claimsForJob(job: PreviewBuildJob, now: Date): PreviewBuildJobClaims {
  const issuedAt = now.toISOString();
  const expiresAt = new Date(now.getTime() + 5 * 60_000).toISOString();
  return {
    version: 2,
    action: "preview-build",
    jobId: job.jobId,
    attemptId: job.jobId,
    idempotencyKey: job.clientRequestId,
    dispatchGeneration: job.dispatchGeneration,
    buildId: job.buildId,
    builderProfile: "vite-react-static-v1",
    builderImageDigest: job.builderImageDigest,
    projectId: job.projectId,
    proposalId: job.proposalId,
    operationId: job.operationId,
    proposalRevision: job.proposalRevision,
    candidateRevision: job.candidateRevision,
    changeSetHash: job.changeSetHash,
    sourceRoot: job.sourceRoot,
    sourceDigest: job.sourceDigest,
    inputArtifactKey: job.inputArtifactKey,
    archiveDigest: job.archiveDigest,
    outputArtifactKey: job.outputArtifactKey,
    issuedAt,
    expiresAt,
  };
}

export async function attestPreviewBuildJob(input: {
  gatewayUrl: string;
  privateKeyPem: string;
  job: PreviewBuildJob;
  executionRef: string;
  now?: Date;
  fetcher?: typeof fetch;
}): Promise<PreviewBuildAttestorResult> {
  if (
    input.job.status !== "builder_succeeded" ||
    !input.job.executionRef ||
    input.job.executionRef !== input.executionRef ||
    !/^arn:(aws|aws-us-gov|aws-cn):ecs:[a-z0-9-]+:\d{12}:task\/[A-Za-z0-9_-]+\/[a-f0-9]{32}$/i.test(
      input.executionRef,
    )
  ) {
    throw new PreviewBuildAttestorClientError();
  }
  let gatewayUrl: URL;
  try {
    gatewayUrl = new URL(input.gatewayUrl);
  } catch {
    throw new PreviewBuildAttestorClientError();
  }
  if (
    gatewayUrl.protocol !== "https:" ||
    gatewayUrl.username ||
    gatewayUrl.password ||
    gatewayUrl.search ||
    gatewayUrl.hash ||
    gatewayUrl.pathname !== "/"
  ) {
    throw new PreviewBuildAttestorClientError();
  }

  const now = input.now ?? new Date();
  let token: string;
  try {
    token = signPreviewBuildJob({
      claims: claimsForJob(input.job, now),
      privateKeyPem: input.privateKeyPem,
      now,
    });
  } catch {
    throw new PreviewBuildAttestorClientError();
  }
  const body = JSON.stringify({
    token,
    builderTaskArn: input.executionRef,
  });
  if (Buffer.byteLength(body, "utf8") > MAX_REQUEST_BYTES) {
    throw new PreviewBuildAttestorClientError();
  }

  const fetcher = input.fetcher ?? fetch;
  let response: Response;
  try {
    response = await fetcher(new URL(ATTEST_PATH, gatewayUrl), {
      method: "POST",
      headers: {
        "content-type": "application/json",
        accept: "application/json",
      },
      body,
      cache: "no-store",
      redirect: "error",
      signal: AbortSignal.timeout(20_000),
    });
  } catch {
    throw new PreviewBuildAttestorClientError();
  }
  if (response.status !== 200 && response.status !== 202) {
    throw new PreviewBuildAttestorClientError();
  }
  if (
    response.headers
      .get("content-type")
      ?.split(";", 1)[0]
      ?.trim()
      .toLowerCase() !== "application/json"
  ) {
    throw new PreviewBuildAttestorClientError();
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(await readBoundedResponseText(response));
  } catch {
    throw new PreviewBuildAttestorClientError();
  }
  return parseResponse(parsed, {
    jobId: input.job.jobId,
    buildId: input.job.buildId,
  });
}
