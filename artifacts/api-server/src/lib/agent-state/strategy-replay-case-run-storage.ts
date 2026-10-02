import { createHash, randomUUID } from "node:crypto";
import { and, eq, sql } from "drizzle-orm";
import type { JsonValue } from "@workspace/ai-orchestrator";
import { z } from "zod/v4";
import {
  aiStrategyReplayCaseRunsTable,
  db,
} from "@workspace/db";
import {
  createStrategyReplayCaseRunLease,
  decideStrategyReplayCaseLeaseClaim,
  STRATEGY_REPLAY_CASE_LEASE_KIND,
  STRATEGY_REPLAY_CASE_LEASE_MS,
} from "./strategy-replay-case-lease.js";

type ReplayRunTransaction = Parameters<Parameters<typeof db.transaction>[0]>[0];
type ReplayRun = typeof aiStrategyReplayCaseRunsTable.$inferSelect;
const RetryRequestIdSchema = z.string().uuid();

export type StrategyReplayCaseTerminalReceiptFields = {
  status: "proven" | "incomplete";
  replayExecutionId: string | null;
  replayEpisodeId: string | null;
  replayAttempt: number | null;
  replayEffectBundleId: string | null;
  replayCanonicalProofHash: string | null;
  workspaceTreeHash: string | null;
};

export type StrategyReplayCaseRunLeaseClaim =
  | { decision: "reclaim"; replayRun: ReplayRun; ownerToken: string }
  | { decision: "busy" | "invalid" | "terminal" };

function deterministicIdentity(prefix: string, value: string): string {
  return `${prefix}:${createHash("sha256").update(value).digest("hex")}`;
}

export function strategyReplayCaseAttemptRunId(
  caseRegistrationId: string,
  attemptNumber: number,
): string {
  if (!Number.isInteger(attemptNumber) || attemptNumber < 1) {
    throw new Error("Strategy Replay attempt number must be a positive integer.");
  }
  const identity = attemptNumber === 1
    ? caseRegistrationId
    : `${caseRegistrationId}:attempt:${attemptNumber}`;
  return deterministicIdentity("strategy-replay-run", identity);
}

export function strategyReplayCaseRetryOperationId(
  caseRegistrationId: string,
  retryRequestId: string,
): string {
  const requestId = RetryRequestIdSchema.parse(retryRequestId);
  return deterministicIdentity(
    "strategy-replay-operation",
    `${caseRegistrationId}:retry:${requestId}`,
  );
}

export function strategyReplayCaseAttemptOperationId(
  caseRegistrationId: string,
  attemptNumber: number,
  retryRequestId?: string,
): string {
  if (attemptNumber === 1 && retryRequestId === undefined) {
    return deterministicIdentity("strategy-replay-operation", caseRegistrationId);
  }
  if (attemptNumber <= 1 || retryRequestId === undefined) {
    throw new Error("New Strategy Replay attempts require a request identity.");
  }
  return strategyReplayCaseRetryOperationId(caseRegistrationId, retryRequestId);
}

export async function createStrategyReplayCaseRunAttempt(
  tx: ReplayRunTransaction,
  input: {
    projectId: string;
    caseRegistrationId: string;
    candidateId: string;
    sourceEpisodeId: string;
    candidateHash: string;
    sourceCanonicalProofHash: string;
    attemptNumber: number;
    retryRequestId?: string;
    now: Date;
  },
): Promise<{ replayRun: ReplayRun; ownerToken: string } | undefined> {
  const id = strategyReplayCaseAttemptRunId(input.caseRegistrationId, input.attemptNumber);
  const operationId = strategyReplayCaseAttemptOperationId(
    input.caseRegistrationId,
    input.attemptNumber,
    input.retryRequestId,
  );
  const ownerToken = randomUUID();
  const [replayRun] = await tx.insert(aiStrategyReplayCaseRunsTable).values({
    id,
    projectId: input.projectId,
    caseRegistrationId: input.caseRegistrationId,
    attemptNumber: input.attemptNumber,
    candidateId: input.candidateId,
    sourceEpisodeId: input.sourceEpisodeId,
    operationId,
    candidateHash: input.candidateHash,
    sourceCanonicalProofHash: input.sourceCanonicalProofHash,
    status: "running",
    receipt: createStrategyReplayCaseRunLease({
      ownerToken,
      expiresAt: new Date(input.now.getTime() + STRATEGY_REPLAY_CASE_LEASE_MS),
    }),
    createdAt: input.now,
    updatedAt: input.now,
  }).onConflictDoNothing().returning();
  return replayRun ? { replayRun, ownerToken } : undefined;
}

