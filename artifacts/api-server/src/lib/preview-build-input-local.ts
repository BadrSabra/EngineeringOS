import { createHash, randomUUID } from "node:crypto";
import { constants } from "node:fs";
import {
  lstat,
  link,
  mkdir,
  open,
  readdir,
  realpath,
  unlink,
  type FileHandle,
} from "node:fs/promises";
import { dirname, isAbsolute, relative, resolve, sep } from "node:path";
import {
  PreviewBuildInputObjectStoreError,
  type PreviewBuildInputObjectStore,
  type PreviewBuildArtifactWriteMetadata,
} from "./preview-build-upload.js";
import { previewBuildArtifactRefId } from "./preview-artifact-reference.js";
import { isPreviewBuildOutputArtifactKey } from "./preview-build-output-key.js";

const OBJECT_KEY_PATTERN =
  /^build-inputs\/([a-f0-9]{64})\/([a-f0-9]{64})\.zip$/;
const DIGEST_PATTERN = /^[a-f0-9]{64}$/;
const DEFAULT_MAX_INPUT_BYTES = 55 * 1024 * 1024;
const MAX_OUTPUT_BYTES = 32 * 1024 * 1024;
const MAX_MANIFEST_BYTES = 2_048;
const STORE_IDENTITY_FILE = ".store-identity";
const CHUNK_BYTES = 64 * 1024;
const FILE_FLAGS = constants.O_NOFOLLOW;
const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export class LocalPreviewBuildInputStoreError extends PreviewBuildInputObjectStoreError {
  constructor(
    readonly code:
      | "PREVIEW_LOCAL_STORE_INVALID_CONFIG"
      | "PREVIEW_LOCAL_STORE_UNSUPPORTED_PLATFORM"
      | "PREVIEW_LOCAL_STORE_INVALID_OBJECT"
      | "PREVIEW_LOCAL_STORE_TOO_LARGE"
      | "PREVIEW_LOCAL_STORE_DIGEST_MISMATCH"
      | "PREVIEW_LOCAL_STORE_CONFLICT"
      | "PREVIEW_LOCAL_STORE_UNAVAILABLE",
  ) {
    const kind =
      code === "PREVIEW_LOCAL_STORE_TOO_LARGE"
        ? "too_large"
        : code === "PREVIEW_LOCAL_STORE_INVALID_OBJECT" ||
            code === "PREVIEW_LOCAL_STORE_DIGEST_MISMATCH"
          ? "invalid"
          : "unavailable";
    super(kind);
    this.name = "LocalPreviewBuildInputStoreError";
  }
}

type ObjectIdentity = {
  archiveDigest?: string;
  artifactRole: "input" | "output";
  maxBytes: number;
  retentionPolicy: PreviewBuildArtifactWriteMetadata["retentionPolicy"];
};

function parseObjectKey(value: string): ObjectIdentity {
  const inputMatch =
    typeof value === "string" && value.length <= 160
      ? OBJECT_KEY_PATTERN.exec(value)
      : null;
  if (inputMatch) {
    return {
      archiveDigest: inputMatch[2]!,
      artifactRole: "input",
      maxBytes: DEFAULT_MAX_INPUT_BYTES,
      retentionPolicy: "preview-build-input-24h-v1",
    };
  }

  if (!isPreviewBuildOutputArtifactKey(value)) {
    throw new LocalPreviewBuildInputStoreError(
      "PREVIEW_LOCAL_STORE_INVALID_OBJECT",
    );
  }
  return {
    artifactRole: "output",
    maxBytes: MAX_OUTPUT_BYTES,
    retentionPolicy: "preview-build-output-live-reference-v1",
  };
}

function isWithin(base: string, target: string): boolean {
  const relativePath = relative(base, target);
  return (
    relativePath === "" ||
    (!relativePath.startsWith(`..${sep}`) &&
      relativePath !== ".." &&
      !isAbsolute(relativePath))
  );
}

function errorCode(error: unknown): string | undefined {
  if (!error || typeof error !== "object") return undefined;
  const code = (error as { code?: unknown }).code;
  return typeof code === "string" ? code : undefined;
}

