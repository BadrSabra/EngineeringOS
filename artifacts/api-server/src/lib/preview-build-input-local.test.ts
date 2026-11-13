import { createHash, randomUUID } from "node:crypto";
import { spawn } from "node:child_process";
import {
  lstat,
  chmod,
  mkdir,
  link,
  mkdtemp,
  readFile,
  readdir,
  rm,
  stat as statPath,
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
import { previewBuildArtifactRefId } from "./preview-artifact-reference.js";

const tempRoots: string[] = [];
const BINDING_DIGEST = "b".repeat(64);
const DEFAULT_JOB_ID = "00000000-0000-8000-8000-000000000001";

function artifactOwner(objectKey: string, jobId = DEFAULT_JOB_ID) {
  return {
    jobId,
    artifactRefId: previewBuildArtifactRefId(
      jobId,
      objectKey.startsWith("build-inputs/") ? "input" : "output",
    ),
  };
}

function put(
  store: Awaited<ReturnType<typeof createLocalPreviewBuildInputObjectStore>>,
  input: Omit<
    Parameters<typeof store.put>[0],
    "jobId" | "artifactRefId"
  >,
  jobId = DEFAULT_JOB_ID,
) {
  return store.put({ ...input, ...artifactOwner(input.objectKey, jobId) });
}

function putStream(
  store: Awaited<ReturnType<typeof createLocalPreviewBuildInputObjectStore>>,
  input: Omit<
    Parameters<typeof store.putStream>[0],
    "jobId" | "artifactRefId"
  >,
  jobId = DEFAULT_JOB_ID,
) {
  return store.putStream({
    ...input,
    ...artifactOwner(input.objectKey, jobId),
  });
}

function read(
  store: Awaited<ReturnType<typeof createLocalPreviewBuildInputObjectStore>>,
  objectKey: string,
  jobId = DEFAULT_JOB_ID,
) {
  return store.read({ objectKey, ...artifactOwner(objectKey, jobId) });
}

function inspect(
  store: Awaited<ReturnType<typeof createLocalPreviewBuildInputObjectStore>>,
  objectKey: string,
  jobId = DEFAULT_JOB_ID,
) {
  return store.inspect({ objectKey, ...artifactOwner(objectKey, jobId) });
}

function remove(
  store: Awaited<ReturnType<typeof createLocalPreviewBuildInputObjectStore>>,
  objectKey: string,
  expectedDigest?: string,
  jobId = DEFAULT_JOB_ID,
) {
  return store.remove({
    objectKey,
    expectedDigest,
    ...artifactOwner(objectKey, jobId),
  });
}

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

async function deadProcessStagingFilename(
  kind: "upload" | "reference",
): Promise<string> {
  const [bootId, procStat, pidNamespace] = await Promise.all([
    readFile("/proc/sys/kernel/random/boot_id", "utf8"),
    readFile("/proc/self/stat", "utf8"),
    statPath("/proc/self/ns/pid", { bigint: true }),
  ]);
  const closeParen = procStat.lastIndexOf(")");
  const fields = procStat.slice(closeParen + 1).trim().split(/\s+/);
  const startTimeTicks = fields[19] === "1" ? "2" : "1";
  return `${kind}-${process.pid}-${startTimeTicks}-${pidNamespace.ino}-${bootId.trim().toLowerCase()}-${randomUUID()}.part`;
}

async function killChildAfterMarker(
  script: string,
  args: string[],
  marker: string,
  beforeKill?: () => Promise<void>,
): Promise<void> {
  const child = spawn(
    process.execPath,
    ["--import", "tsx", "--input-type=module", "-e", script, "--", ...args],
    { cwd: process.cwd(), stdio: ["ignore", "pipe", "pipe"] },
  );
  let stdout = "";
  let stderr = "";
  const exit = new Promise<{
    code: number | null;
    signal: NodeJS.Signals | null;
  }>((resolve) => {
    child.once("exit", (code, signal) => resolve({ code, signal }));
  });
  const markerSeen = new Promise<void>((resolve, reject) => {
    const timeout = setTimeout(() => {
      child.kill("SIGKILL");
      reject(new Error(`Child did not emit ${marker}: ${stderr}`));
    }, 10_000);
    child.stdout.on("data", (chunk: Buffer) => {
      stdout += chunk.toString("utf8");
      if (stdout.includes(marker)) {
        clearTimeout(timeout);
        resolve();
      }
    });
    child.stderr.on("data", (chunk: Buffer) => {
      stderr += chunk.toString("utf8");
    });
    child.once("error", (error) => {
      clearTimeout(timeout);
      reject(error);
    });
    child.once("exit", (code, signal) => {
      if (!stdout.includes(marker)) {
        clearTimeout(timeout);
        reject(
          new Error(
            `Child exited before ${marker} (${code}, ${signal}): ${stderr}`,
          ),
        );
      }
    });
  });

  try {
    await markerSeen;
    await beforeKill?.();
    child.kill("SIGKILL");
    await expect(exit).resolves.toEqual({ code: null, signal: "SIGKILL" });
  } finally {
    if (child.exitCode === null && child.signalCode === null) {
      child.kill("SIGKILL");
    }
  }
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

    await put(store, {
      ...identity,
      archive: bytes,
      contentLength: bytes.length,
    });

    expect(await read(store, identity.objectKey)).toEqual(bytes);
    expect((await lstat(rootDir)).mode & 0o777).toBe(0o700);
    const staged = await readdir(join(rootDir, "staging"));
    expect(staged).toEqual([]);
  });

  it("accepts exact retries and concurrent identical writes without replacing content", async () => {
    const { store } = await createStore();
    const bytes = Buffer.from("same content, same immutable artifact");
    const identity = objectKey(bytes);
    const writeAgain = () =>
      put(store, {
        ...identity,
        archive: bytes,
        contentLength: bytes.length,
      });

    await Promise.all([writeAgain(), writeAgain(), writeAgain()]);

    expect(await read(store, identity.objectKey)).toEqual(bytes);
  });

  it("recovers when a blob was published but its manifest could not be published", async () => {
    const { rootDir, store } = await createStore();
    const bytes = Buffer.from("recover the immutable blob after a manifest conflict");
    const identity = objectKey(bytes);
    const referenceDirectory = join(rootDir, "refs");
    const referencePath = join(
      referenceDirectory,
      `${artifactOwner(identity.objectKey).artifactRefId}.json`,
    );
    const blobPath = join(
      rootDir,
      "blobs",
      identity.archiveDigest.slice(0, 2),
      `${identity.archiveDigest.slice(2)}.zip`,
    );
    await writeFile(referencePath, "conflicting immutable manifest", {
      mode: 0o600,
    });

    await expect(
      putStream(store, {
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
    await expect(read(store, identity.objectKey)).rejects.toThrow(
      LocalPreviewBuildInputStoreError,
    );

    await unlink(referencePath);
    const retry = await putStream(store, {
      ...identity,
      bytes: (async function* () {
        yield bytes;
      })(),
      contentLength: bytes.length,
    });
    expect(await read(store, identity.objectKey)).toEqual(bytes);
    expect(await inspect(store, identity.objectKey)).toEqual(retry);
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

    const stored = await putStream(store, {
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
    expect(stored.artifactRefId).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-8[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,
    );
    expect(stored.manifestDigest).toMatch(/^[a-f0-9]{64}$/);
    expect(await read(store, identity.objectKey)).toEqual(bytes);
    expect(await inspect(store, identity.objectKey)).toEqual(stored);

    const repeated = await putStream(store, {
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
    expect(await inspect(reopened, identity.objectKey)).toEqual(stored);
  });

  it("binds output metadata to its build reference and live-session retention", async () => {
    const { store } = await createStore();
    const bytes = Buffer.from("output metadata must stay bound to this build");
    const digest = createHash("sha256").update(bytes).digest("hex");
    const outputObjectKey =
      "preview-build-outputs/223e4567-e89b-42d3-a456-426614174001/g1/site.tar.gz";

    const stored = await putStream(store, {
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
    expect(await inspect(store, outputObjectKey)).toEqual(stored);
  });

  it("rejects a manifest whose store or object identity was changed", async () => {
    const { rootDir, store } = await createStore();
    const bytes = Buffer.from("metadata is immutable and store-scoped");
    const identity = objectKey(bytes);
    await put(store, {
      ...identity,
      archive: bytes,
      contentLength: bytes.length,
    });
    const referencePath = join(
      rootDir,
      "refs",
      `${artifactOwner(identity.objectKey).artifactRefId}.json`,
    );
    const manifest = JSON.parse(
      await readFile(referencePath, "utf8"),
    ) as Record<string, unknown>;
    manifest.storeId = "c617246f-3ccd-4e2d-91e8-e626827696ab";
    await writeFile(referencePath, JSON.stringify(manifest), { mode: 0o600 });

    await expect(inspect(store, identity.objectKey)).rejects.toMatchObject({
      code: "PREVIEW_LOCAL_STORE_INVALID_OBJECT",
    });

    manifest.storeId = store.storeId;
    manifest.artifactRefId = "323e4567-e89b-42d3-a456-426614174002";
    await writeFile(referencePath, JSON.stringify(manifest), { mode: 0o600 });

    await expect(inspect(store, identity.objectKey)).rejects.toMatchObject({
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
      "preview-build-outputs/223e4567-e89b-42d3-a456-426614174001/g1/site.tar.gz";

    await put(store, {
      ...input,
      archive: bytes,
      contentLength: bytes.length,
    });
    await putStream(store, {
      objectKey: outputObjectKey,
      bytes: (async function* () {
        yield bytes.subarray(0, 8);
        yield bytes.subarray(8);
      })(),
      archiveDigest: digest,
      contentLength: bytes.length,
    });
    await putStream(store, {
      objectKey: outputObjectKey,
      bytes: (async function* () {
        yield bytes;
      })(),
      archiveDigest: digest,
      contentLength: bytes.length,
    });

    expect(await read(store, outputObjectKey)).toEqual(bytes);
    await remove(store, outputObjectKey, digest);
    expect(await read(store, input.objectKey)).toEqual(bytes);

    await remove(store, input.objectKey);
    await remove(store, outputObjectKey, digest);
    await expect(read(store, outputObjectKey)).rejects.toThrow(
      LocalPreviewBuildInputStoreError,
    );
  });

  it("rejects output keys outside the fixed build-output namespace", async () => {
    const { store } = await createStore();
    const bytes = Buffer.from("not an allowed output reference");
    const digest = createHash("sha256").update(bytes).digest("hex");

    await expect(
      putStream(store, {
        objectKey:
          "preview-build-outputs/223e4567-e89b-42d3-a456-426614174001/g1/../site.tar.gz",
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
      "preview-build-outputs/323e4567-e89b-42d3-a456-426614174002/g1/site.tar.gz";
    const bytes = Buffer.from("output bytes that do not match the claim");
    const claimedDigest = createHash("sha256")
      .update("different output bytes")
      .digest("hex");

    await expect(
      putStream(store, {
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
    await expect(read(store, outputObjectKey)).rejects.toThrow(
      LocalPreviewBuildInputStoreError,
    );
  });

  it("removes one reference, preserves shared content, and retries deletion idempotently", async () => {
    const { rootDir, store } = await createStore();
    const bytes = Buffer.from("one blob with two independently bound references");
    const first = objectKey(bytes, "1".repeat(64));
    const second = objectKey(bytes, "2".repeat(64));
    const firstJobId = "00000000-0000-8000-8000-000000000002";
    const secondJobId = "00000000-0000-8000-8000-000000000003";
    const blobPath = join(
      rootDir,
      "blobs",
      first.archiveDigest.slice(0, 2),
      `${first.archiveDigest.slice(2)}.zip`,
    );
    await put(store, {
      ...first,
      archive: bytes,
      contentLength: bytes.length,
    }, firstJobId);
    await put(store, {
      ...second,
      archive: bytes,
      contentLength: bytes.length,
    }, secondJobId);
    const firstMetadata = await inspect(store, first.objectKey, firstJobId);
    const secondMetadata = await inspect(store, second.objectKey, secondJobId);
    expect(firstMetadata.artifactRefId).not.toBe(secondMetadata.artifactRefId);

    await remove(store, first.objectKey, undefined, firstJobId);
    expect(await read(store, second.objectKey, secondJobId)).toEqual(bytes);
    await expect(lstat(blobPath)).resolves.toBeDefined();

    await remove(store, second.objectKey, undefined, secondJobId);
    await remove(store, second.objectKey, undefined, secondJobId);
    await expect(lstat(blobPath)).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("keeps same-key references job-scoped while deduplicating the shared blob", async () => {
    const { rootDir, store } = await createStore();
    const bytes = Buffer.from("same Candidate archive, two independent build jobs");
    const identity = objectKey(bytes);
    const firstJobId = "00000000-0000-8000-8000-000000000004";
    const secondJobId = "00000000-0000-8000-8000-000000000005";
    const blobPath = join(
      rootDir,
      "blobs",
      identity.archiveDigest.slice(0, 2),
      `${identity.archiveDigest.slice(2)}.zip`,
    );

    await put(
      store,
      { ...identity, archive: bytes, contentLength: bytes.length },
      firstJobId,
    );
    await put(
      store,
      { ...identity, archive: bytes, contentLength: bytes.length },
      secondJobId,
    );

    const first = await inspect(store, identity.objectKey, firstJobId);
    const second = await inspect(store, identity.objectKey, secondJobId);
    expect(first.artifactRefId).not.toBe(second.artifactRefId);
    expect(first.digest).toBe(second.digest);
    const unownedJobId = "00000000-0000-8000-8000-000000000006";
    await expect(
      read(store, identity.objectKey, unownedJobId),
    ).rejects.toThrow(LocalPreviewBuildInputStoreError);
    await expect(
      store.read({
        objectKey: identity.objectKey,
        jobId: unownedJobId,
        artifactRefId: "../../outside",
      }),
    ).rejects.toMatchObject({ code: "PREVIEW_LOCAL_STORE_INVALID_OBJECT" });
    await remove(store, identity.objectKey, undefined, unownedJobId);
    expect(await read(store, identity.objectKey, firstJobId)).toEqual(bytes);
    await remove(store, identity.objectKey, undefined, firstJobId);
    await expect(read(store, identity.objectKey, firstJobId)).rejects.toThrow(
      LocalPreviewBuildInputStoreError,
    );
    expect(await read(store, identity.objectKey, secondJobId)).toEqual(bytes);
    await expect(lstat(blobPath)).resolves.toBeDefined();
    await remove(store, identity.objectKey, undefined, secondJobId);
    await expect(lstat(blobPath)).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("removes an orphaned blob after a prior attempt already removed its manifest", async () => {
    const { rootDir, store } = await createStore();
    const bytes = Buffer.from("recover an interrupted reference cleanup");
    const identity = objectKey(bytes);
    const referencePath = join(
      rootDir,
      "refs",
      `${artifactOwner(identity.objectKey).artifactRefId}.json`,
    );
    const blobPath = join(
      rootDir,
      "blobs",
      identity.archiveDigest.slice(0, 2),
      `${identity.archiveDigest.slice(2)}.zip`,
    );
    await put(store, {
      ...identity,
      archive: bytes,
      contentLength: bytes.length,
    });

    await unlink(referencePath);
    await remove(store, identity.objectKey);

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
      putStream(store, {
        ...identity,
        bytes: interruptedStream(),
        contentLength: bytes.length,
      }),
    ).rejects.toMatchObject({
      code: "PREVIEW_LOCAL_STORE_UNAVAILABLE",
    });
    expect(await readdir(join(rootDir, "staging"))).toEqual([]);
    await expect(read(store, identity.objectKey)).rejects.toThrowError(
      LocalPreviewBuildInputStoreError,
    );
  });

  it("does not publish a partial artifact when its writer is killed and allows retry after reopen", async () => {
    const { rootDir } = await createStore();
    const firstChunk = Buffer.alloc(64 * 1024, 0x61);
    const secondChunk = Buffer.alloc(64 * 1024, 0x62);
    const completeBytes = Buffer.concat([firstChunk, secondChunk]);
    const identity = objectKey(completeBytes);
    const jobId = DEFAULT_JOB_ID;
    const artifactRefId = previewBuildArtifactRefId(jobId, "input");
    const childScript = [
      'import { createLocalPreviewBuildInputObjectStore } from "./src/lib/preview-build-input-local.ts";',
      'import { previewBuildArtifactRefId } from "./src/lib/preview-artifact-reference.ts";',
      "const [rootDir, workspaceRoot, jobId, objectKey, archiveDigest, contentLength, firstChunk] = process.argv.slice(1);",
      "const store = await createLocalPreviewBuildInputObjectStore({ rootDir, workspaceRoot });",
      "async function* interruptedStream() {",
      '  yield Buffer.from(firstChunk, "base64");',
      '  process.stdout.write("STAGED_CHUNK\\n");',
      "  setInterval(() => {}, 1_000);",
      "  await new Promise(() => {});",
      "}",
      "await store.putStream({",
      "  jobId,",
      '  artifactRefId: previewBuildArtifactRefId(jobId, "input"),',
      "  objectKey,",
      "  bytes: interruptedStream(),",
      "  archiveDigest,",
      "  contentLength: Number(contentLength),",
      "});",
    ].join("\n");
    await killChildAfterMarker(
      childScript,
      [
        rootDir,
        process.cwd(),
        jobId,
        identity.objectKey,
        identity.archiveDigest,
        String(completeBytes.length),
        firstChunk.toString("base64"),
      ],
      "STAGED_CHUNK\n",
      async () => {
        await createLocalPreviewBuildInputObjectStore({
          rootDir,
          workspaceRoot: process.cwd(),
        });
        expect(await readdir(join(rootDir, "staging"))).toHaveLength(1);
      },
    );

    const reopened = await createLocalPreviewBuildInputObjectStore({
      rootDir,
      workspaceRoot: process.cwd(),
    });
    await expect(
      read(reopened, identity.objectKey, jobId),
    ).rejects.toThrowError(LocalPreviewBuildInputStoreError);
    expect(await readdir(join(rootDir, "blobs"))).toEqual([]);
    expect(await readdir(join(rootDir, "refs"))).toEqual([]);
    expect(await readdir(join(rootDir, "staging"))).toEqual([]);

    await putStream(
      reopened,
      {
        ...identity,
        bytes: (async function* () {
          yield completeBytes;
        })(),
        contentLength: completeBytes.length,
      },
      jobId,
    );
    expect(await read(reopened, identity.objectKey, jobId)).toEqual(
      completeBytes,
    );
    expect(await inspect(reopened, identity.objectKey, jobId)).toMatchObject({
      jobId,
      artifactRefId,
      digest: identity.archiveDigest,
      sizeBytes: completeBytes.length,
    });
  });

  it("recovers a committed artifact when its writer dies before acknowledging success", async () => {
    const { rootDir } = await createStore();
    const completeBytes = Buffer.from("committed locally before response loss");
    const identity = objectKey(completeBytes);
    const jobId = DEFAULT_JOB_ID;
    const artifactRefId = previewBuildArtifactRefId(jobId, "input");
    const childScript = [
      'import { createLocalPreviewBuildInputObjectStore } from "./src/lib/preview-build-input-local.ts";',
      'import { previewBuildArtifactRefId } from "./src/lib/preview-artifact-reference.ts";',
      "const [rootDir, workspaceRoot, jobId, objectKey, archiveDigest, contentLength, bytes] = process.argv.slice(1);",
      "const store = await createLocalPreviewBuildInputObjectStore({ rootDir, workspaceRoot });",
      "async function* completeStream() {",
      '  yield Buffer.from(bytes, "base64");',
      "}",
      "await store.putStream({",
      "  jobId,",
      '  artifactRefId: previewBuildArtifactRefId(jobId, "input"),',
      "  objectKey,",
      "  bytes: completeStream(),",
      "  archiveDigest,",
      "  contentLength: Number(contentLength),",
      "});",
      'process.stdout.write("COMMITTED\\n");',
      "setInterval(() => {}, 1_000);",
      "await new Promise(() => {});",
    ].join("\n");
    await killChildAfterMarker(
      childScript,
      [
        rootDir,
        process.cwd(),
        jobId,
        identity.objectKey,
        identity.archiveDigest,
        String(completeBytes.length),
        completeBytes.toString("base64"),
      ],
      "COMMITTED\n",
    );

    const reopened = await createLocalPreviewBuildInputObjectStore({
      rootDir,
      workspaceRoot: process.cwd(),
    });
    expect(await read(reopened, identity.objectKey, jobId)).toEqual(
      completeBytes,
    );
    await putStream(
      reopened,
      {
        ...identity,
        bytes: (async function* () {
          yield completeBytes;
        })(),
        contentLength: completeBytes.length,
      },
      jobId,
    );
    expect(await read(reopened, identity.objectKey, jobId)).toEqual(
      completeBytes,
    );
    expect(await inspect(reopened, identity.objectKey, jobId)).toMatchObject({
      jobId,
      artifactRefId,
      digest: identity.archiveDigest,
      sizeBytes: completeBytes.length,
    });
    expect(await readdir(join(rootDir, "refs"))).toEqual([
      `${artifactRefId}.json`,
    ]);
  });

  it("leaves legacy and other-boot staging files untouched", async () => {
    const { rootDir } = await createStore();
    const stagingRoot = join(rootDir, "staging");
    const bootId = (await readFile("/proc/sys/kernel/random/boot_id", "utf8"))
      .trim()
      .toLowerCase();
    const otherBootId = `${bootId.startsWith("0") ? "1" : "0"}${bootId.slice(1)}`;
    const legacyName = `upload-${randomUUID()}.part`;
    const otherBootName = `upload-${process.pid}-1-1-${otherBootId}-${randomUUID()}.part`;
    const marker = Buffer.from("preserve-unowned-staging");
    await writeFile(join(stagingRoot, legacyName), marker, { mode: 0o600 });
    await writeFile(join(stagingRoot, otherBootName), marker, { mode: 0o600 });

    await createLocalPreviewBuildInputObjectStore({
      rootDir,
      workspaceRoot: process.cwd(),
    });

    expect((await readdir(stagingRoot)).sort()).toEqual(
      [legacyName, otherBootName].sort(),
    );
    expect(await readFile(join(stagingRoot, legacyName))).toEqual(marker);
    expect(await readFile(join(stagingRoot, otherBootName))).toEqual(marker);
  });

  it("recovers published blob and manifest hard links left by a dead writer", async () => {
    const { rootDir } = await createStore();
    const bytes = Buffer.from("recover a published blob link");
    const identity = objectKey(bytes);
    const blobDirectory = join(
      rootDir,
      "blobs",
      identity.archiveDigest.slice(0, 2),
    );
    await mkdir(blobDirectory, { mode: 0o700 });
    const blobPath = join(
      blobDirectory,
      `${identity.archiveDigest.slice(2)}.zip`,
    );
    await writeFile(blobPath, bytes, { mode: 0o600 });
    const uploadStage = join(
      rootDir,
      "staging",
      await deadProcessStagingFilename("upload"),
    );
    await link(blobPath, uploadStage);
    expect((await lstat(blobPath)).nlink).toBe(2);

    const reopened = await createLocalPreviewBuildInputObjectStore({
      rootDir,
      workspaceRoot: process.cwd(),
    });
    await expect(lstat(uploadStage)).rejects.toMatchObject({
      code: "ENOENT",
    });
    expect((await lstat(blobPath)).nlink).toBe(1);
    await putStream(
      reopened,
      {
        ...identity,
        bytes: (async function* () {
          yield bytes;
        })(),
        contentLength: bytes.length,
      },
    );
    expect(await read(reopened, identity.objectKey)).toEqual(bytes);

    const referencePath = join(
      rootDir,
      "refs",
      `${artifactOwner(identity.objectKey).artifactRefId}.json`,
    );
    const referenceStage = join(
      rootDir,
      "staging",
      await deadProcessStagingFilename("reference"),
    );
    await link(referencePath, referenceStage);
    expect((await lstat(referencePath)).nlink).toBe(2);

    const reopenedAfterReferenceLink =
      await createLocalPreviewBuildInputObjectStore({
        rootDir,
        workspaceRoot: process.cwd(),
      });
    await expect(lstat(referenceStage)).rejects.toMatchObject({
      code: "ENOENT",
    });
    expect((await lstat(referencePath)).nlink).toBe(1);
    expect(
      await read(reopenedAfterReferenceLink, identity.objectKey),
    ).toEqual(bytes);
  });

  it("rejects digest mismatch, oversized input, and non-canonical object keys", async () => {
    const { store } = await createStore();
    const bytes = Buffer.from("expected archive");
    const identity = objectKey(bytes);

    await expect(
      put(store, {
        ...identity,
        archive: Buffer.from("x".repeat(bytes.length)),
        contentLength: bytes.length,
      }),
    ).rejects.toMatchObject({
      code: "PREVIEW_LOCAL_STORE_DIGEST_MISMATCH",
    });
    await expect(
      put(store, {
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
      put(smallStore, {
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
    await put(store, {
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

    await expect(read(store, identity.objectKey)).rejects.toMatchObject({
      code: "PREVIEW_LOCAL_STORE_DIGEST_MISMATCH",
    });
  });

  it("rejects blobs with an unexpected hard link", async () => {
    const { parent, rootDir, store } = await createStore();
    const bytes = Buffer.from("hard-link protected");
    const identity = objectKey(bytes);
    await put(store, {
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

    await expect(read(store, identity.objectKey)).rejects.toMatchObject({
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
