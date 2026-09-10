import { createHash, randomUUID } from "node:crypto";
import { and, desc, eq, inArray, isNull, sql } from "drizzle-orm";
import {
  aiChatMessagesTable,
  aiExecutionAcceptancesTable,
  aiExecutionEvidenceReadsTable,
  aiExecutionEvidenceSnapshotsTable,
  aiExecutionsTable,
  db,
  eventsTable,
  taskLogsTable,
  tasksTable,
} from "@workspace/db";
import { recordAuditInTransaction, type RecordAuditParams } from "./audit.js";

export const ACCEPTANCE_NEXT_ACTION_CODES = [
  "NONE",
  "RESUME_ALLOWED",
  "START_NEW_PROBE",
  "REVIEW_INCOMPLETE_EVIDENCE",
  "ABANDON_EXECUTION",
  "RETRY_AFTER_TIMEOUT",
  "RETRY_AFTER_RATE_LIMIT",
] as const;
export type AcceptanceNextActionCode = (typeof ACCEPTANCE_NEXT_ACTION_CODES)[number];

export type ExecutionAcceptanceDisposition = {
  reasonCodes: string[];
  outcome: "SUCCEEDED" | "FAILED" | "INTERRUPTED";
  failureKind?: string;
  recoveryState: "NONE" | "REQUIRED" | "INCOMPLETE";
  nextActionCode: AcceptanceNextActionCode;
  operatorAction: string;
  retryAfterMs?: number;
  retryAt?: string;
  retryAfterSource?: "provider" | "server_default" | "adaptive_default" | "project_rate_limit";
};

export type EvidenceReadInput = {
  path: string;
  readType?: string;
  lineStart?: number | null;
  lineEnd?: number | null;
  body: string;
  complete?: boolean;
  truncated?: boolean;
};

export type EvidenceSnapshotInput = {
  operationId?: string | null;
  sourceRevision?: string | null;
  candidateIdentity?: string | null;
  verdict?: string;
  required?: boolean;
  /**
   * Some execution contracts are proven by a server-owned validation
   * artifact rather than source-file reads. Keep the acceptance contract
   * required while allowing that artifact-only snapshot to be complete.
   */
  sourceEvidenceRequired?: boolean;
  reads?: readonly EvidenceReadInput[];
};

export type ReusableEvidenceRead = {
  path: string;
  body: string;
};

export type NormalizedEvidenceSnapshot = {
  complete: boolean;
  verdict: string;
  reads: Array<EvidenceReadInput & { complete: boolean; truncated: boolean; byteLength: number; contentHash: string }>;
  totalBytes: number;
  reason?: string;
};

export type FinalizeExecutionAcceptanceParams = {
  executionId: string;
  workerId?: string | null;
  allowExpiredLease?: boolean;
  finalMessageId?: string | null;
  finalMessageContent?: string | null;
  /** Preserve a bounded provider/validation code already persisted on the message. */
  finalMessageErrorCode?: string | null;
  finalizationKey: string;
  outcome: "SUCCEEDED" | "FAILED" | "INTERRUPTED";
  terminalStatus: "completed" | "failed" | "cancelled" | "paused";
  reasonCode: string;
  failureKind?: string;
  recoveryState: "NONE" | "REQUIRED" | "INCOMPLETE";
  retryable?: boolean;
  evidence?: EvidenceSnapshotInput;
  resumable?: boolean;
  disposition?: Record<string, unknown>;
  sourceRevision?: string | null;
  candidateIdentity?: string | null;
  error?: string | null;
  retryAfterMs?: number;
  retryAt?: string;
  proposalId?: string | null;
  recipeReceipt?: unknown;
  checkpoint?: string;
  /**
   * Standalone task executions have no assistant chat row to project. Their
   * task row, logs, events, and audit entry are nevertheless part of the same
   * guarded terminal transaction as the acceptance ledger.
   */
  taskFinalization?: TaskExecutionFinalization;
};

