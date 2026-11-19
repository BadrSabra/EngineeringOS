import { randomUUID } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  aiChangeProposalsTable,
  aiChatMessagesTable,
  aiChatSessionsTable,
  aiExecutionsTable,
  aiShadowReplaysTable,
  db,
  projectsTable,
} from "@workspace/db";
import {
  shadowReplayDatabaseLeaseUntil,
  shadowReplayLeaseIsExpired,
  shadowReplayLeaseIsLive,
} from "./shadow-replay-lease.js";

const CLOCK_SKEW_MS = 24 * 60 * 60 * 1_000;

type Fixture = {
  projectId: string;
  sessionId: string;
  messageId: string;
  proposalId: string;
  executionId: string;
  replayId: string;
};

async function insertReplayFixture(leaseOffsetMs: number): Promise<Fixture> {
  const fixture = {
    projectId: randomUUID(),
    sessionId: randomUUID(),
    messageId: randomUUID(),
    proposalId: randomUUID(),
    executionId: randomUUID(),
    replayId: randomUUID(),
  };
  const now = new Date();

  try {
    await db.insert(projectsTable).values({
      id: fixture.projectId,
      ownerId: "shadow-replay-lease-test",
      name: "shadow-replay-lease-test",
      rootPath: `/tmp/shadow-replay-lease-${fixture.projectId}`,
      language: "typescript",
      status: "active",
      createdAt: now,
      updatedAt: now,
    });
    await db.insert(aiChatSessionsTable).values({
      id: fixture.sessionId,
      projectId: fixture.projectId,
      title: "shadow-replay-lease-test",
      createdAt: now,
      updatedAt: now,
    });
    await db.insert(aiChatMessagesTable).values({
      id: fixture.messageId,
      sessionId: fixture.sessionId,
      role: "assistant",
      content: "Shadow Replay lease test fixture",
      createdAt: now,
    });
    await db.insert(aiChangeProposalsTable).values({
      id: fixture.proposalId,
      projectId: fixture.projectId,
      sessionId: fixture.sessionId,
      messageId: fixture.messageId,
      changes: "[]",
      createdAt: now,
    });
    await db.insert(aiExecutionsTable).values({
      id: fixture.executionId,
      projectId: fixture.projectId,
      sessionId: fixture.sessionId,
      userId: "shadow-replay-lease-test",
      idempotencyKey: `shadow-replay-lease:${fixture.executionId}`,
      resumeTokenHash: "test-resume-token-hash",
      request: "{}",
      status: "running",
      createdAt: now,
      updatedAt: now,
    });
    await db.insert(aiShadowReplaysTable).values({
      id: fixture.replayId,
      executionId: fixture.executionId,
      projectId: fixture.projectId,
      proposalId: fixture.proposalId,
      userId: "shadow-replay-lease-test",
      idempotencyKey: `shadow-replay-lease:${fixture.replayId}`,
      operationId: "shadow-replay-lease-operation",
      candidateId: "shadow-replay-lease-candidate",
      canonicalAcceptanceId: "source-acceptance",
      trajectoryDigest: "trajectory-digest",
      sourceRevision: "source-revision",
      candidateTreeHash: "candidate-tree-hash",
      sourceWorkspaceRoot: `/tmp/shadow-replay-lease-${fixture.projectId}`,
      status: "running",
      attempt: 0,
      workerId: "current-worker",
      leaseUntil: shadowReplayDatabaseLeaseUntil(leaseOffsetMs),
      createdAt: now,
      updatedAt: now,
    });
    return fixture;
  } catch (error) {
    await removeReplayFixture(fixture);
    throw error;
  }
}

async function removeReplayFixture(fixture: Fixture): Promise<void> {
  await db.delete(aiShadowReplaysTable).where(eq(aiShadowReplaysTable.id, fixture.replayId));
  await db.delete(aiExecutionsTable).where(eq(aiExecutionsTable.id, fixture.executionId));
  await db.delete(aiChangeProposalsTable).where(eq(aiChangeProposalsTable.id, fixture.proposalId));
  await db.delete(aiChatMessagesTable).where(eq(aiChatMessagesTable.id, fixture.messageId));
  await db.delete(aiChatSessionsTable).where(eq(aiChatSessionsTable.id, fixture.sessionId));
  await db.delete(projectsTable).where(eq(projectsTable.id, fixture.projectId));
}

afterEach(() => {
  vi.useRealTimers();
});

describe("Shadow Replay database lease clock", () => {
  it("keeps a live database lease valid when the API clock is 24 hours ahead", async () => {
    const fixture = await insertReplayFixture(60_000);
    try {
      const localNow = Date.now();
      vi.useFakeTimers({ toFake: ["Date"] });
      vi.setSystemTime(new Date(localNow + CLOCK_SKEW_MS));

      const ownerUpdate = await db.update(aiShadowReplaysTable)
        .set({ error: "owner-still-valid" })
        .where(and(
          eq(aiShadowReplaysTable.id, fixture.replayId),
          eq(aiShadowReplaysTable.workerId, "current-worker"),
          shadowReplayLeaseIsLive(),
        ))
        .returning({ id: aiShadowReplaysTable.id });
      const staleClaim = await db.update(aiShadowReplaysTable)
        .set({ workerId: "replacement-worker" })
        .where(and(
          eq(aiShadowReplaysTable.id, fixture.replayId),
          shadowReplayLeaseIsExpired(),
        ))
        .returning({ id: aiShadowReplaysTable.id });

      expect(ownerUpdate).toHaveLength(1);
      expect(staleClaim).toHaveLength(0);
    } finally {
      vi.useRealTimers();
      await removeReplayFixture(fixture);
    }
  });

  it("rejects an expired database lease when the API clock is 24 hours behind", async () => {
    const fixture = await insertReplayFixture(-60_000);
    try {
      const localNow = Date.now();
      vi.useFakeTimers({ toFake: ["Date"] });
      vi.setSystemTime(new Date(localNow - CLOCK_SKEW_MS));

      const staleOwnerUpdate = await db.update(aiShadowReplaysTable)
        .set({ error: "must-not-write" })
        .where(and(
          eq(aiShadowReplaysTable.id, fixture.replayId),
          eq(aiShadowReplaysTable.workerId, "current-worker"),
          shadowReplayLeaseIsLive(),
        ))
        .returning({ id: aiShadowReplaysTable.id });
      const recoveryClaim = await db.update(aiShadowReplaysTable)
        .set({
          workerId: "replacement-worker",
          leaseUntil: shadowReplayDatabaseLeaseUntil(60_000),
        })
        .where(and(
          eq(aiShadowReplaysTable.id, fixture.replayId),
          shadowReplayLeaseIsExpired(),
        ))
        .returning({ id: aiShadowReplaysTable.id });

      expect(staleOwnerUpdate).toHaveLength(0);
      expect(recoveryClaim).toHaveLength(1);
    } finally {
      vi.useRealTimers();
      await removeReplayFixture(fixture);
    }
  });
});
