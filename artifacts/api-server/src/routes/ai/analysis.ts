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
import { auditLogsTable, eventsTable, projectsTable } from "@workspace/db";
import {
  buildProjectContext,
  invalidateContextCache,
  analyzeScan,
  reviewCode,
} from "@workspace/ai-orchestrator";
import { logger } from "../../lib/logger.js";
import { requireProjectAccess } from "../../middlewares/requireProjectAccess.js";
import { checkProjectRateLimitDb, LLM_RATE_LIMIT } from "../../lib/db-rate-limiter.js";
import { resolveRootPath } from "../../lib/rootpath-validator.js";
import {
  requireProvider,
  handleOrchestratorError,
  runAgentWithFallback,
  redactUserFacingText,
  redactUserFacingValue,
} from "../../lib/ai-route-helpers.js";

const router = Router();

type StructuredTask = "analyze" | "review";
type StructuredAuditTraceEntry = {
  stage: string;
  status: "started" | "completed" | "failed" | "incomplete";
  provider?: string;
};
type StructuredAuditMetadata = {
  operationId: string;
  projectId: string;
  projectRevision: string;
  rootAvailable: boolean;
  incomplete: boolean;
  operationalTrace: StructuredAuditTraceEntry[];
};
type StructuredTaskEvent =
  | ({ type: "task_started"; task: StructuredTask; projectId: string }
    | { type: "stage"; stage: string }
    | { type: "task_progress"; task: StructuredTask; message: string; provider?: string }
    | { type: "task_done"; task: StructuredTask; result: Record<string, unknown> }
    | { type: "error"; code: string; message: string; hint?: string })
    & Partial<StructuredAuditMetadata>;

function auditEnvelope(metadata: StructuredAuditMetadata): Record<string, unknown> {
  return {
    operationId: metadata.operationId,
    projectId: metadata.projectId,
    projectRevision: metadata.projectRevision,
    rootAvailable: metadata.rootAvailable,
    incomplete: metadata.incomplete,
    operationalTrace: metadata.operationalTrace,
  };
}

function recordTrace(
  metadata: StructuredAuditMetadata,
  stage: string,
  status: StructuredAuditTraceEntry["status"],
  provider?: string,
): void {
  metadata.operationalTrace.push({
    stage,
    status,
    ...(provider ? { provider: redactUserFacingText(provider) } : {}),
  });
}

async function createAuditMetadata(
  projectId: string,
  project: typeof projectsTable.$inferSelect,
): Promise<StructuredAuditMetadata> {
  const root = await resolveRootPath(project.rootPath, projectId);
  return {
    operationId: randomUUID(),
    projectId,
    projectRevision: project.updatedAt.toISOString(),
    rootAvailable: Boolean(root.validRootPath),
    incomplete: !root.validRootPath,
    operationalTrace: [],
  };
}

function beginTaskStream(
  res: import("express").Response,
  task: StructuredTask,
  projectId: string,
  metadata: StructuredAuditMetadata,
) {
  res.status(200).set({
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-cache, no-transform",
    Connection: "keep-alive",
    "X-Accel-Buffering": "no",
  });
  res.flushHeaders();

  let closed = false;
  const heartbeat = setInterval(() => {
    if (!closed && !res.writableEnded) res.write(": heartbeat\n\n");
  }, 15_000);

  const emit = (event: StructuredTaskEvent) => {
    if (!closed && !res.writableEnded) {
      res.write(`data: ${JSON.stringify({ ...event, ...auditEnvelope(metadata) })}\n\n`);
    }
  };

  const close = () => {
    if (closed) return;
    closed = true;
    clearInterval(heartbeat);
    if (!res.writableEnded) res.end();
  };

  res.once("close", () => {
    closed = true;
    clearInterval(heartbeat);
  });

  metadata.operationalTrace.push({ stage: "task", status: "started" });
  emit({ type: "task_started", task, projectId });
  return { emit, close };
}

function emitTaskFailure(
  emit: (event: StructuredTaskEvent) => void,
  close: () => void,
  err: unknown,
  metadata: StructuredAuditMetadata,
) {
  const candidate = err as { code?: unknown; message?: unknown };
  metadata.incomplete = true;
  metadata.operationalTrace.push({ stage: "failed", status: "failed" });
  emit({
    type: "error",
    code: typeof candidate.code === "string" ? candidate.code : "task_failed",
    message: typeof candidate.message === "string"
      ? redactUserFacingText(candidate.message)
      : "AI task failed",
  });
  close();
}

// ── POST /api/ai/projects/:projectId/analyze ─────────────────────────────────

