import {
  createHash,
  createPrivateKey,
  createPublicKey,
  sign as signBytes,
  verify as verifyBytes,
  type KeyObject,
} from "node:crypto";

export const MAX_PREVIEW_ARTIFACT_SIZE_BYTES = 55 * 1024 * 1024;

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
const SIGNATURE_PATTERN = /^[A-Za-z0-9_-]{86}$/;

const COMMAND_FIELDS = [
  "version", "action", "commandId", "nodeId", "keyVersion", "storeId",
  "artifactRefId", "jobId", "projectId", "proposalId", "operationId",
  "proposalRevision", "candidateRevision", "changeSetHash", "artifactKind",
  "artifactDigest", "sizeBytes", "manifestDigest", "retentionPolicy",
  "gcLeaseAt", "issuedAt", "expiresAt",
] as const;
const RECEIPT_FIELDS = [
  "version", "action", "commandId", "commandFingerprint", "nodeId",
  "keyVersion", "storeId", "artifactRefId", "artifactDigest",
  "manifestDigest", "result", "completedAt",
] as const;
const POLL_PROOF_FIELDS = [
  "version", "action", "nodeId", "keyVersion", "jobId", "issuedAt", "nonce",
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

/**
 * Local, reference-only storage capability required by the Preview Agent.
 * The implementation must validate its own store identity and immutable
 * manifest before removing a reference; it must never accept filesystem paths
 * from a signed command or remove a shared content blob.
 */
export interface PreviewAgentArtifactReferenceStore {
  readonly storeId: string;
  removeReference(input: {
    storeId: string;
    jobId: string;
    artifactRefId: string;
    projectId: string;
    proposalId: string;
    operationId: string;
    proposalRevision: number;
    candidateRevision: string;
    changeSetHash: string;
    expectedDigest: string;
    expectedSizeBytes: number;
    expectedManifestDigest: string;
  }): Promise<"deleted" | "already_deleted">;
}

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

function fail(
  code: ConstructorParameters<typeof PreviewArtifactGcCommandError>[0],
): never {
  throw new PreviewArtifactGcCommandError(code);
}

function canonicalTimestamp(value: unknown): value is string {
  return typeof value === "string" &&
    /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value) &&
    Number.isFinite(Date.parse(value)) &&
    new Date(value).toISOString() === value;
}

function boundedText(value: unknown, maxLength: number): value is string {
  return typeof value === "string" && value.length > 0 &&
    value.length <= maxLength && value.trim() === value &&
    !/[\u0000-\u001f\u007f]/.test(value);
}

function parseKey(pem: string | undefined, kind: "private" | "public"): KeyObject {
  if (!pem || pem.length > 16_384 || !pem.includes("-----BEGIN")) {
    return fail("PREVIEW_ARTIFACT_GC_COMMAND_KEY_INVALID");
  }
  try {
    const key = kind === "private"
      ? createPrivateKey(pem.replace(/\\n/g, "\n"))
      : createPublicKey(pem.replace(/\\n/g, "\n"));
    if (key.asymmetricKeyType !== "ed25519") throw new Error("key type");
    return key;
  } catch {
    return fail("PREVIEW_ARTIFACT_GC_COMMAND_KEY_INVALID");
  }
}

function exactRecord(
  value: unknown,
  fields: readonly string[],
  code: "PREVIEW_ARTIFACT_GC_COMMAND_INVALID" |
    "PREVIEW_ARTIFACT_GC_RECEIPT_INVALID" |
    "PREVIEW_ARTIFACT_GC_POLL_PROOF_INVALID",
): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return fail(code);
  const record = value as Record<string, unknown>;
  if (Object.keys(record).length !== fields.length ||
      fields.some((field) => !(field in record))) return fail(code);
  return record;
}

function canonical(
  record: Record<string, unknown>,
  fields: readonly string[],
): string {
  return JSON.stringify(Object.fromEntries(fields.map((field) => [field, record[field]])));
}

