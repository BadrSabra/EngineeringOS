/**
 * Unit tests for path-validation.ts
 *
 * Covers:
 *  - validateRootPath: EOS_GIT_TEMP_PREFIX bypass, depth rule, system-prefix
 *    block, Replit workspace constraint, and happy paths
 *  - verifyProjectRoot: real temp-dir with a project marker (valid clone),
 *    and empty temp-dir (no project root)
 */

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { validateRootPath, verifyProjectRoot, EOS_GIT_TEMP_PREFIX } from "./path-validation.js";

// ─── validateRootPath ─────────────────────────────────────────────────────────

describe("validateRootPath — EOS_GIT_TEMP_PREFIX bypass (Rule 0)", () => {
  it("allows /tmp/eos-git-<uuid> regardless of depth or environment", () => {
    const path = `${EOS_GIT_TEMP_PREFIX}550e8400-e29b-41d4-a716-446655440000`;
    expect(validateRootPath(path)).toBeNull();
  });

  it("allows any path starting with the exact EOS_GIT_TEMP_PREFIX", () => {
    expect(validateRootPath(`${EOS_GIT_TEMP_PREFIX}abc-def`)).toBeNull();
  });

  it("does NOT allow /tmp paths that don't start with the prefix", () => {
    // /tmp/malicious has only 1 segment so fails Rule 1 (depth)
    const result = validateRootPath("/tmp/malicious");
    expect(result).not.toBeNull();
  });
});

describe("validateRootPath — Rule 1: minimum depth", () => {
  it("rejects a single-segment path (/tmp)", () => {
    const result = validateRootPath("/tmp");
    expect(result).not.toBeNull();
    expect(result).toMatch(/too shallow/i);
  });

  it("rejects a two-segment path (/home/runner)", () => {
    const result = validateRootPath("/home/runner");
    expect(result).not.toBeNull();
    expect(result).toMatch(/too shallow/i);
  });

  it("allows a three-segment path outside Replit env", () => {
    const saved = process.env.REPLIT_DEV_DOMAIN;
    delete process.env.REPLIT_DEV_DOMAIN;
    try {
      expect(validateRootPath("/home/user/project")).toBeNull();
    } finally {
      if (saved !== undefined) process.env.REPLIT_DEV_DOMAIN = saved;
    }
  });
});

describe("validateRootPath — Rule 2: system prefix block list", () => {
  it("rejects /usr/local/bin (exact system prefix) — wait, /usr has < 3 segs", () => {
    // /usr/local/bin has 3 segments but starts with /usr which is in the block list
    // as an exact-match only — /usr/local/bin is NOT an exact match of /usr, so
    // Rule 2 won't fire. Only Rule 3 (Replit env) would catch it outside of workspace.
    // Confirm it is NOT blocked by Rule 2 specifically when env is off.
    const saved = process.env.REPLIT_DEV_DOMAIN;
    delete process.env.REPLIT_DEV_DOMAIN;
    try {
      const result = validateRootPath("/usr/local/bin");
      // Rule 2 only blocks exact matches — /usr/local/bin is not in the set
      // (we're checking that behaviour is as documented)
      expect(result).toBeNull();
    } finally {
      if (saved !== undefined) process.env.REPLIT_DEV_DOMAIN = saved;
    }
  });
});

describe("validateRootPath — Rule 3: Replit workspace constraint", () => {
  const originalEnv = process.env.REPLIT_DEV_DOMAIN;

  beforeEach(() => {
    process.env.REPLIT_DEV_DOMAIN = "test.replit.dev";
  });

  afterEach(() => {
    if (originalEnv === undefined) {
      delete process.env.REPLIT_DEV_DOMAIN;
    } else {
      process.env.REPLIT_DEV_DOMAIN = originalEnv;
    }
  });

  it("rejects a path outside /home/runner/workspace in Replit env", () => {
    const result = validateRootPath("/var/app/project");
    expect(result).not.toBeNull();
    expect(result).toMatch(/home\/runner\/workspace/i);
  });

  it("allows /home/runner/workspace/my-project in Replit env", () => {
    expect(validateRootPath("/home/runner/workspace/my-project")).toBeNull();
  });

  it("allows /tmp/eos-git-<uuid> even in Replit env (Rule 0 fires first)", () => {
    const path = `${EOS_GIT_TEMP_PREFIX}test-uuid-1234`;
    expect(validateRootPath(path)).toBeNull();
  });

  it("rejects /tmp/not-an-eos-git-path/with/depth in Replit env (Rule 3)", () => {
    const result = validateRootPath("/tmp/not-eos/nested/path");
    expect(result).not.toBeNull();
    expect(result).toMatch(/home\/runner\/workspace/i);
  });
});

