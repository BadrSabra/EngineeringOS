import {
  createHash,
  createPrivateKey,
  createPublicKey,
  sign,
  verify,
  type KeyObject,
} from "node:crypto";
import { isPreviewBuildOutputArtifactKey } from "./preview-build-output-key.js";

const SIGNING_DOMAIN = Buffer.from(
  "EngineeringOS Preview Control v1\n",
  "utf8",
);
const MAX_COMMAND_TTL_MS = 30_000;
const MAX_SESSION_TTL_MS = 30 * 60_000;
const CLOCK_SKEW_MS = 5_000;
const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const DIGEST_PATTERN = /^[a-f0-9]{64}$/i;
const TASK_DEFINITION_ARN_PATTERN =
  /^arn:(aws|aws-us-gov|aws-cn):ecs:[a-z0-9-]+:\d{12}:task-definition\/[A-Za-z0-9_-]+:\d+$/i;
const TASK_ARN_PATTERN =
  /^arn:(aws|aws-us-gov|aws-cn):ecs:[a-z0-9-]+:\d{12}:task\/[A-Za-z0-9_-]+\/[a-f0-9]{32}$/i;

type PreviewControlCommandBase = {
  version: 1;
  commandId: string;
  sessionId: string;
  stateVersion: number;
  issuedAt: string;
  expiresAt: string;
};

export type PreviewStartCommand = PreviewControlCommandBase & {
  action: "start";
  proposalId: string;
  proposalRevision: number;
  candidateRevision: string;
  changeSetHash: string;
  outputArtifactKey: string;
  outputArtifactDigest: string;
  imageDigest: string;
  taskDefinitionArn: string;
  sessionExpiresAt: string;
};

export type PreviewStopCommand = PreviewControlCommandBase & {
  action: "stop";
  taskDefinitionArn: string;
  sessionExpiresAt: string;
  taskArn?: string;
};

export type PreviewControlCommand = PreviewStartCommand | PreviewStopCommand;

export function previewControlCommandFingerprint(
  command: PreviewControlCommand,
): string {
  const semanticCommand =
    command.action === "start"
      ? {
          action: command.action,
          sessionId: command.sessionId,
          stateVersion: command.stateVersion,
          proposalId: command.proposalId,
          proposalRevision: command.proposalRevision,
          candidateRevision: command.candidateRevision,
          changeSetHash: command.changeSetHash,
          outputArtifactKey: command.outputArtifactKey,
          outputArtifactDigest: command.outputArtifactDigest,
          imageDigest: command.imageDigest,
          taskDefinitionArn: command.taskDefinitionArn,
          sessionExpiresAt: command.sessionExpiresAt,
        }
      : {
          action: command.action,
          sessionId: command.sessionId,
          stateVersion: command.stateVersion,
          taskDefinitionArn: command.taskDefinitionArn,
          sessionExpiresAt: command.sessionExpiresAt,
        };
  return createHash("sha256")
    .update("EngineeringOS Preview Command Fence v1\n")
    .update(JSON.stringify(semanticCommand))
    .digest("hex");
}

export class PreviewControlCommandError extends Error {
  constructor(
    readonly code:
      | "PREVIEW_CONTROL_KEY_INVALID"
      | "PREVIEW_CONTROL_COMMAND_INVALID"
      | "PREVIEW_CONTROL_SIGNATURE_INVALID"
      | "PREVIEW_CONTROL_COMMAND_EXPIRED",
  ) {
    super("Preview control command is invalid or unavailable.");
    this.name = "PreviewControlCommandError";
  }
}

function isUuid(value: unknown): value is string {
  return typeof value === "string" && UUID_PATTERN.test(value);
}

function isIsoTimestamp(value: unknown): value is string {
  return (
    typeof value === "string" &&
    /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value) &&
    Number.isFinite(Date.parse(value)) &&
    new Date(value).toISOString() === value
  );
}

function isString(value: unknown, maxLength: number): value is string {
  return (
    typeof value === "string" &&
    value.length > 0 &&
    value.length <= maxLength &&
    value.trim() === value
  );
}

function validateBase(
  value: Record<string, unknown>,
): value is Record<string, unknown> & PreviewControlCommandBase {
  return (
    value.version === 1 &&
    isUuid(value.commandId) &&
    isUuid(value.sessionId) &&
    Number.isSafeInteger(value.stateVersion) &&
    (value.stateVersion as number) >= 0 &&
    isIsoTimestamp(value.issuedAt) &&
    isIsoTimestamp(value.expiresAt)
  );
}

