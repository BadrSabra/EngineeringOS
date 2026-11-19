import { randomUUID } from "node:crypto";
import { afterEach, describe, expect, it, vi } from "vitest";
import request from "supertest";
import { and, eq, sql } from "drizzle-orm";
import {
  aiGeneralChatMessagesTable,
  aiGeneralChatSessionsTable,
  db,
} from "@workspace/db";
import app from "../../app.js";
import * as aiRouteHelpers from "../../lib/ai-route-helpers.js";

const sessionIds: string[] = [];

async function seedPendingTurn(leaseState: "active" | "expired") {
  const sessionId = randomUUID();
  const turnId = randomUUID();
  sessionIds.push(sessionId);

  await db.insert(aiGeneralChatSessionsTable).values({
    id: sessionId,
    ownerId: "test-user",
    title: "Lease test",
  });
  await db.insert(aiGeneralChatMessagesTable).values({
    id: randomUUID(),
    sessionId,
    turnId,
    role: "user",
    content: "hello",
    status: "completed",
  });
  await db.insert(aiGeneralChatMessagesTable).values({
    id: randomUUID(),
    sessionId,
    turnId,
    role: "assistant",
    content: "",
    status: "pending",
    workerId: "previous-worker",
    leaseUntil: leaseState === "active"
      ? sql<Date>`(clock_timestamp() AT TIME ZONE 'UTC') + interval '5 minutes'`
      : sql<Date>`(clock_timestamp() AT TIME ZONE 'UTC') - interval '5 minutes'`,
  });

  return { sessionId, turnId };
}

async function postExistingTurn(sessionId: string, turnId: string) {
  return request(app)
    .post(`/api/ai/general-chat/sessions/${sessionId}/messages`)
    .send({ turnId, message: "hello" });
}

describe("General Chat database-authoritative turn leases", () => {
  afterEach(async () => {
    vi.useRealTimers();
    vi.restoreAllMocks();
    for (const sessionId of sessionIds.splice(0)) {
      await db.delete(aiGeneralChatSessionsTable)
        .where(eq(aiGeneralChatSessionsTable.id, sessionId));
    }
  });

  it("does not steal a lease that is still active in PostgreSQL when the API clock is ahead", async () => {
    const { sessionId, turnId } = await seedPendingTurn("active");
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2036-01-01T00:00:00.000Z"));

    const response = await postExistingTurn(sessionId, turnId);

    expect(response.status).toBe(409);
    expect(response.body).toMatchObject({ code: "TURN_IN_PROGRESS" });
  });

  it("reclaims a lease expired in PostgreSQL when the API clock is behind", async () => {
    const { sessionId, turnId } = await seedPendingTurn("expired");
    const resolveProvider = vi.spyOn(aiRouteHelpers, "resolveProvider")
      .mockResolvedValue(undefined);
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2010-01-01T00:00:00.000Z"));

    const response = await postExistingTurn(sessionId, turnId);

    expect(resolveProvider).toHaveBeenCalledOnce();
    expect(response.status).toBe(200);
    expect(response.body.assistantMessage).toMatchObject({
      status: "failed",
      errorCode: "AI_PROVIDER_UNAVAILABLE",
    });
  });
});


