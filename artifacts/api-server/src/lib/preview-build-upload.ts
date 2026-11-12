import {
  createHash,
  createPrivateKey,
  createPublicKey,
  randomUUID,
  sign as signBytes,
  verify as verifyBytes,
  type KeyObject,
} from "node:crypto";
import AdmZip from "adm-zip";
import type {
  PreviewBuildInputArchive,
  PreviewBuildInputIdentity,
  PreviewBuildInputManifest,
} from "./preview-build-input.js";
import {
  isValidPreviewBuildSourceRoot,
  PREVIEW_BUILD_INPUT_MANIFEST_PATH,
} from "./preview-build-input.js";
import { previewBuildArtifactRefId } from "./preview-artifact-reference.js";

const SIGNING_DOMAIN = Buffer.from(
  "EngineeringOS Preview Build Input Upload v2\n",
  "utf8",
);
const TOKEN_TTL_MS = 30_000;
const CLOCK_SKEW_MS = 5_000;
export const MAX_PREVIEW_BUILD_ARCHIVE_BYTES = 55 * 1024 * 1024;
const MAX_TOKEN_LENGTH = 8_192;
const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const HASH_PATTERN = /^[a-f0-9]{64}$/i;

export type PreviewBuildInputUploadClaims = PreviewBuildInputIdentity & {
  version: 2;
  action: "upload-build-input";
  commandId: string;
  jobId: string;
  artifactRefId: string;
  builderProfile: "vite-react-static-v1";
  sourceDigest: string;
  archiveDigest: string;
  archiveBytes: number;
  issuedAt: string;
  expiresAt: string;
};

export type PreviewBuildInputUploadRequest = {
  token: string | undefined;
  contentType: string | undefined;
  archive?: Buffer;
  bytes?: AsyncIterable<Uint8Array>;
  contentLength?: number;
  authorization?: PreviewBuildInputUploadAuthorization;
};

export type PreviewBuildInputUploadAuthorization = object;

export interface PreviewBuildInputUploadHandler {
  readonly supportsStreaming?: boolean;
  authorize(
    token: string,
    contentLength: number,
  ): PreviewBuildInputUploadAuthorization;
  handle(request: PreviewBuildInputUploadRequest): Promise<Response>;
}

export interface PreviewBuildInputObjectStore {
  put(input: {
    jobId: string;
    artifactRefId: string;
    objectKey: string;
    archive: Buffer;
    archiveDigest: string;
    contentLength: number;
  }): Promise<void>;
}

export type PreviewBuildArtifactWriteMetadata = {
  storeId: string;
  jobId: string;
  artifactRefId: string;
  digest: string;
  sizeBytes: number;
  manifestDigest: string;
  retentionPolicy:
    | "preview-build-input-24h-v1"
    | "preview-build-output-live-reference-v1";
};

export interface PreviewBuildInputStreamObjectStore
  extends PreviewBuildInputObjectStore {
  /**
   * Consume and verify the complete digest-bound stream before publishing the
   * immutable object. A rejected or interrupted stream must not become visible.
   */
  putStream(input: {
    jobId: string;
    artifactRefId: string;
    objectKey: string;
    bytes: AsyncIterable<Uint8Array>;
    archiveDigest: string;
    contentLength: number;
  }): Promise<PreviewBuildArtifactWriteMetadata | void>;
}

export class PreviewBuildInputObjectStoreError extends Error {
  constructor(
    readonly kind: "invalid" | "too_large" | "unavailable",
  ) {
    super("Preview build input storage failed.");
    this.name = "PreviewBuildInputObjectStoreError";
  }
}

export class PreviewBuildInputUploadError extends Error {
  constructor(
    readonly code:
      | "PREVIEW_BUILD_UPLOAD_KEY_INVALID"
      | "PREVIEW_BUILD_UPLOAD_TOKEN_INVALID"
      | "PREVIEW_BUILD_UPLOAD_EXPIRED"
      | "PREVIEW_BUILD_UPLOAD_BODY_INVALID"
      | "PREVIEW_BUILD_UPLOAD_UNAVAILABLE",
    readonly status: 400 | 401 | 413 | 503,
  ) {
    super("Preview build input upload is invalid or unavailable.");
    this.name = "PreviewBuildInputUploadError";
  }
}

