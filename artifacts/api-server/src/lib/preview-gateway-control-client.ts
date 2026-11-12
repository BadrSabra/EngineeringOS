import { isIP } from "node:net";
import {
  PreviewControlCommandError,
  signPreviewControlCommand,
  type PreviewControlCommand,
} from "./preview-control-command.js";
import type { PreviewEcsCommandResult } from "./preview-ecs-runner.js";

const CONTROL_PATH = "/internal/v1/preview/commands";
const TASK_ARN_PATTERN =
  /^arn:(aws|aws-us-gov|aws-cn):ecs:[a-z0-9-]+:\d{12}:task\/[A-Za-z0-9_-]+\/[a-f0-9]{32}$/i;
const REQUEST_TIMEOUT_MS = 5_000;

export class PreviewGatewayControlClientError extends Error {
  constructor(
    readonly code:
      | "PREVIEW_GATEWAY_URL_INVALID"
      | "PREVIEW_GATEWAY_KEY_MISSING"
      | "PREVIEW_GATEWAY_COMMAND_INVALID"
      | "PREVIEW_GATEWAY_UNAVAILABLE"
      | "PREVIEW_GATEWAY_RESPONSE_INVALID",
  ) {
    super("Preview Gateway control request failed.");
    this.name = "PreviewGatewayControlClientError";
  }
}

function controlEndpoint(value: string): URL {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new PreviewGatewayControlClientError("PREVIEW_GATEWAY_URL_INVALID");
  }
  const hostname = url.hostname.toLowerCase();
  if (
    url.protocol !== "https:" ||
    url.username ||
    url.password ||
    url.search ||
    url.hash ||
    url.pathname !== "/" ||
    hostname === "localhost" ||
    hostname.endsWith(".localhost") ||
    hostname.endsWith(".local") ||
    hostname.endsWith(".internal") ||
    isIP(hostname) !== 0
  ) {
    throw new PreviewGatewayControlClientError("PREVIEW_GATEWAY_URL_INVALID");
  }
  return new URL(CONTROL_PATH, url);
}

function parseGatewayResponse(
  command: PreviewControlCommand,
  payload: unknown,
): PreviewEcsCommandResult {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    throw new PreviewGatewayControlClientError(
      "PREVIEW_GATEWAY_RESPONSE_INVALID",
    );
  }
  const response = payload as Record<string, unknown>;
  if (command.action === "start") {
    if (
      response.action !== "start" ||
      response.taskDefinitionArn !== command.taskDefinitionArn ||
      typeof response.taskArn !== "string" ||
      !TASK_ARN_PATTERN.test(response.taskArn)
    ) {
      throw new PreviewGatewayControlClientError(
        "PREVIEW_GATEWAY_RESPONSE_INVALID",
      );
    }
    return {
      action: "start",
      taskArn: response.taskArn,
      taskDefinitionArn: command.taskDefinitionArn,
    };
  }

  if (
    response.action !== "stop" ||
    (command.taskArn !== undefined && response.taskArn !== command.taskArn) ||
    (response.taskArn !== undefined &&
      (typeof response.taskArn !== "string" ||
        !TASK_ARN_PATTERN.test(response.taskArn))) ||
    (response.stopped !== true && response.stopped !== false)
  ) {
    throw new PreviewGatewayControlClientError(
      "PREVIEW_GATEWAY_RESPONSE_INVALID",
    );
  }
  return {
    action: "stop",
    ...(typeof response.taskArn === "string"
      ? { taskArn: response.taskArn }
      : {}),
    stopped: response.stopped,
  };
}

export async function dispatchPreviewControlCommand(input: {
  command: PreviewControlCommand;
  privateKeyPem: string | undefined;
  gatewayUrl: string | undefined;
  fetcher?: typeof fetch;
  now?: Date;
}): Promise<PreviewEcsCommandResult> {
  if (!input.privateKeyPem) {
    throw new PreviewGatewayControlClientError("PREVIEW_GATEWAY_KEY_MISSING");
  }
  if (!input.gatewayUrl) {
    throw new PreviewGatewayControlClientError("PREVIEW_GATEWAY_URL_INVALID");
  }
  const url = controlEndpoint(input.gatewayUrl);
  let token: string;
  try {
    token = signPreviewControlCommand(
      input.command,
      input.privateKeyPem,
      input.now,
    );
  } catch (error) {
    throw new PreviewGatewayControlClientError(
      error instanceof PreviewControlCommandError &&
        error.code === "PREVIEW_CONTROL_KEY_INVALID"
        ? "PREVIEW_GATEWAY_KEY_MISSING"
        : "PREVIEW_GATEWAY_COMMAND_INVALID",
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
    if (!response.ok) {
      throw new PreviewGatewayControlClientError("PREVIEW_GATEWAY_UNAVAILABLE");
    }
    let payload: unknown;
    try {
      payload = await response.json();
    } catch {
      throw new PreviewGatewayControlClientError(
        "PREVIEW_GATEWAY_RESPONSE_INVALID",
      );
    }
    return parseGatewayResponse(input.command, payload);
  } catch (error) {
    if (error instanceof PreviewGatewayControlClientError) throw error;
    throw new PreviewGatewayControlClientError("PREVIEW_GATEWAY_UNAVAILABLE");
  } finally {
    clearTimeout(timeout);
  }
}
