import { createPublicKey, verify as verifySignature } from "node:crypto";

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
const UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const HASH = /^[a-f0-9]{64}$/i;
const IMAGE_DIGEST = /^sha256:[a-f0-9]{64}$/i;
const INPUT_KEY = /^build-inputs\/([a-f0-9]{64})\/([a-f0-9]{64})\.zip$/i;
const OUTPUT_KEY = /^preview-build-outputs\/([0-9a-f-]{36})\/site\.tar\.gz$/i;
const FIELDS_V1 = [
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
];
const FIELDS_V2 = [
  ...FIELDS_V1.slice(0, -2),
  "attemptId",
  "idempotencyKey",
  "dispatchGeneration",
  "issuedAt",
  "expiresAt",
];

export class PreviewBuildJobTokenError extends Error {
  constructor(code = "PREVIEW_BUILD_JOB_INVALID") {
    super("Preview build job is invalid or unavailable.");
    this.name = "PreviewBuildJobTokenError";
    this.code = code;
  }
}

function fail() {
  throw new PreviewBuildJobTokenError();
}

function canonicalTimestamp(value) {
  return (
    typeof value === "string" &&
    /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value) &&
    Number.isFinite(Date.parse(value)) &&
    new Date(value).toISOString() === value
  );
}

function boundedText(value, maxLength = 255) {
  return (
    typeof value === "string" &&
    value.length > 0 &&
    value.length <= maxLength &&
    value.trim() === value
  );
}

function validSourceRoot(value) {
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

function validateClaims(value, now) {
  if (
    !value ||
    typeof value !== "object" ||
    Array.isArray(value) ||
    !Number.isFinite(now.getTime())
  ) {
    fail();
  }
  const claims = value;
  const fields =
    claims.version === 1
      ? FIELDS_V1
      : claims.version === 2
        ? FIELDS_V2
        : undefined;
  if (
    !fields ||
    Object.keys(claims).length !== fields.length ||
    fields.some((field) => !(field in claims)) ||
    claims.action !== "preview-build" ||
    !boundedText(claims.jobId) ||
    !UUID.test(claims.jobId) ||
    !boundedText(claims.buildId) ||
    !UUID.test(claims.buildId) ||
    claims.builderProfile !== "vite-react-static-v1" ||
    !IMAGE_DIGEST.test(claims.builderImageDigest ?? "") ||
    !boundedText(claims.projectId) ||
    !boundedText(claims.proposalId) ||
    !boundedText(claims.operationId) ||
    !Number.isSafeInteger(claims.proposalRevision) ||
    claims.proposalRevision < 0 ||
    !HASH.test(claims.candidateRevision ?? "") ||
    !HASH.test(claims.changeSetHash ?? "") ||
    !validSourceRoot(claims.sourceRoot) ||
    !HASH.test(claims.sourceDigest ?? "") ||
    !HASH.test(claims.archiveDigest ?? "") ||
    !INPUT_KEY.test(claims.inputArtifactKey ?? "") ||
    !OUTPUT_KEY.test(claims.outputArtifactKey ?? "") ||
    !canonicalTimestamp(claims.issuedAt) ||
    !canonicalTimestamp(claims.expiresAt) ||
    (claims.version === 2 &&
      (claims.attemptId !== claims.jobId ||
        !UUID.test(claims.idempotencyKey ?? "") ||
        !Number.isSafeInteger(claims.dispatchGeneration) ||
        claims.dispatchGeneration < 1))
  ) {
    fail();
  }
  const inputKey = INPUT_KEY.exec(claims.inputArtifactKey);
  const outputKey = OUTPUT_KEY.exec(claims.outputArtifactKey);
  if (
    inputKey?.[2]?.toLowerCase() !== claims.archiveDigest.toLowerCase() ||
    outputKey?.[1]?.toLowerCase() !== claims.buildId.toLowerCase()
  ) {
    fail();
  }
  const issuedAt = Date.parse(claims.issuedAt);
  const expiresAt = Date.parse(claims.expiresAt);
  if (
    issuedAt > now.getTime() + CLOCK_SKEW_MS ||
    expiresAt <= now.getTime() ||
    expiresAt <= issuedAt ||
    expiresAt - issuedAt > MAX_JOB_TTL_MS
  ) {
    throw new PreviewBuildJobTokenError("PREVIEW_BUILD_JOB_EXPIRED");
  }
  return Object.fromEntries(fields.map((field) => [field, claims[field]]));
}

function decodeBase64Url(value) {
  if (!/^[A-Za-z0-9_-]+$/.test(value)) return undefined;
  const bytes = Buffer.from(value, "base64url");
  return bytes.toString("base64url") === value ? bytes : undefined;
}

export function verifyPreviewBuildJobToken(
  token,
  publicKeyPem,
  now = new Date(),
) {
  if (typeof token !== "string" || token.length > MAX_TOKEN_LENGTH) fail();
  const separator = token.indexOf(".");
  if (separator <= 0 || separator !== token.lastIndexOf(".")) fail();
  const payload = decodeBase64Url(token.slice(0, separator));
  const signature = decodeBase64Url(token.slice(separator + 1));
  if (
    !payload ||
    payload.length > 6_144 ||
    !signature ||
    signature.length !== 64
  ) {
    fail();
  }
  let decoded;
  try {
    decoded = JSON.parse(payload.toString("utf8"));
  } catch {
    fail();
  }
  const claims = validateClaims(decoded, now);
  const canonical = Buffer.from(JSON.stringify(claims), "utf8");
  if (!payload.equals(canonical)) fail();
  let publicKey;
  try {
    if (
      typeof publicKeyPem !== "string" ||
      publicKeyPem.length > 16_384 ||
      !publicKeyPem.includes("-----BEGIN")
    ) {
      fail();
    }
    publicKey = createPublicKey(publicKeyPem.replace(/\\n/g, "\n"));
    if (publicKey.asymmetricKeyType !== "ed25519") fail();
  } catch {
    throw new PreviewBuildJobTokenError("PREVIEW_BUILD_JOB_KEY_INVALID");
  }
  if (
    !verifySignature(
      null,
      Buffer.concat([
        claims.version === 1 ? SIGNING_DOMAIN_V1 : SIGNING_DOMAIN_V2,
        canonical,
      ]),
      publicKey,
      signature,
    )
  ) {
    throw new PreviewBuildJobTokenError("PREVIEW_BUILD_JOB_SIGNATURE_INVALID");
  }
  return Object.freeze(claims);
}
