/**
 * PR-01 (Durable Jobs): Atomic claim / heartbeat / complete / fail helpers.
 *
 * These helpers turn background job lifecycle transitions into single,
 * atomic DB writes so there is never a window between "status changed to
 * running" and "lease/workerId set". This lets job-reconciliation distinguish
 * "job is still being worked on by a live worker" from "job was abandoned by a
 * crashed process" purely from the DB row state.
 *
 * Usage contract for every background runner:
 *
 *   1. Call claimXxx(id, workerId, leaseMs) BEFORE starting any work.
 *      If it returns false, bail out — another worker already owns the job.
 *   2. Start a setInterval that calls heartbeatXxx to extend lease_until
 *      before it expires. Use an interval ≤ leaseMs / 3 (default: 1 min).
 *   3. On success, call completeXxx / releaseXxxLease.
 *      On failure, call failXxx / releaseXxxLease.
 *      In finally: always clearInterval.
 *
 * The stale-job sweep in job-reconciliation.ts recovers jobs whose
 * lease_until has fallen behind now() without a clean completion/failure
 * write — e.g. because the worker process was OOM-killed.
 */
import { db } from "@workspace/db";
import { scanJobsTable, discoverySessionsTable, tasksTable } from "@workspace/db";
import { and, eq } from "drizzle-orm";

// ── Lease duration constants ───────────────────────────────────────────────────

/** How long a scan-job worker's lease stays valid between heartbeats (ms). */
export const SCAN_LEASE_MS = Number(
  process.env.SCAN_LEASE_MS ?? 5 * 60 * 1000, // 5 minutes
);

/** How often a scan-job worker should send a heartbeat to extend its lease (ms). */
export const SCAN_HEARTBEAT_INTERVAL_MS = Number(
  process.env.SCAN_HEARTBEAT_INTERVAL_MS ?? 60 * 1000, // 1 minute
);

/**
 * How long a discovery-session worker's lease stays valid between
 * heartbeats. Longer than scan leases because the pipeline (9 steps)
 * includes slower operations like walkProject and extractGraph.
 */
export const DISCOVERY_LEASE_MS = Number(
  process.env.DISCOVERY_LEASE_MS ?? 10 * 60 * 1000, // 10 minutes
);

/** How often a discovery-session worker should heartbeat (ms). */
export const DISCOVERY_HEARTBEAT_INTERVAL_MS = Number(
  process.env.DISCOVERY_HEARTBEAT_INTERVAL_MS ?? 60 * 1000, // 1 minute
);

/** How long an AI-task worker's lease stays valid between heartbeats (ms). */
export const AI_TASK_LEASE_MS = Number(
  process.env.AI_TASK_LEASE_MS ?? 5 * 60 * 1000, // 5 minutes
);

/** How often an AI-task worker should heartbeat (ms). */
export const AI_TASK_HEARTBEAT_INTERVAL_MS = Number(
  process.env.AI_TASK_HEARTBEAT_INTERVAL_MS ?? 60 * 1000, // 1 minute
);

// ── Scan-job lease helpers ─────────────────────────────────────────────────────

/**
 * Atomically transition a scan_job from queued → running, assigning a
 * workerId and an initial lease. Returns true if the claim succeeded
 * (this worker now owns the job), false if the job was already in a
 * non-queued state (claimed by another worker or already completed).
 */
export async function claimScanJob(
  jobId: string,
  workerId: string,
  leaseMs: number,
): Promise<boolean> {
  const now = new Date();
  const leaseUntil = new Date(now.getTime() + leaseMs);
  const updated = await db
    .update(scanJobsTable)
    .set({
      status: "running",
      workerId,
      leaseUntil,
      lastHeartbeatAt: now,
      startedAt: now,
    })
    .where(and(eq(scanJobsTable.id, jobId), eq(scanJobsTable.status, "queued")))
    .returning({ id: scanJobsTable.id });
  return updated.length > 0;
}

/**
 * Extend a scan-job's lease by `leaseMs` from now. Silently no-ops if
 * the workerId no longer matches (e.g. another worker reclaimed the job
 * after a lease expiry).
 */
export async function heartbeatScanJob(
  jobId: string,
  workerId: string,
  leaseMs: number,
): Promise<void> {
  const now = new Date();
  const leaseUntil = new Date(now.getTime() + leaseMs);
  await db
    .update(scanJobsTable)
    .set({ leaseUntil, lastHeartbeatAt: now })
    .where(and(eq(scanJobsTable.id, jobId), eq(scanJobsTable.workerId, workerId)));
}

/**
 * Atomically mark a scan_job as completed and release the lease in one write.
 * The workerId guard is part of the terminal fence. A stale worker must not
 * complete a job after reconciliation has cleared its lease and another
 * worker has claimed it.
 */