function validateCommand(value: unknown, now: Date): PreviewControlCommand {
  if (
    !value ||
    typeof value !== "object" ||
    Array.isArray(value) ||
    !Number.isFinite(now.getTime())
  ) {
    throw new PreviewControlCommandError("PREVIEW_CONTROL_COMMAND_INVALID");
  }

  const record = value as Record<string, unknown>;
  if (!validateBase(record)) {
    throw new PreviewControlCommandError("PREVIEW_CONTROL_COMMAND_INVALID");
  }

  const issuedAt = Date.parse(record.issuedAt);
  const expiresAt = Date.parse(record.expiresAt);
  if (
    issuedAt > now.getTime() + CLOCK_SKEW_MS ||
    expiresAt <= now.getTime() ||
    expiresAt <= issuedAt ||
    expiresAt - issuedAt > MAX_COMMAND_TTL_MS
  ) {
    throw new PreviewControlCommandError("PREVIEW_CONTROL_COMMAND_EXPIRED");
  }

  if (record.action === "start") {
    const sessionExpiresAt = record.sessionExpiresAt;
    if (
      !isString(record.proposalId, 255) ||
      !Number.isSafeInteger(record.proposalRevision) ||
      (record.proposalRevision as number) < 0 ||
      typeof record.candidateRevision !== "string" ||
      !DIGEST_PATTERN.test(record.candidateRevision) ||
      typeof record.changeSetHash !== "string" ||
      !DIGEST_PATTERN.test(record.changeSetHash) ||
      !isPreviewBuildOutputArtifactKey(record.outputArtifactKey) ||
      typeof record.outputArtifactDigest !== "string" ||
      !DIGEST_PATTERN.test(record.outputArtifactDigest) ||
      typeof record.imageDigest !== "string" ||
      !/^sha256:[a-f0-9]{64}$/i.test(record.imageDigest) ||
      typeof record.taskDefinitionArn !== "string" ||
      !TASK_DEFINITION_ARN_PATTERN.test(record.taskDefinitionArn) ||
      record.stateVersion !== 0 ||
      !isIsoTimestamp(sessionExpiresAt)
    ) {
      throw new PreviewControlCommandError("PREVIEW_CONTROL_COMMAND_INVALID");
    }

    const sessionExpiry = Date.parse(sessionExpiresAt);
    if (
      sessionExpiry <= now.getTime() ||
      sessionExpiry - now.getTime() > MAX_SESSION_TTL_MS + CLOCK_SKEW_MS
    ) {
      throw new PreviewControlCommandError("PREVIEW_CONTROL_COMMAND_EXPIRED");
    }

    return {
      version: 1,
      action: "start",
      commandId: record.commandId,
      sessionId: record.sessionId,
      stateVersion: 0,
      issuedAt: record.issuedAt,
      expiresAt: record.expiresAt,
      proposalId: record.proposalId,
      proposalRevision: record.proposalRevision as number,
      candidateRevision: record.candidateRevision,
      changeSetHash: record.changeSetHash,
      outputArtifactKey: record.outputArtifactKey,
      outputArtifactDigest: record.outputArtifactDigest,
      imageDigest: record.imageDigest,
      taskDefinitionArn: record.taskDefinitionArn,
      sessionExpiresAt,
    };
  }

  if (
    record.action === "stop" &&
    (record.stateVersion as number) > 0 &&
    typeof record.taskDefinitionArn === "string" &&
    TASK_DEFINITION_ARN_PATTERN.test(record.taskDefinitionArn) &&
    isIsoTimestamp(record.sessionExpiresAt) &&
    (record.taskArn == null ||
      (typeof record.taskArn === "string" &&
        TASK_ARN_PATTERN.test(record.taskArn)))
  ) {
    return {
      version: 1,
      action: "stop",
      commandId: record.commandId,
      sessionId: record.sessionId,
      stateVersion: record.stateVersion as number,
      issuedAt: record.issuedAt,
      expiresAt: record.expiresAt,
      taskDefinitionArn: record.taskDefinitionArn,
      sessionExpiresAt: record.sessionExpiresAt,
      ...(record.taskArn == null ? {} : { taskArn: record.taskArn }),
    };
  }

  throw new PreviewControlCommandError("PREVIEW_CONTROL_COMMAND_INVALID");
}

