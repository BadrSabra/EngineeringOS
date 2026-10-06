import { promises as fs } from "node:fs";
import path from "node:path";
import { createHash, randomUUID } from "node:crypto";
import { and, eq, gt, inArray, isNull, lte, or, sql } from "drizzle-orm";
import {
  aiChangeProposalsTable,
  aiExecutionAcceptancesTable,
  aiExecutionsTable,
  aiGoalsTable,
  aiMissionsTable,
  aiShadowReplaysTable,
  projectsTable,
  db,
} from "@workspace/db";
import {
  createAiExecution,
  type AiExecutionRequestEnvelope,
} from "./ai-execution-state.js";
import {
  createValidationWorkspace,
  runRepairValidation,
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
  parseStoredProposalEvidence,
  validateSkillCandidateAgainstCanonicalProof,
} from "./skill-candidate.js";
import {
  loadCanonicalProof,
  type CanonicalProof,
} from "./proof-foundation.js";
import { heavyJobQueue } from "./job-queue.js";
import {
  parseTaskObjectiveContract,
  type TaskObjectiveContract,
} from "./task-objective-contract.js";
import {
  GoalNextActionSchema,
  type ValidationRunner,
} from "@workspace/ai-orchestrator";
import { runDeliveryPairedBaseline } from "./paired-baseline-delivery.js";

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

export type ShadowReplayReceiptProofFreshness =
  | "CURRENT"
  | "STALE"
  | "NOT_APPLICABLE";

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

export type DurableShadowReplayReceipt = Omit<ShadowReplayReceipt, "contractVersion"> & {
  contractVersion: 2;
  operationId: string;
  changeSetHash: string | null;
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
      engine: "server-registered-validation";
      profiles: Array<"workspace-typecheck" | "ai-orchestrator-tests">;
    };
  };
  pairedBaseline: {
    status: "incomplete" | "regressed" | "passed";
    promotionAllowed: boolean;
    contract: unknown;
    baselineRunId: string;
    candidateRunId: string;
    baselineWorkspaceHash: string;
    candidateWorkspaceHash: string;
    metricDeltas?: Record<string, number>;
    terminalMismatchCount: number;
    cases: unknown[];
    blockers: string[];
  };
};

type ShadowReplayBehaviorContract = {
  objective: TaskObjectiveContract;
  recipeId: "candidate.verify";
  recipeVersion: 1;
  approvedPaths: string[];
  validationProfiles: Array<"workspace-typecheck" | "ai-orchestrator-tests">;
};

type ShadowReplayRow = typeof aiShadowReplaysTable.$inferSelect;

function idempotencyKey(input: ShadowReplayStartInput): string {
  return `shadow-replay:${input.proposalId}:${input.candidate.candidateId}:${input.candidateTreeHash}`;
}

export function expectedShadowReplayOperationId(
  proposalId: string,
  candidateId: string,
): string {
  const candidateKey = createHash("sha256")
    .update(candidateId)
    .digest("hex")
    .slice(0, 32);
  return `shadow-replay:${proposalId}:${candidateKey}`;
}