export async function completeScanJob(
  jobId: string,
  workerId: string,
  result: Record<string, unknown>,
  finishedAt?: Date,
): Promise<boolean> {
  const updated = await db
    .update(scanJobsTable)
    .set({
      status: "completed",
      result,
      finishedAt: finishedAt ?? new Date(),
      workerId: null,
      leaseUntil: null,
      lastHeartbeatAt: null,
    })
    .where(and(eq(scanJobsTable.id, jobId), eq(scanJobsTable.workerId, workerId), eq(scanJobsTable.status, "running")))
    .returning({ id: scanJobsTable.id });
  return updated.length > 0;
}

/**
 * Atomically mark a scan_job as failed and release the lease in one write.
 */
export async function failScanJob(
  jobId: string,
  workerId: string,
  error: string,
  finishedAt?: Date,
): Promise<boolean> {
  const updated = await db
    .update(scanJobsTable)
    .set({
      status: "failed",
      error,
      finishedAt: finishedAt ?? new Date(),
      workerId: null,
      leaseUntil: null,
      lastHeartbeatAt: null,
    })
    .where(and(eq(scanJobsTable.id, jobId), eq(scanJobsTable.workerId, workerId), eq(scanJobsTable.status, "running")))
    .returning({ id: scanJobsTable.id });
  return updated.length > 0;
}

// ── Discovery-session lease helpers ───────────────────────────────────────────

/**
 * Atomically transition a discovery_session from pending → discovering,
 * assigning a workerId and an initial lease. Returns true on success.
 */
export async function claimDiscoverySession(
  sessionId: string,
  workerId: string,
  leaseMs: number,
): Promise<boolean> {
  const now = new Date();
  const leaseUntil = new Date(now.getTime() + leaseMs);
  const updated = await db
    .update(discoverySessionsTable)
    .set({
      status: "discovering",
      workerId,
      leaseUntil,
      lastHeartbeatAt: now,
    })
    .where(
      and(
        eq(discoverySessionsTable.id, sessionId),
        eq(discoverySessionsTable.status, "pending"),
      ),
    )
    .returning({ id: discoverySessionsTable.id });
  return updated.length > 0;
}

/**
 * Extend a discovery session's lease. Silently no-ops if the workerId
 * no longer matches.
 */
export async function heartbeatDiscoverySession(
  sessionId: string,
  workerId: string,
  leaseMs: number,
): Promise<void> {
  const now = new Date();
  const leaseUntil = new Date(now.getTime() + leaseMs);
  await db
    .update(discoverySessionsTable)
    .set({ leaseUntil, lastHeartbeatAt: now })
    .where(
      and(
        eq(discoverySessionsTable.id, sessionId),
        eq(discoverySessionsTable.workerId, workerId),
      ),
    );
}

/**
 * Release the lease fields for a discovery session after completion or
 * failure. Called alongside the final status updateSession to ensure
 * lease fields are cleared even when the session transitions to a
 * terminal state.
 */
export async function releaseDiscoverySessionLease(sessionId: string): Promise<void> {
  await db
    .update(discoverySessionsTable)
    .set({ workerId: null, leaseUntil: null, lastHeartbeatAt: null })
    .where(eq(discoverySessionsTable.id, sessionId));
}

// ── AI-task lease helpers ──────────────────────────────────────────────────────

/**
 * Atomically claim an AI task (verifying → running) with a lease.
 * Returns true if the claim succeeded.
 */
export async function claimAiTask(
  taskId: string,
  workerId: string,
  leaseMs: number,
): Promise<boolean> {
  const now = new Date();
  const leaseUntil = new Date(now.getTime() + leaseMs);
  const updated = await db
    .update(tasksTable)
    .set({ status: "running", workerId, leaseUntil, lastHeartbeatAt: now, updatedAt: now })
    .where(and(eq(tasksTable.id, taskId), eq(tasksTable.status, "verifying")))
    .returning({ id: tasksTable.id });
  return updated.length > 0;
}

/**
 * Extend an AI task's lease. Silently no-ops if workerId no longer matches.
 */
export async function heartbeatAiTask(
  taskId: string,
  workerId: string,
  leaseMs: number,
): Promise<void> {
  const now = new Date();
  const leaseUntil = new Date(now.getTime() + leaseMs);
  await db
    .update(tasksTable)
    .set({ leaseUntil, lastHeartbeatAt: now, updatedAt: now })
    .where(and(eq(tasksTable.id, taskId), eq(tasksTable.workerId, workerId)));
}

/**
 * Release an AI task's lease fields. Called after any terminal status
 * transition (completed, failed, or reset to verifying).
 */
export async function releaseAiTaskLease(taskId: string): Promise<void> {
  await db
    .update(tasksTable)
    .set({ workerId: null, leaseUntil: null, lastHeartbeatAt: null })
    .where(eq(tasksTable.id, taskId));
}

