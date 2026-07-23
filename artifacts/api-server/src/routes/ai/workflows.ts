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
import { requireProvider, handleOrchestratorError } from "../../lib/ai-route-helpers.js";

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

  const providerResolved = await requireProvider(req.userId, res);
  if (!providerResolved) return;
  const { provider, apiKey } = providerResolved;

  const projectContext = await buildProjectContext(workflow.projectId);

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
    if (handleOrchestratorError(err, res, { projectId: workflow.projectId, operation: "workflow-orchestration", provider })) return;
    throw err;
  } finally {
    await orchLock.release();
  }

  if (decision._parseError) {
    return res.status(422).json({
      error: "model_output_invalid",
      code: "model_output_invalid",
      hint: "The AI model returned an unexpected response — try again in a moment.",
      raw: decision._parseError.raw.slice(0, 500),
      parseCode: decision._parseError.code,
    });
  }

  logger.info({ workflowId, decision }, "AI workflow orchestration decision");

  invalidateContextCache(workflow.projectId);

  await Promise.all([
    recordAudit({
      entityType: "workflow",
      entityId: workflowId,
      action: "ai_orchestrated",
      projectId: workflow.projectId,
      stateBefore: { currentPhase, completedPhases },
      stateAfter: { action: decision.action },
    }),
    db.insert(eventsTable).values({
      id: randomUUID(),
      type: "AiWorkflowOrchestration",
      projectId: workflow.projectId,
      severity: "info",
      message: `AI orchestrator decision for "${workflow.name}": ${decision.action} — ${decision.reasoning.slice(0, 100)}`,
    }),
  ]);

  return res.json(decision);
});

export default router;
