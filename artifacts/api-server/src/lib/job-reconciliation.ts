/**
 * Startup reconciliation for scan/discovery jobs.
 *
 * Scan and discovery jobs are tracked in-process (see job-queue.ts): the
 * only record that a job is "queued" or "running" lives in the DB row plus
 * an in-memory closure. If the process crashes or is killed mid-job, that
 * in-memory state is gone on restart, but the DB row is left behind saying
 * "queued" or "running" forever — nothing will ever come back to finish it
 * or mark it failed. The same is true for the project it belongs to, which
 * gets flipped to "scanning" for the duration of the job.
 *
 * This module sweeps for exactly that stuck state once, at process start,
 * before the server accepts traffic — any non-terminal job found here is
 * *necessarily* orphaned, because a freshly-started process has an empty
 * queue and hasn't run anything yet.
 */
import { db, scanJobsTable, discoverySessionsTable, projectsTable } from "@workspace/db";
import { and, eq, inArray } from "drizzle-orm";
import { logger } from "./logger.js";

const ORPHANED_JOB_MESSAGE =
  "Job was still in progress when the server restarted and could not be resumed.";

/**
 * Marks any scan_jobs row left in "queued"/"running" as failed, and resets
 * the owning project back to "active" if it's still stuck in "scanning".
 * Returns the number of jobs reconciled (for logging/tests).
 */
async function reconcileScanJobs(): Promise<number> {
  const stuck = await db
    .select({ id: scanJobsTable.id, projectId: scanJobsTable.projectId })
    .from(scanJobsTable)
    .where(inArray(scanJobsTable.status, ["queued", "running"]));

  if (stuck.length === 0) return 0;

  const now = new Date();
  for (const job of stuck) {
    await db
      .update(scanJobsTable)
      .set({ status: "failed", error: ORPHANED_JOB_MESSAGE, finishedAt: now })
      .where(eq(scanJobsTable.id, job.id));

    // Only reset the project if it is still "scanning" — it may have already
    // been reassigned or completed by a newer job in the meantime.
    // The `status = "scanning"` guard prevents a stale orphaned job from
    // clobbering a project that has since moved to a different state.
    await db
      .update(projectsTable)
      .set({ status: "active", updatedAt: now })
      .where(
        and(
          eq(projectsTable.id, job.projectId),
          eq(projectsTable.status, "scanning"),
        ),
      );
  }

  const stuckIds = stuck.map((j: { id: string; projectId: string }) => j.id);
  const stuckProjectIds = [...new Set(stuck.map((j: { id: string; projectId: string }) => j.projectId))];
  logger.warn(
    { count: stuck.length, jobIds: stuckIds, projectIds: stuckProjectIds },
    "reconciled orphaned scan jobs from a previous process",
  );
  return stuck.length;
}

/**
 * Marks any discovery_sessions row left in "discovering" as errored. Unlike
 * scan jobs, discovery sessions don't drive a separate entity's status field
 * (there's no project yet at this stage), so there's nothing else to reset.
 */
async function reconcileDiscoverySessions(): Promise<number> {
  const stuck = await db
    .select({ id: discoverySessionsTable.id })
    .from(discoverySessionsTable)
    .where(eq(discoverySessionsTable.status, "discovering"));

  if (stuck.length === 0) return 0;

  const now = new Date();
  for (const session of stuck) {
    await db
      .update(discoverySessionsTable)
      .set({ status: "error", error: ORPHANED_JOB_MESSAGE, completedAt: now })
      .where(eq(discoverySessionsTable.id, session.id));
  }

  const stuckIds = stuck.map((s: { id: string }) => s.id);
  logger.warn(
    { count: stuck.length, sessionIds: stuckIds },
    "reconciled orphaned discovery sessions from a previous process",
  );
  return stuck.length;
}

/**
 * Runs all startup reconciliation passes. Never throws — a reconciliation
 * bug must not prevent the server from starting; it's the same
 * fail-open-but-log posture used by scan-runner.ts's own cleanup paths.
 */
export async function reconcileStuckJobs(): Promise<{ scanJobs: number; discoverySessions: number }> {
  try {
    const [scanJobs, discoverySessions] = await Promise.all([
      reconcileScanJobs(),
      reconcileDiscoverySessions(),
    ]);
    return { scanJobs, discoverySessions };
  } catch (err) {
    logger.error({ err }, "startup job reconciliation failed");
    return { scanJobs: 0, discoverySessions: 0 };
  }
}
