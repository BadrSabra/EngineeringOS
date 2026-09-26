import { afterEach, describe, expect, it, vi } from "vitest";
import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import {
  aiWorldFactsTable,
  aiExecutionsTable,
  aiExecutionAcceptancesTable,
  aiAgentEpisodesTable,
  aiAgentEffectBundlesTable,
  aiAgentObservationsTable,
  aiGoalsTable,
  aiMissionsTable,
  aiWorldTransitionsTable,
  db,
  eventsTable,
  projectsTable,
  tasksTable,
} from "@workspace/db";
import {
  receiveMissionEvent,
  replayPendingMissionEvents,
  runMissionGoal,
  wakeRuntimeTransitionMissionGoals,
  wakeDueMissionGoals,
  wakeMissionGoalsForEvent,
} from "./mission-runtime.js";
import { createMissionEventEnvelope } from "./mission-events.js";
import { buildMissionDelegationBinding } from "./mission-delegation.js";
import { createHash } from "node:crypto";
import { getProjectWorldState } from "./agent-state/world-state.js";
import { heavyJobQueue } from "./job-queue.js";

const projectIds: string[] = [];

async function createMissionFixture(nextAction: Record<string, unknown>) {
  const projectId = randomUUID();
  const missionId = randomUUID();
  const goalId = randomUUID();
  const now = new Date();
  await db.insert(projectsTable).values({
    id: projectId,
    ownerId: "test-user",
    name: `mission-runtime-${projectId.slice(0, 8)}`,
    rootPath: `/tmp/mission-runtime-${projectId}`,
    language: "typescript",
    status: "active",
    createdAt: now,
    updatedAt: now,
  });
  await db.insert(aiMissionsTable).values({
    id: missionId,
    projectId,
    userId: "test-user",
    title: "Runtime fixture",
    intent: "Exercise the existing objective runtime",
    status: "active",
    scope: { kind: "project", projectId },
    createdAt: now,
    updatedAt: now,
  });
  await db.insert(aiGoalsTable).values({
    id: goalId,
    missionId,
    projectId,
    title: "Runtime goal",
    status: "queued",
    nextAction,
    createdAt: now,
    updatedAt: now,
  });
  projectIds.push(projectId);
  return { projectId, missionId, goalId, now };
}

