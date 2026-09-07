import { createHash, randomUUID } from "node:crypto";
import { and, eq, isNull } from "drizzle-orm";
import {
  aiChatMessagesTable,
  aiExecutionAcceptancesTable,
  aiExecutionEvidenceReadsTable,
  aiExecutionEvidenceSnapshotsTable,
  aiExecutionsTable,
  db,
} from "@workspace/db";

export const ACCEPTANCE_NEXT_ACTION_CODES = [
  "NONE",
  "RESUME_ALLOWED",
  "START_NEW_PROBE",
  "REVIEW_INCOMPLETE_EVIDENCE",
  "ABANDON_EXECUTION",
  "RETRY_AFTER_TIMEOUT",
] as const;
export type AcceptanceNextActionCode = (typeof ACCEPTANCE_NEXT_ACTION_CODES)[number];

export type ExecutionAcceptanceDisposition = {
  reasonCodes: string[];
  outcome: "SUCCEEDED" | "FAILED" | "INTERRUPTED";
  failureKind?: string;
  recoveryState: "NONE" | "REQUIRED" | "INCOMPLETE";
  nextActionCode: AcceptanceNextActionCode;
  operatorAction: string;
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
  reads?: readonly EvidenceReadInput[];
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
  finalMessageId?: string | null;
  finalMessageContent?: string | null;
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
  proposalId?: string | null;
  recipeReceipt?: unknown;
  checkpoint?: string;
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

export function projectExecutionAcceptance(
  row: typeof aiExecutionAcceptancesTable.$inferSelect | undefined,
): PublicExecutionAcceptance | undefined {
  if (!row) return undefined;
  const disposition = row.disposition && typeof row.disposition === "object"
    ? row.disposition as ExecutionAcceptanceDisposition
    : undefined;
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
  const complete = Boolean(input?.required !== true || (
    reads.length > 0
    && totalBytes <= MAX_SNAPSHOT_BYTES
    && reads.every((read) => read.complete && !read.truncated)
  ));
  return {
    complete,
    verdict: typeof input?.verdict === "string" && input.verdict.trim()
      ? input.verdict.slice(0, 40)
      : complete ? "PROVEN" : "NOT_RECORDED",
    reads,
    totalBytes,
    ...(complete ? {} : { reason: totalBytes > MAX_SNAPSHOT_BYTES
      ? "Evidence snapshot exceeds the server-owned byte limit."
      : "Required source evidence is missing, incomplete, or truncated." }),
  };
}

export function deriveAcceptanceNextAction(params: {
  outcome: FinalizeExecutionAcceptanceParams["outcome"];
  recoveryState: FinalizeExecutionAcceptanceParams["recoveryState"];
  resumable?: boolean;
  reasonCode?: string;
}): AcceptanceNextActionCode {
  if (params.outcome === "SUCCEEDED") return "NONE";
  if (params.reasonCode === "CAPABILITY_PROBE_FINAL") return "START_NEW_PROBE";
  if (params.recoveryState === "REQUIRED" && params.resumable !== false) return "RESUME_ALLOWED";
  if (params.reasonCode === "EVIDENCE_INCOMPLETE" || params.reasonCode === "EXECUTION_ACCEPTANCE_INCOMPLETE") {
    return "REVIEW_INCOMPLETE_EVIDENCE";
  }
  if (params.reasonCode === "EXECUTION_CANCELLED") return "ABANDON_EXECUTION";
  return params.resumable === false ? "ABANDON_EXECUTION" : "RETRY_AFTER_TIMEOUT";
}

function safeError(value: string | null | undefined): string | null {
  return value ? value.replace(/\s+/g, " ").trim().slice(0, 500) : null;
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
  const evidence = normalizeEvidenceSnapshot(params.evidence);
  const evidenceRequired = params.evidence?.required === true;
  if (params.outcome === "SUCCEEDED" && evidenceRequired && !evidence.complete) {
    return { accepted: false, duplicate: false, reason: evidence.reason ?? "Evidence is incomplete." };
  }

  return db.transaction(async (tx) => {
    const [execution] = await tx
      .select()
      .from(aiExecutionsTable)
      .where(eq(aiExecutionsTable.id, params.executionId))
      .for("update");
    if (!execution) return { accepted: false, duplicate: false, reason: "Execution was not found." };

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
    });
    const acceptanceId = randomUUID();
    let evidenceSnapshotId: string | null = null;
    if (params.evidence) {
      evidenceSnapshotId = randomUUID();
      await tx.insert(aiExecutionEvidenceSnapshotsTable).values({
        id: evidenceSnapshotId,
        executionId: execution.id,
        projectId: execution.projectId,
        attempt: execution.attempt,
        operationId: params.evidence.operationId ?? execution.operationId,
        sourceRevision: params.evidence.sourceRevision ?? null,
        candidateIdentity: params.evidence.candidateIdentity ?? null,
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
      sourceRevision: params.sourceRevision ?? null,
      candidateIdentity: params.candidateIdentity ?? null,
      createdAt: now,
    }).returning();
    if (!acceptance) return { accepted: false, duplicate: false, reason: "Acceptance insert failed." };

    if (params.finalMessageId) {
      await tx.update(aiChatMessagesTable)
        .set({
          ...(params.finalMessageContent !== undefined
            ? { content: params.finalMessageContent ?? "" }
            : {}),
          outcome,
          errorCode: outcome === "SUCCEEDED" ? null : reasonCode,
          errorMessage: outcome === "SUCCEEDED" ? null : safeError(params.error),
        })
        .where(eq(aiChatMessagesTable.id, params.finalMessageId));
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