import { randomUUID } from "node:crypto";
import { afterEach, describe, expect, it, vi } from "vitest";
import { eq, sql } from "drizzle-orm";
import {
  aiChatMessagesTable,
  aiChatSessionsTable,
  aiExecutionAcceptancesTable,
  aiExecutionsTable,
  db,
  projectsTable,
} from "@workspace/db";
import { startStructuredExecution } from "./structured-task-execution.js";

async function createStructuredExecutionFixture(providerName = "Groq") {
  const projectId = randomUUID();
  const userId = `structured-clock-${projectId}`;
  const now = new Date();

  await db.insert(projectsTable).values({
    id: projectId,
    ownerId: userId,
    name: `structured-clock-${projectId.slice(0, 8)}`,
    rootPath: `/tmp/structured-clock-${projectId}`,
    language: "typescript",
    status: "active",
    createdAt: now,
    updatedAt: now,
  });

  const execution = await startStructuredExecution({
    userId,
    projectId,
    projectRevision: "fixture-project-revision",
    task: "analyze",
    prompt: "Verify database-owned lease time.",
    providerName,
  });

  return { projectId, userId, execution };
}

async function removeStructuredExecutionFixture(
  fixture: Awaited<ReturnType<typeof createStructuredExecutionFixture>>,
  removeProject = true,
) {
  const executionId = fixture.execution.execution.id;
  const sessionId = fixture.execution.started.sessionId;
  fixture.execution.cleanup();

  await db.delete(aiExecutionAcceptancesTable)
    .where(eq(aiExecutionAcceptancesTable.executionId, executionId));
  await db.delete(aiChatMessagesTable)
    .where(eq(aiChatMessagesTable.sessionId, sessionId));
  await db.delete(aiExecutionsTable)
    .where(eq(aiExecutionsTable.id, executionId));
  await db.delete(aiChatSessionsTable)
    .where(eq(aiChatSessionsTable.id, sessionId));
  if (removeProject) {
    await db.delete(projectsTable)
      .where(eq(projectsTable.id, fixture.projectId));
  }
}

async function persistStructuredProviderCooldown(
  fixture: Awaited<ReturnType<typeof createStructuredExecutionFixture>>,
  retryOffsetMs: number,
): Promise<string> {
  const clockResult = await db.execute(sql`SELECT clock_timestamp() AS "databaseNow"`);
  const clockValue = clockResult.rows[0]?.databaseNow;
  const databaseNow = clockValue instanceof Date
    ? clockValue
    : new Date(String(clockValue));
  if (!Number.isFinite(databaseNow.getTime())) {
    throw new Error("Could not read PostgreSQL time for the cooldown fixture.");
  }
  const retryAt = new Date(databaseNow.getTime() + retryOffsetMs).toISOString();
  const messageId = await fixture.execution.persistAssistant({
    content: "Provider temporarily unavailable.",
    outcome: "FAILED",
    errorCode: "RATE_LIMITED",
  });
  const accepted = await fixture.execution.fail({
    messageId,
    error: "Provider temporarily unavailable.",
    errorCode: "RATE_LIMITED",
    providerAttempts: [{ provider: "Groq", code: "RATE_LIMITED" }],
    retryAfterMs: 30_000,
    retryAt,
    disposition: {
      failureKind: "RATE_LIMIT",
      retryAfterSource: "provider",
      rateLimitScope: "provider_credential",
    },
  });
  if (!accepted) throw new Error("Could not persist the provider cooldown fixture.");
  return retryAt;
}

describe("structured execution lease clock", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("keeps a live lease valid when the API clock is 24 hours ahead", async () => {
    const fixture = await createStructuredExecutionFixture();
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date(Date.now() + 24 * 60 * 60 * 1_000));

    try {
      await expect(fixture.execution.isCurrentOwner()).resolves.toBe(true);
      const messageId = await fixture.execution.persistAssistant({
        content: "Structured analysis result.",
        outcome: "SUCCEEDED",
      });
      expect(messageId).toMatch(/^[0-9a-f-]{36}$/iu);
    } finally {
      await removeStructuredExecutionFixture(fixture);
    }
  });

  it("does not allow a future provider cooldown when the API clock is 24 hours ahead", async () => {
    const fixture = await createStructuredExecutionFixture("Groq");
    const retryAt = await persistStructuredProviderCooldown(fixture, 30_000);
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date(Date.now() + 24 * 60 * 60 * 1_000));

    try {
      await expect(startStructuredExecution({
        userId: fixture.userId,
        projectId: fixture.projectId,
        projectRevision: "fixture-project-revision",
        task: "analyze",
        prompt: "The provider cooldown must still be active.",
        providerName: "Groq",
      })).rejects.toMatchObject({
        code: "RATE_LIMITED",
        retryAt,
        retryAfterMs: expect.any(Number),
      });
    } finally {
      await removeStructuredExecutionFixture(fixture);
    }
  });

  it("does not extend an expired provider cooldown when the API clock is 24 hours behind", async () => {
    const fixture = await createStructuredExecutionFixture("Groq");
    await persistStructuredProviderCooldown(fixture, -30_000);
    let replacement: Awaited<ReturnType<typeof startStructuredExecution>> | undefined;
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date(Date.now() - 24 * 60 * 60 * 1_000));

    try {
      replacement = await startStructuredExecution({
        userId: fixture.userId,
        projectId: fixture.projectId,
        projectRevision: "fixture-project-revision",
        task: "analyze",
        prompt: "The expired provider cooldown must not block this run.",
        providerName: "Groq",
      });
      expect(replacement.execution.id).not.toBe(fixture.execution.execution.id);
    } finally {
      if (replacement) {
        await removeStructuredExecutionFixture({
          projectId: fixture.projectId,
          userId: fixture.userId,
          execution: replacement,
        }, false);
      }
      await removeStructuredExecutionFixture(fixture);
    }
  });

  it("rejects an expired lease when the API clock is 24 hours behind", async () => {
    const fixture = await createStructuredExecutionFixture();
    await db.update(aiExecutionsTable)
      .set({
        leaseUntil: sql<Date>`(clock_timestamp() AT TIME ZONE 'UTC') - interval '1 second'`,
      })
      .where(eq(aiExecutionsTable.id, fixture.execution.execution.id));

    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date(Date.now() - 24 * 60 * 60 * 1_000));

    try {
      await expect(fixture.execution.isCurrentOwner()).resolves.toBe(false);

      await db.update(aiExecutionsTable)
        .set({
          status: "cancelling",
          cancelRequestedAt: sql<Date>`clock_timestamp() AT TIME ZONE 'UTC'`,
        })
        .where(eq(aiExecutionsTable.id, fixture.execution.execution.id));

      await expect(fixture.execution.isCancellationRequested()).resolves.toBe(false);
      await expect(fixture.execution.persistAssistant({
        content: "Must not be persisted after lease expiry.",
        outcome: "INTERRUPTED",
      })).rejects.toMatchObject({ code: "EXECUTION_OWNERSHIP_LOST" });
    } finally {
      await removeStructuredExecutionFixture(fixture);
    }
  });
});
