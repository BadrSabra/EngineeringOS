import { isIP } from "node:net";
import type { PreviewBuildJob } from "@workspace/db";
import {
  signPreviewBuildObservation,
  type PreviewBuildObservationClaims,
} from "./preview-build-observation-command.js";

const OBSERVATION_PATH = "/internal/v1/preview/builds/reconcile";
const REQUEST_TIMEOUT_MS = 8_000;
const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const TASK_ARN_PATTERN =
  /^arn:(aws|aws-us-gov|aws-cn):ecs:[a-z0-9-]+:\d{12}:task\/[A-Za-z0-9_-]+\/[a-f0-9]{32}$/i;
const SHA256_PATTERN = /^[a-f0-9]{64}$/i;

export type PreviewBuildObservation = {
  jobId: string;
  buildId: string;
  state: "not_found" | "pending" | "running" | "stopped" | "unknown";
  executionRef?: string;
  exitCode?: number;
  outputDigest?: string;
};

export class PreviewBuildObservationClientError extends Error {
  constructor(
    readonly code:
      | "PREVIEW_BUILD_OBSERVATION_GATEWAY_INVALID"
      | "PREVIEW_BUILD_OBSERVATION_KEY_MISSING"
      | "PREVIEW_BUILD_OBSERVATION_REQUEST_INVALID"
      | "PREVIEW_BUILD_OBSERVATION_UNAVAILABLE"
      | "PREVIEW_BUILD_OBSERVATION_RESPONSE_INVALID",
  ) {
    super("Preview build observation request failed.");
    this.name = "PreviewBuildObservationClientError";
  }
}

function observationEndpoint(value: string): URL {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new PreviewBuildObservationClientError(
      "PREVIEW_BUILD_OBSERVATION_GATEWAY_INVALID",
    );
  }
  const hostname = url.hostname.toLowerCase();
  if (
    url.protocol !== "https:" ||
    url.username ||
    url.password ||
    url.pathname !== "/" ||
    url.search ||
    url.hash ||
    hostname === "localhost" ||
    hostname.endsWith(".localhost") ||
    hostname.endsWith(".local") ||
    hostname.endsWith(".internal") ||
    isIP(hostname) !== 0
  ) {
    throw new PreviewBuildObservationClientError(
      "PREVIEW_BUILD_OBSERVATION_GATEWAY_INVALID",
    );
  }
  return new URL(OBSERVATION_PATH, url);
}

function claimsForJob(
  job: PreviewBuildJob,
  now: Date,
): PreviewBuildObservationClaims {
  const claims: PreviewBuildObservationClaims = {
    version: 1,
    action: "preview-build-observe",
    jobId: job.jobId,
    buildId: job.buildId,
    builderImageDigest: job.builderImageDigest,
    outputArtifactKey: job.outputArtifactKey,
    ...(job.executionRef ? { taskArn: job.executionRef } : {}),
    issuedAt: now.toISOString(),
    expiresAt: new Date(now.getTime() + 20_000).toISOString(),
  };
  if (!UUID_PATTERN.test(claims.jobId) || !UUID_PATTERN.test(claims.buildId)) {
    throw new PreviewBuildObservationClientError(
      "PREVIEW_BUILD_OBSERVATION_REQUEST_INVALID",
    );
  }
  return claims;
}