async function ensurePrivateDirectory(path: string): Promise<void> {
  let created = false;
  try {
    await mkdir(path, { mode: 0o700 });
    created = true;
  } catch (error) {
    if (errorCode(error) !== "EEXIST") throw error;
  }
  const stat = await lstat(path);
  if (!stat.isDirectory() || stat.isSymbolicLink()) {
    throw new LocalPreviewBuildInputStoreError(
      "PREVIEW_LOCAL_STORE_INVALID_CONFIG",
    );
  }
  if (typeof process.getuid === "function" && stat.uid !== process.getuid()) {
    throw new LocalPreviewBuildInputStoreError(
      "PREVIEW_LOCAL_STORE_INVALID_CONFIG",
    );
  }
  const secured = await lstat(path);
  if (
    !secured.isDirectory() ||
    secured.isSymbolicLink() ||
    (typeof process.getuid === "function" &&
      secured.uid !== process.getuid()) ||
    (secured.mode & 0o077) !== 0
  ) {
    throw new LocalPreviewBuildInputStoreError(
      "PREVIEW_LOCAL_STORE_INVALID_CONFIG",
    );
  }
  if (created && (secured.mode & 0o700) !== 0o700) {
    throw new LocalPreviewBuildInputStoreError(
      "PREVIEW_LOCAL_STORE_INVALID_CONFIG",
    );
  }
}

async function syncDirectory(path: string): Promise<void> {
  const directory = await open(
    path,
    constants.O_RDONLY | constants.O_DIRECTORY | FILE_FLAGS,
  );
  try {
    await directory.sync();
  } finally {
    await directory.close();
  }
}

async function waitForSingleLink(path: string): Promise<boolean> {
  for (let attempt = 0; attempt < 50; attempt += 1) {
    try {
      const stat = await lstat(path);
      if (!stat.isFile() || stat.isSymbolicLink()) return false;
      if (stat.nlink === 1) return true;
      if (stat.nlink !== 2) return false;
    } catch {
      return false;
    }
    await new Promise((resolveDelay) => setTimeout(resolveDelay, 10));
  }
  return false;
}

async function filesHaveExactBytes(
  existingPath: string,
  stagedPath: string,
  expectedSize: number,
): Promise<boolean> {
  if (!(await waitForSingleLink(existingPath))) return false;
  let existing;
  let staged;
  try {
    existing = await open(existingPath, constants.O_RDONLY | FILE_FLAGS);
    staged = await open(stagedPath, constants.O_RDONLY | FILE_FLAGS);
    const [existingStat, stagedStat] = await Promise.all([
      existing.stat(),
      staged.stat(),
    ]);
    if (
      !existingStat.isFile() ||
      !stagedStat.isFile() ||
      existingStat.nlink !== 1 ||
      stagedStat.nlink !== 1 ||
      (typeof process.getuid === "function" &&
        (existingStat.uid !== process.getuid() ||
          stagedStat.uid !== process.getuid())) ||
      (existingStat.mode & 0o077) !== 0 ||
      (stagedStat.mode & 0o077) !== 0 ||
      existingStat.size !== expectedSize ||
      stagedStat.size !== expectedSize
    ) {
      return false;
    }
    const left = Buffer.allocUnsafe(CHUNK_BYTES);
    const right = Buffer.allocUnsafe(CHUNK_BYTES);
    let offset = 0;
    while (offset < expectedSize) {
      const length = Math.min(CHUNK_BYTES, expectedSize - offset);
      const [leftRead, rightRead] = await Promise.all([
        existing.read(left, 0, length, offset),
        staged.read(right, 0, length, offset),
      ]);
      if (
        leftRead.bytesRead !== length ||
        rightRead.bytesRead !== length ||
        !left.subarray(0, length).equals(right.subarray(0, length))
      ) {
        return false;
      }
      offset += length;
    }
    return true;
  } catch {
    return false;
  } finally {
    await Promise.allSettled([existing?.close(), staged?.close()]);
  }
}

async function readRegularFile(
  path: string,
  maxBytes: number,
): Promise<Buffer> {
  let handle;
  try {
    const before = await lstat(path);
    if (
      !before.isFile() ||
      before.isSymbolicLink() ||
      before.nlink !== 1 ||
      (typeof process.getuid === "function" &&
        before.uid !== process.getuid()) ||
      (before.mode & 0o077) !== 0 ||
      before.size < 1 ||
      before.size > maxBytes
    ) {
      throw new LocalPreviewBuildInputStoreError(
        "PREVIEW_LOCAL_STORE_INVALID_OBJECT",
      );
    }
    handle = await open(path, constants.O_RDONLY | FILE_FLAGS);
    const opened = await handle.stat();
    if (
      !opened.isFile() ||
      opened.nlink !== 1 ||
      (typeof process.getuid === "function" &&
        opened.uid !== process.getuid()) ||
      (opened.mode & 0o077) !== 0 ||
      opened.size !== before.size ||
      opened.size > maxBytes
    ) {
      throw new LocalPreviewBuildInputStoreError(
        "PREVIEW_LOCAL_STORE_INVALID_OBJECT",
      );
    }
    const bytes = await handle.readFile();
    if (bytes.length !== opened.size || bytes.length > maxBytes) {
      throw new LocalPreviewBuildInputStoreError(
        "PREVIEW_LOCAL_STORE_INVALID_OBJECT",
      );
    }
    return bytes;
  } catch (error) {
    if (error instanceof LocalPreviewBuildInputStoreError) throw error;
    throw new LocalPreviewBuildInputStoreError(
      "PREVIEW_LOCAL_STORE_UNAVAILABLE",
    );
  } finally {
    await handle?.close().catch(() => undefined);
  }
}

