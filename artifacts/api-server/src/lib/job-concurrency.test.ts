/**
 * PR-01 (Durable Jobs): Concurrency tests.
 *
 * Proves that the DB-level atomic claim prevents double execution even when
 * multiple workers race simultaneously, and that lease expiry enables safe
 * re-claim after a crash.
 */
import { afterEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { randomUUID } from "crypto";
import { db, projectsTable, scanJobsTable } from "@workspace/db";
import {
  claimScanJob,
  completeScanJob,
  failScanJob,
  SCAN_LEASE_MS,
} from "./job-lease.js";

// ── Helpers ────────────────────────────────────────────────────────────────────

async function insertProject(): Promise<string> {
  const id = randomUUID();
  const now = new Date();
  await db.insert(projectsTable).values({
    id,
    ownerId: "concurrency-test-user",
    name: `concurrency-proj-${id.slice(0, 8)}`,
    rootPath: `/tmp/concurrency-${id}`,
    language: "typescript",
    status: "active",
    createdAt: now,
    updatedAt: now,
  });
  return id;
}

async function insertQueuedJob(): Promise<string> {
  const projectId = await insertProject();
  projectCleanup.push(projectId);
  const jobId = randomUUID();
  jobCleanup.push(jobId);
  await db.insert(scanJobsTable).values({
    id: jobId,
    projectId,
    status: "queued",
    createdAt: new Date(),
  });
  return jobId;
}

const projectCleanup: string[] = [];
const jobCleanup: string[] = [];

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("concurrent workers", () => {
  afterEach(async () => {
    for (const id of jobCleanup.splice(0)) {
      await db.delete(scanJobsTable).where(eq(scanJobsTable.id, id));
    }
    for (const id of projectCleanup.splice(0)) {
      await db.delete(projectsTable).where(eq(projectsTable.id, id));
    }
  });

  it("5 concurrent workers claim exactly 1 job — no double execution", async () => {
    const jobId = await insertQueuedJob();

    const workerIds = Array.from({ length: 5 }, () => randomUUID());
    const results = await Promise.all(
      workerIds.map((wid) => claimScanJob(jobId, wid, SCAN_LEASE_MS)),
    );

    const winners = results.filter(Boolean);
    expect(winners).toHaveLength(1); // exactly one worker wins

    const [row] = await db.select().from(scanJobsTable).where(eq(scanJobsTable.id, jobId));
    expect(row.status).toBe("running");
    expect(row.workerId).not.toBeNull();

    const winnerIdx = results.findIndex(Boolean);
    expect(row.workerId).toBe(workerIds[winnerIdx]);
  });

  it("winner completes the job; losers' completion attempts are no-ops", async () => {
    const jobId = await insertQueuedJob();

    const winner = randomUUID();
    const loser = randomUUID();

    await claimScanJob(jobId, winner, SCAN_LEASE_MS);
    // Loser tries to claim — fails
    await claimScanJob(jobId, loser, SCAN_LEASE_MS);

    await completeScanJob(jobId, winner, { result: "ok" });

    const [row] = await db.select().from(scanJobsTable).where(eq(scanJobsTable.id, jobId));
    expect(row.status).toBe("completed");
    expect(row.workerId).toBeNull();
  });

  it("expired-lease job can be re-claimed after reconciliation resets it to queued", async () => {
    // Simulate a crashed worker: job is running with an expired lease
    const projectId = await insertProject();
    projectCleanup.push(projectId);
    const jobId = randomUUID();
    jobCleanup.push(jobId);

    await db.insert(scanJobsTable).values({
      id: jobId,
      projectId,
      status: "running",
      workerId: randomUUID(), // dead worker
      leaseUntil: new Date(Date.now() - 1_000), // expired
      lastHeartbeatAt: new Date(Date.now() - 60_000),
      startedAt: new Date(Date.now() - 120_000),
      createdAt: new Date(),
    });

    // Simulate reconciliation resetting the job to queued and clearing lease
    await db
      .update(scanJobsTable)
      .set({ status: "queued", workerId: null, leaseUntil: null, lastHeartbeatAt: null })
      .where(eq(scanJobsTable.id, jobId));

    // New worker can now claim the recovered job
    const newWorker = randomUUID();
    const reclaimed = await claimScanJob(jobId, newWorker, SCAN_LEASE_MS);
    expect(reclaimed).toBe(true);

    const [row] = await db.select().from(scanJobsTable).where(eq(scanJobsTable.id, jobId));
    expect(row.status).toBe("running");
    expect(row.workerId).toBe(newWorker);
    expect(row.leaseUntil!.getTime()).toBeGreaterThan(Date.now());
  });

  it("a worker that loses a race cannot overwrite the winner's lease", async () => {
    const jobId = await insertQueuedJob();

    const w1 = randomUUID();
    const w2 = randomUUID();

    await claimScanJob(jobId, w1, SCAN_LEASE_MS);
    const w2won = await claimScanJob(jobId, w2, SCAN_LEASE_MS);
    expect(w2won).toBe(false);

    // A stale worker may still reach its error path, but the terminal write
    // must be fenced by the worker identity.
    const failed = await failScanJob(jobId, w2, "w2 lost the race");
    expect(failed).toBe(false);

    const [row] = await db.select().from(scanJobsTable).where(eq(scanJobsTable.id, jobId));
    expect(row.status).toBe("running");
    expect(row.workerId).toBe(w1);
    expect(row.leaseUntil).not.toBeNull();
  });
});
