/**
 * Unit tests for discovery-adapters.ts.
 *
 * Each adapter is tested in isolation: validate() is pure and fully testable;
 * resolve() is tested for its synchronous error paths (missing config, unknown
 * project). The happy-path git clone and DB lookups are covered by route-level
 * integration tests in discovery.test.ts.
 */

import { describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import {
  ADAPTERS,
  resolveSource,
  cleanupResolveResult,
  isResolveError,
} from "./discovery-adapters.js";

// ─── isResolveError type guard ────────────────────────────────────────────────

const TEST_USER = "test-user";
const OTHER_USER = "someone-else";

describe("isResolveError", () => {
  it("returns true for an error result", () => {
    expect(isResolveError({ error: "oops", status: 400, reason: "invalid_source" })).toBe(true);
  });

  it("returns false for a success result", () => {
    expect(isResolveError({ rootPath: "/home/runner/workspace/foo" })).toBe(false);
  });

  it("returns false for a success result that has a tempDir", () => {
    expect(isResolveError({ rootPath: "/tmp/eos-git-abc", tempDir: "/tmp/eos-git-abc" })).toBe(false);
  });
});

// ─── ADAPTERS registry ────────────────────────────────────────────────────────

describe("ADAPTERS registry", () => {
  const ALL_SOURCE_TYPES = [
    "LOCAL_FOLDER",
    "GIT_REPOSITORY",
    "WORKSPACE_PROJECT",
    "ARCHIVE_UPLOAD",
    "REMOTE_FILESYSTEM",
    "DOCKER_VOLUME",
  ];

  it("contains an entry for every SourceType enum value", () => {
    for (const t of ALL_SOURCE_TYPES) {
      expect(ADAPTERS).toHaveProperty(t);
    }
  });

  it("marks LOCAL_FOLDER, GIT_REPOSITORY, WORKSPACE_PROJECT as available", () => {
    expect(ADAPTERS["LOCAL_FOLDER"].available).toBe(true);
    expect(ADAPTERS["GIT_REPOSITORY"].available).toBe(true);
    expect(ADAPTERS["WORKSPACE_PROJECT"].available).toBe(true);
  });

  it("marks ARCHIVE_UPLOAD, REMOTE_FILESYSTEM, DOCKER_VOLUME as not available", () => {
    expect(ADAPTERS["ARCHIVE_UPLOAD"].available).toBe(false);
    expect(ADAPTERS["REMOTE_FILESYSTEM"].available).toBe(false);
    expect(ADAPTERS["DOCKER_VOLUME"].available).toBe(false);
  });

  it("unsupported adapters have a human-readable reason", () => {
    for (const type of ["ARCHIVE_UPLOAD", "REMOTE_FILESYSTEM", "DOCKER_VOLUME"]) {
      const adapter = ADAPTERS[type];
      if (!adapter.available) {
        expect(typeof adapter.reason).toBe("string");
        expect(adapter.reason.length).toBeGreaterThan(0);
      }
    }
  });
});

// ─── LOCAL_FOLDER adapter ─────────────────────────────────────────────────────

describe("LOCAL_FOLDER adapter — validate", () => {
  const adapter = ADAPTERS["LOCAL_FOLDER"];
  if (!adapter.available) throw new Error("LOCAL_FOLDER must be available");

  it("returns null (valid) when path is provided", () => {
    expect(adapter.validate({ path: "/home/runner/workspace/my-project" })).toBeNull();
  });

  it("returns an error when path is missing", () => {
    const err = adapter.validate({});
    expect(err).not.toBeNull();
    expect(err!.status).toBe(400);
    expect(err!.error).toMatch(/path is required/i);
  });

  it("returns an error when path is an empty string", () => {
    const err = adapter.validate({ path: "" });
    expect(err).not.toBeNull();
    expect(err!.status).toBe(400);
  });
});

describe("LOCAL_FOLDER adapter — resolve", () => {
  const adapter = ADAPTERS["LOCAL_FOLDER"];
  if (!adapter.available) throw new Error("LOCAL_FOLDER must be available");

  it("returns the path unchanged when it already starts with /", async () => {
    const result = await adapter.resolve({ path: "/home/runner/workspace/foo" }, { userId: TEST_USER });
    expect(isResolveError(result)).toBe(false);
    if (!isResolveError(result)) {
      expect(result.rootPath).toBe("/home/runner/workspace/foo");
    }
  });

  it("prepends / when path does not start with /", async () => {
    const result = await adapter.resolve({ path: "home/runner/workspace/foo" }, { userId: TEST_USER });
    expect(isResolveError(result)).toBe(false);
    if (!isResolveError(result)) {
      expect(result.rootPath).toBe("/home/runner/workspace/foo");
    }
  });

  it("does not set tempDir (LOCAL_FOLDER needs no cleanup)", async () => {
    const result = await adapter.resolve({ path: "/home/runner/workspace/foo" }, { userId: TEST_USER });
    if (!isResolveError(result)) {
      expect(result.tempDir).toBeUndefined();
    }
  });
});

// ─── GIT_REPOSITORY adapter ───────────────────────────────────────────────────

describe("GIT_REPOSITORY adapter — validate", () => {
  const adapter = ADAPTERS["GIT_REPOSITORY"];
  if (!adapter.available) throw new Error("GIT_REPOSITORY must be available");

  it("returns null (valid) when url is provided with https://", () => {
    expect(adapter.validate({ url: "https://github.com/owner/repo" })).toBeNull();
  });

  it("returns null (valid) for http:// URLs (local/internal registries)", () => {
    expect(adapter.validate({ url: "http://internal.corp/repo.git" })).toBeNull();
  });

  it("returns an error when url is missing", () => {
    const err = adapter.validate({});
    expect(err).not.toBeNull();
    expect(err!.status).toBe(400);
    expect(err!.error).toMatch(/url is required/i);
  });

  // PR-04: URL scheme whitelist
  it("rejects ssh:// URLs (scheme not allowed)", () => {
    const err = adapter.validate({ url: "ssh://git@github.com/owner/repo.git" });
    expect(err).not.toBeNull();
    expect(err!.status).toBe(400);
    expect(err!.reason).toBe("invalid_source");
    expect(err!.error).toMatch(/only https/i);
  });

  it("rejects SCP-syntax git@host URLs (bare SSH, no https scheme)", () => {
    const err = adapter.validate({ url: "git@github.com:owner/repo.git" });
    expect(err).not.toBeNull();
    expect(err!.status).toBe(400);
    expect(err!.reason).toBe("invalid_source");
  });

  it("rejects file:// URLs (could clone local filesystem paths)", () => {
    const err = adapter.validate({ url: "file:///home/runner/workspace" });
    expect(err).not.toBeNull();
    expect(err!.status).toBe(400);
    expect(err!.reason).toBe("invalid_source");
    expect(err!.error).toMatch(/only https/i);
  });

  it("rejects git:// URLs", () => {
    const err = adapter.validate({ url: "git://github.com/owner/repo.git" });
    expect(err).not.toBeNull();
    expect(err!.status).toBe(400);
    expect(err!.reason).toBe("invalid_source");
  });

  it("rejects an empty url string", () => {
    const err = adapter.validate({ url: "" });
    expect(err).not.toBeNull();
    expect(err!.status).toBe(400);
    // An empty string doesn't start with https:// so hits the scheme check
    // (or the presence check if we add a truthy guard first).
  });
});

// PR-04: Credential redaction in git clone errors
describe("GIT_REPOSITORY adapter — credential redaction", () => {
  it("resolveSource returns 400 for GIT_REPOSITORY with a file:// URL before any clone attempt", async () => {
    // The scheme check is in validate(), which runs before resolve(), so a
    // file:// URL is rejected with 400 before git is ever invoked.
    const result = await resolveSource(
      "GIT_REPOSITORY",
      { url: "file:///etc/passwd" },
      "test-user",
    );
    expect(isResolveError(result)).toBe(true);
    if (isResolveError(result)) {
      expect(result.status).toBe(400);
      expect(result.reason).toBe("invalid_source");
    }
  });

  it("resolveSource returns 400 for GIT_REPOSITORY with an ssh:// URL", async () => {
    const result = await resolveSource(
      "GIT_REPOSITORY",
      { url: "ssh://git@github.com/owner/repo.git" },
      "test-user",
    );
    expect(isResolveError(result)).toBe(true);
    if (isResolveError(result)) {
      expect(result.status).toBe(400);
    }
  });
});

// ─── WORKSPACE_PROJECT adapter ────────────────────────────────────────────────

describe("WORKSPACE_PROJECT adapter — validate", () => {
  const adapter = ADAPTERS["WORKSPACE_PROJECT"];
  if (!adapter.available) throw new Error("WORKSPACE_PROJECT must be available");

  it("returns null (valid) when projectId is provided", () => {
    expect(adapter.validate({ projectId: "some-uuid" })).toBeNull();
  });

  it("returns an error when projectId is missing", () => {
    const err = adapter.validate({});
    expect(err).not.toBeNull();
    expect(err!.status).toBe(400);
    expect(err!.error).toMatch(/projectId is required/i);
  });
});

describe("WORKSPACE_PROJECT adapter — resolve", () => {
  const adapter = ADAPTERS["WORKSPACE_PROJECT"];
  if (!adapter.available) throw new Error("WORKSPACE_PROJECT must be available");

  it("returns 404 when projectId does not exist in the database", async () => {
    const result = await adapter.resolve(
      { projectId: "00000000-0000-0000-0000-000000000000" },
      { userId: TEST_USER },
    );
    expect(isResolveError(result)).toBe(true);
    if (isResolveError(result)) {
      expect(result.status).toBe(404);
      expect(result.reason).toBe("not_found");
      expect(result.error).toMatch(/project not found/i);
    }
  });
});

// ─── WORKSPACE_PROJECT adapter — ownership scoping ────────────────────────────

describe("WORKSPACE_PROJECT adapter — ownership scoping", () => {
  const adapter = ADAPTERS["WORKSPACE_PROJECT"];
  if (!adapter.available) throw new Error("WORKSPACE_PROJECT must be available");

  it("returns 403 permission_denied when the source project is owned by a different user", async () => {
    const { db, projectsTable } = await import("@workspace/db");
    const { randomUUID } = await import("crypto");
    const projectId = randomUUID();
    await db.insert(projectsTable).values({
      id: projectId,
      ownerId: OTHER_USER,
      name: "someone-else's project",
      rootPath: "/home/runner/workspace/other-" + randomUUID(),
      language: "typescript",
      status: "active",
      createdAt: new Date(),
      updatedAt: new Date(),
    });
    try {
      const result = await adapter.resolve({ projectId }, { userId: TEST_USER });
      expect(isResolveError(result)).toBe(true);
      if (isResolveError(result)) {
        expect(result.status).toBe(403);
        expect(result.reason).toBe("permission_denied");
      }
    } finally {
      await db.delete(projectsTable).where(eq(projectsTable.id, projectId));
    }
  });

  it("resolves successfully when the source project is owned by the requesting user", async () => {
    const { db, projectsTable } = await import("@workspace/db");
    const { randomUUID } = await import("crypto");
    const projectId = randomUUID();
    const rootPath = "/home/runner/workspace/own-" + randomUUID();
    await db.insert(projectsTable).values({
      id: projectId,
      ownerId: TEST_USER,
      name: "my own project",
      rootPath,
      language: "typescript",
      status: "active",
      createdAt: new Date(),
      updatedAt: new Date(),
    });
    try {
      const result = await adapter.resolve({ projectId }, { userId: TEST_USER });
      expect(isResolveError(result)).toBe(false);
      if (!isResolveError(result)) {
        expect(result.rootPath).toBe(rootPath);
      }
    } finally {
      await db.delete(projectsTable).where(eq(projectsTable.id, projectId));
    }
  });
});

// ─── resolveSource facade ─────────────────────────────────────────────────────

describe("resolveSource", () => {
  it("returns 400 for an unknown source type", async () => {
    const result = await resolveSource("TOTALLY_UNKNOWN", {}, TEST_USER);
    expect(isResolveError(result)).toBe(true);
    if (isResolveError(result)) {
      expect(result.status).toBe(400);
      expect(result.reason).toBe("invalid_source");
      expect(result.error).toMatch(/unknown source type/i);
    }
  });

  it("returns 501 for ARCHIVE_UPLOAD", async () => {
    const result = await resolveSource("ARCHIVE_UPLOAD", { uploadId: "fake" }, TEST_USER);
    expect(isResolveError(result)).toBe(true);
    if (isResolveError(result)) {
      expect(result.status).toBe(501);
      expect(result.reason).toBe("unsupported_source");
      expect(result.error).toMatch(/not available/i);
    }
  });

  it("returns 501 for REMOTE_FILESYSTEM", async () => {
    const result = await resolveSource("REMOTE_FILESYSTEM", {}, TEST_USER);
    expect(isResolveError(result)).toBe(true);
    if (isResolveError(result)) expect(result.status).toBe(501);
  });

  it("returns 501 for DOCKER_VOLUME", async () => {
    const result = await resolveSource("DOCKER_VOLUME", {}, TEST_USER);
    expect(isResolveError(result)).toBe(true);
    if (isResolveError(result)) expect(result.status).toBe(501);
  });

  it("returns 400 for LOCAL_FOLDER with missing path (validation runs before resolve)", async () => {
    const result = await resolveSource("LOCAL_FOLDER", {}, TEST_USER);
    expect(isResolveError(result)).toBe(true);
    if (isResolveError(result)) {
      expect(result.status).toBe(400);
      expect(result.error).toMatch(/path is required/i);
    }
  });

  it("returns 400 for GIT_REPOSITORY with missing url", async () => {
    const result = await resolveSource("GIT_REPOSITORY", {}, TEST_USER);
    expect(isResolveError(result)).toBe(true);
    if (isResolveError(result)) {
      expect(result.status).toBe(400);
      expect(result.error).toMatch(/url is required/i);
    }
  });

  it("returns 400 for WORKSPACE_PROJECT with missing projectId", async () => {
    const result = await resolveSource("WORKSPACE_PROJECT", {}, TEST_USER);
    expect(isResolveError(result)).toBe(true);
    if (isResolveError(result)) {
      expect(result.status).toBe(400);
      expect(result.error).toMatch(/projectId is required/i);
    }
  });

  it("resolves LOCAL_FOLDER to a rootPath when path is provided", async () => {
    const result = await resolveSource("LOCAL_FOLDER", { path: "/home/runner/workspace/x" }, TEST_USER);
    expect(isResolveError(result)).toBe(false);
    if (!isResolveError(result)) {
      expect(result.rootPath).toBe("/home/runner/workspace/x");
    }
  });
});

// ─── cleanupResolveResult ─────────────────────────────────────────────────────

describe("cleanupResolveResult", () => {
  it("is a no-op for error results", async () => {
    // Should not throw
    await cleanupResolveResult({ error: "bad", status: 400, reason: "resolution_failed" });
  });

  it("is a no-op for success results without a tempDir", async () => {
    await cleanupResolveResult({ rootPath: "/home/runner/workspace/foo" });
  });

  it("does not throw when tempDir does not exist on disk", async () => {
    await cleanupResolveResult({
      rootPath: "/tmp/eos-git-nonexistent",
      tempDir: "/tmp/eos-git-nonexistent",
    });
  });
});
