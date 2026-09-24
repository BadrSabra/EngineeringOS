import path from "node:path";
import { createHash, randomUUID } from "node:crypto";
import { realpath } from "node:fs/promises";
import {
  advanceCompiledRecipeTransition,
  compileCapabilityRecipe,
  createServerCapabilityRegistry,
  createServerRecipeDefinitionRegistry,
  evaluateRecipeEvidencePredicate,
  executeExecutionNodePlan,
  canonicalJsonHash,
  type ActiveTaskExecutionPlan,
  type ExecutionNode,
  type BrowserValidationRunner,
  type GitHubDeliveryRunner,
  type RuntimeStartRunner,
  type RecipeCapabilityRuntime,
  type RecipeEvidence,
  type ValidationRunner,
  type AgentAction,
  type EffectContract,
  type JsonValue,
} from "@workspace/ai-orchestrator";
import { and, desc, eq, inArray } from "drizzle-orm";
import {
  aiGoalsTable,
  db,
  eventsTable,
  projectsTable,
} from "@workspace/db";
import type { AiExternalEffectCheckpoint } from "./ai-execution-state.js";
import {
  assertRecipeNodeBinding,
  authorizeRecipeNodeExecution,
  checkpointAiExecution,
  claimAiExecution,
  completeAiExecution,
  createAiExecution,
  createRecipeOperationBinding,
  failAiExecution,
  getAiExecutionForUser,
  heartbeatAiExecution,
  ownsAiExecutionLease,
  parseAiExecutionCheckpoint,
  persistCancelledRecipeReceipt,
  recoverAiExecutionResumeToken,
  reconcileExecutionNodeCheckpoint,
  registerAiExecutionController,
  unregisterAiExecutionController,
  type RecipeOperationBinding,
  type RecipeSkillRegistryBinding,
} from "./ai-execution-state.js";
import { RecipeReceiptSchema, type RecipeReceipt } from "@workspace/ai-orchestrator";
import { runRepairValidation } from "./ai-repair-validation.js";
import { HOST_DISPOSABLE_TEMP_ROOT } from "./disposable-temp.js";
import { logger } from "./logger.js";
import {
  parseTaskObjectiveContract,
  type TaskObjectiveValidatorReceipt,
} from "./task-objective-contract.js";
import {
  requireActiveSkillRegistry,
  type ActiveSkillRegistryBinding,
} from "./skill-registry.js";
import type { ExecutionDelegationBudget } from "./execution-lineage.js";
import {
  appendEpisodeEvent,
  startEpisode,
  startEpisodeShadow,
} from "./agent-state/agent-episode-ledger.js";
import { materializeServerOwnedObservations } from "./agent-state/observation-materializer.js";
import { hashDeliveryTree } from "./delivery-workspace.js";
import { verifyAndPersistEffect } from "./agent-state/effect-observer.js";
import {
  buildCandidateValidationAction,
  buildCandidateValidationEffectContract,
} from "./agent-state/candidate-validation-effect.js";
import {
  buildGateCAction,
  buildGateCEffectContract,
  gateCEffectIdentity,
  gateCEffectKind,
} from "./agent-state/gate-c-effect.js";
import { workspaceRuntime, WorkspaceRuntimeError } from "./workspace-runtime.js";
import { extractAcceptedEpisodeStrategy } from "./agent-state/strategy-candidate-extractor.js";
import { registerProspectiveStrategyReplayCase } from "./agent-state/strategy-replay-case-registry.js";

function strategyActionContract(action: AgentAction): {
  contractVersion: 1;
  triggerConditions: JsonValue[];
  preconditions: string[];
  expectedEffects: string[];
  observationProfile: string;
  failureSemantics: string[];
} {
  return {
    contractVersion: 1,
    triggerConditions: (action.triggerConditions ?? []) as JsonValue[],
    preconditions: action.preconditions,
    expectedEffects: action.expectedEffects,
    observationProfile: action.observationProfile,
    failureSemantics: action.failureSemantics,
  };
}

export type PrepareRecipeOperationParams = {
  projectId: string;
  operationId: string;
  rootPath: string;
  sourceRevision: string;
  recipeId: string;
  recipeVersion: number;
  approvedPaths?: readonly string[];
  candidateIdentity?: string | null;
  candidateWorkspace?: string | null;
  validationProfiles?: readonly ("workspace-typecheck" | "ai-orchestrator-tests")[];
  deliveryMessage?: string;
  browserValidationRunner?: BrowserValidationRunner;
  githubDeliveryRunner?: GitHubDeliveryRunner;
  runtimeStartRunner?: RuntimeStartRunner;
  databaseReadRunner?: NonNullable<RecipeCapabilityRuntime["databaseReadRunner"]>;
  validationRunner?: ValidationRunner;
  skillBinding?: ActiveSkillRegistryBinding;
};

export type PreparedRecipeOperation = {
  plan: ActiveTaskExecutionPlan;
  binding: RecipeOperationBinding;
};

export function createRuntimeStartRunner(
  manager = workspaceRuntime,
): RuntimeStartRunner {
  return async ({ projectId, operationId, rootPath, revision, signal }) => {
    if (signal?.aborted) {
      return { status: "blocked", detail: "Runtime action was cancelled before startup." };
    }
    try {
      const snapshot = await manager.start({
        projectId,
        projectRoot: rootPath,
        revision,
      });
      if (snapshot.status !== "running" || !snapshot.sessionId) {
        return {
          status: "unavailable",
          detail: snapshot.error ?? "The workspace runtime did not reach running state.",
        };
      }
      const after = await manager.observeAfterState({
        projectId,
        sessionId: snapshot.sessionId,
        revision,
        signal,
      });
      const evidenceId = `runtime:${projectId}:${operationId}:${snapshot.sessionId}:after`;
      const resultHash = createHash("sha256")
        .update(JSON.stringify(after))
        .digest("hex");
      return {
        status: after.status === "passed" ? "passed" as const : after.status === "failed" ? "blocked" as const : "unavailable" as const,
        evidence: {
          evidenceId,
          resultHash,
          artifactRef: `runtime:${snapshot.sessionId}`,
          afterState: {
            status: after.status,
            projectId: after.projectId,
            sessionId: after.sessionId,
            revision: after.revision,
            pid: after.pid,
            port: after.port,
            processAlive: after.processAlive,
            portReady: after.portReady,
            healthPath: after.healthPath,
            healthStatus: after.healthStatus,
            servingRevision: after.servingRevision,
            markerMatched: after.markerMatched,
            observedAt: after.observedAt,
          },
        },
        detail: after.detail,
      };
    } catch (error) {
      const detail = error instanceof Error ? error.message.slice(0, 4_000) : "Runtime action failed.";
      return {
        status: error instanceof WorkspaceRuntimeError && error.code === "RUNTIME_OBSERVATION_STALE"
          ? "blocked" as const
          : "unavailable" as const,
        detail,
      };
    }
  };
}

function normalizedPaths(paths: readonly string[] | undefined): string[] {
  return [...new Set((paths ?? []).map((value) => value.trim().replaceAll("\\", "/")).filter(Boolean))];
}