export type TaskExecutionFinalization = {
  taskId: string;
  workerId: string;
  status: "pending" | "queued" | "verifying" | "completed" | "failed" | "cancelled";
  agentResponse: string | null;
  remediationPlan?: typeof tasksTable.$inferSelect["remediationPlan"];
  verificationResult?: typeof tasksTable.$inferSelect["verificationResult"];
  completedAt?: Date | null;
  log?: {
    level: "info" | "warn" | "error";
    message: string;
    metadata?: Record<string, unknown>;
  };
  event?: {
    type: string;
    severity: "info" | "warning" | "error" | "success";
    message: string;
    payload?: Record<string, unknown>;
  };
  audit?: Omit<RecordAuditParams, "entityType" | "entityId" | "projectId" | "correlationId"> & {
    action: RecordAuditParams["action"];
    stateBefore?: Record<string, unknown> | null;
    stateAfter?: Record<string, unknown> | null;
  };
  correlationId?: string | null;
};

export type FinalizeExecutionAcceptanceResult = {
  accepted: boolean;
  duplicate: boolean;
  acceptance?: typeof aiExecutionAcceptancesTable.$inferSelect;
  reason?: string;
};

export type PublicExecutionAcceptance = {
  attempt: number;
  terminalStatus: string;
  outcome: string;
  reasonCode: string;
  nextActionCode: AcceptanceNextActionCode;
  evidenceComplete: boolean;
  evidenceRequired: boolean;
  resumable: boolean;
  disposition?: ExecutionAcceptanceDisposition;
};

function projectAcceptanceDisposition(value: unknown): ExecutionAcceptanceDisposition | undefined {
  if (!value || typeof value !== "object") return undefined;
  const raw = value as Partial<ExecutionAcceptanceDisposition>;
  const reasonCodes = Array.isArray(raw.reasonCodes)
    ? raw.reasonCodes.filter((code): code is string => typeof code === "string").slice(0, 8)
    : [];
  const outcome = raw.outcome === "SUCCEEDED" || raw.outcome === "FAILED" || raw.outcome === "INTERRUPTED"
    ? raw.outcome
    : undefined;
  const recoveryState = raw.recoveryState === "NONE"
    || raw.recoveryState === "REQUIRED"
    || raw.recoveryState === "INCOMPLETE"
    ? raw.recoveryState
    : undefined;
  const nextActionCode = ACCEPTANCE_NEXT_ACTION_CODES.includes(
    raw.nextActionCode as AcceptanceNextActionCode,
  ) ? raw.nextActionCode as AcceptanceNextActionCode : undefined;
  const operatorAction = typeof raw.operatorAction === "string"
    ? raw.operatorAction.slice(0, 240)
    : undefined;
  if (!outcome || !recoveryState || !nextActionCode || !operatorAction) return undefined;
  return {
    reasonCodes,
    outcome,
    ...(typeof raw.failureKind === "string" ? { failureKind: raw.failureKind.slice(0, 80) } : {}),
    recoveryState,
    nextActionCode,
    operatorAction,
    ...(typeof raw.retryAfterMs === "number" && Number.isFinite(raw.retryAfterMs)
      ? { retryAfterMs: Math.max(0, Math.round(raw.retryAfterMs)) }
      : {}),
    ...(typeof raw.retryAt === "string" ? { retryAt: raw.retryAt.slice(0, 40) } : {}),
    ...(raw.retryAfterSource === "provider"
      || raw.retryAfterSource === "server_default"
      || raw.retryAfterSource === "adaptive_default"
      || raw.retryAfterSource === "project_rate_limit"
      ? { retryAfterSource: raw.retryAfterSource }
      : {}),
  };
}

export function projectExecutionAcceptance(
  row: typeof aiExecutionAcceptancesTable.$inferSelect | undefined,
): PublicExecutionAcceptance | undefined {
  if (!row) return undefined;
  const disposition = projectAcceptanceDisposition(row.disposition);
  return {
    attempt: row.attempt,
    terminalStatus: row.terminalStatus,
    outcome: row.outcome,
    reasonCode: row.reasonCode,
    nextActionCode: ACCEPTANCE_NEXT_ACTION_CODES.includes(
      row.nextActionCode as AcceptanceNextActionCode,
    ) ? row.nextActionCode as AcceptanceNextActionCode : "ABANDON_EXECUTION",
    evidenceComplete: row.evidenceComplete === 1,
    evidenceRequired: row.evidenceRequired === 1,
    resumable: row.resumable === 1,
    ...(disposition ? { disposition } : {}),
  };
}

/**
 * Resolve the acceptance for the latest server-owned attempt associated with
 * a standalone task. The latest execution is selected first so an older
 * accepted retry cannot be shown after a newer attempt has started.
 */
