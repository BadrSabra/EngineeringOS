import { createHash } from "node:crypto";
import type { PreviewBuildInputIdentity } from "./preview-build-input.js";
import {
  PreviewBuildInputObjectStoreError,
  previewBuildInputObjectKeyForArchive,
} from "./preview-build-upload.js";
import { previewBuildArtifactRefId } from "./preview-artifact-reference.js";
import type {
  PreviewBuildInputArtifactStore,
  PreviewBuildInputArtifactReceipt,
} from "./preview-build-provider-contracts.js";
import type { LocalPreviewArtifactObjectStore } from "./preview-build-input-local.js";

const HASH_PATTERN = /^[a-f0-9]{64}$/i;

function sameIdentity(
  left: PreviewBuildInputIdentity,
  right: PreviewBuildInputIdentity,
): boolean {
  return (
    left.projectId === right.projectId &&
    left.proposalId === right.proposalId &&
    left.operationId === right.operationId &&
    left.proposalRevision === right.proposalRevision &&
    left.candidateRevision.toLowerCase() ===
      right.candidateRevision.toLowerCase() &&
    left.changeSetHash.toLowerCase() === right.changeSetHash.toLowerCase()
  );
}

/**
 * Adapts the existing local CAS to the provider-neutral build-input port.
 *
 * This adapter only stores the already-validated immutable archive. It does
 * not create or authorize a Job, dispatch a Builder, or enable Candidate
 * execution. The normal build-start path remains S3-only until Local Agent
 * ownership and a qualified Runner are connected.
 */
export function createLocalPreviewBuildInputArtifactStore(input: {
  store: LocalPreviewArtifactObjectStore;
}): PreviewBuildInputArtifactStore {
  return {
    provider: "local",
    async storeInput({
      jobId,
      identity,
      buildInput,
    }): Promise<PreviewBuildInputArtifactReceipt> {
      const manifest = buildInput?.manifest;
      const archive = buildInput?.archive;
      if (
        !Buffer.isBuffer(archive) ||
        !manifest ||
        !sameIdentity(identity, manifest) ||
        manifest.builderProfile !== "vite-react-static-v1" ||
        !HASH_PATTERN.test(manifest.sourceDigest) ||
        !HASH_PATTERN.test(buildInput.archiveDigest) ||
        !Number.isSafeInteger(archive.byteLength) ||
        archive.byteLength < 1 ||
        archive.byteLength > 50 * 1024 * 1024 ||
        buildInput.totalBytes !== archive.byteLength ||
        createHash("sha256").update(archive).digest("hex") !==
          buildInput.archiveDigest.toLowerCase()
      ) {
        throw new PreviewBuildInputObjectStoreError("invalid");
      }

      const archiveDigest = buildInput.archiveDigest.toLowerCase();
      const artifactRefId = previewBuildArtifactRefId(jobId, "input");
      const objectKey = previewBuildInputObjectKeyForArchive({
        identity,
        sourceDigest: manifest.sourceDigest.toLowerCase(),
        archiveDigest,
      });

      try {
        const written = await input.store.putStream({
          jobId,
          artifactRefId,
          objectKey,
          bytes: (async function* () {
            yield archive;
          })(),
          archiveDigest,
          contentLength: archive.byteLength,
        });
        const stored = await input.store.inspect({
          objectKey,
          jobId,
          artifactRefId,
        });
        if (
          !written ||
          written.storeId !== input.store.storeId ||
          written.jobId !== jobId ||
          written.artifactRefId !== artifactRefId ||
          written.digest !== archiveDigest ||
          written.sizeBytes !== archive.byteLength ||
          written.retentionPolicy !== "preview-build-input-24h-v1" ||
          stored.storeId !== written.storeId ||
          stored.jobId !== written.jobId ||
          stored.artifactRefId !== written.artifactRefId ||
          stored.digest !== written.digest ||
          stored.sizeBytes !== written.sizeBytes ||
          stored.manifestDigest !== written.manifestDigest ||
          stored.retentionPolicy !== written.retentionPolicy
        ) {
          throw new PreviewBuildInputObjectStoreError("unavailable");
        }
      } catch (error) {
        if (error instanceof PreviewBuildInputObjectStoreError) throw error;
        throw new PreviewBuildInputObjectStoreError("unavailable");
      }

      return {
        jobId,
        artifactRefId,
        sourceDigest: manifest.sourceDigest.toLowerCase(),
        archiveDigest,
        objectKey,
      };
    },
  };
}
