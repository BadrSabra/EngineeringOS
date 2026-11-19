import type { Request, Response } from "express";
import { and, eq, inArray, sql } from "drizzle-orm";
import {
  aiExecutionAcceptancesTable,
  aiExecutionsTable,
  db,
} from "@workspace/db";
import {
  getAiExecutionForUser,
  hasAiExecutionResumeContract,
  parseExecutionRequest,
  recoverAiExecutionRetryToken,
  recoverAiExecutionResumeToken,
} from "./ai-execution-state.js";
import {
  finalizeChatRecoveryExhaustion,
  handleChatStream,
} from "../routes/ai/chat.js";

export type DatabaseRetryWindowDecision = "due" | "not_due" | "invalid";

/**
 * A persisted retry deadline is compared to the database clock, not the API
 * host clock. Invalid metadata fails closed.
 */
export function evaluateRetryWindowAtDatabaseTime(
  retryAt: unknown,
  databaseNowMs: number,
): DatabaseRetryWindowDecision {
  if (!Number.isFinite(databaseNowMs)) return "invalid";
  if (retryAt === undefined) return "due";
  if (typeof retryAt !== "string") return "invalid";
  const retryAtMs = Date.parse(retryAt);
  if (!Number.isFinite(retryAtMs)) return "invalid";
  return retryAtMs <= databaseNowMs ? "due" : "not_due";
}

type InternalResponse = Response & {
  recoveryStatusCode: number;
  recoveryBody?: unknown;
  recoveryErrorCode?: string;
};