export async function getPublicTaskExecutionAcceptance(
  taskId: string,
): Promise<PublicExecutionAcceptance | undefined> {
  const [execution] = await db
    .select({
      id: aiExecutionsTable.id,
      attempt: aiExecutionsTable.attempt,
    })
    .from(aiExecutionsTable)
    .where(eq(aiExecutionsTable.linkedTaskId, taskId))
    .orderBy(desc(aiExecutionsTable.attempt), desc(aiExecutionsTable.updatedAt), desc(aiExecutionsTable.id))
    .limit(1);
  if (!execution) return undefined;

  const [acceptance] = await db
    .select()
    .from(aiExecutionAcceptancesTable)
    .where(and(
      eq(aiExecutionAcceptancesTable.executionId, execution.id),
      eq(aiExecutionAcceptancesTable.attempt, execution.attempt),
    ))
    .limit(1);

  return projectExecutionAcceptance(acceptance);
}

/**
 * Resolve the current public acceptance projection for a list of standalone
 * tasks without exposing execution/provider rows or issuing one query per
 * task. The newest execution attempt wins, matching the detail endpoint.
 */
export async function getPublicTaskExecutionAcceptances(
  taskIds: readonly string[],
): Promise<Map<string, PublicExecutionAcceptance>> {
  const result = new Map<string, PublicExecutionAcceptance>();
  if (taskIds.length === 0) return result;

  const executions = await db
    .select({
      id: aiExecutionsTable.id,
      linkedTaskId: aiExecutionsTable.linkedTaskId,
      attempt: aiExecutionsTable.attempt,
    })
    .from(aiExecutionsTable)
    .where(inArray(aiExecutionsTable.linkedTaskId, [...taskIds]))
    .orderBy(
      desc(aiExecutionsTable.attempt),
      desc(aiExecutionsTable.updatedAt),
      desc(aiExecutionsTable.id),
    );

  const latestExecutionByTask = new Map<
    string,
    { id: string; attempt: number }
  >();
  for (const execution of executions) {
    if (
      execution.linkedTaskId &&
      !latestExecutionByTask.has(execution.linkedTaskId)
    ) {
      latestExecutionByTask.set(execution.linkedTaskId, {
        id: execution.id,
        attempt: execution.attempt,
      });
    }
  }

  const latestExecutions = [...latestExecutionByTask.values()];
  if (latestExecutions.length === 0) return result;

  const acceptances = await db
    .select()
    .from(aiExecutionAcceptancesTable)
    .where(
      inArray(
        aiExecutionAcceptancesTable.executionId,
        latestExecutions.map((execution) => execution.id),
      ),
    );
  const acceptanceByExecution = new Map(
    acceptances.map((acceptance) => [
      `${acceptance.executionId}:${acceptance.attempt}`,
      acceptance,
    ]),
  );

  for (const [taskId, execution] of latestExecutionByTask) {
    const acceptance = acceptanceByExecution.get(
      `${execution.id}:${execution.attempt}`,
    );
    const projected = projectExecutionAcceptance(acceptance);
    if (projected) result.set(taskId, projected);
  }

  return result;
}

const MAX_READ_BYTES = 256 * 1024;
const MAX_SNAPSHOT_BYTES = 2 * 1024 * 1024;
const MAX_READS = 128;

function byteLength(value: string): number {
  return Buffer.byteLength(value, "utf8");
}

export function normalizeEvidenceSnapshot(input: EvidenceSnapshotInput | undefined): NormalizedEvidenceSnapshot {
  const reads = (input?.reads ?? []).slice(0, MAX_READS).map((read) => {
    const body = typeof read.body === "string" ? read.body : "";
    const bytes = byteLength(body);
    const complete = read.complete !== false
      && read.truncated !== true
      && bytes <= MAX_READ_BYTES;
    // Do not persist a misleading prefix. Oversized source is rejected
    // fail-closed and its original hash/length remain diagnostic metadata.
    const retainedBody = bytes <= MAX_READ_BYTES ? body : "";
    return {
      ...read,
      body: retainedBody,
      complete,
      truncated: read.truncated === true || bytes > MAX_READ_BYTES,
      byteLength: bytes,
      contentHash: createHash("sha256").update(body, "utf8").digest("hex"),
    };
  });
  const totalBytes = reads.reduce((sum, read) => sum + read.byteLength, 0);
  const required = input?.sourceEvidenceRequired ?? input?.required === true;
  const readsComplete = (
    reads.length > 0
    && totalBytes <= MAX_SNAPSHOT_BYTES
    && reads.every((read) => read.complete && !read.truncated)
  );
  const suppliedVerdict = typeof input?.verdict === "string" && input.verdict.trim()
    ? input.verdict.slice(0, 40)
    : undefined;
  const verdict = suppliedVerdict ?? (readsComplete ? "PROVEN" : "NOT_RECORDED");
  const complete = Boolean(!required || (
    readsComplete
    && verdict !== "NOT_RECORDED"
    && verdict !== "UNAVAILABLE"
  ));
  return {
    complete,
    verdict,
    reads,
    totalBytes,
    ...(complete ? {} : { reason: totalBytes > MAX_SNAPSHOT_BYTES
      ? "Evidence snapshot exceeds the server-owned byte limit."
      : "Required source evidence is missing, incomplete, or truncated." }),
  };
}

