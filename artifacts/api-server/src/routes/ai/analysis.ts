/**
 * AI analysis and code review routes.
 *
 * POST /api/ai/projects/:projectId/analyze
 * POST /api/ai/projects/:projectId/review
 */
import { Router } from "express";
import { randomUUID } from "crypto";
import { db } from "@workspace/db";
import {
  aiChatMessagesTable,
  aiChatSessionsTable,
  auditLogsTable,
  eventsTable,
  projectsTable,
} from "@workspace/db";
import { and, eq } from "drizzle-orm";
import {
  buildProjectContext,
  invalidateContextCache,
  analyzeScan,
  reviewCode,
  invalidReviewFileKey,
  reviewFileContentsBytes,
  REVIEW_MAX_FILE_CONTENTS_BYTES,
} from "@workspace/ai-orchestrator";
import { logger } from "../../lib/logger.js";
import { requireProjectAccess } from "../../middlewares/requireProjectAccess.js";
import { checkProjectRateLimitDb } from "../../lib/db-rate-limiter.js";
import { resolveRootPath } from "../../lib/rootpath-validator.js";
import {
  resolveProvider,
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
     | { type: "task_progress"; task: StructuredTask; message: string }
    | { type: "task_done"; task: StructuredTask; result: Record<string, unknown> }
     | { type: "error"; code: string; message: string; hint?: string; retryable?: boolean; failureKind?: "PROVIDER_FORMAT" | "QUALITY_REVIEW" | "RATE_LIMIT" | "CONFIGURATION" | "PROVIDER_FAILURE" | "TRANSPORT"; quality?: { code: "QUALITY_REVIEW_LOW"; score: number; threshold: number; reasons: string[] }; outcome?: "FAILED" | "INTERRUPTED"; sessionId?: string })
    & Partial<StructuredAuditMetadata>;

type StructuredFailureKind =
  | "PROVIDER_FORMAT"
  | "QUALITY_REVIEW"
  | "RATE_LIMIT"
  | "CONFIGURATION"
  | "PROVIDER_FAILURE"
  | "TRANSPORT";

function publicQualityFailure(value: {
  score: number;
  threshold: number;
  reasons: unknown;
}): { code: "QUALITY_REVIEW_LOW"; score: number; threshold: number; reasons: string[] } {
  const score = Number.isFinite(value.score) ? Math.max(0, Math.min(1, value.score)) : 0;
  const threshold = Number.isFinite(value.threshold) ? Math.max(0, Math.min(1, value.threshold)) : 1;
  return {
    code: "QUALITY_REVIEW_LOW",
    score: Number(score.toFixed(4)),
    threshold: Number(threshold.toFixed(4)),
    reasons: (Array.isArray(value.reasons) ? value.reasons : [])
      .filter((reason): reason is string => typeof reason === "string")
      .map((reason) => reason.replace(/\s+/g, " ").trim().slice(0, 240))
      .filter(Boolean)
      .slice(0, 8),
  };
}

function structuredFailureDetails(err: unknown): {
  code: string;
  failureKind: StructuredFailureKind;
  message: string;
  retryable: boolean;
} {
  const candidate = err as { code?: unknown };
  const code = typeof candidate.code === "string" ? candidate.code : "task_failed";
  const failureKind =
    code === "model_output_invalid" || code === "INVALID_MODEL_OUTPUT" || code === "EMPTY_RESPONSE" ? "PROVIDER_FORMAT" :
    code === "QUALITY_REVIEW_LOW" || code === "quality_review_low" ? "QUALITY_REVIEW" :
    code === "RATE_LIMITED" ? "RATE_LIMIT" :
    code === "INVALID_CONFIG" || code === "AUTH_ERROR" || code === "MODEL_NOT_FOUND" || code === "PLAN_RESTRICTED" ? "CONFIGURATION" :
    code === "TIMEOUT" || code === "NETWORK_ERROR" || code === "NON_200" || code === "SERVER_ERROR" ? "PROVIDER_FAILURE" :
    "PROVIDER_FAILURE";
  const message =
    failureKind === "RATE_LIMIT" ? "The AI provider is rate-limited. Please wait before retrying." :
    failureKind === "CONFIGURATION" ? "The AI provider configuration needs attention before this can run." :
    failureKind === "QUALITY_REVIEW" ? "The AI result did not meet the quality checks required for completion." :
    failureKind === "PROVIDER_FORMAT" ? "The AI returned an unexpected response format." :
    "The AI provider could not complete this run.";
  return { code, failureKind, message, retryable: failureKind !== "CONFIGURATION" };
}

