import { randomUUID } from "node:crypto";
import { eq, sql } from "drizzle-orm";
import { afterEach, expect, it, vi } from "vitest";
import {
  aiExecutionAcceptancesTable,
  aiExecutionsTable,
  aiGoalDependenciesTable,
  aiGoalsTable,
  aiMissionsTable,
  db,
  projectsTable,
  tasksTable,
} from "@workspace/db";
import { evaluateMissionCompletion } from "./mission-completion-gate.js";
import { finalizeExecutionAcceptance } from "./ai-execution-acceptance.js";
import * as missionAutoReplanModule from "./mission-auto-replan.js";
import * as missionRuntime from "./mission-runtime.js";

const projectIds: string[] = [];

async function createFixture() {
  const projectId = randomUUID();
  const missionId = randomUUID();
  const goalId = randomUUID();
  const taskId = randomUUID();
  const executionId = randomUUID();
  const correlationId = `mission-finalize-lock-correlation:${randomUUID()}`;
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
    prompt: "Inspect the current Mission Task and complete its bounded objective.",
    status: "running",
    priority: "p2",
    retryCount: 0,
    maxRetries: 3,
    correlationId,
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
    correlationId,
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
    goalId,
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
  vi.restoreAllMocks();
  for (const projectId of projectIds.splice(0)) {
    await db.delete(projectsTable).where(eq(projectsTable.id, projectId)).catch(() => undefined);
  }
});

it("attempts autonomous Mission replanning only after a retryable failure acceptance commits", async () => {
  const fixture = await createFixture();
  const planRevision = "mission-finalize-lock-order-plan";
  await db.update(aiMissionsTable)
    .set({
      autonomyPolicy: {
        mode: "autonomous",
        maxAutoReplans: 2,
        activePlanRevision: planRevision,
      },
    })
    .where(eq(aiMissionsTable.id, fixture.missionId));
  await db.update(aiGoalsTable)
    .set({ status: "running", completedAt: null })
    .where(eq(aiGoalsTable.missionId, fixture.missionId));

  const committedSnapshots: Array<{
    missionStatus: string | undefined;
    goalStatus: string | undefined;
    acceptanceOutcome: string | undefined;
  }> = [];
  const replanSpy = vi.spyOn(missionAutoReplanModule, "autoReplanMission")
    .mockImplementation(async (missionId) => {
      const [mission] = await db.select({ status: aiMissionsTable.status })
        .from(aiMissionsTable).where(eq(aiMissionsTable.id, missionId));
      const [goal] = await db.select({ status: aiGoalsTable.status })
        .from(aiGoalsTable).where(eq(aiGoalsTable.missionId, missionId));
      const [acceptance] = await db.select({ outcome: aiExecutionAcceptancesTable.outcome })
        .from(aiExecutionAcceptancesTable)
        .where(eq(aiExecutionAcceptancesTable.executionId, fixture.executionId));
      committedSnapshots.push({
        missionStatus: mission?.status,
        goalStatus: goal?.status,
        acceptanceOutcome: acceptance?.outcome,
      });
      return { status: "skipped" as const, missionId, reason: "test_observed_committed_acceptance" };
    });

  const finalized = await finalizeExecutionAcceptance({
    executionId: fixture.executionId,
    expectedAttempt: 0,
    workerId: fixture.workerId,
    finalizationKey: `mission-finalize-replan:${fixture.executionId}:0`,
    outcome: "FAILED",
    terminalStatus: "failed",
    reasonCode: "EXECUTION_PROVIDER_FAILURE",
    recoveryState: "NONE",
    resumable: true,
    error: "Synthetic retryable failure.",
    taskFinalization: {
      taskId: fixture.taskId,
      workerId: fixture.workerId,
      status: "failed",
      agentResponse: "Synthetic retryable task failure.",
    },
  });

  expect(finalized).toMatchObject({ accepted: true, duplicate: false });
  expect(replanSpy).toHaveBeenCalledOnce();
  expect(replanSpy).toHaveBeenCalledWith(fixture.missionId);
  expect(committedSnapshots).toEqual([{
    missionStatus: "needs_replan",
    goalStatus: "needs_replan",
    acceptanceOutcome: "FAILED",
  }]);
});

