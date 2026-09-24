import { createHash, randomUUID } from "node:crypto";
import { and, desc, eq, inArray, isNull, sql } from "drizzle-orm";
import {
  aiChatMessagesTable,
  aiChangeProposalsTable,
  aiExecutionAcceptancesTable,
  aiAgentEffectBundlesTable,
  aiAgentEffectsTable,
  aiExecutionEvidenceReadsTable,
  aiExecutionEvidenceSnapshotsTable,
  aiExecutionsTable,
  aiGoalsTable,
  aiMissionsTable,
  db,
  eventsTable,
  taskLogsTable,
  tasksTable,
  workflowExecutionsTable,
  workflowsTable,
} from "@workspace/db";
import { recordAuditInTransaction, type RecordAuditParams } from "./audit.js";
import { parseTaskObjectiveContract, type TaskObjectiveContract } from "./task-objective-contract.js";
import { projectGoalAcceptance, type GoalAcceptanceProjection } from "./mission-acceptance-projection.js";
import {
  buildExecutionProofProjection,
  parseExecutionProofProjection,
  type ExecutionProofProjection,
} from "./execution-proof.js";
import { loadCanonicalProof } from "./proof-foundation.js";

export const ACCEPTANCE_NEXT_ACTION_CODES = [
  "NONE",
  "RESUME_ALLOWED",
  "START_NEW_PROBE",
  "REVIEW_INCOMPLETE_EVIDENCE",
  "ABANDON_EXECUTION",
  "RETRY_AFTER_PARSE",
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
  taskObjective?: {
    kind: string;
    validatorIds: string[];
    status: "PROVEN" | "INCOMPLETE" | "UNAVAILABLE";
  };
  proof?: ExecutionProofProjection;
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

export type EvidenceArtifactInput = {
  kind: "png";
  evidenceId: string;
  artifactRef: string;
  path: string;
  operationId: string;
  workspaceRevision: string;
  sha256: string;
  sizeBytes: number;
  width: number;
  height: number;
} | {
  kind: "pdf";
  evidenceId: string;
  artifactRef: string;
  path: string;
  operationId: string;
  workspaceRevision: string;
  sha256: string;
  sizeBytes: number;
  pageCount: number;
};

export type EvidenceSnapshotInput = {
  operationId?: string | null;
  /** Server-owned managed root from which the retained reads were acquired. */
  workspaceRoot?: string | null;
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
  /** Server-owned bounded artifact metadata; raw bytes are never retained. */
  artifacts?: readonly EvidenceArtifactInput[];
};

export type ReusableEvidenceRead = {
  path: string;
  body: string;
};

export type NormalizedEvidenceSnapshot = {
  complete: boolean;
  verdict: string;
  reads: Array<EvidenceReadInput & { complete: boolean; truncated: boolean; byteLength: number; contentHash: string }>;
  artifacts: EvidenceArtifactInput[];
  totalBytes: number;
  reason?: string;
};

export type FinalizeExecutionAcceptanceParams = {
  executionId: string;
  /** Attempt identity captured by the worker before it performed terminal work. */
  expectedAttempt: number;
  workerId?: string | null;
  allowExpiredLease?: boolean;
  /**
   * Reconciliation may begin from an unlocked lease snapshot. When it later
   * finalizes that snapshot, require the locked row to still have the exact
   * ownership tuple that was observed; otherwise a renewal or terminal write
   * has already won the race.
   */
  expectedExecutionState?: {
    status: "queued" | "running" | "paused" | "cancelling" | "failed" | "completed" | "cancelled";
    workerId: string | null;
    leaseUntil: Date | null;
  };
  finalMessageId?: string | null;
  finalMessageContent?: string | null;
  /** Preserve a bounded provider/validation code already persisted on the message. */
  finalMessageErrorCode?: string | null;
  /**
   * A paused/queued cancellation or abandon may arrive after the attempt
   * already has a retry acceptance. In that narrow case the interruption
   * refines the existing row instead of being treated as a duplicate.
   */
  replaceExistingInterruption?: boolean;
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
  /** Server-owned managed root used by this terminalization. */
  workspaceRoot?: string | null;
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
  /** Optional workflow phase projection through the existing Goal/Mission seam. */
  goalProjection?: GoalExecutionProjection;
  taskObjective?: TaskObjectiveContract;
  taskObjectiveStatus?: "PROVEN" | "INCOMPLETE" | "UNAVAILABLE";
  stateProjection?: Record<string, unknown>;
  /** A mutation-backed acceptance must name the server-owned effect bundle. */
  effectBundleId?: string | null;
  /** Persisted request flag indicating that this execution has a mutation effect gate. */
  effectRequired?: boolean;
};

/**
 * Refine an already-terminal provider failure when bounded recovery is
 * exhausted. This is intentionally not a new acceptance attempt: the
 * existing execution/attempt/message identity remains authoritative while
 * the public disposition changes from "retry" to an explicit incomplete
 * result backed by the evidence snapshot already persisted for that attempt.
 */
export async function settleExhaustedExecutionRecovery(params: {
  executionId: string;
  userId: string;
  finalMessageId: string;
  content: string;
  errorMessage: string;
  evidenceReason: string;
  reasonCode?: string;
  evidenceVerdict?: "UNAVAILABLE" | "PARTIAL";
  nextActionCode?: "REVIEW_INCOMPLETE_EVIDENCE" | "ABANDON_EXECUTION";
}): Promise<{ settled: boolean; reason?: string }> {
  return db.transaction(async (tx) => {
    const [execution] = await tx
      .select()
      .from(aiExecutionsTable)
      .where(and(
        eq(aiExecutionsTable.id, params.executionId),
        eq(aiExecutionsTable.userId, params.userId),
      ))
      .for("update");
    if (!execution) return { settled: false, reason: "execution_not_found" };
    if (execution.status === "cancelled" || execution.status === "completed") {
      return { settled: false, reason: "execution_already_terminal" };
    }
    if (execution.finalMessageId !== params.finalMessageId) {
      return { settled: false, reason: "final_message_mismatch" };
    }

    const [acceptance] = await tx
      .select()
      .from(aiExecutionAcceptancesTable)
      .where(and(
        eq(aiExecutionAcceptancesTable.executionId, execution.id),
        eq(aiExecutionAcceptancesTable.attempt, execution.attempt),
      ))
      .limit(1);
    if (!acceptance) return { settled: false, reason: "acceptance_not_found" };
    if (acceptance.outcome !== "FAILED" && acceptance.outcome !== "INTERRUPTED") {
      return { settled: false, reason: "acceptance_already_terminal" };
    }

    const now = new Date();
    const errorCode = params.reasonCode ?? "EVIDENCE_RECOVERY_EXHAUSTED";
    const nextActionCode = params.nextActionCode ?? "REVIEW_INCOMPLETE_EVIDENCE";
    const disposition = {
      ...(acceptance.disposition && typeof acceptance.disposition === "object"
        ? acceptance.disposition as Record<string, unknown>
        : {}),
      reasonCodes: ["EXECUTION_ACCEPTANCE_INCOMPLETE"],
      outcome: "FAILED",
      failureKind: "INCOMPLETE",
      recoveryState: "INCOMPLETE",
      nextActionCode,
      operatorAction: "START_NEW_RUN",
      evidenceReason: params.evidenceReason.slice(0, 500),
    };
    await tx
      .update(aiExecutionAcceptancesTable)
      .set({
        terminalStatus: "failed",
        outcome: "FAILED",
        reasonCode: "EXECUTION_ACCEPTANCE_INCOMPLETE",
        nextActionCode,
        disposition,
        resumable: 0,
      })
      .where(eq(aiExecutionAcceptancesTable.id, acceptance.id));

    await tx
      .update(aiChatMessagesTable)
      .set({
        content: params.content,
        outcome: "FAILED",
        errorCode,
        errorMessage: params.errorMessage.slice(0, 500),
      })
      .where(and(
        eq(aiChatMessagesTable.id, params.finalMessageId),
        eq(aiChatMessagesTable.executionId, execution.id),
      ));

    let checkpoint: Record<string, unknown> = {};
    try {
      const parsed = JSON.parse(execution.checkpoint) as unknown;
      if (parsed && typeof parsed === "object") checkpoint = parsed as Record<string, unknown>;
    } catch {
      // Preserve a valid terminal envelope even when a legacy checkpoint is malformed.
    }
    await tx
      .update(aiExecutionsTable)
      .set({
        status: "failed",
        error: params.errorMessage.slice(0, 500),
        updatedAt: now,
        workerId: null,
        leaseUntil: null,
        lastHeartbeatAt: null,
        checkpoint: JSON.stringify({
          ...checkpoint,
          stage: "failed",
          evidenceVerdict: params.evidenceVerdict ?? "PARTIAL",
          evidenceReason: params.evidenceReason.slice(0, 500),
          recoveryState: "INCOMPLETE",
          updatedAt: now.toISOString(),
        }),
        checkpointVersion: execution.checkpointVersion + 1,
      })
      .where(and(
        eq(aiExecutionsTable.id, execution.id),
        eq(aiExecutionsTable.finalMessageId, params.finalMessageId),
      ));

    return { settled: true };
  });
}

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

export type GoalExecutionProjection = {
  goalId: string;
  workflowId: string;
  workflowExecutionId: string;
  phase: string;
  finalPhase: boolean;
  correlationId?: string | null;
};

type ObjectiveTaskStatus = typeof tasksTable.$inferSelect["status"];
type ObjectiveOutcome = "SUCCEEDED" | "FAILED" | "INTERRUPTED";
type ObjectiveGoalStatus = typeof aiGoalsTable.$inferSelect["status"];
type ObjectiveMissionStatus = typeof aiMissionsTable.$inferSelect["status"];
type AcceptanceTransaction = Parameters<Parameters<typeof db.transaction>[0]>[0];

/**
 * Derive the linked objective state from server-owned task/acceptance state.
 * Provider text and provider-selected status never participate in this decision.
 */
export function deriveLinkedGoalStatus(params: {
  outcome: ObjectiveOutcome;
  taskStatus: ObjectiveTaskStatus;
  retryable: boolean;
  siblingTaskStatuses: ObjectiveTaskStatus[];
  deliveryRequired?: boolean;
  deliveryReceipt?: { status: "PROVEN" | "completed" | "succeeded" } | null;
  canonicalProofAccepted?: boolean;
}): ObjectiveGoalStatus {
  if (params.outcome === "INTERRUPTED") return "needs_replan";
  if (params.outcome === "FAILED") return params.retryable ? "needs_replan" : "failed";
  if (params.taskStatus === "verifying") return "verifying";
  if (params.taskStatus !== "completed") return "running";

  const taskStatuses = [...params.siblingTaskStatuses, params.taskStatus];
  if (taskStatuses.some((status) => status === "failed" || status === "cancelled")) {
    return "needs_replan";
  }
  if (!taskStatuses.every((status) => status === "completed")) return "running";
  if (params.deliveryRequired && !params.deliveryReceipt) return "verifying";
  return params.canonicalProofAccepted !== false ? "completed" : "verifying";
}

function goalRequiresDelivery(contract: unknown, nextAction?: unknown): boolean {
  const action = nextAction && typeof nextAction === "object" && !Array.isArray(nextAction)
    ? nextAction as Record<string, unknown>
    : {};
  return Boolean(
    contract
    && typeof contract === "object"
    && !Array.isArray(contract)
    && (contract as Record<string, unknown>).deliveryRequired === true,
  ) && action.recipeId !== "candidate.verify";
}

function recordValue(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function buildCanonicalRecipeReceipt(params: {
  value: unknown;
  execution: typeof aiExecutionsTable.$inferSelect;
  sourceRevision: string | null;
  proposal?: {
    candidateTreeHash: string | null;
    promotedTreeHash: string | null;
    committedTreeHash: string | null;
  } | null;
}): GoalAcceptanceProjection["deliveryReceipt"] {
  const value = recordValue(params.value);
  if (
    value.contractVersion !== 1
    || typeof value.recipeId !== "string"
    || value.status !== "completed"
  ) {
    return null;
  }
  return {
    kind: "recipe",
    status: "completed",
    executionId: typeof value.executionId === "string" ? value.executionId : params.execution.id,
    attempt: typeof value.attempt === "number" ? value.attempt : params.execution.attempt,
    operationId: typeof value.operationId === "string"
      ? value.operationId
      : params.execution.operationId,
    sourceRevision: typeof value.sourceRevision === "string"
      ? value.sourceRevision
      : params.sourceRevision,
    candidateTreeHash: typeof value.candidateTreeHash === "string"
      ? value.candidateTreeHash
      : params.proposal?.candidateTreeHash ?? null,
    treeHash: typeof value.treeHash === "string"
      ? value.treeHash
      : params.proposal?.committedTreeHash
        ?? params.proposal?.promotedTreeHash
        ?? null,
  };
}

export function deriveMissionStatusFromGoals(
  goalStatuses: ObjectiveGoalStatus[],
): ObjectiveMissionStatus {
  if (goalStatuses.some((status) => status === "needs_replan")) return "needs_replan";
  if (goalStatuses.some((status) => status === "failed")) return "failed";
  if (goalStatuses.some((status) => status === "blocked")) return "blocked";
  if (goalStatuses.some((status) =>
    status === "waiting_for_event"
    || status === "waiting_for_approval"
    || status === "verifying"
  )) return "waiting";
  if (goalStatuses.some((status) =>
    status === "queued"
    || status === "planning"
    || status === "running"
  )) return "active";
  if (goalStatuses.length > 0 && goalStatuses.every((status) => status === "completed")) {
    return "completed";
  }
  if (goalStatuses.length > 0 && goalStatuses.every((status) => status === "cancelled")) {
    return "cancelled";
  }
  return "needs_replan";
}

function readGoalPlanRevision(value: unknown): string | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  const record = value as Record<string, unknown>;
  const planRevision = record.planRevision;
  if (planRevision && typeof planRevision === "object" && !Array.isArray(planRevision)) {
    const hash = (planRevision as Record<string, unknown>).hash;
    return typeof hash === "string" ? hash : undefined;
  }
  return typeof planRevision === "string" ? planRevision : undefined;
}

function activeMissionPlanRevision(
  mission: typeof aiMissionsTable.$inferSelect,
): string | null {
  const policy = mission.autonomyPolicy;
  if (!policy || typeof policy !== "object" || Array.isArray(policy)) return null;
  const revision = (policy as Record<string, unknown>).activePlanRevision;
  return typeof revision === "string" && revision.length > 0 ? revision : null;
}

function goalPlanRevisionForProof(
  goal: typeof aiGoalsTable.$inferSelect,
): string | null {
  return readGoalPlanRevision(goal.outcomeContract)
    ?? readGoalPlanRevision(goal.successCriteria)
    ?? null;
}

/**
 * Historical Goals remain visible for audit, but only the active plan revision
 * can determine the current Mission status. Without this projection boundary,
 * a failed Goal from an earlier revision would immediately poison every later
 * replan back to needs_replan.
 */
export function selectActiveMissionGoals<
  T extends {
    status: ObjectiveGoalStatus;
    successCriteria?: unknown;
    outcomeContract?: unknown;
  },
>(params: {
  mission: { autonomyPolicy: Record<string, unknown> };
  goals: T[];
}): T[] {
  const activeRevision = params.mission.autonomyPolicy.activePlanRevision;
  if (typeof activeRevision !== "string" || activeRevision.length === 0) return params.goals;
  const activeGoals = params.goals.filter((goal) =>
    readGoalPlanRevision(goal.successCriteria) === activeRevision
    || readGoalPlanRevision(goal.outcomeContract) === activeRevision,
  );
  return activeGoals.length > 0 ? activeGoals : params.goals;
}

async function syncLinkedObjectiveState(
  tx: AcceptanceTransaction,
  params: {
    task: typeof tasksTable.$inferSelect;
    taskStatus: ObjectiveTaskStatus;
    outcome: ObjectiveOutcome;
    retryable: boolean;
    executionId: string;
    operationId: string | null;
    correlationId: string | null;
    now: Date;
    acceptanceProjection?: GoalAcceptanceProjection;
  },
) {
  if (!params.task.goalId) return;

  const [goal] = await tx
    .select()
    .from(aiGoalsTable)
    .where(and(
      eq(aiGoalsTable.id, params.task.goalId),
      eq(aiGoalsTable.projectId, params.task.projectId),
    ))
    .for("update");
  if (!goal) return;
  const siblingTasks = await tx
    .select({ id: tasksTable.id, status: tasksTable.status })
    .from(tasksTable)
    .where(and(
      eq(tasksTable.goalId, goal.id),
      eq(tasksTable.projectId, params.task.projectId),
    ));
  const [mission] = await tx
    .select()
    .from(aiMissionsTable)
    .where(and(
      eq(aiMissionsTable.id, goal.missionId),
      eq(aiMissionsTable.projectId, params.task.projectId),
    ))
    .for("update");
  if (!mission) return;

  const deliveryRequired = goalRequiresDelivery(goal.outcomeContract, goal.nextAction);
  const canonicalProof = params.outcome === "SUCCEEDED" && params.acceptanceProjection
    ? await loadCanonicalProof({
        tx,
        executionId: params.executionId,
        scope: {
          projectId: params.task.projectId,
          missionId: mission.id,
          goalId: goal.id,
          executionId: params.executionId,
          operationId: params.operationId,
          planRevision: goalPlanRevisionForProof(goal),
          activePlanRevision: activeMissionPlanRevision(mission),
          sourceRevision: params.acceptanceProjection.sourceRevision ?? null,
          candidateIdentity: params.acceptanceProjection.candidateIdentity ?? null,
        },
        goalStatus: "completed",
        deliveryRequired,
        deliveryReceipt: params.acceptanceProjection.deliveryReceipt,
      })
    : null;
  const acceptanceProjection = params.acceptanceProjection
    ? {
        ...params.acceptanceProjection,
        verdict: params.outcome === "SUCCEEDED"
          ? canonicalProof?.accepted === true ? "PROVEN" as const : "INCOMPLETE" as const
          : params.acceptanceProjection.verdict,
      }
    : undefined;
  if (acceptanceProjection) {
    await projectGoalAcceptance(tx, {
      goalId: goal.id,
      projectId: params.task.projectId,
      projection: acceptanceProjection,
    });
  }

  const nextGoalStatus: ObjectiveGoalStatus = deriveLinkedGoalStatus({
    outcome: params.outcome,
    taskStatus: params.taskStatus,
    retryable: params.retryable,
    siblingTaskStatuses: siblingTasks
      .filter((task) => task.id !== params.task.id)
      .map((task) => task.status),
    deliveryRequired,
    deliveryReceipt: acceptanceProjection?.deliveryReceipt,
    canonicalProofAccepted: canonicalProof?.accepted === true,
  });

  // A manually blocked/cancelled goal remains operator-owned. Automatic
  // execution may advance an active/recoverable goal but must not reopen it.
  const goalIsOperatorOwned = goal.status === "blocked" || goal.status === "cancelled";
  const goalChanged = !goalIsOperatorOwned && goal.status !== nextGoalStatus;
  if (goalChanged) {
    await tx.update(aiGoalsTable)
      .set({
        status: nextGoalStatus,
        completedAt: nextGoalStatus === "completed" ? goal.completedAt ?? params.now : null,
        blockedReason: nextGoalStatus === "needs_replan"
          ? params.acceptanceProjection?.reasonCode
            ? `Server-owned acceptance ${params.acceptanceProjection.reasonCode}; proof is not complete.`
            : `Execution ${params.outcome === "INTERRUPTED" ? "was cancelled" : "did not complete"}; review or retry the task.`
          : null,
        updatedAt: params.now,
      })
      .where(and(
        eq(aiGoalsTable.id, goal.id),
        eq(aiGoalsTable.projectId, params.task.projectId),
      ));
    await tx.insert(eventsTable).values({
      id: randomUUID(),
      type: "AiGoalStatusSynced",
      projectId: params.task.projectId,
      goalId: goal.id,
      taskId: params.task.id,
      severity: nextGoalStatus === "completed" ? "success" : nextGoalStatus === "needs_replan" ? "warning" : "info",
      message: `AI goal "${goal.title}" → ${nextGoalStatus}`,
      correlationId: params.correlationId ?? undefined,
      payload: {
        executionId: params.executionId,
        taskId: params.task.id,
        before: goal.status,
        after: nextGoalStatus,
        outcome: params.outcome,
        retryable: params.retryable,
        ...(acceptanceProjection
          ? {
              acceptance: {
                acceptanceId: acceptanceProjection.acceptanceId ?? null,
                executionId: acceptanceProjection.executionId,
                outcome: acceptanceProjection.outcome,
                verdict: acceptanceProjection.verdict,
                evidenceSnapshotId: acceptanceProjection.evidenceSnapshotId ?? null,
                sourceRevision: acceptanceProjection.sourceRevision ?? null,
                candidateIdentity: acceptanceProjection.candidateIdentity ?? null,
                acceptedRefs: acceptanceProjection.acceptedRefs ?? [],
                validatorIds: acceptanceProjection.validatorIds ?? [],
                receipt: acceptanceProjection.receipt ?? null,
                reasonCode: acceptanceProjection.reasonCode ?? null,
                nextActionCode: acceptanceProjection.nextActionCode ?? null,
              },
            }
          : {}),
      },
    });
  }

  const goals = await tx
    .select({
      id: aiGoalsTable.id,
      status: aiGoalsTable.status,
      successCriteria: aiGoalsTable.successCriteria,
      outcomeContract: aiGoalsTable.outcomeContract,
    })
    .from(aiGoalsTable)
    .where(and(
      eq(aiGoalsTable.missionId, goal.missionId),
      eq(aiGoalsTable.projectId, params.task.projectId),
    ))
    .for("update");
  const missionIsOperatorOwned =
    mission.status === "blocked"
    || mission.status === "cancelled"
    || mission.status === "completed";
  const effectiveGoalStatuses = selectActiveMissionGoals({
    mission,
    goals,
  }).map((item) =>
    item.id === goal.id && goalChanged ? nextGoalStatus : item.status,
  );
  const nextMissionStatus = deriveMissionStatusFromGoals(effectiveGoalStatuses);
  if (missionIsOperatorOwned || mission.status === nextMissionStatus) return;

  await tx.update(aiMissionsTable)
    .set({
      status: nextMissionStatus,
      completedAt: nextMissionStatus === "completed" ? mission.completedAt ?? params.now : null,
      updatedAt: params.now,
    })
    .where(and(
      eq(aiMissionsTable.id, mission.id),
      eq(aiMissionsTable.projectId, params.task.projectId),
    ));
  await tx.insert(eventsTable).values({
    id: randomUUID(),
    type: "AiMissionStatusSynced",
    projectId: params.task.projectId,
    taskId: params.task.id,
    severity: nextMissionStatus === "completed" ? "success" : nextMissionStatus === "needs_replan" || nextMissionStatus === "failed" ? "warning" : "info",
    message: `AI mission "${mission.title}" → ${nextMissionStatus}`,
    correlationId: params.correlationId ?? undefined,
    payload: {
      executionId: params.executionId,
      taskId: params.task.id,
      goalId: goal.id,
      before: mission.status,
      after: nextMissionStatus,
      outcome: params.outcome,
      retryable: params.retryable,
    },
  });
}

async function syncWorkflowGoalProjection(
  tx: AcceptanceTransaction,
  params: {
    projection: GoalExecutionProjection;
    projectId: string;
    executionId: string;
    acceptance: typeof aiExecutionAcceptancesTable.$inferSelect;
    now: Date;
  },
): Promise<void> {
  const [goal] = await tx
    .select()
    .from(aiGoalsTable)
    .where(and(
      eq(aiGoalsTable.id, params.projection.goalId),
      eq(aiGoalsTable.projectId, params.projectId),
    ))
    .for("update");
  if (!goal) return;
  const [workflow] = await tx
    .select({ id: workflowsTable.id, goalId: workflowsTable.goalId })
    .from(workflowsTable)
    .where(and(
      eq(workflowsTable.id, params.projection.workflowId),
      eq(workflowsTable.projectId, params.projectId),
      eq(workflowsTable.goalId, goal.id),
    ))
    .limit(1);
  if (!workflow) return;
  const [workflowExecution] = await tx
    .select({ id: workflowExecutionsTable.id })
    .from(workflowExecutionsTable)
    .where(and(
      eq(workflowExecutionsTable.id, params.projection.workflowExecutionId),
      eq(workflowExecutionsTable.workflowId, workflow.id),
    ))
    .limit(1);
  if (!workflowExecution) return;

  const evidenceComplete = params.acceptance.evidenceComplete === 1;
  const [missionForProof] = params.projection.finalPhase
    ? await tx
      .select()
      .from(aiMissionsTable)
      .where(and(
        eq(aiMissionsTable.id, goal.missionId),
        eq(aiMissionsTable.projectId, params.projectId),
      ))
      .for("update")
    : [];
  const canonicalProof = missionForProof
    && params.projection.finalPhase
    && params.acceptance.outcome === "SUCCEEDED"
    ? await loadCanonicalProof({
        tx,
        executionId: params.executionId,
        scope: {
          projectId: params.projectId,
          missionId: missionForProof.id,
          goalId: goal.id,
          executionId: params.executionId,
          operationId: params.acceptance.operationId,
          planRevision: goalPlanRevisionForProof(goal),
          activePlanRevision: activeMissionPlanRevision(missionForProof),
          sourceRevision: params.acceptance.sourceRevision,
          candidateIdentity: params.acceptance.candidateIdentity,
        },
        goalStatus: "completed",
        deliveryRequired: goalRequiresDelivery(goal.outcomeContract, goal.nextAction),
      })
    : null;
  await projectGoalAcceptance(tx, {
    goalId: goal.id,
    projectId: params.projectId,
    projection: {
      acceptanceId: params.acceptance.id,
      executionId: params.executionId,
      outcome: params.acceptance.outcome as GoalAcceptanceProjection["outcome"],
      verdict: params.acceptance.outcome === "SUCCEEDED"
        && (params.projection.finalPhase
          ? canonicalProof?.accepted === true
          : evidenceComplete)
        ? "PROVEN"
        : params.acceptance.outcome === "FAILED"
          ? "FAILED"
          : "INCOMPLETE",
      evidenceSnapshotId: params.acceptance.evidenceSnapshotId,
      evidenceRequired: params.acceptance.evidenceRequired === 1,
      evidenceComplete,
      sourceRevision: params.acceptance.sourceRevision,
      scope: { projectId: params.projectId },
      acceptedRefs: [
        params.acceptance.evidenceSnapshotId,
        params.executionId,
      ].filter((value): value is string => Boolean(value)),
      receipt: {
        kind: "execution_acceptance",
        id: params.acceptance.id,
        executionId: params.executionId,
        status: params.acceptance.terminalStatus,
      },
      reasonCode: params.acceptance.reasonCode,
      nextActionCode: params.acceptance.nextActionCode,
      updatedAt: params.now,
    },
  });

  // Intermediate phases contribute durable acceptance evidence but do not
  // complete the Goal. Only the final phase owns the Goal/Mission terminal
  // transition.
  if (!params.projection.finalPhase) return;

  const nextGoalStatus: ObjectiveGoalStatus = params.acceptance.outcome === "SUCCEEDED"
    ? canonicalProof?.accepted === true ? "completed" : "verifying"
    : params.acceptance.outcome === "INTERRUPTED"
      ? "needs_replan"
      : "failed";
  const operatorOwned = goal.status === "blocked" || goal.status === "cancelled";
  const goalChanged = !operatorOwned && goal.status !== nextGoalStatus;
  if (goalChanged) {
    await tx.update(aiGoalsTable)
      .set({
        status: nextGoalStatus,
        completedAt: nextGoalStatus === "completed" ? goal.completedAt ?? params.now : null,
        blockedReason: nextGoalStatus === "completed" ? null : "Final workflow phase did not complete.",
        updatedAt: params.now,
      })
      .where(eq(aiGoalsTable.id, goal.id));
    await tx.insert(eventsTable).values({
      id: randomUUID(),
      type: "AiGoalStatusSynced",
      projectId: params.projectId,
      goalId: goal.id,
      severity: nextGoalStatus === "completed" ? "success" : "warning",
      message: `AI goal "${goal.title}" → ${nextGoalStatus}`,
      correlationId: params.projection.correlationId ?? undefined,
      payload: {
        executionId: params.executionId,
        workflowId: params.projection.workflowId,
        workflowExecutionId: params.projection.workflowExecutionId,
        phase: params.projection.phase,
        finalPhase: true,
        outcome: params.acceptance.outcome,
        acceptanceId: params.acceptance.id,
      },
    });
  }

  const goals = await tx
    .select({
      id: aiGoalsTable.id,
      status: aiGoalsTable.status,
      successCriteria: aiGoalsTable.successCriteria,
      outcomeContract: aiGoalsTable.outcomeContract,
    })
    .from(aiGoalsTable)
    .where(and(
      eq(aiGoalsTable.missionId, goal.missionId),
      eq(aiGoalsTable.projectId, params.projectId),
    ))
    .for("update");
  const [mission] = await tx
    .select()
    .from(aiMissionsTable)
    .where(and(
      eq(aiMissionsTable.id, goal.missionId),
      eq(aiMissionsTable.projectId, params.projectId),
    ))
    .for("update");
  if (!mission) return;
  const missionOperatorOwned =
    mission.status === "blocked"
    || mission.status === "cancelled"
    || mission.status === "completed";
  const nextMissionStatus = deriveMissionStatusFromGoals(
    selectActiveMissionGoals({ mission, goals }).map((item) =>
      item.id === goal.id && goalChanged ? nextGoalStatus : item.status,
    ),
  );
  if (missionOperatorOwned || mission.status === nextMissionStatus) return;

  await tx.update(aiMissionsTable)
    .set({
      status: nextMissionStatus,
      completedAt: nextMissionStatus === "completed" ? mission.completedAt ?? params.now : null,
      updatedAt: params.now,
    })
    .where(eq(aiMissionsTable.id, mission.id));
  await tx.insert(eventsTable).values({
    id: randomUUID(),
    type: "AiMissionStatusSynced",
    projectId: params.projectId,
    goalId: goal.id,
    severity: nextMissionStatus === "completed" ? "success" : "warning",
    message: `AI mission "${mission.title}" → ${nextMissionStatus}`,
    correlationId: params.projection.correlationId ?? undefined,
    payload: {
      executionId: params.executionId,
      workflowId: params.projection.workflowId,
      workflowExecutionId: params.projection.workflowExecutionId,
      phase: params.projection.phase,
      goalId: goal.id,
      acceptanceId: params.acceptance.id,
      status: nextMissionStatus,
    },
  });
}

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
  const rawTaskObjective = raw.taskObjective;
  const taskObjective = rawTaskObjective && typeof rawTaskObjective === "object"
    ? rawTaskObjective as Record<string, unknown>
    : undefined;
  const taskObjectiveKind = typeof taskObjective?.kind === "string"
    ? taskObjective.kind.slice(0, 80)
    : undefined;
  const taskObjectiveValidatorIds = Array.isArray(taskObjective?.validatorIds)
    ? taskObjective.validatorIds
      .filter((value): value is string => typeof value === "string")
      .slice(0, 8)
    : undefined;
  const taskObjectiveStatus = taskObjective?.status === "PROVEN"
    || taskObjective?.status === "INCOMPLETE"
    || taskObjective?.status === "UNAVAILABLE"
    ? taskObjective.status
    : undefined;
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
    ...(taskObjectiveKind && taskObjectiveValidatorIds && taskObjectiveStatus
      ? {
          taskObjective: {
            kind: taskObjectiveKind,
            validatorIds: taskObjectiveValidatorIds,
            status: taskObjectiveStatus,
          },
        }
      : {}),
    ...(parseExecutionProofProjection(raw.proof)
      ? { proof: parseExecutionProofProjection(raw.proof) }
      : {}),
  };
}

