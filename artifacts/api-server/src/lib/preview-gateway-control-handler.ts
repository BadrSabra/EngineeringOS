import { PreviewControlCommandError } from "./preview-control-command.js";
import {
  executePreviewGatewayCommand,
  type PreviewCommandFence,
  PreviewEcsRunnerError,
  type PreviewEcsClient,
  type PreviewEcsRunnerConfig,
} from "./preview-ecs-runner.js";
import type { PreviewBuildOutputUrlProvider } from "./preview-build-output-s3.js";

const CONTROL_PATH = "/internal/v1/preview/commands";
const MAX_BODY_BYTES = 8_192;

export type PreviewGatewayHandlerDependencies = {
  publicKeyPem: string | undefined;
  ecs: PreviewEcsClient;
  buildOutputUrlProvider: PreviewBuildOutputUrlProvider;
  fence: PreviewCommandFence;
  config: PreviewEcsRunnerConfig;
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
    throw new Error("Invalid control request.");
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
        throw new Error("Control request is too large.");
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  const text = Buffer.concat(chunks).toString("utf8");
  return JSON.parse(text);
}

export function createPreviewGatewayControlHandler(
  dependencies: PreviewGatewayHandlerDependencies,
) {
  return async function handle(request: Request): Promise<Response> {
    const url = new URL(request.url);
    if (request.method !== "POST" || url.pathname !== CONTROL_PATH) {
      return jsonResponse(404, { error: "Not found." });
    }

    let payload: unknown;
    try {
      payload = await readBoundedJson(request);
    } catch {
      return jsonResponse(400, { error: "Invalid control request." });
    }
    if (
      !payload ||
      typeof payload !== "object" ||
      Array.isArray(payload) ||
      Object.keys(payload).length !== 1 ||
      typeof (payload as { token?: unknown }).token !== "string"
    ) {
      return jsonResponse(400, { error: "Invalid control request." });
    }

    try {
      const result = await executePreviewGatewayCommand({
        token: (payload as { token: string }).token,
        publicKeyPem: dependencies.publicKeyPem,
        ecs: dependencies.ecs,
        buildOutputUrlProvider: dependencies.buildOutputUrlProvider,
        fence: dependencies.fence,
        config: dependencies.config,
        now: dependencies.now?.(),
      });
      return jsonResponse(200, result);
    } catch (error) {
      if (error instanceof PreviewControlCommandError) {
        const status =
          error.code === "PREVIEW_CONTROL_COMMAND_EXPIRED" ? 410 : 403;
        return jsonResponse(status, { error: "Command rejected." });
      }
      if (error instanceof PreviewEcsRunnerError) {
        return jsonResponse(409, { error: "Preview task operation rejected." });
      }
      return jsonResponse(503, { error: "Preview control unavailable." });
    }
  };
}