it("keeps the current Mission plan while an accepted Task recovery action is pending", async () => {
  const fixture = await createFixture();
  const planRevision = "mission-finalize-lock-order-plan";
  await db.update(aiMissionsTable)
    .set({
      autonomyPolicy: {
        mode: "autonomous",
        maxAutoReplans: 2,
        activePlanRevision: planRevision,
      },
    })
    .where(eq(aiMissionsTable.id, fixture.missionId));
  await db.update(aiGoalsTable)
    .set({ status: "running", completedAt: null })
    .where(eq(aiGoalsTable.id, fixture.goalId));

  const replanSpy = vi.spyOn(missionAutoReplanModule, "autoReplanMission");
  const finalized = await finalizeExecutionAcceptance({
    executionId: fixture.executionId,
    expectedAttempt: 0,
    workerId: fixture.workerId,
    finalizationKey: `mission-same-plan-recovery:${fixture.executionId}:0`,
    outcome: "FAILED",
    terminalStatus: "failed",
    reasonCode: "EXECUTION_PROVIDER_FAILURE",
    recoveryState: "REQUIRED",
    resumable: false,
    error: "Synthetic provider failure with an authorized same-plan retry.",
    taskFinalization: {
      taskId: fixture.taskId,
      workerId: fixture.workerId,
      status: "verifying",
      agentResponse: "Task is waiting for its bounded recovery attempt.",
    },
  });

  expect(finalized).toMatchObject({ accepted: true, duplicate: false });
  expect(replanSpy).not.toHaveBeenCalled();

  const [mission] = await db.select({ status: aiMissionsTable.status })
    .from(aiMissionsTable).where(eq(aiMissionsTable.id, fixture.missionId));
  const [goal] = await db.select({ status: aiGoalsTable.status })
    .from(aiGoalsTable).where(eq(aiGoalsTable.id, fixture.goalId));
  const [task] = await db.select({ status: tasksTable.status })
    .from(tasksTable).where(eq(tasksTable.id, fixture.taskId));
  const [acceptance] = await db.select({
    outcome: aiExecutionAcceptancesTable.outcome,
    nextActionCode: aiExecutionAcceptancesTable.nextActionCode,
    disposition: aiExecutionAcceptancesTable.disposition,
  }).from(aiExecutionAcceptancesTable)
    .where(eq(aiExecutionAcceptancesTable.executionId, fixture.executionId));

  expect(mission?.status).toBe("active");
  expect(goal?.status).toBe("running");
  expect(task?.status).toBe("verifying");
  expect(acceptance).toMatchObject({
    outcome: "FAILED",
    nextActionCode: "RETRY_AFTER_TIMEOUT",
    disposition: { recoveryState: "REQUIRED" },
  });
});

it("does not immediately replan a non-retryable accepted Task failure", async () => {
  const fixture = await createFixture();
  await db.update(aiGoalsTable)
    .set({ status: "running", completedAt: null })
    .where(eq(aiGoalsTable.missionId, fixture.missionId));
  const replanSpy = vi.spyOn(missionAutoReplanModule, "autoReplanMission");

  const finalized = await finalizeExecutionAcceptance({
    executionId: fixture.executionId,
    expectedAttempt: 0,
    workerId: fixture.workerId,
    finalizationKey: `mission-finalize-no-replan:${fixture.executionId}:0`,
    outcome: "FAILED",
    terminalStatus: "failed",
    reasonCode: "EXECUTION_PROVIDER_FAILURE",
    recoveryState: "NONE",
    resumable: false,
    error: "Synthetic non-retryable failure.",
    taskFinalization: {
      taskId: fixture.taskId,
      workerId: fixture.workerId,
      status: "failed",
      agentResponse: "Synthetic non-retryable task failure.",
    },
  });

  expect(finalized).toMatchObject({ accepted: true, duplicate: false });
  expect(replanSpy).not.toHaveBeenCalled();
  const [mission] = await db.select({ status: aiMissionsTable.status })
    .from(aiMissionsTable).where(eq(aiMissionsTable.id, fixture.missionId));
  expect(mission?.status).toBe("failed");
});

