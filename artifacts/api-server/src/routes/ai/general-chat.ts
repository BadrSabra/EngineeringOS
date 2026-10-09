import { randomUUID } from "node:crypto";
import { Router } from "express";
import {
  aiGeneralChatMessagesTable,
  aiGeneralChatSessionsTable,
  db,
} from "@workspace/db";
import {
  DeleteGeneralChatSessionParams,
  SendGeneralChatMessageBody,
  SendGeneralChatMessageParams,
} from "@workspace/api-zod";
import {
  GroqClientError,
  PROVIDER_REGISTRY,
  getStrategy,
  type ProviderId,
} from "@workspace/ai-orchestrator";
import { and, desc, eq, isNull, lte, or } from "drizzle-orm";
import { requireAuth } from "../../middlewares/requireAuth.js";
import {
  redactUserFacingText,
  resolveProvider,
  runAgentWithFallback,
} from "../../lib/ai-route-helpers.js";
import { checkGeneralChatRateLimit } from "../../lib/general-chat-rate-limiter.js";
import { logger } from "../../lib/logger.js";

const router = Router();
router.use(requireAuth);

const HISTORY_MESSAGE_LIMIT = 20;
const MESSAGE_LIST_LIMIT = 500;
const GENERAL_CHAT_SYSTEM_PROMPT = [
  "You are EngineeringOS's general engineering assistant.",
  "Answer using only general knowledge and the conversation history.",
  "You do not have access to a project, files, tools, the internet, or the ability to run commands or make changes.",
  "Never claim that you inspected or changed a project. If the user wants work done in project files, explain that they should open that project and use its project chat.",
].join(" ");

type MessageRow = typeof aiGeneralChatMessagesTable.$inferSelect;
type SessionRow = typeof aiGeneralChatSessionsTable.$inferSelect;

function publicMessage(row: MessageRow) {
  return {
    id: row.id,
    sessionId: row.sessionId,
    turnId: row.turnId,
    role: row.role,
    content: redactUserFacingText(row.content).slice(0, 12_000),
    status: row.status,
    errorCode: row.errorCode ?? null,
    errorMessage: row.errorMessage
      ? redactUserFacingText(row.errorMessage).slice(0, 300)
      : null,
    createdAt: row.createdAt,
  };
}