function parseStoreId(bytes: Buffer): string {
  let value: unknown;
  try {
    value = JSON.parse(bytes.toString("utf8"));
  } catch {
    throw new LocalPreviewBuildInputStoreError(
      "PREVIEW_LOCAL_STORE_INVALID_CONFIG",
    );
  }
  if (
    !value ||
    typeof value !== "object" ||
    Array.isArray(value) ||
    Object.keys(value).length !== 2 ||
    (value as Record<string, unknown>).version !== 1 ||
    typeof (value as Record<string, unknown>).storeId !== "string" ||
    !UUID_PATTERN.test((value as Record<string, string>).storeId) ||
    bytes.toString("utf8") !==
      JSON.stringify({
        version: 1,
        storeId: (value as Record<string, string>).storeId,
      })
  ) {
    throw new LocalPreviewBuildInputStoreError(
      "PREVIEW_LOCAL_STORE_INVALID_CONFIG",
    );
  }
  return (value as Record<string, string>).storeId;
}

async function readStoreId(path: string): Promise<string> {
  return parseStoreId(await readRegularFile(path, 128));
}

async function loadOrCreateStoreId(rootDir: string): Promise<string> {
  const identityPath = resolve(rootDir, STORE_IDENTITY_FILE);
  const readExisting = async () => {
    for (let attempt = 0; attempt < 20; attempt += 1) {
      try {
        return await readStoreId(identityPath);
      } catch (error) {
        if (
          error instanceof LocalPreviewBuildInputStoreError &&
          error.code === "PREVIEW_LOCAL_STORE_INVALID_OBJECT"
        ) {
          // A concurrent no-replace publication may briefly have two links.
          await new Promise((resolveDelay) => setTimeout(resolveDelay, 5));
          continue;
        }
        throw error;
      }
    }
    throw new LocalPreviewBuildInputStoreError(
      "PREVIEW_LOCAL_STORE_INVALID_CONFIG",
    );
  };

  try {
    await lstat(identityPath);
    return await readExisting();
  } catch (error) {
    if (errorCode(error) !== "ENOENT") throw error;
  }

  const stagePath = resolve(rootDir, `.store-identity-${randomUUID()}`);
  let stage: FileHandle | undefined;
  try {
    stage = await open(
      stagePath,
      constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | FILE_FLAGS,
      0o600,
    );
    const storeId = randomUUID();
    await stage.writeFile(JSON.stringify({ version: 1, storeId }), "utf8");
    await stage.sync();
    await stage.close();
    stage = undefined;
    try {
      await link(stagePath, identityPath);
    } catch (error) {
      if (errorCode(error) !== "EEXIST") throw error;
    } finally {
      await unlink(stagePath).catch(() => undefined);
    }
    await syncDirectory(rootDir);
    return await readExisting();
  } catch (error) {
    await stage?.close().catch(() => undefined);
    await unlink(stagePath).catch(() => undefined);
    if (error instanceof LocalPreviewBuildInputStoreError) throw error;
    throw new LocalPreviewBuildInputStoreError(
      "PREVIEW_LOCAL_STORE_UNAVAILABLE",
    );
  }
}

export type LocalPreviewBuildInputObjectStore =
  PreviewBuildInputObjectStore & {
    /**
     * Stable for this initialized directory; not an authenticated Agent
     * identity until a separate pairing flow registers its key.
     */
    storeId: string;
    putStream(input: {
      jobId: string;
      artifactRefId: string;
      objectKey: string;
      bytes: AsyncIterable<Uint8Array>;
      archiveDigest: string;
      contentLength: number;
    }): Promise<PreviewBuildArtifactWriteMetadata>;
    inspect(input: {
      objectKey: string;
      jobId: string;
      artifactRefId: string;
    }): Promise<PreviewBuildArtifactWriteMetadata>;
    read(input: {
      objectKey: string;
      jobId: string;
      artifactRefId: string;
    }): Promise<Buffer>;
    remove(input: {
      objectKey: string;
      jobId: string;
      artifactRefId: string;
      expectedDigest?: string;
    }): Promise<void>;
  };