it("wakes only dependents after Task acceptance commits a Canonical-Proof-backed Goal completion", async () => {
  const fixture = await createFixture();
  const planRevision = "mission-finalize-lock-order-plan";
  const sourceRevision = "a".repeat(40);
  const workspaceRoot = process.cwd();
  const now = new Date();
  const dependentGoalId = randomUUID();
  const dependentTaskId = randomUUID();

  await db.update(aiGoalsTable)
    .set({
      status: "running",
      completedAt: null,
      nextAction: { kind: "task", taskId: fixture.taskId },
      outcomeContract: {
        deliveryRequired: false,
        planRevision: { hash: planRevision },
      },
    })
    .where(eq(aiGoalsTable.id, fixture.goalId));
  await db.update(aiExecutionsTable)
    .set({
      workspaceRoot,
      request: JSON.stringify({
        projectId: fixture.projectId,
        operationId: fixture.operationId,
        workspaceRevision: sourceRevision,
        workspaceRoot,
        proofRequired: true,
      }),
    })
    .where(eq(aiExecutionsTable.id, fixture.executionId));
  await db.insert(aiGoalsTable).values({
    id: dependentGoalId,
    missionId: fixture.missionId,
    projectId: fixture.projectId,
    title: "Dependent Goal",
    status: "waiting_for_event",
    blockedReason: "dependencies_pending",
    nextAction: { kind: "task", taskId: dependentTaskId },
    successCriteria: { planRevision: { hash: planRevision } },
    outcomeContract: {
      deliveryRequired: false,
      planRevision: { hash: planRevision },
    },
    createdAt: now,
    updatedAt: now,
  });
  await db.insert(aiGoalDependenciesTable).values({
    id: randomUUID(),
    missionId: fixture.missionId,
    projectId: fixture.projectId,
    goalId: dependentGoalId,
    dependsOnGoalId: fixture.goalId,
    planRevision,
    createdAt: now,
  });

  const wakeCalls: Array<[number, string | undefined, string | undefined]> = [];
  let wakeObservedAfterCommit = false;
  const wakeSpy = vi.spyOn(missionRuntime, "wakeReadyMissionGoals")
    .mockImplementation(async (limit, scopeProjectId, dependencyGoalId) => {
      wakeCalls.push([limit ?? 32, scopeProjectId, dependencyGoalId]);
      const [goal] = await db.select({ status: aiGoalsTable.status })
        .from(aiGoalsTable).where(eq(aiGoalsTable.id, fixture.goalId));
      const [task] = await db.select({ status: tasksTable.status })
        .from(tasksTable).where(eq(tasksTable.id, fixture.taskId));
      const [acceptance] = await db.select({
        outcome: aiExecutionAcceptancesTable.outcome,
        terminalStatus: aiExecutionAcceptancesTable.terminalStatus,
        evidenceComplete: aiExecutionAcceptancesTable.evidenceComplete,
      }).from(aiExecutionAcceptancesTable)
        .where(eq(aiExecutionAcceptancesTable.executionId, fixture.executionId));
      wakeObservedAfterCommit = goal?.status === "completed"
        && task?.status === "completed"
        && acceptance?.outcome === "SUCCEEDED"
        && acceptance.terminalStatus === "completed"
        && acceptance.evidenceComplete === 1;
      return 0;
    });

  try {
    const finalized = await finalizeExecutionAcceptance({
      executionId: fixture.executionId,
      expectedAttempt: 0,
      workerId: fixture.workerId,
      finalizationKey: `execution:${fixture.executionId}:attempt:0:completed`,
      outcome: "SUCCEEDED",
      terminalStatus: "completed",
      reasonCode: "ACCEPTED",
      recoveryState: "NONE",
      resumable: false,
      evidence: {
        required: true,
        sourceEvidenceRequired: true,
        operationId: fixture.operationId,
        workspaceRoot,
        sourceRevision,
        verdict: "PROVEN",
        reads: [{
          path: "src/task-proof.ts",
          body: "export const taskProof = true;\\n",
        }],
      },
      taskFinalization: {
        taskId: fixture.taskId,
        workerId: fixture.workerId,
        status: "completed",
        agentResponse: "Mission Task completed with accepted evidence.",
        completedAt: now,
      },
    });

    expect(finalized).toMatchObject({ accepted: true, duplicate: false });
    expect(wakeSpy).toHaveBeenCalledOnce();
    expect(wakeCalls).toEqual([[32, fixture.projectId, fixture.goalId]]);
    expect(wakeObservedAfterCommit).toBe(true);
    const [goal] = await db.select({ status: aiGoalsTable.status })
      .from(aiGoalsTable).where(eq(aiGoalsTable.id, fixture.goalId));
    expect(goal?.status).toBe("completed");
  } finally {
    wakeSpy.mockRestore();
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
