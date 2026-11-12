import type { PreviewBuildAttestorFence } from "./preview-build-attestor-fence.js";
import type { PreviewBuildAttestorEnvelopeStore } from "./preview-build-attestor-envelope.js";
import {
  executePreviewBuildAttestorJob,
  type PreviewBuildAttestorRunnerConfig,
} from "./preview-build-attestor-runner.js";
import type { PreviewEcsClient } from "./preview-ecs-runner.js";

const ATTEST_PATH = "/internal/v1/preview/builds/attest";
const MAX_BODY_BYTES = 16_384;
const REQUEST_FIELDS = ["token", "builderTaskArn"] as const;

export type PreviewBuildAttestorReceiptStore = {
  read(input: { jobId: string; buildId: string }): Promise<string | null>;
};

export type PreviewBuildAttestorHandlerDependencies = {
  ecs: PreviewEcsClient;
  fence: PreviewBuildAttestorFence;
  envelopeStore: PreviewBuildAttestorEnvelopeStore;
  receiptStore: PreviewBuildAttestorReceiptStore;
  config: PreviewBuildAttestorRunnerConfig;
  now?: () => Date;
  execute?: typeof executePreviewBuildAttestorJob;
};

function jsonResponse(status: number, body: Record<string, unknown>): Response {
  return Response.json(body, {
    status,
    headers: {
      "cache-control": "no-store",
      "x-content-type-options": "nosniff",
    },
  });
}

async function readBoundedJson(request: Request): Promise<unknown> {
  if (
    request.headers.get("content-type")?.toLowerCase() !== "application/json" ||
    Number(request.headers.get("content-length")) > MAX_BODY_BYTES ||
    !request.body
  ) {
    throw new Error("Invalid attestor request.");
  }
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > MAX_BODY_BYTES) {
        await reader.cancel();
        throw new Error("Attestor request is too large.");
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  return JSON.parse(Buffer.concat(chunks).toString("utf8"));
}

function parseRequest(
  value: unknown,
): { token: string; builderTaskArn: string } | null {
  if (
    !value ||
    typeof value !== "object" ||
    Array.isArray(value) ||
    Object.keys(value).length !== REQUEST_FIELDS.length ||
    REQUEST_FIELDS.some((field) => !(field in value))
  ) {
    return null;
  }
  const record = value as Record<string, unknown>;
  if (
    typeof record.token !== "string" ||
    record.token.length < 1 ||
    record.token.length > 8_192 ||
    typeof record.builderTaskArn !== "string" ||
    !/^arn:(aws|aws-us-gov|aws-cn):ecs:[a-z0-9-]+:\d{12}:task\/[A-Za-z0-9_-]+\/[a-f0-9]{32}$/i.test(
      record.builderTaskArn,
    )
  ) {
    return null;
  }
  return {
    token: record.token,
    builderTaskArn: record.builderTaskArn,
  };
}

export function createPreviewBuildAttestorHandler(
  dependencies: PreviewBuildAttestorHandlerDependencies,
) {
  return async function handle(request: Request): Promise<Response> {
    const url = new URL(request.url);
    if (request.method !== "POST" || url.pathname !== ATTEST_PATH) {
      return jsonResponse(404, { error: "Not found." });
    }

    let body: unknown;
    try {
      body = await readBoundedJson(request);
    } catch {
      return jsonResponse(400, { error: "Invalid Attestor request." });
    }
    const parsed = parseRequest(body);
    if (!parsed) {
      return jsonResponse(400, { error: "Invalid Attestor request." });
    }

    try {
      const execute = dependencies.execute ?? executePreviewBuildAttestorJob;
      const result = await execute({
        ...parsed,
        ecs: dependencies.ecs,
        fence: dependencies.fence,
        envelopeStore: dependencies.envelopeStore,
        config: dependencies.config,
        now: dependencies.now?.(),
      });
      if (result.state === "failed") {
        return jsonResponse(200, {
          jobId: result.jobId,
          buildId: result.buildId,
          state: "failed",
        });
      }
      const receiptToken = await dependencies.receiptStore.read({
        jobId: result.jobId,
        buildId: result.buildId,
      });
      if (receiptToken) {
        return jsonResponse(200, {
          jobId: result.jobId,
          buildId: result.buildId,
          state: "ready",
          receiptToken,
        });
      }
      if (result.state === "completed") {
        return jsonResponse(200, {
          jobId: result.jobId,
          buildId: result.buildId,
          state: "failed",
        });
      }
      return jsonResponse(202, {
        jobId: result.jobId,
        buildId: result.buildId,
        state: "pending",
      });
    } catch {
      return jsonResponse(503, { error: "Attestor service unavailable." });
    }
  };
}
