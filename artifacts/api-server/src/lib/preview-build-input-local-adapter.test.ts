import { createHash } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { previewBuildArtifactRefId } from "./preview-artifact-reference.js";
import {
  createLocalPreviewArtifactObjectStore,
  LocalPreviewBuildInputStoreError,
} from "./preview-build-input-local.js";
import { createLocalPreviewBuildInputArtifactStore } from "./preview-build-input-local-adapter.js";
import type {
  PreviewBuildInputArchive,
  PreviewBuildInputIdentity,
} from "./preview-build-input.js";
import { PreviewBuildInputObjectStoreError } from "./preview-build-upload.js";

const jobId = "00000000-0000-8000-8000-000000000001";
const identity: PreviewBuildInputIdentity = {
  projectId: "project-1",
  proposalId: "proposal-1",
  operationId: "operation-1",
  proposalRevision: 4,
  candidateRevision: "a".repeat(64),
  changeSetHash: "b".repeat(64),
};
const archiveBytes = Buffer.from("validated preview build archive");
const archiveDigest = createHash("sha256").update(archiveBytes).digest("hex");
const sourceDigest = "c".repeat(64);

function buildInput(
  overrides: Partial<PreviewBuildInputArchive> = {},
): PreviewBuildInputArchive {
  return {
    archive: archiveBytes,
    archiveDigest,
    totalBytes: archiveBytes.byteLength,
    manifest: {
      version: 1,
      builderProfile: "vite-react-static-v1",
      ...identity,
      sourceRoot: ".",
      sourceDigest,
      files: [],
    },
    ...overrides,
  };
}

describe("Local Preview build-input artifact adapter", () => {
  const roots: string[] = [];
  afterEach(async () => {
    await Promise.all(
      roots.splice(0).map((root) => rm(root, { recursive: true, force: true })),
    );
  });

  async function createAdapter() {
    const parent = await mkdtemp(join(tmpdir(), "preview-local-adapter-"));
    roots.push(parent);
    try {
      const store = await createLocalPreviewArtifactObjectStore({
        rootDir: join(parent, "cas"),
        workspaceRoot: process.cwd(),
      });
      return {
        store,
        adapter: createLocalPreviewBuildInputArtifactStore({ store }),
      };
    } catch (error) {
      if (
        error instanceof LocalPreviewBuildInputStoreError &&
        error.code === "PREVIEW_LOCAL_STORE_UNSUPPORTED_PLATFORM"
      ) {
        return null;
      }
      throw error;
    }
  }

  it("stores an immutable job-owned input and returns the stable logical identity", async () => {
    const created = await createAdapter();
    if (!created) return;
    const result = await created.adapter.storeInput({
      jobId,
      identity,
      buildInput: buildInput(),
      now: new Date("2026-11-18T12:00:00.000Z"),
    });

    expect(created.adapter.provider).toBe("local");
    expect(result).toEqual({
      jobId,
      artifactRefId: previewBuildArtifactRefId(jobId, "input"),
      sourceDigest,
      archiveDigest,
      objectKey: expect.stringMatching(
        /^build-inputs\/[a-f0-9]{64}\/[a-f0-9]{64}\.zip$/,
      ),
    });
    const stored = await created.store.read({
      objectKey: result.objectKey,
      jobId,
      artifactRefId: result.artifactRefId,
    });
    expect(stored).toEqual(archiveBytes);
  });

  it("retries with the same Job identity without creating a second reference", async () => {
    const created = await createAdapter();
    if (!created) return;
    const first = await created.adapter.storeInput({
      jobId,
      identity,
      buildInput: buildInput(),
      now: new Date("2026-11-18T12:00:00.000Z"),
    });
    const retry = await created.adapter.storeInput({
      jobId,
      identity,
      buildInput: buildInput(),
      now: new Date("2026-11-18T12:00:01.000Z"),
    });

    expect(retry).toEqual(first);
    await expect(
      created.store.inspect({
        objectKey: first.objectKey,
        jobId,
        artifactRefId: first.artifactRefId,
      }),
    ).resolves.toMatchObject({
      jobId,
      artifactRefId: first.artifactRefId,
      digest: archiveDigest,
    });
  });

  it("rejects a mismatched Candidate identity or archive digest before writing", async () => {
    const created = await createAdapter();
    if (!created) return;
    const mismatched = buildInput({
      manifest: {
        ...buildInput().manifest,
        candidateRevision: "d".repeat(64),
      },
    });

    await expect(
      created.adapter.storeInput({
        jobId,
        identity,
        buildInput: mismatched,
        now: new Date("2026-11-18T12:00:00.000Z"),
      }),
    ).rejects.toBeInstanceOf(PreviewBuildInputObjectStoreError);
    await expect(
      created.adapter.storeInput({
        jobId,
        identity,
        buildInput: buildInput({ archiveDigest: "0".repeat(64) }),
        now: new Date("2026-11-18T12:00:00.000Z"),
      }),
    ).rejects.toBeInstanceOf(PreviewBuildInputObjectStoreError);
  });
});
