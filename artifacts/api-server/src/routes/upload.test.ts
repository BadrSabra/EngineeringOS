import express from "express";
import request from "supertest";
import { afterEach, describe, expect, it, vi } from "vitest";
import { mkdtemp, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

vi.mock("../middlewares/requireAuth.js", () => ({
  requireAuth: (_req: unknown, _res: unknown, next: (error?: unknown) => void) => next(),
}));

import { createUploadRouter } from "./upload.js";

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
});
