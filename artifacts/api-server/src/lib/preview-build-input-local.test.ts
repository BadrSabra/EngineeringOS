import { createHash } from "node:crypto";
import {
  lstat,
  chmod,
  mkdir,
  link,
  mkdtemp,
  readFile,
  readdir,
  rm,
  symlink,
  unlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  createLocalPreviewArtifactObjectStore,
  createLocalPreviewBuildInputObjectStore,
  LocalPreviewBuildInputStoreError,
} from "./preview-build-input-local.js";

const tempRoots: string[] = [];
const BINDING_DIGEST = "b".repeat(64);

async function createStore() {
  const parent = await mkdtemp(join(tmpdir(), "preview-local-store-"));
  tempRoots.push(parent);
  const rootDir = join(parent, "cas");
  const store = await createLocalPreviewBuildInputObjectStore({
    rootDir,
    workspaceRoot: process.cwd(),
  });
  return { parent, rootDir, store };
}

function objectKey(bytes: Buffer, bindingDigest = BINDING_DIGEST) {
  const digest = createHash("sha256").update(bytes).digest("hex");
  return {
    archiveDigest: digest,
    objectKey: `build-inputs/${bindingDigest}/${digest}.zip`,
  };
}

afterEach(async () => {
  await Promise.all(
    tempRoots
      .splice(0)
      .map((root) => rm(root, { recursive: true, force: true })),
  );
});

