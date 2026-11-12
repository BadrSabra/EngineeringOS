import {
  createHash,
  createPrivateKey,
  createPublicKey,
  sign as signSignature,
  verify as verifySignature,
  type KeyObject,
} from "node:crypto";
import { MAX_PREVIEW_BUILD_ARCHIVE_BYTES } from "./preview-build-upload.js";

const COMMAND_DOMAIN = Buffer.from(
  "EngineeringOS Preview Artifact Delete Command v1\n",
  "utf8",
);
const RECEIPT_DOMAIN = Buffer.from(
  "EngineeringOS Preview Artifact Delete Receipt v1\n",
  "utf8",
);
const MAX_TOKEN_LENGTH = 8_192;
const MAX_PAYLOAD_BYTES = 6_144;
const MAX_COMMAND_TTL_MS = 60_000;
const MAX_RECEIPT_AGE_MS = 5 * 60_000;
const CLOCK_SKEW_MS = 5_000;
const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const HASH_PATTERN = /^[a-f0-9]{64}$/i;

const COMMAND_FIELDS = [
  "version",
  "action",
  "commandId",
  "storeId",
  "artifactRefId",
  "jobId",
  "projectId",
  "proposalId",
  "operationId",
  "proposalRevision",
  "candidateRevision",
  "changeSetHash",
  "artifactKind",
  "artifactDigest",
  "sizeBytes",
  "manifestDigest",
  "retentionPolicy",
  "issuedAt",
  "expiresAt",
] as const;

const RECEIPT_FIELDS = [
  "version",
  "action",
  "commandId",
  "commandFingerprint",
  "storeId",
  "artifactRefId",
  "artifactDigest",
  "manifestDigest",
  "result",
  "completedAt",
] as const;

export type PreviewArtifactDeleteCommandClaims = {
  version: 1;
  action: "delete-artifact";
  commandId: string;
  storeId: string;
  artifactRefId: string;
  jobId: string;
  projectId: string;
  proposalId: string;
  operationId: string;
  proposalRevision: number;
  candidateRevision: string;
  changeSetHash: string;
  artifactKind: "preview-build-input";
  artifactDigest: string;
  sizeBytes: number;
  manifestDigest: string;
  retentionPolicy: "preview-build-input-24h-v1";
  issuedAt: string;
  expiresAt: string;
};

export type PreviewArtifactDeleteReceiptClaims = {
  version: 1;
  action: "artifact-delete-receipt";
  commandId: string;
  commandFingerprint: string;
  storeId: string;
  artifactRefId: string;
  artifactDigest: string;
  manifestDigest: string;
  result: "deleted" | "already_deleted";
  completedAt: string;
};

export class PreviewArtifactGcCommandError extends Error {
  constructor(
    readonly code:
      | "PREVIEW_ARTIFACT_GC_COMMAND_INVALID"
      | "PREVIEW_ARTIFACT_GC_COMMAND_EXPIRED"
      | "PREVIEW_ARTIFACT_GC_COMMAND_KEY_INVALID"
      | "PREVIEW_ARTIFACT_GC_COMMAND_SIGNATURE_INVALID"
      | "PREVIEW_ARTIFACT_GC_RECEIPT_INVALID"
      | "PREVIEW_ARTIFACT_GC_RECEIPT_SIGNATURE_INVALID"
      | "PREVIEW_ARTIFACT_GC_RECEIPT_EXPIRED",
  ) {
    super("Preview artifact delete authorization is invalid or unavailable.");
    this.name = "PreviewArtifactGcCommandError";
  }
}

function parseKey(
  pem: string | undefined,
  kind: "private" | "public",
): KeyObject {
  if (!pem || pem.length > 16_384 || !pem.includes("-----BEGIN")) {
    throw new PreviewArtifactGcCommandError(
      "PREVIEW_ARTIFACT_GC_COMMAND_KEY_INVALID",
    );
  }
  try {
    const key =
      kind === "private"
        ? createPrivateKey(pem.replace(/\\n/g, "\n"))
        : createPublicKey(pem.replace(/\\n/g, "\n"));
    if (key.asymmetricKeyType !== "ed25519") {
      throw new Error("Expected Ed25519 key.");
    }
    return key;
  } catch {
    throw new PreviewArtifactGcCommandError(
      "PREVIEW_ARTIFACT_GC_COMMAND_KEY_INVALID",
    );
  }
}

