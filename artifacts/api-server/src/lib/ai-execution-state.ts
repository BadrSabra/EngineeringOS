import { createHash, randomUUID } from "node:crypto";
import { and, eq, gt, inArray, lt, sql } from "drizzle-orm";
import { db, aiExecutionsTable } from "@workspace/db";
import type { AiExecution } from "@workspace/db";
import type { ExecutionNode, FlightDeckEvidenceVerdict, RecipeReceipt } from "@workspace/ai-orchestrator";
import { formatUntrustedContent } from "@workspace/ai-orchestrator";

export const AI_EXECUTION_LEASE_MS = 5 * 60 * 1000;
export const AI_EXECUTION_CHECKPOINT_PREVIEW_LIMIT = 12_000;
export const AI_EXECUTION_TRACE_LIMIT = 80;
export const AI_EXECUTION_NODE_LIMIT = 24;
export const AI_EXECUTION_NODE_FILES_LIMIT = 48;
const activeControllers = new Map<string, AbortController>();

/**
 * The durable operation state is intentionally separate from the provider
 * lifecycle status. `ai_executions.status` answers "is a worker alive?", while
 * this state answers "which guarded operation stage owns the next action?"
 * Keeping both prevents a reconnect or provider response from being treated as
 * proof that a mutation, promotion, or delivery succeeded.
 */
export const AUTONOMOUS_OPERATION_STATES = [
  "planned",
  "inspecting",
  "mutating",
  "validating",
  "diagnosing",
  "repairing",
  "promoting",
  "delivering",
  "succeeded",
  "failed",
  "cancelled",
  "blocked",
  "uncertain",
] as const;
export type AutonomousOperationState = (typeof AUTONOMOUS_OPERATION_STATES)[number];
export type AutonomousOperationNodeKind =
  | "inspect"
  | "mutate"
  | "validate"
  | "diagnose"
  | "repair"
  | "promote"
  | "delivery";

export type AutonomousOperationNode = {
  id: string;
  kind: AutonomousOperationNodeKind;
  dependencies: string[];
  status: "queued" | "running" | "passed" | "failed" | "blocked";
  attempts: number;
  validationAttempts: number;
  allowedFiles: string[];
  validationProfile: string;
  evidenceRefs: string[];
};

export const RECIPE_OPERATION_PHASES = [
  "planned",
  "queued",
  "running",
  "mutating",
  "validating",
  "completed",
  "failed",
  "cancelled",
] as const;
export type RecipeOperationPhase = (typeof RECIPE_OPERATION_PHASES)[number];

export type RecipeOperationBudget = {
  maxNodes: number;
  maxParallelNodes: number;
  maxTotalTimeoutMs: number;
  maxProcessCount: number;
  maxOutputBytes: number;
};

export type RecipeOperationBinding = {
  projectId: string;
  operationId: string;
  sourceRevision: string;
  candidateIdentity: string | null;
  candidateWorkspace: string | null;
  approvedPaths: string[];
  phase: RecipeOperationPhase;
  leaseOwner: string | null;
  leaseUntil: string | null;
  missionBudget: RecipeOperationBudget;
  concurrencyBudget: {
    maxInFlightNodes: number;
    maxProcesses: number;
  };
};

export type RecipeBindingExpectation = {
  projectId?: string;
  operationId?: string;
  sourceRevision?: string;
  candidateIdentity?: string | null;
  candidateWorkspace?: string | null;
  leaseOwner?: string | null;
  phase?: RecipeOperationPhase;
  now?: Date;
  requireLease?: boolean;
  approvedPaths?: readonly string[];
};

export type RecipeBindingCheck = {
  allowed: boolean;
  reason:
    | "allowed"
    | "invalid_binding"
    | "project_mismatch"
    | "operation_mismatch"
    | "revision_mismatch"
    | "candidate_mismatch"
    | "workspace_mismatch"
    | "scope_mismatch"
    | "phase_mismatch"
    | "lease_owner_mismatch"
    | "lease_expired"
    | "budget_exceeded";
  detail: string;
};

const RECIPE_PATH_PATTERN = /^(?!\/)(?!.*(?:^|\/)\.\.(?:\/|$))(?!\.\.?$).+$/;

function normalizedRecipePath(value: string): string {
  return value.trim().replaceAll("\\", "/").replace(/^(\.\/)+/, "");
}

function validRecipeBudget(value: unknown): value is RecipeOperationBudget {
  if (!value || typeof value !== "object") return false;
  const budget = value as Partial<RecipeOperationBudget>;
  return Number.isInteger(budget.maxNodes) && budget.maxNodes! >= 1 && budget.maxNodes! <= AI_EXECUTION_NODE_LIMIT
    && Number.isInteger(budget.maxParallelNodes) && budget.maxParallelNodes! >= 1 && budget.maxParallelNodes! <= 8
    && Number.isInteger(budget.maxTotalTimeoutMs) && budget.maxTotalTimeoutMs! >= 1 && budget.maxTotalTimeoutMs! <= 900_000
    && Number.isInteger(budget.maxProcessCount) && budget.maxProcessCount! >= 1 && budget.maxProcessCount! <= 24
    && Number.isInteger(budget.maxOutputBytes) && budget.maxOutputBytes! >= 1 && budget.maxOutputBytes! <= 8 * 1024 * 1024;
}

function parseRecipeOperationBinding(value: unknown): RecipeOperationBinding | undefined {
  if (!value || typeof value !== "object") return undefined;
  const candidate = value as Partial<RecipeOperationBinding> & {
    concurrencyBudget?: Partial<RecipeOperationBinding["concurrencyBudget"]>;
  };
  const approvedPaths = Array.isArray(candidate.approvedPaths)
    ? candidate.approvedPaths.filter((item): item is string => typeof item === "string").map(normalizedRecipePath)
    : [];
  const leaseUntil = candidate.leaseUntil;
  const concurrencyBudget = candidate.concurrencyBudget;
  if (
    typeof candidate.projectId !== "string" || candidate.projectId.length < 1 || candidate.projectId.length > 160
    || typeof candidate.operationId !== "string" || candidate.operationId.length < 1 || candidate.operationId.length > 160
    || typeof candidate.sourceRevision !== "string" || candidate.sourceRevision.length < 1 || candidate.sourceRevision.length > 240
    || candidate.sourceRevision === "unbound"
    || (candidate.candidateIdentity !== null && typeof candidate.candidateIdentity !== "string")
    || (candidate.candidateWorkspace !== null && typeof candidate.candidateWorkspace !== "string")
    || !RECIPE_OPERATION_PHASES.includes(candidate.phase as RecipeOperationPhase)
    || (candidate.leaseOwner !== null && typeof candidate.leaseOwner !== "string")
    || (leaseUntil !== null && typeof leaseUntil !== "string")
    || (leaseUntil !== null && Number.isNaN(Date.parse(leaseUntil)))
    || approvedPaths.length > 48
    || approvedPaths.some((item) => !RECIPE_PATH_PATTERN.test(item))
    || !validRecipeBudget(candidate.missionBudget)
    || !concurrencyBudget
    || !Number.isInteger(concurrencyBudget.maxInFlightNodes)
    || concurrencyBudget.maxInFlightNodes < 1 || concurrencyBudget.maxInFlightNodes > 8
    || !Number.isInteger(concurrencyBudget.maxProcesses)
    || concurrencyBudget.maxProcesses < 1 || concurrencyBudget.maxProcesses > 24
  ) return undefined;
  return {
    projectId: candidate.projectId,
    operationId: candidate.operationId,
    sourceRevision: candidate.sourceRevision,
    candidateIdentity: candidate.candidateIdentity ?? null,
    candidateWorkspace: candidate.candidateWorkspace ?? null,
    approvedPaths: [...new Set(approvedPaths)],
    phase: candidate.phase as RecipeOperationPhase,
    leaseOwner: candidate.leaseOwner ?? null,
    leaseUntil: leaseUntil ?? null,
    missionBudget: { ...candidate.missionBudget },
    concurrencyBudget: {
      maxInFlightNodes: concurrencyBudget.maxInFlightNodes,
      maxProcesses: concurrencyBudget.maxProcesses,
    },
  };
}

export function createRecipeOperationBinding(params: {
  projectId: string;
  operationId: string;
  sourceRevision: string;
  candidateIdentity?: string | null;
  candidateWorkspace?: string | null;
  approvedPaths?: readonly string[];
  phase?: RecipeOperationPhase;
  leaseOwner?: string | null;
  leaseUntil?: Date | string | null;
  missionBudget?: Partial<RecipeOperationBudget>;
  concurrencyBudget?: Partial<RecipeOperationBinding["concurrencyBudget"]>;
}): RecipeOperationBinding {
  const binding = parseRecipeOperationBinding({
    projectId: params.projectId,
    operationId: params.operationId,
    sourceRevision: params.sourceRevision,
    candidateIdentity: params.candidateIdentity ?? null,
    candidateWorkspace: params.candidateWorkspace ?? null,
    approvedPaths: (params.approvedPaths ?? []).map(normalizedRecipePath),
    phase: params.phase ?? "planned",
    leaseOwner: params.leaseOwner ?? null,
    leaseUntil: params.leaseUntil instanceof Date ? params.leaseUntil.toISOString() : params.leaseUntil ?? null,
    missionBudget: {
      maxNodes: params.missionBudget?.maxNodes ?? AI_EXECUTION_NODE_LIMIT,
      maxParallelNodes: params.missionBudget?.maxParallelNodes ?? 3,
      maxTotalTimeoutMs: params.missionBudget?.maxTotalTimeoutMs ?? 900_000,
      maxProcessCount: params.missionBudget?.maxProcessCount ?? 24,
      maxOutputBytes: params.missionBudget?.maxOutputBytes ?? 8 * 1024 * 1024,
    },
    concurrencyBudget: {
      maxInFlightNodes: params.concurrencyBudget?.maxInFlightNodes ?? 3,
      maxProcesses: params.concurrencyBudget?.maxProcesses ?? 8,
    },
  });
  if (!binding) throw new Error("Invalid server-owned recipe operation binding.");
  return binding;
}

