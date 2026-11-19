import { randomUUID } from "node:crypto";
import { and, asc, eq } from "drizzle-orm";
import { db, eventsTable, projectsTable, scanJobsTable } from "@workspace/db";
import { LockNamespace, tryAdvisoryLock } from "./advisory-lock.js";
import { databaseNow } from "./job-lease.js";

export type PostPushScanAdmission = {
  jobId: string;
  coalesced: boolean;
};

/**
 * Create one durable post-push scan for a project, or fold the push into the
 * already queued scan. A running scan is never interrupted; its single queued
 * successor will inspect the current project tree when it starts.
 */
export async function queuePostPushScan(
  projectId: string,
  parentCorrelationId: string,
): Promise<PostPushScanAdmission> {
  // If no scan is running, keep a worker from claiming the queued row before
  // this admission commits. When a scan is already active the lock is busy,
  // and the durable follow-up can safely wait behind that owner.
  const scanLock = await tryAdvisoryLock(LockNamespace.SCAN_JOB, projectId);
  try {
    return await db.transaction(async (tx) => {
      const [project] = await tx
        .select({ id: projectsTable.id })
        .from(projectsTable)
        .where(eq(projectsTable.id, projectId))
        .for("update")
        .limit(1);
      if (!project) throw new Error(`Project ${projectId} no longer exists`);

      const [queuedJob] = await tx
        .select({ id: scanJobsTable.id })
        .from(scanJobsTable)
        .where(and(
          eq(scanJobsTable.projectId, projectId),
          eq(scanJobsTable.status, "queued"),
        ))
        .orderBy(asc(scanJobsTable.createdAt), asc(scanJobsTable.id))
        .limit(1);
      // Durable timestamps must share PostgreSQL's clock with the scan
      // recovery sweeper; API replica clocks are not authoritative here.
      const now = databaseNow();

      if (queuedJob) {
        await tx
          .update(projectsTable)
          .set({ status: "scanning", updatedAt: now })
          .where(eq(projectsTable.id, projectId));
        await tx.insert(eventsTable).values({
          id: randomUUID(),
          type: "ProjectScanCoalesced",
          projectId,
          severity: "info",
          message: "Push coalesced into the queued automatic scan",
          correlationId: queuedJob.id,
          payload: { jobId: queuedJob.id, parentCorrelationId },
        });
        return { jobId: queuedJob.id, coalesced: true };
      }

      const jobId = randomUUID();
      await tx.insert(scanJobsTable).values({
        id: jobId,
        projectId,
        status: "queued",
        createdAt: now,
      });
      await tx
        .update(projectsTable)
        .set({ status: "scanning", updatedAt: now })
        .where(eq(projectsTable.id, projectId));
      await tx.insert(eventsTable).values({
        id: randomUUID(),
        type: "ProjectScanQueued",
        projectId,
        severity: "info",
        message: "Automatic scan queued after push",
        correlationId: jobId,
        payload: { parentCorrelationId },
      });
      return { jobId, coalesced: false };
    });
  } finally {
    if (scanLock.acquired) {
      await scanLock.release();
    }
  }
}
