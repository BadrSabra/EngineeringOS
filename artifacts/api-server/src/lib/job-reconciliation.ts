/**
 * Startup reconciliation for scan/discovery jobs.
 *
 * Scan and discovery jobs are tracked in-process (see job-queue.ts): the
 * only record that a job is "queued"/"pending" or "running"/"discovering"
 * lives in the DB row plus an in-memory closure. If the process crashes or
 * is killed, that in-memory state is gone on restart, but the DB rows are
 * left behind. This module sweeps for exactly that stuck state once, at
 * process start, before the server accepts traffic.
 *
 * Treatment per status:
 *
 *   scan_jobs "queued"          → re-enqueue via heavyJobQueue (never started;
 *                                  all params are in the DB row: project_id)
 *   scan_jobs "running"         → mark failed (interrupted mid-execution;
 *                                  unsafe to resume from an unknown point)
 *   discovery_sessions "pending"    → re-enqueue via heavyJobQueue (never
 *                                  started; rootPath is in the DB row)
 *   discovery_sessions "discovering" → mark error (was in-flight when process
 *                                  died; intermediate state is gone)
 *
 * For re-enqueued queued scan jobs the project stays "scanning" — it is
 * still going to scan. runScanJob handles both the success and failure paths
 * including resetting the project status. For re-enqueued pending discovery
 * sessions whose rootPath no longer exists (e.g. a git clone in /tmp that
 * was cleaned up), runDiscovery fails fast at the "Finding repository" step
 * and marks the session "error" with a clear message.
 */
import { db, scanJobsTable, discoverySessionsTable, projectsTable } from "@workspace/db";
import { and, eq, lt } from "drizzle-orm";
import { invalidateContextCache } from "@workspace/ai-orchestrator";
import { logger } from "./logger.js";
import { heavyJobQueue } from "./job-queue.js";
import { runScanJob } from "./scan-runner.js";
import { runDiscovery } from "./discovery-runner.js";

const ORPHANED_RUNNING_MESSAGE =
  "Job was in progress when the server restarted and could not be resumed.";


/**
 * Handles scan_jobs left in non-terminal states:
 *   "running" → mark failed (interrupted)
 *   "queued"  → re-enqueue (never started; safe to retry)
 *
 * Returns total number of jobs handled (failed + re-enqueued).
 */
async function reconcileScanJobs(): Promise<number> {
  const now = new Date();

  // ── 1. Running → failed ───────────────────────────────────────────────────
  // These jobs were actively executing when the process died. We cannot
  // safely determine how far they got, so they are marked failed and the
  // owning project is reset to "active".
  const running = await db
    .select({ id: scanJobsTable.id, projectId: scanJobsTable.projectId })
    .from(scanJobsTable)
    .where(eq(scanJobsTable.status, "running"));

  for (const job of running) {
    await db
      .update(scanJobsTable)
      .set({ status: "failed", error: ORPHANED_RUNNING_MESSAGE, finishedAt: now })
      .where(eq(scanJobsTable.id, job.id));

    // Only reset the project if it is still "scanning" — it may have already
    // been reassigned or completed by a newer job in the meantime.
    await db
      .update(projectsTable)
      .set({ status: "active", updatedAt: now })
      .where(
        and(
          eq(projectsTable.id, job.projectId),
          eq(projectsTable.status, "scanning"),
        ),
      );

    // Bust the context cache so AI requests don't see stale "scanning" state.
    invalidateContextCache(job.projectId);
  }

  if (running.length > 0) {
    const runningIds = running.map((j) => j.id);
    const runningProjectIds = [...new Set(running.map((j) => j.projectId))];
    logger.warn(
      { count: running.length, jobIds: runningIds, projectIds: runningProjectIds },
      "marked interrupted scan jobs as failed (process restart)",
    );
  }

  // ── 2. Queued → re-enqueue ────────────────────────────────────────────────
  // These jobs were waiting for a free slot in heavyJobQueue and never
  // started. All parameters needed to run them (project_id) are already in
  // the DB row, so we can safely re-enqueue them as if the route had just
  // been called. The project stays "scanning" — it is still going to scan.
  const queued = await db
    .select({ id: scanJobsTable.id, projectId: scanJobsTable.projectId })
    .from(scanJobsTable)
    .where(eq(scanJobsTable.status, "queued"));

  for (const job of queued) {
    heavyJobQueue.enqueue(() => runScanJob(job.id, job.projectId));
  }

  if (queued.length > 0) {
    const queuedIds = queued.map((j) => j.id);
    logger.info(
      { count: queued.length, jobIds: queuedIds },
      "re-enqueued orphaned queued scan jobs (process restart)",
    );
  }

  return running.length + queued.length;
}

/**
 * Handles discovery_sessions left in non-terminal states:
 *   "discovering" → mark error (was running when process died)
 *   "pending"     → re-enqueue (never started; rootPath is in the DB row)
 *
 * Returns total number of sessions handled (failed + re-enqueued).
 */
