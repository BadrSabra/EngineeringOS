import { createHash, randomUUID } from "node:crypto";
import { posix as posixPath } from "node:path";
import { and, eq, inArray } from "drizzle-orm";
import {
  db,
  aiGoalsTable,
  projectsTable,
  taskLogsTable,
  tasksTable,
} from "@workspace/db";
import {
  buildProjectContext,
  executeTask,
  invalidateContextCache,
  PROVIDER_REGISTRY,
  type AgentStep,
  type AgentLoopClaimState,
  type AgentLoopToolCall,
  type PendingChange,
  type ValidationProfile,
} from "@workspace/ai-orchestrator";
import {
  createAiExecution,
  getAiExecutionForUser,
  checkpointAiExecution,
  claimAiExecution,
  failAiExecution,
  heartbeatAiExecution,
  AI_EXECUTION_LEASE_MS,
  buildAiExecutionResumeContext,
  parseAiExecutionCheckpoint,
  registerAiExecutionController,
  unregisterAiExecutionController,
} from "./ai-execution-state.js";
import {
  finalizeExecutionAcceptance,
  type EvidenceSnapshotInput,
  type TaskExecutionFinalization,
} from "./ai-execution-acceptance.js";
import {
  buildTaskObjectiveContract,
  validateTaskObjectiveContract,
  type TaskObjectiveContract,
  type TaskObjectiveValidatorReceipt,
} from "./task-objective-contract.js";
import {
  chatWithFallback,
  redactUserFacingText,
  runAgentWithFallback,
} from "./ai-route-helpers.js";
import type { ProviderId } from "./ai-route-helpers.js";
import { logger } from "./logger.js";
import { taskTransitionConflict, type TaskStatus } from "./task-state.js";
import {
  buildRuleVerificationChecks,
  markRemediationPlanVerified,
} from "./remediation-plan.js";
import { createTaskProgressEmitter } from "./task-progress.js";
import { establishProjectRoot } from "./project-root.js";
import {
  isMissionToolLoopProfile,
  missionObjectiveContract,
  readMissionExecutionProfile,
  type MissionExecutionProfile,
} from "./mission-execution-profile.js";
import { parseBinaryEvidencePacket } from "@workspace/ai-orchestrator";
import {
  runRepairValidation,
  createValidationWorkspace,
  validateRepairValidationScope,
} from "./ai-repair-validation.js";
import type { ExecutionDelegationBudget } from "./execution-lineage.js";
import {
  appendEpisodeEvent,
  startEpisode,
  startEpisodeShadow,
} from "./agent-state/agent-episode-ledger.js";
import { serverEnvironmentProfile } from "./agent-state/environment-attestation.js";
import { materializeServerOwnedObservations } from "./agent-state/observation-materializer.js";
import { verifyAndPersistEffect } from "./agent-state/effect-observer.js";
import {
  buildMissionRepairAction,
  buildMissionRepairEffectContract,
} from "./agent-state/mission-repair-effect.js";
import { hashDeliveryTree } from "./delivery-workspace.js";

const CONTEXT_SECTIONS = ["tasks", "metrics", "graphEntities", "graphRelationships", "events"] as const;

function pendingPlanVerificationSteps(plan: typeof tasksTable.$inferSelect["remediationPlan"]) {
  if (!plan) return [];
  const checks = plan.verificationChecks?.length
    ? plan.verificationChecks
    : buildRuleVerificationChecks(plan.verificationSteps ?? []);
  return checks.map((check) => ({
    id: check.id,
    name: `Rule verification ${check.id.replace("rule-verification-", "#")}`,
    kind: check.kind,
    guidance: check.guidance,
    passed: false,
    output: "Not recorded — operator evidence is required",
  }));
}

export type TaskExecutionTrigger = "manual" | "automatic" | "reconciliation";
export type TaskExecutionOutcome = {
  ok: boolean;
  status: "completed" | "verifying" | "failed" | "conflict";
  task?: typeof tasksTable.$inferSelect;
  executionId?: string;
  errorCode?: string;
  parseCode?: string;
  error?: unknown;
};

type Provider = { provider: ProviderId; apiKey: string };

const RECEIPT_MAX_BYTES = 8_000;
const RECEIPT_MAX_STAGES = 12;
const RECEIPT_MAX_STEPS = 24;
const RECEIPT_MAX_TEXT = 480;

export type AiTaskExecutionReceipt = {
  kind: "AI_TASK_EXECUTION_RECEIPT";
  operationId: string;
  correlationId: string;
  revision: string | null;
  provider: ProviderId;
  model: string;
  attempt: number;
  attempts: number;
  durationMs: number;
  stages: string[];
  terminalStatus: "SUCCEEDED" | "BLOCKED" | "FAILED" | "CANCELLED";
  terminalReason: string;
  summary?: string;
  confidence?: string;
  steps?: string[];
  evidenceRefs: string[];
  executionProfile?: MissionExecutionProfile;
  stateProjection?: MissionStateProjection;
  failureClass?: AiTaskFailureClass;
  retryable?: boolean;
};

export type MissionStateProjection = {
  knownFacts: string[];
  hypotheses: string[];
  unknowns: string[];
  contradictions: string[];
  observations: string[];
  actions: string[];
  effects: string[];
  proofObligations: string[];
  sourceRevision?: string;
  candidateRevision?: string;
  nextAction?: string;
};

export type AiTaskFailureClass =
  | "checkpoint"
  | "context"
  | "provider"
  | "malformed_output"
  | "quality_gate"
  | "tool"
  | "validation"
  | "revision_conflict"
  | "permission"
  | "objective_incomplete"
  | "ownership"
  | "internal";

function safeText(value: unknown, max = RECEIPT_MAX_TEXT): string {
  return redactUserFacingText(String(value ?? ""))
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, max);
}

function boundedReceipt(receiptValue: AiTaskExecutionReceipt): AiTaskExecutionReceipt {
  const bounded = {
    ...receiptValue,
    stages: receiptValue.stages.slice(0, RECEIPT_MAX_STAGES).map((stage) => safeText(stage, 80)),
    evidenceRefs: receiptValue.evidenceRefs.slice(0, 8).map((ref) => safeText(ref, 120)),
    ...(receiptValue.summary ? { summary: safeText(receiptValue.summary, 2_000) } : {}),
    ...(receiptValue.steps ? { steps: receiptValue.steps.slice(0, RECEIPT_MAX_STEPS).map((step) => safeText(step)) } : {}),
    ...(receiptValue.stateProjection ? {
      stateProjection: {
        knownFacts: receiptValue.stateProjection.knownFacts.slice(0, 24).map((item) => safeText(item, 180)),
        hypotheses: receiptValue.stateProjection.hypotheses.slice(0, 12).map((item) => safeText(item, 240)),
        unknowns: receiptValue.stateProjection.unknowns.slice(0, 24).map((item) => safeText(item, 240)),
        contradictions: receiptValue.stateProjection.contradictions.slice(0, 12).map((item) => safeText(item, 240)),
        observations: receiptValue.stateProjection.observations.slice(0, 12).map((item) => safeText(item, 240)),
        actions: receiptValue.stateProjection.actions.slice(0, 12).map((item) => safeText(item, 240)),
        effects: receiptValue.stateProjection.effects.slice(0, 24).map((item) => safeText(item, 240)),
        proofObligations: receiptValue.stateProjection.proofObligations.slice(0, 24).map((item) => safeText(item, 240)),
        ...(receiptValue.stateProjection.sourceRevision
          ? { sourceRevision: safeText(receiptValue.stateProjection.sourceRevision, 240) }
          : {}),
        ...(receiptValue.stateProjection.candidateRevision
          ? { candidateRevision: safeText(receiptValue.stateProjection.candidateRevision, 240) }
          : {}),
        ...(receiptValue.stateProjection.nextAction
          ? { nextAction: safeText(receiptValue.stateProjection.nextAction, 240) }
          : {}),
      },
    } : {}),
    terminalReason: safeText(receiptValue.terminalReason, 240),
  };
  // Keep this envelope bounded even if future fields are added to the contract.
  const serialized = JSON.stringify(bounded);
  return serialized.length <= RECEIPT_MAX_BYTES
    ? bounded
    : {
        ...bounded,
        summary: bounded.summary?.slice(0, 240),
        steps: bounded.steps?.slice(0, 8),
        ...(bounded.stateProjection ? {
          stateProjection: {
            ...bounded.stateProjection,
            knownFacts: bounded.stateProjection.knownFacts.slice(0, 8),
            hypotheses: bounded.stateProjection.hypotheses.slice(0, 4),
            unknowns: bounded.stateProjection.unknowns.slice(0, 8),
            contradictions: bounded.stateProjection.contradictions.slice(0, 4),
            observations: bounded.stateProjection.observations.slice(0, 4),
            actions: bounded.stateProjection.actions.slice(0, 4),
            effects: bounded.stateProjection.effects.slice(0, 8),
            proofObligations: bounded.stateProjection.proofObligations.slice(0, 8),
          },
        } : {}),
      };
}

export function buildAiTaskExecutionReceipt(params: {
  executionId: string;
  correlationId: string;
  revision?: string;
  provider: ProviderId;
  attempt: number;
  durationMs: number;
  stages: string[];
  attempts?: number;
  result: Awaited<ReturnType<typeof executeTask>>;
  executionProfile?: MissionExecutionProfile;
  evidenceRefs?: string[];
  stateProjection?: MissionStateProjection;
}): AiTaskExecutionReceipt {
  return boundedReceipt({
    kind: "AI_TASK_EXECUTION_RECEIPT",
    operationId: params.executionId,
    correlationId: params.correlationId,
    revision: params.revision ?? null,
    provider: params.provider,
    model: PROVIDER_REGISTRY[params.provider]?.defaultModels.powerful ?? "provider-default",
    attempt: params.attempt,
    attempts: Math.max(1, Math.min(params.attempts ?? 1, 8)),
    durationMs: Math.max(0, Math.min(Math.round(params.durationMs), 86_400_000)),
    stages: params.stages,
    terminalStatus: params.result.needsHumanReview ? "BLOCKED" : "SUCCEEDED",
    terminalReason: params.result.needsHumanReview ? "human_review_required" : "structured_result_verified",
    summary: params.result.summary,
    confidence: safeText(params.result.confidence, 40),
    steps: params.result.steps.map((step) => String(step)),
    evidenceRefs: params.evidenceRefs ?? [],
    ...(params.executionProfile ? { executionProfile: params.executionProfile } : {}),
    ...(params.stateProjection ? { stateProjection: params.stateProjection } : {}),
  });
}

