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
  aiExecutionAcceptancesTable,
  aiExecutionsTable,
  auditLogsTable,
  eventsTable,
  projectsTable,
  scanJobsTable,
} from "@workspace/db";
import { and, desc, eq } from "drizzle-orm";
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
  getProviderSelectionFailure,
  requireProvider,
  handleOrchestratorError,
  runAgentWithFallback,
  redactUserFacingText,
  redactUserFacingValue,
} from "../../lib/ai-route-helpers.js";
import {
  startStructuredExecution,
  StructuredExecutionCooldownError,
  resolveStructuredRetryAfter,
  type StructuredExecution,
  type StructuredRetryAfterSource,
} from "../../lib/structured-task-execution.js";
import type { AiTerminalProjection } from "../../lib/ai-terminal-outcome.js";

const router = Router();
const STRUCTURED_MAX_MODEL_FALLBACKS = 3;
const STRUCTURED_DEADLINE_MS = 45_000;

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
  | ({ type: "execution_started"; executionId: string; sessionId: string; resumeToken?: string; resumable: boolean }
     | { type: "task_started"; task: StructuredTask; projectId: string }
    | { type: "stage"; stage: string }
     | { type: "task_progress"; task: StructuredTask; message: string }
      | { type: "task_done"; task: StructuredTask; result: Record<string, unknown>; executionId?: string; terminalProjection?: AiTerminalProjection }
        | { type: "error"; code: string; message: string; hint?: string; parseCode?: string; retryable?: boolean; retryAfterMs?: number; retryAt?: string; retryAfterSource?: StructuredRetryAfterSource; failureKind?: "PROVIDER_FORMAT" | "QUALITY_REVIEW" | "RATE_LIMIT" | "CONFIGURATION" | "PROVIDER_FAILURE" | "TRANSPORT"; quality?: { code: "QUALITY_REVIEW_LOW"; score: number; threshold: number; reasons: string[] }; outcome?: "FAILED" | "INTERRUPTED"; sessionId?: string; executionId?: string; terminalProjection?: AiTerminalProjection })
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
  parseCode?: string;
  retryAfterMs?: number;
  retryAfterSource?: StructuredRetryAfterSource;
  providerAttempts?: Array<{ provider: string; code: string }>;
} {
  const candidate = err as { code?: unknown };
  const code = typeof candidate.code === "string" ? candidate.code : "task_failed";
  const parseCode = typeof (err as { parseCode?: unknown }).parseCode === "string"
    ? (err as { parseCode: string }).parseCode
    : undefined;
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
  const retryAfterCandidate = (err as { retryAfterMs?: unknown }).retryAfterMs;
  const hasProviderRetryAfter =
    typeof retryAfterCandidate === "number"
    && Number.isFinite(retryAfterCandidate);
  const retryAfterMs = failureKind === "RATE_LIMIT"
    ? Math.max(
        1_000,
        hasProviderRetryAfter ? retryAfterCandidate as number : 30_000,
      )
    : undefined;
  const providerName = (err as { providerName?: unknown }).providerName;
  const providerAttempts =
    failureKind === "RATE_LIMIT" || failureKind === "PROVIDER_FAILURE"
      ? [{
          provider: typeof providerName === "string" && providerName.trim() ? providerName : "unknown",
          code,
        }]
      : undefined;
  return {
    code,
    failureKind,
    message,
    retryable: failureKind !== "CONFIGURATION",
    ...(parseCode ? { parseCode } : {}),
    retryAfterMs,
    retryAfterSource: failureKind === "RATE_LIMIT"
      ? hasProviderRetryAfter ? "provider" : "server_default"
      : undefined,
    providerAttempts,
  };
}

function structuredDeadlineError(task: StructuredTask): Error {
  return Object.assign(
    new Error(`Structured ${task} exceeded its execution deadline.`),
    { code: "TIMEOUT" },
  );
}

