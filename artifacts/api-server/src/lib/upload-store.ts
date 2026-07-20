/**
 * Epic D — Ephemeral upload store for ARCHIVE_UPLOAD discovery.
 *
 * Uploaded archives are extracted to a temporary directory.  The store maps
 * an uploadId (a UUID returned to the client) to the extraction directory.
 * Entries expire after TTL_MS (default 1 hour) to prevent temp-dir leakage
 * on long-running servers.
 *
 * This is intentionally in-process:
 *   - Uploads are one-shot (start discovery immediately after upload).
 *   - Multi-instance deployments would need shared object storage, but that's
 *     a future concern; for the current single-instance Replit deployment this
 *     is correct and avoids an unnecessary Redis/S3 dependency.
 */
import { rm } from "node:fs/promises";
import { logger } from "./logger.js";

const TTL_MS = 60 * 60_000; // 1 hour

interface UploadEntry {
  /** Extracted directory path — this is what the ARCHIVE_UPLOAD adapter uses as rootPath. */
  extractedDir: string;
  /** Original filename (for logging). */
  originalName: string;
  createdAt: number;
}

const store = new Map<string, UploadEntry>();

/** Register a new upload entry.  Returns the uploadId. */
export function registerUpload(uploadId: string, extractedDir: string, originalName: string): void {
  store.set(uploadId, { extractedDir, originalName, createdAt: Date.now() });
  logger.info({ uploadId, originalName, extractedDir }, "upload-store: registered");
}

/**
 * Look up an upload by ID.
 * Returns `undefined` when the ID is unknown or has expired.
 */
export function lookupUpload(uploadId: string): UploadEntry | undefined {
  const entry = store.get(uploadId);
  if (!entry) return undefined;
  if (Date.now() - entry.createdAt > TTL_MS) {
    // Expired — remove and clean up.
    store.delete(uploadId);
    void rm(entry.extractedDir, { recursive: true, force: true }).catch(() => {});
    return undefined;
  }
  return entry;
}

/**
 * Remove an upload entry and delete its extracted directory.
 * Called by the ARCHIVE_UPLOAD adapter's cleanup hook after discovery finishes.
 */
export async function removeUpload(uploadId: string): Promise<void> {
  const entry = store.get(uploadId);
  store.delete(uploadId);
  if (entry) {
    await rm(entry.extractedDir, { recursive: true, force: true }).catch(() => {});
    logger.info({ uploadId }, "upload-store: removed");
  }
}

// ── Periodic sweep ────────────────────────────────────────────────────────────
// Clean up expired entries every 10 minutes.
setInterval(() => {
  const now = Date.now();
  for (const [id, entry] of store) {
    if (now - entry.createdAt > TTL_MS) {
      store.delete(id);
      void rm(entry.extractedDir, { recursive: true, force: true }).catch(() => {});
      logger.info({ uploadId: id }, "upload-store: expired entry cleaned up");
    }
  }
}, 10 * 60_000).unref();
