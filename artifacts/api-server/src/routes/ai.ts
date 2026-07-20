import { Router } from "express";
import { z } from "zod";
import { randomUUID } from "crypto";
import { promises as fs } from "node:fs";
import path from "node:path";
import { db } from "@workspace/db";
import {
  aiChatSessionsTable,
  aiChatMessagesTable,
  aiProviderCredentialsTable,
  projectsTable,
  tasksTable,
  workflowsTable,
  workflowExecutionsTable,
  eventsTable,
  taskLogsTable,
} from "@workspace/db";
import { eq, desc, and } from "drizzle-orm";
import {
  buildProjectContext,
  invalidateContextCache,
  chat,
  executeTask,
  analyzeScan,
  reviewCode,
  orchestrateWorkflow,
  GroqClientError,
  parseWorkflowPhases,
} from "@workspace/ai-orchestrator";
import { recordAudit } from "../lib/audit.js";
import { logger } from "../lib/logger.js";
import { encryptApiKey, decryptApiKey } from "../lib/credentials-crypto.js";
import { heavyJobQueue } from "../lib/job-queue.js";
import {
  loadProjectByIdForUser,
  requireProjectAccess,
} from "../middlewares/requireProjectAccess.js";

const router = Router();

// Per-workflow in-memory orchestration lock. Prevents two concurrent
// POST /orchestrate calls from producing conflicting phase decisions for the
// same workflow. Note: process-local only — a multi-instance deployment needs
// a DB-level advisory lock or a distributed mutex instead.
const _orchestratingWorkflows = new Set<string>();

// Per-project apply lock (R-01 fix). Held for the duration of an
// apply-changes write so that concurrent chat requests cannot read a
// partially-written context snapshot.  Process-local only — a multi-instance
// deployment would need a distributed mutex or a DB advisory lock.
const _applyingProjects = new Set<string>();

// ── Per-project LLM rate limiting ─────────────────────────────────────────────
// Sliding-window guard: at most LLM_RATE_LIMIT calls per project per minute.
// Prevents a single project from exhausting the shared Groq quota.
// Note: process-local only; a multi-instance deployment needs a shared store
// (Redis etc.) for accurate cross-instance limiting.
const LLM_RATE_LIMIT = 20;
const LLM_RATE_WINDOW_MS = 60_000; // 1 minute

const _projectCallTimestamps = new Map<string, number[]>();

// Periodically sweep entries that have no live timestamps so the Map doesn't
// accumulate one entry per project forever in a long-running server.
// .unref() ensures the timer doesn't prevent a clean process exit.
setInterval(() => {
  const cutoff = Date.now() - LLM_RATE_WINDOW_MS;
  for (const [projectId, timestamps] of _projectCallTimestamps) {
    const live = timestamps.filter((t) => t > cutoff);
    if (live.length === 0) {
      _projectCallTimestamps.delete(projectId);
    } else {
      _projectCallTimestamps.set(projectId, live);
    }
  }
}, 5 * 60_000 /* 5 min */).unref();

function checkProjectRateLimit(projectId: string): { allowed: boolean; retryAfterSec?: number } {
  const now = Date.now();
  const cutoff = now - LLM_RATE_WINDOW_MS;
  const prev = (_projectCallTimestamps.get(projectId) ?? []).filter((t) => t > cutoff);
  if (prev.length >= LLM_RATE_LIMIT) {
    const oldest = prev[0]!;
    return { allowed: false, retryAfterSec: Math.ceil((oldest + LLM_RATE_WINDOW_MS - now) / 1_000) };
  }
  prev.push(now);
  _projectCallTimestamps.set(projectId, prev);
  return { allowed: true };
}

/**
 * Maps GroqClientError codes to typed HTTP responses so callers receive a
 * structured error body instead of a generic 500. Returns true when a response
 * was sent; false when the error is not a known provider error (caller should
 * rethrow to the central error handler).
 */
function handleOrchestratorError(
  err: unknown,
  res: import("express").Response,
  /** D-04: optional context so failures are emitted to eventsTable and become
   *  visible in the AI's recentEvents on the next request. */
  ctx?: { projectId?: string; operation?: string },
): boolean {
  if (!(err instanceof GroqClientError)) return false;

  // Emit a DB event for every operational failure so the AI's context reflects
  // that an attempt was made and failed.  Previously a 429 or AUTH_ERROR was
  // returned to the client with no eventsTable write, leaving the AI with no
  // awareness of the failure pattern on the next turn.
  if (ctx?.projectId) {
    void db
      .insert(eventsTable)
      .values({
        id: randomUUID(),
        type: "AiOrchestratorError",
        projectId: ctx.projectId,
        severity: "error",
        message: `AI request failed [${err.code}]${ctx.operation ? ` during ${ctx.operation}` : ""}: ${err.message.slice(0, 180)}`,
      })
      .catch(() => {}); // fire-and-forget; response is already being sent
  }

  const base = { code: err.code };
  switch (err.code) {
    case "TIMEOUT":
    case "NETWORK_ERROR":
      res.status(503).json({ ...base, error: "AI provider unreachable — try again in a moment." });
      return true;
    // إصلاح #1: AUTH_ERROR يُعاد كـ401 مع رسالة توجيهية واضحة بدل 502 عام.
    // المستخدم يحتاج أن يعرف تحديداً أن المفتاح خاطئ وليس مشكلة عابرة.
    case "AUTH_ERROR":
      res.status(401).json({
        ...base,
        error: "Groq API key is invalid or unauthorized.",
        hint: "Delete your current key and save a valid one from console.groq.com.",
      });
      return true;
    // إصلاح #4: RATE_LIMITED → 429 مع نصيحة الانتظار. SERVER_ERROR → 502 مع رسالة مؤقتة.
    case "RATE_LIMITED":
      res.status(429).json({
        ...base,
        error: "Groq rate limit reached — please wait a moment before retrying.",
        hint: "You've exceeded your Groq API quota. Wait 30–60 seconds or upgrade your Groq plan at console.groq.com.",
      });
      return true;
    case "SERVER_ERROR":
      res.status(502).json({
        ...base,
        error: "Groq server error — this is a temporary infrastructure issue.",
        hint: "Try again in a moment. If it persists, check status.groq.com.",
      });
      return true;
    case "NON_200":
      res.status(502).json({ ...base, error: "AI provider returned an unexpected error.", hint: "Check your Groq API key or try again." });
      return true;
    case "EMPTY_RESPONSE":
      res.status(502).json({ ...base, error: "AI provider returned an empty response.", hint: "This may be a transient Groq issue — try again." });
      return true;
    case "INVALID_CONFIG":
      res.status(422).json({ ...base, error: "AI provider configuration is invalid.", hint: "Re-save your Groq API key." });
      return true;
    default:
      res.status(502).json({ ...base, error: "AI provider error.", hint: err.message });
      return true;
  }
}

