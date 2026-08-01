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
} from "@workspace/ai-orchestrator";
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

  const historyRows = existingSession
    ? await db
        .select()
        .from(aiChatMessagesTable)
        .where(eq(aiChatMessagesTable.sessionId, existingSession.id))
        .orderBy(desc(aiChatMessagesTable.createdAt))
        .limit(10)
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
      sections: ["tasks", "metrics", "graphEntities", "graphRelationships", "events", "workflows"],
    });
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

    invalidateContextCache(projectId);

    const msgNow = new Date();
    let session: typeof aiChatSessionsTable.$inferSelect;
    if (existingSession) {
      session = existingSession;
    } else {
      const [created] = await db
        .insert(aiChatSessionsTable)
        .values({
          id: randomUUID(),
          projectId,
          title: message.slice(0, 60),
          createdAt: now,
          updatedAt: now,
        })
        .returning();
      session = created;
    }

    // Atomic: user message + assistant message + session timestamp update in one
    // transaction — prevents a half-saved conversation if one insert fails.
    const assistantMsg = await db.transaction(async (tx) => {
      await tx.insert(aiChatMessagesTable).values({
        id: randomUUID(),
        sessionId: session.id,
        role: "user",
        content: message,
        createdAt: now,
      });
      const [msg] = await tx
        .insert(aiChatMessagesTable)
        .values({
          id: randomUUID(),
          sessionId: session.id,
          role: "assistant",
          content: sanitizeResponseText(result.response),
          sources: JSON.stringify(result.sources),
          createdAt: msgNow,
        })
        .returning();
      await tx
        .update(aiChatSessionsTable)
        .set({ updatedAt: msgNow })
        .where(eq(aiChatSessionsTable.id, session.id));
      return msg;
    });

    return res.json({
      sessionId: session.id,
      message: assistantMsg,
      sources: result.sources,
      pendingChanges: result.pendingChanges ?? [],
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

    const historyRows = existingSession
      ? await db
          .select()
          .from(aiChatMessagesTable)
          .where(eq(aiChatMessagesTable.sessionId, existingSession.id))
          .orderBy(desc(aiChatMessagesTable.createdAt))
          .limit(10)
      : [];

    sse({ type: "stage", stage: "building-context" });
    const projectContext = await buildProjectContext(projectId, {
      sections: ["tasks", "metrics", "graphEntities", "graphRelationships", "events", "workflows"],
    });

    sse({ type: "stage", stage: "calling-model" });

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
        },
        { provider, apiKey },
        onDelta,
        { requireTools: !!validRootPath, qualityProfile: validRootPath ? "tool_chat" : "chat" },
        onStreamReset,
      );
      result = chatOut.result;
    } catch (err) {
      if (err instanceof GroqClientError) {
        logger.error(
          { code: err.code, message: err.message, provider },
          "chat stream: all providers failed",
        );
        const base = { type: "error", code: err.code };
        switch (err.code) {
          case "RATE_LIMITED":
            sse({ ...base, message: "Rate limit reached on all configured AI providers — wait 30–60 seconds and retry.", hint: err.message });
            break;
          case "AUTH_ERROR":
            sse({ ...base, message: "AI provider key is invalid or unauthorized.", hint: "Delete your current key and save a valid one." });
            break;
          case "TIMEOUT":
          case "NETWORK_ERROR":
            sse({ ...base, message: "AI provider is temporarily unreachable — try again in a moment." });
            break;
          default:
            sse({ ...base, message: `AI provider error: ${err.message.slice(0, 200)}`, hint: err.message });
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
    let session: typeof aiChatSessionsTable.$inferSelect;
    if (existingSession) {
      session = existingSession;
    } else {
      const [created] = await db
        .insert(aiChatSessionsTable)
        .values({
          id: randomUUID(),
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
      session = created;
    }

    // Atomic: user message + assistant message + session timestamp update in one
    // transaction — prevents a half-saved conversation if one insert fails.
    const assistantMsg = await db.transaction(async (tx) => {
      await tx.insert(aiChatMessagesTable).values({
        id: randomUUID(),
        sessionId: session.id,
        role: "user",
        content: message,
        createdAt: now,
      });
      const [msg] = await tx
        .insert(aiChatMessagesTable)
        .values({
          id: randomUUID(),
          sessionId: session.id,
          role: "assistant",
          content: sanitizeResponseText(result.response),
          sources: JSON.stringify(result.sources),
          createdAt: msgNow,
        })
        .returning();
      await tx
        .update(aiChatSessionsTable)
        .set({ updatedAt: msgNow })
        .where(eq(aiChatSessionsTable.id, session.id));
      return msg;
    });

    sse({
      type: "done",
      sessionId: session.id,
      message: assistantMsg,
      sources: result.sources,
      pendingChanges: result.pendingChanges ?? [],
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
