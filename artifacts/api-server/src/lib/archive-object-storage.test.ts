import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { tmpdir } from "node:os";
import {
  createArchiveObjectKey,
  downloadArchiveObject,
  putArchiveObject,
  setArchiveObjectStorageForTests,
} from "./archive-object-storage.js";

const uploadId = "11111111-1111-4111-8111-111111111111";
const ownerId = "owner-a";
const files = new Map<string, Buffer>();
const storage = {
  put: vi.fn(async (objectKey: string, sourcePath: string) => {
    files.set(objectKey, await readFile(sourcePath));
  }),
  download: vi.fn(async (objectKey: string, destinationPath: string) => {
    const data = files.get(objectKey);
    if (!data) throw new Error("missing object");
    await mkdir(dirname(destinationPath), { recursive: true });
    await writeFile(destinationPath, data, { flag: "wx", mode: 0o600 });
  }),
  delete: vi.fn(async (objectKey: string) => {
    files.delete(objectKey);
  }),
};

let restoreStorage: (() => void) | undefined;
let testRoot = "";

beforeEach(async () => {
  restoreStorage = setArchiveObjectStorageForTests(storage);
  testRoot = await mkdtemp(join(tmpdir(), "archive-object-storage-test-"));
});

afterEach(async () => {
  files.clear();
  vi.clearAllMocks();
  await rm(testRoot, { recursive: true, force: true });
  restoreStorage?.();
  restoreStorage = undefined;
  vi.unstubAllEnvs();
});

describe("shared private archive storage", () => {
  it("lets a second API instance download the first instance's archive", async () => {
    vi.stubEnv("PRIVATE_OBJECT_DIR", "/shared-test-bucket/private");
    const source = join(testRoot, "source.zip");
    const destination = join(testRoot, "replica-b", "archive.zip");
    const data = Buffer.from("validated archive bytes");
    await writeFile(source, data);
    const key = createArchiveObjectKey(ownerId, uploadId, "zip");

    // API replica A persists the archive; replica B resolves the same private key.
    await putArchiveObject(key, source, ownerId, uploadId, "zip");
    await downloadArchiveObject(key, destination);

    await expect(readFile(destination)).resolves.toEqual(data);
    expect(key).toContain("/engineeringos/archive-uploads/");
  });

  it("uses different private object references for different owners", () => {
    vi.stubEnv("PRIVATE_OBJECT_DIR", "/shared-test-bucket/private");
    const ownerKey = createArchiveObjectKey(ownerId, uploadId, "zip");
    const otherOwnerKey = createArchiveObjectKey("owner-b", uploadId, "zip");
    expect(ownerKey).not.toBe(otherOwnerKey);
  });

  it("removes a partially written object when storage upload fails", async () => {
    vi.stubEnv("PRIVATE_OBJECT_DIR", "/shared-test-bucket/private");
    const source = join(testRoot, "partial.zip");
    await writeFile(source, "partial bytes");
    storage.put.mockImplementationOnce(async (objectKey) => {
      files.set(objectKey, Buffer.from("partial"));
      throw new Error("simulated interrupted write");
    });
    const key = createArchiveObjectKey(ownerId, uploadId, "zip");

    await expect(
      putArchiveObject(key, source, ownerId, uploadId, "zip"),
    ).rejects.toThrow("simulated interrupted write");
    expect(storage.delete).toHaveBeenCalledWith(key);
    expect(files.has(key)).toBe(false);
  });

  it("rejects object references that do not match their owner and upload", async () => {
    vi.stubEnv("PRIVATE_OBJECT_DIR", "/shared-test-bucket/private");
    const source = join(testRoot, "foreign.zip");
    await writeFile(source, "bytes");
    const foreignKey = createArchiveObjectKey("owner-b", uploadId, "zip");

    await expect(
      putArchiveObject(foreignKey, source, ownerId, uploadId, "zip"),
    ).rejects.toThrow(/does not match its owner/i);
    expect(storage.put).not.toHaveBeenCalled();
  });
});