export function checkRecipeOperationBinding(
  binding: RecipeOperationBinding,
  expected: RecipeBindingExpectation = {},
): RecipeBindingCheck {
  const parsed = parseRecipeOperationBinding(binding);
  if (!parsed) return { allowed: false, reason: "invalid_binding", detail: "Recipe operation binding is invalid." };
  if (expected.projectId !== undefined && parsed.projectId !== expected.projectId) {
    return { allowed: false, reason: "project_mismatch", detail: "Recipe operation belongs to a different project." };
  }
  if (expected.operationId !== undefined && parsed.operationId !== expected.operationId) {
    return { allowed: false, reason: "operation_mismatch", detail: "Recipe operation identity does not match the durable execution." };
  }
  if (expected.sourceRevision !== undefined && parsed.sourceRevision !== expected.sourceRevision) {
    return { allowed: false, reason: "revision_mismatch", detail: "Recipe source revision is stale." };
  }
  if (expected.candidateIdentity !== undefined && parsed.candidateIdentity !== expected.candidateIdentity) {
    return { allowed: false, reason: "candidate_mismatch", detail: "Recipe candidate identity does not match the durable execution." };
  }
  if (expected.candidateWorkspace !== undefined && parsed.candidateWorkspace !== expected.candidateWorkspace) {
    return { allowed: false, reason: "workspace_mismatch", detail: "Recipe candidate workspace does not match the durable execution." };
  }
  if (expected.phase !== undefined && parsed.phase !== expected.phase) {
    return { allowed: false, reason: "phase_mismatch", detail: "Recipe operation is not in the required phase." };
  }
  if (expected.leaseOwner !== undefined && parsed.leaseOwner !== expected.leaseOwner) {
    return { allowed: false, reason: "lease_owner_mismatch", detail: "Recipe worker does not own the operation lease." };
  }
  if (expected.approvedPaths !== undefined) {
    const approved = new Set(parsed.approvedPaths);
    const outside = expected.approvedPaths.map(normalizedRecipePath).find((item) => !approved.has(item));
    if (outside) return { allowed: false, reason: "scope_mismatch", detail: "Recipe action is outside the approved path scope." };
  }
  if (expected.requireLease && (!parsed.leaseOwner || !parsed.leaseUntil
    || Date.parse(parsed.leaseUntil) <= (expected.now ?? new Date()).getTime())) {
    return { allowed: false, reason: "lease_expired", detail: "Recipe operation lease is missing or expired." };
  }
  if (parsed.missionBudget.maxParallelNodes > parsed.concurrencyBudget.maxInFlightNodes
    || parsed.missionBudget.maxProcessCount > parsed.concurrencyBudget.maxProcesses) {
    return { allowed: false, reason: "budget_exceeded", detail: "Recipe mission budget exceeds its concurrency budget." };
  }
  return { allowed: true, reason: "allowed", detail: "Recipe operation binding is authorized." };
}

export function assertRecipeOperationBinding(binding: RecipeOperationBinding, expected: RecipeBindingExpectation = {}): void {
  const result = checkRecipeOperationBinding(binding, expected);
  if (!result.allowed) throw new Error(`Recipe operation binding rejected: ${result.reason}`);
}

export function assertRecipeNodeBinding(
  binding: RecipeOperationBinding,
  node: Pick<ExecutionNode, "allowedFiles" | "validationProfile" | "executionContext">,
  expected: RecipeBindingExpectation = {},
): void {
  assertRecipeOperationBinding(binding, expected);
  const approved = new Set(binding.approvedPaths);
  if (node.allowedFiles.map(normalizedRecipePath).some((file) => !approved.has(file))) {
    throw new Error("Recipe node is outside the approved path scope.");
  }
  if (node.executionContext) {
    if (node.executionContext.projectId !== binding.projectId) throw new Error("Recipe node belongs to a different project.");
    if (node.executionContext.revision !== binding.sourceRevision) throw new Error("Recipe node belongs to a stale source revision.");
    if (node.executionContext.scope.paths.map(normalizedRecipePath).some((file) => !approved.has(file))) {
      throw new Error("Recipe node context is outside the approved path scope.");
    }
  }
  if (!node.validationProfile.trim()) throw new Error("Recipe node has no registered validation profile.");
}

export type AutonomousAcceptanceCheck = {
  id: string;
  kind: "scope" | "behavior" | "validation" | "evidence";
  description: string;
  required: boolean;
};

export type AutonomousOperationContract = {
  operationId: string;
  objective: string;
  revisionManifest: string;
  planHash: string;
  policyRevision: string;
  candidateIdentity: string | null;
  targetPaths: string[];
  expectedBehavior: string;
  acceptanceChecks: AutonomousAcceptanceCheck[];
  state: AutonomousOperationState;
  nodes: AutonomousOperationNode[];
  retryBudget: number;
  repairAttempts: number;
  evidenceRefs: string[];
  binding?: RecipeOperationBinding;
  updatedAt: string;
};

const OPERATION_TRANSITIONS: Record<AutonomousOperationState, readonly AutonomousOperationState[]> = {
  planned: ["inspecting", "blocked", "cancelled"],
  inspecting: ["mutating", "validating", "blocked", "cancelled", "failed"],
  mutating: ["validating", "blocked", "cancelled", "uncertain", "failed"],
  validating: ["succeeded", "diagnosing", "promoting", "blocked", "cancelled", "uncertain", "failed"],
  diagnosing: ["repairing", "blocked", "cancelled", "failed"],
  repairing: ["validating", "blocked", "cancelled", "uncertain", "failed"],
  promoting: ["delivering", "blocked", "cancelled", "uncertain", "failed"],
  delivering: ["succeeded", "blocked", "cancelled", "uncertain", "failed"],
  succeeded: [],
  failed: [],
  cancelled: [],
  blocked: [],
  uncertain: [],
};

export function transitionAutonomousOperation(
  operation: AutonomousOperationContract,
  nextState: AutonomousOperationState,
  evidenceRefs: readonly string[] = [],
): AutonomousOperationContract {
  if (operation.state === nextState) return operation;
  if (!OPERATION_TRANSITIONS[operation.state].includes(nextState)) {
    throw new Error(`Illegal autonomous operation transition: ${operation.state} -> ${nextState}`);
  }
  if (["succeeded", "promoting", "delivering"].includes(nextState)
    && operation.nodes.some((node) => node.status === "failed" || node.status === "blocked")) {
    throw new Error("Autonomous operation cannot advance with failed or blocked nodes.");
  }
  if (nextState === "succeeded") {
    const completion = validateAutonomousOperationCompletion(operation, {
      evidenceRefs,
      evidenceVerdict: "PROVEN",
    });
    if (!completion.allowed) {
      throw new Error(`Autonomous operation success is blocked: ${completion.reasons.join("; ")}`);
    }
  }
  return {
    ...operation,
    state: nextState,
    evidenceRefs: [...new Set([...operation.evidenceRefs, ...evidenceRefs])].slice(0, 48),
    updatedAt: new Date().toISOString(),
  };
}

export type AutonomousOperationCompletionCheck = {
  allowed: boolean;
  reasons: string[];
};

/**
 * The terminal success contract for autonomous work. This is deliberately
 * server-side and receipt-oriented: a provider response or a completed worker
 * lease is not evidence that the requested bytes or behavior were accepted.
 */