// ── Groq API Key Management ──────────────────────────────────────────────────

/**
 * Resolve the Groq API key to use for a given user.
 *
 * Resolution order:
 *   1. User's own saved key (decrypted from DB).
 *   2. Server-wide fallback: process.env.GROQ_API_KEY.
 *   3. undefined — caller MUST return 428 to the client.
 */
async function resolveGroqApiKey(userId: string): Promise<string | undefined> {
  const [row] = await db
    .select()
    .from(aiProviderCredentialsTable)
    .where(
      and(
        eq(aiProviderCredentialsTable.ownerId, userId),
        eq(aiProviderCredentialsTable.provider, "groq"),
      ),
    )
    .limit(1);

  if (row) {
    try {
      return decryptApiKey(row.encryptedApiKey);
    } catch (err) {
      logger.error({ err, ownerId: userId }, "Failed to decrypt stored Groq API key — falling back to env");
    }
  }

  return process.env.GROQ_API_KEY || undefined;
}

/**
 * Resolve the DeepSeek API key for a given user (DB only, no env fallback).
 */
async function resolveDeepSeekApiKey(userId: string): Promise<string | undefined> {
  const [row] = await db
    .select()
    .from(aiProviderCredentialsTable)
    .where(
      and(
        eq(aiProviderCredentialsTable.ownerId, userId),
        eq(aiProviderCredentialsTable.provider, "deepseek"),
      ),
    )
    .limit(1);

  if (row) {
    try {
      return decryptApiKey(row.encryptedApiKey);
    } catch (err) {
      logger.error({ err, ownerId: userId }, "Failed to decrypt stored DeepSeek API key");
    }
  }

  return undefined;
}

/**
 * Resolve which AI provider to use for a request.
 *
 * Priority: DeepSeek (if key saved) → Groq (key or env fallback) → undefined.
 * DeepSeek is preferred when configured because it is the higher-quality option.
 */
async function resolveProvider(
  userId: string,
): Promise<{ provider: "groq" | "deepseek"; apiKey: string } | undefined> {
  const deepseekKey = await resolveDeepSeekApiKey(userId);
  if (deepseekKey) return { provider: "deepseek", apiKey: deepseekKey };

  const groqKey = await resolveGroqApiKey(userId);
  if (groqKey) return { provider: "groq", apiKey: groqKey };

  return undefined;
}

/**
 * Rejects the request with 428 if no provider key can be resolved.
 * Returns { provider, apiKey } on success, null on failure (response already sent).
 */
async function requireProvider(
  userId: string,
  res: import("express").Response,
): Promise<{ provider: "groq" | "deepseek"; apiKey: string } | null> {
  const resolved = await resolveProvider(userId);
  if (!resolved) {
    res.status(428).json({
      error: "AI provider not configured",
      hint: "Save a DeepSeek API key via PUT /api/ai/deepseek-key or a Groq API key via PUT /api/ai/groq-key.",
    });
    return null;
  }
  return resolved;
}

/**
 * Rejects the request with 428 if no Groq API key can be resolved.
 * Kept for backward-compatibility with non-chat routes that only support Groq.
 */
async function requireGroqApiKey(
  userId: string,
  res: import("express").Response,
): Promise<string | null> {
  const key = await resolveGroqApiKey(userId);
  if (!key) {
    res.status(428).json({
      error: "AI provider not configured",
      hint: "Save a Groq API key via PUT /api/ai/groq-key or ask your administrator to set GROQ_API_KEY on the server.",
    });
    return null;
  }
  return key;
}

// ── DeepSeek key management ──────────────────────────────────────────────────

/** GET /api/ai/deepseek-key — return DeepSeek key status (never the key itself) */
router.get("/ai/deepseek-key", async (req, res) => {
  const [row] = await db
    .select({ last4: aiProviderCredentialsTable.last4, updatedAt: aiProviderCredentialsTable.updatedAt })
    .from(aiProviderCredentialsTable)
    .where(and(
      eq(aiProviderCredentialsTable.ownerId, req.userId),
      eq(aiProviderCredentialsTable.provider, "deepseek"),
    ))
    .limit(1);
  if (!row) return res.json({ configured: false, last4: null, updatedAt: null });
  return res.json({ configured: true, last4: row.last4, updatedAt: row.updatedAt });
});

/** PUT /api/ai/deepseek-key — save or update the user's DeepSeek API key */
router.put("/ai/deepseek-key", async (req, res) => {
  const { apiKey } = req.body as { apiKey?: string };
  if (!apiKey || typeof apiKey !== "string" || apiKey.trim().length < 10) {
    return res.status(400).json({ error: "apiKey must be at least 10 characters" });
  }
  const trimmed = apiKey.trim();
  const last4 = trimmed.slice(-4);
  let encryptedApiKey: string;
  try {
    encryptedApiKey = encryptApiKey(trimmed);
  } catch (err) {
    logger.error({ err }, "DeepSeek key encryption failed");
    return res.status(500).json({ error: "Key storage unavailable — encryption not configured" });
  }
  const now = new Date();
  await db
    .insert(aiProviderCredentialsTable)
    .values({ id: randomUUID(), ownerId: req.userId, provider: "deepseek", encryptedApiKey, last4, createdAt: now, updatedAt: now })
    .onConflictDoUpdate({
      target: [aiProviderCredentialsTable.ownerId, aiProviderCredentialsTable.provider],
      set: { encryptedApiKey, last4, updatedAt: now },
    });
  return res.json({ configured: true, last4, updatedAt: now });
});

/** DELETE /api/ai/deepseek-key — remove the user's saved DeepSeek API key */
router.delete("/ai/deepseek-key", async (req, res) => {
  await db
    .delete(aiProviderCredentialsTable)
    .where(and(
      eq(aiProviderCredentialsTable.ownerId, req.userId),
      eq(aiProviderCredentialsTable.provider, "deepseek"),
    ));
  return res.json({ configured: false });
});

