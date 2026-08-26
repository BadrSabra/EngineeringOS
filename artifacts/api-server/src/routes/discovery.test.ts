import { afterAll, afterEach, describe, expect, it, vi } from "vitest";
import request from "supertest";
import { eq } from "drizzle-orm";
import app from "../app.js";
import { setGitCloneExecutorForTests } from "../lib/discovery-adapters.js";
import {
  db,
  discoverySessionsTable,
  projectsTable,
  metricsTable,
  eventsTable,
  tasksTable,
  graphEntitiesTable,
} from "@workspace/db";
import { randomUUID } from "crypto";
import { mkdirSync, rmSync } from "node:fs";
import { access, mkdir, rm, writeFile } from "node:fs/promises";
import { promisify } from "node:util";
import { execFile } from "node:child_process";
import { join } from "node:path";
import type { DiscoveryResultData } from "@workspace/db";
import { MANAGED_PROJECT_ROOTS_DIR } from "../lib/project-materialization.js";
import { EOS_GIT_TEMP_PREFIX } from "../lib/path-validation.js";

const execFileAsync = promisify(execFile);

// ─── Shared fixtures ──────────────────────────────────────────────────────────

let sessionId: string | null = null;
let projectId: string | null = null;

function fakeResult(overrides: Partial<DiscoveryResultData> = {}): DiscoveryResultData {
  return {
    detectedName: "test-project",
    detectedLanguage: "typescript",
    detectedLanguages: ["typescript"],
    detectedFramework: null,
    detectedRuntime: "Node.js",
    detectedPackageManager: "pnpm",
    detectedArchitecture: "Monolith",
    detectedDb: null,
    detectedOrm: null,
    detectedTestFramework: null,
    detectedBuildTool: null,
    detectedCi: null,
    isMonorepo: false,
    hasDocker: false,
    hasOpenApi: false,
    packageCount: 1,
    moduleCount: 3,
    repoSizeBytes: 1024,
    detectedApis: [],
    detectedRisks: [],
    qualityScore: 80,
    confidenceScore: 90,
    graphSummary: { entityCount: 0, relationshipCount: 0, entitiesByType: {}, filesByLanguage: {} },
    ruleViolations: [],
    ...overrides,
  };
}

/**
 * Import now re-establishes the session root against the real filesystem, so
 * ready-session fixtures need a directory that actually exists under the
 * workspace boundary. Unique per session because projects.root_path is unique.
 */
const TEST_ROOTS_BASE = "/home/runner/workspace/.test-roots";
const fixtureDirs: string[] = [];
function makeSessionRootDir(): string {
  const dir = `${TEST_ROOTS_BASE}/discovery-${randomUUID()}`;
  mkdirSync(dir, { recursive: true });
  fixtureDirs.push(dir);
  return dir;
}

afterAll(() => {
  for (const dir of fixtureDirs) {
    try { rmSync(dir, { recursive: true, force: true }); } catch { /* gone */ }
  }
});

/** Insert a pre-completed session in "ready" state, bypassing the pipeline. */
async function insertReadySession(
  result: DiscoveryResultData,
  rootPathOverride?: string,
): Promise<string> {
  const id = randomUUID();
  await db.insert(discoverySessionsTable).values({
    id,
    ownerId: "test-user",
    status: "ready",
    rootPath: rootPathOverride ?? makeSessionRootDir(),
    sourceType: "LOCAL_FOLDER",
    progress: 100,
    currentStep: null,
    steps: [],
    result,
    startedAt: new Date(),
    completedAt: new Date(),
  });
  sessionId = id;
  return id;
}

async function cleanupSessionAndProject(): Promise<void> {
  if (projectId) {
    await db.delete(graphEntitiesTable).where(eq(graphEntitiesTable.projectId, projectId)).catch(() => undefined);
    await db.delete(tasksTable).where(eq(tasksTable.projectId, projectId)).catch(() => undefined);
    await db.delete(metricsTable).where(eq(metricsTable.projectId, projectId)).catch(() => undefined);
    await db.delete(eventsTable).where(eq(eventsTable.projectId, projectId)).catch(() => undefined);
    await db.delete(projectsTable).where(eq(projectsTable.id, projectId)).catch(() => undefined);
    projectId = null;
  }
  if (sessionId) {
    await db.delete(discoverySessionsTable).where(eq(discoverySessionsTable.id, sessionId)).catch(() => undefined);
    sessionId = null;
  }
}

// ─── GET /discovery/sources ───────────────────────────────────────────────────

