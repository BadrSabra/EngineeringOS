import { Router } from "express";
import { randomUUID } from "node:crypto";
import { RecipeRequestSchema, toPublicRecipeReceipt } from "@workspace/ai-orchestrator";
import { requireProjectAccess } from "../../middlewares/requireProjectAccess.js";
import { resolveRootPath } from "../../lib/rootpath-validator.js";
import { runRecipeOperation } from "../../lib/recipe-operation-runner.js";

const router = Router();

router.post("/ai/projects/:projectId/recipe", requireProjectAccess, async (req, res) => {
  const parsed = RecipeRequestSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({
      error: "Invalid recipe request.",
      code: "INVALID_RECIPE_REQUEST",
      issues: parsed.error.issues.map((issue) => ({ path: issue.path, message: issue.message })),
    });
  }
  const project = req.project;
  if (!project) return res.status(500).json({ error: "Project context unavailable" });
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
  const operationId = randomUUID();
  try {
    const result = await runRecipeOperation({
      ...parsed.data,
      projectId: project.id,
      operationId,
      rootPath: root.validRootPath,
      sourceRevision: project.updatedAt.toISOString(),
      userId: req.userId,
      idempotencyKey,
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

export default router;