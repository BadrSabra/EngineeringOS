/**
 * AI chat routes.
 *
 * POST /api/ai/chat
 * POST /api/ai/chat/stream
 * GET  /api/ai/chat/sessions
 * GET  /api/ai/chat/:sessionId/messages
 * POST /api/ai/chat/apply-changes
 */
import { Router } from "express";
import { z } from "zod";
import { randomUUID } from "crypto";
import { promises as fs } from "node:fs";
import path from "node:path";
import { db } from "@workspace/db";
import {
  aiChatSessionsTable,
  aiChatMessagesTable,
  auditLogsTable,
  eventsTable,
} from "@workspace/db";
import { eq, desc } from "drizzle-orm";
import {
  buildProjectContext,
  invalidateContextCache,
  chat,
  GroqClientError,
  recordRequest,
  recordFailure,
  recordSuccess,
  recordInvalidModel,
  recordLatency,
  recordFallbackSuccess,
  enrichContextWithMemories,
  writeSessionMemories,
  classifyRequest,
} from "@workspace/ai-orchestrator";
import type { AgentStep } from "@workspace/ai-orchestrator";
import { logger } from "../../lib/logger.js";
import { resolveRootPath } from "../../lib/rootpath-validator.js";
import { tryAdvisoryLock, LockNamespace } from "../../lib/advisory-lock.js";
import { loadProjectByIdForUser } from "../../middlewares/requireProjectAccess.js";
import { checkProjectRateLimitDb, LLM_RATE_LIMIT } from "../../lib/db-rate-limiter.js";
import {
  requireProvider,
  chatWithFallback,
  handleOrchestratorError,
} from "../../lib/ai-route-helpers.js";

// ── AI-02: Last-resort response sanitizer ────────────────────────────────────
// Even if the AI orchestrator has its own normalisation layer, a JSON envelope
// may slip through (e.g. a provider returns {"response":"...","sources":[...]}).
// This guard sits at the storage + SSE boundary so nothing reaches the DB or
// the client without being cleaned first.
function sanitizeResponseText(raw: string): string {
  if (!raw) return raw;
  const trimmed = raw.trim();
  // Only attempt extraction when the value looks like a JSON object that
  // wraps a string `response` field — not for ordinary markdown/text.
  if (!trimmed.startsWith("{")) return raw;
  try {
    const parsed = JSON.parse(trimmed);
    if (
      parsed !== null &&
      typeof parsed === "object" &&
      !Array.isArray(parsed) &&
      typeof (parsed as Record<string, unknown>)["response"] === "string"
    ) {
      const inner = ((parsed as Record<string, unknown>)["response"] as string).trim();
      logger.warn({ scope: "chat-route", action: "sanitize_envelope", preview: trimmed.slice(0, 120) }, "AI-02: stripped JSON envelope from response before storage");
      return inner || raw;
    }
  } catch {
    // Not valid JSON — leave as-is.
  }
  return raw;
}

// ── Profile → context sections mapping ──────────────────────────────────────
// Maps the classifier's contextProfile to the DB sections buildProjectContext
// should load. Lite turns load the minimum; deep turns load everything.
type ContextSection = "tasks" | "metrics" | "graphEntities" | "graphRelationships" | "events" | "workflows";
function profileContextSections(profile: "chat-lite" | "chat-normal" | "chat-deep" | "chat"): ContextSection[] {
  switch (profile) {
    case "chat-lite":   return ["tasks"];
    case "chat-normal": return ["tasks", "metrics"];
    case "chat-deep":   return ["tasks", "metrics", "graphEntities", "graphRelationships", "events", "workflows"];
    case "chat":        return ["tasks", "metrics"]; // legacy alias → chat-normal
  }
}

const router = Router();

// ── POST /api/ai/chat ────────────────────────────────────────────────────────