describe("GET /discovery/sources — source capability listing", () => {
  it("returns 200 with all 6 source types", async () => {
    const res = await request(app).get("/api/discovery/sources");
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
    expect(res.body).toHaveLength(6);
  });

  it("each capability has required fields: sourceType, available, label, description, requiredConfig", async () => {
    const res = await request(app).get("/api/discovery/sources");
    for (const cap of res.body) {
      expect(cap).toHaveProperty("sourceType");
      expect(cap).toHaveProperty("available");
      expect(typeof cap.available).toBe("boolean");
      expect(cap).toHaveProperty("label");
      expect(cap).toHaveProperty("description");
      expect(cap).toHaveProperty("requiredConfig");
      expect(Array.isArray(cap.requiredConfig)).toBe(true);
    }
  });

  it("marks LOCAL_FOLDER and GIT_REPOSITORY as available", async () => {
    const res = await request(app).get("/api/discovery/sources");
    const byType = Object.fromEntries(res.body.map((c: { sourceType: string }) => [c.sourceType, c]));
    expect((byType["LOCAL_FOLDER"] as { available: boolean }).available).toBe(true);
    expect((byType["GIT_REPOSITORY"] as { available: boolean }).available).toBe(true);
  });

  it("marks WORKSPACE_PROJECT as available", async () => {
    const res = await request(app).get("/api/discovery/sources");
    const byType = Object.fromEntries(res.body.map((c: { sourceType: string }) => [c.sourceType, c]));
    expect((byType["WORKSPACE_PROJECT"] as { available: boolean }).available).toBe(true);
  });

  it("marks REMOTE_FILESYSTEM, DOCKER_VOLUME as not available and includes a notes field (ARCHIVE_UPLOAD is now implemented)", async () => {
    const res = await request(app).get("/api/discovery/sources");
    const byType = Object.fromEntries(res.body.map((c: { sourceType: string }) => [c.sourceType, c]));
    for (const type of ["REMOTE_FILESYSTEM", "DOCKER_VOLUME"]) {
      const cap = byType[type] as { available: boolean; notes?: string; hint?: string };
      expect(cap.available).toBe(false);
      expect(typeof cap.notes).toBe("string");
      expect(cap.notes!.length).toBeGreaterThan(0);
    }
  });

  it("marks ARCHIVE_UPLOAD as available (Epic D implemented)", async () => {
    const res = await request(app).get("/api/discovery/sources");
    const byType = Object.fromEntries(res.body.map((c: { sourceType: string }) => [c.sourceType, c]));
    expect((byType["ARCHIVE_UPLOAD"] as { available: boolean }).available).toBe(true);
  });

  it("capabilities list is the single source of truth — all 6 SourceType enum values are represented", async () => {
    const ALL_SOURCE_TYPES = [
      "LOCAL_FOLDER",
      "GIT_REPOSITORY",
      "WORKSPACE_PROJECT",
      "ARCHIVE_UPLOAD",
      "REMOTE_FILESYSTEM",
      "DOCKER_VOLUME",
    ];
    const res = await request(app).get("/api/discovery/sources");
    const returnedTypes = res.body.map((c: { sourceType: string }) => c.sourceType).sort();
    expect(returnedTypes).toEqual(ALL_SOURCE_TYPES.sort());
  });
});

// ─── POST /projects/discover — path validation ────────────────────────────────

