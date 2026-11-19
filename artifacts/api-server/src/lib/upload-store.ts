/**
 * Owner-scoped archive metadata backed by PostgreSQL and private shared storage.
 * Retired rows act as cleanup receipts until object deletion succeeds.
 */
import AdmZip from "adm-zip";
import { and, eq, gt, lte, or, sql } from "drizzle-orm";
import { randomUUID } from "node:crypto";
import { chmod, lstat, mkdir, mkdtemp, rm, unlink } from "node:fs/promises";
import { join, relative, resolve, sep } from "node:path";
import { tmpdir } from "node:os";
import {
  db,
  uploadsTable,
  type Upload,
} from "@workspace/db";
import {
  createArchiveObjectKey,
  deleteArchiveObject,
  downloadArchiveObject,
  putArchiveObject,
  type ArchiveFormat,
} from "./archive-object-storage.js";
import {
  extractTarGzSafely,
  extractZipSafely,
  archiveProcessingLimiter,
} from "./archive-safety.js";
import { LockNamespace, tryAdvisoryLock } from "./advisory-lock.js";
import { logger } from "./logger.js";

export const UPLOAD_TTL_MS = Number(
  process.env.UPLOAD_TTL_MS ?? 60 * 60_000,
);

export interface UploadEntry {
  ownerId: string;
  extractedDir?: string;
  storageKey?: string;
  archiveFormat?: ArchiveFormat;
  originalName: string;
  createdAt: number;
  state: "storing" | "active" | "claimed" | "retired";
}

export interface MaterializedUpload {
  entry: UploadEntry;
  extractedDir: string;
  cleanupLocal: () => Promise<void>;
}

export class ArchiveUploadAdmissionError extends Error {
  constructor(
    readonly status: 429 | 503,
    message: string,
  ) {
    super(message);
    this.name = "ArchiveUploadAdmissionError";
  }
}

async function acquireDiscoveryArchiveAdmission(): Promise<() => Promise<void>> {
  const releaseLocal = archiveProcessingLimiter.tryAcquire();
  if (!releaseLocal) {
    throw new ArchiveUploadAdmissionError(
      429,
      "Archive processing is temporarily busy.",
    );
  }

  let lock;
  try {
    lock = await tryAdvisoryLock(LockNamespace.ARCHIVE_UPLOAD, "global");
  } catch {
    releaseLocal();
    throw new ArchiveUploadAdmissionError(
      503,
      "Archive processing admission is unavailable.",
    );
  }
  if (!lock.acquired) {
    releaseLocal();
    throw new ArchiveUploadAdmissionError(
      429,
      "Archive processing is temporarily busy.",
    );
  }

  return async () => {
    try {
      await lock.release();
    } catch (err) {
      logger.warn({ err }, "upload-store: discovery archive lock release failed");
    } finally {
      releaseLocal();
    }
  };
}

function toEntry(row: Upload): UploadEntry {
  return {
    ownerId: row.ownerId,
    extractedDir: row.extractedDir ?? undefined,
    storageKey: row.storageKey ?? undefined,
    archiveFormat:
      row.archiveFormat === "zip" || row.archiveFormat === "tar.gz"
        ? row.archiveFormat
        : undefined,
    originalName: row.originalName,
    createdAt: row.createdAt.getTime(),
    state: row.state as UploadEntry["state"],
  };
}

function legacyUploadPath(uploadId: string, extractedDir: string): string {
  const root = resolve(tmpdir());
  const candidate = resolve(extractedDir);
  const child = relative(root, candidate);
  if (
    !child ||
    child === ".." ||
    child.startsWith(`..${sep}`) ||
    child.includes(sep) ||
    !child.startsWith(`eos-extract-${uploadId}-`)
  ) {
    throw new Error("Legacy upload directory is outside its managed temporary root.");
  }
  return candidate;
}