describe("Local Preview build-input CAS", () => {
  it("persists a private stable store ID without treating it as a paired Agent key", async () => {
    const { rootDir, store } = await createStore();
    const identityPath = join(rootDir, ".store-identity");
    const identityStat = await lstat(identityPath);
    const reopened = await createLocalPreviewBuildInputObjectStore({
      rootDir,
      workspaceRoot: process.cwd(),
    });

    expect(store.storeId).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,
    );
    expect(reopened.storeId).toBe(store.storeId);
    expect(identityStat.isFile()).toBe(true);
    expect(identityStat.mode & 0o777).toBe(0o600);
  });

  it("fails closed when the store identity is replaced by a symlink", async () => {
    const { parent, rootDir } = await createStore();
    const identityPath = join(rootDir, ".store-identity");
    const targetPath = join(parent, "other-identity");
    await writeFile(targetPath, JSON.stringify({
      version: 1,
      storeId: "c617246f-3ccd-4e2d-91e8-e626827696ab",
    }), { mode: 0o600 });
    await unlink(identityPath);
    await symlink(targetPath, identityPath);

    await expect(
      createLocalPreviewBuildInputObjectStore({
        rootDir,
        workspaceRoot: process.cwd(),
      }),
    ).rejects.toMatchObject({
      code: "PREVIEW_LOCAL_STORE_INVALID_CONFIG",
    });
  });

  it("stores bytes by digest and reads them only through the exact immutable reference", async () => {
    const { rootDir, store } = await createStore();
    const bytes = Buffer.from("bounded local archive");
    const identity = objectKey(bytes);

    await store.put({
      ...identity,
      archive: bytes,
      contentLength: bytes.length,
    });

    expect(await store.read(identity.objectKey)).toEqual(bytes);
    expect((await lstat(rootDir)).mode & 0o777).toBe(0o700);
    const staged = await readdir(join(rootDir, "staging"));
    expect(staged).toEqual([]);
  });

  it("accepts exact retries and concurrent identical writes without replacing content", async () => {
    const { store } = await createStore();
    const bytes = Buffer.from("same content, same immutable artifact");
    const identity = objectKey(bytes);
    const put = () =>
      store.put({
        ...identity,
        archive: bytes,
        contentLength: bytes.length,
      });

    await Promise.all([put(), put(), put()]);

    expect(await store.read(identity.objectKey)).toEqual(bytes);
  });

  it("recovers when a blob was published but its manifest could not be published", async () => {
    const { rootDir, store } = await createStore();
    const bytes = Buffer.from("recover the immutable blob after a manifest conflict");
    const identity = objectKey(bytes);
    const referenceDirectory = join(rootDir, "refs", BINDING_DIGEST);
    const referencePath = join(
      referenceDirectory,
      `${identity.archiveDigest}.json`,
    );
    const blobPath = join(
      rootDir,
      "blobs",
      identity.archiveDigest.slice(0, 2),
      `${identity.archiveDigest.slice(2)}.zip`,
    );
    await mkdir(referenceDirectory, { mode: 0o700 });
    await writeFile(referencePath, "conflicting immutable manifest", {
      mode: 0o600,
    });

    await expect(
      store.putStream({
        ...identity,
        bytes: (async function* () {
          yield bytes;
        })(),
        contentLength: bytes.length,
      }),
    ).rejects.toMatchObject({
      code: "PREVIEW_LOCAL_STORE_CONFLICT",
    });
    await expect(lstat(blobPath)).resolves.toBeDefined();
    expect(await readdir(join(rootDir, "staging"))).toEqual([]);
    await expect(store.read(identity.objectKey)).rejects.toThrow(
      LocalPreviewBuildInputStoreError,
    );

    await unlink(referencePath);
    const retry = await store.putStream({
      ...identity,
      bytes: (async function* () {
        yield bytes;
      })(),
      contentLength: bytes.length,
    });
    expect(await store.read(identity.objectKey)).toEqual(bytes);
    expect(await store.inspect(identity.objectKey)).toEqual(retry);
  });

  it("stores successful chunked streams without requiring a caller Buffer", async () => {
    const { rootDir, store } = await createStore();
    const bytes = Buffer.from("chunked payload stored from async iterable");
    const identity = objectKey(bytes);
    async function* chunks() {
      yield bytes.subarray(0, 7);
      yield bytes.subarray(7, 23);
      yield bytes.subarray(23);
    }

    const stored = await store.putStream({
      ...identity,
      bytes: chunks(),
      contentLength: bytes.length,
    });

    expect(stored).toMatchObject({
      storeId: store.storeId,
      digest: identity.archiveDigest,
      sizeBytes: bytes.length,
      retentionPolicy: "preview-build-input-24h-v1",
    });
    expect(stored.objectRefId).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-8[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,
    );
    expect(stored.manifestDigest).toMatch(/^[a-f0-9]{64}$/);
    expect(await store.read(identity.objectKey)).toEqual(bytes);
    expect(await store.inspect(identity.objectKey)).toEqual(stored);

    const repeated = await store.putStream({
      ...identity,
      bytes: (async function* () {
        yield bytes;
      })(),
      contentLength: bytes.length,
    });
    const reopened = await createLocalPreviewBuildInputObjectStore({
      rootDir,
      workspaceRoot: process.cwd(),
    });
    expect(repeated).toEqual(stored);
    expect(await reopened.inspect(identity.objectKey)).toEqual(stored);
  });

  it("binds output metadata to its build reference and live-session retention", async () => {
    const { store } = await createStore();
    const bytes = Buffer.from("output metadata must stay bound to this build");
    const digest = createHash("sha256").update(bytes).digest("hex");
    const outputObjectKey =
      "preview-build-outputs/223e4567-e89b-42d3-a456-426614174001/site.tar.gz";

    const stored = await store.putStream({
      objectKey: outputObjectKey,
      bytes: (async function* () {
        yield bytes;
      })(),
      archiveDigest: digest,
      contentLength: bytes.length,
    });

    expect(stored).toMatchObject({
      storeId: store.storeId,
      digest,
      sizeBytes: bytes.length,
      retentionPolicy: "preview-build-output-live-reference-v1",
    });
    expect(await store.inspect(outputObjectKey)).toEqual(stored);
  });

  it("rejects a manifest whose store or object identity was changed", async () => {
    const { rootDir, store } = await createStore();
    const bytes = Buffer.from("metadata is immutable and store-scoped");
    const identity = objectKey(bytes);
    await store.put({
      ...identity,
      archive: bytes,
      contentLength: bytes.length,
    });
    const referencePath = join(
      rootDir,
      "refs",
      BINDING_DIGEST,
      `${identity.archiveDigest}.json`,
    );
    const manifest = JSON.parse(
      await readFile(referencePath, "utf8"),
    ) as Record<string, unknown>;
    manifest.storeId = "c617246f-3ccd-4e2d-91e8-e626827696ab";
    await writeFile(referencePath, JSON.stringify(manifest), { mode: 0o600 });

    await expect(store.inspect(identity.objectKey)).rejects.toMatchObject({
      code: "PREVIEW_LOCAL_STORE_INVALID_OBJECT",
    });

    manifest.storeId = store.storeId;
    manifest.objectRefId = "323e4567-e89b-42d3-a456-426614174002";
    await writeFile(referencePath, JSON.stringify(manifest), { mode: 0o600 });

    await expect(store.inspect(identity.objectKey)).rejects.toMatchObject({
      code: "PREVIEW_LOCAL_STORE_INVALID_OBJECT",
    });
  });

  it("stores bounded build outputs in the same CAS and preserves shared blobs", async () => {
    const parent = await mkdtemp(join(tmpdir(), "preview-local-artifact-cas-"));
    tempRoots.push(parent);
    const rootDir = join(parent, "cas");
    const store = await createLocalPreviewArtifactObjectStore({
      rootDir,
      workspaceRoot: process.cwd(),
    });
    const bytes = Buffer.from("verified static site artifact");
    const digest = createHash("sha256").update(bytes).digest("hex");
    const input = objectKey(bytes);
    const outputObjectKey =
      "preview-build-outputs/223e4567-e89b-42d3-a456-426614174001/site.tar.gz";

    await store.put({
      ...input,
      archive: bytes,
      contentLength: bytes.length,
    });
    await store.putStream({
      objectKey: outputObjectKey,
      bytes: (async function* () {
        yield bytes.subarray(0, 8);
        yield bytes.subarray(8);
      })(),
      archiveDigest: digest,
      contentLength: bytes.length,
    });
    await store.putStream({
      objectKey: outputObjectKey,
      bytes: (async function* () {
        yield bytes;
      })(),
      archiveDigest: digest,
      contentLength: bytes.length,
    });

    expect(await store.read(outputObjectKey)).toEqual(bytes);
    await store.remove(outputObjectKey, digest);
    expect(await store.read(input.objectKey)).toEqual(bytes);

    await store.remove(input.objectKey);
    await store.remove(outputObjectKey, digest);
    await expect(store.read(outputObjectKey)).rejects.toThrow(
      LocalPreviewBuildInputStoreError,
    );
  });

  it("rejects output keys outside the fixed build-output namespace", async () => {
    const { store } = await createStore();
    const bytes = Buffer.from("not an allowed output reference");
    const digest = createHash("sha256").update(bytes).digest("hex");

    await expect(
      store.putStream({
        objectKey:
          "preview-build-outputs/223e4567-e89b-42d3-a456-426614174001/../site.tar.gz",
        bytes: (async function* () {
          yield bytes;
        })(),
        archiveDigest: digest,
        contentLength: bytes.length,
      }),
    ).rejects.toMatchObject({
      code: "PREVIEW_LOCAL_STORE_INVALID_OBJECT",
    });
  });

  it("does not publish a local output whose bytes fail the declared digest", async () => {
    const { rootDir, store } = await createStore();
    const outputObjectKey =
      "preview-build-outputs/323e4567-e89b-42d3-a456-426614174002/site.tar.gz";
    const bytes = Buffer.from("output bytes that do not match the claim");
    const claimedDigest = createHash("sha256")
      .update("different output bytes")
      .digest("hex");

    await expect(
      store.putStream({
        objectKey: outputObjectKey,
        bytes: (async function* () {
          yield bytes.subarray(0, 9);
          yield bytes.subarray(9);
        })(),
        archiveDigest: claimedDigest,
        contentLength: bytes.byteLength,
      }),
    ).rejects.toMatchObject({
      code: "PREVIEW_LOCAL_STORE_DIGEST_MISMATCH",
    });

    expect(await readdir(join(rootDir, "staging"))).toEqual([]);
    await expect(store.read(outputObjectKey)).rejects.toThrow(
      LocalPreviewBuildInputStoreError,
    );
  });

  it("removes one reference, preserves shared content, and retries deletion idempotently", async () => {
    const { rootDir, store } = await createStore();
    const bytes = Buffer.from("one blob with two independently bound references");
    const first = objectKey(bytes, "1".repeat(64));
    const second = objectKey(bytes, "2".repeat(64));
    const blobPath = join(
      rootDir,
      "blobs",
      first.archiveDigest.slice(0, 2),
      `${first.archiveDigest.slice(2)}.zip`,
    );
    await store.put({
      ...first,
      archive: bytes,
      contentLength: bytes.length,
    });
    await store.put({
      ...second,
      archive: bytes,
      contentLength: bytes.length,
    });
    const firstMetadata = await store.inspect(first.objectKey);
    const secondMetadata = await store.inspect(second.objectKey);
    expect(firstMetadata.objectRefId).not.toBe(secondMetadata.objectRefId);

    await store.remove(first.objectKey);
    expect(await store.read(second.objectKey)).toEqual(bytes);
    await expect(lstat(blobPath)).resolves.toBeDefined();

    await store.remove(second.objectKey);
    await store.remove(second.objectKey);
    await expect(lstat(blobPath)).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("removes an orphaned blob after a prior attempt already removed its manifest", async () => {
    const { rootDir, store } = await createStore();
    const bytes = Buffer.from("recover an interrupted reference cleanup");
    const identity = objectKey(bytes);
    const referencePath = join(
      rootDir,
      "refs",
      BINDING_DIGEST,
      `${identity.archiveDigest}.json`,
    );
    const blobPath = join(
      rootDir,
      "blobs",
      identity.archiveDigest.slice(0, 2),
      `${identity.archiveDigest.slice(2)}.zip`,
    );
    await store.put({
      ...identity,
      archive: bytes,
      contentLength: bytes.length,
    });

    await unlink(referencePath);
    await store.remove(identity.objectKey);

    await expect(lstat(blobPath)).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("hashes streamed bytes and removes staging files when the stream fails", async () => {
    const { rootDir, store } = await createStore();
    const bytes = Buffer.from("stream fragment");
    const identity = objectKey(bytes);

    async function* interruptedStream() {
      yield bytes.subarray(0, 6);
      throw new Error("stream interrupted");
    }

    await expect(
      store.putStream({
        ...identity,
        bytes: interruptedStream(),
        contentLength: bytes.length,
      }),
    ).rejects.toMatchObject({
      code: "PREVIEW_LOCAL_STORE_UNAVAILABLE",
    });
    expect(await readdir(join(rootDir, "staging"))).toEqual([]);
    await expect(store.read(identity.objectKey)).rejects.toThrowError(
      LocalPreviewBuildInputStoreError,
    );
  });

  it("rejects digest mismatch, oversized input, and non-canonical object keys", async () => {
    const { store } = await createStore();
    const bytes = Buffer.from("expected archive");
    const identity = objectKey(bytes);

    await expect(
      store.put({
        ...identity,
        archive: Buffer.from("x".repeat(bytes.length)),
        contentLength: bytes.length,
      }),
    ).rejects.toMatchObject({
      code: "PREVIEW_LOCAL_STORE_DIGEST_MISMATCH",
    });
    await expect(
      store.put({
        objectKey: "../outside.zip",
        archive: bytes,
        archiveDigest: identity.archiveDigest,
        contentLength: bytes.length,
      }),
    ).rejects.toThrowError(LocalPreviewBuildInputStoreError);

    const smallParent = await mkdtemp(
      join(tmpdir(), "preview-local-store-small-"),
    );
    tempRoots.push(smallParent);
    const smallStore = await createLocalPreviewBuildInputObjectStore({
      rootDir: join(smallParent, "cas"),
      workspaceRoot: process.cwd(),
      maxBytes: 8,
    });
    const tooLarge = Buffer.from("more than eight bytes");
    const tooLargeIdentity = objectKey(tooLarge);
    await expect(
      smallStore.put({
        ...tooLargeIdentity,
        archive: tooLarge,
        contentLength: tooLarge.length,
      }),
    ).rejects.toMatchObject({
      code: "PREVIEW_LOCAL_STORE_TOO_LARGE",
    });
  });

  it("rejects a replaced blob instead of returning bytes that no longer match its digest", async () => {
    const { rootDir, store } = await createStore();
    const bytes = Buffer.from("trusted");
    const identity = objectKey(bytes);
    await store.put({
      ...identity,
      archive: bytes,
      contentLength: bytes.length,
    });

    const blobPath = join(
      rootDir,
      "blobs",
      identity.archiveDigest.slice(0, 2),
      `${identity.archiveDigest.slice(2)}.zip`,
    );
    await writeFile(blobPath, Buffer.from("altered"));

    await expect(store.read(identity.objectKey)).rejects.toMatchObject({
      code: "PREVIEW_LOCAL_STORE_DIGEST_MISMATCH",
    });
  });

  it("rejects blobs with an unexpected hard link", async () => {
    const { parent, rootDir, store } = await createStore();
    const bytes = Buffer.from("hard-link protected");
    const identity = objectKey(bytes);
    await store.put({
      ...identity,
      archive: bytes,
      contentLength: bytes.length,
    });
    const blobPath = join(
      rootDir,
      "blobs",
      identity.archiveDigest.slice(0, 2),
      `${identity.archiveDigest.slice(2)}.zip`,
    );
    await link(blobPath, join(parent, "unexpected-hard-link"));

    await expect(store.read(identity.objectKey)).rejects.toMatchObject({
      code: "PREVIEW_LOCAL_STORE_INVALID_OBJECT",
    });
  });

  it("rejects symlink roots and roots placed inside the live workspace", async () => {
    const parent = await mkdtemp(join(tmpdir(), "preview-local-store-links-"));
    tempRoots.push(parent);
    const realRoot = join(parent, "real");
    const aliasRoot = join(parent, "alias");
    await createLocalPreviewBuildInputObjectStore({
      rootDir: realRoot,
      workspaceRoot: process.cwd(),
    });
    await symlink(realRoot, aliasRoot);

    await expect(
      createLocalPreviewBuildInputObjectStore({
        rootDir: aliasRoot,
        workspaceRoot: process.cwd(),
      }),
    ).rejects.toThrowError(LocalPreviewBuildInputStoreError);
    await expect(
      createLocalPreviewBuildInputObjectStore({
        rootDir: resolve(process.cwd(), ".local-preview-store-test"),
        workspaceRoot: process.cwd(),
      }),
    ).rejects.toMatchObject({
      code: "PREVIEW_LOCAL_STORE_INVALID_CONFIG",
    });
  });

  it("rejects a permissive existing root without changing its permissions", async () => {
    const parent = await mkdtemp(join(tmpdir(), "preview-local-store-mode-"));
    tempRoots.push(parent);
    const rootDir = join(parent, "shared");
    await mkdir(rootDir);
    await chmod(rootDir, 0o755);

    await expect(
      createLocalPreviewBuildInputObjectStore({
        rootDir,
        workspaceRoot: process.cwd(),
      }),
    ).rejects.toMatchObject({
      code: "PREVIEW_LOCAL_STORE_INVALID_CONFIG",
    });
    expect((await lstat(rootDir)).mode & 0o777).toBe(0o755);
  });
});