export function validateAutonomousOperationCompletion(
  operation: AutonomousOperationContract,
  params: {
    evidenceRefs?: readonly string[];
    evidenceVerdict?: FlightDeckEvidenceVerdict;
    workspaceRevision?: string;
    candidateIdentity?: string | null;
    nodeStates?: readonly Pick<AutonomousOperationNode, "status" | "evidenceRefs">[];
  } = {},
): AutonomousOperationCompletionCheck {
  const reasons: string[] = [];
  if (!operation.objective.trim()) reasons.push("objective is missing");
  if (!operation.revisionManifest.trim() || operation.revisionManifest === "unbound") {
    reasons.push("workspace revision is unbound");
  }
  if (!operation.expectedBehavior.trim()) reasons.push("expected behavior is missing");
  if (operation.acceptanceChecks.length === 0) reasons.push("acceptance checks are missing");
  if (params.workspaceRevision && operation.revisionManifest !== params.workspaceRevision) {
    reasons.push("workspace revision does not match the execution request");
  }
  if (params.candidateIdentity !== undefined && operation.candidateIdentity !== params.candidateIdentity) {
    reasons.push("candidate identity does not match the operation");
  }
  const requiredChecks = operation.acceptanceChecks.filter((check) => check.required);
  if (requiredChecks.some((check) => !check.id || !check.description.trim())) {
    reasons.push("acceptance checks are not executable");
  }
  const nodes = params.nodeStates ?? operation.nodes;
  if (nodes.some((node) => node.status !== "passed")) reasons.push("not all execution nodes passed");
  const mutatingOperation = operation.nodes.some((node) =>
    ["mutate", "repair", "promote", "delivery"].includes(node.kind),
  );
  if (mutatingOperation && operation.targetPaths.length === 0) {
    reasons.push("mutating operation has no approved target scope");
  }
  if (operation.targetPaths.length > 0) {
    const approved = new Set(operation.targetPaths);
    const outOfScope = operation.nodes
      .flatMap((node) => node.allowedFiles)
      .find((file) => !approved.has(file));
    if (outOfScope) reasons.push(`execution node is outside approved target scope: ${outOfScope}`);
  }
  const refs = [...new Set([
    ...operation.evidenceRefs,
    ...(params.evidenceRefs ?? []),
    ...nodes.flatMap((node) => node.evidenceRefs),
  ])];
  if (refs.length === 0) reasons.push("required acceptance evidence is missing");
  if (params.evidenceVerdict !== "PROVEN") {
    reasons.push(`evidence verdict is ${params.evidenceVerdict ?? "NOT_RECORDED"}`);
  }
  return { allowed: reasons.length === 0, reasons };
}

export function assertAutonomousOperationIdentity(
  original: AutonomousOperationContract,
  candidate: AutonomousOperationContract,
): void {
  for (const key of [
    "operationId",
    "objective",
    "revisionManifest",
    "planHash",
    "policyRevision",
    "candidateIdentity",
    "expectedBehavior",
  ] as const) {
    if (original[key] !== candidate[key]) {
      throw new Error(`Autonomous operation identity changed: ${key}`);
    }
  }
  if (!sameStringArray(original.targetPaths, candidate.targetPaths)) {
    throw new Error("Autonomous operation identity changed: targetPaths");
  }
  if (JSON.stringify(original.acceptanceChecks) !== JSON.stringify(candidate.acceptanceChecks)) {
    throw new Error("Autonomous operation acceptance checks changed without policy approval.");
  }
  if (candidate.retryBudget < 0 || candidate.repairAttempts < 0 || candidate.repairAttempts > candidate.retryBudget) {
    throw new Error("Autonomous operation retry budget is invalid.");
  }
}

export type AiExecutionRequestEnvelope = {
  projectId: string;
  /** Stable server-owned identity shared by all phases of one operation. */
  operationId?: string;
  sessionId?: string;
  message: string;
  modelMessage: string;
  /** Workspace revision captured when this durable analysis operation began. */
  workspaceRevision?: string;
  linkedTaskId?: string;
  buildPlanMessageId?: string;
  objective?: unknown;
  validationTargetPaths: string[];
  proofRequired?: boolean;
};

export type AiExecutionNodeCheckpoint = Pick<
  ExecutionNode,
  | "id"
  | "title"
  | "status"
  | "allowedFiles"
  | "dependencies"
  | "validationProfile"
  | "attempts"
  | "validationAttempts"
  | "lastFailure"
> & {
  evidenceRefs?: string[];
};

export type AiExecutionCheckpoint = {
  stage:
    | "queued"
    | "running"
    | "client_disconnected"
    | "model_call"
    | "tool_loop"
    | "finalizing"
    | "completed"
    | "failed"
    | "cancelled";
  sequence: number;
  streamedPreview?: string;
  recentSteps?: Array<Record<string, unknown>>;
  nodeStates?: AiExecutionNodeCheckpoint[];
  currentNode?: string;
  completedNodes?: string[];
  evidenceVerdict?: FlightDeckEvidenceVerdict;
  evidenceReason?: string;
  proofRequired?: boolean;
  detail?: string;
  operation?: AutonomousOperationContract;
  recipeBinding?: RecipeOperationBinding;
  updatedAt: string;
};

const AI_EXECUTION_CHECKPOINT_STAGES = new Set<AiExecutionCheckpoint["stage"]>([
  "queued",
  "running",
  "client_disconnected",
  "model_call",
  "tool_loop",
  "finalizing",
  "completed",
  "failed",
  "cancelled",
]);

export function hashResumeToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

export function createResumeToken(): string {
  return randomUUID().replaceAll("-", "") + randomUUID().replaceAll("-", "");
}

export function createAutonomousOperationContract(params: {
  operationId: string;
  objective: string;
  revisionManifest?: string;
  planHash?: string;
  policyRevision?: string;
  candidateIdentity?: string | null;
  targetPaths?: string[];
  expectedBehavior?: string;
  acceptanceChecks?: AutonomousAcceptanceCheck[];
  nodes?: AutonomousOperationNode[];
  binding?: RecipeOperationBinding;
}): AutonomousOperationContract {
  const objective = params.objective.slice(0, 2_000);
  if (params.binding && params.binding.operationId !== params.operationId) {
    throw new Error("Recipe operation binding identity does not match the operation.");
  }
  return {
    operationId: params.operationId,
    objective,
    revisionManifest: (params.revisionManifest ?? "unbound").slice(0, 2_000),
    planHash: params.planHash ?? createHash("sha256").update(objective).digest("hex"),
    policyRevision: params.policyRevision ?? "server-policy-v1",
    candidateIdentity: params.candidateIdentity ?? null,
    targetPaths: [...new Set((params.targetPaths ?? []).filter(Boolean))].slice(0, 48),
    expectedBehavior: (params.expectedBehavior ?? objective).slice(0, 2_000),
    acceptanceChecks: (params.acceptanceChecks ?? [
      {
        id: "validation-passed",
        kind: "validation",
        description: "Registered validation passes for the approved scope.",
        required: true,
      },
      {
        id: "evidence-bound",
        kind: "evidence",
        description: "Completion evidence is bound to this operation and revision.",
        required: true,
      },
    ]).slice(0, 12),
    state: "planned",
    nodes: params.nodes ?? [],
    retryBudget: 3,
    repairAttempts: 0,
    evidenceRefs: [],
    ...(params.binding ? { binding: params.binding } : {}),
    updatedAt: new Date().toISOString(),
  };
}

export function parseExecutionRequest(raw: string): AiExecutionRequestEnvelope | undefined {
  try {
    const value = JSON.parse(raw) as AiExecutionRequestEnvelope;
    if (
      !value ||
      typeof value.projectId !== "string" ||
      (value.operationId !== undefined && typeof value.operationId !== "string") ||
      (value.sessionId !== undefined && typeof value.sessionId !== "string") ||
      typeof value.message !== "string" ||
      typeof value.modelMessage !== "string" ||
      !Array.isArray(value.validationTargetPaths)
    ) {
      return undefined;
    }
    return value;
  } catch {
    return undefined;
  }
}