router.post("/ai/projects/:projectId/analyze", requireProjectAccess, async (req, res) => {
  const projectId = req.params.projectId as string;
  const project = req.project;
  if (!project) return res.status(500).json({ error: "Project context unavailable" });
  const metadata = await createAuditMetadata(projectId, project);
  recordTrace(metadata, "analyze", "started");

  logger.info({ projectId }, "AI scan analysis requested");

  const providerResolved = await requireProvider(req.userId, res, {
    qualityProfile: "analysis",
  });
  if (!providerResolved) return;
  const { provider, apiKey } = providerResolved;

  const projectContext = await buildProjectContext(projectId, {
    sections: ["tasks", "metrics", "graphEntities", "graphRelationships", "events"],
  });

  const rlAnalyze = await checkProjectRateLimitDb(projectId);
  if (!rlAnalyze.allowed) {
    return res.status(429).json({
      error: `LLM rate limit exceeded — max ${LLM_RATE_LIMIT} calls per minute per project. Retry in ${rlAnalyze.retryAfterSec}s.`,
    });
  }

  let result: Awaited<ReturnType<typeof analyzeScan>>;
  let effectiveProvider = provider;
  try {
    ({ result, effectiveProvider } = await runAgentWithFallback(
      req.userId,
      { provider, apiKey },
      (opts) => analyzeScan(projectContext, opts),
      { qualityProfile: "analysis" },
    ));
  } catch (err) {
    metadata.incomplete = true;
    recordTrace(metadata, "analyze", "failed", effectiveProvider);
    if (handleOrchestratorError(err, res, { projectId, operation: "scan-analysis", provider: effectiveProvider })) return;
    throw err;
  }

  // When the model output failed to parse, we still have the fallback data
  // (generated by fallbackScanAnalysis). Serve it with a warning header so the
  // UI can still display something useful rather than showing a hard error.
  // Only a completely empty/unusable response (no summary at all) should 422.
  if (result._parseError) {
    metadata.incomplete = true;
    recordTrace(metadata, "analyze", "incomplete", effectiveProvider);
    logger.warn(
      { projectId, parseCode: result._parseError.code, message: result._parseError.message, provider: effectiveProvider },
      "scan-analyst: parse error",
    );
    return res.status(422).json({
      ...auditEnvelope(metadata),
      error: "model_output_invalid",
      code: "model_output_invalid",
      hint: "The AI model returned an unexpected response — try again in a moment.",
      parseCode: result._parseError.code,
    });
  }

  invalidateContextCache(projectId);

  await db.transaction(async (tx) => {
    await tx.insert(auditLogsTable).values({
      id: randomUUID(),
      entityType: "project",
      entityId: projectId,
      action: "ai_analyzed",
      projectId,
      actor: req.userId,
      stateBefore: {},
      stateAfter: { summary: result.summary, overallAssessment: result.overallAssessment },
    });
    await tx.insert(eventsTable).values({
      id: randomUUID(),
      type: "AiScanAnalysisCompleted",
      projectId,
      severity: "info",
      message: `AI scan analysis completed: ${result.summary}`,
    });
  });

  recordTrace(metadata, "analyze", "completed", effectiveProvider);
  return res.json({ ...redactUserFacingValue(result) as Record<string, unknown>, ...auditEnvelope(metadata) });
});

// ── POST /api/ai/projects/:projectId/review ──────────────────────────────────

router.post("/ai/projects/:projectId/review", requireProjectAccess, async (req, res) => {
  const projectId = req.params.projectId as string;
  const project = req.project;
  if (!project) return res.status(500).json({ error: "Project context unavailable" });
  const metadata = await createAuditMetadata(projectId, project);
  recordTrace(metadata, "review", "started");
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

  const providerResolved = await requireProvider(req.userId, res, {
    qualityProfile: "code_review",
  });
  if (!providerResolved) return;
  const { provider, apiKey } = providerResolved;

  const projectContext = await buildProjectContext(projectId, {
    sections: ["tasks", "metrics", "graphEntities", "graphRelationships", "events"],
  });
  let result: Awaited<ReturnType<typeof reviewCode>>;
  let effectiveProvider = provider;
  try {
    ({ result, effectiveProvider } = await runAgentWithFallback(
      req.userId,
      { provider, apiKey },
      (opts) => reviewCode(projectContext, fileContents, opts),
      { qualityProfile: "code_review" },
    ));
  } catch (err) {
    metadata.incomplete = true;
    recordTrace(metadata, "review", "failed", effectiveProvider);
    if (handleOrchestratorError(err, res, { projectId, operation: "code-review", provider: effectiveProvider })) return;
    throw err;
  }

  // When the model output failed to parse, we still have the fallback data.
  // Serve it with a warning header so the UI can display something useful.
  if (result._parseError) {
    metadata.incomplete = true;
    recordTrace(metadata, "review", "incomplete", effectiveProvider);
    logger.warn(
      { projectId, parseCode: result._parseError.code, message: result._parseError.message, provider: effectiveProvider },
      "code-reviewer: parse error",
    );
    return res.status(422).json({
      ...auditEnvelope(metadata),
      error: "model_output_invalid",
      code: "model_output_invalid",
      hint: "The AI model returned an unexpected response — try again in a moment.",
      parseCode: result._parseError.code,
    });
  }

  invalidateContextCache(projectId);

  await db.transaction(async (tx) => {
    await tx.insert(auditLogsTable).values({
      id: randomUUID(),
      entityType: "project",
      entityId: projectId,
      action: "ai_reviewed",
      projectId,
      actor: req.userId,
      stateBefore: {},
      stateAfter: { verdict: result.verdict, overallScore: result.overallScore },
    });
    await tx.insert(eventsTable).values({
      id: randomUUID(),
      type: "AiCodeReviewCompleted",
      projectId,
      severity: result.verdict === "approved" ? "success" : "warning",
      message: `AI code review: ${result.verdict} (score: ${result.overallScore}/100)`,
    });
  });

  recordTrace(metadata, "review", "completed", effectiveProvider);
  return res.json({ ...redactUserFacingValue(result) as Record<string, unknown>, ...auditEnvelope(metadata) });
});

