import { afterEach, describe, expect, it, vi } from "vitest";
import { and, eq, or } from "drizzle-orm";
import {
  auditLogsTable,
  db,
  eventsTable,
  projectBootstrapJobsTable,
  projectsTable,
  scanJobsTable,
} from "@workspace/db";
import { commitCreatedProject } from "./project-bootstrap.js";

vi.mock("./job-queue.js", () => ({
  heavyJobQueue: {
    enqueueWithId: vi.fn().mockReturnValue(false),
  },
}));
import { heavyJobQueue } from "./job-queue.js";

const bootstrapJobIds: string[] = [];
const projectIds: string[] = [];

async function insertRunningBootstrapJob(leaseUntil: Date) {
  const id = crypto.randomUUID();
  const now = new Date();
  const [job] = await db
    .insert(projectBootstrapJobsTable)
    .values({
      id,
      ownerId: "bootstrap-initial-scan-test-user",
      idempotencyKey: `bootstrap-test:${id}`,
      name: `bootstrap-test-${id.slice(0, 8)}`,
      description: "Initial scan regression fixture",
      templateVersion: "react-vite-v1",
      status: "running",
      attempt: 1,
      maxAttempts: 3,
      workerId: `bootstrap-worker:${id}`,
      leaseUntil,
      lastHeartbeatAt: now,
      workingRootPath: `/home/runner/workspace/bootstrap-test-${id}`,
      createdAt: now,
      updatedAt: now,
      startedAt: now,
    })
    .returning();
  bootstrapJobIds.push(id);
  return { job, workerId: job.workerId! };
}

afterEach(async () => {
  for (const id of bootstrapJobIds.splice(0)) {
    await db.delete(projectBootstrapJobsTable).where(eq(projectBootstrapJobsTable.id, id));
  }
  for (const id of projectIds.splice(0)) {
    await db.delete(auditLogsTable).where(or(
      eq(auditLogsTable.projectId, id),
      eq(auditLogsTable.entityId, id),
    ));
    await db.delete(eventsTable).where(eq(eventsTable.projectId, id));
    await db.delete(scanJobsTable).where(eq(scanJobsTable.projectId, id));
    await db.delete(projectsTable).where(eq(projectsTable.id, id));
  }
  vi.mocked(heavyJobQueue.enqueueWithId).mockClear().mockReturnValue(false);
});

describe("project bootstrap initial scan", () => {
  it("commits the project and its first scan together, retaining the scan when local capacity is full", async () => {
    const { job, workerId } = await insertRunningBootstrapJob(
      new Date(Date.now() + 120_000),
    );

    const committed = await commitCreatedProject({
      job,
      workerId,
      canonicalRootPath: `/home/runner/workspace/bootstrap-created-${job.id}`,
    });
    projectIds.push(committed.projectId);

    const [project] = await db
      .select()
      .from(projectsTable)
      .where(eq(projectsTable.id, committed.projectId));
    expect(project.status).toBe("scanning");

    const scans = await db
      .select()
      .from(scanJobsTable)
      .where(eq(scanJobsTable.projectId, committed.projectId));
    expect(scans).toHaveLength(1);
    expect(scans[0]).toMatchObject({
      id: committed.scanJobId,
      status: "queued",
      retryCount: 0,
    });

    const [queuedEvent] = await db
      .select()
      .from(eventsTable)
      .where(eq(eventsTable.correlationId, committed.scanJobId));
    expect(queuedEvent).toMatchObject({
      type: "ProjectScanQueued",
      projectId: committed.projectId,
      payload: {
        jobId: committed.scanJobId,
        trigger: "project_bootstrap",
      },
    });

    const [audit] = await db
      .select()
      .from(auditLogsTable)
      .where(and(
        eq(auditLogsTable.entityId, committed.projectId),
        eq(auditLogsTable.action, "created"),
      ));
    expect(audit.stateAfter).toMatchObject({ status: "scanning" });

    const [completedBootstrap] = await db
      .select()
      .from(projectBootstrapJobsTable)
      .where(eq(projectBootstrapJobsTable.id, job.id));
    expect(completedBootstrap).toMatchObject({
      status: "completed",
      projectId: committed.projectId,
    });

    // Local queue saturation must not roll back or lose the durable scan row.
    expect(heavyJobQueue.enqueueWithId).toHaveBeenCalledWith(
      committed.scanJobId,
      expect.any(Function),
    );
    expect(scans[0]?.status).toBe("queued");
  });

  it("does not create a project or initial scan after the bootstrap lease expires", async () => {
    const { job, workerId } = await insertRunningBootstrapJob(
      new Date(Date.now() - 1_000),
    );

    await expect(commitCreatedProject({
      job,
      workerId,
      canonicalRootPath: `/home/runner/workspace/bootstrap-expired-${job.id}`,
    })).rejects.toThrow("Project bootstrap worker no longer owns the operation.");

    const [persistedBootstrap] = await db
      .select()
      .from(projectBootstrapJobsTable)
      .where(eq(projectBootstrapJobsTable.id, job.id));
    expect(persistedBootstrap).toMatchObject({
      status: "running",
      projectId: null,
    });

    const projects = await db
      .select({ id: projectsTable.id })
      .from(projectsTable)
      .where(eq(projectsTable.name, job.name));
    expect(projects).toHaveLength(0);
    expect(heavyJobQueue.enqueueWithId).not.toHaveBeenCalled();
  });
});
