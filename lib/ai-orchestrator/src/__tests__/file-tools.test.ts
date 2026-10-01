/** Tests for bounded, grep-compatible source search. */
import { describe, it, expect, vi } from "vitest";
import { promises as fs } from "node:fs";
import path from "node:path";
import { EventEmitter } from "node:events";
import type { ChildProcess } from "node:child_process";
import { PassThrough } from "node:stream";

vi.mock("node:child_process", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:child_process")>();
  return { ...actual, spawn: vi.fn(actual.spawn) };
});

import { spawn } from "node:child_process";
import { executeFileTool, FILE_TOOL_DEFINITIONS, isSensitiveProjectPath, stripReadFileWrapper } from "../tools/file-tools.js";
import { buildPatchHunks, hashPatchBase } from "../patch-contract.js";

const mockSpawn = vi.mocked(spawn);
const realSpawnImplementation = mockSpawn.getMockImplementation()!;

async function createSearchProject(): Promise<{
  root: string;
  cleanup: () => Promise<void>;
}> {
  const root = await fs.mkdtemp(path.join("/tmp", "file-tools-search-"));
  return {
    root,
    cleanup: () => fs.rm(root, { recursive: true, force: true }),
  };
}

describe("executeFileTool — search_code error handling", () => {
  it("marks search incomplete after scanning 5,000 entries", async () => {
    const { root, cleanup } = await createSearchProject();
    let yieldedEntries = 0;
    const fakeDirectory = {
      async *[Symbol.asyncIterator]() {
        for (let index = 0; index < 5_001; index += 1) {
          yieldedEntries += 1;
          yield {
            name: `link-${String(index).padStart(4, "0")}`,
            isDirectory: () => false,
            isFile: () => false,
            isSymbolicLink: () => true,
          };
        }
      },
      close: vi.fn(async () => undefined),
    };
    const originalOpendir = fs.opendir.bind(fs);
    const opendirSpy = vi.spyOn(fs, "opendir").mockImplementation(async (requestedPath, options) => {
      if (path.resolve(String(requestedPath)) === root) {
        return fakeDirectory as unknown as Awaited<ReturnType<typeof fs.opendir>>;
      }
      return originalOpendir(requestedPath, options);
    });
    mockSpawn.mockClear();

    try {
      const result = await executeFileTool("search_code", { pattern: "match" }, root, []);
      expect(yieldedEntries).toBe(5_001);
      expect(fakeDirectory.close).toHaveBeenCalledTimes(1);
      expect(mockSpawn).not.toHaveBeenCalled();
      expect(result).toContain("No matches found within the bounded search window.");
      expect(result).toContain("search incomplete");
    } finally {
      opendirSpy.mockRestore();
      mockSpawn.mockClear();
      await cleanup();
    }
  });

  it("marks search incomplete at the 16,000,000-byte total read budget", async () => {
    const { root, cleanup } = await createSearchProject();
    const fileBytes = 512_000;
    const sentinel = Buffer.from("TOTAL_BYTES_SENTINEL\n");
    mockSpawn.mockClear();

    try {
      await Promise.all(Array.from({ length: 32 }, (_, index) => {
        const contents = Buffer.alloc(fileBytes, 0x78);
        if (index === 0) sentinel.copy(contents);
        return fs.writeFile(
          path.join(root, `${String(index).padStart(3, "0")}.txt`),
          contents,
        );
      }));

      const result = await executeFileTool(
        "search_code",
        { pattern: "TOTAL_BYTES_SENTINEL" },
        root,
        [],
      );

      expect(mockSpawn).toHaveBeenCalledTimes(32);
      expect(result).toContain("000.txt:1:TOTAL_BYTES_SENTINEL");
      expect(result).toContain("search incomplete");
      expect(Buffer.byteLength(result, "utf8")).toBeLessThanOrEqual(24_000);
    } finally {
      mockSpawn.mockClear();
      await cleanup();
    }
  });

  it("returns 'No matches found.' for a complete search with no match", async () => {
    const { root, cleanup } = await createSearchProject();
    try {
      await fs.writeFile(path.join(root, "source.ts"), "const value = 1;\n");
      const result = await executeFileTool("search_code", { pattern: "missing" }, root, []);
      expect(result).toBe("No matches found.");
    } finally {
      await cleanup();
    }
  });

  it("returns matching lines with project-relative paths and line numbers", async () => {
    const { root, cleanup } = await createSearchProject();
    try {
      await fs.mkdir(path.join(root, "src"));
      await fs.writeFile(path.join(root, "src", "foo.ts"), "const value = 1;\nconst foo = 2;\n");
      const result = await executeFileTool("search_code", { pattern: "foo" }, root, []);
      expect(result).toBe("src/foo.ts:2:const foo = 2;");
    } finally {
      await cleanup();
    }
  });

  it("applies a file glob before selecting bounded search files", async () => {
    const { root, cleanup } = await createSearchProject();
    try {
      await fs.writeFile(path.join(root, "included.ts"), "match here\n");
      await fs.writeFile(path.join(root, "excluded.md"), "match here\n");
      const result = await executeFileTool(
        "search_code",
        { pattern: "match", file_glob: "*.ts" },
        root,
        [],
      );
      expect(result).toContain("included.ts:1:match here");
      expect(result).not.toContain("excluded.md");
    } finally {
      await cleanup();
    }
  });

  it("never searches sensitive files or directories", async () => {
    const { root, cleanup } = await createSearchProject();
    try {
      await fs.mkdir(path.join(root, "secrets"));
      await fs.writeFile(path.join(root, ".env"), "token=hidden-env\n");
      await fs.writeFile(path.join(root, "secrets", "config.ts"), "token=hidden-secret\n");
      await fs.writeFile(path.join(root, "source.ts"), "token=visible\n");
      const result = await executeFileTool("search_code", { pattern: "token" }, root, []);
      expect(result).toContain("source.ts:1:token=visible");
      expect(result).not.toContain(".env");
      expect(result).not.toContain("secrets/");
      expect(result).not.toContain("hidden");
    } finally {
      await cleanup();
    }
  });

  it("marks results incomplete when the bounded candidate-file count is reached", async () => {
    const { root, cleanup } = await createSearchProject();
    try {
      await Promise.all(Array.from({ length: 101 }, (_, index) =>
        fs.writeFile(
          path.join(root, `${String(index).padStart(3, "0")}.bin`),
          Buffer.from([0]),
        ),
      ));
      const result = await executeFileTool("search_code", { pattern: "match" }, root, []);
      expect(result).toContain("No matches found within the bounded search window.");
      expect(result).toContain("search incomplete");
    } finally {
      await cleanup();
    }
  });

  it("keeps the rendered search response within its byte cap", async () => {
    const { root, cleanup } = await createSearchProject();
    try {
      const longMatch = `match ${"x".repeat(5_000)}\n`;
      await fs.writeFile(path.join(root, "long-lines.txt"), longMatch.repeat(6));
      const result = await executeFileTool("search_code", { pattern: "match" }, root, []);
      expect(result).toContain("search incomplete");
      expect(result).toContain("long-lines.txt:1:match");
      expect(Buffer.byteLength(result, "utf8")).toBeLessThanOrEqual(24_000);
    } finally {
      await cleanup();
    }
  });

  it("terminates the active grep process when search is cancelled", async () => {
    const { root, cleanup } = await createSearchProject();
    const controller = new AbortController();
    const fakeChild = new EventEmitter() as unknown as ChildProcess;
    const stdin = new PassThrough();
    const stdout = new PassThrough();
    Object.assign(fakeChild, { stdin, stdout, killed: false });
    const kill = vi.fn(() => {
      Object.defineProperty(fakeChild, "killed", {
        value: true,
        configurable: true,
      });
      setImmediate(() => fakeChild.emit("close", null, "SIGTERM"));
      return true;
    });
    Object.assign(fakeChild, { kill });
    try {
      await fs.writeFile(path.join(root, "source.ts"), "match\n");
      mockSpawn.mockImplementationOnce(() => {
        controller.abort();
        return fakeChild as ReturnType<typeof spawn>;
      });
      await expect(
        executeFileTool("search_code", { pattern: "match" }, root, [], controller.signal),
      ).rejects.toThrow(/cancelled/i);
      expect(mockSpawn).toHaveBeenCalled();
      expect(kill).toHaveBeenCalledWith("SIGTERM");
    } finally {
      mockSpawn.mockReset();
      mockSpawn.mockImplementation(realSpawnImplementation);
      await cleanup();
    }
  });

  it("terminates the active grep process when the search runtime expires", async () => {
    const { root, cleanup } = await createSearchProject();
    const fakeChild = new EventEmitter() as unknown as ChildProcess;
    const stdin = new PassThrough();
    const stdout = new PassThrough();
    Object.assign(fakeChild, { stdin, stdout, killed: false });
    const kill = vi.fn(() => {
      Object.defineProperty(fakeChild, "killed", {
        value: true,
        configurable: true,
      });
      setImmediate(() => fakeChild.emit("close", null, "SIGTERM"));
      return true;
    });
    Object.assign(fakeChild, { kill });
    const initialTime = 1_000_000;
    const now = vi.spyOn(Date, "now")
      .mockImplementationOnce(() => initialTime)
      .mockReturnValue(initialTime + 9_990);

    try {
      await fs.writeFile(path.join(root, "source.ts"), "match\n");
      mockSpawn.mockImplementationOnce(() => fakeChild as ReturnType<typeof spawn>);

      const result = await executeFileTool("search_code", { pattern: "match" }, root, []);

      expect(result).toContain("search incomplete");
      expect(mockSpawn).toHaveBeenCalled();
      expect(kill).toHaveBeenCalledWith("SIGTERM");
    } finally {
      now.mockRestore();
      mockSpawn.mockReset();
      mockSpawn.mockImplementation(realSpawnImplementation);
      await cleanup();
    }
  });

  it("marks a search incomplete when a source file exceeds its byte window", async () => {
    const { root, cleanup } = await createSearchProject();
    try {
      await fs.writeFile(
        path.join(root, "large.ts"),
        `const match = true;\n${"x".repeat(520_000)}\n`,
      );
      const result = await executeFileTool("search_code", { pattern: "match" }, root, []);
      expect(result).toContain("large.ts:1:const match = true;");
      expect(result).toContain("search incomplete");
    } finally {
      await cleanup();
    }
  });

  it("returns a safe search failure for an invalid grep-compatible expression", async () => {
    const { root, cleanup } = await createSearchProject();
    try {
      await fs.writeFile(path.join(root, "source.ts"), "source\n");
      const result = await executeFileTool("search_code", { pattern: "[" }, root, []);
      expect(result).toMatch(/search failed/i);
    } finally {
      await cleanup();
    }
  });
});

