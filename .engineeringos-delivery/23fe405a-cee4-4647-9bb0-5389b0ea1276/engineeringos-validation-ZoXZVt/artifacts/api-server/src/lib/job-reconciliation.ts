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
 *
 * PR-D1 (Durability hardening):
 *   - All re-enqueue calls use `enqueueWithId` (ID-based deduplication) to
 *     prevent duplicate execution when a job is re-enqueued at startup while
 *     still present in a hot-reload or overlapping process queue.
 *   - Added `requeueStalePendingJobs`: a periodic sweep that finds scan_jobs
 *     stuck in "queued" state beyond STALE_PENDING_TIMEOUT_MS and re-enqueues
 *     them. Handles the rare case where an in-memory closure was lost without
 *     a clean restart (hot-reload, signal race, etc.). The advisory lock inside
 *     runScanJob provides a second safety net against any double-execution.
 */
import { randomUUID } from "node:crypto";
import {
  db,
  scanJobsTable,
  discoverySessionsTable,
  projectsTable,
  tasksTable,
  taskLogsTable,
  aiApplyJournalTable,
  aiChangeProposalsTable,
} from "@workspace/db";
import { and, eq, inArray, isNull, lt, or, count } from "drizzle-orm";
import { invalidateContextCache } from "@workspace/ai-orchestrator";
import { logger } from "./logger.js";
import { heavyJobQueue } from "./job-queue.js";
import { runScanJob } from "./scan-runner.js";
import { runDiscovery } from "./discovery-runner.js";
import { sweepExpiredUploads } from "./upload-store.js";
import { reconcileAiExecutions } from "./ai-execution-state.js";
import { recoverPromotion } from "./delivery-workspace.js";

const ORPHANED_RUNNING_MESSAGE =
  "Job was in progress when the server restarted and could not be resumed.";

/**
 * An apply is deliberately not replayed after a process crash: its file
 * snapshots live in memory and replaying an unknown write could overwrite
 * user edits. Instead, convert any non-terminal journal into a durable,
 * visible conflict. This makes the post-crash state known and prevents a
 * partially promoted tree from being reported as successful.
 */