function failureReceipt(params: {
  executionId: string;
  correlationId: string;
  revision?: string;
  provider: ProviderId;
  attempt: number;
  durationMs: number;
  stages: string[];
  code: string;
  failureClass: AiTaskFailureClass;
  retryable: boolean;
  cancelled?: boolean;
  executionProfile?: MissionExecutionProfile;
}): AiTaskExecutionReceipt {
  const cancelled = Boolean(params.cancelled);
  return boundedReceipt({
    kind: "AI_TASK_EXECUTION_RECEIPT",
    operationId: params.executionId,
    correlationId: params.correlationId,
    revision: params.revision ?? null,
    provider: params.provider,
    model: PROVIDER_REGISTRY[params.provider]?.defaultModels.powerful ?? "provider-default",
    attempt: params.attempt,
    attempts: 1,
    durationMs: Math.max(0, Math.min(Math.round(params.durationMs), 86_400_000)),
    stages: params.stages,
    terminalStatus: cancelled ? "CANCELLED" : "FAILED",
    terminalReason: safeText(params.code, 120),
    evidenceRefs: [],
    ...(params.executionProfile ? { executionProfile: params.executionProfile } : {}),
    failureClass: params.failureClass,
    retryable: params.retryable,
  });
}

export function classifyTaskExecutionFailure(params: {
  stage: string;
  cancelled: boolean;
}): {
  code: string;
  failureClass: AiTaskFailureClass;
  reasonCode: string;
  retryable: boolean;
} {
  if (params.cancelled) {
    return {
      code: "cancelled",
      failureClass: "internal",
      reasonCode: "EXECUTION_CANCELLED",
      retryable: false,
    };
  }
  if (params.stage === "context") {
    return {
      code: "context_build_failed",
      failureClass: "context",
      reasonCode: "CONTEXT_BUILD_FAILED",
      retryable: true,
    };
  }
  if (params.stage === "provider_call" || params.stage === "provider_fallback") {
    return {
      code: "provider_call_failed",
      failureClass: "provider",
      reasonCode: "EXECUTION_PROVIDER_FAILURE",
      retryable: true,
    };
  }
  if (params.stage === "finalize") {
    return {
      code: "execution_finalize_failed",
      failureClass: "ownership",
      reasonCode: "EXECUTION_FINALIZATION_FAILED",
      retryable: true,
    };
  }
  return {
    code: "task_execution_failed",
    failureClass: "internal",
    reasonCode: "EXECUTION_FAILED",
    retryable: true,
  };
}

function taskVerificationResult(params: {
  receipt: AiTaskExecutionReceipt;
  remediationPlan: typeof tasksTable.$inferSelect["remediationPlan"];
}) {
  const passed = params.receipt.terminalStatus === "SUCCEEDED" && !params.remediationPlan;
  const incomplete = Boolean(params.remediationPlan) || params.receipt.terminalStatus === "BLOCKED";
  return {
    passed,
    decision: incomplete
      ? ("incomplete" as const)
      : passed
        ? ("verified" as const)
        : params.receipt.terminalStatus === "CANCELLED"
          ? ("cancelled" as const)
          : ("failed" as const),
    steps: [
      ...(params.receipt.steps ?? []).map((name) => ({
        name,
        ...(!params.remediationPlan ? { kind: "automatic" as const } : {}),
        passed,
      })),
      ...(params.remediationPlan ? pendingPlanVerificationSteps(params.remediationPlan) : []),
    ],
  };
}

async function finalizeTaskExecutionAcceptance(params: {
  executionId: string;
  workerId: string;
  task: typeof tasksTable.$inferSelect;
  receipt: AiTaskExecutionReceipt;
  outcome: "SUCCEEDED" | "FAILED" | "INTERRUPTED";
  terminalStatus: "completed" | "failed" | "cancelled";
  reasonCode: string;
  retryable: boolean;
  trigger: TaskExecutionTrigger;
  finalStatus: "pending" | "queued" | "verifying" | "completed" | "failed" | "cancelled";
  error?: string | null;
  logLevel: "info" | "warn" | "error";
  logMessage: string;
  logMetadata?: Record<string, unknown>;
  taskObjective?: TaskObjectiveContract;
  taskObjectiveStatus?: "PROVEN" | "INCOMPLETE" | "UNAVAILABLE";
  evidence?: EvidenceSnapshotInput;
  workspaceRoot?: string | null;
  candidateIdentity?: string | null;
  effectRequired?: boolean;
  effectBundleId?: string | null;
}): Promise<{ accepted: boolean; duplicate: boolean }> {
  const taskFinalization: TaskExecutionFinalization = {
    taskId: params.task.id,
    workerId: params.workerId,
    status: params.finalStatus,
    agentResponse: JSON.stringify(params.receipt),
    remediationPlan: markRemediationPlanVerified(
      params.task.remediationPlan,
      false,
    ),
    verificationResult: taskVerificationResult({
      receipt: params.receipt,
      remediationPlan: params.task.remediationPlan,
    }),
    completedAt: params.finalStatus === "completed" ? new Date() : null,
    correlationId: params.receipt.correlationId,
    log: {
      level: params.logLevel,
      message: params.logMessage,
      metadata: params.logMetadata,
    },
    event: {
      type: params.outcome === "SUCCEEDED"
        ? params.finalStatus === "completed" ? "TaskCompleted" : "TaskVerifying"
        : params.trigger === "automatic" ? "TaskAutoExecutionFailed" : "TaskExecutionFailed",
      severity: params.outcome === "SUCCEEDED"
        ? params.finalStatus === "completed" ? "success" : "warning"
        : "error",
      message: params.outcome === "SUCCEEDED"
        ? `AI executed "${params.task.title}" → ${params.finalStatus}`
        : `AI execution of "${params.task.title}" failed`,
      payload: {
        executionId: params.executionId,
        operationId: params.executionId,
        revision: params.receipt.revision,
        provider: params.receipt.provider,
        model: params.receipt.model,
        attempt: params.receipt.attempt,
        attempts: params.receipt.attempts,
        durationMs: params.receipt.durationMs,
        terminalStatus: params.receipt.terminalStatus,
        terminalReason: params.receipt.terminalReason,
        trigger: params.trigger,
        retryable: params.retryable,
      },
    },
    audit: {
      action: params.outcome === "SUCCEEDED"
        ? params.trigger === "automatic" ? "ai_auto_executed" : "ai_executed"
        : params.trigger === "automatic" ? "ai_auto_execution_failed" : "execution_failed",
      stateBefore: { status: params.task.status },
      stateAfter: {
        status: params.finalStatus,
        executionId: params.executionId,
        operationId: params.executionId,
        revision: params.receipt.revision,
        terminalStatus: params.receipt.terminalStatus,
        terminalReason: params.receipt.terminalReason,
      },
    },
  };
  const finalized = await finalizeExecutionAcceptance({
    executionId: params.executionId,
    expectedAttempt: params.receipt.attempt,
    workerId: params.workerId,
    finalizationKey: `execution:${params.executionId}:attempt:${params.receipt.attempt}:${params.reasonCode}`,
    outcome: params.outcome,
    terminalStatus: params.terminalStatus,
    reasonCode: params.reasonCode,
    recoveryState: params.outcome === "SUCCEEDED" ? "NONE" : params.outcome === "INTERRUPTED" ? "INCOMPLETE" : "REQUIRED",
    resumable: params.retryable,
    error: params.error,
    recipeReceipt: params.receipt,
    sourceRevision: params.receipt.revision,
    workspaceRoot: params.workspaceRoot,
    candidateIdentity: params.candidateIdentity,
    evidence: params.evidence,
    taskObjective: params.taskObjective,
    taskObjectiveStatus: params.taskObjectiveStatus,
    stateProjection: params.receipt.stateProjection,
    effectRequired: params.effectRequired,
    effectBundleId: params.effectBundleId,
    taskFinalization,
  });
  if (finalized.duplicate) {
    const [projectedTask] = await db
      .select({ status: tasksTable.status, workerId: tasksTable.workerId })
      .from(tasksTable)
      .where(eq(tasksTable.id, params.task.id))
      .limit(1);
    return {
      accepted: finalized.accepted
        && projectedTask?.status === params.finalStatus
        && projectedTask.workerId === null,
      duplicate: true,
    };
  }
  return { accepted: finalized.accepted, duplicate: false };
}

type MissionToolLoopExecution = {
  result: Awaited<ReturnType<typeof executeTask>>;
  effectiveProvider: ProviderId;
  profile: Exclude<MissionExecutionProfile, "analysis" | "delivery">;
  proof: {
    taskObjective?: TaskObjectiveContract;
    status: "PROVEN" | "INCOMPLETE" | "UNAVAILABLE";
    validatorReceipts: TaskObjectiveValidatorReceipt[];
    evidence?: EvidenceSnapshotInput;
    candidateIdentity: string;
    effectRequired: boolean;
    effectBundleId?: string;
    refs: string[];
    stateProjection: MissionStateProjection;
  };
};

type MissionToolLoopCheckpoint = {
  schemaVersion: 2;
  executionProfile: Exclude<MissionExecutionProfile, "analysis" | "delivery">;
  iteration: number;
  toolCalls: number;
  noProgressStreak: number;
  claimState: AgentLoopClaimState[];
  missingEvidencePaths: string[];
  lastObservation: string;
  nextAction?: string;
  completedToolCalls: AgentLoopToolCall[];
  pendingChanges: PendingChange[];
  stateProjection?: MissionStateProjection;
};

function buildMissionStateProjection(params: {
  profile: MissionToolLoopCheckpoint["executionProfile"];
  claimState: AgentLoopClaimState[];
  missingEvidencePaths: string[];
  lastObservation: string;
  nextAction?: string;
  pendingChanges: readonly Pick<PendingChange, "path" | "newContent">[];
  sourceRevision: string;
  candidateRevision?: string;
}): MissionStateProjection {
  const provenClaims = params.claimState
    .filter((claim) => claim.status === "PROVEN")
    .map((claim) => `claim:${claim.claimId}`);
  const blockedClaims = params.claimState
    .filter((claim) => claim.status === "BLOCKED")
    .map((claim) => `claim:${claim.claimId}`);
  const pendingClaims = params.claimState
    .filter((claim) => claim.status === "PENDING")
    .map((claim) => `claim:${claim.claimId}`);
  return {
    knownFacts: provenClaims,
    hypotheses: [`execution-profile:${params.profile}`],
    unknowns: params.missingEvidencePaths.map((path) => `missing-evidence:${path}`),
    contradictions: blockedClaims,
    observations: params.lastObservation ? [params.lastObservation] : [],
    actions: params.nextAction ? [params.nextAction] : [],
    effects: params.pendingChanges.map((change) => `candidate-change:${change.path}`),
    proofObligations: pendingClaims,
    sourceRevision: params.sourceRevision,
    ...(params.candidateRevision ? { candidateRevision: params.candidateRevision } : {}),
    ...(params.nextAction ? { nextAction: params.nextAction } : {}),
  };
}