function replayOperationId(input: ShadowReplayStartInput): string {
  return expectedShadowReplayOperationId(input.proposalId, input.candidate.candidateId);
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

async function validateCurrentSourceCandidate(
  replay: ShadowReplayRow,
  replayExecution: typeof aiExecutionsTable.$inferSelect,
): Promise<boolean> {
  const [proposal] = await db
    .select({
      projectId: aiChangeProposalsTable.projectId,
      operationId: aiChangeProposalsTable.operationId,
      baseRevision: aiChangeProposalsTable.baseRevision,
      candidateTreeHash: aiChangeProposalsTable.candidateTreeHash,
      changeSetHash: aiChangeProposalsTable.changeSetHash,
      workspaceRoot: aiChangeProposalsTable.workspaceRoot,
      status: aiChangeProposalsTable.status,
      lifecycle: aiChangeProposalsTable.lifecycle,
      validationEvidence: aiChangeProposalsTable.validationEvidence,
    })
    .from(aiChangeProposalsTable)
    .where(and(
      eq(aiChangeProposalsTable.id, replay.proposalId),
      eq(aiChangeProposalsTable.projectId, replay.projectId),
    ))
    .limit(1);
  if (
    !proposal
    || proposal.status !== "applied"
    || proposal.lifecycle !== "committed"
    || !proposal.operationId
    || proposal.baseRevision !== replay.sourceRevision
    || proposal.candidateTreeHash !== replay.candidateTreeHash
    || proposal.workspaceRoot !== replay.sourceWorkspaceRoot
  ) return false;

  let storedEvidence: unknown;
  try {
    storedEvidence = proposal.validationEvidence
      ? JSON.parse(proposal.validationEvidence)
      : null;
  } catch {
    return false;
  }
  const candidate = parseStoredProposalEvidence(storedEvidence).skillCandidate;
  if (
    !candidate
    || candidate.candidateId !== replay.candidateId
    || candidate.projectId !== replay.projectId
    || candidate.sourceRevision !== replay.sourceRevision
    || candidate.candidateTreeHash !== replay.candidateTreeHash
    || candidate.changeSetHash !== (proposal.changeSetHash ?? null)
    || candidate.proof.receiptId !== replay.canonicalAcceptanceId
    || candidate.proof.trajectoryDigest !== replay.trajectoryDigest
    || replay.operationId !== expectedShadowReplayOperationId(replay.proposalId, candidate.candidateId)
  ) return false;

  const [sourceAcceptance] = await db
    .select({ executionId: aiExecutionAcceptancesTable.executionId })
    .from(aiExecutionAcceptancesTable)
    .where(and(
      eq(aiExecutionAcceptancesTable.id, replay.canonicalAcceptanceId),
      eq(aiExecutionAcceptancesTable.projectId, replay.projectId),
    ))
    .limit(1);
  if (!sourceAcceptance) return false;
  const [sourceExecution] = await db
    .select()
    .from(aiExecutionsTable)
    .where(eq(aiExecutionsTable.id, sourceAcceptance.executionId))
    .limit(1);
  if (
    !sourceExecution
    || sourceExecution.projectId !== replay.projectId
    || sourceExecution.goalId !== replayExecution.goalId
    || sourceExecution.operationId !== proposal.operationId
  ) return false;

  const [scope] = await db
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
      eq(aiGoalsTable.id, sourceExecution.goalId ?? ""),
      eq(aiGoalsTable.projectId, replay.projectId),
      eq(aiMissionsTable.projectId, replay.projectId),
    ))
    .limit(1);
  const planRevision = scope ? planRevisionFromGoal(scope.outcomeContract) : undefined;
  const activePlanRevision = scope
    ? activePlanRevisionFromMission(scope.autonomyPolicy)
    : undefined;
  if (
    !scope
    || scope.goalId !== replayExecution.goalId
    || scope.goalStatus !== "completed"
    || !planRevision
    || !activePlanRevision
    || planRevision !== activePlanRevision
  ) return false;

  const canonicalProof = await db.transaction((tx) => loadCanonicalProof({
    tx,
    executionId: sourceExecution.id,
    scope: {
      projectId: replay.projectId,
      missionId: scope.missionId,
      goalId: scope.goalId,
      executionId: sourceExecution.id,
      operationId: proposal.operationId!,
      planRevision,
      activePlanRevision,
      sourceRevisionBinding: "scope",
      candidateIdentityBinding: "required",
      sourceRevision: replay.sourceRevision,
      candidateIdentity: replay.candidateTreeHash,
    },
    goalStatus: scope.goalStatus,
  }));
  const candidateDecision = validateSkillCandidateAgainstCanonicalProof(candidate, canonicalProof, {
    projectId: replay.projectId,
    sourceRevision: replay.sourceRevision,
    candidateTreeHash: replay.candidateTreeHash,
    changeSetHash: proposal.changeSetHash,
  });
  return candidateDecision.allowed
    && canonicalProof.acceptanceId === replay.canonicalAcceptanceId
    && canonicalProof.trajectoryDigest?.digest === replay.trajectoryDigest;
}

function recordValue(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : undefined;
}

type CompletedShadowReplayProofValidation =
  | { accepted: true; receipt: Record<string, unknown> }
  | {
      accepted: false;
      errorCode:
        | "SHADOW_REPLAY_RECEIPT_MISSING"
        | "SHADOW_REPLAY_SCOPE_UNAVAILABLE"
        | "SHADOW_REPLAY_CANONICAL_PROOF_REJECTED";
    };