async function persistStructuredFailure(params: {
  projectId: string;
  userId: string;
  task: StructuredTask;
  sessionId?: string;
  failureKind: StructuredFailureKind;
  retryable: boolean;
  errorCode: string;
  errorMessage: string;
}): Promise<string> {
  const now = new Date();
  let sessionId = params.sessionId;
  const existingSession = sessionId
    ? (await db
      .select({ id: aiChatSessionsTable.id })
      .from(aiChatSessionsTable)
      .where(and(
        eq(aiChatSessionsTable.id, sessionId),
        eq(aiChatSessionsTable.projectId, params.projectId),
      ))
      .limit(1))[0]
    : undefined;
  if (!existingSession) sessionId = randomUUID();

  const prompt = params.task === "review"
    ? "Review the codebase and identify the most critical quality issues."
    : "Analyze the latest scan results and suggest the top 3 improvements.";
  const trace = JSON.stringify([{
    kind: "structured_task_failure",
    task: params.task,
    failureKind: params.failureKind,
    retryable: params.retryable,
  }]);

  await db.transaction(async (tx) => {
    if (!existingSession) {
      await tx.insert(aiChatSessionsTable).values({
        id: sessionId!,
        projectId: params.projectId,
        title: params.task === "review" ? "Code review" : "Scan analysis",
        createdAt: now,
        updatedAt: now,
      });
      await tx.insert(aiChatMessagesTable).values({
        id: randomUUID(),
        sessionId: sessionId!,
        role: "user",
        content: prompt,
        outcome: "SUCCEEDED",
        createdAt: now,
      });
    }
    await tx.insert(aiChatMessagesTable).values({
      id: randomUUID(),
      sessionId: sessionId!,
      role: "assistant",
      content: "",
      outcome: "FAILED",
      errorCode: params.errorCode,
      errorMessage: redactUserFacingText(params.errorMessage).slice(0, 500),
      toolTrace: trace,
      createdAt: now,
    });
    await tx.update(aiChatSessionsTable)
      .set({ updatedAt: now })
      .where(eq(aiChatSessionsTable.id, sessionId!));
  });
  return sessionId!;
}

async function requireStructuredProvider(
  userId: string,
  res: import("express").Response,
  options: Parameters<typeof resolveProvider>[1],
  params: {
    projectId: string;
    task: StructuredTask;
    sessionId?: string;
  },
): Promise<Awaited<ReturnType<typeof resolveProvider>> | null> {
  const resolved = await resolveProvider(userId, options);
  if (resolved) return resolved;

  const sessionId = await persistStructuredFailure({
    ...params,
    userId,
    failureKind: "CONFIGURATION",
    retryable: false,
    errorCode: "AI_PROVIDER_NOT_CONFIGURED",
    errorMessage: "The AI provider configuration needs attention before this can run.",
  });
  res.status(428).json({
    error: "AI provider not configured",
    hint: "Save an API key for at least one supported provider, then start a new task.",
    availabilityState: "missing_credentials",
    operatorAction: "Save an API key for at least one supported provider, then retry.",
    retryable: false,
    failureKind: "CONFIGURATION",
    sessionId,
  });
  return null;
}

function auditEnvelope(metadata: StructuredAuditMetadata): Record<string, unknown> {
  return {
    // Correlation identifiers are server diagnostics. Do not expose opaque
    // UUIDs in a model-output error response where they can be persisted or
    // echoed back to the user.
    rootAvailable: metadata.rootAvailable,
    incomplete: metadata.incomplete,
    operationalTrace: metadata.operationalTrace,
  };
}