function parseMissionToolLoopCheckpoint(
  checkpoint: ReturnType<typeof parseAiExecutionCheckpoint>,
): MissionToolLoopCheckpoint | undefined {
  if (!checkpoint?.detail) return undefined;
  try {
    const value = JSON.parse(checkpoint.detail) as Partial<MissionToolLoopCheckpoint>;
    if (
      value.schemaVersion !== 2
      || typeof value.executionProfile !== "string"
      || !["mission_observe", "mission_repair", "mission_validate"].includes(value.executionProfile)
      || typeof value.iteration !== "number"
      || typeof value.toolCalls !== "number"
      || typeof value.noProgressStreak !== "number"
      || !Array.isArray(value.claimState)
      || !Array.isArray(value.completedToolCalls)
      || !Array.isArray(value.pendingChanges)
    ) return undefined;
    const claimState = value.claimState.flatMap((claim) => {
      if (!claim || typeof claim !== "object") return [];
      const candidate = claim as Partial<AgentLoopClaimState>;
      if (
        typeof candidate.claimId !== "string"
        || !["PENDING", "PROVEN", "BLOCKED"].includes(candidate.status ?? "")
        || !Array.isArray(candidate.evidenceRefs)
      ) return [];
      return [{
        claimId: candidate.claimId.slice(0, 160),
        status: candidate.status as AgentLoopClaimState["status"],
        evidenceRefs: (candidate.evidenceRefs as unknown[])
          .filter((ref): ref is string => typeof ref === "string")
          .slice(0, 12)
          .map((ref) => ref.slice(0, 500)),
        ...(Array.isArray(candidate.requiredEvidencePaths)
          ? { requiredEvidencePaths: (candidate.requiredEvidencePaths as unknown[]).filter((path): path is string => typeof path === "string").slice(0, 24) }
          : {}),
        ...(Array.isArray(candidate.missingEvidencePaths)
          ? { missingEvidencePaths: (candidate.missingEvidencePaths as unknown[]).filter((path): path is string => typeof path === "string").slice(0, 24) }
          : {}),
      }];
    });
    const completedToolCalls = value.completedToolCalls.flatMap((call) => {
      if (!call || typeof call !== "object") return [];
      const candidate = call as Partial<AgentLoopToolCall>;
      if (
        typeof candidate.key !== "string"
        || typeof candidate.tool !== "string"
        || !["started", "completed"].includes(candidate.status ?? "")
        || !candidate.args
        || typeof candidate.args !== "object"
      ) return [];
      const args = Object.fromEntries(
        Object.entries(candidate.args as Record<string, unknown>)
          .filter(([, arg]) => typeof arg === "string")
          .slice(0, 16),
      ) as Record<string, string>;
      return [{
        key: candidate.key.slice(0, 2_000),
        tool: candidate.tool.slice(0, 80),
        args,
        status: candidate.status as AgentLoopToolCall["status"],
      }];
    });
    const pendingChanges = value.pendingChanges
      .flatMap((change) => {
        const parsed = (change && typeof change === "object")
          ? change as PendingChange
          : undefined;
        return parsed && typeof parsed.path === "string" && typeof parsed.newContent === "string"
          ? [parsed]
          : [];
      })
      .slice(0, 12);
    const projectionRecord = value.stateProjection && typeof value.stateProjection === "object"
      && !Array.isArray(value.stateProjection)
      ? value.stateProjection as Partial<MissionStateProjection>
      : undefined;
    const projectionArray = (candidate: unknown, max: number): string[] =>
      Array.isArray(candidate)
        ? candidate.filter((item): item is string => typeof item === "string").slice(0, max).map((item) => item.slice(0, 240))
        : [];
    const stateProjection = projectionRecord
      ? {
          knownFacts: projectionArray(projectionRecord.knownFacts, 24),
          hypotheses: projectionArray(projectionRecord.hypotheses, 12),
          unknowns: projectionArray(projectionRecord.unknowns, 24),
          contradictions: projectionArray(projectionRecord.contradictions, 12),
          observations: projectionArray(projectionRecord.observations, 12),
          actions: projectionArray(projectionRecord.actions, 12),
          effects: projectionArray(projectionRecord.effects, 24),
          proofObligations: projectionArray(projectionRecord.proofObligations, 24),
          ...(typeof projectionRecord.sourceRevision === "string"
            ? { sourceRevision: projectionRecord.sourceRevision.slice(0, 240) }
            : {}),
          ...(typeof projectionRecord.candidateRevision === "string"
            ? { candidateRevision: projectionRecord.candidateRevision.slice(0, 240) }
            : {}),
          ...(typeof projectionRecord.nextAction === "string"
            ? { nextAction: projectionRecord.nextAction.slice(0, 240) }
            : {}),
        } satisfies MissionStateProjection
      : undefined;
    return {
      schemaVersion: 2,
      executionProfile: value.executionProfile as MissionToolLoopCheckpoint["executionProfile"],
      iteration: Math.max(0, Math.min(200, Math.trunc(value.iteration))),
      toolCalls: Math.max(0, Math.min(1_000, Math.trunc(value.toolCalls))),
      noProgressStreak: Math.max(0, Math.min(100, Math.trunc(value.noProgressStreak))),
      claimState: claimState.slice(0, 24),
      missingEvidencePaths: (Array.isArray(value.missingEvidencePaths) ? value.missingEvidencePaths : [])
        .filter((path): path is string => typeof path === "string")
        .slice(0, 24),
      lastObservation: typeof value.lastObservation === "string" ? value.lastObservation.slice(0, 240) : "",
      ...(typeof value.nextAction === "string" ? { nextAction: value.nextAction.slice(0, 240) } : {}),
      completedToolCalls: completedToolCalls.slice(-64),
      pendingChanges,
      ...(stateProjection ? { stateProjection } : {}),
    };
  } catch {
    return undefined;
  }
}

function jsonRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

export function missionPlanRevisionHash(goal: typeof aiGoalsTable.$inferSelect | undefined): string | undefined {
  const outcome = jsonRecord(goal?.outcomeContract);
  const success = jsonRecord(goal?.successCriteria);
  const revision = jsonRecord(outcome.planRevision ?? success.planRevision);
  return typeof revision.hash === "string" && revision.hash.trim()
    ? revision.hash.trim()
    : undefined;
}

function missionTaskPolicy(params: {
  task: typeof tasksTable.$inferSelect;
  goal: typeof aiGoalsTable.$inferSelect | undefined;
  profile: MissionExecutionProfile;
}) {
  const outcome = jsonRecord(params.goal?.outcomeContract);
  const success = jsonRecord(params.goal?.successCriteria);
  const planRevision = jsonRecord(outcome.planRevision ?? success.planRevision);
  const steps = Array.isArray(planRevision.steps) ? planRevision.steps : [];
  const step = steps.find((candidate) =>
    candidate && typeof candidate === "object"
    && (candidate as Record<string, unknown>).kind === params.task.phase,
  );
  const stepRecord = jsonRecord(step);
  const targetPaths = Array.isArray(stepRecord.files)
    ? stepRecord.files.filter((path): path is string => typeof path === "string").slice(0, 48)
    : Array.isArray(params.task.relatedFiles)
      ? params.task.relatedFiles.filter((path): path is string => typeof path === "string").slice(0, 48)
      : [];
  const requestedValidationProfile = stepRecord.validationProfile;
  const validationProfile = typeof requestedValidationProfile === "string"
    && validateRepairValidationScope(
      requestedValidationProfile as ValidationProfile,
      targetPaths,
    ) === null
    ? requestedValidationProfile as ValidationProfile
    : params.profile === "mission_observe"
      ? undefined
      : "workspace-typecheck" as ValidationProfile;
  return {
    targetPaths,
    approvalRequired: stepRecord.approvalRequired === true,
    objective: typeof success.objective === "string"
      ? success.objective
      : params.task.description ?? params.task.title,
    validationProfile,
  };
}

function missionCandidateIdentity(
  sourceRevision: string,
  pendingChanges: readonly { path: string; newContent: string }[],
  baseTreeHash?: string,
): string {
  const canonical = pendingChanges
    .map((change) => ({
      path: change.path.replaceAll("\\", "/"),
      newContent: change.newContent,
    }))
    .sort((left, right) => left.path.localeCompare(right.path));
  return `mission-candidate:${createHash("sha256")
    .update(JSON.stringify({
      sourceRevision,
      ...(baseTreeHash ? { baseTreeHash } : {}),
      changes: canonical,
    }))
    .digest("hex")}`;
}

type CanonicalMissionChange = Pick<PendingChange, "path" | "newContent">;

function normalizeMissionRelativePath(value: unknown): string | undefined {
  if (typeof value !== "string" || value.length === 0 || value.includes("\0")) {
    return undefined;
  }
  const slashPath = value.replaceAll("\\", "/");
  if (slashPath.startsWith("/") || /^[a-zA-Z]:/.test(slashPath)) {
    return undefined;
  }
  const normalized = posixPath.normalize(slashPath).replace(/^(?:\.\/)+/, "");
  if (
    normalized === "."
    || normalized === ".."
    || normalized.startsWith("../")
    || normalized.startsWith("/")
  ) {
    return undefined;
  }
  return normalized;
}

function canonicalizeMissionChanges(
  changes: readonly PendingChange[],
  approvedPaths: readonly string[],
): { valid: true; changes: CanonicalMissionChange[] } | { valid: false; changes: [] } {
  const approved = new Set(
    approvedPaths
      .map(normalizeMissionRelativePath)
      .filter((path): path is string => Boolean(path)),
  );
  if (approved.size === 0) return { valid: false, changes: [] };

  const byPath = new Map<string, CanonicalMissionChange>();
  let totalBytes = 0;
  for (const candidate of changes) {
    const path = normalizeMissionRelativePath(candidate?.path);
    if (
      !path
      || !approved.has(path)
      || typeof candidate?.newContent !== "string"
    ) {
      return { valid: false, changes: [] };
    }
    totalBytes += Buffer.byteLength(candidate.newContent, "utf8");
    if (totalBytes > 8 * 1024 * 1024) {
      return { valid: false, changes: [] };
    }
    // Multiple tool calls can edit the same approved file. The candidate overlay
    // uses the final content for that path, so retain the last server result.
    byPath.set(path, { path, newContent: candidate.newContent });
  }

  return {
    valid: true,
    changes: [...byPath.values()].sort((left, right) => left.path.localeCompare(right.path)),
  };
}

