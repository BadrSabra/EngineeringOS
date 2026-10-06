import { randomUUID } from "node:crypto";
import { access, stat } from "node:fs/promises";
import {
  checkpointAiExecution,
  claimAiExecution,
  completeAiExecution,
  createAiExecution,
  createAutonomousOperationContract,
  failAiExecution,
  hasSuccessfulAiExecutionAcceptance,
  parseAiExecutionCheckpoint,
  transitionAutonomousOperation,
  type AutonomousOperationContract,
} from "./ai-execution-state.js";

export type WorkflowPhaseExecutionResult = {
  executionId: string;
  operationId?: string;
  created: boolean;
  status: "completed" | "already_completed" | "in_progress" | "failed";
  failureCode?: "WORKFLOW_PHASE_RUNNER_UNAVAILABLE";
};

/**
 * Record one workflow phase through the shared autonomous operation loop.
 *
 * Workflow definitions describe phase work rather than arbitrary shell text.
 * Empty phases are durable no-op boundaries. Non-empty phase steps require a
 * real runner and substantive, revision-bound evidence; this adapter has no
 * such runner, so it must fail before creating an execution or projecting a
 * Goal transition.
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
  goalId?: string;
  isFinalPhase?: boolean;
}): Promise<WorkflowPhaseExecutionResult> {
  const phaseKey = `workflow-phase:${params.workflowExecutionId}:${params.phaseName}`;
  const hasDeclaredWork = params.phaseSteps.length > 0;
  if (hasDeclaredWork) {
    return {
      executionId: params.workflowExecutionId,
      created: false,
      status: "failed",
      failureCode: "WORKFLOW_PHASE_RUNNER_UNAVAILABLE",
    };
  }
  const objective = `Execute workflow "${params.workflowName}" phase "${params.phaseName}"`;
  const nodeId = `workflow-phase:${params.phaseName}`;
  const operationRequest = {
    projectId: params.projectId,
    operationId: params.workflowExecutionId,
    message: objective,
    modelMessage: "Execute the server-owned workflow phase boundary.",
    workspaceRevision: params.revision,
    workspaceRoot: params.rootPath ?? undefined,
    objective,
    validationTargetPaths: [],
    // This execution records a phase-local boundary only. The root inspection
    // is not substantive evidence that the declared phase work was performed.
    proofRequired: false,
  };

  const durable = await createAiExecution({
    userId: params.userId,
    projectId: params.projectId,
    request: operationRequest,
    idempotencyKey: phaseKey,
    workspaceRoot: params.rootPath ?? undefined,
    goalId: params.goalId,
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
  const noOpPhase = !hasDeclaredWork;
  const nodes = noOpPhase ? [] : [{
    id: `${nodeId}:boundary`,
    title: "Record workflow phase boundary",
    kind: "inspect" as const,
    dependencies: [],
    status: "queued" as const,
    attempts: 0,
    validationAttempts: 0,
    allowedFiles: [],
    validationProfile: "api-ai-tests" as const,
    evidenceRefs: [],
  }];
  let operation: AutonomousOperationContract | undefined = noOpPhase
    ? undefined
    : existingCheckpoint?.operation
    ? {
        ...existingCheckpoint.operation,
        nodes: existingCheckpoint.operation.nodes.length > 0
          ? existingCheckpoint.operation.nodes
          : nodes,
      }
    : createAutonomousOperationContract({
        operationId: durable.execution.operationId ?? durable.execution.id,
        objective,
        revisionManifest: params.revision,
        policyRevision: "server-policy-v1",
        nodes,
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

  let completionFinalizationInFlight = false;
  try {
    if (operation) operation = transitionAutonomousOperation(operation, "inspecting");
    const checkpointed = await checkpointAiExecution({
      executionId: claimed.id,
      expectedAttempt: claimed.attempt,
      workerId,
      checkpoint: {
        stage: "model_call",
        sequence: Math.max(1, durable.execution.checkpointVersion + 1),
        ...(operation ? { operation, nodeStates: nodes, currentNode: nodeId } : {}),
        detail: noOpPhase
          ? `Workflow phase "${params.phaseName}" has no declared steps; recording a no-op boundary.`
          : `Workflow phase "${params.phaseName}" claimed at revision ${params.revision}; `
            + `${params.completedPhaseNames.length} prerequisite phase(s) already complete.`,
        updatedAt: new Date().toISOString(),
      },
    });
    if (!checkpointed) throw new Error("Workflow phase lease was lost before checkpoint");
    // An empty phase is a valid no-op boundary. For non-empty phase definitions,
    // this routine does not execute the declared work; it only records the
    // boundary and verifies that the configured project root remains available.
    if (!noOpPhase && params.rootPath) {
      const rootStat = await stat(params.rootPath);
      if (!rootStat.isDirectory()) throw new Error("Workflow project root is not a directory");
      await access(params.rootPath);
    }
    const completedNodes = operation ? nodes.map((node) => ({
      ...node,
      status: "passed" as const,
      attempts: 1,
      validationAttempts: 1,
    })) : [];
    if (operation) {
      operation = {
        ...operation,
        nodes: completedNodes,
        updatedAt: new Date().toISOString(),
      };
      operation = transitionAutonomousOperation(operation, "validating");
      operation = transitionAutonomousOperation(operation, "succeeded");
    }
    completionFinalizationInFlight = true;
    const completed = await completeAiExecution({
      executionId: claimed.id,
      workerId,
      ...(operation ? { operation, nodeStates: completedNodes } : {}),
      ...(operation && params.goalId
        ? {
            goalProjection: {
            goalId: params.goalId,
            workflowId: params.workflowId,
            workflowExecutionId: params.workflowExecutionId,
            phase: params.phaseName,
            finalPhase: params.isFinalPhase === true,
            },
          }
        : {}),
    });
    completionFinalizationInFlight = false;
    if (!completed) throw new Error("Workflow phase lease was lost before completion");
    return {
      executionId: claimed.id,
      operationId: operation?.operationId ?? durable.execution.operationId ?? durable.execution.id,
      created: true,
      status: "completed",
    };
  } catch (error) {
    if (completionFinalizationInFlight) {
      try {
        const accepted = await hasSuccessfulAiExecutionAcceptance({
          executionId: claimed.id,
          attempt: claimed.attempt,
          operationId: durable.execution.operationId ?? durable.execution.id,
        });
        if (accepted) {
          return {
            executionId: claimed.id,
            operationId: durable.execution.operationId ?? durable.execution.id,
            created: true,
            status: "completed",
          };
        }
      } catch {
        // If durable acceptance cannot be reloaded, continue with the fenced
        // failure path rather than inferring success from the local operation.
      }
    }
    const shouldPersistFailure = completionFinalizationInFlight
      || !operation
      || !["succeeded", "failed", "cancelled", "blocked", "uncertain"].includes(operation.state);
    if (shouldPersistFailure) {
      // If the terminal acceptance transaction throws, retry failure finalization
      // under the same worker fence. It cannot overwrite a success that committed
      // before an uncertain response; otherwise it records the failed attempt.
      const failureOperation = !operation
        ? undefined
        : operation.state === "succeeded"
          ? {
            ...operation,
            state: "failed" as const,
            updatedAt: new Date().toISOString(),
          }
          : transitionAutonomousOperation(operation, "failed");
      await failAiExecution({
        executionId: claimed.id,
        workerId,
        error: error instanceof Error ? error.message : "Workflow phase execution failed",
        operation: failureOperation,
        nodeStates: nodes,
        ...(operation && params.goalId
          ? {
              goalProjection: {
                goalId: params.goalId,
                workflowId: params.workflowId,
                workflowExecutionId: params.workflowExecutionId,
                phase: params.phaseName,
                finalPhase: params.isFinalPhase === true,
              },
            }
          : {}),
      });
    }
    return {
      executionId: claimed.id,
      operationId: operation?.operationId ?? durable.execution.operationId ?? durable.execution.id,
      created: true,
      status: "failed",
    };
  }
}