type ResponseStub = {
  recoveryStatusCode: number;
  recoveryBody?: unknown;
  recoveryErrorCode?: string;
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
    write(chunk: unknown) {
      if (this.writableEnded) return false;
      this.headersSent = true;
      if (typeof chunk === "string") {
        for (const line of chunk.split(/\r?\n/)) {
          if (!line.startsWith("data:")) continue;
          try {
            const event = JSON.parse(line.slice("data:".length).trim()) as {
              type?: unknown;
              code?: unknown;
            };
            if (
              event.type === "error"
              && typeof event.code === "string"
              && /^[A-Z][A-Z0-9_]{2,63}$/.test(event.code)
            ) {
              this.recoveryErrorCode = event.code;
            }
          } catch {
            // Non-JSON SSE frames do not carry a recovery gate code.
          }
        }
      }
      return true;
    },
    json(value: unknown) {
      this.recoveryBody = value;
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

export function parseChatRecoveryRetryAfterSeconds(body: unknown): number | undefined {
  if (!body || typeof body !== "object" || Array.isArray(body)) return undefined;
  const record = body as Record<string, unknown>;
  const message = [record.error, record.hint]
    .filter((value): value is string => typeof value === "string")
    .join(" ");
  const match = message.match(/(?:retry in|try again in)\s+(\d+(?:\.\d+)?)\s*s(?:ec(?:ond)?s?)?/i);
  if (!match) return undefined;
  const seconds = Number(match[1]);
  return Number.isFinite(seconds) && seconds >= 0 ? seconds : undefined;
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
  expectedAttempt: number;
  mode?: "resume" | "retry";
}): Promise<{
  ok: boolean;
  reason?: string;
  failureCode?: string;
  statusCode?: number;
  retryAfterSec?: number;
}> {
  const execution = await getAiExecutionForUser(params.executionId, params.userId);
  if (!execution) return { ok: false, reason: "execution_not_found" };
  if (execution.attempt !== params.expectedAttempt) {
    return { ok: false, reason: "execution_attempt_changed" };
  }

  const request = parseExecutionRequest(execution.request);
  if (
    !request
    || !request.sessionId
    || (request.turnIntent !== "CHAT" && !hasAiExecutionResumeContract(request))
  ) {
    return { ok: false, reason: "execution_not_resumable" };
  }

  const recovered = params.mode === "retry"
    ? await db.transaction(async (tx) => {
        // Lock the exact execution/acceptance pair, then compare the durable
        // retryAt to PostgreSQL time before the helper rotates its capability.
        const [lockedExecution] = await tx
          .select({
            databaseNow: sql<string>`clock_timestamp()::text`,
          })
          .from(aiExecutionsTable)
          .where(and(
            eq(aiExecutionsTable.id, execution.id),
            eq(aiExecutionsTable.userId, params.userId),
            eq(aiExecutionsTable.attempt, params.expectedAttempt),
            inArray(aiExecutionsTable.status, ["paused", "failed"]),
          ))
          .for("update")
          .limit(1);
        if (!lockedExecution) return { kind: "conflict" as const };

        const [acceptance] = await tx
          .select({ disposition: aiExecutionAcceptancesTable.disposition })
          .from(aiExecutionAcceptancesTable)
          .where(and(
            eq(aiExecutionAcceptancesTable.executionId, execution.id),
            eq(aiExecutionAcceptancesTable.attempt, params.expectedAttempt),
          ))
          .for("update")
          .limit(1);
        const disposition = acceptance?.disposition;
        const retryAt = disposition && typeof disposition === "object" && !Array.isArray(disposition)
          ? (disposition as Record<string, unknown>).retryAt
          : undefined;
        const databaseNowMs = Date.parse(lockedExecution.databaseNow);
        const retryWindow = evaluateRetryWindowAtDatabaseTime(retryAt, databaseNowMs);
        if (retryWindow === "not_due") return { kind: "not_due" as const };
        if (retryWindow === "invalid") return { kind: "conflict" as const };

        const recovered = await recoverAiExecutionRetryToken({
          executionId: execution.id,
          userId: params.userId,
          expectedAttempt: params.expectedAttempt,
          transaction: tx,
        });
        return recovered
          ? { kind: "recovered" as const, recovered }
          : { kind: "conflict" as const };
      })
    : {
        kind: "recovered" as const,
        recovered: await recoverAiExecutionResumeToken({
          executionId: execution.id,
          userId: params.userId,
          expectedAttempt: execution.attempt,
        }),
      };
  if (recovered.kind === "not_due") {
    return { ok: false, reason: "retry_not_due" };
  }
  if (recovered.kind !== "recovered" || !recovered.recovered) {
    return { ok: false, reason: "resume_claim_conflict" };
  }
  const recoveredToken = recovered.recovered;

  const response = createInternalResponse();
  const body: Record<string, unknown> = {
    projectId: request.projectId,
    message: request.message,
    sessionId: request.sessionId,
    executionId: execution.id,
    resumeToken: recoveredToken.resumeToken,
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
  if (response.recoveryStatusCode >= 400) {
    return {
      ok: false,
      statusCode: response.recoveryStatusCode,
      ...(response.recoveryStatusCode === 429
        ? { retryAfterSec: parseChatRecoveryRetryAfterSeconds(response.recoveryBody) }
        : {}),
      reason: "chat_recovery_handler_rejected",
    };
  }
  const completedExecution = await getAiExecutionForUser(execution.id, params.userId);
  if (
    !completedExecution
    || completedExecution.attempt !== recoveredToken.execution.attempt + 1
    || completedExecution.status !== "completed"
  ) {
    return {
      ok: false,
      statusCode: response.recoveryStatusCode,
      reason: "chat_recovery_not_completed",
      ...(response.recoveryErrorCode ? { failureCode: response.recoveryErrorCode } : {}),
    };
  }
  return {
    ok: true,
    statusCode: response.recoveryStatusCode,
  };
}

export async function runChatRecoveryExhaustionFinalization(params: {
  executionId: string;
  userId: string;
  expectedAttempt: number;
}): Promise<{ ok: boolean; reason?: string; readCount?: number }> {
  return finalizeChatRecoveryExhaustion(params);
}