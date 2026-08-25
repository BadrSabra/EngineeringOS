/**
 * PR-01 (Durable Jobs): Idempotency tests.
 *
 * Proves that a job enqueued multiple times (e.g. due to a retry or a race)
 * is executed at most once — the claim gate in job-lease.ts prevents
 * double execution.
 */
import { afterEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { randomUUID } from "crypto";
import { db, projectsTable, scanJobsTable } from "@workspace/db";
import { claimScanJob, completeScanJob, failScanJob, SCAN_LEASE_MS } from "./job-lease.js";

// ── Helpers ────────────────────────────────────────────────────────────────────

async function insertProject(): Promise<string> {
  const id = randomUUID();
  const now = new Date();
  await db.insert(projectsTable).values({
    id,
    ownerId: "idempotency-test-user",
    name: `idempotency-proj-${id.slice(0, 8)}`,
    rootPath: `/tmp/idempotency-${id}`,
    language: "typescript",
    status: "active",
    createdAt: now,
    updatedAt: now,
  });
  return id;
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("job idempotency", () => {
  const projectCleanup: string[] = [];
  const jobCleanup: string[] = [];

  afterEach(async () => {
    for (const id of jobCleanup.splice(0)) {
      await db.delete(scanJobsTable).where(eq(scanJobsTable.id, id));
    }
    for (const id of projectCleanup.splice(0)) {
      await db.delete(projectsTable).where(eq(projectsTable.id, id));
    }
  });

  async function insertQueuedJob(): Promise<{ jobId: string; projectId: string }> {
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
    return { jobId, projectId };
  }

  it("second claim attempt on the same job is rejected — only one worker executes", async () => {
    const { jobId } = await insertQueuedJob();

    const w1 = randomUUID();
    const w2 = randomUUID();

    const first = await claimScanJob(jobId, w1, SCAN_LEASE_MS);
    const second = await claimScanJob(jobId, w2, SCAN_LEASE_MS);

    expect(first).toBe(true);
    expect(second).toBe(false);

    const [row] = await db.select().from(scanJobsTable).where(eq(scanJobsTable.id, jobId));
    // Only w1's workerId should be on the row
    expect(row.workerId).toBe(w1);
  });

  it("a completed job cannot be claimed again", async () => {
    const { jobId } = await insertQueuedJob();

    const workerId = randomUUID();
    await claimScanJob(jobId, workerId, SCAN_LEASE_MS);
    await completeScanJob(jobId, workerId, { summary: "done" });

    const reclaimed = await claimScanJob(jobId, randomUUID(), SCAN_LEASE_MS);
    expect(reclaimed).toBe(false);

    const [row] = await db.select().from(scanJobsTable).where(eq(scanJobsTable.id, jobId));
    expect(row.status).toBe("completed");
    expect(row.workerId).toBeNull();
  });

  it("a failed job cannot be claimed again", async () => {
    const { jobId } = await insertQueuedJob();

    const workerId = randomUUID();
    await claimScanJob(jobId, workerId, SCAN_LEASE_MS);
    await failScanJob(jobId, workerId, "test failure");

    const reclaimed = await claimScanJob(jobId, randomUUID(), SCAN_LEASE_MS);
    expect(reclaimed).toBe(false);

    const [row] = await db.select().from(scanJobsTable).where(eq(scanJobsTable.id, jobId));
    expect(row.status).toBe("failed");
    expect(row.workerId).toBeNull();
  });

  it("a running job (with valid lease) cannot be claimed by another worker", async () => {
    const { jobId } = await insertQueuedJob();

    const w1 = randomUUID();
    await claimScanJob(jobId, w1, SCAN_LEASE_MS);

    // w1 is still running (lease is valid) — w2 must not steal the job
    const w2 = randomUUID();
    const stolen = await claimScanJob(jobId, w2, SCAN_LEASE_MS);
    expect(stolen).toBe(false);

    const [row] = await db.select().from(scanJobsTable).where(eq(scanJobsTable.id, jobId));
    expect(row.workerId).toBe(w1);
  });
});
