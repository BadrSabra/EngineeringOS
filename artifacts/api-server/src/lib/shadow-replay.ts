import { promises as fs } from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { and, eq, inArray } from "drizzle-orm";
import {
  aiExecutionsTable,
  aiShadowReplaysTable,
  db,
} from "@workspace/db";
import {
  claimAiExecution,
  createAiExecution,
  heartbeatAiExecution,
  registerAiExecutionController,
  unregisterAiExecutionController,
  type AiExecutionRequestEnvelope,
} from "./ai-execution-state.js";
import { finalizeExecutionAcceptance } from "./ai-execution-acceptance.js";
import {
  createValidationWorkspace,
} from "./ai-repair-validation.js";
import {
  DELIVERY_TREE_DIGEST_VERSION,
  deliveryWorkspaceExists,
  hashDeliveryTree,
} from "./delivery-workspace.js";
import {
  type ShadowReplayReceipt,
  type SkillCandidateEnvelope,
  validateSkillCandidateAgainstCanonicalProof,
} from "./skill-candidate.js";
import type { CanonicalProof } from "./proof-foundation.js";
import { heavyJobQueue } from "./job-queue.js";

const SHADOW_REPLAY_LEASE_MS = 5 * 60 * 1000;
const SHADOW_REPLAY_MAX_FILE_BYTES = 512_000;
const SHADOW_REPLAY_MAX_TOTAL_BYTES = 2_000_000;
const SHADOW_REPLAY_MAX_PATHS = 48;
const SHADOW_REPLAY_PROFILE = "shadow-replay";

export type ShadowReplayPublicStatus =
  | "queued"
  | "running"
  | "completed"
  | "failed"
  | "cancelled";

export type ShadowReplayStartInput = {
  userId: string;
  projectId: string;
  proposalId: string;
  operationId: string;
  sourceRevision: string;
  candidateTreeHash: string;
  changeSetHash?: string | null;
  sourceWorkspaceRoot: string | null;
  candidate: SkillCandidateEnvelope;
  canonicalProof: CanonicalProof;
};

export type DurableShadowReplayReceipt = ShadowReplayReceipt & {
  replayId: string;
  replayExecutionId: string;
  status: "completed";
  attempt: number;
  preTreeHash: string;
  postTreeHash: string;
  treeDigestVersion: typeof DELIVERY_TREE_DIGEST_VERSION;
  workspaceIsolated: true;
  workspaceCleaned: true;
  evidenceRefs: string[];
  sideEffects: {
    apply: false;
    push: false;
    browser: false;
    commands: false;
  };
  validator: {
    profile: typeof SHADOW_REPLAY_PROFILE;
    status: "passed";
    readCount: number;
    totalBytes: number;
    approvedPathCount: number;
  };
};

type ShadowReplayRow = typeof aiShadowReplaysTable.$inferSelect;

function idempotencyKey(input: ShadowReplayStartInput): string {
  return `shadow-replay:${input.proposalId}:${input.candidate.candidateId}:${input.candidateTreeHash}`;
}

function replayOperationId(input: ShadowReplayStartInput): string {
  return `shadow-replay:${input.proposalId}:${input.candidate.candidateId}`;
}

export function toPublicShadowReplay(row: ShadowReplayRow): {
  id: string;
  executionId: string;
  proposalId: string;
  projectId: string;
  candidateId: string;
  executionProfile: "shadow-replay";
  status: ShadowReplayPublicStatus;
  attempt: number;
  sourceRevision: string;
  candidateTreeHash: string;
  preTreeHash: string | null;
  postTreeHash: string | null;
  receipt: unknown;
  error: string | null;
  createdAt: Date;
  startedAt: Date | null;
  completedAt: Date | null;
} {
  return {
    id: row.id,
    executionId: row.executionId,
    proposalId: row.proposalId,
    projectId: row.projectId,
    candidateId: row.candidateId,
    executionProfile: row.executionProfile as "shadow-replay",
    status: row.status,
    attempt: row.attempt,
    sourceRevision: row.sourceRevision,
    candidateTreeHash: row.candidateTreeHash,
    preTreeHash: row.preTreeHash,
    postTreeHash: row.postTreeHash,
    receipt: row.receipt,
    error: row.error,
    createdAt: row.createdAt,
    startedAt: row.startedAt,
    completedAt: row.completedAt,
  };
}

