import { randomUUID } from "node:crypto";
import { eq, sql } from "drizzle-orm";
import { afterEach, expect, it } from "vitest";
import {
  aiAgentEpisodesTable,
  aiExecutionsTable,
  db,
  projectsTable,
} from "@workspace/db";
import { lockEpisodeExecutionPair } from "./episode-execution-lock.js";

const projectIds: string[] = [];

async function createFixture() {
  const projectId = randomUUID();
  const executionId = randomUUID();
  const episodeId = randomUUID();
  const now = new Date();
  const sourceRevision = "a".repeat(40);

  await db.insert(projectsTable).values({
    id: projectId,
    ownerId: "test-user",
    name: `episode-execution-lock-${projectId.slice(0, 8)}`,
    rootPath: `/tmp/episode-execution-lock-${projectId}`,
    language: "typescript",
    status: "active",
    createdAt: now,
    updatedAt: now,
  });
  await db.insert(aiExecutionsTable).values({
    id: executionId,
    projectId,
    userId: "test-user",
    idempotencyKey: `episode-execution-lock:${executionId}`,
    resumeTokenHash: "test-hash",
    request: "{}",
    status: "completed",
    attempt: 0,
    baseRevision: sourceRevision,
    createdAt: now,
    updatedAt: now,
  });
  await db.insert(aiAgentEpisodesTable).values({
    id: episodeId,
    projectId,
    executionId,
    attempt: 0,
    projectRevision: sourceRevision,
    intentKind: "TEST",
    scope: {},
    workerId: `episode-lock-worker:${episodeId}`,
    leaseUntil: new Date(now.getTime() + 60_000),
    idempotencyKey: `episode-execution-lock:${episodeId}`,
    state: "completed",
    verdict: "achieved",
    closedAt: now,
    createdAt: now,
    updatedAt: now,
  });
  projectIds.push(projectId);
  return { projectId, executionId, episodeId };
}

async function waitForExecutionLockWaiter() {
  const deadline = Date.now() + 10_000;
  while (Date.now() < deadline) {
    const result = await db.execute(sql`
      SELECT waiting.pid, waiting.query, pg_blocking_pids(waiting.pid) AS blockers
      FROM pg_stat_activity AS waiting
      WHERE waiting.pid <> pg_backend_pid()
        AND waiting.datname = current_database()
        AND waiting.wait_event_type = 'Lock'
        AND cardinality(pg_blocking_pids(waiting.pid)) > 0
    `);
    const rows = (result as unknown as {
      rows?: Array<{ pid: number; query: string | null; blockers: number[] }>;
    }).rows ?? [];
    const matching = rows.filter((row) => /ai_executions/i.test(row.query ?? ""));
    if (matching.length > 0) return matching;
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  throw new Error("Timed out waiting for the proof reader to wait on the Execution row.");
}

function errorCodes(value: unknown): string[] {
  const codes: string[] = [];
  const seen = new Set<unknown>();
  let current: unknown = value;
  while (current && typeof current === "object" && !seen.has(current)) {
    seen.add(current);
    const error = current as { code?: unknown; cause?: unknown };
    if (typeof error.code === "string") codes.push(error.code);
    current = error.cause;
  }
  return codes;
}

afterEach(async () => {
  for (const projectId of projectIds.splice(0)) {
    await db.delete(projectsTable).where(eq(projectsTable.id, projectId)).catch(() => undefined);
  }
});

it("locks Execution before Episode while acceptance finalization closes an accepted episode", async () => {
  const fixture = await createFixture();
  let announceExecutionLock!: () => void;
  let continueToEpisodeLock!: () => void;
  const executionLocked = new Promise<void>((resolve) => {
    announceExecutionLock = resolve;
  });
  const canLockEpisode = new Promise<void>((resolve) => {
    continueToEpisodeLock = resolve;
  });
  const pending: Promise<unknown>[] = [];

  const finalizer = db.transaction(async (tx) => {
    await tx.select({ id: aiExecutionsTable.id })
      .from(aiExecutionsTable)
      .where(eq(aiExecutionsTable.id, fixture.executionId))
      .for("update");
    announceExecutionLock();
    await canLockEpisode;
    const [episode] = await tx.select({ id: aiAgentEpisodesTable.id })
      .from(aiAgentEpisodesTable)
      .where(eq(aiAgentEpisodesTable.id, fixture.episodeId))
      .for("update");
    if (!episode) throw new Error("Expected the finalizer to find its episode.");
  });
  pending.push(finalizer);
  try {
    await executionLocked;
    const proofReader = db.transaction((tx) =>
      lockEpisodeExecutionPair(tx, {
        projectId: fixture.projectId,
        episodeId: fixture.episodeId,
      }),
    );
    pending.push(proofReader);
    const executionWaiters = await waitForExecutionLockWaiter();
    continueToEpisodeLock();

    const outcomes = await Promise.allSettled([finalizer, proofReader] as const);
    const deadlocks = outcomes.filter((outcome) =>
      outcome.status === "rejected" && errorCodes(outcome.reason).includes("40P01"),
    );
    expect(deadlocks, JSON.stringify({
      executionWaiters,
      outcomes: outcomes.map((outcome) =>
        outcome.status === "fulfilled" ? "fulfilled" : errorCodes(outcome.reason),
      ),
    })).toHaveLength(0);
    expect(outcomes.map((outcome) => outcome.status)).toEqual(["fulfilled", "fulfilled"]);
    if (outcomes[1]?.status !== "fulfilled") {
      throw new Error("Expected the proof reader to complete after finalization released Execution.");
    }
    expect(outcomes[1].value.kind).toBe("locked");
  } finally {
    continueToEpisodeLock();
    await Promise.allSettled(pending);
  }
});
