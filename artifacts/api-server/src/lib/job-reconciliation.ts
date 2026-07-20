/**
 * Startup reconciliation for scan/discovery/AI-task jobs.
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
 *   scan_jobs "running"         → retry if retryCount < maxRetries (reset to
 *                                  "queued"), else mark failed
 *   discovery_sessions "pending"    → re-enqueue via heavyJobQueue (never
 *                                  started; rootPath is in the DB row)
 *   discovery_sessions "discovering" → mark error (was in-flight when process
 *                                  died; intermediate state is gone)
 *   tasks "running"             → reset to "verifying" if retryCount < maxRetries
 *                                  (AI execution was interrupted; safe to re-trigger),
 *                                  else mark failed
 *
 * For re-enqueued queued scan jobs the project stays "scanning" — it is
 * still going to scan. runScanJob handles both the success and failure paths
 * including resetting the project status. For re-enqueued pending discovery
 * sessions whose rootPath no longer exists (e.g. a git clone in /tmp that
 * was cleaned up), runDiscovery fails fast at the "Finding repository" step
 * and marks the session "error" with a clear message.
 *
 * For interrupted AI tasks, resetting to "verifying" makes the task visible
 * and re-triggerable by the user or by the auto-scheduler. We cannot safely
 * resume an AI agent call from an unknown midpoint, so we never re-execute
 * automatically here — we only restore the task to a state where re-execution
 * is safe to initiate.
 */
import { randomUUID } from "node:crypto";
import { db, scanJobsTable, discoverySessionsTable, projectsTable, tasksTable, taskLogsTable } from "@workspace/db";
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
  // PR-01: also select retryCount and maxRetries so we can decide whether to
  // retry or permanently fail each interrupted job.
  const running = await db
    .select({
      id: scanJobsTable.id,
      projectId: scanJobsTable.projectId,
      retryCount: scanJobsTable.retryCount,
      maxRetries: scanJobsTable.maxRetries,
    })
    .from(scanJobsTable)
    .where(eq(scanJobsTable.status, "running"));

  let retriedCount = 0;
  let failedCount  = 0;

  for (const job of running) {
    if (job.retryCount < job.maxRetries) {
      // PR-01: Job was mid-flight when the process died. Re-queue it — transient
      // crashes (OOM, SIGKILL) shouldn't permanently fail a scan. Increment
      // retryCount so we eventually give up after maxRetries attempts.
      await db
        .update(scanJobsTable)
        .set({
          status: "queued",
          retryCount: job.retryCount + 1,
          error: null,
          startedAt: null,
          finishedAt: null,
        })
        .where(eq(scanJobsTable.id, job.id));

      heavyJobQueue.enqueue(() => runScanJob(job.id, job.projectId));
      retriedCount++;
    } else {
      // Exceeded maxRetries — mark permanently failed and reset project status.
      await db
        .update(scanJobsTable)
        .set({
          status: "failed",
          error: `${ORPHANED_RUNNING_MESSAGE} (retry limit of ${job.maxRetries} exceeded)`,
          finishedAt: now,
        })
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
      failedCount++;
    }
  }

  if (running.length > 0) {
    const runningIds         = running.map((j) => j.id);
    const runningProjectIds  = [...new Set(running.map((j) => j.projectId))];
    logger.warn(
      {
        count: running.length,
        retried: retriedCount,
        failed: failedCount,
        jobIds: runningIds,
        projectIds: runningProjectIds,
      },
      "reconciled interrupted scan jobs after restart: retried or failed",
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
 * Handles tasks left in "running" state after a process crash.
 *
 * AI task execution (scheduleAiTaskExecution) claims verifying → running,
 * then calls the Groq agent. The inner try/catch rolls back to "verifying"
 * on normal execution failure, but a hard crash (SIGKILL, OOM) bypasses that
 * rollback, leaving the task permanently stuck in "running".
 *
 * Treatment:
 *   "running" + retryCount < maxRetries → reset to "verifying" (re-triggerable)
 *   "running" + retryCount >= maxRetries → mark "failed" (give up)
 *
 * We never auto-re-execute here because:
 *   1. We don't have the userId needed to resolve a Groq API key.
 *   2. The agent may have applied partial changes — the user should review first.
 *
 * Resetting to "verifying" makes the task visible on the dashboard and allows
 * the user or the auto-trigger to re-execute it cleanly.
 */
async function reconcileAiTasks(): Promise<number> {
  const now = new Date();

  const runningTasks = await db
    .select({
      id: tasksTable.id,
      projectId: tasksTable.projectId,
      title: tasksTable.title,
      retryCount: tasksTable.retryCount,
      maxRetries: tasksTable.maxRetries,
    })
    .from(tasksTable)
    .where(eq(tasksTable.status, "running"));

  if (runningTasks.length === 0) return 0;

  let resetCount = 0;
  let failedCount = 0;

  for (const task of runningTasks) {
    const correlationId = randomUUID();

    if (task.retryCount < task.maxRetries) {
      // Reset to verifying so the task can be re-triggered. The AI call was
      // interrupted mid-flight — we can't resume, but we can let it run again.
      await db
        .update(tasksTable)
        .set({
          status: "verifying",
          retryCount: task.retryCount + 1,
          updatedAt: now,
        })
        .where(and(eq(tasksTable.id, task.id), eq(tasksTable.status, "running")));

      await db.insert(taskLogsTable).values({
        id: randomUUID(),
        taskId: task.id,
        level: "warn",
        message: `Task reset to "verifying" after process restart (retry ${task.retryCount + 1}/${task.maxRetries}). Re-trigger to execute.`,
        correlationId,
      });
      resetCount++;
    } else {
      // Exceeded maxRetries — mark permanently failed.
      await db
        .update(tasksTable)
        .set({
          status: "failed",
          updatedAt: now,
          completedAt: now,
        })
        .where(and(eq(tasksTable.id, task.id), eq(tasksTable.status, "running")));

      await db.insert(taskLogsTable).values({
        id: randomUUID(),
        taskId: task.id,
        level: "error",
        message: `Task permanently failed after process restart: retry limit of ${task.maxRetries} exceeded. ${ORPHANED_RUNNING_MESSAGE}`,
        correlationId,
      });

      invalidateContextCache(task.projectId);
      failedCount++;
    }
  }

  logger.warn(
    {
      count: runningTasks.length,
      reset: resetCount,
      failed: failedCount,
      taskIds: runningTasks.map((t) => t.id),
    },
    "reconciled interrupted AI tasks after restart: reset to verifying or failed",
  );

  return runningTasks.length;
}

/**
 * Runs all startup reconciliation passes. Never throws — a reconciliation
 * bug must not prevent the server from starting.
 */
export async function reconcileStuckJobs(): Promise<{
  scanJobs: number;
  discoverySessions: number;
  aiTasks: number;
}> {
  try {
    const [scanJobs, discoverySessions, aiTasks] = await Promise.all([
      reconcileScanJobs(),
      reconcileDiscoverySessions(),
      reconcileAiTasks(),
    ]);
    return { scanJobs, discoverySessions, aiTasks };
  } catch (err) {
    logger.error({ err }, "startup job reconciliation failed");
    return { scanJobs: 0, discoverySessions: 0, aiTasks: 0 };
  }
}