function parseKey(
  pem: string | undefined,
  kind: "private" | "public",
): KeyObject {
  if (!pem || pem.length > 16_384 || !pem.includes("-----BEGIN")) {
    throw new PreviewBuildInputUploadError(
      "PREVIEW_BUILD_UPLOAD_KEY_INVALID",
      503,
    );
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
    throw new PreviewBuildInputUploadError(
      "PREVIEW_BUILD_UPLOAD_KEY_INVALID",
      503,
    );
  }
}

function validText(value: unknown, maxLength: number): value is string {
  return (
    typeof value === "string" &&
    value.length > 0 &&
    value.length <= maxLength &&
    value.trim() === value
  );
}

function isCanonicalTime(value: unknown): value is string {
  return (
    typeof value === "string" &&
    /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value) &&
    Number.isFinite(Date.parse(value)) &&
    new Date(value).toISOString() === value
  );
}

function canonicalClaims(claims: PreviewBuildInputUploadClaims): string {
  return JSON.stringify({
    version: claims.version,
    action: claims.action,
    commandId: claims.commandId,
    jobId: claims.jobId,
    artifactRefId: claims.artifactRefId,
    builderProfile: claims.builderProfile,
    projectId: claims.projectId,
    proposalId: claims.proposalId,
    operationId: claims.operationId,
    proposalRevision: claims.proposalRevision,
    candidateRevision: claims.candidateRevision,
    changeSetHash: claims.changeSetHash,
    sourceDigest: claims.sourceDigest,
    archiveDigest: claims.archiveDigest,
    archiveBytes: claims.archiveBytes,
    issuedAt: claims.issuedAt,
    expiresAt: claims.expiresAt,
  });
}

function validateClaims(
  value: unknown,
  now: Date,
): PreviewBuildInputUploadClaims {
  if (
    !value ||
    typeof value !== "object" ||
    Array.isArray(value) ||
    !Number.isFinite(now.getTime())
  ) {
    throw new PreviewBuildInputUploadError(
      "PREVIEW_BUILD_UPLOAD_TOKEN_INVALID",
      401,
    );
  }
  const record = value as Record<string, unknown>;
  const allowedKeys = [
    "version",
    "action",
    "commandId",
    "jobId",
    "artifactRefId",
    "builderProfile",
    "projectId",
    "proposalId",
    "operationId",
    "proposalRevision",
    "candidateRevision",
    "changeSetHash",
    "sourceDigest",
    "archiveDigest",
    "archiveBytes",
    "issuedAt",
    "expiresAt",
  ];
  if (
    Object.keys(record).length !== allowedKeys.length ||
    allowedKeys.some((key) => !(key in record)) ||
    record.version !== 2 ||
    record.action !== "upload-build-input" ||
    record.builderProfile !== "vite-react-static-v1" ||
    typeof record.commandId !== "string" ||
    !UUID_PATTERN.test(record.commandId) ||
    typeof record.jobId !== "string" ||
    !UUID_PATTERN.test(record.jobId) ||
    typeof record.artifactRefId !== "string" ||
    record.artifactRefId !==
      previewBuildArtifactRefId(record.jobId, "input") ||
    !validText(record.projectId, 255) ||
    !validText(record.proposalId, 255) ||
    !validText(record.operationId, 255) ||
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
    !Number.isSafeInteger(record.archiveBytes) ||
    (record.archiveBytes as number) < 1 ||
    (record.archiveBytes as number) > MAX_PREVIEW_BUILD_ARCHIVE_BYTES ||
    !isCanonicalTime(record.issuedAt) ||
    !isCanonicalTime(record.expiresAt)
  ) {
    throw new PreviewBuildInputUploadError(
      "PREVIEW_BUILD_UPLOAD_TOKEN_INVALID",
      401,
    );
  }

  const issuedAt = Date.parse(record.issuedAt);
  const expiresAt = Date.parse(record.expiresAt);
  if (
    issuedAt > now.getTime() + CLOCK_SKEW_MS ||
    expiresAt <= now.getTime() ||
    expiresAt <= issuedAt ||
    expiresAt - issuedAt > TOKEN_TTL_MS
  ) {
    throw new PreviewBuildInputUploadError("PREVIEW_BUILD_UPLOAD_EXPIRED", 401);
  }

  return {
    version: 2,
    action: "upload-build-input",
    commandId: record.commandId,
    jobId: record.jobId,
    artifactRefId: record.artifactRefId,
    builderProfile: "vite-react-static-v1",
    projectId: record.projectId,
    proposalId: record.proposalId,
    operationId: record.operationId,
    proposalRevision: record.proposalRevision as number,
    candidateRevision: record.candidateRevision,
    changeSetHash: record.changeSetHash,
    sourceDigest: record.sourceDigest,
    archiveDigest: record.archiveDigest,
    archiveBytes: record.archiveBytes as number,
    issuedAt: record.issuedAt,
    expiresAt: record.expiresAt,
  };
}

