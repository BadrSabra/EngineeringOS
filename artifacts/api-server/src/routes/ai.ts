import { Router } from "express";
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
  chat,
  executeTask,
  analyzeScan,
  reviewCode,
  orchestrateWorkflow,
  GroqClientError,
} from "@workspace/ai-orchestrator";
import type { PendingChange } from "@workspace/ai-orchestrator";
import { recordAudit } from "../lib/audit.js";
import { logger } from "../lib/logger.js";
import { encryptApiKey, decryptApiKey } from "../lib/credentials-crypto.js";
import {
  loadProjectByIdForUser,
  requireProjectAccess,
} from "../middlewares/requireProjectAccess.js";

const router = Router();

/**
 * Maps GroqClientError codes to typed HTTP responses so callers receive a
 * structured error body instead of a generic 500. Returns true when a response
 * was sent; false when the error is not a known provider error (caller should
 * rethrow to the central error handler).
 */
function handleOrchestratorError(
  err: unknown,
  res: import("express").Response,
): boolean {
  if (!(err instanceof GroqClientError)) return false;

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
 *   2. Server-wide fallback: process.env.GROQ_API_KEY — allows platform
 *      operators to pre-configure a shared key without requiring every user
 *      to supply their own.
 *   3. undefined — caller MUST return 428 to the client.
 *
 * The key value is never logged. Errors during decryption are logged without
 * the ciphertext or decrypted value.
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
      // Log the error but never the ciphertext or decrypted value.
      logger.error({ err, ownerId: userId }, "Failed to decrypt stored Groq API key — falling back to env");
    }
  }

  // Server-wide fallback — present when the platform operator has configured
  // GROQ_API_KEY in the environment (e.g. during onboarding before users have
  // set up their own keys).
  return process.env.GROQ_API_KEY || undefined;
}

/**
 * Rejects the request with 428 if no Groq API key can be resolved.
 * Returns the key string on success, null on failure (response already sent).
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
  const { projectId, message, sessionId } = req.body as {
    projectId: string;
    message: string;
    sessionId?: string;
  };

  if (!projectId || !message?.trim()) {
    return res.status(400).json({ error: "projectId and message are required" });
  }

  // Verify ownership of the project
  const project = await loadProjectByIdForUser(projectId, req.userId, res);
  if (!project) return;

  const now = new Date();

  // Find or create session
  let session;
  if (sessionId) {
    const [existing] = await db
      .select()
      .from(aiChatSessionsTable)
      .where(eq(aiChatSessionsTable.id, sessionId))
      .limit(1);
    session = existing;
  }
  if (!session) {
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

  // Load history (last 10 messages)
  const history = await db
    .select()
    .from(aiChatMessagesTable)
    .where(eq(aiChatMessagesTable.sessionId, session.id))
    .orderBy(desc(aiChatMessagesTable.createdAt))
    .limit(10);

  // Resolve API key — returns 428 and stops if neither user key nor env key is set
  const apiKey = await requireGroqApiKey(req.userId, res);
  if (apiKey === null) return;

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
        console.warn(
          JSON.stringify({
            scope: "ai-route",
            code: "ROOTPATH_FALLBACK",
            original: project.rootPath,
            fallback: WORKSPACE_FALLBACK,
            projectId,
          }),
        );
        // Persist the corrected path so subsequent requests don't repeat the fallback dance.
        await db.update(projectsTable).set({ rootPath: WORKSPACE_FALLBACK }).where(eq(projectsTable.id, projectId));
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

  // NOTE: The user message is intentionally saved AFTER the Groq call succeeds
  // (see below). Saving it here — before the LLM call — would leave orphaned
  // user messages in the DB whenever Groq returns a 502/429 error, creating
  // sessions that appear to have unanswered questions. Moved to the success path.

  // Build context and run chat agent (file-system tools activated via rootPath)
  const projectContext = await buildProjectContext(projectId);
  let result: Awaited<ReturnType<typeof chat>>;
  try {
    result = await chat({
      message,
      history: history
        .reverse()
        .filter((m) => m.role === "user" || m.role === "assistant")
        .map((m) => ({ role: m.role as "user" | "assistant", content: m.content })),
      projectContext,
      rootPath: validRootPath,
      apiKey,
    });
  } catch (err) {
    if (handleOrchestratorError(err, res)) return;
    throw err;
  }

  // Save BOTH the user message and the assistant response atomically.
  // Doing this here — after a successful Groq call — prevents orphaned user
  // messages (sessions with a question but no answer) that previously appeared
  // whenever Groq returned a 429/502 error. If this insert fails, the client
  // still receives the error and can retry; no ghost session is created.
  const msgNow = new Date();
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
  const { changes, projectId } = req.body as {
    changes: Array<Pick<PendingChange, "path" | "absolutePath" | "newContent">>;
    projectId: string;
  };

  if (!projectId) return res.status(400).json({ error: "projectId is required" });
  if (!Array.isArray(changes) || changes.length === 0) {
    return res.status(400).json({ error: "changes must be a non-empty array" });
  }

  // Verify the user owns this project
  const project = await loadProjectByIdForUser(projectId, req.userId, res);
  if (!project) return;

  const resolvedRoot = path.resolve(project.rootPath);
  const results: Array<{ path: string; ok: boolean; error?: string }> = [];

  for (const change of changes) {
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
  if (appliedPaths.length > 0) {
    // Audit log for reversibility / compliance
    await recordAudit({
      entityType: "project",
      entityId: projectId,
      action: "ai_executed",
      projectId,
      stateBefore: {},
      stateAfter: { filesWritten: appliedPaths },
    });

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
    });
  }

  const allOk = results.every((r) => r.ok);
  return res.status(allOk ? 200 : 207).json({ results });
});

// ── Scan Analysis ────────────────────────────────────────────────────────────

/** POST /api/ai/projects/:projectId/analyze — AI scan analysis */
router.post("/ai/projects/:projectId/analyze", requireProjectAccess, async (req, res) => {
  const projectId = req.params.projectId as string;

  logger.info({ projectId }, "AI scan analysis requested");

  const apiKey = await requireGroqApiKey(req.userId, res);
  if (apiKey === null) return;

  const projectContext = await buildProjectContext(projectId);
  let result: Awaited<ReturnType<typeof analyzeScan>>;
  try {
    result = await analyzeScan(projectContext, { apiKey });
  } catch (err) {
    if (handleOrchestratorError(err, res)) return;
    throw err;
  }

  await db.insert(eventsTable).values({
    id: randomUUID(),
    type: "AiScanAnalysisCompleted",
    projectId,
    severity: "info",
    message: `AI scan analysis completed: ${result.summary}`,
  });

  return res.json(result);
});