async function reconcileInterruptedDeliveries(): Promise<number> {
  const proposals = await db
    .select({
      id: aiChangeProposalsTable.id,
      operationId: aiChangeProposalsTable.operationId,
      projectId: aiChangeProposalsTable.projectId,
      lifecycle: aiChangeProposalsTable.lifecycle,
      changes: aiChangeProposalsTable.changes,
      workspaceRoot: aiChangeProposalsTable.workspaceRoot,
    })
    .from(aiChangeProposalsTable)
    .where(or(
      eq(aiChangeProposalsTable.lifecycle, "isolated"),
      eq(aiChangeProposalsTable.lifecycle, "validated"),
    ));
  let recovered = 0;
  for (const proposal of proposals) {
    if (!proposal.operationId) continue;
    const journal = await db
      .select({ stage: aiApplyJournalTable.stage, sequence: aiApplyJournalTable.sequence, payload: aiApplyJournalTable.payload })
      .from(aiApplyJournalTable)
      .where(eq(aiApplyJournalTable.operationId, proposal.operationId))
      .orderBy(aiApplyJournalTable.sequence);
    const latest = journal.at(-1)?.stage;
    if (!latest || ["APPLIED", "BLOCKED", "ROLLED_BACK", "ROLLBACK_FAILED", "RECOVERY_REQUIRED"].includes(latest)) {
      continue;
    }
    // Promotion intent is durable before the first live-root replacement.
    // Reconcile only against the persisted proposal bytes and the persisted
    // project root; never resume from an in-memory snapshot.
    if (["PROMOTION_INTENT", "WRITING_STARTED", "WRITTEN", "PROMOTED"].includes(latest)) {
      const [project] = await db
        .select({ rootPath: projectsTable.rootPath })
        .from(projectsTable)
        .where(eq(projectsTable.id, proposal.projectId))
        .limit(1);
      let recovery: "PROMOTED" | "ROLLED_BACK" | "RECOVERY_REQUIRED" = "RECOVERY_REQUIRED";
      try {
        const proposalChanges = JSON.parse(proposal.changes) as Array<{
          path: string; newContent: string; originalContent?: string | null;
        }>;
        const intent = [...journal].reverse().find((entry: { stage: string }) => entry.stage === "PROMOTION_INTENT")?.payload;
        const intentFiles = intent && Array.isArray((intent as Record<string, unknown>).files)
          ? (intent as Record<string, unknown>).files
          : undefined;
        const changes = Array.isArray(intentFiles)
          ? intentFiles.reduce<Array<{ path: string; newContent: string; originalContent: string | null }>>((result, entry: unknown) => {
              if (!entry || typeof entry !== "object") return result;
              const file = entry as Record<string, unknown>;
              if (typeof file.path === "string" && typeof file.newContent === "string") {
                result.push({ path: file.path, newContent: file.newContent, originalContent: typeof file.originalContent === "string" ? file.originalContent : null });
              }
              return result;
            }, [])
          : proposalChanges;
        if (project && proposal.operationId && Array.isArray(changes)) {
          recovery = await recoverPromotion({
            rootPath: project.rootPath,
            changes,
            operationId: proposal.operationId,
          });
        }
      } catch (error) {
        logger.warn({ error, proposalId: proposal.id }, "delivery promotion recovery could not be evaluated");
      }
      const sequence = (journal.at(-1)?.sequence ?? 0) + 1;
      await db.insert(aiApplyJournalTable).values({
        id: randomUUID(),
        operationId: proposal.operationId,
        attemptId: randomUUID(),
        projectId: proposal.projectId,
        proposalId: proposal.id,
        stage: recovery === "PROMOTED" ? "PROMOTED" : recovery === "ROLLED_BACK" ? "ROLLED_BACK" : "RECOVERY_REQUIRED",
        sequence,
        payload: {
          recoveryDecision: recovery,
          previousStage: latest,
          workspaceRoot: proposal.workspaceRoot,
          reason: "process_restart",
        },
      });
      if (recovery === "PROMOTED") {
        await db.update(aiChangeProposalsTable).set({
          lifecycle: "conflicted",
          conflictReason: "Promotion completed before validation outcome was recorded; resume validation before delivery can continue.",
        }).where(and(eq(aiChangeProposalsTable.id, proposal.id), inArray(aiChangeProposalsTable.lifecycle, ["isolated", "validated"])));
      } else if (recovery === "ROLLED_BACK") {
        await db.update(aiChangeProposalsTable).set({
          lifecycle: "conflicted",
          conflictReason: "Promotion was interrupted and rolled back; resume validation before retrying.",
        }).where(and(eq(aiChangeProposalsTable.id, proposal.id), inArray(aiChangeProposalsTable.lifecycle, ["isolated", "validated"])));
      } else {
        await db.update(aiChangeProposalsTable).set({
          lifecycle: "conflicted",
          conflictReason: "Promotion encountered unexpected live-root bytes; manual review is required before retrying.",
        }).where(and(eq(aiChangeProposalsTable.id, proposal.id), inArray(aiChangeProposalsTable.lifecycle, ["isolated", "validated"])));
      }
      recovered++;
      continue;
    }
    const [updated] = await db.update(aiChangeProposalsTable).set({
      lifecycle: "conflicted",
      conflictReason: "Delivery was interrupted during apply; filesystem state requires review before retry.",
    }).where(and(
      eq(aiChangeProposalsTable.id, proposal.id),
      or(
        eq(aiChangeProposalsTable.lifecycle, "isolated"),
        eq(aiChangeProposalsTable.lifecycle, "validated"),
      ),
    )).returning({ id: aiChangeProposalsTable.id });
    if (!updated) continue;
    await db.insert(aiApplyJournalTable).values({
      id: randomUUID(),
      operationId: proposal.operationId,
      attemptId: randomUUID(),
      projectId: proposal.projectId,
      proposalId: proposal.id,
      stage: "RECOVERY_REQUIRED",
      sequence: (journal.at(-1)?.sequence ?? 0) + 1,
      payload: { previousStage: latest, reason: "process_restart" },
    });
    recovered++;
  }
  return recovered;
}