function decodeCanonicalBase64Url(value: string): Buffer | undefined {
  if (!/^[A-Za-z0-9_-]+$/.test(value)) return undefined;
  const decoded = Buffer.from(value, "base64url");
  return decoded.toString("base64url") === value ? decoded : undefined;
}

export function previewBuildInputObjectKey(
  claims: PreviewBuildInputUploadClaims,
): string {
  return previewBuildInputObjectKeyForArchive({
    identity: claims,
    sourceDigest: claims.sourceDigest,
    archiveDigest: claims.archiveDigest,
  });
}

export function previewBuildInputObjectKeyForArchive(input: {
  identity: PreviewBuildInputIdentity;
  sourceDigest: string;
  archiveDigest: string;
}): string {
  const bindingDigest = createHash("sha256")
    .update(
      JSON.stringify({
        projectId: input.identity.projectId,
        proposalId: input.identity.proposalId,
        operationId: input.identity.operationId,
        proposalRevision: input.identity.proposalRevision,
        candidateRevision: input.identity.candidateRevision,
        changeSetHash: input.identity.changeSetHash,
        sourceDigest: input.sourceDigest,
      }),
    )
    .digest("hex");
  return `build-inputs/${bindingDigest}/${input.archiveDigest}.zip`;
}

function assertArchiveMatchesManifest(
  archive: Buffer,
  manifest: PreviewBuildInputManifest,
): void {
  try {
    const zip = new AdmZip(archive);
    const entries = zip.getEntries();
    const manifestEntry = zip.getEntry(PREVIEW_BUILD_INPUT_MANIFEST_PATH);
    if (
      !manifestEntry ||
      manifestEntry.isDirectory ||
      manifestEntry.header.size > 1_000_000
    ) {
      throw new Error("Missing or oversized manifest.");
    }
    const embeddedManifest = JSON.parse(
      manifestEntry.getData().toString("utf8"),
    ) as Record<string, unknown>;
    const manifestKeys = [
      "version",
      "builderProfile",
      "projectId",
      "proposalId",
      "operationId",
      "proposalRevision",
      "candidateRevision",
      "changeSetHash",
      "sourceRoot",
      "sourceDigest",
      "files",
    ];
    if (
      JSON.stringify(embeddedManifest) !== JSON.stringify(manifest) ||
      !embeddedManifest ||
      typeof embeddedManifest !== "object" ||
      Array.isArray(embeddedManifest) ||
      Object.keys(embeddedManifest).length !== manifestKeys.length ||
      manifestKeys.some((key) => !(key in embeddedManifest)) ||
      !isValidPreviewBuildSourceRoot(embeddedManifest.sourceRoot) ||
      !Array.isArray(manifest.files) ||
      manifest.files.length > 5_000 ||
      !manifest.files.some(
        (file) =>
          file.path ===
          (manifest.sourceRoot === "."
            ? "index.html"
            : `${manifest.sourceRoot}/index.html`),
      ) ||
      createHash("sha256")
        .update(
          JSON.stringify({
            sourceRoot: manifest.sourceRoot,
            files: manifest.files,
          }),
        )
        .digest("hex") !== manifest.sourceDigest
    ) {
      throw new Error("Embedded manifest does not match.");
    }

    const archiveFiles = entries.filter(
      (entry) =>
        !entry.isDirectory &&
        entry.entryName !== PREVIEW_BUILD_INPUT_MANIFEST_PATH,
    );
    if (
      archiveFiles.length !== manifest.files.length ||
      entries.length !== archiveFiles.length + 1
    ) {
      throw new Error("Archive file list does not match.");
    }
    let totalBytes = 0;
    const entriesByName = new Map(
      archiveFiles.map((entry) => [entry.entryName, entry]),
    );
    if (entriesByName.size !== archiveFiles.length) {
      throw new Error("Archive contains duplicate paths.");
    }
    for (const file of manifest.files) {
      if (
        !file ||
        Object.keys(file).length !== 3 ||
        !("path" in file) ||
        !("size" in file) ||
        !("sha256" in file) ||
        typeof file.path !== "string" ||
        file.path.startsWith("/") ||
        file.path.includes("\\") ||
        file.path
          .split("/")
          .some(
            (segment) =>
              !segment ||
              segment === "." ||
              segment === ".." ||
              segment.includes(":"),
          ) ||
        typeof file.size !== "number" ||
        !Number.isSafeInteger(file.size) ||
        file.size < 0 ||
        typeof file.sha256 !== "string" ||
        !HASH_PATTERN.test(file.sha256)
      ) {
        throw new Error("Manifest file entry is invalid.");
      }
      const entry = entriesByName.get(file.path);
      if (!entry || entry.header.size !== file.size) {
        throw new Error("Archive entry is missing.");
      }
      totalBytes += file.size;
      if (totalBytes > 50 * 1024 * 1024) {
        throw new Error("Archive expands beyond its limit.");
      }
      const bytes = entry.getData();
      if (
        bytes.byteLength !== file.size ||
        createHash("sha256").update(bytes).digest("hex") !== file.sha256
      ) {
        throw new Error("Archive entry digest does not match.");
      }
      entriesByName.delete(file.path);
    }
    if (entriesByName.size !== 0) {
      throw new Error("Archive contains an unbound entry.");
    }
  } catch {
    throw new PreviewBuildInputUploadError(
      "PREVIEW_BUILD_UPLOAD_BODY_INVALID",
      400,
    );
  }
}

