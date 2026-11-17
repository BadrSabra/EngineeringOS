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
  "EngineeringOS Preview Artifact Delete Command v2\n",
  "utf8",
);
const RECEIPT_DOMAIN = Buffer.from(
  "EngineeringOS Preview Artifact Delete Receipt v2\n",
  "utf8",
);
const POLL_PROOF_DOMAIN = Buffer.from(
  "EngineeringOS Preview Artifact Delete Poll Proof v2\n",
  "utf8",
);
const MAX_TOKEN_LENGTH = 8_192;
const MAX_PAYLOAD_BYTES = 6_144;
const MAX_COMMAND_TTL_MS = 60_000;
const MAX_RECEIPT_AGE_MS = 5 * 60_000;
const MAX_POLL_PROOF_AGE_MS = 30_000;
const CLOCK_SKEW_MS = 5_000;
const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const HASH_PATTERN = /^[a-f0-9]{64}$/i;

const COMMAND_FIELDS = [
  "version",
  "action",
  "commandId",
  "nodeId",
  "keyVersion",
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
  "gcLeaseAt",
  "issuedAt",
  "expiresAt",
] as const;

const RECEIPT_FIELDS = [
  "version",
  "action",
  "commandId",
  "commandFingerprint",
  "nodeId",
  "keyVersion",
  "storeId",
  "artifactRefId",
  "artifactDigest",
  "manifestDigest",
  "result",
  "completedAt",
] as const;

const POLL_PROOF_FIELDS = [
  "version",
  "action",
  "nodeId",
  "keyVersion",
  "jobId",
  "issuedAt",
  "nonce",
] as const;

export type PreviewArtifactDeleteCommandClaims = {
  version: 2;
  action: "delete-artifact";
  commandId: string;
  nodeId: string;
  keyVersion: number;
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
  gcLeaseAt: string;
  issuedAt: string;
  expiresAt: string;
};

export type PreviewArtifactDeleteReceiptClaims = {
  version: 2;
  action: "artifact-delete-receipt";
  commandId: string;
  commandFingerprint: string;
  nodeId: string;
  keyVersion: number;
  storeId: string;
  artifactRefId: string;
  artifactDigest: string;
  manifestDigest: string;
  result: "deleted" | "already_deleted";
  completedAt: string;
};

export type PreviewArtifactDeletePollProofClaims = {
  version: 2;
  action: "poll-artifact-delete-command";
  nodeId: string;
  keyVersion: number;
  jobId: string;
  issuedAt: string;
  nonce: string;
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
      | "PREVIEW_ARTIFACT_GC_RECEIPT_EXPIRED"
      | "PREVIEW_ARTIFACT_GC_POLL_PROOF_INVALID"
      | "PREVIEW_ARTIFACT_GC_POLL_PROOF_SIGNATURE_INVALID"
      | "PREVIEW_ARTIFACT_GC_POLL_PROOF_EXPIRED",
  ) {
    super("Preview artifact delete authorization is invalid or unavailable.");
    this.name = "PreviewArtifactGcCommandError";
  }
}

function canonicalPollProof(
  proof: PreviewArtifactDeletePollProofClaims,
): string {
  return JSON.stringify(
    Object.fromEntries(
      POLL_PROOF_FIELDS.map((field) => [field, proof[field]]),
    ),
  );
}

