import path from "node:path";
import { randomUUID } from "node:crypto";
import { realpath } from "node:fs/promises";
import {
  advanceCompiledRecipeTransition,
  compileCapabilityRecipe,
  createServerCapabilityRegistry,
  createServerRecipeDefinitionRegistry,
  evaluateRecipeEvidencePredicate,
  executeExecutionNodePlan,
  type ActiveTaskExecutionPlan,
  type BrowserValidationRunner,
  type RecipeEvidence,
} from "@workspace/ai-orchestrator";
import {
  assertRecipeNodeBinding,
  authorizeRecipeNodeExecution,
  checkpointAiExecution,
  claimAiExecution,
  completeAiExecution,
  createAiExecution,
  createRecipeOperationBinding,
  failAiExecution,
  heartbeatAiExecution,
  registerAiExecutionController,
  unregisterAiExecutionController,
  type RecipeOperationBinding,
} from "./ai-execution-state.js";
import { RecipeReceiptSchema, type RecipeReceipt } from "@workspace/ai-orchestrator";
import { runRepairValidation } from "./ai-repair-validation.js";
import { HOST_DISPOSABLE_TEMP_ROOT } from "./disposable-temp.js";

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
  browserValidationRunner?: BrowserValidationRunner;
};

export type PreparedRecipeOperation = {
  plan: ActiveTaskExecutionPlan;
  binding: RecipeOperationBinding;
};

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
  });
  const registry = createServerCapabilityRegistry(
    params.browserValidationRunner ? { browserProfiles: ["default"] } : {},
  );
  const compiled = compileCapabilityRecipe(recipe, {
    registry,
    context: {
      projectId: params.projectId,
      rootPath: params.rootPath,
      revision: params.sourceRevision,
      operation: "recipe",
      // Validation and browser profiles operate on a bounded set, even when
      // that set contains one file. "file" is reserved for file-native tools.
      scope: { kind: "paths", paths: approvedPaths },
      allowedFiles: approvedPaths,
      authorized: true,
      approvalState: "APPROVED",
      maxRisk: "low",
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
  sessionId?: string;
  idempotencyKey: string;
};

function evidenceForNodes(
  nodes: readonly ActiveTaskExecutionPlan["nodes"][number][],
  outputs: ReadonlyMap<string, Record<string, unknown>>,
): RecipeEvidence {
  return Object.fromEntries(nodes.map((node) => {
    const evidenceType = node.capabilityId?.startsWith("browser.verify.")
      ? "browser_verified" as const
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
  status: RecipeReceipt["status"],
  nodes: readonly ActiveTaskExecutionPlan["nodes"][number][],
  outputs: ReadonlyMap<string, Record<string, unknown>>,
  completedNodeIds: readonly string[],
): RecipeReceipt {
  const receipt = {
    contractVersion: 1 as const,
    executionId,
    operationId: params.operationId,
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
      }),
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
  const candidateRoot = await canonicalCandidateWorkspace(params.candidateWorkspace);
  const executionRoot = candidateRoot ?? path.resolve(params.rootPath);
  const executionRequest = {
    projectId: params.projectId,
    operationId: params.operationId,
    sessionId: params.sessionId,
    message: `recipe:${params.operationId}`,
    modelMessage: `recipe:${params.operationId}`,
    workspaceRevision: params.sourceRevision,
    validationTargetPaths: normalizedPaths(params.approvedPaths),
  };
  const created = await createAiExecution({
    userId: params.userId,
    request: executionRequest,
    idempotencyKey: params.idempotencyKey,
    projectId: params.projectId,
    sessionId: params.sessionId,
    recipeBinding: prepared.binding,
  });
  const workerId = `recipe:${params.operationId}:${randomUUID()}`;
  const claimed = await claimAiExecution({
    executionId: created.execution.id,
    userId: params.userId,
    workerId,
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

  const registry = createServerCapabilityRegistry({
    validationRunner: async (profile, targetPaths, signal) =>
      runRepairValidation(
        executionRoot,
        profile as Parameters<typeof runRepairValidation>[1],
        targetPaths,
        signal,
      ),
    ...(params.browserValidationRunner
      ? {
          browserValidationRunner: params.browserValidationRunner,
          browserProfiles: ["default"],
        }
      : {}),
  });
  const overallController = new AbortController();
  registerAiExecutionController(claimed.id, overallController);
  const heartbeatTimer = setInterval(() => {
    void heartbeatAiExecution({ executionId: claimed.id, workerId }).then((ok) => {
      if (!ok) overallController.abort();
    }).catch(() => overallController.abort());
  }, 30_000);
  const abortOverall = () => overallController.abort();
  const totalTimer = setTimeout(abortOverall, prepared.binding.missionBudget.maxTotalTimeoutMs);
  let checkpointSequence = Date.now();
  const outputs = new Map<string, Record<string, unknown>>();
  try {
    const result = await executeExecutionNodePlan({
      nodes: prepared.plan.nodes,
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
        const nodeController = new AbortController();
        const abortNode = () => nodeController.abort();
        const nodeTimer = setTimeout(abortNode, node.executionTimeoutMs);
        const abortFromOverall = () => nodeController.abort();
        overallController.signal.addEventListener("abort", abortFromOverall, { once: true });
        context.signal?.addEventListener("abort", abortFromOverall, { once: true });
        try {
          const invocation = await registry.invoke(
            node.capabilityId!,
            node.recipeVersion!,
            node.capabilityInput,
            {
              rootPath: executionRoot,
              operation: "recipe",
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
        void checkpointAiExecution({
          executionId: claimed.id,
          workerId,
          recipeBinding: { ...prepared.binding, phase: "running", leaseOwner: workerId, leaseUntil: new Date(Date.now() + 300_000).toISOString() },
          checkpoint: {
            stage: "running",
            sequence: ++checkpointSequence,
            nodeStates: nodes.map((node) => ({ ...node })),
            completedNodes: nodes.filter((node) => node.status === "passed").map((node) => node.id),
            updatedAt: new Date().toISOString(),
          },
        }).then((ok) => {
          if (!ok) overallController.abort();
        }).catch(() => overallController.abort());
      },
    });
    if (result.status !== "passed" || overallController.signal.aborted) {
      await failAiExecution({
        executionId: claimed.id,
        workerId,
        error: overallController.signal.aborted ? "Recipe execution exceeded its overall deadline." : "Recipe node execution was blocked.",
        nodeStates: result.nodes.map((node) => ({ ...node, evidenceRefs: [] })),
        recipeBinding: { ...prepared.binding, phase: "running", leaseOwner: workerId, leaseUntil: new Date(Date.now() + 300_000).toISOString() },
      });
      const receipt = buildRecipeReceipt(params, claimed.id, "blocked", result.nodes, outputs, result.completedNodeIds);
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
      const receipt = buildRecipeReceipt(params, claimed.id, "blocked", result.nodes, outputs, result.completedNodeIds);
      return { executionId: claimed.id, status: "blocked", completedNodeIds: result.completedNodeIds, receipt };
    }
    const evidenceRefs = Object.values(evidence)
      .map(receiptIdForEvidence)
      .filter((id): id is string => typeof id === "string");
    if (evidenceRefs.length !== result.nodes.length) {
      await failAiExecution({
        executionId: claimed.id,
        workerId,
        error: "Recipe completed without a verified evidence receipt for every node.",
        nodeStates: result.nodes.map((node) => ({ ...node, evidenceRefs: [] })),
        recipeBinding: { ...prepared.binding, phase: "running", leaseOwner: workerId, leaseUntil: new Date(Date.now() + 300_000).toISOString() },
      });
      const receipt = buildRecipeReceipt(params, claimed.id, "blocked", result.nodes, outputs, result.completedNodeIds);
      return { executionId: claimed.id, status: "blocked", completedNodeIds: result.completedNodeIds, receipt };
    }
    const completed = await completeAiExecution({
      executionId: claimed.id,
      workerId,
      finalMessageId: `recipe-receipt:${params.operationId}`,
      evidenceVerdict: "PROVEN",
      evidenceRefs,
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
      recipeReceipt: buildRecipeReceipt(params, claimed.id, "completed", result.nodes, outputs, result.completedNodeIds),
    });
    if (!completed) throw new Error("Recipe completion lost its durable ownership fence.");
    const receipt = buildRecipeReceipt(params, claimed.id, "completed", result.nodes, outputs, result.completedNodeIds);
    return { executionId: claimed.id, status: "completed", completedNodeIds: result.completedNodeIds, receipt };
  } finally {
    clearTimeout(totalTimer);
    clearInterval(heartbeatTimer);
    unregisterAiExecutionController(claimed.id, overallController);
  }
}