export function signPreviewBuildInputUpload(input: {
  buildInput: PreviewBuildInputArchive;
  jobId: string;
  privateKeyPem: string | undefined;
  now?: Date;
}): string {
  const now = input.now ?? new Date();
  const archive = input.buildInput.archive;
  if (!Buffer.isBuffer(archive)) {
    throw new PreviewBuildInputUploadError(
      "PREVIEW_BUILD_UPLOAD_BODY_INVALID",
      400,
    );
  }
  const archiveDigest = createHash("sha256").update(archive).digest("hex");
  if (
    archive.length < 1 ||
    archive.length > MAX_PREVIEW_BUILD_ARCHIVE_BYTES ||
    archiveDigest !== input.buildInput.archiveDigest ||
    !HASH_PATTERN.test(input.buildInput.manifest.sourceDigest)
  ) {
    throw new PreviewBuildInputUploadError(
      "PREVIEW_BUILD_UPLOAD_BODY_INVALID",
      archive.length > MAX_PREVIEW_BUILD_ARCHIVE_BYTES ? 413 : 400,
    );
  }
  assertArchiveMatchesManifest(archive, input.buildInput.manifest);
  const issuedAt = now.toISOString();
  if (!UUID_PATTERN.test(input.jobId)) {
    throw new PreviewBuildInputUploadError(
      "PREVIEW_BUILD_UPLOAD_BODY_INVALID",
      400,
    );
  }
  const claims = validateClaims(
    {
      version: 2,
      action: "upload-build-input",
      commandId: randomUUID(),
      jobId: input.jobId,
      artifactRefId: previewBuildArtifactRefId(input.jobId, "input"),
      builderProfile: input.buildInput.manifest.builderProfile,
      projectId: input.buildInput.manifest.projectId,
      proposalId: input.buildInput.manifest.proposalId,
      operationId: input.buildInput.manifest.operationId,
      proposalRevision: input.buildInput.manifest.proposalRevision,
      candidateRevision: input.buildInput.manifest.candidateRevision,
      changeSetHash: input.buildInput.manifest.changeSetHash,
      sourceDigest: input.buildInput.manifest.sourceDigest,
      archiveDigest,
      archiveBytes: archive.length,
      issuedAt,
      expiresAt: new Date(now.getTime() + TOKEN_TTL_MS).toISOString(),
    },
    now,
  );
  const key = parseKey(input.privateKeyPem, "private");
  const payload = Buffer.from(canonicalClaims(claims), "utf8");
  const signature = signBytes(
    null,
    Buffer.concat([SIGNING_DOMAIN, payload]),
    key,
  );
  return `${payload.toString("base64url")}.${signature.toString("base64url")}`;
}

