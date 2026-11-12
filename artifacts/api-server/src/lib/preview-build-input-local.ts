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
} from "node:fs/promises";
import { dirname, isAbsolute, relative, resolve, sep } from "node:path";
import type { PreviewBuildInputObjectStore } from "./preview-build-upload.js";

const OBJECT_KEY_PATTERN =
  /^build-inputs\/([a-f0-9]{64})\/([a-f0-9]{64})\.zip$/;
const DIGEST_PATTERN = /^[a-f0-9]{64}$/;
const DEFAULT_MAX_BYTES = 55 * 1024 * 1024;
const MAX_MANIFEST_BYTES = 2_048;
const CHUNK_BYTES = 64 * 1024;
const FILE_FLAGS = constants.O_NOFOLLOW;

export class LocalPreviewBuildInputStoreError extends Error {
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
    super("Local Preview artifact is invalid or unavailable.");
    this.name = "LocalPreviewBuildInputStoreError";
  }
}

type ObjectIdentity = {
  bindingDigest: string;
  archiveDigest: string;
};

function parseObjectKey(value: string): ObjectIdentity {
  const match =
    typeof value === "string" && value.length <= 160
      ? OBJECT_KEY_PATTERN.exec(value)
      : null;
  if (!match) {
    throw new LocalPreviewBuildInputStoreError(
      "PREVIEW_LOCAL_STORE_INVALID_OBJECT",
    );
  }
  return {
    bindingDigest: match[1]!,
    archiveDigest: match[2]!,
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

export type LocalPreviewBuildInputObjectStore =
  PreviewBuildInputObjectStore & {
    putStream(input: {
      objectKey: string;
      bytes: AsyncIterable<Uint8Array>;
      archiveDigest: string;
      contentLength: number;
    }): Promise<void>;
    read(objectKey: string): Promise<Buffer>;
    remove(objectKey: string): Promise<void>;
  };

/**
 * Local immutable CAS for the existing signed build-input object-key contract.
 * The configured root must be private, explicit, and outside the live project
 * root. Mode 0700 does not protect against code running as the same UID; do not
 * use it until Candidate execution is separated from the trusted store process.
 * This is storage, not an execution sandbox.
 */
export async function createLocalPreviewBuildInputObjectStore(input: {
  rootDir: string;
  workspaceRoot: string;
  maxBytes?: number;
}): Promise<LocalPreviewBuildInputObjectStore> {
  if (process.platform !== "linux") {
    throw new LocalPreviewBuildInputStoreError(
      "PREVIEW_LOCAL_STORE_UNSUPPORTED_PLATFORM",
    );
  }
  const maxBytes = input.maxBytes ?? DEFAULT_MAX_BYTES;
  if (
    !isAbsolute(input.rootDir) ||
    !isAbsolute(input.workspaceRoot) ||
    !Number.isSafeInteger(maxBytes) ||
    maxBytes < 1 ||
    maxBytes > DEFAULT_MAX_BYTES ||
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

  const blobPath = (digest: string) =>
    resolve(
      configuredRoot,
      "blobs",
      digest.slice(0, 2),
      `${digest.slice(2)}.zip`,
    );
  const referencePath = (bindingDigest: string, digest: string) =>
    resolve(
      configuredRoot,
      "refs",
      bindingDigest,
      `${digest}.json`,
    );

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
    archiveDigest: string,
  ): Promise<number> {
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
    const contentLength = record.contentLength;
    const canonical =
      typeof contentLength === "number"
        ? JSON.stringify({
            version: 1,
            objectKey,
            archiveDigest,
            contentLength,
          })
        : "";
    if (
      Object.keys(record).length !== 4 ||
      record.version !== 1 ||
      record.objectKey !== objectKey ||
      record.archiveDigest !== archiveDigest ||
      typeof contentLength !== "number" ||
      !Number.isSafeInteger(contentLength) ||
      contentLength < 1 ||
      contentLength > maxBytes ||
      manifestBytes.toString("utf8") !== canonical
    ) {
      throw new LocalPreviewBuildInputStoreError(
        "PREVIEW_LOCAL_STORE_INVALID_OBJECT",
      );
    }
    return contentLength;
  }

  async function referenceExistsForDigest(digest: string): Promise<boolean> {
    const refsRoot = resolve(configuredRoot, "refs");
    const bindingDirectories = await readdir(refsRoot, {
      withFileTypes: true,
    }).catch(() => {
      throw new LocalPreviewBuildInputStoreError(
        "PREVIEW_LOCAL_STORE_UNAVAILABLE",
      );
    });
    for (const bindingEntry of bindingDirectories) {
      if (
        !bindingEntry.isDirectory() ||
        bindingEntry.isSymbolicLink() ||
        !DIGEST_PATTERN.test(bindingEntry.name)
      ) {
        throw new LocalPreviewBuildInputStoreError(
          "PREVIEW_LOCAL_STORE_INVALID_OBJECT",
        );
      }
      const bindingDir = resolve(refsRoot, bindingEntry.name);
      const bindingStat = await lstat(bindingDir);
      if (
        !bindingStat.isDirectory() ||
        bindingStat.isSymbolicLink() ||
        (typeof process.getuid === "function" &&
          bindingStat.uid !== process.getuid()) ||
        (bindingStat.mode & 0o077) !== 0
      ) {
        throw new LocalPreviewBuildInputStoreError(
          "PREVIEW_LOCAL_STORE_INVALID_OBJECT",
        );
      }
      const files = await readdir(bindingDir, { withFileTypes: true });
      for (const entry of files) {
        const match = /^([a-f0-9]{64})\.json$/.exec(entry.name);
        if (
          !entry.isFile() ||
          entry.isSymbolicLink() ||
          !match
        ) {
          throw new LocalPreviewBuildInputStoreError(
            "PREVIEW_LOCAL_STORE_INVALID_OBJECT",
          );
        }
        if (match[1] !== digest) continue;
        const key = `build-inputs/${bindingEntry.name}/${digest}.zip`;
        const identity = parseObjectKey(key);
        const manifestBytes = await readRegularFile(
          resolve(bindingDir, entry.name),
          MAX_MANIFEST_BYTES,
        );
        await validateManifest(
          manifestBytes,
          key,
          identity.archiveDigest,
        );
        return true;
      }
    }
    return false;
  }

  const store: Pick<
    LocalPreviewBuildInputObjectStore,
    "putStream" | "read" | "remove"
  > = {
    async putStream({ objectKey, bytes, archiveDigest, contentLength }) {
      const identity = parseObjectKey(objectKey);
      if (
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
      if (digest !== identity.archiveDigest) {
        throw new LocalPreviewBuildInputStoreError(
          "PREVIEW_LOCAL_STORE_INVALID_OBJECT",
        );
      }
      if (contentLength > maxBytes) {
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
          if (totalBytes > maxBytes || totalBytes > contentLength) {
            throw new LocalPreviewBuildInputStoreError(
              "PREVIEW_LOCAL_STORE_TOO_LARGE",
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
            version: 1,
            objectKey,
            archiveDigest: digest,
            contentLength,
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
          referencePath(identity.bindingDigest, digest),
          manifest,
        );
        referenceTemp = undefined;
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

    async read(objectKey) {
      const identity = parseObjectKey(objectKey);
      const manifestBytes = await readRegularFile(
        referencePath(identity.bindingDigest, identity.archiveDigest),
        MAX_MANIFEST_BYTES,
      );
      const contentLength = await validateManifest(
        manifestBytes,
        objectKey,
        identity.archiveDigest,
      );
      const content = await readRegularFile(
        blobPath(identity.archiveDigest),
        maxBytes,
      );
      if (
        content.length !== contentLength ||
        createHash("sha256").update(content).digest("hex") !==
          identity.archiveDigest
      ) {
        throw new LocalPreviewBuildInputStoreError(
          "PREVIEW_LOCAL_STORE_DIGEST_MISMATCH",
        );
      }
      return content;
    },

    async remove(objectKey) {
      const identity = parseObjectKey(objectKey);
      const reference = referencePath(
        identity.bindingDigest,
        identity.archiveDigest,
      );
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
        await validateManifest(
          manifestBytes,
          objectKey,
          identity.archiveDigest,
        );
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

      if (await referenceExistsForDigest(identity.archiveDigest)) return;

      const artifactPath = blobPath(identity.archiveDigest);
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
      const artifactBytes = await readRegularFile(artifactPath, maxBytes);
      if (
        createHash("sha256").update(artifactBytes).digest("hex") !==
        identity.archiveDigest
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
    async put({ objectKey, archive, archiveDigest, contentLength }) {
      if (!Buffer.isBuffer(archive)) {
        throw new LocalPreviewBuildInputStoreError(
          "PREVIEW_LOCAL_STORE_INVALID_OBJECT",
        );
      }
      await store.putStream({
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