describe("POST /projects/discover — path validation and session creation", () => {
  const createdSessionIds: string[] = [];

  afterEach(async () => {
    for (const id of createdSessionIds.splice(0)) {
      await db
        .delete(discoverySessionsTable)
        .where(eq(discoverySessionsTable.id, id))
        .catch(() => undefined);
    }
  });

  it("rejects a path with fewer than 3 segments (too shallow)", async () => {
    const res = await request(app)
      .post("/api/projects/discover")
      .send({ sourceType: "LOCAL_FOLDER", sourceConfig: { path: "/home/runner" } });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/too shallow/i);
  });

  it("rejects a single-segment path", async () => {
    const res = await request(app)
      .post("/api/projects/discover")
      .send({ sourceType: "LOCAL_FOLDER", sourceConfig: { path: "/tmp" } });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/too shallow/i);
  });

  it("rejects LOCAL_FOLDER missing the path field", async () => {
    const res = await request(app)
      .post("/api/projects/discover")
      .send({ sourceType: "LOCAL_FOLDER", sourceConfig: {} });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/path is required/i);
  });

  it("rejects a forged eos-git temp prefix for LOCAL_FOLDER before creating a session", async () => {
    const forgedPath = `${EOS_GIT_TEMP_PREFIX}forged-${randomUUID()}`;
    mkdirSync(forgedPath, { recursive: true });
    const savedDomain = process.env.REPLIT_DEV_DOMAIN;
    delete process.env.REPLIT_DEV_DOMAIN;
    try {
      const res = await request(app)
        .post("/api/projects/discover")
        .send({ sourceType: "LOCAL_FOLDER", sourceConfig: { path: forgedPath } });

      expect(res.status).toBe(400);
      expect(res.body.reason).toBe("invalid_source");
      const sessions = await db
        .select({ id: discoverySessionsTable.id })
        .from(discoverySessionsTable)
        .where(eq(discoverySessionsTable.rootPath, forgedPath));
      expect(sessions).toHaveLength(0);
    } finally {
      if (savedDomain !== undefined) process.env.REPLIT_DEV_DOMAIN = savedDomain;
      rmSync(forgedPath, { recursive: true, force: true });
    }
  });

  it("rejects GIT_REPOSITORY missing the url field", async () => {
    const res = await request(app)
      .post("/api/projects/discover")
      .send({ sourceType: "GIT_REPOSITORY", sourceConfig: {} });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/url is required/i);
  });

  it("rejects a non-GitHub URL before attempting Git discovery", async () => {
    const res = await request(app)
      .post("/api/projects/discover")
      .send({
        sourceType: "GIT_REPOSITORY",
        sourceConfig: { url: "http://127.0.0.1:12345/repo.git" },
      });
    expect(res.status).toBe(400);
    expect(res.body.reason).toBe("invalid_source");
    expect(res.body.error).toMatch(/credential-free HTTPS github\.com/i);
  });

  it("rejects WORKSPACE_PROJECT missing the projectId field", async () => {
    const res = await request(app)
      .post("/api/projects/discover")
      .send({ sourceType: "WORKSPACE_PROJECT", sourceConfig: {} });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/projectId is required/i);
  });

  it("returns 404 for ARCHIVE_UPLOAD with an unknown uploadId (Epic D: source is now available)", async () => {
    const res = await request(app)
      .post("/api/projects/discover")
      .send({ sourceType: "ARCHIVE_UPLOAD", sourceConfig: { uploadId: "nonexistent-upload-id" } });
    expect(res.status).toBe(404);
    expect(res.body.reason).toBe("not_found");
  });

  it("returns 501 for REMOTE_FILESYSTEM with structured error body", async () => {
    const res = await request(app)
      .post("/api/projects/discover")
      .send({ sourceType: "REMOTE_FILESYSTEM", sourceConfig: {} });
    expect(res.status).toBe(501);
    expect(res.body.reason).toBe("unsupported_source");
    expect(typeof res.body.error).toBe("string");
  });

  it("returns 501 for DOCKER_VOLUME with structured error body", async () => {
    const res = await request(app)
      .post("/api/projects/discover")
      .send({ sourceType: "DOCKER_VOLUME", sourceConfig: {} });
    expect(res.status).toBe(501);
    expect(res.body.reason).toBe("unsupported_source");
    expect(typeof res.body.error).toBe("string");
  });

  it("creates a session and returns 202 for a valid LOCAL_FOLDER path", async () => {
    // Path passes validation; discovery will fail in the background (path doesn't exist)
    // — the test only verifies the synchronous session-creation response.
    const res = await request(app)
      .post("/api/projects/discover")
      .send({
        sourceType: "LOCAL_FOLDER",
        sourceConfig: { path: "/home/runner/workspace/nonexistent-test-only" },
      });
    expect(res.status).toBe(202);
    expect(typeof res.body.id).toBe("string");
    expect(res.body.status).toBe("pending");
    expect(res.body.progress).toBe(0);
    expect(typeof res.body.startedAt).toBe("string");
    createdSessionIds.push(res.body.id);
  });

  it("response shape includes all required session fields", async () => {
    const res = await request(app)
      .post("/api/projects/discover")
      .send({
        sourceType: "LOCAL_FOLDER",
        sourceConfig: { path: "/home/runner/workspace/nonexistent-test-only-2" },
      });
    expect(res.status).toBe(202);
    expect(res.body).toHaveProperty("id");
    expect(res.body).toHaveProperty("status");
    expect(res.body).toHaveProperty("progress");
    expect(res.body).toHaveProperty("currentStep");
    expect(res.body).toHaveProperty("steps");
    expect(res.body).toHaveProperty("startedAt");
    expect(res.body).toHaveProperty("completedAt");
    expect(res.body).toHaveProperty("error");
    expect(res.body).toHaveProperty("importedProjectId");
    createdSessionIds.push(res.body.id);
  });
});

// ─── GET /projects/discover/:id — session polling ─────────────────────────────

describe("GET /projects/discover/:id — session polling", () => {
  afterEach(cleanupSessionAndProject);

  it("returns 404 with a deterministic error message for an unknown session", async () => {
    const res = await request(app).get(`/api/projects/discover/${randomUUID()}`);
    expect(res.status).toBe(404);
    expect(res.body.error).toBe("Discovery session not found");
  });

  it("returns 200 with session data for a known session", async () => {
    const id = await insertReadySession(fakeResult());
    const res = await request(app).get(`/api/projects/discover/${id}`);
    expect(res.status).toBe(200);
    expect(res.body.id).toBe(id);
    expect(res.body.status).toBe("ready");
    expect(res.body.progress).toBe(100);
  });

  it("response includes all required session fields", async () => {
    const id = await insertReadySession(fakeResult());
    const res = await request(app).get(`/api/projects/discover/${id}`);
    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty("id");
    expect(res.body).toHaveProperty("status");
    expect(res.body).toHaveProperty("progress");
    expect(res.body).toHaveProperty("currentStep");
    expect(res.body).toHaveProperty("steps");
    expect(res.body).toHaveProperty("startedAt");
    expect(res.body).toHaveProperty("completedAt");
    expect(res.body).toHaveProperty("error");
    expect(res.body).toHaveProperty("importedProjectId");
    expect(typeof res.body.startedAt).toBe("string");
  });
});