export function parseAiExecutionCheckpoint(raw: string): AiExecutionCheckpoint | undefined {
  try {
    const value = JSON.parse(raw) as Partial<AiExecutionCheckpoint>;
    if (
      !value ||
      typeof value.stage !== "string" ||
      !AI_EXECUTION_CHECKPOINT_STAGES.has(value.stage as AiExecutionCheckpoint["stage"]) ||
      typeof value.sequence !== "number" ||
      !Number.isFinite(value.sequence) ||
      typeof value.updatedAt !== "string"
    ) {
      return undefined;
    }
    const nodeStates = Array.isArray(value.nodeStates)
      ? value.nodeStates
        .slice(0, AI_EXECUTION_NODE_LIMIT)
        .flatMap((node) => {
          if (!node || typeof node !== "object") return [];
          const candidate = node as Partial<AiExecutionNodeCheckpoint>;
          if (
            typeof candidate.id !== "string" ||
            typeof candidate.title !== "string" ||
            !["queued", "running", "passed", "failed", "blocked"].includes(candidate.status ?? "") ||
            !Array.isArray(candidate.allowedFiles) ||
            !Array.isArray(candidate.dependencies) ||
            typeof candidate.validationProfile !== "string" ||
            typeof candidate.attempts !== "number" ||
            !Number.isInteger(candidate.attempts) ||
            candidate.attempts < 0 ||
            candidate.attempts > 3 ||
            (candidate.validationAttempts !== undefined && (
              typeof candidate.validationAttempts !== "number"
              || !Number.isInteger(candidate.validationAttempts)
              || candidate.validationAttempts < 0
              || candidate.validationAttempts > 3
            ))
            || (candidate.lastFailure !== undefined && (
              !candidate.lastFailure
              || typeof candidate.lastFailure !== "object"
              || !["failed", "blocked"].includes((candidate.lastFailure as { status?: unknown }).status as string)
              || typeof (candidate.lastFailure as { attempt?: unknown }).attempt !== "number"
              || !Number.isInteger((candidate.lastFailure as { attempt: number }).attempt)
              || (candidate.lastFailure as { attempt: number }).attempt < 1
              || (candidate.lastFailure as { attempt: number }).attempt > 3
              || typeof (candidate.lastFailure as { validationAttempts?: unknown }).validationAttempts !== "number"
              || !Number.isInteger((candidate.lastFailure as { validationAttempts: number }).validationAttempts)
              || (candidate.lastFailure as { validationAttempts: number }).validationAttempts < 0
              || (candidate.lastFailure as { validationAttempts: number }).validationAttempts > 3
              || typeof (candidate.lastFailure as { detail?: unknown }).detail !== "string"
            ))
          ) return [];
          return [{
            id: candidate.id.slice(0, 160),
            title: candidate.title.slice(0, 240),
            status: candidate.status as AiExecutionNodeCheckpoint["status"],
            allowedFiles: candidate.allowedFiles
              .filter((file): file is string => typeof file === "string")
              .slice(0, AI_EXECUTION_NODE_FILES_LIMIT)
              .map((file) => file.slice(0, 500)),
            dependencies: candidate.dependencies
              .filter((dependency): dependency is string => typeof dependency === "string")
              .slice(0, 12)
              .map((dependency) => dependency.slice(0, 160)),
            validationProfile: candidate.validationProfile as AiExecutionNodeCheckpoint["validationProfile"],
            attempts: candidate.attempts,
            validationAttempts: candidate.validationAttempts ?? 0,
            ...(Array.isArray(candidate.evidenceRefs) ? { evidenceRefs: candidate.evidenceRefs
              .filter((ref): ref is string => typeof ref === "string")
              .slice(0, 8)
              .map((ref) => ref.slice(0, 500)) } : {}),
            ...(candidate.lastFailure
              ? {
                  lastFailure: {
                    status: (candidate.lastFailure as { status: "failed" | "blocked" }).status,
                    attempt: (candidate.lastFailure as { attempt: number }).attempt,
                    validationAttempts: (candidate.lastFailure as { validationAttempts: number }).validationAttempts,
                    detail: (candidate.lastFailure as { detail: string }).detail.slice(0, 4_000),
                  },
                }
              : {}),
          }];
        })
      : undefined;
    const operation = value.operation && typeof value.operation === "object"
      ? parseAutonomousOperation(value.operation)
      : undefined;
    if (value.operation !== undefined && !operation) return undefined;
    const recipeBinding = value.recipeBinding === undefined
      ? operation?.binding
      : parseRecipeOperationBinding(value.recipeBinding);
    if (value.recipeBinding !== undefined && !recipeBinding) return undefined;
    if (recipeBinding && operation?.binding
      && JSON.stringify(recipeBinding) !== JSON.stringify(operation.binding)) return undefined;
    return {
      stage: value.stage as AiExecutionCheckpoint["stage"],
      sequence: value.sequence,
      ...(typeof value.streamedPreview === "string"
        ? { streamedPreview: value.streamedPreview.slice(-AI_EXECUTION_CHECKPOINT_PREVIEW_LIMIT) }
        : {}),
      ...(Array.isArray(value.recentSteps)
        ? { recentSteps: value.recentSteps.slice(-AI_EXECUTION_TRACE_LIMIT) as Array<Record<string, unknown>> }
        : {}),
      ...(nodeStates && nodeStates.length > 0 ? { nodeStates } : {}),
      ...(typeof value.currentNode === "string" ? { currentNode: value.currentNode.slice(0, 160) } : {}),
      ...(Array.isArray(value.completedNodes)
        ? {
            completedNodes: value.completedNodes
              .filter((nodeId): nodeId is string => typeof nodeId === "string")
              .slice(0, AI_EXECUTION_NODE_LIMIT)
              .map((nodeId) => nodeId.slice(0, 160)),
          }
        : {}),
      ...(typeof value.evidenceVerdict === "string" &&
        ["PROVEN", "PARTIAL", "UNAVAILABLE", "BLOCKED", "NOT_RECORDED"].includes(value.evidenceVerdict)
        ? { evidenceVerdict: value.evidenceVerdict as FlightDeckEvidenceVerdict }
        : {}),
      ...(typeof value.evidenceReason === "string"
        ? { evidenceReason: value.evidenceReason.slice(0, 500) }
        : {}),
      ...(typeof value.proofRequired === "boolean" ? { proofRequired: value.proofRequired } : {}),
      ...(typeof value.detail === "string" ? { detail: value.detail.slice(0, 500) } : {}),
      ...(operation ? { operation } : {}),
      ...(recipeBinding ? { recipeBinding } : {}),
      updatedAt: value.updatedAt,
    };
  } catch {
    return undefined;
  }
}

function parseAutonomousOperation(value: unknown): AutonomousOperationContract | undefined {
  if (!value || typeof value !== "object") return undefined;
  const candidate = value as Partial<AutonomousOperationContract>;
  if (
    typeof candidate.operationId !== "string"
    || typeof candidate.objective !== "string"
    || typeof candidate.revisionManifest !== "string"
    || typeof candidate.planHash !== "string"
    || typeof candidate.policyRevision !== "string"
    || (candidate.candidateIdentity !== null && typeof candidate.candidateIdentity !== "string")
    || !AUTONOMOUS_OPERATION_STATES.includes(candidate.state as AutonomousOperationState)
    || !Array.isArray(candidate.nodes)
    || !Number.isInteger(candidate.retryBudget)
    || !Number.isInteger(candidate.repairAttempts)
    || !Array.isArray(candidate.evidenceRefs)
    || typeof candidate.updatedAt !== "string"
  ) return undefined;
  const nodes = candidate.nodes.slice(0, AI_EXECUTION_NODE_LIMIT).flatMap((node) => {
    if (!node || typeof node !== "object") return [];
    const item = node as Partial<AutonomousOperationNode>;
    if (
      typeof item.id !== "string" || !["inspect", "mutate", "validate", "diagnose", "repair", "promote", "delivery"].includes(item.kind ?? "")
      || !["queued", "running", "passed", "failed", "blocked"].includes(item.status ?? "")
      || !Array.isArray(item.dependencies) || !Array.isArray(item.allowedFiles)
      || !Array.isArray(item.evidenceRefs) || typeof item.validationProfile !== "string"
      || !Number.isInteger(item.attempts) || !Number.isInteger(item.validationAttempts)
    ) return [];
    const attempts = item.attempts as number;
    const validationAttempts = item.validationAttempts as number;
    return [{
      id: item.id.slice(0, 160),
      kind: item.kind as AutonomousOperationNodeKind,
      dependencies: item.dependencies.filter((v): v is string => typeof v === "string").slice(0, 12),
      status: item.status as AutonomousOperationNode["status"],
      attempts: Math.max(0, Math.min(attempts, 3)),
      validationAttempts: Math.max(0, Math.min(validationAttempts, 3)),
      allowedFiles: item.allowedFiles.filter((v): v is string => typeof v === "string").slice(0, AI_EXECUTION_NODE_FILES_LIMIT),
      validationProfile: item.validationProfile.slice(0, 120),
      evidenceRefs: item.evidenceRefs.filter((v): v is string => typeof v === "string").slice(0, 8),
    }];
  });
  const acceptanceChecks = (candidate.acceptanceChecks ?? []).slice(0, 12).flatMap((check) => {
    if (!check || typeof check !== "object") return [];
    const item = check as Partial<AutonomousAcceptanceCheck>;
    if (
      typeof item.id !== "string"
      || !["scope", "behavior", "validation", "evidence"].includes(item.kind ?? "")
      || typeof item.description !== "string"
      || typeof item.required !== "boolean"
    ) return [];
    return [{
      id: item.id.slice(0, 120),
      kind: item.kind as AutonomousAcceptanceCheck["kind"],
      description: item.description.slice(0, 500),
      required: item.required,
    }];
  });
  const retryBudget = candidate.retryBudget as number;
  const repairAttempts = candidate.repairAttempts as number;
  if (nodes.length !== candidate.nodes.length
    || (candidate.acceptanceChecks && acceptanceChecks.length !== candidate.acceptanceChecks.length)
    || retryBudget < 0 || repairAttempts < 0
    || repairAttempts > retryBudget) return undefined;
  const binding = candidate.binding === undefined ? undefined : parseRecipeOperationBinding(candidate.binding);
  if (candidate.binding !== undefined && !binding) return undefined;
  if (binding && binding.operationId !== candidate.operationId) return undefined;
  return {
    operationId: candidate.operationId.slice(0, 160),
    objective: candidate.objective.slice(0, 2_000),
    revisionManifest: candidate.revisionManifest.slice(0, 2_000),
    planHash: candidate.planHash.slice(0, 160),
    policyRevision: candidate.policyRevision.slice(0, 160),
    candidateIdentity: candidate.candidateIdentity ? candidate.candidateIdentity.slice(0, 500) : null,
    targetPaths: (candidate.targetPaths ?? []).filter((v): v is string => typeof v === "string").slice(0, 48),
    expectedBehavior: typeof candidate.expectedBehavior === "string" ? candidate.expectedBehavior.slice(0, 2_000) : "",
    acceptanceChecks,
    state: candidate.state as AutonomousOperationState,
    nodes,
    retryBudget: Math.min(retryBudget, 8),
    repairAttempts: Math.min(repairAttempts, 8),
    evidenceRefs: candidate.evidenceRefs.filter((v): v is string => typeof v === "string").slice(0, 48),
    ...(binding ? { binding } : {}),
    updatedAt: candidate.updatedAt,
  };
}

