import { randomUUID } from "node:crypto";
import { afterEach, describe, expect, it, vi } from "vitest";
import request from "supertest";
import { eq, sql } from "drizzle-orm";
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

async function seedSearchConversation(
  ownerId: string,
  title: string,
  messages: Array<{
    content: string;
    role?: "user" | "assistant";
    status?: "pending" | "completed" | "failed";
    createdAt?: Date;
  }>,
) {
  const sessionId = randomUUID();
  sessionIds.push(sessionId);
  await db.insert(aiGeneralChatSessionsTable).values({
    id: sessionId,
    ownerId,
    title,
  });
  const messageRows = messages.map((message) => ({
    id: randomUUID(),
    sessionId,
    turnId: randomUUID(),
    role: message.role ?? "user",
    content: message.content,
    status: message.status ?? "completed",
    ...(message.createdAt ? { createdAt: message.createdAt } : {}),
  }));
  await db.insert(aiGeneralChatMessagesTable).values(messageRows);
  return sessionId;
}

describe("General Chat database-authoritative contracts", () => {
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

  it("searches only completed messages in the signed-in user's sessions and returns one safe excerpt per chat", async () => {
    const ownSessionId = await seedSearchConversation("test-user", "Owned conversation", [
      {
        content: "Needle marker appeared in an older user message.",
        role: "user",
        createdAt: new Date("2026-01-01T00:00:00.000Z"),
      },
      {
        content: "The latest Needle marker appears in this assistant reply; api_key=sk-or-v1-test-secret.",
        role: "assistant",
        createdAt: new Date("2026-01-02T00:00:00.000Z"),
      },
      { content: "Needle marker in a pending response.", status: "pending" },
      { content: "Needle marker in a failed response.", status: "failed" },
    ]);
    await seedSearchConversation("another-user", "Private conversation", [
      { content: "Needle marker in another user's conversation." },
    ]);

    const response = await request(app)
      .get(`/api/ai/general-chat/message-search?query=${encodeURIComponent("Needle marker")}`);
    expect(response.status, JSON.stringify(response.body)).toBe(200);

    expect(response.body).toHaveLength(1);
    expect(response.body[0]).toMatchObject({
      sessionId: ownSessionId,
      sessionTitle: "Owned conversation",
      role: "assistant",
    });
    expect(response.body[0].snippet).toContain("Needle marker");
    expect(response.body[0].snippet).toContain("[redacted credential]");
    expect(response.body[0].snippet).not.toContain("sk-or-v1-test-secret");
    expect(response.body[0]).not.toHaveProperty("content");
    expect(response.body[0]).not.toHaveProperty("errorMessage");
  });

  it("treats SQL wildcard characters in message-search text literally", async () => {
    const literalSessionId = await seedSearchConversation("test-user", "Literal symbols", [
      { content: "Find this literal pattern: 50%_marker." },
    ]);
    await seedSearchConversation("test-user", "Wildcard decoy", [
      { content: "This decoy has 50X_marker instead." },
    ]);

    const response = await request(app)
      .get(`/api/ai/general-chat/message-search?query=${encodeURIComponent("%_marker")}`);
    expect(response.status, JSON.stringify(response.body)).toBe(200);

    expect(response.body).toHaveLength(1);
    expect(response.body[0].sessionId).toBe(literalSessionId);
  });

  it("rejects missing, blank, too-short, and oversized message-search queries", async () => {
    await request(app).get("/api/ai/general-chat/message-search").expect(400);
    await request(app).get("/api/ai/general-chat/message-search?query=a").expect(400);
    await request(app).get("/api/ai/general-chat/message-search?query=%20%20").expect(400);
    await request(app)
      .get(`/api/ai/general-chat/message-search?query=${"x".repeat(121)}`)
      .expect(400);
  });
});