describe("executeFileTool — bounded source reads", () => {
  it("blocks sensitive project files from direct and ranged reads", async () => {
    expect(isSensitiveProjectPath(".env")).toBe(true);
    expect(isSensitiveProjectPath("config/service-account.json")).toBe(true);

    const direct = await executeFileTool("read_file", { path: ".env" }, "/tmp", []);
    const ranged = await executeFileTool(
      "read_file_range",
      { path: "keys/server.pem", startLine: "1", endLine: "2" },
      "/tmp",
      [],
    );

    expect(direct).toMatch(/not allowed|sensitive/i);
    expect(ranged).toMatch(/not allowed|sensitive/i);
  });

  it("does not expose sensitive entries through directory listing", async () => {
    const directory = path.join("/tmp", `sensitive-list-${Date.now()}`);
    await fs.mkdir(directory);
    await fs.writeFile(path.join(directory, ".env"), "TOKEN=hidden\n", "utf-8");
    await fs.writeFile(path.join(directory, "safe.ts"), "export const safe = true;\n", "utf-8");

    try {
      const result = await executeFileTool("list_directory", { path: path.basename(directory) }, "/tmp", []);
      expect(result).toContain("safe.ts");
      expect(result).not.toContain(".env");
    } finally {
      await fs.rm(directory, { recursive: true, force: true });
    }
  });

  it("reports a missing file without exposing the absolute runtime path", async () => {
    const result = await executeFileTool(
      "read_file",
      { path: "src/missing.ts" },
      "/tmp",
      [],
    );
    expect(result).toContain("does not exist");
    expect(result).toContain("Check the project-relative path and retry.");
    expect(result).not.toContain("/tmp");
    expect(result).not.toContain("ENOENT");
  });

  it("marks large reads as a display limit, not incomplete source", async () => {
    const filePath = path.join("/tmp", `bounded-read-${Date.now()}.ts`);
    await fs.writeFile(filePath, `export const start = true;\n${"x".repeat(128_100)}`, "utf-8");

    try {
      const result = await executeFileTool("read_file", { path: path.basename(filePath) }, "/tmp", []);
      expect(result).toContain("output truncated at 128 KB by the read tool");
      expect(result).toContain("not evidence that the file is incomplete or corrupted");
      expect(result).not.toContain("truncated at 80 KB");
    } finally {
      await fs.rm(filePath, { force: true });
    }
  });

  it("reads only the configured prefix plus one byte to detect truncation", async () => {
    const filePath = path.join("/tmp", `bounded-read-budget-${Date.now()}.ts`);
    await fs.writeFile(filePath, "x", "utf-8");
    const virtualFileBytes = 2_000_000;
    let bytesReturned = 0;
    const read = vi.fn(async (
      buffer: Buffer,
      offset: number,
      length: number,
      position: number,
    ) => {
      const bytesRead = Math.min(length, virtualFileBytes - position);
      buffer.fill(0x78, offset, offset + bytesRead);
      bytesReturned += bytesRead;
      return { bytesRead, buffer };
    });
    const fakeHandle = { read, close: vi.fn(async () => undefined) };
    const originalOpen = fs.open.bind(fs);
    const openSpy = vi.spyOn(fs, "open").mockImplementation(async (
      requestedPath: any,
      ...options: any[]
    ) => {
      if (path.resolve(String(requestedPath)) === filePath) return fakeHandle as any;
      return originalOpen(requestedPath, ...options);
    });

    try {
      const result = await executeFileTool(
        "read_file",
        { path: path.basename(filePath) },
        "/tmp",
        [],
      );
      expect(result).toContain("output truncated at 128 KB by the read tool");
      expect(bytesReturned).toBe(128_001);
      expect(bytesReturned).toBeLessThan(virtualFileBytes);
    } finally {
      openSpy.mockRestore();
      await fs.rm(filePath, { force: true });
    }
  });

  it("supports a complete forensic read without the normal 128 KB marker", async () => {
    const filePath = path.join("/tmp", `complete-read-${Date.now()}.ts`);
    const tail = "export const completeTail = true;\n";
    await fs.writeFile(filePath, `export const start = true;\n${"x".repeat(16_100)}${tail}`, "utf-8");

    try {
      const result = await executeFileTool(
        "read_file",
        { path: path.basename(filePath), complete: "true" },
        "/tmp",
        [],
      );
      expect(result).toContain(tail);
      expect(result).not.toContain("output truncated at 128 KB by the read tool");
      expect(result).not.toContain("forensic read exceeded the maximum safe evidence window");
    } finally {
      await fs.rm(filePath, { force: true });
    }
  });

  it("preserves complete forensic reads when list_directory is mistakenly given a file", async () => {
    const filePath = path.join("/tmp", `complete-list-file-${Date.now()}.ts`);
    const tail = "export const completeListTail = true;\n";
    await fs.writeFile(filePath, `export const start = true;\n${"x".repeat(128_100)}${tail}`, "utf-8");

    try {
      const result = await executeFileTool(
        "list_directory",
        { path: path.basename(filePath), complete: "true" },
        "/tmp",
        [],
      );
      expect(result).toContain(tail);
      expect(result).not.toContain("output truncated at 128 KB by the read tool");
      expect(result).not.toContain("forensic read exceeded the maximum safe evidence window");
    } finally {
      await fs.rm(filePath, { force: true });
    }
  });

  it("bounds directory enumeration and serialized listing output", async () => {
    const directoryPath = path.join("/tmp", `bounded-directory-${Date.now()}`);
    await fs.mkdir(directoryPath);
    let yieldedEntries = 0;
    const fakeDirectory = {
      async *[Symbol.asyncIterator]() {
        for (let index = 0; index < 5_000; index += 1) {
          yieldedEntries += 1;
          yield {
            name: `entry-${String(index).padStart(4, "0")}.ts`,
            isDirectory: () => false,
            isFile: () => true,
            isSymbolicLink: () => false,
          };
        }
      },
      close: vi.fn(async () => undefined),
    };
    const originalOpendir = fs.opendir.bind(fs);
    const opendirSpy = vi.spyOn(fs, "opendir").mockImplementation(async (
      requestedPath: any,
      ...options: any[]
    ) => {
      if (path.resolve(String(requestedPath)) === directoryPath) return fakeDirectory as any;
      return originalOpendir(requestedPath, ...options);
    });

    try {
      const result = await executeFileTool(
        "list_directory",
        { path: path.basename(directoryPath) },
        "/tmp",
        [],
      );
      expect(result).toContain("directory listing truncated");
      expect(yieldedEntries).toBe(1_001);
      expect((result.match(/^\[file\]/gm) ?? [])).toHaveLength(100);
      expect(Buffer.byteLength(result, "utf-8")).toBeLessThan(24_000);
      expect(fakeDirectory.close).toHaveBeenCalledTimes(1);
    } finally {
      opendirSpy.mockRestore();
      await fs.rm(directoryPath, { recursive: true, force: true });
    }
  });

  it("describes read_file as a bounded preview in the tool contract", () => {
    const readTool = FILE_TOOL_DEFINITIONS.find((tool) => tool.function.name === "read_file");
    expect(readTool?.function.description).toContain("first 128 KB");
    expect(readTool?.function.description).toContain("not proof that the file is incomplete");
  });

  it("describes an optional scoped path for search_code", () => {
    const searchTool = FILE_TOOL_DEFINITIONS.find((tool) => tool.function.name === "search_code");
    expect(searchTool?.function.parameters).toMatchObject({
      properties: {
        path: expect.any(Object),
      },
    });
  });

  it("lists only bounded metadata from the fixed project root without following symlinks", async () => {
    const root = path.join("/tmp", `mission-tree-${process.pid}-${Date.now()}`);
    const outside = `${root}-outside`;
    const rootLink = `${root}-link`;
    await fs.mkdir(path.join(root, "src", "nested"), { recursive: true });
    await fs.mkdir(path.join(root, "node_modules", "pkg"), { recursive: true });
    await fs.mkdir(path.join(root, "secrets"), { recursive: true });
    await fs.mkdir(outside, { recursive: true });
    await fs.writeFile(path.join(root, "README.md"), "PRIVATE_SOURCE_BYTES", "utf-8");
    await fs.writeFile(path.join(root, ".env"), "TOKEN=hidden", "utf-8");
    await fs.writeFile(path.join(root, "secrets", "notes.txt"), "SECRET_CONTENT", "utf-8");
    await fs.writeFile(path.join(root, "node_modules", "pkg", "generated.js"), "GENERATED_CONTENT", "utf-8");
    await fs.writeFile(path.join(root, "src", "index.ts"), "SOURCE_CONTENT", "utf-8");
    await fs.writeFile(path.join(root, "src", "nested", "too-deep.ts"), "TOO_DEEP", "utf-8");
    await fs.writeFile(path.join(outside, "outside.ts"), "OUTSIDE_CONTENT", "utf-8");
    await fs.symlink(outside, path.join(root, "linked"), "dir");
    await fs.symlink(root, rootLink, "dir");

    try {
      const result = await executeFileTool("project.list_tree", {}, root, []);
      const tree = JSON.parse(result) as {
        kind: string;
        root: string;
        maxDepth: number;
        maxEntries: number;
        truncated: boolean;
        entries: Array<{ path: string; kind: string; sizeBytes?: number }>;
      };
      const paths = tree.entries.map((entry) => entry.path);

      expect(tree).toMatchObject({
        kind: "project_tree",
        root: ".",
        maxDepth: 2,
        maxEntries: 100,
      });
      expect(paths).toEqual(expect.arrayContaining(["README.md", "src", "src/index.ts", "src/nested"]));
      expect(paths).not.toEqual(expect.arrayContaining([
        ".env",
        "secrets",
        "secrets/notes.txt",
        "node_modules",
        "node_modules/pkg",
        "node_modules/pkg/generated.js",
        "src/nested/too-deep.ts",
        "linked",
      ]));
      expect(result).not.toContain("PRIVATE_SOURCE_BYTES");
      expect(result).not.toContain("SOURCE_CONTENT");
      expect(result).not.toContain("OUTSIDE_CONTENT");
      expect(Buffer.byteLength(result, "utf8")).toBeLessThanOrEqual(24_000);
      expect(tree.entries.find((entry) => entry.path === "README.md")).toMatchObject({
        kind: "file",
        sizeBytes: Buffer.byteLength("PRIVATE_SOURCE_BYTES", "utf8"),
      });

      await expect(
        executeFileTool("project.list_tree", { path: "." }, root, []),
      ).rejects.toThrow("project_tree_arguments_not_allowed");
      await expect(
        executeFileTool("project.list_tree", {}, rootLink, []),
      ).rejects.toThrow("project_tree_root_not_directory");
    } finally {
      await fs.rm(root, { recursive: true, force: true });
      await fs.rm(outside, { recursive: true, force: true });
      await fs.rm(rootLink, { force: true });
    }
  });

  it("caps project tree entries and marks the result as truncated", async () => {
    const root = path.join("/tmp", `mission-tree-limit-${process.pid}-${Date.now()}`);
    await fs.mkdir(root, { recursive: true });
    try {
      await Promise.all(
        Array.from({ length: 125 }, (_, index) =>
          fs.writeFile(path.join(root, `entry-${String(index).padStart(3, "0")}.txt`), "x", "utf-8"),
        ),
      );
      const result = await executeFileTool("project.list_tree", {}, root, []);
      const tree = JSON.parse(result) as { truncated: boolean; entries: unknown[] };
      expect(tree.entries).toHaveLength(100);
      expect(tree.truncated).toBe(true);
    } finally {
      await fs.rm(root, { recursive: true, force: true });
    }
  });

  it("fails closed when a directory exceeds the per-directory scan budget", async () => {
    const root = path.join("/tmp", `mission-tree-directory-scan-${process.pid}-${Date.now()}`);
    await fs.mkdir(root, { recursive: true });
    try {
      await Promise.all(
        Array.from({ length: 1_001 }, (_, index) =>
          fs.writeFile(path.join(root, `entry-${String(index).padStart(4, "0")}.txt`), "x", "utf-8"),
        ),
      );

      await expect(executeFileTool("project.list_tree", {}, root, []))
        .rejects.toThrow("project_tree_scan_limit_exceeded");
    } finally {
      await fs.rm(root, { recursive: true, force: true });
    }
  });

  it("enforces the global scan budget even when scanned symlinks are excluded", async () => {
    const root = path.join("/tmp", `mission-tree-scan-${process.pid}-${Date.now()}`);
    const directoryCount = 6;
    const linksPerDirectory = 850;
    await Promise.all(
      Array.from({ length: directoryCount }, (_, directoryIndex) =>
        fs.mkdir(path.join(root, `dir-${directoryIndex}`), { recursive: true }),
      ),
    );
    try {
      await Promise.all(
        Array.from({ length: directoryCount }, (_, directoryIndex) => {
          const directory = path.join(root, `dir-${directoryIndex}`);
          return Promise.all(
            Array.from({ length: linksPerDirectory }, (_, linkIndex) =>
              fs.symlink(root, path.join(directory, `link-${linkIndex}`), "dir"),
            ),
          );
        }),
      );

      await expect(executeFileTool("project.list_tree", {}, root, []))
        .rejects.toThrow("project_tree_scan_limit_exceeded");
    } finally {
      await fs.rm(root, { recursive: true, force: true });
    }
  });

  it("truncates oversized metadata output below the byte budget", async () => {
    const root = path.join("/tmp", `mission-tree-output-${process.pid}-${Date.now()}`);
    await fs.mkdir(root, { recursive: true });
    try {
      await Promise.all(
        Array.from({ length: 100 }, (_, index) =>
          fs.writeFile(
            path.join(root, `file-${String(index).padStart(3, "0")}-${"x".repeat(225)}.txt`),
            "x",
            "utf-8",
          ),
        ),
      );

      const result = await executeFileTool("project.list_tree", {}, root, []);
      const tree = JSON.parse(result) as { truncated: boolean; entries: unknown[] };
      expect(Buffer.byteLength(result, "utf8")).toBeLessThanOrEqual(24_000);
      expect(tree.truncated).toBe(true);
      expect(tree.entries.length).toBeGreaterThan(0);
      expect(tree.entries.length).toBeLessThan(100);
    } finally {
      await fs.rm(root, { recursive: true, force: true });
    }
  });
});

