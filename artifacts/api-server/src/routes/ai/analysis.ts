/**
 * AI analysis and code review routes.
 *
 * POST /api/ai/projects/:projectId/analyze
 * POST /api/ai/projects/:projectId/review
 */
import { Router } from "express";
import { randomUUID } from "crypto";
import path from "node:path";
import { db } from "@workspace/db";
import { eventsTable } from "@workspace/db";
import {
  buildProjectContext,
  invalidateContextCache,
  analyzeScan,
  reviewCode,
} from "@workspace/ai-orchestrator";
import { recordAudit } from "../../lib/audit.js";
import { logger } from "../../lib/logger.js";
import { requireProjectAccess } from "../../middlewares/requireProjectAccess.js";
import { checkProjectRateLimitDb, LLM_RATE_LIMIT } from "../../lib/db-rate-limiter.js";
import { requireProvider, handleOrchestratorError } from "../../lib/ai-route-helpers.js";

const router = Router();

// ── POST /api/ai/projects/:projectId/analyze ─────────────────────────────────

router.post("/ai/projects/:projectId/analyze", requireProjectAccess, async (req, res) => {
  const projectId = req.params.projectId as string;

  logger.info({ projectId }, "AI scan analysis requested");

  const providerResolved = await requireProvider(req.userId, res);
  if (!providerResolved) return;
  const { provider, apiKey } = providerResolved;

  const projectContext = await buildProjectContext(projectId);

  const rlAnalyze = await checkProjectRateLimitDb(projectId);
  if (!rlAnalyze.allowed) {
    return res.status(429).json({
      error: `LLM rate limit exceeded — max ${LLM_RATE_LIMIT} calls per minute per project. Retry in ${rlAnalyze.retryAfterSec}s.`,
    });
  }

  let result: Awaited<ReturnType<typeof analyzeScan>>;
  try {
    result = await analyzeScan(projectContext, { apiKey, provider });
  } catch (err) {
    if (handleOrchestratorError(err, res, { projectId, operation: "scan-analysis", provider })) return;
    throw err;
  }

  if (result._parseError) {
    return res.status(422).json({
      error: "model_output_invalid",
      code: "model_output_invalid",
      hint: "The AI model returned an unexpected response — try again in a moment.",
      raw: result._parseError.raw.slice(0, 500),
      parseCode: result._parseError.code,
    });
  }

  invalidateContextCache(projectId);

  await Promise.all([
    recordAudit({
      entityType: "project",
      entityId: projectId,
      action: "ai_analyzed",
      projectId,
      stateBefore: {},
      stateAfter: { summary: result.summary, overallAssessment: result.overallAssessment },
    }),
    db.insert(eventsTable).values({
      id: randomUUID(),
      type: "AiScanAnalysisCompleted",
      projectId,
      severity: "info",
      message: `AI scan analysis completed: ${result.summary}`,
    }),
  ]);

  return res.json(result);
});

// ── POST /api/ai/projects/:projectId/review ──────────────────────────────────

router.post("/ai/projects/:projectId/review", requireProjectAccess, async (req, res) => {
  const projectId = req.params.projectId as string;
  const { fileContents } = req.body as { fileContents?: Record<string, string> };

  logger.info({ projectId }, "AI code review requested");

  const MAX_FILE_CONTENTS_BYTES = 50_000;
  if (fileContents) {
    const invalidKey = Object.keys(fileContents).find(
      (k) => path.isAbsolute(k) || k.includes(".."),
    );
    if (invalidKey) {
      return res.status(400).json({
        error: `fileContents key "${invalidKey}" must be a relative path without traversal (no ".." segments)`,
      });
    }
    const totalSize = Object.values(fileContents).reduce((sum, v) => sum + v.length, 0);
    if (totalSize > MAX_FILE_CONTENTS_BYTES) {
      return res.status(413).json({
        error: `fileContents total size (${Math.round(totalSize / 1_000)} KB) exceeds the ${MAX_FILE_CONTENTS_BYTES / 1_000} KB limit — send fewer or smaller files`,
      });
    }
  }

  const rlReview = await checkProjectRateLimitDb(projectId);
  if (!rlReview.allowed) {
    return res.status(429).json({
      error: `LLM rate limit exceeded — max ${LLM_RATE_LIMIT} calls per minute per project. Retry in ${rlReview.retryAfterSec}s.`,
    });
  }

  const providerResolved = await requireProvider(req.userId, res);
  if (!providerResolved) return;
  const { provider, apiKey } = providerResolved;

  const projectContext = await buildProjectContext(projectId);
  let result: Awaited<ReturnType<typeof reviewCode>>;
  try {
    result = await reviewCode(projectContext, fileContents, { apiKey, provider });
  } catch (err) {
    if (handleOrchestratorError(err, res, { projectId, operation: "code-review", provider })) return;
    throw err;
  }

  if (result._parseError) {
    return res.status(422).json({
      error: "model_output_invalid",
      code: "model_output_invalid",
      hint: "The AI model returned an unexpected response — try again in a moment.",
      raw: result._parseError.raw.slice(0, 500),
      parseCode: result._parseError.code,
    });
  }

  invalidateContextCache(projectId);

  await Promise.all([
    recordAudit({
      entityType: "project",
      entityId: projectId,
      action: "ai_reviewed",
      projectId,
      stateBefore: {},
      stateAfter: { verdict: result.verdict, overallScore: result.overallScore },
    }),
    db.insert(eventsTable).values({
      id: randomUUID(),
      type: "AiCodeReviewCompleted",
      projectId,
      severity: result.verdict === "approved" ? "success" : "warning",
      message: `AI code review: ${result.verdict} (score: ${result.overallScore}/100)`,
    }),
  ]);

  return res.json(result);
});

export default router;
