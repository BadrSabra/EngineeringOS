import { afterEach, describe, expect, it, vi } from "vitest";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

const faults = vi.hoisted(() => ({
  failFileOpen: false,
  failFileRead: false,
  failChildDirectoryOpen: false,
  failNestedDirectoryRead: false,
  directoryCursorCalls: 0,
}));

vi.mock("../safe-path-open.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../safe-path-open.js")>();
  return {
    ...actual,
    openProjectChildFile: async (
      ...args: Parameters<typeof actual.openProjectChildFile>
    ) => {
      if (faults.failFileOpen) throw new Error("EACCES");
      const handle = await actual.openProjectChildFile(...args);
      if (!faults.failFileRead) return handle;
      return new Proxy(handle, {
        get(target, property) {
          if (property === "read") return async () => { throw new Error("EIO"); };
          const value = Reflect.get(target, property, target);
          return typeof value === "function" ? value.bind(target) : value;
        },
      });
    },
    openProjectChildDirectory: async (
      ...args: Parameters<typeof actual.openProjectChildDirectory>
    ) => {
      if (faults.failChildDirectoryOpen) throw new Error("EACCES");
      return actual.openProjectChildDirectory(...args);
    },
    openProjectDirectoryCursor: async (
      ...args: Parameters<typeof actual.openProjectDirectoryCursor>
    ) => {
      const cursor = await actual.openProjectDirectoryCursor(...args);
      faults.directoryCursorCalls += 1;
      if (!faults.failNestedDirectoryRead || faults.directoryCursorCalls !== 2) {
        return cursor;
      }
      return new Proxy(cursor, {
        get(target, property) {
          if (property === "read") return async () => { throw new Error("EIO"); };
          const value = Reflect.get(target, property, target);
          return typeof value === "function" ? value.bind(target) : value;
        },
      });
    },
  };
});

import { walkProject } from "../file-walker.js";

const roots: string[] = [];

afterEach(async () => {
  faults.failFileOpen = false;
  faults.failFileRead = false;
  faults.failChildDirectoryOpen = false;
  faults.failNestedDirectoryRead = false;
  faults.directoryCursorCalls = 0;
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe("walkProject filesystem failures", () => {
  it("marks an unreadable file as partial instead of silently completing", async () => {
    const root = await mkdtemp(join(tmpdir(), "scanner-file-error-"));
    roots.push(root);
    await writeFile(join(root, "app.ts"), "export const app = true;");
    faults.failFileOpen = true;

    const result = await walkProject(root);

    expect(result.revisionManifest.completeness).toBe("PARTIAL");
    expect(result.revisionManifest.incompleteReasons ?? []).toContain("file_open_failed");
    expect(result.files).toHaveLength(0);
  });

  it("marks an unreadable child directory as partial instead of silently completing", async () => {
    const root = await mkdtemp(join(tmpdir(), "scanner-directory-error-"));
    roots.push(root);
    const nested = join(root, "src");
    await mkdir(nested);
    await writeFile(join(nested, "app.ts"), "export const app = true;");
    faults.failChildDirectoryOpen = true;

    const result = await walkProject(root);

    expect(result.revisionManifest.completeness).toBe("PARTIAL");
    expect(result.revisionManifest.incompleteReasons ?? []).toContain("directory_open_failed");
    expect(result.files).toHaveLength(0);
  });

  it("marks a file read failure as partial and excludes its empty placeholder", async () => {
    const root = await mkdtemp(join(tmpdir(), "scanner-file-read-error-"));
    roots.push(root);
    await writeFile(join(root, "app.ts"), "export const app = true;");
    faults.failFileRead = true;

    const result = await walkProject(root);

    expect(result.revisionManifest.completeness).toBe("PARTIAL");
    expect(result.revisionManifest.incompleteReasons ?? []).toContain("file_read_failed");
    expect(result.files).toHaveLength(0);
  });

  it("marks a nested directory read failure as partial", async () => {
    const root = await mkdtemp(join(tmpdir(), "scanner-directory-read-error-"));
    roots.push(root);
    const nested = join(root, "src");
    await mkdir(nested);
    await writeFile(join(nested, "app.ts"), "export const app = true;");
    faults.failNestedDirectoryRead = true;

    const result = await walkProject(root);

    expect(result.revisionManifest.completeness).toBe("PARTIAL");
    expect(result.revisionManifest.incompleteReasons ?? []).toContain("directory_read_failed");
    expect(result.files).toHaveLength(0);
  });
});