function boundedText(value: unknown, maxLength: number): value is string {
  return (
    typeof value === "string" &&
    value.length > 0 &&
    value.length <= maxLength &&
    value.trim() === value &&
    !/[\u0000-\u001f\u007f]/.test(value)
  );
}

function canonicalTimestamp(value: unknown): value is string {
  return (
    typeof value === "string" &&
    /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value) &&
    Number.isFinite(Date.parse(value)) &&
    new Date(value).toISOString() === value
  );
}

function canonicalCommand(
  claims: PreviewArtifactDeleteCommandClaims,
): string {
  return JSON.stringify(
    Object.fromEntries(COMMAND_FIELDS.map((field) => [field, claims[field]])),
  );
}

function canonicalReceipt(
  claims: PreviewArtifactDeleteReceiptClaims,
): string {
  return JSON.stringify(
    Object.fromEntries(RECEIPT_FIELDS.map((field) => [field, claims[field]])),
  );
}

function validateCommand(
  value: unknown,
  now: Date,
): PreviewArtifactDeleteCommandClaims {
  if (
    !value ||
    typeof value !== "object" ||
    Array.isArray(value) ||
    !Number.isFinite(now.getTime())
  ) {
    throw new PreviewArtifactGcCommandError(
      "PREVIEW_ARTIFACT_GC_COMMAND_INVALID",
    );
  }
  const record = value as Record<string, unknown>;
  if (
    Object.keys(record).length !== COMMAND_FIELDS.length ||
    COMMAND_FIELDS.some((field) => !(field in record)) ||
    record.version !== 1 ||
    record.action !== "delete-artifact" ||
    !boundedText(record.commandId, 36) ||
    !UUID_PATTERN.test(String(record.commandId)) ||
    !boundedText(record.storeId, 36) ||
    !UUID_PATTERN.test(String(record.storeId)) ||
    !boundedText(record.artifactRefId, 36) ||
    !UUID_PATTERN.test(String(record.artifactRefId)) ||
    !boundedText(record.jobId, 36) ||
    !UUID_PATTERN.test(String(record.jobId)) ||
    !boundedText(record.projectId, 255) ||
    !boundedText(record.proposalId, 255) ||
    !boundedText(record.operationId, 255) ||
    !Number.isSafeInteger(record.proposalRevision) ||
    (record.proposalRevision as number) < 0 ||
    typeof record.candidateRevision !== "string" ||
    !HASH_PATTERN.test(record.candidateRevision) ||
    typeof record.changeSetHash !== "string" ||
    !HASH_PATTERN.test(record.changeSetHash) ||
    record.artifactKind !== "preview-build-input" ||
    typeof record.artifactDigest !== "string" ||
    !HASH_PATTERN.test(record.artifactDigest) ||
    !Number.isSafeInteger(record.sizeBytes) ||
    (record.sizeBytes as number) < 1 ||
    (record.sizeBytes as number) > MAX_PREVIEW_BUILD_ARCHIVE_BYTES ||
    typeof record.manifestDigest !== "string" ||
    !HASH_PATTERN.test(record.manifestDigest) ||
    record.retentionPolicy !== "preview-build-input-24h-v1" ||
    !canonicalTimestamp(record.issuedAt) ||
    !canonicalTimestamp(record.expiresAt)
  ) {
    throw new PreviewArtifactGcCommandError(
      "PREVIEW_ARTIFACT_GC_COMMAND_INVALID",
    );
  }

  const issuedAt = Date.parse(record.issuedAt);
  const expiresAt = Date.parse(record.expiresAt);
  if (
    issuedAt > now.getTime() + CLOCK_SKEW_MS ||
    expiresAt <= now.getTime() ||
    expiresAt <= issuedAt ||
    expiresAt - issuedAt > MAX_COMMAND_TTL_MS
  ) {
    throw new PreviewArtifactGcCommandError(
      "PREVIEW_ARTIFACT_GC_COMMAND_EXPIRED",
    );
  }

  return Object.fromEntries(
    COMMAND_FIELDS.map((field) => [field, record[field]]),
  ) as PreviewArtifactDeleteCommandClaims;
}