router.post("/ai/chat", async (req, res) => {
  const ChatBodySchema = z.object({
    projectId: z.string({ required_error: "projectId is required" }).min(1, "projectId is required"),
    message:   z.string({ required_error: "message is required" }).trim().min(1, "message is required").max(10_000, "message must be ≤ 10 000 characters"),
    sessionId: z.string().uuid("sessionId must be a valid UUID").optional(),
  });
  const chatBody = ChatBodySchema.safeParse(req.body);
  if (!chatBody.success) {
    const issue = chatBody.error.issues[0];
    const raw   = issue?.message ?? "Invalid request body";
    const field = String(issue?.path[0] ?? "");
    const error = raw === "Required" && field ? `${field} is required` : raw;
    return res.status(400).json({ error });
  }
  const { projectId, message, sessionId } = chatBody.data;

  const project = await loadProjectByIdForUser(projectId, req.userId, res);
  if (!project) return;

  const rlChat = await checkProjectRateLimitDb(projectId);
  if (!rlChat.allowed) {
    return res.status(429).json({
      error: `LLM rate limit exceeded — max ${LLM_RATE_LIMIT} calls per minute per project. Retry in ${rlChat.retryAfterSec}s.`,
    });
  }

  const now = new Date();

  let existingSession: (typeof aiChatSessionsTable.$inferSelect) | undefined;
  if (sessionId) {
    const [found] = await db
      .select()
      .from(aiChatSessionsTable)
      .where(eq(aiChatSessionsTable.id, sessionId))
      .limit(1);
    // Prevent cross-project session leakage: reject sessions that belong to a
    // different project even if the UUID is known to the caller.
    if (found && found.projectId !== projectId) {
      return res.status(403).json({ error: "Session does not belong to this project" });
    }
    existingSession = found;
  }

  const { validRootPath, fallbackUsed: rootFallbackUsed, originalPath: rootOriginalPath } =
    await resolveRootPath(project.rootPath, projectId);

  // Classify the request upfront — pure sync, zero cost.
  const chatClassification = classifyRequest(message);

  const historyRows = existingSession
    ? await db
        .select()
        .from(aiChatMessagesTable)
        .where(eq(aiChatMessagesTable.sessionId, existingSession.id))
        .orderBy(desc(aiChatMessagesTable.createdAt))
        .limit(chatClassification.historyDepth)
    : [];

  const providerResolved = await requireProvider(req.userId, res, {
    requireTools: !!validRootPath,
    qualityProfile: validRootPath ? "tool_chat" : "chat",
  });
  if (!providerResolved) return;
  const { provider, apiKey } = providerResolved;

  const applyProbe = await tryAdvisoryLock(LockNamespace.APPLY, projectId);
  if (!applyProbe.acquired) {
    return res.status(409).json({
      error: "apply_in_progress",
      hint: "File changes are still being written for this project — wait a moment, then retry.",
    });
  }
  try {
    const projectContext = await buildProjectContext(projectId, {
      sections: profileContextSections(chatClassification.contextProfile),
    });
    // Enrich context with cross-session memories (outside cache; always fresh).
    // Failure is non-fatal — agent proceeds without memory context.
    await enrichContextWithMemories(projectContext, projectId).catch((err) => {
      logger.warn({ err, projectId }, "memory-enrich: failed to load session memories");
    });
    logger.info({
      scope: "chat-route",
      action: "pre_chat_trace",
      provider,
      sessionId: existingSession?.id ?? sessionId ?? null,
      projectId,
      messageCount: historyRows.length,
      requireTools: !!validRootPath,
      qualityProfile: validRootPath ? "tool_chat" : "chat",
      contextProfile: chatClassification.contextProfile,
    }, "chat: dispatching chatWithFallback");

    let result: Awaited<ReturnType<typeof chat>>;
    try {
      const chatOut = await chatWithFallback(
        req.userId,
        {
          message,
          history: historyRows
            .reverse()
            .filter((m) => m.role === "user" || m.role === "assistant")
            .map((m) => ({ role: m.role as "user" | "assistant", content: m.content })),
          projectContext,
          rootPath: validRootPath,
          projectId,
        },
        { provider, apiKey },
        undefined,
        { requireTools: !!validRootPath, qualityProfile: validRootPath ? "tool_chat" : "chat" },
      );
      result = chatOut.result;
    } catch (err) {
      if (handleOrchestratorError(err, res, { projectId, operation: "chat", provider })) return;
      throw err;
    }

    if (result._parseError) {
      if (!result.response) {
        return res.status(422).json({
          error: "model_output_invalid",
          code: "model_output_invalid",
          hint: "The AI model returned an unexpected response — try rephrasing your message.",
          raw: result._parseError.raw.slice(0, 500),
          parseCode: result._parseError.code,
        });
      }
      logger.warn(
        { parseCode: result._parseError.code, rawPreview: result._parseError.raw.slice(0, 200) },
        "AI parse failure — using fallback response",
      );
    }

    // Chat turns don't modify project data — no cache invalidation needed.
    // Full invalidation happens only in /apply-changes when files are written.

    const msgNow = new Date();
    const sessionIdToUse = existingSession?.id ?? randomUUID();

    // Atomic: session creation (when needed) + user message + assistant message
    // + session timestamp update in one transaction — prevents a half-saved
    // conversation if one insert fails.
    const assistantMsg = await db.transaction(async (tx) => {
      if (!existingSession) {
        const [created] = await tx
          .insert(aiChatSessionsTable)
          .values({
            id: sessionIdToUse,
            projectId,
            title: message.slice(0, 60),
            createdAt: now,
            updatedAt: now,
          })
          .returning();
        if (!created) {
          throw new Error("Failed to create chat session");
        }
      }
      await tx.insert(aiChatMessagesTable).values({
        id: randomUUID(),
        sessionId: sessionIdToUse,
        role: "user",
        content: message,
        createdAt: now,
      });
      const [msg] = await tx
        .insert(aiChatMessagesTable)
        .values({
          id: randomUUID(),
          sessionId: sessionIdToUse,
          role: "assistant",
          content: sanitizeResponseText(result.response),
          sources: JSON.stringify(result.sources),
          createdAt: msgNow,
        })
        .returning();
      await tx
        .update(aiChatSessionsTable)
        .set({ updatedAt: msgNow })
        .where(eq(aiChatSessionsTable.id, sessionIdToUse));
      return msg;
    });

    // Fire-and-forget memory write — must not block the JSON response.
    writeSessionMemories(sessionIdToUse, projectId, result.sources, result.response).catch((err) => {
      logger.warn({ err, projectId }, "memory-write: failed to persist session memories");
    });

    return res.json({
      sessionId: sessionIdToUse,
      message: assistantMsg,
      sources: result.sources,
      pendingChanges: result.pendingChanges ?? [],
      // STORY-04: actual model used (may differ from default if fallback occurred)
      resolvedModel: result.resolvedModel,
      _meta: rootFallbackUsed
        ? { rootPathFallback: { used: true, original: rootOriginalPath } }
        : undefined,
    });
  } finally {
    await applyProbe.release();
  }
});