async function withStructuredDeadline<T>(
  task: StructuredTask,
  work: (signal: AbortSignal) => Promise<T>,
): Promise<T> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), STRUCTURED_DEADLINE_MS);
  try {
    return await Promise.race([
      work(controller.signal),
      new Promise<T>((_, reject) => {
        const onAbort = () => reject(structuredDeadlineError(task));
        if (controller.signal.aborted) onAbort();
        else controller.signal.addEventListener("abort", onAbort, { once: true });
      }),
    ]);
  } finally {
    clearTimeout(timeout);
    controller.abort();
  }
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
  const [latestScan] = await db
    .select({
      status: scanJobsTable.status,
      result: scanJobsTable.result,
    })
    .from(scanJobsTable)
    .where(eq(scanJobsTable.projectId, projectId))
    .orderBy(desc(scanJobsTable.createdAt))
    .limit(1);
  const scanResult = latestScan?.result;
  const scanRevision =
    latestScan?.status === "completed" &&
    typeof scanResult?.projectRevision === "string"
      ? scanResult.projectRevision
      : undefined;
  return {
    operationId: randomUUID(),
    projectId,
    projectRevision: scanRevision ?? project.updatedAt.toISOString(),
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
  options?: {
    execution?: StructuredExecution;
  },
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
    options?.execution?.onClientClose();
  });

  metadata.operationalTrace.push({ stage: "task", status: "started" });
  if (options?.execution) {
    emit({
      type: "execution_started",
      ...options.execution.started,
    });
  }
  emit({ type: "task_started", task, projectId });
  return { emit, close };
}

function structuredResultContent(task: StructuredTask, result: Record<string, unknown>): string {
  if (task === "analyze") {
    return [
      "## Scan analysis",
      typeof result.summary === "string" ? result.summary : "Scan analysis completed.",
      typeof result.overallAssessment === "string" ? `\nOverall assessment: ${result.overallAssessment}` : "",
      typeof result.topPriority === "string" ? `\nTop priority: ${result.topPriority}` : "",
      typeof result.estimatedImpact === "string" ? `\nEstimated impact: ${result.estimatedImpact}` : "",
    ].filter(Boolean).join("\n");
  }
  return [
    "## Code review",
    typeof result.verdict === "string" ? `Verdict: ${result.verdict}` : "Code review completed.",
    typeof result.overallScore === "number" ? `Score: ${result.overallScore}/100` : "",
    "The complete structured review is available in the saved execution result.",
  ].filter(Boolean).join("\n");
}

async function loadStructuredTerminalProjection(params: {
  executionId: string;
  sessionId: string;
}): Promise<AiTerminalProjection | undefined> {
  const [execution] = await db
    .select({
      id: aiExecutionsTable.id,
      sessionId: aiExecutionsTable.sessionId,
      attempt: aiExecutionsTable.attempt,
      status: aiExecutionsTable.status,
      finalMessageId: aiExecutionsTable.finalMessageId,
      operationId: aiExecutionsTable.operationId,
      correlationId: aiExecutionsTable.correlationId,
    })
    .from(aiExecutionsTable)
    .where(and(
      eq(aiExecutionsTable.id, params.executionId),
      eq(aiExecutionsTable.sessionId, params.sessionId),
    ))
    .limit(1);
  if (!execution) return undefined;

  const [acceptance] = await db
    .select({
      id: aiExecutionAcceptancesTable.id,
      messageId: aiExecutionAcceptancesTable.messageId,
      terminalStatus: aiExecutionAcceptancesTable.terminalStatus,
      outcome: aiExecutionAcceptancesTable.outcome,
      reasonCode: aiExecutionAcceptancesTable.reasonCode,
      nextActionCode: aiExecutionAcceptancesTable.nextActionCode,
      resumable: aiExecutionAcceptancesTable.resumable,
    })
    .from(aiExecutionAcceptancesTable)
    .where(and(
      eq(aiExecutionAcceptancesTable.executionId, execution.id),
      eq(aiExecutionAcceptancesTable.attempt, execution.attempt),
    ))
    .limit(1);

  const status = acceptance?.terminalStatus === "completed"
      || acceptance?.terminalStatus === "failed"
      || acceptance?.terminalStatus === "cancelled"
      || acceptance?.terminalStatus === "paused"
    ? acceptance.terminalStatus
    : execution.status === "completed"
      || execution.status === "failed"
      || execution.status === "cancelled"
      || execution.status === "paused"
      ? execution.status
      : "failed";
  const outcome = acceptance?.outcome === "SUCCEEDED"
    || acceptance?.outcome === "FAILED"
    || acceptance?.outcome === "INTERRUPTED"
    ? acceptance.outcome
    : status === "completed"
      ? "SUCCEEDED"
      : status === "cancelled"
        ? "INTERRUPTED"
        : "FAILED";

  return {
    executionId: execution.id,
    sessionId: execution.sessionId ?? params.sessionId,
    attempt: execution.attempt,
    messageId: acceptance?.messageId ?? execution.finalMessageId ?? null,
    acceptanceId: acceptance?.id ?? null,
    operationId: execution.operationId ?? null,
    correlationId: execution.correlationId ?? execution.operationId ?? execution.id,
    status,
    outcome,
    reasonCode: acceptance?.reasonCode ?? (
      status === "cancelled"
        ? "EXECUTION_CANCELLED"
        : status === "completed"
          ? "ACCEPTED"
          : "EXECUTION_FAILED"
    ),
    nextActionCode: acceptance?.nextActionCode ?? null,
    resumable: Boolean(acceptance?.resumable) || status === "paused",
  };
}