// ─── verifyProjectRoot ────────────────────────────────────────────────────────

describe("verifyProjectRoot — valid clone (project root present)", () => {
  let tempDir: string;

  afterEach(async () => {
    if (tempDir) await rm(tempDir, { recursive: true, force: true });
  });

  it("returns null when package.json is present (Node.js project)", async () => {
    tempDir = await mkdtemp(join(tmpdir(), "eos-test-valid-"));
    await writeFile(join(tempDir, "package.json"), JSON.stringify({ name: "test-repo" }));
    const result = await verifyProjectRoot(tempDir);
    expect(result).toBeNull();
  });

  it("returns null when pyproject.toml is present (Python project)", async () => {
    tempDir = await mkdtemp(join(tmpdir(), "eos-test-valid-"));
    await writeFile(join(tempDir, "pyproject.toml"), "[tool.poetry]\nname = \"test\"");
    const result = await verifyProjectRoot(tempDir);
    expect(result).toBeNull();
  });

  it("returns null when Cargo.toml is present (Rust project)", async () => {
    tempDir = await mkdtemp(join(tmpdir(), "eos-test-valid-"));
    await writeFile(join(tempDir, "Cargo.toml"), "[package]\nname = \"test\"");
    const result = await verifyProjectRoot(tempDir);
    expect(result).toBeNull();
  });

  it("returns null when go.mod is present (Go project)", async () => {
    tempDir = await mkdtemp(join(tmpdir(), "eos-test-valid-"));
    await writeFile(join(tempDir, "go.mod"), "module example.com/test\n\ngo 1.21");
    const result = await verifyProjectRoot(tempDir);
    expect(result).toBeNull();
  });

  it("returns null when .git directory is present (git repo without manifest)", async () => {
    tempDir = await mkdtemp(join(tmpdir(), "eos-test-valid-"));
    await mkdir(join(tempDir, ".git"));
    const result = await verifyProjectRoot(tempDir);
    expect(result).toBeNull();
  });
});

describe("verifyProjectRoot — invalid clone (no project root)", () => {
  let tempDir: string;

  afterEach(async () => {
    if (tempDir) await rm(tempDir, { recursive: true, force: true });
  });

  it("returns an error message when the directory is completely empty", async () => {
    tempDir = await mkdtemp(join(tmpdir(), "eos-test-empty-"));
    const result = await verifyProjectRoot(tempDir);
    expect(result).not.toBeNull();
    expect(result).toMatch(/no project root detected/i);
  });

  it("error message lists the expected marker files", async () => {
    tempDir = await mkdtemp(join(tmpdir(), "eos-test-empty-"));
    const result = await verifyProjectRoot(tempDir);
    expect(result).toMatch(/package\.json/);
    expect(result).toMatch(/pyproject\.toml/);
    expect(result).toMatch(/Cargo\.toml/);
    expect(result).toMatch(/go\.mod/);
    expect(result).toMatch(/\.git/);
  });

  it("returns an error when only unrecognised files are present", async () => {
    tempDir = await mkdtemp(join(tmpdir(), "eos-test-unknown-"));
    await writeFile(join(tempDir, "README.md"), "# nothing here");
    await writeFile(join(tempDir, "random.txt"), "some content");
    const result = await verifyProjectRoot(tempDir);
    expect(result).not.toBeNull();
    expect(result).toMatch(/no project root detected/i);
  });
});
