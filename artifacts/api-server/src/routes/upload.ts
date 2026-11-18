/**
 * Epic D — Archive upload endpoint for ARCHIVE_UPLOAD discovery.
 *
 * POST /api/upload/archive
 *   Accepts a multipart file upload (field name: "archive").
 *   Supported formats: .zip, .tar.gz
 *   Max size: 50 MB
 *
 * Returns { uploadId, originalName } on success.
 * The uploadId is then used as sourceConfig.uploadId when starting an
 * ARCHIVE_UPLOAD discovery session.
 *
 * Uploads are stored in a temp directory and expire after 1 hour.
 */
import { Router } from "express";
import type { Request } from "express";
import multer, { MulterError } from "multer";
import { promises as fs } from "node:fs";
import { randomUUID } from "crypto";
import AdmZip from "adm-zip";
import { join } from "node:path";
import { requireAuth } from "../middlewares/requireAuth.js";
import { registerUpload, removeUpload } from "../lib/upload-store.js";
import { logger } from "../lib/logger.js";
import { LockNamespace, tryAdvisoryLock } from "../lib/advisory-lock.js";
import {
  ArchiveProcessingLimiter,
  ArchiveSafetyError,
  ARCHIVE_UPLOAD_BODY_TIMEOUT_MS,
  archiveProcessingLimiter,
  extractTarGzSafely,
  extractZipSafely,
} from "../lib/archive-safety.js";

async function createPrivateUploadDirectory(parent: string): Promise<string> {
  const directory = join(parent, `eos-upload-stage-${randomUUID()}`);
  await fs.mkdir(directory, { mode: 0o700 });
  const stat = await fs.lstat(directory);
  if (
    !stat.isDirectory() ||
    stat.isSymbolicLink() ||
    (typeof process.getuid === "function" && stat.uid !== process.getuid()) ||
    (stat.mode & 0o077) !== 0
  ) {
    await fs.rm(directory, { recursive: true, force: true }).catch(() => {});
    throw new Error("Private upload directory could not be established.");
  }
  return directory;
}

