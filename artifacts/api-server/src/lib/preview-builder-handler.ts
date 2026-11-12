import {
  PreviewBuilderRunnerError,
  executePreviewBuilderJob,
  type PreviewBuilderJobRequest,
  type PreviewBuilderRunnerConfig,
} from "./preview-builder-runner.js";
import type { PreviewEcsClient } from "./preview-ecs-runner.js";
import type { PreviewBuildJobFence } from "./preview-build-job-fence.js";
import type { PreviewBuildTransferProvider } from "./preview-build-transfer-s3.js";
import type { PreviewBuildJobEnvelopeStore } from "./preview-build-job-envelope.js";

const BUILD_PATH = "/internal/v1/preview/builds";
const MAX_BODY_BYTES = 16_384;
const REQUEST_FIELDS = ["token"] as const;

export type PreviewBuilderHandlerDependencies = {
  ecs: PreviewEcsClient;
  fence: PreviewBuildJobFence;
  transferProvider: PreviewBuildTransferProvider;
  envelopeStore: PreviewBuildJobEnvelopeStore;
  config: PreviewBuilderRunnerConfig;
  now?: () => Date;
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
  const contentType = request.headers.get("content-type")?.toLowerCase();
  const contentLength = Number(request.headers.get("content-length"));
  if (
    contentType !== "application/json" ||
    (Number.isFinite(contentLength) && contentLength > MAX_BODY_BYTES) ||
    !request.body
  ) {
    throw new Error("Invalid Builder request.");
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
        throw new Error("Builder request is too large.");
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  return JSON.parse(Buffer.concat(chunks).toString("utf8"));
}

function parseRequest(value: unknown): PreviewBuilderJobRequest | null {
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
  if (typeof record.token !== "string" || record.token.length > 8_192) {
    return null;
  }
  return { token: record.token };
}

export function createPreviewBuilderHandler(
  dependencies: PreviewBuilderHandlerDependencies,
) {
  return async function handle(request: Request): Promise<Response> {
    const url = new URL(request.url);
    if (request.method !== "POST" || url.pathname !== BUILD_PATH) {
      return jsonResponse(404, { error: "Not found." });
    }

    let body: unknown;
    try {
      body = await readBoundedJson(request);
    } catch {
      return jsonResponse(400, { error: "Invalid Builder request." });
    }
    const parsed = parseRequest(body);
    if (!parsed) {
      return jsonResponse(400, { error: "Invalid Builder request." });
    }

    try {
      const result = await executePreviewBuilderJob({
        request: parsed,
        ecs: dependencies.ecs,
        fence: dependencies.fence,
        transferProvider: dependencies.transferProvider,
        envelopeStore: dependencies.envelopeStore,
        config: dependencies.config,
        now: dependencies.now?.(),
      });
      return jsonResponse(202, result);
    } catch (error) {
      if (error instanceof PreviewBuilderRunnerError) {
        const status =
          error.code === "PREVIEW_BUILDER_JOB_REJECTED" ? 403 : 409;
        return jsonResponse(status, { error: "Builder job rejected." });
      }
      return jsonResponse(503, { error: "Builder service unavailable." });
    }
  };
}