export type LocalPreviewArtifactObjectStore =
  LocalPreviewBuildInputObjectStore;

/**
 * Local immutable CAS for job-scoped Preview artifact references.
 * The configured root must be private, explicit, and outside the live project
 * root. Mode 0700 does not protect against code running as the same UID; do not
 * use it until Candidate execution is separated from the trusted store process.
 * The stored jobId/reference are not authorization by themselves: admission,
 * current Candidate checks, and paired-Agent ownership remain server duties.
 * This is storage, not an execution sandbox.
 */
export async function createLocalPreviewArtifactObjectStore(input: {
  rootDir: string;
  workspaceRoot: string;
  maxBytes?: number;
}): Promise<LocalPreviewArtifactObjectStore> {
  if (process.platform !== "linux") {
    throw new LocalPreviewBuildInputStoreError(
      "PREVIEW_LOCAL_STORE_UNSUPPORTED_PLATFORM",
    );
  }
  const maxBytes = input.maxBytes ?? DEFAULT_MAX_INPUT_BYTES;
  if (
    !isAbsolute(input.rootDir) ||
    !isAbsolute(input.workspaceRoot) ||
    !Number.isSafeInteger(maxBytes) ||
    maxBytes < 1 ||
    maxBytes > DEFAULT_MAX_INPUT_BYTES ||
    typeof constants.O_NOFOLLOW !== "number" ||
    typeof constants.O_DIRECTORY !== "number"
  ) {
    throw new LocalPreviewBuildInputStoreError(
      "PREVIEW_LOCAL_STORE_INVALID_CONFIG",
    );
  }

  const configuredRoot = resolve(input.rootDir);
  const parent = dirname(configuredRoot);
  try {
    if ((await realpath(parent)) !== parent) {
      throw new LocalPreviewBuildInputStoreError(
        "PREVIEW_LOCAL_STORE_INVALID_CONFIG",
      );
    }
    const [workspaceRoot, existingRoot] = await Promise.all([
      realpath(input.workspaceRoot),
      lstat(configuredRoot).catch((error: unknown) => {
        if (errorCode(error) === "ENOENT") return null;
        throw error;
      }),
    ]);
    if (isWithin(workspaceRoot, configuredRoot)) {
      throw new LocalPreviewBuildInputStoreError(
        "PREVIEW_LOCAL_STORE_INVALID_CONFIG",
      );
    }
    if (existingRoot?.isSymbolicLink()) {
      throw new LocalPreviewBuildInputStoreError(
        "PREVIEW_LOCAL_STORE_INVALID_CONFIG",
      );
    }
    await ensurePrivateDirectory(configuredRoot);
    if ((await realpath(configuredRoot)) !== configuredRoot) {
      throw new LocalPreviewBuildInputStoreError(
        "PREVIEW_LOCAL_STORE_INVALID_CONFIG",
      );
    }
    for (const child of ["blobs", "refs", "staging"]) {
      await ensurePrivateDirectory(resolve(configuredRoot, child));
    }
  } catch (error) {
    if (error instanceof LocalPreviewBuildInputStoreError) throw error;
    throw new LocalPreviewBuildInputStoreError(
      "PREVIEW_LOCAL_STORE_INVALID_CONFIG",
    );
  }
  const storeId = await loadOrCreateStoreId(configuredRoot);

  const blobPath = (digest: string) =>
    resolve(
      configuredRoot,
      "blobs",
      digest.slice(0, 2),
      `${digest.slice(2)}.zip`,
    );
  const referencePath = (artifactRefId: string) => {
    if (!UUID_PATTERN.test(artifactRefId)) {
      throw new LocalPreviewBuildInputStoreError(
        "PREVIEW_LOCAL_STORE_INVALID_OBJECT",
      );
    }
    return resolve(configuredRoot, "refs", `${artifactRefId}.json`);
  };

  async function publishImmutable(
    stagedPath: string,
    destination: string,
    expected: Buffer | { size: number; stagedPath: string },
  ): Promise<void> {
    await ensurePrivateDirectory(dirname(destination));
    try {
      await link(stagedPath, destination);
      await unlink(stagedPath);
      await syncDirectory(dirname(destination));
      return;
    } catch (error) {
      if (errorCode(error) !== "EEXIST") {
        throw new LocalPreviewBuildInputStoreError(
          "PREVIEW_LOCAL_STORE_UNAVAILABLE",
        );
      }
    }
    const matches = Buffer.isBuffer(expected)
      ? (await waitForSingleLink(destination)) &&
        (await readRegularFile(destination, expected.length)).equals(expected)
      : await filesHaveExactBytes(
          destination,
          expected.stagedPath,
          expected.size,
        );
    if (!matches) {
      throw new LocalPreviewBuildInputStoreError(
        "PREVIEW_LOCAL_STORE_CONFLICT",
      );
    }
  }

  async function validateManifest(
    manifestBytes: Buffer,
    objectKey: string,
    expectedStoreId: string,
    expectedArchiveDigest?: string,
    expectedReference?: { jobId: string; artifactRefId: string },
  ): Promise<PreviewBuildArtifactWriteMetadata> {
    const identity = parseObjectKey(objectKey);
    let manifest: unknown;
    try {
      manifest = JSON.parse(manifestBytes.toString("utf8"));
    } catch {
      throw new LocalPreviewBuildInputStoreError(
        "PREVIEW_LOCAL_STORE_INVALID_OBJECT",
      );
    }
    if (!manifest || typeof manifest !== "object" || Array.isArray(manifest)) {
      throw new LocalPreviewBuildInputStoreError(
        "PREVIEW_LOCAL_STORE_INVALID_OBJECT",
      );
    }
    const record = manifest as Record<string, unknown>;
    const jobId = record.jobId;
    const artifactRefId = record.artifactRefId;
    const archiveDigest = record.archiveDigest;
    const contentLength = record.contentLength;
    const expectedArtifactRefId =
      typeof jobId === "string" && UUID_PATTERN.test(jobId)
        ? previewBuildArtifactRefId(jobId, identity.artifactRole)
        : "";
    const canonical = JSON.stringify({
      version: 3,
      objectKey,
      storeId: expectedStoreId,
      jobId,
      artifactRefId,
      archiveDigest,
      contentLength,
      retentionPolicy: identity.retentionPolicy,
    });
    if (
      Object.keys(record).length !== 8 ||
      record.version !== 3 ||
      record.objectKey !== objectKey ||
      record.storeId !== expectedStoreId ||
      record.jobId !== jobId ||
      record.artifactRefId !== expectedArtifactRefId ||
      (expectedReference !== undefined &&
        (jobId !== expectedReference.jobId ||
          artifactRefId !== expectedReference.artifactRefId)) ||
      record.retentionPolicy !== identity.retentionPolicy ||
      typeof archiveDigest !== "string" ||
      !DIGEST_PATTERN.test(archiveDigest) ||
      (identity.archiveDigest !== undefined &&
        identity.archiveDigest !== archiveDigest) ||
      (expectedArchiveDigest !== undefined &&
        expectedArchiveDigest !== archiveDigest) ||
      typeof contentLength !== "number" ||
      !Number.isSafeInteger(contentLength) ||
      contentLength < 1 ||
      contentLength > Math.min(maxBytes, identity.maxBytes) ||
      manifestBytes.toString("utf8") !== canonical
    ) {
      throw new LocalPreviewBuildInputStoreError(
        "PREVIEW_LOCAL_STORE_INVALID_OBJECT",
      );
    }
    return {
      storeId: expectedStoreId,
      jobId: jobId as string,
      artifactRefId: artifactRefId as string,
      digest: archiveDigest,
      sizeBytes: contentLength,
      manifestDigest: createHash("sha256")
        .update(manifestBytes)
        .digest("hex"),
      retentionPolicy: identity.retentionPolicy,
    };
  }

  async function referenceExistsForDigest(digest: string): Promise<boolean> {
    const refsRoot = resolve(configuredRoot, "refs");
    const refsStat = await lstat(refsRoot);
    if (
      !refsStat.isDirectory() ||
      refsStat.isSymbolicLink() ||
      (typeof process.getuid === "function" &&
        refsStat.uid !== process.getuid()) ||
      (refsStat.mode & 0o077) !== 0
    ) {
      throw new LocalPreviewBuildInputStoreError(
        "PREVIEW_LOCAL_STORE_INVALID_OBJECT",
      );
    }
    const files = await readdir(refsRoot, { withFileTypes: true });
    for (const entry of files) {
      const match =
        /^([0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12})\.json$/i.exec(
          entry.name,
        );
      if (!entry.isFile() || entry.isSymbolicLink() || !match) {
        throw new LocalPreviewBuildInputStoreError(
          "PREVIEW_LOCAL_STORE_INVALID_OBJECT",
        );
      }
      const manifestBytes = await readRegularFile(
        resolve(refsRoot, entry.name),
        MAX_MANIFEST_BYTES,
      );
      let manifest: unknown;
      try {
        manifest = JSON.parse(manifestBytes.toString("utf8"));
      } catch {
        throw new LocalPreviewBuildInputStoreError(
          "PREVIEW_LOCAL_STORE_INVALID_OBJECT",
        );
      }
      const objectKey =
        manifest &&
        typeof manifest === "object" &&
        !Array.isArray(manifest) &&
        typeof (manifest as Record<string, unknown>).objectKey === "string"
          ? ((manifest as Record<string, unknown>).objectKey as string)
          : "";
      const artifact = await validateManifest(
        manifestBytes,
        objectKey,
        storeId,
      );
      if (artifact.artifactRefId !== match[1]) {
        throw new LocalPreviewBuildInputStoreError(
          "PREVIEW_LOCAL_STORE_INVALID_OBJECT",
        );
      }
      if (artifact.digest === digest) return true;
    }
    return false;
  }

  const store: Pick<
    LocalPreviewBuildInputObjectStore,
    "putStream" | "inspect" | "read" | "remove"
  > = {
    async putStream({
      jobId,
      artifactRefId,
      objectKey,
      bytes,
      archiveDigest,
      contentLength,
    }): Promise<PreviewBuildArtifactWriteMetadata> {
      const identity = parseObjectKey(objectKey);
      if (
        typeof jobId !== "string" ||
        !UUID_PATTERN.test(jobId) ||
        artifactRefId !==
          previewBuildArtifactRefId(jobId, identity.artifactRole) ||
        typeof archiveDigest !== "string" ||
        !DIGEST_PATTERN.test(archiveDigest) ||
        !Number.isSafeInteger(contentLength) ||
        contentLength < 1
      ) {
        throw new LocalPreviewBuildInputStoreError(
          "PREVIEW_LOCAL_STORE_INVALID_OBJECT",
        );
      }
      const digest = archiveDigest;
      if (
        identity.archiveDigest !== undefined &&
        digest !== identity.archiveDigest
      ) {
        throw new LocalPreviewBuildInputStoreError(
          "PREVIEW_LOCAL_STORE_INVALID_OBJECT",
        );
      }
      const objectMaxBytes = Math.min(maxBytes, identity.maxBytes);
      if (contentLength > objectMaxBytes) {
        throw new LocalPreviewBuildInputStoreError(
          "PREVIEW_LOCAL_STORE_TOO_LARGE",
        );
      }
      const stagedPath = resolve(
        configuredRoot,
        "staging",
        `upload-${randomUUID()}.part`,
      );
      let handle;
      let referenceTemp: string | undefined;
      try {
        handle = await open(
          stagedPath,
          constants.O_WRONLY |
            constants.O_CREAT |
            constants.O_EXCL |
            constants.O_NOFOLLOW,
          0o600,
        );
        const hash = createHash("sha256");
        let totalBytes = 0;
        for await (const chunk of bytes) {
          if (!(chunk instanceof Uint8Array) || chunk.byteLength < 1) {
            throw new LocalPreviewBuildInputStoreError(
              "PREVIEW_LOCAL_STORE_INVALID_OBJECT",
            );
          }
          totalBytes += chunk.byteLength;
          if (totalBytes > objectMaxBytes) {
            throw new LocalPreviewBuildInputStoreError(
              "PREVIEW_LOCAL_STORE_TOO_LARGE",
            );
          }
          if (totalBytes > contentLength) {
            throw new LocalPreviewBuildInputStoreError(
              "PREVIEW_LOCAL_STORE_INVALID_OBJECT",
            );
          }
          hash.update(chunk);
          let offset = 0;
          while (offset < chunk.byteLength) {
            const result = await handle.write(
              chunk,
              offset,
              chunk.byteLength - offset,
              null,
            );
            if (result.bytesWritten < 1) {
              throw new LocalPreviewBuildInputStoreError(
                "PREVIEW_LOCAL_STORE_UNAVAILABLE",
              );
            }
            offset += result.bytesWritten;
          }
        }
        if (totalBytes !== contentLength) {
          throw new LocalPreviewBuildInputStoreError(
            "PREVIEW_LOCAL_STORE_INVALID_OBJECT",
          );
        }
        if (hash.digest("hex") !== digest) {
          throw new LocalPreviewBuildInputStoreError(
            "PREVIEW_LOCAL_STORE_DIGEST_MISMATCH",
          );
        }
        await handle.sync();
        await handle.close();
        handle = undefined;

        await publishImmutable(stagedPath, blobPath(digest), {
          size: contentLength,
          stagedPath,
        });

        const manifest = Buffer.from(
          JSON.stringify({
            version: 3,
            objectKey,
            storeId,
            jobId,
            artifactRefId,
            archiveDigest: digest,
            contentLength,
            retentionPolicy: identity.retentionPolicy,
          }),
          "utf8",
        );
        referenceTemp = resolve(
          configuredRoot,
          "staging",
          `reference-${randomUUID()}.part`,
        );
        const refHandle = await open(
          referenceTemp,
          constants.O_WRONLY |
            constants.O_CREAT |
            constants.O_EXCL |
            constants.O_NOFOLLOW,
          0o600,
        );
        try {
          await refHandle.writeFile(manifest);
          await refHandle.sync();
        } finally {
          await refHandle.close();
        }
        await publishImmutable(
          referenceTemp,
          referencePath(artifactRefId),
          manifest,
        );
        referenceTemp = undefined;
        return {
          storeId,
          jobId,
          artifactRefId,
          digest,
          sizeBytes: contentLength,
          manifestDigest: createHash("sha256")
            .update(manifest)
            .digest("hex"),
          retentionPolicy: identity.retentionPolicy,
        };
      } catch (error) {
        if (error instanceof LocalPreviewBuildInputStoreError) throw error;
        throw new LocalPreviewBuildInputStoreError(
          "PREVIEW_LOCAL_STORE_UNAVAILABLE",
        );
      } finally {
        await handle?.close().catch(() => undefined);
        await unlink(stagedPath).catch(() => undefined);
        if (referenceTemp) await unlink(referenceTemp).catch(() => undefined);
      }
    },

    async read({ objectKey, jobId, artifactRefId }) {
      const identity = parseObjectKey(objectKey);
      if (
        !UUID_PATTERN.test(jobId) ||
        artifactRefId !== previewBuildArtifactRefId(jobId, identity.artifactRole)
      ) {
        throw new LocalPreviewBuildInputStoreError(
          "PREVIEW_LOCAL_STORE_INVALID_OBJECT",
        );
      }
      const manifestBytes = await readRegularFile(
        referencePath(artifactRefId),
        MAX_MANIFEST_BYTES,
      );
      const artifact = await validateManifest(
        manifestBytes,
        objectKey,
        storeId,
        identity.archiveDigest,
        { jobId, artifactRefId },
      );
      const content = await readRegularFile(
        blobPath(artifact.digest),
        Math.min(maxBytes, identity.maxBytes),
      );
      if (
        content.length !== artifact.sizeBytes ||
        createHash("sha256").update(content).digest("hex") !==
          artifact.digest
      ) {
        throw new LocalPreviewBuildInputStoreError(
          "PREVIEW_LOCAL_STORE_DIGEST_MISMATCH",
        );
      }
      return content;
    },

    async inspect({ objectKey, jobId, artifactRefId }) {
      const identity = parseObjectKey(objectKey);
      if (
        !UUID_PATTERN.test(jobId) ||
        artifactRefId !== previewBuildArtifactRefId(jobId, identity.artifactRole)
      ) {
        throw new LocalPreviewBuildInputStoreError(
          "PREVIEW_LOCAL_STORE_INVALID_OBJECT",
        );
      }
      const manifestBytes = await readRegularFile(
        referencePath(artifactRefId),
        MAX_MANIFEST_BYTES,
      );
      const artifact = await validateManifest(
        manifestBytes,
        objectKey,
        storeId,
        identity.archiveDigest,
        { jobId, artifactRefId },
      );
      const content = await readRegularFile(
        blobPath(artifact.digest),
        Math.min(maxBytes, identity.maxBytes),
      );
      if (
        content.length !== artifact.sizeBytes ||
        createHash("sha256").update(content).digest("hex") !== artifact.digest
      ) {
        throw new LocalPreviewBuildInputStoreError(
          "PREVIEW_LOCAL_STORE_DIGEST_MISMATCH",
        );
      }
      return artifact;
    },

    async remove({ objectKey, jobId, artifactRefId, expectedDigest }) {
      const identity = parseObjectKey(objectKey);
      if (
        !UUID_PATTERN.test(jobId) ||
        artifactRefId !== previewBuildArtifactRefId(jobId, identity.artifactRole) ||
        expectedDigest !== undefined &&
        !DIGEST_PATTERN.test(expectedDigest)
      ) {
        throw new LocalPreviewBuildInputStoreError(
          "PREVIEW_LOCAL_STORE_INVALID_OBJECT",
        );
      }
      if (
        identity.archiveDigest !== undefined &&
        expectedDigest !== undefined &&
        identity.archiveDigest !== expectedDigest
      ) {
        throw new LocalPreviewBuildInputStoreError(
          "PREVIEW_LOCAL_STORE_INVALID_OBJECT",
        );
      }
      let archiveDigest = identity.archiveDigest ?? expectedDigest;
      const reference = referencePath(artifactRefId);
      let referenceStat;
      try {
        referenceStat = await lstat(reference);
      } catch (error) {
        if (errorCode(error) !== "ENOENT") {
          throw new LocalPreviewBuildInputStoreError(
            "PREVIEW_LOCAL_STORE_UNAVAILABLE",
          );
        }
      }
      if (referenceStat) {
        if (!referenceStat.isFile() || referenceStat.isSymbolicLink()) {
          throw new LocalPreviewBuildInputStoreError(
            "PREVIEW_LOCAL_STORE_INVALID_OBJECT",
          );
        }
        const manifestBytes = await readRegularFile(
          reference,
          MAX_MANIFEST_BYTES,
        );
        const artifact = await validateManifest(
          manifestBytes,
          objectKey,
          storeId,
          expectedDigest ?? identity.archiveDigest,
          { jobId, artifactRefId },
        );
        archiveDigest = artifact.digest;
        try {
          await unlink(reference);
        } catch (error) {
          if (errorCode(error) !== "ENOENT") {
            throw new LocalPreviewBuildInputStoreError(
              "PREVIEW_LOCAL_STORE_UNAVAILABLE",
            );
          }
        }
        await syncDirectory(dirname(reference));
      }

      if (!archiveDigest || (await referenceExistsForDigest(archiveDigest))) {
        return;
      }

      const artifactPath = blobPath(archiveDigest);
      let artifactStat;
      try {
        artifactStat = await lstat(artifactPath);
      } catch (error) {
        if (errorCode(error) !== "ENOENT") {
          throw new LocalPreviewBuildInputStoreError(
            "PREVIEW_LOCAL_STORE_UNAVAILABLE",
          );
        }
      }
      if (!artifactStat) return;
      if (!artifactStat.isFile() || artifactStat.isSymbolicLink()) {
        throw new LocalPreviewBuildInputStoreError(
          "PREVIEW_LOCAL_STORE_INVALID_OBJECT",
        );
      }
      const artifactBytes = await readRegularFile(
        artifactPath,
        Math.min(maxBytes, identity.maxBytes),
      );
      if (
        createHash("sha256").update(artifactBytes).digest("hex") !==
        archiveDigest
      ) {
        throw new LocalPreviewBuildInputStoreError(
          "PREVIEW_LOCAL_STORE_DIGEST_MISMATCH",
        );
      }
      try {
        await unlink(artifactPath);
      } catch (error) {
        if (errorCode(error) !== "ENOENT") {
          throw new LocalPreviewBuildInputStoreError(
            "PREVIEW_LOCAL_STORE_UNAVAILABLE",
          );
        }
      }
      await syncDirectory(dirname(artifactPath));
    },
  };

  return {
    ...store,
    storeId,
    async put({
      objectKey,
      jobId,
      artifactRefId,
      archive,
      archiveDigest,
      contentLength,
    }) {
      if (!Buffer.isBuffer(archive)) {
        throw new LocalPreviewBuildInputStoreError(
          "PREVIEW_LOCAL_STORE_INVALID_OBJECT",
        );
      }
      await store.putStream({
        jobId,
        artifactRefId,
        objectKey,
        bytes: (async function* () {
          yield archive;
        })(),
        archiveDigest,
        contentLength,
      });
    },
  };
}

export async function createLocalPreviewBuildInputObjectStore(input: {
  rootDir: string;
  workspaceRoot: string;
  maxBytes?: number;
}): Promise<LocalPreviewBuildInputObjectStore> {
  return createLocalPreviewArtifactObjectStore(input);
}