async function cleanupRetiredRow(row: Upload): Promise<boolean> {
  try {
    if (row.storageKey) {
      if (row.archiveFormat !== "zip" && row.archiveFormat !== "tar.gz") {
        throw new Error("Retired archive has an invalid storage format.");
      }
      await deleteArchiveObject(
        row.storageKey,
        row.ownerId,
        row.id,
        row.archiveFormat,
      );
    } else if (row.extractedDir) {
      await rm(legacyUploadPath(row.id, row.extractedDir), {
        recursive: true,
        force: true,
      });
    }
  } catch (err) {
    logger.warn(
      { uploadId: row.id, err },
      "upload-store: retired archive cleanup will retry",
    );
    return false;
  }

  await db
    .delete(uploadsTable)
    .where(and(
      eq(uploadsTable.id, row.id),
      eq(uploadsTable.ownerId, row.ownerId),
      eq(uploadsTable.state, "retired"),
    ));
  logger.info({ uploadId: row.id }, "upload-store: retired entry removed");
  return true;
}

async function retireUpload(uploadId: string, ownerId: string): Promise<void> {
  const retired = await db
    .update(uploadsTable)
    .set({ state: "retired" })
    .where(and(
      eq(uploadsTable.id, uploadId),
      eq(uploadsTable.ownerId, ownerId),
      eq(uploadsTable.state, "active"),
    ))
    .returning();

  const claimed = retired[0] ?? (await db
    .select()
    .from(uploadsTable)
    .where(and(
      eq(uploadsTable.id, uploadId),
      eq(uploadsTable.ownerId, ownerId),
      eq(uploadsTable.state, "retired"),
    ))
    .limit(1))[0];
  if (claimed) await cleanupRetiredRow(claimed);
}

/**
 * Retire only an active row that PostgreSQL confirms has expired.
 * The conditional update prevents an old read from deleting a renewed claim.
 */
async function retireExpiredUpload(uploadId: string, ownerId: string): Promise<void> {
  const [retired] = await db
    .update(uploadsTable)
    .set({ state: "retired" })
    .where(and(
      eq(uploadsTable.id, uploadId),
      eq(uploadsTable.ownerId, ownerId),
      eq(uploadsTable.state, "active"),
      lte(uploadsTable.expiresAt, sql`CURRENT_TIMESTAMP`),
    ))
    .returning();
  if (retired) {
    await cleanupRetiredRow(retired);
    logger.info({ uploadId }, "upload-store: expired entry retired on lookup");
  }
}

/**
 * Persist an upload intent before streaming bytes so a process crash or partial
 * object write leaves a durable, retryable cleanup record.
 */
export async function registerUpload(
  uploadId: string,
  archivePath: string,
  originalName: string,
  ownerId: string,
  archiveFormat: ArchiveFormat,
): Promise<void> {
  const storageKey = createArchiveObjectKey(ownerId, uploadId, archiveFormat);

  await db.insert(uploadsTable).values({
    id: uploadId,
    ownerId,
    extractedDir: null,
    storageKey,
    archiveFormat,
    state: "storing",
    originalName,
    // PostgreSQL owns upload expiry so every API replica uses one clock.
    expiresAt: sql`CURRENT_TIMESTAMP + (${UPLOAD_TTL_MS} * INTERVAL '1 millisecond')`,
  });

  try {
    await putArchiveObject(
      storageKey,
      archivePath,
      ownerId,
      uploadId,
      archiveFormat,
    );
    const activated = await db
      .update(uploadsTable)
      .set({ state: "active" })
      .where(and(
        eq(uploadsTable.id, uploadId),
        eq(uploadsTable.ownerId, ownerId),
        eq(uploadsTable.state, "storing"),
        gt(uploadsTable.expiresAt, sql`CURRENT_TIMESTAMP`),
      ))
      .returning({ id: uploadsTable.id });
    if (activated.length !== 1) {
      throw new Error("Archive upload could not be activated.");
    }
    logger.info(
      { uploadId, originalName, ttlMs: UPLOAD_TTL_MS },
      "upload-store: registered",
    );
  } catch (err) {
    try {
      await db
        .update(uploadsTable)
        .set({ state: "retired" })
        .where(and(
          eq(uploadsTable.id, uploadId),
          eq(uploadsTable.ownerId, ownerId),
        ));
    } catch (retireErr) {
      logger.error(
        { uploadId, retireErr },
        "upload-store: failed to retire partial upload",
      );
    }
    await retireUpload(uploadId, ownerId).catch((cleanupErr: unknown) =>
      logger.warn({ uploadId, cleanupErr }, "upload-store: partial upload cleanup deferred"),
    );
    throw err;
  }
}

