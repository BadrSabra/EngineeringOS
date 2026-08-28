import { db, auditLogsTable, pendingAuditLogsTable, auditEntityTypeEnum, auditActionEnum } from "@workspace/db";
import { eq } from "drizzle-orm";
import { randomUUID } from "crypto";
import { logger } from "./logger.js";
import {
  decrementPendingAudits,
  incrementAuditFailures,
  incrementAuditPersistenceUnavailable,
  incrementMutationsWithoutAudit,
  incrementPendingAudits,
  incrementRecoveredAudits,
  setPendingAudits,
} from "./operational-counters.js";

// Derived from the DB enum so the schema stays the single source of truth —
// adding a new entity type or action means updating lib/db/src/schema/audit_logs.ts
// once, and both the DB constraint and this type stay in sync.
export type AuditEntityType = (typeof auditEntityTypeEnum.enumValues)[number];
export type AuditAction = (typeof auditActionEnum.enumValues)[number];

export interface RecordAuditParams {
  entityType: AuditEntityType;
  entityId: string;
  action: AuditAction;
  projectId?: string | null;
  actor?: string;
  changedFields?: Record<string, unknown>;
  stateBefore?: Record<string, unknown> | null;
  stateAfter?: Record<string, unknown> | null;
  reason?: string;
  /** Ties this audit entry to the logical operation that triggered it.
   *  Same value should be set on the corresponding events/task_logs/metrics
   *  rows so the full operation trace can be retrieved with one filter. */
  correlationId?: string;
}

type PendingAudit = {
  row: typeof auditLogsTable.$inferInsert;
  attempts: number;
  nextAttemptAt: number;
};

type AuditWriter = Pick<typeof db, "insert">;

const pendingAudits = new Map<string, PendingAudit>();
const retryDelaysMs = [1_000, 5_000, 30_000, 60_000];
let retryTimer: NodeJS.Timeout | undefined;
let draining = false;

async function insertAudit(row: typeof auditLogsTable.$inferInsert): Promise<void> {
  await db.insert(auditLogsTable).values(row).onConflictDoNothing();
}

function isDeletedProjectReference(
  error: unknown,
  row: typeof auditLogsTable.$inferInsert,
): boolean {
  if (!row.projectId) return false;

  let current: unknown = error;
  for (let depth = 0; current && depth < 4; depth++) {
    if (typeof current !== "object") break;
    const candidate = current as {
      code?: unknown;
      constraint?: unknown;
      message?: unknown;
      cause?: unknown;
    };
    const message = typeof candidate.message === "string" ? candidate.message : "";
    if (
      candidate.code === "23503" &&
      (
        candidate.constraint === "audit_logs_project_id_projects_id_fk" ||
        message.includes("audit_logs_project_id_projects_id_fk")
      )
    ) {
      return true;
    }
    current = candidate.cause;
  }
  return false;
}

function buildAuditRow(params: RecordAuditParams): typeof auditLogsTable.$inferInsert {
  return {
    id: randomUUID(),
    entityType: params.entityType,
    entityId: params.entityId,
    action: params.action,
    projectId: params.projectId ?? null,
    actor: params.actor ?? "system",
    changedFields: params.changedFields ?? null,
    stateBefore: params.stateBefore ?? null,
    stateAfter: params.stateAfter ?? null,
    reason: params.reason ?? null,
    correlationId: params.correlationId ?? null,
  };
}

function scheduleRetry(): void {
  if (retryTimer || pendingAudits.size === 0) return;
  const next = Math.max(0, Math.min(...[...pendingAudits.values()].map((item) => item.nextAttemptAt)) - Date.now());
  retryTimer = setTimeout(() => {
    retryTimer = undefined;
    void drainPendingAudits();
  }, next);
  retryTimer.unref?.();
}

async function persistPendingAudit(pending: PendingAudit): Promise<void> {
  await db
    .insert(pendingAuditLogsTable)
    .values({
      id: pending.row.id!,
      row: pending.row as Record<string, unknown>,
      attempts: pending.attempts,
      nextAttemptAt: new Date(pending.nextAttemptAt),
    })
    .onConflictDoUpdate({
      target: pendingAuditLogsTable.id,
      set: {
        row: pending.row as Record<string, unknown>,
        attempts: pending.attempts,
        nextAttemptAt: new Date(pending.nextAttemptAt),
      },
    });
}

async function removePersistedAudit(id: string): Promise<void> {
  await db.delete(pendingAuditLogsTable).where(eq(pendingAuditLogsTable.id, id));
}