function validateReceipt(
  value: unknown,
  now: Date,
): PreviewArtifactDeleteReceiptClaims {
  if (
    !value ||
    typeof value !== "object" ||
    Array.isArray(value) ||
    !Number.isFinite(now.getTime())
  ) {
    throw new PreviewArtifactGcCommandError(
      "PREVIEW_ARTIFACT_GC_RECEIPT_INVALID",
    );
  }
  const record = value as Record<string, unknown>;
  if (
    Object.keys(record).length !== RECEIPT_FIELDS.length ||
    RECEIPT_FIELDS.some((field) => !(field in record)) ||
    record.version !== 1 ||
    record.action !== "artifact-delete-receipt" ||
    !boundedText(record.commandId, 36) ||
    !UUID_PATTERN.test(String(record.commandId)) ||
    typeof record.commandFingerprint !== "string" ||
    !HASH_PATTERN.test(record.commandFingerprint) ||
    !boundedText(record.storeId, 36) ||
    !UUID_PATTERN.test(String(record.storeId)) ||
    !boundedText(record.artifactRefId, 36) ||
    !UUID_PATTERN.test(String(record.artifactRefId)) ||
    typeof record.artifactDigest !== "string" ||
    !HASH_PATTERN.test(record.artifactDigest) ||
    typeof record.manifestDigest !== "string" ||
    !HASH_PATTERN.test(record.manifestDigest) ||
    (record.result !== "deleted" && record.result !== "already_deleted") ||
    !canonicalTimestamp(record.completedAt)
  ) {
    throw new PreviewArtifactGcCommandError(
      "PREVIEW_ARTIFACT_GC_RECEIPT_INVALID",
    );
  }
  const completedAt = Date.parse(record.completedAt);
  if (
    completedAt > now.getTime() + CLOCK_SKEW_MS ||
    now.getTime() - completedAt > MAX_RECEIPT_AGE_MS
  ) {
    throw new PreviewArtifactGcCommandError(
      "PREVIEW_ARTIFACT_GC_RECEIPT_EXPIRED",
    );
  }
  return Object.fromEntries(
    RECEIPT_FIELDS.map((field) => [field, record[field]]),
  ) as PreviewArtifactDeleteReceiptClaims;
}

export function previewArtifactDeleteCommandFingerprint(
  command: PreviewArtifactDeleteCommandClaims,
): string {
  const semanticClaims = Object.fromEntries(
    COMMAND_FIELDS.filter(
      (field) => field !== "issuedAt" && field !== "expiresAt",
    ).map((field) => [field, command[field]]),
  );
  return createHash("sha256")
    .update("EngineeringOS Preview Artifact Delete Fingerprint v1\n")
    .update(JSON.stringify(semanticClaims))
    .digest("hex");
}

export function signPreviewArtifactDeleteCommand(input: {
  claims: PreviewArtifactDeleteCommandClaims;
  privateKeyPem: string | undefined;
  now?: Date;
}): string {
  const claims = validateCommand(input.claims, input.now ?? new Date());
  const payload = Buffer.from(canonicalCommand(claims), "utf8");
  const signature = signSignature(
    null,
    Buffer.concat([COMMAND_DOMAIN, payload]),
    parseKey(input.privateKeyPem, "private"),
  );
  return `${payload.toString("base64url")}.${signature.toString("base64url")}`;
}

export function verifyPreviewArtifactDeleteCommand(input: {
  token: string;
  publicKeyPem: string | undefined;
  now?: Date;
}): PreviewArtifactDeleteCommandClaims {
  const now = input.now ?? new Date();
  const decoded = decodeSignedPayload(input.token);
  let value: unknown;
  try {
    value = JSON.parse(decoded.payload.toString("utf8"));
  } catch {
    throw new PreviewArtifactGcCommandError(
      "PREVIEW_ARTIFACT_GC_COMMAND_INVALID",
    );
  }
  const claims = validateCommand(value, now);
  if (
    !decoded.payload.equals(Buffer.from(canonicalCommand(claims), "utf8"))
  ) {
    throw new PreviewArtifactGcCommandError(
      "PREVIEW_ARTIFACT_GC_COMMAND_INVALID",
    );
  }
  if (
    !verifySignature(
      null,
      Buffer.concat([COMMAND_DOMAIN, decoded.payload]),
      parseKey(input.publicKeyPem, "public"),
      decoded.signature,
    )
  ) {
    throw new PreviewArtifactGcCommandError(
      "PREVIEW_ARTIFACT_GC_COMMAND_SIGNATURE_INVALID",
    );
  }
  return Object.freeze(claims);
}