function assertCandidateWorkspace(candidateWorkspace: string | null | undefined): void {
  if (candidateWorkspace === null || candidateWorkspace === undefined) return;
  const candidate = path.resolve(candidateWorkspace);
  const disposableRoot = path.resolve(HOST_DISPOSABLE_TEMP_ROOT);
  const relative = path.relative(disposableRoot, candidate);
  if (!path.isAbsolute(candidateWorkspace) || !relative || relative === ".." || relative.startsWith(`..${path.sep}`)) {
    throw new Error("Recipe candidate workspace must be an absolute path inside the host disposable temp root.");
  }
}

async function canonicalCandidateWorkspace(candidateWorkspace: string | null | undefined): Promise<string | undefined> {
  if (!candidateWorkspace) return undefined;
  const [candidate, disposableRoot] = await Promise.all([
    realpath(path.resolve(candidateWorkspace)),
    realpath(path.resolve(HOST_DISPOSABLE_TEMP_ROOT)),
  ]);
  const relative = path.relative(disposableRoot, candidate);
  if (!relative || relative === ".." || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) {
    throw new Error("Recipe candidate workspace resolves outside the host disposable temp root.");
  }
  return candidate;
}

export function prepareRecipeOperation(params: PrepareRecipeOperationParams): PreparedRecipeOperation {
  assertCandidateWorkspace(params.candidateWorkspace);
  const approvedPaths = normalizedPaths(params.approvedPaths);
  const definitions = createServerRecipeDefinitionRegistry();
  const definition = definitions.resolve(params.recipeId, params.recipeVersion);
  if (!definition) throw new Error(`Unknown server recipe "${params.recipeId}" version ${params.recipeVersion}.`);
  const recipe = definition.buildRecipe({
    recipeId: params.recipeId,
    recipeVersion: params.recipeVersion,
    approvedPaths,
    candidateIdentity: params.candidateIdentity ?? null,
    ...(params.validationProfiles ? { validationProfiles: [...params.validationProfiles] } : {}),
    ...(params.deliveryMessage ? { deliveryMessage: params.deliveryMessage } : {}),
  });
  const registry = createServerCapabilityRegistry(
    {
      ...(params.browserValidationRunner ? { browserProfiles: ["default"] } : {}),
      ...(params.githubDeliveryRunner ? { githubDeliveryRunner: params.githubDeliveryRunner } : {}),
      ...(params.runtimeStartRunner ? { runtimeStartRunner: params.runtimeStartRunner } : {}),
      databaseReadRunner: params.databaseReadRunner ?? DEFAULT_DATABASE_READ_RUNNER,
    },
  );
  const compiled = compileCapabilityRecipe(recipe, {
    registry,
    context: {
      projectId: params.projectId,
      rootPath: params.rootPath,
      revision: params.sourceRevision,
      operation: "recipe",
      operationId: params.operationId,
      // Validation and browser profiles operate on a bounded set, even when
      // that set contains one file. "file" is reserved for file-native tools.
      scope: params.recipeId === "runtime.start"
        ? { kind: "project", paths: [] }
        : approvedPaths.length > 0
          ? { kind: "paths", paths: approvedPaths }
          : { kind: "none", paths: [] },
      allowedFiles: approvedPaths,
      authorized: true,
      approvalState: "APPROVED",
      maxRisk: definition.maxRisk,
      validationProfile: "workspace-typecheck",
    },
    policy: definition.executionPolicy,
  });
  if (!compiled.ok) {
    throw new Error(compiled.diagnostics.map((diagnostic) => diagnostic.code).join(", "));
  }
  if (compiled.plan.nodes.length > definition.executionPolicy.maxNodes) {
    throw new Error("Recipe exceeds its server-owned mission node budget.");
  }
  const binding = createRecipeOperationBinding({
    projectId: params.projectId,
    operationId: params.operationId,
    sourceRevision: params.sourceRevision,
    approvedPaths,
    candidateIdentity: params.candidateIdentity,
    candidateWorkspace: params.candidateWorkspace,
    missionBudget: {
      maxNodes: definition.executionPolicy.maxNodes,
      maxParallelNodes: definition.maxParallelNodes,
      maxTotalTimeoutMs: definition.executionPolicy.maxTotalTimeoutMs,
      maxProcessCount: definition.maxParallelNodes,
      maxOutputBytes: 200_000,
    },
    concurrencyBudget: {
      maxInFlightNodes: definition.maxParallelNodes,
      maxProcesses: definition.maxParallelNodes,
    },
    ...(params.skillBinding
      ? {
          skillRegistryBinding: {
            registryId: params.skillBinding.registryId,
            skillId: params.skillBinding.skillId,
            skillVersion: params.skillBinding.skillVersion,
            candidateId: params.skillBinding.candidateId,
            sourceRevision: params.skillBinding.sourceRevision,
            candidateTreeHash: params.skillBinding.candidateTreeHash,
            proofReceiptId: params.skillBinding.proofReceiptId,
            shadowReplayId: params.skillBinding.shadowReplayId,
          } satisfies RecipeSkillRegistryBinding,
        }
      : {}),
  });
  if (compiled.plan.nodes.length > binding.missionBudget.maxNodes
    || definition.maxParallelNodes !== binding.concurrencyBudget.maxInFlightNodes) {
    throw new Error("Recipe plan does not fit its durable mission budget.");
  }
  for (const node of compiled.plan.nodes) assertRecipeNodeBinding(binding, node);
  return { plan: compiled.plan, binding };
}

export type RunRecipeOperationParams = PrepareRecipeOperationParams & {
  userId: string;
  goalId?: string;
  sessionId?: string;
  idempotencyKey: string;
  executionProfile?: string;
  proofRequired?: boolean;
  parentExecutionId?: string | null;
  delegationBudget?: Partial<ExecutionDelegationBudget>;
};

function evidenceForNodes(
  nodes: readonly ActiveTaskExecutionPlan["nodes"][number][],
  outputs: ReadonlyMap<string, Record<string, unknown>>,
): RecipeEvidence {
  return Object.fromEntries(nodes.map((node) => {
    const evidenceType = node.capabilityId?.startsWith("browser.verify.")
      ? "browser_verified" as const
      : node.capabilityId === "runtime.start"
        ? "runtime_verified" as const
      : node.capabilityId?.startsWith("github.push")
        ? "integration_verified" as const
        : node.capabilityId?.startsWith("database.read")
          ? "database_read" as const
      : "validation_passed" as const;
    const evidenceId = outputs.get(node.id)?.evidence
      && typeof outputs.get(node.id)?.evidence === "object"
      && typeof (outputs.get(node.id)?.evidence as { evidenceId?: unknown }).evidenceId === "string"
      ? (outputs.get(node.id)?.evidence as { evidenceId: string }).evidenceId
      : undefined;
    return [node.id, {
      status: node.status,
      outputs: outputs.get(node.id),
      evidence: node.status === "passed" && evidenceId ? [{ type: evidenceType, evidenceId }] : [],
    }];
  }));
}

