import { db } from "@workspace/db";
import { auditLogsTable, auditEntityTypeEnum, auditActionEnum } from "@workspace/db";
import { randomUUID } from "crypto";
import { logger } from "./logger.js";
import {
  decrementPendingAudits,
  incrementAuditFailures,
  incrementPendingAudits,
  incrementRecoveredAudits,
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

const pendingAudits = new Map<string, PendingAudit>();
const retryDelaysMs = [1_000, 5_000, 30_000, 60_000];
let retryTimer: NodeJS.Timeout | undefined;
let draining = false;

async function insertAudit(row: typeof auditLogsTable.$inferInsert): Promise<void> {
  await db.insert(auditLogsTable).values(row);
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
        decrementPendingAudits();
        incrementRecoveredAudits();
        logger.info({ auditId: id, attempts: pending.attempts + 1 }, "recovered pending audit log entry");
      } catch (err) {
        pending.attempts++;
        pending.nextAttemptAt = Date.now() + retryDelaysMs[Math.min(pending.attempts - 1, retryDelaysMs.length - 1)]!;
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
  const row: typeof auditLogsTable.$inferInsert = {
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
  try {
    await insertAudit(row);
  } catch (err) {
    incrementAuditFailures();
    pendingAudits.set(row.id, { row, attempts: 0, nextAttemptAt: Date.now() });
    incrementPendingAudits();
    logger.error(
      { err, auditId: row.id, entityType: params.entityType, entityId: params.entityId, action: params.action },
      "failed to record audit log entry; queued for retry",
    );
    scheduleRetry();
  }
}

export function getPendingAuditCount(): number {
  return pendingAudits.size;
}