async function cleanupOrphanedStagingDirectories(parent: string): Promise<void> {
  let entries;
  try {
    entries = await fs.readdir(parent, { withFileTypes: true });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return;
    throw error;
  }

  const generatedDirectoryName =
    /^eos-upload-stage-[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
  for (const entry of entries) {
    if (!entry.isDirectory() || !generatedDirectoryName.test(entry.name)) continue;
    const directory = join(parent, entry.name);
    const stat = await fs.lstat(directory);
    if (
      !stat.isDirectory() ||
      stat.isSymbolicLink() ||
      (typeof process.getuid === "function" && stat.uid !== process.getuid()) ||
      (stat.mode & 0o077) !== 0
    ) {
      continue;
    }
    await fs.rm(directory, { recursive: true, force: true });
  }
}

function releaseArchiveRequest(
  releases: WeakMap<object, () => void>,
  request: object,
): void {
  releases.get(request)?.();
  releases.delete(request);
}

export function createUploadRouter(
  uploadTempDir = "/tmp",
  processingLimiter: ArchiveProcessingLimiter = archiveProcessingLimiter,
  acquireDistributedLock: typeof tryAdvisoryLock = tryAdvisoryLock,
  bodyTimeoutMs = ARCHIVE_UPLOAD_BODY_TIMEOUT_MS,
) {
  const router = Router();
  const archiveReleases = new WeakMap<object, () => void>();
  const stagingDirectories = new WeakMap<object, string>();
  const distributedLockReleases = new WeakMap<object, () => Promise<void>>();
  const requestAbortControllers = new WeakMap<object, AbortController>();
  const cleanupStagingDirectory = async (request: object) => {
    const stagingDirectory = stagingDirectories.get(request);
    if (!stagingDirectory) return;
    await fs.rm(stagingDirectory, { recursive: true, force: true }).catch(() => {});
    stagingDirectories.delete(request);
  };
  const releaseDistributedLock = async (request: object) => {
    const release = distributedLockReleases.get(request);
    if (!release) return;
    distributedLockReleases.delete(request);
    try {
      await release();
    } catch {
      logger.warn({ code: "ARCHIVE_LOCK_RELEASE_FAILED" }, "archive admission lock release failed");
    }
  };
  const releaseArchiveAdmission = async (request: object) => {
    await releaseDistributedLock(request);
    releaseArchiveRequest(archiveReleases, request);
    requestAbortControllers.delete(request);
  };
  const cleanupIncomingUpload = async (request: Request) => {
    if (request.file?.path) await fs.unlink(request.file.path).catch(() => {});
    await cleanupStagingDirectory(request);
    await releaseArchiveAdmission(request);
  };

  const upload = multer({
    storage: multer.diskStorage({
      destination: (req, _file, cb) => {
        void createPrivateUploadDirectory(uploadTempDir)
          .then((directory) => {
            stagingDirectories.set(req, directory);
            cb(null, directory);
          })
          .catch((error: unknown) =>
            cb(
              error instanceof Error
                ? error
                : new Error("Private upload directory could not be created."),
              "",
            ),
          );
      },
      filename: (_req, _file, cb) => cb(null, randomUUID()),
    }),
    limits: { fileSize: 50 * 1024 * 1024 },
  });

  /** POST /api/upload/archive */
  router.post(
    "/upload/archive",
    requireAuth,
    (req, res, next) => {
      const release = processingLimiter.tryAcquire();
      if (!release) {
        res.setHeader("retry-after", "1");
        res.setHeader("connection", "close");
        res.status(429).json({
          error: "Archive processing is temporarily busy",
          code: "UPLOAD_ARCHIVE_BUSY",
        });
        return;
      }
      archiveReleases.set(req, release);
      void (async () => {
        let lock;
        try {
          lock = await acquireDistributedLock(LockNamespace.ARCHIVE_UPLOAD, "global");
        } catch {
          await releaseArchiveAdmission(req);
          if (!res.destroyed) {
            res.setHeader("connection", "close");
            res.status(503).json({
              error: "Archive processing admission is unavailable",
              code: "UPLOAD_ADMISSION_UNAVAILABLE",
            });
          }
          return;
        }
        if (!lock.acquired) {
          await releaseArchiveAdmission(req);
          res.setHeader("retry-after", "1");
          res.setHeader("connection", "close");
          if (!res.destroyed) {
            res.status(429).json({
              error: "Archive processing is temporarily busy",
              code: "UPLOAD_ARCHIVE_BUSY",
            });
          }
          return;
        }
        distributedLockReleases.set(req, lock.release);
        await cleanupOrphanedStagingDirectories(uploadTempDir);
        const abortController = new AbortController();
        requestAbortControllers.set(req, abortController);
        req.once("aborted", () => abortController.abort());
        res.once("close", () => {
          if (!res.writableEnded) abortController.abort();
        });

        if (req.aborted || res.destroyed) {
          abortController.abort();
          await cleanupIncomingUpload(req);
          return;
        }

        // The shared session lock is the one-slot, cross-replica reservation.
        // Bound how long a slow request can hold it while Multer receives data.
        const bodyTimer = setTimeout(() => {
          abortController.abort();
          req.destroy();
        }, bodyTimeoutMs);
        bodyTimer.unref?.();

        upload.single("archive")(req, res, (err) => {
          clearTimeout(bodyTimer);
          void (async () => {
            if (err) {
              await cleanupIncomingUpload(req);
              if (req.aborted || res.destroyed) return;
              if (err instanceof MulterError && err.code === "LIMIT_FILE_SIZE") {
                res.status(413).json({
                  error: "Archive exceeds the 50 MB upload limit",
                  code: "UPLOAD_TOO_LARGE",
                });
                return;
              }
              next(err);
              return;
            }
            if (abortController.signal.aborted || req.aborted || res.destroyed) {
              await cleanupIncomingUpload(req);
              return;
            }
            next();
          })().catch(async (error: unknown) => {
            await cleanupIncomingUpload(req);
            if (!res.headersSent && !res.destroyed) next(error);
          });
        });
      })().catch(async () => {
        await cleanupIncomingUpload(req);
        if (!res.headersSent && !res.destroyed) {
          res.status(503).json({
            error: "Archive processing admission is unavailable",
            code: "UPLOAD_ADMISSION_UNAVAILABLE",
          });
        }
      });
    },
    async (req, res) => {
      if (!req.file) {
        await releaseArchiveAdmission(req);
        if (!res.destroyed) {
          res.status(400).json({
            error: "No file uploaded. Send the archive as a multipart field named 'archive'.",
          });
        }
        return;
      }

      const { originalname, path: uploadedPath } = req.file;
      const abortSignal = requestAbortControllers.get(req)?.signal;
      const lower = originalname.toLowerCase();
      const isTarGz = lower.endsWith(".tar.gz") || lower.endsWith(".tgz");
      const isZip = lower.endsWith(".zip");

      const uploadId = randomUUID();
      let extractionDirectory: string | undefined;
      let tarPath: string | undefined;
      let registrationAttempted = false;

      try {
        if (!isTarGz && !isZip) {
          await cleanupIncomingUpload(req);
          if (!res.destroyed) {
            res.status(400).json({
              error: "Unsupported archive format. Only .zip and .tar.gz archives are supported.",
            });
          }
          return;
        }

        const extractDir = await fs.mkdtemp(
          join(uploadTempDir, `eos-extract-${uploadId}-`),
        );
        extractionDirectory = extractDir;
        await fs.chmod(extractDir, 0o700);
        const extractionStat = await fs.lstat(extractDir);
        if (
          !extractionStat.isDirectory() ||
          extractionStat.isSymbolicLink() ||
          (typeof process.getuid === "function" &&
            extractionStat.uid !== process.getuid()) ||
          (extractionStat.mode & 0o077) !== 0
        ) {
          throw new ArchiveSafetyError(
            "archive extraction directory is not private",
          );
        }
        const stagingDirectory = stagingDirectories.get(req);
        if (!stagingDirectory || !req.file.path.startsWith(`${stagingDirectory}/`)) {
          throw new ArchiveSafetyError("archive upload path is not private");
        }
        const uploadedStat = await fs.lstat(req.file.path);
        if (
          !uploadedStat.isFile() ||
          uploadedStat.isSymbolicLink() ||
          (typeof process.getuid === "function" &&
            uploadedStat.uid !== process.getuid())
        ) {
          throw new ArchiveSafetyError("archive upload file is not private");
        }
        await fs.chmod(req.file.path, 0o600);

        if (isZip) {
          const zip = new AdmZip(uploadedPath);
          await extractZipSafely(zip, extractDir, undefined, abortSignal);
        } else {
          tarPath = join(extractDir, `.archive-${uploadId}.tar.gz`);
          await fs.copyFile(uploadedPath, tarPath);
          await extractTarGzSafely(tarPath, extractDir, undefined, abortSignal);
          await fs.unlink(tarPath);
          tarPath = undefined;
        }

        if (abortSignal?.aborted || req.aborted || res.destroyed) {
          const error = new Error("Archive upload was cancelled.");
          error.name = "AbortError";
          throw error;
        }

        // Register the original archive in private shared storage. The validated
        // extraction above remains local only long enough to reject unsafe input.
        registrationAttempted = true;
        await registerUpload(
          uploadId,
          uploadedPath,
          originalname,
          req.userId!,
          isZip ? "zip" : "tar.gz",
        );
        if (abortSignal?.aborted || req.aborted || res.destroyed) {
          const error = new Error("Archive upload was cancelled.");
          error.name = "AbortError";
          throw error;
        }

        logger.info(
          { uploadId, originalname, format: isZip ? "zip" : "tar.gz" },
          "archive uploaded to shared storage",
        );

        await fs.rm(extractDir, { recursive: true, force: true });
        extractionDirectory = undefined;
        await fs.unlink(uploadedPath).catch(() => {});
        await cleanupStagingDirectory(req);
        await releaseArchiveAdmission(req);
        if (abortSignal?.aborted || req.aborted || res.destroyed) {
          await removeUpload(uploadId, req.userId!).catch(() => {});
          return;
        }
        res.status(201).json({ uploadId, originalName: originalname });
      } catch (err) {
        if (registrationAttempted) {
          await removeUpload(uploadId, req.userId!).catch(() => {});
        }
        if (extractionDirectory) {
          await fs.rm(extractionDirectory, { recursive: true, force: true }).catch(() => {});
        }
        if (tarPath) await fs.unlink(tarPath).catch(() => {});
        await cleanupIncomingUpload(req);
        if (abortSignal?.aborted || req.aborted || res.destroyed) return;
        const msg = err instanceof ArchiveSafetyError
          ? err.message
          : "archive is malformed or could not be extracted";
        logger.error({ err, uploadId, originalname }, "archive extraction failed");
        res.status(422).json({ error: `Archive extraction failed: ${msg}` });
      } finally {
        await cleanupIncomingUpload(req);
      }
    },
  );

  return router;
}

export default createUploadRouter();
