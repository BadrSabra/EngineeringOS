import { and, eq } from "drizzle-orm";
import {
  db,
  aiApplyJournalTable,
  aiChangeProposalsTable,
  auditLogsTable,
  eventsTable,
  taskLogsTable,
} from "@workspace/db";
import type { AiExecution } from "@workspace/db";
import { redactUserFacingText, redactUserFacingValue } from "./ai-route-helpers.js";

export const OPERATION_EVIDENCE_LIMITS = {
  events: 120,
  audit: 80,
  taskLogs: 80,
  journal: 80,
  receipts: 80,
  gaps: 24,
} as const;

export type EvidenceCompleteness =
  | "complete"
  | "partial"
  | "retained-with-gaps"
  | "blocked"
  | "failed"
  | "cancelled"
  | "uncertain";

export type EvidenceGap = {
  kind: "missing" | "expired" | "inaccessible" | "mismatch" | "unrecorded";
  source: "execution" | "checkpoint" | "event" | "audit" | "task-log" | "journal" | "proposal" | "revision";
  detail: string;
};

export type OperationReceipt = {
  kind: "process" | "provider" | "validation" | "promotion" | "commit" | "push";
  status: "started" | "passed" | "failed" | "blocked" | "cancelled" | "unknown";
  attempt: number;
  timestamp: string;
  detail?: string;
  diagnostic?: string;
};

export type OperationEvidenceProjection = {
  version: 1;
  redacted: true;
  operationId: string;
  projectId: string;
  revision: string | null;
  terminalState: string;
  completeness: EvidenceCompleteness;
  verified: false;
  hashes: {
    changeSet: string | null;
    committed: string | null;
  };
  counts: {
    executions: number;
    checkpoints: number;
    events: number;
    audit: number;
    taskLogs: number;
    journal: number;
    receipts: number;
  };
  receipts: OperationReceipt[];
  gaps: EvidenceGap[];
};

export type EvidenceInput = {
  execution: Pick<AiExecution, "id" | "projectId" | "operationId" | "correlationId" | "status" | "attempt" | "checkpoint" | "checkpointVersion" | "request" | "baseRevision" | "error" | "createdAt" | "startedAt" | "completedAt">;
  events?: Array<{
    id: string; type: string; severity: string; message: string; timestamp: Date; payload: Record<string, unknown> | null;
  }>;
  audits?: Array<{ id: string; action: string; entityType: string; timestamp: Date; reason: string | null }>;
  taskLogs?: Array<{ id: string; level: string; message: string; timestamp: Date; metadata: Record<string, unknown> | null }>;
  journal?: Array<{ id: string; stage: string; sequence: number; attemptId: string; createdAt: Date; payload: Record<string, unknown> }>;
  proposal?: { revision: number; baseRevision: string | null; changeSetHash: string | null; committedHash: string | null } | null;
};

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function text(value: unknown, limit = 500): string | undefined {
  return typeof value === "string" && value.trim() ? redactUserFacingText(value).slice(0, limit) : undefined;
}

function status(value: unknown): OperationReceipt["status"] {
  const normalized = String(value ?? "").toLowerCase();
  if (normalized.includes("cancel")) return "cancelled";
  if (normalized.includes("block")) return "blocked";
  if (["passed", "success", "succeeded", "completed", "applied", "committed", "pushed"].includes(normalized)) return "passed";
  if (["failed", "error", "rejected", "conflicted"].includes(normalized)) return "failed";
  if (["started", "running", "queued", "pending"].includes(normalized)) return "started";
  return "unknown";
}

function receiptKind(value: string): OperationReceipt["kind"] {
  const normalized = value.toLowerCase();
  if (/provider|model|fallback|llm/.test(normalized)) return "provider";
  if (/validat|test|check/.test(normalized)) return "validation";
  if (/promot|apply|rollback|recovery|delivery/.test(normalized)) return "promotion";
  if (/commit/.test(normalized)) return "commit";
  if (/push/.test(normalized)) return "push";
  return "process";
}

