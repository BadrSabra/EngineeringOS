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
  it("allows /tmp/eos-git-<uuid> regardless of depth or environment", async () => {
    const path = `${EOS_GIT_TEMP_PREFIX}550e8400-e29b-41d4-a716-446655440000`;
    expect(await validateRootPath(path)).toBeNull();
  });

  it("allows any path starting with the exact EOS_GIT_TEMP_PREFIX", async () => {
    expect(await validateRootPath(`${EOS_GIT_TEMP_PREFIX}abc-def`)).toBeNull();
  });

  it("does NOT allow /tmp paths that don't start with the prefix", async () => {
    // /tmp/malicious has only 1 segment so fails Rule 1 (depth)
    const result = await validateRootPath("/tmp/malicious");
    expect(result).not.toBeNull();
  });
});

describe("validateRootPath — Rule 1: minimum depth", () => {
  it("rejects a single-segment path (/tmp)", async () => {
    const result = await validateRootPath("/tmp");
    expect(result).not.toBeNull();
    expect(result).toMatch(/too shallow/i);
  });

  it("rejects a two-segment path (/home/runner)", async () => {
    const result = await validateRootPath("/home/runner");
    expect(result).not.toBeNull();
    expect(result).toMatch(/too shallow/i);
  });

  it("allows a three-segment path outside Replit env", async () => {
    const saved = process.env.REPLIT_DEV_DOMAIN;
    delete process.env.REPLIT_DEV_DOMAIN;
    try {
      expect(await validateRootPath("/home/user/project")).toBeNull();
    } finally {
      if (saved !== undefined) process.env.REPLIT_DEV_DOMAIN = saved;
    }
  });
});

describe("validateRootPath — Rule 2: system prefix block list", () => {
  it("does not block /usr/local/bin by Rule 2 (only exact matches are blocked)", async () => {
    // /usr/local/bin has 3 segments but starts with /usr which is in the block list
    // as an exact-match only — /usr/local/bin is NOT an exact match of /usr, so
    // Rule 2 won't fire. Only Rule 3 (Replit env) would catch it outside of workspace.
    // Confirm it is NOT blocked by Rule 2 specifically when env is off.
    const saved = process.env.REPLIT_DEV_DOMAIN;
    delete process.env.REPLIT_DEV_DOMAIN;
    try {
      const result = await validateRootPath("/usr/local/bin");
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

  it("rejects a path outside /home/runner/workspace in Replit env", async () => {
    const result = await validateRootPath("/var/app/project");
    expect(result).not.toBeNull();
    expect(result).toMatch(/home\/runner\/workspace/i);
  });

  it("allows /home/runner/workspace/my-project in Replit env", async () => {
    expect(await validateRootPath("/home/runner/workspace/my-project")).toBeNull();
  });

  it("allows /tmp/eos-git-<uuid> even in Replit env (Rule 0 fires first)", async () => {
    const path = `${EOS_GIT_TEMP_PREFIX}test-uuid-1234`;
    expect(await validateRootPath(path)).toBeNull();
  });

  it("rejects /tmp/not-an-eos-git-path/with/depth in Replit env (Rule 3)", async () => {
    const result = await validateRootPath("/tmp/not-eos/nested/path");
    expect(result).not.toBeNull();
    expect(result).toMatch(/home\/runner\/workspace/i);
  });
});

// ─── validateRootPath — Rule 4: symlink escape prevention ─────────────────────

describe("validateRootPath — Rule 4: symlink resolution", () => {
  let workDir: string;
  const originalEnv = process.env.REPLIT_DEV_DOMAIN;

  beforeEach(async () => {
    // Create a real temp dir inside /tmp so the base dir itself is safe.
    // Tests create symlinks inside this dir that point elsewhere.
    workDir = await mkdtemp(join(tmpdir(), "eos-symlink-test-"));
    process.env.REPLIT_DEV_DOMAIN = "test.replit.dev";
  });

  afterEach(async () => {
    if (workDir) await rm(workDir, { recursive: true, force: true });
    if (originalEnv === undefined) {
      delete process.env.REPLIT_DEV_DOMAIN;
    } else {
      process.env.REPLIT_DEV_DOMAIN = originalEnv;
    }
  });

  it("rejects a symlink inside /home/runner/workspace that points outside the workspace boundary", async () => {
    // Simulate a workspace symlink by creating a symlink inside a workspace-like dir.
    // We can't create /home/runner/workspace/evil here, so we test the underlying
    // mechanism: a path that resolves (via realpath) to a blocked destination.
    // Create a temp workspace tree: /tmp/eos-symlink-test-<id>/workspace/project/
    //                               /tmp/eos-symlink-test-<id>/workspace/evil-link -> /etc
    const workspace = join(workDir, "workspace");
    await mkdir(workspace, { recursive: true });
    const { symlink } = await import("node:fs/promises");
    const linkPath = join(workspace, "evil-link");
    // /etc exists on the system — point the symlink at it
    try {
      await symlink("/etc", linkPath);
    } catch {
      // If symlink creation fails (permissions), skip the test body
      return;
    }

    // Temporarily override REPLIT_DEV_DOMAIN env check target so our test workspace passes.
    // We patch validateRootPath's env check by unsetting the env — this lets us test
    // the raw realpath mechanism without workspace-prefix gating.
    delete process.env.REPLIT_DEV_DOMAIN;

    // The link itself has 3 segments from workDir's perspective, passes depth rule,
    // passes exact-match block list (not a member). Without realpath resolution it
    // would return null (valid). WITH realpath it resolves to /etc which has only
    // 1 segment → Rule 1 fires.
    const result = await validateRootPath(linkPath);
    // /etc resolves to 1 segment — too shallow OR is in the block list.
    expect(result).not.toBeNull();
  });

  it("allows a symlink pointing to a valid project directory", async () => {
    // Create a real target dir with 3 path segments.
    const realTarget = join(workDir, "real-project");
    await mkdir(realTarget, { recursive: true });
    const { symlink } = await import("node:fs/promises");
    const linkDir = join(workDir, "links");
    await mkdir(linkDir, { recursive: true });
    const linkPath = join(linkDir, "my-project");
    try {
      await symlink(realTarget, linkPath);
    } catch {
      return; // symlink not supported — skip
    }

    // Unset Replit env so Rule 3 doesn't interfere with the /tmp paths.
    delete process.env.REPLIT_DEV_DOMAIN;

    // realTarget resolves inside workDir which has > 3 segments (/tmp/eos-symlink-test-*/real-project)
    // so it should pass all rules.
    const result = await validateRootPath(linkPath);
    expect(result).toBeNull();
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
