/**
 * PR-01 (Durable Jobs): Startup recovery tests.
 *
 * Verifies that jobs left in non-terminal states after a simulated process
 * crash are correctly handled by reconcileStuckJobs — the function that runs
 * before the server accepts traffic on each restart.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { eq } from "drizzle-orm";
import { randomUUID } from "crypto";
import {
  db,
  projectsTable,
  scanJobsTable,
  discoverySessionsTable,
} from "@workspace/db";
import { reconcileStuckJobs } from "./job-reconciliation.js";
import { SCAN_LEASE_MS, DISCOVERY_LEASE_MS } from "./job-lease.js";

// ── Mocks ─────────────────────────────────────────────────────────────────────

vi.mock("./job-queue.js", () => ({
  heavyJobQueue: {
    enqueue: vi.fn(),
    enqueueWithId: vi.fn().mockReturnValue(true),
    has: vi.fn().mockReturnValue(false),
  },
}));

vi.mock("@workspace/ai-orchestrator", () => ({
  invalidateContextCache: vi.fn(),
}));

// ── Helpers ────────────────────────────────────────────────────────────────────

async function insertProject(status: "active" | "scanning" = "active"): Promise<string> {
  const id = randomUUID();
  const now = new Date();
  await db.insert(projectsTable).values({
    id,
    ownerId: "recovery-test-user",
    name: `recovery-proj-${id.slice(0, 8)}`,
    rootPath: `/tmp/recovery-${id}`,
    language: "typescript",
    status,
    createdAt: now,
    updatedAt: now,
  });
  return id;
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("recovery: jobs with expired leases after crash", () => {
  const projectCleanup: string[] = [];
  const sessionCleanup: string[] = [];

  afterEach(async () => {
    vi.clearAllMocks();
    for (const id of projectCleanup.splice(0)) {
      await db.delete(scanJobsTable).where(eq(scanJobsTable.projectId, id));
      await db.delete(projectsTable).where(eq(projectsTable.id, id));
    }
    for (const id of sessionCleanup.splice(0)) {
      await db.delete(discoverySessionsTable).where(eq(discoverySessionsTable.id, id));
    }
  });

  it("a running scan job with an expired lease is marked failed and lease cleared", async () => {
    const projectId = await insertProject("scanning");
    projectCleanup.push(projectId);

    const jobId = randomUUID();
    await db.insert(scanJobsTable).values({
      id: jobId,
      projectId,
      status: "running",
      workerId: randomUUID(),
      leaseUntil: new Date(Date.now() - 1_000),   // expired 1 s ago
      lastHeartbeatAt: new Date(Date.now() - 10_000),
      startedAt: new Date(Date.now() - 10_000),
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    await reconcileStuckJobs();

    const [row] = await db.select().from(scanJobsTable).where(eq(scanJobsTable.id, jobId));
    expect(row.status).toBe("failed");
    expect(row.workerId).toBeNull();
    expect(row.leaseUntil).toBeNull();
  });

  it("a queued scan job is re-enqueued on recovery — never lost", async () => {
    const { heavyJobQueue } = await import("./job-queue.js");
    const projectId = await insertProject("scanning");
    projectCleanup.push(projectId);

    const jobId = randomUUID();
    await db.insert(scanJobsTable).values({
      id: jobId,
      projectId,
      status: "queued",
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    await reconcileStuckJobs();

    expect(vi.mocked(heavyJobQueue.enqueueWithId)).toHaveBeenCalledWith(
      jobId,
      expect.any(Function),
    );
  });

  it("a discovering session with an expired lease is marked error on recovery", async () => {
    const sessionId = randomUUID();
    sessionCleanup.push(sessionId);

    await db.insert(discoverySessionsTable).values({
      id: sessionId,
      ownerId: "recovery-test-user",
      rootPath: `/tmp/discovery-${sessionId}`,
      status: "discovering",
      workerId: randomUUID(),
      leaseUntil: new Date(Date.now() - 1_000),
      lastHeartbeatAt: new Date(Date.now() - 10_000),
      progress: 40,
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    await reconcileStuckJobs();

    const [row] = await db
      .select()
      .from(discoverySessionsTable)
      .where(eq(discoverySessionsTable.id, sessionId));
    expect(row.status).toBe("error");
    expect(row.workerId).toBeNull();
  });

  it("a running scan job with an active (non-expired) lease is NOT touched by recovery", async () => {
    const projectId = await insertProject("scanning");
    projectCleanup.push(projectId);

    const jobId = randomUUID();
    await db.insert(scanJobsTable).values({
      id: jobId,
      projectId,
      status: "running",
      workerId: randomUUID(),
      leaseUntil: new Date(Date.now() + SCAN_LEASE_MS), // valid lease
      lastHeartbeatAt: new Date(),
      startedAt: new Date(),
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    await reconcileStuckJobs();

    const [row] = await db.select().from(scanJobsTable).where(eq(scanJobsTable.id, jobId));
    // Lease is still valid — must not be failed or modified
    expect(row.status).toBe("running");
    expect(row.workerId).not.toBeNull();
  });

  it("a pending discovery session is re-enqueued on recovery", async () => {
    const { heavyJobQueue } = await import("./job-queue.js");
    const sessionId = randomUUID();
    sessionCleanup.push(sessionId);

    await db.insert(discoverySessionsTable).values({
      id: sessionId,
      ownerId: "recovery-test-user",
      rootPath: `/tmp/discovery-${sessionId}`,
      status: "pending",
      progress: 0,
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    await reconcileStuckJobs();

    expect(vi.mocked(heavyJobQueue.enqueueWithId)).toHaveBeenCalledWith(
      sessionId,
      expect.any(Function),
    );
  });
});
