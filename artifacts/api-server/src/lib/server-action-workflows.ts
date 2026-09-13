import { randomUUID } from "node:crypto";
import { and, eq } from "drizzle-orm";
import {
  db,
  eventsTable,
  workflowExecutionsTable,
  workflowsTable,
} from "@workspace/db";
import { recordAudit } from "./audit.js";
import { invalidateContextCache } from "@workspace/ai-orchestrator";
import { executeWorkflowPhase } from "./workflow-phase-execution.js";

const RESTART_SERVICES_WORKFLOW_NAME = "Restart services (internal workflow)";
const RESTART_SERVICES_PHASE_NAME = "record_restart_request";
const RESTART_SERVICES_PHASE_STEPS = [
  "Record the requested service restart in the EngineeringOS workflow ledger.",
];

export type InternalRestartWorkflowResult = {
  workflowId: string;
  executionId: string;
  operationId: string;
  workflowStatus: "completed" | "failed";
  phaseStatus: "completed" | "already_completed" | "failed";
  serviceControl: "NOT_PERFORMED";
  message: string;
};

export async function startInternalRestartServicesWorkflow(params: {
  userId: string;
  projectId: string;
  rootPath?: string | null;
  revision: string;
}): Promise<InternalRestartWorkflowResult> {
  const workflowId = randomUUID();
  const executionId = randomUUID();
  const correlationId = randomUUID();
  const now = new Date();

  await db.transaction(async (tx) => {
    await tx.insert(workflowsTable).values({
      id: workflowId,
      projectId: params.projectId,
      name: RESTART_SERVICES_WORKFLOW_NAME,
      description:
        "Records a restart request in EngineeringOS. It does not control Replit workflows or service processes.",
      status: "running",
      phases: [{
        name: RESTART_SERVICES_PHASE_NAME,
        steps: RESTART_SERVICES_PHASE_STEPS,
      }],
      currentPhase: RESTART_SERVICES_PHASE_NAME,
      executionCount: 1,
      lastExecutedAt: now,
      createdAt: now,
      updatedAt: now,
    });

    await tx.insert(workflowExecutionsTable).values({
      id: executionId,
      workflowId,
      status: "running",
      currentPhase: RESTART_SERVICES_PHASE_NAME,
      startedAt: now,
    });

    await tx.insert(eventsTable).values([
      {
        id: randomUUID(),
        type: "WorkflowCreated",
        projectId: params.projectId,
        workflowId,
        severity: "info",
        message: `Workflow "${RESTART_SERVICES_WORKFLOW_NAME}" created`,
        correlationId,
      },
      {
        id: randomUUID(),
        type: "WorkflowStarted",
        projectId: params.projectId,
        workflowId,
        severity: "info",
        message: `Workflow "${RESTART_SERVICES_WORKFLOW_NAME}" started — phase: ${RESTART_SERVICES_PHASE_NAME}`,
        correlationId,
        payload: { phase: RESTART_SERVICES_PHASE_NAME, serviceControl: "NOT_PERFORMED" },
      },
    ]);
  });

  await recordAudit({
    entityType: "workflow",
    entityId: workflowId,
    action: "created",
    projectId: params.projectId,
    stateAfter: {
      status: "running",
      action: "RESTART_SERVICES",
      serviceControl: "NOT_PERFORMED",
    },
    correlationId,
    actor: params.userId,
  });

  let phaseResult: Awaited<ReturnType<typeof executeWorkflowPhase>>;
  let phaseError: string | undefined;
  try {
    phaseResult = await executeWorkflowPhase({
      userId: params.userId,
      projectId: params.projectId,
      workflowId,
      workflowExecutionId: executionId,
      workflowName: RESTART_SERVICES_WORKFLOW_NAME,
      phaseName: RESTART_SERVICES_PHASE_NAME,
      phaseSteps: RESTART_SERVICES_PHASE_STEPS,
      revision: params.revision,
      completedPhaseNames: [],
      rootPath: params.rootPath ?? undefined,
    });
  } catch (error) {
    phaseError = error instanceof Error ? error.message : "Internal workflow phase failed";
    phaseResult = {
      executionId,
      operationId: executionId,
      created: true,
      status: "failed",
    };
  }

  const succeeded =
    phaseResult.status === "completed" || phaseResult.status === "already_completed";
  const workflowStatus = succeeded ? "completed" : "failed";
  const phaseStatus: InternalRestartWorkflowResult["phaseStatus"] =
    phaseResult.status === "in_progress" ? "failed" : phaseResult.status;
  const completedAt = new Date();
  const errorMessage = phaseError ?? (succeeded ? undefined : "Internal workflow phase failed");

  await db.transaction(async (tx) => {
    const [updatedExecution] = await tx
      .update(workflowExecutionsTable)
      .set({
        status: workflowStatus,
        completedPhases: succeeded ? [RESTART_SERVICES_PHASE_NAME] : [],
        completedAt,
        errorMessage,
      })
      .where(and(
        eq(workflowExecutionsTable.id, executionId),
        eq(workflowExecutionsTable.status, "running"),
      ))
      .returning({ id: workflowExecutionsTable.id });
    if (!updatedExecution) {
      throw new Error("Internal restart workflow execution was changed before finalization");
    }

    await tx
      .update(workflowsTable)
      .set({
        status: workflowStatus,
        updatedAt: completedAt,
      })
      .where(and(
        eq(workflowsTable.id, workflowId),
        eq(workflowsTable.status, "running"),
      ));

    await tx.insert(eventsTable).values({
      id: randomUUID(),
      type: succeeded ? "WorkflowCompleted" : "WorkflowFailed",
      projectId: params.projectId,
      workflowId,
      severity: succeeded ? "info" : "error",
      message: succeeded
        ? `Workflow "${RESTART_SERVICES_WORKFLOW_NAME}" completed; Replit services were not restarted`
        : `Workflow "${RESTART_SERVICES_WORKFLOW_NAME}" failed`,
      correlationId,
      payload: {
        phase: RESTART_SERVICES_PHASE_NAME,
        serviceControl: "NOT_PERFORMED",
        ...(errorMessage ? { error: errorMessage } : {}),
      },
    });
  });

  await recordAudit({
    entityType: "workflow",
    entityId: workflowId,
    action: succeeded ? "completed" : "phase_failed",
    projectId: params.projectId,
    stateBefore: { status: "running" },
    stateAfter: {
      status: workflowStatus,
      action: "RESTART_SERVICES",
      serviceControl: "NOT_PERFORMED",
      ...(errorMessage ? { error: errorMessage } : {}),
    },
    correlationId,
    actor: params.userId,
  });
  invalidateContextCache(params.projectId);

  return {
    workflowId,
    executionId,
    operationId: phaseResult.operationId,
    workflowStatus,
    phaseStatus,
    serviceControl: "NOT_PERFORMED",
    message: succeeded
      ? "The restart request was recorded and completed as an internal EngineeringOS workflow. Replit services were not restarted."
      : "The internal EngineeringOS workflow recorded the restart request but failed. Replit services were not restarted.",
  };
}