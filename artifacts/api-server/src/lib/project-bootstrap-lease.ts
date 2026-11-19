import { and, eq, gt, lt, sql } from "drizzle-orm";
import { db, projectBootstrapJobsTable } from "@workspace/db";
import type { ProjectBootstrapJob } from "@workspace/db";
import { databaseLeaseUntil, databaseNow } from "./job-lease.js";

export const PROJECT_BOOTSTRAP_LEASE_MS = 120_000;

export class ProjectBootstrapLeaseLost extends Error {
  constructor() {
    super("Project bootstrap worker no longer owns the operation.");
    this.name = "ProjectBootstrapLeaseLost";
  }
}

/**
 * Lease ownership uses PostgreSQL time across API instances with skewed clocks.
 */
export async function claimProjectBootstrapJob(
  jobId: string,
  workerId: string,
): Promise<ProjectBootstrapJob | undefined> {
  const [job] = await db
    .update(projectBootstrapJobsTable)
    .set({
      status: "running",
      attempt: sql`${projectBootstrapJobsTable.attempt} + 1`,
      workerId,
      leaseUntil: databaseLeaseUntil(PROJECT_BOOTSTRAP_LEASE_MS),
      lastHeartbeatAt: databaseNow(),
      startedAt: databaseNow(),
      updatedAt: databaseNow(),
      errorCode: null,
      errorMessage: null,
    })
    .where(
      and(
        eq(projectBootstrapJobsTable.id, jobId),
        eq(projectBootstrapJobsTable.status, "queued"),
        lt(projectBootstrapJobsTable.attempt, projectBootstrapJobsTable.maxAttempts),
      ),
    )
    .returning();
  return job;
}

export async function assertProjectBootstrapWorkerLease(
  jobId: string,
  workerId: string,
): Promise<void> {
  const [owned] = await db
    .select({ id: projectBootstrapJobsTable.id })
    .from(projectBootstrapJobsTable)
    .where(
      and(
        eq(projectBootstrapJobsTable.id, jobId),
        eq(projectBootstrapJobsTable.status, "running"),
        eq(projectBootstrapJobsTable.workerId, workerId),
        gt(projectBootstrapJobsTable.leaseUntil, databaseNow()),
      ),
    )
    .limit(1);
  if (!owned) throw new ProjectBootstrapLeaseLost();
}

export async function setProjectBootstrapWorkingRoot(
  jobId: string,
  workerId: string,
  rootPath: string,
): Promise<void> {
  const [updated] = await db
    .update(projectBootstrapJobsTable)
    .set({
      workingRootPath: rootPath,
      leaseUntil: databaseLeaseUntil(PROJECT_BOOTSTRAP_LEASE_MS),
      lastHeartbeatAt: databaseNow(),
      updatedAt: databaseNow(),
    })
    .where(
      and(
        eq(projectBootstrapJobsTable.id, jobId),
        eq(projectBootstrapJobsTable.status, "running"),
        eq(projectBootstrapJobsTable.workerId, workerId),
        gt(projectBootstrapJobsTable.leaseUntil, databaseNow()),
      ),
    )
    .returning({ id: projectBootstrapJobsTable.id });
  if (!updated) throw new ProjectBootstrapLeaseLost();
}

export async function heartbeatProjectBootstrapJob(
  jobId: string,
  workerId: string,
): Promise<boolean> {
  const [owned] = await db
    .update(projectBootstrapJobsTable)
    .set({
      leaseUntil: databaseLeaseUntil(PROJECT_BOOTSTRAP_LEASE_MS),
      lastHeartbeatAt: databaseNow(),
      updatedAt: databaseNow(),
    })
    .where(
      and(
        eq(projectBootstrapJobsTable.id, jobId),
        eq(projectBootstrapJobsTable.status, "running"),
        eq(projectBootstrapJobsTable.workerId, workerId),
        gt(projectBootstrapJobsTable.leaseUntil, databaseNow()),
      ),
    )
    .returning({ id: projectBootstrapJobsTable.id });
  return Boolean(owned);
}