const DEFAULT_DATABASE_READ_RUNNER: NonNullable<RecipeCapabilityRuntime["databaseReadRunner"]> = async ({
  projectId,
  operationId,
  resource,
  limit,
  signal,
}) => {
  if (signal?.aborted) return { status: "blocked" as const, detail: "Database read was cancelled." };
  try {
    let rows: Array<Record<string, unknown>>;
    if (resource === "project_summary") {
      const projects = await db
        .select({
          id: projectsTable.id,
          name: projectsTable.name,
          language: projectsTable.language,
          status: projectsTable.status,
          updatedAt: projectsTable.updatedAt,
        })
        .from(projectsTable)
        .where(eq(projectsTable.id, projectId))
        .limit(1);
      rows = projects.map((project) => ({
        id: project.id,
        name: project.name,
        language: project.language,
        status: project.status,
        updatedAt: project.updatedAt.toISOString(),
      }));
    } else if (resource === "active_goals") {
      const goals = await db
        .select({
          id: aiGoalsTable.id,
          title: aiGoalsTable.title,
          status: aiGoalsTable.status,
          priority: aiGoalsTable.priority,
          updatedAt: aiGoalsTable.updatedAt,
        })
        .from(aiGoalsTable)
        .where(and(
          eq(aiGoalsTable.projectId, projectId),
          inArray(aiGoalsTable.status, ["queued", "planning", "running", "waiting_for_event", "waiting_for_approval", "verifying", "needs_replan"]),
        ))
        .orderBy(desc(aiGoalsTable.updatedAt), desc(aiGoalsTable.id))
        .limit(limit);
      rows = goals.map((goal) => ({
        id: goal.id,
        title: goal.title,
        status: goal.status,
        priority: goal.priority,
        updatedAt: goal.updatedAt.toISOString(),
      }));
    } else {
      const events = await db
        .select({
          id: eventsTable.id,
          goalId: eventsTable.goalId,
          workflowId: eventsTable.workflowId,
          type: eventsTable.type,
          severity: eventsTable.severity,
          message: eventsTable.message,
          correlationId: eventsTable.correlationId,
          timestamp: eventsTable.timestamp,
        })
        .from(eventsTable)
        .where(eq(eventsTable.projectId, projectId))
        .orderBy(desc(eventsTable.timestamp), desc(eventsTable.id))
        .limit(limit);
      rows = events.map((event) => ({
        id: event.id,
        goalId: event.goalId,
        workflowId: event.workflowId,
        type: event.type,
        severity: event.severity,
        message: event.message.slice(0, 500),
        correlationId: event.correlationId,
        timestamp: event.timestamp.toISOString(),
      }));
    }
    const resultHash = createHash("sha256").update(JSON.stringify({ projectId, resource, rows })).digest("hex");
    return {
      status: "passed" as const,
      rows,
      evidence: {
        evidenceId: `database:${operationId}:${resultHash}`,
        resultHash,
      },
    };
  } catch {
    return { status: "unavailable" as const, detail: "The approved project data view is unavailable." };
  }
};

function externalEffectForNodes(
  nodes: readonly ExecutionNode[],
  operationId: string,
): AiExternalEffectCheckpoint | undefined {
  const node = nodes.find((candidate) =>
    candidate.status === "running" && candidate.capabilityId?.startsWith("github.push."));
  if (!node || !node.capabilityId) return undefined;
  const intentHash = createHash("sha256").update(JSON.stringify({
    operationId,
    capabilityId: node.capabilityId,
    recipeVersion: node.recipeVersion,
    capabilityInput: node.capabilityInput,
  })).digest("hex");
  return {
    kind: "github_delivery",
    operationId,
    capabilityId: node.capabilityId,
    intentHash,
    state: "pending",
    updatedAt: new Date().toISOString(),
  };
}

function receiptIdForEvidence(entry: RecipeEvidence[string]): string | undefined {
  const receipt = entry.outputs?.evidence;
  return receipt
    && typeof receipt === "object"
    && !Array.isArray(receipt)
    && typeof (receipt as { evidenceId?: unknown }).evidenceId === "string"
    ? (receipt as { evidenceId: string }).evidenceId
    : undefined;
}

function buildRecipeReceipt(
  params: RunRecipeOperationParams,
  executionId: string,
  attempt: number,
  status: RecipeReceipt["status"],
  nodes: readonly ActiveTaskExecutionPlan["nodes"][number][],
  outputs: ReadonlyMap<string, Record<string, unknown>>,
  completedNodeIds: readonly string[],
): RecipeReceipt {
  const deliveryOutput = [...outputs.values()].find((output) =>
    typeof output.candidateTreeHash === "string"
    || typeof output.treeHash === "string"
    || typeof output.committedTreeHash === "string"
  );
  const receipt = {
    contractVersion: 1 as const,
    executionId,
    operationId: params.operationId,
    attempt,
    sourceRevision: params.sourceRevision,
    candidateTreeHash: params.candidateIdentity ?? null,
    treeHash: typeof deliveryOutput?.treeHash === "string"
      ? deliveryOutput.treeHash
      : typeof deliveryOutput?.committedTreeHash === "string"
        ? deliveryOutput.committedTreeHash
        : null,
    recipeId: params.recipeId,
    recipeVersion: params.recipeVersion,
    status,
    completedNodeIds: [...completedNodeIds],
    nodes: nodes.map((node) => ({
      nodeId: node.id,
      status: node.status === "passed" ? "passed" as const
        : node.status === "failed" ? "failed" as const : "blocked" as const,
      attempts: node.attempts,
      elapsedMs: 0,
      evidenceId: receiptIdForEvidence({
        status: node.status,
        outputs: outputs.get(node.id),
      }) ?? null,
      excerpt: outputs.get(node.id)?.detail
        && typeof outputs.get(node.id)?.detail === "string"
        ? String(outputs.get(node.id)?.detail).slice(0, 500)
        : null,
    })),
    evidenceRefs: nodes.map((node) => receiptIdForEvidence({
      status: node.status,
      outputs: outputs.get(node.id),
    })).filter((id): id is string => typeof id === "string"),
    createdAt: new Date().toISOString(),
    completedAt: new Date().toISOString(),
  };
  return RecipeReceiptSchema.parse(receipt);
}

function advanceRecipeToTerminal(
  plan: ActiveTaskExecutionPlan,
  evidence: RecipeEvidence,
  signal: AbortSignal,
): { plan: ActiveTaskExecutionPlan; status: "succeeded" | "failed" | "blocked" | "cancelled" } {
  let current = plan;
  for (let index = 0; index <= plan.nodes.length; index += 1) {
    const advanced = advanceCompiledRecipeTransition(current, evidence, signal);
    if (advanced.status !== "advanced") return { plan: { ...current, recipeState: advanced.state }, status: advanced.status };
    current = { ...current, recipeState: advanced.state };
  }
  return { plan: current, status: "blocked" };
}