function signedPayload(token: string): { payload: Buffer; signature: Buffer } {
  if (typeof token !== "string" || token.length > MAX_TOKEN_LENGTH) {
    return fail("PREVIEW_ARTIFACT_GC_COMMAND_INVALID");
  }
  const separator = token.indexOf(".");
  if (separator <= 0 || separator !== token.lastIndexOf(".") ||
      !/^[A-Za-z0-9_-]+$/.test(token.slice(0, separator)) ||
      !/^[A-Za-z0-9_-]+$/.test(token.slice(separator + 1))) {
    return fail("PREVIEW_ARTIFACT_GC_COMMAND_INVALID");
  }
  const payload = Buffer.from(token.slice(0, separator), "base64url");
  const signature = Buffer.from(token.slice(separator + 1), "base64url");
  if (payload.length > MAX_PAYLOAD_BYTES ||
      payload.toString("base64url") !== token.slice(0, separator) ||
      signature.length !== 64 ||
      signature.toString("base64url") !== token.slice(separator + 1)) {
    return fail("PREVIEW_ARTIFACT_GC_COMMAND_INVALID");
  }
  return { payload, signature };
}

function validateCommand(value: unknown, now: Date): PreviewArtifactDeleteCommandClaims {
  if (!Number.isFinite(now.getTime())) return fail("PREVIEW_ARTIFACT_GC_COMMAND_INVALID");
  const r = exactRecord(value, COMMAND_FIELDS, "PREVIEW_ARTIFACT_GC_COMMAND_INVALID");
  if (
    r.version !== 2 || r.action !== "delete-artifact" ||
    !boundedText(r.commandId, 36) || !UUID_PATTERN.test(String(r.commandId)) ||
    !boundedText(r.nodeId, 36) || !UUID_PATTERN.test(String(r.nodeId)) ||
    !Number.isSafeInteger(r.keyVersion) || (r.keyVersion as number) < 1 ||
    !boundedText(r.storeId, 36) || !UUID_PATTERN.test(String(r.storeId)) ||
    !boundedText(r.artifactRefId, 36) || !UUID_PATTERN.test(String(r.artifactRefId)) ||
    !boundedText(r.jobId, 36) || !UUID_PATTERN.test(String(r.jobId)) ||
    !boundedText(r.projectId, 255) || !boundedText(r.proposalId, 255) ||
    !boundedText(r.operationId, 255) ||
    !Number.isSafeInteger(r.proposalRevision) || (r.proposalRevision as number) < 0 ||
    typeof r.candidateRevision !== "string" || !HASH_PATTERN.test(r.candidateRevision) ||
    typeof r.changeSetHash !== "string" || !HASH_PATTERN.test(r.changeSetHash) ||
    r.artifactKind !== "preview-build-input" ||
    typeof r.artifactDigest !== "string" || !HASH_PATTERN.test(r.artifactDigest) ||
    !Number.isSafeInteger(r.sizeBytes) || (r.sizeBytes as number) < 1 ||
    (r.sizeBytes as number) > MAX_PREVIEW_ARTIFACT_SIZE_BYTES ||
    typeof r.manifestDigest !== "string" || !HASH_PATTERN.test(r.manifestDigest) ||
    r.retentionPolicy !== "preview-build-input-24h-v1" ||
    !canonicalTimestamp(r.gcLeaseAt) || !canonicalTimestamp(r.issuedAt) ||
    !canonicalTimestamp(r.expiresAt)
  ) return fail("PREVIEW_ARTIFACT_GC_COMMAND_INVALID");

  const issued = Date.parse(r.issuedAt as string);
  const expires = Date.parse(r.expiresAt as string);
  if (issued > now.getTime() + CLOCK_SKEW_MS || expires <= now.getTime() ||
      expires <= issued || expires - issued > MAX_COMMAND_TTL_MS) {
    return fail("PREVIEW_ARTIFACT_GC_COMMAND_EXPIRED");
  }
  if (Date.parse(r.gcLeaseAt as string) > issued + CLOCK_SKEW_MS ||
      r.commandId !== previewArtifactDeleteCommandId({
        nodeId: r.nodeId as string,
        keyVersion: r.keyVersion as number,
        jobId: r.jobId as string,
        artifactRefId: r.artifactRefId as string,
        gcLeaseAt: r.gcLeaseAt as string,
      })) return fail("PREVIEW_ARTIFACT_GC_COMMAND_INVALID");
  return Object.fromEntries(COMMAND_FIELDS.map((field) => [field, r[field]])) as
    PreviewArtifactDeleteCommandClaims;
}