type MissionRepairCandidateEffectContext = {
  episodeId: string;
  action: ReturnType<typeof buildMissionRepairAction>;
  candidateIdentity: string;
  baseTreeHash: string;
  candidateTreeHash: string;
  beforeObservationId: string;
  workspace: Awaited<ReturnType<typeof createValidationWorkspace>>;
};

async function beginMissionRepairCandidateEffect(params: {
  task: typeof tasksTable.$inferSelect;
  goal: typeof aiGoalsTable.$inferSelect;
  executionId: string;
  correlationId: string;
  attempt: number;
  workerId: string;
  sourceRevision: string;
  rootPath: string;
  changes: readonly CanonicalMissionChange[];
  approvedPaths: readonly string[];
}): Promise<MissionRepairCandidateEffectContext> {
  const baseTreeHash = await hashDeliveryTree(params.rootPath);
  const planRevision = missionPlanRevisionHash(params.goal);
  const episode = await startEpisode({
    projectId: params.task.projectId,
    executionId: params.executionId,
    attempt: params.attempt,
    workerId: params.workerId,
    idempotencyKey: `${params.task.id}:episode:${params.attempt}`,
    projectRevision: params.sourceRevision,
    environmentRootPath: params.rootPath,
    intentKind: "TASK_EXECUTION",
    scope: {
      kind: "mission-task",
      taskId: params.task.id,
      missionId: params.goal.missionId,
      goalId: params.goal.id,
    },
    missionId: params.goal.missionId,
    goalId: params.goal.id,
    ...(planRevision ? { planRevision } : {}),
  });
  const candidateIdentity = missionCandidateIdentity(
    params.sourceRevision,
    params.changes,
    baseTreeHash,
  );
  const action = buildMissionRepairAction({
    actionId: `mission-repair:${params.executionId}:${params.attempt}`,
    episodeId: episode.episodeId,
    projectId: params.task.projectId,
    missionId: params.goal.missionId,
    goalId: params.goal.id,
    taskId: params.task.id,
    executionId: params.executionId,
    attempt: params.attempt,
    sourceRevision: params.sourceRevision,
    goalRevision: params.goal.updatedAt.toISOString(),
    ...(planRevision ? { planRevision } : {}),
    candidateIdentity,
    baseTreeHash,
    approvedPaths: [...params.approvedPaths],
  });
  await appendEpisodeEvent({
    episodeId: episode.episodeId,
    projectId: params.task.projectId,
    executionId: params.executionId,
    attempt: params.attempt,
    workerId: params.workerId,
    eventType: "ACTION_REQUESTED",
    payload: {
      action,
      candidateIdentity,
      baseTreeHash,
      expectedEffects: action.expectedEffects,
    },
    actorType: "worker",
    actorId: params.workerId,
    correlationId: params.correlationId,
  });

  const before = await materializeServerOwnedObservations({
    projectId: params.task.projectId,
    executionId: params.executionId,
    attempt: params.attempt,
    episodeId: episode.episodeId,
    environmentRootPath: params.rootPath,
    projectRevision: params.sourceRevision,
    materializeWorldState: false,
    sources: [{
      kind: "direct_observation",
      sourceId: `mission-repair:${params.executionId}:${params.attempt}:before`,
      subject: `project:${params.task.projectId}:task:${params.task.id}:candidate:${candidateIdentity}`,
      predicate: "workspace.tree_hash",
      value: baseTreeHash,
      sourceRevision: params.sourceRevision,
      observedAt: new Date(),
    }],
  });
  const beforeObservationId = before.observationIds[0];
  if (!beforeObservationId || before.stale > 0) {
    throw new Error("mission_repair_before_observation_unavailable");
  }

  const workspace = await createValidationWorkspace(params.rootPath, params.changes);
  try {
    const candidateTreeHash = await hashDeliveryTree(workspace.rootPath);
    return {
      episodeId: episode.episodeId,
      action,
      candidateIdentity,
      baseTreeHash,
      candidateTreeHash,
      beforeObservationId,
      workspace,
    };
  } catch (error) {
    await workspace.cleanup();
    throw error;
  }
}

async function finishMissionRepairCandidateEffect(params: {
  task: typeof tasksTable.$inferSelect;
  executionId: string;
  correlationId: string;
  attempt: number;
  workerId: string;
  sourceRevision: string;
  rootPath: string;
  context: MissionRepairCandidateEffectContext;
  validationStatus: "passed" | "failed" | "blocked" | "unavailable" | "skipped" | "not-run";
}): Promise<{ effectBundleId?: string; observed: boolean }> {
  const candidateTreeHash = await hashDeliveryTree(params.context.workspace.rootPath);
  const liveTreeHash = await hashDeliveryTree(params.rootPath);
  await appendEpisodeEvent({
    episodeId: params.context.episodeId,
    projectId: params.task.projectId,
    executionId: params.executionId,
    attempt: params.attempt,
    workerId: params.workerId,
    eventType: "ACTION_COMMITTED",
    payload: {
      actionId: params.context.action.actionId,
      candidateIdentity: params.context.candidateIdentity,
      baseTreeHash: params.context.baseTreeHash,
      candidateTreeHash,
      validationStatus: params.validationStatus,
      liveTreeUnchanged: liveTreeHash === params.context.baseTreeHash,
    },
    actorType: "worker",
    actorId: params.workerId,
    correlationId: params.correlationId,
  });

  const after = await materializeServerOwnedObservations({
    projectId: params.task.projectId,
    executionId: params.executionId,
    attempt: params.attempt,
    episodeId: params.context.episodeId,
    environmentRootPath: params.context.workspace.rootPath,
    projectRevision: params.sourceRevision,
    materializeWorldState: false,
    sources: [{
      kind: "direct_observation",
      sourceId: `mission-repair:${params.executionId}:${params.attempt}:after`,
      subject: `project:${params.task.projectId}:task:${params.task.id}:candidate:${params.context.candidateIdentity}`,
      predicate: "workspace.tree_hash",
      value: candidateTreeHash,
      sourceRevision: params.sourceRevision,
      observedAt: new Date(),
    }],
  });
  const afterObservationId = after.observationIds[0];
  if (!afterObservationId || after.stale > 0) {
    throw new Error("mission_repair_after_observation_unavailable");
  }

  const verification = await verifyAndPersistEffect({
    projectId: params.task.projectId,
    executionId: params.executionId,
    attempt: params.attempt,
    episodeId: params.context.episodeId,
    workerId: params.workerId,
    action: params.context.action,
    effectContract: buildMissionRepairEffectContract({
      projectId: params.task.projectId,
      taskId: params.task.id,
      candidateIdentity: params.context.candidateIdentity,
      candidateTreeHash: params.context.candidateTreeHash,
      beforeEvidenceRef: params.context.beforeObservationId,
      afterEvidenceRef: afterObservationId,
    }),
    beforeObservationIds: [params.context.beforeObservationId],
    afterObservationIds: [afterObservationId],
  });
  const stableCandidate = candidateTreeHash === params.context.candidateTreeHash;
  const sourceStillCurrent = liveTreeHash === params.context.baseTreeHash;
  return {
    ...(verification.status === "observed" ? { effectBundleId: verification.effectBundleId } : {}),
    observed: verification.status === "observed" && stableCandidate && sourceStillCurrent,
  };
}

function buildMissionTaskObjective(params: {
  task: typeof tasksTable.$inferSelect;
  goal: typeof aiGoalsTable.$inferSelect;
  profile: Exclude<MissionExecutionProfile, "analysis" | "delivery">;
  workspaceRevision: string;
}): TaskObjectiveContract | undefined {
  if (params.profile === "mission_observe") return undefined;
  const policy = missionTaskPolicy({
    task: params.task,
    goal: params.goal,
    profile: params.profile,
  });
  return buildTaskObjectiveContract({
    message: policy.objective,
    projectId: params.task.projectId,
    workspaceRevision: params.workspaceRevision,
    targetPaths: policy.targetPaths,
    proofRequired: true,
    operationMode: "BUILD",
    implementationTaskMode: true,
  });
}