function operationStateForCheckpoint(stage: AiExecutionCheckpoint["stage"]): AutonomousOperationState | undefined {
  if (stage === "model_call") return "inspecting";
  if (stage === "tool_loop") return "mutating";
  if (stage === "finalizing") return "validating";
  if (stage === "failed") return "failed";
  if (stage === "cancelled" || stage === "client_disconnected") return "cancelled";
  return undefined;
}

function advanceOperationForCheckpoint(
  operation: AutonomousOperationContract,
  stage: AiExecutionCheckpoint["stage"],
): AutonomousOperationContract {
  const target = operationStateForCheckpoint(stage);
  if (!target || operation.state === target) return operation;
  // A stage-only writer may resume directly at tool_loop after a process
  // restart. The server fills only the known prerequisite transition; it
  // never accepts a provider's assertion as a skipped graph edge.
  const bridge: Partial<Record<AutonomousOperationState, AutonomousOperationState>> = {
    planned: "inspecting",
    inspecting: "mutating",
    mutating: "validating",
  };
  let current = operation;
  while (current.state !== target) {
    const next = bridge[current.state];
    if (!next) {
      if (target === "failed" || target === "cancelled") {
        return transitionAutonomousOperation(current, target);
      }
      return current;
    }
    current = transitionAutonomousOperation(current, next);
  }
  return current;
}

function sameStringArray(left: readonly string[], right: readonly string[]): boolean {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}

/**
 * Reconcile checkpointed node progress with the server-owned plan that will be
 * resumed. The checkpoint may advance status and attempts, but it must never
 * redefine a node's title, scope, dependency graph, or validation profile.
 * Returning undefined is an intentional fail-closed signal for stale/mixed
 * execution state.
 */
export function reconcileExecutionNodeCheckpoint(
  planNodes: readonly ExecutionNode[],
  checkpointNodes: AiExecutionCheckpoint["nodeStates"] | undefined,
): ExecutionNode[] | undefined {
  if (!checkpointNodes || checkpointNodes.length === 0) return [...planNodes];
  if (planNodes.length !== checkpointNodes.length) return undefined;

  const checkpointById = new Map(checkpointNodes.map((node) => [node.id, node]));
  if (checkpointById.size !== planNodes.length) return undefined;

  for (const planNode of planNodes) {
    const checkpointNode = checkpointById.get(planNode.id);
    if (
      !checkpointNode
      || !sameStringArray(planNode.allowedFiles, checkpointNode.allowedFiles)
      || !sameStringArray(planNode.dependencies, checkpointNode.dependencies)
      || planNode.validationProfile !== checkpointNode.validationProfile
      || checkpointNode.attempts < planNode.attempts
      || checkpointNode.validationAttempts < planNode.validationAttempts
      || (planNode.lastFailure
        && (
          planNode.lastFailure.status !== checkpointNode.lastFailure?.status
          || planNode.lastFailure.attempt > (checkpointNode.lastFailure?.attempt ?? 0)
        ))
      || (planNode.status === "passed" && checkpointNode.status !== "passed")
      || (planNode.status === "blocked" && checkpointNode.status !== "blocked")
      || (checkpointNode.status === "running" && checkpointNode.attempts < 1)
    ) {
      return undefined;
    }
  }

  return planNodes.map((planNode) => {
    const checkpointNode = checkpointById.get(planNode.id)!;
    return {
      ...planNode,
      status: checkpointNode.status,
      attempts: checkpointNode.attempts,
      validationAttempts: checkpointNode.validationAttempts,
      ...(checkpointNode.lastFailure ? { lastFailure: checkpointNode.lastFailure } : {}),
    };
  });
}

/**
 * Turns the last durable checkpoint into server-owned continuation context.
 * The provider still needs a fresh call after a process crash, but it receives
 * the bounded checkpoint and can continue from the last observed stage instead
 * of blindly replaying the original user request.
 */
export function buildAiExecutionResumeContext(
  checkpoint: AiExecutionCheckpoint | undefined,
): string {
  if (!checkpoint || checkpoint.stage === "queued") return "";
  return [
    "SERVER-OWNED DURABLE RESUME CONTEXT",
    "The previous worker stopped unexpectedly. Continue the same execution from the checkpoint below.",
    "Do not claim that any step succeeded unless the current tool result or persisted evidence confirms it.",
    "Do not repeat a completed deferred write or apply action; writes remain approval-gated.",
    formatUntrustedContent(JSON.stringify(checkpoint), {
      source: "checkpoint",
      revision: checkpoint.updatedAt,
    }),
  ].join("\n");
}

export async function createAiExecution(params: {
  userId: string;
  request: AiExecutionRequestEnvelope;
  idempotencyKey: string;
  correlationId?: string;
  attempt?: number;
  projectId: string;
  sessionId?: string;
  linkedTaskId?: string;
  buildPlanMessageId?: string;
  recipeBinding?: RecipeOperationBinding;
}): Promise<{ execution: AiExecution; resumeToken?: string; created: boolean }> {
  if (params.recipeBinding) {
    assertRecipeOperationBinding(params.recipeBinding, {
      projectId: params.projectId,
      operationId: params.request.operationId,
      sourceRevision: params.request.workspaceRevision,
    });
  }
  const existing = await db
    .select()
    .from(aiExecutionsTable)
    .where(and(
      eq(aiExecutionsTable.userId, params.userId),
      eq(aiExecutionsTable.idempotencyKey, params.idempotencyKey),
    ))
    .limit(1);
  if (existing[0]) {
    const row = existing[0];
    const storedRequest = parseExecutionRequest(row.request);
    if (!storedRequest || storedRequest.projectId !== params.projectId || storedRequest.sessionId !== params.sessionId) {
      throw new Error("Execution idempotency key is bound to a different request");
    }
    return { execution: row, created: false };
  }

  const resumeToken = createResumeToken();
  const now = new Date();
  const executionId = randomUUID();
  const operationId = params.request.operationId ?? params.buildPlanMessageId ?? executionId;
  const operation = createAutonomousOperationContract({
    operationId,
    objective: typeof params.request.objective === "string"
      ? params.request.objective
      : params.request.message,
    revisionManifest: params.request.workspaceRevision,
    targetPaths: params.request.validationTargetPaths,
    expectedBehavior: params.request.message,
    ...(params.recipeBinding ? { binding: params.recipeBinding } : {}),
  });
  const [execution] = await db
    .insert(aiExecutionsTable)
    .values({
      id: executionId,
      projectId: params.projectId,
      sessionId: params.sessionId ?? null,
      operationId,
      linkedTaskId: params.linkedTaskId ?? null,
      buildPlanMessageId: params.buildPlanMessageId ?? null,
      userId: params.userId,
      idempotencyKey: params.idempotencyKey,
      correlationId: params.correlationId ?? null,
      attempt: params.attempt ?? 0,
      resumeTokenHash: hashResumeToken(resumeToken),
      request: JSON.stringify(params.request),
      checkpoint: JSON.stringify({
        stage: "queued",
        sequence: 0,
        operation,
        ...(params.recipeBinding ? { recipeBinding: params.recipeBinding } : {}),
        updatedAt: now.toISOString(),
      } satisfies AiExecutionCheckpoint),
      status: "queued",
      createdAt: now,
      updatedAt: now,
    })
    .onConflictDoNothing({
      target: [aiExecutionsTable.userId, aiExecutionsTable.idempotencyKey],
    })
    .returning();

  if (execution) return { execution, resumeToken, created: true };

  // Another identical request won the unique-key race. Re-read the row rather
  // than surfacing the expected conflict, so both callers get the same
  // resumable execution identity. Keep the request binding check here as well:
  // a conflicting key must never allow a different request to reuse it.
  const [racedExecution] = await db
    .select()
    .from(aiExecutionsTable)
    .where(and(
      eq(aiExecutionsTable.userId, params.userId),
      eq(aiExecutionsTable.idempotencyKey, params.idempotencyKey),
    ))
    .limit(1);
  if (!racedExecution) throw new Error("Failed to create AI execution");
  const racedRequest = parseExecutionRequest(racedExecution.request);
  if (!racedRequest || racedRequest.projectId !== params.projectId || racedRequest.sessionId !== params.sessionId) {
    throw new Error("Execution idempotency key is bound to a different request");
  }
  return { execution: racedExecution, created: false };
}

export async function getAiExecutionForUser(
  executionId: string,
  userId: string,
): Promise<AiExecution | undefined> {
  const [execution] = await db
    .select()
    .from(aiExecutionsTable)
    .where(and(
      eq(aiExecutionsTable.id, executionId),
      eq(aiExecutionsTable.userId, userId),
    ))
    .limit(1);
  return execution;
}

export type RecipeNodeAuthorizationPhase = "start" | "completion" | "retry";

