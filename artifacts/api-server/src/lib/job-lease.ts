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
import { and, eq, gt, sql } from "drizzle-orm";

export type ScanJobTransaction = Parameters<Parameters<typeof db.transaction>[0]>[0];

// Lease timestamps are stored as timestamp-without-time-zone. Use UTC-naive
// values from PostgreSQL so workers on different hosts do not make ownership
// decisions using their own clocks.
const databaseNow = () => sql<Date>`clock_timestamp() AT TIME ZONE 'UTC'`;
const databaseLeaseUntil = (leaseMs: number) =>
  sql<Date>`(clock_timestamp() AT TIME ZONE 'UTC') + (${leaseMs} * interval '1 millisecond')`;

export class ScanJobLeaseLostError extends Error {
  constructor(jobId: string) {
    super(`scan job ${jobId} is no longer owned by this worker`);
    this.name = "ScanJobLeaseLostError";
  }
}

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
  const updated = await db
    .update(scanJobsTable)
    .set({
      status: "running",
      workerId,
      leaseUntil: databaseLeaseUntil(leaseMs),
      lastHeartbeatAt: databaseNow(),
      startedAt: databaseNow(),
    })
    .where(and(eq(scanJobsTable.id, jobId), eq(scanJobsTable.status, "queued")))
    .returning({ id: scanJobsTable.id });
  return updated.length > 0;
}

/**
 * Extend a scan-job's lease only while its current lease is still live.
 * Expiry is not renewable: once the deadline passes, only reconciliation
 * can recover the job and the old worker must stop.
 */
export async function heartbeatScanJob(
  jobId: string,
  workerId: string,
  leaseMs: number,
): Promise<boolean> {
  const updated = await db
    .update(scanJobsTable)
    .set({
      leaseUntil: databaseLeaseUntil(leaseMs),
      lastHeartbeatAt: databaseNow(),
    })
    .where(and(
      eq(scanJobsTable.id, jobId),
      eq(scanJobsTable.status, "running"),
      eq(scanJobsTable.workerId, workerId),
      gt(scanJobsTable.leaseUntil, databaseNow()),
    ))
    .returning({ id: scanJobsTable.id });
  return updated.length > 0;
}

/**
 * Mark a scan job complete inside the same transaction as its scan effects.
 * If the lease has expired or ownership changed, throw so the caller's
 * transaction rolls back every effect produced by that scan.
 */
export async function completeScanJobInTransaction(
  tx: ScanJobTransaction,
  jobId: string,
  workerId: string,
  result: Record<string, unknown>,
  finishedAt?: Date,
): Promise<void> {
  const [updated] = await tx
    .update(scanJobsTable)
    .set({
      status: "completed",
      result,
      finishedAt: finishedAt ?? databaseNow(),
      workerId: null,
      leaseUntil: null,
      lastHeartbeatAt: null,
    })
    .where(and(
      eq(scanJobsTable.id, jobId),
      eq(scanJobsTable.workerId, workerId),
      eq(scanJobsTable.status, "running"),
      gt(scanJobsTable.leaseUntil, databaseNow()),
    ))
    .returning({ id: scanJobsTable.id });
  if (!updated) throw new ScanJobLeaseLostError(jobId);
}

/**
 * Run scan persistence and its terminal ownership transition in one database
 * transaction. A rejected fence rolls back the callback's writes as well.
 */
export async function persistScanJobTransaction<T extends object>(
  jobId: string,
  workerId: string,
  persistEffects: (tx: ScanJobTransaction) => Promise<T>,
): Promise<T> {
  return db.transaction(async (tx) => {
    const result = await persistEffects(tx);
    await completeScanJobInTransaction(
      tx,
      jobId,
      workerId,
      result as Record<string, unknown>,
    );
    return result;
  });
}

/**
 * Compatibility helper for callers that only need the terminal transition.
 * Scan runners should use completeScanJobInTransaction so completion and
 * persisted effects cannot diverge.
 */
export async function completeScanJob(
  jobId: string,
  workerId: string,
  result: Record<string, unknown>,
  finishedAt?: Date,
): Promise<boolean> {
  try {
    await db.transaction((tx) =>
      completeScanJobInTransaction(tx, jobId, workerId, result, finishedAt),
    );
    return true;
  } catch (error) {
    if (error instanceof ScanJobLeaseLostError) return false;
    throw error;
  }
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
      finishedAt: finishedAt ?? databaseNow(),
      workerId: null,
      leaseUntil: null,
      lastHeartbeatAt: null,
    })
    .where(and(
      eq(scanJobsTable.id, jobId),
      eq(scanJobsTable.workerId, workerId),
      eq(scanJobsTable.status, "running"),
      gt(scanJobsTable.leaseUntil, databaseNow()),
    ))
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