/**
 * Load only complete source bodies from the prior attempt of an execution.
 * The snapshot itself may be incomplete because another required read failed;
 * individually complete reads are still safe to reuse, while truncated reads
 * must never become provider context or proof.
 */
export async function loadReusableEvidenceReads(params: {
  executionId: string;
  projectId: string;
  attempt: number;
  operationId?: string | null;
  sourceRevision?: string | null;
}): Promise<ReusableEvidenceRead[]> {
  const conditions = [
    eq(aiExecutionEvidenceSnapshotsTable.executionId, params.executionId),
    eq(aiExecutionEvidenceSnapshotsTable.projectId, params.projectId),
    eq(aiExecutionEvidenceSnapshotsTable.attempt, params.attempt),
    eq(aiExecutionEvidenceReadsTable.complete, 1),
    eq(aiExecutionEvidenceReadsTable.truncated, 0),
    eq(aiExecutionEvidenceReadsTable.readType, "source"),
  ];
  if (params.operationId) {
    conditions.push(eq(aiExecutionEvidenceSnapshotsTable.operationId, params.operationId));
  }
  if (params.sourceRevision) {
    conditions.push(eq(aiExecutionEvidenceSnapshotsTable.sourceRevision, params.sourceRevision));
  }

  const rows = await db
    .select({
      path: aiExecutionEvidenceReadsTable.path,
      body: aiExecutionEvidenceReadsTable.body,
    })
    .from(aiExecutionEvidenceReadsTable)
    .innerJoin(
      aiExecutionEvidenceSnapshotsTable,
      eq(aiExecutionEvidenceReadsTable.snapshotId, aiExecutionEvidenceSnapshotsTable.id),
    )
    .where(and(...conditions));

  return rows
    .filter((row) => row.path.trim().length > 0)
    .slice(0, MAX_READS)
    .map((row) => ({ path: row.path, body: row.body }));
}

export function deriveAcceptanceNextAction(params: {
  outcome: FinalizeExecutionAcceptanceParams["outcome"];
  recoveryState: FinalizeExecutionAcceptanceParams["recoveryState"];
  resumable?: boolean;
  reasonCode?: string;
  retryAfterMs?: number;
}): AcceptanceNextActionCode {
  if (params.outcome === "SUCCEEDED") return "NONE";
  if (params.reasonCode === "CAPABILITY_PROBE_FINAL") return "START_NEW_PROBE";
  if (params.recoveryState === "REQUIRED" && params.resumable !== false) return "RESUME_ALLOWED";
  if (params.reasonCode === "EXECUTION_PROVIDER_FAILURE" && params.resumable === false) {
    if (params.retryAfterMs !== undefined) return "RETRY_AFTER_RATE_LIMIT";
    return "RETRY_AFTER_TIMEOUT";
  }
  if (params.reasonCode === "EVIDENCE_INCOMPLETE" || params.reasonCode === "EXECUTION_ACCEPTANCE_INCOMPLETE") {
    return "REVIEW_INCOMPLETE_EVIDENCE";
  }
  if (params.reasonCode === "EXECUTION_CANCELLED") return "ABANDON_EXECUTION";
  return params.resumable === false ? "ABANDON_EXECUTION" : "RETRY_AFTER_TIMEOUT";
}

function safeError(value: string | null | undefined): string | null {
  return value ? value.replace(/\s+/g, " ").trim().slice(0, 500) : null;
}