async function executeMissionToolLoop(params: {
  task: typeof tasksTable.$inferSelect;
  goal: typeof aiGoalsTable.$inferSelect;
  projectContext: Awaited<ReturnType<typeof buildProjectContext>>;
  profile: Exclude<MissionExecutionProfile, "analysis" | "delivery">;
  userId: string;
  provider: Provider;
  executionId: string;
  correlationId: string;
  signal: AbortSignal;
  workspaceRevision: string;
  workerId: string;
  expectedAttempt: number;
  checkpointSequenceBase: number;
  resumeState?: MissionToolLoopCheckpoint;
}): Promise<MissionToolLoopExecution> {
  const [project] = await db
    .select()
    .from(projectsTable)
    .where(eq(projectsTable.id, params.task.projectId))
    .limit(1);
  if (!project) throw new Error("mission_project_not_found");
  const root = await establishProjectRoot(project.rootPath);
  if (!root.ok) throw new Error("mission_project_root_unavailable");

  const policy = missionTaskPolicy({
    task: params.task,
    goal: params.goal,
    profile: params.profile,
  });
  const approvalState = policy.approvalRequired ? "PENDING_APPROVAL" : "APPROVED";
  const allowValidationTools = params.profile !== "mission_observe";
  const objective = missionObjectiveContract({
    objective: policy.objective,
    profile: params.profile,
    targetPaths: policy.targetPaths,
  });
  const taskObjective = buildMissionTaskObjective({
    task: params.task,
    goal: params.goal,
    profile: params.profile,
    workspaceRevision: params.workspaceRevision,
  });
  let checkpointSequence = Math.max(1, params.checkpointSequenceBase);
  let iteration = params.resumeState?.iteration ?? 0;
  let toolCalls = params.resumeState?.toolCalls ?? 0;
  let noProgressStreak = params.resumeState?.noProgressStreak ?? 0;
  let claimState = params.resumeState?.claimState ?? [];
  let missingEvidencePaths = params.resumeState?.missingEvidencePaths ?? [];
  let lastObservation = params.resumeState?.lastObservation || "tool loop initialized";
  const resumedChanges = params.profile === "mission_repair"
    ? canonicalizeMissionChanges(
        params.resumeState?.pendingChanges ?? [],
        policy.targetPaths,
      )
    : { valid: true as const, changes: [] as CanonicalMissionChange[] };
  const pendingChanges = resumedChanges.valid
    ? resumedChanges.changes as PendingChange[]
    : [];
  let completedToolCalls = (params.resumeState?.completedToolCalls ?? []).filter((call) => {
    if (call.tool !== "write_file" && call.tool !== "replace_text") return true;
    if (params.profile !== "mission_repair" || !resumedChanges.valid) return false;
    const path = normalizeMissionRelativePath(call.args.path);
    return Boolean(path && pendingChanges.some((change) => change.path === path));
  });
  const lastToolCallKeyByTool = new Map<string, string>();
  const message = [
    "Server-owned Mission execution.",
    `Execution profile: ${params.profile}.`,
    `Objective: ${policy.objective}`,
    policy.targetPaths.length > 0
      ? `Server-approved target paths: ${policy.targetPaths.join(", ")}`
      : "Use only server-observed project evidence.",
    "Use the available server tools. Do not claim completion without evidence.",
    params.task.prompt ?? params.task.title,
  ].join("\n\n");

  const chat = await chatWithFallback(
    params.userId,
    {
      message,
      history: [],
      projectContext: params.projectContext,
      rootPath: root.canonicalPath,
      projectId: params.task.projectId,
      activeTask: {
        id: params.task.id,
        title: params.task.title,
        description: params.task.description,
        priority: String(params.task.priority),
        relatedFiles: policy.targetPaths,
      },
      objective,
      claimState,
      priorToolCalls: completedToolCalls,
      initialPendingChanges: pendingChanges,
      allowValidationTools,
      approvalState,
      approvedFilePaths: approvalState === "APPROVED" ? policy.targetPaths : [],
      validationTargetPaths: policy.targetPaths,
      executionMode: params.profile === "mission_observe" ? "forensic" : "repair_plan",
      allowExecutionTools: params.profile !== "mission_observe" && approvalState === "APPROVED",
      allowedToolNames: params.profile === "mission_observe"
        ? ["read_file", "read_file_range", "list_directory", "search_code"]
        : params.profile === "mission_validate"
          ? ["read_file", "read_file_range", "list_directory", "search_code", "run_validation"]
          : [
              "read_file",
              "read_file_range",
              "list_directory",
              "search_code",
              "replace_text",
              "write_file",
              "run_validation",
            ],
      validationRunner: allowValidationTools
        ? async (
            validationProfile: string,
            targetPaths: string[],
            signal?: AbortSignal,
            pendingChanges?: readonly { path: string; newContent: string }[],
            evidenceContext?: {
              operationId?: string;
              projectRevision?: string;
              candidateHash?: string;
            },
          ) => runRepairValidation(
            root.canonicalPath,
            validationProfile as ValidationProfile,
            targetPaths,
            signal,
            pendingChanges,
            {
              operationId: evidenceContext?.operationId ?? params.executionId,
              projectRevision: evidenceContext?.projectRevision,
              candidateHash: evidenceContext?.candidateHash,
              environmentProfile: params.goal
                ? serverEnvironmentProfile("TASK_EXECUTION", {
                    kind: "mission-task",
                    taskId: params.task.id,
                    missionId: params.goal.missionId,
                    goalId: params.goal.id,
                  })
                : null,
            },
          )
        : undefined,
      signal: params.signal,
      telemetryContext: {
        projectId: params.task.projectId,
        userId: params.userId,
        operationId: params.executionId,
        correlationId: params.correlationId,
      },
    },
    params.provider,
    undefined,
    { qualityProfile: "task_execution", requireTools: true },
    undefined,
    async (step: AgentStep) => {
      if (step.kind === "iteration_start") iteration = step.iter;
      if (step.kind === "tool_call") {
        toolCalls++;
        const key = `${step.tool}:${JSON.stringify(
          Object.fromEntries(Object.entries(step.args).sort(([a], [b]) => a.localeCompare(b))),
        )}`;
        lastToolCallKeyByTool.set(step.tool, key);
        if (!completedToolCalls.some((call) => call.key === key)) {
          completedToolCalls = [
            ...completedToolCalls,
            { key, tool: step.tool, args: { ...step.args }, status: "started" as const },
          ].slice(-64);
        }
      }
      if (step.kind === "tool_result") {
        lastObservation = `${step.tool}: ${step.resultKind ?? "completed"}`;
        const key = lastToolCallKeyByTool.get(step.tool);
        if (key) {
          completedToolCalls = completedToolCalls.map((call) =>
            call.key === key ? { ...call, status: "completed" as const } : call,
          );
        }
      } else if (step.kind === "diagnostic") {
        lastObservation = step.code;
      } else if (step.kind === "done" && step.objectiveState) {
        claimState = step.objectiveState.claims;
        missingEvidencePaths = step.objectiveState.missingEvidencePaths;
        noProgressStreak = step.objectiveState.progress.noProgressStreak;
        completedToolCalls = step.objectiveState.completedToolCalls ?? completedToolCalls;
      }
      const checkpointStateProjection = buildMissionStateProjection({
        profile: params.profile,
        claimState,
        missingEvidencePaths,
        lastObservation,
        nextAction: step.kind === "done" ? step.objectiveState?.nextAction : undefined,
        pendingChanges,
        sourceRevision: params.workspaceRevision,
        candidateRevision: missionCandidateIdentity(params.workspaceRevision, pendingChanges),
      });
      await checkpointAiExecution({
        executionId: params.executionId,
        expectedAttempt: params.expectedAttempt,
        workerId: params.workerId,
        checkpoint: {
          stage: "tool_loop",
          sequence: checkpointSequence++,
          detail: JSON.stringify({
            schemaVersion: 2,
            executionProfile: params.profile,
            iteration,
            toolCalls,
            noProgressStreak,
            claimState,
            missingEvidencePaths,
            lastObservation: lastObservation.slice(0, 240),
            nextAction: step.kind === "done" ? step.objectiveState?.nextAction : undefined,
            completedToolCalls,
            pendingChanges: pendingChanges.slice(0, 12),
            stateProjection: checkpointStateProjection,
          }),
          updatedAt: new Date().toISOString(),
        },
      });
    },
  );
  const output = chat.result;
  const rawOutputPendingChanges = output.pendingChanges ?? pendingChanges;
  const normalizedOutputChanges = params.profile === "mission_repair"
    ? canonicalizeMissionChanges(rawOutputPendingChanges, policy.targetPaths)
    : { valid: true as const, changes: [] as CanonicalMissionChange[] };
  const candidateGenerationRejected = params.profile === "mission_repair"
    && rawOutputPendingChanges.length > 0
    && (
      !normalizedOutputChanges.valid
      || approvalState !== "APPROVED"
      || Boolean(output._parseError)
      || Boolean(output._qualityError)
    );
  const outputPendingChanges = params.profile === "mission_repair"
    && normalizedOutputChanges.valid
    && approvalState === "APPROVED"
    ? normalizedOutputChanges.changes
    : [];
  let candidateIdentity = missionCandidateIdentity(params.workspaceRevision, outputPendingChanges);
  const effectRequired = params.profile === "mission_repair"
    && outputPendingChanges.length > 0;
  let effectBundleId: string | undefined;
  let effectObserved = false;
  const validatorReceipts: TaskObjectiveValidatorReceipt[] = [];
  let proofStatus: "PROVEN" | "INCOMPLETE" | "UNAVAILABLE" = candidateGenerationRejected
    ? "UNAVAILABLE"
    : "INCOMPLETE";
  let evidence: EvidenceSnapshotInput | undefined;
  let candidateEffectContext: MissionRepairCandidateEffectContext | undefined;
  let validationResult: Awaited<ReturnType<typeof runRepairValidation>> | undefined;

  try {
    if (effectRequired) {
      try {
        candidateEffectContext = await beginMissionRepairCandidateEffect({
          task: params.task,
          goal: params.goal,
          executionId: params.executionId,
          correlationId: params.correlationId,
          attempt: params.expectedAttempt,
          workerId: params.workerId,
          sourceRevision: params.workspaceRevision,
          rootPath: root.canonicalPath,
          changes: outputPendingChanges,
          approvedPaths: policy.targetPaths,
        });
        candidateIdentity = candidateEffectContext.candidateIdentity;
      } catch (error) {
        proofStatus = "UNAVAILABLE";
        logger.warn(
          {
            scope: "task-execution",
            code: "mission_repair_candidate_action_unavailable",
            taskId: params.task.id,
            executionId: params.executionId,
            error,
          },
          "Mission repair candidate action could not be initialized",
        );
      }
    }

    if (taskObjective && policy.validationProfile) {
      const validationAllowed = !candidateGenerationRejected
        && (params.profile !== "mission_repair"
          || (effectRequired && Boolean(candidateEffectContext)));
      validationResult = validationAllowed
        ? await runRepairValidation(
          root.canonicalPath,
          policy.validationProfile,
          policy.targetPaths,
          params.signal,
          outputPendingChanges,
          {
            operationId: params.executionId,
            projectRevision: params.workspaceRevision,
            candidateHash: candidateIdentity,
            environmentProfile: params.goal
              ? serverEnvironmentProfile("TASK_EXECUTION", {
                  kind: "mission-task",
                  taskId: params.task.id,
                  missionId: params.goal.missionId,
                  goalId: params.goal.id,
                })
              : null,
          },
        )
      : undefined;
      const receiptStatus = validationResult?.status === "passed"
        ? "PROVEN" as const
        : validationResult?.status === "unavailable" || validationResult?.status === "blocked"
          ? "UNAVAILABLE" as const
          : "INCOMPLETE" as const;
      const artifactRef = validationResult?.evidence.artifactRef
        ?? `validation-result:${params.executionId}:not-run`;
      validatorReceipts.push({
        validatorId: "registered-validation.v1",
        status: receiptStatus,
        operationId: params.executionId,
        projectId: params.task.projectId,
        workspaceRevision: params.workspaceRevision,
        artifactRef,
        environmentRevision: validationResult?.evidence.environmentRevision ?? null,
      });
      const objectiveValidation = validateTaskObjectiveContract({
        contract: taskObjective,
        workspaceRevision: params.workspaceRevision,
        projectId: params.task.projectId,
        operationId: params.executionId,
        objectiveValidated: receiptStatus === "PROVEN",
        evidenceVerdict: receiptStatus === "PROVEN" ? "PROVEN" : "INCOMPLETE",
        evidenceComplete: receiptStatus === "PROVEN",
        targetPaths: policy.targetPaths,
        validatorReceipts,
      });
      proofStatus = objectiveValidation.allowed
        ? "PROVEN"
        : receiptStatus === "UNAVAILABLE"
          ? "UNAVAILABLE"
          : "INCOMPLETE";
      evidence = {
        operationId: params.executionId,
        workspaceRoot: root.canonicalPath,
        sourceRevision: params.workspaceRevision,
        candidateIdentity,
        verdict: proofStatus,
        required: true,
        sourceEvidenceRequired: false,
        reads: [],
      };
    }

    if (effectRequired && candidateEffectContext) {
      try {
        const effect = await finishMissionRepairCandidateEffect({
          task: params.task,
          executionId: params.executionId,
          correlationId: params.correlationId,
          attempt: params.expectedAttempt,
          workerId: params.workerId,
          sourceRevision: params.workspaceRevision,
          rootPath: root.canonicalPath,
          context: candidateEffectContext,
          validationStatus: validationResult?.status ?? "not-run",
        });
        effectBundleId = effect.effectBundleId;
        effectObserved = effect.observed;
        if (!effect.observed) {
          proofStatus = proofStatus === "UNAVAILABLE" ? "UNAVAILABLE" : "INCOMPLETE";
        }
      } catch (error) {
        proofStatus = proofStatus === "UNAVAILABLE" ? "UNAVAILABLE" : "INCOMPLETE";
        logger.warn(
          {
            scope: "task-execution",
            code: "mission_repair_candidate_effect_unavailable",
            taskId: params.task.id,
            executionId: params.executionId,
            error,
          },
          "Mission repair candidate effect could not be verified",
        );
      }
    } else if (effectRequired) {
      proofStatus = "UNAVAILABLE";
    }
  } finally {
    if (candidateEffectContext) {
      await candidateEffectContext.workspace.cleanup();
    }
  }

  const binaryEvidence = (output.binaryEvidence ?? []).flatMap((packet) => {
    const parsed = parseBinaryEvidencePacket(packet, {
      operationId: params.executionId,
      workspaceRevision: params.workspaceRevision,
    });
    return parsed ? [parsed] : [];
  });
  if (binaryEvidence.length > 0) {
    const mediaVerdict = binaryEvidence.every((packet) =>
      packet.operationId === params.executionId
      && packet.workspaceRevision === params.workspaceRevision
    ) ? "PROVEN" as const : "INCOMPLETE" as const;
    proofStatus = taskObjective
      ? proofStatus === "PROVEN" && mediaVerdict === "PROVEN"
        ? "PROVEN"
        : proofStatus === "UNAVAILABLE"
          ? "UNAVAILABLE"
          : "INCOMPLETE"
      : mediaVerdict;
    evidence = {
      ...(evidence ?? {}),
      operationId: params.executionId,
      workspaceRoot: root.canonicalPath,
      sourceRevision: params.workspaceRevision,
      candidateIdentity,
      verdict: mediaVerdict,
      required: true,
      sourceEvidenceRequired: false,
      reads: [],
      artifacts: binaryEvidence,
    };
  }
  if (effectRequired && !effectObserved) {
    proofStatus = proofStatus === "UNAVAILABLE" ? "UNAVAILABLE" : "INCOMPLETE";
  }
  if (evidence) {
    evidence = {
      ...evidence,
      candidateIdentity,
      verdict: proofStatus,
    };
  }
  const stateProjection = buildMissionStateProjection({
    profile: params.profile,
    claimState,
    missingEvidencePaths,
    lastObservation,
    pendingChanges: outputPendingChanges,
    sourceRevision: params.workspaceRevision,
    candidateRevision: candidateIdentity,
  });
  const response = typeof output.response === "string"
    ? output.response
    : "Mission tool loop ended without a user-facing response.";
  const toolSteps = [
    `Mission tool loop profile: ${params.profile}`,
    `Server-observed sources: ${output.sources?.length ?? 0}`,
    `Pending candidate changes: ${outputPendingChanges.length}`,
    `Objective proof: ${proofStatus}`,
  ];
  return {
    effectiveProvider: chat.effectiveProvider,
    profile: params.profile,
    result: {
      summary: response,
      confidence: "medium",
      needsHumanReview: proofStatus !== "PROVEN",
      steps: toolSteps,
      ...(output._parseError ? { _parseError: output._parseError } : {}),
    } as Awaited<ReturnType<typeof executeTask>>,
    proof: {
      taskObjective,
      status: proofStatus,
      validatorReceipts,
      evidence,
      candidateIdentity,
      effectRequired,
      ...(effectBundleId ? { effectBundleId } : {}),
      refs: [
        ...validatorReceipts.map((receipt) => receipt.artifactRef),
        ...(effectBundleId ? [effectBundleId] : []),
      ],
      stateProjection,
    },
  };
}