// ── POST /api/ai/projects/:projectId/analyze/stream ──────────────────────────

router.post("/ai/projects/:projectId/analyze/stream", requireProjectAccess, async (req, res) => {
  const projectId = req.params.projectId as string;
  const project = req.project;
  if (!project) return res.status(500).json({ error: "Project context unavailable" });
  const providerResolved = await requireProvider(req.userId, res, { qualityProfile: "analysis" });
  if (!providerResolved) return;
  const metadata = await createAuditMetadata(projectId, project);
  recordTrace(metadata, "analyze", "started");

  const rlAnalyze = await checkProjectRateLimitDb(projectId);
  if (!rlAnalyze.allowed) {
    return res.status(429).json({
      error: `LLM rate limit exceeded — max ${LLM_RATE_LIMIT} calls per minute per project. Retry in ${rlAnalyze.retryAfterSec}s.`,
    });
  }

  const { emit, close } = beginTaskStream(res, "analyze", projectId, metadata);
  try {
    recordTrace(metadata, "building-context", "started");
    emit({ type: "stage", stage: "building-context" });
    const projectContext = await buildProjectContext(projectId, {
      sections: ["tasks", "metrics", "graphEntities", "graphRelationships", "events"],
    });

    emit({ type: "stage", stage: "calling-model" });
    recordTrace(metadata, "calling-model", "started", providerResolved.provider);
    const { provider, apiKey } = providerResolved;
    let effectiveProvider = provider;
    const { result } = await runAgentWithFallback(
      req.userId,
      { provider, apiKey },
      (opts) => analyzeScan(projectContext, {
        ...opts,
        onProgress: (message) => emit({
          type: "task_progress",
          task: "analyze",
          message,
          provider: opts.provider,
        }),
      }),
      { qualityProfile: "analysis" },
    ).then((output) => {
      effectiveProvider = output.effectiveProvider;
      return output;
    });

    if (result._parseError) {
      metadata.incomplete = true;
      recordTrace(metadata, "calling-model", "incomplete", effectiveProvider);
      emit({
        type: "error",
        code: "model_output_invalid",
        message: "The AI model returned an unexpected response.",
        hint: redactUserFacingText(result._parseError.message),
      });
      close();
      return;
    }

    emit({ type: "stage", stage: "persisting-result" });
    recordTrace(metadata, "persisting-result", "completed", effectiveProvider);
    invalidateContextCache(projectId);
    await db.transaction(async (tx) => {
      await tx.insert(auditLogsTable).values({
        id: randomUUID(),
        entityType: "project",
        entityId: projectId,
        action: "ai_analyzed",
        projectId,
        actor: req.userId,
        stateBefore: {},
        stateAfter: { summary: result.summary, overallAssessment: result.overallAssessment },
      });
      await tx.insert(eventsTable).values({
        id: randomUUID(),
        type: "AiScanAnalysisCompleted",
        projectId,
        severity: "info",
        message: `AI scan analysis completed: ${result.summary}`,
      });
    });

    emit({ type: "stage", stage: "completed" });
    recordTrace(metadata, "analyze", "completed", effectiveProvider);
    emit({
      type: "task_done",
      task: "analyze",
      result: {
        ...redactUserFacingValue(result) as Record<string, unknown>,
        ...auditEnvelope(metadata),
      },
    });
    close();
    logger.info({ projectId, provider: effectiveProvider }, "AI scan analysis stream completed");
  } catch (err) {
    logger.error({ err, projectId }, "AI scan analysis stream failed");
    emitTaskFailure(emit, close, err, metadata);
  }
  return;
});