export async function authorizeRecipeNodeExecution(params: {
  executionId: string;
  userId: string;
  workerId: string;
  binding: RecipeOperationBinding;
  phase: RecipeNodeAuthorizationPhase;
}): Promise<{ allowed: boolean; reason?: string }> {
  const execution = await getAiExecutionForUser(params.executionId, params.userId);
  if (!execution) return { allowed: false, reason: "durable execution row is missing" };
  if (execution.status === "cancelled" || execution.cancelRequestedAt) {
    return { allowed: false, reason: "durable execution is cancelled" };
  }
  if (execution.status !== "running") {
    return { allowed: false, reason: `durable execution status is ${execution.status}` };
  }
  if (execution.workerId !== params.workerId) {
    return { allowed: false, reason: "recipe lease owner changed" };
  }
  if (!execution.leaseUntil || execution.leaseUntil <= new Date()) {
    return { allowed: false, reason: "recipe lease expired" };
  }
  const checkpoint = parseAiExecutionCheckpoint(execution.checkpoint);
  const storedBinding = checkpoint?.recipeBinding;
  if (!storedBinding) return { allowed: false, reason: "durable recipe binding is missing" };
  if (storedBinding.sourceRevision !== params.binding.sourceRevision) {
    return { allowed: false, reason: "recipe source revision drifted" };
  }
  if (storedBinding.candidateIdentity !== params.binding.candidateIdentity) {
    return { allowed: false, reason: "recipe candidate identity changed" };
  }
  if (storedBinding.candidateWorkspace !== params.binding.candidateWorkspace) {
    return { allowed: false, reason: "recipe candidate workspace changed" };
  }
  if (storedBinding.leaseOwner !== params.workerId) {
    return { allowed: false, reason: "durable recipe binding lease owner changed" };
  }
  try {
    assertRecipeOperationBinding(params.binding, {
      projectId: execution.projectId,
      operationId: execution.operationId ?? undefined,
      sourceRevision: parseExecutionRequest(execution.request)?.workspaceRevision,
      candidateIdentity: storedBinding.candidateIdentity,
      candidateWorkspace: storedBinding.candidateWorkspace,
      leaseOwner: params.workerId,
      requireLease: true,
      now: new Date(),
    });
  } catch {
    return { allowed: false, reason: `recipe binding rejected before ${params.phase}` };
  }
  return { allowed: true };
}

export async function recoverAiExecutionResumeToken(params: {
  executionId: string;
  userId: string;
}): Promise<{ execution: AiExecution; resumeToken: string } | undefined> {
  const resumeToken = createResumeToken();
  const [execution] = await db
    .update(aiExecutionsTable)
    .set({
      resumeTokenHash: hashResumeToken(resumeToken),
      updatedAt: new Date(),
    })
    .where(and(
      eq(aiExecutionsTable.id, params.executionId),
      eq(aiExecutionsTable.userId, params.userId),
      inArray(aiExecutionsTable.status, ["paused", "failed"]),
    ))
    .returning();
  return execution ? { execution, resumeToken } : undefined;
}

export type AiExecutionRecoveryAction = "resume" | "abandon";
export type AiExecutionRecoveryOutcome =
  | "resume_accepted"
  | "abandoned"
  | "already_abandoned"
  | "already_running"
  | "stale"
  | "not_eligible";

export type AiExecutionRecoveryResult = {
  execution: AiExecution;
  outcome: AiExecutionRecoveryOutcome;
  resumeToken?: string;
};

function recoveryCheckpoint(execution: AiExecution): AiExecutionCheckpoint | undefined {
  return parseAiExecutionCheckpoint(execution.checkpoint);
}

function mergeTerminalCheckpoint(
  execution: AiExecution,
  params: {
    cancelled: boolean;
    error: string;
    nodeStates?: AiExecutionCheckpoint["nodeStates"];
    recentSteps?: Array<Record<string, unknown>>;
    streamedPreview?: string;
    operation?: AutonomousOperationContract;
  },
): AiExecutionCheckpoint {
  const previous = parseAiExecutionCheckpoint(execution.checkpoint);
  const now = new Date().toISOString();
  const operation = params.operation
    ?? previous?.operation;
  const previousBinding = previous?.recipeBinding ?? operation?.binding;
  const terminalBinding = previousBinding
    ? {
        ...previousBinding,
        phase: params.cancelled ? "cancelled" as const : "failed" as const,
        leaseOwner: null,
        leaseUntil: null,
      }
    : undefined;
  return {
    ...(previous ?? {}),
    stage: params.cancelled ? "cancelled" : "failed",
    sequence: Date.now(),
    ...(operation
      ? {
          operation: params.cancelled
            ? { ...operation, state: "cancelled", ...(terminalBinding ? { binding: terminalBinding } : {}), updatedAt: now }
            : { ...operation, ...(terminalBinding ? { binding: terminalBinding } : {}) },
        }
      : {}),
    ...(terminalBinding ? { recipeBinding: terminalBinding } : {}),
    ...(params.streamedPreview
      ? { streamedPreview: params.streamedPreview.slice(-AI_EXECUTION_CHECKPOINT_PREVIEW_LIMIT) }
      : {}),
    ...(params.recentSteps && params.recentSteps.length > 0
      ? { recentSteps: params.recentSteps.slice(-AI_EXECUTION_TRACE_LIMIT) }
      : {}),
    ...(params.nodeStates && params.nodeStates.length > 0
      ? { nodeStates: params.nodeStates }
      : {}),
    detail: params.error.slice(0, 500),
    updatedAt: now,
  } satisfies AiExecutionCheckpoint;
}

/**
 * Operator recovery is deliberately narrower than the legacy capability
 * endpoint. Only a paused execution whose server-owned operation is uncertain
 * can be resumed or abandoned. The checkpoint and operation identity are
 * retained for both outcomes; no new execution or user turn is created.
 */
export async function requestAiExecutionRecovery(params: {
  executionId: string;
  userId: string;
  action: AiExecutionRecoveryAction;
  revision?: string;
}): Promise<AiExecutionRecoveryResult | undefined> {
  const current = await getAiExecutionForUser(params.executionId, params.userId);
  if (!current) return undefined;
  const checkpoint = recoveryCheckpoint(current);
  const operation = checkpoint?.operation;
  const storedRevision = operation?.revisionManifest ?? null;
  if (params.revision && params.revision !== storedRevision) {
    return { execution: current, outcome: "stale" };
  }
  const priorRecovery = checkpoint && typeof checkpoint === "object"
    ? (checkpoint as AiExecutionCheckpoint & { recovery?: { action?: string } }).recovery
    : undefined;
  if (priorRecovery?.action === "abandon" || current.status === "cancelled") {
    return { execution: current, outcome: "already_abandoned" };
  }
  if (params.action === "resume" && priorRecovery?.action === "resume") {
    return { execution: current, outcome: "resume_accepted" };
  }
  if (params.action === "resume" && current.status === "running") {
    return { execution: current, outcome: "already_running" };
  }
  if (current.status !== "paused" || operation?.state !== "uncertain") {
    return { execution: current, outcome: "not_eligible" };
  }

  if (params.action === "resume") {
    const resumeToken = createResumeToken();
    const nextCheckpoint = {
      ...checkpoint,
      recovery: { action: "resume", outcome: "resume_accepted", updatedAt: new Date().toISOString() },
    };
    const [updated] = await db.update(aiExecutionsTable).set({
      resumeTokenHash: hashResumeToken(resumeToken),
      checkpoint: JSON.stringify(nextCheckpoint),
      updatedAt: new Date(),
    }).where(and(
      eq(aiExecutionsTable.id, params.executionId),
      eq(aiExecutionsTable.userId, params.userId),
      eq(aiExecutionsTable.status, "paused"),
    )).returning();
    return updated
      ? { execution: updated, outcome: "resume_accepted", resumeToken }
      : { execution: current, outcome: "not_eligible" };
  }

  const now = new Date();
  const nextCheckpoint = {
    ...checkpoint,
    stage: "cancelled" as const,
    sequence: Date.now(),
    recovery: { action: "abandon", outcome: "abandoned", updatedAt: now.toISOString() },
    updatedAt: now.toISOString(),
  };
  const [updated] = await db.update(aiExecutionsTable).set({
    status: "cancelled",
    checkpoint: JSON.stringify(nextCheckpoint),
    checkpointVersion: sql`${aiExecutionsTable.checkpointVersion} + 1`,
    completedAt: now,
    updatedAt: now,
    leaseUntil: null,
    lastHeartbeatAt: null,
  }).where(and(
    eq(aiExecutionsTable.id, params.executionId),
    eq(aiExecutionsTable.userId, params.userId),
    eq(aiExecutionsTable.status, "paused"),
  )).returning();
  return updated
    ? { execution: updated, outcome: "abandoned" }
    : { execution: current, outcome: "not_eligible" };
}

