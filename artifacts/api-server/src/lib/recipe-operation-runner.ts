import {
  compileCapabilityRecipe,
  createServerCapabilityRegistry,
  executeExecutionNodePlan,
  type ActiveTaskExecutionPlan,
} from "@workspace/ai-orchestrator";
import {
  assertRecipeNodeBinding,
  checkpointAiExecution,
  claimAiExecution,
  completeAiExecution,
  createAiExecution,
  createRecipeOperationBinding,
  type RecipeOperationBinding,
} from "./ai-execution-state.js";

export type PrepareRecipeOperationParams = {
  projectId: string;
  operationId: string;
  rootPath: string;
  sourceRevision: string;
  approvedPaths?: readonly string[];
  candidateIdentity?: string | null;
  candidateWorkspace?: string | null;
  recipe: unknown;
};

export type PreparedRecipeOperation = {
  plan: ActiveTaskExecutionPlan;
  binding: RecipeOperationBinding;
};

/**
 * Compile only after the server has established the project context. This is
 * intentionally the sole entry point for recipe compilation in the API
 * server; callers cannot supply a root, profile, timeout, or process budget.
 */
export function prepareRecipeOperation(params: PrepareRecipeOperationParams): PreparedRecipeOperation {
  const approvedPaths = [...new Set((params.approvedPaths ?? []).map((path) => path.trim().replaceAll("\\", "/")))];
  const registry = createServerCapabilityRegistry();
  const compiled = compileCapabilityRecipe(params.recipe, {
    registry,
    context: {
      projectId: params.projectId,
      rootPath: params.rootPath,
      revision: params.sourceRevision,
      operation: "recipe",
      scope: { kind: approvedPaths.length === 1 ? "file" : "paths", paths: approvedPaths },
      allowedFiles: approvedPaths,
      authorized: true,
      approvalState: "APPROVED",
      maxRisk: "low",
      validationProfile: "workspace-typecheck",
    },
  });
  if (!compiled.ok) {
    throw new Error(compiled.diagnostics.map((diagnostic) => diagnostic.code).join(", "));
  }
  if (compiled.plan.nodes.length !== 1 || compiled.plan.nodes[0]?.capabilityId === undefined) {
    throw new Error("Only one-node capability recipes are eligible for durable execution.");
  }
  const binding = createRecipeOperationBinding({
    projectId: params.projectId,
    operationId: params.operationId,
    sourceRevision: params.sourceRevision,
    approvedPaths,
    candidateIdentity: params.candidateIdentity,
    candidateWorkspace: params.candidateWorkspace,
    missionBudget: {
      maxNodes: compiled.plan.executionPolicy?.maxNodes ?? 1,
      maxParallelNodes: 1,
      maxTotalTimeoutMs: compiled.plan.executionPolicy?.maxTotalTimeoutMs ?? 900_000,
      maxProcessCount: 1,
      maxOutputBytes: 200_000,
    },
    concurrencyBudget: { maxInFlightNodes: 1, maxProcesses: 1 },
  });
  assertRecipeNodeBinding(binding, compiled.plan.nodes[0]!);
  return { plan: compiled.plan, binding };
}

export type RunRecipeOperationParams = PrepareRecipeOperationParams & {
  userId: string;
  sessionId?: string;
  idempotencyKey: string;
};

export async function runRecipeOperation(params: RunRecipeOperationParams): Promise<{
  executionId: string;
  status: "completed" | "blocked";
  completedNodeIds: string[];
}> {
  const prepared = prepareRecipeOperation(params);
  const executionRequest = {
    projectId: params.projectId,
    operationId: params.operationId,
    sessionId: params.sessionId,
    message: `recipe:${params.operationId}`,
    modelMessage: `recipe:${params.operationId}`,
    workspaceRevision: params.sourceRevision,
    validationTargetPaths: [...(params.approvedPaths ?? [])],
  };
  const created = await createAiExecution({
    userId: params.userId,
    request: executionRequest,
    idempotencyKey: params.idempotencyKey,
    projectId: params.projectId,
    sessionId: params.sessionId,
    recipeBinding: prepared.binding,
  });
  const claimed = await claimAiExecution({
    executionId: created.execution.id,
    userId: params.userId,
    workerId: `recipe:${params.operationId}`,
    recipeBinding: prepared.binding,
  });
  if (!claimed) throw new Error("Recipe operation could not acquire its durable lease.");

  const registry = createServerCapabilityRegistry();
  const result = await executeExecutionNodePlan({
    nodes: prepared.plan.nodes,
    maxParallelNodes: prepared.binding.concurrencyBudget.maxInFlightNodes,
    authorizeNodeExecution: () => ({ allowed: true }),
    runNode: async (node, context) => {
      if (context.signal?.aborted) return { status: "blocked" as const, detail: "recipe execution cancelled" };
      const invocation = await registry.invoke(
        node.capabilityId!,
        node.recipeVersion!,
        node.capabilityInput,
        { rootPath: params.rootPath, operation: "recipe", signal: context.signal },
      );
      if (!invocation.ok) return { status: "failed" as const, detail: invocation.code };
      return {
        status: "passed" as const,
        detail: JSON.stringify(invocation.output).slice(0, prepared.binding.missionBudget.maxOutputBytes),
        validationAttempts: 1,
      };
    },
    onChange: ({ nodes }) => {
      void checkpointAiExecution({
        executionId: claimed.id,
        workerId: `recipe:${params.operationId}`,
        recipeBinding: { ...prepared.binding, phase: "running", leaseOwner: `recipe:${params.operationId}`, leaseUntil: new Date(Date.now() + 300_000).toISOString() },
        checkpoint: {
          stage: "running",
          sequence: Date.now(),
          nodeStates: nodes.map((node) => ({ ...node })),
          completedNodes: nodes.filter((node) => node.status === "passed").map((node) => node.id),
          updatedAt: new Date().toISOString(),
        },
      }).catch(() => undefined);
    },
  });
  if (result.status === "passed") {
    const completed = await completeAiExecution({
      executionId: claimed.id,
      workerId: `recipe:${params.operationId}`,
      finalMessageId: `recipe-receipt:${params.operationId}`,
      evidenceVerdict: "PROVEN",
      evidenceRefs: [`recipe:${params.operationId}:completed`],
      recipeBinding: { ...prepared.binding, phase: "running", leaseOwner: `recipe:${params.operationId}`, leaseUntil: new Date(Date.now() + 300_000).toISOString() },
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
        evidenceRefs: [`recipe:${params.operationId}:${node.id}`],
      })),
    });
    if (!completed) throw new Error("Recipe completion lost its durable ownership fence.");
  }
  return {
    executionId: claimed.id,
    status: result.status === "passed" ? "completed" : "blocked",
    completedNodeIds: result.completedNodeIds,
  };
}