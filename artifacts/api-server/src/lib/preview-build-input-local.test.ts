import { createHash } from "node:crypto";
import {
  lstat,
  chmod,
  mkdir,
  link,
  mkdtemp,
  readdir,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
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

  it("stores successful chunked streams without requiring a caller Buffer", async () => {
    const { store } = await createStore();
    const bytes = Buffer.from("chunked payload stored from async iterable");
    const identity = objectKey(bytes);
    async function* chunks() {
      yield bytes.subarray(0, 7);
      yield bytes.subarray(7, 23);
      yield bytes.subarray(23);
    }

    await store.putStream({
      ...identity,
      bytes: chunks(),
      contentLength: bytes.length,
    });

    expect(await store.read(identity.objectKey)).toEqual(bytes);
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

    await store.remove(first.objectKey);
    expect(await store.read(second.objectKey)).toEqual(bytes);
    await expect(lstat(blobPath)).resolves.toBeDefined();

    await store.remove(second.objectKey);
    await store.remove(second.objectKey);
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
