import express from "express";
import request from "supertest";
import { afterEach, describe, expect, it, vi } from "vitest";
import { mkdtemp, readFile, readdir, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import AdmZip from "adm-zip";
import { ArchiveProcessingLimiter } from "../lib/archive-safety.js";

vi.mock("../middlewares/requireAuth.js", () => ({
  requireAuth: (req: { userId?: string }, _res: unknown, next: (error?: unknown) => void) => {
    req.userId = "test-user";
    next();
  },
}));
vi.mock("../lib/upload-store.js", () => ({
  registerUpload: vi.fn(async () => {}),
}));
vi.mock("../lib/logger.js", () => ({
  logger: { info: vi.fn(), error: vi.fn() },
}));

import { createUploadRouter } from "./upload.js";
import { registerUpload } from "../lib/upload-store.js";

const tempDirs: string[] = [];

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

describe("archive upload temporary files", () => {
  it("removes an unsupported archive after returning 400", async () => {
    const uploadTempDir = await mkdtemp(join(tmpdir(), "upload-rejected-"));
    tempDirs.push(uploadTempDir);
    const app = express();
    app.use(createUploadRouter(uploadTempDir));

    const response = await request(app)
      .post("/upload/archive")
      .attach("archive", Buffer.from("not an archive"), "unsupported.rar");

    expect(response.status).toBe(400);
    expect(response.body.error).toMatch(/unsupported archive format/i);
    expect(await readdir(uploadTempDir)).toEqual([]);
  });

  it("keeps a successful extraction private and available to the upload store", async () => {
    const uploadTempDir = await mkdtemp(join(tmpdir(), "upload-valid-"));
    tempDirs.push(uploadTempDir);
    const zip = new AdmZip();
    zip.addFile("src/index.ts", Buffer.from("export const safe = true;\n"));
    const app = express();
    app.use(createUploadRouter(uploadTempDir));

    const response = await request(app)
      .post("/upload/archive")
      .attach("archive", zip.toBuffer(), "workspace.zip");

    expect(response.status).toBe(201);
    expect(response.body.uploadId).toEqual(expect.any(String));
    expect(vi.mocked(registerUpload)).toHaveBeenCalledOnce();
    const [, extractionPath, originalName, ownerId] = vi.mocked(registerUpload).mock.calls[0];
    expect(originalName).toBe("workspace.zip");
    expect(ownerId).toBe("test-user");
    const extractionStat = await stat(extractionPath);
    expect(extractionStat.mode & 0o077).toBe(0);
    await expect(readFile(join(extractionPath, "src/index.ts"), "utf8"))
      .resolves.toContain("safe = true");
    expect(await readdir(uploadTempDir)).toEqual([extractionPath.split("/").at(-1)]);
  });

  it("removes private staging after a malformed ZIP is rejected", async () => {
    const uploadTempDir = await mkdtemp(join(tmpdir(), "upload-malformed-"));
    tempDirs.push(uploadTempDir);
    const app = express();
    app.use(createUploadRouter(uploadTempDir));

    const response = await request(app)
      .post("/upload/archive")
      .attach("archive", Buffer.from("not a ZIP archive"), "broken.zip");

    expect(response.status).toBe(422);
    expect(response.body.error).toMatch(/archive extraction failed/i);
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
    expect(await readdir(uploadTempDir)).toEqual([]);
    releaseActive?.();
  });
});
