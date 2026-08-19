import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { mkdir, writeFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { walkProject } from "../file-walker.js";

const TEST_DIR = join(tmpdir(), `scanner-test-${process.pid}`);

beforeAll(async () => {
  await mkdir(join(TEST_DIR, "src"), { recursive: true });
  await mkdir(join(TEST_DIR, "src", "__tests__"), { recursive: true });
  await mkdir(join(TEST_DIR, "node_modules", "pkg"), { recursive: true });

  await writeFile(join(TEST_DIR, "package.json"), JSON.stringify({ name: "test-project" }));
  await writeFile(join(TEST_DIR, "src", "index.ts"), 'export const hello = "world";');
  await writeFile(join(TEST_DIR, "src", "utils.ts"), "export function add(a: number, b: number) { return a + b; }");
  await writeFile(join(TEST_DIR, "src", "__tests__", "utils.test.ts"), 'import { add } from "../utils.js";\nconsole.log(add(1, 2));');
  await writeFile(join(TEST_DIR, "README.md"), "# Test Project");
  // This should be excluded
  await writeFile(join(TEST_DIR, "node_modules", "pkg", "index.js"), 'module.exports = {};');
});

afterAll(async () => {
  await rm(TEST_DIR, { recursive: true, force: true });
});

describe("walkProject", () => {
  it("returns scanned files from a valid directory", async () => {
    const result = await walkProject(TEST_DIR);

    expect(result.files.length).toBeGreaterThan(0);
  });

  it("detects TypeScript files with correct language", async () => {
    const result = await walkProject(TEST_DIR);

    const tsFiles = result.files.filter((f) => f.language === "typescript");
    expect(tsFiles.length).toBeGreaterThanOrEqual(2);
  });

  it("excludes node_modules from scan results", async () => {
    const result = await walkProject(TEST_DIR);

    const nodeModulesFiles = result.files.filter((f) => f.path.includes("node_modules"));
    expect(nodeModulesFiles).toHaveLength(0);
  });

  it("includes README.md in results", async () => {
    const result = await walkProject(TEST_DIR);

    const mdFiles = result.files.filter((f) => f.language === "markdown");
    expect(mdFiles.length).toBeGreaterThanOrEqual(1);
  });

  it("includes package.json in results", async () => {
    const result = await walkProject(TEST_DIR);

    const jsonFiles = result.files.filter((f) => f.path === "package.json");
    expect(jsonFiles.length).toBe(1);
  });

  it("populates content for small files", async () => {
    const result = await walkProject(TEST_DIR);

    const tsFiles = result.files.filter(
      (f) => f.language === "typescript" && !f.oversized,
    );
    for (const file of tsFiles) {
      expect(typeof file.content).toBe("string");
      expect((file.content ?? "").length).toBeGreaterThan(0);
    }
  });

  it("returns relative paths (no leading /)", async () => {
    const result = await walkProject(TEST_DIR);

    for (const file of result.files) {
      expect(file.path).not.toMatch(/^\//);
    }
  });

  it("throws for a non-existent path (hard-fail — callers mark jobs failed)", async () => {
    // walkProject hard-fails on a missing path so callers (scan-runner, discovery)
    // can mark the job/session as error. Silent cwd-fallback was removed to prevent
    // scanning the wrong directory and producing plausible-but-wrong results.
    await expect(
      walkProject("/this/path/does/not/exist/at/all"),
    ).rejects.toThrow("Project root does not exist or is inaccessible");
  });

  it("marks files over 512KB as oversized and skips their content", async () => {
    const bigContent = "x".repeat(512 * 1024 + 10);
    await writeFile(join(TEST_DIR, "src", "huge.ts"), bigContent);
    try {
      const result = await walkProject(TEST_DIR);
      const huge = result.files.find((f) => f.path === "src/huge.ts");
      expect(huge).toBeDefined();
      expect(huge?.oversized).toBe(true);
      expect(huge?.content).toBe("");
    } finally {
      await rm(join(TEST_DIR, "src", "huge.ts"), { force: true });
    }
  });

  it("ignores unsupported extensions", async () => {
    await writeFile(join(TEST_DIR, "image.png"), Buffer.from([0x89, 0x50, 0x4e, 0x47]));
    try {
      const result = await walkProject(TEST_DIR);
      expect(result.files.some((f) => f.path === "image.png")).toBe(false);
    } finally {
      await rm(join(TEST_DIR, "image.png"), { force: true });
    }
  });

  it("does not recurse into dot-directories", async () => {
    await mkdir(join(TEST_DIR, ".hidden"), { recursive: true });
    await writeFile(join(TEST_DIR, ".hidden", "secret.ts"), "export const x = 1;");
    try {
      const result = await walkProject(TEST_DIR);
      expect(result.files.some((f) => f.path.includes(".hidden"))).toBe(false);
    } finally {
      await rm(join(TEST_DIR, ".hidden"), { recursive: true, force: true });
    }
  });
});