/** GET /api/ai/active-provider — which provider will be used for this user */
router.get("/ai/active-provider", async (req, res) => {
  const resolved = await resolveProvider(req.userId);
  if (!resolved) return res.json({ provider: null, configured: false });
  return res.json({ provider: resolved.provider, configured: true });
});

// ── Groq key management ──────────────────────────────────────────────────────

/** GET /api/ai/groq-key — return key status (never the key itself) */
router.get("/ai/groq-key", async (req, res) => {
  const [row] = await db
    .select({
      last4: aiProviderCredentialsTable.last4,
      updatedAt: aiProviderCredentialsTable.updatedAt,
    })
    .from(aiProviderCredentialsTable)
    .where(
      and(
        eq(aiProviderCredentialsTable.ownerId, req.userId),
        eq(aiProviderCredentialsTable.provider, "groq"),
      ),
    )
    .limit(1);

  if (!row) {
    return res.json({ configured: false, last4: null, updatedAt: null });
  }
  return res.json({ configured: true, last4: row.last4, updatedAt: row.updatedAt });
});

/** PUT /api/ai/groq-key — save or update the user's Groq API key */
router.put("/ai/groq-key", async (req, res) => {
  const { apiKey } = req.body as { apiKey?: string };

  if (!apiKey || typeof apiKey !== "string" || apiKey.trim().length < 10) {
    return res.status(400).json({ error: "apiKey must be at least 10 characters" });
  }

  const trimmed = apiKey.trim();
  const last4 = trimmed.slice(-4);
  let encryptedApiKey: string;

  try {
    encryptedApiKey = encryptApiKey(trimmed);
  } catch (err) {
    logger.error({ err }, "Groq key encryption failed");
    return res.status(500).json({ error: "Key storage unavailable — encryption not configured" });
  }

  const now = new Date();

  await db
    .insert(aiProviderCredentialsTable)
    .values({
      id: randomUUID(),
      ownerId: req.userId,
      provider: "groq",
      encryptedApiKey,
      last4,
      createdAt: now,
      updatedAt: now,
    })
    .onConflictDoUpdate({
      target: [aiProviderCredentialsTable.ownerId, aiProviderCredentialsTable.provider],
      set: { encryptedApiKey, last4, updatedAt: now },
    });

  return res.json({ configured: true, last4, updatedAt: now });
});

/** DELETE /api/ai/groq-key — remove the user's saved Groq API key */
router.delete("/ai/groq-key", async (req, res) => {
  await db
    .delete(aiProviderCredentialsTable)
    .where(
      and(
        eq(aiProviderCredentialsTable.ownerId, req.userId),
        eq(aiProviderCredentialsTable.provider, "groq"),
      ),
    );

  return res.json({ configured: false });
});

// ── Chat ────────────────────────────────────────────────────────────────────