function ownerCondition(ownerToken: string, now?: Date) {
  const receipt = aiStrategyReplayCaseRunsTable.receipt;
  if (now) {
    return sql`(${receipt} ->> 'kind') = ${STRATEGY_REPLAY_CASE_LEASE_KIND}
      AND (${receipt} ->> 'ownerToken') = ${ownerToken}
      AND (${receipt} ->> 'expiresAt')::timestamptz > ${now.toISOString()}::timestamptz`;
  }
  return sql`(${receipt} ->> 'kind') = ${STRATEGY_REPLAY_CASE_LEASE_KIND}
    AND (${receipt} ->> 'ownerToken') = ${ownerToken}`;
}

export async function claimStrategyReplayCaseRunLease(
  tx: ReplayRunTransaction,
  replayRun: ReplayRun,
  now: Date,
): Promise<StrategyReplayCaseRunLeaseClaim> {
  const decision = decideStrategyReplayCaseLeaseClaim({
    status: replayRun.status,
    receipt: replayRun.receipt,
    updatedAt: replayRun.updatedAt,
    now,
  });
  if (decision !== "reclaim") return { decision };

  const ownerToken = randomUUID();
  const [claimedRun] = await tx.update(aiStrategyReplayCaseRunsTable).set({
    receipt: createStrategyReplayCaseRunLease({
      ownerToken,
      expiresAt: new Date(now.getTime() + STRATEGY_REPLAY_CASE_LEASE_MS),
    }),
    updatedAt: now,
  }).where(and(
    eq(aiStrategyReplayCaseRunsTable.id, replayRun.id),
    eq(aiStrategyReplayCaseRunsTable.status, "running"),
  )).returning();
  if (!claimedRun) return { decision: "busy" };
  return { decision: "reclaim", replayRun: claimedRun, ownerToken };
}

export async function renewStrategyReplayCaseRunLease(input: {
  runId: string;
  ownerToken: string;
  now: Date;
}): Promise<boolean> {
  const [updated] = await db.update(aiStrategyReplayCaseRunsTable).set({
    receipt: createStrategyReplayCaseRunLease({
      ownerToken: input.ownerToken,
      expiresAt: new Date(input.now.getTime() + STRATEGY_REPLAY_CASE_LEASE_MS),
    }),
    updatedAt: input.now,
  }).where(and(
    eq(aiStrategyReplayCaseRunsTable.id, input.runId),
    eq(aiStrategyReplayCaseRunsTable.status, "running"),
    ownerCondition(input.ownerToken, input.now),
  )).returning({ id: aiStrategyReplayCaseRunsTable.id });
  return Boolean(updated);
}

export async function persistStrategyReplayCaseTerminalReceipt(input: {
  runId: string;
  ownerToken: string;
  receipt: StrategyReplayCaseTerminalReceiptFields;
  now: Date;
}): Promise<boolean> {
  const [updated] = await db.update(aiStrategyReplayCaseRunsTable).set({
    status: input.receipt.status,
    replayExecutionId: input.receipt.replayExecutionId,
    replayEpisodeId: input.receipt.replayEpisodeId,
    replayAttempt: input.receipt.replayAttempt,
    replayEffectBundleId: input.receipt.replayEffectBundleId,
    replayCanonicalProofHash: input.receipt.replayCanonicalProofHash,
    workspaceTreeHash: input.receipt.workspaceTreeHash,
    receipt: input.receipt as unknown as JsonValue,
    updatedAt: input.now,
  }).where(and(
    eq(aiStrategyReplayCaseRunsTable.id, input.runId),
    eq(aiStrategyReplayCaseRunsTable.status, "running"),
    ownerCondition(input.ownerToken, input.now),
  )).returning({ id: aiStrategyReplayCaseRunsTable.id });
  return Boolean(updated);
}