describe("executeFileTool — read_file_range (SR-003)", () => {
  it("stops scanning when a late range exceeds the source-byte budget", async () => {
    const filePath = path.join("/tmp", `range-scan-budget-${Date.now()}.ts`);
    await fs.writeFile(filePath, "x", "utf-8");
    const virtualFileBytes = 2_000_000;
    let bytesReturned = 0;
    const read = vi.fn(async (
      buffer: Buffer,
      offset: number,
      length: number,
      position: number,
    ) => {
      const bytesRead = Math.min(length, virtualFileBytes - position);
      buffer.fill(0x78, offset, offset + bytesRead);
      bytesReturned += bytesRead;
      return { bytesRead, buffer };
    });
    const fakeHandle = { read, close: vi.fn(async () => undefined) };
    const originalOpen = fs.open.bind(fs);
    const openSpy = vi.spyOn(fs, "open").mockImplementation(async (
      requestedPath: any,
      ...options: any[]
    ) => {
      if (path.resolve(String(requestedPath)) === filePath) return fakeHandle as any;
      return originalOpen(requestedPath, ...options);
    });

    try {
      const result = await executeFileTool(
        "read_file_range",
        { path: path.basename(filePath), startLine: "2", endLine: "2" },
        "/tmp",
        [],
      );
      expect(result).toContain("512000-byte scan budget");
      expect(bytesReturned).toBe(512_001);
      expect(bytesReturned).toBeLessThan(virtualFileBytes);
    } finally {
      openSpy.mockRestore();
      await fs.rm(filePath, { force: true });
    }
  });

  it("returns only the requested 1-based inclusive window", async () => {
    const filePath = path.join("/tmp", `range-read-${Date.now()}.ts`);
    const lines = [1, 2, 3, 4, 5].map((n) => `line${n}();`);
    await fs.writeFile(filePath, lines.join("\n"), "utf-8");

    try {
      const result = await executeFileTool(
        "read_file_range",
        { path: path.basename(filePath), startLine: "2", endLine: "4" },
        "/tmp",
        [],
      );
      // 2-line wrapper header + the 3 requested lines + closing fence.
      expect(result).toContain("line2();");
      expect(result).toContain("line3();");
      expect(result).toContain("line4();");
      expect(result).not.toContain("line1();");
      expect(result).not.toContain("line5();");
    } finally {
      await fs.rm(filePath, { force: true });
    }
  });

  it("clamps an out-of-range end to the last line of the file", async () => {
    const filePath = path.join("/tmp", `range-clamp-${Date.now()}.ts`);
    await fs.writeFile(filePath, "a();\nb();\nc();\n", "utf-8");
    try {
      const result = await executeFileTool(
        "read_file_range",
        { path: path.basename(filePath), startLine: "2", endLine: "999" },
        "/tmp",
        [],
      );
      expect(result).toContain("b();");
      expect(result).toContain("c();");
    } finally {
      await fs.rm(filePath, { force: true });
    }
  });

  it("rejects an invalid range up front", async () => {
    const filePath = path.join("/tmp", `range-invalid-${Date.now()}.ts`);
    await fs.writeFile(filePath, "a();\n", "utf-8");
    try {
      const result = await executeFileTool(
        "read_file_range",
        { path: path.basename(filePath), startLine: "4", endLine: "2" },
        "/tmp",
        [],
      );
      expect(result).toContain("startLine");
    } finally {
      await fs.rm(filePath, { force: true });
    }
  });

  it("rejects a window larger than the targeted read limit", async () => {
    const filePath = path.join("/tmp", `range-cap-${Date.now()}.ts`);
    await fs.writeFile(filePath, Array.from({ length: 4001 }, (_, i) => `const v${i} = 1;`).join("\n"), "utf-8");
    try {
      const result = await executeFileTool(
        "read_file_range",
        { path: path.basename(filePath), startLine: "1", endLine: "4001" },
        "/tmp",
        [],
      );
      expect(result).toMatch(/Narrow the range|targeted read window/i);
    } finally {
      await fs.rm(filePath, { force: true });
    }
  });

  it("is exposed in the tool contract for the model to discover", () => {
    const tool = FILE_TOOL_DEFINITIONS.find((t) => t.function.name === "read_file_range");
    expect(tool?.function.name).toBe("read_file_range");
    expect(tool?.function.description).toMatch(/targeted|window|startLine/i);
  });

  /**
   * EI-018 EOF-clamp regression: when anchor + 50 exceeds the file's last line
   * the tool returns fewer lines than requested. The recovery code must derive
   * the effective endLine from the returned content — not from the requested
   * endLine — or the ledger will claim lines that were never read.
   */
  it("EI-018 fix: effectiveEndLine is derived from actual returned line count, not requested endLine", async () => {
    const filePath = path.join("/tmp", `eof-clamp-${Date.now()}.ts`);
    // 7-line file: symbol on line 5, only 2 lines follow it.
    const lines = [
      "const a = 1;",       // 1
      "const b = 2;",       // 2
      "const c = 3;",       // 3
      "const d = 4;",       // 4
      "function eofSymbol() { return 42; }",  // 5 — the symbol
      "const e = 5;",       // 6
      "const f = 6;",       // 7
    ];
    await fs.writeFile(filePath, lines.join("\n"), "utf-8");
    // Anchor at line 5, request startLine=1 endLine=55 (well past EOF).
    const startLine = 1;
    const requestedEndLine = 55; // anchor + 50

    try {
      const rangeOut = await executeFileTool(
        "read_file_range",
        { path: path.basename(filePath), startLine: String(startLine), endLine: String(requestedEndLine) },
        "/tmp",
        [],
      );
      expect(rangeOut).not.toMatch(/Error/i);

      const content = stripReadFileWrapper(rangeOut);
      expect(content).toContain("eofSymbol");

      // Effective end line from returned content — the same formula the
      // recovery path uses. The file has 7 lines so the window is also 7 lines.
      const returnedLineCount = content.split("\n").length;
      const effectiveEndLine = startLine + returnedLineCount - 1;

      // The recorded span must be the clamped value (7), not the request (55).
      expect(effectiveEndLine).toBe(7);
      expect(effectiveEndLine).not.toBe(requestedEndLine);
    } finally {
      await fs.rm(filePath, { force: true });
    }
  });

  /**
   * Regression: the previous implementation measured the full file's byte size
   * before slicing the window, so any file >128 KB returned an error even when
   * the requested 56-line window itself was well within the byte cap. The fix
   * measures the window bytes only, allowing targeted reads on large files.
   */
  it("EI-017 fix: succeeds on a >128 KB file when the targeted window is small", async () => {
    const filePath = path.join("/tmp", `large-file-${Date.now()}.ts`);
    // Build a file that is deliberately >128 KB (the old byte cap was against
    // the entire file). Each line is ~100 bytes; 300 lines ≈ 30 KB.
    const pad = "x".repeat(80); // 80-char padding so each line is ~100 bytes
    const headerLines = Array.from({ length: 1_300 }, (_, i) => `const filler${i} = "${pad}"; // ${i}`);
    const symbolLine = "function targetedSymbol() { return { kind: 'partial' }; }";
    // Symbol appears at line 1301 (1300 filler lines + 1).
    const content = [...headerLines, symbolLine, "const trailing = 1;"].join("\n");
    await fs.writeFile(filePath, content, "utf-8");

    const totalBytes = Buffer.byteLength(content, "utf-8");
    // Confirm the file is >128 KB (128_000 bytes = MAX_TARGETED_READ_BYTES).
    expect(totalBytes).toBeGreaterThan(128_000);

    try {
      // Request a small window of 5 lines around the symbol (lines 1299-1303).
      const result = await executeFileTool(
        "read_file_range",
        { path: path.basename(filePath), startLine: "1299", endLine: "1303" },
        "/tmp",
        [],
      );
      // Must succeed — the window is small even though the file is large.
      expect(result).not.toMatch(/Error.*byte limit/i);
      expect(result).toContain("targetedSymbol");
      // The returned window must NOT contain the very first filler lines.
      expect(result).not.toContain("filler0");
    } finally {
      await fs.rm(filePath, { force: true });
    }
  });
});