// ── POST /api/ai/chat/stream ─────────────────────────────────────────────────

router.post("/ai/chat/stream", async (req, res) => {
  const ChatBodySchema = z.object({
    projectId: z.string({ required_error: "projectId is required" }).min(1, "projectId is required"),
    message:   z.string({ required_error: "message is required" }).trim().min(1, "message is required").max(10_000, "message must be ≤ 10 000 characters"),
    sessionId: z.string().uuid("sessionId must be a valid UUID").optional(),
  });
  const chatBody = ChatBodySchema.safeParse(req.body);
  if (!chatBody.success) {
    const issue = chatBody.error.issues[0];
    const raw   = issue?.message ?? "Invalid request body";
    const field = String(issue?.path[0] ?? "");
    const error = raw === "Required" && field ? `${field} is required` : raw;
    return res.status(400).json({ error });
  }
  const { projectId, message, sessionId } = chatBody.data;

  const project = await loadProjectByIdForUser(projectId, req.userId, res);
  if (!project) return;

  const rlChat = await checkProjectRateLimitDb(projectId);
  if (!rlChat.allowed) {
    return res.status(429).json({
      error: `LLM rate limit exceeded — max ${LLM_RATE_LIMIT} calls per minute per project. Retry in ${rlChat.retryAfterSec}s.`,
    });
  }

  const { validRootPath, fallbackUsed: rootFallbackUsed, originalPath: rootOriginalPath } =
    await resolveRootPath(project.rootPath, projectId);

  const providerResolved = await requireProvider(req.userId, res, {
    requireTools: !!validRootPath,
    qualityProfile: validRootPath ? "tool_chat" : "chat",
  });
  if (!providerResolved) return;
  const { provider, apiKey } = providerResolved;

  const applyLock = await tryAdvisoryLock(LockNamespace.APPLY, projectId);
  if (!applyLock.acquired) {
    return res.status(409).json({
      error: "apply_in_progress",
      hint: "File changes are still being written for this project — wait a moment, then retry.",
    });
  }

  try {
    res.setHeader("Content-Type", "text/event-stream");
    res.setHeader("Cache-Control", "no-cache, no-transform");
    res.setHeader("Connection", "keep-alive");
    res.setHeader("X-Accel-Buffering", "no");
    res.flushHeaders();

    function sse(data: Record<string, unknown>): void {
      res.write(`data: ${JSON.stringify(data)}\n\n`);
    }

    const now = new Date();

    let existingSession: (typeof aiChatSessionsTable.$inferSelect) | undefined;
    if (sessionId) {
      const [found] = await db
        .select()
        .from(aiChatSessionsTable)
        .where(eq(aiChatSessionsTable.id, sessionId))
        .limit(1);
      // Prevent cross-project session leakage: reject sessions that belong to a
      // different project even if the UUID is known to the caller.
      if (found && found.projectId !== projectId) {
        sse({ type: "error", code: "forbidden", message: "Session does not belong to this project" });
        res.end();
        return;
      }
      existingSession = found;
    }

    // Classify the request upfront — pure sync, zero cost.
    const streamClassification = classifyRequest(message);

    const historyRows = existingSession
      ? await db
          .select()
          .from(aiChatMessagesTable)
          .where(eq(aiChatMessagesTable.sessionId, existingSession.id))
          .orderBy(desc(aiChatMessagesTable.createdAt))
          .limit(streamClassification.historyDepth)
      : [];

    sse({ type: "stage", stage: "building-context" });
    const projectContext = await buildProjectContext(projectId, {
      sections: profileContextSections(streamClassification.contextProfile),
    });
    // Enrich with cross-session memories (outside cache; always fresh).
    await enrichContextWithMemories(projectContext, projectId).catch((err) => {
      logger.warn({ err, projectId }, "memory-enrich: failed to load session memories (stream)");
    });

    sse({ type: "stage", stage: "calling-model" });

    logger.info({
      scope: "chat-route",
      action: "pre_stream_trace",
      provider,
      sessionId: existingSession?.id ?? sessionId ?? null,
      projectId,
      messageCount: historyRows.length,
      requireTools: !!validRootPath,
      qualityProfile: validRootPath ? "tool_chat" : "chat",
      contextProfile: streamClassification.contextProfile,
    }, "chat/stream: dispatching chatWithFallback");

    // PR-011: record the request and track latency start.
    recordRequest(provider);
    const chatStartMs = Date.now();

    // Collect deltas as they arrive and forward each one as a real-time SSE
    // delta event. The accumulated string is used below for DB persistence.
    let streamedContent = "";
    let streamingActive = false;
    function onDelta(delta: string): void {
      if (!streamingActive) {
        // First token — signal the client to switch from "stage" indicator to
        // the live streaming bubble.
        sse({ type: "stage", stage: "streaming" });
        streamingActive = true;
      }
      streamedContent += delta;
      sse({ type: "delta", delta });
    }
    // GAP-A2: Called by chatWithFallback when the native SSE stream broke
    // mid-flight and the agent is falling back to the non-streaming result.
    // Emit stream_reset so the client discards the partial bubble before the
    // full response arrives in the `done` event.
    function onStreamReset(): void {
      if (streamingActive) {
        logger.warn(
          { scope: "chat-route", action: "stream_reset", provider, streamedBytes: streamedContent.length },
          "SSE stream broke mid-flight — emitting stream_reset to client",
        );
        streamedContent = "";
        sse({ type: "stream_reset" });
      }
    }

    // Emit agent tool-loop steps as SSE events so the client gets real-time
    // visibility into what the agent is doing — which files it reads, which
    // searches it runs, and how many iterations it has taken.
    function onStep(step: AgentStep): void {
      if (step.kind === "tool_call") {
        sse({ type: "tool_call", tool: step.tool, args: step.args, cached: step.cached });
      } else if (step.kind === "tool_result") {
        sse({ type: "tool_result", tool: step.tool, source: step.source, cached: step.cached });
      } else if (step.kind === "iteration_start" && step.iter > 0) {
        // Skip iter 0 to avoid noise before any tools are called.
        sse({ type: "thinking", iter: step.iter, max: step.maxIterations });
      }
    }

    let result: Awaited<ReturnType<typeof chat>>;
    try {
      const chatOut = await chatWithFallback(
        req.userId,
        {
          message,
          history: historyRows
            .reverse()
            .filter((m) => m.role === "user" || m.role === "assistant")
            .map((m) => ({ role: m.role as "user" | "assistant", content: m.content })),
          projectContext,
          rootPath: validRootPath,
          projectId,
        },
        { provider, apiKey },
        onDelta,
        { requireTools: !!validRootPath, qualityProfile: validRootPath ? "tool_chat" : "chat" },
        onStreamReset,
        onStep,
      );
      result = chatOut.result;
      // PR-05/PR-011: record successful call latency and health.
      const callLatency = Date.now() - chatStartMs;
      const effectiveProvider = chatOut.effectiveProvider ?? provider;
      recordLatency(effectiveProvider, callLatency);
      recordSuccess(effectiveProvider);
      // effectiveProvider differs from `provider` when fallback occurred
      if (chatOut.effectiveProvider && chatOut.effectiveProvider !== provider) {
        recordFallbackSuccess(provider);
      }
    } catch (err) {
      // PR-011: record failure metrics before emitting the SSE error.
      recordFailure(provider);
      if (err instanceof GroqClientError) {
        if (err.code === "MODEL_NOT_FOUND" || err.code === "MODEL_UNAVAILABLE") {
          recordInvalidModel(provider);
        }
        logger.error(
          { code: err.code, message: err.message, provider,
            providerStatus: err.providerStatus, providerModel: err.providerModel },
          "chat stream: all providers failed",
        );

        // PR-009: structured error with provider context so the dashboard can
        // show actionable diagnostics (model name, HTTP status, suggestedFix).
        const providerCtx = err.toProviderContext() ?? {};
        const base: Record<string, unknown> = {
          type: "error",
          code: err.code,
          // PR-007: surface provider context on the wire.
          ...(Object.keys(providerCtx).length > 0 ? { providerContext: providerCtx } : {}),
        };

        switch (err.code) {
          case "RATE_LIMITED":
            sse({
              ...base,
              message: "Rate limit reached on all configured AI providers — wait 30–60 seconds and retry.",
              retryable: true,
              suggestedFix: "Wait before retrying.",
            });
            break;
          case "QUOTA":
            sse({
              ...base,
              message: "AI provider billing quota or credits are exhausted.",
              retryable: false,
              suggestedFix: "Check your OpenRouter/provider account balance and top up credits.",
            });
            break;
          case "AUTH_ERROR":
            sse({
              ...base,
              message: "AI provider key is invalid or unauthorized.",
              retryable: false,
              suggestedFix: "Delete your current provider key and save a valid one in Settings.",
            });
            break;
          case "MODEL_NOT_FOUND":
            sse({
              ...base,
              message: `All AI model fallbacks exhausted${err.providerModel ? ` (last tried: ${err.providerModel})` : ""} — no model was available.`,
              retryable: false,
              suggestedFix: "Check your OpenRouter API key and model availability on openrouter.ai/models.",
            });
            break;
          case "PLAN_RESTRICTED":
            sse({
              ...base,
              message: "The selected AI model requires a paid plan or credit balance — all free-tier fallbacks failed.",
              retryable: false,
              suggestedFix: "Add credit balance to your OpenRouter account, or save a Groq/Gemini API key as a free fallback.",
            });
            break;
          case "MODEL_UNAVAILABLE":
            sse({
              ...base,
              message: `AI model temporarily unavailable${err.providerModel ? ` (${err.providerModel})` : ""} — all fallbacks also unavailable.`,
              retryable: true,
              suggestedFix: "Try again in a few minutes; the model may be back online.",
            });
            break;
          case "TIMEOUT":
          case "NETWORK_ERROR":
            sse({
              ...base,
              message: "AI provider is temporarily unreachable — try again in a moment.",
              retryable: true,
              suggestedFix: "Check your network connection and retry.",
            });
            break;
          default:
            sse({ ...base, message: `AI provider error: ${err.message.slice(0, 200)}`, retryable: false });
        }
      } else {
        logger.error({ err }, "chat stream: unexpected non-GroqClientError");
        sse({ type: "error", code: "unknown", message: err instanceof Error ? err.message : String(err) });
      }
      res.end();
      return;
    }

    if (result._parseError) {
      if (!result.response) {
        sse({
          type: "error",
          code: "model_output_invalid",
          message: "The AI model returned an unexpected response — try rephrasing your message.",
          raw: result._parseError.raw.slice(0, 500),
          parseCode: result._parseError.code,
        });
        res.end();
        return;
      }
      logger.warn(
        { parseCode: result._parseError.code, rawPreview: result._parseError.raw.slice(0, 200) },
        "AI parse failure — using fallback response",
      );
    }

    invalidateContextCache(projectId);

    // BUG-6: log language anomalies in AI responses.
    // If a response to an Arabic message contains Thai-range characters
    // (U+0E00–U+0E7F) or other unexpected scripts, record it for monitoring.
    // This catches hallucinations like "ภาษته" appearing inside Arabic prose.
    (() => {
      const hasArabic = /[\u0600-\u06FF]/.test(message);
      const thaiBidiRange = /[\u0E00-\u0E7F]/.test(result.response);
      if (hasArabic && thaiBidiRange) {
        logger.warn(
          { scope: "chat-route", action: "language_anomaly", projectId, provider,
            responsePreview: result.response.slice(0, 200) },
          "AI-06: response to Arabic message contains Thai-range characters — possible model hallucination",
        );
      }
    })();

    const msgNow = new Date();
    const sessionIdToUse = existingSession?.id ?? randomUUID();

    // Atomic: session creation (when needed) + user message + assistant message
    // + session timestamp update in one transaction — prevents a half-saved
    // conversation if one insert fails.
    const assistantMsg = await db.transaction(async (tx) => {
      if (!existingSession) {
        const [created] = await tx
          .insert(aiChatSessionsTable)
          .values({
            id: sessionIdToUse,
            projectId,
            // BUG-5 fix: don't use a bare greeting as the session title.
            // "مرحبا", "Hello", "Hi" etc. give no context in the sessions list.
            // Use the first 60 chars only when the opener is substantive.
            title: (() => {
              const trimmed = message.trim();
              const isGreeting = /^(مرحبا|مرحبً?ا|أهلاً?|سلام|هلا|hi|hello|hey|greetings|سلاماً?|صباح الخير|مساء الخير|good (morning|afternoon|evening))[\s!.،,]*$/i.test(trimmed);
              return (!isGreeting && trimmed.length > 10)
                ? trimmed.slice(0, 60)
                : `Session ${now.toISOString().slice(0, 16).replace("T", " ")}`;
            })(),
            createdAt: now,
            updatedAt: now,
          })
          .returning();
        if (!created) {
          throw new Error("Failed to create chat session");
        }
      }
      await tx.insert(aiChatMessagesTable).values({
        id: randomUUID(),
        sessionId: sessionIdToUse,
        role: "user",
        content: message,
        createdAt: now,
      });
      const [msg] = await tx
        .insert(aiChatMessagesTable)
        .values({
          id: randomUUID(),
          sessionId: sessionIdToUse,
          role: "assistant",
          content: sanitizeResponseText(result.response),
          sources: JSON.stringify(result.sources),
          createdAt: msgNow,
        })
        .returning();
      await tx
        .update(aiChatSessionsTable)
        .set({ updatedAt: msgNow })
        .where(eq(aiChatSessionsTable.id, sessionIdToUse));
      return msg;
    });

    // Fire-and-forget memory write — must not block the SSE done event.
    writeSessionMemories(sessionIdToUse, projectId, result.sources, result.response).catch((err) => {
      logger.warn({ err, projectId }, "memory-write: failed to persist session memories (stream)");
    });

    // PR-010: surface latency and model info in done event.
    const chatLatencyMs = Date.now() - chatStartMs;

    sse({
      type: "done",
      sessionId: sessionIdToUse,
      message: assistantMsg,
      sources: result.sources,
      pendingChanges: result.pendingChanges ?? [],
      // STORY-04: surface the actual model used so the UI can display it accurately
      resolvedModel: result.resolvedModel,
      // PR-010: telemetry fields for client observability
      telemetry: {
        latencyMs: chatLatencyMs,
        provider,
      },
      _meta: rootFallbackUsed
        ? { rootPathFallback: { used: true, original: rootOriginalPath } }
        : undefined,
    });
    res.end();
    return;
  } finally {
    await applyLock.release();
  }
});

