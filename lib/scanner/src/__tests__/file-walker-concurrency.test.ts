import { afterEach, describe, expect, it, vi } from "vitest";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

const counters = vi.hoisted(() => ({
  activeFileOpens: 0,
  maxFileOpens: 0,
  activeDirectoryReads: 0,
  maxDirectoryReads: 0,
}));

vi.mock("../safe-path-open.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../safe-path-open.js")>();
  return {
    ...actual,
    openProjectChildFile: async (...args: Parameters<typeof actual.openProjectChildFile>) => {
      counters.activeFileOpens += 1;
      counters.maxFileOpens = Math.max(counters.maxFileOpens, counters.activeFileOpens);
      try {
        await new Promise((resolve) => setTimeout(resolve, 3));
        return await actual.openProjectChildFile(...args);
      } finally {
        counters.activeFileOpens -= 1;
      }
    },
    openProjectDirectoryCursor: async (
      ...args: Parameters<typeof actual.openProjectDirectoryCursor>
    ) => {
      const cursor = await actual.openProjectDirectoryCursor(...args);
      return {
        ...cursor,
        read: async () => {
          counters.activeDirectoryReads += 1;
          counters.maxDirectoryReads = Math.max(
            counters.maxDirectoryReads,
            counters.activeDirectoryReads,
          );
          try {
            await new Promise((resolve) => setTimeout(resolve, 1));
            return await cursor.read();
          } finally {
            counters.activeDirectoryReads -= 1;
          }
        },
        close: () => cursor.close(),
      } as typeof cursor;
    },
  };
});

import { MAX_CONCURRENT_FILE_READS, walkProject } from "../file-walker.js";

const roots: string[] = [];

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
  counters.activeFileOpens = 0;
  counters.maxFileOpens = 0;
  counters.activeDirectoryReads = 0;
  counters.maxDirectoryReads = 0;
});

describe("walkProject filesystem concurrency", () => {
  it("keeps file opens within the fixed cap and directory reads sequential", async () => {
    const root = await mkdtemp(join(tmpdir(), "scanner-concurrency-"));
    roots.push(root);
    const nested = join(root, "src");
    await mkdir(nested);
    await Promise.all(
      Array.from({ length: 64 }, (_, index) =>
        writeFile(join(nested, `file-${index}.ts`), "export const value = 1;"),
      ),
    );

    const result = await walkProject(root);
    expect(result.files).toHaveLength(64);
    expect(counters.maxFileOpens).toBeGreaterThan(1);
    expect(counters.maxFileOpens).toBeLessThanOrEqual(MAX_CONCURRENT_FILE_READS);
    expect(counters.maxDirectoryReads).toBe(1);
  });
});