/** POST /api/ai/chat — send a message and get an AI response */
router.post("/ai/chat", async (req, res) => {
  const ChatBodySchema = z.object({
    projectId: z.string({ required_error: "projectId is required" }).min(1, "projectId is required"),
    // .trim() collapses blank-only strings to "" before min(1) validation so
    // messages that are only whitespace are rejected with 400, not forwarded.
    message:   z.string({ required_error: "message is required" }).trim().min(1, "message is required").max(10_000, "message must be ≤ 10 000 characters"),
    sessionId: z.string().uuid("sessionId must be a valid UUID").optional(),
  });
  const chatBody = ChatBodySchema.safeParse(req.body);
  if (!chatBody.success) {
    const issue = chatBody.error.issues[0];
    // Zod emits "Required" for missing fields; replace with the field-aware
    // message so clients know exactly which field is absent.
    const raw   = issue?.message ?? "Invalid request body";
    const field = String(issue?.path[0] ?? "");
    const error = raw === "Required" && field ? `${field} is required` : raw;
    return res.status(400).json({ error });
  }
  const { projectId, message, sessionId } = chatBody.data;

  // Verify ownership of the project
  const project = await loadProjectByIdForUser(projectId, req.userId, res);
  if (!project) return;

  const rlChat = checkProjectRateLimit(projectId);
  if (!rlChat.allowed) {
    return res.status(429).json({
      error: `LLM rate limit exceeded — max ${LLM_RATE_LIMIT} calls per minute per project. Retry in ${rlChat.retryAfterSec}s.`,
    });
  }

  const now = new Date();

  // Gap-9 fix: session creation is deferred to after the Groq call succeeds.
  // Previously the session was created here unconditionally, which left empty
  // orphaned sessions (a session with a question but no answer) whenever Groq
  // returned a 429/502/401 error. Now we only look up an existing session for
  // history loading — a new session is created only on the success path below.
  let existingSession: (typeof aiChatSessionsTable.$inferSelect) | undefined;
  if (sessionId) {
    const [found] = await db
      .select()
      .from(aiChatSessionsTable)
      .where(eq(aiChatSessionsTable.id, sessionId))
      .limit(1);
    existingSession = found;
  }

  // Load history from the existing session. New sessions have no prior history.
  const historyRows = existingSession
    ? await db
        .select()
        .from(aiChatMessagesTable)
        .where(eq(aiChatMessagesTable.sessionId, existingSession.id))
        .orderBy(desc(aiChatMessagesTable.createdAt))
        .limit(10)
    : [];

  // Resolve provider + API key (DeepSeek preferred over Groq when both configured).
  const providerResolved = await requireProvider(req.userId, res);
  if (!providerResolved) return;
  const { provider, apiKey } = providerResolved;

  // Validate rootPath is accessible on disk before activating file-system tools.
  // If the project's stored path is a deleted temp directory (e.g. a GitHub
  // discovery clone under /tmp/eos-git-*), fall back to the workspace root so
  // file tools remain active. If neither is accessible, degrade gracefully to
  // knowledge-graph-only mode rather than disabling all tooling silently.
  const WORKSPACE_FALLBACK = process.env.WORKSPACE_PATH ?? "/home/runner/workspace";
  let validRootPath: string | undefined;
  if (project.rootPath) {
    try {
      await fs.access(project.rootPath);
      validRootPath = project.rootPath;
    } catch {
      // Primary path inaccessible — try workspace root as fallback.
      try {
        await fs.access(WORKSPACE_FALLBACK);
        validRootPath = WORKSPACE_FALLBACK;
        // G-16: log the fallback but do NOT persist it to the DB.  Writing
        // WORKSPACE_FALLBACK permanently over the stored rootPath would expose
        // the entire monorepo as the project's file scope and make the original
        // path unrecoverable — e.g. if the project is re-scanned or re-imported
        // after the temp clone is refreshed.  The fallback applies to this
        // request only; the DB retains the authoritative (currently inaccessible)
        // path so future operations can resolve it correctly.
        console.warn(
          JSON.stringify({
            scope: "ai-route",
            code: "ROOTPATH_FALLBACK",
            original: project.rootPath,
            fallback: WORKSPACE_FALLBACK,
            projectId,
            note: "transient fallback only — rootPath not persisted",
          }),
        );
      } catch {
        console.warn(
          JSON.stringify({
            scope: "ai-route",
            code: "ROOTPATH_NOT_ACCESSIBLE",
            rootPath: project.rootPath,
            projectId,
          }),
        );
      }
    }
  }

  // R-01: block chat context reads while an apply is writing files for this
  // project. Without this guard a chat request starting milliseconds after
  // apply-changes begins can read a partially-written snapshot and give the
  // user a confused or contradictory response.
  if (_applyingProjects.has(projectId)) {
    return res.status(409).json({
      error: "apply_in_progress",
      hint: "File changes are still being written for this project — wait a moment, then retry.",
    });
  }

  // Build context and run chat agent (file-system tools activated via rootPath)
  const projectContext = await buildProjectContext(projectId);
  let result: Awaited<ReturnType<typeof chat>>;
  try {
    result = await chat({
      message,
      history: historyRows
        .reverse()
        .filter((m) => m.role === "user" || m.role === "assistant")
        .map((m) => ({ role: m.role as "user" | "assistant", content: m.content })),
      projectContext,
      rootPath: validRootPath,
      apiKey,
      provider,
    });
  } catch (err) {
    if (handleOrchestratorError(err, res, { projectId, operation: "chat" })) return;
    throw err;
  }

  // PR-E: parse failure detected — surface as 422 so the dashboard shows a
  // specific "model output invalid" message rather than a confusing degraded 200.
  // The raw field is truncated to 500 chars to avoid leaking huge model outputs.
  if (result._parseError) {
    return res.status(422).json({
      error: "model_output_invalid",
      code: "model_output_invalid",
      hint: "The AI model returned an unexpected response — try rephrasing your message.",
      raw: result._parseError.raw.slice(0, 500),
      parseCode: result._parseError.code,
    });
  }

  // Groq call succeeded — now resolve or create the session.
  // Creating the session here (Gap-9 fix) guarantees we never leave an empty
  // orphaned session when the Groq call fails above.
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

  // Save BOTH the user message and the assistant response atomically.
  const [, [assistantMsg]] = await Promise.all([
    db.insert(aiChatMessagesTable).values({
      id: randomUUID(),
      sessionId: session.id,
      role: "user",
      content: message,
      createdAt: now, // use the request timestamp so history ordering is stable
    }),
    db
      .insert(aiChatMessagesTable)
      .values({
        id: randomUUID(),
        sessionId: session.id,
        role: "assistant",
        content: result.response,
        sources: JSON.stringify(result.sources),
        createdAt: msgNow,
      })
      .returning(),
  ]);

  // Update session timestamp
  await db
    .update(aiChatSessionsTable)
    .set({ updatedAt: msgNow })
    .where(eq(aiChatSessionsTable.id, session.id));

  return res.json({
    sessionId: session.id,
    message: assistantMsg,
    sources: result.sources,
    // Pending changes are ephemeral — not persisted in the DB.
    // The frontend holds them in local state until the user approves or rejects.
    pendingChanges: result.pendingChanges ?? [],
  });
});

// ── Chat (SSE streaming) ─────────────────────────────────────────────────────