// ── GET /api/ai/chat/sessions ────────────────────────────────────────────────

router.get("/ai/chat/sessions", async (req, res) => {
  const project = await loadProjectByIdForUser(
    typeof req.query.projectId === "string" ? req.query.projectId : undefined,
    req.userId,
    res,
  );
  if (!project) return;

  const sessions = await db
    .select()
    .from(aiChatSessionsTable)
    .where(eq(aiChatSessionsTable.projectId, project.id))
    .orderBy(desc(aiChatSessionsTable.updatedAt))
    .limit(20);

  return res.json(sessions);
});

// ── GET /api/ai/chat/:sessionId/messages ─────────────────────────────────────

router.get("/ai/chat/:sessionId/messages", async (req, res) => {
  const { sessionId } = req.params;

  const sessionRows = await db
    .select()
    .from(aiChatSessionsTable)
    .where(eq(aiChatSessionsTable.id, sessionId))
    .limit(1);
  const session = sessionRows[0];
  if (!session) return res.json([]);

  if (session.projectId) {
    const ownerProject = await loadProjectByIdForUser(session.projectId, req.userId, res);
    if (!ownerProject) return;
  }

  const messages = await db
    .select()
    .from(aiChatMessagesTable)
    .where(eq(aiChatMessagesTable.sessionId, sessionId))
    .orderBy(aiChatMessagesTable.createdAt);

  return res.json(messages);
});