async function reconcileDiscoverySessions(): Promise<number> {
  const now = new Date();

  // ── 1. Discovering → error ────────────────────────────────────────────────
  // These sessions were actively running the discovery pipeline. Their
  // intermediate state (in-memory steps, partial walk results) is gone.
  const discovering = await db
    .select({ id: discoverySessionsTable.id })
    .from(discoverySessionsTable)
    .where(eq(discoverySessionsTable.status, "discovering"));

  for (const session of discovering) {
    await db
      .update(discoverySessionsTable)
      .set({ status: "error", error: ORPHANED_RUNNING_MESSAGE, completedAt: now })
      .where(eq(discoverySessionsTable.id, session.id));
  }

  if (discovering.length > 0) {
    const discoveringIds = discovering.map((s) => s.id);
    logger.warn(
      { count: discovering.length, sessionIds: discoveringIds },
      "marked interrupted discovery sessions as error (process restart)",
    );
  }

  // ── 2. Pending → re-enqueue ───────────────────────────────────────────────
  // These sessions were created (DB row exists) but were waiting for a free
  // slot in heavyJobQueue and never actually started. rootPath is persisted
  // on the row. runDiscovery will transition the session to "discovering"
  // as its first action, and will fail fast at "Finding repository" if the
  // rootPath no longer exists (e.g. a git-clone temp dir that was cleaned up
  // after a crash), giving the user a clear error message.
  const pending = await db
    .select({ id: discoverySessionsTable.id, rootPath: discoverySessionsTable.rootPath })
    .from(discoverySessionsTable)
    .where(eq(discoverySessionsTable.status, "pending"));

  for (const session of pending) {
    const { id: sessionId, rootPath } = session;
    heavyJobQueue.enqueue(async () => {
      try {
        await runDiscovery(sessionId, rootPath);
      } catch (err) {
        // runDiscovery is documented to never throw — reaching here means
        // it broke that contract. Log with session context so on-call can
        // tell whether this is an isolated failure or a queue degradation.
        logger.error(
          { err, sessionId },
          "discovery runner threw past its own error handling on re-queue",
        );
      }
    });
  }

  if (pending.length > 0) {
    const pendingIds = pending.map((s) => s.id);
    logger.info(
      { count: pending.length, sessionIds: pendingIds },
      "re-enqueued pending discovery sessions (process restart)",
    );
  }

  return discovering.length + pending.length;
}

// ── Stale running-job sweep (PR-02 / audit W-002) ────────────────────────────
//
// Startup reconciliation already fails ALL running jobs on restart (correct for
// crash recovery). But a scan job can also get hung while the server is up — e.g.
// walkProject against a huge repo that never finishes, or a zombie worker that
// neither completes nor throws. The periodic sweep below covers that gap by
// timing out any scan job that has been "running" longer than STALE_JOB_TIMEOUT_MS
// without completing.
//
// Default: 2 hours (configurable via STALE_JOB_TIMEOUT_MS env var).
// The sweep itself runs every STALE_JOB_SWEEP_INTERVAL_MS (default: 30 minutes)
// and is started from index.ts after the server begins accepting traffic.

export const STALE_JOB_TIMEOUT_MS = Number(
  process.env.STALE_JOB_TIMEOUT_MS ?? 2 * 60 * 60 * 1000, // 2 hours
);
const STALE_JOB_SWEEP_INTERVAL_MS = Number(
  process.env.STALE_JOB_SWEEP_INTERVAL_MS ?? 30 * 60 * 1000, // 30 minutes
);

/**
 * Mark scan jobs that have been in "running" state for longer than
 * `STALE_JOB_TIMEOUT_MS` as "failed". Returns the number of rows updated.
 *
 * Safe to call at any time — uses a server-side timestamp comparison so it
 * does not race with legitimate fast-running jobs.
 */
export async function failStaleRunningJobs(): Promise<number> {
  const cutoff = new Date(Date.now() - STALE_JOB_TIMEOUT_MS);

  let staleCount = 0;
  try {
    const staleJobs = await db
      .select({ id: scanJobsTable.id, projectId: scanJobsTable.projectId })
      .from(scanJobsTable)
      .where(
        and(
          eq(scanJobsTable.status, "running"),
          lt(scanJobsTable.startedAt, cutoff),
        ),
      );

    if (staleJobs.length === 0) return 0;

    for (const job of staleJobs) {
      await db
        .update(scanJobsTable)
        .set({
          status: "failed",
          error: `Timed out — job was still "running" after ${Math.round(STALE_JOB_TIMEOUT_MS / 60_000)} minutes`,
        })
        .where(
          and(eq(scanJobsTable.id, job.id), eq(scanJobsTable.status, "running")),
        );
      staleCount++;
      logger.warn(
        {
          scope: "job-reconciliation",
          code: "STALE_JOB_TIMEOUT",
          jobId: job.id,
          projectId: job.projectId,
          cutoff: cutoff.toISOString(),
          timeoutMs: STALE_JOB_TIMEOUT_MS,
        },
        "scan job timed out — marked as failed",
      );
    }
  } catch (err) {
    logger.error({ err, scope: "job-reconciliation" }, "failStaleRunningJobs failed");
  }
  return staleCount;
}

/**
 * Start the periodic stale-job sweep. Returns the interval handle so the
 * caller can clear it on graceful shutdown if needed.
 */
export function startStaleJobSweep(): NodeJS.Timeout {
  logger.info(
    { intervalMs: STALE_JOB_SWEEP_INTERVAL_MS, timeoutMs: STALE_JOB_TIMEOUT_MS },
    "stale-job sweep scheduled",
  );
  return setInterval(async () => {
    const failed = await failStaleRunningJobs();
    if (failed > 0) {
      logger.warn({ failed }, "stale-job sweep: timed out scan jobs marked failed");
    }
  }, STALE_JOB_SWEEP_INTERVAL_MS);
}

/**
 * Runs all startup reconciliation passes. Never throws — a reconciliation
 * bug must not prevent the server from starting.
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
