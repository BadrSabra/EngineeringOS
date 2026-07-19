import { afterEach, describe, expect, it, vi } from "vitest";
import { eq } from "drizzle-orm";
import { randomUUID } from "crypto";
import { db, projectsTable, scanJobsTable, discoverySessionsTable } from "@workspace/db";
import { reconcileStuckJobs } from "./job-reconciliation.js";

// ── PR-03: cache invalidation spy ─────────────────────────────────────────────
// Replace @workspace/ai-orchestrator with a spy so we can assert that
// invalidateContextCache is called for every reconciled project without
// needing a live context-builder instance.  The existing DB-integration
// tests are unaffected because they don't touch this package.
vi.mock("@workspace/ai-orchestrator", () => ({
  invalidateContextCache: vi.fn(),
}));
import { invalidateContextCache } from "@workspace/ai-orchestrator";

async function insertProject(status: "active" | "scanning"): Promise<string> {
  const id = randomUUID();
  const now = new Date();
  await db.insert(projectsTable).values({
    id,
    ownerId: "test-user",
    name: `reconcile-test-${id.slice(0, 8)}`,
    rootPath: `/tmp/reconcile-test-${id}`,
    language: "typescript",
    status,
    createdAt: now,
    updatedAt: now,
  });
  return id;
}

describe("reconcileStuckJobs", () => {
  const projectCleanup: string[] = [];
  const sessionCleanup: string[] = [];

  afterEach(async () => {
    while (projectCleanup.length > 0) {
      const id = projectCleanup.pop();
      if (id) {
        await db.delete(scanJobsTable).where(eq(scanJobsTable.projectId, id));
        await db.delete(projectsTable).where(eq(projectsTable.id, id));
      }
    }
    while (sessionCleanup.length > 0) {
      const id = sessionCleanup.pop();
      if (id) await db.delete(discoverySessionsTable).where(eq(discoverySessionsTable.id, id));
    }
  });

  it("marks orphaned queued/running scan jobs failed and resets the project to active", async () => {
    const projectId = await insertProject("scanning");
    projectCleanup.push(projectId);

    const runningJobId = randomUUID();
    const queuedJobId = randomUUID();
    const now = new Date();
    await db.insert(scanJobsTable).values([
      { id: runningJobId, projectId, status: "running", createdAt: now, startedAt: now },
      { id: queuedJobId, projectId, status: "queued", createdAt: now },
    ]);

    const result = await reconcileStuckJobs();
    expect(result.scanJobs).toBeGreaterThanOrEqual(2);

    const jobs = await db
      .select()
      .from(scanJobsTable)
      .where(eq(scanJobsTable.projectId, projectId));
    for (const job of jobs) {
      expect(job.status).toBe("failed");
      expect(job.error).toBeTruthy();
      expect(job.finishedAt).not.toBeNull();
    }

    const project = await db
      .select()
      .from(projectsTable)
      .where(eq(projectsTable.id, projectId))
      .limit(1);
    expect(project[0]?.status).toBe("active");
  });

  it("does not touch scan jobs that already finished", async () => {
    const projectId = await insertProject("active");
    projectCleanup.push(projectId);

    const completedJobId = randomUUID();
    const now = new Date();
    await db.insert(scanJobsTable).values({
      id: completedJobId,
      projectId,
      status: "completed",
      createdAt: now,
      startedAt: now,
      finishedAt: now,
    });

    await reconcileStuckJobs();

    const job = await db
      .select()
      .from(scanJobsTable)
      .where(eq(scanJobsTable.id, completedJobId))
      .limit(1);
    expect(job[0]?.status).toBe("completed");
    expect(job[0]?.error).toBeNull();
  });

  it("marks orphaned discovery sessions as errored", async () => {
    const sessionId = randomUUID();
    await db.insert(discoverySessionsTable).values({
      id: sessionId,
      ownerId: "test-user",
      status: "discovering",
      rootPath: "/tmp/reconcile-discovery-test",
      sourceType: "LOCAL_FOLDER",
      progress: 40,
      currentStep: "Scanning source tree",
      steps: [],
      startedAt: new Date(),
    });
    sessionCleanup.push(sessionId);

    const result = await reconcileStuckJobs();
    expect(result.discoverySessions).toBeGreaterThanOrEqual(1);

    const session = await db
      .select()
      .from(discoverySessionsTable)
      .where(eq(discoverySessionsTable.id, sessionId))
      .limit(1);
    expect(session[0]?.status).toBe("error");
    expect(session[0]?.error).toBeTruthy();
    expect(session[0]?.completedAt).not.toBeNull();
  });

  // PR-03: verify cache invalidation is triggered for every reconciled project
  it("calls invalidateContextCache for each project whose scan job was reconciled", async () => {
    vi.mocked(invalidateContextCache).mockClear();

    const projectId = await insertProject("scanning");
    projectCleanup.push(projectId);

    const now = new Date();
    await db.insert(scanJobsTable).values({
      id: randomUUID(),
      projectId,
      status: "running",
      createdAt: now,
      startedAt: now,
    });

    await reconcileStuckJobs();

    expect(vi.mocked(invalidateContextCache)).toHaveBeenCalledWith(projectId);
  });

  it("does not call invalidateContextCache when there are no stuck jobs", async () => {
    vi.mocked(invalidateContextCache).mockClear();
    // Insert a project with a completed job — nothing to reconcile.
    const projectId = await insertProject("active");
    projectCleanup.push(projectId);
    const now = new Date();
    await db.insert(scanJobsTable).values({
      id: randomUUID(),
      projectId,
      status: "completed",
      createdAt: now,
      startedAt: now,
      finishedAt: now,
    });

    await reconcileStuckJobs();

    expect(vi.mocked(invalidateContextCache)).not.toHaveBeenCalledWith(projectId);
  });

  it("leaves ready/imported discovery sessions untouched", async () => {
    const sessionId = randomUUID();
    await db.insert(discoverySessionsTable).values({
      id: sessionId,
      ownerId: "test-user",
      status: "ready",
      rootPath: "/tmp/reconcile-discovery-ready",
      sourceType: "LOCAL_FOLDER",
      progress: 100,
      currentStep: null,
      steps: [],
      startedAt: new Date(),
      completedAt: new Date(),
    });
    sessionCleanup.push(sessionId);

    await reconcileStuckJobs();

    const session = await db
      .select()
      .from(discoverySessionsTable)
      .where(eq(discoverySessionsTable.id, sessionId))
      .limit(1);
    expect(session[0]?.status).toBe("ready");
  });
});