export function verifyPreviewBuildInputUpload(
  token: string,
  publicKeyPem: string | undefined,
  now = new Date(),
): PreviewBuildInputUploadClaims {
  if (typeof token !== "string" || token.length > MAX_TOKEN_LENGTH) {
    throw new PreviewBuildInputUploadError(
      "PREVIEW_BUILD_UPLOAD_TOKEN_INVALID",
      401,
    );
  }
  const separator = token.indexOf(".");
  if (
    separator <= 0 ||
    separator !== token.lastIndexOf(".") ||
    !Number.isFinite(now.getTime())
  ) {
    throw new PreviewBuildInputUploadError(
      "PREVIEW_BUILD_UPLOAD_TOKEN_INVALID",
      401,
    );
  }
  const payload = decodeCanonicalBase64Url(token.slice(0, separator));
  const signature = decodeCanonicalBase64Url(token.slice(separator + 1));
  if (!payload || !signature || signature.length !== 64) {
    throw new PreviewBuildInputUploadError(
      "PREVIEW_BUILD_UPLOAD_TOKEN_INVALID",
      401,
    );
  }
  let decoded: unknown;
  try {
    decoded = JSON.parse(payload.toString("utf8"));
  } catch {
    throw new PreviewBuildInputUploadError(
      "PREVIEW_BUILD_UPLOAD_TOKEN_INVALID",
      401,
    );
  }
  const claims = validateClaims(decoded, now);
  if (!payload.equals(Buffer.from(canonicalClaims(claims), "utf8"))) {
    throw new PreviewBuildInputUploadError(
      "PREVIEW_BUILD_UPLOAD_TOKEN_INVALID",
      401,
    );
  }
  const key = parseKey(publicKeyPem, "public");
  if (
    !verifyBytes(null, Buffer.concat([SIGNING_DOMAIN, payload]), key, signature)
  ) {
    throw new PreviewBuildInputUploadError(
      "PREVIEW_BUILD_UPLOAD_TOKEN_INVALID",
      401,
    );
  }
  return claims;
}