describe("executeFileTool — safe source editing", () => {
  const rootPath = "/tmp";

  it("creates a complete Patch Lab hunk for a new file", () => {
    const content = "export const created = true;\n";
    const hunks = buildPatchHunks(null, content, "Create the module");

    expect(hunks).toHaveLength(1);
    expect(hunks[0]).toMatchObject({
      startLine: 1,
      endLine: 1,
      expectedText: "",
      replacementText: content,
      reason: "Create the module",
    });
    expect(hashPatchBase(null)).toMatch(/^[a-f0-9]{64}$/);
  });

  it("queues a focused replacement while preserving the complete file", async () => {
    const filePath = path.join(rootPath, `replace-text-${Date.now()}.ts`);
    const original = [
      "export function first() { return 1; }",
      "const untouched = true;",
      "export function second() { return 2; }",
    ].join("\n");
    await fs.writeFile(filePath, original, "utf-8");
    const pending: any[] = [];

    try {
      const result = await executeFileTool(
        "replace_text",
        {
          path: path.basename(filePath),
          old_text: "const untouched = true;",
          new_text: "const untouched = false;",
          reason: "Update the flag",
        },
        rootPath,
        pending,
      );

      expect(result).toContain("Focused change queued");
      expect(pending).toHaveLength(1);
      expect(pending[0].originalContent).toBe(original);
      expect(pending[0].newContent).toBe(
        original.replace("const untouched = true;", "const untouched = false;"),
      );
      expect(pending[0].baseHash).toBe(hashPatchBase(original));
      expect(pending[0].hunks).toEqual(buildPatchHunks(
        original,
        original.replace("const untouched = true;", "const untouched = false;"),
        "Update the flag",
      ));
      expect(await fs.readFile(filePath, "utf-8")).toBe(original);
    } finally {
      await fs.rm(filePath, { force: true });
    }
  });

  it("rejects oversized full-file content and reasons using UTF-8 byte counts", async () => {
    const pending: any[] = [];
    const oversizedContent = await executeFileTool(
      "write_file",
      {
        path: "bounded-content.ts",
        content: "é".repeat(64_001),
        reason: "Keep the edit bounded",
      },
      rootPath,
      pending,
    );
    expect(oversizedContent).toContain('"content" exceeds the 128000-byte');
    expect(pending).toHaveLength(0);

    const oversizedReason = await executeFileTool(
      "write_file",
      {
        path: "bounded-reason.ts",
        content: "export const value = true;",
        reason: "é".repeat(1_001),
      },
      rootPath,
      pending,
    );
    expect(oversizedReason).toContain('"reason" exceeds the 2000-byte');
    expect(pending).toHaveLength(0);
  });

  it("rejects oversized replace_text fragments before reading the source", async () => {
    const openSpy = vi.spyOn(fs, "open");
    try {
      const result = await executeFileTool(
        "replace_text",
        {
          path: "replace-input-cap.ts",
          old_text: "x".repeat(128_001),
          new_text: "y",
          reason: "Keep fragments bounded",
        },
        rootPath,
        [],
      );
      expect(result).toContain('"old_text" exceeds the 128000-byte');
      expect(openSpy).not.toHaveBeenCalled();
    } finally {
      openSpy.mockRestore();
    }
  });

  it("bounds replace_text source reads at 2 MB plus one detection byte", async () => {
    const filePath = path.join(rootPath, `replace-source-cap-${Date.now()}.ts`);
    await fs.writeFile(filePath, "x", "utf-8");
    const virtualFileBytes = 3_000_000;
    let bytesReturned = 0;
    const read = vi.fn(async (
      buffer: Buffer,
      offset: number,
      length: number,
      position: number,
    ) => {
      const bytesRead = Math.min(length, virtualFileBytes - position);
      buffer.fill(0x78, offset, offset + bytesRead);
      bytesReturned += bytesRead;
      return { bytesRead, buffer };
    });
    const fakeHandle = { read, close: vi.fn(async () => undefined) };
    const originalOpen = fs.open.bind(fs);
    const openSpy = vi.spyOn(fs, "open").mockImplementation(async (
      requestedPath: any,
      ...options: any[]
    ) => {
      if (path.resolve(String(requestedPath)) === filePath) return fakeHandle as any;
      return originalOpen(requestedPath, ...options);
    });

    try {
      const pending: any[] = [];
      const result = await executeFileTool(
        "replace_text",
        {
          path: path.basename(filePath),
          old_text: "match",
          new_text: "replacement",
          reason: "Test source size limit",
        },
        rootPath,
        pending,
      );
      expect(result).toContain("2000000-byte replace_text source limit");
      expect(bytesReturned).toBe(2_000_001);
      expect(bytesReturned).toBeLessThan(virtualFileBytes);
      expect(pending).toHaveLength(0);
    } finally {
      openSpy.mockRestore();
      await fs.rm(filePath, { force: true });
    }
  });

  it("does not queue a replacement that would exceed the source-size limit", async () => {
    const filePath = path.join(rootPath, `replace-result-cap-${Date.now()}.ts`);
    const original = `UNIQUE_TOKEN${"x".repeat(1_900_000)}`;
    await fs.writeFile(filePath, original, "utf-8");
    const pending: any[] = [];

    try {
      const result = await executeFileTool(
        "replace_text",
        {
          path: path.basename(filePath),
          old_text: "UNIQUE_TOKEN",
          new_text: "y".repeat(128_000),
          reason: "Test result size limit",
        },
        rootPath,
        pending,
      );
      expect(result).toContain("would make");
      expect(result).toContain("exceed the 2000000-byte replace_text result limit");
      expect(pending).toHaveLength(0);
      expect(await fs.readFile(filePath, "utf-8")).toBe(original);
    } finally {
      await fs.rm(filePath, { force: true });
    }
  });

  it("does not stage a write when its source read finishes after cancellation", async () => {
    const filePath = path.join(rootPath, `cancelled-write-${Date.now()}.ts`);
    const original = "export const value = true;\n";
    await fs.writeFile(filePath, original, "utf-8");

    const controller = new AbortController();
    const pending: any[] = [];
    const originalReadFile = fs.readFile.bind(fs);
    const originalOpen = fs.open.bind(fs);
    let releaseRead: (() => void) | undefined;
    let notifyReadStarted: (() => void) | undefined;
    const readGate = new Promise<void>((resolve) => {
      releaseRead = resolve;
    });
    const readStarted = new Promise<void>((resolve) => {
      notifyReadStarted = resolve;
    });
    const openSpy = vi.spyOn(fs, "open").mockImplementation(async (
      requestedPath: any,
      ...options: any[]
    ) => {
      const handle = await originalOpen(requestedPath, ...options);
      if (path.resolve(String(requestedPath)) !== filePath) return handle;
      const originalRead = handle.read.bind(handle);
      const read = vi.fn(async (...readArgs: any[]) => {
        notifyReadStarted?.();
        await readGate;
        return originalRead(...readArgs);
      });
      return {
        read,
        close: handle.close.bind(handle),
      } as any;
    });

    try {
      const operation = executeFileTool(
        "write_file",
        {
          path: path.basename(filePath),
          content: "export const value = false;\n",
          reason: "Test late cancellation",
        },
        rootPath,
        pending,
        controller.signal,
      );

      await readStarted;
      controller.abort();
      releaseRead?.();

      await expect(operation).rejects.toThrow("File operation cancelled.");
      expect(pending).toHaveLength(0);
      expect(await originalReadFile(filePath, "utf-8")).toBe(original);
    } finally {
      openSpy.mockRestore();
      await fs.rm(filePath, { force: true });
    }
  });

  it("rejects a replacement when old_text is not unique", async () => {
    const filePath = path.join(rootPath, `replace-duplicate-${Date.now()}.ts`);
    await fs.writeFile(filePath, "const value = true;\nconst value = true;\n", "utf-8");
    try {
      const result = await executeFileTool(
        "replace_text",
        {
          path: path.basename(filePath),
          old_text: "const value = true;",
          new_text: "const value = false;",
          reason: "Change one value",
        },
        rootPath,
        [],
      );
      expect(result).toContain("more than once");
    } finally {
      await fs.rm(filePath, { force: true });
    }
  });

  it("rejects full replacement of an existing large source file", async () => {
    const filePath = path.join(rootPath, `large-source-${Date.now()}.ts`);
    await fs.writeFile(filePath, `export const keep = true;\n${"x".repeat(128_100)}`, "utf-8");
    try {
      const result = await executeFileTool(
        "write_file",
        {
          path: path.basename(filePath),
          content: "export const truncated = true;",
          reason: "Test the large-file guard",
        },
        rootPath,
        [],
      );
      expect(result).toContain("Full-file replacement is blocked");
    } finally {
      await fs.rm(filePath, { force: true });
    }
  });
});