/**
 * Reload the durable outbox before accepting traffic. A temporary database
 * outage must not make startup fail; the next process-local retry will still
 * attempt to recover rows once the database is reachable.
 */
export async function loadPendingAudits(): Promise<void> {
  try {
    const rows = await db.select().from(pendingAuditLogsTable);
    pendingAudits.clear();
    for (const persisted of rows) {
      pendingAudits.set(persisted.id, {
        row: persisted.row as typeof auditLogsTable.$inferInsert,
        attempts: persisted.attempts,
        nextAttemptAt: persisted.nextAttemptAt.getTime(),
      });
    }
    setPendingAudits(pendingAudits.size);
    logger.info({ pendingAudits: pendingAudits.size }, "reloaded pending audit log entries");
    scheduleRetry();
  } catch (err) {
    incrementAuditPersistenceUnavailable();
    logger.error({ err }, "failed to reload pending audit log entries; continuing with an empty in-memory queue");
  }
}

/**
 * Retry every failed audit write indefinitely with exponential backoff.
 *
 * The business mutation is deliberately not rolled back when audit storage is
 * unavailable. The row remains in this process-local queue until it is
 * accepted by the database, and healthz exposes the pending count so an
 * operator can see that recovery is still required. A retry is keyed by the
 * original row id, so retrying cannot create a second logical audit entry.
 */
export async function drainPendingAudits(): Promise<void> {
  if (draining) return;
  draining = true;
  try {
    const now = Date.now();
    for (const [id, pending] of pendingAudits) {
      if (pending.nextAttemptAt > now) continue;
      try {
        await insertAudit(pending.row);
        pendingAudits.delete(id);
        await removePersistedAudit(id);
        decrementPendingAudits();
        incrementRecoveredAudits();
        logger.info({ auditId: id, attempts: pending.attempts + 1 }, "recovered pending audit log entry");
      } catch (err) {
        if (isDeletedProjectReference(err, pending.row)) {
          const originalProjectId = pending.row.projectId;
          const historicalRow = { ...pending.row, projectId: null };
          try {
            await insertAudit(historicalRow);
            pendingAudits.delete(id);
            await removePersistedAudit(id);
            decrementPendingAudits();
            incrementRecoveredAudits();
            logger.warn(
              { auditId: id, originalProjectId, attempts: pending.attempts + 1 },
              "recovered pending audit log entry after project deletion",
            );
            continue;
          } catch (fallbackErr) {
            err = fallbackErr;
          }
        }
        pending.attempts++;
        pending.nextAttemptAt = Date.now() + retryDelaysMs[Math.min(pending.attempts - 1, retryDelaysMs.length - 1)]!;
        try {
          await persistPendingAudit(pending);
        } catch (persistErr) {
          incrementAuditPersistenceUnavailable();
          logger.error({ err: persistErr, auditId: id }, "failed to update durable pending audit entry");
        }
        incrementAuditFailures();
        logger.error({ err, auditId: id, attempts: pending.attempts }, "audit log retry failed; retaining entry for another retry");
      }
    }
  } finally {
    draining = false;
    scheduleRetry();
  }
}

/**
 * Insert a single audit_logs row capturing a state change.
 *
 * Audit failure never suppresses a successful business operation. Instead,
 * the exact row is retained and retried until the database accepts it.
 */
export async function recordAudit(params: RecordAuditParams): Promise<void> {
  const row = buildAuditRow(params);
  try {
    await insertAudit(row);
  } catch (err) {
    incrementAuditFailures();
    const pending = { row, attempts: 0, nextAttemptAt: Date.now() };
    pendingAudits.set(row.id, pending);
    incrementPendingAudits();
    try {
      await persistPendingAudit(pending);
    } catch (persistErr) {
      incrementAuditPersistenceUnavailable();
      incrementMutationsWithoutAudit();
      logger.error({ err: persistErr, auditId: row.id }, "audit destination and durable outbox unavailable; audit is not durably retained");
    }
    logger.error(
      { err, auditId: row.id, entityType: params.entityType, entityId: params.entityId, action: params.action },
      "failed to record audit log entry; queued for retry",
    );
    scheduleRetry();
  }
}

/** Write an audit row in the caller's authoritative business transaction. */
export async function recordAuditInTransaction(
  tx: AuditWriter,
  params: RecordAuditParams,
): Promise<void> {
  await tx.insert(auditLogsTable).values(buildAuditRow(params)).onConflictDoNothing();
}

export function getPendingAuditCount(): number {
  return pendingAudits.size;
}
