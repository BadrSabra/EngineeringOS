import { afterEach, describe, expect, it, vi } from "vitest";
import { and, eq, gt } from "drizzle-orm";
import {
  db,
  eventsTable,
  projectsTable,
  scanJobsTable,
} from "@workspace/db";
import { randomUUID } from "node:crypto";
import { databaseNow } from "./job-lease.js";
import { terminalizeFailedScanJob } from "./scan-runner.js";
import { LockNamespace, tryAdvisoryLock } from "./advisory-lock.js";
import { queuePostPushScan } from "./post-push-scan.js";

const projectIds: string[] = [];
const heldLocks: Array<{ release(): Promise<void> }> = [];

async function insertProject(status: "active" | "scanning" = "active"): Promise<string> {
  const id = randomUUID();
  const now = new Date();
  projectIds.push(id);
  await db.insert(projectsTable).values({
    id,
    ownerId: "post-push-scan-test-user",
    name: `post-push-scan-${id.slice(0, 8)}`,
    rootPath: `/tmp/post-push-scan-${id}`,
    language: "typescript",
    status,
    createdAt: now,
    updatedAt: now,
  });
  return id;
}

afterEach(async () => {
  for (const lock of heldLocks.splice(0)) await lock.release();
  for (const projectId of projectIds.splice(0)) {
    await db.delete(eventsTable).where(eq(eventsTable.projectId, projectId));
    await db.delete(scanJobsTable).where(eq(scanJobsTable.projectId, projectId));
    await db.delete(projectsTable).where(eq(projectsTable.id, projectId));
  }
});

describe("post-push scan admission", () => {
  it("reuses one durable queued job for consecutive pushes", async () => {
    const projectId = await insertProject();
    const first = await queuePostPushScan(projectId, "push-first");
    const second = await queuePostPushScan(projectId, "push-second");

    expect(first).toMatchObject({ coalesced: false });
    expect(second).toEqual({ jobId: first.jobId, coalesced: true });

    const jobs = await db
      .select({ id: scanJobsTable.id, status: scanJobsTable.status })
      .from(scanJobsTable)
      .where(eq(scanJobsTable.projectId, projectId));
    expect(jobs).toEqual([{ id: first.jobId, status: "queued" }]);

    const coalescedEvents = await db
      .select({ payload: eventsTable.payload })
      .from(eventsTable)
      .where(and(
        eq(eventsTable.projectId, projectId),
        eq(eventsTable.type, "ProjectScanCoalesced"),
      ));
    expect(coalescedEvents).toHaveLength(1);
    expect(coalescedEvents[0]?.payload).toMatchObject({
      jobId: first.jobId,
      parentCorrelationId: "push-second",
    });
  });

  it("writes durable scan timestamps using PostgreSQL time despite API clock skew", async () => {
    const dayMs = 24 * 60 * 60_000;

    for (const clockSkewMs of [dayMs, -dayMs]) {
      const projectId = await insertProject();
      const [before] = await db.select({ now: databaseNow() });
      if (!before?.now) throw new Error("Could not read the PostgreSQL clock");

      vi.useFakeTimers({
        now: new Date(before.now.getTime() + clockSkewMs),
        toFake: ["Date"],
      });
      try {
        const first = await queuePostPushScan(projectId, "clock-skew-push-1");
        const second = await queuePostPushScan(projectId, "clock-skew-push-2");
        expect(first).toMatchObject({ coalesced: false });
        expect(second).toEqual({ jobId: first.jobId, coalesced: true });
      } finally {
        vi.useRealTimers();
      }

      const [job] = await db
        .select({ createdAt: scanJobsTable.createdAt })
        .from(scanJobsTable)
        .where(eq(scanJobsTable.projectId, projectId));
      const [project] = await db
        .select({ updatedAt: projectsTable.updatedAt })
        .from(projectsTable)
        .where(eq(projectsTable.id, projectId));
      const [after] = await db.select({ now: databaseNow() });
      if (!job?.createdAt || !project?.updatedAt || !after?.now) {
        throw new Error("Post-push scan timestamps were not persisted");
      }

      // Both queue creation and coalescing must use the DB clock, not the
      // deliberately skewed process clock. Allow a small integration-test margin.
      expect(Math.abs(job.createdAt.getTime() - after.now.getTime())).toBeLessThan(5_000);
      expect(Math.abs(project.updatedAt.getTime() - after.now.getTime())).toBeLessThan(5_000);
    }
  });

  it("keeps an active scan intact and leaves one queued successor after failure", async () => {
    const projectId = await insertProject("scanning");
    const runningJobId = randomUUID();
    const workerId = randomUUID();
    const now = new Date();
    await db.insert(scanJobsTable).values({
      id: runningJobId,
      projectId,
      status: "running",
      workerId,
      leaseUntil: new Date(now.getTime() + 60_000),
      startedAt: now,
      createdAt: now,
    });
    const scanLock = await tryAdvisoryLock(LockNamespace.SCAN_JOB, projectId);
    expect(scanLock.acquired).toBe(true);
    if (!scanLock.acquired) return;
    heldLocks.push(scanLock);

    const first = await queuePostPushScan(projectId, "push-during-scan-1");
    const second = await queuePostPushScan(projectId, "push-during-scan-2");
    expect(second).toEqual({ jobId: first.jobId, coalesced: true });

    const failed = await terminalizeFailedScanJob({
      jobId: runningJobId,
      projectId,
      error: "fixture failure",
      guard: and(
        eq(scanJobsTable.workerId, workerId),
        gt(scanJobsTable.leaseUntil, databaseNow()),
      )!,
    });
    expect(failed).toBe(true);

    const jobs = await db
      .select({ id: scanJobsTable.id, status: scanJobsTable.status })
      .from(scanJobsTable)
      .where(eq(scanJobsTable.projectId, projectId));
    expect(jobs).toHaveLength(2);
    expect(jobs.find((job) => job.id === runningJobId)?.status).toBe("failed");
    expect(jobs.find((job) => job.id === first.jobId)?.status).toBe("queued");
    const [project] = await db
      .select({ status: projectsTable.status })
      .from(projectsTable)
      .where(eq(projectsTable.id, projectId));
    expect(project?.status).toBe("scanning");
  });
});
