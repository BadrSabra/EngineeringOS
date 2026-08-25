import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { mkdirSync, writeFileSync, symlinkSync, rmSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { establishProjectRoot } from "./project-root.js";

// All fixtures live under the workspace boundary so they pass Rule 3
// (REPLIT_DEV_DOMAIN is set in this environment).
const BASE = `/home/runner/workspace/.test-roots/project-root-${randomUUID()}`;

const markerDir = `${BASE}/with-marker`;
const bareDir = `${BASE}/bare`;
const fileEntry = `${BASE}/a-file`;
const escapeLink = `${BASE}/escape-link`;
const internalLink = `${BASE}/internal-link`;

beforeAll(() => {
  mkdirSync(markerDir, { recursive: true });
  writeFileSync(`${markerDir}/package.json`, "{}");
  mkdirSync(bareDir, { recursive: true });
  writeFileSync(fileEntry, "not a directory");
  // Symlink escaping the workspace boundary
  symlinkSync("/etc", escapeLink);
  // Symlink resolving inside the workspace
  symlinkSync(markerDir, internalLink);
});

afterAll(() => {
  rmSync(BASE, { recursive: true, force: true });
});

describe("establishProjectRoot", () => {
  it("accepts an existing readable directory and returns its canonical path", async () => {
    const res = await establishProjectRoot(markerDir);
    expect(res.ok).toBe(true);
    if (res.ok) expect(res.canonicalPath).toBe(markerDir);
  });

  it("normalizes trailing slashes before resolving", async () => {
    const res = await establishProjectRoot(`${markerDir}///`);
    expect(res.ok).toBe(true);
    if (res.ok) expect(res.canonicalPath).toBe(markerDir);
  });

  it("rejects an empty rootPath", async () => {
    const res = await establishProjectRoot("   ");
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.reason).toBe("root_not_found");
  });

  it("rejects a nonexistent path with root_not_found", async () => {
    const res = await establishProjectRoot(`${BASE}/missing-${randomUUID()}`);
    expect(res.ok).toBe(false);
    if (!res.ok) {
      expect(res.reason).toBe("root_not_found");
      expect(res.status).toBe(422);
    }
  });

  it("rejects a dead eos-git temp clone with root_unavailable and 409", async () => {
    const res = await establishProjectRoot(`/tmp/eos-git-${randomUUID()}`);
    expect(res.ok).toBe(false);
    if (!res.ok) {
      expect(res.reason).toBe("root_unavailable");
      expect(res.status).toBe(409);
      expect(res.error).toMatch(/re-run discovery/i);
    }
  });

  it("rejects an EXISTING eos-git-prefixed dir unless allowManagedTempRoot is set", async () => {
    const forged = `/tmp/eos-git-forged-${randomUUID()}`;
    mkdirSync(forged, { recursive: true });
    writeFileSync(`${forged}/package.json`, "{}");
    try {
      const direct = await establishProjectRoot(forged, { requireMarkers: true });
      expect(direct.ok).toBe(false);
      if (!direct.ok) expect(direct.reason).toBe("root_unsafe");

      const imported = await establishProjectRoot(forged, { allowManagedTempRoot: true });
      expect(imported.ok).toBe(true);
    } finally {
      rmSync(forged, { recursive: true, force: true });
    }
  });

  it("rejects a plain file with root_not_directory", async () => {
    const res = await establishProjectRoot(fileEntry);
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.reason).toBe("root_not_directory");
  });

  it("rejects a symlink escaping the workspace boundary with root_unsafe", async () => {
    const res = await establishProjectRoot(escapeLink);
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.reason).toBe("root_unsafe");
  });

  it("resolves an internal symlink to its canonical target", async () => {
    const res = await establishProjectRoot(internalLink);
    expect(res.ok).toBe(true);
    if (res.ok) expect(res.canonicalPath).toBe(markerDir);
  });

  it("rejects blocked system paths with root_unsafe", async () => {
    const res = await establishProjectRoot("/etc");
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.reason).toBe("root_unsafe");
  });

  it("rejects a boundary-prefix sibling like /home/runner/workspace-evil", async () => {
    // Does not exist, so it fails at existence — but the underlying policy
    // (validateRootPath) must also reject the prefix trick when it exists.
    const { validateRootPath } = await import("./path-validation.js");
    const msg = await validateRootPath("/home/runner/workspace-evil");
    expect(msg).not.toBeNull();
  });

  it("requires project markers when requireMarkers is set", async () => {
    const res = await establishProjectRoot(bareDir, { requireMarkers: true });
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.reason).toBe("root_no_project_markers");
  });

  it("accepts a marker directory when requireMarkers is set", async () => {
    const res = await establishProjectRoot(markerDir, { requireMarkers: true });
    expect(res.ok).toBe(true);
  });
});
