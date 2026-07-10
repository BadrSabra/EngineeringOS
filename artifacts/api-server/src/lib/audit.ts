import { db } from "@workspace/db";
import { auditLogsTable } from "@workspace/db";
import { randomUUID } from "crypto";
import { logger } from "./logger.js";

export type AuditEntityType =
  | "project"
  | "task"
  | "rule"
  | "workflow"
  | "plugin"
  | "discovery_session";

export interface RecordAuditParams {
  entityType: AuditEntityType;
  entityId: string;
  action: string;
  projectId?: string | null;
  actor?: string;
  changedFields?: Record<string, unknown>;
  stateBefore?: Record<string, unknown> | null;
  stateAfter?: Record<string, unknown> | null;
  reason?: string;
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
    });
  } catch (err) {
    logger.error(
      { err, entityType: params.entityType, entityId: params.entityId, action: params.action },
      "failed to record audit log entry",
    );
  }
}