function recordTrace(
  metadata: StructuredAuditMetadata,
  stage: string,
  status: StructuredAuditTraceEntry["status"],
): void {
  metadata.operationalTrace.push({
    stage,
    status,
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
  params: { projectId: string; userId: string; task: StructuredTask; sessionId?: string },
) {
  const { code, failureKind, message, retryable } = structuredFailureDetails(err);
  metadata.incomplete = true;
  metadata.operationalTrace.push({ stage: "failed", status: "failed" });
  void persistStructuredFailure({
    ...params,
    failureKind,
    retryable,
    errorCode: code,
    errorMessage: message,
  }).then((sessionId) => {
    emit({
      type: "error",
      code,
      message,
      hint: failureKind === "RATE_LIMIT"
        ? "Wait a moment and retry the task."
        : failureKind === "CONFIGURATION"
          ? "Update the AI setup before starting a new task."
          : "You can retry this task without sending another prompt.",
      retryable,
      failureKind,
      outcome: "FAILED",
      sessionId,
    });
    close();
  }).catch((persistError) => {
    logger.error({ persistError, projectId: params.projectId, task: params.task }, "structured task failure persistence failed");
    emit({
      type: "error",
      code,
      message,
      hint: "You can retry this task without sending another prompt.",
      retryable,
      failureKind,
      outcome: "FAILED",
    });
    close();
  });
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
      error: "The AI provider is temporarily rate-limited.",
      code: "RATE_LIMITED",
      hint: `Wait ${rlAnalyze.retryAfterSec}s, then retry the analysis.`,
      retryable: true,
      failureKind: "RATE_LIMIT",
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
    recordTrace(metadata, "analyze", "failed");
    const details = structuredFailureDetails(err);
    let sessionId: string | undefined;
    try {
      sessionId = await persistStructuredFailure({
        projectId,
        userId: req.userId,
        task: "analyze",
        failureKind: details.failureKind,
        retryable: details.retryable,
        errorCode: details.code,
        errorMessage: details.message,
      });
    } catch (persistError) {
      logger.error({ persistError, projectId, task: "analyze" }, "structured provider failure persistence failed");
    }
    if (handleOrchestratorError(err, res, {
      projectId,
      operation: "scan-analysis",
      provider: effectiveProvider,
      incompleteReview: { sessionId, failureKind: details.failureKind },
    })) return;
    throw err;
  }

  // When the model output failed to parse, we still have the fallback data
  // (generated by fallbackScanAnalysis). Serve it with a warning header so the
  // UI can still display something useful rather than showing a hard error.
  // Only a completely empty/unusable response (no summary at all) should 422.
  if (result._parseError) {
    metadata.incomplete = true;
    recordTrace(metadata, "analyze", "incomplete");
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
  if (result._qualityError) {
    const quality = publicQualityFailure(result._qualityError);
    metadata.incomplete = true;
    recordTrace(metadata, "analyze", "incomplete");
    logger.warn(
      { projectId, quality, provider: effectiveProvider },
      "scan-analyst: quality gate rejected result",
    );
    return res.status(422).json({
      ...auditEnvelope(metadata),
      error: "quality_review_low",
      code: "QUALITY_REVIEW_LOW",
      quality,
      hint: "The AI result did not meet the quality checks required for completion — try again.",
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

  recordTrace(metadata, "analyze", "completed");
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

  if (fileContents) {
    const invalidKey = invalidReviewFileKey(fileContents);
    if (invalidKey) {
      return res.status(400).json({
        error: `fileContents key "${invalidKey}" must be a relative path without traversal (no ".." segments)`,
      });
    }
    const totalSize = reviewFileContentsBytes(fileContents);
    if (totalSize > REVIEW_MAX_FILE_CONTENTS_BYTES) {
      return res.status(413).json({
        error: `fileContents total size (${Math.round(totalSize / 1_000)} KB) exceeds the ${REVIEW_MAX_FILE_CONTENTS_BYTES / 1_000} KB limit — send fewer or smaller files`,
      });
    }
  }

  const rlReview = await checkProjectRateLimitDb(projectId);
  if (!rlReview.allowed) {
    return res.status(429).json({
      error: "The AI provider is temporarily rate-limited.",
      code: "RATE_LIMITED",
      hint: `Wait ${rlReview.retryAfterSec}s, then retry the code review.`,
      retryable: true,
      failureKind: "RATE_LIMIT",
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
    recordTrace(metadata, "review", "failed");
    const details = structuredFailureDetails(err);
    let sessionId: string | undefined;
    try {
      sessionId = await persistStructuredFailure({
        projectId,
        userId: req.userId,
        task: "review",
        failureKind: details.failureKind,
        retryable: details.retryable,
        errorCode: details.code,
        errorMessage: details.message,
      });
    } catch (persistError) {
      logger.error({ persistError, projectId, task: "review" }, "structured provider failure persistence failed");
    }
    if (handleOrchestratorError(err, res, {
      projectId,
      operation: "code-review",
      provider: effectiveProvider,
      incompleteReview: { sessionId, failureKind: details.failureKind },
    })) return;
    throw err;
  }

  // When the model output failed to parse, we still have the fallback data.
  // Serve it with a warning header so the UI can display something useful.
  if (result._parseError) {
    metadata.incomplete = true;
    recordTrace(metadata, "review", "incomplete");
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
  if (result._qualityError) {
    const quality = publicQualityFailure(result._qualityError);
    metadata.incomplete = true;
    recordTrace(metadata, "review", "incomplete");
    logger.warn(
      { projectId, quality, provider: effectiveProvider },
      "code-reviewer: quality gate rejected result",
    );
    return res.status(422).json({
      ...auditEnvelope(metadata),
      error: "quality_review_low",
      code: "QUALITY_REVIEW_LOW",
      quality,
      hint: "The AI review did not meet the quality checks required for completion — try again.",
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
      stateAfter: {
        verdict: result.verdict,
        overallScore: result.overallScore,
        reviewScope: result.reviewScope,
      },
    });
    await tx.insert(eventsTable).values({
      id: randomUUID(),
      type: "AiCodeReviewCompleted",
      projectId,
      severity: result.verdict === "approved" ? "success" : "warning",
      message: `AI code review: ${result.verdict} (score: ${result.overallScore}/100)`,
    });
  });

  recordTrace(metadata, "review", "completed");
  return res.json({ ...redactUserFacingValue(result) as Record<string, unknown>, ...auditEnvelope(metadata) });
});

// ── POST /api/ai/projects/:projectId/analyze/stream ──────────────────────────

router.post("/ai/projects/:projectId/analyze/stream", requireProjectAccess, async (req, res) => {
  const projectId = req.params.projectId as string;
  const project = req.project;
  if (!project) return res.status(500).json({ error: "Project context unavailable" });
  const requestedSessionId = typeof req.body?.sessionId === "string" ? req.body.sessionId : undefined;
  const metadata = await createAuditMetadata(projectId, project);
  recordTrace(metadata, "analyze", "started");
  const providerResolved = await requireStructuredProvider(
    req.userId,
    res,
    { qualityProfile: "analysis" },
    { projectId, task: "analyze", sessionId: requestedSessionId },
  );
  if (!providerResolved) return;

  const rlAnalyze = await checkProjectRateLimitDb(projectId);
  if (!rlAnalyze.allowed) {
    const sessionId = await persistStructuredFailure({
      projectId,
      userId: req.userId,
      task: "analyze",
      sessionId: requestedSessionId,
      failureKind: "RATE_LIMIT",
      retryable: true,
      errorCode: "RATE_LIMITED",
      errorMessage: "The AI provider is temporarily rate-limited.",
    });
    return res.status(429).json({
      error: "The AI provider is temporarily rate-limited.",
      code: "RATE_LIMITED",
      hint: `Wait ${rlAnalyze.retryAfterSec}s, then retry the analysis.`,
      retryable: true,
      failureKind: "RATE_LIMIT",
      sessionId,
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
    recordTrace(metadata, "calling-model", "started");
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
        }),
      }),
      { qualityProfile: "analysis" },
    ).then((output) => {
      effectiveProvider = output.effectiveProvider;
      return output;
    });

    if (result._parseError) {
      metadata.incomplete = true;
      recordTrace(metadata, "calling-model", "incomplete");
      const sessionId = await persistStructuredFailure({
        projectId,
        userId: req.userId,
        task: "analyze",
        sessionId: requestedSessionId,
        failureKind: "PROVIDER_FORMAT",
        retryable: true,
        errorCode: "model_output_invalid",
        errorMessage: "The AI returned an unexpected response format.",
      });
      emit({
        type: "error",
        code: "model_output_invalid",
        message: "The AI model returned an unexpected response.",
        hint: "The response could not be verified as a structured result. You can retry this task.",
        retryable: true,
        failureKind: "PROVIDER_FORMAT",
        outcome: "FAILED",
        sessionId,
      });
      close();
      return;
    }
    if (result._qualityError) {
      const quality = publicQualityFailure(result._qualityError);
      metadata.incomplete = true;
      recordTrace(metadata, "calling-model", "incomplete");
      const sessionId = await persistStructuredFailure({
        projectId,
        userId: req.userId,
        task: "analyze",
        sessionId: requestedSessionId,
        failureKind: "QUALITY_REVIEW",
        retryable: true,
        errorCode: "QUALITY_REVIEW_LOW",
        errorMessage: "The AI result did not meet the quality checks required for completion.",
      });
      emit({
        type: "error",
        code: "QUALITY_REVIEW_LOW",
        message: "The AI result did not meet the quality checks required for completion.",
        hint: "Retry the task to request a newly assessed structured result.",
        retryable: true,
        quality,
        failureKind: "QUALITY_REVIEW",
        outcome: "FAILED",
        sessionId,
      });
      close();
      return;
    }

    emit({ type: "stage", stage: "persisting-result" });
    recordTrace(metadata, "persisting-result", "completed");
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
    recordTrace(metadata, "analyze", "completed");
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
    emitTaskFailure(emit, close, err, metadata, {
      projectId,
      userId: req.userId,
      task: "analyze",
      sessionId: requestedSessionId,
    });
  }
  return;
});

// ── POST /api/ai/projects/:projectId/review/stream ───────────────────────────

router.post("/ai/projects/:projectId/review/stream", requireProjectAccess, async (req, res) => {
  const projectId = req.params.projectId as string;
  const project = req.project;
  if (!project) return res.status(500).json({ error: "Project context unavailable" });
  const { fileContents, sessionId: requestedSessionId } = req.body as {
    fileContents?: Record<string, string>;
    sessionId?: string;
  };
  if (fileContents) {
    const invalidKey = invalidReviewFileKey(fileContents);
    if (invalidKey) {
      return res.status(400).json({
        error: `fileContents key "${invalidKey}" must be a relative path without traversal (no ".." segments)`,
      });
    }
    const totalSize = reviewFileContentsBytes(fileContents);
    if (totalSize > REVIEW_MAX_FILE_CONTENTS_BYTES) {
      return res.status(413).json({
        error: `fileContents total size (${Math.round(totalSize / 1_000)} KB) exceeds the ${REVIEW_MAX_FILE_CONTENTS_BYTES / 1_000} KB limit — send fewer or smaller files`,
      });
    }
  }

  const metadata = await createAuditMetadata(projectId, project);
  recordTrace(metadata, "review", "started");
  const providerResolved = await requireStructuredProvider(
    req.userId,
    res,
    { qualityProfile: "code_review" },
    { projectId, task: "review", sessionId: requestedSessionId },
  );
  if (!providerResolved) return;

  const rlReview = await checkProjectRateLimitDb(projectId);
  if (!rlReview.allowed) {
    const sessionId = await persistStructuredFailure({
      projectId,
      userId: req.userId,
      task: "review",
      sessionId: requestedSessionId,
      failureKind: "RATE_LIMIT",
      retryable: true,
      errorCode: "RATE_LIMITED",
      errorMessage: "The AI provider is temporarily rate-limited.",
    });
    return res.status(429).json({
      error: "The AI provider is temporarily rate-limited.",
      code: "RATE_LIMITED",
      hint: `Wait ${rlReview.retryAfterSec}s, then retry the code review.`,
      retryable: true,
      failureKind: "RATE_LIMIT",
      sessionId,
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
    recordTrace(metadata, "calling-model", "started");
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
        }),
      }),
      { qualityProfile: "code_review" },
    ).then((output) => {
      effectiveProvider = output.effectiveProvider;
      return output;
    });

    if (result._parseError) {
      metadata.incomplete = true;
      recordTrace(metadata, "calling-model", "incomplete");
      const sessionId = await persistStructuredFailure({
        projectId,
        userId: req.userId,
        task: "review",
        sessionId: requestedSessionId,
        failureKind: "PROVIDER_FORMAT",
        retryable: true,
        errorCode: "model_output_invalid",
        errorMessage: "The AI returned an unexpected response format.",
      });
      emit({
        type: "error",
        code: "model_output_invalid",
        message: "The AI model returned an unexpected response.",
        hint: "The response could not be verified as a structured result. You can retry this task.",
        retryable: true,
        failureKind: "PROVIDER_FORMAT",
        outcome: "FAILED",
        sessionId,
      });
      close();
      return;
    }
    if (result._qualityError) {
      const quality = publicQualityFailure(result._qualityError);
      metadata.incomplete = true;
      recordTrace(metadata, "calling-model", "incomplete");
      const sessionId = await persistStructuredFailure({
        projectId,
        userId: req.userId,
        task: "review",
        sessionId: requestedSessionId,
        failureKind: "QUALITY_REVIEW",
        retryable: true,
        errorCode: "QUALITY_REVIEW_LOW",
        errorMessage: "The AI review did not meet the quality checks required for completion.",
      });
      emit({
        type: "error",
        code: "QUALITY_REVIEW_LOW",
        message: "The AI review did not meet the quality checks required for completion.",
        hint: "Retry the review to request a newly assessed structured result.",
        retryable: true,
        quality,
        failureKind: "QUALITY_REVIEW",
        outcome: "FAILED",
        sessionId,
      });
      close();
      return;
    }

    emit({ type: "stage", stage: "persisting-result" });
    recordTrace(metadata, "persisting-result", "completed");
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
        stateAfter: {
          verdict: result.verdict,
          overallScore: result.overallScore,
          reviewScope: result.reviewScope,
        },
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
    recordTrace(metadata, "review", "completed");
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
    emitTaskFailure(emit, close, err, metadata, {
      projectId,
      userId: req.userId,
      task: "review",
      sessionId: requestedSessionId,
    });
  }
  return;
});

export default router;
