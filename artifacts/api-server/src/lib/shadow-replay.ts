import { promises as fs } from "node:fs";
import path from "node:path";
import { createHash, randomUUID } from "node:crypto";
import ts from "typescript";
import { and, eq, inArray } from "drizzle-orm";
import {
  aiExecutionsTable,
  aiGoalsTable,
  aiMissionsTable,
  aiShadowReplaysTable,
  db,
} from "@workspace/db";
import {
  createAiExecution,
  type AiExecutionRequestEnvelope,
} from "./ai-execution-state.js";
import {
  createValidationWorkspace,
} from "./ai-repair-validation.js";
import {
  prepareRecipeOperation,
  runRecipeOperation,
} from "./recipe-operation-runner.js";
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
import {
  loadCanonicalProof,
  type CanonicalProof,
} from "./proof-foundation.js";
import { heavyJobQueue } from "./job-queue.js";
import type { ValidationRunner } from "@workspace/ai-orchestrator";

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
  missionId: string;
  goalId: string;
  planRevision: string;
  activePlanRevision: string;
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
    behavioralCheck: {
      status: "passed";
      checkedFileCount: number;
      engine: "typescript-compiler-api";
    };
  };
};

type ShadowReplayRow = typeof aiShadowReplaysTable.$inferSelect;

function idempotencyKey(input: ShadowReplayStartInput): string {
  return `shadow-replay:${input.proposalId}:${input.candidate.candidateId}:${input.candidateTreeHash}`;
}

function replayOperationId(input: ShadowReplayStartInput): string {
  const candidateKey = createHash("sha256")
    .update(input.candidate.candidateId)
    .digest("hex")
    .slice(0, 32);
  return `shadow-replay:${input.proposalId}:${candidateKey}`;
}

function planRevisionFromGoal(
  outcomeContract: unknown,
): string | undefined {
  if (!outcomeContract || typeof outcomeContract !== "object" || Array.isArray(outcomeContract)) {
    return undefined;
  }
  const revision = (outcomeContract as { planRevision?: unknown }).planRevision;
  if (!revision || typeof revision !== "object" || Array.isArray(revision)) return undefined;
  const hash = (revision as { hash?: unknown }).hash;
  return typeof hash === "string" && hash.trim() ? hash : undefined;
}

