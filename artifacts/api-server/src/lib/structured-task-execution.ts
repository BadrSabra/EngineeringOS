import { randomUUID } from "crypto";
import { and, desc, eq } from "drizzle-orm";
import {
  aiChatMessagesTable,
  aiChatSessionsTable,
  aiExecutionAcceptancesTable,
  aiExecutionsTable,
  db,
} from "@workspace/db";
import {
  AI_EXECUTION_HEARTBEAT_INTERVAL_MS,
  checkpointAiExecution,
  claimAiExecution,
  completeAiExecution,
  createAiExecution,
  failAiExecution,
  getAiExecutionForUser,
  heartbeatAiExecution,
  parseAiExecutionCheckpoint,
  parseExecutionRequest,
  registerAiExecutionController,
  unregisterAiExecutionController,
  type AiExecutionCheckpoint,
  type AiExecutionRequestEnvelope,
  type AiProviderAttemptCheckpoint,
} from "./ai-execution-state.js";

export type StructuredTask = "analyze" | "review";
type AiExecution = typeof aiExecutionsTable.$inferSelect;

export class StructuredExecutionCooldownError extends Error {
  readonly code = "RATE_LIMITED" as const;
  readonly retryAfterMs: number;
  readonly retryAt: string;
  readonly sessionId?: string;
  readonly executionId?: string;

  constructor(params: {
    retryAfterMs: number;
    retryAt: string;
    sessionId?: string | null;
    executionId?: string;
  }) {
    super("The AI provider is temporarily rate-limited.");
    this.name = "StructuredExecutionCooldownError";
    this.retryAfterMs = params.retryAfterMs;
    this.retryAt = params.retryAt;
    this.sessionId = params.sessionId ?? undefined;
    this.executionId = params.executionId;
  }
}

async function findStructuredExecutionCooldown(params: {
  userId: string;
  projectId: string;
  task: StructuredTask;
  providerName?: string;
}): Promise<StructuredExecutionCooldownError | undefined> {
  const turnIntent = params.task === "review" ? "STRUCTURED_REVIEW" : "STRUCTURED_ANALYZE";
  const rows = await db
    .select({
      executionId: aiExecutionsTable.id,
      sessionId: aiExecutionsTable.sessionId,
      request: aiExecutionsTable.request,
      checkpoint: aiExecutionsTable.checkpoint,
      nextActionCode: aiExecutionAcceptancesTable.nextActionCode,
      outcome: aiExecutionAcceptancesTable.outcome,
      disposition: aiExecutionAcceptancesTable.disposition,
    })
    .from(aiExecutionAcceptancesTable)
    .innerJoin(
      aiExecutionsTable,
      eq(aiExecutionAcceptancesTable.executionId, aiExecutionsTable.id),
    )
    .where(and(
      eq(aiExecutionsTable.userId, params.userId),
      eq(aiExecutionsTable.projectId, params.projectId),
      eq(aiExecutionAcceptancesTable.nextActionCode, "RETRY_AFTER_RATE_LIMIT"),
      eq(aiExecutionAcceptancesTable.outcome, "FAILED"),
    ))
    .orderBy(desc(aiExecutionAcceptancesTable.createdAt))
    .limit(16);

  const now = Date.now();
  for (const row of rows) {
    const request = parseExecutionRequest(row.request);
    if (!request || request.turnIntent !== turnIntent) continue;
    const checkpoint = parseAiExecutionCheckpoint(row.checkpoint);
    const priorProviders = checkpoint?.providerAttempts ?? [];
    if (
      params.providerName
      && priorProviders.length > 0
      && !priorProviders.some((attempt) =>
        attempt.provider.trim().toLowerCase() === params.providerName!.trim().toLowerCase())
    ) {
      continue;
    }
    const disposition = row.disposition && typeof row.disposition === "object"
      ? row.disposition as Record<string, unknown>
      : undefined;
    const retryAtValue = disposition?.retryAt ?? checkpoint?.retryAt;
    if (typeof retryAtValue !== "string") continue;
    const retryAtMs = Date.parse(retryAtValue);
    if (!Number.isFinite(retryAtMs) || retryAtMs <= now) continue;
    return new StructuredExecutionCooldownError({
      retryAfterMs: Math.max(1_000, retryAtMs - now),
      retryAt: new Date(retryAtMs).toISOString(),
      sessionId: row.sessionId,
      executionId: row.executionId,
    });
  }
  return undefined;
}

export type StructuredExecutionStarted = {
  executionId: string;
  sessionId: string;
  resumeToken?: string;
  resumable: boolean;
};

