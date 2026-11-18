import express from "express";
import request from "supertest";
import { afterEach, describe, expect, it, vi } from "vitest";
import { promises as fs } from "node:fs";
import { mkdir, mkdtemp, readFile, readdir, rm, stat, writeFile } from "node:fs/promises";
import { request as httpRequest } from "node:http";
import { once } from "node:events";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import AdmZip from "adm-zip";
import { pool } from "@workspace/db";
import { LockNamespace, tryAdvisoryLock } from "../lib/advisory-lock.js";
import { ArchiveProcessingLimiter } from "../lib/archive-safety.js";

vi.mock("../middlewares/requireAuth.js", () => ({
  requireAuth: (req: { userId?: string }, _res: unknown, next: (error?: unknown) => void) => {
    req.userId = "test-user";
    next();
  },
}));
vi.mock("../lib/upload-store.js", () => ({
  registerUpload: vi.fn(async () => {}),
  removeUpload: vi.fn(async () => {}),
}));
vi.mock("../lib/logger.js", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

import { createUploadRouter } from "./upload.js";
import { registerUpload, removeUpload } from "../lib/upload-store.js";
import { logger } from "../lib/logger.js";

const tempDirs: string[] = [];

function advisoryKey(id: string): number {
  let hash = 5381;
  for (let index = 0; index < id.length; index += 1) {
    hash = (((hash << 5) + hash) ^ id.charCodeAt(index)) | 0;
  }
  return hash;
}

async function waitFor(
  predicate: () => Promise<boolean>,
  timeoutMs = 2000,
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await predicate()) return;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error(`condition was not met within ${timeoutMs}ms`);
}

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