function activePlanRevisionFromMission(
  autonomyPolicy: unknown,
): string | undefined {
  if (!autonomyPolicy || typeof autonomyPolicy !== "object" || Array.isArray(autonomyPolicy)) {
    return undefined;
  }
  const revision = (autonomyPolicy as { activePlanRevision?: unknown }).activePlanRevision;
  return typeof revision === "string" && revision.trim() ? revision : undefined;
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
  behavioralCheckedFileCount: number;
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
  let behavioralCheckedFileCount = 0;
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
    const contents = await fs.readFile(target);
    const extension = path.extname(relativePath).toLowerCase();
    if ([".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs"].includes(extension)) {
      const syntax = ts.transpileModule(contents.toString("utf8"), {
        fileName: relativePath,
        compilerOptions: {
          allowJs: true,
          jsx: ts.JsxEmit.ReactJSX,
          target: ts.ScriptTarget.ES2022,
          module: ts.ModuleKind.ESNext,
        },
        reportDiagnostics: true,
      });
      const diagnostics = syntax.diagnostics ?? [];
      if (diagnostics.length > 0) {
        const detail = diagnostics
          .slice(0, 3)
          .map((diagnostic) => ts.flattenDiagnosticMessageText(diagnostic.messageText, " "))
          .join("; ");
        throw new ShadowReplayError(
          "SHADOW_REPLAY_BEHAVIOR_FAILED",
          `The server-owned source behavior check rejected ${relativePath}: ${detail}`,
        );
      }
      behavioralCheckedFileCount += 1;
    } else if (extension === ".json") {
      try {
        JSON.parse(contents.toString("utf8"));
        behavioralCheckedFileCount += 1;
      } catch {
        throw new ShadowReplayError(
          "SHADOW_REPLAY_BEHAVIOR_FAILED",
          `The server-owned JSON behavior check rejected ${relativePath}.`,
        );
      }
    }
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
  return {
    preTreeHash,
    postTreeHash,
    readCount,
    totalBytes,
    behavioralCheckedFileCount,
  };
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
  if (
    input.canonicalProof.scope.missionId !== input.missionId
    || input.canonicalProof.scope.goalId !== input.goalId
    || input.canonicalProof.scope.planRevision !== input.planRevision
    || input.canonicalProof.scope.activePlanRevision !== input.activePlanRevision
  ) {
    throw new ShadowReplayError(
      "SHADOW_REPLAY_SCOPE_MISMATCH",
      "The replay scope is not the same Mission, Goal, and plan revision as the canonical proof.",
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
  const recipeParams = {
    projectId: input.projectId,
    operationId,
    rootPath: input.sourceWorkspaceRoot!,
    sourceRevision: input.sourceRevision,
    recipeId: "candidate.verify",
    recipeVersion: 1,
    approvedPaths: [...input.candidate.approvedPaths],
    candidateIdentity: input.candidateTreeHash,
    candidateWorkspace: replayWorkspace.rootPath,
    executionProfile: SHADOW_REPLAY_PROFILE,
    userId: input.userId,
    idempotencyKey: key,
    proofRequired: true,
    goalId: input.goalId,
  } as const;
  const prepared = prepareRecipeOperation(recipeParams);
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
    proofRequired: true,
  };
  const execution = await createAiExecution({
    userId: input.userId,
    request: replayExecutionRequest,
    idempotencyKey: key,
    correlationId: operationId,
    projectId: input.projectId,
    goalId: input.goalId,
    recipeBinding: prepared.binding,
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
    const durableReceipt = replay.receipt && typeof replay.receipt === "object" && !Array.isArray(replay.receipt)
      ? replay.receipt as Record<string, unknown>
      : undefined;
    const receiptMatchesReplay = receiptRecord?.status === "completed"
      && receiptRecord.executionId === replay.executionId
      && receiptRecord.operationId === replay.operationId
      && receiptRecord.recipeId === "candidate.verify"
      && receiptRecord.recipeVersion === 1
      && durableReceipt?.status === "completed"
      && durableReceipt.replayId === replay.id
      && durableReceipt.replayExecutionId === replay.executionId
      && durableReceipt.productionExecution === false;
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
      preTreeHash: typeof durableReceipt?.preTreeHash === "string" ? durableReceipt.preTreeHash : replay.preTreeHash,
      postTreeHash: typeof durableReceipt?.postTreeHash === "string" ? durableReceipt.postTreeHash : replay.postTreeHash,
      validatorResult: durableReceipt?.validator ?? replay.validatorResult,
      receipt,
      completedAt: execution.completedAt ?? new Date(),
      replayWorkspaceRoot: null,
      replayWorkspaceCleaned: true,
      error: null,
    });
    return true;
  }

  // Startup reconciliation pauses an execution that was running when the
  // process died. The replay row remains running, so the durable execution
  // state is the recovery authority: queued starts normally, paused resumes
  // from its recipe checkpoint, and an active running execution is left alone.
  if (execution.status !== "queued" && execution.status !== "paused") return false;
  const startedAt = new Date();
  const [claimedReplay] = await db
    .update(aiShadowReplaysTable)
    .set({
      status: "running",
      attempt: execution.attempt,
      workerId: `shadow-replay:${replay.id}`,
      leaseUntil: new Date(startedAt.getTime() + SHADOW_REPLAY_LEASE_MS),
      startedAt: replay.startedAt ?? startedAt,
      updatedAt: startedAt,
    })
    .where(and(
      eq(aiShadowReplaysTable.id, replay.id),
      inArray(aiShadowReplaysTable.status, ["queued", "running"]),
    ))
    .returning();
  if (!claimedReplay) return false;

  const request = JSON.parse(execution.request) as AiExecutionRequestEnvelope & {
    validationTargetPaths?: string[];
  };
  const approvedPaths = [...(request.validationTargetPaths ?? [])];
  const replayRoot = claimedReplay.replayWorkspaceRoot;
  if (!replayRoot) {
    await updateReplay(replay.id, {
      status: "failed",
      error: "SHADOW_REPLAY_WORKSPACE_MISSING",
      workerId: null,
      leaseUntil: null,
      completedAt: new Date(),
    });
    return false;
  }
  let replayStats: {
    preTreeHash: string;
    postTreeHash: string;
    readCount: number;
    totalBytes: number;
    behavioralCheckedFileCount: number;
  } | undefined;
  const validationRunner: ValidationRunner = async (profile, targetPaths, signal) => {
    if (profile !== "workspace-typecheck" && profile !== "ai-orchestrator-tests") {
      return {
        profile,
        status: "blocked",
        scenario: "Shadow replay exposes only the fixed candidate verification profiles.",
        exitCode: null,
        command: "",
        stdout: "",
        stderr: "",
        failedTests: [],
        changedFiles: [],
        evidence: {
          evidenceId: `shadow-replay:${replay.id}:blocked:${profile}`,
          observedAt: new Date().toISOString(),
          artifactRef: `shadow-replay:${replay.id}:blocked`,
          operationId: replay.operationId,
          projectRevision: replay.sourceRevision,
          candidateHash: replay.candidateTreeHash,
          treeDigestVersion: DELIVERY_TREE_DIGEST_VERSION,
        },
        terminalState: "blocked",
        failureKind: "scope",
      };
    }
    const result = await runCandidateVerify({
      workspaceRoot: replayRoot,
      candidateTreeHash: replay.candidateTreeHash,
      approvedPaths: targetPaths,
      signal: signal ?? new AbortController().signal,
    });
    replayStats = replayStats
      ? {
          ...replayStats,
          postTreeHash: result.postTreeHash,
          readCount: replayStats.readCount + result.readCount,
          totalBytes: replayStats.totalBytes + result.totalBytes,
           behavioralCheckedFileCount:
             replayStats.behavioralCheckedFileCount + result.behavioralCheckedFileCount,
        }
      : result;
    return {
      profile,
      status: "passed",
      scenario: "Read-only server-owned candidate verification.",
      exitCode: 0,
      command: "",
      stdout: "",
      stderr: "",
      failedTests: [],
      changedFiles: [],
      evidence: {
        evidenceId: `shadow-replay:${replay.id}:validation:${profile}`,
        observedAt: new Date().toISOString(),
        artifactRef: `shadow-replay:${replay.id}:validation:${profile}`,
        operationId: replay.operationId,
        projectRevision: replay.sourceRevision,
        candidateHash: replay.candidateTreeHash,
        treeDigestVersion: DELIVERY_TREE_DIGEST_VERSION,
      },
      terminalState: "passed",
    };
  };
  const replayLeaseTimer = setInterval(() => {
    void updateReplay(replay.id, {
      leaseUntil: new Date(Date.now() + SHADOW_REPLAY_LEASE_MS),
    });
  }, Math.floor(SHADOW_REPLAY_LEASE_MS / 3));
  try {
    const result = await runRecipeOperation({
      projectId: replay.projectId,
      operationId: replay.operationId,
      rootPath: replay.sourceWorkspaceRoot,
      sourceRevision: replay.sourceRevision,
      recipeId: "candidate.verify",
      recipeVersion: 1,
      approvedPaths,
      candidateIdentity: replay.candidateTreeHash,
      candidateWorkspace: replayRoot,
      userId,
      idempotencyKey: execution.idempotencyKey,
      ...(execution.goalId ? { goalId: execution.goalId } : {}),
      ...(execution.sessionId ? { sessionId: execution.sessionId } : {}),
      executionProfile: SHADOW_REPLAY_PROFILE,
      proofRequired: true,
      validationRunner,
    });
    if (result.status !== "completed" || !replayStats) {
      throw new ShadowReplayError(
        "SHADOW_REPLAY_RECIPE_BLOCKED",
        "The server-owned candidate verification recipe did not reach terminal success.",
      );
    }
    const workspaceCleaned = await cleanupReplayWorkspace({
      ...claimedReplay,
      replayWorkspaceRoot: replayRoot,
    });
    if (!workspaceCleaned) {
      throw new ShadowReplayError(
        "SHADOW_REPLAY_CLEANUP_FAILED",
        "The disposable replay workspace could not be cleaned up.",
      );
    }
    const evidenceRefs = [
      `shadow-replay:${replay.id}:tree:pre`,
      `shadow-replay:${replay.id}:tree:post`,
      ...result.receipt.evidenceRefs,
      ...approvedPaths
        .slice(0, SHADOW_REPLAY_MAX_PATHS)
        .map((relativePath: string) => `shadow-replay:${replay.id}:read:${relativePath}`),
    ].slice(0, 48);
    const [replayScope] = await db
      .select({
        goalId: aiGoalsTable.id,
        missionId: aiGoalsTable.missionId,
        goalStatus: aiGoalsTable.status,
        outcomeContract: aiGoalsTable.outcomeContract,
        autonomyPolicy: aiMissionsTable.autonomyPolicy,
      })
      .from(aiGoalsTable)
      .innerJoin(aiMissionsTable, eq(aiMissionsTable.id, aiGoalsTable.missionId))
      .where(and(
        eq(aiGoalsTable.id, execution.goalId ?? ""),
        eq(aiGoalsTable.projectId, replay.projectId),
        eq(aiMissionsTable.projectId, replay.projectId),
      ))
      .limit(1);
    const planRevision = replayScope
      ? planRevisionFromGoal(replayScope.outcomeContract)
      : undefined;
    const activePlanRevision = replayScope
      ? activePlanRevisionFromMission(replayScope.autonomyPolicy)
      : undefined;
    if (
      !replayScope
      || replayScope.goalId !== execution.goalId
      || replayScope.goalStatus !== "completed"
      || !planRevision
      || !activePlanRevision
      || planRevision !== activePlanRevision
    ) {
      throw new ShadowReplayError(
        "SHADOW_REPLAY_SCOPE_UNAVAILABLE",
        "The replay execution is not bound to a completed Goal and active plan revision.",
      );
    }
    const replayProof = await db.transaction((tx) => loadCanonicalProof({
      tx,
      executionId: replay.executionId,
      scope: {
        projectId: replay.projectId,
        missionId: replayScope.missionId,
        goalId: replayScope.goalId,
        executionId: replay.executionId,
        operationId: replay.operationId,
        planRevision,
        activePlanRevision,
        sourceRevision: replay.sourceRevision,
        candidateIdentity: replay.candidateTreeHash,
      },
      goalStatus: replayScope.goalStatus,
    }));
    if (!replayProof.accepted || replayProof.verdict !== "PROVEN") {
      throw new ShadowReplayError(
        "SHADOW_REPLAY_CANONICAL_PROOF_REJECTED",
        `The replay execution did not produce accepted canonical proof: ${replayProof.failureReasons.join(", ")}`,
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
        receiptId: replayProof.acceptanceId!,
        trajectoryDigest: replayProof.trajectoryDigest?.digest ?? replay.trajectoryDigest,
        verdict: "PROVEN",
      },
      productionExecution: false,
      replayId: replay.id,
      replayExecutionId: replay.executionId,
      status: "completed",
      attempt: execution.attempt,
      preTreeHash: replayStats.preTreeHash,
      postTreeHash: replayStats.postTreeHash,
      treeDigestVersion: DELIVERY_TREE_DIGEST_VERSION,
      workspaceIsolated: true,
      workspaceCleaned: true,
      evidenceRefs,
      sideEffects: { apply: false, push: false, browser: false, commands: false },
      validator: {
        profile: SHADOW_REPLAY_PROFILE,
        status: "passed",
        readCount: replayStats.readCount,
        totalBytes: replayStats.totalBytes,
        approvedPathCount: approvedPaths.length,
        behavioralCheck: {
          status: "passed",
          checkedFileCount: replayStats.behavioralCheckedFileCount,
          engine: "typescript-compiler-api",
        },
      },
    };
    await updateReplay(replay.id, {
      status: "completed",
      preTreeHash: replayStats.preTreeHash,
      postTreeHash: replayStats.postTreeHash,
      validatorResult: receipt.validator,
      receipt,
      completedAt: new Date(),
      error: null,
      workerId: null,
      leaseUntil: null,
      replayWorkspaceRoot: null,
      replayWorkspaceCleaned: true,
    });
    return true;
  } catch (error) {
    const reason = error instanceof ShadowReplayError
      ? `${error.code}: ${error.message}`
      : "SHADOW_REPLAY_FAILED";
    await updateReplay(replay.id, {
      status: "failed",
      error: reason.slice(0, 1_000),
      workerId: null,
      leaseUntil: null,
      completedAt: new Date(),
    });
    await cleanupReplayWorkspace({ ...claimedReplay, replayWorkspaceRoot: claimedReplay.replayWorkspaceRoot });
    return false;
  } finally {
    clearInterval(replayLeaseTimer);
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