export type StructuredExecution = {
  started: StructuredExecutionStarted;
  execution: AiExecution;
  workerId: string;
  checkpoint: (stage: AiExecutionCheckpoint["stage"], detail?: string) => Promise<void>;
  persistAssistant: (params: {
    content: string;
    outcome: "SUCCEEDED" | "FAILED" | "INTERRUPTED";
    errorCode?: string;
    errorMessage?: string;
    toolTrace?: string;
  }) => Promise<string>;
  complete: (params: { messageId: string; content: string }) => Promise<boolean>;
  fail: (params: {
    messageId: string;
    error: string;
    errorCode: string;
    cancelled?: boolean;
    providerAttempts?: AiProviderAttemptCheckpoint[];
    retryAfterMs?: number;
  }) => Promise<boolean>;
  onClientClose: () => void;
  cleanup: () => void;
};

async function ensureSession(params: {
  projectId: string;
  task: StructuredTask;
  sessionId?: string;
}): Promise<{ id: string; existing: boolean }> {
  if (params.sessionId) {
    const [existing] = await db
      .select({ id: aiChatSessionsTable.id })
      .from(aiChatSessionsTable)
      .where(and(
        eq(aiChatSessionsTable.id, params.sessionId),
        eq(aiChatSessionsTable.projectId, params.projectId),
      ))
      .limit(1);
    if (existing) return { id: existing.id, existing: true };
  }

  const id = randomUUID();
  await db.insert(aiChatSessionsTable).values({
    id,
    projectId: params.projectId,
    title: params.task === "review" ? "Code review" : "Scan analysis",
  });
  return { id, existing: false };
}

async function persistUserTurn(params: {
  sessionId: string;
  executionId: string;
  prompt: string;
  task: StructuredTask;
}): Promise<void> {
  await db.transaction(async (tx) => {
    const [existing] = await tx
      .select({ id: aiChatMessagesTable.id })
      .from(aiChatMessagesTable)
      .where(and(
        eq(aiChatMessagesTable.sessionId, params.sessionId),
        eq(aiChatMessagesTable.role, "user"),
        eq(aiChatMessagesTable.content, params.prompt),
      ))
      .limit(1);
    if (existing) return;

    await tx.insert(aiChatMessagesTable).values({
      id: randomUUID(),
      sessionId: params.sessionId,
      role: "user",
      content: params.prompt,
      turnIntent: params.task === "review" ? "STRUCTURED_REVIEW" : "STRUCTURED_ANALYZE",
      executionId: params.executionId,
      outcome: "SUCCEEDED",
      createdAt: new Date(),
    });
  });
}