export function createPreviewBuildInputUploadHandler(input: {
  publicKeyPem: string;
  objectStore: PreviewBuildInputObjectStore;
  now?: () => Date;
}): PreviewBuildInputUploadHandler {
  const authorizationClaims = new WeakMap<
    PreviewBuildInputUploadAuthorization,
    PreviewBuildInputUploadClaims
  >();
  const authorize = (
    token: string,
    contentLength: number,
  ): PreviewBuildInputUploadAuthorization => {
    const claims = verifyPreviewBuildInputUpload(
      token,
      input.publicKeyPem,
      input.now?.() ?? new Date(),
    );
    if (
      !Number.isSafeInteger(contentLength) ||
      contentLength !== claims.archiveBytes
    ) {
      throw new PreviewBuildInputUploadError(
        "PREVIEW_BUILD_UPLOAD_BODY_INVALID",
        400,
      );
    }
    const authorization = Object.freeze({});
    authorizationClaims.set(authorization, claims);
    return authorization;
  };
  return {
    supportsStreaming:
      typeof (input.objectStore as Partial<PreviewBuildInputStreamObjectStore>)
        .putStream === "function",
    authorize,
    async handle(request) {
      if (request.contentType?.toLowerCase() !== "application/zip") {
        return Response.json(
          { error: "Invalid Preview build upload." },
          { status: 400, headers: { "cache-control": "no-store" } },
        );
      }

      try {
        const claims =
          (request.authorization &&
            authorizationClaims.get(request.authorization)) ??
          verifyPreviewBuildInputUpload(
            request.token ?? "",
            input.publicKeyPem,
            input.now?.() ?? new Date(),
          );
        const contentLength =
          request.contentLength ??
          (Buffer.isBuffer(request.archive)
            ? request.archive.byteLength
            : undefined);
        if (
          !Number.isSafeInteger(contentLength) ||
          contentLength !== claims.archiveBytes ||
          contentLength < 1
        ) {
          throw new PreviewBuildInputUploadError(
            "PREVIEW_BUILD_UPLOAD_BODY_INVALID",
            400,
          );
        }
        if (contentLength > MAX_PREVIEW_BUILD_ARCHIVE_BYTES) {
          throw new PreviewBuildInputUploadError(
            "PREVIEW_BUILD_UPLOAD_BODY_INVALID",
            413,
          );
        }
        const objectKey = previewBuildInputObjectKey(claims);
        let archiveDigest = claims.archiveDigest;
        if (Buffer.isBuffer(request.archive) && !request.bytes) {
          archiveDigest = createHash("sha256")
            .update(request.archive)
            .digest("hex");
          if (
            request.archive.byteLength !== contentLength ||
            archiveDigest !== claims.archiveDigest
          ) {
            throw new PreviewBuildInputUploadError(
              "PREVIEW_BUILD_UPLOAD_BODY_INVALID",
              400,
            );
          }
          await input.objectStore.put({
            jobId: claims.jobId,
            artifactRefId: claims.artifactRefId,
            objectKey,
            archive: request.archive,
            archiveDigest,
            contentLength,
          });
        } else if (!request.archive && request.bytes) {
          const streamStore =
            input.objectStore as Partial<PreviewBuildInputStreamObjectStore>;
          if (typeof streamStore.putStream !== "function") {
            throw new PreviewBuildInputUploadError(
              "PREVIEW_BUILD_UPLOAD_BODY_INVALID",
              400,
            );
          }
          await streamStore.putStream({
            jobId: claims.jobId,
            artifactRefId: claims.artifactRefId,
            objectKey,
            bytes: request.bytes,
            archiveDigest,
            contentLength,
          });
        } else {
          throw new PreviewBuildInputUploadError(
            "PREVIEW_BUILD_UPLOAD_BODY_INVALID",
            400,
          );
        }
        return Response.json(
          {
            action: "build-input-upload",
            jobId: claims.jobId,
            artifactRefId: claims.artifactRefId,
            sourceDigest: claims.sourceDigest,
            archiveDigest,
            objectKey,
          },
          {
            status: 201,
            headers: {
              "cache-control": "no-store",
              "x-content-type-options": "nosniff",
            },
          },
        );
      } catch (error) {
        if (error instanceof PreviewBuildInputUploadError) {
          return Response.json(
            { error: error.code },
            {
              status: error.status,
              headers: {
                "cache-control": "no-store",
                "x-content-type-options": "nosniff",
              },
            },
          );
        }
        if (error instanceof PreviewBuildInputObjectStoreError) {
          const status =
            error.kind === "too_large"
              ? 413
              : error.kind === "invalid"
                ? 400
                : 503;
          const code =
            error.kind === "too_large"
              ? "PREVIEW_BUILD_UPLOAD_TOO_LARGE"
              : error.kind === "invalid"
                ? "PREVIEW_BUILD_UPLOAD_BODY_INVALID"
                : "PREVIEW_BUILD_UPLOAD_UNAVAILABLE";
          return Response.json(
            { error: code },
            {
              status,
              headers: {
                "cache-control": "no-store",
                "x-content-type-options": "nosniff",
              },
            },
          );
        }
        return Response.json(
          { error: "PREVIEW_BUILD_UPLOAD_UNAVAILABLE" },
          {
            status: 503,
            headers: {
              "cache-control": "no-store",
              "x-content-type-options": "nosniff",
            },
          },
        );
      }
    },
  };
}
