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
import multer, { MulterError } from "multer";
import { promises as fs } from "node:fs";
import { randomUUID } from "crypto";
import AdmZip from "adm-zip";
import { requireAuth } from "../middlewares/requireAuth.js";
import { registerUpload } from "../lib/upload-store.js";
import { logger } from "../lib/logger.js";
import { ArchiveSafetyError, extractTarGzSafely, extractZipSafely } from "../lib/archive-safety.js";
const router = Router();

// Stream the multipart body to disk. Keeping a 50 MB archive in the Node heap
// made concurrent uploads multiply memory usage before archive limits ran.
const upload = multer({
  storage: multer.diskStorage({
    destination: "/tmp",
    filename: (_req, _file, cb) => cb(null, randomUUID()),
  }),
  limits: { fileSize: 50 * 1024 * 1024 },
});

/** POST /api/upload/archive */
router.post("/upload/archive", requireAuth, (req, res, next) => {
  upload.single("archive")(req, res, (err) => {
    if (err instanceof MulterError && err.code === "LIMIT_FILE_SIZE") {
      return res.status(413).json({ error: "Archive exceeds the 50 MB upload limit", code: "UPLOAD_TOO_LARGE" });
    }
    if (err) return next(err);
    return next();
  });
}, async (req, res) => {
  if (!req.file) {
    return res.status(400).json({
      error: "No file uploaded. Send the archive as a multipart field named 'archive'.",
    });
  }

  const { originalname, path: uploadedPath } = req.file;
  const lower = originalname.toLowerCase();
  const isTarGz = lower.endsWith(".tar.gz") || lower.endsWith(".tgz");
  const isZip   = lower.endsWith(".zip");

  if (!isTarGz && !isZip) {
    return res.status(400).json({
      error: "Unsupported archive format. Only .zip and .tar.gz archives are supported.",
    });
  }

  const uploadId   = randomUUID();
  const extractDir = `/tmp/eos-upload-${uploadId}`;
  const tarPath = `/tmp/eos-archive-${uploadId}.tar.gz`;

  try {
    await fs.mkdir(extractDir, { recursive: true });

    if (isZip) {
       const zip = new AdmZip(uploadedPath);
      await extractZipSafely(zip, extractDir);
    } else {
       await fs.copyFile(uploadedPath, tarPath);
      await extractTarGzSafely(tarPath, extractDir);
    }

    // PR-D2: registerUpload is now async (DB-backed). Pass the authenticated
    // userId so the row can be owner-scoped for future access-control checks.
    await registerUpload(uploadId, extractDir, originalname, req.userId!);

    logger.info({ uploadId, originalname, extractDir, format: isZip ? "zip" : "tar.gz" },
      "archive uploaded and extracted");

    return res.status(201).json({ uploadId, originalName: originalname });
  } catch (err) {
    await fs.rm(extractDir, { recursive: true, force: true }).catch(() => {});
    await fs.unlink(tarPath).catch(() => {});
    const msg = err instanceof ArchiveSafetyError
      ? err.message
      : "archive is malformed or could not be extracted";
    logger.error({ err, uploadId, originalname }, "archive extraction failed");
    return res.status(422).json({ error: `Archive extraction failed: ${msg}` });
  } finally {
    await fs.unlink(uploadedPath).catch(() => {});
  }
});

export default router;