// ─── GET /projects/discover/:id/summary ───────────────────────────────────────

describe("GET /projects/discover/:id/summary", () => {
  afterEach(cleanupSessionAndProject);

  it("returns 404 for an unknown session", async () => {
    const res = await request(app).get(`/api/projects/discover/${randomUUID()}/summary`);
    expect(res.status).toBe(404);
    expect(res.body.error).toBe("Discovery session not found");
  });

  it("returns 409 with 'Discovery not yet complete' when session is still discovering", async () => {
    const id = await insertReadySession(fakeResult());
    await db
      .update(discoverySessionsTable)
      .set({ status: "discovering" })
      .where(eq(discoverySessionsTable.id, id));

    const res = await request(app).get(`/api/projects/discover/${id}/summary`);
    expect(res.status).toBe(409);
    expect(res.body.error).toBe("Discovery not yet complete");
  });

  it("returns 409 with 'Discovery not yet complete' when session is in error state", async () => {
    const id = await insertReadySession(fakeResult());
    await db
      .update(discoverySessionsTable)
      .set({ status: "error" })
      .where(eq(discoverySessionsTable.id, id));

    const res = await request(app).get(`/api/projects/discover/${id}/summary`);
    expect(res.status).toBe(409);
    expect(res.body.error).toBe("Discovery not yet complete");
  });

  it("returns 200 with full result data for a ready session", async () => {
    const result = fakeResult({ detectedName: "my-project", qualityScore: 85 });
    const id = await insertReadySession(result);

    const res = await request(app).get(`/api/projects/discover/${id}/summary`);
    expect(res.status).toBe(200);
    expect(res.body.id).toBe(id);
    expect(res.body.detectedName).toBe("my-project");
    expect(res.body.qualityScore).toBe(85);
    expect(res.body.detectedLanguage).toBe("typescript");
  });

  it("returns 200 for an already-imported session", async () => {
    const id = await insertReadySession(fakeResult({ detectedName: "imported-project" }));
    await db
      .update(discoverySessionsTable)
      .set({ status: "imported" })
      .where(eq(discoverySessionsTable.id, id));

    const res = await request(app).get(`/api/projects/discover/${id}/summary`);
    expect(res.status).toBe(200);
    expect(res.body.detectedName).toBe("imported-project");
  });
});

// ─── POST /projects/import — atomic claim ─────────────────────────────────────

