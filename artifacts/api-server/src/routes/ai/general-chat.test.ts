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
