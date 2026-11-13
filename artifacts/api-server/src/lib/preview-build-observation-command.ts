import {
  createPrivateKey,
  createPublicKey,
  sign as signBytes,
  verify as verifyBytes,
  type KeyObject,
} from "node:crypto";
import { isPreviewBuildOutputArtifactKey } from "./preview-build-output-key.js";

const DOMAIN = Buffer.from(
  "EngineeringOS Preview Build Observation v1\n",
  "utf8",
);
const MAX_TOKEN_LENGTH = 8_192;
const MAX_TTL_MS = 30_000;
const CLOCK_SKEW_MS = 5_000;
const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const IMAGE_DIGEST_PATTERN = /^sha256:[a-f0-9]{64}$/i;

export type PreviewBuildObservationClaims = {
  version: 1;
  action: "preview-build-observe";
  jobId: string;
  buildId: string;
  builderImageDigest: string;
  outputArtifactKey: string;
  taskArn?: string;
  issuedAt: string;
  expiresAt: string;
};

export class PreviewBuildObservationCommandError extends Error {
  constructor(
    readonly code:
      | "PREVIEW_BUILD_OBSERVATION_INVALID"
      | "PREVIEW_BUILD_OBSERVATION_KEY_INVALID"
      | "PREVIEW_BUILD_OBSERVATION_SIGNATURE_INVALID"
      | "PREVIEW_BUILD_OBSERVATION_EXPIRED",
  ) {
    super("Preview build observation command was rejected.");
    this.name = "PreviewBuildObservationCommandError";
  }
}

function keyObject(
  pem: string | undefined,
  kind: "private" | "public",
): KeyObject {
  if (!pem || pem.length > 16_384 || !pem.includes("-----BEGIN")) {
    throw new PreviewBuildObservationCommandError(
      "PREVIEW_BUILD_OBSERVATION_KEY_INVALID",
    );
  }
  try {
    const key =
      kind === "private"
        ? createPrivateKey(pem.replace(/\\n/g, "\n"))
        : createPublicKey(pem.replace(/\\n/g, "\n"));
    if (key.asymmetricKeyType !== "ed25519") throw new Error("Invalid key.");
    return key;
  } catch {
    throw new PreviewBuildObservationCommandError(
      "PREVIEW_BUILD_OBSERVATION_KEY_INVALID",
    );
  }
}

function canonicalClaims(claims: PreviewBuildObservationClaims): string {
  return JSON.stringify({
    version: claims.version,
    action: claims.action,
    jobId: claims.jobId,
    buildId: claims.buildId,
    builderImageDigest: claims.builderImageDigest,
    outputArtifactKey: claims.outputArtifactKey,
    ...(claims.taskArn ? { taskArn: claims.taskArn } : {}),
    issuedAt: claims.issuedAt,
    expiresAt: claims.expiresAt,
  });
}

function canonicalTimestamp(value: unknown): value is string {
  return (
    typeof value === "string" &&
    /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value) &&
    Number.isFinite(Date.parse(value)) &&
    new Date(value).toISOString() === value
  );
}

