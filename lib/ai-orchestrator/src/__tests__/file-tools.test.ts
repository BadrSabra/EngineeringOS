/**
 * Tests for the search_code error-path differentiation (PR-05).
 *
 * Strategy: vi.mock hoists the child_process mock before file-tools.ts loads,
 * so promisify(execFile) wraps the mock. Each test overrides mockImplementation
 * to simulate a specific execFile outcome, then asserts the string returned by
 * executeFileTool("search_code", ...).
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

// Hoisted mock — runs before any import is evaluated.
vi.mock("node:child_process", () => ({
  execFile: vi.fn(),
}));

// Import after mock is registered.
import { execFile } from "node:child_process";
import { executeFileTool } from "../tools/file-tools.js";

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
