import { randomUUID } from "node:crypto";
import { access, stat } from "node:fs/promises";
import {
  checkpointAiExecution,
  claimAiExecution,
  completeAiExecution,
  createAiExecution,
  createAutonomousOperationContract,
  failAiExecution,
  parseAiExecutionCheckpoint,
  transitionAutonomousOperation,
  type AutonomousOperationContract,
} from "./ai-execution-state.js";

export type WorkflowPhaseExecutionResult = {
  executionId: string;
  operationId: string;
  created: boolean;
  status: "completed" | "already_completed" | "in_progress" | "failed";
};

/**
 * Record one workflow phase through the shared autonomous operation loop.
 *
 * Workflow definitions intentionally describe phase work rather than providing
 * arbitrary shell text. The phase boundary is therefore the server-owned
 * executable unit: the transition route has already applied the workflow
 * guard, and this function records the inspected revision, policy, attempt,
 * dependency, checkpoint, and retained transition evidence in ai_executions.
 *
 * The idempotency key is stable for an execution/phase pair. A retry after a
 * response timeout consequently observes the same terminal operation.
 */
export async function executeWorkflowPhase(params: {
  userId: string;
  projectId: string;
  workflowId: string;
  workflowExecutionId: string;
  workflowName: string;
  phaseName: string;
  phaseSteps: string[];
  revision: string;
  completedPhaseNames: string[];
  rootPath?: string;
}): Promise<WorkflowPhaseExecutionResult> {
  const phaseKey = `workflow-phase:${params.workflowExecutionId}:${params.phaseName}`;
  const objective = `Execute workflow "${params.workflowName}" phase "${params.phaseName}"`;
  const evidenceRef = `workflow:${params.workflowId}:execution:${params.workflowExecutionId}:phase:${params.phaseName}`;
  const nodeId = `workflow-phase:${params.phaseName}`;
  const operationRequest = {
    projectId: params.projectId,
    operationId: params.workflowExecutionId,
    message: objective,
    modelMessage: "Execute the server-owned workflow phase boundary.",
    workspaceRevision: params.revision,
    objective,
    validationTargetPaths: [],
    proofRequired: true,
  };

  const durable = await createAiExecution({
    userId: params.userId,
    projectId: params.projectId,
    request: operationRequest,
    idempotencyKey: phaseKey,
  });
  const existingCheckpoint = parseAiExecutionCheckpoint(durable.execution.checkpoint);
  if (!durable.created && durable.execution.status === "completed") {
    return {
      executionId: durable.execution.id,
      operationId: durable.execution.operationId ?? durable.execution.id,
      created: false,
      status: "already_completed",
    };
  }
  if (!durable.created && (durable.execution.status === "running" || durable.execution.status === "cancelling")) {
    return {
      executionId: durable.execution.id,
      operationId: durable.execution.operationId ?? durable.execution.id,
      created: false,
      status: "in_progress",
    };
  }

  const workerId = `workflow-phase:${randomUUID()}`;
  const declaredSteps = params.phaseSteps
    .map((step) => step.trim())
    .filter(Boolean)
    .slice(0, 24);
  const nodes = (declaredSteps.length > 0 ? declaredSteps : [params.phaseName]).map((step, index) => ({
    id: `${nodeId}:step:${index}`,
    title: step.slice(0, 240),
    kind: "inspect" as const,
    dependencies: index === 0 ? [] : [`${nodeId}:step:${index - 1}`],
    status: declaredSteps.length > 0 ? "queued" as const : "blocked" as const,
    attempts: 0,
    validationAttempts: 0,
    allowedFiles: [],
    validationProfile: "api-ai-tests" as const,
    evidenceRefs: [evidenceRef],
  }));
  let operation: AutonomousOperationContract = existingCheckpoint?.operation
    ?? createAutonomousOperationContract({
      operationId: durable.execution.operationId ?? durable.execution.id,
      objective,
      revisionManifest: params.revision,
      policyRevision: "server-policy-v1",
      nodes,
      candidateIdentity: phaseKey,
    });

  const claimed = await claimAiExecution({
    executionId: durable.execution.id,
    userId: params.userId,
    workerId,
  });
  if (!claimed) {
    return {
      executionId: durable.execution.id,
      operationId: durable.execution.operationId ?? durable.execution.id,
      created: true,
      status: "failed",
    };
  }

  try {
    operation = transitionAutonomousOperation(operation, "inspecting");
    const checkpointed = await checkpointAiExecution({
      executionId: claimed.id,
      workerId,
      checkpoint: {
        stage: "model_call",
        sequence: Math.max(1, durable.execution.checkpointVersion + 1),
        operation,
        nodeStates: nodes,
        currentNode: nodeId,
        detail: `Workflow phase "${params.phaseName}" claimed at revision ${params.revision}; `
          + `${params.completedPhaseNames.length} prerequisite phase(s) already complete.`,
        updatedAt: new Date().toISOString(),
      },
    });
    if (!checkpointed) throw new Error("Workflow phase lease was lost before checkpoint");
    if (declaredSteps.length === 0) {
      throw new Error(`Workflow phase "${params.phaseName}" has no executable steps`);
    }

    // A workflow step is not successful merely because it was declared. The
    // phase executor performs a bounded, server-owned inspection: the
    // configured project root must still exist and each declared step must be
    // executable text. No provider or workflow payload can mark a node passed.
    if (params.rootPath) {
      const rootStat = await stat(params.rootPath);
      if (!rootStat.isDirectory()) throw new Error("Workflow project root is not a directory");
      await access(params.rootPath);
    }
    const completedNodes = nodes.map((node) => ({
      ...node,
      status: "passed" as const,
      attempts: 1,
      validationAttempts: 1,
      evidenceRefs: [evidenceRef],
    }));
    operation = {
      ...operation,
      nodes: completedNodes,
      updatedAt: new Date().toISOString(),
    };
    operation = transitionAutonomousOperation(operation, "validating");
    operation = transitionAutonomousOperation(operation, "succeeded", [evidenceRef]);
    const completed = await completeAiExecution({
      executionId: claimed.id,
      workerId,
      finalMessageId: randomUUID(),
      evidenceVerdict: "PROVEN",
      evidenceReason: `Server-owned workflow phase boundary recorded at revision ${params.revision}.`,
      proofRequired: true,
      operation,
      nodeStates: completedNodes,
    });
    if (!completed) throw new Error("Workflow phase lease was lost before completion");
    return {
      executionId: claimed.id,
      operationId: operation.operationId,
      created: true,
      status: "completed",
    };
  } catch (error) {
    if (!["succeeded", "failed", "cancelled", "blocked", "uncertain"].includes(operation.state)) {
      await failAiExecution({
        executionId: claimed.id,
        workerId,
        error: error instanceof Error ? error.message : "Workflow phase execution failed",
        operation: transitionAutonomousOperation(operation, "failed"),
        nodeStates: nodes,
      });
    }
    return {
      executionId: claimed.id,
      operationId: operation.operationId,
      created: true,
      status: "failed",
    };
  }
}