export function signPreviewArtifactDeleteReceipt(input: {
  claims: PreviewArtifactDeleteReceiptClaims;
  privateKeyPem: string | undefined;
  now?: Date;
}): string {
  const claims = validateReceipt(input.claims, input.now ?? new Date());
  const payload = Buffer.from(canonicalReceipt(claims), "utf8");
  const signature = signSignature(
    null,
    Buffer.concat([RECEIPT_DOMAIN, payload]),
    parseKey(input.privateKeyPem, "private"),
  );
  return `${payload.toString("base64url")}.${signature.toString("base64url")}`;
}

export function verifyPreviewArtifactDeleteReceipt(input: {
  token: string;
  publicKeyPem: string | undefined;
  command: PreviewArtifactDeleteCommandClaims;
  now?: Date;
}): PreviewArtifactDeleteReceiptClaims {
  const decoded = decodeSignedPayload(input.token);
  let value: unknown;
  try {
    value = JSON.parse(decoded.payload.toString("utf8"));
  } catch {
    throw new PreviewArtifactGcCommandError(
      "PREVIEW_ARTIFACT_GC_RECEIPT_INVALID",
    );
  }
  const receipt = validateReceipt(value, input.now ?? new Date());
  if (
    !decoded.payload.equals(Buffer.from(canonicalReceipt(receipt), "utf8"))
  ) {
    throw new PreviewArtifactGcCommandError(
      "PREVIEW_ARTIFACT_GC_RECEIPT_INVALID",
    );
  }
  if (
    !verifySignature(
      null,
      Buffer.concat([RECEIPT_DOMAIN, decoded.payload]),
      parseKey(input.publicKeyPem, "public"),
      decoded.signature,
    )
  ) {
    throw new PreviewArtifactGcCommandError(
      "PREVIEW_ARTIFACT_GC_RECEIPT_SIGNATURE_INVALID",
    );
  }
  if (
    receipt.commandId !== input.command.commandId ||
    receipt.commandFingerprint !==
      previewArtifactDeleteCommandFingerprint(input.command) ||
    receipt.storeId !== input.command.storeId ||
    receipt.artifactRefId !== input.command.artifactRefId ||
    receipt.artifactDigest !== input.command.artifactDigest ||
    receipt.manifestDigest !== input.command.manifestDigest
  ) {
    throw new PreviewArtifactGcCommandError(
      "PREVIEW_ARTIFACT_GC_RECEIPT_INVALID",
    );
  }
  return Object.freeze(receipt);
}

function decodeSignedPayload(token: string): {
  payload: Buffer;
  signature: Buffer;
} {
  if (typeof token !== "string" || token.length > MAX_TOKEN_LENGTH) {
    throw new PreviewArtifactGcCommandError(
      "PREVIEW_ARTIFACT_GC_COMMAND_INVALID",
    );
  }
  const separator = token.indexOf(".");
  if (
    separator <= 0 ||
    separator !== token.lastIndexOf(".") ||
    !/^[A-Za-z0-9_-]+$/.test(token.slice(0, separator)) ||
    !/^[A-Za-z0-9_-]+$/.test(token.slice(separator + 1))
  ) {
    throw new PreviewArtifactGcCommandError(
      "PREVIEW_ARTIFACT_GC_COMMAND_INVALID",
    );
  }
  const payload = Buffer.from(token.slice(0, separator), "base64url");
  const signature = Buffer.from(token.slice(separator + 1), "base64url");
  if (
    payload.length > MAX_PAYLOAD_BYTES ||
    payload.toString("base64url") !== token.slice(0, separator) ||
    signature.length !== 64 ||
    signature.toString("base64url") !== token.slice(separator + 1)
  ) {
    throw new PreviewArtifactGcCommandError(
      "PREVIEW_ARTIFACT_GC_COMMAND_INVALID",
    );
  }
  return { payload, signature };
}