export async function runRecipeOperation(params: RunRecipeOperationParams): Promise<{
  executionId: string;
  status: "completed" | "blocked";
  completedNodeIds: string[];
  receipt: RecipeReceipt;
}> {
  const prepared = prepareRecipeOperation(params);
  if (params.skillBinding) {
    await requireActiveSkillRegistry({
      projectId: params.projectId,
      skillId: params.skillBinding.skillId,
      skillVersion: params.skillBinding.skillVersion,
      candidateId: params.candidateIdentity,
      sourceRevision: params.sourceRevision,
      candidateTreeHash: params.candidateIdentity,
      registryId: params.skillBinding.registryId,
      proofReceiptId: params.skillBinding.proofReceiptId,
      shadowReplayId: params.skillBinding.shadowReplayId,
    });
  }
  const candidateRoot = await canonicalCandidateWorkspace(params.candidateWorkspace);
  const executionRoot = candidateRoot ?? path.resolve(params.rootPath);
  const executionRequest = {
    projectId: params.projectId,
    ...(params.executionProfile ? { executionProfile: params.executionProfile } : {}),
    operationId: params.operationId,
    sessionId: params.sessionId,
    message: `recipe:${params.operationId}`,
    modelMessage: `recipe:${params.operationId}`,
    workspaceRevision: params.sourceRevision,
    validationTargetPaths: normalizedPaths(params.approvedPaths),
    ...(params.validationProfiles ? { validationProfiles: [...params.validationProfiles] } : {}),
    ...(params.proofRequired ? { proofRequired: true } : {}),
    ...(params.skillBinding
      ? {
          skillRegistryBinding: {
            registryId: params.skillBinding.registryId,
            skillId: params.skillBinding.skillId,
            skillVersion: params.skillBinding.skillVersion,
            candidateId: params.skillBinding.candidateId,
            sourceRevision: params.skillBinding.sourceRevision,
            candidateTreeHash: params.skillBinding.candidateTreeHash,
            proofReceiptId: params.skillBinding.proofReceiptId,
            shadowReplayId: params.skillBinding.shadowReplayId,
          },
        }
      : {}),
  };
  const created = await createAiExecution({
    userId: params.userId,
    request: executionRequest,
    idempotencyKey: params.idempotencyKey,
    projectId: params.projectId,
    ...(params.goalId ? { goalId: params.goalId } : {}),
    sessionId: params.sessionId,
    recipeBinding: prepared.binding,
    parentExecutionId: params.parentExecutionId,
    delegationBudget: params.delegationBudget,
  });
  const workerId = `recipe:${params.operationId}:${randomUUID()}`;
  const recovery = created.execution.status === "paused"
    ? await recoverAiExecutionResumeToken({
        executionId: created.execution.id,
        userId: params.userId,
        expectedAttempt: created.execution.attempt,
      })
    : undefined;
  if (created.execution.status === "paused" && !recovery) {
    throw new Error("Paused recipe execution is not eligible for durable recovery.");
  }
  const claimed = await claimAiExecution({
    executionId: created.execution.id,
    userId: params.userId,
    workerId,
    ...(recovery?.resumeToken ? { resumeToken: recovery.resumeToken } : {}),
    recipeBinding: prepared.binding,
  });
  if (!claimed) {
    const existingReceipt = created.execution.recipeReceipt
      ? RecipeReceiptSchema.safeParse(created.execution.recipeReceipt).data
      : undefined;
    if (existingReceipt) return {
      executionId: created.execution.id,
      status: existingReceipt.status === "completed" ? "completed" : "blocked",
      completedNodeIds: existingReceipt.completedNodeIds,
      receipt: existingReceipt,
    };
    throw new Error("Recipe operation could not acquire its durable lease.");
  }
  const candidateValidation = params.recipeId === "candidate.verify";
  const recipeGateCEffectKind = gateCEffectKind(params.recipeId);
  const authoritativeEffectRecipe = candidateValidation || Boolean(recipeGateCEffectKind);
  const episode = authoritativeEffectRecipe
    ? await startEpisode({
        projectId: params.projectId,
        executionId: claimed.id,
        attempt: claimed.attempt,
        workerId,
        idempotencyKey: `${params.operationId}:episode:${claimed.attempt}`,
        projectRevision: params.sourceRevision,
         intentKind: candidateValidation
           ? "CANDIDATE_VALIDATION"
           : recipeGateCEffectKind === "browser"
             ? "BROWSER_VALIDATION"
             : recipeGateCEffectKind === "runtime"
               ? "RUNTIME_START"
               : "GITHUB_DELIVERY",
        scope: {
          kind: "recipe",
          operationId: params.operationId,
          recipeId: params.recipeId,
          candidateIdentity: params.candidateIdentity ?? null,
        },
        ...(params.goalId ? { goalId: params.goalId } : {}),
      })
    : (startEpisodeShadow({
        projectId: params.projectId,
        executionId: claimed.id,
        attempt: claimed.attempt,
        workerId,
        idempotencyKey: `${params.operationId}:episode:${claimed.attempt}`,
        projectRevision: params.sourceRevision,
        intentKind: "RECIPE_OPERATION",
        scope: { kind: "recipe", operationId: params.operationId, recipeId: params.recipeId },
        ...(params.goalId ? { goalId: params.goalId } : {}),
      }), undefined);
  let candidateValidationAction: AgentAction | undefined;
  let candidateValidationEffectContract: EffectContract | undefined;
  let candidateValidationBeforeObservationIds: string[] | undefined;
  let gateCAction: AgentAction | undefined;
  let gateCEffectContract: EffectContract | undefined;
  let gateCBeforeObservationIds: string[] | undefined;
  let gateCEffectBundleId: string | undefined;
  if (candidateValidation) {
    if (!episode || !params.candidateIdentity || !candidateRoot) {
      throw new Error("Candidate validation requires an identity and disposable workspace.");
    }
    const beforeTreeHash = await hashDeliveryTree(executionRoot);
    const beforeEvidenceRef = `candidate-validation:${claimed.id}:${claimed.attempt}:before`;
    const afterEvidenceRef = `candidate-validation:${claimed.id}:${claimed.attempt}:after`;
    const action = buildCandidateValidationAction({
      actionId: `action:${claimed.id}:${claimed.attempt}:candidate-validation`,
      episodeId: episode.episodeId,
      projectId: params.projectId,
      operationId: params.operationId,
      sourceRevision: params.sourceRevision,
      candidateIdentity: params.candidateIdentity,
      approvedPaths: normalizedPaths(params.approvedPaths),
    });
    const actionContract = strategyActionContract(action);
    candidateValidationAction = action;
    candidateValidationEffectContract = buildCandidateValidationEffectContract({
      candidateIdentity: params.candidateIdentity,
      beforeEvidenceRef,
      afterEvidenceRef,
    });
    await appendEpisodeEvent({
      episodeId: episode.episodeId,
      projectId: params.projectId,
      executionId: claimed.id,
      attempt: claimed.attempt,
      workerId,
      eventType: "ACTION_REQUESTED",
      payload: {
        actionId: action.actionId,
        capabilityId: action.capabilityId,
        expectedEffects: action.expectedEffects,
        observationProfile: action.observationProfile,
        actionContract,
        actionContractHash: canonicalJsonHash(actionContract),
      },
      actorType: "worker",
      actorId: workerId,
      correlationId: claimed.id,
    });
    const before = await materializeServerOwnedObservations({
      projectId: params.projectId,
      executionId: claimed.id,
      attempt: claimed.attempt,
      episodeId: episode.episodeId,
      projectRevision: params.sourceRevision,
      materializeWorldState: false,
      sources: [
        {
          kind: "direct_observation",
          sourceId: `${beforeEvidenceRef}:workspace`,
          sourceRevision: params.sourceRevision,
          subject: `candidate:${params.candidateIdentity}`,
          predicate: "workspace.tree_hash",
          value: beforeTreeHash,
          evidenceRefs: [beforeEvidenceRef],
        },
        {
          kind: "direct_observation",
          sourceId: `${beforeEvidenceRef}:status`,
          sourceRevision: params.sourceRevision,
          subject: `candidate:${params.candidateIdentity}`,
          predicate: "validation.status",
          value: "pending",
          evidenceRefs: [beforeEvidenceRef],
        },
      ],
    });
    candidateValidationBeforeObservationIds = before.observationIds;
  }
  if (recipeGateCEffectKind && episode) {
    const gateNode = prepared.plan.nodes[0];
    if (!gateNode?.capabilityId) {
      throw new Error("Gate C recipe is missing a server-owned capability.");
    }
    const identity = gateCEffectIdentity({
      kind: recipeGateCEffectKind,
      operationId: params.operationId,
    });
    const beforeEvidenceRef = `gate-c:${claimed.id}:${claimed.attempt}:before`;
    const afterEvidenceRef = `gate-c:${claimed.id}:${claimed.attempt}:after`;
    const action = buildGateCAction({
      actionId: `action:${claimed.id}:${claimed.attempt}:gate-c`,
      episodeId: episode.episodeId,
      projectId: params.projectId,
      operationId: params.operationId,
      sourceRevision: params.sourceRevision,
      recipeId: params.recipeId,
      capabilityId: gateNode.capabilityId,
      approvedPaths: normalizedPaths(params.approvedPaths),
      candidateIdentity: params.candidateIdentity,
    });
    const actionContract = strategyActionContract(action);
    gateCAction = action;
    gateCEffectContract = buildGateCEffectContract({
      kind: recipeGateCEffectKind,
      operationId: params.operationId,
      beforeEvidenceRef,
      afterEvidenceRef,
    });
    await appendEpisodeEvent({
      episodeId: episode.episodeId,
      projectId: params.projectId,
      executionId: claimed.id,
      attempt: claimed.attempt,
      workerId,
      eventType: "ACTION_REQUESTED",
      payload: {
        actionId: action.actionId,
        capabilityId: action.capabilityId,
        expectedEffects: action.expectedEffects,
        observationProfile: action.observationProfile,
        actionContract,
        actionContractHash: canonicalJsonHash(actionContract),
      },
      actorType: "worker",
      actorId: workerId,
      correlationId: claimed.id,
    });
    const before = await materializeServerOwnedObservations({
      projectId: params.projectId,
      executionId: claimed.id,
      attempt: claimed.attempt,
      episodeId: episode.episodeId,
      projectRevision: params.sourceRevision,
      materializeWorldState: false,
      sources: [{
        kind: "direct_observation",
        sourceId: `${beforeEvidenceRef}:${identity.subject}:${identity.predicate}`,
        sourceRevision: params.sourceRevision,
        subject: identity.subject,
        predicate: identity.predicate,
        value: "pending",
        evidenceRefs: [beforeEvidenceRef],
      }],
    });
    gateCBeforeObservationIds = before.observationIds;
  }
  const checkpoint = parseAiExecutionCheckpoint(claimed.checkpoint);
  const runningRecipeBinding = checkpoint?.recipeBinding ?? {
    ...prepared.binding,
    phase: "running" as const,
    leaseOwner: workerId,
    leaseUntil: new Date(Date.now() + 300_000).toISOString(),
  };
  const resumedNodes = reconcileExecutionNodeCheckpoint(prepared.plan.nodes, checkpoint?.nodeStates);
  if (!resumedNodes) {
    await failAiExecution({
      executionId: claimed.id,
      workerId,
      error: "Recipe checkpoint does not match the server-owned recipe plan.",
      recipeBinding: runningRecipeBinding,
    });
    throw new Error("Recipe checkpoint could not be reconciled with the server-owned plan.");
  }
  const outputs = new Map<string, Record<string, unknown>>();
  for (const node of checkpoint?.nodeStates ?? []) {
    if (node.status !== "passed") continue;
    const evidenceId = node.evidenceRefs?.find((value): value is string => typeof value === "string" && value.length > 0);
    if (!evidenceId) {
      await failAiExecution({
        executionId: claimed.id,
        workerId,
        error: "Recipe checkpoint passed node has no retained evidence receipt.",
        recipeBinding: runningRecipeBinding,
      });
      throw new Error("Recipe checkpoint passed node is missing retained evidence.");
    }
    outputs.set(node.id, { evidence: { evidenceId } });
  }

  const registry = createServerCapabilityRegistry({
    validationRunner: params.validationRunner ?? (async (profile, targetPaths, signal) =>
      runRepairValidation(
        executionRoot,
        profile as Parameters<typeof runRepairValidation>[1],
        targetPaths,
        signal,
      )),
    ...(params.githubDeliveryRunner ? { githubDeliveryRunner: params.githubDeliveryRunner } : {}),
    ...(params.runtimeStartRunner ? { runtimeStartRunner: params.runtimeStartRunner } : {}),
    databaseReadRunner: params.databaseReadRunner ?? DEFAULT_DATABASE_READ_RUNNER,
    ...(params.browserValidationRunner
      ? {
          browserValidationRunner: params.browserValidationRunner,
          browserProfiles: ["default"],
        }
      : {}),
  });
  const overallController = new AbortController();
  await registerAiExecutionController(claimed.id, overallController);
  const heartbeatTimer = setInterval(() => {
    void heartbeatAiExecution({
      executionId: claimed.id,
      expectedAttempt: claimed.attempt,
      workerId,
    }).then((ok) => {
      if (!ok) overallController.abort();
    }).catch(() => overallController.abort());
  }, 30_000);
  const abortOverall = () => overallController.abort();
  const totalTimer = setTimeout(abortOverall, prepared.binding.missionBudget.maxTotalTimeoutMs);
  // checkpoint_version is a PostgreSQL integer. Continue from the durable
  // version claimed above instead of using wall-clock milliseconds, which
  // overflow the column on the first progress checkpoint.
  let checkpointSequence = claimed.checkpointVersion;
  let latestNodes = resumedNodes;
  try {
    const result = await executeExecutionNodePlan({
      nodes: resumedNodes,
      maxParallelNodes: prepared.binding.concurrencyBudget.maxInFlightNodes,
      signal: overallController.signal,
      authorizeNodeExecution: ({ phase }) => authorizeRecipeNodeExecution({
        executionId: claimed.id,
        userId: params.userId,
        workerId,
        binding: {
          ...prepared.binding,
          phase: "running",
          leaseOwner: workerId,
          leaseUntil: new Date(Date.now() + 300_000).toISOString(),
        },
        phase,
      }),
      runNode: async (node, context) => {
        if (context.signal?.aborted || overallController.signal.aborted) {
          return { status: "blocked" as const, detail: "recipe execution cancelled" };
        }
        assertRecipeNodeBinding(prepared.binding, node, {
          projectId: params.projectId,
          operationId: params.operationId,
          sourceRevision: params.sourceRevision,
          candidateIdentity: params.candidateIdentity ?? null,
          candidateWorkspace: params.candidateWorkspace ?? null,
          approvedPaths: normalizedPaths(params.approvedPaths),
        });
        if (params.candidateWorkspace) {
          const currentCandidateRoot = await canonicalCandidateWorkspace(params.candidateWorkspace);
          if (currentCandidateRoot !== executionRoot) {
            return { status: "blocked" as const, detail: "Recipe candidate workspace canonical identity changed." };
          }
        }
        if (params.skillBinding) {
          await requireActiveSkillRegistry({
            projectId: params.projectId,
            skillId: params.skillBinding.skillId,
            skillVersion: params.skillBinding.skillVersion,
            candidateId: params.candidateIdentity,
            sourceRevision: params.sourceRevision,
            candidateTreeHash: params.candidateIdentity,
            registryId: params.skillBinding.registryId,
            proofReceiptId: params.skillBinding.proofReceiptId,
            shadowReplayId: params.skillBinding.shadowReplayId,
          });
        }
        const nodeController = new AbortController();
        const abortNode = () => nodeController.abort();
        const nodeTimer = setTimeout(abortNode, node.executionTimeoutMs);
        const abortFromOverall = () => nodeController.abort();
        overallController.signal.addEventListener("abort", abortFromOverall, { once: true });
        context.signal?.addEventListener("abort", abortFromOverall, { once: true });
        try {
          const checkpointNodes = latestNodes.some((candidate) => candidate.id === node.id)
            ? latestNodes
            : [...latestNodes, { ...node, status: "running" as const }];
          const externalEffect = externalEffectForNodes(
            checkpointNodes.map((candidate) => candidate.id === node.id
              ? { ...candidate, status: "running" as const }
              : candidate),
            params.operationId,
          );
          if (externalEffect) {
            const liveBinding = {
              ...prepared.binding,
              phase: "running" as const,
              leaseOwner: workerId,
              leaseUntil: new Date(Date.now() + 300_000).toISOString(),
            };
            const checkpointed = await checkpointAiExecution({
              executionId: claimed.id,
              expectedAttempt: claimed.attempt,
              workerId,
              recipeBinding: liveBinding,
              checkpoint: {
                stage: "running",
                sequence: ++checkpointSequence,
                currentNode: node.id,
                externalEffect,
                ...(checkpoint?.operation ? { operation: { ...checkpoint.operation, binding: liveBinding } } : {}),
                recipeBinding: liveBinding,
                nodeStates: checkpointNodes.map((candidate) => ({
                  ...candidate,
                  evidenceRefs: candidate.status === "passed"
                    ? [receiptIdForEvidence({ status: candidate.status, outputs: outputs.get(candidate.id) })]
                      .filter((id): id is string => typeof id === "string")
                    : [],
                })),
                completedNodes: checkpointNodes.filter((candidate) => candidate.status === "passed").map((candidate) => candidate.id),
                updatedAt: new Date().toISOString(),
              },
            });
            if (!checkpointed) {
              return { status: "blocked" as const, detail: "Recipe could not durably record the external delivery intent." };
            }
          }
          const invocation = await registry.invoke(
            node.capabilityId!,
            node.recipeVersion!,
            node.capabilityInput,
            {
              rootPath: executionRoot,
              operation: "recipe",
              projectId: params.projectId,
              operationId: params.operationId,
              signal: nodeController.signal,
              scope: node.executionContext?.scope,
              allowedFiles: node.allowedFiles,
              approvalState: "APPROVED",
              authorized: true,
              revision: node.executionContext?.revision,
            },
          );
          if (!invocation.ok) return { status: "failed" as const, detail: invocation.code };
          const output = invocation.output as Record<string, unknown>;
          outputs.set(node.id, output);
          const evidence = output.evidence;
          const hasVerifiedReceipt = Boolean(
            evidence
            && typeof evidence === "object"
            && !Array.isArray(evidence)
            && typeof (evidence as { evidenceId?: unknown }).evidenceId === "string",
          );
          if (recipeGateCEffectKind && episode && gateCAction && gateCEffectContract && gateCBeforeObservationIds) {
            const identity = gateCEffectIdentity({
              kind: recipeGateCEffectKind,
              operationId: params.operationId,
            });
            const afterEvidenceRef = `gate-c:${claimed.id}:${claimed.attempt}:after`;
            const afterStatus = output.status === "passed" && hasVerifiedReceipt ? "passed" : "failed";
            await appendEpisodeEvent({
              episodeId: episode.episodeId,
              projectId: params.projectId,
              executionId: claimed.id,
              attempt: claimed.attempt,
              workerId,
              eventType: "ACTION_COMMITTED",
              payload: {
                actionId: gateCAction.actionId,
                capabilityId: gateCAction.capabilityId,
                status: afterStatus,
              },
              actorType: "worker",
              actorId: workerId,
              correlationId: claimed.id,
            });
            const afterEvidence = typeof evidence === "object" && evidence && !Array.isArray(evidence)
              ? evidence as Record<string, unknown>
              : {};
            const after = await materializeServerOwnedObservations({
              projectId: params.projectId,
              executionId: claimed.id,
              attempt: claimed.attempt,
              episodeId: episode.episodeId,
              projectRevision: params.sourceRevision,
              materializeWorldState: false,
              sources: [{
                kind: "direct_observation",
                sourceId: `${afterEvidenceRef}:${identity.subject}:${identity.predicate}`,
                sourceRevision: params.sourceRevision,
                subject: identity.subject,
                predicate: identity.predicate,
                value: afterStatus,
                evidenceRefs: [
                  afterEvidenceRef,
                  ...(typeof afterEvidence.evidenceId === "string" ? [afterEvidence.evidenceId] : []),
                  ...(typeof afterEvidence.artifactRef === "string" ? [afterEvidence.artifactRef] : []),
                ],
              }],
            });
            const effect = await verifyAndPersistEffect({
              projectId: params.projectId,
              executionId: claimed.id,
              attempt: claimed.attempt,
              episodeId: episode.episodeId,
              workerId,
              action: gateCAction,
              effectContract: gateCEffectContract,
              beforeObservationIds: gateCBeforeObservationIds,
              afterObservationIds: after.observationIds,
            });
            if (effect.status !== "observed") {
              return {
                status: "failed" as const,
                detail: `Gate C effect was ${effect.status}.`,
                validationAttempts: 1,
              };
            }
            gateCEffectBundleId = effect.effectBundleId;
          }
          const passed = output.status === "passed" && hasVerifiedReceipt;
          return {
            status: passed ? "passed" as const : "failed" as const,
            detail: JSON.stringify(output).slice(0, prepared.binding.missionBudget.maxOutputBytes),
            validationAttempts: 1,
          };
        } finally {
          clearTimeout(nodeTimer);
          overallController.signal.removeEventListener("abort", abortFromOverall);
          context.signal?.removeEventListener("abort", abortFromOverall);
        }
      },
      onChange: ({ nodes }) => {
        latestNodes = nodes;
        const externalEffect = externalEffectForNodes(nodes, params.operationId);
        const liveBinding = {
          ...prepared.binding,
          phase: "running" as const,
          leaseOwner: workerId,
          leaseUntil: new Date(Date.now() + 300_000).toISOString(),
        };
        void checkpointAiExecution({
          executionId: claimed.id,
          expectedAttempt: claimed.attempt,
          workerId,
          recipeBinding: liveBinding,
          checkpoint: {
            stage: "running",
            sequence: ++checkpointSequence,
            ...(checkpoint?.operation ? { operation: { ...checkpoint.operation, binding: liveBinding } } : {}),
            recipeBinding: liveBinding,
            ...(externalEffect ? { externalEffect } : {}),
            nodeStates: nodes.map((node) => ({
              ...node,
              evidenceRefs: node.status === "passed"
                ? [receiptIdForEvidence({ status: node.status, outputs: outputs.get(node.id) })]
                  .filter((id): id is string => typeof id === "string")
                : [],
            })),
            completedNodes: nodes.filter((node) => node.status === "passed").map((node) => node.id),
            updatedAt: new Date().toISOString(),
          },
        }).then(async (ok) => {
          if (ok) return;
          const stillOwnsLease = await ownsAiExecutionLease({
            executionId: claimed.id,
            workerId,
          });
          if (!stillOwnsLease) overallController.abort();
        }).catch(() => overallController.abort());
      },
    });
    if (result.status !== "passed" || overallController.signal.aborted) {
      if (candidateValidation && episode && candidateValidationAction) {
        await appendEpisodeEvent({
          episodeId: episode.episodeId,
          projectId: params.projectId,
          executionId: claimed.id,
          attempt: claimed.attempt,
          workerId,
          eventType: "ACTION_COMMITTED",
          payload: {
            actionId: candidateValidationAction.actionId,
            capabilityId: candidateValidationAction.capabilityId,
            status: "failed",
            reason: overallController.signal.aborted ? "deadline" : "node_failed",
          },
          actorType: "worker",
          actorId: workerId,
          correlationId: claimed.id,
        });
      }
      await failAiExecution({
        executionId: claimed.id,
        workerId,
        error: overallController.signal.aborted ? "Recipe execution exceeded its overall deadline." : "Recipe node execution was blocked.",
        nodeStates: result.nodes.map((node) => ({
          ...node,
          evidenceRefs: node.status === "passed"
            ? [receiptIdForEvidence({ status: node.status, outputs: outputs.get(node.id) })]
              .filter((id): id is string => typeof id === "string")
            : [],
        })),
        recipeBinding: { ...prepared.binding, phase: "running", leaseOwner: workerId, leaseUntil: new Date(Date.now() + 300_000).toISOString() },
      });
      const receipt = buildRecipeReceipt(params, claimed.id, claimed.attempt, "blocked", result.nodes, outputs, result.completedNodeIds);
      return { executionId: claimed.id, status: "blocked", completedNodeIds: result.completedNodeIds, receipt };
    }

    const evidence = evidenceForNodes(result.nodes, outputs);
    const advanced = advanceRecipeToTerminal(prepared.plan, evidence, overallController.signal);
    const outcome = prepared.plan.outcomeContract
      ? evaluateRecipeEvidencePredicate(prepared.plan.outcomeContract.success, evidence)
      : false;
    if (advanced.status !== "succeeded" || outcome !== true) {
      await failAiExecution({
        executionId: claimed.id,
        workerId,
        error: "Recipe outcome contract was not satisfied.",
        nodeStates: result.nodes.map((node) => ({ ...node, evidenceRefs: [] })),
        recipeBinding: { ...prepared.binding, phase: "running", leaseOwner: workerId, leaseUntil: new Date(Date.now() + 300_000).toISOString() },
      });
      const receipt = buildRecipeReceipt(params, claimed.id, claimed.attempt, "blocked", result.nodes, outputs, result.completedNodeIds);
      return { executionId: claimed.id, status: "blocked", completedNodeIds: result.completedNodeIds, receipt };
    }
    const evidenceRefs = Object.values(evidence)
      .map(receiptIdForEvidence)
      .filter((id): id is string => typeof id === "string");
    const completionEvidence = Object.values(evidence)
      .map((entry) => entry.outputs?.evidence)
      .filter((value): value is {
        evidenceId: string;
        artifactRef: string;
        operationId: string;
        projectRevision: string;
        candidateHash: string;
      } => Boolean(
        value
        && typeof value === "object"
        && !Array.isArray(value)
        && typeof (value as { evidenceId?: unknown }).evidenceId === "string"
        && typeof (value as { artifactRef?: unknown }).artifactRef === "string"
        && typeof (value as { operationId?: unknown }).operationId === "string"
        && typeof (value as { projectRevision?: unknown }).projectRevision === "string"
        && typeof (value as { candidateHash?: unknown }).candidateHash === "string",
      ));
    if (evidenceRefs.length !== result.nodes.length) {
      await failAiExecution({
        executionId: claimed.id,
        workerId,
        error: "Recipe completed without a verified evidence receipt for every node.",
        nodeStates: result.nodes.map((node) => ({ ...node, evidenceRefs: [] })),
        recipeBinding: { ...prepared.binding, phase: "running", leaseOwner: workerId, leaseUntil: new Date(Date.now() + 300_000).toISOString() },
      });
      const receipt = buildRecipeReceipt(params, claimed.id, claimed.attempt, "blocked", result.nodes, outputs, result.completedNodeIds);
      return { executionId: claimed.id, status: "blocked", completedNodeIds: result.completedNodeIds, receipt };
    }
    const completedReceipt = buildRecipeReceipt(params, claimed.id, claimed.attempt, "completed", result.nodes, outputs, result.completedNodeIds);
    let taskObjective;
    try {
      taskObjective = parseTaskObjectiveContract(
        (JSON.parse(claimed.request) as { taskObjective?: unknown }).taskObjective,
      );
    } catch {
      taskObjective = undefined;
    }
    const validatorEvidence = completionEvidence[0];
    const validatorReceipts: TaskObjectiveValidatorReceipt[] = taskObjective && validatorEvidence
      ? taskObjective.validatorIds.map((validatorId) => {
          const evidence = validatorEvidence;
          return {
            validatorId,
            status: "PROVEN" as const,
            operationId: evidence.operationId,
            projectId: params.projectId,
            workspaceRevision: evidence.projectRevision,
            artifactRef: evidence.artifactRef,
          };
        })
      : [];
    let candidateEffectBundleId: string | undefined;
    if (
      candidateValidation
      && episode
      && candidateValidationAction
      && candidateValidationEffectContract
      && candidateValidationBeforeObservationIds
      && params.candidateIdentity
    ) {
      await appendEpisodeEvent({
        episodeId: episode.episodeId,
        projectId: params.projectId,
        executionId: claimed.id,
        attempt: claimed.attempt,
        workerId,
        eventType: "ACTION_COMMITTED",
        payload: {
          actionId: candidateValidationAction.actionId,
          capabilityId: candidateValidationAction.capabilityId,
          status: "completed",
        },
        actorType: "worker",
        actorId: workerId,
        correlationId: claimed.id,
      });
      const afterTreeHash = await hashDeliveryTree(executionRoot);
      const afterEvidenceRef = `candidate-validation:${claimed.id}:${claimed.attempt}:after`;
      const after = await materializeServerOwnedObservations({
        projectId: params.projectId,
        executionId: claimed.id,
        attempt: claimed.attempt,
        episodeId: episode.episodeId,
        projectRevision: params.sourceRevision,
        materializeWorldState: false,
        sources: [
          {
            kind: "direct_observation",
            sourceId: `${afterEvidenceRef}:workspace`,
            sourceRevision: params.sourceRevision,
            subject: `candidate:${params.candidateIdentity}`,
            predicate: "workspace.tree_hash",
            value: afterTreeHash,
            evidenceRefs: [afterEvidenceRef],
          },
          {
            kind: "direct_observation",
            sourceId: `${afterEvidenceRef}:status`,
            sourceRevision: params.sourceRevision,
            subject: `candidate:${params.candidateIdentity}`,
            predicate: "validation.status",
            value: "passed",
            evidenceRefs: [afterEvidenceRef],
          },
        ],
      });
      const effect = await verifyAndPersistEffect({
        projectId: params.projectId,
        executionId: claimed.id,
        attempt: claimed.attempt,
        episodeId: episode.episodeId,
        workerId,
        action: candidateValidationAction,
        effectContract: candidateValidationEffectContract,
        beforeObservationIds: candidateValidationBeforeObservationIds,
        afterObservationIds: after.observationIds,
      });
      if (effect.status !== "observed") {
        throw new Error(`candidate_validation_effect_${effect.status}`);
      }
      candidateEffectBundleId = effect.effectBundleId;
    }
    const terminalEffectBundleId = candidateEffectBundleId ?? gateCEffectBundleId;
    const completed = await completeAiExecution({
      executionId: claimed.id,
      workerId,
      finalMessageId: `recipe-receipt:${params.operationId}`,
      evidenceVerdict: "PROVEN",
      evidenceRefs,
      evidence: completionEvidence,
      operationId: params.operationId,
      candidateIdentity: params.candidateIdentity ?? null,
      ...(taskObjective
        ? {
            taskObjective,
            validatorReceipts,
            objectiveValidated: true,
          }
        : {}),
      recipeBinding: { ...prepared.binding, phase: "running", leaseOwner: workerId, leaseUntil: new Date(Date.now() + 300_000).toISOString() },
      nodeStates: result.nodes.map((node) => ({
        id: node.id,
        title: node.title,
        kind: "inspect" as const,
        dependencies: node.dependencies,
        status: node.status,
        attempts: node.attempts,
        validationAttempts: node.validationAttempts,
        allowedFiles: node.allowedFiles,
        validationProfile: node.validationProfile,
        evidenceRefs: evidence[node.id] ? [receiptIdForEvidence(evidence[node.id])]
          .filter((id): id is string => typeof id === "string") : [],
      })),
      recipeReceipt: completedReceipt,
      ...(terminalEffectBundleId
        ? { effectRequired: true, effectBundleId: terminalEffectBundleId }
        : {}),
    });
    if (!completed) {
      const cancelledReceipt = buildRecipeReceipt(
        params,
        claimed.id,
        claimed.attempt,
        "cancelled",
        result.nodes,
        outputs,
        result.completedNodeIds,
      );
      const cancelled = await failAiExecution({
        executionId: claimed.id,
        workerId,
        cancelled: true,
        error: "Recipe execution was cancelled before terminal acceptance.",
        nodeStates: result.nodes.map((node) => ({
          id: node.id,
          title: node.title,
          kind: "inspect" as const,
          dependencies: node.dependencies,
          status: node.status,
          attempts: node.attempts,
          validationAttempts: node.validationAttempts,
          allowedFiles: node.allowedFiles,
          validationProfile: node.validationProfile,
          evidenceRefs: evidence[node.id] ? [receiptIdForEvidence(evidence[node.id])]
            .filter((id): id is string => typeof id === "string") : [],
        })),
        recipeBinding: { ...prepared.binding, phase: "running", leaseOwner: workerId, leaseUntil: new Date(Date.now() + 300_000).toISOString() },
        recipeReceipt: cancelledReceipt,
      });
      if (cancelled) {
        return {
          executionId: claimed.id,
          status: "blocked",
          completedNodeIds: result.completedNodeIds,
          receipt: cancelledReceipt,
        };
      }
      const terminalExecution = await getAiExecutionForUser(claimed.id, params.userId);
      if (terminalExecution?.status === "cancelled") {
        await persistCancelledRecipeReceipt({
          executionId: claimed.id,
          userId: params.userId,
          recipeReceipt: cancelledReceipt,
        });
        return {
          executionId: claimed.id,
          status: "blocked",
          completedNodeIds: result.completedNodeIds,
          receipt: cancelledReceipt,
        };
      }
      throw new Error("Recipe completion lost its durable ownership fence.");
    }
    const receipt = completedReceipt;
    if (episode) {
      try {
        const extraction = await extractAcceptedEpisodeStrategy({
          projectId: params.projectId,
          episodeId: episode.episodeId,
        });
        if (extraction.status === "stored") {
          logger.info(
            {
              scope: "recipe-operation",
              executionId: claimed.id,
              episodeId: episode.episodeId,
              candidateId: extraction.candidate.candidateId,
              created: extraction.created,
            },
            "Accepted episode strategy candidate extracted",
          );
        } else {
          logger.info(
            {
              scope: "recipe-operation",
              executionId: claimed.id,
              episodeId: episode.episodeId,
              reason: extraction.reason,
            },
            "Accepted episode was not eligible for strategy extraction",
          );
        }
    if (
      extraction.status === "not_eligible"
      && extraction.reason === "candidate_evaluation_started"
    ) {
      try {
        const registration = await registerProspectiveStrategyReplayCase({
          projectId: params.projectId,
          episodeId: episode.episodeId,
        });
        if (registration.status === "registered") {
          logger.info(
            {
              scope: "recipe-operation",
              executionId: claimed.id,
              episodeId: episode.episodeId,
              caseId: registration.caseId,
              candidateId: registration.candidateId,
            },
            "Prospective Strategy Replay case registered",
          );
        }
      } catch (error) {
        logger.warn(
          {
            scope: "recipe-operation",
            code: "strategy_replay_case_registration_failed",
            executionId: claimed.id,
            episodeId: episode.episodeId,
            error,
          },
          "Strategy Replay case registration failed without changing the accepted recipe outcome",
        );
      }
    }
      } catch (error) {
        logger.warn(
          {
            scope: "recipe-operation",
            code: "strategy_candidate_extraction_failed",
            executionId: claimed.id,
            episodeId: episode.episodeId,
            error,
          },
          "Strategy extraction failed without changing the accepted recipe outcome",
        );
      }
    }
    await materializeServerOwnedObservations({
      projectId: params.projectId,
      executionId: claimed.id,
      attempt: receipt.attempt ?? claimed.attempt,
      ...(episode ? { episodeId: episode.episodeId } : {}),
      projectRevision: receipt.sourceRevision,
      sources: [
        {
          kind: "acceptance",
          sourceId: `acceptance:${claimed.id}:${receipt.attempt ?? claimed.attempt}`,
          sourceRevision: receipt.sourceRevision,
          terminalStatus: "completed",
          outcome: "SUCCEEDED",
          reasonCode: "ACCEPTED",
          evidenceComplete: true,
          evidenceRefs: receipt.evidenceRefs,
        },
        {
          kind: "runtime_receipt",
          sourceId: `runtime:${claimed.id}:${receipt.attempt ?? claimed.attempt}`,
          sourceRevision: receipt.sourceRevision,
          status: "passed",
          profile: "recipe",
          candidateIdentity: params.candidateIdentity,
        },
        {
          kind: "delivery_receipt",
          sourceId: `delivery:${claimed.id}:${receipt.attempt ?? claimed.attempt}`,
          sourceRevision: receipt.sourceRevision,
          status: "passed",
          candidateIdentity: params.candidateIdentity,
          treeHash: receipt.treeHash ?? receipt.candidateTreeHash,
        },
        ...validatorReceipts.map((validator) => ({
          kind: "validator_receipt" as const,
          validatorId: validator.validatorId,
          operationId: validator.operationId,
          projectId: validator.projectId,
          workspaceRevision: validator.workspaceRevision,
          status: validator.status,
          artifactRef: validator.artifactRef,
        })),
      ],
    }).catch((error: unknown) => {
      logger.warn(
        { scope: "recipe-operation", code: "observation_materialization_failed", executionId: claimed.id, error },
        "Server-owned recipe observation materialization failed after acceptance",
      );
    });
    return { executionId: claimed.id, status: "completed", completedNodeIds: result.completedNodeIds, receipt };
  } finally {
    clearTimeout(totalTimer);
    clearInterval(heartbeatTimer);
    unregisterAiExecutionController(claimed.id, overallController);
  }
}