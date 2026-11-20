/**
 * AI workflow orchestration routes.
 *
 * POST /api/ai/workflows/:workflowId/orchestrate
 */
import { Router } from "express";
import { z } from "zod";
import { randomUUID } from "node:crypto";
import { db } from "@workspace/db";
import {
  workflowsTable,
  workflowExecutionsTable,
  eventsTable,
  aiExecutionAcceptancesTable,
  aiExecutionsTable,
} from "@workspace/db";
import { eq, and, desc } from "drizzle-orm";
import {
  buildProjectContext,
  invalidateContextCache,
  orchestrateWorkflow,
  parseWorkflowPhases,
} from "@workspace/ai-orchestrator";
import { recordAudit } from "../../lib/audit.js";
import { logger } from "../../lib/logger.js";
import { loadProjectByIdForUser } from "../../middlewares/requireProjectAccess.js";
import { tryAdvisoryLock, LockNamespace } from "../../lib/advisory-lock.js";
import { checkProjectRateLimitDb, LLM_RATE_LIMIT } from "../../lib/db-rate-limiter.js";
import {
  requireProvider,
  handleOrchestratorError,
  redactUserFacingValue,
} from "../../lib/ai-route-helpers.js";
import {
  checkpointAiExecution,
  claimAiExecution,
  completeAiExecution,
  createAiExecution,
  createAutonomousOperationContract,
  failAiExecution,
  parseAiExecutionCheckpoint,
  transitionAutonomousOperation,
} from "../../lib/ai-execution-state.js";
import {
  buildWorkflowOrchestrationDisposition,
  buildWorkflowOrchestrationRequestKey,
  fingerprintWorkflowOrchestrationContext,
  parseWorkflowOrchestrationDisposition,
} from "../../lib/workflow-orchestration-result.js";

const router = Router();

// ── POST /api/ai/workflows/:workflowId/orchestrate ───────────────────────────

