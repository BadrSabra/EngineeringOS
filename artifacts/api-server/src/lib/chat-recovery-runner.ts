import type { Request, Response } from "express";
import {
  getAiExecutionForUser,
  hasAiExecutionResumeContract,
  parseExecutionRequest,
  recoverAiExecutionRetryToken,
  recoverAiExecutionResumeToken,
} from "./ai-execution-state.js";
import {
  finalizeChatEvidenceRecovery,
  handleChatStream,
} from "../routes/ai/chat.js";

type InternalResponse = Response & {
  recoveryStatusCode: number;
};

type ResponseStub = {
  recoveryStatusCode: number;
  statusCode: number;
  headersSent: boolean;
  writableEnded: boolean;
  destroyed: boolean;
  status(code: number): ResponseStub;
  setHeader(name: string, value: unknown): ResponseStub;
  flushHeaders(): ResponseStub;
  write(chunk: unknown): boolean;
  json(value: unknown): ResponseStub;
  end(): ResponseStub;
  on(event: string, listener: (...args: unknown[]) => void): ResponseStub;
  once(event: string, listener: (...args: unknown[]) => void): ResponseStub;
};

function createInternalResponse(): InternalResponse {
  const listeners = new Map<string, Array<(...args: unknown[]) => void>>();
  const response: ResponseStub = {
    recoveryStatusCode: 200,
    statusCode: 200,
    headersSent: false,
    writableEnded: false,
    destroyed: false,
    status(code: number) {
      this.statusCode = code;
      this.recoveryStatusCode = code;
      return this;
    },
    setHeader(_name: string, _value: unknown) {
      return this;
    },
    flushHeaders() {
      this.headersSent = true;
      return this;
    },
    write() {
      if (this.writableEnded) return false;
      this.headersSent = true;
      return true;
    },
    json() {
      this.headersSent = true;
      this.end();
      return this;
    },
    end() {
      if (this.writableEnded) return this;
      this.writableEnded = true;
      this.headersSent = true;
      for (const listener of listeners.get("close") ?? []) listener();
      return this;
    },
    on(event: string, listener: (...args: unknown[]) => void) {
      const existing = listeners.get(event) ?? [];
      existing.push(listener);
      listeners.set(event, existing);
      return this;
    },
    once(event: string, listener: (...args: unknown[]) => void) {
      const wrapped = (...args: unknown[]) => {
        const existing = listeners.get(event) ?? [];
        listeners.set(event, existing.filter((entry) => entry !== wrapped));
        listener(...args);
      };
      const existing = listeners.get(event) ?? [];
      existing.push(wrapped);
      listeners.set(event, existing);
      return this;
    },
  };
  return response as unknown as InternalResponse;
}

type RecoveryRequest = Request & {
  userId: string;
  body: Record<string, unknown>;
  query: Record<string, never>;
  headers: Record<string, string>;
  log?: { error?: (...args: unknown[]) => void };
};

/**
 * Server-owned chat continuation. It deliberately delegates to the same
 * stream handler used by HTTP clients, with a response sink that discards SSE
 * transport while retaining all durable execution and acceptance writes.
 * Parser failures and transient provider failures use the same bounded
 * continuation seam; admission remains owned by the recovery coordinator.
 */
export async function runChatExecutionRecovery(params: {
  executionId: string;
  userId: string;
  mode?: "resume" | "retry";
}): Promise<{ ok: boolean; reason?: string; statusCode?: number }> {
  const execution = await getAiExecutionForUser(params.executionId, params.userId);
  if (!execution) return { ok: false, reason: "execution_not_found" };

  const request = parseExecutionRequest(execution.request);
  if (
    !request
    || !request.sessionId
    || (request.turnIntent !== "CHAT" && !hasAiExecutionResumeContract(request))
  ) {
    return { ok: false, reason: "execution_not_resumable" };
  }

  const recovered = params.mode === "retry"
    ? await recoverAiExecutionRetryToken({
        executionId: execution.id,
        userId: params.userId,
        expectedAttempt: execution.attempt,
      })
    : await recoverAiExecutionResumeToken({
        executionId: execution.id,
        userId: params.userId,
        expectedAttempt: execution.attempt,
      });
  if (!recovered) return { ok: false, reason: "resume_claim_conflict" };

  const response = createInternalResponse();
  const body: Record<string, unknown> = {
    projectId: request.projectId,
    message: request.message,
    sessionId: request.sessionId,
    executionId: execution.id,
    resumeToken: recovered.resumeToken,
  };
  if (request.linkedTaskId) body.linkedTaskId = request.linkedTaskId;
  if (request.buildPlanMessageId) body.buildPlanMessageId = request.buildPlanMessageId;
  if (request.objective !== undefined) body.objective = request.objective;

  const req = {
    userId: params.userId,
    body,
    query: {},
    headers: {},
    log: {
      error: () => undefined,
    },
  } as unknown as RecoveryRequest;

  await handleChatStream(req, response);
  return {
    ok: response.recoveryStatusCode < 400,
    statusCode: response.recoveryStatusCode,
    ...(response.recoveryStatusCode >= 400 ? { reason: "chat_recovery_handler_rejected" } : {}),
  };
}

export async function runChatEvidenceRecoveryFinalization(params: {
  executionId: string;
  userId: string;
}): Promise<{ ok: boolean; reason?: string; readCount?: number }> {
  return finalizeChatEvidenceRecovery(params);
}