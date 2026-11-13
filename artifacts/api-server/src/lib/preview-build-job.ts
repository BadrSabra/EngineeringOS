import {
  createPrivateKey,
  createPublicKey,
  sign as signSignature,
  verify as verifySignature,
  type KeyObject,
} from "node:crypto";
import type { PreviewBuildInputIdentity } from "./preview-build-input.js";

const SIGNING_DOMAIN_V1 = Buffer.from(
  "EngineeringOS Preview Build Job v1\n",
  "utf8",
);
const SIGNING_DOMAIN_V2 = Buffer.from(
  "EngineeringOS Preview Build Job v2\n",
  "utf8",
);
const MAX_TOKEN_LENGTH = 8_192;
const MAX_JOB_TTL_MS = 5 * 60_000;
const CLOCK_SKEW_MS = 5_000;
const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const HASH_PATTERN = /^[a-f0-9]{64}$/i;
const IMAGE_DIGEST_PATTERN = /^sha256:[a-f0-9]{64}$/i;
const INPUT_KEY_PATTERN =
  /^build-inputs\/([a-f0-9]{64})\/([a-f0-9]{64})\.zip$/i;
const OUTPUT_KEY_PATTERN =
  /^preview-build-outputs\/([0-9a-f-]{36})\/site\.tar\.gz$/i;
const JOB_FIELDS_V1 = [
  "version",
  "action",
  "jobId",
  "buildId",
  "builderProfile",
  "builderImageDigest",
  "projectId",
  "proposalId",
  "operationId",
  "proposalRevision",
  "candidateRevision",
  "changeSetHash",
  "sourceRoot",
  "sourceDigest",
  "inputArtifactKey",
  "archiveDigest",
  "outputArtifactKey",
  "issuedAt",
  "expiresAt",
] as const;

const JOB_FIELDS_V2 = [
  ...JOB_FIELDS_V1.slice(0, -2),
  "attemptId",
  "idempotencyKey",
  "dispatchGeneration",
  "issuedAt",
  "expiresAt",
] as const;

type PreviewBuildJobClaimsBase = PreviewBuildInputIdentity & {
  action: "preview-build";
  jobId: string;
  buildId: string;
  builderProfile: "vite-react-static-v1";
  builderImageDigest: string;
  sourceRoot: string;
  sourceDigest: string;
  inputArtifactKey: string;
  archiveDigest: string;
  outputArtifactKey: string;
  issuedAt: string;
  expiresAt: string;
};

export type LegacyPreviewBuildJobClaims = PreviewBuildJobClaimsBase & {
  version: 1;
};

export type PreviewBuildJobClaims = PreviewBuildJobClaimsBase & {
  version: 2;
  attemptId: string;
  idempotencyKey: string;
  dispatchGeneration: number;
};

export type VerifiedPreviewBuildJobClaims =
  | LegacyPreviewBuildJobClaims
  | PreviewBuildJobClaims;

export class PreviewBuildJobError extends Error {
  constructor(
    readonly code:
      | "PREVIEW_BUILD_JOB_INVALID"
      | "PREVIEW_BUILD_JOB_KEY_INVALID"
      | "PREVIEW_BUILD_JOB_SIGNATURE_INVALID"
      | "PREVIEW_BUILD_JOB_EXPIRED",
  ) {
    super("Preview build job is invalid or unavailable.");
    this.name = "PreviewBuildJobError";
  }
}

export function assertPreviewBuildJobPublicKeyPem(
  pem: string | undefined,
): void {
  parseKey(pem, "public");
}

export function assertPreviewBuildJobPrivateKeyPem(
  pem: string | undefined,
): void {
  parseKey(pem, "private");
}