function parseStoredExecutionRequest(value: string): Record<string, unknown> | undefined {
  try {
    const parsed: unknown = JSON.parse(value);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? parsed as Record<string, unknown>
      : undefined;
  } catch {
    return undefined;
  }
}

/**
 * One server-owned terminal seam. The execution row is locked first, then
 * the message and acceptance rows are written in that same transaction.
 * Provider calls, filesystem reads, and long validators must happen before
 * entering this function.
 */
export async function finalizeExecutionAcceptance(
  params: FinalizeExecutionAcceptanceParams,
): Promise<FinalizeExecutionAcceptanceResult> {
  return db.transaction(async (tx) => {
    const [execution] = await tx
      .select()
      .from(aiExecutionsTable)
      .where(eq(aiExecutionsTable.id, params.executionId))
      .for("update");
    if (!execution) return { accepted: false, duplicate: false, reason: "Execution was not found." };

    const storedRequest = parseStoredExecutionRequest(execution.request);
    const storedProofRequired = storedRequest?.proofRequired === true;
    const evidenceRequired = storedProofRequired || params.evidence?.required === true;
    const sourceEvidenceRequired = params.evidence?.sourceEvidenceRequired
      ?? evidenceRequired;
    const effectiveEvidence = evidenceRequired
      ? {
          ...(params.evidence ?? {}),
          required: true,
          sourceEvidenceRequired,
          operationId: params.evidence?.operationId ?? execution.operationId,
          sourceRevision: params.evidence?.sourceRevision
            ?? (typeof storedRequest?.workspaceRevision === "string"
              ? storedRequest.workspaceRevision
              : null),
          verdict: params.evidence?.verdict ?? "NOT_RECORDED",
          reads: params.evidence?.reads ?? [],
        } satisfies EvidenceSnapshotInput
      : params.evidence;
    const evidence = normalizeEvidenceSnapshot(effectiveEvidence);
    if (params.outcome === "SUCCEEDED" && evidenceRequired && !evidence.complete) {
      return { accepted: false, duplicate: false, reason: evidence.reason ?? "Evidence is incomplete." };
    }

    const [existingByKey] = await tx
      .select()
      .from(aiExecutionAcceptancesTable)
      .where(eq(aiExecutionAcceptancesTable.finalizationKey, params.finalizationKey))
      .limit(1);
    if (existingByKey) return { accepted: true, duplicate: true, acceptance: existingByKey };

    const [existing] = await tx
      .select()
      .from(aiExecutionAcceptancesTable)
      .where(and(
        eq(aiExecutionAcceptancesTable.executionId, params.executionId),
        eq(aiExecutionAcceptancesTable.attempt, execution.attempt),
      ))
      .limit(1);
    if (existing) return { accepted: true, duplicate: true, acceptance: existing };

    const now = new Date();
    let task: typeof tasksTable.$inferSelect | undefined;
    if (params.taskFinalization) {
      task = (await tx
        .select()
        .from(tasksTable)
        .where(and(
          eq(tasksTable.id, params.taskFinalization.taskId),
          eq(tasksTable.projectId, execution.projectId),
          eq(tasksTable.workerId, params.taskFinalization.workerId),
          eq(tasksTable.status, "running"),
        ))
        .for("update"))[0];
      if (!task || execution.linkedTaskId !== task.id) {
        return {
          accepted: false,
          duplicate: false,
          reason: "The task worker no longer owns a live task execution.",
        };
      }
    }
    const workerOwnsLease = Boolean(
      params.workerId
      && execution.workerId === params.workerId
      && execution.leaseUntil
      && execution.leaseUntil > now,
    );
    const cancellationWon = execution.status === "cancelling" || Boolean(execution.cancelRequestedAt);
    if (params.outcome === "SUCCEEDED" && (!workerOwnsLease || cancellationWon || execution.status !== "running")) {
      return { accepted: false, duplicate: false, reason: "The worker no longer owns a live execution lease." };
    }
    if (
      params.outcome !== "SUCCEEDED"
      && params.workerId
      && execution.status === "running"
      && !workerOwnsLease
      && !params.allowExpiredLease
      && !cancellationWon
    ) {
      return { accepted: false, duplicate: false, reason: "The worker no longer owns a live execution lease." };
    }
    if (params.outcome !== "SUCCEEDED" && params.workerId && execution.workerId
      && execution.workerId !== params.workerId && execution.status === "running") {
      return { accepted: false, duplicate: false, reason: "A stale worker cannot finalize this execution." };
    }

    // Cancellation is a terminal fence. Once it wins the execution row, a
    // worker's generic error is recorded as interruption, never as failure.
    const outcome = cancellationWon && params.outcome !== "SUCCEEDED"
      ? "INTERRUPTED" as const
      : params.outcome;
    const terminalStatus = outcome === "INTERRUPTED" ? "cancelled" as const : params.terminalStatus;
    const reasonCode = outcome === "INTERRUPTED" ? "EXECUTION_CANCELLED" : params.reasonCode;
    const nextActionCode = deriveAcceptanceNextAction({
      outcome,
      recoveryState: params.recoveryState,
      resumable: params.resumable,
      reasonCode,
      retryAfterMs: params.retryAfterMs,
    });
    const acceptanceId = randomUUID();
    let evidenceSnapshotId: string | null = null;
    if (effectiveEvidence) {
      evidenceSnapshotId = randomUUID();
      await tx.insert(aiExecutionEvidenceSnapshotsTable).values({
        id: evidenceSnapshotId,
        executionId: execution.id,
        projectId: execution.projectId,
        attempt: execution.attempt,
        operationId: effectiveEvidence.operationId ?? execution.operationId,
        sourceRevision: effectiveEvidence.sourceRevision ?? null,
        candidateIdentity: effectiveEvidence.candidateIdentity ?? null,
        verdict: evidence.verdict,
        complete: evidence.complete ? 1 : 0,
        readCount: evidence.reads.length,
        totalBytes: evidence.totalBytes,
        createdAt: now,
      });
      if (evidence.reads.length > 0) {
        await tx.insert(aiExecutionEvidenceReadsTable).values(evidence.reads.map((read) => ({
          id: randomUUID(),
          snapshotId: evidenceSnapshotId!,
          path: read.path.slice(0, 500),
          readType: (read.readType ?? "source").slice(0, 40),
          lineStart: read.lineStart ?? null,
          lineEnd: read.lineEnd ?? null,
          contentHash: read.contentHash,
          byteLength: read.byteLength,
          complete: read.complete ? 1 : 0,
          truncated: read.truncated ? 1 : 0,
          body: read.body,
          createdAt: now,
        })));
      }
    }

    const disposition = {
      reasonCodes: [reasonCode],
      outcome,
      ...(params.failureKind ? { failureKind: params.failureKind } : {}),
      recoveryState: params.recoveryState,
      nextActionCode,
      operatorAction: nextActionCode,
      ...(params.disposition ?? {}),
      ...(params.retryAfterMs !== undefined ? { retryAfterMs: params.retryAfterMs } : {}),
      ...(params.retryAt ? { retryAt: params.retryAt } : {}),
    };
    const [acceptance] = await tx.insert(aiExecutionAcceptancesTable).values({
      id: acceptanceId,
      executionId: execution.id,
      projectId: execution.projectId,
      attempt: execution.attempt,
      finalizationKey: params.finalizationKey,
      operationId: execution.operationId,
      workerId: params.workerId ?? execution.workerId,
      terminalStatus,
      outcome,
      reasonCode,
      nextActionCode,
      disposition,
      evidenceSnapshotId,
      evidenceRequired: evidenceRequired ? 1 : 0,
      evidenceComplete: evidence.complete ? 1 : 0,
      resumable: params.resumable === true ? 1 : 0,
      messageId: params.finalMessageId ?? null,
      sourceRevision: params.sourceRevision
        ?? (typeof storedRequest?.workspaceRevision === "string"
          ? storedRequest.workspaceRevision
          : null),
      candidateIdentity: params.candidateIdentity ?? effectiveEvidence?.candidateIdentity ?? null,
      createdAt: now,
    }).onConflictDoNothing().returning();
    if (!acceptance) {
      const [concurrentAcceptance] = await tx
        .select()
        .from(aiExecutionAcceptancesTable)
        .where(and(
          eq(aiExecutionAcceptancesTable.executionId, execution.id),
          eq(aiExecutionAcceptancesTable.attempt, execution.attempt),
        ))
        .limit(1);
      return concurrentAcceptance
        ? { accepted: true, duplicate: true, acceptance: concurrentAcceptance }
        : { accepted: false, duplicate: false, reason: "Acceptance insert failed." };
    }

    if (params.finalMessageId) {
      await tx.update(aiChatMessagesTable)
        .set({
          ...(params.finalMessageContent !== undefined
            ? { content: params.finalMessageContent ?? "" }
            : {}),
          outcome,
          errorCode: outcome === "SUCCEEDED"
            ? null
            : params.finalMessageErrorCode
              ?? sql`coalesce(${aiChatMessagesTable.errorCode}, ${reasonCode})`,
          errorMessage: outcome === "SUCCEEDED" ? null : safeError(params.error),
        })
        .where(eq(aiChatMessagesTable.id, params.finalMessageId));
    }
    if (params.taskFinalization && task) {
      const taskUpdate: Partial<typeof tasksTable.$inferInsert> = {
        status: params.taskFinalization.status,
        workerId: null,
        leaseUntil: null,
        lastHeartbeatAt: null,
        agentResponse: params.taskFinalization.agentResponse,
        ...(params.taskFinalization.remediationPlan !== undefined
          ? { remediationPlan: params.taskFinalization.remediationPlan }
          : {}),
        ...(params.taskFinalization.verificationResult !== undefined
          ? { verificationResult: params.taskFinalization.verificationResult }
          : {}),
        completedAt: params.taskFinalization.completedAt ?? null,
        updatedAt: now,
      };
      const [updatedTask] = await tx.update(tasksTable)
        .set(taskUpdate)
        .where(and(
          eq(tasksTable.id, task.id),
          eq(tasksTable.workerId, params.taskFinalization.workerId),
          eq(tasksTable.status, "running"),
        ))
        .returning();
      if (!updatedTask) throw new Error("task_state_changed_during_finalize");

      const correlationId = params.taskFinalization.correlationId ?? execution.correlationId;
      if (params.taskFinalization.log) {
        await tx.insert(taskLogsTable).values({
          id: randomUUID(),
          taskId: task.id,
          level: params.taskFinalization.log.level,
          message: params.taskFinalization.log.message,
          metadata: params.taskFinalization.log.metadata ?? null,
          correlationId: correlationId ?? undefined,
        });
      }
      if (params.taskFinalization.event) {
        await tx.insert(eventsTable).values({
          id: randomUUID(),
          type: params.taskFinalization.event.type,
          projectId: execution.projectId,
          taskId: task.id,
          severity: params.taskFinalization.event.severity,
          message: params.taskFinalization.event.message,
          correlationId: correlationId ?? undefined,
          payload: params.taskFinalization.event.payload ?? null,
        });
      }
      if (params.taskFinalization.audit) {
        await recordAuditInTransaction(tx, {
          entityType: "task",
          entityId: task.id,
          projectId: execution.projectId,
          correlationId: correlationId ?? undefined,
          ...params.taskFinalization.audit,
        });
      }
    }
    const checkpoint = params.checkpoint ?? (() => {
      try {
        const parsed = JSON.parse(execution.checkpoint) as Record<string, unknown>;
        return JSON.stringify({
          ...parsed,
          stage: outcome === "SUCCEEDED" ? "completed" : terminalStatus,
          acceptance: {
            id: acceptance.id,
            attempt: execution.attempt,
            outcome,
            nextActionCode,
            evidenceComplete: evidence.complete,
          },
          updatedAt: now.toISOString(),
        });
      } catch {
        return execution.checkpoint;
      }
    })();
    const finalMessageFence = execution.finalMessageId === null
      ? isNull(aiExecutionsTable.finalMessageId)
      : eq(aiExecutionsTable.finalMessageId, execution.finalMessageId);
    await tx.update(aiExecutionsTable)
      .set({
        status: terminalStatus,
        finalMessageId: params.finalMessageId ?? execution.finalMessageId,
        ...(params.proposalId !== undefined ? { proposalId: params.proposalId } : {}),
        ...(params.recipeReceipt !== undefined ? { recipeReceipt: params.recipeReceipt } : {}),
        error: outcome === "SUCCEEDED" ? null : safeError(params.error),
        completedAt: now,
        updatedAt: now,
        workerId: null,
        leaseUntil: null,
        lastHeartbeatAt: null,
        checkpoint,
        checkpointVersion: execution.checkpointVersion + 1,
      })
      .where(and(eq(aiExecutionsTable.id, execution.id), finalMessageFence));

    return { accepted: true, duplicate: false, acceptance };
  });
}