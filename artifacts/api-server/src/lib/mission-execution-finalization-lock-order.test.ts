import { randomUUID } from "node:crypto";
import { eq, sql } from "drizzle-orm";
import { afterEach, expect, it } from "vitest";
import {
  aiExecutionsTable,
  aiGoalsTable,
  aiMissionsTable,
  db,
  projectsTable,
  tasksTable,
} from "@workspace/db";
import { evaluateMissionCompletion } from "./mission-completion-gate.js";
import { finalizeExecutionAcceptance } from "./ai-execution-acceptance.js";

const projectIds: string[] = [];

async function createFixture() {
  const projectId = randomUUID();
  const missionId = randomUUID();
  const goalId = randomUUID();
  const taskId = randomUUID();
  const executionId = randomUUID();
  const workerId = `lock-order-worker:${randomUUID()}`;
  const operationId = `mission-finalize-lock:${randomUUID()}`;
  const planRevision = "mission-finalize-lock-order-plan";
  const now = new Date();
  const leaseUntil = new Date(now.getTime() + 60_000);

  await db.insert(projectsTable).values({
    id: projectId,
    ownerId: "test-user",
    name: `mission-finalize-lock-${projectId.slice(0, 8)}`,
    rootPath: `/tmp/mission-finalize-lock-${projectId}`,
    language: "typescript",
    status: "active",
    createdAt: now,
    updatedAt: now,
  });
  await db.insert(aiMissionsTable).values({
    id: missionId,
    projectId,
    userId: "test-user",
    title: "Mission finalization lock fixture",
    intent: "Exercise acceptance finalization lock order without running a replay",
    status: "active",
    scope: { kind: "project", projectId },
    autonomyPolicy: { activePlanRevision: planRevision },
    createdAt: now,
    updatedAt: now,
  });
  await db.insert(aiGoalsTable).values({
    id: goalId,
    missionId,
    projectId,
    title: "Completed proof-gated Goal",
    status: "completed",
    nextAction: { kind: "recipe", recipeId: "test.recipe", recipeVersion: 1 },
    successCriteria: { stepId: "completed-goal", planRevision: { hash: planRevision } },
    outcomeContract: {
      planRevision: { hash: planRevision },
      acceptance: { executionId },
    },
    createdAt: now,
    updatedAt: now,
    completedAt: now,
  });
  await db.insert(tasksTable).values({
    id: taskId,
    projectId,
    goalId,
    title: "Linked running task",
    status: "running",
    priority: "p2",
    workerId,
    leaseUntil,
    idempotencyKey: `mission-finalize-lock:${taskId}`,
    createdAt: now,
    updatedAt: now,
  });
  await db.insert(aiExecutionsTable).values({
    id: executionId,
    projectId,
    goalId,
    linkedTaskId: taskId,
    operationId,
    userId: "test-user",
    idempotencyKey: `mission-finalize-lock:${executionId}`,
    resumeTokenHash: "test-hash",
    request: "{}",
    checkpoint: "{}",
    status: "running",
    workerId,
    leaseUntil,
    attempt: 0,
    baseRevision: "a".repeat(40),
    createdAt: now,
    updatedAt: now,
  });

  projectIds.push(projectId);
  return {
    projectId,
    missionId,
    taskId,
    executionId,
    workerId,
    operationId,
  };
}

async function waitForTableLockWaiters(table: string, count: number) {
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
    const matching = rows.filter((row) => new RegExp(table, "i").test(row.query ?? ""));
    if (matching.length >= count) return matching;
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  throw new Error(`Timed out waiting for ${count} lock waiter(s) on ${table}.`);
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

it("serializes execution finalization before the Mission proof gate without a lock cycle", async () => {
  const fixture = await createFixture();
  let announceTaskLocked!: () => void;
  let releaseTaskLock!: () => void;
  const taskLocked = new Promise<void>((resolve) => {
    announceTaskLocked = resolve;
  });
  const taskLockRelease = new Promise<void>((resolve) => {
    releaseTaskLock = resolve;
  });
  const pending: Promise<unknown>[] = [];

  const taskBlocker = db.transaction(async (tx) => {
    await tx.select({ id: tasksTable.id })
      .from(tasksTable)
      .where(eq(tasksTable.id, fixture.taskId))
      .for("update");
    announceTaskLocked();
    await taskLockRelease;
  });
  pending.push(taskBlocker);
  await taskLocked;

  try {
    const finalizer = finalizeExecutionAcceptance({
      executionId: fixture.executionId,
      expectedAttempt: 0,
      workerId: fixture.workerId,
      finalizationKey: `mission-finalize-lock:${fixture.executionId}:0`,
      outcome: "FAILED",
      terminalStatus: "failed",
      reasonCode: "EXECUTION_PROVIDER_FAILURE",
      recoveryState: "NONE",
      resumable: false,
      error: "Synthetic failure for lock-order test.",
      taskFinalization: {
        taskId: fixture.taskId,
        workerId: fixture.workerId,
        status: "failed",
        agentResponse: "Synthetic failed task.",
      },
    });
    pending.push(finalizer);
    const finalizerTaskWaiters = await waitForTableLockWaiters("tasks", 1);

    const completionGate = db.transaction((tx) => evaluateMissionCompletion(tx, {
      missionId: fixture.missionId,
      projectId: fixture.projectId,
    }));
    pending.push(completionGate);
    const completionMissionWaiters = await waitForTableLockWaiters("ai_missions", 1);
    releaseTaskLock();

    const outcomes = await Promise.allSettled([
      taskBlocker,
      finalizer,
      completionGate,
    ] as const);
    const deadlocks = outcomes.filter((outcome) =>
      outcome.status === "rejected" && errorCodes(outcome.reason).includes("40P01"),
    );
    expect(
      deadlocks,
      JSON.stringify({
        finalizerTaskWaiters,
        completionMissionWaiters,
        outcomes: outcomes.map((outcome) =>
          outcome.status === "fulfilled" ? "fulfilled" : errorCodes(outcome.reason),
        ),
      }),
    ).toHaveLength(0);
    expect(completionMissionWaiters[0]?.blockers).toContain(finalizerTaskWaiters[0]?.pid);
    expect(outcomes.map((outcome) => outcome.status)).toEqual([
      "fulfilled",
      "fulfilled",
      "fulfilled",
    ]);
    if (outcomes[1]?.status !== "fulfilled" || outcomes[2]?.status !== "fulfilled") {
      throw new Error("Expected finalization and proof-gate transactions to complete.");
    }
    expect(outcomes[1].value.accepted).toBe(true);
    expect(outcomes[2].value.allowed).toBe(false);
  } finally {
    releaseTaskLock();
    await Promise.allSettled(pending);
  }
});
