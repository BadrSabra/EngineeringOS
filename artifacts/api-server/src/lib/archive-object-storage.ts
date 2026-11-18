import { createHash } from "node:crypto";
import { createReadStream, createWriteStream } from "node:fs";
import { mkdir, rm } from "node:fs/promises";
import { dirname } from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";

export type ArchiveFormat = "zip" | "tar.gz";

export interface ArchiveObjectStorage {
  put(objectKey: string, sourcePath: string): Promise<void>;
  download(objectKey: string, destinationPath: string): Promise<void>;
  delete(objectKey: string): Promise<void>;
}

const SIDECAR_ENDPOINT = "http://127.0.0.1:1106";
const STORAGE_REQUEST_TIMEOUT_MS = 5 * 60_000;
const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

let storageOverride: ArchiveObjectStorage | undefined;

function privateObjectLocation(): { bucketName: string; prefix: string } {
  const configuredPath = process.env.PRIVATE_OBJECT_DIR?.trim();
  if (!configuredPath) {
    throw new Error("Private object storage is not configured.");
  }

  const parts = configuredPath.replace(/^\/+|\/+$/g, "").split("/");
  const bucketName = parts.shift();
  if (!bucketName || parts.some((part) => !part || part === "." || part === "..")) {
    throw new Error("Private object storage path is invalid.");
  }

  return { bucketName, prefix: parts.join("/") };
}

function assertPrivateObjectKey(objectKey: string): {
  bucketName: string;
  objectName: string;
} {
  const { bucketName, prefix } = privateObjectLocation();
  const base = [
    prefix,
    "engineeringos",
    "archive-uploads",
  ].filter(Boolean).join("/");
  if (
    !objectKey.startsWith(`${base}/`) ||
    objectKey.split("/").some((segment) => !segment || segment === "." || segment === "..")
  ) {
    throw new Error("Archive object reference is outside private upload storage.");
  }
  return { bucketName, objectName: objectKey };
}

async function signedObjectUrl(
  objectKey: string,
  method: "GET" | "PUT" | "DELETE",
): Promise<string> {
  const { bucketName, objectName } = assertPrivateObjectKey(objectKey);
  const response = await fetch(
    `${SIDECAR_ENDPOINT}/object-storage/signed-object-url`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        bucket_name: bucketName,
        object_name: objectName,
        method,
        expires_at: new Date(Date.now() + 15 * 60_000).toISOString(),
      }),
      signal: AbortSignal.timeout(30_000),
    },
  );
  if (!response.ok) {
    throw new Error("Private archive storage could not authorize the operation.");
  }
  const result = await response.json() as { signed_url?: unknown };
  if (typeof result.signed_url !== "string" || !result.signed_url.startsWith("https://")) {
    throw new Error("Private archive storage returned an invalid object URL.");
  }
  return result.signed_url;
}

const googleArchiveStorage: ArchiveObjectStorage = {
  async put(objectKey, sourcePath) {
    const url = await signedObjectUrl(objectKey, "PUT");
    const body = Readable.toWeb(createReadStream(sourcePath));
    const response = await fetch(url, {
      method: "PUT",
      headers: { "Content-Type": "application/octet-stream" },
      body,
      duplex: "half",
      signal: AbortSignal.timeout(STORAGE_REQUEST_TIMEOUT_MS),
    });
    if (!response.ok) {
      throw new Error("Private archive storage write failed.");
    }
  },

  async download(objectKey, destinationPath) {
    await mkdir(dirname(destinationPath), { recursive: true, mode: 0o700 });
    try {
      const url = await signedObjectUrl(objectKey, "GET");
      const response = await fetch(url, {
        method: "GET",
        signal: AbortSignal.timeout(STORAGE_REQUEST_TIMEOUT_MS),
      });
      if (!response.ok || !response.body) {
        throw new Error("Private archive storage download failed.");
      }
      await pipeline(
        Readable.fromWeb(response.body),
        createWriteStream(destinationPath, { flags: "wx", mode: 0o600 }),
      );
    } catch (error) {
      await rm(destinationPath, { force: true }).catch(() => undefined);
      throw error;
    }
  },

  async delete(objectKey) {
    const url = await signedObjectUrl(objectKey, "DELETE");
    const response = await fetch(url, {
      method: "DELETE",
      signal: AbortSignal.timeout(STORAGE_REQUEST_TIMEOUT_MS),
    });
    if (!response.ok && response.status !== 404) {
      throw new Error("Private archive storage delete failed.");
    }
  },
};

export function createArchiveObjectKey(
  ownerId: string,
  uploadId: string,
  format: ArchiveFormat,
): string {
  if (!UUID_PATTERN.test(uploadId)) {
    throw new Error("Invalid archive upload identifier.");
  }
  const { prefix } = privateObjectLocation();
  const ownerDigest = createHash("sha256").update(ownerId).digest("hex");
  const base = [prefix, "engineeringos", "archive-uploads"].filter(Boolean).join("/");
  const extension = format === "zip" ? "zip" : "tar.gz";
  return `${base}/${ownerDigest}/${uploadId}/archive.${extension}`;
}

export async function putArchiveObject(
  objectKey: string,
  sourcePath: string,
  ownerId: string,
  uploadId: string,
  format: ArchiveFormat,
): Promise<void> {
  if (objectKey !== createArchiveObjectKey(ownerId, uploadId, format)) {
    throw new Error("Archive object reference does not match its owner.");
  }
  const storage = storageOverride ?? googleArchiveStorage;
  try {
    await storage.put(objectKey, sourcePath);
  } catch (error) {
    await storage.delete(objectKey).catch(() => undefined);
    throw error;
  }
}

export async function downloadArchiveObject(
  objectKey: string,
  destinationPath: string,
): Promise<void> {
  await (storageOverride ?? googleArchiveStorage).download(objectKey, destinationPath);
}

export async function deleteArchiveObject(
  objectKey: string,
  ownerId: string,
  uploadId: string,
  format: ArchiveFormat,
): Promise<void> {
  if (objectKey !== createArchiveObjectKey(ownerId, uploadId, format)) {
    throw new Error("Archive object reference does not match its owner.");
  }
  await (storageOverride ?? googleArchiveStorage).delete(objectKey);
}

/** Test seam for exercising independent API instances against one shared bucket. */
export function setArchiveObjectStorageForTests(
  storage: ArchiveObjectStorage | undefined,
): () => void {
  const previous = storageOverride;
  storageOverride = storage;
  return () => {
    storageOverride = previous;
  };
}