async function persistStructuredExecutionFailure(params: {
  execution: StructuredExecution;
  task: StructuredTask;
  details: ReturnType<typeof structuredFailureDetails>;
  emit: (event: StructuredTaskEvent) => void;
  close: () => void;
}): Promise<void> {
  const { execution, task, details, emit, close } = params;
  const content = details.message;
  const providerName = details.providerAttempts?.[0]?.provider;
  const retry = details.failureKind === "RATE_LIMIT"
    ? await resolveStructuredRetryAfter({
        userId: execution.execution.userId,
        projectId: execution.execution.projectId,
        task,
        providerName,
        providerRetryAfterMs: details.retryAfterMs,
        providerRetryAfterSource: details.retryAfterSource,
      })
    : undefined;
  const retryAfterMs = retry?.retryAfterMs ?? details.retryAfterMs;
  const retryAfterSource = retry?.source ?? details.retryAfterSource;
  const retryAt = retryAfterMs !== undefined
    ? new Date(Date.now() + retryAfterMs).toISOString()
    : undefined;
  const messageId = await execution.persistAssistant({
    content: "",
    outcome: "FAILED",
    errorCode: details.code,
    errorMessage: content,
    toolTrace: JSON.stringify([{
      kind: "structured_task_failure",
      task,
      failureKind: details.failureKind,
      ...(details.parseCode ? { parseCode: details.parseCode } : {}),
      retryable: details.retryable,
    }]),
  });
  await execution.fail({
    messageId,
    error: content,
    errorCode: details.code,
    providerAttempts: details.providerAttempts,
    retryAfterMs,
    retryAt,
    disposition: retryAfterSource
      ? { retryAfterSource }
      : undefined,
  });
  const terminalProjection = await loadStructuredTerminalProjection({
    executionId: execution.started.executionId,
    sessionId: execution.started.sessionId,
  });
  emit({
    type: "error",
    code: details.code,
    message: content,
    hint: details.failureKind === "RATE_LIMIT"
      ? "Wait a moment and retry the task."
      : details.failureKind === "CONFIGURATION"
        ? "Update the AI setup before starting a new task."
        : "You can retry this task without sending another prompt.",
    retryable: details.retryable,
    retryAfterMs,
    retryAt,
    retryAfterSource,
    failureKind: details.failureKind,
    ...(details.parseCode ? { parseCode: details.parseCode } : {}),
    outcome: "FAILED",
    sessionId: execution.started.sessionId,
    executionId: execution.started.executionId,
    ...(terminalProjection ? { terminalProjection } : {}),
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
    operationId: metadata.operationId,
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
    ({ result, effectiveProvider } = await withStructuredDeadline("analyze", (signal) =>
      runAgentWithFallback(
        req.userId,
        { provider, apiKey },
        (opts) => analyzeScan(projectContext, { ...opts, signal }),
        {
          signal,
          qualityProfile: "analysis",
          telemetryContext: {
            projectId,
            userId: req.userId,
            operationId: metadata.operationId,
            correlationId: metadata.operationId,
          },
        },
      ),
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
      {
        qualityProfile: "code_review",
        telemetryContext: { projectId, userId: req.userId, operationId: metadata.operationId, correlationId: metadata.operationId },
      },
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
  const requestedExecutionId = typeof req.body?.executionId === "string" ? req.body.executionId : undefined;
  const requestedResumeToken = typeof req.body?.resumeToken === "string" ? req.body.resumeToken : undefined;
  const idempotencyKey = typeof req.body?.idempotencyKey === "string" ? req.body.idempotencyKey : undefined;
  const metadata = await createAuditMetadata(projectId, project);
  recordTrace(metadata, "analyze", "started");
  const preflightProvider = await resolveProvider(req.userId, { qualityProfile: "analysis" });
  let structuredExecution: StructuredExecution;
  try {
    structuredExecution = await startStructuredExecution({
      userId: req.userId,
      projectId,
      projectRevision: metadata.projectRevision,
      task: "analyze",
      prompt: "Analyze the latest scan results and suggest the top 3 improvements.",
      providerName: preflightProvider?.provider,
      sessionId: requestedSessionId,
      executionId: requestedExecutionId,
      resumeToken: requestedResumeToken,
      idempotencyKey,
    });
  } catch (error) {
    const code = error instanceof Error ? error.message : "EXECUTION_START_FAILED";
    if (error instanceof StructuredExecutionCooldownError) {
      return res.status(429).json({
        error: error.message,
        code: error.code,
        retryable: true,
        retryAfterMs: error.retryAfterMs,
        retryAt: error.retryAt,
        retryAfterSource: error.retryAfterSource,
        failureKind: "RATE_LIMIT",
        sessionId: error.sessionId,
      });
    }
    return res.status(code === "EXECUTION_NOT_FOUND" ? 404 : 409).json({
      error: code,
      code,
    });
  }
  metadata.operationId = structuredExecution.execution.operationId ?? metadata.operationId;
  const { emit, close } = beginTaskStream(res, "analyze", projectId, metadata, {
    execution: structuredExecution,
  });
  await structuredExecution.checkpoint("running", "Structured analysis started");

  const providerResolved = preflightProvider
    ?? await resolveProvider(req.userId, { qualityProfile: "analysis" });
  if (!providerResolved) {
    await persistStructuredExecutionFailure({
      execution: structuredExecution,
      task: "analyze",
      details: structuredFailureDetails({ code: "INVALID_CONFIG" }),
      emit,
      close,
    });
    return;
  }

  const rlAnalyze = await checkProjectRateLimitDb(projectId);
  if (!rlAnalyze.allowed) {
    await persistStructuredExecutionFailure({
      execution: structuredExecution,
      task: "analyze",
      details: {
        code: "RATE_LIMITED",
        failureKind: "RATE_LIMIT",
        message: "The AI provider is temporarily rate-limited.",
        retryable: true,
        retryAfterMs: (rlAnalyze.retryAfterSec ?? 30) * 1_000,
        retryAfterSource: "project_rate_limit",
      },
      emit,
      close,
    });
    return;
  }

  try {
    recordTrace(metadata, "building-context", "started");
    await structuredExecution.checkpoint("running", "Building project context");
    emit({ type: "stage", stage: "building-context" });
    const projectContext = await buildProjectContext(projectId, {
      sections: ["tasks", "metrics", "graphEntities", "graphRelationships", "events"],
      operationId: metadata.operationId,
    });

    emit({ type: "stage", stage: "calling-model" });
    await structuredExecution.checkpoint("model_call", "Calling AI model");
    recordTrace(metadata, "calling-model", "started");
    const { provider, apiKey } = providerResolved;
    let effectiveProvider = provider;
    const { result } = await runAgentWithFallback(
      req.userId,
      { provider, apiKey },
      (opts) => analyzeScan(projectContext, {
        ...opts,
        maxFallbackModels: STRUCTURED_MAX_MODEL_FALLBACKS,
        retryTransient: false,
        onProgress: (message) => emit({
          type: "task_progress",
          task: "analyze",
          message,
        }),
      }),
      {
        qualityProfile: "analysis",
        telemetryContext: {
          projectId,
          userId: req.userId,
          executionId: structuredExecution.started.executionId,
          operationId: metadata.operationId,
          correlationId: metadata.operationId,
        },
      },
    ).then((output) => {
      effectiveProvider = output.effectiveProvider;
      return output;
    });

    if (result._parseError) {
      metadata.incomplete = true;
      recordTrace(metadata, "calling-model", "incomplete");
      await persistStructuredExecutionFailure({
        execution: structuredExecution,
        task: "analyze",
        details: structuredFailureDetails({
          code: "model_output_invalid",
          parseCode: result._parseError.code,
        }),
        emit,
        close,
      });
      return;
    }
    if (result._qualityError) {
      metadata.incomplete = true;
      recordTrace(metadata, "calling-model", "incomplete");
      await persistStructuredExecutionFailure({
        execution: structuredExecution,
        task: "analyze",
        details: {
          code: "QUALITY_REVIEW_LOW",
          failureKind: "QUALITY_REVIEW",
          message: "The AI result did not meet the quality checks required for completion.",
          retryable: true,
        },
        emit,
        close,
      });
      return;
    }

    emit({ type: "stage", stage: "persisting-result" });
    recordTrace(metadata, "persisting-result", "completed");
    await structuredExecution.checkpoint("finalizing", "Persisting structured analysis");
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

    const content = structuredResultContent("analyze", result as unknown as Record<string, unknown>);
    const messageId = await structuredExecution.persistAssistant({
      content,
      outcome: "SUCCEEDED",
      toolTrace: JSON.stringify([{ kind: "structured_task_result", task: "analyze" }]),
    });
    const accepted = await structuredExecution.complete({ messageId, content });
    if (!accepted) {
      close();
      return;
    }
    emit({ type: "stage", stage: "completed" });
    recordTrace(metadata, "analyze", "completed");
    emit({
      type: "task_done",
      task: "analyze",
      executionId: structuredExecution.started.executionId,
      result: {
        ...redactUserFacingValue(result) as Record<string, unknown>,
        ...auditEnvelope(metadata),
      },
      terminalProjection: await loadStructuredTerminalProjection({
        executionId: structuredExecution.started.executionId,
        sessionId: structuredExecution.started.sessionId,
      }),
    });
    close();
    logger.info({ projectId, provider: effectiveProvider }, "AI scan analysis stream completed");
  } catch (err) {
    logger.error({ err, projectId }, "AI scan analysis stream failed");
    await persistStructuredExecutionFailure({
      execution: structuredExecution,
      task: "analyze",
      details: structuredFailureDetails(err),
      emit,
      close,
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
  const requestedExecutionId = typeof req.body?.executionId === "string" ? req.body.executionId : undefined;
  const requestedResumeToken = typeof req.body?.resumeToken === "string" ? req.body.resumeToken : undefined;
  const idempotencyKey = typeof req.body?.idempotencyKey === "string" ? req.body.idempotencyKey : undefined;
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
  const preflightProvider = await resolveProvider(req.userId, { qualityProfile: "code_review" });
  let structuredExecution: StructuredExecution;
  try {
    structuredExecution = await startStructuredExecution({
      userId: req.userId,
      projectId,
      projectRevision: metadata.projectRevision,
      task: "review",
      prompt: "Review the codebase and identify the most critical quality issues.",
      providerName: preflightProvider?.provider,
      sessionId: requestedSessionId,
      executionId: requestedExecutionId,
      resumeToken: requestedResumeToken,
      idempotencyKey,
    });
  } catch (error) {
    const code = error instanceof Error ? error.message : "EXECUTION_START_FAILED";
    if (error instanceof StructuredExecutionCooldownError) {
      return res.status(429).json({
        error: error.message,
        code: error.code,
        retryable: true,
        retryAfterMs: error.retryAfterMs,
        retryAt: error.retryAt,
        retryAfterSource: error.retryAfterSource,
        failureKind: "RATE_LIMIT",
        sessionId: error.sessionId,
      });
    }
    return res.status(code === "EXECUTION_NOT_FOUND" ? 404 : 409).json({
      error: code,
      code,
    });
  }
  metadata.operationId = structuredExecution.execution.operationId ?? metadata.operationId;
  const { emit, close } = beginTaskStream(res, "review", projectId, metadata, {
    execution: structuredExecution,
  });
  await structuredExecution.checkpoint("running", "Structured review started");

  const providerResolved = preflightProvider
    ?? await resolveProvider(req.userId, { qualityProfile: "code_review" });
  if (!providerResolved) {
    const details = structuredFailureDetails(
      await getProviderSelectionFailure(req.userId, { qualityProfile: "code_review" }),
    );
    await persistStructuredExecutionFailure({
      execution: structuredExecution,
      task: "review",
      details,
      emit,
      close,
    });
    return;
  }

  const rlReview = await checkProjectRateLimitDb(projectId);
  if (!rlReview.allowed) {
    await persistStructuredExecutionFailure({
      execution: structuredExecution,
      task: "review",
      details: {
        code: "RATE_LIMITED",
        failureKind: "RATE_LIMIT",
        message: "The AI provider is temporarily rate-limited.",
        retryable: true,
        retryAfterMs: (rlReview.retryAfterSec ?? 30) * 1_000,
        retryAfterSource: "project_rate_limit",
      },
      emit,
      close,
    });
    return;
  }

  try {
    recordTrace(metadata, "building-context", "started");
    await structuredExecution.checkpoint("running", "Building project context");
    emit({ type: "stage", stage: "building-context" });
    const projectContext = await buildProjectContext(projectId, {
      sections: ["tasks", "metrics", "graphEntities", "graphRelationships", "events"],
    });

    emit({ type: "stage", stage: "calling-model" });
    await structuredExecution.checkpoint("model_call", "Calling AI model");
    recordTrace(metadata, "calling-model", "started");
    const { provider, apiKey } = providerResolved;
    let effectiveProvider = provider;
    const { result } = await withStructuredDeadline("review", (signal) =>
      runAgentWithFallback(
        req.userId,
        { provider, apiKey },
        (opts) => reviewCode(projectContext, fileContents, {
          ...opts,
          signal,
          maxFallbackModels: STRUCTURED_MAX_MODEL_FALLBACKS,
          retryTransient: false,
          onProgress: (message) => emit({
            type: "task_progress",
            task: "review",
            message,
          }),
        }),
        {
          signal,
          qualityProfile: "code_review",
          telemetryContext: {
            projectId,
            userId: req.userId,
            executionId: structuredExecution.started.executionId,
            operationId: metadata.operationId,
            correlationId: metadata.operationId,
          },
        },
      ),
    ).then((output) => {
      effectiveProvider = output.effectiveProvider;
      return output;
    });

    if (result._parseError) {
      metadata.incomplete = true;
      recordTrace(metadata, "calling-model", "incomplete");
      await persistStructuredExecutionFailure({
        execution: structuredExecution,
        task: "review",
        details: structuredFailureDetails({
          code: "model_output_invalid",
          parseCode: result._parseError.code,
        }),
        emit,
        close,
      });
      return;
    }
    if (result._qualityError) {
      metadata.incomplete = true;
      recordTrace(metadata, "calling-model", "incomplete");
      await persistStructuredExecutionFailure({
        execution: structuredExecution,
        task: "review",
        details: {
          code: "QUALITY_REVIEW_LOW",
          failureKind: "QUALITY_REVIEW",
          message: "The AI review did not meet the quality checks required for completion.",
          retryable: true,
        },
        emit,
        close,
      });
      return;
    }

    emit({ type: "stage", stage: "persisting-result" });
    recordTrace(metadata, "persisting-result", "completed");
    await structuredExecution.checkpoint("finalizing", "Persisting structured review");
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

    const content = structuredResultContent("review", result as unknown as Record<string, unknown>);
    const messageId = await structuredExecution.persistAssistant({
      content,
      outcome: "SUCCEEDED",
      toolTrace: JSON.stringify([{ kind: "structured_task_result", task: "review" }]),
    });
    const accepted = await structuredExecution.complete({ messageId, content });
    if (!accepted) {
      close();
      return;
    }
    emit({ type: "stage", stage: "completed" });
    recordTrace(metadata, "review", "completed");
    emit({
      type: "task_done",
      task: "review",
      executionId: structuredExecution.started.executionId,
      result: {
        ...redactUserFacingValue(result) as Record<string, unknown>,
        ...auditEnvelope(metadata),
      },
      terminalProjection: await loadStructuredTerminalProjection({
        executionId: structuredExecution.started.executionId,
        sessionId: structuredExecution.started.sessionId,
      }),
    });
    close();
    logger.info({ projectId, provider: effectiveProvider }, "AI code review stream completed");
  } catch (err) {
    logger.error({ err, projectId }, "AI code review stream failed");
    await persistStructuredExecutionFailure({
      execution: structuredExecution,
      task: "review",
      details: structuredFailureDetails(err),
      emit,
      close,
    });
  }
  return;
});

export default router;