/**
 * The single task execution state machine used by HTTP and queue callers.
 * The queue is only a concurrency limiter; ai_executions and the task lease
 * are the source of truth for ownership and recovery.
 */
export async function executeTaskLifecycle(params: {
  taskId: string;
  userId: string;
  provider: Provider;
  trigger: TaskExecutionTrigger;
  expectedStatuses?: Array<"pending" | "queued" | "verifying">;
  workspaceRevision?: string;
  resumeExecutionId?: string;
  resumeToken?: string;
  parentExecutionId?: string | null;
  delegationBudget?: Partial<ExecutionDelegationBudget>;
}): Promise<TaskExecutionOutcome> {
  const [before] = await db.select().from(tasksTable).where(eq(tasksTable.id, params.taskId)).limit(1);
  if (!before) return { ok: false, status: "conflict", errorCode: "task_not_found" };
  const [missionGoal] = before.goalId
    ? await db
        .select()
        .from(aiGoalsTable)
        .where(and(
          eq(aiGoalsTable.id, before.goalId),
          eq(aiGoalsTable.projectId, before.projectId),
        ))
        .limit(1)
    : [];
  const executionProfile = readMissionExecutionProfile(
    missionGoal?.outcomeContract,
    before.phase,
  );
  const executionWorkspaceRevision = params.workspaceRevision
    ?? (missionGoal && isMissionToolLoopProfile(executionProfile)
      ? before.updatedAt.toISOString()
      : undefined);
  let executionWorkspaceRoot: string | undefined;
  if (missionGoal && isMissionToolLoopProfile(executionProfile)) {
    const [project] = await db
      .select({ rootPath: projectsTable.rootPath })
      .from(projectsTable)
      .where(eq(projectsTable.id, before.projectId))
      .limit(1);
    if (project) {
      const established = await establishProjectRoot(project.rootPath);
      if (established.ok) executionWorkspaceRoot = established.canonicalPath;
    }
  }
  const allowed = params.expectedStatuses ?? ["pending", "queued", "verifying"];
  const initialStatus = before.status as TaskStatus;
  const rollbackStatus = before.status === "running" ? "verifying" : before.status;
  const initialCorrelationId = randomUUID();
  const workerId = `task-worker:${randomUUID()}`;
  const idempotencyKey = `${before.id}:attempt:${before.retryCount}`;
  const request = {
    projectId: before.projectId,
    message: before.prompt ?? before.title,
    modelMessage: before.prompt ?? before.title,
    workspaceRevision: executionWorkspaceRevision,
    linkedTaskId: before.id,
    correlationId: initialCorrelationId,
    attempt: before.retryCount,
    validationTargetPaths: Array.isArray(before.relatedFiles) ? before.relatedFiles : [],
    ...(missionGoal && isMissionToolLoopProfile(executionProfile) && executionWorkspaceRevision
      ? {
          proofRequired: true,
          taskObjective: buildMissionTaskObjective({
            task: before,
            goal: missionGoal,
            profile: executionProfile,
            workspaceRevision: executionWorkspaceRevision,
          }),
        }
      : {}),
  };
  let stage = "claim";
  const startedAt = Date.now();
  const stages: string[] = ["claim"];
  let executionProvider = params.provider.provider;

  // A resume continues the existing durable execution. It must not re-enter
  // createAiExecution with the original task idempotency key: that key belongs
  // to the original user turn, while resumeToken authorizes a new auditable
  // assistant attempt on the same execution.
  const durable = params.resumeExecutionId
    ? await (async () => {
        if (!params.resumeToken) return undefined;
        const existing = await getAiExecutionForUser(params.resumeExecutionId!, params.userId);
        if (
          !existing
          || existing.linkedTaskId !== before.id
          || existing.projectId !== before.projectId
        ) {
          return undefined;
        }
        return { execution: existing, created: false as const };
      })()
    : await createAiExecution({
        userId: params.userId,
        request,
        idempotencyKey,
        correlationId: initialCorrelationId,
        attempt: before.retryCount,
        projectId: before.projectId,
        linkedTaskId: before.id,
        goalId: before.goalId ?? undefined,
        workspaceRoot: executionWorkspaceRoot,
        parentExecutionId: params.parentExecutionId,
        delegationBudget: params.delegationBudget,
      });
  if (!durable) {
    return {
      ok: false,
      status: "conflict",
      errorCode: "execution_identity_changed",
    };
  }
  const executionId = durable.execution.id;
  if (params.resumeExecutionId && executionId !== params.resumeExecutionId) {
    return {
      ok: false,
      status: "conflict",
      executionId,
      errorCode: "execution_identity_changed",
    };
  }
  const correlationId = durable.execution.correlationId ?? initialCorrelationId;
  const claimedExecution = durable.created
    ? await claimAiExecution({
        executionId,
        userId: params.userId,
        workerId,
        ...(params.resumeToken ? { resumeToken: params.resumeToken } : {}),
      })
    : durable.execution.status === "running"
      ? undefined
      : await claimAiExecution({
          executionId,
          userId: params.userId,
          workerId,
          ...(params.resumeToken ? { resumeToken: params.resumeToken } : {}),
        });
  if (!claimedExecution) {
    return { ok: false, status: "conflict", executionId, errorCode: "execution_already_claimed" };
  }
  const executionAttempt = claimedExecution.attempt;
  const executionRevision = claimedExecution.baseRevision ?? executionWorkspaceRevision;
  const episodePlanRevision = missionPlanRevisionHash(missionGoal);
  const episodeScope = {
    kind: missionGoal
      ? "mission-task"
      : before.workflowId
        ? "workflow-task"
        : "task",
    taskId: before.id,
    ...(missionGoal
      ? { missionId: missionGoal.missionId, goalId: missionGoal.id }
      : {}),
    ...(before.workflowId ? { workflowId: before.workflowId } : {}),
  } as const;
  startEpisodeShadow({
    projectId: before.projectId,
    executionId,
    attempt: executionAttempt,
    workerId,
    idempotencyKey: `${before.id}:episode:${executionAttempt}`,
    projectRevision: executionRevision ?? "unknown",
    intentKind: "TASK_EXECUTION",
    scope: episodeScope,
    ...(missionGoal ? { missionId: missionGoal.missionId } : {}),
    ...(before.goalId ? { goalId: before.goalId } : {}),
    ...(episodePlanRevision ? { planRevision: episodePlanRevision } : {}),
  });
  const claimedCheckpoint = parseAiExecutionCheckpoint(claimedExecution.checkpoint);
  const missionResumeState = parseMissionToolLoopCheckpoint(claimedCheckpoint);
  const initialCheckpointSequence = Math.max(
    1,
    claimedCheckpoint?.sequence ?? 0,
    claimedExecution.checkpointVersion ?? 0,
  ) + 1;
  const resumeContext = params.resumeToken
    ? buildAiExecutionResumeContext(claimedCheckpoint)
    : "";

  const [claimedTask] = await db.update(tasksTable)
    .set({
      status: "running",
      workerId,
      leaseUntil: new Date(Date.now() + AI_EXECUTION_LEASE_MS),
      lastHeartbeatAt: new Date(),
      correlationId,
      idempotencyKey,
      updatedAt: new Date(),
    })
    .where(and(eq(tasksTable.id, before.id), inArray(tasksTable.status, allowed)))
    .returning();
  if (!claimedTask) {
    await failAiExecution({ executionId, workerId, error: "Task state changed before claim." });
    return { ok: false, status: "conflict", executionId, errorCode: "task_state_changed" };
  }
  const claimConflict = taskTransitionConflict(initialStatus, "running", "execution");
  if (claimConflict) {
    await failAiExecution({ executionId, workerId, error: claimConflict });
    return { ok: false, status: "conflict", executionId, errorCode: "invalid_task_transition" };
  }

  const log = async (level: "info" | "warn" | "error", message: string, metadata?: Record<string, unknown>) => {
    const safeMetadata = Object.fromEntries(
      Object.entries(metadata ?? {})
        .filter(([key]) => key !== "workerId")
        .map(([key, value]) => [key, typeof value === "string" ? safeText(value, 240) : value]),
    );
    await db.insert(taskLogsTable).values({
      id: randomUUID(), taskId: before.id, level, message: safeText(message, 500),
      metadata: { ...safeMetadata, executionId, trigger: params.trigger },
      correlationId,
    }).catch((error) => logger.warn({ error, taskId: before.id }, "task execution log write failed"));
  };
  const progress = createTaskProgressEmitter({
    taskId: before.id,
    executionId,
    attempt: executionAttempt,
    workerId,
    correlationId,
    trigger: params.trigger,
  });
  await log("info", "AI task execution claimed", { stage: "claim", workerId });
  await progress.start("acquisition", "Execution acquired.", 8, 1);
  await progress.finish("acquisition", "completed", "Execution is owned by the active worker.", 12, 1);
  const initialCheckpointed = await checkpointAiExecution({
    executionId, expectedAttempt: executionAttempt, workerId,
    checkpoint: {
      stage: "running",
      sequence: initialCheckpointSequence,
      detail: "Task claimed.",
      updatedAt: new Date().toISOString(),
    },
  });
  if (!initialCheckpointed) {
    const failure = failureReceipt({
      executionId,
      correlationId,
      revision: params.workspaceRevision,
      provider: executionProvider,
      attempt: executionAttempt,
      durationMs: Date.now() - startedAt,
      stages,
      code: "checkpoint_persistence_failed",
       failureClass: "checkpoint",
       retryable: true,
    });
    const finalized = await finalizeTaskExecutionAcceptance({
      executionId,
      workerId,
      task: before,
      receipt: failure,
      outcome: "FAILED",
      terminalStatus: "failed",
      reasonCode: "CHECKPOINT_PERSISTENCE_FAILED",
      retryable: true,
      trigger: params.trigger,
      finalStatus: rollbackStatus,
      error: "Execution checkpoint could not be persisted after claim.",
      logLevel: "error",
      logMessage: "AI task execution could not persist its initial checkpoint",
      logMetadata: { stage: "claim", code: "checkpoint_persistence_failed" },
    });
    if (finalized.accepted) {
      await progress.finish("finalization", "failed", "Saving the execution checkpoint failed.", 92, 7);
      await progress.terminal("FAILED", "Task execution failed before model work began.");
    }
    return { ok: false, status: "failed", executionId, errorCode: "checkpoint_persistence_failed" };
  }
  const heartbeat = setInterval(() => {
    void heartbeatAiExecution({ executionId, expectedAttempt: executionAttempt, workerId });
    void db.update(tasksTable).set({
      leaseUntil: new Date(Date.now() + AI_EXECUTION_LEASE_MS),
      lastHeartbeatAt: new Date(),
      updatedAt: new Date(),
    }).where(and(
      eq(tasksTable.id, before.id),
      eq(tasksTable.workerId, workerId),
      eq(tasksTable.status, "running"),
    ));
  }, Math.max(1_000, Math.floor(AI_EXECUTION_LEASE_MS / 3)));
  const executionAbortController = new AbortController();
  await registerAiExecutionController(executionId, executionAbortController);

  try {
    stage = "context";
    stages.push("context");
    await progress.start("context", "Building project context.", 16, 2);
    await log("info", "Building project context", { stage: "context" });
    if (executionAbortController.signal.aborted) throw Object.assign(new Error("Execution cancelled"), { name: "AbortError" });
    const projectContext = await buildProjectContext(before.projectId, { sections: [...CONTEXT_SECTIONS] });
    await progress.finish("context", "completed", "Project context is ready.", 24, 2);
    await checkpointAiExecution({
      executionId, expectedAttempt: executionAttempt, workerId,
      checkpoint: { stage: "model_call", sequence: 2, detail: "Project context built.", updatedAt: new Date().toISOString() },
    });
    const progressMessage = async (message: string) => log("info", message, { stage: "progress" });
    stage = "provider_call";
    stages.push("provider_call");
    await progress.start("model", "Calling the AI model.", 32, 3);
    const missionExecution = missionGoal && isMissionToolLoopProfile(executionProfile)
      ? await executeMissionToolLoop({
          task: before,
          goal: missionGoal,
          projectContext,
          profile: executionProfile,
          userId: params.userId,
          provider: params.provider,
          executionId,
          correlationId,
          signal: executionAbortController.signal,
           workspaceRevision: executionRevision!,
          workerId,
          expectedAttempt: executionAttempt,
          checkpointSequenceBase: Math.max(3, initialCheckpointSequence + 1),
          ...(missionResumeState ? { resumeState: missionResumeState } : {}),
        })
      : undefined;
    const { result, effectiveProvider } = missionExecution ?? await runAgentWithFallback<Awaited<ReturnType<typeof executeTask>>>(
      params.userId,
      params.provider,
      (opts) => executeTask({
        taskTitle: before.title,
        taskDescription: before.description,
        taskPrompt: [before.prompt ?? before.title, resumeContext].filter(Boolean).join("\n\n"),
        taskPriority: before.priority,
        relatedFiles: before.relatedFiles ?? [],
        remediationPlan: before.remediationPlan ?? null,
        projectContext,
        ...opts,
      }, {
        onProgress: progressMessage,
        signal: executionAbortController.signal,
        onModelAttempt: async (attempt) => {
          const isRetry = attempt.outcome !== "success" || attempt.contractOutcome === "malformed_but_recovered";
          if (isRetry) {
            await progress.start("attempt", "Retrying the model attempt.", 40, 4);
          }
          await progress.finish(
            "attempt",
            attempt.outcome === "success" ? "completed" : "failed",
            attempt.outcome === "success" ? "Model attempt completed." : "Model attempt needs recovery.",
            44,
            4,
          );
        },
      }),
      {
        qualityProfile: "task_execution",
        onProviderAttempt: async (attempt) => {
          if (attempt.fallbackCount > 0) {
            await progress.start("attempt", "Trying a server-selected recovery attempt.", 42, 4);
          }
          if (attempt.outcome === "failure" || attempt.outcome === "cancelled") {
            await progress.finish(
              "attempt",
              attempt.outcome === "cancelled" ? "cancelled" : "failed",
              attempt.outcome === "cancelled" ? "Execution was cancelled." : "The model attempt did not complete.",
              44,
              4,
            );
          }
        },
        signal: executionAbortController.signal,
        telemetryContext: {
          projectId: before.projectId,
          userId: params.userId,
          operationId: correlationId,
          correlationId,
        },
      },
    );
    if (missionExecution) {
      stages.push("tool_loop");
      await checkpointAiExecution({
        executionId,
        expectedAttempt: executionAttempt,
        workerId,
        checkpoint: {
          stage: "tool_loop",
          sequence: Math.max(3, initialCheckpointSequence + 1),
          detail: [
            `profile=${missionExecution.profile}`,
            "server-owned tool loop completed",
            "candidate/proof state remains provisional until acceptance",
          ].join("; "),
          updatedAt: new Date().toISOString(),
        },
      });
    }
    executionProvider = effectiveProvider;
    if (effectiveProvider !== params.provider.provider) {
      stages.push("provider_fallback");
      await progress.finish("attempt", "completed", "A recovery attempt completed.", 48, 4);
    }
    await progress.finish("model", "completed", "The model response was received.", 56, 3);
    if (executionAbortController.signal.aborted) {
      throw Object.assign(new Error("Execution cancelled"), { name: "AbortError" });
    }

    if (result._parseError) {
      stage = "parse";
      stages.push("parse");
      await progress.start("analysis", "Analyzing the model response.", 64, 5);
      await progress.finish("analysis", "failed", "The model response could not be accepted.", 68, 5);
      await progress.start("finalization", "Recording the failed execution.", 84, 7);
      const parseReceipt = failureReceipt({
        executionId, correlationId, revision: params.workspaceRevision,
        provider: effectiveProvider, attempt: executionAttempt,
        durationMs: Date.now() - startedAt, stages, code: "model_output_invalid",
        failureClass: "malformed_output",
        retryable: true,
        executionProfile,
      });
      const error = `model_output_invalid:${result._parseError.code}`;
      const finalized = await finalizeTaskExecutionAcceptance({
        executionId,
        workerId,
        task: before,
        receipt: parseReceipt,
        outcome: "FAILED",
        terminalStatus: "failed",
        reasonCode: "MODEL_OUTPUT_INVALID",
        retryable: true,
        trigger: params.trigger,
        finalStatus: rollbackStatus,
        error,
        logLevel: "error",
        logMessage: "AI task output was invalid",
        logMetadata: { stage: "parse", code: result._parseError.code },
      });
      if (finalized.accepted) {
        await progress.finish("finalization", "completed", "The failed execution was recorded.", 92, 7);
        await progress.terminal("FAILED", "Task execution failed validation.");
      }
      return {
        ok: false,
        status: "failed",
        executionId,
        errorCode: "model_output_invalid",
        parseCode: result._parseError.code,
      };
    }

    if (result._qualityError) {
      stage = "quality";
      stages.push("quality");
      await progress.start("analysis", "Analyzing the model response.", 64, 5);
      await progress.finish("analysis", "completed", "The model response was parsed.", 72, 5);
      await progress.start("verification", "Running the server quality gate.", 76, 6);
      await progress.finish("verification", "failed", "The result did not pass the quality gate.", 80, 6);
      await progress.start("finalization", "Recording the failed execution.", 84, 7);
      const quality = result._qualityError;
      const qualityReceipt = failureReceipt({
        executionId,
        correlationId,
        revision: params.workspaceRevision,
        provider: effectiveProvider,
        attempt: executionAttempt,
        durationMs: Date.now() - startedAt,
        stages,
        code: quality.code,
        failureClass: "quality_gate",
        retryable: true,
        executionProfile,
      });
      const finalized = await finalizeTaskExecutionAcceptance({
        executionId,
        workerId,
        task: before,
        receipt: qualityReceipt,
        outcome: "FAILED",
        terminalStatus: "failed",
        reasonCode: "QUALITY_REVIEW_LOW",
        retryable: true,
        trigger: params.trigger,
        finalStatus: rollbackStatus,
        error: quality.code,
        logLevel: "error",
        logMessage: "AI task output failed the quality gate",
        logMetadata: {
          stage: "quality",
          code: quality.code,
          score: quality.score,
          threshold: quality.threshold,
          reasons: quality.reasons,
        },
      });
      if (finalized.accepted) {
        await progress.finish("finalization", "completed", "The failed execution was recorded.", 92, 7);
        await progress.terminal("FAILED", "Task execution did not pass quality checks.");
      }
      return {
        ok: false,
        status: "failed",
        executionId,
        errorCode: "quality_review_low",
      };
    }

    // An AI report is not proof that a remediation was applied. Rule-backed
    // tasks remain in verification until the explicit verification path passes.
    const missionProofProven = missionExecution?.proof.status === "PROVEN";
    const finalStatus =
      missionExecution
        ? missionProofProven ? "completed" : "verifying"
        : result.needsHumanReview || before.remediationPlan ? "verifying" : "completed";
    const finalConflict = taskTransitionConflict("running", finalStatus, "execution");
    if (finalConflict) throw new Error(finalConflict);
    stage = "finalize";
    stages.push("finalize");
    await progress.start("analysis", "Analyzing the model response.", 64, 5);
    await progress.finish("analysis", "completed", "The model response was parsed.", 72, 5);
    await progress.start("verification", "Running server-owned verification.", 76, 6);
    await progress.finish(
      "verification",
      "completed",
      finalStatus === "verifying" ? "Operator verification is required." : "Server verification completed.",
      80,
      6,
    );
    await progress.start("finalization", "Recording the execution outcome.", 84, 7);
    const taskReceipt = buildAiTaskExecutionReceipt({
      executionId, correlationId, revision: executionRevision,
       provider: executionProvider, attempt: executionAttempt,
      durationMs: Date.now() - startedAt, stages,
      attempts: effectiveProvider === params.provider.provider ? 1 : 2, result,
      executionProfile,
      evidenceRefs: missionExecution?.proof.refs,
    });
    const missionProofPending = Boolean(missionExecution && !missionProofProven);
    const terminalOutcome = missionProofPending ? "FAILED" as const : "SUCCEEDED" as const;
    const terminalStatus = missionProofPending ? "failed" as const : "completed" as const;
    const terminalReasonCode = missionProofPending
      ? missionExecution?.proof.status === "UNAVAILABLE"
        ? "MISSION_VALIDATOR_UNAVAILABLE"
        : "MISSION_OBJECTIVE_NOT_PROVEN"
      : finalStatus === "completed"
        ? "ACCEPTED"
        : "HUMAN_REVIEW_REQUIRED";
    const finalized = await finalizeTaskExecutionAcceptance({
      executionId,
      workerId,
      task: before,
      receipt: taskReceipt,
      outcome: terminalOutcome,
      terminalStatus,
      reasonCode: terminalReasonCode,
      retryable: missionProofPending,
      trigger: params.trigger,
      finalStatus,
      logLevel: missionProofPending ? "warn" : finalStatus === "completed" ? "info" : "warn",
      logMessage: missionProofPending
        ? `Mission objective proof is ${missionExecution?.proof.status.toLowerCase()}.`
        : `AI task ${finalStatus}: ${safeText(taskReceipt.summary)}`,
      logMetadata: {
        receipt: taskReceipt,
        executionId,
        trigger: params.trigger,
        ...(missionExecution ? {
          objectiveProof: missionExecution.proof.status,
          validatorReceipts: missionExecution.proof.validatorReceipts,
        } : {}),
      },
      taskObjective: missionExecution?.proof.taskObjective,
      taskObjectiveStatus: missionExecution?.proof.status,
      evidence: missionExecution?.proof.evidence,
      workspaceRoot: missionExecution?.proof.evidence?.workspaceRoot,
      candidateIdentity: missionExecution?.proof.candidateIdentity,
      effectRequired: missionExecution?.proof.effectRequired,
      effectBundleId: missionExecution?.proof.effectBundleId,
    });
    if (!finalized.accepted) {
      throw Object.assign(new Error("task_state_changed_during_finalize"), { name: "AbortError" });
    }
    void materializeServerOwnedObservations({
      projectId: before.projectId,
      executionId,
      attempt: taskReceipt.attempt,
      ...(executionWorkspaceRoot ? { environmentRootPath: executionWorkspaceRoot } : {}),
      projectRevision: taskReceipt.revision,
      sources: [
        {
          kind: "acceptance",
          sourceId: `acceptance:${executionId}:${taskReceipt.attempt}`,
          sourceRevision: taskReceipt.revision,
          terminalStatus: taskReceipt.terminalStatus,
          outcome: terminalOutcome,
          reasonCode: terminalReasonCode,
          evidenceComplete: true,
          evidenceRefs: taskReceipt.evidenceRefs,
        },
        {
          kind: "runtime_receipt",
          sourceId: `runtime:${executionId}:${taskReceipt.attempt}`,
          sourceRevision: taskReceipt.revision,
          status: taskReceipt.terminalStatus === "SUCCEEDED"
            ? "passed"
            : taskReceipt.terminalStatus === "CANCELLED"
              ? "cancelled"
              : taskReceipt.terminalStatus === "BLOCKED"
                ? "blocked"
                : "failed",
          profile: taskReceipt.executionProfile,
          candidateIdentity: missionExecution?.proof.candidateIdentity,
        },
        ...(missionExecution?.proof.validatorReceipts ?? []).map((receipt) => ({
          kind: "validator_receipt" as const,
          validatorId: receipt.validatorId,
          operationId: receipt.operationId,
          projectId: receipt.projectId,
          workspaceRevision: receipt.workspaceRevision,
          status: receipt.status,
          artifactRef: receipt.artifactRef,
          environmentRevision: receipt.environmentRevision ?? null,
        })),
      ],
    }).catch((error: unknown) => {
      logger.warn(
        { scope: "task-execution", code: "observation_materialization_failed", executionId, error },
        "Server-owned observation materialization failed after acceptance",
      );
    });
    await progress.finish(
      "finalization",
      "completed",
      missionProofPending
        ? "Execution recorded without objective proof; the Mission remains open."
        : finalStatus === "verifying"
          ? "Execution accepted; review remains open."
          : "Execution accepted.",
      92,
      7,
    );
    await progress.terminal(
      missionProofPending ? "FAILED" : "SUCCEEDED",
      missionProofPending
        ? "Mission execution needs a new proof-directed attempt."
        : finalStatus === "verifying"
          ? "Task finished and is awaiting verification."
          : "Task completed successfully.",
    );
    const [updated] = await db
      .select()
      .from(tasksTable)
      .where(eq(tasksTable.id, before.id))
      .limit(1);
    invalidateContextCache(before.projectId);
    return { ok: true, status: finalStatus, task: updated, executionId };
  } catch (error) {
    const cancelled = executionAbortController.signal.aborted
      || (error instanceof Error && error.name === "AbortError");
    const classification = classifyTaskExecutionFailure({ stage, cancelled });
    const failure = failureReceipt({
      executionId, correlationId, revision: params.workspaceRevision,
      provider: executionProvider, attempt: executionAttempt,
      durationMs: Date.now() - startedAt,
      stages,
      code: classification.code,
      failureClass: classification.failureClass,
      retryable: classification.retryable,
      cancelled,
    });
    const message = safeText(classification.code, 120);
    await progress.finish(
      stage === "context" ? "context" : "finalization",
      cancelled ? "cancelled" : "failed",
      cancelled ? "Execution was cancelled." : "Recording the execution failure.",
      stage === "context" ? 24 : 92,
      stage === "context" ? 2 : 7,
    );
    const finalized = await finalizeTaskExecutionAcceptance({
      executionId,
      workerId,
      task: before,
      receipt: failure,
      outcome: cancelled ? "INTERRUPTED" : "FAILED",
      terminalStatus: cancelled ? "cancelled" : "failed",
      reasonCode: classification.reasonCode,
      retryable: classification.retryable,
      trigger: params.trigger,
      finalStatus: rollbackStatus,
      error: message,
      logLevel: "error",
      logMessage: cancelled
        ? "AI task execution was cancelled"
        : "AI task execution failed",
      logMetadata: {
        stage,
        code: classification.code,
        failureClass: classification.failureClass,
        reasonCode: classification.reasonCode,
      },
    });
    if (finalized.accepted) {
      await progress.terminal(
        cancelled ? "INTERRUPTED" : "FAILED",
        cancelled ? "Task execution was cancelled." : "Task execution failed.",
      );
    }
    invalidateContextCache(before.projectId);
    return {
      ok: false,
      status: "failed",
      executionId,
      errorCode: classification.code,
      error: message,
    };
  } finally {
    clearInterval(heartbeat);
    unregisterAiExecutionController(executionId, executionAbortController);
  }
}