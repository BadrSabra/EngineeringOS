/**
 * AI workflow orchestration routes.
 *
 * POST /api/ai/workflows/:workflowId/orchestrate
 */
import { Router } from "express";
import { z } from "zod";
import { randomUUID } from "crypto";
import { db } from "@workspace/db";
import {
  workflowsTable,
  workflowExecutionsTable,
  eventsTable,
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
    .where(
      and(
        eq(workflowExecutionsTable.workflowId, workflowId),
        eq(workflowExecutionsTable.status, "running"),
      ),
    )
    .orderBy(desc(workflowExecutionsTable.startedAt))
    .limit(1);

  const providerResolved = await requireProvider(req.userId, res, {
    qualityProfile: "workflow",
  });
  if (!providerResolved) return;
  const { provider, apiKey } = providerResolved;

  const projectContext = await buildProjectContext(workflow.projectId, {
    sections: ["tasks", "metrics", "events", "workflows"],
  });

  const phasesResult = parseWorkflowPhases(workflow.phases ?? []);
  if (!phasesResult.ok) {
    return res.status(422).json({ error: `Invalid workflow phases: ${phasesResult.error}` });
  }
  const phases = phasesResult.phases;
  const currentPhase = execution?.currentPhase ?? workflow.currentPhase;
  const completedPhases = (execution?.completedPhases as string[]) ?? [];

  const rlOrch = await checkProjectRateLimitDb(workflow.projectId);
  if (!rlOrch.allowed) {
    return res.status(429).json({
      error: `LLM rate limit exceeded — max ${LLM_RATE_LIMIT} calls per minute per project. Retry in ${rlOrch.retryAfterSec}s.`,
    });
  }

  const orchLock = await tryAdvisoryLock(LockNamespace.ORCHESTRATION, workflowId);
  if (!orchLock.acquired) {
    return res.status(409).json({
      error: "An orchestration decision is already in progress for this workflow. Retry in a moment.",
    });
  }

  // Workflow executions predate the shared autonomous ledger. Use the
  // workflow execution as the idempotency boundary so retries/restarts resume
  // one server-owned operation instead of creating a parallel workflow log.
  const workflowExecutionKey = execution?.id ?? `workflow:${workflowId}:${workflow.updatedAt.toISOString()}`;
  const operationRequest = {
    projectId: workflow.projectId,
    message: `AI orchestration for workflow "${workflow.name}"`,
    modelMessage: "Choose the next workflow phase from the server-provided phase list.",
    workspaceRevision: workflow.updatedAt.toISOString(),
    objective: `Orchestrate workflow "${workflow.name}" from phase "${currentPhase ?? "none"}"`,
    validationTargetPaths: [],
    proofRequired: true,
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
    if (durable.created) {
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
    await orchLock.release();
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
  } finally {
    await orchLock.release();
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
  const evidenceRef = `workflow:${workflowId}:execution:${execution?.id ?? "unstarted"}:decision`;
  if (workerId && operation) {
    const completedOperation = transitionAutonomousOperation(
      transitionAutonomousOperation(operation, "validating"),
      "succeeded",
      [evidenceRef],
    );
    await completeAiExecution({
      executionId: operationExecution.id,
      workerId,
      finalMessageId: randomUUID(),
      evidenceVerdict: "PROVEN",
      evidenceReason: "The workflow decision and phase context were retained in the durable operation ledger.",
      proofRequired: true,
      operation: completedOperation,
    });
    operation = completedOperation;
  }

  await Promise.all([
    recordAudit({
      entityType: "workflow",
      entityId: workflowId,
      action: "ai_orchestrated",
      projectId: workflow.projectId,
      stateBefore: { currentPhase, completedPhases },
      stateAfter: { action: decision.action },
      correlationId: operation?.operationId ?? operationExecution.operationId ?? operationExecution.id,
    }),
    db.insert(eventsTable).values({
      id: randomUUID(),
      type: "AiWorkflowOrchestration",
      projectId: workflow.projectId,
      workflowId,
      severity: "info",
      message: `AI orchestrator decision for "${workflow.name}": ${safeDecision.action} — ${safeDecision.reasoning.slice(0, 100)}`,
      correlationId: operation?.operationId ?? operationExecution.operationId ?? operationExecution.id,
      payload: {
        action: safeDecision.action,
        phase: currentPhase ?? null,
        evidenceRefs: [evidenceRef],
      },
    }),
  ]);

  return res.json(safeDecision);
});

export default router;