function parseKey(
  pem: string | undefined,
  kind: "private" | "public",
): KeyObject {
  if (!pem || pem.length > 16_384 || !pem.includes("-----BEGIN")) {
    throw new PreviewBuildJobError("PREVIEW_BUILD_JOB_KEY_INVALID");
  }
  try {
    const key =
      kind === "private"
        ? createPrivateKey(pem.replace(/\\n/g, "\n"))
        : createPublicKey(pem.replace(/\\n/g, "\n"));
    if (key.asymmetricKeyType !== "ed25519") {
      throw new Error("Unexpected build job key type.");
    }
    return key;
  } catch {
    throw new PreviewBuildJobError("PREVIEW_BUILD_JOB_KEY_INVALID");
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

function boundedText(value: unknown, maxLength = 255): value is string {
  return (
    typeof value === "string" &&
    value.length > 0 &&
    value.length <= maxLength &&
    value.trim() === value
  );
}

function validSourceRoot(value: unknown): value is string {
  return (
    typeof value === "string" &&
    value.length > 0 &&
    value.length <= 512 &&
    value === value.normalize("NFC") &&
    !value.startsWith("/") &&
    !value.includes("\\") &&
    !value.includes("\0") &&
    (value === "." ||
      value.split("/").every((part) => part && part !== "." && part !== ".."))
  );
}

function canonicalClaims(claims: PreviewBuildJobClaims): string {
  return JSON.stringify(
    Object.fromEntries(JOB_FIELDS_V2.map((field) => [field, claims[field]])),
  );
}

function canonicalVerifiedClaims(
  claims: VerifiedPreviewBuildJobClaims,
): string {
  const fields = claims.version === 1 ? JOB_FIELDS_V1 : JOB_FIELDS_V2;
  return JSON.stringify(
    Object.fromEntries(fields.map((field) => [field, claims[field]])),
  );
}

function validateClaims(
  value: unknown,
  now: Date,
): VerifiedPreviewBuildJobClaims {
  if (
    !value ||
    typeof value !== "object" ||
    Array.isArray(value) ||
    !Number.isFinite(now.getTime())
  ) {
    throw new PreviewBuildJobError("PREVIEW_BUILD_JOB_INVALID");
  }
  const record = value as Record<string, unknown>;
  const fields =
    record.version === 1
      ? JOB_FIELDS_V1
      : record.version === 2
        ? JOB_FIELDS_V2
        : undefined;
  if (
    !fields ||
    Object.keys(record).length !== fields.length ||
    fields.some((field) => !(field in record)) ||
    record.action !== "preview-build" ||
    !boundedText(record.jobId) ||
    !UUID_PATTERN.test(String(record.jobId)) ||
    !boundedText(record.buildId) ||
    !UUID_PATTERN.test(String(record.buildId)) ||
    record.builderProfile !== "vite-react-static-v1" ||
    typeof record.builderImageDigest !== "string" ||
    !IMAGE_DIGEST_PATTERN.test(record.builderImageDigest) ||
    !boundedText(record.projectId) ||
    !boundedText(record.proposalId) ||
    !boundedText(record.operationId) ||
    !Number.isSafeInteger(record.proposalRevision) ||
    (record.proposalRevision as number) < 0 ||
    typeof record.candidateRevision !== "string" ||
    !HASH_PATTERN.test(record.candidateRevision) ||
    typeof record.changeSetHash !== "string" ||
    !HASH_PATTERN.test(record.changeSetHash) ||
    !validSourceRoot(record.sourceRoot) ||
    typeof record.sourceDigest !== "string" ||
    !HASH_PATTERN.test(record.sourceDigest) ||
    typeof record.archiveDigest !== "string" ||
    !HASH_PATTERN.test(record.archiveDigest) ||
    typeof record.inputArtifactKey !== "string" ||
    !INPUT_KEY_PATTERN.test(record.inputArtifactKey) ||
    !canonicalTimestamp(record.issuedAt) ||
    !canonicalTimestamp(record.expiresAt) ||
    (record.version === 2 &&
      (record.attemptId !== record.jobId ||
        typeof record.idempotencyKey !== "string" ||
        !UUID_PATTERN.test(record.idempotencyKey) ||
        !Number.isSafeInteger(record.dispatchGeneration) ||
        (record.dispatchGeneration as number) < 1))
  ) {
    throw new PreviewBuildJobError("PREVIEW_BUILD_JOB_INVALID");
  }
  const inputKeyMatch = INPUT_KEY_PATTERN.exec(record.inputArtifactKey);
  if (
    inputKeyMatch?.[2]?.toLowerCase() !== record.archiveDigest.toLowerCase()
  ) {
    throw new PreviewBuildJobError("PREVIEW_BUILD_JOB_INVALID");
  }
  const outputKeyMatch = OUTPUT_KEY_PATTERN.exec(
    String(record.outputArtifactKey ?? ""),
  );
  if (
    !outputKeyMatch ||
    outputKeyMatch[1]?.toLowerCase() !== String(record.buildId).toLowerCase()
  ) {
    throw new PreviewBuildJobError("PREVIEW_BUILD_JOB_INVALID");
  }

  const issuedAt = Date.parse(record.issuedAt);
  const expiresAt = Date.parse(record.expiresAt);
  if (
    issuedAt > now.getTime() + CLOCK_SKEW_MS ||
    expiresAt <= now.getTime() ||
    expiresAt <= issuedAt ||
    expiresAt - issuedAt > MAX_JOB_TTL_MS
  ) {
    throw new PreviewBuildJobError("PREVIEW_BUILD_JOB_EXPIRED");
  }

  return Object.fromEntries(
    fields.map((field) => [field, record[field]]),
  ) as VerifiedPreviewBuildJobClaims;
}

export function signPreviewBuildJob(input: {
  claims: PreviewBuildJobClaims;
  privateKeyPem: string | undefined;
  now?: Date;
}): string {
  const validated = validateClaims(input.claims, input.now ?? new Date());
  if (validated.version !== 2) {
    throw new PreviewBuildJobError("PREVIEW_BUILD_JOB_INVALID");
  }
  const claims = validated;
  const payload = Buffer.from(canonicalClaims(claims), "utf8");
  const signature = signSignature(
    null,
    Buffer.concat([SIGNING_DOMAIN_V2, payload]),
    parseKey(input.privateKeyPem, "private"),
  );
  return `${payload.toString("base64url")}.${signature.toString("base64url")}`;
}

export function verifyPreviewBuildJob(input: {
  token: string;
  publicKeyPem: string | undefined;
  now?: Date;
}): VerifiedPreviewBuildJobClaims {
  if (
    typeof input.token !== "string" ||
    input.token.length > MAX_TOKEN_LENGTH
  ) {
    throw new PreviewBuildJobError("PREVIEW_BUILD_JOB_INVALID");
  }
  const separator = input.token.indexOf(".");
  if (
    separator <= 0 ||
    separator !== input.token.lastIndexOf(".") ||
    !/^[A-Za-z0-9_-]+$/.test(input.token.slice(0, separator)) ||
    !/^[A-Za-z0-9_-]+$/.test(input.token.slice(separator + 1))
  ) {
    throw new PreviewBuildJobError("PREVIEW_BUILD_JOB_INVALID");
  }
  const payload = Buffer.from(input.token.slice(0, separator), "base64url");
  const signature = Buffer.from(input.token.slice(separator + 1), "base64url");
  if (
    payload.length > 6_144 ||
    payload.toString("base64url") !== input.token.slice(0, separator) ||
    signature.length !== 64 ||
    signature.toString("base64url") !== input.token.slice(separator + 1)
  ) {
    throw new PreviewBuildJobError("PREVIEW_BUILD_JOB_INVALID");
  }
  let decoded: unknown;
  try {
    decoded = JSON.parse(payload.toString("utf8"));
  } catch {
    throw new PreviewBuildJobError("PREVIEW_BUILD_JOB_INVALID");
  }
  const claims = validateClaims(decoded, input.now ?? new Date());
  if (!payload.equals(Buffer.from(canonicalVerifiedClaims(claims), "utf8"))) {
    throw new PreviewBuildJobError("PREVIEW_BUILD_JOB_INVALID");
  }
  if (
    !verifySignature(
      null,
      Buffer.concat([
        claims.version === 1 ? SIGNING_DOMAIN_V1 : SIGNING_DOMAIN_V2,
        payload,
      ]),
      parseKey(input.publicKeyPem, "public"),
      signature,
    )
  ) {
    throw new PreviewBuildJobError("PREVIEW_BUILD_JOB_SIGNATURE_INVALID");
  }
  return Object.freeze(claims);
}
