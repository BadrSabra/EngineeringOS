import { afterEach, describe, expect, it, vi } from "vitest";
import { eq, sql } from "drizzle-orm";
import { randomUUID } from "node:crypto";
import { db, projectBootstrapJobsTable } from "@workspace/db";
import {
  assertProjectBootstrapWorkerLease,
  claimProjectBootstrapJob,
  heartbeatProjectBootstrapJob,
  PROJECT_BOOTSTRAP_LEASE_MS,
} from "./project-bootstrap-lease.js";

const cleanupQueue: string[] = [];

afterEach(async () => {
  vi.unstubAllGlobals();
  for (const id of cleanupQueue.splice(0)) {
    await db.delete(projectBootstrapJobsTable)
      .where(eq(projectBootstrapJobsTable.id, id));
  }
});

async function insertQueuedJob(): Promise<string> {
  const id = randomUUID();
  cleanupQueue.push(id);
  await db.insert(projectBootstrapJobsTable).values({
    id,
    ownerId: "bootstrap-lease-test-user",
    idempotencyKey: randomUUID(),
    name: "bootstrap-lease-test",
    description: "",
    templateVersion: "react-vite-v1",
    status: "queued",
    attempt: 0,
    maxAttempts: 3,
  });
  return id;
}

describe("project bootstrap database-clock leases", () => {
  it("claims and validates a lease independently of a worker wall-clock skew", async () => {
    const jobId = await insertQueuedJob();
    const workerId = randomUUID();
    const [before] = await db.select({
      now: sql<Date>`clock_timestamp() AT TIME ZONE 'UTC'`,
    });

    const RealDate = globalThis.Date;
    class FutureClockDate extends RealDate {
      constructor(...args: [] | [string | number]) {
        if (args.length === 0) super("2099-01-01T00:00:00.000Z");
        else super(args[0]);
      }
      static now(): number {
        return RealDate.parse("2099-01-01T00:00:00.000Z");
      }
    }
    vi.stubGlobal("Date", FutureClockDate);

    expect(await claimProjectBootstrapJob(jobId, workerId)).toBeDefined();
    await expect(assertProjectBootstrapWorkerLease(jobId, workerId)).resolves.toBeUndefined();
    expect(await heartbeatProjectBootstrapJob(jobId, workerId)).toBe(true);

    const [row] = await db.select({
      status: projectBootstrapJobsTable.status,
      workerId: projectBootstrapJobsTable.workerId,
      leaseUntil: projectBootstrapJobsTable.leaseUntil,
    }).from(projectBootstrapJobsTable)
      .where(eq(projectBootstrapJobsTable.id, jobId));
    const leaseDeltaMs = row.leaseUntil!.getTime() - before.now.getTime();

    expect(row.status).toBe("running");
    expect(row.workerId).toBe(workerId);
    expect(leaseDeltaMs).toBeGreaterThan(0);
    expect(leaseDeltaMs).toBeLessThanOrEqual(PROJECT_BOOTSTRAP_LEASE_MS + 5_000);
  });

  it("does not renew or validate a lease after PostgreSQL says it expired", async () => {
    const jobId = await insertQueuedJob();
    const workerId = randomUUID();
    expect(await claimProjectBootstrapJob(jobId, workerId)).toBeDefined();

    await db.update(projectBootstrapJobsTable)
      .set({
        leaseUntil: sql<Date>`(clock_timestamp() AT TIME ZONE 'UTC') - interval '1 millisecond'`,
      })
      .where(eq(projectBootstrapJobsTable.id, jobId));

    expect(await heartbeatProjectBootstrapJob(jobId, workerId)).toBe(false);
    await expect(assertProjectBootstrapWorkerLease(jobId, workerId))
      .rejects.toMatchObject({ name: "ProjectBootstrapLeaseLost" });
  });

  it("does not let a different worker extend the active lease", async () => {
    const jobId = await insertQueuedJob();
    const workerId = randomUUID();
    expect(await claimProjectBootstrapJob(jobId, workerId)).toBeDefined();

    const [before] = await db.select({
      leaseUntil: projectBootstrapJobsTable.leaseUntil,
    }).from(projectBootstrapJobsTable)
      .where(eq(projectBootstrapJobsTable.id, jobId));

    expect(await heartbeatProjectBootstrapJob(jobId, randomUUID())).toBe(false);

    const [after] = await db.select({
      leaseUntil: projectBootstrapJobsTable.leaseUntil,
    }).from(projectBootstrapJobsTable)
      .where(eq(projectBootstrapJobsTable.id, jobId));
    expect(after.leaseUntil?.getTime()).toBe(before.leaseUntil?.getTime());
  });
});