// ── POST /api/ai/chat/apply-changes ─────────────────────────────────────────

router.post("/ai/chat/apply-changes", async (req, res) => {
  const ChangeItemSchema = z.object({
    path:         z.string().min(1, "each change must have a non-empty path"),
    absolutePath: z.string()
                    .min(1, "each change must have a non-empty absolutePath")
                    .refine((v) => path.isAbsolute(v), "absolutePath must be an absolute path"),
    newContent:   z.string(),
  });
  const ApplyChangesBodySchema = z.object({
    projectId: z.string({ required_error: "projectId is required" }).min(1, "projectId is required"),
    changes:   z.array(ChangeItemSchema)
                 .min(1, "changes must be a non-empty array")
                 .max(50, "too many changes — max 50 per request"),
  });
  const applyBody = ApplyChangesBodySchema.safeParse(req.body);
  if (!applyBody.success) {
    const issue = applyBody.error.issues[0];
    const raw   = issue?.message ?? "Invalid request body";
    const field = String(issue?.path[0] ?? "");
    const error = raw === "Required" && field ? `${field} is required` : raw;
    return res.status(400).json({ error });
  }
  const { changes, projectId } = applyBody.data;

  const project = await loadProjectByIdForUser(projectId, req.userId, res);
  if (!project) return;

  const resolvedRoot = path.resolve(project.rootPath);

  const applyLock = await tryAdvisoryLock(LockNamespace.APPLY, projectId);
  if (!applyLock.acquired) {
    return res.status(409).json({
      error: "apply_in_progress",
      hint: "An apply operation is already in progress for this project — wait for it to complete before starting another.",
    });
  }

  let results: Array<{ path: string; ok: boolean; error?: string }>;
  try {
    results = [];

    for (const change of changes) {
      const BLOCKED_WRITE_EXTENSIONS =
        /(?:^|[/\\])\.env(?:\.|$)|\.(sh|bash|zsh|fish|ps1|bat|cmd|pem|key|pfx|p12|crt|cer|der|pub|rsa|dsa|htpasswd)$/i;
      // Check BOTH the client-supplied path and absolutePath — a mismatch between
      // the two fields can bypass a check on path alone.
      if (BLOCKED_WRITE_EXTENSIONS.test(change.path) || BLOCKED_WRITE_EXTENSIONS.test(change.absolutePath)) {
        results.push({
          path: change.path,
          ok: false,
          error: "File type is classified as sensitive (secrets, credentials, or executable scripts) — apply manually.",
        });
        continue;
      }

      const resolved = path.resolve(change.absolutePath);
      if (resolved !== resolvedRoot && !resolved.startsWith(resolvedRoot + path.sep)) {
        results.push({ path: change.path, ok: false, error: "Path is outside the project root" });
        continue;
      }
      try {
        // Create parent dirs then realpath them to detect symlink escape — path.resolve()
        // is purely lexical and does not follow symlinks.
        const parentDir = path.dirname(resolved);
        await fs.mkdir(parentDir, { recursive: true });
        const realParent = await fs.realpath(parentDir);
        const realResolved = path.join(realParent, path.basename(resolved));
        if (realResolved !== resolvedRoot && !realResolved.startsWith(resolvedRoot + path.sep)) {
          results.push({ path: change.path, ok: false, error: "Path is outside the project root" });
          continue;
        }
        await fs.writeFile(realResolved, change.newContent, "utf-8");
        results.push({ path: change.path, ok: true });
      } catch (e) {
        results.push({ path: change.path, ok: false, error: e instanceof Error ? e.message : String(e) });
      }
    }

    const appliedPaths = results.filter((r) => r.ok).map((r) => r.path);
    const failedPaths  = results.filter((r) => !r.ok).map((r) => r.path);
    const applyCorrelationId = randomUUID();

    if (appliedPaths.length > 0) {
      invalidateContextCache(projectId);
    }

    const preview = appliedPaths.length > 0
      ? appliedPaths.slice(0, 3).join(", ") + (appliedPaths.length > 3 ? ` +${appliedPaths.length - 3} more` : "")
      : failedPaths.slice(0, 3).join(", ") + (failedPaths.length > 3 ? ` +${failedPaths.length - 3} more` : "");
    await db.transaction(async (tx) => {
      await tx.insert(auditLogsTable).values({
        id: applyCorrelationId,
        entityType: "project",
        entityId: projectId,
        action: "ai_executed",
        projectId,
        actor: req.userId,
        stateBefore: {},
        stateAfter: { filesWritten: appliedPaths, failedFiles: failedPaths },
        correlationId: applyCorrelationId,
      });
      await tx.insert(eventsTable).values({
        id: randomUUID(),
        type: "AiChangesApplied",
        projectId,
        severity: appliedPaths.length > 0 ? (failedPaths.length > 0 ? "warning" : "success") : "warning",
        message: appliedPaths.length > 0
          ? `AI applied ${appliedPaths.length} file change${appliedPaths.length !== 1 ? "s" : ""}: ${preview}${failedPaths.length > 0 ? ` (${failedPaths.length} failed)` : ""}`
          : `AI apply made no writable changes: ${preview || "none"}${failedPaths.length > 0 ? ` (${failedPaths.length} failed)` : ""}`,
        correlationId: applyCorrelationId,
        payload: { appliedFiles: appliedPaths, failedFiles: failedPaths },
      });
    });

    const allOk = results.every((r) => r.ok);
    return res.status(allOk ? 200 : 207).json({ results });
  } finally {
    await applyLock.release();
  }
});

export default router;