function addGap(gaps: EvidenceGap[], gap: EvidenceGap): void {
  if (gaps.some((item) => item.kind === gap.kind && item.source === gap.source && item.detail === gap.detail)) return;
  if (gaps.length < OPERATION_EVIDENCE_LIMITS.gaps) gaps.push(gap);
}

export function buildOperationEvidenceProjection(input: EvidenceInput): OperationEvidenceProjection {
  const execution = input.execution;
  const checkpoint = record(parseJson(execution.checkpoint));
  const request = record(parseJson(execution.request));
  const operationId = execution.operationId ?? execution.correlationId ?? execution.id;
  const uniqueById = <T extends { id: string }>(items: T[], limit: number): T[] => {
    const seen = new Set<string>();
    return items.filter((item) => {
      if (seen.has(item.id)) return false;
      seen.add(item.id);
      return true;
    }).slice(0, limit);
  };
  const events = uniqueById(input.events ?? [], OPERATION_EVIDENCE_LIMITS.events);
  const audits = uniqueById(input.audits ?? [], OPERATION_EVIDENCE_LIMITS.audit);
  const taskLogs = uniqueById(input.taskLogs ?? [], OPERATION_EVIDENCE_LIMITS.taskLogs);
  const journal = uniqueById(input.journal ?? [], OPERATION_EVIDENCE_LIMITS.journal);
  const gaps: EvidenceGap[] = [];
  const receipts: OperationReceipt[] = [];
  const pushReceipt = (kind: OperationReceipt["kind"], value: unknown, timestamp: Date | string, attempt = 0, diagnostic?: unknown) => {
    receipts.push({
      kind,
      status: status(value),
      attempt: Math.max(0, Math.min(100, Number.isInteger(attempt) ? attempt : 0)),
      timestamp: new Date(timestamp).toISOString(),
      ...(text(value) ? { detail: text(value) } : {}),
      ...(text(diagnostic, 300) ? { diagnostic: text(diagnostic, 300) } : {}),
    });
  };

  pushReceipt("process", "started", execution.startedAt ?? execution.createdAt, execution.attempt);
  for (const event of events) {
    const payload = record(event.payload);
    const kind = receiptKind(event.type);
    pushReceipt(
      kind,
      payload.status ?? event.type,
      event.timestamp,
      Number(payload.attempt ?? execution.attempt),
      kind === "provider" ? "Provider diagnostic retained in server logs." : event.message,
    );
  }
  for (const entry of journal) {
    pushReceipt(receiptKind(entry.stage), entry.stage, entry.createdAt, Number(record(entry.payload).attempt ?? 0), record(entry.payload).reason);
  }
  if (execution.completedAt) pushReceipt("process", execution.status, execution.completedAt, execution.attempt, execution.error);

  const revision = text(request.workspaceRevision, 200) ?? text(input.proposal?.baseRevision, 200) ?? text(execution.baseRevision, 200) ?? null;
  if (!revision) addGap(gaps, { kind: "unrecorded", source: "revision", detail: "The operation revision was not retained." });
  if (execution.checkpointVersion <= 0 || Object.keys(checkpoint).length === 0) {
    addGap(gaps, { kind: "missing", source: "checkpoint", detail: "No durable checkpoint was retained." });
  }
  if (events.length === 0) addGap(gaps, { kind: "missing", source: "event", detail: "No correlated operational events were retained." });
  if (execution.status === "completed" && receipts.every((receipt) => receipt.kind !== "validation")) {
    addGap(gaps, { kind: "missing", source: "event", detail: "A completed execution has no retained validation receipt." });
  }
  if (execution.status === "completed" && !input.proposal && record(request.objective).type === "delivery") {
    addGap(gaps, { kind: "missing", source: "proposal", detail: "The delivery proposal is no longer available." });
  }
  if (input.proposal?.baseRevision && revision && input.proposal.baseRevision !== revision) {
    addGap(gaps, { kind: "mismatch", source: "revision", detail: "Evidence revisions do not agree." });
  }
  if (execution.error) addGap(gaps, { kind: "unrecorded", source: "execution", detail: "The execution retained a failure diagnostic." });

  const terminalState = execution.status.toUpperCase();
  let completeness: EvidenceCompleteness;
  if (execution.status === "cancelled" || execution.status === "cancelling") completeness = "cancelled";
  else if (execution.status === "failed") completeness = "failed";
  else if (execution.status === "completed" && gaps.length === 0) completeness = "complete";
  else if (execution.status === "completed" && gaps.some((gap) => gap.kind === "mismatch" || gap.source === "revision")) completeness = "uncertain";
  else if (execution.status === "completed") completeness = "retained-with-gaps";
  else if (["blocked", "paused"].includes(execution.status)) completeness = "blocked";
  else completeness = gaps.length > 0 ? "partial" : "uncertain";

  return {
    version: 1,
    redacted: true,
    operationId,
    projectId: execution.projectId,
    revision,
    terminalState,
    completeness,
    verified: false,
    hashes: {
      changeSet: text(input.proposal?.changeSetHash, 128) ?? null,
      committed: text(input.proposal?.committedHash, 128) ?? null,
    },
    counts: {
      executions: 1,
      checkpoints: execution.checkpointVersion > 0 ? 1 : 0,
      events: events.length,
      audit: audits.length,
      taskLogs: taskLogs.length,
      journal: journal.length,
      receipts: Math.min(receipts.length, OPERATION_EVIDENCE_LIMITS.receipts),
    },
    receipts: receipts.slice(0, OPERATION_EVIDENCE_LIMITS.receipts),
    gaps,
  };
}