export async function claimAiExecution(params: {
  executionId: string;
  userId: string;
  workerId: string;
  resumeToken?: string;
  recipeBinding?: RecipeOperationBinding;
}): Promise<AiExecution | undefined> {
  const tokenHash = params.resumeToken ? hashResumeToken(params.resumeToken) : undefined;
  const existing = params.recipeBinding
    ? await getAiExecutionForUser(params.executionId, params.userId)
    : undefined;
  if (params.recipeBinding) {
    if (!existing) return undefined;
    const storedBinding = parseAiExecutionCheckpoint(existing.checkpoint)?.recipeBinding;
    if (!storedBinding || JSON.stringify(storedBinding) !== JSON.stringify(params.recipeBinding)) return undefined;
    try {
      assertRecipeOperationBinding(params.recipeBinding, {
        projectId: existing.projectId,
        operationId: existing.operationId ?? undefined,
        sourceRevision: parseExecutionRequest(existing.request)?.workspaceRevision,
      });
    } catch {
      return undefined;
    }
  }
  const claimTime = new Date();
  const claimLeaseUntil = new Date(claimTime.getTime() + AI_EXECUTION_LEASE_MS);
  const claimCheckpoint = existing && params.recipeBinding ? parseAiExecutionCheckpoint(existing.checkpoint) : undefined;
  const claimedBinding = params.recipeBinding
    ? { ...params.recipeBinding, phase: "running" as const, leaseOwner: params.workerId, leaseUntil: claimLeaseUntil.toISOString() }
    : undefined;
  const [claimed] = await db
    .update(aiExecutionsTable)
    .set({
      status: "running",
      workerId: params.workerId,
      leaseUntil: claimLeaseUntil,
      lastHeartbeatAt: claimTime,
      startedAt: claimTime,
      updatedAt: claimTime,
      error: null,
      cancelRequestedAt: null,
      ...(claimedBinding && claimCheckpoint ? {
        checkpoint: JSON.stringify({
          ...claimCheckpoint,
          recipeBinding: claimedBinding,
          ...(claimCheckpoint.operation ? { operation: { ...claimCheckpoint.operation, binding: claimedBinding } } : {}),
          sequence: claimCheckpoint.sequence + 1,
          updatedAt: claimTime.toISOString(),
        } satisfies AiExecutionCheckpoint),
        checkpointVersion: sql`${aiExecutionsTable.checkpointVersion} + 1`,
      } : {}),
    })
    .where(and(
      eq(aiExecutionsTable.id, params.executionId),
      eq(aiExecutionsTable.userId, params.userId),
      ...(params.recipeBinding ? [
        eq(aiExecutionsTable.projectId, params.recipeBinding.projectId),
        eq(aiExecutionsTable.operationId, params.recipeBinding.operationId),
      ] : []),
      inArray(aiExecutionsTable.status, ["queued", "paused", "failed"]),
      ...(tokenHash ? [eq(aiExecutionsTable.resumeTokenHash, tokenHash)] : []),
    ))
    .returning();
  return claimed;
}

export async function checkpointAiExecution(params: {
  executionId: string;
  workerId: string;
  checkpoint: AiExecutionCheckpoint;
  recipeBinding?: RecipeOperationBinding;
}): Promise<boolean> {
  // Keep this update atomic: the worker lease and checkpoint version are the
  // concurrency boundary. Callers that advance an operation include its
  // server-validated contract in the checkpoint; legacy stage-only writers
  // remain compatible and do not get a second read/race window here.
  const durableOperation = params.checkpoint.operation
    ? advanceOperationForCheckpoint(params.checkpoint.operation, params.checkpoint.stage)
    : undefined;
  const checkpointBinding = params.checkpoint.recipeBinding ?? durableOperation?.binding;
  if (params.recipeBinding) {
    if (!checkpointBinding) return false;
    try {
      assertRecipeOperationBinding(checkpointBinding, {
        projectId: params.recipeBinding.projectId,
        operationId: params.recipeBinding.operationId,
        sourceRevision: params.recipeBinding.sourceRevision,
        candidateIdentity: params.recipeBinding.candidateIdentity,
        candidateWorkspace: params.recipeBinding.candidateWorkspace,
        leaseOwner: params.workerId,
        requireLease: true,
      });
    } catch {
      return false;
    }
    if (JSON.stringify(checkpointBinding) !== JSON.stringify(params.recipeBinding)) return false;
  }
  const durableCheckpoint = durableOperation
    ? { ...params.checkpoint, operation: durableOperation, ...(checkpointBinding ? { recipeBinding: checkpointBinding } : {}) }
    : { ...params.checkpoint, ...(checkpointBinding ? { recipeBinding: checkpointBinding } : {}) };
  const [updated] = await db
    .update(aiExecutionsTable)
    .set({
      checkpoint: JSON.stringify(durableCheckpoint),
      checkpointVersion: durableCheckpoint.sequence,
      updatedAt: new Date(),
      lastHeartbeatAt: new Date(),
      leaseUntil: new Date(Date.now() + AI_EXECUTION_LEASE_MS),
    })
    .where(and(
      eq(aiExecutionsTable.id, params.executionId),
      eq(aiExecutionsTable.workerId, params.workerId),
      eq(aiExecutionsTable.status, "running"),
      gt(aiExecutionsTable.leaseUntil, new Date()),
      // A stale worker must not overwrite a newer durable checkpoint.
      lt(aiExecutionsTable.checkpointVersion, params.checkpoint.sequence),
    ))
    .returning({ id: aiExecutionsTable.id });
  return Boolean(updated);
}

export async function heartbeatAiExecution(params: {
  executionId: string;
  workerId: string;
}): Promise<boolean> {
  const [updated] = await db
    .update(aiExecutionsTable)
    .set({
      lastHeartbeatAt: new Date(),
      leaseUntil: new Date(Date.now() + AI_EXECUTION_LEASE_MS),
      updatedAt: new Date(),
    })
    .where(and(
      eq(aiExecutionsTable.id, params.executionId),
      eq(aiExecutionsTable.workerId, params.workerId),
      eq(aiExecutionsTable.status, "running"),
    ))
    .returning({ id: aiExecutionsTable.id });
  return Boolean(updated);
}

export async function completeAiExecution(params: {
  executionId: string;
  workerId: string;
  finalMessageId: string;
  proposalId?: string;
  operation?: AutonomousOperationContract;
  nodeStates?: AiExecutionCheckpoint["nodeStates"];
  evidenceVerdict?: FlightDeckEvidenceVerdict;
  evidenceReason?: string;
  proofRequired?: boolean;
  evidenceRefs?: readonly string[];
  recipeBinding?: RecipeOperationBinding;
  recipeReceipt?: RecipeReceipt;
}): Promise<boolean> {
  const [current] = await db
    .select({
      projectId: aiExecutionsTable.projectId,
      operationId: aiExecutionsTable.operationId,
      request: aiExecutionsTable.request,
      checkpoint: aiExecutionsTable.checkpoint,
      leaseUntil: aiExecutionsTable.leaseUntil,
    })
    .from(aiExecutionsTable)
    .where(and(
      eq(aiExecutionsTable.id, params.executionId),
      eq(aiExecutionsTable.workerId, params.workerId),
      eq(aiExecutionsTable.status, "running"),
    ))
    .limit(1);
  const request = current ? parseExecutionRequest(current.request) : undefined;
  const checkpoint = current ? parseAiExecutionCheckpoint(current.checkpoint) : undefined;
  if (params.recipeBinding) {
    if (!current?.leaseUntil || current.leaseUntil <= new Date()) return false;
    try {
      assertRecipeOperationBinding(params.recipeBinding, {
        projectId: current.projectId,
        operationId: current.operationId ?? undefined,
        sourceRevision: request?.workspaceRevision,
        leaseOwner: params.workerId,
        requireLease: true,
      });
    } catch {
      return false;
    }
    if (!checkpoint?.recipeBinding || checkpoint.recipeBinding.leaseOwner !== params.workerId) return false;
  }
  const requiresProof = params.proofRequired ?? request?.proofRequired ?? false;
  const operation = params.operation ?? checkpoint?.operation;
  if (requiresProof) {
    if (!operation) return false;
    const completion = validateAutonomousOperationCompletion(operation, {
      evidenceRefs: params.evidenceRefs,
      evidenceVerdict: params.evidenceVerdict,
      workspaceRevision: request?.workspaceRevision,
      candidateIdentity: operation.candidateIdentity,
      nodeStates: params.nodeStates?.map((node) => ({
        status: node.status,
        evidenceRefs: node.evidenceRefs ?? [],
      })),
    });
    if (!completion.allowed) return false;
  }
  const [updated] = await db
    .update(aiExecutionsTable)
    .set({
      status: "completed",
      finalMessageId: params.finalMessageId,
      proposalId: params.proposalId ?? null,
      ...(params.recipeReceipt ? { recipeReceipt: params.recipeReceipt } : {}),
      completedAt: new Date(),
      updatedAt: new Date(),
      leaseUntil: null,
      lastHeartbeatAt: null,
      checkpointVersion: sql`${aiExecutionsTable.checkpointVersion} + 1`,
      checkpoint: JSON.stringify({
        stage: "completed",
        sequence: Date.now(),
        ...(params.operation ? { operation: params.operation } : {}),
        ...(params.nodeStates && params.nodeStates.length > 0
          ? {
              nodeStates: params.nodeStates,
              completedNodes: params.nodeStates
                .filter((node) => node.status === "passed")
                .map((node) => node.id)
                .slice(0, AI_EXECUTION_NODE_LIMIT),
            }
          : {}),
        ...(params.evidenceVerdict ? { evidenceVerdict: params.evidenceVerdict } : {}),
        ...(params.evidenceRefs && params.evidenceRefs.length > 0
          ? { evidenceRefs: [...new Set(params.evidenceRefs)].slice(0, 48) }
          : {}),
        ...(params.evidenceReason ? { evidenceReason: params.evidenceReason.slice(0, 500) } : {}),
        ...(typeof params.proofRequired === "boolean" ? { proofRequired: params.proofRequired } : {}),
        updatedAt: new Date().toISOString(),
      } satisfies AiExecutionCheckpoint),
    })
    .where(and(
      eq(aiExecutionsTable.id, params.executionId),
      eq(aiExecutionsTable.workerId, params.workerId),
      eq(aiExecutionsTable.status, "running"),
      gt(aiExecutionsTable.leaseUntil, new Date()),
    ))
    .returning({ id: aiExecutionsTable.id });
  return Boolean(updated);
}