describe("archive upload temporary files", () => {
  it("removes an unsupported archive after returning 400", async () => {
    const uploadTempDir = await mkdtemp(join(tmpdir(), "upload-rejected-"));
    tempDirs.push(uploadTempDir);
    const app = express();
    const releaseLock = vi.fn(async () => {});
    app.use(createUploadRouter(uploadTempDir, undefined, async () => ({
      acquired: true,
      release: releaseLock,
    })));

    const response = await request(app)
      .post("/upload/archive")
      .attach("archive", Buffer.from("not an archive"), "unsupported.rar");

    expect(response.status).toBe(400);
    expect(response.body.error).toMatch(/unsupported archive format/i);
    expect(releaseLock).toHaveBeenCalledOnce();
    expect(await readdir(uploadTempDir)).toEqual([]);
  });

  it("stores a validated archive by owner and leaves no replica-local extraction behind", async () => {
    const uploadTempDir = await mkdtemp(join(tmpdir(), "upload-valid-"));
    tempDirs.push(uploadTempDir);
    const zip = new AdmZip();
    zip.addFile("src/index.ts", Buffer.from("export const safe = true;\n"));
    const app = express();
    const releaseLock = vi.fn(async () => {});
    app.use(createUploadRouter(uploadTempDir, undefined, async () => ({
      acquired: true,
      release: releaseLock,
    })));

    const response = await request(app)
      .post("/upload/archive")
      .attach("archive", zip.toBuffer(), "workspace.zip");

    expect(response.status).toBe(201);
    expect(response.body.uploadId).toEqual(expect.any(String));
    expect(releaseLock).toHaveBeenCalledOnce();
    expect(vi.mocked(registerUpload)).toHaveBeenCalledOnce();
    const [uploadId, archivePath, originalName, ownerId, archiveFormat] =
      vi.mocked(registerUpload).mock.calls[0];
    expect(uploadId).toBe(response.body.uploadId);
    expect(archivePath).toContain(`${uploadTempDir}/eos-upload-stage-`);
    expect(originalName).toBe("workspace.zip");
    expect(ownerId).toBe("test-user");
    expect(archiveFormat).toBe("zip");
    await expect(stat(archivePath)).rejects.toThrow();
    expect(await readdir(uploadTempDir)).toEqual([]);
  });

  it("retries staging cleanup after a transient filesystem error", async () => {
    const uploadTempDir = await mkdtemp(join(tmpdir(), "upload-cleanup-retry-"));
    tempDirs.push(uploadTempDir);
    vi.mocked(logger.warn).mockClear();
    const actualRm = rm;
    let failFirstStagingCleanup = true;
    const rmSpy = vi.spyOn(fs, "rm").mockImplementation(async (path, options) => {
      if (
        failFirstStagingCleanup &&
        String(path).includes("eos-upload-stage-")
      ) {
        failFirstStagingCleanup = false;
        const error = new Error("simulated staging cleanup failure") as NodeJS.ErrnoException;
        error.code = "EACCES";
        throw error;
      }
      return actualRm(path, options);
    });
    const app = express();
    app.use(createUploadRouter(uploadTempDir, undefined, async () => ({
      acquired: true,
      release: vi.fn(async () => {}),
    })));
    const zip = new AdmZip();
    zip.addFile("src/index.ts", Buffer.from("valid contents"));

    try {
      const response = await request(app)
        .post("/upload/archive")
        .attach("archive", zip.toBuffer(), "workspace.zip");

      expect(response.status).toBe(201);
      await waitFor(async () => (await readdir(uploadTempDir)).length === 0);
      expect(rmSpy.mock.calls.filter(([path]) =>
        String(path).includes("eos-upload-stage-"),
      )).toHaveLength(2);
      expect(await readdir(uploadTempDir)).toEqual([]);
      expect(logger.warn).toHaveBeenCalledWith(
        expect.objectContaining({
          code: "ARCHIVE_STAGING_CLEANUP_FAILED",
          errorCode: "EACCES",
        }),
        "archive staging cleanup failed; a later cleanup will retry",
      );
    } finally {
      rmSpy.mockRestore();
    }
  });

  it("reports an orphan cleanup failure and retries it before later uploads", async () => {
    const uploadTempDir = await mkdtemp(join(tmpdir(), "upload-orphan-retry-"));
    tempDirs.push(uploadTempDir);
    const orphanName = "eos-upload-stage-123e4567-e89b-42d3-a456-426614174000";
    const orphanPath = join(uploadTempDir, orphanName);
    await mkdir(orphanPath, { mode: 0o700 });
    vi.mocked(logger.warn).mockClear();
    const actualRm = rm;
    let failFirstOrphanCleanup = true;
    const rmSpy = vi.spyOn(fs, "rm").mockImplementation(async (path, options) => {
      if (failFirstOrphanCleanup && String(path) === orphanPath) {
        failFirstOrphanCleanup = false;
        const error = new Error("simulated orphan cleanup failure") as NodeJS.ErrnoException;
        error.code = "EACCES";
        throw error;
      }
      return actualRm(path, options);
    });
    const app = express();
    app.use(createUploadRouter(uploadTempDir, undefined, async () => ({
      acquired: true,
      release: vi.fn(async () => {}),
    })));
    const zip = new AdmZip();
    zip.addFile("src/index.ts", Buffer.from("valid contents"));

    try {
      const firstResponse = await request(app)
        .post("/upload/archive")
        .attach("archive", zip.toBuffer(), "workspace.zip");

      expect(firstResponse.status).toBe(503);
      expect(await readdir(uploadTempDir)).toEqual([orphanName]);
      expect(logger.warn).toHaveBeenCalledWith(
        expect.objectContaining({
          code: "ARCHIVE_STAGING_CLEANUP_FAILED",
          errorCode: "EACCES",
        }),
        "archive staging cleanup failed; a later cleanup will retry",
      );

      rmSpy.mockRestore();
      const retryResponse = await request(app).post("/upload/archive");
      expect(retryResponse.status).toBe(400);
      expect(await readdir(uploadTempDir)).toEqual([]);
    } finally {
      rmSpy.mockRestore();
    }
  });

  it("removes private staging after a malformed ZIP is rejected", async () => {
    const uploadTempDir = await mkdtemp(join(tmpdir(), "upload-malformed-"));
    tempDirs.push(uploadTempDir);
    const app = express();
    const releaseLock = vi.fn(async () => {});
    app.use(createUploadRouter(uploadTempDir, undefined, async () => ({
      acquired: true,
      release: releaseLock,
    })));

    const response = await request(app)
      .post("/upload/archive")
      .attach("archive", Buffer.from("not a ZIP archive"), "broken.zip");

    expect(response.status).toBe(422);
    expect(response.body.error).toMatch(/archive extraction failed/i);
    expect(releaseLock).toHaveBeenCalledOnce();
    expect(await readdir(uploadTempDir)).toEqual([]);
  });

  it("cleans extracted files and releases admission when upload registration fails", async () => {
    vi.mocked(registerUpload).mockClear();
    vi.mocked(removeUpload).mockClear();
    vi.mocked(registerUpload).mockRejectedValueOnce(new Error("simulated store failure"));
    const uploadTempDir = await mkdtemp(join(tmpdir(), "upload-store-failure-"));
    tempDirs.push(uploadTempDir);
    const releaseLock = vi.fn(async () => {});
    const app = express();
    app.use(createUploadRouter(uploadTempDir, undefined, async () => ({
      acquired: true,
      release: releaseLock,
    })));
    const zip = new AdmZip();
    zip.addFile("src/index.ts", Buffer.from("valid contents"));

    const response = await request(app)
      .post("/upload/archive")
      .attach("archive", zip.toBuffer(), "workspace.zip");

    expect(response.status).toBe(422);
    expect(releaseLock).toHaveBeenCalledOnce();
    expect(removeUpload).toHaveBeenCalledOnce();
    expect(await readdir(uploadTempDir)).toEqual([]);
  });

  it("rejects excess archive uploads before writing request data to disk", async () => {
    const uploadTempDir = await mkdtemp(join(tmpdir(), "upload-busy-"));
    tempDirs.push(uploadTempDir);
    const limiter = new ArchiveProcessingLimiter(1);
    const releaseActive = limiter.tryAcquire();
    const app = express();
    app.use(createUploadRouter(uploadTempDir, limiter));

    const response = await request(app)
      .post("/upload/archive")
      .attach("archive", Buffer.from("not written"), "queued.zip");

    expect(response.status).toBe(429);
    expect(response.body.code).toBe("UPLOAD_ARCHIVE_BUSY");
    expect(response.headers["retry-after"]).toBe("1");
    expect(response.headers.connection).toBe("close");
    expect(await readdir(uploadTempDir)).toEqual([]);
    releaseActive?.();
  });

  it("rejects uploads when another API instance owns the shared archive lock", async () => {
    const uploadTempDir = await mkdtemp(join(tmpdir(), "upload-shared-busy-"));
    tempDirs.push(uploadTempDir);
    const app = express();
    app.use(createUploadRouter(uploadTempDir, undefined, async () => ({ acquired: false })));

    const response = await request(app)
      .post("/upload/archive")
      .attach("archive", Buffer.from("not decompressed"), "queued.zip");

    expect(response.status).toBe(429);
    expect(response.body.code).toBe("UPLOAD_ARCHIVE_BUSY");
    expect(response.headers.connection).toBe("close");
    expect(await readdir(uploadTempDir)).toEqual([]);
  });

  it("reserves the shared body slot before Multer across independent database sessions", async () => {
    const uploadTempDir = await mkdtemp(join(tmpdir(), "upload-db-admission-"));
    tempDirs.push(uploadTempDir);
    const app = express();
    app.use(createUploadRouter(uploadTempDir, new ArchiveProcessingLimiter(1)));

    const holder = await tryAdvisoryLock(LockNamespace.ARCHIVE_UPLOAD, "global");
    if (!holder.acquired) throw new Error("Could not reserve the archive slot for the test.");
    try {
      const response = await request(app)
        .post("/upload/archive")
        .attach("archive", Buffer.from("not staged"), "blocked.zip");

      expect(response.status).toBe(429);
      expect(response.body.code).toBe("UPLOAD_ARCHIVE_BUSY");
      expect(response.headers["retry-after"]).toBe("1");
      expect(response.headers.connection).toBe("close");
      expect(await readdir(uploadTempDir)).toEqual([]);
    } finally {
      await holder.release();
    }

    const zip = new AdmZip();
    zip.addFile("src/index.ts", Buffer.from("after release"));
    const response = await request(app)
      .post("/upload/archive")
      .attach("archive", zip.toBuffer(), "available.zip");
    expect(response.status).toBe(201);
  });

  it("releases the slot and clears orphaned staging after its PostgreSQL session disappears", async () => {
    const uploadTempDir = await mkdtemp(join(tmpdir(), "upload-session-recovery-"));
    tempDirs.push(uploadTempDir);
    const staleStagingName = "eos-upload-stage-00000000-0000-4000-8000-000000000001";
    const staleStagingDirectory = join(uploadTempDir, staleStagingName);
    await mkdir(staleStagingDirectory, { mode: 0o700 });
    await writeFile(join(staleStagingDirectory, "partial-upload"), "orphan");

    const client = await pool.connect();
    try {
      const result = await client.query<{ acquired: boolean }>(
        "SELECT pg_try_advisory_lock($1, $2) AS acquired",
        [LockNamespace.ARCHIVE_UPLOAD, advisoryKey("global")],
      );
      expect(result.rows[0]?.acquired).toBe(true);
    } finally {
      client.release(true);
    }

    await waitFor(async () => {
      const lock = await tryAdvisoryLock(LockNamespace.ARCHIVE_UPLOAD, "global");
      if (!lock.acquired) return false;
      await lock.release();
      return true;
    });

    const app = express();
    app.use(createUploadRouter(uploadTempDir, new ArchiveProcessingLimiter(1)));
    const zip = new AdmZip();
    zip.addFile("src/index.ts", Buffer.from("recovered"));
    const response = await request(app)
      .post("/upload/archive")
      .attach("archive", zip.toBuffer(), "recovered.zip");

    expect(response.status).toBe(201);
    expect((await readdir(uploadTempDir)).some((name) => name.startsWith("eos-upload-stage-")))
      .toBe(false);
    await expect(readFile(join(staleStagingDirectory, "partial-upload"))).rejects.toThrow();
  });

  it("releases the reservation and staging file after a client disconnects mid-upload", async () => {
    vi.mocked(removeUpload).mockClear();
    const uploadTempDir = await mkdtemp(join(tmpdir(), "upload-disconnect-"));
    tempDirs.push(uploadTempDir);
    const limiter = new ArchiveProcessingLimiter(1);
    const releaseLock = vi.fn(async () => {});
    const app = express();
    app.use(createUploadRouter(uploadTempDir, limiter, async () => ({
      acquired: true,
      release: releaseLock,
    }), 2000));
    const server = app.listen(0, "127.0.0.1");
    await once(server, "listening");
    const address = server.address() as AddressInfo;
    const boundary = "archive-disconnect-boundary";
    const client = httpRequest({
      hostname: "127.0.0.1",
      port: address.port,
      path: "/upload/archive",
      method: "POST",
      headers: { "content-type": `multipart/form-data; boundary=${boundary}` },
    });
    client.on("error", () => {});

    try {
      client.write(
        `--${boundary}\r\nContent-Disposition: form-data; name="archive"; filename="partial.zip"\r\nContent-Type: application/zip\r\n\r\n`,
      );
      client.write(Buffer.from([0x50, 0x4b, 0x03, 0x04]));
      await waitFor(async () => (await readdir(uploadTempDir)).length > 0);
      client.destroy();

      await waitFor(async () =>
        releaseLock.mock.calls.length === 1 &&
        (await readdir(uploadTempDir)).length === 0,
      );
      const localProbe = limiter.tryAcquire();
      expect(localProbe).toEqual(expect.any(Function));
      localProbe?.();
      expect(removeUpload).not.toHaveBeenCalled();
    } finally {
      client.destroy();
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  });

  it("releases the reservation when an incomplete body reaches its timeout", async () => {
    const uploadTempDir = await mkdtemp(join(tmpdir(), "upload-timeout-"));
    tempDirs.push(uploadTempDir);
    const releaseLock = vi.fn(async () => {});
    const app = express();
    app.use(createUploadRouter(uploadTempDir, new ArchiveProcessingLimiter(1), async () => ({
      acquired: true,
      release: releaseLock,
    }), 100));
    const server = app.listen(0, "127.0.0.1");
    await once(server, "listening");
    const address = server.address() as AddressInfo;
    const boundary = "archive-timeout-boundary";
    const client = httpRequest({
      hostname: "127.0.0.1",
      port: address.port,
      path: "/upload/archive",
      method: "POST",
      headers: { "content-type": `multipart/form-data; boundary=${boundary}` },
    });
    client.on("error", () => {});

    try {
      client.write(
        `--${boundary}\r\nContent-Disposition: form-data; name="archive"; filename="partial.zip"\r\nContent-Type: application/zip\r\n\r\n`,
      );
      client.write(Buffer.from([0x50, 0x4b, 0x03, 0x04]));
      await waitFor(async () =>
        releaseLock.mock.calls.length === 1 &&
        (await readdir(uploadTempDir)).length === 0,
      );
      expect(releaseLock).toHaveBeenCalledOnce();
    } finally {
      client.destroy();
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  });

  it("fails closed and cleans staging when shared admission is unavailable", async () => {
    const uploadTempDir = await mkdtemp(join(tmpdir(), "upload-no-db-"));
    tempDirs.push(uploadTempDir);
    const app = express();
    app.use(createUploadRouter(uploadTempDir, undefined, async () => {
      throw new Error("unexposed database failure");
    }));

    const response = await request(app)
      .post("/upload/archive")
      .attach("archive", Buffer.from("not decompressed"), "queued.zip");

    expect(response.status).toBe(503);
    expect(response.body.code).toBe("UPLOAD_ADMISSION_UNAVAILABLE");
    expect(await readdir(uploadTempDir)).toEqual([]);
  });
});