/**
 * POST /api/ai/chat/stream — SSE-based AI chat (PR-I)
 *
 * Emits a sequence of Server-Sent Events over a `text/event-stream` response:
 *   { type: "stage",  stage: "building-context" | "calling-model" }
 *   { type: "done",   sessionId, message, sources, pendingChanges }
 *   { type: "error",  code, message, hint?, raw?, parseCode? }
 *
 * The non-streaming `POST /api/ai/chat` endpoint remains available as a
 * fallback for programmatic / non-browser clients.
 */
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

  const rlChat = checkProjectRateLimit(projectId);
  if (!rlChat.allowed) {
    return res.status(429).json({
      error: `LLM rate limit exceeded — max ${LLM_RATE_LIMIT} calls per minute per project. Retry in ${rlChat.retryAfterSec}s.`,
    });
  }

  const providerResolved = await requireProvider(req.userId, res);
  if (!providerResolved) return;
  const { provider, apiKey } = providerResolved;

  // ── SSE setup ──────────────────────────────────────────────────────────────
  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache, no-transform");
  res.setHeader("Connection", "keep-alive");
  // Disable nginx/proxy buffering so events are flushed immediately.
  res.setHeader("X-Accel-Buffering", "no");
  res.flushHeaders();

  /** Send a single SSE data event. */
  function sse(data: Record<string, unknown>): void {
    res.write(`data: ${JSON.stringify(data)}\n\n`);
  }

  const now = new Date();

  // Load or locate the existing session for history
  let existingSession: (typeof aiChatSessionsTable.$inferSelect) | undefined;
  if (sessionId) {
    const [found] = await db
      .select()
      .from(aiChatSessionsTable)
      .where(eq(aiChatSessionsTable.id, sessionId))
      .limit(1);
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

  // rootPath validation (same logic as /api/ai/chat)
  const WORKSPACE_FALLBACK = process.env.WORKSPACE_PATH ?? "/home/runner/workspace";
  let validRootPath: string | undefined;
  if (project.rootPath) {
    try {
      await fs.access(project.rootPath);
      validRootPath = project.rootPath;
    } catch {
      try {
        await fs.access(WORKSPACE_FALLBACK);
        // Use fallback for this request only — do NOT persist it to the DB.
        // Writing WORKSPACE_FALLBACK over the stored rootPath would permanently
        // expose the entire monorepo to AI file tools for every future request,
        // regardless of what the project was originally scoped to (G-16 fix).
        validRootPath = WORKSPACE_FALLBACK;
      } catch { /* neither accessible — file tools disabled */ }
    }
  }

  // ── Stage: building context ────────────────────────────────────────────────
  sse({ type: "stage", stage: "building-context" });
  const projectContext = await buildProjectContext(projectId);

  // ── Stage: calling model ───────────────────────────────────────────────────
  sse({ type: "stage", stage: "calling-model" });

  let result: Awaited<ReturnType<typeof chat>>;
  try {
    result = await chat({
      message,
      history: historyRows
        .reverse()
        .filter((m) => m.role === "user" || m.role === "assistant")
        .map((m) => ({ role: m.role as "user" | "assistant", content: m.content })),
      projectContext,
      rootPath: validRootPath,
      apiKey,
      provider,
    });
  } catch (err) {
    if (err instanceof GroqClientError) {
      const base = { type: "error", code: err.code };
      switch (err.code) {
        case "RATE_LIMITED":
          sse({ ...base, message: "Groq rate limit reached — wait 30–60 seconds before retrying.", hint: err.message });
          break;
        case "AUTH_ERROR":
          sse({ ...base, message: "Groq API key is invalid or unauthorized.", hint: "Delete your current key and save a valid one." });
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

  // PR-E: parse failure
  if (result._parseError) {
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

  // ── DB writes (identical to /api/ai/chat success path) ────────────────────
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

  const [, [assistantMsg]] = await Promise.all([
    db.insert(aiChatMessagesTable).values({
      id: randomUUID(),
      sessionId: session.id,
      role: "user",
      content: message,
      createdAt: now,
    }),
    db
      .insert(aiChatMessagesTable)
      .values({
        id: randomUUID(),
        sessionId: session.id,
        role: "assistant",
        content: result.response,
        sources: JSON.stringify(result.sources),
        createdAt: msgNow,
      })
      .returning(),
  ]);

  await db
    .update(aiChatSessionsTable)
    .set({ updatedAt: msgNow })
    .where(eq(aiChatSessionsTable.id, session.id));

  // ── Done ───────────────────────────────────────────────────────────────────
  sse({
    type: "done",
    sessionId: session.id,
    message: assistantMsg,
    sources: result.sources,
    pendingChanges: result.pendingChanges ?? [],
  });
  res.end();
  return;
});

/** GET /api/ai/chat/sessions?projectId=xxx — list chat sessions */
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

/** GET /api/ai/chat/:sessionId/messages — get messages in a session */
router.get("/ai/chat/:sessionId/messages", async (req, res) => {
  const { sessionId } = req.params;

  // Load the session first to verify ownership
  const sessionRows = await db
    .select()
    .from(aiChatSessionsTable)
    .where(eq(aiChatSessionsTable.id, sessionId))
    .limit(1);
  const session = sessionRows[0];
  // Unknown session → return empty messages rather than 404.
  // This preserves the original contract (no information leakage about
  // whether a session ID exists or not) while still enforcing ownership
  // on sessions that do exist and are linked to a project.
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

// ── Apply AI-proposed file changes ───────────────────────────────────────────

/**
 * POST /api/ai/chat/apply-changes
 *
 * Writes the set of pending file changes that the chat agent proposed and the
 * user has approved through the dashboard UI.  Every path is re-verified
 * against the project's rootPath before writing — the frontend approval is
 * UX-level trust, not a security boundary.
 */
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

  // Verify the user owns this project
  const project = await loadProjectByIdForUser(projectId, req.userId, res);
  if (!project) return;

  const resolvedRoot = path.resolve(project.rootPath);

  // R-01: acquire the per-project apply lock before touching the filesystem.
  // Held for the full duration of the write + cache-invalidation cycle so that
  // concurrent chat requests (which check _applyingProjects before building
  // context) cannot read a partially-written snapshot.
  if (_applyingProjects.has(projectId)) {
    return res.status(409).json({
      error: "apply_in_progress",
      hint: "An apply operation is already in progress for this project — wait for it to complete before starting another.",
    });
  }
  _applyingProjects.add(projectId);

  let results: Array<{ path: string; ok: boolean; error?: string }>;
  try {
    results = [];

    for (const change of changes) {
      // Sensitive-extension guard — mirrors the same check in file-tools.ts write_file.
      // Prevents a tampered or prompt-injected payload from overwriting .env files,
      // shell scripts, or TLS material via the apply-changes route.
      const BLOCKED_WRITE_EXTENSIONS =
        /(?:^|[/\\])\.env(?:\.|$)|\.(sh|bash|zsh|fish|ps1|bat|cmd|pem|key|pfx|p12|crt|cer|der|pub|rsa|dsa|htpasswd)$/i;
      if (BLOCKED_WRITE_EXTENSIONS.test(change.path)) {
        results.push({
          path: change.path,
          ok: false,
          error: "File type is classified as sensitive (secrets, credentials, or executable scripts) — apply manually.",
        });
        continue;
      }

      // Re-validate path is inside the project root (guard against tampered payloads)
      const resolved = path.resolve(change.absolutePath);
      if (resolved !== resolvedRoot && !resolved.startsWith(resolvedRoot + path.sep)) {
        results.push({ path: change.path, ok: false, error: "Path is outside the project root" });
        continue;
      }
      try {
        await fs.mkdir(path.dirname(resolved), { recursive: true });
        await fs.writeFile(resolved, change.newContent, "utf-8");
        results.push({ path: change.path, ok: true });
      } catch (e) {
        results.push({ path: change.path, ok: false, error: e instanceof Error ? e.message : String(e) });
      }
    }

    const appliedPaths = results.filter((r) => r.ok).map((r) => r.path);
    const failedPaths  = results.filter((r) => !r.ok).map((r) => r.path);
    // One correlationId ties the audit record and the event for this apply batch
    // together — callers can retrieve the full trace with a single correlationId filter.
    const applyCorrelationId = randomUUID();
    if (appliedPaths.length > 0) {
      // Audit log for reversibility / compliance
      await recordAudit({
        entityType: "project",
        entityId: projectId,
        action: "ai_executed",
        projectId,
        stateBefore: {},
        stateAfter: { filesWritten: appliedPaths },
        correlationId: applyCorrelationId,
      });

      // G-11: bust the context cache so the very next /ai/chat request reflects
      // the newly written files rather than serving a 30-second-old snapshot.
      // Cache invalidation happens inside the lock so the next chat request that
      // passes the _applyingProjects guard is guaranteed to see the fresh cache.
      invalidateContextCache(projectId);

      // G-02 / G-14: emit an eventsTable row so this operation is visible in the
      // dashboard activity feed and in the AI context's recentEvents on the next
      // chat request.  Previously apply-changes was audit-only and invisible to
      // both the UI event log and the AI context.
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
    // Always release the lock — even if an unexpected exception escapes the
    // try block — so the project isn't permanently locked out of chat.
    _applyingProjects.delete(projectId);
  }
});

// ── Scan Analysis ────────────────────────────────────────────────────────────

/** POST /api/ai/projects/:projectId/analyze — AI scan analysis */
router.post("/ai/projects/:projectId/analyze", requireProjectAccess, async (req, res) => {
  const projectId = req.params.projectId as string;

  logger.info({ projectId }, "AI scan analysis requested");

  const apiKey = await requireGroqApiKey(req.userId, res);
  if (apiKey === null) return;

  const projectContext = await buildProjectContext(projectId);

  const rlAnalyze = checkProjectRateLimit(projectId);
  if (!rlAnalyze.allowed) {
    return res.status(429).json({
      error: `LLM rate limit exceeded — max ${LLM_RATE_LIMIT} calls per minute per project. Retry in ${rlAnalyze.retryAfterSec}s.`,
    });
  }

  let result: Awaited<ReturnType<typeof analyzeScan>>;
  try {
    result = await analyzeScan(projectContext, { apiKey });
  } catch (err) {
    if (handleOrchestratorError(err, res, { projectId, operation: "scan-analysis" })) return;
    throw err;
  }

  // PR-E: parse failure detected — return 422 so the dashboard shows a specific
  // "model output invalid" message rather than silently returning degraded content.
  if (result._parseError) {
    return res.status(422).json({
      error: "model_output_invalid",
      code: "model_output_invalid",
      hint: "The AI model returned an unexpected response — try again in a moment.",
      raw: result._parseError.raw.slice(0, 500),
      parseCode: result._parseError.code,
    });
  }

  // Gap-2 fix: invalidate context cache so next chat request reflects any
  // state changes that the analysis may have written (events, updated scores).
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

// ── Code Review ──────────────────────────────────────────────────────────────

/** POST /api/ai/projects/:projectId/review — AI code review */
router.post("/ai/projects/:projectId/review", requireProjectAccess, async (req, res) => {
  const projectId = req.params.projectId as string;
  const { fileContents } = req.body as { fileContents?: Record<string, string> };

  logger.info({ projectId }, "AI code review requested");

  // Validate fileContents before touching the LLM:
  //   (a) Keys must be relative — absolute paths could leak server internals.
  //   (b) Keys must not contain traversal — defence against path confusion.
  //   (c) Total payload capped at 50 KB — prevents hitting model context limits
  //       with a silent truncation that the caller would never notice.
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

  const rlReview = checkProjectRateLimit(projectId);
  if (!rlReview.allowed) {
    return res.status(429).json({
      error: `LLM rate limit exceeded — max ${LLM_RATE_LIMIT} calls per minute per project. Retry in ${rlReview.retryAfterSec}s.`,
    });
  }

  const apiKey = await requireGroqApiKey(req.userId, res);
  if (apiKey === null) return;

  const projectContext = await buildProjectContext(projectId);
  let result: Awaited<ReturnType<typeof reviewCode>>;
  try {
    result = await reviewCode(projectContext, fileContents, { apiKey });
  } catch (err) {
    if (handleOrchestratorError(err, res, { projectId, operation: "code-review" })) return;
    throw err;
  }

  // PR-E: parse failure detected — return 422 instead of a silent degraded 200.
  if (result._parseError) {
    return res.status(422).json({
      error: "model_output_invalid",
      code: "model_output_invalid",
      hint: "The AI model returned an unexpected response — try again in a moment.",
      raw: result._parseError.raw.slice(0, 500),
      parseCode: result._parseError.code,
    });
  }

  // Gap-2 fix: bust context cache after code review emits events.
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

// ── Workflow Orchestration ───────────────────────────────────────────────────

/** POST /api/ai/workflows/:workflowId/orchestrate — AI workflow decision */
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

  const apiKey = await requireGroqApiKey(req.userId, res);
  if (apiKey === null) return;

  const projectContext = await buildProjectContext(workflow.projectId);

  // Gap-5 fix: parse and validate phases using WorkflowPhaseSchema instead of
  // a raw cast. This catches malformed phase shapes and duplicate phase names
  // (which break validateDecision's linear name-based lookups) before the
  // orchestrator runs rather than producing a silent mis-decision.
  const phasesResult = parseWorkflowPhases(workflow.phases ?? []);
  if (!phasesResult.ok) {
    return res.status(422).json({ error: `Invalid workflow phases: ${phasesResult.error}` });
  }
  const phases = phasesResult.phases;
  const currentPhase = execution?.currentPhase ?? workflow.currentPhase;
  const completedPhases = (execution?.completedPhases as string[]) ?? [];

  const rlOrch = checkProjectRateLimit(workflow.projectId);
  if (!rlOrch.allowed) {
    return res.status(429).json({
      error: `LLM rate limit exceeded — max ${LLM_RATE_LIMIT} calls per minute per project. Retry in ${rlOrch.retryAfterSec}s.`,
    });
  }

  // Concurrency guard: reject a second simultaneous orchestrate call for the
  // same workflow. Two concurrent decisions would read the same state and
  // produce conflicting phase transitions — one would silently win depending
  // on whichever DB write lands last.
  // Note: process-local only; a multi-instance deployment needs a DB advisory
  // lock or distributed mutex instead.
  if (_orchestratingWorkflows.has(workflowId)) {
    return res.status(409).json({
      error: "An orchestration decision is already in progress for this workflow. Retry in a moment.",
    });
  }
  _orchestratingWorkflows.add(workflowId);

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
    });
  } catch (err) {
    _orchestratingWorkflows.delete(workflowId);
    if (handleOrchestratorError(err, res, { projectId: workflow.projectId, operation: "workflow-orchestration" })) return;
    throw err;
  } finally {
    // Always release the lock — even if orchestrateWorkflow throws an error
    // not caught by handleOrchestratorError and propagates to Express.
    _orchestratingWorkflows.delete(workflowId);
  }

  // PR-E: parse failure detected — return 422 instead of a silent degraded 200
  // (which would look like a valid "wait" decision but with no model reasoning).
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

  // Gap-2 fix: orchestration decisions write an event; bust the cache so the
  // next chat turn sees the updated workflow state immediately.
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

// ── Task AI Execution ────────────────────────────────────────────────────────

/** POST /api/ai/tasks/:taskId/execute — execute a task via AI agent */
router.post("/ai/tasks/:taskId/execute", async (req, res) => {
  const { taskId } = req.params;

  const [task] = await db
    .select()
    .from(tasksTable)
    .where(eq(tasksTable.id, taskId))
    .limit(1);
  if (!task) return res.status(404).json({ error: "Task not found" });

  const ownerProject = await loadProjectByIdForUser(task.projectId, req.userId, res);
  if (!ownerProject) return;

  if (!["pending", "queued", "verifying"].includes(task.status)) {
    return res
      .status(409)
      .json({ error: `Cannot AI-execute task with status "${task.status}"` });
  }

  // Verify API key availability BEFORE the atomic claim so we never leave a
  // task stuck in "running" when no key is configured.  If we checked after
  // claiming we would need an async rollback that races with the test/client
  // reading the DB after receiving the 428 response.
  const apiKey = await requireGroqApiKey(req.userId, res);
  if (apiKey === null) return;

  // Rate limit BEFORE the atomic claim — if we hit the limit after claiming,
  // the task stays stuck in "running" with no automatic rollback.
  const rlExecute = checkProjectRateLimit(task.projectId);
  if (!rlExecute.allowed) {
    return res.status(429).json({
      error: `LLM rate limit exceeded — max ${LLM_RATE_LIMIT} calls per minute per project. Retry in ${rlExecute.retryAfterSec}s.`,
    });
  }

  const correlationId = randomUUID();
  const now = new Date();

  // Atomic claim
  const [claimed] = await db
    .update(tasksTable)
    .set({ status: "running", updatedAt: now })
    .where(
      and(
        eq(tasksTable.id, taskId),
        eq(tasksTable.status, task.status),
      ),
    )
    .returning();
  if (!claimed) return res.status(409).json({ error: "Task state changed concurrently" });

  await db.insert(taskLogsTable).values({
    id: randomUUID(),
    taskId,
    level: "info",
    message: "AI agent execution started",
    metadata: { correlationId },
    correlationId,
  });

  const projectContext = await buildProjectContext(task.projectId);

  let agentResult: Awaited<ReturnType<typeof executeTask>>;
  try {
    agentResult = await executeTask({
      taskTitle: task.title,
      taskDescription: task.description,
      taskPrompt: task.prompt,
      taskPriority: task.priority,
      relatedFiles: (task.relatedFiles as string[]) ?? [],
      projectContext,
      apiKey,
    });
  } catch (err) {
    // Roll back the atomic claim so the task doesn't stay in "running" forever.
    await db
      .update(tasksTable)
      .set({ status: task.status, updatedAt: new Date() })
      .where(eq(tasksTable.id, taskId));
    await db.insert(taskLogsTable).values({
      id: randomUUID(),
      taskId,
      level: "error",
      message: err instanceof Error ? err.message : String(err),
      metadata: { error: String(err), correlationId },
      correlationId,
    });
    if (handleOrchestratorError(err, res, { projectId: task.projectId, operation: "task-execution" })) return;
    throw err;
  }

  // PR-E: parse failure detected — roll back the atomic claim so the task
  // doesn't stay stuck in "running", then return 422 so the caller knows the
  // AI produced unusable output rather than a silent degraded result.
  if (agentResult._parseError) {
    await db
      .update(tasksTable)
      .set({ status: task.status, updatedAt: new Date() })
      .where(eq(tasksTable.id, taskId));
    await db.insert(taskLogsTable).values({
      id: randomUUID(),
      taskId,
      level: "error",
      message: `AI agent parse failure [${agentResult._parseError.code}]: ${agentResult._parseError.message}`,
      metadata: { parseError: agentResult._parseError, correlationId },
      correlationId,
    });
    return res.status(422).json({
      error: "model_output_invalid",
      code: "model_output_invalid",
      hint: "The AI model returned an unexpected response — try executing the task again.",
      raw: agentResult._parseError.raw.slice(0, 500),
      parseCode: agentResult._parseError.code,
    });
  }

  // Gap-2 fix: task execution mutates task status and emits events — bust
  // context cache so the next chat request sees the updated task immediately.
  invalidateContextCache(task.projectId);

  const finalStatus = agentResult.needsHumanReview ? "verifying" : "completed";
  const agentResponseText = JSON.stringify(agentResult, null, 2);

  const [updated] = await db
    .update(tasksTable)
    .set({
      status: finalStatus,
      agentResponse: agentResponseText,
      // Gap-6 fix: verification reflects the agent's actual recommendation rather
      // than blindly marking every step as passed. When needsHumanReview is true,
      // the agent is uncertain — steps are marked accordingly so the UI can surface
      // "needs review" instead of a misleading all-green verification record.
      verificationResult: {
        passed: !agentResult.needsHumanReview,
        steps: agentResult.steps.map((s: string) => ({
          name: s,
          passed: !agentResult.needsHumanReview,
        })),
      },
      updatedAt: new Date(),
      completedAt: finalStatus === "completed" ? new Date() : null,
    })
    .where(eq(tasksTable.id, taskId))
    .returning();

  await db.insert(taskLogsTable).values({
    id: randomUUID(),
    taskId,
    level: finalStatus === "completed" ? "info" : "warn",
    message: `AI agent: ${agentResult.summary} (confidence: ${agentResult.confidence})`,
    metadata: { agentResult, correlationId },
    correlationId,
  });

  await db.insert(eventsTable).values({
    id: randomUUID(),
    type: finalStatus === "completed" ? "TaskCompleted" : "TaskVerifying",
    projectId: task.projectId,
    taskId,
    severity: finalStatus === "completed" ? "success" : "warning",
    message: `AI executed "${task.title}" → ${finalStatus} (${agentResult.confidence} confidence)`,
    correlationId,
  });

  await recordAudit({
    entityType: "task",
    entityId: taskId,
    action: "ai_executed",
    projectId: task.projectId,
    stateBefore: { status: task.status },
    stateAfter: { status: finalStatus },
    correlationId,
  });

  return res.status(202).json(updated);
});

// ── PR-C: AI auto-trigger on verifying state ──────────────────────────────────

/**
 * Schedules an AI task execution job for a task that just entered `verifying`
 * status with a non-null prompt. Fire-and-forget: enqueued into the shared
 * heavyJobQueue so it never blocks the caller's HTTP response.
 *
 * The job re-confirms the task is still in `verifying` before doing anything —
 * guards against a user cancelling or manually resolving the task between the
 * trigger point and when a queue slot becomes free.
 *
 * Re-uses the same pipeline as POST /api/ai/tasks/:taskId/execute
 * (resolveGroqApiKey, checkProjectRateLimit, buildProjectContext, executeTask)
 * so the two paths are mechanically identical.
 *
 * @param taskId  ID of the task to auto-execute.
 * @param userId  Owner — used for Groq API key resolution (user key → env fallback).
 */
export function scheduleAiTaskExecution(taskId: string, userId: string): void {
  heavyJobQueue.enqueue(async () => {
    try {
      // Re-fetch to confirm the task is still eligible — the user may have
      // cancelled or manually changed the status while the job was queued.
      const [task] = await db
        .select()
        .from(tasksTable)
        .where(eq(tasksTable.id, taskId))
        .limit(1);

      if (!task || task.status !== "verifying" || !task.prompt) {
        logger.info(
          { taskId, status: task?.status ?? "gone", hasPrompt: !!task?.prompt },
          "AI auto-trigger: task no longer eligible — skipping",
        );
        return;
      }

      const apiKey = await resolveGroqApiKey(userId);
      if (!apiKey) {
        // No key configured — leave task in verifying for manual resolution and
        // emit a skipped event so the situation is visible in the event feed.
        logger.warn({ taskId }, "AI auto-trigger: no Groq API key configured — task stays in verifying");
        await db.insert(eventsTable).values({
          id: randomUUID(),
          type: "TaskAutoTriggered",
          projectId: task.projectId,
          taskId,
          severity: "warning",
          message: `AI auto-trigger skipped for "${task.title}": no Groq API key configured`,
          payload: { skipped: true, reason: "no_api_key" },
        });
        return;
      }

      const rl = checkProjectRateLimit(task.projectId);
      if (!rl.allowed) {
        logger.warn(
          { taskId, retryAfterSec: rl.retryAfterSec },
          "AI auto-trigger: rate limited — task stays in verifying",
        );
        return;
      }

      const correlationId = randomUUID();

      // Emit TaskAutoTriggered before the atomic claim so the event is visible
      // in the feed even if the claim races with a concurrent state change.
      await db.insert(eventsTable).values({
        id: randomUUID(),
        type: "TaskAutoTriggered",
        projectId: task.projectId,
        taskId,
        severity: "info",
        message: `AI auto-execution triggered for "${task.title}"`,
        correlationId,
        payload: { trigger: "verifying_state", before: { status: "verifying" }, after: { status: "running" } },
      });

      // Atomic claim: verifying → running — guards against a concurrent manual
      // /execute call winning the same task at the same time.
      const [claimed] = await db
        .update(tasksTable)
        .set({ status: "running", updatedAt: new Date() })
        .where(and(eq(tasksTable.id, taskId), eq(tasksTable.status, "verifying")))
        .returning();
      if (!claimed) {
        logger.info({ taskId }, "AI auto-trigger: concurrent state change won the claim — skipping");
        return;
      }

      await db.insert(taskLogsTable).values({
        id: randomUUID(),
        taskId,
        level: "info",
        message: "AI auto-execution started (triggered by verifying state transition)",
        correlationId,
      });

      const projectContext = await buildProjectContext(task.projectId);

      let agentResult: Awaited<ReturnType<typeof executeTask>>;
      try {
        agentResult = await executeTask({
          taskTitle: task.title,
          taskDescription: task.description,
          taskPrompt: task.prompt,
          taskPriority: task.priority,
          relatedFiles: (task.relatedFiles as string[]) ?? [],
          projectContext,
          apiKey,
        });
      } catch (execErr) {
        // Roll back to verifying so the task is not stuck in running.
        await db
          .update(tasksTable)
          .set({ status: "verifying", updatedAt: new Date() })
          .where(and(eq(tasksTable.id, taskId), eq(tasksTable.status, "running")));
        await db.insert(taskLogsTable).values({
          id: randomUUID(),
          taskId,
          level: "error",
          message: `AI auto-execution failed: ${execErr instanceof Error ? execErr.message : String(execErr)}`,
          correlationId,
        });
        throw execErr; // re-throw so the job queue's catch block logs it
      }

      invalidateContextCache(task.projectId);

      const autoFinalStatus = agentResult.needsHumanReview ? "verifying" : "completed";

      await db
        .update(tasksTable)
        .set({
          status: autoFinalStatus,
          agentResponse: JSON.stringify(agentResult, null, 2),
          verificationResult: {
            passed: !agentResult.needsHumanReview,
            steps: agentResult.steps.map((s: string) => ({
              name: s,
              passed: !agentResult.needsHumanReview,
            })),
          },
          updatedAt: new Date(),
          completedAt: autoFinalStatus === "completed" ? new Date() : null,
        })
        .where(eq(tasksTable.id, taskId));

      await db.insert(taskLogsTable).values({
        id: randomUUID(),
        taskId,
        level: autoFinalStatus === "completed" ? "info" : "warn",
        message: `AI auto-execution: ${agentResult.summary} (confidence: ${agentResult.confidence})`,
        metadata: { agentResult, correlationId },
        correlationId,
      });

      await db.insert(eventsTable).values({
        id: randomUUID(),
        type: autoFinalStatus === "completed" ? "TaskCompleted" : "TaskVerifying",
        projectId: task.projectId,
        taskId,
        severity: autoFinalStatus === "completed" ? "success" : "warning",
        message: `AI auto-executed "${task.title}" → ${autoFinalStatus} (${agentResult.confidence} confidence)`,
        correlationId,
        payload: { before: { status: "running" }, after: { status: autoFinalStatus } },
      });

      await recordAudit({
        entityType: "task",
        entityId: taskId,
        action: "ai_auto_executed",
        projectId: task.projectId,
        stateBefore: { status: "verifying" },
        stateAfter: { status: autoFinalStatus },
        correlationId,
      });
    } catch (err) {
      // Top-level catch satisfies the job queue's contract (jobs must not let
      // errors escape unhandled). The inner try/catch already rolled back the
      // atomic claim and logged a task-level entry; this just prevents process
      // instability from an unexpected throw path.
      logger.error({ err, taskId }, "AI auto-trigger: unhandled error in auto-execution job");
    }
  });
}

export default router;