export async function failAiExecution(params: {
  executionId: string;
  workerId: string;
  error: string;
  cancelled?: boolean;
  nodeStates?: AiExecutionCheckpoint["nodeStates"];
  recentSteps?: Array<Record<string, unknown>>;
  streamedPreview?: string;
  operation?: AutonomousOperationContract;
  recipeBinding?: RecipeOperationBinding;
}): Promise<boolean> {
  const status = params.cancelled ? "cancelled" : "failed";
  const [current] = await db
    .select()
    .from(aiExecutionsTable)
    .where(and(
      eq(aiExecutionsTable.id, params.executionId),
      eq(aiExecutionsTable.workerId, params.workerId),
      gt(aiExecutionsTable.leaseUntil, new Date()),
      inArray(
        aiExecutionsTable.status,
        params.cancelled ? ["running", "cancelling"] : ["running"],
      ),
    ))
    .limit(1);
  const terminalCheckpoint = current
    ? mergeTerminalCheckpoint(current, { ...params, cancelled: params.cancelled ?? false })
    : undefined;
  if (params.recipeBinding && current) {
    const request = parseExecutionRequest(current.request);
    const checkpoint = parseAiExecutionCheckpoint(current.checkpoint);
    try {
      assertRecipeOperationBinding(params.recipeBinding, {
        projectId: current.projectId,
        operationId: current.operationId ?? undefined,
        sourceRevision: request?.workspaceRevision,
        leaseOwner: params.workerId,
        requireLease: true,
      });
    } catch {
      return false;
    }
    if (!checkpoint?.recipeBinding || checkpoint.recipeBinding.leaseOwner !== params.workerId) return false;
  }
  const [updated] = await db
    .update(aiExecutionsTable)
    .set({
      status,
      error: params.error.slice(0, 1000),
      completedAt: new Date(),
      updatedAt: new Date(),
      leaseUntil: null,
      lastHeartbeatAt: null,
      checkpointVersion: sql`${aiExecutionsTable.checkpointVersion} + 1`,
      ...(terminalCheckpoint ? { checkpoint: JSON.stringify(terminalCheckpoint) } : {}),
    })
    .where(and(
      eq(aiExecutionsTable.id, params.executionId),
      eq(aiExecutionsTable.workerId, params.workerId),
      gt(aiExecutionsTable.leaseUntil, new Date()),
      params.cancelled ? inArray(aiExecutionsTable.status, ["running", "cancelling"]) : eq(aiExecutionsTable.status, "running"),
    ))
    .returning({ id: aiExecutionsTable.id });
  if (updated) return true;

  // Cancellation is an authoritative terminal fence. If the worker learned
  // about cancellation through the database (rather than its local signal),
  // its ordinary failure path must still settle `cancelling` as cancelled and
  // must never publish a failed outcome after the cancellation won.
  if (!params.cancelled) {
    const cancellationCheckpoint = current
      ? mergeTerminalCheckpoint(current, { ...params, cancelled: true })
      : undefined;
    const [cancelled] = await db
      .update(aiExecutionsTable)
      .set({
        status: "cancelled",
        error: params.error.slice(0, 1000),
        completedAt: new Date(),
        updatedAt: new Date(),
        leaseUntil: null,
        lastHeartbeatAt: null,
        checkpointVersion: sql`${aiExecutionsTable.checkpointVersion} + 1`,
        ...(cancellationCheckpoint ? { checkpoint: JSON.stringify(cancellationCheckpoint) } : {}),
      })
      .where(and(
        eq(aiExecutionsTable.id, params.executionId),
        eq(aiExecutionsTable.workerId, params.workerId),
        eq(aiExecutionsTable.status, "cancelling"),
      ))
      .returning({ id: aiExecutionsTable.id });
    return Boolean(cancelled);
  }
  return false;
}

export async function requestAiExecutionCancel(params: {
  executionId: string;
  userId: string;
}): Promise<AiExecution | undefined> {
  const now = new Date();
  const current = await getAiExecutionForUser(params.executionId, params.userId);
  if (!current) return undefined;
  const cancelledCheckpoint = JSON.stringify(mergeTerminalCheckpoint(current, {
    cancelled: true,
    error: "Execution cancelled before a worker started.",
  }));

  // Queued and paused executions have no active worker to observe the
  // cancellation signal. Transition them directly to a terminal state so
  // they cannot remain permanently stuck in `cancelling`.
  const [cancelledBeforeStart] = await db
    .update(aiExecutionsTable)
    .set({
      status: "cancelled",
      cancelRequestedAt: now,
      completedAt: now,
      checkpoint: cancelledCheckpoint,
      checkpointVersion: sql`${aiExecutionsTable.checkpointVersion} + 1`,
      updatedAt: now,
      leaseUntil: null,
      lastHeartbeatAt: null,
    })
    .where(and(
      eq(aiExecutionsTable.id, params.executionId),
      eq(aiExecutionsTable.userId, params.userId),
      inArray(aiExecutionsTable.status, ["queued", "paused"]),
    ))
    .returning();
  if (cancelledBeforeStart) return cancelledBeforeStart;

  const [updated] = await db
    .update(aiExecutionsTable)
    .set({
      status: "cancelling",
      cancelRequestedAt: now,
      updatedAt: now,
    })
    .where(and(
      eq(aiExecutionsTable.id, params.executionId),
      eq(aiExecutionsTable.userId, params.userId),
      eq(aiExecutionsTable.status, "running"),
    ))
    .returning();
  if (updated) activeControllers.get(updated.id)?.abort(new Error("AI execution cancellation requested"));
  return updated;
}

export function registerAiExecutionController(executionId: string, controller: AbortController): void {
  activeControllers.set(executionId, controller);
}

export function unregisterAiExecutionController(executionId: string, controller: AbortController): void {
  if (activeControllers.get(executionId) === controller) activeControllers.delete(executionId);
}

export async function reconcileAiExecutions(): Promise<number> {
  const now = new Date();
  const running = await db.select().from(aiExecutionsTable).where(
    inArray(aiExecutionsTable.status, ["running", "cancelling"]),
  );
  let count = 0;
  for (const execution of running) {
    const checkpoint = parseAiExecutionCheckpoint(execution.checkpoint);
    if (execution.status === "cancelling") {
      const terminalCheckpoint = mergeTerminalCheckpoint(execution, {
        cancelled: true,
        error: "Execution cancellation was finalized after the server restarted.",
      });
      const [updated] = await db.update(aiExecutionsTable).set({
        status: "cancelled",
        error: "Execution cancelled by the user.",
        completedAt: now,
        workerId: null,
        leaseUntil: null,
        lastHeartbeatAt: null,
        updatedAt: now,
        checkpoint: JSON.stringify(terminalCheckpoint),
        checkpointVersion: sql`${aiExecutionsTable.checkpointVersion} + 1`,
      }).where(and(
        eq(aiExecutionsTable.id, execution.id),
        eq(aiExecutionsTable.status, "cancelling"),
      )).returning({ id: aiExecutionsTable.id });
      if (updated) count += 1;
      continue;
    }
    const operation = checkpoint?.operation;
    const uncertainOperation = operation
      ? { ...operation, state: "uncertain" as const, updatedAt: now.toISOString() }
      : undefined;
    const nextCheckpoint = checkpoint
      ? {
          ...checkpoint,
          ...(uncertainOperation ? { operation: uncertainOperation } : {}),
          recovery: {
            action: "uncertain",
            phase: operation?.state ?? null,
            outcome: "recovery_required",
            updatedAt: now.toISOString(),
          },
          updatedAt: now.toISOString(),
        }
      : undefined;
    const [updated] = await db.update(aiExecutionsTable).set({
      status: "paused",
      error: "Execution interrupted; operator recovery is required.",
      workerId: null,
      leaseUntil: null,
      lastHeartbeatAt: null,
      updatedAt: now,
      ...(nextCheckpoint ? { checkpoint: JSON.stringify(nextCheckpoint) } : {}),
    }).where(and(eq(aiExecutionsTable.id, execution.id), eq(aiExecutionsTable.status, "running"))).returning({ id: aiExecutionsTable.id });
    if (updated) count += 1;
  }
  return count;
}

export async function listRecoverableAiExecutions(userId: string, sessionId: string): Promise<AiExecution[]> {
  return db
    .select()
    .from(aiExecutionsTable)
    .where(and(
      eq(aiExecutionsTable.userId, userId),
      eq(aiExecutionsTable.sessionId, sessionId),
      inArray(aiExecutionsTable.status, ["queued", "running", "paused", "cancelling"]),
    ));
}