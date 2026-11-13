import {
  createPublicKey,
  verify as verifySignature,
  type KeyObject,
} from "node:crypto";
import type { PreviewBuildInputIdentity } from "./preview-build-input.js";

const SIGNING_DOMAIN_V1 = Buffer.from(
  "EngineeringOS Preview Build Receipt v1\n",
  "utf8",
);
const SIGNING_DOMAIN_V2 = Buffer.from(
  "EngineeringOS Preview Build Receipt v2\n",
  "utf8",
);
const MAX_TOKEN_LENGTH = 8_192;
const MAX_RECEIPT_TTL_MS = 2 * 60_000;
const CLOCK_SKEW_MS = 5_000;
const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const HASH_PATTERN = /^[a-f0-9]{64}$/i;
const IMAGE_DIGEST_PATTERN = /^sha256:[a-f0-9]{64}$/i;
const OUTPUT_ARTIFACT_KEY_PATTERN =
  /^preview-build-outputs\/[0-9a-f-]{36}\/site\.tar\.gz$/i;
const verifiedReceipts = new WeakSet<object>();

declare const verifiedReceiptBrand: unique symbol;

type PreviewBuildReceiptClaimsBase = PreviewBuildInputIdentity & {
  action: "preview-build-ready";
  receiptId: string;
  buildId: string;
  builderProfile: "vite-react-static-v1";
  builderImageDigest: string;
  sourceDigest: string;
  archiveDigest: string;
  buildOutputDigest: string;
  outputArtifactKey: string;
  issuedAt: string;
  expiresAt: string;
};

export type LegacyPreviewBuildReceiptClaims =
  PreviewBuildReceiptClaimsBase & {
    version: 1;
  };

export type PreviewBuildReceiptClaims = PreviewBuildReceiptClaimsBase & {
  version: 2;
  attemptId: string;
  idempotencyKey: string;
  dispatchGeneration: number;
};

export type AnyPreviewBuildReceiptClaims =
  | LegacyPreviewBuildReceiptClaims
  | PreviewBuildReceiptClaims;

export type VerifiedPreviewBuildReceipt = PreviewBuildReceiptClaims & {
  readonly [verifiedReceiptBrand]: true;
} | (LegacyPreviewBuildReceiptClaims & {
  readonly [verifiedReceiptBrand]: true;
});

export class PreviewBuildReceiptError extends Error {
  constructor(
    readonly code:
      | "PREVIEW_BUILD_RECEIPT_INVALID"
      | "PREVIEW_BUILD_RECEIPT_KEY_INVALID"
      | "PREVIEW_BUILD_RECEIPT_SIGNATURE_INVALID"
      | "PREVIEW_BUILD_RECEIPT_EXPIRED"
      | "PREVIEW_BUILD_RECEIPT_BINDING_MISMATCH",
  ) {
    super("Preview build receipt is invalid or unavailable.");
    this.name = "PreviewBuildReceiptError";
  }
}

function parsePublicKey(pem: string | undefined): KeyObject {
  if (!pem || pem.length > 16_384 || !pem.includes("-----BEGIN")) {
    throw new PreviewBuildReceiptError("PREVIEW_BUILD_RECEIPT_KEY_INVALID");
  }
  try {
    const key = createPublicKey(pem.replace(/\\n/g, "\n"));
    if (key.asymmetricKeyType !== "ed25519") {
      throw new Error("Unexpected receipt key type.");
    }
    return key;
  } catch {
    throw new PreviewBuildReceiptError("PREVIEW_BUILD_RECEIPT_KEY_INVALID");
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
    value.trim() === value
  );
}