describe("POST /projects/import — atomic claim", () => {
  afterEach(cleanupSessionAndProject);

  it("imports a ready session exactly once and rejects a concurrent second import", async () => {
    const discoveryId = await insertReadySession(fakeResult());

    const [first, second] = await Promise.all([
      request(app).post("/api/projects/import").send({ discoveryId }),
      request(app).post("/api/projects/import").send({ discoveryId }),
    ]);

    const statuses = [first.status, second.status].sort();
    expect(statuses).toEqual([201, 409]);

    const winner = first.status === 201 ? first : second;
    projectId = winner.body.id;

    // DB-level proof: exactly one project row, session claimed exactly once
    const projectRows = await db
      .select()
      .from(projectsTable)
      .where(eq(projectsTable.id, winner.body.id));
    expect(projectRows).toHaveLength(1);

    const session = await db
      .select()
      .from(discoverySessionsTable)
      .where(eq(discoverySessionsTable.id, discoveryId))
      .limit(1);
    expect(session[0]?.status).toBe("imported");
    expect(session[0]?.importedProjectId).toBe(winner.body.id);
  });

  it("returns 409 root_unavailable when the session root is a dead temporary git clone", async () => {
    const discoveryId = await insertReadySession(
      fakeResult(),
      `/tmp/eos-git-${randomUUID()}`,
    );
    const res = await request(app).post("/api/projects/import").send({ discoveryId });
    expect(res.status).toBe(409);
    expect(res.body.reason).toBe("root_unavailable");
    expect(res.body.hint).toMatch(/re-run discovery/i);

    // Session must NOT be claimed or rebound to another root.
    const session = await db
      .select()
      .from(discoverySessionsTable)
      .where(eq(discoverySessionsTable.id, discoveryId))
      .limit(1);
    expect(session[0]?.status).toBe("ready");
    expect(session[0]?.rootPath).toMatch(/^\/tmp\/eos-git-/);
  });

  it("rejects a LOCAL_FOLDER session whose root forges the managed /tmp/eos-git prefix, even when the directory exists", async () => {
    const forged = `/tmp/eos-git-forged-${randomUUID()}`;
    mkdirSync(forged, { recursive: true });
    try {
      const discoveryId = await insertReadySession(fakeResult(), forged);
      const res = await request(app).post("/api/projects/import").send({ discoveryId });
      expect(res.status).toBe(422);
      expect(res.body.reason).toBe("root_unsafe");

      // Session must not be claimed.
      const session = await db
        .select()
        .from(discoverySessionsTable)
        .where(eq(discoverySessionsTable.id, discoveryId))
        .limit(1);
      expect(session[0]?.status).toBe("ready");
    } finally {
      rmSync(forged, { recursive: true, force: true });
    }
  });

  it("allows a GIT_REPOSITORY session whose managed clone directory still exists", async () => {
    const cloneDir = `/tmp/eos-git-${randomUUID()}`;
    mkdirSync(cloneDir, { recursive: true });
    try {
      const id = randomUUID();
      await db.insert(discoverySessionsTable).values({
        id,
        ownerId: "test-user",
        status: "ready",
        rootPath: cloneDir,
        sourceType: "GIT_REPOSITORY",
        progress: 100,
        currentStep: null,
        steps: [],
        result: fakeResult(),
        startedAt: new Date(),
        completedAt: new Date(),
      });
      sessionId = id;

      const res = await request(app).post("/api/projects/import").send({ discoveryId: id });
      expect(res.status).toBe(201);
      expect(res.body.rootPath).toBe(cloneDir);
      projectId = res.body.id;
    } finally {
      rmSync(cloneDir, { recursive: true, force: true });
    }
  });

  it("returns 422 root_not_found when the session root directory was deleted after discovery", async () => {
    const discoveryId = await insertReadySession(
      fakeResult(),
      `/home/runner/workspace/.test-roots/deleted-${randomUUID()}`,
    );
    const res = await request(app).post("/api/projects/import").send({ discoveryId });
    expect(res.status).toBe(422);
    expect(res.body.reason).toBe("root_not_found");
  });

  it("returns 409 'Discovery not yet complete' when importing a discovering session", async () => {
    const discoveryId = await insertReadySession(fakeResult());
    await db
      .update(discoverySessionsTable)
      .set({ status: "discovering" })
      .where(eq(discoverySessionsTable.id, discoveryId));

    const res = await request(app).post("/api/projects/import").send({ discoveryId });
    expect(res.status).toBe(409);
    expect(res.body.error).toBe("Discovery not yet complete");
  });

  it("returns 409 'Session already imported' when re-importing an already-imported session", async () => {
    const discoveryId = await insertReadySession(fakeResult());
    await db
      .update(discoverySessionsTable)
      .set({ status: "imported" })
      .where(eq(discoverySessionsTable.id, discoveryId));

    const res = await request(app).post("/api/projects/import").send({ discoveryId });
    expect(res.status).toBe(409);
    expect(res.body.error).toBe("Session already imported");
  });

  it("returns 404 for an unknown discovery session", async () => {
    const res = await request(app)
      .post("/api/projects/import")
      .send({ discoveryId: randomUUID() });
    expect(res.status).toBe(404);
    expect(res.body.error).toBe("Discovery session not found");
  });

  it("creates tasks capped at 20 from rule violations on import", async () => {
    const violations = Array.from({ length: 30 }, (_, i) => ({
      code: `RULE_${i}`,
      title: `Violation ${i}`,
      severity: "medium" as const,
      count: 1,
    }));
    const discoveryId = await insertReadySession(fakeResult({ ruleViolations: violations }));

    const res = await request(app).post("/api/projects/import").send({ discoveryId });
    expect(res.status).toBe(201);
    projectId = res.body.id;

    const tasks = await db
      .select()
      .from(tasksTable)
      .where(eq(tasksTable.projectId, res.body.id));
    expect(tasks.length).toBe(20);
  });

  it("imported project has the detected name from discovery result", async () => {
    const discoveryId = await insertReadySession(fakeResult({ detectedName: "cool-service" }));

    const res = await request(app).post("/api/projects/import").send({ discoveryId });
    expect(res.status).toBe(201);
    projectId = res.body.id;
    expect(res.body.name).toBe("cool-service");
  });

  it("accepts overrides that replace detected values", async () => {
    const discoveryId = await insertReadySession(fakeResult({ detectedName: "auto-detected" }));

    const res = await request(app)
      .post("/api/projects/import")
      .send({ discoveryId, overrides: { name: "custom-name" } });
    expect(res.status).toBe(201);
    projectId = res.body.id;
    expect(res.body.name).toBe("custom-name");
  });
});

// ─── POST /projects/import — transaction integrity ─────────────────────────────
//
// These tests prove that the import transaction is all-or-nothing:
//  • Every successful import creates exactly the right side effects.
//  • A failed import leaves no partial traces (session stays "ready").
//  • Two different sessions that share the same rootPath cannot both succeed.