router.post("/ai/workflows/:workflowId/orchestrate", async (req, res) => {
  const { workflowId } = req.params;
  const OrchestrateBodySchema = z.object({
    additionalContext: z.string().max(2_000, "additionalContext must be ≤ 2 000 characters").optional(),
  });
  const orchestrateBody = OrchestrateBodySchema.safeParse(req.body);
  if (!orchestrateBody.success) {
    return res.status(400).json({ error: orchestrateBody.error.issues[0]?.message ?? "Invalid request body" });
  }
  const { additionalContext } = orchestrateBody.data;

  const [workflow] = await db
    .select()
    .from(workflowsTable)
    .where(eq(workflowsTable.id, workflowId))
    .limit(1);
  if (!workflow) return res.status(404).json({ error: "Workflow not found" });

  const ownerProject = await loadProjectByIdForUser(workflow.projectId, req.userId, res);
  if (!ownerProject) return;

  const [execution] = await db
    .select()
    .from(workflowExecutionsTable)
    .where(eq(workflowExecutionsTable.workflowId, workflowId))
    .orderBy(desc(workflowExecutionsTable.startedAt))
    .limit(1);

  const phasesResult = parseWorkflowPhases(workflow.phases ?? []);
  if (!phasesResult.ok) {
    return res.status(422).json({ error: `Invalid workflow phases: ${phasesResult.error}` });
  }
  const phases = phasesResult.phases;
  const currentPhase = execution?.currentPhase ?? workflow.currentPhase;
  const completedPhases = (execution?.completedPhases as string[]) ?? [];

  const orchLock = await tryAdvisoryLock(LockNamespace.ORCHESTRATION, workflowId);
  if (!orchLock.acquired) {
    return res.status(409).json({
      error: "An orchestration decision is already in progress for this workflow. Retry in a moment.",
    });
  }

  try {
  // Workflow executions predate the shared autonomous ledger. Use the
  // workflow execution as the idempotency boundary so retries/restarts resume
  // one server-owned operation instead of creating a parallel workflow log.
  const projectContext = await buildProjectContext(workflow.projectId, {
    sections: ["tasks", "metrics", "events", "workflows"],
  });
  const contextFingerprint = fingerprintWorkflowOrchestrationContext({
    project: projectContext.project,
    recentTasks: projectContext.recentTasks,
    latestMetrics: projectContext.latestMetrics,
    graphSummary: projectContext.graphSummary,
    recentEvents: projectContext.recentEvents,
    workflows: projectContext.workflows,
    worldState: projectContext.worldState,
    metricsVerified: projectContext.metricsVerified,
    workspaceRevision: projectContext.workspaceRevision ?? "unavailable",
    scanCorrelationId: projectContext.contextManifest?.scanCorrelationId,
  });

  const baseWorkflowExecutionKey = execution?.id ?? `workflow:${workflowId}:${workflow.updatedAt.toISOString()}`;
  const workflowExecutionKey = buildWorkflowOrchestrationRequestKey({
    workflowId,
    baseExecutionKey: baseWorkflowExecutionKey,
    workflowRevision: workflow.updatedAt.toISOString(),
    phases,
    currentPhase,
    completedPhases,
    contextFingerprint,
    additionalContext,
  });

  // A previously accepted result can be replayed without depending on provider
  // availability or consuming another model call.
  const [existingOperation] = await db
    .select({
      id: aiExecutionsTable.id,
      status: aiExecutionsTable.status,
      attempt: aiExecutionsTable.attempt,
    })
    .from(aiExecutionsTable)
    .where(and(
      eq(aiExecutionsTable.userId, req.userId),
      eq(aiExecutionsTable.projectId, workflow.projectId),
      eq(aiExecutionsTable.idempotencyKey, workflowExecutionKey),
    ))
    .limit(1);
  if (existingOperation && existingOperation.status !== "queued") {
    if (existingOperation.status === "completed") {
      const [acceptance] = await db
        .select({ disposition: aiExecutionAcceptancesTable.disposition })
        .from(aiExecutionAcceptancesTable)
        .where(and(
          eq(aiExecutionAcceptancesTable.executionId, existingOperation.id),
          eq(aiExecutionAcceptancesTable.projectId, workflow.projectId),
          eq(aiExecutionAcceptancesTable.attempt, existingOperation.attempt),
          eq(aiExecutionAcceptancesTable.terminalStatus, "completed"),
          eq(aiExecutionAcceptancesTable.outcome, "SUCCEEDED"),
          eq(aiExecutionAcceptancesTable.reasonCode, "ACCEPTED"),
        ))
        .limit(1);
      const replayedDecision = parseWorkflowOrchestrationDisposition(
        acceptance?.disposition && typeof acceptance.disposition === "object"
          ? (acceptance.disposition as Record<string, unknown>).workflowOrchestration
          : undefined,
        { workflowId, requestKey: workflowExecutionKey },
      );
      if (replayedDecision) return res.json(replayedDecision);
      return res.status(409).json({
        error: "The completed workflow orchestration has no matching replayable decision receipt.",
        code: "WORKFLOW_ORCHESTRATION_RESULT_UNAVAILABLE",
      });
    }

    return res.status(409).json({
      error: "A workflow orchestration already exists for this request and is not complete.",
      code: "WORKFLOW_ORCHESTRATION_ALREADY_CLAIMED",
      status: existingOperation.status,
    });
  }

  const providerResolved = await requireProvider(req.userId, res, {
    qualityProfile: "workflow",
  });
  if (!providerResolved) {
    return;
  }
  const { provider, apiKey } = providerResolved;

  const rlOrch = await checkProjectRateLimitDb(workflow.projectId);
  if (!rlOrch.allowed) {
    return res.status(429).json({
      error: `LLM rate limit exceeded — max ${LLM_RATE_LIMIT} calls per minute per project. Retry in ${rlOrch.retryAfterSec}s.`,
    });
  }


  const operationRequest = {
    projectId: workflow.projectId,
    message: `AI orchestration for workflow "${workflow.name}"`,
    modelMessage: "Choose the next workflow phase from the server-provided phase list.",
    workspaceRevision: workflow.updatedAt.toISOString(),
    objective: `Orchestrate workflow "${workflow.name}" from phase "${currentPhase ?? "none"}"`,
    validationTargetPaths: [],
    // Workflow orchestration records a server-owned routing decision. It is
    // not a task-objective proof of a deployment, integration, or phase
    // outcome; those outcomes are accepted by their own durable executors.
    proofRequired: false,
  };
  let operationExecution: Awaited<ReturnType<typeof createAiExecution>>["execution"];
  let workerId: string | undefined;
  let operation = undefined as ReturnType<typeof createAutonomousOperationContract> | undefined;
  try {
    const durable = await createAiExecution({
      userId: req.userId,
      projectId: workflow.projectId,
      request: operationRequest,
      idempotencyKey: workflowExecutionKey,
      correlationId: undefined,
    });
    operationExecution = durable.execution;
    if (!durable.created && operationExecution.status !== "queued") {
      if (operationExecution.status === "completed") {
        const [acceptance] = await db
          .select({ disposition: aiExecutionAcceptancesTable.disposition })
          .from(aiExecutionAcceptancesTable)
          .where(and(
            eq(aiExecutionAcceptancesTable.executionId, operationExecution.id),
            eq(aiExecutionAcceptancesTable.projectId, workflow.projectId),
            eq(aiExecutionAcceptancesTable.attempt, operationExecution.attempt),
            eq(aiExecutionAcceptancesTable.terminalStatus, "completed"),
            eq(aiExecutionAcceptancesTable.outcome, "SUCCEEDED"),
            eq(aiExecutionAcceptancesTable.reasonCode, "ACCEPTED"),
          ))
          .limit(1);
        const replayedDecision = parseWorkflowOrchestrationDisposition(
          acceptance?.disposition && typeof acceptance.disposition === "object"
            ? (acceptance.disposition as Record<string, unknown>).workflowOrchestration
            : undefined,
          { workflowId, requestKey: workflowExecutionKey },
        );
        if (replayedDecision) return res.json(replayedDecision);
        return res.status(409).json({
          error: "The completed workflow orchestration has no matching replayable decision receipt.",
          code: "WORKFLOW_ORCHESTRATION_RESULT_UNAVAILABLE",
        });
      }

      return res.status(409).json({
        error: "A workflow orchestration already exists for this request and is not complete.",
        code: "WORKFLOW_ORCHESTRATION_ALREADY_CLAIMED",
        status: operationExecution.status,
      });
    }
    const checkpoint = parseAiExecutionCheckpoint(operationExecution.checkpoint);
    operation = checkpoint?.operation;
    if (!operation) {
      operation = createAutonomousOperationContract({
        operationId: operationExecution.operationId ?? operationExecution.id,
        objective: operationRequest.objective,
        revisionManifest: operationRequest.workspaceRevision,
        policyRevision: "server-policy-v1",
      });
    }
    // A pre-existing queued row has not been claimed, so it is safe to recover.
    // Running/paused/failed rows are fenced by their existing worker/recovery contract.
    {
      workerId = `workflow-orchestrator:${randomUUID()}`;
      const claimed = await claimAiExecution({
        executionId: operationExecution.id,
        userId: req.userId,
        workerId,
      });
      if (!claimed) throw new Error("Workflow operation could not be claimed");
      operationExecution = claimed;
      operation = transitionAutonomousOperation(operation, "inspecting");
      await checkpointAiExecution({
        executionId: operationExecution.id,
        expectedAttempt: operationExecution.attempt,
        workerId,
        checkpoint: {
          stage: "model_call",
          sequence: 1,
          operation,
          detail: "Workflow orchestration decision in progress",
          updatedAt: new Date().toISOString(),
        },
      });
    }
  } catch (err) {
    logger.error({ err, workflowId }, "workflow operation ledger initialization failed");
    return res.status(500).json({ error: "Workflow operation could not be recorded." });
  }

  let decision: Awaited<ReturnType<typeof orchestrateWorkflow>>;
    try {
      decision = await orchestrateWorkflow({
        workflowName: workflow.name,
        phases,
        currentPhase,
        completedPhases,
        projectContext,
        additionalContext,
        apiKey,
        provider,
      });
    } catch (err) {
      if (workerId && operation) {
        await failAiExecution({
          executionId: operationExecution.id,
          workerId,
          error: "Workflow orchestration provider failed",
          operation: transitionAutonomousOperation(operation, "failed"),
        });
      }
      if (handleOrchestratorError(err, res, { projectId: workflow.projectId, operation: "workflow-orchestration", provider })) return;
      throw err;
    }

    if (decision._parseError) {
      if (workerId && operation) {
        await failAiExecution({
          executionId: operationExecution.id,
          workerId,
          error: "Workflow orchestration returned invalid model output",
          operation: transitionAutonomousOperation(operation, "failed"),
        });
      }
      return res.status(422).json({
        error: "model_output_invalid",
        code: "model_output_invalid",
        hint: "The AI model returned an unexpected response — try again in a moment.",
        parseCode: decision._parseError.code,
      });
    }

    logger.info({ workflowId, decision }, "AI workflow orchestration decision");

    invalidateContextCache(workflow.projectId);
    const safeDecision = redactUserFacingValue(decision);
    const decisionReceipt = buildWorkflowOrchestrationDisposition({
      workflowId,
      requestKey: workflowExecutionKey,
      decision: safeDecision,
    });
    const evidenceRef = `workflow:${workflowId}:execution:${execution?.id ?? "unstarted"}:decision`;
    if (workerId && operation) {
      const completedOperation = transitionAutonomousOperation(
        transitionAutonomousOperation(operation, "validating"),
        "succeeded",
        [evidenceRef],
      );
      const accepted = await completeAiExecution({
        executionId: operationExecution.id,
        workerId,
        evidenceReason: "The workflow routing decision was retained in the durable operation ledger.",
        proofRequired: false,
        disposition: { workflowOrchestration: decisionReceipt },
        operation: completedOperation,
      });
      if (!accepted) {
        return res.status(409).json({
          error: "The workflow decision was generated but its durable execution record could not be finalized.",
          code: "WORKFLOW_ORCHESTRATION_FINALIZATION_FAILED",
        });
      }
      operation = completedOperation;
    }

    const correlationId = operation?.operationId ?? operationExecution.operationId ?? operationExecution.id;
    await Promise.all([
      recordAudit({
        entityType: "workflow",
        entityId: workflowId,
        action: "ai_orchestrated",
        projectId: workflow.projectId,
        stateBefore: { currentPhase, completedPhases },
        stateAfter: { action: decisionReceipt.decision.action },
        correlationId,
      }),
      db.insert(eventsTable).values({
        id: randomUUID(),
        type: "AiWorkflowOrchestration",
        projectId: workflow.projectId,
        workflowId,
        severity: "info",
        message: `AI orchestrator decision for "${workflow.name}": ${decisionReceipt.decision.action} — ${decisionReceipt.decision.reasoning.slice(0, 100)}`,
        correlationId,
        payload: {
          action: decisionReceipt.decision.action,
          decision: decisionReceipt.decision,
          phase: currentPhase ?? null,
          evidenceRefs: [evidenceRef],
        },
      }),
    ]);

    return res.json(decisionReceipt.decision);
  } finally {
    // Release on every exit, including provider/context/rate-limit failures.
    await orchLock.release();
  }
});

export default router;
