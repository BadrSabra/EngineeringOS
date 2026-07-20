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
import multer from "multer";
import { promises as fs } from "node:fs";
import path from "node:path";
import { randomUUID } from "crypto";
import AdmZip from "adm-zip";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { requireAuth } from "../middlewares/requireAuth.js";
import { registerUpload } from "../lib/upload-store.js";
import { logger } from "../lib/logger.js";

const execFileAsync = promisify(execFile);
const router = Router();

// In-memory storage — archives are extracted immediately and the buffer discarded.
// 50 MB is generous for most source repos; adjust if needed.
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 50 * 1024 * 1024 },
});

/** POST /api/upload/archive */
router.post("/upload/archive", requireAuth, upload.single("archive"), async (req, res) => {
  if (!req.file) {
    return res.status(400).json({
      error: "No file uploaded. Send the archive as a multipart field named 'archive'.",
    });
  }

  const { originalname, buffer } = req.file;
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

  try {
    await fs.mkdir(extractDir, { recursive: true });

    if (isZip) {
      // AdmZip operates synchronously on the in-memory buffer — no temp file needed.
      const zip = new AdmZip(buffer);
      zip.extractAllTo(extractDir, /* overwrite */ true);
    } else {
      // Write buffer to a temp file then delegate to system tar (always available).
      const tarPath = `/tmp/eos-archive-${uploadId}.tar.gz`;
      try {
        await fs.writeFile(tarPath, buffer);
        await execFileAsync("tar", ["-xzf", tarPath, "-C", extractDir], { timeout: 60_000 });
      } finally {
        await fs.unlink(tarPath).catch(() => {});
      }
    }

    registerUpload(uploadId, extractDir, originalname);

    logger.info({ uploadId, originalname, extractDir, format: isZip ? "zip" : "tar.gz" },
      "archive uploaded and extracted");

    return res.status(201).json({ uploadId, originalName: originalname });
  } catch (err) {
    await fs.rm(extractDir, { recursive: true, force: true }).catch(() => {});
    const msg = err instanceof Error ? err.message : String(err);
    logger.error({ err, uploadId, originalname }, "archive extraction failed");
    return res.status(422).json({ error: `Archive extraction failed: ${msg}` });
  }
});

export default router;