describe("POST /projects/import — transaction integrity", () => {
  // Track multiple sessions/projects created in a single test.
  const createdProjectIds: string[] = [];
  const createdSessionIds: string[] = [];

  afterEach(async () => {
    for (const pid of createdProjectIds.splice(0)) {
      await db.delete(graphEntitiesTable).where(eq(graphEntitiesTable.projectId, pid)).catch(() => undefined);
      await db.delete(tasksTable).where(eq(tasksTable.projectId, pid)).catch(() => undefined);
      await db.delete(metricsTable).where(eq(metricsTable.projectId, pid)).catch(() => undefined);
      await db.delete(eventsTable).where(eq(eventsTable.projectId, pid)).catch(() => undefined);
      await db.delete(projectsTable).where(eq(projectsTable.id, pid)).catch(() => undefined);
    }
    for (const sid of createdSessionIds.splice(0)) {
      await db.delete(discoverySessionsTable).where(eq(discoverySessionsTable.id, sid)).catch(() => undefined);
    }
    // Also clear the module-level trackers used by cleanupSessionAndProject.
    await cleanupSessionAndProject();
  });

  // ── Side-effect completeness ──────────────────────────────────────────────

  it("creates exactly one metrics row per successful import", async () => {
    const discoveryId = await insertReadySession(fakeResult({ qualityScore: 72 }));
    const res = await request(app).post("/api/projects/import").send({ discoveryId });
    expect(res.status).toBe(201);
    projectId = res.body.id;

    const rows = await db.select().from(metricsTable).where(eq(metricsTable.projectId, projectId!));
    expect(rows).toHaveLength(1);
    expect(rows[0].overallScore).toBe(72);
  });

  it("creates a ProjectImported event in the same transaction", async () => {
    const discoveryId = await insertReadySession(fakeResult({ detectedName: "event-test" }));
    const res = await request(app).post("/api/projects/import").send({ discoveryId });
    expect(res.status).toBe(201);
    projectId = res.body.id;

    const events = await db
      .select()
      .from(eventsTable)
      .where(eq(eventsTable.projectId, projectId!));
    expect(events.length).toBeGreaterThanOrEqual(1);
    const importedEvent = events.find((e) => e.type === "ProjectImported");
    expect(importedEvent).toBeDefined();
    expect(importedEvent?.severity).toBe("success");
    expect(importedEvent?.message).toMatch(/event-test/);
  });

  it("imports every detectedApi, including routes beyond the former cap", async () => {
    const detectedApis = Array.from({ length: 60 }, (_, i) => `/api/route-${i}`);
    const discoveryId = await insertReadySession(fakeResult({ detectedApis }));
    const res = await request(app).post("/api/projects/import").send({ discoveryId });
    expect(res.status).toBe(201);
    projectId = res.body.id;

    const entities = await db
      .select()
      .from(graphEntitiesTable)
      .where(eq(graphEntitiesTable.projectId, projectId!));
    expect(entities).toHaveLength(detectedApis.length);
    expect(entities.every((e) => e.type === "api")).toBe(true);
    expect(entities.map((e) => e.name).sort()).toEqual([...detectedApis].sort());
  });

  it("graph entity stubs from detectedApis carry a full provenance record", async () => {
    const detectedApis = ["/api/users", "/api/orders"];
    const discoveryId = await insertReadySession(fakeResult({ detectedApis }));
    const res = await request(app).post("/api/projects/import").send({ discoveryId });
    expect(res.status).toBe(201);
    projectId = res.body.id;

    const entities = await db
      .select()
      .from(graphEntitiesTable)
      .where(eq(graphEntitiesTable.projectId, projectId!));

    expect(entities).toHaveLength(2);
    for (const e of entities) {
      // sourceType must be set — no "unknown" or null rows
      expect(e.sourceType).toBe("discovery-import");
      expect(typeof e.confidence).toBe("number");
      // provenance must be a complete record (not null, not partial)
      expect(e.provenance).not.toBeNull();
      const prov = e.provenance as {
        sourceType: string;
        method: string;
        extractedAt: string;
        evidence?: unknown[];
      };
      expect(prov.sourceType).toBe("discovery-import");
      expect(prov.method).toBe("api-route-detection");
      expect(typeof prov.extractedAt).toBe("string");
      expect(Array.isArray(prov.evidence)).toBe(true);
    }
  });

  it("creates no graph entities when detectedApis is empty", async () => {
    const discoveryId = await insertReadySession(fakeResult({ detectedApis: [] }));
    const res = await request(app).post("/api/projects/import").send({ discoveryId });
    expect(res.status).toBe(201);
    projectId = res.body.id;

    const entities = await db
      .select()
      .from(graphEntitiesTable)
      .where(eq(graphEntitiesTable.projectId, projectId!));
    expect(entities).toHaveLength(0);
  });

  it("maps rule violation severity to task priority: critical→p0, high→p1, other→p2", async () => {
    const violations = [
      { code: "A", title: "Crit", severity: "critical" as const, count: 1 },
      { code: "B", title: "High", severity: "high" as const, count: 1 },
      { code: "C", title: "Med", severity: "medium" as const, count: 1 },
    ];
    const discoveryId = await insertReadySession(fakeResult({ ruleViolations: violations }));
    const res = await request(app).post("/api/projects/import").send({ discoveryId });
    expect(res.status).toBe(201);
    projectId = res.body.id;

    const tasks = await db.select().from(tasksTable).where(eq(tasksTable.projectId, projectId!));
    const byTitle = Object.fromEntries(tasks.map((t) => [t.title, t]));
    expect(byTitle["Fix: Crit"]?.priority).toBe("p0");
    expect(byTitle["Fix: High"]?.priority).toBe("p1");
    expect(byTitle["Fix: Med"]?.priority).toBe("p2");
  });

  // ── No partial writes on failure ──────────────────────────────────────────

  it("leaves session in 'ready' state after a failed concurrent import", async () => {
    // Run two concurrent imports; the loser gets 409. The session must remain
    // accessible and still in "ready" state (or "imported" for the winner's
    // side), never in a partially-written limbo.
    const discoveryId = await insertReadySession(fakeResult());

    const [first, second] = await Promise.all([
      request(app).post("/api/projects/import").send({ discoveryId }),
      request(app).post("/api/projects/import").send({ discoveryId }),
    ]);

    const winner = first.status === 201 ? first : second;
    projectId = winner.body.id;

    // The session must be fully committed to "imported" — never stuck in a
    // partial state.
    const session = await db
      .select()
      .from(discoverySessionsTable)
      .where(eq(discoverySessionsTable.id, discoveryId))
      .limit(1);
    expect(session[0]?.status).toBe("imported");
    expect(session[0]?.importedProjectId).toBe(projectId);

    // Exactly one project row must exist.
    const projects = await db
      .select()
      .from(projectsTable)
      .where(eq(projectsTable.id, projectId!));
    expect(projects).toHaveLength(1);
  });

  it("returns 201 even when recordAudit throws after a successful import", async () => {
    // Regression: recordAudit was called *after* the transaction committed but
    // *before* res.status(201).json(), so a failing audit would suppress the
    // success response. The fix makes recordAudit best-effort (.catch()).
    const auditMod = await import("../lib/audit.js");
    vi.spyOn(auditMod, "recordAudit").mockRejectedValueOnce(new Error("audit service down"));

    const discoveryId = await insertReadySession(fakeResult({ detectedName: "audit-fail-test" }));
    const res = await request(app).post("/api/projects/import").send({ discoveryId });

    expect(res.status).toBe(201);
    expect(res.body.name).toBe("audit-fail-test");
    projectId = res.body.id;

    // The import must still be fully committed (session → imported, project row exists).
    const session = await db
      .select()
      .from(discoverySessionsTable)
      .where(eq(discoverySessionsTable.id, discoveryId))
      .limit(1);
    expect(session[0]?.status).toBe("imported");

    vi.restoreAllMocks();
  });

  it("leaves no project row after a 409 from importing an already-imported session", async () => {
    // Import once successfully, then attempt a re-import. The second attempt
    // must leave no extra project row behind (the transaction must roll back).
    const discoveryId = await insertReadySession(fakeResult());
    const first = await request(app).post("/api/projects/import").send({ discoveryId });
    expect(first.status).toBe(201);
    projectId = first.body.id;

    const second = await request(app).post("/api/projects/import").send({ discoveryId });
    expect(second.status).toBe(409);

    // Still exactly one project row.
    const rows = await db
      .select()
      .from(projectsTable)
      .where(eq(projectsTable.id, projectId!));
    expect(rows).toHaveLength(1);
  });

  // ── rootPath uniqueness — two different sessions, same rootPath ───────────

  it("rejects a second import when another project already occupies the same rootPath", async () => {
    const sharedRoot = makeSessionRootDir();

    // Session A
    const sidA = randomUUID();
    await db.insert(discoverySessionsTable).values({
      id: sidA,
      ownerId: "test-user",
      status: "ready",
      rootPath: sharedRoot,
      sourceType: "LOCAL_FOLDER",
      progress: 100,
      steps: [],
      result: fakeResult(),
      startedAt: new Date(),
      completedAt: new Date(),
    });
    createdSessionIds.push(sidA);

    // Session B — different session, same rootPath
    const sidB = randomUUID();
    await db.insert(discoverySessionsTable).values({
      id: sidB,
      ownerId: "test-user",
      status: "ready",
      rootPath: sharedRoot,
      sourceType: "LOCAL_FOLDER",
      progress: 100,
      steps: [],
      result: fakeResult(),
      startedAt: new Date(),
      completedAt: new Date(),
    });
    createdSessionIds.push(sidB);

    const resA = await request(app).post("/api/projects/import").send({ discoveryId: sidA });
    expect(resA.status).toBe(201);
    createdProjectIds.push(resA.body.id);

    // Importing B must fail — same rootPath already has a project.
    const resB = await request(app).post("/api/projects/import").send({ discoveryId: sidB });
    expect(resB.status).toBe(409);
    expect(resB.body.error).toMatch(/root path already exists/i);

    // Session B must not have been claimed (still "ready").
    const sessionB = await db
      .select()
      .from(discoverySessionsTable)
      .where(eq(discoverySessionsTable.id, sidB))
      .limit(1);
    expect(sessionB[0]?.status).toBe("ready");
    expect(sessionB[0]?.importedProjectId).toBeNull();
  });
});