export async function lookupUpload(
  uploadId: string,
  ownerId: string,
): Promise<UploadEntry | undefined> {
  const rows = await db
    .select()
    .from(uploadsTable)
    .where(and(
      eq(uploadsTable.id, uploadId),
      eq(uploadsTable.ownerId, ownerId),
      eq(uploadsTable.state, "active"),
      gt(uploadsTable.expiresAt, sql`CURRENT_TIMESTAMP`),
    ))
    .limit(1);
  const row = rows[0];
  if (!row || row.ownerId !== ownerId) {
    await retireExpiredUpload(uploadId, ownerId);
    return undefined;
  }

  if (row.storageKey && (row.archiveFormat === "zip" || row.archiveFormat === "tar.gz")) {
    return toEntry(row);
  }

  if (!row.extractedDir) {
    await retireUpload(uploadId, ownerId);
    return undefined;
  }
  try {
    const path = legacyUploadPath(uploadId, row.extractedDir);
    const stats = await lstat(path);
    if (!stats.isDirectory() || stats.isSymbolicLink()) throw new Error("not a directory");
  } catch {
    await retireUpload(uploadId, ownerId);
    logger.warn({ uploadId }, "upload-store: legacy extracted directory is unavailable");
    return undefined;
  }
  return toEntry(row);
}

/**
 * Atomically grants one discovery attempt the right to use an active upload.
 * The durable claimed row remains until that attempt's cleanup or TTL sweep.
 */
export async function claimUpload(
  uploadId: string,
  ownerId: string,
): Promise<UploadEntry | undefined> {
  const rows = await db
    .update(uploadsTable)
    // Give resolution a full TTL to download/materialize even when the upload
    // was claimed immediately before its original expiry.
    .set({
      state: "claimed",
      expiresAt: sql`CURRENT_TIMESTAMP + (${UPLOAD_TTL_MS} * INTERVAL '1 millisecond')`,
    })
    .where(and(
      eq(uploadsTable.id, uploadId),
      eq(uploadsTable.ownerId, ownerId),
      eq(uploadsTable.state, "active"),
      gt(uploadsTable.expiresAt, sql`CURRENT_TIMESTAMP`),
    ))
    .returning();
  return rows[0] ? toEntry(rows[0]) : undefined;
}

async function releaseUploadClaim(uploadId: string, ownerId: string): Promise<void> {
  await db
    .update(uploadsTable)
    .set({ state: "active" })
    .where(and(
      eq(uploadsTable.id, uploadId),
      eq(uploadsTable.ownerId, ownerId),
      eq(uploadsTable.state, "claimed"),
      gt(uploadsTable.expiresAt, sql`CURRENT_TIMESTAMP`),
    ));
}