function parseObservation(
  payload: unknown,
  job: PreviewBuildJob,
): PreviewBuildObservation {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    throw new PreviewBuildObservationClientError(
      "PREVIEW_BUILD_OBSERVATION_RESPONSE_INVALID",
    );
  }
  const value = payload as Record<string, unknown>;
  const allowed = [
    "jobId",
    "buildId",
    "state",
    "taskArn",
    "exitCode",
    "outputDigest",
  ];
  if (
    Object.keys(value).some((key) => !allowed.includes(key)) ||
    value.jobId !== job.jobId ||
    value.buildId !== job.buildId ||
    !["not_found", "pending", "running", "stopped", "unknown"].includes(
      String(value.state),
    ) ||
    (value.taskArn !== undefined &&
      (typeof value.taskArn !== "string" ||
        !TASK_ARN_PATTERN.test(value.taskArn))) ||
    (value.exitCode !== undefined &&
      (!Number.isSafeInteger(value.exitCode) ||
        typeof value.exitCode !== "number")) ||
    (value.outputDigest !== undefined &&
      (typeof value.outputDigest !== "string" ||
        !SHA256_PATTERN.test(value.outputDigest)))
  ) {
    throw new PreviewBuildObservationClientError(
      "PREVIEW_BUILD_OBSERVATION_RESPONSE_INVALID",
    );
  }
  const state = value.state as PreviewBuildObservation["state"];
  if (
    (state === "pending" || state === "running" || state === "stopped") &&
    !value.taskArn
  ) {
    throw new PreviewBuildObservationClientError(
      "PREVIEW_BUILD_OBSERVATION_RESPONSE_INVALID",
    );
  }
  if (
    job.executionRef &&
    value.taskArn !== undefined &&
    value.taskArn !== job.executionRef
  ) {
    throw new PreviewBuildObservationClientError(
      "PREVIEW_BUILD_OBSERVATION_RESPONSE_INVALID",
    );
  }
  if (value.exitCode !== undefined && state !== "stopped") {
    throw new PreviewBuildObservationClientError(
      "PREVIEW_BUILD_OBSERVATION_RESPONSE_INVALID",
    );
  }
  if (
    value.outputDigest !== undefined &&
    (state !== "stopped" || value.exitCode !== 0)
  ) {
    throw new PreviewBuildObservationClientError(
      "PREVIEW_BUILD_OBSERVATION_RESPONSE_INVALID",
    );
  }
  if (
    state === "not_found" &&
    (value.taskArn !== undefined ||
      value.exitCode !== undefined ||
      value.outputDigest !== undefined)
  ) {
    throw new PreviewBuildObservationClientError(
      "PREVIEW_BUILD_OBSERVATION_RESPONSE_INVALID",
    );
  }
  return {
    jobId: job.jobId,
    buildId: job.buildId,
    state,
    ...(typeof value.taskArn === "string"
      ? { executionRef: value.taskArn }
      : {}),
    ...(typeof value.exitCode === "number" ? { exitCode: value.exitCode } : {}),
    ...(typeof value.outputDigest === "string"
      ? { outputDigest: value.outputDigest.toLowerCase() }
      : {}),
  };
}

export async function observePreviewBuildJob(input: {
  gatewayUrl: string | undefined;
  privateKeyPem: string | undefined;
  job: PreviewBuildJob;
  fetcher?: typeof fetch;
  now?: Date;
}): Promise<PreviewBuildObservation> {
  if (!input.privateKeyPem) {
    throw new PreviewBuildObservationClientError(
      "PREVIEW_BUILD_OBSERVATION_KEY_MISSING",
    );
  }
  if (!input.gatewayUrl) {
    throw new PreviewBuildObservationClientError(
      "PREVIEW_BUILD_OBSERVATION_GATEWAY_INVALID",
    );
  }
  const url = observationEndpoint(input.gatewayUrl);
  const now = input.now ?? new Date();
  let token: string;
  try {
    token = signPreviewBuildObservation({
      claims: claimsForJob(input.job, now),
      privateKeyPem: input.privateKeyPem,
      now,
    });
  } catch {
    throw new PreviewBuildObservationClientError(
      "PREVIEW_BUILD_OBSERVATION_REQUEST_INVALID",
    );
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const response = await (input.fetcher ?? fetch)(url, {
      method: "POST",
      redirect: "error",
      credentials: "omit",
      cache: "no-store",
      signal: controller.signal,
      headers: {
        "content-type": "application/json",
        accept: "application/json",
      },
      body: JSON.stringify({ token }),
    });
    if (response.status !== 200) {
      throw new PreviewBuildObservationClientError(
        "PREVIEW_BUILD_OBSERVATION_UNAVAILABLE",
      );
    }
    let payload: unknown;
    try {
      payload = await response.json();
    } catch {
      throw new PreviewBuildObservationClientError(
        "PREVIEW_BUILD_OBSERVATION_RESPONSE_INVALID",
      );
    }
    return parseObservation(payload, input.job);
  } catch (error) {
    if (error instanceof PreviewBuildObservationClientError) throw error;
    throw new PreviewBuildObservationClientError(
      "PREVIEW_BUILD_OBSERVATION_UNAVAILABLE",
    );
  } finally {
    clearTimeout(timeout);
  }
}