export async function startStructuredExecution(params: {
  userId: string;
  projectId: string;
  projectRevision: string;
  task: StructuredTask;
  prompt: string;
  providerName?: string;
  sessionId?: string;
  executionId?: string;
  resumeToken?: string;
  idempotencyKey?: string;
}): Promise<StructuredExecution> {
  const turnIntent = params.task === "review" ? "STRUCTURED_REVIEW" : "STRUCTURED_ANALYZE";
  const workerId = randomUUID();
  let resumeToken: string | undefined;
  let execution: AiExecution | undefined;

  if (params.executionId) {
    const existing = await getAiExecutionForUser(params.executionId, params.userId);
    if (!existing) throw new Error("EXECUTION_NOT_FOUND");
    const storedRequest = parseExecutionRequest(existing.request);
    if (
      !storedRequest
      || existing.projectId !== params.projectId
      || storedRequest.turnIntent !== turnIntent
      || (params.sessionId && storedRequest.sessionId !== params.sessionId)
    ) {
      throw new Error("EXECUTION_BINDING_MISMATCH");
    }
    const claimed = await claimAiExecution({
      executionId: existing.id,
      userId: params.userId,
      workerId,
      resumeToken: params.resumeToken,
    });
    if (!claimed) throw new Error("EXECUTION_CLAIM_CONFLICT");
    execution = claimed;
  } else {
    const cooldown = await findStructuredExecutionCooldown({
      userId: params.userId,
      projectId: params.projectId,
      task: params.task,
      providerName: params.providerName,
    });
    if (cooldown) throw cooldown;

    const initialSession = await ensureSession({
      projectId: params.projectId,
      task: params.task,
      sessionId: params.sessionId,
    });
    const request: AiExecutionRequestEnvelope = {
      projectId: params.projectId,
      sessionId: initialSession.id,
      message: params.prompt,
      modelMessage: params.prompt,
      turnIntent,
      workspaceRevision: params.projectRevision,
      validationTargetPaths: [],
      proofRequired: false,
    };
    const created = await createAiExecution({
      userId: params.userId,
      projectId: params.projectId,
      sessionId: initialSession.id,
      request,
      idempotencyKey: params.idempotencyKey ?? randomUUID(),
      correlationId: request.operationId,
    });
    resumeToken = created.resumeToken;
    const claimed = await claimAiExecution({
      executionId: created.execution.id,
      userId: params.userId,
      workerId,
    });
    if (!claimed) throw new Error("EXECUTION_CLAIM_CONFLICT");
    execution = claimed;
    await persistUserTurn({
      sessionId: initialSession.id,
      executionId: execution.id,
      prompt: params.prompt,
      task: params.task,
    });
  }

  const controller = new AbortController();
  const isResume = Boolean(params.executionId && params.resumeToken);
  let terminal = false;
  let sequence = Math.max(execution.checkpointVersion, 0);
  let checkpointChain = Promise.resolve();
  const checkpoint = (stage: AiExecutionCheckpoint["stage"], detail?: string) => {
    checkpointChain = checkpointChain.then(async () => {
      if (terminal) return;
      sequence += 1;
      const payload: AiExecutionCheckpoint = {
        stage,
        sequence,
        ...(detail ? { detail: detail.slice(0, 240) } : {}),
        proofRequired: false,
        updatedAt: new Date().toISOString(),
      };
      const saved = await checkpointAiExecution({
        executionId: execution!.id,
        workerId,
        checkpoint: payload,
      });
      if (!saved && !terminal) controller.abort();
    });
    return checkpointChain;
  };

  registerAiExecutionController(execution.id, controller);
  const heartbeat = setInterval(() => {
    if (terminal || controller.signal.aborted) return;
    void heartbeatAiExecution({
      executionId: execution!.id,
      workerId,
    }).then((renewed) => {
      if (!renewed && !terminal) controller.abort();
    });
  }, AI_EXECUTION_HEARTBEAT_INTERVAL_MS);

  const persistAssistant = async (message: {
    content: string;
    outcome: "SUCCEEDED" | "FAILED" | "INTERRUPTED";
    errorCode?: string;
    errorMessage?: string;
    toolTrace?: string;
  }): Promise<string> => {
    const id = randomUUID();
    await db.transaction(async (tx) => {
      await tx.insert(aiChatMessagesTable).values({
        id,
        sessionId: execution!.sessionId!,
        role: "assistant",
        content: message.content,
        toolTrace: message.toolTrace ?? null,
        executionId: execution!.id,
        outcome: message.outcome,
        errorCode: message.errorCode ?? null,
        errorMessage: message.errorMessage ?? null,
        turnIntent,
        createdAt: new Date(),
      });
      await tx.update(aiChatSessionsTable)
        .set({ updatedAt: new Date() })
        .where(eq(aiChatSessionsTable.id, execution!.sessionId!));
    });
    return id;
  };

  const cleanup = () => {
    clearInterval(heartbeat);
    unregisterAiExecutionController(execution!.id, controller);
  };

  const complete = async (message: { messageId: string; content: string }) => {
    await checkpoint("finalizing", "Persisting structured result");
    terminal = true;
    cleanup();
    return completeAiExecution({
      executionId: execution!.id,
      workerId,
      finalMessageId: message.messageId,
      finalMessageContent: message.content,
      proofRequired: false,
    });
  };

  const fail = async (failure: {
    messageId: string;
    error: string;
    errorCode: string;
    cancelled?: boolean;
    providerAttempts?: AiProviderAttemptCheckpoint[];
    retryAfterMs?: number;
  }) => {
    terminal = true;
    cleanup();
    return failAiExecution({
      executionId: execution!.id,
      workerId,
      finalMessageId: failure.messageId,
      finalMessageErrorCode: failure.errorCode,
      error: failure.error,
      cancelled: failure.cancelled,
      providerAttempts: failure.providerAttempts,
      retryAfterMs: failure.retryAfterMs,
      // Structured Retry creates a new execution. A terminal provider/model
      // failure is therefore not a resumable continuation; only a paused
      // execution recovered with its resume token is a real Resume.
      resumable: false,
    });
  };

  return {
    started: {
      executionId: execution.id,
      sessionId: execution.sessionId!,
      ...(resumeToken ? { resumeToken } : {}),
      resumable: isResume,
    },
    execution,
    workerId,
    checkpoint,
    persistAssistant,
    complete,
    fail,
    onClientClose: () => {
      if (!terminal) void checkpoint("client_disconnected", "SSE client disconnected");
    },
    cleanup,
  };
}