/**
 * Handles scan_jobs left in non-terminal states:
 *   "running" → mark failed (interrupted)
 *   "queued"  → re-enqueue (never started; safe to retry)
 *
 * Returns total number of jobs handled (failed + re-enqueued).
 */
async function reconcileScanJobs(): Promise<number> {
  const now = new Date();
  const abandonedScan = or(
    lt(scanJobsTable.leaseUntil, now),
    isNull(scanJobsTable.leaseUntil),
  );

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
    .where(and(eq(scanJobsTable.status, "running"), abandonedScan));

  let retriedCount = 0;
  let failedCount  = 0;

  for (const job of running) {
    if (job.retryCount < job.maxRetries) {
      // PR-01: Job was mid-flight when the process died. Re-queue it — transient
      // crashes (OOM, SIGKILL) shouldn't permanently fail a scan. Increment
      // retryCount so we eventually give up after maxRetries attempts.
      const [recovered] = await db
        .update(scanJobsTable)
        .set({
          status: "queued",
          retryCount: job.retryCount + 1,
          error: null,
          startedAt: null,
          finishedAt: null,
          // PR-01: clear lease so the recovering worker can claim cleanly
          workerId: null,
          leaseUntil: null,
          lastHeartbeatAt: null,
        })
        .where(and(eq(scanJobsTable.id, job.id), eq(scanJobsTable.status, "running"), abandonedScan))
        .returning({ id: scanJobsTable.id });

      if (!recovered) {
        logger.debug({ jobId: job.id }, "scan recovery lost ownership race");
        continue;
      }
      // PR-D1: use enqueueWithId to prevent double-execution if another
      // process or a concurrent reconciliation path already enqueued this job.
      heavyJobQueue.enqueueWithId(job.id, () => runScanJob(job.id, job.projectId));
      retriedCount++;
    } else {
      // Exceeded maxRetries — mark permanently failed and reset project status.
      const [recovered] = await db
        .update(scanJobsTable)
        .set({
          status: "failed",
          error: `${ORPHANED_RUNNING_MESSAGE} (retry limit of ${job.maxRetries} exceeded)`,
          finishedAt: now,
          // PR-01: clear lease so the row doesn't appear as "in-flight"
          workerId: null,
          leaseUntil: null,
          lastHeartbeatAt: null,
        })
        .where(and(eq(scanJobsTable.id, job.id), eq(scanJobsTable.status, "running"), abandonedScan))
        .returning({ id: scanJobsTable.id });
      if (!recovered) {
        logger.debug({ jobId: job.id }, "scan failure recovery lost ownership race");
        continue;
      }

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
    // PR-D1: enqueueWithId deduplicates — skips jobs already added by the
    // running→re-queued path above (retryCount < maxRetries branch).
    heavyJobQueue.enqueueWithId(job.id, () => runScanJob(job.id, job.projectId));
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
  const abandonedDiscovery = or(
    lt(discoverySessionsTable.leaseUntil, now),
    isNull(discoverySessionsTable.leaseUntil),
  );

  // ── 1. Discovering → error ────────────────────────────────────────────────
  // These sessions were actively running the discovery pipeline. Their
  // intermediate state (in-memory steps, partial walk results) is gone.
  const discovering = await db
    .select({ id: discoverySessionsTable.id })
    .from(discoverySessionsTable)
    .where(and(eq(discoverySessionsTable.status, "discovering"), abandonedDiscovery));

    for (const session of discovering) {
      const [recovered] = await db
      .update(discoverySessionsTable)
      .set({
        status: "error",
        error: ORPHANED_RUNNING_MESSAGE,
        completedAt: now,
        // PR-01: clear lease so the row no longer appears as "in-flight"
        workerId: null,
        leaseUntil: null,
        lastHeartbeatAt: null,
      })
        .where(and(eq(discoverySessionsTable.id, session.id), eq(discoverySessionsTable.status, "discovering"), abandonedDiscovery))
        .returning({ id: discoverySessionsTable.id });
      if (!recovered) {
        logger.debug({ sessionId: session.id }, "discovery recovery lost ownership race");
        continue;
      }
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
    // PR-D1: use enqueueWithId so a concurrent route handler or a second
    // reconciliation pass cannot enqueue the same session twice.
    heavyJobQueue.enqueueWithId(sessionId, async () => {
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

/**
 * PR-D1: Timeout for scan_jobs stuck in "queued" state without transitioning
 * to "running". This catches the rare case where the in-memory closure was
 * dropped without a clean restart (hot-reload, signal race, dev watch mode).
 * Default: 15 minutes. Set STALE_PENDING_TIMEOUT_MS env var to override.
 */
export const STALE_PENDING_TIMEOUT_MS = Number(
  process.env.STALE_PENDING_TIMEOUT_MS ?? 15 * 60 * 1000, // 15 minutes
);

const STALE_JOB_SWEEP_INTERVAL_MS = Number(
  process.env.STALE_JOB_SWEEP_INTERVAL_MS ?? 30 * 60 * 1000, // 30 minutes
);

/**
 * How often each API instance looks for durable work that may have been
 * persisted successfully but whose in-process enqueue was lost (for example
 * during a deploy between the DB commit and queue dispatch).
 *
 * This is intentionally separate from the stale-job sweep: dispatching a
 * queued row is cheap and should recover promptly, while timing out a truly
 * running job needs a much longer safety window.
 */
export const DURABLE_JOB_DISPATCH_INTERVAL_MS = Number(
  process.env.DURABLE_JOB_DISPATCH_INTERVAL_MS ?? 10 * 1000,
);

/**
 * Mark scan jobs that have been in "running" state for longer than
 * `STALE_JOB_TIMEOUT_MS` as "failed". Returns the number of rows updated.
 *
 * Safe to call at any time — uses a server-side timestamp comparison so it
 * does not race with legitimate fast-running jobs.
 */
export async function failStaleRunningJobs(): Promise<number> {
  const now = new Date();
  const cutoff = new Date(Date.now() - STALE_JOB_TIMEOUT_MS);

  let staleCount = 0;
  try {
    const staleJobs = await db
      .select({ id: scanJobsTable.id, projectId: scanJobsTable.projectId })
      .from(scanJobsTable)
      .where(
        and(
          eq(scanJobsTable.status, "running"),
          // PR-01: Two stale conditions:
          //   (a) New rows with a lease: worker stopped heartbeating → lease expired.
          //   (b) Legacy rows without a lease: fall back to startedAt time cutoff.
          or(
            lt(scanJobsTable.leaseUntil, now),
            and(isNull(scanJobsTable.leaseUntil), lt(scanJobsTable.startedAt, cutoff)),
          ),
        ),
      );

    if (staleJobs.length === 0) return 0;

    for (const job of staleJobs) {
      const [updated] = await db
        .update(scanJobsTable)
        .set({
          status: "failed",
          error: `Timed out — job was still "running" after ${Math.round(STALE_JOB_TIMEOUT_MS / 60_000)} minutes`,
          // PR-01: clear lease fields so the row no longer appears in-flight
          workerId: null,
          leaseUntil: null,
          lastHeartbeatAt: null,
        })
        .where(
          and(eq(scanJobsTable.id, job.id), eq(scanJobsTable.status, "running")),
        )
        .returning({ id: scanJobsTable.id });
      if (!updated) continue;
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
 * Discovery has no safe checkpoint between pipeline steps. An abandoned
 * session therefore becomes an explicit error once its lease expires rather
 * than remaining "discovering" forever. The conditional update is the
 * ownership fence: a live worker that heartbeats or finishes concurrently
 * wins and is never clobbered by this sweep.
 */
export async function failStaleDiscoverySessions(): Promise<number> {
  const now = new Date();
  let failed = 0;
  try {
    const stale = await db
      .select({ id: discoverySessionsTable.id, rootPath: discoverySessionsTable.rootPath })
      .from(discoverySessionsTable)
      .where(and(
        eq(discoverySessionsTable.status, "discovering"),
        lt(discoverySessionsTable.leaseUntil, now),
      ));
    for (const session of stale) {
      const [updated] = await db.update(discoverySessionsTable).set({
        status: "error",
        error: "Discovery worker lease expired; restart discovery to retry.",
        completedAt: now,
        workerId: null,
        leaseUntil: null,
        lastHeartbeatAt: null,
      }).where(and(
        eq(discoverySessionsTable.id, session.id),
        eq(discoverySessionsTable.status, "discovering"),
        lt(discoverySessionsTable.leaseUntil, now),
      )).returning({ id: discoverySessionsTable.id });
      if (!updated) continue;
      failed++;
      logger.warn({
        scope: "job-reconciliation",
        code: "STALE_DISCOVERY_LEASE",
        sessionId: session.id,
      }, "discovery session lease expired — marked as error");
    }
  } catch (err) {
    logger.error({ err, scope: "job-reconciliation" }, "failStaleDiscoverySessions failed");
  }
  return failed;
}

/**
 * Reconcile abandoned AI task workers while the server remains healthy.
 * Recovery is deliberately non-replaying: the task returns to verifying so
 * a new execution can be explicitly started, preserving cancellation and
 * avoiding duplicate model/tool side effects.
 */
export async function reconcileStaleAiTasks(): Promise<number> {
  const now = new Date();
  let recovered = 0;
  try {
    const stale = await db.select({
      id: tasksTable.id,
      projectId: tasksTable.projectId,
      retryCount: tasksTable.retryCount,
      maxRetries: tasksTable.maxRetries,
    }).from(tasksTable).where(and(
      eq(tasksTable.status, "running"),
      lt(tasksTable.leaseUntil, now),
    ));
    for (const task of stale) {
      const exhausted = task.retryCount >= task.maxRetries;
      const [updated] = await db.update(tasksTable).set({
        status: exhausted ? "failed" : "verifying",
        retryCount: exhausted ? task.retryCount : task.retryCount + 1,
        updatedAt: now,
        completedAt: exhausted ? now : null,
        workerId: null,
        leaseUntil: null,
        lastHeartbeatAt: null,
      }).where(and(
        eq(tasksTable.id, task.id),
        eq(tasksTable.status, "running"),
        lt(tasksTable.leaseUntil, now),
      )).returning({ id: tasksTable.id });
      if (!updated) continue;
      await db.insert(taskLogsTable).values({
        id: randomUUID(),
        taskId: task.id,
        level: exhausted ? "error" : "warn",
        message: exhausted
          ? "Task failed because its worker lease expired and retry limit was reached."
          : "Task returned to verifying because its worker lease expired; re-trigger to execute.",
        correlationId: randomUUID(),
      });
      invalidateContextCache(task.projectId);
      recovered++;
    }
  } catch (err) {
    logger.error({ err, scope: "job-reconciliation" }, "reconcileStaleAiTasks failed");
  }
  return recovered;
}

/**
 * PR-D1: Re-enqueue scan jobs that have been stuck in "queued" state for
 * longer than `STALE_PENDING_TIMEOUT_MS` without progressing to "running".
 *
 * This is a safety net for the rare case where an in-memory closure was
 * dropped without a clean server restart — for example during a hot-reload
 * in development, a signal race, or a bug in the queue drain logic. Under
 * normal operation (clean restarts) startup reconciliation already handles
 * all "queued" rows, so this sweep should find nothing.
 *
 * Uses `enqueueWithId` so jobs already present in the in-memory queue are
 * skipped — no double-execution risk. The advisory lock inside `runScanJob`
 * provides a second safety net if two closures for the same job do race.
 *
 * Returns the number of jobs re-enqueued.
 */
export async function requeueStalePendingJobs(): Promise<number> {
  const cutoff = new Date(Date.now() - STALE_PENDING_TIMEOUT_MS);
  let requeued = 0;

  try {
    const staleQueued = await db
      .select({ id: scanJobsTable.id, projectId: scanJobsTable.projectId })
      .from(scanJobsTable)
      .where(
        and(
          eq(scanJobsTable.status, "queued"),
          lt(scanJobsTable.createdAt, cutoff),
        ),
      );

    if (staleQueued.length === 0) return 0;

    for (const job of staleQueued) {
      // enqueueWithId returns false if the job is already in the in-memory
      // queue — in that case we skip it silently (it will run shortly).
      const added = heavyJobQueue.enqueueWithId(
        job.id,
        () => runScanJob(job.id, job.projectId),
      );
      if (added) {
        requeued++;
        logger.warn(
          {
            scope: "job-reconciliation",
            code: "STALE_PENDING_REQUEUE",
            jobId: job.id,
            projectId: job.projectId,
            cutoff: cutoff.toISOString(),
            timeoutMs: STALE_PENDING_TIMEOUT_MS,
          },
          "scan job stuck in queued — re-enqueued by stale-pending sweep",
        );
      }
    }
  } catch (err) {
    logger.error({ err, scope: "job-reconciliation" }, "requeueStalePendingJobs failed");
  }

  return requeued;
}

/**
 * Dispatch all durable rows that are waiting to start.
 *
 * The database row is the durable queue record; `heavyJobQueue` is only the
 * local concurrency limiter. Every API instance may observe the same row, so
 * the runners' PostgreSQL advisory locks and atomic claims remain the final
 * duplicate-execution guard.
 *
 * Unlike `requeueStalePendingJobs`, this pass intentionally includes fresh
 * rows. It closes the small failure window where the request committed the
 * durable row but the process died before its fire-and-forget enqueue ran.
 */
export async function dispatchPersistedPendingJobs(): Promise<number> {
  let dispatched = 0;

  try {
    const [queuedScans, pendingDiscoveries] = await Promise.all([
      db
        .select({ id: scanJobsTable.id, projectId: scanJobsTable.projectId })
        .from(scanJobsTable)
        .where(eq(scanJobsTable.status, "queued")),
      db
        .select({ id: discoverySessionsTable.id, rootPath: discoverySessionsTable.rootPath })
        .from(discoverySessionsTable)
        .where(eq(discoverySessionsTable.status, "pending")),
    ]);

    for (const job of queuedScans) {
      if (
        heavyJobQueue.enqueueWithId(job.id, () =>
          runScanJob(job.id, job.projectId),
        )
      ) {
        dispatched++;
      }
    }

    for (const session of pendingDiscoveries) {
      if (
        heavyJobQueue.enqueueWithId(session.id, async () => {
          try {
            await runDiscovery(session.id, session.rootPath);
          } catch (err) {
            logger.error(
              { err, sessionId: session.id },
              "discovery runner threw past its own error handling in durable dispatch",
            );
          }
        })
      ) {
        dispatched++;
      }
    }

    if (dispatched > 0) {
      logger.info(
        {
          dispatched,
          scanCount: queuedScans.length,
          discoveryCount: pendingDiscoveries.length,
        },
        "durable job dispatcher: persisted pending work dispatched",
      );
    }
  } catch (err) {
    // A temporary database problem must not take down the API process. The
    // next interval will retry the durable rows.
    logger.error({ err, scope: "job-reconciliation" }, "durable job dispatch failed");
  }

  return dispatched;
}

/** Content-free durable queue health for operators and health checks. */
export async function getDurableJobHealth(): Promise<{
  status: "healthy" | "degraded";
  queuedScanJobs: number;
  pendingDiscoverySessions: number;
  expiredScanLeases: number;
  expiredDiscoveryLeases: number;
  expiredTaskLeases: number;
  retryExhaustedScanJobs: number;
  retryExhaustedTasks: number;
}> {
  const now = new Date();
  try {
    const [
      [queuedScans],
      [pendingDiscoveries],
      [expiredScans],
      [expiredDiscoveries],
      [expiredTasks],
      [exhaustedScans],
      [exhaustedTasks],
    ] = await Promise.all([
      db.select({ value: count() }).from(scanJobsTable).where(eq(scanJobsTable.status, "queued")),
      db.select({ value: count() }).from(discoverySessionsTable).where(eq(discoverySessionsTable.status, "pending")),
      db.select({ value: count() }).from(scanJobsTable).where(and(eq(scanJobsTable.status, "running"), lt(scanJobsTable.leaseUntil, now))),
      db.select({ value: count() }).from(discoverySessionsTable).where(and(eq(discoverySessionsTable.status, "discovering"), lt(discoverySessionsTable.leaseUntil, now))),
      db.select({ value: count() }).from(tasksTable).where(and(eq(tasksTable.status, "running"), lt(tasksTable.leaseUntil, now))),
      db.select({ value: count() }).from(scanJobsTable).where(and(eq(scanJobsTable.status, "failed"), eq(scanJobsTable.retryCount, scanJobsTable.maxRetries))),
      db.select({ value: count() }).from(tasksTable).where(and(eq(tasksTable.status, "failed"), eq(tasksTable.retryCount, tasksTable.maxRetries))),
    ]);
    const values = {
      queuedScanJobs: Number(queuedScans.value),
      pendingDiscoverySessions: Number(pendingDiscoveries.value),
      expiredScanLeases: Number(expiredScans.value),
      expiredDiscoveryLeases: Number(expiredDiscoveries.value),
      expiredTaskLeases: Number(expiredTasks.value),
      retryExhaustedScanJobs: Number(exhaustedScans.value),
      retryExhaustedTasks: Number(exhaustedTasks.value),
    };
    return { status: values.expiredScanLeases + values.expiredDiscoveryLeases + values.expiredTaskLeases > 0 ? "degraded" : "healthy", ...values };
  } catch (error) {
    logger.error({ error, scope: "job-reconciliation" }, "durable job health query failed");
    return {
      status: "degraded",
      queuedScanJobs: 0,
      pendingDiscoverySessions: 0,
      expiredScanLeases: 0,
      expiredDiscoveryLeases: 0,
      expiredTaskLeases: 0,
      retryExhaustedScanJobs: 0,
      retryExhaustedTasks: 0,
    };
  }
}

/**
 * Keep persisted pending work flowing while the server is alive. This
 * complements startup reconciliation and also lets a healthy instance recover
 * work written by another instance that died before local dispatch.
 */
export function startDurableJobDispatcher(): NodeJS.Timeout {
  logger.info(
    { intervalMs: DURABLE_JOB_DISPATCH_INTERVAL_MS },
    "durable job dispatcher scheduled",
  );

  void dispatchPersistedPendingJobs();
  return setInterval(() => {
    void dispatchPersistedPendingJobs();
  }, DURABLE_JOB_DISPATCH_INTERVAL_MS);
}

/**
 * Start the periodic stale-job sweep. Returns the interval handle so the
 * caller can clear it on graceful shutdown if needed.
 *
 * PR-D1: Now runs both `failStaleRunningJobs` (hung running jobs) and
 * `requeueStalePendingJobs` (lost queued closures) on each tick.
 */
export function startStaleJobSweep(): NodeJS.Timeout {
  logger.info(
    {
      intervalMs: STALE_JOB_SWEEP_INTERVAL_MS,
      timeoutMs: STALE_JOB_TIMEOUT_MS,
      pendingTimeoutMs: STALE_PENDING_TIMEOUT_MS,
    },
    "stale-job sweep scheduled",
  );
  return setInterval(async () => {
    const [failed, requeued, failedDiscoveries, recoveredTasks, expiredUploads] = await Promise.all([
      failStaleRunningJobs(),
      requeueStalePendingJobs(),
      failStaleDiscoverySessions(),
      reconcileStaleAiTasks(),
      sweepExpiredUploads(),
    ]);
    if (failed > 0) {
      logger.warn({ failed }, "stale-job sweep: timed out running scan jobs marked failed");
    }
    if (requeued > 0) {
      logger.warn({ requeued }, "stale-job sweep: stale pending scan jobs re-enqueued");
    }
    if (failedDiscoveries > 0 || recoveredTasks > 0) {
      logger.warn({ failedDiscoveries, recoveredTasks }, "stale-job sweep: abandoned work reconciled");
    }
    if (expiredUploads > 0) {
      logger.info({ expiredUploads }, "stale-job sweep: expired upload entries removed");
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
  const abandonedTask = or(
    lt(tasksTable.leaseUntil, now),
    isNull(tasksTable.leaseUntil),
  );

  const runningTasks = await db
    .select({
      id: tasksTable.id,
      projectId: tasksTable.projectId,
      title: tasksTable.title,
      retryCount: tasksTable.retryCount,
      maxRetries: tasksTable.maxRetries,
    })
    .from(tasksTable)
    .where(and(eq(tasksTable.status, "running"), abandonedTask));

  if (runningTasks.length === 0) return 0;

  let resetCount = 0;
  let failedCount = 0;

  for (const task of runningTasks) {
    const correlationId = randomUUID();

    if (task.retryCount < task.maxRetries) {
      // Reset to verifying so the task can be re-triggered. The AI call was
      // interrupted mid-flight — we can't resume, but we can let it run again.
      const [resetTask] = await db
        .update(tasksTable)
        .set({
          status: "verifying",
          retryCount: task.retryCount + 1,
          updatedAt: now,
          // PR-01: clear lease so the task can be re-claimed on next execution
          workerId: null,
          leaseUntil: null,
          lastHeartbeatAt: null,
        })
        .where(and(eq(tasksTable.id, task.id), eq(tasksTable.status, "running"), abandonedTask))
        .returning({ id: tasksTable.id });

      if (!resetTask) {
        logger.warn(
          {
            scope: "job-reconciliation",
            code: "AI_TASK_RESET_CONFLICT",
            taskId: task.id,
            projectId: task.projectId,
            correlationId,
          },
          "running AI task changed concurrently during reconciliation; reset skipped",
        );
      }

      if (resetTask) {
        invalidateContextCache(task.projectId);
        await db.insert(taskLogsTable).values({
          id: randomUUID(),
          taskId: task.id,
          level: "warn",
          message: `Task reset to "verifying" after process restart (retry ${task.retryCount + 1}/${task.maxRetries}). Re-trigger to execute.`,
          correlationId,
        });
        resetCount++;
      }
    } else {
      // Exceeded maxRetries — mark permanently failed.
      const [failedTask] = await db
        .update(tasksTable)
        .set({
          status: "failed",
          updatedAt: now,
          completedAt: now,
          // PR-01: clear lease on permanent failure
          workerId: null,
          leaseUntil: null,
          lastHeartbeatAt: null,
        })
        .where(and(eq(tasksTable.id, task.id), eq(tasksTable.status, "running"), abandonedTask))
        .returning({ id: tasksTable.id });

      if (!failedTask) {
        logger.warn(
          {
            scope: "job-reconciliation",
            code: "AI_TASK_FAIL_CONFLICT",
            taskId: task.id,
            projectId: task.projectId,
            correlationId,
          },
          "running AI task changed concurrently during reconciliation; failure write skipped",
        );
      }

      if (failedTask) {
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
  aiExecutions: number;
  deliveries: number;
  expiredUploads: number;
}> {
  try {
    const [scanJobs, discoverySessions, aiTasks, aiExecutions, deliveries, expiredUploads] = await Promise.all([
      reconcileScanJobs(),
      reconcileDiscoverySessions(),
      reconcileAiTasks(),
      reconcileAiExecutions(),
      reconcileInterruptedDeliveries(),
      sweepExpiredUploads(),
    ]);
    if (aiExecutions > 0) {
      logger.info({ aiExecutions }, "startup reconciliation: paused interrupted AI executions");
    }
    if (expiredUploads > 0) {
      logger.info({ expiredUploads }, "startup reconciliation: expired upload entries swept");
    }
    return { scanJobs, discoverySessions, aiTasks, aiExecutions, deliveries, expiredUploads };
  } catch (err) {
    logger.error({ err }, "startup job reconciliation failed");
    return { scanJobs: 0, discoverySessions: 0, aiTasks: 0, aiExecutions: 0, deliveries: 0, expiredUploads: 0 };
  }
}