describe("stripReadFileWrapper — source-aligned evidence bodies (task #31)", () => {
  it("removes the 2-line File/``` header so spans point at true source lines", () => {
    // Mirror the exact format executeFileTool("read_file") produces:
    // `File: <path>\n\`\`\`\n${content}\n\`\`\`` where content retains its
    // trailing newline.
    const content =
      "export function pick(flag: boolean): string {\n" +
      "  if (flag) return 'partial';\n" +
      "}\n";
    const wrapped = `File: src/pick.ts\n\`\`\`\n${content}\n\`\`\``;
    expect(stripReadFileWrapper(wrapped)).toBe(content);
  });

  it("leaves an already-raw body untouched", () => {
    const raw = "export const x = 1;\n";
    expect(stripReadFileWrapper(raw)).toBe(raw);
  });

  it("does not mangle a body that merely starts with a File: token but lacks the fence", () => {
    const body = "File: listing\nsoon after\nThe quick brown fox.";
    expect(stripReadFileWrapper(body)).toBe(body);
  });

  it("returns byte-for-byte unchanged when an opening fence has no closing fence", () => {
    // A body that opens a ``` fence but never closes it is NOT the read_file
    // wrapper shape — it could be a raw file body. Stripping the header would
    // silently corrupt the source before evidence validation, so it must be
    // left entirely untouched.
    const body =
      "File: src/pick.ts\n```\nexport const open = true;\nconst neverClosed = 1;";
    expect(stripReadFileWrapper(body)).toBe(body);
  });

  it("requires the closing fence to be a bare line (info-string variant is not a wrapper)", () => {
    // Closing fences in the real wrapper are bare ```. A line like ```ts is
    // not a terminating fence, so the shape is not recognised and the body is
    // left untouched.
    const body =
      "File: src/pick.ts\n```\nexport const open = true;\n```ts";
    expect(stripReadFileWrapper(body)).toBe(body);
  });
});