function canonicalCommand(command: PreviewControlCommand): string {
  if (command.action === "start") {
    return JSON.stringify({
      version: command.version,
      action: command.action,
      commandId: command.commandId,
      sessionId: command.sessionId,
      stateVersion: command.stateVersion,
      issuedAt: command.issuedAt,
      expiresAt: command.expiresAt,
      proposalId: command.proposalId,
      proposalRevision: command.proposalRevision,
      candidateRevision: command.candidateRevision,
      changeSetHash: command.changeSetHash,
      outputArtifactKey: command.outputArtifactKey,
      outputArtifactDigest: command.outputArtifactDigest,
      imageDigest: command.imageDigest,
      taskDefinitionArn: command.taskDefinitionArn,
      sessionExpiresAt: command.sessionExpiresAt,
    });
  }

  return JSON.stringify({
    version: command.version,
    action: command.action,
    commandId: command.commandId,
    sessionId: command.sessionId,
    stateVersion: command.stateVersion,
    issuedAt: command.issuedAt,
    expiresAt: command.expiresAt,
    taskDefinitionArn: command.taskDefinitionArn,
    sessionExpiresAt: command.sessionExpiresAt,
    taskArn: command.taskArn ?? null,
  });
}

function parseKey(
  pem: string | undefined,
  kind: "private" | "public",
): KeyObject {
  if (!pem || pem.length > 16_384 || !pem.includes("-----BEGIN")) {
    throw new PreviewControlCommandError("PREVIEW_CONTROL_KEY_INVALID");
  }

  try {
    const key =
      kind === "private"
        ? createPrivateKey(pem.replace(/\\n/g, "\n"))
        : createPublicKey(pem.replace(/\\n/g, "\n"));
    if (key.asymmetricKeyType !== "ed25519") {
      throw new Error("Unexpected signing key type.");
    }
    return key;
  } catch {
    throw new PreviewControlCommandError("PREVIEW_CONTROL_KEY_INVALID");
  }
}

export function assertPreviewControlPublicKeyPem(
  pem: string | undefined,
): void {
  parseKey(pem, "public");
}

export function signPreviewControlCommand(
  command: PreviewControlCommand,
  privateKeyPem: string | undefined,
  now = new Date(),
): string {
  const validated = validateCommand(command, now);
  const key = parseKey(privateKeyPem, "private");
  const payload = Buffer.from(
    `${SIGNING_DOMAIN.toString("utf8")}${canonicalCommand(validated)}`,
    "utf8",
  );
  const signature = sign(null, payload, key);
  return `${Buffer.from(canonicalCommand(validated)).toString("base64url")}.${signature.toString("base64url")}`;
}

export function verifyPreviewControlCommand(
  token: string,
  publicKeyPem: string | undefined,
  now = new Date(),
): PreviewControlCommand {
  if (
    typeof token !== "string" ||
    token.length > 8_192 ||
    !/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/.test(token)
  ) {
    throw new PreviewControlCommandError("PREVIEW_CONTROL_COMMAND_INVALID");
  }

  const [encodedPayload, encodedSignature] = token.split(".");
  const payload = Buffer.from(encodedPayload, "base64url");
  const signature = Buffer.from(encodedSignature, "base64url");
  if (payload.length > 6_144 || signature.length !== 64) {
    throw new PreviewControlCommandError("PREVIEW_CONTROL_COMMAND_INVALID");
  }

  let decoded: unknown;
  try {
    decoded = JSON.parse(payload.toString("utf8"));
  } catch {
    throw new PreviewControlCommandError("PREVIEW_CONTROL_COMMAND_INVALID");
  }

  const command = validateCommand(decoded, now);
  const canonical = Buffer.from(canonicalCommand(command), "utf8");
  if (!payload.equals(canonical)) {
    throw new PreviewControlCommandError("PREVIEW_CONTROL_COMMAND_INVALID");
  }

  const key = parseKey(publicKeyPem, "public");
  const signedPayload = Buffer.concat([SIGNING_DOMAIN, canonical]);
  if (!verify(null, signedPayload, key, signature)) {
    throw new PreviewControlCommandError("PREVIEW_CONTROL_SIGNATURE_INVALID");
  }
  return command;
}