async function validateCompletedShadowReplayProof(
  replay: ShadowReplayRow,
  execution: typeof aiExecutionsTable.$inferSelect,
): Promise<CompletedShadowReplayProofValidation> {
  const recipeReceipt = recordValue(execution.recipeReceipt);
  const durableReceipt = recordValue(replay.receipt);
  const receiptProof = recordValue(durableReceipt?.proof);
  const verification = recordValue(durableReceipt?.verification);
  const receiptMatchesReplay = recipeReceipt?.status === "completed"
    && recipeReceipt.executionId === replay.executionId
    && recipeReceipt.operationId === replay.operationId
    && recipeReceipt.recipeId === "candidate.verify"
    && recipeReceipt.recipeVersion === 1
    && durableReceipt?.status === "completed"
    && durableReceipt.contractVersion === 2
    && durableReceipt.runId === replay.id
    && durableReceipt.candidateId === replay.candidateId
    && durableReceipt.projectId === replay.projectId
    && durableReceipt.sourceRevision === replay.sourceRevision
    && durableReceipt.candidateTreeHash === replay.candidateTreeHash
    && durableReceipt.operationId === replay.operationId
    && durableReceipt.changeSetHash === replay.changeSetHash
    && verification?.recipeId === "candidate.verify"
    && verification.recipeVersion === 1
    && durableReceipt.replayId === replay.id
    && durableReceipt.replayExecutionId === replay.executionId
    && durableReceipt.productionExecution === false
    && replay.replayCanonicalAcceptanceId !== null
    && replay.attempt === execution.attempt
    && durableReceipt.attempt === execution.attempt
    && receiptProof?.receiptId === replay.replayCanonicalAcceptanceId
    && receiptProof?.verdict === "PROVEN";
  if (!receiptMatchesReplay || !durableReceipt) {
    return { accepted: false, errorCode: "SHADOW_REPLAY_RECEIPT_MISSING" };
  }

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
    return { accepted: false, errorCode: "SHADOW_REPLAY_SCOPE_UNAVAILABLE" };
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
      sourceRevisionBinding: "scope",
      candidateIdentityBinding: "required",
      sourceRevision: replay.sourceRevision,
      candidateIdentity: replay.candidateTreeHash,
    },
    goalStatus: replayScope.goalStatus,
  }));
  return replayProof.accepted
    && replayProof.verdict === "PROVEN"
    && replayProof.acceptanceId === replay.replayCanonicalAcceptanceId
    && replayProof.acceptanceId === receiptProof?.receiptId
    && replayProof.trajectoryDigest?.digest === receiptProof?.trajectoryDigest
    ? { accepted: true, receipt: durableReceipt }
    : { accepted: false, errorCode: "SHADOW_REPLAY_CANONICAL_PROOF_REJECTED" };
}

export async function getShadowReplayReceiptProofFreshness(
  replayId: string,
  userId: string,
): Promise<ShadowReplayReceiptProofFreshness> {
  const replay = await getShadowReplayForUser(replayId, userId);
  if (!replay) return "STALE";
  if (replay.status !== "completed") return "NOT_APPLICABLE";

  const [execution] = await db
    .select()
    .from(aiExecutionsTable)
    .where(eq(aiExecutionsTable.id, replay.executionId))
    .limit(1);
  if (
    !execution
    || execution.status !== "completed"
    || execution.attempt !== replay.attempt
    || !await validateCurrentSourceCandidate(replay, execution)
  ) {
    return "STALE";
  }
  const validation = await validateCompletedShadowReplayProof(replay, execution);
  return validation.accepted ? "CURRENT" : "STALE";
}

function validationProfileFromGoal(
  goal: Pick<typeof aiGoalsTable.$inferSelect, "outcomeContract" | "successCriteria">,
): "workspace-typecheck" | "ai-orchestrator-tests" | undefined {
  const outcome = recordValue(goal.outcomeContract);
  const success = recordValue(goal.successCriteria);
  const plan = recordValue(outcome?.planRevision ?? success?.planRevision);
  const steps = Array.isArray(plan?.steps) ? plan.steps : [];
  const step = steps.find((candidate) =>
    recordValue(candidate)?.id === outcome?.stepId,
  );
  const requested = outcome?.validationProfile ?? recordValue(step)?.validationProfile;
  return requested === "workspace-typecheck" || requested === "ai-orchestrator-tests"
    ? requested
    : undefined;
}