async function assertCandidateWorkspace(input: ShadowReplayStartInput): Promise<string> {
  if (!input.sourceWorkspaceRoot) {
    throw new ShadowReplayError(
      "SKILL_CANDIDATE_WORKSPACE_REQUIRED",
      "A server-owned candidate workspace is required before shadow replay.",
    );
  }
  if (!await deliveryWorkspaceExists(input.sourceWorkspaceRoot, input.operationId)) {
    throw new ShadowReplayError(
      "SKILL_CANDIDATE_WORKSPACE_UNAVAILABLE",
      "The server-owned candidate workspace is unavailable or no longer owned by this proposal.",
    );
  }
  const sourceTreeHash = await hashDeliveryTree(input.sourceWorkspaceRoot);
  if (sourceTreeHash !== input.candidateTreeHash) {
    throw new ShadowReplayError(
      "SKILL_CANDIDATE_WORKSPACE_DRIFTED",
      "The candidate workspace bytes no longer match the server-owned candidate tree hash.",
    );
  }
  return sourceTreeHash;
}

function safeRelativePath(relativePath: string): string {
  const normalized = relativePath.replaceAll("\\", "/").replace(/^(\.\/)+/, "");
  if (
    !normalized
    || normalized.startsWith("/")
    || path.isAbsolute(relativePath)
    || normalized.split("/").some((segment) => !segment || segment === "..")
  ) {
    throw new ShadowReplayError(
      "SHADOW_REPLAY_UNSAFE_PATH",
      "The candidate approved path is not a safe project-relative path.",
    );
  }
  return normalized;
}