// ── POST /api/ai/projects/:projectId/review/stream ───────────────────────────

router.post("/ai/projects/:projectId/review/stream", requireProjectAccess, async (req, res) => {
  const projectId = req.params.projectId as string;
  const project = req.project;
  if (!project) return res.status(500).json({ error: "Project context unavailable" });
  const { fileContents } = req.body as { fileContents?: Record<string, string> };
  const MAX_FILE_CONTENTS_BYTES = 50_000;

  if (fileContents) {
    const invalidKey = Object.keys(fileContents).find(
      (key) => path.isAbsolute(key) || key.includes(".."),
    );
    if (invalidKey) {
      return res.status(400).json({
        error: `fileContents key "${invalidKey}" must be a relative path without traversal (no ".." segments)`,
      });
    }
    const totalSize = Object.values(fileContents).reduce((sum, value) => sum + value.length, 0);
    if (totalSize > MAX_FILE_CONTENTS_BYTES) {
      return res.status(413).json({
        error: `fileContents total size (${Math.round(totalSize / 1_000)} KB) exceeds the ${MAX_FILE_CONTENTS_BYTES / 1_000} KB limit — send fewer or smaller files`,
      });
    }
  }

  const providerResolved = await requireProvider(req.userId, res, { qualityProfile: "code_review" });
  if (!providerResolved) return;
  const metadata = await createAuditMetadata(projectId, project);
  recordTrace(metadata, "review", "started");

  const rlReview = await checkProjectRateLimitDb(projectId);
  if (!rlReview.allowed) {
    return res.status(429).json({
      error: `LLM rate limit exceeded — max ${LLM_RATE_LIMIT} calls per minute per project. Retry in ${rlReview.retryAfterSec}s.`,
    });
  }

  const { emit, close } = beginTaskStream(res, "review", projectId, metadata);
  try {
    recordTrace(metadata, "building-context", "started");
    emit({ type: "stage", stage: "building-context" });
    const projectContext = await buildProjectContext(projectId, {
      sections: ["tasks", "metrics", "graphEntities", "graphRelationships", "events"],
    });

    emit({ type: "stage", stage: "calling-model" });
    recordTrace(metadata, "calling-model", "started", providerResolved.provider);
    const { provider, apiKey } = providerResolved;
    let effectiveProvider = provider;
    const { result } = await runAgentWithFallback(
      req.userId,
      { provider, apiKey },
      (opts) => reviewCode(projectContext, fileContents, {
        ...opts,
        onProgress: (message) => emit({
          type: "task_progress",
          task: "review",
          message,
          provider: opts.provider,
        }),
      }),
      { qualityProfile: "code_review" },
    ).then((output) => {
      effectiveProvider = output.effectiveProvider;
      return output;
    });

    if (result._parseError) {
      metadata.incomplete = true;
      recordTrace(metadata, "calling-model", "incomplete", effectiveProvider);
      emit({
        type: "error",
        code: "model_output_invalid",
        message: "The AI model returned an unexpected response.",
        hint: redactUserFacingText(result._parseError.message),
      });
      close();
      return;
    }

    emit({ type: "stage", stage: "persisting-result" });
    recordTrace(metadata, "persisting-result", "completed", effectiveProvider);
    invalidateContextCache(projectId);
    await db.transaction(async (tx) => {
      await tx.insert(auditLogsTable).values({
        id: randomUUID(),
        entityType: "project",
        entityId: projectId,
        action: "ai_reviewed",
        projectId,
        actor: req.userId,
        stateBefore: {},
        stateAfter: { verdict: result.verdict, overallScore: result.overallScore },
      });
      await tx.insert(eventsTable).values({
        id: randomUUID(),
        type: "AiCodeReviewCompleted",
        projectId,
        severity: result.verdict === "approved" ? "success" : "warning",
        message: `AI code review: ${result.verdict} (score: ${result.overallScore}/100)`,
      });
    });

    emit({ type: "stage", stage: "completed" });
    recordTrace(metadata, "review", "completed", effectiveProvider);
    emit({
      type: "task_done",
      task: "review",
      result: {
        ...redactUserFacingValue(result) as Record<string, unknown>,
        ...auditEnvelope(metadata),
      },
    });
    close();
    logger.info({ projectId, provider: effectiveProvider }, "AI code review stream completed");
  } catch (err) {
    logger.error({ err, projectId }, "AI code review stream failed");
    emitTaskFailure(emit, close, err, metadata);
  }
  return;
});

export default router;
