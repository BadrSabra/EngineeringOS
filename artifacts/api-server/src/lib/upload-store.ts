/**
 * PR-D2 — DB-backed upload store for ARCHIVE_UPLOAD discovery.
 *
 * ## What changed and why
 *
 * Previously entries lived in an in-process `Map<string, UploadEntry>`. Any
 * process restart between `POST /api/upload/archive` (which creates the entry)
 * and `POST /api/projects/discover` (which consumes it) silently dropped the
 * entry, producing a misleading "Upload not found or expired" 404 on the
 * discovery call.
 *
 * The fix is simple: persist the upload metadata row to the `uploads` DB table.
 * The extracted files themselves stay in `/tmp/eos-upload-{uploadId}/` — those
 * directories survive process restarts on Replit because `/tmp` is a host-level
 * tmpfs, not wiped between process restarts (only on full host reboot). If a
 * full host reboot cleans up the dir, `lookupUpload` detects the missing dir
 * and returns `undefined` so the caller shows a clear "re-upload required" error.
 *
 * ## Public API (identical to the old in-memory store, all functions now async)
 *
 * - `registerUpload(uploadId, extractedDir, originalName, ownerId)` → `Promise<void>`
 * - `lookupUpload(uploadId)` → `Promise<UploadEntry | undefined>`
 * - `removeUpload(uploadId)` → `Promise<void>`
 * - `sweepExpiredUploads()` → `Promise<number>` (new — used by reconciliation sweep)
 *
 * ## TTL
 *
 * Default: 1 hour (configurable via UPLOAD_TTL_MS env var). The TTL is written
 * as an absolute `expires_at` timestamp at insert time — no in-process timers.
 * Expired entries are cleaned up by:
 *   1. Startup reconciliation (see job-reconciliation.ts `reconcileStuckJobs`)
 *   2. The periodic stale-job sweep (see `startStaleJobSweep`)
 *   3. `lookupUpload` itself — skips and removes expired rows on access (lazy GC)
 */
import { rm, access } from "node:fs/promises";
import { db, uploadsTable } from "@workspace/db";
import { and, eq, lt } from "drizzle-orm";
import { logger } from "./logger.js";

export const UPLOAD_TTL_MS = Number(
  process.env.UPLOAD_TTL_MS ?? 60 * 60_000, // 1 hour
);

/** Shape returned by `lookupUpload` (unchanged from previous in-memory version). */
export interface UploadEntry {
  extractedDir: string;
  originalName: string;
  createdAt: number;
}

// ── Core API ─────────────────────────────────────────────────────────────────

/**
 * Register a new upload entry in the DB.
 * Called by `POST /api/upload/archive` immediately after extraction.
 */
export async function registerUpload(
  uploadId: string,
  extractedDir: string,
  originalName: string,
  ownerId: string,
): Promise<void> {
  const now = new Date();
  const expiresAt = new Date(now.getTime() + UPLOAD_TTL_MS);
  await db.insert(uploadsTable).values({
    id: uploadId,
    ownerId,
    extractedDir,
    originalName,
    createdAt: now,
    expiresAt,
  });
  logger.info({ uploadId, originalName, extractedDir, expiresAt }, "upload-store: registered");
}

/**
 * Look up an upload by ID.
 * Returns `undefined` when the ID is unknown, has expired, or its extracted
 * directory no longer exists on disk (covers full-host-reboot recovery).
 */
export async function lookupUpload(uploadId: string): Promise<UploadEntry | undefined> {
  const rows = await db
    .select()
    .from(uploadsTable)
    .where(eq(uploadsTable.id, uploadId))
    .limit(1);

  const row = rows[0];
  if (!row) return undefined;

  // Lazy expiry: if the row is past its TTL, clean it up and signal not-found.
  if (row.expiresAt.getTime() < Date.now()) {
    await db.delete(uploadsTable).where(eq(uploadsTable.id, uploadId));
    await rm(row.extractedDir, { recursive: true, force: true }).catch(() => {});
    logger.info({ uploadId }, "upload-store: lazy-expired entry removed on lookup");
    return undefined;
  }

  // Extra guard: if the dir was wiped by a full host reboot, remove the stale
  // DB row and tell the caller to re-upload. Better a clear error than a
  // confusing "directory does not exist" from the scanner pipeline.
  try {
    await access(row.extractedDir);
  } catch {
    await db.delete(uploadsTable).where(eq(uploadsTable.id, uploadId));
    logger.warn({ uploadId, extractedDir: row.extractedDir },
      "upload-store: extracted dir no longer exists — DB row removed; user must re-upload");
    return undefined;
  }

  return {
    extractedDir: row.extractedDir,
    originalName: row.originalName,
    createdAt: row.createdAt.getTime(),
  };
}

/**
 * Remove an upload entry from the DB and delete its extracted directory.
 * Called by the ARCHIVE_UPLOAD adapter's cleanup hook after discovery finishes.
 */
export async function removeUpload(uploadId: string): Promise<void> {
  const rows = await db
    .select({ extractedDir: uploadsTable.extractedDir })
    .from(uploadsTable)
    .where(eq(uploadsTable.id, uploadId))
    .limit(1);

  await db.delete(uploadsTable).where(eq(uploadsTable.id, uploadId));

  if (rows[0]) {
    await rm(rows[0].extractedDir, { recursive: true, force: true }).catch(() => {});
    logger.info({ uploadId }, "upload-store: removed");
  }
}

// ── Sweep ─────────────────────────────────────────────────────────────────────

/**
 * Delete all DB rows whose `expires_at` is in the past and clean up their
 * extracted directories. Safe to call at any time — uses the DB-persisted
 * `expires_at` so it does not race with active uploads.
 *
 * Returns the number of entries deleted.
 *
 * Called by:
 * - `reconcileStuckJobs()` once at startup
 * - `startStaleJobSweep()` on each periodic tick alongside the job sweeps
 */
export async function sweepExpiredUploads(): Promise<number> {
  const now = new Date();
  let count = 0;

  try {
    const expired = await db
      .select({ id: uploadsTable.id, extractedDir: uploadsTable.extractedDir })
      .from(uploadsTable)
      .where(lt(uploadsTable.expiresAt, now));

    if (expired.length === 0) return 0;

    for (const row of expired) {
      // Delete the DB row first so a concurrent lookup doesn't race with rm().
      await db
        .delete(uploadsTable)
        .where(and(eq(uploadsTable.id, row.id), lt(uploadsTable.expiresAt, now)));
      await rm(row.extractedDir, { recursive: true, force: true }).catch(() => {});
      count++;
      logger.info({ uploadId: row.id, extractedDir: row.extractedDir },
        "upload-store: sweep removed expired entry");
    }
  } catch (err) {
    logger.error({ err }, "upload-store: sweepExpiredUploads failed");
  }

  return count;
}