type AcceptanceProjectionRow =
  Omit<typeof aiExecutionAcceptancesTable.$inferSelect, "effectBundleId">
  & { effectBundleId?: string | null };

export function projectExecutionAcceptance(
  row: AcceptanceProjectionRow | undefined,
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

function byteLength(value: string): number {
  return Buffer.byteLength(value, "utf8");
}

export function normalizeEvidenceSnapshot(input: EvidenceSnapshotInput | undefined): NormalizedEvidenceSnapshot {
  const reads = (input?.reads ?? []).map((read) => {
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
  const artifacts: EvidenceArtifactInput[] = (input?.artifacts ?? []).flatMap(
    (artifact): EvidenceArtifactInput[] => {
    if (
      (artifact.kind !== "png" && artifact.kind !== "pdf")
      || !/^binary-evidence:[a-f0-9]{64}$/i.test(artifact.evidenceId)
      || !/^binary-artifact:[a-f0-9]{64}$/i.test(artifact.artifactRef)
      || !/^[a-f0-9]{64}$/i.test(artifact.sha256)
      || typeof artifact.path !== "string"
      || artifact.path.startsWith("/")
      || artifact.path.split("/").includes("..")
      || typeof artifact.operationId !== "string"
      || typeof artifact.workspaceRevision !== "string"
      || !Number.isSafeInteger(artifact.sizeBytes)
      || artifact.sizeBytes <= 0
      || artifact.kind === "png" && (
        !Number.isSafeInteger(artifact.width)
        || artifact.width <= 0
        || !Number.isSafeInteger(artifact.height)
        || artifact.height <= 0
      )
      || artifact.kind === "pdf" && (
        !Number.isSafeInteger(artifact.pageCount)
        || artifact.pageCount < 0
      )
    ) return [];
    const common = {
      evidenceId: artifact.evidenceId.slice(0, 120),
      artifactRef: artifact.artifactRef.slice(0, 120),
      path: artifact.path.slice(0, 500),
      operationId: artifact.operationId.slice(0, 160),
      workspaceRevision: artifact.workspaceRevision.slice(0, 500),
      sha256: artifact.sha256.toLowerCase(),
      sizeBytes: artifact.sizeBytes,
    };
    return artifact.kind === "png"
      ? [{ kind: "png" as const, ...common, width: artifact.width, height: artifact.height }]
      : [{ kind: "pdf" as const, ...common, pageCount: artifact.pageCount }];
    },
  ).slice(0, 16);
  const artifactsComplete = artifacts.length > 0;
  const required = input?.sourceEvidenceRequired ?? input?.required === true;
  const sourceEvidenceRequired = input?.sourceEvidenceRequired ?? required;
  const readsComplete = (
    reads.length > 0
    && totalBytes <= MAX_SNAPSHOT_BYTES
    && reads.every((read) => read.complete && !read.truncated)
  );
  const suppliedVerdict = typeof input?.verdict === "string" && input.verdict.trim()
    ? input.verdict.slice(0, 40)
    : undefined;
  const verdict = suppliedVerdict ?? (readsComplete || artifactsComplete ? "PROVEN" : "NOT_RECORDED");
  const verdictBlocksCompletion =
    verdict === "UNAVAILABLE"
    || (sourceEvidenceRequired && verdict !== "PROVEN");
  const complete = Boolean(!verdictBlocksCompletion && (!required || (
    !sourceEvidenceRequired
      ? verdict !== "NOT_RECORDED"
      : readsComplete && verdict !== "NOT_RECORDED" && verdict !== "UNAVAILABLE"
  )));
  return {
    complete,
    verdict,
    reads,
    artifacts,
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
  if (params.reasonCode === "MODEL_OUTPUT_INVALID") return "RETRY_AFTER_PARSE";
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
    if (params.expectedExecutionState) {
      const expected = params.expectedExecutionState;
      if (
        execution.status !== expected.status
        || execution.workerId !== expected.workerId
        || (execution.leaseUntil?.getTime() ?? null) !== (expected.leaseUntil?.getTime() ?? null)
      ) {
        return {
          accepted: false,
          duplicate: false,
          reason: "The reconciler snapshot is stale.",
        };
      }
    }
    if (execution.attempt !== params.expectedAttempt) {
      return {
        accepted: false,
        duplicate: false,
        reason: "The execution attempt is stale.",
      };
    }

    const storedRequest = parseStoredExecutionRequest(execution.request);
    const [proposal] = execution.proposalId
      ? await tx
        .select({
          candidateTreeHash: aiChangeProposalsTable.candidateTreeHash,
          promotedTreeHash: aiChangeProposalsTable.promotedTreeHash,
          committedTreeHash: aiChangeProposalsTable.committedTreeHash,
        })
        .from(aiChangeProposalsTable)
        .where(and(
          eq(aiChangeProposalsTable.id, execution.proposalId),
          eq(aiChangeProposalsTable.projectId, execution.projectId),
        ))
        .limit(1)
      : [];
    const taskObjective = params.taskObjective
      ?? parseTaskObjectiveContract(storedRequest?.taskObjective);
    const storedProofRequired = storedRequest?.proofRequired === true;
    const effectRequired =
      params.effectRequired === true
      || storedRequest?.effectRequired === true
      || Boolean(params.effectBundleId);
    const evidenceRequired = storedProofRequired || params.evidence?.required === true;
    const reviewReadyProposal =
      params.outcome === "SUCCEEDED"
      && typeof params.proposalId === "string"
      && params.proposalId.length > 0;
    const expectedRevision = typeof storedRequest?.workspaceRevision === "string"
      ? storedRequest.workspaceRevision
      : execution.baseRevision ?? null;
    const expectedRoot = execution.workspaceRoot ?? null;
    const revisionWasSupplied =
      params.evidence?.sourceRevision !== undefined
      || params.sourceRevision !== undefined;
    const rootWasSupplied =
      params.evidence?.workspaceRoot !== undefined
      || params.workspaceRoot !== undefined;
    const suppliedRevision = params.evidence?.sourceRevision
      ?? params.sourceRevision
      ?? expectedRevision;
    const suppliedRoot = params.evidence?.workspaceRoot
      ?? params.workspaceRoot
      ?? expectedRoot;
    const canonicalSourceRevision = params.sourceRevision
      ?? (typeof storedRequest?.workspaceRevision === "string"
        ? storedRequest.workspaceRevision
        : execution.baseRevision ?? null);
    const canonicalCandidateIdentity = params.candidateIdentity
      ?? params.evidence?.candidateIdentity
      ?? null;
    const canonicalDeliveryReceipt = buildCanonicalRecipeReceipt({
      value: params.recipeReceipt,
      execution,
      sourceRevision: canonicalSourceRevision,
      proposal,
    });
    if (
      evidenceRequired
      && (
        (revisionWasSupplied && suppliedRevision !== expectedRevision)
        || (rootWasSupplied && suppliedRoot !== expectedRoot)
        || (
          params.outcome === "SUCCEEDED"
          && !reviewReadyProposal
          && (expectedRevision === null || expectedRoot === null)
        )
      )
    ) {
      return {
        accepted: false,
        duplicate: false,
        reason: "EXECUTION_PROVENANCE_MISMATCH: evidence root or revision does not match the durable execution.",
      };
    }
    const sourceEvidenceRequired = params.evidence?.sourceEvidenceRequired
      ?? evidenceRequired;
    const effectiveEvidence = evidenceRequired
      ? {
          ...(params.evidence ?? {}),
          required: true,
          sourceEvidenceRequired,
          operationId: params.evidence?.operationId ?? execution.operationId,
           workspaceRoot: suppliedRoot,
           sourceRevision: suppliedRevision,
          verdict: params.evidence?.verdict ?? "NOT_RECORDED",
          reads: params.evidence?.reads ?? [],
        } satisfies EvidenceSnapshotInput
      : params.evidence;
    const evidence = normalizeEvidenceSnapshot(effectiveEvidence);
    if (params.outcome === "SUCCEEDED" && evidenceRequired && !evidence.complete && !reviewReadyProposal) {
      return { accepted: false, duplicate: false, reason: evidence.reason ?? "Evidence is incomplete." };
    }

    let effectBundleId = params.effectBundleId ?? null;
    if (effectRequired || effectBundleId) {
      const [effectBundle] = effectBundleId
        ? await tx.select()
          .from(aiAgentEffectBundlesTable)
          .where(and(
            eq(aiAgentEffectBundlesTable.id, effectBundleId),
            eq(aiAgentEffectBundlesTable.projectId, execution.projectId),
            eq(aiAgentEffectBundlesTable.executionId, execution.id),
            eq(aiAgentEffectBundlesTable.attempt, execution.attempt),
          ))
          .limit(1)
        : await tx.select()
          .from(aiAgentEffectBundlesTable)
          .where(and(
            eq(aiAgentEffectBundlesTable.projectId, execution.projectId),
            eq(aiAgentEffectBundlesTable.executionId, execution.id),
            eq(aiAgentEffectBundlesTable.attempt, execution.attempt),
          ))
          .limit(1);
      effectBundleId = effectBundle?.id ?? null;
      if (params.outcome === "SUCCEEDED" && effectRequired) {
        if (!effectBundleId || !effectBundle) {
          return { accepted: false, duplicate: false, reason: "Mutation effect evidence is missing." };
        }
        const effectIds = Array.isArray(effectBundle.effectIds)
          ? effectBundle.effectIds.filter((value): value is string => typeof value === "string")
          : [];
        const effects = effectIds.length > 0
          ? await tx.select()
            .from(aiAgentEffectsTable)
            .where(inArray(aiAgentEffectsTable.id, effectIds))
          : [];
        if (
          effects.length !== effectIds.length
          || effects.length === 0
          || !effects.every((effect) => effect.status === "observed")
        ) {
          return {
            accepted: false,
            duplicate: false,
            reason: "Mutation effect evidence is not observed; PROVEN is unavailable.",
          };
        }
      }
    }

    const now = new Date();
    const [existingByKey] = await tx
      .select()
      .from(aiExecutionAcceptancesTable)
      .where(eq(aiExecutionAcceptancesTable.finalizationKey, params.finalizationKey))
      .limit(1);
    if (existingByKey) {
      if (
        existingByKey.executionId !== params.executionId
        || existingByKey.attempt !== execution.attempt
      ) {
        return {
          accepted: false,
          duplicate: false,
          reason: "Finalization key belongs to another execution attempt.",
        };
      }
      return { accepted: true, duplicate: true, acceptance: existingByKey };
    }

    const [existing] = await tx
      .select()
      .from(aiExecutionAcceptancesTable)
      .where(and(
        eq(aiExecutionAcceptancesTable.executionId, params.executionId),
        eq(aiExecutionAcceptancesTable.attempt, execution.attempt),
      ))
      .limit(1);
    let replaceExistingLeasePause = false;
    if (existing) {
      const replaceExistingInterruption =
        params.replaceExistingInterruption === true
        && params.outcome === "INTERRUPTED"
        && (params.reasonCode === "EXECUTION_CANCELLED"
          || params.reasonCode === "EXECUTION_ABANDONED")
          && (
            execution.status === "queued"
            || execution.status === "paused"
            || execution.status === "cancelling"
          )
        && !params.taskFinalization;
      if (!replaceExistingInterruption) {
        const reclaimOwnsLiveLease = Boolean(
          params.workerId
          && execution.status === "running"
          && execution.workerId === params.workerId
          && execution.leaseUntil
          && execution.leaseUntil > now
          && existing.outcome === "FAILED"
          && existing.reasonCode === "EXECUTION_LEASE_EXPIRED"
          && existing.terminalStatus === "paused",
        );
        if (!reclaimOwnsLiveLease) {
          return { accepted: true, duplicate: true, acceptance: existing };
        }
        replaceExistingLeasePause = true;
      }
      if (replaceExistingInterruption) {
        const now = new Date();
        const cancellationDisposition = {
          ...(existing.disposition && typeof existing.disposition === "object"
            ? existing.disposition as Record<string, unknown>
            : {}),
          reasonCodes: [params.reasonCode],
          outcome: "INTERRUPTED" as const,
          recoveryState: "INCOMPLETE" as const,
          nextActionCode: "ABANDON_EXECUTION" as const,
          operatorAction: "ABANDON_EXECUTION",
          proof: buildExecutionProofProjection({
            outcome: "INTERRUPTED",
            evidenceRequired: existing.evidenceRequired === 1,
            evidenceComplete: existing.evidenceComplete === 1,
            evidenceSnapshotId: existing.evidenceSnapshotId,
            sourceRevision: existing.sourceRevision,
            candidateIdentity: existing.candidateIdentity,
            recipeReceipt: params.recipeReceipt,
          }),
        };
        const [cancelledAcceptance] = await tx
          .update(aiExecutionAcceptancesTable)
          .set({
            terminalStatus: "cancelled",
            outcome: "INTERRUPTED",
            reasonCode: params.reasonCode,
            nextActionCode: "ABANDON_EXECUTION",
            disposition: cancellationDisposition,
            resumable: 0,
            workerId: params.workerId ?? existing.workerId,
          })
          .where(eq(aiExecutionAcceptancesTable.id, existing.id))
          .returning();
        if (!cancelledAcceptance) {
          return { accepted: false, duplicate: false, reason: "Cancellation acceptance update failed." };
        }

        if (existing.messageId) {
          await tx.update(aiChatMessagesTable)
            .set({
              outcome: "INTERRUPTED",
              errorCode: "EXECUTION_CANCELLED",
              errorMessage: safeError(params.error),
            })
            .where(and(
              eq(aiChatMessagesTable.id, existing.messageId),
              eq(aiChatMessagesTable.executionId, execution.id),
            ));
        }

        await tx.update(aiExecutionsTable)
          .set({
            status: "cancelled",
            finalMessageId: params.finalMessageId ?? execution.finalMessageId,
            ...(params.recipeReceipt !== undefined ? { recipeReceipt: params.recipeReceipt } : {}),
            error: safeError(params.error),
            completedAt: now,
            updatedAt: now,
            workerId: null,
            leaseUntil: null,
            lastHeartbeatAt: null,
            cancelRequestedAt: null,
            checkpoint: params.checkpoint ?? execution.checkpoint,
            checkpointVersion: execution.checkpointVersion + 1,
          })
          .where(eq(aiExecutionsTable.id, execution.id));

        return { accepted: true, duplicate: false, acceptance: cancelledAcceptance };
      }
    }

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
    if (
      params.outcome !== "SUCCEEDED"
      && execution.status === "running"
      && !params.workerId
      && !params.expectedExecutionState
    ) {
      return {
        accepted: false,
        duplicate: false,
        reason: "A running execution requires worker ownership for terminal failure.",
      };
    }
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
        artifactRefs: evidence.artifacts,
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

    let acceptedMessageId = params.finalMessageId ?? existing?.messageId ?? null;
    if (acceptedMessageId) {
      const [message] = await tx
        .select({
          id: aiChatMessagesTable.id,
          executionId: aiChatMessagesTable.executionId,
          sessionId: aiChatMessagesTable.sessionId,
        })
        .from(aiChatMessagesTable)
        .where(eq(aiChatMessagesTable.id, acceptedMessageId))
        .limit(1);
      if (!message) {
        acceptedMessageId = existing?.messageId ?? null;
      } else if (
        message.executionId !== execution.id
        || message.sessionId !== execution.sessionId
      ) {
        return {
          accepted: false,
          duplicate: false,
          reason: "Final message does not belong to the execution session.",
        };
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
      ...(taskObjective
        ? {
            taskObjective: {
              kind: taskObjective.kind,
              validatorIds: taskObjective.validatorIds,
              status: params.taskObjectiveStatus
                ?? (params.outcome === "SUCCEEDED" ? "PROVEN" : "INCOMPLETE"),
            },
          }
        : {}),
      ...(params.retryAfterMs !== undefined ? { retryAfterMs: params.retryAfterMs } : {}),
      ...(params.retryAt ? { retryAt: params.retryAt } : {}),
      proof: buildExecutionProofProjection({
        outcome,
        evidenceRequired,
        evidenceComplete: evidence.complete,
        evidenceSnapshotId,
        sourceRevision: canonicalSourceRevision,
        candidateIdentity: canonicalCandidateIdentity,
        recipeReceipt: canonicalDeliveryReceipt,
      }),
    };
    const acceptanceValues = {
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
      messageId: acceptedMessageId,
       ...(effectBundleId ? { effectBundleId } : {}),
       sourceRevision: canonicalSourceRevision,
       candidateIdentity: canonicalCandidateIdentity,
    };
    const [acceptance] = replaceExistingLeasePause && existing
      ? await tx.update(aiExecutionAcceptancesTable)
          .set(acceptanceValues)
          .where(eq(aiExecutionAcceptancesTable.id, existing.id))
          .returning()
      : await tx.insert(aiExecutionAcceptancesTable).values({
          id: acceptanceId,
          executionId: execution.id,
          projectId: execution.projectId,
          attempt: execution.attempt,
          ...acceptanceValues,
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
        .where(and(
          eq(aiChatMessagesTable.id, params.finalMessageId),
          eq(aiChatMessagesTable.executionId, execution.id),
        ));
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
      await syncLinkedObjectiveState(tx, {
        task,
        taskStatus: updatedTask.status,
        outcome,
        retryable: params.resumable === true,
        executionId: execution.id,
        operationId: execution.operationId,
        correlationId,
        now,
        acceptanceProjection: {
          acceptanceId: acceptance.id,
          executionId: execution.id,
          outcome: acceptance.outcome as GoalAcceptanceProjection["outcome"],
          verdict: acceptance.outcome === "SUCCEEDED"
            ? (acceptance.evidenceComplete === 1 ? "PROVEN" : "INCOMPLETE")
            : "FAILED",
          evidenceSnapshotId: acceptance.evidenceSnapshotId,
          evidenceRequired: acceptance.evidenceRequired === 1,
          evidenceComplete: acceptance.evidenceComplete === 1,
          sourceRevision: acceptance.sourceRevision,
          candidateIdentity: acceptance.candidateIdentity,
          scope: {
            projectId: execution.projectId,
            candidateIdentity: acceptance.candidateIdentity,
          },
          acceptedRefs: acceptance.evidenceSnapshotId ? [acceptance.evidenceSnapshotId] : [],
          validatorIds: taskObjective?.validatorIds ?? [],
          ...(params.stateProjection ? { stateProjection: params.stateProjection } : {}),
          receipt: {
            kind: "execution_acceptance",
            id: acceptance.id,
            executionId: execution.id,
            status: acceptance.terminalStatus,
          },
          deliveryReceipt: canonicalDeliveryReceipt
            ?? (params.taskObjectiveStatus === "PROVEN"
              && taskObjective?.validatorIds?.some((id) =>
                id === "deployment-receipt.v1" || id === "integration-receipt.v1")
              ? { kind: "validator", status: "PROVEN" }
              : null),
          reasonCode: acceptance.reasonCode,
          nextActionCode: acceptance.nextActionCode,
          updatedAt: now,
        },
      });
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
    if (params.goalProjection) {
      await syncWorkflowGoalProjection(tx, {
        projection: params.goalProjection,
        projectId: execution.projectId,
        executionId: execution.id,
        acceptance,
        now,
      });
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
        cancelRequestedAt: null,
        checkpoint,
        checkpointVersion: execution.checkpointVersion + 1,
      })
      .where(and(eq(aiExecutionsTable.id, execution.id), finalMessageFence));

    return { accepted: true, duplicate: false, acceptance };
  });
}