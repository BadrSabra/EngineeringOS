import { isIP } from "node:net";
import {
  signPreviewBuildJob,
  type PreviewBuildJobClaims,
} from "./preview-build-job.js";

const BUILD_PATH = "/internal/v1/preview/builds";
const REQUEST_TIMEOUT_MS = 20_000;
const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const TASK_ARN_PATTERN =
  /^arn:(aws|aws-us-gov|aws-cn):ecs:[a-z0-9-]+:\d{12}:task\/[A-Za-z0-9_-]+\/[a-f0-9]{32}$/i;

export class PreviewBuilderGatewayClientError extends Error {
  constructor(
    readonly code:
      | "PREVIEW_BUILDER_GATEWAY_URL_INVALID"
      | "PREVIEW_BUILDER_GATEWAY_KEY_MISSING"
      | "PREVIEW_BUILDER_GATEWAY_JOB_INVALID"
      | "PREVIEW_BUILDER_GATEWAY_UNAVAILABLE"
      | "PREVIEW_BUILDER_GATEWAY_RESPONSE_INVALID",
  ) {
    super("Preview Builder Gateway request failed.");
    this.name = "PreviewBuilderGatewayClientError";
  }
}

function builderEndpoint(value: string): URL {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new PreviewBuilderGatewayClientError(
      "PREVIEW_BUILDER_GATEWAY_URL_INVALID",
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
    throw new PreviewBuilderGatewayClientError(
      "PREVIEW_BUILDER_GATEWAY_URL_INVALID",
    );
  }

  return new URL(BUILD_PATH, url);
}

function parseLaunchResponse(
  payload: unknown,
  expected: Pick<PreviewBuildJobClaims, "jobId" | "buildId">,
): { jobId: string; buildId: string; executionRef: string } {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    throw new PreviewBuilderGatewayClientError(
      "PREVIEW_BUILDER_GATEWAY_RESPONSE_INVALID",
    );
  }
  const response = payload as Record<string, unknown>;
  if (
    Object.keys(response).length !== 3 ||
    response.jobId !== expected.jobId ||
    response.buildId !== expected.buildId ||
    typeof response.taskArn !== "string" ||
    !TASK_ARN_PATTERN.test(response.taskArn)
  ) {
    throw new PreviewBuilderGatewayClientError(
      "PREVIEW_BUILDER_GATEWAY_RESPONSE_INVALID",
    );
  }
  return {
    jobId: expected.jobId,
    buildId: expected.buildId,
    executionRef: response.taskArn,
  };
}

export async function dispatchPreviewBuilderJob(input: {
  gatewayUrl: string | undefined;
  privateKeyPem: string | undefined;
  claims: PreviewBuildJobClaims;
  fetcher?: typeof fetch;
  now?: Date;
}): Promise<{ jobId: string; buildId: string; executionRef: string }> {
  if (!input.privateKeyPem) {
    throw new PreviewBuilderGatewayClientError(
      "PREVIEW_BUILDER_GATEWAY_KEY_MISSING",
    );
  }
  if (!input.gatewayUrl) {
    throw new PreviewBuilderGatewayClientError(
      "PREVIEW_BUILDER_GATEWAY_URL_INVALID",
    );
  }
  if (
    !UUID_PATTERN.test(input.claims.jobId) ||
    !UUID_PATTERN.test(input.claims.buildId)
  ) {
    throw new PreviewBuilderGatewayClientError(
      "PREVIEW_BUILDER_GATEWAY_JOB_INVALID",
    );
  }

  const url = builderEndpoint(input.gatewayUrl);
  let token: string;
  try {
    token = signPreviewBuildJob({
      claims: input.claims,
      privateKeyPem: input.privateKeyPem,
      now: input.now,
    });
  } catch {
    throw new PreviewBuilderGatewayClientError(
      "PREVIEW_BUILDER_GATEWAY_JOB_INVALID",
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
    if (response.status !== 202) {
      throw new PreviewBuilderGatewayClientError(
        "PREVIEW_BUILDER_GATEWAY_UNAVAILABLE",
      );
    }

    let payload: unknown;
    try {
      payload = await response.json();
    } catch {
      throw new PreviewBuilderGatewayClientError(
        "PREVIEW_BUILDER_GATEWAY_RESPONSE_INVALID",
      );
    }
    return parseLaunchResponse(payload, input.claims);
  } catch (error) {
    if (error instanceof PreviewBuilderGatewayClientError) throw error;
    throw new PreviewBuilderGatewayClientError(
      "PREVIEW_BUILDER_GATEWAY_UNAVAILABLE",
    );
  } finally {
    clearTimeout(timeout);
  }
}