function validateClaims(
  value: unknown,
  now: Date,
): PreviewBuildObservationClaims {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new PreviewBuildObservationCommandError(
      "PREVIEW_BUILD_OBSERVATION_INVALID",
    );
  }
  const record = value as Record<string, unknown>;
  const allowed = [
    "version",
    "action",
    "jobId",
    "buildId",
    "builderImageDigest",
    "outputArtifactKey",
    "taskArn",
    "issuedAt",
    "expiresAt",
  ];
  const issuedAt = Date.parse(String(record.issuedAt));
  const expiresAt = Date.parse(String(record.expiresAt));
  if (
    Object.keys(record).some((key) => !allowed.includes(key)) ||
    allowed
      .filter((key) => key !== "taskArn")
      .some((key) => !(key in record)) ||
    record.version !== 1 ||
    record.action !== "preview-build-observe" ||
    typeof record.jobId !== "string" ||
    !UUID_PATTERN.test(record.jobId) ||
    typeof record.buildId !== "string" ||
    !UUID_PATTERN.test(record.buildId) ||
    typeof record.builderImageDigest !== "string" ||
    !IMAGE_DIGEST_PATTERN.test(record.builderImageDigest) ||
    !isPreviewBuildOutputArtifactKey(record.outputArtifactKey, {
      buildId: record.buildId,
    }) ||
    (record.taskArn !== undefined &&
      (typeof record.taskArn !== "string" ||
        !/^arn:(aws|aws-us-gov|aws-cn):ecs:[a-z0-9-]+:\d{12}:task\/[A-Za-z0-9_-]+\/[a-f0-9]{32}$/i.test(
          record.taskArn,
        ))) ||
    !canonicalTimestamp(record.issuedAt) ||
    !canonicalTimestamp(record.expiresAt) ||
    !Number.isFinite(now.getTime()) ||
    issuedAt > now.getTime() + CLOCK_SKEW_MS ||
    expiresAt <= now.getTime() ||
    expiresAt <= issuedAt ||
    expiresAt - issuedAt > MAX_TTL_MS
  ) {
    throw new PreviewBuildObservationCommandError(
      "PREVIEW_BUILD_OBSERVATION_INVALID",
    );
  }
  return {
    version: 1,
    action: "preview-build-observe",
    jobId: record.jobId,
    buildId: record.buildId,
    builderImageDigest: record.builderImageDigest,
    outputArtifactKey: record.outputArtifactKey as string,
    ...(typeof record.taskArn === "string" ? { taskArn: record.taskArn } : {}),
    issuedAt: record.issuedAt,
    expiresAt: record.expiresAt,
  };
}

function decodePart(value: string): Buffer | undefined {
  if (!/^[A-Za-z0-9_-]+$/.test(value)) return undefined;
  const decoded = Buffer.from(value, "base64url");
  return decoded.toString("base64url") === value ? decoded : undefined;
}

export function signPreviewBuildObservation(input: {
  claims: PreviewBuildObservationClaims;
  privateKeyPem: string | undefined;
  now?: Date;
}): string {
  const now = input.now ?? new Date();
  const claims = validateClaims(input.claims, now);
  const payload = Buffer.from(canonicalClaims(claims), "utf8");
  const signature = signBytes(
    null,
    Buffer.concat([DOMAIN, payload]),
    keyObject(input.privateKeyPem, "private"),
  );
  return `${payload.toString("base64url")}.${signature.toString("base64url")}`;
}

export function verifyPreviewBuildObservation(input: {
  token: string;
  publicKeyPem: string | undefined;
  now?: Date;
}): PreviewBuildObservationClaims {
  if (
    typeof input.token !== "string" ||
    input.token.length > MAX_TOKEN_LENGTH
  ) {
    throw new PreviewBuildObservationCommandError(
      "PREVIEW_BUILD_OBSERVATION_INVALID",
    );
  }
  const [payloadPart, signaturePart, ...rest] = input.token.split(".");
  const payload = payloadPart ? decodePart(payloadPart) : undefined;
  const signature = signaturePart ? decodePart(signaturePart) : undefined;
  if (!payload || !signature || rest.length > 0) {
    throw new PreviewBuildObservationCommandError(
      "PREVIEW_BUILD_OBSERVATION_INVALID",
    );
  }
  const now = input.now ?? new Date();
  let parsed: unknown;
  try {
    parsed = JSON.parse(payload.toString("utf8"));
  } catch {
    throw new PreviewBuildObservationCommandError(
      "PREVIEW_BUILD_OBSERVATION_INVALID",
    );
  }
  const claims = validateClaims(parsed, now);
  if (payload.toString("utf8") !== canonicalClaims(claims)) {
    throw new PreviewBuildObservationCommandError(
      "PREVIEW_BUILD_OBSERVATION_INVALID",
    );
  }
  let valid = false;
  try {
    valid = verifyBytes(
      null,
      Buffer.concat([DOMAIN, payload]),
      keyObject(input.publicKeyPem, "public"),
      signature,
    );
  } catch {
    throw new PreviewBuildObservationCommandError(
      "PREVIEW_BUILD_OBSERVATION_KEY_INVALID",
    );
  }
  if (!valid) {
    throw new PreviewBuildObservationCommandError(
      "PREVIEW_BUILD_OBSERVATION_SIGNATURE_INVALID",
    );
  }
  return claims;
}
