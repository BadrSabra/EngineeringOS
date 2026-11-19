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
import { startGeneralChatTurnLeaseHeartbeat } from "./general-chat.js";

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
  it("renews a pending turn lease while provider work is still running", async () => {
    const { sessionId, turnId } = await seedPendingTurn("active");
    const [assistant] = await db.select().from(aiGeneralChatMessagesTable)
      .where(and(
        eq(aiGeneralChatMessagesTable.sessionId, sessionId),
        eq(aiGeneralChatMessagesTable.role, "assistant"),
      ));
    expect(assistant).toBeDefined();
    await db.update(aiGeneralChatMessagesTable)
      .set({ leaseUntil: sql<Date>`(clock_timestamp() AT TIME ZONE 'UTC') + interval '5 seconds'` })
      .where(eq(aiGeneralChatMessagesTable.id, assistant!.id));
    const [beforeHeartbeat] = await db.select().from(aiGeneralChatMessagesTable)
      .where(eq(aiGeneralChatMessagesTable.id, assistant!.id));
    const abortController = new AbortController();
    const heartbeat = startGeneralChatTurnLeaseHeartbeat({
      assistantMessageId: assistant!.id,
      workerId: "previous-worker",
      sessionId,
      turnId,
      abortController,
    }, 15);
    try {
      const deadline = Date.now() + 1_500;
      let afterHeartbeat = beforeHeartbeat;
      while (Date.now() < deadline) {
        [afterHeartbeat] = await db.select().from(aiGeneralChatMessagesTable)
          .where(eq(aiGeneralChatMessagesTable.id, assistant!.id));
        if (afterHeartbeat!.leaseUntil!.getTime() > beforeHeartbeat!.leaseUntil!.getTime()) break;
        await new Promise((resolve) => setTimeout(resolve, 10));
      }
      expect(afterHeartbeat!.leaseUntil!.getTime())
        .toBeGreaterThan(beforeHeartbeat!.leaseUntil!.getTime());
      expect(abortController.signal.aborted).toBe(false);
    } finally {
      clearInterval(heartbeat);
    }
  });

  it("aborts provider work when a replacement worker takes ownership of the pending turn", async () => {
    const { sessionId, turnId } = await seedPendingTurn("active");
    const [assistant] = await db.select().from(aiGeneralChatMessagesTable)
      .where(and(
        eq(aiGeneralChatMessagesTable.sessionId, sessionId),
        eq(aiGeneralChatMessagesTable.role, "assistant"),
      ));
    expect(assistant).toBeDefined();
    await db.update(aiGeneralChatMessagesTable)
      .set({ workerId: "replacement-worker" })
      .where(eq(aiGeneralChatMessagesTable.id, assistant!.id));

    const abortController = new AbortController();
    const heartbeat = startGeneralChatTurnLeaseHeartbeat({
      assistantMessageId: assistant!.id,
      workerId: "previous-worker",
      sessionId,
      turnId,
      abortController,
    }, 15);
    try {
      await new Promise<void>((resolve, reject) => {
        const timeout = setTimeout(() => reject(new Error("heartbeat did not detect ownership loss")), 1_500);
        abortController.signal.addEventListener("abort", () => {
          clearTimeout(timeout);
          resolve();
        }, { once: true });
      });
      expect(abortController.signal.aborted).toBe(true);
    } finally {
      clearInterval(heartbeat);
    }
  });

});