export function canonicalPreviewBuildReceiptPayload(
  receipt: AnyPreviewBuildReceiptClaims,
): string {
  const base = {
    version: receipt.version,
    action: receipt.action,
    receiptId: receipt.receiptId,
    buildId: receipt.buildId,
    builderProfile: receipt.builderProfile,
    builderImageDigest: receipt.builderImageDigest,
    projectId: receipt.projectId,
    proposalId: receipt.proposalId,
    operationId: receipt.operationId,
    proposalRevision: receipt.proposalRevision,
    candidateRevision: receipt.candidateRevision,
    changeSetHash: receipt.changeSetHash,
    sourceDigest: receipt.sourceDigest,
    archiveDigest: receipt.archiveDigest,
    buildOutputDigest: receipt.buildOutputDigest,
    outputArtifactKey: receipt.outputArtifactKey,
    issuedAt: receipt.issuedAt,
    expiresAt: receipt.expiresAt,
  };
  return JSON.stringify(
    receipt.version === 2
      ? {
          ...base,
          attemptId: receipt.attemptId,
          idempotencyKey: receipt.idempotencyKey,
          dispatchGeneration: receipt.dispatchGeneration,
        }
      : base,
  );
}

function validateReceipt(value: unknown, now: Date): AnyPreviewBuildReceiptClaims {
  if (
    !value ||
    typeof value !== "object" ||
    Array.isArray(value) ||
    !Number.isFinite(now.getTime())
  ) {
    throw new PreviewBuildReceiptError("PREVIEW_BUILD_RECEIPT_INVALID");
  }
  const record = value as Record<string, unknown>;
  const allowedKeysV1 = [
    "version",
    "action",
    "receiptId",
    "buildId",
    "builderProfile",
    "builderImageDigest",
    "projectId",
    "proposalId",
    "operationId",
    "proposalRevision",
    "candidateRevision",
    "changeSetHash",
    "sourceDigest",
    "archiveDigest",
    "buildOutputDigest",
    "outputArtifactKey",
    "issuedAt",
    "expiresAt",
  ];
  const allowedKeysV2 = [
    ...allowedKeysV1.slice(0, 4),
    "attemptId",
    "idempotencyKey",
    "dispatchGeneration",
    ...allowedKeysV1.slice(4),
  ];
  const allowedKeys =
    record.version === 1
      ? allowedKeysV1
      : record.version === 2
        ? allowedKeysV2
        : undefined;
  if (
    !allowedKeys ||
    Object.keys(record).length !== allowedKeys.length ||
    allowedKeys.some((key) => !(key in record)) ||
    record.action !== "preview-build-ready" ||
    record.builderProfile !== "vite-react-static-v1" ||
    typeof record.receiptId !== "string" ||
    !UUID_PATTERN.test(record.receiptId) ||
    typeof record.buildId !== "string" ||
    !UUID_PATTERN.test(record.buildId) ||
    !boundedText(record.projectId, 255) ||
    !boundedText(record.proposalId, 255) ||
    !boundedText(record.operationId, 255) ||
    !Number.isSafeInteger(record.proposalRevision) ||
    (record.proposalRevision as number) < 0 ||
    typeof record.candidateRevision !== "string" ||
    !HASH_PATTERN.test(record.candidateRevision) ||
    typeof record.changeSetHash !== "string" ||
    !HASH_PATTERN.test(record.changeSetHash) ||
    typeof record.sourceDigest !== "string" ||
    !HASH_PATTERN.test(record.sourceDigest) ||
    typeof record.archiveDigest !== "string" ||
    !HASH_PATTERN.test(record.archiveDigest) ||
    typeof record.buildOutputDigest !== "string" ||
    !HASH_PATTERN.test(record.buildOutputDigest) ||
    typeof record.builderImageDigest !== "string" ||
    !IMAGE_DIGEST_PATTERN.test(record.builderImageDigest) ||
    typeof record.outputArtifactKey !== "string" ||
    !OUTPUT_ARTIFACT_KEY_PATTERN.test(record.outputArtifactKey) ||
    !canonicalTimestamp(record.issuedAt) ||
    !canonicalTimestamp(record.expiresAt) ||
    (record.version === 2 &&
      (typeof record.attemptId !== "string" ||
        !UUID_PATTERN.test(record.attemptId) ||
        typeof record.idempotencyKey !== "string" ||
        !UUID_PATTERN.test(record.idempotencyKey) ||
        !Number.isSafeInteger(record.dispatchGeneration) ||
        (record.dispatchGeneration as number) < 1))
  ) {
    throw new PreviewBuildReceiptError("PREVIEW_BUILD_RECEIPT_INVALID");
  }

  const issuedAt = Date.parse(record.issuedAt);
  const expiresAt = Date.parse(record.expiresAt);
  if (
    issuedAt > now.getTime() + CLOCK_SKEW_MS ||
    expiresAt <= now.getTime() ||
    expiresAt <= issuedAt ||
    expiresAt - issuedAt > MAX_RECEIPT_TTL_MS
  ) {
    throw new PreviewBuildReceiptError("PREVIEW_BUILD_RECEIPT_EXPIRED");
  }

  const common: PreviewBuildReceiptClaimsBase = {
    action: "preview-build-ready",
    receiptId: record.receiptId as string,
    buildId: record.buildId as string,
    builderProfile: "vite-react-static-v1",
    builderImageDigest: record.builderImageDigest as string,
    projectId: record.projectId as string,
    proposalId: record.proposalId as string,
    operationId: record.operationId as string,
    proposalRevision: record.proposalRevision as number,
    candidateRevision: record.candidateRevision as string,
    changeSetHash: record.changeSetHash as string,
    sourceDigest: record.sourceDigest as string,
    archiveDigest: record.archiveDigest as string,
    buildOutputDigest: record.buildOutputDigest as string,
    outputArtifactKey: record.outputArtifactKey as string,
    issuedAt: record.issuedAt as string,
    expiresAt: record.expiresAt as string,
  };
  return record.version === 2
    ? {
        ...common,
        version: 2,
        attemptId: record.attemptId as string,
        idempotencyKey: record.idempotencyKey as string,
        dispatchGeneration: record.dispatchGeneration as number,
      }
    : { ...common, version: 1 };
}