function validateReceipt(value: unknown, now: Date): PreviewArtifactDeleteReceiptClaims {
  if (!Number.isFinite(now.getTime())) return fail("PREVIEW_ARTIFACT_GC_RECEIPT_INVALID");
  const r = exactRecord(value, RECEIPT_FIELDS, "PREVIEW_ARTIFACT_GC_RECEIPT_INVALID");
  if (
    r.version !== 2 || r.action !== "artifact-delete-receipt" ||
    !boundedText(r.commandId, 36) || !UUID_PATTERN.test(String(r.commandId)) ||
    typeof r.commandFingerprint !== "string" || !HASH_PATTERN.test(r.commandFingerprint) ||
    !boundedText(r.nodeId, 36) || !UUID_PATTERN.test(String(r.nodeId)) ||
    !Number.isSafeInteger(r.keyVersion) || (r.keyVersion as number) < 1 ||
    !boundedText(r.storeId, 36) || !UUID_PATTERN.test(String(r.storeId)) ||
    !boundedText(r.artifactRefId, 36) || !UUID_PATTERN.test(String(r.artifactRefId)) ||
    typeof r.artifactDigest !== "string" || !HASH_PATTERN.test(r.artifactDigest) ||
    typeof r.manifestDigest !== "string" || !HASH_PATTERN.test(r.manifestDigest) ||
    (r.result !== "deleted" && r.result !== "already_deleted") ||
    !canonicalTimestamp(r.completedAt)
  ) return fail("PREVIEW_ARTIFACT_GC_RECEIPT_INVALID");
  const completed = Date.parse(r.completedAt as string);
  if (completed > now.getTime() + CLOCK_SKEW_MS ||
      now.getTime() - completed > MAX_RECEIPT_AGE_MS) {
    return fail("PREVIEW_ARTIFACT_GC_RECEIPT_EXPIRED");
  }
  return Object.fromEntries(RECEIPT_FIELDS.map((field) => [field, r[field]])) as
    PreviewArtifactDeleteReceiptClaims;
}

function validatePollProof(value: unknown, now: Date): PreviewArtifactDeletePollProofClaims {
  if (!Number.isFinite(now.getTime())) return fail("PREVIEW_ARTIFACT_GC_POLL_PROOF_INVALID");
  const r = exactRecord(value, POLL_PROOF_FIELDS, "PREVIEW_ARTIFACT_GC_POLL_PROOF_INVALID");
  if (
    r.version !== 2 || r.action !== "poll-artifact-delete-command" ||
    typeof r.nodeId !== "string" || !UUID_PATTERN.test(r.nodeId) ||
    !Number.isSafeInteger(r.keyVersion) || (r.keyVersion as number) < 1 ||
    typeof r.jobId !== "string" || !UUID_PATTERN.test(r.jobId) ||
    !canonicalTimestamp(r.issuedAt) ||
    typeof r.nonce !== "string" || !UUID_PATTERN.test(r.nonce)
  ) return fail("PREVIEW_ARTIFACT_GC_POLL_PROOF_INVALID");
  const issued = Date.parse(r.issuedAt as string);
  if (issued > now.getTime() + CLOCK_SKEW_MS ||
      now.getTime() - issued > MAX_POLL_PROOF_AGE_MS) {
    return fail("PREVIEW_ARTIFACT_GC_POLL_PROOF_EXPIRED");
  }
  return Object.fromEntries(POLL_PROOF_FIELDS.map((field) => [field, r[field]])) as
    PreviewArtifactDeletePollProofClaims;
}

function signToken(domain: Buffer, claims: Record<string, unknown>, fields: readonly string[], key: string | undefined): string {
  const payload = Buffer.from(canonical(claims, fields), "utf8");
  const signature = signBytes(null, Buffer.concat([domain, payload]), parseKey(key, "private"));
  return `${payload.toString("base64url")}.${signature.toString("base64url")}`;
}