async function createRuntimeTransitionFixture(
  status: "pending" | "retrying" | "materialized" | "terminal_failed",
  dispatchTarget = false,
) {
  const fixture = await createMissionFixture({ kind: "wait", reason: "event", wakeAt: null });
  const sourceId = randomUUID();
  const targetId = fixture.goalId;
  const planRevision = "plan-runtime-start";
  const sourceRevision = "a".repeat(40);
  const environmentRevision = `env-v1:${"b".repeat(64)}`;
  const transitionId = randomUUID();
  const executionId = randomUUID();
  const episodeId = randomUUID();
  const effectBundleId = randomUUID();
  const actionId = `action:${executionId}:gate-c`;
  const requirement = {
    kind: "runtime.start",
    version: 1,
    sourceStepId: "runtime-start",
    targetStepId: "target-step",
    from: "stopped",
    to: "running",
  };
  const plan = { hash: planRevision, transitionRequirements: [requirement] };
  const sourceAction = { kind: "recipe", recipeId: "runtime.start", recipeVersion: 1 };
  const now = new Date();
  await db.insert(aiGoalsTable).values({
    id: sourceId,
    missionId: fixture.missionId,
    projectId: fixture.projectId,
    title: "Runtime source",
    status: "completed",
    nextAction: sourceAction,
    successCriteria: { stepId: "runtime-start", planRevision: plan },
    outcomeContract: { planRevision: { hash: planRevision } },
    createdAt: now,
    updatedAt: now,
  });
  await db.update(aiGoalsTable).set({
    ...(dispatchTarget
      ? { nextAction: { kind: "recipe", recipeId: "candidate.verify", recipeVersion: 1, approvedPaths: ["package.json"] } }
      : {}),
    successCriteria: { stepId: "target-step", planRevision: plan, transitionRequirement: requirement },
    outcomeContract: { planRevision: { hash: planRevision } },
    blockedReason: "runtime_transition_pending",
    status: "waiting_for_event",
    updatedAt: now,
  }).where(eq(aiGoalsTable.id, targetId));
  await db.update(aiMissionsTable).set({
    status: "waiting",
    autonomyPolicy: { activePlanRevision: planRevision },
    updatedAt: now,
  })
    .where(eq(aiMissionsTable.id, fixture.missionId));
  await db.insert(aiExecutionsTable).values({
    id: executionId, projectId: fixture.projectId, goalId: sourceId,
    operationId: `operation:${executionId}`, userId: "test-user",
    idempotencyKey: `execution:${executionId}`, resumeTokenHash: "test-hash",
    request: "{}", checkpoint: "{}", status: "completed", attempt: 0,
    completedAt: now, createdAt: now, updatedAt: now,
  });
  await db.insert(aiAgentEpisodesTable).values({
    id: episodeId,
    projectId: fixture.projectId,
    executionId,
    attempt: 0,
    missionId: fixture.missionId,
    goalId: sourceId,
    projectRevision: sourceRevision,
    environmentRevision,
    worldRevision: "c".repeat(64),
    planRevision,
    intentKind: "recipe",
    scope: { kind: "project" },
    workerId: "test-worker",
    leaseUntil: new Date(Date.now() + 60_000),
    idempotencyKey: `episode:${episodeId}`,
    createdAt: now,
    updatedAt: now,
  });
  await db.insert(aiAgentEffectBundlesTable).values({
    id: effectBundleId,
    projectId: fixture.projectId,
    executionId,
    attempt: 0,
    episodeId,
    effectIds: [],
    effectContractHashes: [],
    verdict: "PROVEN",
    createdAt: now,
  });
  await db.insert(aiExecutionAcceptancesTable).values({
    id: randomUUID(),
    executionId,
    projectId: fixture.projectId,
    attempt: 0,
    finalizationKey: `final:${executionId}`,
    operationId: `operation:${executionId}`,
    workerId: "test-worker",
    terminalStatus: "completed",
    outcome: "SUCCEEDED",
    reasonCode: "CANONICAL_PROOF_PROVEN",
    nextActionCode: "none",
    effectBundleId,
    createdAt: now,
  });
  const beforeId = randomUUID();
  const afterId = randomUUID();
  const statusId = randomUUID();
  const beforeValue = {
    status: "observed", runtimeStatus: "stopped", projectId: fixture.projectId,
    revision: sourceRevision, sessionId: null, environmentRevision,
    inventoryComplete: true, unknownListenerPorts: [], observedAt: now.toISOString(),
  };
  const afterValue = {
    status: "passed", runtimeStatus: "running", projectId: fixture.projectId,
    revision: sourceRevision, sessionId: "session-runtime", environmentRevision,
    processAlive: true, portReady: true, pid: 1234, port: 3000, observedAt: now.toISOString(),
  };
  for (const [id, predicate, value] of [
    [beforeId, "runtime.before_state", beforeValue],
    [afterId, "runtime.after_state", afterValue],
    [statusId, "runtime.status", "running"],
  ] as const) {
    await db.insert(aiAgentObservationsTable).values({
      id, projectId: fixture.projectId, executionId, episodeId, taskScope: "project",
      environmentRevisionKey: `revision:${environmentRevision}`, kind: "direct_observation",
      provenance: "DIRECT_OBSERVATION", observationRole: predicate, sourceType: "direct_observation",
      sourceId: id, sourceVersion: sourceRevision, subject: `runtime:${fixture.projectId}`,
      predicate, value, valueHash: createHash("sha256").update(JSON.stringify(value)).digest("hex"),
      sourceRefs: [], observedAt: now, projectRevision: sourceRevision, environmentRevision,
      completeness: "complete", freshness: "fresh", environmentFreshness: "fresh",
      evidenceRefs: [], sequence: 1, createdAt: now,
    });
  }
  await db.insert(aiWorldTransitionsTable).values({
    id: transitionId, projectId: fixture.projectId, executionId, attempt: 0, episodeId,
    actionId, effectBundleId, parentWorldRevision: "c".repeat(64),
    resultingWorldRevision: status === "materialized" ? "d".repeat(64) : null,
    taskScope: "project", environmentRevisionKey: `revision:${environmentRevision}`,
    environmentRevision, freshness: status === "materialized" ? "fresh" : "unknown",
    beforeObservationIds: [beforeId], afterObservationIds: [afterId, statusId],
    materializedObservationIds: status === "materialized" ? [beforeId, afterId, statusId] : [],
    parentFactRefs: [], changedFactRefs: [], evidenceRefs: [`runtime:${afterValue.sessionId}`],
    status, idempotencyKey: `transition:${transitionId}`, retryCount: 0,
    createdAt: now, updatedAt: now,
  });
  const projection = await getProjectWorldState(fixture.projectId);
  if (status === "materialized") {
    await db.update(aiWorldTransitionsTable).set({
      resultingWorldRevision: projection.worldRevision,
      updatedAt: new Date(),
    }).where(eq(aiWorldTransitionsTable.id, transitionId));
  }
  return {
    ...fixture, sourceId, transitionId, targetId, beforeId, afterId, statusId,
    executionId,
    attempt: 0,
    episodeId,
    actionId,
    effectBundleId,
    sourceRevision,
    environmentRevision,
    parentWorldRevision: "c".repeat(64),
    worldRevision: projection.worldRevision,
  };
}

