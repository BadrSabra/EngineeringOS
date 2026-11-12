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
import { registerUpload } from "../lib/upload-store.js";
import { logger } from "../lib/logger.js";
import { LockNamespace, tryAdvisoryLock } from "../lib/advisory-lock.js";
import {
  ArchiveProcessingLimiter,
  ArchiveSafetyError,
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
) {
  const router = Router();
  const archiveReleases = new WeakMap<object, () => void>();
  const stagingDirectories = new WeakMap<object, string>();
  const distributedLockReleases = new WeakMap<object, () => Promise<void>>();
  const cleanupStagingDirectory = async (request: object) => {
    const stagingDirectory = stagingDirectories.get(request);
    if (!stagingDirectory) return;
    await fs.rm(stagingDirectory, { recursive: true, force: true }).catch(() => {});
    stagingDirectories.delete(request);
  };
  const cleanupIncomingUpload = async (request: Request) => {
    if (request.file?.path) await fs.unlink(request.file.path).catch(() => {});
    await cleanupStagingDirectory(request);
    releaseArchiveRequest(archiveReleases, request);
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
        res.status(429).json({
          error: "Archive processing is temporarily busy",
          code: "UPLOAD_ARCHIVE_BUSY",
        });
        return;
      }
      archiveReleases.set(req, release);
      upload.single("archive")(req, res, (err) => {
        if (err instanceof MulterError && err.code === "LIMIT_FILE_SIZE") {
          releaseArchiveRequest(archiveReleases, req);
          const stagingDirectory = stagingDirectories.get(req);
          if (stagingDirectory) {
            void fs.rm(stagingDirectory, { recursive: true, force: true });
            stagingDirectories.delete(req);
          }
          res.status(413).json({
            error: "Archive exceeds the 50 MB upload limit",
            code: "UPLOAD_TOO_LARGE",
          });
          return;
        }
        if (err) {
          releaseArchiveRequest(archiveReleases, req);
          const stagingDirectory = stagingDirectories.get(req);
          if (stagingDirectory) {
            void fs.rm(stagingDirectory, { recursive: true, force: true });
            stagingDirectories.delete(req);
          }
          next(err);
          return;
        }
        next();
      });
    },
    (req, res, next) => {
      if (!req.file) {
        next();
        return;
      }
      void (async () => {
        let lock;
        try {
          lock = await acquireDistributedLock(LockNamespace.ARCHIVE_UPLOAD, "global");
        } catch {
          await cleanupIncomingUpload(req);
          res.status(503).json({
            error: "Archive processing admission is unavailable",
            code: "UPLOAD_ADMISSION_UNAVAILABLE",
          });
          return;
        }
        if (!lock.acquired) {
          await cleanupIncomingUpload(req);
          res.setHeader("retry-after", "1");
          res.status(429).json({
            error: "Archive processing is temporarily busy",
            code: "UPLOAD_ARCHIVE_BUSY",
          });
          return;
        }
        distributedLockReleases.set(req, lock.release);
        next();
      })().catch(async () => {
        await releaseDistributedLock(req);
        await cleanupIncomingUpload(req);
        if (!res.headersSent) {
          res.status(503).json({
            error: "Archive processing admission is unavailable",
            code: "UPLOAD_ADMISSION_UNAVAILABLE",
          });
        }
      });
    },
    async (req, res) => {
      if (!req.file) {
        releaseArchiveRequest(archiveReleases, req);
        res.status(400).json({
          error: "No file uploaded. Send the archive as a multipart field named 'archive'.",
        });
        return;
      }

      const { originalname, path: uploadedPath } = req.file;
      const lower = originalname.toLowerCase();
      const isTarGz = lower.endsWith(".tar.gz") || lower.endsWith(".tgz");
      const isZip = lower.endsWith(".zip");

      const uploadId = randomUUID();
      let extractionDirectory: string | undefined;
      let tarPath: string | undefined;

      try {
        if (!isTarGz && !isZip) {
          await fs.unlink(uploadedPath).catch(() => {});
          await cleanupStagingDirectory(req);
          releaseArchiveRequest(archiveReleases, req);
          res.status(400).json({
            error: "Unsupported archive format. Only .zip and .tar.gz archives are supported.",
          });
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
          await extractZipSafely(zip, extractDir);
        } else {
          tarPath = join(extractDir, `.archive-${uploadId}.tar.gz`);
          await fs.copyFile(uploadedPath, tarPath);
          await extractTarGzSafely(tarPath, extractDir);
          await fs.unlink(tarPath);
          tarPath = undefined;
        }

        // PR-D2: registerUpload is now async (DB-backed). Pass the authenticated
        // userId so the row can be owner-scoped for future access-control checks.
        await registerUpload(uploadId, extractDir, originalname, req.userId!);

        logger.info(
          { uploadId, originalname, extractDir, format: isZip ? "zip" : "tar.gz" },
          "archive uploaded and extracted",
        );

        await fs.unlink(uploadedPath).catch(() => {});
        await cleanupStagingDirectory(req);
        await releaseDistributedLock(req);
        releaseArchiveRequest(archiveReleases, req);
        res.status(201).json({ uploadId, originalName: originalname });
      } catch (err) {
        if (extractionDirectory) {
          await fs.rm(extractionDirectory, { recursive: true, force: true }).catch(() => {});
        }
        if (tarPath) await fs.unlink(tarPath).catch(() => {});
        await fs.unlink(uploadedPath).catch(() => {});
        await cleanupStagingDirectory(req);
        await releaseDistributedLock(req);
        releaseArchiveRequest(archiveReleases, req);
        const msg = err instanceof ArchiveSafetyError
          ? err.message
          : "archive is malformed or could not be extracted";
        logger.error({ err, uploadId, originalname }, "archive extraction failed");
        res.status(422).json({ error: `Archive extraction failed: ${msg}` });
      } finally {
        await fs.unlink(uploadedPath).catch(() => {});
        await cleanupStagingDirectory(req);
        await releaseDistributedLock(req);
        releaseArchiveRequest(archiveReleases, req);
      }
    },
  );

  return router;
}

export default createUploadRouter();