export function previewArtifactDeleteCommandId(input: {
  nodeId: string; keyVersion: number; jobId: string; artifactRefId: string; gcLeaseAt: string;
}): string {
  if (!UUID_PATTERN.test(input.nodeId) || !Number.isSafeInteger(input.keyVersion) ||
      input.keyVersion < 1 || !UUID_PATTERN.test(input.jobId) ||
      !UUID_PATTERN.test(input.artifactRefId) || !canonicalTimestamp(input.gcLeaseAt)) {
    return fail("PREVIEW_ARTIFACT_GC_COMMAND_INVALID");
  }
  const bytes = createHash("sha256")
    .update("EngineeringOS Preview Artifact Delete Command ID v2\n")
    .update(input.nodeId.toLowerCase(), "utf8").update("\n")
    .update(String(input.keyVersion), "utf8").update("\n")
    .update(input.jobId.toLowerCase(), "utf8").update("\n")
    .update(input.artifactRefId.toLowerCase(), "utf8").update("\n")
    .update(input.gcLeaseAt, "utf8").digest().subarray(0, 16);
  bytes[6] = (bytes[6]! & 0x0f) | 0x80;
  bytes[8] = (bytes[8]! & 0x3f) | 0x80;
  const hex = bytes.toString("hex");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

export function previewArtifactDeleteCommandFingerprint(command: PreviewArtifactDeleteCommandClaims): string {
  const claims = Object.fromEntries(
    COMMAND_FIELDS.filter((field) => field !== "issuedAt" && field !== "expiresAt")
      .map((field) => [field, command[field]]),
  );
  return createHash("sha256")
    .update("EngineeringOS Preview Artifact Delete Fingerprint v1\n")
    .update(JSON.stringify(claims)).digest("hex");
}

export function signPreviewArtifactDeleteCommand(input: {
  claims: PreviewArtifactDeleteCommandClaims; privateKeyPem: string | undefined; now?: Date;
}): string {
  const claims = validateCommand(input.claims, input.now ?? new Date());
  return signToken(COMMAND_DOMAIN, claims, COMMAND_FIELDS, input.privateKeyPem);
}

export function previewArtifactDeleteCommandPublicKeyPem(privateKeyPem: string | undefined): string {
  return createPublicKey(parseKey(privateKeyPem, "private"))
    .export({ type: "spki", format: "pem" }).toString();
}

export function signPreviewArtifactDeletePollProof(input: {
  proof: PreviewArtifactDeletePollProofClaims; privateKeyPem: string | undefined; now?: Date;
}): string {
  const proof = validatePollProof(input.proof, input.now ?? new Date());
  const payload = Buffer.from(canonical(proof, POLL_PROOF_FIELDS), "utf8");
  return signBytes(
    null,
    Buffer.concat([POLL_PROOF_DOMAIN, payload]),
    parseKey(input.privateKeyPem, "private"),
  ).toString("base64url");
}

export function verifyPreviewArtifactDeletePollProof(input: {
  proof: unknown; signature: string; publicKeyPem: string | undefined; now?: Date;
}): PreviewArtifactDeletePollProofClaims {
  const proof = validatePollProof(input.proof, input.now ?? new Date());
  if (typeof input.signature !== "string" || !SIGNATURE_PATTERN.test(input.signature)) {
    return fail("PREVIEW_ARTIFACT_GC_POLL_PROOF_INVALID");
  }
  const signature = Buffer.from(input.signature, "base64url");
  const payload = Buffer.from(canonical(proof, POLL_PROOF_FIELDS), "utf8");
  if (signature.length !== 64 || signature.toString("base64url") !== input.signature ||
      !verifyBytes(null, Buffer.concat([POLL_PROOF_DOMAIN, payload]),
        parseKey(input.publicKeyPem, "public"), signature)) {
    return fail("PREVIEW_ARTIFACT_GC_POLL_PROOF_SIGNATURE_INVALID");
  }
  return Object.freeze(proof);
}

export function verifyPreviewArtifactDeleteCommand(input: {
  token: string; publicKeyPem: string | undefined; now?: Date;
}): PreviewArtifactDeleteCommandClaims {
  const decoded = signedPayload(input.token);
  let value: unknown;
  try { value = JSON.parse(decoded.payload.toString("utf8")); }
  catch { return fail("PREVIEW_ARTIFACT_GC_COMMAND_INVALID"); }
  const claims = validateCommand(value, input.now ?? new Date());
  if (!decoded.payload.equals(Buffer.from(canonical(claims, COMMAND_FIELDS), "utf8"))) {
    return fail("PREVIEW_ARTIFACT_GC_COMMAND_INVALID");
  }
  if (!verifyBytes(null, Buffer.concat([COMMAND_DOMAIN, decoded.payload]),
      parseKey(input.publicKeyPem, "public"), decoded.signature)) {
    return fail("PREVIEW_ARTIFACT_GC_COMMAND_SIGNATURE_INVALID");
  }
  return Object.freeze(claims);
}

export function signPreviewArtifactDeleteReceipt(input: {
  claims: PreviewArtifactDeleteReceiptClaims; privateKeyPem: string | undefined; now?: Date;
}): string {
  const claims = validateReceipt(input.claims, input.now ?? new Date());
  return signToken(RECEIPT_DOMAIN, claims, RECEIPT_FIELDS, input.privateKeyPem);
}

export function previewArtifactDeleteReceiptCompletedAtHint(token: string): Date {
  let decoded: ReturnType<typeof signedPayload>;
  try { decoded = signedPayload(token); }
  catch { return fail("PREVIEW_ARTIFACT_GC_RECEIPT_INVALID"); }
  let value: unknown;
  try { value = JSON.parse(decoded.payload.toString("utf8")); }
  catch { return fail("PREVIEW_ARTIFACT_GC_RECEIPT_INVALID"); }
  if (!value || typeof value !== "object" || Array.isArray(value) ||
      !canonicalTimestamp((value as Record<string, unknown>).completedAt)) {
    return fail("PREVIEW_ARTIFACT_GC_RECEIPT_INVALID");
  }
  return new Date((value as Record<string, string>).completedAt);
}

export function verifyPreviewArtifactDeleteReceipt(input: {
  token: string; publicKeyPem: string | undefined;
  command: PreviewArtifactDeleteCommandClaims; now?: Date;
}): PreviewArtifactDeleteReceiptClaims {
  const decoded = signedPayload(input.token);
  let value: unknown;
  try { value = JSON.parse(decoded.payload.toString("utf8")); }
  catch { return fail("PREVIEW_ARTIFACT_GC_RECEIPT_INVALID"); }
  const receipt = validateReceipt(value, input.now ?? new Date());
  if (!decoded.payload.equals(Buffer.from(canonical(receipt, RECEIPT_FIELDS), "utf8"))) {
    return fail("PREVIEW_ARTIFACT_GC_RECEIPT_INVALID");
  }
  if (!verifyBytes(null, Buffer.concat([RECEIPT_DOMAIN, decoded.payload]),
      parseKey(input.publicKeyPem, "public"), decoded.signature)) {
    return fail("PREVIEW_ARTIFACT_GC_RECEIPT_SIGNATURE_INVALID");
  }
  if (
    receipt.commandId !== input.command.commandId ||
    receipt.commandFingerprint !== previewArtifactDeleteCommandFingerprint(input.command) ||
    receipt.nodeId !== input.command.nodeId || receipt.keyVersion !== input.command.keyVersion ||
    receipt.storeId !== input.command.storeId ||
    receipt.artifactRefId !== input.command.artifactRefId ||
    receipt.artifactDigest !== input.command.artifactDigest ||
    receipt.manifestDigest !== input.command.manifestDigest ||
    Date.parse(receipt.completedAt) < Date.parse(input.command.issuedAt) - CLOCK_SKEW_MS ||
    Date.parse(receipt.completedAt) > Date.parse(input.command.expiresAt) + CLOCK_SKEW_MS
  ) return fail("PREVIEW_ARTIFACT_GC_RECEIPT_INVALID");
  return Object.freeze(receipt);
}