export async function materializeClaimedUpload(
  uploadId: string,
  ownerId: string,
): Promise<MaterializedUpload | undefined> {
  const releaseAdmission = await acquireDiscoveryArchiveAdmission();
  try {
    const entry = await claimUpload(uploadId, ownerId);
    if (!entry) return undefined;

    if (entry.extractedDir) {
      try {
        return {
          entry,
          extractedDir: legacyUploadPath(uploadId, entry.extractedDir),
          cleanupLocal: async () => {},
        };
      } catch (err) {
        await releaseUploadClaim(uploadId, ownerId).catch(() => undefined);
        throw err;
      }
    }

    if (
      !entry.storageKey ||
      (entry.archiveFormat !== "zip" && entry.archiveFormat !== "tar.gz") ||
      entry.storageKey !== createArchiveObjectKey(ownerId, uploadId, entry.archiveFormat)
    ) {
      await removeUpload(uploadId, ownerId);
      throw new Error("Archive upload storage reference is invalid.");
    }

    let workingDir: string | undefined;
    const workingDirPrefix = join(tmpdir(), `eos-upload-resolve-${randomUUID()}-`);
    try {
      const localWorkingDir = await mkdtemp(workingDirPrefix);
      workingDir = localWorkingDir;
      await chmod(localWorkingDir, 0o700);
      const extractionDir = join(localWorkingDir, "extracted");
      const archivePath = join(
        localWorkingDir,
        entry.archiveFormat === "zip" ? "source.zip" : "source.tar.gz",
      );
      await mkdir(extractionDir, { mode: 0o700 });
      await downloadArchiveObject(entry.storageKey, archivePath);
      if (entry.archiveFormat === "zip") {
        await extractZipSafely(new AdmZip(archivePath), extractionDir);
      } else {
        await extractTarGzSafely(archivePath, extractionDir);
      }
      await unlink(archivePath);
      return {
        entry,
        extractedDir: extractionDir,
        cleanupLocal: async () => {
          await rm(localWorkingDir, { recursive: true, force: true });
        },
      };
    } catch (err) {
      if (workingDir) {
        await rm(workingDir, { recursive: true, force: true }).catch(() => undefined);
      }
      await releaseUploadClaim(uploadId, ownerId).catch(() => undefined);
      throw err;
    }
  } finally {
    await releaseAdmission();
  }
}

export async function removeUpload(uploadId: string, ownerId: string): Promise<void> {
  const rows = await db
    .update(uploadsTable)
    .set({ state: "retired" })
    .where(and(
      eq(uploadsTable.id, uploadId),
      eq(uploadsTable.ownerId, ownerId),
      or(
        eq(uploadsTable.state, "active"),
        eq(uploadsTable.state, "claimed"),
        eq(uploadsTable.state, "storing"),
      ),
    ))
    .returning();
  const row = rows[0] ?? (await db
    .select()
    .from(uploadsTable)
    .where(and(
      eq(uploadsTable.id, uploadId),
      eq(uploadsTable.ownerId, ownerId),
      eq(uploadsTable.state, "retired"),
    ))
    .limit(1))[0];
  if (row) await cleanupRetiredRow(row);
}

/** Retire expired entries and retry prior object deletions without data loss. */
export async function sweepExpiredUploads(): Promise<number> {
  try {
    const expired = await db
      .select()
      .from(uploadsTable)
      .where(or(
        lte(uploadsTable.expiresAt, sql`CURRENT_TIMESTAMP`),
        eq(uploadsTable.state, "retired"),
      ));

    let removed = 0;
    for (const row of expired) {
      if (row.state !== "retired") {
        await db
          .update(uploadsTable)
          .set({ state: "retired" })
          .where(and(
            eq(uploadsTable.id, row.id),
            lte(uploadsTable.expiresAt, sql`CURRENT_TIMESTAMP`),
            or(
              eq(uploadsTable.state, "storing"),
              eq(uploadsTable.state, "active"),
              eq(uploadsTable.state, "claimed"),
            ),
          ));
      }
      const [current] = await db
        .select()
        .from(uploadsTable)
        .where(and(
          eq(uploadsTable.id, row.id),
          eq(uploadsTable.ownerId, row.ownerId),
          eq(uploadsTable.state, "retired"),
        ))
        .limit(1);
      if (current && await cleanupRetiredRow(current)) removed += 1;
    }
    return removed;
  } catch (err) {
    logger.error({ err }, "upload-store: sweepExpiredUploads failed");
    return 0;
  }
}
