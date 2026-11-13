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
  "EngineeringOS Preview Artifact Store Command v1\n",
  "utf8",
);
const RECEIPT_DOMAIN = Buffer.from(
  "EngineeringOS Preview Artifact Store Receipt v1\n",
  "utf8",
);
const POLL_PROOF_DOMAIN = Buffer.from(
  "EngineeringOS Preview Artifact Store Poll Proof v1\n",
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
  "sourceDigest",
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
  "nodeId",
  "keyVersion",
  "storeId",
  "artifactRefId",
  "artifactDigest",
  "sizeBytes",
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

export type PreviewArtifactStoreCommandClaims = {
  version: 1;
  action: "store-artifact";
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
  sourceDigest: string;
  artifactDigest: string;
  sizeBytes: number;
  manifestDigest: string;
  retentionPolicy: "preview-build-input-24h-v1";
  issuedAt: string;
  expiresAt: string;
};

export type PreviewArtifactStoreReceiptClaims = {
  version: 1;
  action: "artifact-store-receipt";
  commandId: string;
  commandFingerprint: string;
  nodeId: string;
  keyVersion: number;
  storeId: string;
  artifactRefId: string;
  artifactDigest: string;
  sizeBytes: number;
  manifestDigest: string;
  result: "stored" | "already_stored";
  completedAt: string;
};

export type PreviewArtifactStorePollProofClaims = {
  version: 1;
  action: "poll-artifact-store-command";
  nodeId: string;
  keyVersion: number;
  jobId: string;
  issuedAt: string;
  nonce: string;
};

declare const verifiedCommandBrand: unique symbol;
export type VerifiedPreviewArtifactStoreCommand =
  PreviewArtifactStoreCommandClaims & {
    readonly [verifiedCommandBrand]: true;
  };

declare const verifiedReceiptBrand: unique symbol;
export type VerifiedPreviewArtifactStoreReceipt =
  PreviewArtifactStoreReceiptClaims & {
    readonly [verifiedReceiptBrand]: true;
  };

const verifiedCommands = new WeakSet<object>();
const verifiedReceipts = new WeakSet<object>();

export class PreviewArtifactStoreCommandError extends Error {
  constructor(
    readonly code:
      | "PREVIEW_ARTIFACT_STORE_COMMAND_INVALID"
      | "PREVIEW_ARTIFACT_STORE_COMMAND_EXPIRED"
      | "PREVIEW_ARTIFACT_STORE_COMMAND_KEY_INVALID"
      | "PREVIEW_ARTIFACT_STORE_COMMAND_SIGNATURE_INVALID"
      | "PREVIEW_ARTIFACT_STORE_RECEIPT_INVALID"
      | "PREVIEW_ARTIFACT_STORE_RECEIPT_SIGNATURE_INVALID"
      | "PREVIEW_ARTIFACT_STORE_RECEIPT_EXPIRED",
  ) {
    super("Preview artifact storage authorization is invalid or unavailable.");
    this.name = "PreviewArtifactStoreCommandError";
  }
}

export class PreviewArtifactStorePollProofError extends Error {
  constructor(
    readonly code:
      | "PREVIEW_ARTIFACT_STORE_POLL_PROOF_INVALID"
      | "PREVIEW_ARTIFACT_STORE_POLL_PROOF_EXPIRED"
      | "PREVIEW_ARTIFACT_STORE_POLL_PROOF_SIGNATURE_INVALID",
  ) {
    super("Preview artifact command poll proof is invalid or unavailable.");
    this.name = "PreviewArtifactStorePollProofError";
  }
}

function parseKey(
  pem: string | undefined,
  kind: "private" | "public",
): KeyObject {
  if (!pem || pem.length > 16_384 || !pem.includes("-----BEGIN")) {
    throw new PreviewArtifactStoreCommandError(
      "PREVIEW_ARTIFACT_STORE_COMMAND_KEY_INVALID",
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
    throw new PreviewArtifactStoreCommandError(
      "PREVIEW_ARTIFACT_STORE_COMMAND_KEY_INVALID",
    );
  }
}

function canonicalTimestamp(value: unknown): value is string {
  return (
    typeof value === "string" &&
    /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value) &&
    Number.isFinite(Date.parse(value)) &&
    new Date(value).toISOString() === value
  );
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

function canonicalCommand(
  command: PreviewArtifactStoreCommandClaims,
): string {
  return JSON.stringify(
    Object.fromEntries(COMMAND_FIELDS.map((field) => [field, command[field]])),
  );
}

function canonicalReceipt(
  receipt: PreviewArtifactStoreReceiptClaims,
): string {
  return JSON.stringify(
    Object.fromEntries(RECEIPT_FIELDS.map((field) => [field, receipt[field]])),
  );
}

function canonicalPollProof(
  proof: PreviewArtifactStorePollProofClaims,
): string {
  return JSON.stringify(
    Object.fromEntries(POLL_PROOF_FIELDS.map((field) => [field, proof[field]])),
  );
}

function validatePollProof(
  value: unknown,
  now: Date,
): PreviewArtifactStorePollProofClaims {
  if (
    !value ||
    typeof value !== "object" ||
    Array.isArray(value) ||
    !Number.isFinite(now.getTime())
  ) {
    throw new PreviewArtifactStorePollProofError(
      "PREVIEW_ARTIFACT_STORE_POLL_PROOF_INVALID",
    );
  }
  const record = value as Record<string, unknown>;
  if (
    Object.keys(record).length !== POLL_PROOF_FIELDS.length ||
    POLL_PROOF_FIELDS.some((field) => !(field in record)) ||
    record.version !== 1 ||
    record.action !== "poll-artifact-store-command" ||
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
    throw new PreviewArtifactStorePollProofError(
      "PREVIEW_ARTIFACT_STORE_POLL_PROOF_INVALID",
    );
  }
  const issuedAt = Date.parse(record.issuedAt);
  if (
    issuedAt > now.getTime() + CLOCK_SKEW_MS ||
    now.getTime() - issuedAt > MAX_POLL_PROOF_AGE_MS
  ) {
    throw new PreviewArtifactStorePollProofError(
      "PREVIEW_ARTIFACT_STORE_POLL_PROOF_EXPIRED",
    );
  }
  return Object.fromEntries(
    POLL_PROOF_FIELDS.map((field) => [field, record[field]]),
  ) as PreviewArtifactStorePollProofClaims;
}

function validateCommand(
  value: unknown,
  now: Date,
): PreviewArtifactStoreCommandClaims {
  if (
    !value ||
    typeof value !== "object" ||
    Array.isArray(value) ||
    !Number.isFinite(now.getTime())
  ) {
    throw new PreviewArtifactStoreCommandError(
      "PREVIEW_ARTIFACT_STORE_COMMAND_INVALID",
    );
  }
  const record = value as Record<string, unknown>;
  if (
    Object.keys(record).length !== COMMAND_FIELDS.length ||
    COMMAND_FIELDS.some((field) => !(field in record)) ||
    record.version !== 1 ||
    record.action !== "store-artifact" ||
    typeof record.commandId !== "string" ||
    !UUID_PATTERN.test(record.commandId) ||
    typeof record.nodeId !== "string" ||
    !UUID_PATTERN.test(record.nodeId) ||
    !Number.isSafeInteger(record.keyVersion) ||
    (record.keyVersion as number) < 1 ||
    typeof record.storeId !== "string" ||
    !UUID_PATTERN.test(record.storeId) ||
    typeof record.artifactRefId !== "string" ||
    !UUID_PATTERN.test(record.artifactRefId) ||
    typeof record.jobId !== "string" ||
    !UUID_PATTERN.test(record.jobId) ||
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
    typeof record.sourceDigest !== "string" ||
    !HASH_PATTERN.test(record.sourceDigest) ||
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
    throw new PreviewArtifactStoreCommandError(
      "PREVIEW_ARTIFACT_STORE_COMMAND_INVALID",
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
    throw new PreviewArtifactStoreCommandError(
      "PREVIEW_ARTIFACT_STORE_COMMAND_EXPIRED",
    );
  }
  return Object.fromEntries(
    COMMAND_FIELDS.map((field) => [field, record[field]]),
  ) as PreviewArtifactStoreCommandClaims;
}

function validateReceipt(
  value: unknown,
  now: Date,
): PreviewArtifactStoreReceiptClaims {
  if (
    !value ||
    typeof value !== "object" ||
    Array.isArray(value) ||
    !Number.isFinite(now.getTime())
  ) {
    throw new PreviewArtifactStoreCommandError(
      "PREVIEW_ARTIFACT_STORE_RECEIPT_INVALID",
    );
  }
  const record = value as Record<string, unknown>;
  if (
    Object.keys(record).length !== RECEIPT_FIELDS.length ||
    RECEIPT_FIELDS.some((field) => !(field in record)) ||
    record.version !== 1 ||
    record.action !== "artifact-store-receipt" ||
    typeof record.commandId !== "string" ||
    !UUID_PATTERN.test(record.commandId) ||
    typeof record.commandFingerprint !== "string" ||
    !HASH_PATTERN.test(record.commandFingerprint) ||
    typeof record.nodeId !== "string" ||
    !UUID_PATTERN.test(record.nodeId) ||
    !Number.isSafeInteger(record.keyVersion) ||
    (record.keyVersion as number) < 1 ||
    typeof record.storeId !== "string" ||
    !UUID_PATTERN.test(record.storeId) ||
    typeof record.artifactRefId !== "string" ||
    !UUID_PATTERN.test(record.artifactRefId) ||
    typeof record.artifactDigest !== "string" ||
    !HASH_PATTERN.test(record.artifactDigest) ||
    !Number.isSafeInteger(record.sizeBytes) ||
    (record.sizeBytes as number) < 1 ||
    (record.sizeBytes as number) > MAX_PREVIEW_BUILD_ARCHIVE_BYTES ||
    typeof record.manifestDigest !== "string" ||
    !HASH_PATTERN.test(record.manifestDigest) ||
    (record.result !== "stored" && record.result !== "already_stored") ||
    !canonicalTimestamp(record.completedAt)
  ) {
    throw new PreviewArtifactStoreCommandError(
      "PREVIEW_ARTIFACT_STORE_RECEIPT_INVALID",
    );
  }
  const completedAt = Date.parse(record.completedAt);
  if (
    completedAt > now.getTime() + CLOCK_SKEW_MS ||
    now.getTime() - completedAt > MAX_RECEIPT_AGE_MS
  ) {
    throw new PreviewArtifactStoreCommandError(
      "PREVIEW_ARTIFACT_STORE_RECEIPT_EXPIRED",
    );
  }
  return Object.fromEntries(
    RECEIPT_FIELDS.map((field) => [field, record[field]]),
  ) as PreviewArtifactStoreReceiptClaims;
}

export function previewArtifactStoreCommandFingerprint(
  command: PreviewArtifactStoreCommandClaims,
): string {
  const semanticClaims = Object.fromEntries(
    COMMAND_FIELDS.filter(
      (field) => field !== "issuedAt" && field !== "expiresAt",
    ).map((field) => [field, command[field]]),
  );
  return createHash("sha256")
    .update("EngineeringOS Preview Artifact Store Fingerprint v1\n")
    .update(JSON.stringify(semanticClaims))
    .digest("hex");
}

export function previewArtifactStoreCommandPublicKeyPem(
  privateKeyPem: string | undefined,
): string {
  return createPublicKey(parseKey(privateKeyPem, "private"))
    .export({ type: "spki", format: "pem" })
    .toString();
}

export function signPreviewArtifactStorePollProof(input: {
  proof: PreviewArtifactStorePollProofClaims;
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

export function verifyPreviewArtifactStorePollProof(input: {
  proof: unknown;
  signature: string;
  publicKeyPem: string | undefined;
  now?: Date;
}): PreviewArtifactStorePollProofClaims {
  const proof = validatePollProof(input.proof, input.now ?? new Date());
  if (
    typeof input.signature !== "string" ||
    !/^[A-Za-z0-9_-]{86}$/.test(input.signature)
  ) {
    throw new PreviewArtifactStorePollProofError(
      "PREVIEW_ARTIFACT_STORE_POLL_PROOF_INVALID",
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
    throw new PreviewArtifactStorePollProofError(
      "PREVIEW_ARTIFACT_STORE_POLL_PROOF_SIGNATURE_INVALID",
    );
  }
  return Object.freeze(proof);
}

export function signPreviewArtifactStoreCommand(input: {
  command: PreviewArtifactStoreCommandClaims;
  privateKeyPem: string | undefined;
  now?: Date;
}): string {
  const command = validateCommand(input.command, input.now ?? new Date());
  const payload = Buffer.from(canonicalCommand(command), "utf8");
  const signature = signSignature(
    null,
    Buffer.concat([COMMAND_DOMAIN, payload]),
    parseKey(input.privateKeyPem, "private"),
  );
  return `${payload.toString("base64url")}.${signature.toString("base64url")}`;
}

export function verifyPreviewArtifactStoreCommand(input: {
  token: string;
  publicKeyPem: string | undefined;
  now?: Date;
}): VerifiedPreviewArtifactStoreCommand {
  const payload = decodeSignedPayload(input.token);
  let value: unknown;
  try {
    value = JSON.parse(payload.payload.toString("utf8"));
  } catch {
    throw new PreviewArtifactStoreCommandError(
      "PREVIEW_ARTIFACT_STORE_COMMAND_INVALID",
    );
  }
  const command = validateCommand(value, input.now ?? new Date());
  const canonical = Buffer.from(canonicalCommand(command), "utf8");
  if (
    !payload.payload.equals(canonical) ||
    !verifySignature(
      null,
      Buffer.concat([COMMAND_DOMAIN, canonical]),
      parseKey(input.publicKeyPem, "public"),
      payload.signature,
    )
  ) {
    throw new PreviewArtifactStoreCommandError(
      "PREVIEW_ARTIFACT_STORE_COMMAND_SIGNATURE_INVALID",
    );
  }
  const verified = Object.freeze(command) as VerifiedPreviewArtifactStoreCommand;
  verifiedCommands.add(verified);
  return verified;
}

export function signPreviewArtifactStoreReceipt(input: {
  receipt: PreviewArtifactStoreReceiptClaims;
  privateKeyPem: string | undefined;
  now?: Date;
}): string {
  const receipt = validateReceipt(input.receipt, input.now ?? new Date());
  const payload = Buffer.from(canonicalReceipt(receipt), "utf8");
  const signature = signSignature(
    null,
    Buffer.concat([RECEIPT_DOMAIN, payload]),
    parseKey(input.privateKeyPem, "private"),
  );
  return `${payload.toString("base64url")}.${signature.toString("base64url")}`;
}

export function verifyPreviewArtifactStoreReceipt(input: {
  token: string;
  publicKeyPem: string | undefined;
  command: VerifiedPreviewArtifactStoreCommand;
  now?: Date;
}): VerifiedPreviewArtifactStoreReceipt {
  if (!verifiedCommands.has(input.command)) {
    throw new PreviewArtifactStoreCommandError(
      "PREVIEW_ARTIFACT_STORE_RECEIPT_INVALID",
    );
  }
  const now = input.now ?? new Date();
  const payload = decodeSignedPayload(input.token);
  let value: unknown;
  try {
    value = JSON.parse(payload.payload.toString("utf8"));
  } catch {
    throw new PreviewArtifactStoreCommandError(
      "PREVIEW_ARTIFACT_STORE_RECEIPT_INVALID",
    );
  }
  const receipt = validateReceipt(value, now);
  const canonical = Buffer.from(canonicalReceipt(receipt), "utf8");
  if (!payload.payload.equals(canonical)) {
    throw new PreviewArtifactStoreCommandError(
      "PREVIEW_ARTIFACT_STORE_RECEIPT_INVALID",
    );
  }
  if (
    !verifySignature(
      null,
      Buffer.concat([RECEIPT_DOMAIN, canonical]),
      parseKey(input.publicKeyPem, "public"),
      payload.signature,
    )
  ) {
    throw new PreviewArtifactStoreCommandError(
      "PREVIEW_ARTIFACT_STORE_RECEIPT_SIGNATURE_INVALID",
    );
  }
  const completedAt = Date.parse(receipt.completedAt);
  if (
    receipt.commandId !== input.command.commandId ||
    receipt.commandFingerprint !==
      previewArtifactStoreCommandFingerprint(input.command) ||
    receipt.nodeId !== input.command.nodeId ||
    receipt.keyVersion !== input.command.keyVersion ||
    receipt.storeId !== input.command.storeId ||
    receipt.artifactRefId !== input.command.artifactRefId ||
    receipt.artifactDigest !== input.command.artifactDigest ||
    receipt.sizeBytes !== input.command.sizeBytes ||
    receipt.manifestDigest !== input.command.manifestDigest ||
    completedAt <
      Date.parse(input.command.issuedAt) - CLOCK_SKEW_MS ||
    completedAt >
      Date.parse(input.command.expiresAt) + CLOCK_SKEW_MS
  ) {
    throw new PreviewArtifactStoreCommandError(
      "PREVIEW_ARTIFACT_STORE_RECEIPT_INVALID",
    );
  }
  const verified = Object.freeze(receipt) as VerifiedPreviewArtifactStoreReceipt;
  verifiedReceipts.add(verified);
  return verified;
}

export function isVerifiedPreviewArtifactStoreReceipt(
  value: unknown,
): value is VerifiedPreviewArtifactStoreReceipt {
  return value !== null && typeof value === "object" && verifiedReceipts.has(value);
}

function decodeSignedPayload(token: string): {
  payload: Buffer;
  signature: Buffer;
} {
  if (typeof token !== "string" || token.length > MAX_TOKEN_LENGTH) {
    throw new PreviewArtifactStoreCommandError(
      "PREVIEW_ARTIFACT_STORE_COMMAND_INVALID",
    );
  }
  const separator = token.indexOf(".");
  if (
    separator <= 0 ||
    separator !== token.lastIndexOf(".") ||
    !/^[A-Za-z0-9_-]+$/.test(token.slice(0, separator)) ||
    !/^[A-Za-z0-9_-]+$/.test(token.slice(separator + 1))
  ) {
    throw new PreviewArtifactStoreCommandError(
      "PREVIEW_ARTIFACT_STORE_COMMAND_INVALID",
    );
  }
  const encodedPayload = token.slice(0, separator);
  const encodedSignature = token.slice(separator + 1);
  const payload = Buffer.from(encodedPayload, "base64url");
  const signature = Buffer.from(encodedSignature, "base64url");
  if (
    payload.length > MAX_PAYLOAD_BYTES ||
    payload.toString("base64url") !== encodedPayload ||
    signature.length !== 64 ||
    signature.toString("base64url") !== encodedSignature
  ) {
    throw new PreviewArtifactStoreCommandError(
      "PREVIEW_ARTIFACT_STORE_COMMAND_INVALID",
    );
  }
  return { payload, signature };
}