afterEach(async () => {
  vi.restoreAllMocks();
  for (const projectId of projectIds.splice(0)) {
    await db.delete(projectsTable).where(eq(projectsTable.id, projectId)).catch(() => undefined);
  }
});

describe("Mission goal runtime", () => {
  it("dispatches the transition-bound successor despite unrelated project World State changes", async () => {
    const fixture = await createRuntimeTransitionFixture("materialized", true);
    await db.insert(aiWorldFactsTable).values({
      id: randomUUID(),
      projectId: fixture.projectId,
      subject: `unrelated:${fixture.projectId}`,
      predicate: "unrelated.status",
      value: "changed",
      valueHash: createHash("sha256").update("changed").digest("hex"),
      version: 1,
      status: "believed",
      sourceObservationIds: [],
      projectRevision: "a".repeat(40),
    });
    expect((await getProjectWorldState(fixture.projectId)).worldRevision)
      .not.toBe(fixture.worldRevision);
    const enqueue = vi.spyOn(heavyJobQueue, "enqueueWithId").mockReturnValue(true);
    expect(await wakeRuntimeTransitionMissionGoals()).toBe(1);
    const dispatches = await db.select({
      type: eventsTable.type,
      goalId: eventsTable.goalId,
      payload: eventsTable.payload,
    }).from(eventsTable).where(eq(eventsTable.projectId, fixture.projectId));
    const event = dispatches.find((row) =>
      row.type === "AiGoalRecipeDispatchRequested"
      && row.payload
      && (row.payload as Record<string, unknown>).transitionProof,
    );
    expect(event?.goalId).toBe(fixture.targetId);
    expect(event?.payload).toMatchObject({
      transitionProof: {
        transitionId: fixture.transitionId,
        executionId: fixture.executionId,
        attempt: fixture.attempt,
        episodeId: fixture.episodeId,
        actionId: fixture.actionId,
        effectBundleId: fixture.effectBundleId,
        parentWorldRevision: fixture.parentWorldRevision,
        resultingWorldRevision: fixture.worldRevision,
        projectRevision: fixture.sourceRevision,
        environmentRevision: fixture.environmentRevision,
        beforeObservationIds: [fixture.beforeId],
        afterObservationIds: [fixture.afterId, fixture.statusId],
        sourceStepId: "runtime-start",
        targetStepId: "target-step",
        activePlanHash: "plan-runtime-start",
      },
    });
    expect(dispatches.filter((row) =>
      row.goalId === fixture.targetId && row.type === "AiGoalRecipeDispatchRequested",
    ).length).toBe(1);
    const [targetGoal] = await db.select({ status: aiGoalsTable.status })
      .from(aiGoalsTable).where(eq(aiGoalsTable.id, fixture.targetId));
    expect(targetGoal?.status).toBe("running");
    expect(enqueue).toHaveBeenCalledTimes(1);
    enqueue.mockRestore();
  });

  it("fails closed when a materialized transition has an invalid resulting revision", async () => {
    const fixture = await createRuntimeTransitionFixture("materialized");
    await db.update(aiWorldTransitionsTable).set({
      resultingWorldRevision: "not-a-world-revision",
      updatedAt: new Date(),
    }).where(eq(aiWorldTransitionsTable.id, fixture.transitionId));
    expect(await wakeRuntimeTransitionMissionGoals()).toBe(0);
    const [goal] = await db.select({
      status: aiGoalsTable.status,
      blockedReason: aiGoalsTable.blockedReason,
      outcomeContract: aiGoalsTable.outcomeContract,
    }).from(aiGoalsTable).where(eq(aiGoalsTable.id, fixture.targetId));
    expect(goal).toMatchObject({
      status: "needs_replan",
      blockedReason: "runtime_start_transition_unproven",
      outcomeContract: {
        worldStateFailureDiagnosis: {
          version: 1,
          reasonCode: "transition_identity_invalid",
          transition: { id: fixture.transitionId },
          failureDiagnosis: {
            kind: "EVIDENCE_INCOMPLETE",
            retryable: true,
            requiresApproval: false,
          },
          recommendedDisposition: "observe",
        },
      },
    });
    const events = await db.select({ type: eventsTable.type, payload: eventsTable.payload })
      .from(eventsTable)
      .where(eq(eventsTable.projectId, fixture.projectId));
    const blockedEvent = events.find((event) => event.type === "AiGoalTransitionRequirementBlocked");
    expect(blockedEvent?.payload).toMatchObject({
      worldStateFailureDiagnosis: {
        reasonCode: "transition_identity_invalid",
        transition: { id: fixture.transitionId },
      },
    });
    expect(events.some((event) => event.type === "AiGoalRecipeDispatchRequested")).toBe(false);
  });

  it("keeps a runtime.start target pending until its exact transition is materialized", async () => {
    const fixture = await createRuntimeTransitionFixture("pending");
    expect(await wakeRuntimeTransitionMissionGoals()).toBe(0);
    let [goal] = await db.select({
      status: aiGoalsTable.status,
      blockedReason: aiGoalsTable.blockedReason,
    }).from(aiGoalsTable).where(eq(aiGoalsTable.id, fixture.targetId));
    expect(goal).toEqual({
      status: "waiting_for_event",
      blockedReason: "runtime_transition_pending",
    });

    await db.update(aiWorldTransitionsTable).set({
      status: "materialized",
      resultingWorldRevision: fixture.worldRevision,
      freshness: "fresh",
      materializedObservationIds: [fixture.beforeId, fixture.afterId, fixture.statusId],
      updatedAt: new Date(),
    }).where(eq(aiWorldTransitionsTable.id, fixture.transitionId));
    expect(await wakeRuntimeTransitionMissionGoals()).toBe(0);
    [goal] = await db.select({
      status: aiGoalsTable.status,
      blockedReason: aiGoalsTable.blockedReason,
    }).from(aiGoalsTable).where(eq(aiGoalsTable.id, fixture.targetId));
    expect(goal).toEqual({
      status: "waiting_for_event",
      blockedReason: null,
    });
  });

  it("does not wake a target for retrying, terminal, or mismatched transitions", async () => {
    for (const status of ["retrying", "terminal_failed"] as const) {
      const fixture = await createRuntimeTransitionFixture(status);
      expect(await wakeRuntimeTransitionMissionGoals()).toBe(0);
      const [goal] = await db.select({
        status: aiGoalsTable.status,
        blockedReason: aiGoalsTable.blockedReason,
      }).from(aiGoalsTable).where(eq(aiGoalsTable.id, fixture.targetId));
      if (status === "retrying") {
        expect(goal).toEqual({
          status: "waiting_for_event",
          blockedReason: "runtime_transition_pending",
        });
      } else {
        expect(goal).toEqual({
          status: "needs_replan",
          blockedReason: "runtime_start_transition_unproven",
        });
      }
    }
    const fixture = await createRuntimeTransitionFixture("materialized");
    await db.update(aiWorldTransitionsTable).set({
      effectBundleId: null,
      updatedAt: new Date(),
    }).where(eq(aiWorldTransitionsTable.id, fixture.transitionId));
    expect(await wakeRuntimeTransitionMissionGoals()).toBe(0);
    const [goal] = await db.select({
      status: aiGoalsTable.status,
      blockedReason: aiGoalsTable.blockedReason,
    }).from(aiGoalsTable).where(eq(aiGoalsTable.id, fixture.targetId));
    expect(goal?.status).toBe("needs_replan");
  });

  it.each([
    ["after-state session", async (fixture: Awaited<ReturnType<typeof createRuntimeTransitionFixture>>) => {
      const [observation] = await db.select({ value: aiAgentObservationsTable.value })
        .from(aiAgentObservationsTable)
        .where(eq(aiAgentObservationsTable.id, fixture.afterId));
      const value = observation?.value as Record<string, unknown>;
      await db.update(aiAgentObservationsTable).set({
        value: { ...value, sessionId: "session-not-the-transition-session" },
      }).where(eq(aiAgentObservationsTable.id, fixture.afterId));
    }, "session_evidence_missing"],
    ["environment revision", async (fixture: Awaited<ReturnType<typeof createRuntimeTransitionFixture>>) => {
      await db.update(aiWorldTransitionsTable).set({
        environmentRevision: `env-v1:${"e".repeat(64)}`,
        updatedAt: new Date(),
      }).where(eq(aiWorldTransitionsTable.id, fixture.transitionId));
    }, "environment_revision_mismatch"],
    ["project revision", async (fixture: Awaited<ReturnType<typeof createRuntimeTransitionFixture>>) => {
      const [observation] = await db.select({ value: aiAgentObservationsTable.value })
        .from(aiAgentObservationsTable)
        .where(eq(aiAgentObservationsTable.id, fixture.afterId));
      const value = observation?.value as Record<string, unknown>;
      await db.update(aiAgentObservationsTable).set({
        value: { ...value, revision: "f".repeat(40) },
      }).where(eq(aiAgentObservationsTable.id, fixture.afterId));
    }, "project_revision_mismatch"],
  ])("fails closed for a mismatched %s", async (_description, mutate, expectedDiagnosisCode) => {
    const fixture = await createRuntimeTransitionFixture("materialized");
    await mutate(fixture);

    expect(await wakeRuntimeTransitionMissionGoals()).toBe(0);
    const [goal] = await db.select({
      status: aiGoalsTable.status,
      blockedReason: aiGoalsTable.blockedReason,
      outcomeContract: aiGoalsTable.outcomeContract,
    }).from(aiGoalsTable).where(eq(aiGoalsTable.id, fixture.targetId));
    expect(goal).toMatchObject({
      status: "needs_replan",
      blockedReason: "runtime_start_transition_unproven",
    });
    expect(goal?.outcomeContract).toMatchObject({
      worldStateFailureDiagnosis: { reasonCode: expectedDiagnosisCode },
    });
    const dispatches = await db.select({ type: eventsTable.type })
      .from(eventsTable)
      .where(eq(eventsTable.projectId, fixture.projectId));
    expect(dispatches.some((event) => event.type === "AiGoalRecipeDispatchRequested")).toBe(false);
  });

  it.each([
    ["source step", async (fixture: Awaited<ReturnType<typeof createRuntimeTransitionFixture>>) => {
      const [source] = await db.select({ successCriteria: aiGoalsTable.successCriteria })
        .from(aiGoalsTable).where(eq(aiGoalsTable.id, fixture.sourceId));
      const criteria = source?.successCriteria as Record<string, unknown>;
      await db.update(aiGoalsTable).set({
        successCriteria: { ...criteria, stepId: "different-source-step" },
        updatedAt: new Date(),
      }).where(eq(aiGoalsTable.id, fixture.sourceId));
    }, "needs_replan", "runtime_start_transition_unproven"],
    ["target step", async (fixture: Awaited<ReturnType<typeof createRuntimeTransitionFixture>>) => {
      const [target] = await db.select({ successCriteria: aiGoalsTable.successCriteria })
        .from(aiGoalsTable).where(eq(aiGoalsTable.id, fixture.targetId));
      const criteria = target?.successCriteria as Record<string, unknown>;
      await db.update(aiGoalsTable).set({
        successCriteria: { ...criteria, stepId: "different-target-step" },
        updatedAt: new Date(),
      }).where(eq(aiGoalsTable.id, fixture.targetId));
    }, "needs_replan", "runtime_start_transition_unproven"],
    ["active plan hash", async (fixture: Awaited<ReturnType<typeof createRuntimeTransitionFixture>>) => {
      await db.update(aiMissionsTable).set({
        autonomyPolicy: { activePlanRevision: "different-active-plan" },
        updatedAt: new Date(),
      }).where(eq(aiMissionsTable.id, fixture.missionId));
    }, "waiting_for_event", "runtime_transition_pending"],
  ])("does not dispatch valid-looking evidence for a mismatched %s", async (
    _description,
    mutate,
    expectedStatus,
    expectedBlockedReason,
  ) => {
    const fixture = await createRuntimeTransitionFixture("materialized");
    await mutate(fixture);

    expect(await wakeRuntimeTransitionMissionGoals()).toBe(0);
    const [goal] = await db.select({
      status: aiGoalsTable.status,
      blockedReason: aiGoalsTable.blockedReason,
    }).from(aiGoalsTable).where(eq(aiGoalsTable.id, fixture.targetId));
    expect(goal).toEqual({
      status: expectedStatus,
      blockedReason: expectedBlockedReason,
    });
    const dispatches = await db.select({ type: eventsTable.type })
      .from(eventsTable)
      .where(eq(eventsTable.projectId, fixture.projectId));
    expect(dispatches.some((event) => event.type === "AiGoalRecipeDispatchRequested")).toBe(false);
  });

  it("clears the transition wait only for the exact materialized target", async () => {
    const ready = await createRuntimeTransitionFixture("materialized");
    const pending = await createRuntimeTransitionFixture("pending");

    expect(await wakeRuntimeTransitionMissionGoals()).toBe(0);
    const [readyGoal] = await db.select({
      status: aiGoalsTable.status,
      blockedReason: aiGoalsTable.blockedReason,
    }).from(aiGoalsTable).where(eq(aiGoalsTable.id, ready.targetId));
    const [pendingGoal] = await db.select({
      status: aiGoalsTable.status,
      blockedReason: aiGoalsTable.blockedReason,
    }).from(aiGoalsTable).where(eq(aiGoalsTable.id, pending.targetId));
    expect(readyGoal).toEqual({ status: "waiting_for_event", blockedReason: null });
    expect(pendingGoal).toEqual({
      status: "waiting_for_event",
      blockedReason: "runtime_transition_pending",
    });
  });

  it("persists a server-owned wait transition", async () => {
    const fixture = await createMissionFixture({
      kind: "wait",
      reason: "event",
      wakeAt: "2026-09-22T05:00:00.000Z",
    });

    const result = await runMissionGoal({
      goalId: fixture.goalId,
      userId: "test-user",
      trigger: "wake",
    });

    expect(result).toEqual({
      status: "waiting",
      goalId: fixture.goalId,
    });
    const [goal] = await db
      .select({ status: aiGoalsTable.status, nextWakeAt: aiGoalsTable.nextWakeAt })
      .from(aiGoalsTable)
      .where(eq(aiGoalsTable.id, fixture.goalId));
    expect(goal?.status).toBe("waiting_for_event");
    expect(goal?.nextWakeAt?.toISOString()).toBe("2026-09-22T05:00:00.000Z");
  });

  it("rejects a delegation binding from another owner or plan revision", async () => {
    const fixture = await createMissionFixture({
      kind: "wait",
      reason: "event",
      wakeAt: null,
    });
    const binding = buildMissionDelegationBinding({
      missionId: fixture.missionId,
      goalId: fixture.goalId,
      taskId: null,
      planRevision: "stale-plan",
      userId: "another-user",
      trigger: "resume",
    });

    const result = await runMissionGoal({
      goalId: fixture.goalId,
      userId: "test-user",
      trigger: "resume",
      delegation: binding,
    });

    expect(result).toMatchObject({
      status: "conflict",
      goalId: fixture.goalId,
      reason: "user_mismatch",
    });
  });

  it("moves a replan action to needs_replan without creating another execution", async () => {
    const fixture = await createMissionFixture({
      kind: "replan",
      reason: "source revision changed",
    });

    const result = await runMissionGoal({
      goalId: fixture.goalId,
      userId: "test-user",
      trigger: "resume",
    });

    expect(result.status).toBe("blocked");
    expect(result.reason).toBe("replan_required");
    const [goal] = await db
      .select({ status: aiGoalsTable.status, blockedReason: aiGoalsTable.blockedReason })
      .from(aiGoalsTable)
      .where(eq(aiGoalsTable.id, fixture.goalId));
    const [mission] = await db
      .select({ status: aiMissionsTable.status })
      .from(aiMissionsTable)
      .where(eq(aiMissionsTable.id, fixture.missionId));
    expect(goal).toEqual({
      status: "needs_replan",
      blockedReason: "source revision changed",
    });
    expect(mission?.status).toBe("needs_replan");
  });

  it("returns the existing active execution instead of scheduling the task again", async () => {
    const taskId = randomUUID();
    const fixture = await createMissionFixture({
      kind: "task",
      taskId,
      purpose: "execution",
    });
    await db.insert(tasksTable).values({
      id: taskId,
      projectId: fixture.projectId,
      goalId: fixture.goalId,
      title: "Existing task",
      description: "Already running",
      status: "verifying",
      priority: "p1",
      phase: "execute",
      prompt: "Already running",
      createdAt: fixture.now,
      updatedAt: fixture.now,
    });
    const executionId = randomUUID();
    await db.insert(aiExecutionsTable).values({
      id: executionId,
      projectId: fixture.projectId,
      goalId: fixture.goalId,
      linkedTaskId: taskId,
      userId: "test-user",
      idempotencyKey: `mission-runtime-${executionId}`,
      resumeTokenHash: "test-hash",
      request: "{}",
      checkpoint: "{}",
      status: "queued",
      createdAt: fixture.now,
      updatedAt: fixture.now,
    });

    const result = await runMissionGoal({
      goalId: fixture.goalId,
      userId: "test-user",
      trigger: "resume",
    });

    expect(result).toMatchObject({
      status: "scheduled",
      goalId: fixture.goalId,
      taskId,
      executionId,
      reason: "execution_already_active",
    });
  });

  it("wakes due event waits exactly once and leaves approval waits untouched", async () => {
    const due = await createMissionFixture({
      kind: "wait",
      reason: "event",
      wakeAt: "2020-01-01T00:00:00.000Z",
    });
    const approval = await createMissionFixture({
      kind: "wait",
      reason: "approval",
      wakeAt: "2020-01-01T00:00:00.000Z",
    });
    await runMissionGoal({
      goalId: due.goalId,
      userId: "test-user",
      trigger: "resume",
    });
    await runMissionGoal({
      goalId: approval.goalId,
      userId: "test-user",
      trigger: "resume",
    });

    expect(await wakeDueMissionGoals()).toBe(1);
    expect(await wakeDueMissionGoals()).toBe(0);

    const [dueGoal] = await db
      .select({ status: aiGoalsTable.status, nextAction: aiGoalsTable.nextAction })
      .from(aiGoalsTable)
      .where(eq(aiGoalsTable.id, due.goalId));
    const [approvalGoal] = await db
      .select({ status: aiGoalsTable.status, nextAction: aiGoalsTable.nextAction })
      .from(aiGoalsTable)
      .where(eq(aiGoalsTable.id, approval.goalId));
    expect(dueGoal).toMatchObject({
      status: "needs_replan",
      nextAction: {
        kind: "replan",
      },
    });
    expect(approvalGoal).toMatchObject({
      status: "waiting_for_approval",
      nextAction: {
        kind: "wait",
        reason: "approval",
      },
    });
  });

  it("wakes only the targeted event wait and converts it into a revision-bound replan", async () => {
    const waiting = await createMissionFixture({
      kind: "wait",
      reason: "event",
      wakeAt: null,
    });
    await runMissionGoal({
      goalId: waiting.goalId,
      userId: "test-user",
      trigger: "activation",
    });

    const event = createMissionEventEnvelope({
      eventId: randomUUID(),
      type: "WorkflowPhaseAccepted",
      projectId: waiting.projectId,
      goalId: waiting.goalId,
      workflowId: randomUUID(),
      correlationId: randomUUID(),
      payload: { phase: "validate" },
    });
    expect(await wakeMissionGoalsForEvent(event)).toBe(1);
    expect(await wakeMissionGoalsForEvent(event)).toBe(0);

    const [goal] = await db
      .select({ status: aiGoalsTable.status, nextAction: aiGoalsTable.nextAction })
      .from(aiGoalsTable)
      .where(eq(aiGoalsTable.id, waiting.goalId));
    const [mission] = await db
      .select({ status: aiMissionsTable.status })
      .from(aiMissionsTable)
      .where(eq(aiMissionsTable.id, waiting.missionId));
    expect(goal).toMatchObject({
      status: "needs_replan",
      nextAction: { kind: "replan" },
    });
    expect(mission?.status).toBe("needs_replan");
  });

  it("durably replays an event delivered before the Goal enters its wait state", async () => {
    const waiting = await createMissionFixture({
      kind: "wait",
      reason: "event",
      wakeAt: null,
    });
    const event = createMissionEventEnvelope({
      eventId: randomUUID(),
      type: "ExternalValidationCompleted",
      projectId: waiting.projectId,
      goalId: waiting.goalId,
      payload: { validationId: "validation-1" },
    });

    await expect(receiveMissionEvent(event)).resolves.toMatchObject({
      persisted: true,
      woken: false,
      duplicate: false,
    });
    await runMissionGoal({
      goalId: waiting.goalId,
      userId: "test-user",
      trigger: "activation",
    });
    expect(await replayPendingMissionEvents()).toBe(1);
    expect(await replayPendingMissionEvents()).toBe(0);

    const [goal] = await db
      .select({ status: aiGoalsTable.status, nextAction: aiGoalsTable.nextAction })
      .from(aiGoalsTable)
      .where(eq(aiGoalsTable.id, waiting.goalId));
    expect(goal).toMatchObject({
      status: "needs_replan",
      nextAction: { kind: "replan" },
    });
    await expect(receiveMissionEvent(event)).resolves.toMatchObject({
      persisted: true,
      duplicate: true,
    });
  });
});