function decodeCanonicalBase64Url(value: string): Buffer | undefined {
  if (!/^[A-Za-z0-9_-]+$/.test(value)) return undefined;
  const decoded = Buffer.from(value, "base64url");
  return decoded.toString("base64url") === value ? decoded : undefined;
}

export function verifyPreviewBuildReceipt(input: {
  token: string;
  publicKeyPem: string | undefined;
  expected: {
    identity: PreviewBuildInputIdentity;
    sourceDigest: string;
    archiveDigest: string;
    builderImageDigest: string;
    buildId: string;
    outputArtifactKey: string;
    attemptId?: string;
    idempotencyKey?: string;
    dispatchGeneration?: number;
  };
  now?: Date;
}): VerifiedPreviewBuildReceipt {
  if (
    typeof input.token !== "string" ||
    input.token.length > MAX_TOKEN_LENGTH
  ) {
    throw new PreviewBuildReceiptError("PREVIEW_BUILD_RECEIPT_INVALID");
  }
  if (
    !IMAGE_DIGEST_PATTERN.test(input.expected.builderImageDigest) ||
    !HASH_PATTERN.test(input.expected.sourceDigest) ||
    !HASH_PATTERN.test(input.expected.archiveDigest) ||
    !UUID_PATTERN.test(input.expected.buildId) ||
    !OUTPUT_ARTIFACT_KEY_PATTERN.test(input.expected.outputArtifactKey) ||
    input.expected.outputArtifactKey !==
      `preview-build-outputs/${input.expected.buildId}/site.tar.gz` ||
    !boundedText(input.expected.identity.projectId, 255) ||
    !boundedText(input.expected.identity.proposalId, 255) ||
    !boundedText(input.expected.identity.operationId, 255) ||
    !Number.isSafeInteger(input.expected.identity.proposalRevision) ||
    input.expected.identity.proposalRevision < 0 ||
    !HASH_PATTERN.test(input.expected.identity.candidateRevision) ||
    !HASH_PATTERN.test(input.expected.identity.changeSetHash)
  ) {
    throw new PreviewBuildReceiptError(
      "PREVIEW_BUILD_RECEIPT_BINDING_MISMATCH",
    );
  }
  const separator = input.token.indexOf(".");
  if (
    separator <= 0 ||
    separator !== input.token.lastIndexOf(".") ||
    !/^[A-Za-z0-9_-]+$/.test(input.token.slice(0, separator)) ||
    !/^[A-Za-z0-9_-]+$/.test(input.token.slice(separator + 1))
  ) {
    throw new PreviewBuildReceiptError("PREVIEW_BUILD_RECEIPT_INVALID");
  }
  const payload = decodeCanonicalBase64Url(input.token.slice(0, separator));
  const signature = decodeCanonicalBase64Url(input.token.slice(separator + 1));
  if (
    !payload ||
    payload.length > 6_144 ||
    !signature ||
    signature.length !== 64
  ) {
    throw new PreviewBuildReceiptError("PREVIEW_BUILD_RECEIPT_INVALID");
  }
  let decoded: unknown;
  try {
    decoded = JSON.parse(payload.toString("utf8"));
  } catch {
    throw new PreviewBuildReceiptError("PREVIEW_BUILD_RECEIPT_INVALID");
  }

  const now = input.now ?? new Date();
  const receipt = validateReceipt(decoded, now);
  const canonical = Buffer.from(
    canonicalPreviewBuildReceiptPayload(receipt),
    "utf8",
  );
  if (!payload.equals(canonical)) {
    throw new PreviewBuildReceiptError("PREVIEW_BUILD_RECEIPT_INVALID");
  }
  const key = parsePublicKey(input.publicKeyPem);
  if (
    !verifySignature(
      null,
      Buffer.concat([
        receipt.version === 1 ? SIGNING_DOMAIN_V1 : SIGNING_DOMAIN_V2,
        canonical,
      ]),
      key,
      signature,
    )
  ) {
    throw new PreviewBuildReceiptError(
      "PREVIEW_BUILD_RECEIPT_SIGNATURE_INVALID",
    );
  }

  const expected = input.expected;
  if (
    receipt.projectId !== expected.identity.projectId ||
    receipt.proposalId !== expected.identity.proposalId ||
    receipt.operationId !== expected.identity.operationId ||
    receipt.proposalRevision !== expected.identity.proposalRevision ||
    receipt.candidateRevision !== expected.identity.candidateRevision ||
    receipt.changeSetHash !== expected.identity.changeSetHash ||
    receipt.sourceDigest !== expected.sourceDigest ||
    receipt.archiveDigest !== expected.archiveDigest ||
    receipt.buildId !== expected.buildId ||
    receipt.outputArtifactKey !== expected.outputArtifactKey ||
    receipt.builderImageDigest !== expected.builderImageDigest ||
    (receipt.version === 2 &&
      (receipt.attemptId !== expected.attemptId ||
        receipt.idempotencyKey !== expected.idempotencyKey ||
        receipt.dispatchGeneration !== expected.dispatchGeneration))
  ) {
    throw new PreviewBuildReceiptError(
      "PREVIEW_BUILD_RECEIPT_BINDING_MISMATCH",
    );
  }
  const verified = Object.freeze(receipt) as VerifiedPreviewBuildReceipt;
  verifiedReceipts.add(verified);
  return verified;
}

export function isVerifiedPreviewBuildReceipt(
  value: unknown,
): value is VerifiedPreviewBuildReceipt {
  return (
    value !== null && typeof value === "object" && verifiedReceipts.has(value)
  );
}