function publicSession(row: SessionRow) {
  return {
    id: row.id,
    title: redactUserFacingText(row.title).slice(0, 100),
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

async function loadOwnedSession(sessionId: string, ownerId: string) {
  const [session] = await db
    .select()
    .from(aiGeneralChatSessionsTable)
    .where(
      and(
        eq(aiGeneralChatSessionsTable.id, sessionId),
        eq(aiGeneralChatSessionsTable.ownerId, ownerId),
      ),
    )
    .limit(1);
  return session;
}

router.get("/ai/general-chat/sessions", async (req, res) => {
  const sessions = await db
    .select()
    .from(aiGeneralChatSessionsTable)
    .where(eq(aiGeneralChatSessionsTable.ownerId, req.userId!))
    .orderBy(desc(aiGeneralChatSessionsTable.updatedAt))
    .limit(100);
  return res.json(sessions.map(publicSession));
});

router.post("/ai/general-chat/sessions", async (req, res) => {
  const now = new Date();
  const [session] = await db
    .insert(aiGeneralChatSessionsTable)
    .values({
      id: randomUUID(),
      ownerId: req.userId!,
      title: "New conversation",
      createdAt: now,
      updatedAt: now,
    })
    .returning();
  return res.status(201).json(publicSession(session));
});

router.delete("/ai/general-chat/sessions/:sessionId", async (req, res) => {
  const parsedParams = DeleteGeneralChatSessionParams.safeParse(req.params);
  if (!parsedParams.success) {
    return res.status(400).json({ error: "Invalid conversation ID." });
  }
  const { sessionId } = parsedParams.data;
  const deleted = await db
    .delete(aiGeneralChatSessionsTable)
    .where(
      and(
        eq(aiGeneralChatSessionsTable.id, sessionId),
        eq(aiGeneralChatSessionsTable.ownerId, req.userId!),
      ),
    )
    .returning({ id: aiGeneralChatSessionsTable.id });
  if (!deleted.length) {
    return res.status(404).json({ error: "Conversation not found." });
  }
  return res.status(204).end();
});

router.get("/ai/general-chat/sessions/:sessionId/messages", async (req, res) => {
  const parsedParams = SendGeneralChatMessageParams.safeParse(req.params);
  if (!parsedParams.success) {
    return res.status(400).json({ error: "Invalid conversation ID." });
  }
  const { sessionId } = parsedParams.data;
  const session = await loadOwnedSession(sessionId, req.userId!);
  if (!session) {
    return res.status(404).json({ error: "Conversation not found." });
  }
  const messages = await db
    .select()
    .from(aiGeneralChatMessagesTable)
    .where(eq(aiGeneralChatMessagesTable.sessionId, sessionId))
    .orderBy(
      desc(aiGeneralChatMessagesTable.createdAt),
      desc(aiGeneralChatMessagesTable.id),
    )
    .limit(MESSAGE_LIST_LIMIT);
  return res.json(messages.reverse().map(publicMessage));
});

type ClaimResult =
  | { kind: "claimed"; userMessage: MessageRow; assistantMessage: MessageRow; workerId: string }
  | { kind: "finished"; userMessage: MessageRow; assistantMessage: MessageRow }
  | { kind: "in_progress" }
  | { kind: "turn_id_reused" };

async function claimTurn(params: {
  ownerId: string;
  session: SessionRow;
  sessionId: string;
  turnId: string;
  message: string;
}): Promise<ClaimResult> {
  const workerId = randomUUID();
  const now = new Date();
  const leaseUntil = new Date(now.getTime() + 60_000);

  return db.transaction(async (tx) => {
    let [userMessage] = await tx
      .select()
      .from(aiGeneralChatMessagesTable)
      .where(
        and(
          eq(aiGeneralChatMessagesTable.sessionId, params.sessionId),
          eq(aiGeneralChatMessagesTable.turnId, params.turnId),
          eq(aiGeneralChatMessagesTable.role, "user"),
        ),
      )
      .limit(1);

    if (!userMessage) {
      await tx
        .insert(aiGeneralChatMessagesTable)
        .values({
          id: randomUUID(),
          sessionId: params.sessionId,
          turnId: params.turnId,
          role: "user",
          content: params.message,
          status: "completed",
          createdAt: now,
        })
        .onConflictDoNothing();
      [userMessage] = await tx
        .select()
        .from(aiGeneralChatMessagesTable)
        .where(
          and(
            eq(aiGeneralChatMessagesTable.sessionId, params.sessionId),
            eq(aiGeneralChatMessagesTable.turnId, params.turnId),
            eq(aiGeneralChatMessagesTable.role, "user"),
          ),
        )
        .limit(1);
    }

    if (!userMessage || userMessage.content !== params.message) {
      return { kind: "turn_id_reused" };
    }

    if (params.session.title === "New conversation") {
      const title = params.message.replace(/\s+/g, " ").trim().slice(0, 72) || "New conversation";
      await tx
        .update(aiGeneralChatSessionsTable)
        .set({ title, updatedAt: now })
        .where(
          and(
            eq(aiGeneralChatSessionsTable.id, params.sessionId),
            eq(aiGeneralChatSessionsTable.ownerId, params.ownerId),
            eq(aiGeneralChatSessionsTable.title, "New conversation"),
          ),
        );
    } else {
      await tx
        .update(aiGeneralChatSessionsTable)
        .set({ updatedAt: now })
        .where(
          and(
            eq(aiGeneralChatSessionsTable.id, params.sessionId),
            eq(aiGeneralChatSessionsTable.ownerId, params.ownerId),
          ),
        );
    }

    let [assistantMessage] = await tx
      .select()
      .from(aiGeneralChatMessagesTable)
      .where(
        and(
          eq(aiGeneralChatMessagesTable.sessionId, params.sessionId),
          eq(aiGeneralChatMessagesTable.turnId, params.turnId),
          eq(aiGeneralChatMessagesTable.role, "assistant"),
        ),
      )
      .limit(1);

    if (!assistantMessage) {
      await tx
        .insert(aiGeneralChatMessagesTable)
        .values({
          id: randomUUID(),
          sessionId: params.sessionId,
          turnId: params.turnId,
          role: "assistant",
          content: "",
          status: "pending",
          workerId,
          leaseUntil,
          createdAt: now,
        })
        .onConflictDoNothing();
      [assistantMessage] = await tx
        .select()
        .from(aiGeneralChatMessagesTable)
        .where(
          and(
            eq(aiGeneralChatMessagesTable.sessionId, params.sessionId),
            eq(aiGeneralChatMessagesTable.turnId, params.turnId),
            eq(aiGeneralChatMessagesTable.role, "assistant"),
          ),
        )
        .limit(1);
      if (assistantMessage?.workerId !== workerId) {
        return { kind: "in_progress" };
      }
    } else if (assistantMessage.status !== "pending") {
      return { kind: "finished", userMessage, assistantMessage };
    } else {
      const [claimed] = await tx
        .update(aiGeneralChatMessagesTable)
        .set({ workerId, leaseUntil })
        .where(
          and(
            eq(aiGeneralChatMessagesTable.id, assistantMessage.id),
            eq(aiGeneralChatMessagesTable.status, "pending"),
            or(
              isNull(aiGeneralChatMessagesTable.leaseUntil),
              lte(aiGeneralChatMessagesTable.leaseUntil, now),
            ),
          ),
        )
        .returning();
      if (!claimed) {
        return { kind: "in_progress" };
      }
      assistantMessage = claimed;
    }

    return {
      kind: "claimed",
      userMessage,
      assistantMessage: assistantMessage!,
      workerId,
    };
  });
}

async function completeAssistantMessage(params: {
  assistantMessageId: string;
  workerId: string;
  content: string;
  status: "completed" | "failed";
  errorCode?: string | null;
  errorMessage?: string | null;
}) {
  const [updated] = await db
    .update(aiGeneralChatMessagesTable)
    .set({
      content: params.content,
      status: params.status,
      errorCode: params.errorCode ?? null,
      errorMessage: params.errorMessage ?? null,
      workerId: null,
      leaseUntil: null,
    })
    .where(
      and(
        eq(aiGeneralChatMessagesTable.id, params.assistantMessageId),
        eq(aiGeneralChatMessagesTable.status, "pending"),
        eq(aiGeneralChatMessagesTable.workerId, params.workerId),
      ),
    )
    .returning();
  return updated;
}

router.post("/ai/general-chat/sessions/:sessionId/messages", async (req, res) => {
  const parsedParams = SendGeneralChatMessageParams.safeParse(req.params);
  const parsedBody = SendGeneralChatMessageBody.safeParse(req.body);
  if (!parsedParams.success || !parsedBody.success) {
    return res.status(400).json({ error: "Invalid message request." });
  }
  const { sessionId } = parsedParams.data;
  const { turnId } = parsedBody.data;
  const message = redactUserFacingText(parsedBody.data.message.trim()).slice(0, 12_000);
  if (!message.trim()) {
    return res.status(400).json({ error: "Message cannot be empty." });
  }

  const session = await loadOwnedSession(sessionId, req.userId!);
  if (!session) {
    return res.status(404).json({ error: "Conversation not found." });
  }

  const claim = await claimTurn({
    ownerId: req.userId!,
    session,
    sessionId,
    turnId,
    message,
  });
  if (claim.kind === "turn_id_reused") {
    return res.status(409).json({
      error: "This turn ID is already associated with a different message.",
      code: "TURN_ID_REUSED",
    });
  }
  if (claim.kind === "in_progress") {
    return res.status(409).json({
      error: "This message is already being processed.",
      code: "TURN_IN_PROGRESS",
    });
  }
  if (claim.kind === "finished") {
    return res.json({
      sessionId,
      userMessage: publicMessage(claim.userMessage),
      assistantMessage: publicMessage(claim.assistantMessage),
    });
  }

  let rateLimit: Awaited<ReturnType<typeof checkGeneralChatRateLimit>>;
  try {
    rateLimit = await checkGeneralChatRateLimit(req.userId!);
  } catch (error) {
    logger.error(
      { error, sessionId, turnId },
      "General chat rate limiter could not be checked",
    );
    const safeMessage = "I couldn't accept a response request right now. Please try again.";
    const assistantMessage = await completeAssistantMessage({
      assistantMessageId: claim.assistantMessage.id,
      workerId: claim.workerId,
      content: safeMessage,
      status: "failed",
      errorCode: "GENERAL_CHAT_UNAVAILABLE",
      errorMessage: safeMessage,
    });
    if (!assistantMessage) {
      return res.status(409).json({ error: "The conversation turn is no longer owned." });
    }
    return res.status(503).json({ error: safeMessage, code: "GENERAL_CHAT_UNAVAILABLE" });
  }
  if (!rateLimit.allowed) {
    const safeMessage = "You've sent several messages recently. Wait a moment and try again.";
    await completeAssistantMessage({
      assistantMessageId: claim.assistantMessage.id,
      workerId: claim.workerId,
      content: safeMessage,
      status: "failed",
      errorCode: "RATE_LIMITED",
      errorMessage: safeMessage,
    });
    return res.status(429).json({
      error: safeMessage,
      code: "RATE_LIMITED",
      retryAfterSec: rateLimit.retryAfterSec ?? 60,
    });
  }

  let historyRows: MessageRow[];
  let provider: Awaited<ReturnType<typeof resolveProvider>>;
  try {
    [historyRows, provider] = await Promise.all([
      db
        .select()
        .from(aiGeneralChatMessagesTable)
        .where(
          and(
            eq(aiGeneralChatMessagesTable.sessionId, sessionId),
            eq(aiGeneralChatMessagesTable.status, "completed"),
          ),
        )
        .orderBy(
          desc(aiGeneralChatMessagesTable.createdAt),
          desc(aiGeneralChatMessagesTable.id),
        )
        .limit(HISTORY_MESSAGE_LIMIT + 1),
      resolveProvider(req.userId!),
    ]);
  } catch (error) {
    logger.error(
      { error, sessionId, turnId },
      "General chat could not prepare provider context",
    );
    const safeMessage =
      "I couldn't prepare a response right now. Send a new message to try again.";
    const assistantMessage = await completeAssistantMessage({
      assistantMessageId: claim.assistantMessage.id,
      workerId: claim.workerId,
      content: safeMessage,
      status: "failed",
      errorCode: "GENERAL_CHAT_UNAVAILABLE",
      errorMessage: safeMessage,
    });
    if (!assistantMessage) {
      return res.status(409).json({ error: "The conversation turn is no longer owned." });
    }
    return res.json({
      sessionId,
      userMessage: publicMessage(claim.userMessage),
      assistantMessage: publicMessage(assistantMessage),
    });
  }

  if (!provider) {
    const safeMessage =
      "No AI provider is ready. Configure a provider in Settings, then send a new message.";
    const assistantMessage = await completeAssistantMessage({
      assistantMessageId: claim.assistantMessage.id,
      workerId: claim.workerId,
      content: safeMessage,
      status: "failed",
      errorCode: "AI_PROVIDER_UNAVAILABLE",
      errorMessage: safeMessage,
    });
    if (!assistantMessage) {
      return res.status(409).json({ error: "The conversation turn is no longer owned." });
    }
    return res.json({
      sessionId,
      userMessage: publicMessage(claim.userMessage),
      assistantMessage: publicMessage(assistantMessage),
    });
  }

  const providerHistory = historyRows
    .filter((row) => row.turnId !== turnId)
    .slice(0, HISTORY_MESSAGE_LIMIT)
    .reverse()
    .map((row) => ({
      role: row.role,
      content: redactUserFacingText(row.content),
    }));
  const providerMessages = [
    { role: "system" as const, content: GENERAL_CHAT_SYSTEM_PROMPT },
    ...providerHistory,
    { role: "user" as const, content: message },
  ];
  const abortController = new AbortController();
  const deadline = setTimeout(() => abortController.abort(), 55_000);
  deadline.unref?.();

  try {
    const { result } = await runAgentWithFallback(
      req.userId!,
      provider,
      async ({ provider: providerId, apiKey, signal, executionLedger }) => {
        const typedProvider = providerId as ProviderId;
        return getStrategy(typedProvider).call(providerMessages, {
          apiKey,
          model: typedProvider === "openrouter"
            ? undefined
            : PROVIDER_REGISTRY[typedProvider].defaultModels.fast,
          quality: "fast",
          capability: "chat",
          maxTokens: 1_500,
          timeoutMs: 20_000,
          retryTransient: false,
          maxFallbackModels: 2,
          signal: signal ?? abortController.signal,
          executionLedger,
          toolChoice: "none",
        });
      },
      {
        signal: abortController.signal,
        telemetryContext: {
          userId: req.userId!,
          projectId: null,
          executionId: null,
          operationId: `general-chat:${sessionId}:${turnId}`,
          correlationId: randomUUID(),
        },
      },
    );
    const responseText =
      typeof result.content === "string" ? redactUserFacingText(result.content).trim() : "";
    if (!responseText) {
      throw new GroqClientError("EMPTY_RESPONSE", "Provider returned no response content.");
    }
    const assistantMessage = await completeAssistantMessage({
      assistantMessageId: claim.assistantMessage.id,
      workerId: claim.workerId,
      content: responseText.slice(0, 12_000),
      status: "completed",
    });
    if (!assistantMessage) {
      return res.status(409).json({ error: "The conversation turn is no longer owned." });
    }
    await db
      .update(aiGeneralChatSessionsTable)
      .set({ updatedAt: new Date() })
      .where(
        and(
          eq(aiGeneralChatSessionsTable.id, sessionId),
          eq(aiGeneralChatSessionsTable.ownerId, req.userId!),
        ),
      );
    return res.json({
      sessionId,
      userMessage: publicMessage(claim.userMessage),
      assistantMessage: publicMessage(assistantMessage),
    });
  } catch (error) {
    const errorCode =
      error instanceof GroqClientError ? error.code : "GENERAL_CHAT_FAILED";
    logger.error(
      { error, sessionId, turnId, errorCode },
      "General chat provider request failed",
    );
    const safeMessage = errorCode === "TIMEOUT"
      ? "The response took too long. Send a new message and try again."
      : "I couldn't generate a response right now. Send a new message to try again.";
    const assistantMessage = await completeAssistantMessage({
      assistantMessageId: claim.assistantMessage.id,
      workerId: claim.workerId,
      content: safeMessage,
      status: "failed",
      errorCode,
      errorMessage: safeMessage,
    });
    if (!assistantMessage) {
      return res.status(409).json({ error: "The conversation turn is no longer owned." });
    }
    return res.json({
      sessionId,
      userMessage: publicMessage(claim.userMessage),
      assistantMessage: publicMessage(assistantMessage),
    });
  } finally {
    clearTimeout(deadline);
  }
});

export default router;