async function assertNoSymlinkPath(rootPath: string, relativePath: string): Promise<string> {
  const target = path.resolve(rootPath, safeRelativePath(relativePath));
  const resolvedRoot = path.resolve(rootPath);
  if (target === resolvedRoot || !target.startsWith(`${resolvedRoot}${path.sep}`)) {
    throw new ShadowReplayError("SHADOW_REPLAY_UNSAFE_PATH", "The candidate path escapes the replay workspace.");
  }
  let cursor = target;
  while (cursor !== resolvedRoot && cursor.startsWith(`${resolvedRoot}${path.sep}`)) {
    try {
      if ((await fs.lstat(cursor)).isSymbolicLink()) {
        throw new ShadowReplayError(
          "SHADOW_REPLAY_SYMLINK_PATH",
          "Shadow replay refuses to traverse a symbolic link.",
        );
      }
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
    cursor = path.dirname(cursor);
  }
  return target;
}

async function runCandidateVerify(params: {
  workspaceRoot: string;
  candidateTreeHash: string;
  approvedPaths: readonly string[];
  signal: AbortSignal;
}): Promise<{
  preTreeHash: string;
  postTreeHash: string;
  readCount: number;
  totalBytes: number;
}> {
  if (params.approvedPaths.length > SHADOW_REPLAY_MAX_PATHS) {
    throw new ShadowReplayError("SHADOW_REPLAY_BUDGET_EXCEEDED", "The candidate path budget was exceeded.");
  }
  const preTreeHash = await hashDeliveryTree(params.workspaceRoot);
  if (preTreeHash !== params.candidateTreeHash) {
    throw new ShadowReplayError(
      "SHADOW_REPLAY_TREE_MISMATCH",
      "The isolated replay workspace does not match the candidate tree identity.",
    );
  }
  let totalBytes = 0;
  let readCount = 0;
  for (const relativePath of params.approvedPaths) {
    if (params.signal.aborted) {
      throw new ShadowReplayError("SHADOW_REPLAY_CANCELLED", "Shadow replay was cancelled.");
    }
    const target = await assertNoSymlinkPath(params.workspaceRoot, relativePath);
    const stat = await fs.stat(target);
    if (!stat.isFile()) {
      throw new ShadowReplayError("SHADOW_REPLAY_NON_FILE_PATH", "Shadow replay only verifies regular files.");
    }
    if (stat.size > SHADOW_REPLAY_MAX_FILE_BYTES || totalBytes + stat.size > SHADOW_REPLAY_MAX_TOTAL_BYTES) {
      throw new ShadowReplayError("SHADOW_REPLAY_BUDGET_EXCEEDED", "The shadow replay read budget was exceeded.");
    }
    await fs.readFile(target);
    totalBytes += stat.size;
    readCount += 1;
  }
  const postTreeHash = await hashDeliveryTree(params.workspaceRoot);
  if (postTreeHash !== preTreeHash) {
    throw new ShadowReplayError(
      "SHADOW_REPLAY_SIDE_EFFECT_DETECTED",
      "The candidate verification changed the isolated workspace.",
    );
  }
  return { preTreeHash, postTreeHash, readCount, totalBytes };
}

export class ShadowReplayError extends Error {
  readonly code: string;

  constructor(code: string, message: string) {
    super(message);
    this.name = "ShadowReplayError";
    this.code = code;
  }
}

async function updateReplay(
  replayId: string,
  values: Partial<typeof aiShadowReplaysTable.$inferInsert>,
): Promise<ShadowReplayRow | undefined> {
  const [updated] = await db
    .update(aiShadowReplaysTable)
    .set({ ...values, updatedAt: new Date() })
    .where(eq(aiShadowReplaysTable.id, replayId))
    .returning();
  return updated;
}

async function cleanupReplayWorkspace(replay: ShadowReplayRow): Promise<boolean> {
  if (!replay.replayWorkspaceRoot) return replay.replayWorkspaceCleaned;
  try {
    await fs.rm(replay.replayWorkspaceRoot, { recursive: true, force: true });
  } catch {
    return false;
  }
  await updateReplay(replay.id, {
    replayWorkspaceRoot: null,
    replayWorkspaceCleaned: true,
  });
  return true;
}

export async function getShadowReplayForUser(
  replayId: string,
  userId: string,
): Promise<ShadowReplayRow | undefined> {
  const [row] = await db
    .select()
    .from(aiShadowReplaysTable)
    .where(and(
      eq(aiShadowReplaysTable.id, replayId),
      eq(aiShadowReplaysTable.userId, userId),
    ))
    .limit(1);
  return row;
}

export async function startShadowReplay(input: ShadowReplayStartInput): Promise<{
  replay: ReturnType<typeof toPublicShadowReplay>;
  created: boolean;
}> {
  const decision = validateSkillCandidateAgainstCanonicalProof(input.candidate, input.canonicalProof, {
    projectId: input.projectId,
    sourceRevision: input.sourceRevision,
    candidateTreeHash: input.candidateTreeHash,
    changeSetHash: input.changeSetHash,
  });
  if (!decision.allowed || !decision.envelope) {
    throw new ShadowReplayError(
      "SKILL_CANDIDATE_SHADOW_REJECTED",
      `The candidate is not eligible for shadow replay: ${decision.reasons.join("; ")}`,
    );
  }

  const key = idempotencyKey(input);
  const [existing] = await db
    .select()
    .from(aiShadowReplaysTable)
    .where(and(
      eq(aiShadowReplaysTable.userId, input.userId),
      eq(aiShadowReplaysTable.idempotencyKey, key),
    ))
    .limit(1);
  if (existing) {
    if (existing.projectId !== input.projectId || existing.proposalId !== input.proposalId) {
      throw new ShadowReplayError("SHADOW_REPLAY_IDEMPOTENCY_CONFLICT", "Replay idempotency is bound to another proposal.");
    }
    if (existing.status === "queued" || existing.status === "running") {
      await runShadowReplayAttempt(existing.id, input.userId);
    }
    const current = await getShadowReplayForUser(existing.id, input.userId);
    if (!current) throw new ShadowReplayError("SHADOW_REPLAY_NOT_FOUND", "Shadow replay disappeared.");
    return { replay: toPublicShadowReplay(current), created: false };
  }

  await assertCandidateWorkspace(input);
  const replayWorkspace = await createValidationWorkspace(
    input.sourceWorkspaceRoot!,
    [],
    async () => undefined,
  );
  const replayId = randomUUID();
  const operationId = replayOperationId(input);
  const replayExecutionRequest: AiExecutionRequestEnvelope = {
    projectId: input.projectId,
    executionProfile: "shadow-replay",
    turnIntent: "TASK_EXECUTION",
    operationId,
    message: "Server-owned candidate shadow replay.",
    modelMessage: "Server-owned candidate shadow replay.",
    workspaceRevision: input.sourceRevision,
    workspaceRoot: replayWorkspace.rootPath,
    validationTargetPaths: [...input.candidate.approvedPaths],
    proofRequired: false,
  };
  const execution = await createAiExecution({
    userId: input.userId,
    request: replayExecutionRequest,
    idempotencyKey: key,
    correlationId: operationId,
    projectId: input.projectId,
    workspaceRoot: replayWorkspace.rootPath,
  });
  const [inserted] = await db
    .insert(aiShadowReplaysTable)
    .values({
      id: replayId,
      executionId: execution.execution.id,
      projectId: input.projectId,
      proposalId: input.proposalId,
      userId: input.userId,
      idempotencyKey: key,
      operationId,
      candidateId: input.candidate.candidateId,
      canonicalAcceptanceId: input.canonicalProof.acceptanceId!,
      trajectoryDigest: input.canonicalProof.trajectoryDigest!.digest,
      sourceRevision: input.sourceRevision,
      candidateTreeHash: input.candidateTreeHash,
      changeSetHash: input.changeSetHash ?? null,
      executionProfile: "shadow-replay",
      sourceWorkspaceRoot: input.sourceWorkspaceRoot!,
      replayWorkspaceRoot: replayWorkspace.rootPath,
      status: "queued",
      attempt: execution.execution.attempt,
    })
    .onConflictDoNothing()
    .returning();
  if (!inserted) {
    await fs.rm(replayWorkspace.rootPath, { recursive: true, force: true }).catch(() => undefined);
    const [raced] = await db
      .select()
      .from(aiShadowReplaysTable)
      .where(and(
        eq(aiShadowReplaysTable.userId, input.userId),
        eq(aiShadowReplaysTable.idempotencyKey, key),
      ))
      .limit(1);
    if (!raced) throw new ShadowReplayError("SHADOW_REPLAY_CREATE_RACE", "Shadow replay creation raced and was not recoverable.");
    if (raced.status === "queued" || raced.status === "running") {
      await runShadowReplayAttempt(raced.id, input.userId);
    }
    const current = await getShadowReplayForUser(raced.id, input.userId);
    if (!current) throw new ShadowReplayError("SHADOW_REPLAY_NOT_FOUND", "Shadow replay disappeared.");
    return { replay: toPublicShadowReplay(current), created: false };
  }

  await runShadowReplayAttempt(inserted.id, input.userId);
  const current = await getShadowReplayForUser(inserted.id, input.userId);
  if (!current) throw new ShadowReplayError("SHADOW_REPLAY_NOT_FOUND", "Shadow replay disappeared.");
  return { replay: toPublicShadowReplay(current), created: true };
}

export async function runShadowReplayAttempt(
  replayId: string,
  userId: string,
): Promise<boolean> {
  const [replay] = await db
    .select()
    .from(aiShadowReplaysTable)
    .where(and(
      eq(aiShadowReplaysTable.id, replayId),
      eq(aiShadowReplaysTable.userId, userId),
    ))
    .limit(1);
  if (!replay) return false;
  if (replay.status === "completed" || replay.status === "cancelled") return true;

  const [execution] = await db
    .select()
    .from(aiExecutionsTable)
    .where(eq(aiExecutionsTable.id, replay.executionId))
    .limit(1);
  if (!execution) return false;
  if (execution.status === "completed") {
    const receipt = execution.recipeReceipt;
    const receiptRecord = receipt && typeof receipt === "object" && !Array.isArray(receipt)
      ? receipt as Record<string, unknown>
      : undefined;
    const receiptMatchesReplay = receiptRecord?.status === "completed"
      && receiptRecord.productionExecution === false
      && receiptRecord.replayId === replay.id
      && receiptRecord.replayExecutionId === replay.executionId;
    if (!receiptMatchesReplay) {
      await cleanupReplayWorkspace(replay);
      await updateReplay(replay.id, {
        status: "failed",
        error: "SHADOW_REPLAY_RECEIPT_MISSING",
        completedAt: execution.completedAt ?? new Date(),
      });
      return false;
    }
    const workspaceCleaned = await cleanupReplayWorkspace(replay);
    if (!workspaceCleaned) {
      await updateReplay(replay.id, {
        status: "failed",
        error: "SHADOW_REPLAY_CLEANUP_FAILED",
        completedAt: new Date(),
      });
      return false;
    }
    await updateReplay(replay.id, {
      status: "completed",
      preTreeHash: typeof receiptRecord.preTreeHash === "string" ? receiptRecord.preTreeHash : replay.preTreeHash,
      postTreeHash: typeof receiptRecord.postTreeHash === "string" ? receiptRecord.postTreeHash : replay.postTreeHash,
      validatorResult: receiptRecord.validator ?? replay.validatorResult,
      receipt,
      completedAt: execution.completedAt ?? new Date(),
      replayWorkspaceRoot: null,
      replayWorkspaceCleaned: true,
      error: null,
    });
    return true;
  }

  const workerId = `shadow-replay-worker:${randomUUID()}`;
  const claimedExecution = execution.status === "running"
    ? execution.workerId === workerId
      ? execution
      : undefined
    : await claimAiExecution({
        executionId: execution.id,
        userId,
        workerId,
      });
  if (!claimedExecution) return false;

  const startedAt = new Date();
  const leaseUntil = new Date(startedAt.getTime() + SHADOW_REPLAY_LEASE_MS);
  const [claimedReplay] = await db
    .update(aiShadowReplaysTable)
    .set({
      status: "running",
      attempt: claimedExecution.attempt,
      workerId,
      leaseUntil,
      startedAt: replay.startedAt ?? startedAt,
      updatedAt: startedAt,
    })
    .where(and(
      eq(aiShadowReplaysTable.id, replay.id),
      inArray(aiShadowReplaysTable.status, ["queued", "running"]),
    ))
    .returning();
  if (!claimedReplay) return false;

  const controller = new AbortController();
  const registered = await registerAiExecutionController(execution.id, controller);
  if (!registered) {
    const [cancelledExecution] = await db
      .select({ status: aiExecutionsTable.status })
      .from(aiExecutionsTable)
      .where(eq(aiExecutionsTable.id, execution.id))
      .limit(1);
    if (cancelledExecution?.status === "cancelled") {
      await updateReplay(replay.id, {
        status: "cancelled",
        error: "SHADOW_REPLAY_CANCELLED: execution cancellation won before the validator started.",
        workerId: null,
        leaseUntil: null,
        completedAt: new Date(),
      });
      await cleanupReplayWorkspace(claimedReplay);
    }
    return false;
  }
  const heartbeat = setInterval(() => {
    void heartbeatAiExecution({
      executionId: execution.id,
      expectedAttempt: claimedExecution.attempt,
      workerId,
    });
    void updateReplay(replay.id, {
      leaseUntil: new Date(Date.now() + SHADOW_REPLAY_LEASE_MS),
    });
  }, Math.floor(SHADOW_REPLAY_LEASE_MS / 3));

  try {
    const replayResult = await runCandidateVerify({
      workspaceRoot: claimedReplay.replayWorkspaceRoot!,
      candidateTreeHash: replay.candidateTreeHash,
      approvedPaths: JSON.parse(claimedExecution.request).validationTargetPaths ?? [],
      signal: controller.signal,
    });
    const evidenceRefs = [
      `shadow-replay:${replay.id}:tree:pre`,
      `shadow-replay:${replay.id}:tree:post`,
      ...JSON.parse(claimedExecution.request).validationTargetPaths
        .slice(0, SHADOW_REPLAY_MAX_PATHS)
        .map((relativePath: string) => `shadow-replay:${replay.id}:read:${relativePath}`),
    ].slice(0, 48);
    const workspaceCleaned = await cleanupReplayWorkspace({
      ...claimedReplay,
      replayWorkspaceRoot: claimedReplay.replayWorkspaceRoot,
    });
    if (!workspaceCleaned) {
      throw new ShadowReplayError(
        "SHADOW_REPLAY_CLEANUP_FAILED",
        "The disposable replay workspace could not be cleaned up.",
      );
    }
    const receipt: DurableShadowReplayReceipt = {
      contractVersion: 1,
      runId: replay.id,
      candidateId: replay.candidateId,
      projectId: replay.projectId,
      sourceRevision: replay.sourceRevision,
      candidateTreeHash: replay.candidateTreeHash,
      verification: { recipeId: "candidate.verify", recipeVersion: 1 },
      proof: {
        receiptId: replay.canonicalAcceptanceId,
        trajectoryDigest: replay.trajectoryDigest,
        verdict: "PROVEN",
      },
      productionExecution: false,
      replayId: replay.id,
      replayExecutionId: replay.executionId,
      status: "completed",
      attempt: claimedExecution.attempt,
      preTreeHash: replayResult.preTreeHash,
      postTreeHash: replayResult.postTreeHash,
      treeDigestVersion: DELIVERY_TREE_DIGEST_VERSION,
      workspaceIsolated: true,
      workspaceCleaned: true,
      evidenceRefs,
      sideEffects: { apply: false, push: false, browser: false, commands: false },
      validator: {
        profile: SHADOW_REPLAY_PROFILE,
        status: "passed",
        readCount: replayResult.readCount,
        totalBytes: replayResult.totalBytes,
        approvedPathCount: JSON.parse(claimedExecution.request).validationTargetPaths?.length ?? 0,
      },
    };
    const checkpoint = JSON.stringify({
      stage: "completed",
      sequence: claimedExecution.attempt + 1,
      updatedAt: new Date().toISOString(),
      replay: {
        replayId: replay.id,
        profile: SHADOW_REPLAY_PROFILE,
        preTreeHash: replayResult.preTreeHash,
        postTreeHash: replayResult.postTreeHash,
        sideEffects: receipt.sideEffects,
      },
    });
    const finalized = await finalizeExecutionAcceptance({
      executionId: execution.id,
      expectedAttempt: claimedExecution.attempt,
      workerId,
      finalizationKey: `shadow-replay:${replay.id}:attempt:${claimedExecution.attempt}:completed`,
      outcome: "SUCCEEDED",
      terminalStatus: "completed",
      reasonCode: "SHADOW_REPLAY_COMPLETED",
      recoveryState: "NONE",
      sourceRevision: replay.sourceRevision,
      candidateIdentity: replay.candidateTreeHash,
      recipeReceipt: receipt,
      checkpoint,
    });
    if (!finalized.accepted && !finalized.duplicate) {
      throw new ShadowReplayError("SHADOW_REPLAY_FINALIZATION_REJECTED", finalized.reason ?? "Replay finalization was rejected.");
    }
    await updateReplay(replay.id, {
      status: "completed",
      preTreeHash: replayResult.preTreeHash,
      postTreeHash: replayResult.postTreeHash,
      validatorResult: receipt.validator,
      receipt,
      completedAt: new Date(),
      error: null,
      workerId: null,
      leaseUntil: null,
    });
    return true;
  } catch (error) {
    const reason = error instanceof ShadowReplayError
      ? `${error.code}: ${error.message}`
      : "SHADOW_REPLAY_FAILED";
    await finalizeExecutionAcceptance({
      executionId: execution.id,
      expectedAttempt: claimedExecution.attempt,
      workerId,
      finalizationKey: `shadow-replay:${replay.id}:attempt:${claimedExecution.attempt}:failed`,
      outcome: "FAILED",
      terminalStatus: "failed",
      reasonCode: error instanceof ShadowReplayError ? error.code : "SHADOW_REPLAY_FAILED",
      recoveryState: "INCOMPLETE",
      error: reason,
      checkpoint: JSON.stringify({
        stage: "failed",
        sequence: claimedExecution.attempt + 1,
        updatedAt: new Date().toISOString(),
        replay: { replayId: replay.id, profile: SHADOW_REPLAY_PROFILE },
      }),
    }).catch(() => undefined);
    await updateReplay(replay.id, {
      status: controller.signal.aborted ? "cancelled" : "failed",
      error: reason.slice(0, 1_000),
      workerId: null,
      leaseUntil: null,
      completedAt: new Date(),
    });
    await cleanupReplayWorkspace({ ...claimedReplay, replayWorkspaceRoot: claimedReplay.replayWorkspaceRoot });
    return false;
  } finally {
    clearInterval(heartbeat);
    unregisterAiExecutionController(execution.id, controller);
  }
}

export async function dispatchPendingShadowReplays(limit = 32): Promise<number> {
  const pending = await db
    .select({ id: aiShadowReplaysTable.id, userId: aiShadowReplaysTable.userId })
    .from(aiShadowReplaysTable)
    .where(
      inArray(aiShadowReplaysTable.status, ["queued", "running"]),
    )
    .limit(Math.max(1, Math.min(limit, 100)));
  let dispatched = 0;
  for (const replay of pending) {
    const added = heavyJobQueue.enqueueWithId(`shadow-replay:${replay.id}`, async () => {
      await runShadowReplayAttempt(replay.id, replay.userId);
    });
    if (added) dispatched += 1;
  }
  return dispatched;
}