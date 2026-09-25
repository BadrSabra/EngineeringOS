import { Router } from "express";
import { randomUUID } from "node:crypto";
import { RecipeRequestSchema, toPublicRecipeReceipt } from "@workspace/ai-orchestrator";
import { and, eq } from "drizzle-orm";
import { aiChangeProposalsTable, db } from "@workspace/db";
import {
  requireProjectAccess,
  requireProjectWriteAccess,
} from "../../middlewares/requireProjectAccess.js";
import { resolveRootPath } from "../../lib/rootpath-validator.js";
import {
  createRuntimeStartRunner,
  runRecipeOperation,
} from "../../lib/recipe-operation-runner.js";
import { runRegisteredStrategyReplayCase } from "../../lib/agent-state/strategy-replay-case-runner.js";
import { executeVerifiedGitHubDelivery } from "../../lib/github-delivery-service.js";

const router = Router();

function requireRecipeAccess(req: Parameters<typeof requireProjectAccess>[0], res: Parameters<typeof requireProjectAccess>[1], next: Parameters<typeof requireProjectAccess>[2]) {
  const access = req.body?.recipeId === "runtime.start"
    ? requireProjectWriteAccess
    : requireProjectAccess;
  return access(req, res, next);
}

router.post("/ai/projects/:projectId/recipe", requireRecipeAccess, async (req, res) => {
  const rawBody = req.body && typeof req.body === "object" && !Array.isArray(req.body)
    ? req.body as Record<string, unknown>
    : {};
  const { deliveryProposalId: _deliveryProposalId, ...recipeBody } = rawBody;
  const parsed = RecipeRequestSchema.safeParse(recipeBody);
  if (!parsed.success) {
    return res.status(400).json({
      error: "Invalid recipe request.",
      code: "INVALID_RECIPE_REQUEST",
      issues: parsed.error.issues.map((issue) => ({ path: issue.path, message: issue.message })),
    });
  }
  const project = req.project;
  if (!project) return res.status(500).json({ error: "Project context unavailable" });
  const body = (req.body ?? {}) as { deliveryProposalId?: unknown };
  const isDeliveryRecipe = parsed.data.recipeId === "delivery.push.github";
  const deliveryProposalId = typeof body.deliveryProposalId === "string"
    ? body.deliveryProposalId
    : undefined;
  let deliveryOperationId: string | undefined;
  if (isDeliveryRecipe) {
    if (project.status === "archived") {
      return res.status(403).json({
        error: "This project is archived and cannot perform external delivery.",
        code: "PROJECT_ARCHIVED",
      });
    }
    if (
      !deliveryProposalId
      || !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(deliveryProposalId)
    ) {
      return res.status(400).json({
        error: "deliveryProposalId must be a valid UUID for GitHub delivery.",
        code: "DELIVERY_PROPOSAL_REQUIRED",
      });
    }
    if (!project.gitRemoteUrl) {
      return res.status(409).json({
        error: "GitHub delivery requires a configured project remote.",
        code: "DELIVERY_REMOTE_REQUIRED",
      });
    }
    const [proposal] = await db
      .select({
        lifecycle: aiChangeProposalsTable.lifecycle,
        operationId: aiChangeProposalsTable.operationId,
      })
      .from(aiChangeProposalsTable)
      .where(and(
        eq(aiChangeProposalsTable.id, deliveryProposalId),
        eq(aiChangeProposalsTable.projectId, project.id),
      ))
      .limit(1);
    if (!proposal || proposal.lifecycle !== "committed" || !proposal.operationId) {
      return res.status(409).json({
        error: "GitHub delivery requires a committed proposal.",
        code: "DELIVERY_PROPOSAL_NOT_COMMITTED",
      });
    }
    deliveryOperationId = proposal.operationId;
  }
  const idempotencyKey = req.header("Idempotency-Key");
  if (!idempotencyKey || idempotencyKey.length < 8 || idempotencyKey.length > 128) {
    return res.status(400).json({
      error: "Idempotency-Key header is required and must be 8-128 characters.",
      code: "IDEMPOTENCY_KEY_REQUIRED",
    });
  }
  const root = await resolveRootPath(project.rootPath, project.id);
  if (!root.validRootPath) {
    return res.status(409).json({
      error: "The project workspace is unavailable.",
      code: "ROOT_UNAVAILABLE",
      retryable: true,
    });
  }
  const operationId = deliveryOperationId ?? randomUUID();
  try {
    const result = await runRecipeOperation({
      ...parsed.data,
      projectId: project.id,
      operationId,
      rootPath: root.validRootPath,
      sourceRevision: project.updatedAt.toISOString(),
      userId: req.userId,
      idempotencyKey,
      runtimeStartRunner: createRuntimeStartRunner(),
      ...(isDeliveryRecipe && deliveryProposalId && project.gitRemoteUrl
        ? {
            githubDeliveryRunner: async ({
              rootPath,
              projectId,
              operationId: deliveryOperation,
              executionId,
              executionAttempt,
              sourceRevision,
              message,
              signal,
            }) =>
              executeVerifiedGitHubDelivery({
                rootPath,
                projectId,
                operationId: deliveryOperation,
                executionId,
                executionAttempt,
                sourceRevision,
                proposalId: deliveryProposalId,
                remoteUrl: project.gitRemoteUrl!,
                branch: project.gitDefaultBranch ?? "main",
                message,
                signal,
              }),
          }
        : {}),
    });
    return res.status(result.status === "completed" ? 200 : 409).json({
      receipt: toPublicRecipeReceipt(result.receipt),
      executionId: result.executionId,
      status: result.status,
      capabilityGap: null,
    });
  } catch (error) {
    return res.status(409).json({
      error: "Recipe execution could not be completed.",
      code: "RECIPE_EXECUTION_BLOCKED",
      retryable: true,
      detail: error instanceof Error ? error.message.slice(0, 240) : undefined,
      capabilityGap: null,
    });
  }
});

router.post(
  "/ai/projects/:projectId/strategy-replay-cases/:caseRegistrationId/run",
  requireProjectWriteAccess,
  async (req, res) => {
    const project = req.project;
    if (!project || !req.userId) {
      return res.status(500).json({ error: "Project context unavailable" });
    }
    try {
      const result = await runRegisteredStrategyReplayCase({
        projectId: project.id,
        caseRegistrationId: typeof req.params.caseRegistrationId === "string"
          ? req.params.caseRegistrationId
          : "",
        userId: req.userId,
      });
      return res.status(result.status === "proven" ? 200 : 409).json({
        status: result.status,
        recovered: result.recovered,
        receipt: result.receipt,
      });
    } catch {
      return res.status(409).json({
        error: "Strategy Replay could not prove this case.",
        code: "STRATEGY_REPLAY_INCOMPLETE",
      });
    }
  },
);

export default router;