describe("General Chat turn lease heartbeat", () => {
  afterEach(async () => {
    vi.useRealTimers();
    vi.restoreAllMocks();
    for (const sessionId of sessionIds.splice(0)) {
      await db.delete(aiGeneralChatSessionsTable)
        .where(eq(aiGeneralChatSessionsTable.id, sessionId));
    }
  });

  async function createSession() {
    const sessionId = randomUUID();
    sessionIds.push(sessionId);
    await db.insert(aiGeneralChatSessionsTable).values({
      id: sessionId,
      ownerId: "test-user",
      title: "Heartbeat test",
    });
    return sessionId;
  }

  async function loadAssistantMessage(sessionId: string, turnId: string) {
    const [message] = await db.select()
      .from(aiGeneralChatMessagesTable)
      .where(and(
        eq(aiGeneralChatMessagesTable.sessionId, sessionId),
        eq(aiGeneralChatMessagesTable.turnId, turnId),
        eq(aiGeneralChatMessagesTable.role, "assistant"),
      ));
    return message;
  }

  it("renews the database lease while a provider response is still running", async () => {
    const sessionId = await createSession();
    const turnId = randomUUID();
    let markProviderStarted!: () => void;
    const providerStarted = new Promise<void>((resolve) => {
      markProviderStarted = resolve;
    });
    let finishProvider!: (value: {
      result: { content: string };
      effectiveProvider: "groq";
    }) => void;
    const providerWork = new Promise<{
      result: { content: string };
      effectiveProvider: "groq";
    }>((resolve) => {
      finishProvider = resolve;
    });

    vi.spyOn(aiRouteHelpers, "resolveProvider").mockResolvedValue({
      provider: "groq",
      apiKey: "test-only-key",
      source: "user",
    });
    const runAgent = vi.spyOn(aiRouteHelpers, "runAgentWithFallback")
      .mockImplementation((() => {
        markProviderStarted();
        return providerWork;
      }) as never);
    vi.useFakeTimers({ toFake: ["setInterval", "clearInterval"] });

    const responsePromise = request(app)
      .post(`/api/ai/general-chat/sessions/${sessionId}/messages`)
      .send({ turnId, message: "hello" });
    await providerStarted;

    const assistant = await loadAssistantMessage(sessionId, turnId);
    expect(assistant?.status).toBe("pending");
    expect(assistant?.leaseUntil).toBeInstanceOf(Date);

    await db.update(aiGeneralChatMessagesTable)
      .set({
        leaseUntil: sql<Date>`(clock_timestamp() AT TIME ZONE 'UTC') + interval '30 seconds'`,
      })
      .where(eq(aiGeneralChatMessagesTable.id, assistant!.id));
    const [beforeHeartbeat] = await db.select()
      .from(aiGeneralChatMessagesTable)
      .where(eq(aiGeneralChatMessagesTable.id, assistant!.id));

    await vi.advanceTimersByTimeAsync(20_000);

    let afterHeartbeat = beforeHeartbeat;
    for (let attempt = 0; attempt < 20; attempt += 1) {
      [afterHeartbeat] = await db.select()
        .from(aiGeneralChatMessagesTable)
        .where(eq(aiGeneralChatMessagesTable.id, assistant!.id));
      if (afterHeartbeat!.leaseUntil!.getTime() > beforeHeartbeat!.leaseUntil!.getTime()) {
        break;
      }
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
    expect(afterHeartbeat!.leaseUntil!.getTime())
      .toBeGreaterThan(beforeHeartbeat!.leaseUntil!.getTime());

    finishProvider({
      result: { content: "The response completed." },
      effectiveProvider: "groq",
    });
    const response = await responsePromise;

    expect(runAgent).toHaveBeenCalledOnce();
    expect(response.status).toBe(200);
    expect(response.body.assistantMessage).toMatchObject({
      status: "completed",
      content: "The response completed.",
    });
    expect(vi.getTimerCount()).toBe(0);
  });

  it("aborts provider work when the worker no longer owns the pending turn", async () => {
    const sessionId = await createSession();
    const turnId = randomUUID();
    let markProviderStarted!: () => void;
    const providerStarted = new Promise<void>((resolve) => {
      markProviderStarted = resolve;
    });
    let providerSignal: AbortSignal | undefined;

    vi.spyOn(aiRouteHelpers, "resolveProvider").mockResolvedValue({
      provider: "groq",
      apiKey: "test-only-key",
      source: "user",
    });
    const runAgent = vi.spyOn(aiRouteHelpers, "runAgentWithFallback")
      .mockImplementation(((
        _userId: Parameters<typeof aiRouteHelpers.runAgentWithFallback>[0],
        _provider: Parameters<typeof aiRouteHelpers.runAgentWithFallback>[1],
        _run: Parameters<typeof aiRouteHelpers.runAgentWithFallback>[2],
        options: Parameters<typeof aiRouteHelpers.runAgentWithFallback>[3],
      ) => {
        providerSignal = options?.signal;
        markProviderStarted();
        return new Promise((_resolve, reject) => {
          if (providerSignal?.aborted) {
            reject(new Error("provider aborted"));
            return;
          }
          providerSignal?.addEventListener(
            "abort",
            () => reject(new Error("provider aborted")),
            { once: true },
          );
        });
      }) as never);
    vi.useFakeTimers({ toFake: ["setInterval", "clearInterval"] });

    const responsePromise = request(app)
      .post(`/api/ai/general-chat/sessions/${sessionId}/messages`)
      .send({ turnId, message: "hello" });
    await providerStarted;

    const assistant = await loadAssistantMessage(sessionId, turnId);
    expect(assistant?.status).toBe("pending");
    await db.update(aiGeneralChatMessagesTable)
      .set({ workerId: "replacement-worker" })
      .where(eq(aiGeneralChatMessagesTable.id, assistant!.id));

    await vi.advanceTimersByTimeAsync(20_000);
    const response = await responsePromise;

    expect(runAgent).toHaveBeenCalledOnce();
    expect(providerSignal?.aborted).toBe(true);
    expect(response.status).toBe(409);
    expect(response.body.error).toBe("The conversation turn is no longer owned.");
  });
});
