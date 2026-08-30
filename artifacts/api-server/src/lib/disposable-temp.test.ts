import { promises as fs } from "node:fs";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  createHostDisposableTempDirectory,
  HOST_DISPOSABLE_TEMP_ROOT,
} from "./disposable-temp.js";

describe("host disposable temp directories", () => {
  const created: string[] = [];

  afterEach(async () => {
    await Promise.all(created.splice(0).map((directory) =>
      fs.rm(directory, { recursive: true, force: true }),
    ));
  });

  it("ignores a redirected TMPDIR", async () => {
    const previousTmpDir = process.env.TMPDIR;
    process.env.TMPDIR = path.join(process.cwd(), ".engineeringos-delivery", "hostile-tmp");
    try {
      const directory = await createHostDisposableTempDirectory("benchmark-sandbox-");
      created.push(directory);
      expect(path.dirname(directory)).toBe(HOST_DISPOSABLE_TEMP_ROOT);
      expect(directory).not.toContain(".engineeringos-delivery");
    } finally {
      if (previousTmpDir === undefined) delete process.env.TMPDIR;
      else process.env.TMPDIR = previousTmpDir;
    }
  });
});