// ── Code Review ──────────────────────────────────────────────────────────────

/** POST /api/ai/projects/:projectId/review — AI code review */
router.post("/ai/projects/:projectId/review", requireProjectAccess, async (req, res) => {
  const projectId = req.params.projectId as string;
  const { fileContents } = req.body as { fileContents?: Record<string, string> };

  logger.info({ projectId }, "AI code review requested");

  const apiKey = await requireGroqApiKey(req.userId, res);
  if (apiKey === null) return;

  const projectContext = await buildProjectContext(projectId);
  let result: Awaited<ReturnType<typeof reviewCode>>;
  try {
    result = await reviewCode(projectContext, fileContents, { apiKey });
  } catch (err) {
    if (handleOrchestratorError(err, res)) return;
    throw err;
  }

  await db.insert(eventsTable).values({
    id: randomUUID(),
    type: "AiCodeReviewCompleted",
    projectId,
    severity: result.verdict === "approved" ? "success" : "warning",
    message: `AI code review: ${result.verdict} (score: ${result.overallScore}/100)`,
  });

  return res.json(result);
});

// ── Workflow Orchestration ───────────────────────────────────────────────────

/** POST /api/ai/workflows/:workflowId/orchestrate — AI workflow decision */
router.post("/ai/workflows/:workflowId/orchestrate", async (req, res) => {
  const { workflowId } = req.params;
  const { additionalContext } = req.body as { additionalContext?: string };

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

  const phases = (workflow.phases as Array<{ name: string; steps: string[]; condition?: string }>) ?? [];
  const currentPhase = execution?.currentPhase ?? workflow.currentPhase;
  const completedPhases = (execution?.completedPhases as string[]) ?? [];

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
    if (handleOrchestratorError(err, res)) return;
    throw err;
  }

  logger.info({ workflowId, decision }, "AI workflow orchestration decision");

  await db.insert(eventsTable).values({
    id: randomUUID(),
    type: "AiWorkflowOrchestration",
    projectId: workflow.projectId,
    severity: "info",
    message: `AI orchestrator decision for "${workflow.name}": ${decision.action} — ${decision.reasoning.slice(0, 100)}`,
  });

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
    if (handleOrchestratorError(err, res)) return;
    throw err;
  }

  const finalStatus = agentResult.needsHumanReview ? "verifying" : "completed";
  const agentResponseText = JSON.stringify(agentResult, null, 2);

  const [updated] = await db
    .update(tasksTable)
    .set({
      status: finalStatus,
      agentResponse: agentResponseText,
      verificationResult: {
        passed: finalStatus === "completed",
        steps: agentResult.steps.map((s: string) => ({ name: s, passed: true })),
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

export default router;
