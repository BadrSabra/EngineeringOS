import { afterEach, describe, expect, it, vi } from "vitest";
import { eq } from "drizzle-orm";
import { randomUUID } from "crypto";
import { db, projectsTable, scanJobsTable, discoverySessionsTable, tasksTable, taskLogsTable } from "@workspace/db";
import { reconcileStuckJobs } from "./job-reconciliation.js";

// ── Mocks ─────────────────────────────────────────────────────────────────────

// Prevent the in-memory job queue from actually executing enqueued closures
// during reconciliation tests. Without this mock, re-enqueued scan/discovery
// jobs would run against nonexistent test paths and race with the assertions.
vi.mock("./job-queue.js", () => ({
  heavyJobQueue: { enqueue: vi.fn() },
}));
import { heavyJobQueue } from "./job-queue.js";

// PR-03: Replace @workspace/ai-orchestrator with a spy so we can assert that
// invalidateContextCache is called for every reconciled project without
// needing a live context-builder instance.
vi.mock("@workspace/ai-orchestrator", () => ({
  invalidateContextCache: vi.fn(),
}));
import { invalidateContextCache } from "@workspace/ai-orchestrator";

// ── Helpers ───────────────────────────────────────────────────────────────────

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

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("reconcileStuckJobs", () => {
  const projectCleanup: string[] = [];
  const sessionCleanup: string[] = [];

  afterEach(async () => {
    vi.mocked(heavyJobQueue.enqueue).mockClear();
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

  // ── Scan jobs: running → failed ─────────────────────────────────────────────

  it("marks running scan jobs as failed and resets the project to active", async () => {
    const projectId = await insertProject("scanning");
    projectCleanup.push(projectId);

    const runningJobId = randomUUID();
    const now = new Date();
    await db.insert(scanJobsTable).values({
      id: runningJobId,
      projectId,
      status: "running",
      // PR-01: set retryCount === maxRetries so this job hits the permanent-fail
      // path rather than being re-enqueued for another attempt.
      retryCount: 2,
      maxRetries: 2,
      createdAt: now,
      startedAt: now,
    });

    const result = await reconcileStuckJobs();
    expect(result.scanJobs).toBeGreaterThanOrEqual(1);

    const job = await db
      .select()
      .from(scanJobsTable)
      .where(eq(scanJobsTable.id, runningJobId))
      .limit(1);
    expect(job[0]?.status).toBe("failed");
    expect(job[0]?.error).toBeTruthy();
    expect(job[0]?.finishedAt).not.toBeNull();

    const project = await db
      .select()
      .from(projectsTable)
      .where(eq(projectsTable.id, projectId))
      .limit(1);
    expect(project[0]?.status).toBe("active");
  });

  // ── Scan jobs: queued → re-enqueued ────────────────────────────────────────

  it("re-enqueues queued scan jobs without marking them failed", async () => {
    const projectId = await insertProject("scanning");
    projectCleanup.push(projectId);

    const queuedJobId = randomUUID();
    await db.insert(scanJobsTable).values({
      id: queuedJobId,
      projectId,
      status: "queued",
      createdAt: new Date(),
    });

    const result = await reconcileStuckJobs();
    expect(result.scanJobs).toBeGreaterThanOrEqual(1);

    // The job should still be "queued" in the DB (enqueue is mocked, so
    // runScanJob never runs and never updates the row).
    const job = await db
      .select()
      .from(scanJobsTable)
      .where(eq(scanJobsTable.id, queuedJobId))
      .limit(1);
    expect(job[0]?.status).toBe("queued");
    expect(job[0]?.error).toBeNull();

    // The project should still be "scanning" (job is going to run).
    const project = await db
      .select()
      .from(projectsTable)
      .where(eq(projectsTable.id, projectId))
      .limit(1);
    expect(project[0]?.status).toBe("scanning");

    // The heavy job queue should have been asked to enqueue exactly one job.
    expect(vi.mocked(heavyJobQueue.enqueue)).toHaveBeenCalledTimes(1);
  });

  // ── Scan jobs: completed → untouched ───────────────────────────────────────

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

  // ── Discovery sessions: discovering → error ────────────────────────────────

  it("marks orphaned discovering sessions as errored", async () => {
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

  // ── Discovery sessions: pending → re-enqueued ─────────────────────────────

  it("re-enqueues pending discovery sessions without marking them errored", async () => {
    const sessionId = randomUUID();
    await db.insert(discoverySessionsTable).values({
      id: sessionId,
      ownerId: "test-user",
      status: "pending",
      rootPath: "/tmp/reconcile-pending-discovery",
      sourceType: "LOCAL_FOLDER",
      progress: 0,
      currentStep: "Finding repository",
      steps: [],
      startedAt: new Date(),
    });
    sessionCleanup.push(sessionId);

    const result = await reconcileStuckJobs();
    expect(result.discoverySessions).toBeGreaterThanOrEqual(1);

    // Session should remain "pending" in the DB — the queue is mocked so
    // runDiscovery never runs and never transitions it to "discovering".
    const session = await db
      .select()
      .from(discoverySessionsTable)
      .where(eq(discoverySessionsTable.id, sessionId))
      .limit(1);
    expect(session[0]?.status).toBe("pending");
    expect(session[0]?.error).toBeNull();

    // The heavy job queue must have been asked to enqueue a runner for this session.
    expect(vi.mocked(heavyJobQueue.enqueue)).toHaveBeenCalled();
  });

  // ── Cache invalidation ─────────────────────────────────────────────────────

  // PR-03: verify cache invalidation is triggered for every project whose
  // running scan job is reconciled (running → failed path only; re-enqueued
  // jobs are not invalidated at reconciliation time — they will invalidate
  // once they complete via runScanJob's normal completion path).
  it("calls invalidateContextCache for each project whose running scan job was failed", async () => {
    vi.mocked(invalidateContextCache).mockClear();

    const projectId = await insertProject("scanning");
    projectCleanup.push(projectId);

    const now = new Date();
    await db.insert(scanJobsTable).values({
      id: randomUUID(),
      projectId,
      status: "running",
      // PR-01: set retryCount === maxRetries so the job is permanently failed
      // (and invalidateContextCache is called) rather than re-enqueued.
      retryCount: 2,
      maxRetries: 2,
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

  // ── Terminal sessions: untouched ───────────────────────────────────────────

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

  // ── AI tasks: running → verifying (retryable) ─────────────────────────────

  it("resets running AI tasks to verifying when retryCount < maxRetries", async () => {
    const projectId = await insertProject("active");
    projectCleanup.push(projectId);

    const taskId = randomUUID();
    const now = new Date();
    await db.insert(tasksTable).values({
      id: taskId,
      projectId,
      title: "reconcile-test-task",
      status: "running",
      retryCount: 1,
      maxRetries: 3,
      createdAt: now,
      updatedAt: now,
    });

    const result = await reconcileStuckJobs();
    expect(result.aiTasks).toBeGreaterThanOrEqual(1);

    const task = await db
      .select()
      .from(tasksTable)
      .where(eq(tasksTable.id, taskId))
      .limit(1);
    expect(task[0]?.status).toBe("verifying");
    // retryCount must be incremented so we eventually give up
    expect(task[0]?.retryCount).toBe(2);

    // A task_log entry must have been written
    const logs = await db
      .select()
      .from(taskLogsTable)
      .where(eq(taskLogsTable.taskId, taskId));
    expect(logs.length).toBeGreaterThan(0);
    expect(logs[0]?.level).toBe("warn");

    // Cleanup
    await db.delete(taskLogsTable).where(eq(taskLogsTable.taskId, taskId));
    await db.delete(tasksTable).where(eq(tasksTable.id, taskId));
  });

  // ── AI tasks: running → failed (retry limit exceeded) ─────────────────────

  it("marks running AI tasks as failed when retryCount >= maxRetries", async () => {
    vi.mocked(invalidateContextCache).mockClear();

    const projectId = await insertProject("active");
    projectCleanup.push(projectId);

    const taskId = randomUUID();
    const now = new Date();
    await db.insert(tasksTable).values({
      id: taskId,
      projectId,
      title: "reconcile-test-task-exhausted",
      status: "running",
      retryCount: 3,
      maxRetries: 3,
      createdAt: now,
      updatedAt: now,
    });

    const result = await reconcileStuckJobs();
    expect(result.aiTasks).toBeGreaterThanOrEqual(1);

    const task = await db
      .select()
      .from(tasksTable)
      .where(eq(tasksTable.id, taskId))
      .limit(1);
    expect(task[0]?.status).toBe("failed");
    expect(task[0]?.completedAt).not.toBeNull();

    // Cache must be busted so the AI context doesn't serve stale state
    expect(vi.mocked(invalidateContextCache)).toHaveBeenCalledWith(projectId);

    // A task_log error entry must have been written
    const logs = await db
      .select()
      .from(taskLogsTable)
      .where(eq(taskLogsTable.taskId, taskId));
    expect(logs.length).toBeGreaterThan(0);
    expect(logs[0]?.level).toBe("error");

    // Cleanup
    await db.delete(taskLogsTable).where(eq(taskLogsTable.taskId, taskId));
    await db.delete(tasksTable).where(eq(tasksTable.id, taskId));
  });

  // ── AI tasks: terminal states untouched ───────────────────────────────────

  it("does not touch AI tasks in terminal states (completed, failed, pending)", async () => {
    const projectId = await insertProject("active");
    projectCleanup.push(projectId);

    const now = new Date();
    const completedId = randomUUID();
    const failedId = randomUUID();
    const pendingId = randomUUID();

    await db.insert(tasksTable).values([
      { id: completedId, projectId, title: "completed-task", status: "completed", createdAt: now, updatedAt: now, completedAt: now },
      { id: failedId,    projectId, title: "failed-task",    status: "failed",    createdAt: now, updatedAt: now, completedAt: now },
      { id: pendingId,   projectId, title: "pending-task",   status: "pending",   createdAt: now, updatedAt: now },
    ]);

    await reconcileStuckJobs();

    const tasks = await db
      .select({ id: tasksTable.id, status: tasksTable.status })
      .from(tasksTable)
      .where(eq(tasksTable.projectId, projectId));

    const byId = Object.fromEntries(tasks.map((t) => [t.id, t.status]));
    expect(byId[completedId]).toBe("completed");
    expect(byId[failedId]).toBe("failed");
    expect(byId[pendingId]).toBe("pending");

    // Cleanup
    await db.delete(tasksTable).where(eq(tasksTable.projectId, projectId));
  });
});