function parseJson(value: string | null): unknown {
  try { return JSON.parse(value ?? ""); } catch { return undefined; }
}

export async function loadOperationEvidence(execution: AiExecution): Promise<OperationEvidenceProjection> {
  const operationId = execution.operationId ?? execution.correlationId ?? execution.id;
  const [events, audits, taskLogs, journal, proposals] = await Promise.all([
    db.select({
      id: eventsTable.id, type: eventsTable.type, severity: eventsTable.severity, message: eventsTable.message,
      timestamp: eventsTable.timestamp, payload: eventsTable.payload,
    }).from(eventsTable).where(and(eq(eventsTable.projectId, execution.projectId), eq(eventsTable.correlationId, operationId))),
    db.select({
      id: auditLogsTable.id, action: auditLogsTable.action, entityType: auditLogsTable.entityType,
      timestamp: auditLogsTable.timestamp, reason: auditLogsTable.reason,
    }).from(auditLogsTable).where(and(eq(auditLogsTable.projectId, execution.projectId), eq(auditLogsTable.correlationId, operationId))),
    execution.linkedTaskId
      ? db.select({
          id: taskLogsTable.id, level: taskLogsTable.level, message: taskLogsTable.message,
          timestamp: taskLogsTable.timestamp, metadata: taskLogsTable.metadata,
        }).from(taskLogsTable).where(and(eq(taskLogsTable.taskId, execution.linkedTaskId), eq(taskLogsTable.correlationId, operationId)))
      : Promise.resolve([]),
    db.select({
      id: aiApplyJournalTable.id, stage: aiApplyJournalTable.stage, sequence: aiApplyJournalTable.sequence,
      attemptId: aiApplyJournalTable.attemptId, createdAt: aiApplyJournalTable.createdAt, payload: aiApplyJournalTable.payload,
    }).from(aiApplyJournalTable).where(and(eq(aiApplyJournalTable.projectId, execution.projectId), eq(aiApplyJournalTable.operationId, operationId))),
    execution.proposalId
      ? db.select({
          revision: aiChangeProposalsTable.revision, baseRevision: aiChangeProposalsTable.baseRevision,
          changeSetHash: aiChangeProposalsTable.changeSetHash, committedHash: aiChangeProposalsTable.committedHash,
        }).from(aiChangeProposalsTable).where(and(eq(aiChangeProposalsTable.id, execution.proposalId), eq(aiChangeProposalsTable.projectId, execution.projectId))).limit(1)
      : Promise.resolve([]),
  ]);
  return buildOperationEvidenceProjection({
    execution,
    events,
    audits,
    taskLogs,
    journal,
    proposal: proposals[0] ?? null,
  });
}

export function redactOperationEvidence(value: OperationEvidenceProjection): OperationEvidenceProjection {
  return redactUserFacingValue(value) as OperationEvidenceProjection;
}