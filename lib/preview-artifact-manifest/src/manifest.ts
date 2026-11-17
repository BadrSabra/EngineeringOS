import { createHash } from "node:crypto";

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const DIGEST_PATTERN = /^[a-f0-9]{64}$/;

export type PreviewArtifactRetentionPolicy =
  | "preview-build-input-24h-v1"
  | "preview-build-output-live-reference-v1";

export type PreviewArtifactManifestMetadata = {
  storeId: string;
  jobId: string;
  artifactRefId: string;
  digest: string;
  sizeBytes: number;
  manifestDigest: string;
  retentionPolicy: PreviewArtifactRetentionPolicy;
};

export type PreviewArtifactManifestValidationInput = {
  manifestBytes: Buffer;
  objectKey: string;
  expectedStoreId: string;
  expectedJobId?: string;
  expectedArtifactRefId?: string;
  expectedDigest?: string;
  expectedSizeBytes?: number;
  expectedManifestDigest?: string;
  maxBytes: number;
  retentionPolicy: PreviewArtifactRetentionPolicy;
};

export class PreviewArtifactManifestError extends Error {
  constructor() {
    super("Preview artifact manifest is invalid or unavailable.");
    this.name = "PreviewArtifactManifestError";
  }
}

/**
 * Validate the exact canonical version-3 manifest shared by the API CAS and
 * local Agent storage adapters. This checks identity and content metadata, not
 * filesystem permissions or authorization to issue a delete command.
 */
export function validatePreviewArtifactManifest(
  input: PreviewArtifactManifestValidationInput,
): PreviewArtifactManifestMetadata {
  if (
    !Buffer.isBuffer(input.manifestBytes) ||
    input.manifestBytes.length < 1 ||
    input.manifestBytes.length > 2_048 ||
    typeof input.objectKey !== "string" ||
    input.objectKey.length < 1 ||
    input.objectKey.length > 160 ||
    input.objectKey.trim() !== input.objectKey ||
    !UUID_PATTERN.test(input.expectedStoreId) ||
    !Number.isSafeInteger(input.maxBytes) ||
    input.maxBytes < 1
  ) {
    throw new PreviewArtifactManifestError();
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(input.manifestBytes.toString("utf8"));
  } catch {
    throw new PreviewArtifactManifestError();
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new PreviewArtifactManifestError();
  }

  const record = parsed as Record<string, unknown>;
  const jobId = record.jobId;
  const artifactRefId = record.artifactRefId;
  const digest = record.archiveDigest;
  const sizeBytes = record.contentLength;
  const canonical = JSON.stringify({
    version: 3,
    objectKey: input.objectKey,
    storeId: input.expectedStoreId,
    jobId,
    artifactRefId,
    archiveDigest: digest,
    contentLength: sizeBytes,
    retentionPolicy: input.retentionPolicy,
  });

  if (
    Object.keys(record).length !== 8 ||
    record.version !== 3 ||
    record.objectKey !== input.objectKey ||
    record.storeId !== input.expectedStoreId ||
    typeof jobId !== "string" ||
    !UUID_PATTERN.test(jobId) ||
    (input.expectedJobId !== undefined && jobId !== input.expectedJobId) ||
    typeof artifactRefId !== "string" ||
    !UUID_PATTERN.test(artifactRefId) ||
    (input.expectedArtifactRefId !== undefined &&
      artifactRefId !== input.expectedArtifactRefId) ||
    typeof digest !== "string" ||
    !DIGEST_PATTERN.test(digest) ||
    (input.expectedDigest !== undefined &&
      digest !== input.expectedDigest) ||
    typeof sizeBytes !== "number" ||
    !Number.isSafeInteger(sizeBytes) ||
    sizeBytes < 1 ||
    sizeBytes > input.maxBytes ||
    (input.expectedSizeBytes !== undefined &&
      sizeBytes !== input.expectedSizeBytes) ||
    record.retentionPolicy !== input.retentionPolicy ||
    input.manifestBytes.toString("utf8") !== canonical
  ) {
    throw new PreviewArtifactManifestError();
  }

  const manifestDigest = createHash("sha256")
    .update(input.manifestBytes)
    .digest("hex");
  if (
    input.expectedManifestDigest !== undefined &&
    manifestDigest !== input.expectedManifestDigest
  ) {
    throw new PreviewArtifactManifestError();
  }

  return {
    storeId: input.expectedStoreId,
    jobId,
    artifactRefId,
    digest,
    sizeBytes,
    manifestDigest,
    retentionPolicy: input.retentionPolicy,
  };
}
