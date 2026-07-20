import { db } from "@workspace/db";
import { auditLogsTable, auditEntityTypeEnum, auditActionEnum } from "@workspace/db";
import { randomUUID } from "crypto";
import { logger } from "./logger.js";
import { incrementAuditFailures } from "./operational-counters.js";

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

/**
 * Insert a single audit_logs row capturing a state change.
 *
 * Design decision: audit writes are intentionally best-effort telemetry,
 * NOT a silent fallback of business logic. The primary mutation (project
 * update, task execute, etc.) has already committed successfully by the
 * time this is called — an audit-table outage should not turn a successful
 * user-facing write into a 500. Failures are therefore caught and logged
 * loudly via the structured logger (visible in workflow/production logs)
 * rather than propagated. If audit_logs ever becomes a compliance-critical,
 * queryable-by-users record rather than internal traceability, this
 * decision should be revisited (e.g. write inside the same DB transaction
 * as the mutation so both succeed or both roll back).
 */
export async function recordAudit(params: RecordAuditParams): Promise<void> {
  try {
    await db.insert(auditLogsTable).values({
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
    });
  } catch (err) {
    // PR-2: increment the in-process counter so GET /api/healthz can surface
    // audit-write degradation without requiring operators to search logs.
    incrementAuditFailures();
    logger.error(
      { err, entityType: params.entityType, entityId: params.entityId, action: params.action },
      "failed to record audit log entry",
    );
  }
}
