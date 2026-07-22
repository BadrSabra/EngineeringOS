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
  eventsTable,
} from "@workspace/db";
import { eq, desc } from "drizzle-orm";
import {
  buildProjectContext,
  invalidateContextCache,
  chat,
  GroqClientError,
} from "@workspace/ai-orchestrator";
import { recordAudit } from "../../lib/audit.js";
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

  const historyRows = existingSession
    ? await db
        .select()
        .from(aiChatMessagesTable)
        .where(eq(aiChatMessagesTable.sessionId, existingSession.id))
        .orderBy(desc(aiChatMessagesTable.createdAt))
        .limit(10)
    : [];

  const providerResolved = await requireProvider(req.userId, res);
  if (!providerResolved) return;
  const { provider, apiKey } = providerResolved;

  const { validRootPath, fallbackUsed: rootFallbackUsed, originalPath: rootOriginalPath } =
    await resolveRootPath(project.rootPath, projectId);

  const applyProbe = await tryAdvisoryLock(LockNamespace.APPLY, projectId);
  if (!applyProbe.acquired) {
    return res.status(409).json({
      error: "apply_in_progress",
      hint: "File changes are still being written for this project — wait a moment, then retry.",
    });
  }
  await applyProbe.release();

  const projectContext = await buildProjectContext(projectId);
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
    );
    result = chatOut.result;
  } catch (err) {
    if (handleOrchestratorError(err, res, { projectId, operation: "chat" })) return;
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
        content: result.response,
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

  const providerResolved = await requireProvider(req.userId, res);
  if (!providerResolved) return;
  const { provider, apiKey } = providerResolved;

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

  const { validRootPath, fallbackUsed: rootFallbackUsed, originalPath: rootOriginalPath } =
    await resolveRootPath(project.rootPath, projectId);

  sse({ type: "stage", stage: "building-context" });
  const projectContext = await buildProjectContext(projectId);

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
    );
    result = chatOut.result;
  } catch (err) {
    if (err instanceof GroqClientError) {
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
          sse({ ...base, message: "AI provider error.", hint: err.message });
      }
    } else {
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
        content: result.response,
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
      await recordAudit({
        entityType: "project",
        entityId: projectId,
        action: "ai_executed",
        projectId,
        stateBefore: {},
        stateAfter: { filesWritten: appliedPaths },
        correlationId: applyCorrelationId,
      });

      invalidateContextCache(projectId);

      const preview = appliedPaths.slice(0, 3).join(", ") + (appliedPaths.length > 3 ? ` +${appliedPaths.length - 3} more` : "");
      await db.insert(eventsTable).values({
        id: randomUUID(),
        type: "AiChangesApplied",
        projectId,
        severity: failedPaths.length > 0 ? "warning" : "success",
        message: `AI applied ${appliedPaths.length} file change${appliedPaths.length !== 1 ? "s" : ""}: ${preview}${failedPaths.length > 0 ? ` (${failedPaths.length} failed)` : ""}`,
        correlationId: applyCorrelationId,
        payload: { appliedFiles: appliedPaths, failedFiles: failedPaths },
      });
    }

    const allOk = results.every((r) => r.ok);
    return res.status(allOk ? 200 : 207).json({ results });
  } finally {
    await applyLock.release();
  }
});

export default router;