describe("Git discovery → durable import", () => {
  let fixtureRoot: string | undefined;
  let restoreGitClone: (() => void) | undefined;
  let tempClonePath: string | undefined;

  afterEach(async () => {
    restoreGitClone?.();
    restoreGitClone = undefined;
    if (fixtureRoot) {
      await rm(fixtureRoot, { recursive: true, force: true });
      fixtureRoot = undefined;
    }
    await cleanupSessionAndProject();
  });

  it("materializes the clone before temp cleanup and removes it with the project", async () => {
    fixtureRoot = `/home/runner/workspace/.test-roots/git-e2e-${randomUUID()}`;
    const worktree = join(fixtureRoot, "worktree");
    const bareRepo = join(fixtureRoot, "repo.git");
    await mkdir(worktree, { recursive: true });
    await execFileAsync("git", ["init", "-q", worktree]);
    await execFileAsync("git", ["-C", worktree, "config", "user.email", "test@example.com"]);
    await execFileAsync("git", ["-C", worktree, "config", "user.name", "EngineeringOS Test"]);
    await writeFile(join(worktree, "package.json"), "{}\n");
    await writeFile(join(worktree, "README.md"), "git durable fixture\n");
    await execFileAsync("git", ["-C", worktree, "add", "."]);
    await execFileAsync("git", ["-C", worktree, "commit", "-q", "-m", "fixture"]);
    await execFileAsync("git", ["clone", "--bare", "-q", worktree, bareRepo]);
    const approvedRemoteUrl = "https://github.com/octocat/Hello-World.git";
    restoreGitClone = setGitCloneExecutorForTests(async (cloneArgs, options) => {
      expect(cloneArgs.slice(0, 3)).toEqual(["clone", "--depth", "1"]);
      expect(cloneArgs[3]).toBe(approvedRemoteUrl);
      tempClonePath = cloneArgs[4];
      if (!tempClonePath) throw new Error("Git clone destination was not provided");
      // Use the disposable local bare fixture only behind the explicit test
      // seam. The route still receives and validates the approved GitHub URL.
      await execFileAsync("git", ["clone", "--depth", "1", bareRepo, tempClonePath], options);
    });

    const start = await request(app)
      .post("/api/projects/discover")
      .send({
        sourceType: "GIT_REPOSITORY",
        sourceConfig: { url: approvedRemoteUrl },
      });
    expect(start.status).toBe(202);
    const discoveryId = start.body.id as string;
    sessionId = discoveryId;

    let session: { status: string; rootPath: string } | undefined;
    const deadline = Date.now() + 30_000;
    while (Date.now() < deadline) {
      const statusResponse = await request(app).get(`/api/projects/discover/${discoveryId}`);
      session = statusResponse.body;
      if (session?.status === "ready" || session?.status === "error") break;
      await new Promise((resolve) => setTimeout(resolve, 100));
    }

    expect(session?.status).toBe("ready");
    const [storedSession] = await db
      .select({ rootPath: discoverySessionsTable.rootPath })
      .from(discoverySessionsTable)
      .where(eq(discoverySessionsTable.id, discoveryId))
      .limit(1);
    expect(storedSession?.rootPath.startsWith(`${MANAGED_PROJECT_ROOTS_DIR}/`)).toBe(true);
    await expect(access(storedSession!.rootPath)).resolves.toBeUndefined();
    expect(tempClonePath).toBeDefined();
    await expect(access(tempClonePath!)).rejects.toThrow();

    const imported = await request(app)
      .post("/api/projects/import")
      .send({ discoveryId });
    expect(imported.status).toBe(201);
    projectId = imported.body.id;
    expect(imported.body.rootPath).toBe(storedSession!.rootPath);
    expect(imported.body.rootPath).toContain(MANAGED_PROJECT_ROOTS_DIR);

    const deleted = await request(app).delete(`/api/projects/${projectId}`);
    expect(deleted.status).toBe(204);
    await expect(access(storedSession!.rootPath)).rejects.toThrow();
  });
});