function validatePollProof(
  value: unknown,
  now: Date,
): PreviewArtifactDeletePollProofClaims {
  if (
    !value ||
    typeof value !== "object" ||
    Array.isArray(value) ||
    !Number.isFinite(now.getTime())
  ) {
    throw new PreviewArtifactGcCommandError(
      "PREVIEW_ARTIFACT_GC_POLL_PROOF_INVALID",
    );
  }
  const record = value as Record<string, unknown>;
  if (
    Object.keys(record).length !== POLL_PROOF_FIELDS.length ||
    POLL_PROOF_FIELDS.some((field) => !(field in record)) ||
    record.version !== 2 ||
    record.action !== "poll-artifact-delete-command" ||
    typeof record.nodeId !== "string" ||
    !UUID_PATTERN.test(record.nodeId) ||
    !Number.isSafeInteger(record.keyVersion) ||
    (record.keyVersion as number) < 1 ||
    typeof record.jobId !== "string" ||
    !UUID_PATTERN.test(record.jobId) ||
    !canonicalTimestamp(record.issuedAt) ||
    typeof record.nonce !== "string" ||
    !UUID_PATTERN.test(record.nonce)
  ) {
    throw new PreviewArtifactGcCommandError(
      "PREVIEW_ARTIFACT_GC_POLL_PROOF_INVALID",
    );
  }
  const issuedAt = Date.parse(record.issuedAt);
  if (
    issuedAt > now.getTime() + CLOCK_SKEW_MS ||
    now.getTime() - issuedAt > MAX_POLL_PROOF_AGE_MS
  ) {
    throw new PreviewArtifactGcCommandError(
      "PREVIEW_ARTIFACT_GC_POLL_PROOF_EXPIRED",
    );
  }
  return Object.fromEntries(
    POLL_PROOF_FIELDS.map((field) => [field, record[field]]),
  ) as PreviewArtifactDeletePollProofClaims;
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

export function previewArtifactDeleteCommandId(input: {
  nodeId: string;
  keyVersion: number;
  jobId: string;
  artifactRefId: string;
  gcLeaseAt: string;
}): string {
  if (
    !UUID_PATTERN.test(input.nodeId) ||
    !Number.isSafeInteger(input.keyVersion) ||
    input.keyVersion < 1 ||
    !UUID_PATTERN.test(input.jobId) ||
    !UUID_PATTERN.test(input.artifactRefId) ||
    !canonicalTimestamp(input.gcLeaseAt)
  ) {
    throw new PreviewArtifactGcCommandError(
      "PREVIEW_ARTIFACT_GC_COMMAND_INVALID",
    );
  }
  const bytes = createHash("sha256")
    .update("EngineeringOS Preview Artifact Delete Command ID v2\n")
    .update(input.nodeId.toLowerCase(), "utf8")
    .update("\n")
    .update(String(input.keyVersion), "utf8")
    .update("\n")
    .update(input.jobId.toLowerCase(), "utf8")
    .update("\n")
    .update(input.artifactRefId.toLowerCase(), "utf8")
    .update("\n")
    .update(input.gcLeaseAt, "utf8")
    .digest()
    .subarray(0, 16);
  bytes[6] = (bytes[6]! & 0x0f) | 0x80;
  bytes[8] = (bytes[8]! & 0x3f) | 0x80;
  const hex = bytes.toString("hex");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
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
    record.version !== 2 ||
    record.action !== "delete-artifact" ||
    !boundedText(record.commandId, 36) ||
    !UUID_PATTERN.test(String(record.commandId)) ||
    !boundedText(record.nodeId, 36) ||
    !UUID_PATTERN.test(String(record.nodeId)) ||
    !Number.isSafeInteger(record.keyVersion) ||
    (record.keyVersion as number) < 1 ||
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
    !canonicalTimestamp(record.gcLeaseAt) ||
    !canonicalTimestamp(record.issuedAt) ||
    !canonicalTimestamp(record.expiresAt)
  ) {
    throw new PreviewArtifactGcCommandError(
      "PREVIEW_ARTIFACT_GC_COMMAND_INVALID",
    );
  }

  const issuedAt = Date.parse(record.issuedAt);
  const expiresAt = Date.parse(record.expiresAt);
  const gcLeaseAt = Date.parse(record.gcLeaseAt);
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
  if (
    gcLeaseAt > issuedAt + CLOCK_SKEW_MS ||
    record.commandId !==
      previewArtifactDeleteCommandId({
        nodeId: record.nodeId as string,
        keyVersion: record.keyVersion as number,
        jobId: record.jobId as string,
        artifactRefId: record.artifactRefId as string,
        gcLeaseAt: record.gcLeaseAt,
      })
  ) {
    throw new PreviewArtifactGcCommandError(
      "PREVIEW_ARTIFACT_GC_COMMAND_INVALID",
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
    record.version !== 2 ||
    record.action !== "artifact-delete-receipt" ||
    !boundedText(record.commandId, 36) ||
    !UUID_PATTERN.test(String(record.commandId)) ||
    typeof record.commandFingerprint !== "string" ||
    !HASH_PATTERN.test(record.commandFingerprint) ||
    !boundedText(record.nodeId, 36) ||
    !UUID_PATTERN.test(String(record.nodeId)) ||
    !Number.isSafeInteger(record.keyVersion) ||
    (record.keyVersion as number) < 1 ||
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

export function previewArtifactDeleteCommandPublicKeyPem(
  privateKeyPem: string | undefined,
): string {
  return createPublicKey(parseKey(privateKeyPem, "private"))
    .export({ type: "spki", format: "pem" })
    .toString();
}

export function signPreviewArtifactDeletePollProof(input: {
  proof: PreviewArtifactDeletePollProofClaims;
  privateKeyPem: string | undefined;
  now?: Date;
}): string {
  const proof = validatePollProof(input.proof, input.now ?? new Date());
  const payload = Buffer.from(canonicalPollProof(proof), "utf8");
  return signSignature(
    null,
    Buffer.concat([POLL_PROOF_DOMAIN, payload]),
    parseKey(input.privateKeyPem, "private"),
  ).toString("base64url");
}

export function verifyPreviewArtifactDeletePollProof(input: {
  proof: unknown;
  signature: string;
  publicKeyPem: string | undefined;
  now?: Date;
}): PreviewArtifactDeletePollProofClaims {
  const proof = validatePollProof(input.proof, input.now ?? new Date());
  if (
    typeof input.signature !== "string" ||
    !/^[A-Za-z0-9_-]{86}$/.test(input.signature)
  ) {
    throw new PreviewArtifactGcCommandError(
      "PREVIEW_ARTIFACT_GC_POLL_PROOF_INVALID",
    );
  }
  const signature = Buffer.from(input.signature, "base64url");
  const payload = Buffer.from(canonicalPollProof(proof), "utf8");
  if (
    signature.length !== 64 ||
    signature.toString("base64url") !== input.signature ||
    !verifySignature(
      null,
      Buffer.concat([POLL_PROOF_DOMAIN, payload]),
      parseKey(input.publicKeyPem, "public"),
      signature,
    )
  ) {
    throw new PreviewArtifactGcCommandError(
      "PREVIEW_ARTIFACT_GC_POLL_PROOF_SIGNATURE_INVALID",
    );
  }
  return Object.freeze(proof);
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

/**
 * Returns only an untrusted timestamp hint so receipt acceptance can verify a
 * command against the time the owner claims it completed. The caller must still
 * verify the receipt signature before accepting any state change.
 */
export function previewArtifactDeleteReceiptCompletedAtHint(
  token: string,
): Date {
  let decoded: ReturnType<typeof decodeSignedPayload>;
  try {
    decoded = decodeSignedPayload(token);
  } catch {
    throw new PreviewArtifactGcCommandError(
      "PREVIEW_ARTIFACT_GC_RECEIPT_INVALID",
    );
  }
  let value: unknown;
  try {
    value = JSON.parse(decoded.payload.toString("utf8"));
  } catch {
    throw new PreviewArtifactGcCommandError(
      "PREVIEW_ARTIFACT_GC_RECEIPT_INVALID",
    );
  }
  if (
    !value ||
    typeof value !== "object" ||
    Array.isArray(value) ||
    !canonicalTimestamp((value as Record<string, unknown>).completedAt)
  ) {
    throw new PreviewArtifactGcCommandError(
      "PREVIEW_ARTIFACT_GC_RECEIPT_INVALID",
    );
  }
  return new Date((value as Record<string, string>).completedAt);
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
    receipt.nodeId !== input.command.nodeId ||
    receipt.keyVersion !== input.command.keyVersion ||
    receipt.storeId !== input.command.storeId ||
    receipt.artifactRefId !== input.command.artifactRefId ||
    receipt.artifactDigest !== input.command.artifactDigest ||
    receipt.manifestDigest !== input.command.manifestDigest ||
    Date.parse(receipt.completedAt) <
      Date.parse(input.command.issuedAt) - CLOCK_SKEW_MS ||
    Date.parse(receipt.completedAt) >
      Date.parse(input.command.expiresAt) + CLOCK_SKEW_MS
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
