/**
 * Tests for the search_code error-path differentiation (PR-05).
 *
 * Strategy: vi.mock hoists the child_process mock before file-tools.ts loads,
 * so promisify(execFile) wraps the mock. Each test overrides mockImplementation
 * to simulate a specific execFile outcome, then asserts the string returned by
 * executeFileTool("search_code", ...).
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { promises as fs } from "node:fs";
import path from "node:path";

// Hoisted mock — runs before any import is evaluated.
vi.mock("node:child_process", () => ({
  execFile: vi.fn(),
}));

// Import after mock is registered.
import { execFile } from "node:child_process";
import { executeFileTool, FILE_TOOL_DEFINITIONS, stripReadFileWrapper } from "../tools/file-tools.js";
import { buildPatchHunks, hashPatchBase } from "../patch-contract.js";

const mockExecFile = vi.mocked(execFile);

// Helper: simulate a promisify-compatible execFile callback.
// execFile(file, args, options, callback) — promisify resolves to {stdout, stderr} or rejects.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function mockCallback(err: Error | null, stdout = ""): void {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (mockExecFile as any).mockImplementationOnce(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (_f: unknown, _a: unknown, _o: unknown, cb: any) => {
      if (err) cb(err);
      else cb(null, { stdout });
      // Return a minimal stub — the promisify wrapper does not use the return value.
      return { pid: 0 };
    },
  );
}

describe("executeFileTool — search_code error handling", () => {
  beforeEach(() => {
    mockExecFile.mockReset();
  });

  it("returns 'No matches found.' when grep exits with code 1 (no matches)", async () => {
    mockCallback(Object.assign(new Error("exit 1"), { code: 1 }));
    const result = await executeFileTool("search_code", { pattern: "foo" }, "/tmp", []);
    expect(result).toBe("No matches found.");
  });

  it("returns a timeout message when grep is killed", async () => {
    mockCallback(Object.assign(new Error("killed"), { killed: true, code: "SIGTERM" }));
    const result = await executeFileTool("search_code", { pattern: "foo" }, "/tmp", []);
    expect(result).toMatch(/timed out/i);
  });

  it("returns a missing-grep message when execFile throws ENOENT", async () => {
    mockCallback(Object.assign(new Error("not found"), { code: "ENOENT" }));
    const result = await executeFileTool("search_code", { pattern: "foo" }, "/tmp", []);
    expect(result).toMatch(/not available/i);
  });

  it("returns a generic error message for other failures", async () => {
    mockCallback(Object.assign(new Error("permission denied"), { code: "EACCES" }));
    const result = await executeFileTool("search_code", { pattern: "foo" }, "/tmp", []);
    expect(result).toMatch(/search failed/i);
    expect(result).toMatch(/permission denied/i);
  });

  it("returns matched lines on success", async () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (mockExecFile as any).mockImplementationOnce(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (_f: unknown, _a: unknown, _o: unknown, cb: any) => {
        cb(null, { stdout: "/tmp/foo.ts:1:const foo = 1;\n" });
        return { pid: 0 };
      },
    );
    const result = await executeFileTool("search_code", { pattern: "foo" }, "/tmp", []);
    expect(result).toContain("foo");
    expect(result).not.toBe("No matches found.");
  });
});

describe("executeFileTool — bounded source reads", () => {
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

  it("describes read_file as a bounded preview in the tool contract", () => {
    const readTool = FILE_TOOL_DEFINITIONS.find((tool) => tool.function.name === "read_file");
    expect(readTool?.function.description).toContain("first 128 KB");
    expect(readTool?.function.description).toContain("not proof that the file is incomplete");
  });
});

describe("executeFileTool — read_file_range (SR-003)", () => {
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