async function resolveShadowReplayBehaviorContract(
  input: ShadowReplayStartInput,
): Promise<ShadowReplayBehaviorContract> {
  if (!input.canonicalProof.executionId) {
    throw new ShadowReplayError(
      "SHADOW_REPLAY_OBJECTIVE_REQUIRED",
      "Shadow replay requires the source execution that contains the immutable objective contract.",
    );
  }
  const [sourceExecution] = await db
    .select({
      projectId: aiExecutionsTable.projectId,
      baseRevision: aiExecutionsTable.baseRevision,
      request: aiExecutionsTable.request,
    })
    .from(aiExecutionsTable)
    .where(eq(aiExecutionsTable.id, input.canonicalProof.executionId))
    .limit(1);
  const [goal] = await db
    .select({
      outcomeContract: aiGoalsTable.outcomeContract,
      successCriteria: aiGoalsTable.successCriteria,
      nextAction: aiGoalsTable.nextAction,
    })
    .from(aiGoalsTable)
    .where(and(
      eq(aiGoalsTable.id, input.goalId),
      eq(aiGoalsTable.projectId, input.projectId),
    ))
    .limit(1);
  let request: AiExecutionRequestEnvelope | undefined;
  try {
    request = sourceExecution ? JSON.parse(sourceExecution.request) as AiExecutionRequestEnvelope : undefined;
  } catch {
    request = undefined;
  }
  const objective = parseTaskObjectiveContract(request?.taskObjective);
  const validationProfile = goal ? validationProfileFromGoal(goal) : undefined;
  const nextAction = goal ? GoalNextActionSchema.safeParse(goal.nextAction) : undefined;
  const behaviorApprovedPaths = nextAction?.success && nextAction.data.kind === "recipe"
    ? [...nextAction.data.approvedPaths]
    : [];
  const behaviorIsCandidateVerification =
    nextAction?.success
    && nextAction.data.kind === "recipe"
    && nextAction.data.recipeId === "candidate.verify"
    && nextAction.data.recipeVersion === 1
    && nextAction.data.approvedPaths.length > 0
    && (
      nextAction.data.candidateIdentity === undefined
      || nextAction.data.candidateIdentity === null
      || nextAction.data.candidateIdentity === input.candidateTreeHash
    )
    && nextAction.data.approvedPaths.length === input.candidate.approvedPaths.length
    && nextAction.data.approvedPaths.every((approvedPath) => input.candidate.approvedPaths.includes(approvedPath))
    && nextAction.data.proposalId === undefined
    && nextAction.data.skill === undefined;
  const objectiveTargetPaths = objective?.targetPaths ?? [];
  const approved = new Set(input.candidate.approvedPaths);
  const targetScopeCovered = objectiveTargetPaths.length > 0
    && objectiveTargetPaths.every((target) => approved.has(target));
  const objectiveBound =
    sourceExecution?.projectId === input.projectId
    && sourceExecution.baseRevision === input.sourceRevision
    && objective?.projectId === input.projectId
    && objective.workspaceRevision === input.sourceRevision;
  const registeredValidatorOnly = objective?.validatorIds.length === 1
    && objective.validatorIds[0] === "registered-validation.v1";
  if (
    !objective
    || !validationProfile
    || !behaviorIsCandidateVerification
    || !objectiveBound
    || !registeredValidatorOnly
    || !targetScopeCovered
    || objective.kind === "browser_workflow"
    || objective.kind === "database_change"
    || objective.kind === "deployment"
    || objective.kind === "integration_task"
  ) {
    throw new ShadowReplayError(
      "SHADOW_REPLAY_OBJECTIVE_UNSUPPORTED",
      "Shadow replay requires a server-owned registered validation objective whose revision and target scope match the candidate.",
    );
  }
  return {
    objective,
    recipeId: "candidate.verify",
    recipeVersion: 1,
    approvedPaths: behaviorApprovedPaths,
    validationProfiles: [validationProfile],
  };
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

export async function assertCandidateWorkspaceIdentity(input: {
  operationId: string | null;
  sourceWorkspaceRoot: string | null;
  candidateTreeHash: string | null;
}): Promise<string> {
  if (!input.operationId || !input.candidateTreeHash || !input.sourceWorkspaceRoot) {
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

async function assertCandidateWorkspace(input: ShadowReplayStartInput): Promise<string> {
  return assertCandidateWorkspaceIdentity({
    operationId: input.operationId,
    sourceWorkspaceRoot: input.sourceWorkspaceRoot,
    candidateTreeHash: input.candidateTreeHash,
  });
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

async function measureApprovedFiles(
  workspaceRoot: string,
  approvedPaths: readonly string[],
  signal: AbortSignal,
): Promise<{ readCount: number; totalBytes: number }> {
  if (approvedPaths.length > SHADOW_REPLAY_MAX_PATHS) {
    throw new ShadowReplayError("SHADOW_REPLAY_BUDGET_EXCEEDED", "The candidate path budget was exceeded.");
  }
  let totalBytes = 0;
  for (const relativePath of approvedPaths) {
    if (signal.aborted) {
      throw new ShadowReplayError("SHADOW_REPLAY_CANCELLED", "Shadow replay was cancelled.");
    }
    const target = await assertNoSymlinkPath(workspaceRoot, relativePath);
    const stat = await fs.stat(target);
    if (!stat.isFile()) {
      throw new ShadowReplayError("SHADOW_REPLAY_NON_FILE_PATH", "Shadow replay only verifies regular files.");
    }
    if (stat.size > SHADOW_REPLAY_MAX_FILE_BYTES || totalBytes + stat.size > SHADOW_REPLAY_MAX_TOTAL_BYTES) {
      throw new ShadowReplayError("SHADOW_REPLAY_BUDGET_EXCEEDED", "The shadow replay read budget was exceeded.");
    }
    totalBytes += stat.size;
  }
  return { readCount: approvedPaths.length, totalBytes };
}

export class ShadowReplayError extends Error {
  readonly code: string;

  constructor(code: string, message: string) {
    super(message);
    this.name = "ShadowReplayError";
    this.code = code;
  }
}

type ShadowReplayLeaseOwner = {
  userId: string;
  workerId: string;
  attempt: number;
};

function replayOwnerWhere(
  replayId: string,
  owner: ShadowReplayLeaseOwner,
  now: Date,
) {
  return and(
    eq(aiShadowReplaysTable.id, replayId),
    eq(aiShadowReplaysTable.userId, owner.userId),
    eq(aiShadowReplaysTable.workerId, owner.workerId),
    eq(aiShadowReplaysTable.attempt, owner.attempt),
    eq(aiShadowReplaysTable.status, "running"),
    gt(aiShadowReplaysTable.leaseUntil, now),
  );
}

async function updateReplayOwned(
  replayId: string,
  owner: ShadowReplayLeaseOwner,
  values: Partial<typeof aiShadowReplaysTable.$inferInsert>,
): Promise<boolean> {
  const now = new Date();
  const [updated] = await db
    .update(aiShadowReplaysTable)
    .set({ ...values, updatedAt: now })
    .where(replayOwnerWhere(replayId, owner, now))
    .returning({ id: aiShadowReplaysTable.id });
  return Boolean(updated);
}

async function cleanupReplayWorkspace(
  replay: ShadowReplayRow,
  owner: ShadowReplayLeaseOwner,
): Promise<boolean> {
  if (!replay.replayWorkspaceRoot) return replay.replayWorkspaceCleaned;
  const replayWorkspaceRoot = replay.replayWorkspaceRoot;
  const now = new Date();
  const [renewed] = await db
    .update(aiShadowReplaysTable)
    .set({
      leaseUntil: new Date(now.getTime() + SHADOW_REPLAY_LEASE_MS),
      updatedAt: now,
    })
    .where(and(
      replayOwnerWhere(replay.id, owner, now),
      eq(aiShadowReplaysTable.replayWorkspaceRoot, replayWorkspaceRoot),
    ))
    .returning({ id: aiShadowReplaysTable.id });
  if (!renewed) return false;
  try {
    await fs.rm(replayWorkspaceRoot, { recursive: true, force: true });
  } catch {
    return false;
  }
  const cleanedAt = new Date();
  const [cleaned] = await db
    .update(aiShadowReplaysTable)
    .set({
      replayWorkspaceRoot: null,
      replayWorkspaceCleaned: true,
      leaseUntil: new Date(cleanedAt.getTime() + SHADOW_REPLAY_LEASE_MS),
      updatedAt: cleanedAt,
    })
    .where(and(
      replayOwnerWhere(replay.id, owner, cleanedAt),
      eq(aiShadowReplaysTable.replayWorkspaceRoot, replayWorkspaceRoot),
    ))
    .returning({ id: aiShadowReplaysTable.id });
  return Boolean(cleaned);
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
  const behaviorContract = await resolveShadowReplayBehaviorContract(input);

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
    recipeId: behaviorContract.recipeId,
    recipeVersion: behaviorContract.recipeVersion,
    approvedPaths: behaviorContract.approvedPaths,
    candidateIdentity: input.candidateTreeHash,
    candidateWorkspace: replayWorkspace.rootPath,
    validationProfiles: behaviorContract.validationProfiles,
    executionProfile: SHADOW_REPLAY_PROFILE,
    userId: input.userId,
    idempotencyKey: key,
    goalId: input.goalId,
  } as const;
  const prepared = prepareRecipeOperation(recipeParams);
  if (prepared.proofEvidenceMode !== "artifact_only") {
    throw new Error("Shadow Replay requires an artifact-only candidate verification recipe.");
  }
  const replayExecutionRequest: AiExecutionRequestEnvelope = {
    projectId: input.projectId,
    executionProfile: "shadow-replay",
    turnIntent: "TASK_EXECUTION",
    operationId,
    message: "Server-owned candidate shadow replay.",
    modelMessage: "Server-owned candidate shadow replay.",
    workspaceRevision: input.sourceRevision,
    workspaceRoot: replayWorkspace.rootPath,
    validationTargetPaths: [...behaviorContract.approvedPaths],
    validationProfiles: behaviorContract.validationProfiles,
    proofRequired: true,
    proofEvidenceMode: "artifact_only",
    objective: behaviorContract.objective.objective,
    taskObjective: behaviorContract.objective,
  };
  const advisoryLockKey = JSON.stringify([input.userId, key]);
  let creation: {
    kind: "created";
    inserted: ShadowReplayRow;
  } | {
    kind: "existing";
    replay: ShadowReplayRow;
  };
  try {
    creation = await db.transaction(async (tx) => {
      await tx.execute(sql`
        SELECT pg_advisory_xact_lock(hashtextextended(${advisoryLockKey}, 0))
      `);
      const [racedReplay] = await tx
        .select()
        .from(aiShadowReplaysTable)
        .where(and(
          eq(aiShadowReplaysTable.userId, input.userId),
          eq(aiShadowReplaysTable.idempotencyKey, key),
        ))
        .limit(1);
      if (racedReplay) return { kind: "existing" as const, replay: racedReplay };

      const execution = await createAiExecution({
        userId: input.userId,
        request: replayExecutionRequest,
        idempotencyKey: key,
        correlationId: operationId,
        projectId: input.projectId,
        goalId: input.goalId,
        recipeBinding: prepared.binding,
        workspaceRoot: replayWorkspace.rootPath,
        transaction: tx,
      });
      const [inserted] = await tx
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
        throw new ShadowReplayError(
          "SHADOW_REPLAY_CREATE_RACE",
          "Shadow replay creation raced and was not recoverable.",
        );
      }
      return {
        kind: "created" as const,
        inserted,
      };
    });
  } catch (error) {
    await fs.rm(replayWorkspace.rootPath, { recursive: true, force: true }).catch(() => undefined);
    throw error;
  }

  if (creation.kind === "existing") {
    await fs.rm(replayWorkspace.rootPath, { recursive: true, force: true }).catch(() => undefined);
    const raced = creation.replay;
    if (raced.projectId !== input.projectId || raced.proposalId !== input.proposalId) {
      throw new ShadowReplayError(
        "SHADOW_REPLAY_IDEMPOTENCY_CONFLICT",
        "Replay idempotency is bound to another proposal.",
      );
    }
    if (raced.status === "queued" || raced.status === "running") {
      await runShadowReplayAttempt(raced.id, input.userId);
    }
    const current = await getShadowReplayForUser(raced.id, input.userId);
    if (!current) throw new ShadowReplayError("SHADOW_REPLAY_NOT_FOUND", "Shadow replay disappeared.");
    return { replay: toPublicShadowReplay(current), created: false };
  }

  await runShadowReplayAttempt(creation.inserted.id, input.userId);
  const current = await getShadowReplayForUser(creation.inserted.id, input.userId);
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
  if (
    execution.status !== "queued"
    && execution.status !== "paused"
    && execution.status !== "completed"
  ) return false;

  const startedAt = new Date();
  const owner: ShadowReplayLeaseOwner = {
    userId,
    workerId: `shadow-replay:${replay.id}:${randomUUID()}`,
    attempt: execution.attempt,
  };
  const [claimedReplay] = await db
    .update(aiShadowReplaysTable)
    .set({
      status: "running",
      attempt: owner.attempt,
      workerId: owner.workerId,
      leaseUntil: new Date(startedAt.getTime() + SHADOW_REPLAY_LEASE_MS),
      startedAt: replay.startedAt ?? startedAt,
      updatedAt: startedAt,
    })
    .where(and(
      eq(aiShadowReplaysTable.id, replay.id),
      eq(aiShadowReplaysTable.userId, userId),
      eq(aiShadowReplaysTable.attempt, replay.attempt),
      or(
        eq(aiShadowReplaysTable.status, "queued"),
        and(
          eq(aiShadowReplaysTable.status, "running"),
          or(
            isNull(aiShadowReplaysTable.leaseUntil),
            lte(aiShadowReplaysTable.leaseUntil, startedAt),
          ),
        ),
      ),
    ))
    .returning();
  if (!claimedReplay) return false;

  if (!await validateCurrentSourceCandidate(replay, execution)) {
    const workspaceCleaned = await cleanupReplayWorkspace(claimedReplay, owner);
    await updateReplayOwned(replay.id, owner, {
      status: "failed",
      error: workspaceCleaned
        ? "SHADOW_REPLAY_SOURCE_PROOF_REJECTED"
        : "SHADOW_REPLAY_CLEANUP_FAILED",
      completedAt: new Date(),
      workerId: null,
      leaseUntil: null,
    });
    return false;
  }

  if (execution.status === "completed") {
    const proofValidation = await validateCompletedShadowReplayProof(claimedReplay, execution);
    if (!proofValidation.accepted && proofValidation.errorCode === "SHADOW_REPLAY_RECEIPT_MISSING") {
      await cleanupReplayWorkspace(claimedReplay, owner);
      await updateReplayOwned(replay.id, owner, {
        status: "failed",
        error: "SHADOW_REPLAY_RECEIPT_MISSING",
        completedAt: execution.completedAt ?? new Date(),
        workerId: null,
        leaseUntil: null,
      });
      return false;
    }
    if (!proofValidation.accepted) {
      const workspaceCleaned = await cleanupReplayWorkspace(claimedReplay, owner);
      await updateReplayOwned(replay.id, owner, {
        status: "failed",
        error: workspaceCleaned ? proofValidation.errorCode : "SHADOW_REPLAY_CLEANUP_FAILED",
        completedAt: execution.completedAt ?? new Date(),
        workerId: null,
        leaseUntil: null,
      });
      return false;
    }
    const durableReceipt = proofValidation.receipt;
    const workspaceCleaned = await cleanupReplayWorkspace(claimedReplay, owner);
    if (!workspaceCleaned) {
      await updateReplayOwned(replay.id, owner, {
        status: "failed",
        error: "SHADOW_REPLAY_CLEANUP_FAILED",
        completedAt: new Date(),
        workerId: null,
        leaseUntil: null,
      });
      return false;
    }
    return updateReplayOwned(replay.id, owner, {
      status: "completed",
      preTreeHash: typeof durableReceipt?.preTreeHash === "string" ? durableReceipt.preTreeHash : replay.preTreeHash,
      postTreeHash: typeof durableReceipt?.postTreeHash === "string" ? durableReceipt.postTreeHash : replay.postTreeHash,
      validatorResult: durableReceipt?.validator ?? replay.validatorResult,
      receipt: durableReceipt,
      completedAt: execution.completedAt ?? new Date(),
      replayWorkspaceRoot: null,
      replayWorkspaceCleaned: true,
      error: null,
      workerId: null,
      leaseUntil: null,
    });
  }

  // Startup reconciliation pauses an execution that was running when the
  // process died. The replay row remains running, so the durable execution
  // state is the recovery authority: queued starts normally, paused resumes
  // from its recipe checkpoint, and an active running execution is left alone.

  const request = JSON.parse(execution.request) as AiExecutionRequestEnvelope & {
    validationTargetPaths?: string[];
    validationProfiles?: Array<"workspace-typecheck" | "ai-orchestrator-tests">;
  };
  const approvedPaths = [...(request.validationTargetPaths ?? [])];
  const validationProfiles = request.validationProfiles ?? [];
  let ownershipLost = false;
  const renewReplayLease = async (): Promise<boolean> => {
    const renewed = await updateReplayOwned(replay.id, owner, {
      leaseUntil: new Date(Date.now() + SHADOW_REPLAY_LEASE_MS),
    });
    if (!renewed) ownershipLost = true;
    return renewed;
  };
  if (validationProfiles.length === 0) {
    await updateReplayOwned(replay.id, owner, {
      status: "failed",
      error: "SHADOW_REPLAY_OBJECTIVE_MISSING",
      workerId: null,
      leaseUntil: null,
      completedAt: new Date(),
    });
    return false;
  }
  const replayRoot = claimedReplay.replayWorkspaceRoot;
  if (!replayRoot) {
    await updateReplayOwned(replay.id, owner, {
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
  const validationRunner: ValidationRunner = async (
    profile,
    targetPaths,
    signal,
    _pendingChanges,
    evidenceContext,
    serverOwnedContext,
  ) => {
    if (
      !evidenceContext
      || typeof evidenceContext.operationId !== "string"
      || !evidenceContext.operationId
      || evidenceContext.projectRevision !== replay.sourceRevision
      || evidenceContext.candidateHash !== replay.candidateTreeHash
    ) {
      throw new ShadowReplayError(
        "SHADOW_REPLAY_VALIDATION_BINDING_MISSING",
        "The validator did not receive the server-owned execution, revision, and candidate identities.",
      );
    }
    if (ownershipLost || !await renewReplayLease()) {
      throw new ShadowReplayError(
        "SHADOW_REPLAY_LEASE_LOST",
        "The replay worker no longer owns the active lease.",
      );
    }
    if (!validationProfiles.includes(profile as "workspace-typecheck" | "ai-orchestrator-tests")) {
      return {
        profile,
        status: "blocked",
        scenario: "Shadow replay exposes only the server-owned profiles from the immutable objective contract.",
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
          operationId: evidenceContext.operationId,
          projectRevision: evidenceContext.projectRevision,
          candidateHash: evidenceContext.candidateHash,
          treeDigestVersion: DELIVERY_TREE_DIGEST_VERSION,
        },
        terminalState: "blocked",
        failureKind: "scope",
      };
    }
    const replaySignal = signal ?? new AbortController().signal;
    const measured = await measureApprovedFiles(replayRoot, targetPaths, replaySignal);
    const preTreeHash = await hashDeliveryTree(replayRoot);
    if (preTreeHash !== replay.candidateTreeHash) {
      throw new ShadowReplayError(
        "SHADOW_REPLAY_TREE_MISMATCH",
        "The isolated replay workspace does not match the candidate tree identity.",
      );
    }
    const result = await runRepairValidation(
      replayRoot,
      profile as "workspace-typecheck" | "ai-orchestrator-tests",
      targetPaths,
      replaySignal,
      [],
      {
        operationId: evidenceContext.operationId,
        projectRevision: evidenceContext.projectRevision,
        candidateHash: evidenceContext.candidateHash,
        childProcessIdentity: serverOwnedContext?.childProcessIdentity,
      },
    );
    if (ownershipLost || !await renewReplayLease()) {
      throw new ShadowReplayError(
        "SHADOW_REPLAY_LEASE_LOST",
        "The replay worker no longer owns the active lease.",
      );
    }
    const postTreeHash = await hashDeliveryTree(replayRoot);
    if (postTreeHash !== preTreeHash) {
      throw new ShadowReplayError(
        "SHADOW_REPLAY_SIDE_EFFECT_DETECTED",
        "The registered behavioral validator changed the isolated replay workspace.",
      );
    }
    replayStats = replayStats
      ? {
          ...replayStats,
          postTreeHash,
          readCount: replayStats.readCount + measured.readCount,
          totalBytes: replayStats.totalBytes + measured.totalBytes,
          behavioralCheckedFileCount:
            replayStats.behavioralCheckedFileCount + targetPaths.length,
        }
      : {
          preTreeHash,
          postTreeHash,
          readCount: measured.readCount,
          totalBytes: measured.totalBytes,
          behavioralCheckedFileCount: targetPaths.length,
        };
    return result;
  };
  const replayLeaseTimer = setInterval(() => {
    void renewReplayLease().catch(() => {
      ownershipLost = true;
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
      validationProfiles,
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
    if (ownershipLost || !await renewReplayLease()) return false;
    if (result.status !== "completed" || !replayStats) {
      throw new ShadowReplayError(
        "SHADOW_REPLAY_RECIPE_BLOCKED",
        "The server-owned candidate verification recipe did not reach terminal success.",
      );
    }
    const [completedExecution] = await db
      .select({
        status: aiExecutionsTable.status,
        attempt: aiExecutionsTable.attempt,
      })
      .from(aiExecutionsTable)
      .where(eq(aiExecutionsTable.id, replay.executionId))
      .limit(1);
    if (!completedExecution || completedExecution.status !== "completed") {
      throw new ShadowReplayError(
        "SHADOW_REPLAY_EXECUTION_NOT_COMPLETED",
        "The replay execution did not persist its completed state.",
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
        sourceRevisionBinding: "scope",
        candidateIdentityBinding: "required",
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
    if (!replayProof.acceptanceId) {
      throw new ShadowReplayError(
        "SHADOW_REPLAY_CANONICAL_PROOF_ID_MISSING",
        "The replay execution produced accepted proof without a durable acceptance identity.",
      );
    }
    const [project] = await db
      .select({
        rootPath: projectsTable.rootPath,
      })
      .from(projectsTable)
      .where(eq(projectsTable.id, replay.projectId))
      .limit(1);
    const [proposal] = await db
      .select({ baseTreeHash: aiChangeProposalsTable.baseTreeHash })
      .from(aiChangeProposalsTable)
      .where(and(
        eq(aiChangeProposalsTable.id, replay.proposalId),
        eq(aiChangeProposalsTable.projectId, replay.projectId),
      ))
      .limit(1);
    if (!project?.rootPath || !proposal) {
      throw new ShadowReplayError(
        "SHADOW_REPLAY_BASELINE_UNAVAILABLE",
        "The persisted source workspace is unavailable for the paired baseline.",
      );
    }
    if (ownershipLost || !await renewReplayLease()) return false;
    const paired = await runDeliveryPairedBaseline({
      replayId: replay.id,
      candidateId: replay.candidateId,
      sourceRevision: replay.sourceRevision,
      baselineSourceRoot: project.rootPath,
      candidateWorkspaceRoot: replayRoot,
      projectId: replay.projectId,
      missionId: replayScope.missionId,
      goalId: replayScope.goalId,
      planRevision,
      activePlanRevision,
      objective: JSON.stringify(request.taskObjective ?? request.objective),
      approvedPaths,
      validationProfiles,
      maxPaths: SHADOW_REPLAY_MAX_PATHS,
      maxTotalBytes: SHADOW_REPLAY_MAX_TOTAL_BYTES,
      expectedBaselineWorkspaceHash: proposal.baseTreeHash,
    });
    if (ownershipLost || !await renewReplayLease()) {
      await paired.cleanup();
      return false;
    }
    let workspaceCleaned = false;
    try {
      workspaceCleaned = await cleanupReplayWorkspace({
        ...claimedReplay,
        replayWorkspaceRoot: replayRoot,
      }, owner);
    } finally {
      await paired.cleanup();
    }
    if (!workspaceCleaned) {
      throw new ShadowReplayError(
        "SHADOW_REPLAY_CLEANUP_FAILED",
        "The disposable replay workspace could not be cleaned up.",
      );
    }
    const receipt: DurableShadowReplayReceipt = {
      contractVersion: 2,
      runId: replay.id,
      candidateId: replay.candidateId,
      projectId: replay.projectId,
      sourceRevision: replay.sourceRevision,
      candidateTreeHash: replay.candidateTreeHash,
      operationId: replay.operationId,
      changeSetHash: replay.changeSetHash,
      verification: { recipeId: "candidate.verify", recipeVersion: 1 },
      proof: {
        receiptId: replayProof.acceptanceId,
        trajectoryDigest: replayProof.trajectoryDigest?.digest ?? replay.trajectoryDigest,
        verdict: "PROVEN",
      },
      productionExecution: false,
      replayId: replay.id,
      replayExecutionId: replay.executionId,
      status: "completed",
      attempt: completedExecution.attempt,
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
          engine: "server-registered-validation",
          profiles: validationProfiles,
        },
      },
      pairedBaseline: paired.result.comparison,
    };
    return updateReplayOwned(replay.id, owner, {
      status: "completed",
      attempt: completedExecution.attempt,
      replayCanonicalAcceptanceId: replayProof.acceptanceId,
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
  } catch (error) {
    const reason = error instanceof ShadowReplayError
      ? `${error.code}: ${error.message}`
      : "SHADOW_REPLAY_FAILED";
    if (ownershipLost) return false;
    try {
      if (!await renewReplayLease()) return false;
      await cleanupReplayWorkspace(claimedReplay, owner);
      await updateReplayOwned(replay.id, owner, {
        status: "failed",
        error: reason.slice(0, 1_000),
        workerId: null,
        leaseUntil: null,
        completedAt: new Date(),
      });
    } catch {
      return false;
    }
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