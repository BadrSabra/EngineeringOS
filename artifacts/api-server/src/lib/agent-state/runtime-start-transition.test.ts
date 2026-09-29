import { and, eq } from "drizzle-orm";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  aiAgentEffectBundlesTable,
  aiAgentEpisodesTable,
  aiAgentObservationsTable,
  aiChatSessionsTable,
  aiExecutionAcceptancesTable,
  aiExecutionsTable,
  aiGoalsTable,
  aiMissionsTable,
  aiWorldTransitionsTable,
  db,
  eventsTable,
  projectsTable,
} from "@workspace/db";
import { createAiExecution, claimAiExecution } from "../ai-execution-state.js";
import { startEpisode } from "./agent-episode-ledger.js";
import {
  createPendingRuntimeStartTransition,
  finalizeRuntimeStartTransition,
  retryPendingRuntimeStartTransitions,
} from "./runtime-start-transition.js";
import { wakeRuntimeTransitionMissionGoals } from "../mission-runtime.js";
import { heavyJobQueue } from "../job-queue.js";
import { childProcessBindingDigest } from "./child-process-attestation.js";
import {
  getProjectWorldState,
  materializeWorldStateForProject,
} from "./world-state.js";

const createdProjects: string[] = [];
const createdExecutionIds: string[] = [];

afterEach(async () => {
  vi.restoreAllMocks();
  for (const executionId of createdExecutionIds.splice(0)) {
    await db.delete(aiExecutionAcceptancesTable)
      .where(eq(aiExecutionAcceptancesTable.executionId, executionId));
    await db.delete(aiExecutionsTable).where(eq(aiExecutionsTable.id, executionId));
  }
  for (const projectId of createdProjects.splice(0)) {
    await db.delete(projectsTable).where(eq(projectsTable.id, projectId));
  }
});

async function acceptTransitionFixture(fixture: {
  projectId: string;
  executionId: string;
  operationId: string;
  effectBundleId: string;
}) {
  const now = new Date();
  await db.transaction(async (tx) => {
    await tx.update(aiExecutionsTable)
      .set({ status: "completed", completedAt: now, updatedAt: now })
      .where(eq(aiExecutionsTable.id, fixture.executionId));
    await tx.insert(aiExecutionAcceptancesTable).values({
      id: crypto.randomUUID(),
      executionId: fixture.executionId,
      projectId: fixture.projectId,
      attempt: 0,
      finalizationKey: `final:${fixture.executionId}`,
      operationId: fixture.operationId,
      workerId: `runtime-transition-worker:${fixture.projectId}`,
      terminalStatus: "completed",
      outcome: "SUCCEEDED",
      reasonCode: "CANONICAL_PROOF_PROVEN",
      nextActionCode: "none",
      effectBundleId: fixture.effectBundleId,
      createdAt: now,
    });
  });
}

async function transitionFixture(options: { accepted?: boolean } = {}) {
  const projectId = crypto.randomUUID();
  const sessionId = crypto.randomUUID();
  const operationId = crypto.randomUUID();
  const userId = `runtime-transition-test:${projectId}`;
  const workerId = `runtime-transition-worker:${projectId}`;
  const now = new Date();
  await db.insert(projectsTable).values({
    id: projectId,
    ownerId: userId,
    name: "runtime transition retry test",
    rootPath: `${process.cwd()}/.runtime-start-transition-test/${projectId}`,
    language: "typescript",
    status: "active",
    createdAt: now,
    updatedAt: now,
  });
  createdProjects.push(projectId);
  await db.insert(aiChatSessionsTable).values({
    id: sessionId,
    projectId,
    title: "Runtime transition retry test",
    createdAt: now,
    updatedAt: now,
  });

  const created = await createAiExecution({
    userId,
    projectId,
    sessionId,
    idempotencyKey: `${operationId}:retry`,
    request: {
      projectId,
      operationId,
      sessionId,
      message: "runtime transition retry test",
      modelMessage: "runtime transition retry test",
      workspaceRevision: "a".repeat(64),
      validationTargetPaths: [],
    },
  });
  const actualExecutionId = created.execution.id;
  createdExecutionIds.push(actualExecutionId);
  const claimed = await claimAiExecution({
    executionId: actualExecutionId,
    userId,
    workerId,
  });
  expect(claimed?.status).toBe("running");
  const episode = await startEpisode({
    projectId,
    executionId: actualExecutionId,
    attempt: 0,
    workerId,
    idempotencyKey: `${operationId}:episode`,
    projectRevision: "a".repeat(64),
    intentKind: "RUNTIME_START",
    scope: { kind: "project", paths: [] },
  });
  const effectBundleId = `effect:${operationId}`;
  await db.insert(aiAgentEffectBundlesTable).values({
    id: effectBundleId,
    projectId,
    executionId: actualExecutionId,
    attempt: 0,
    episodeId: episode.episodeId,
    effectIds: [],
    effectContractHashes: [],
    verdict: "OBSERVED",
  });
  const parent = await getProjectWorldState(projectId, {
    excludeEpisodeIds: [episode.episodeId],
  });
  const environmentRevision = `env-v1:${"c".repeat(64)}`;
  const sourceRevision = "a".repeat(64);
  const beforeObservationId = crypto.randomUUID();
  const afterObservationId = crypto.randomUUID();
  const statusObservationId = crypto.randomUUID();
  const childProcessObservationId = crypto.randomUUID();
  const transitionInput = {
    projectId,
    executionId: actualExecutionId,
    attempt: 0,
    episodeId: episode.episodeId,
    actionId: `action:${operationId}`,
    effectBundleId,
    workerId,
    parentWorldRevision: parent.worldRevision,
    parentFactRefs: [],
    beforeObservationIds: [beforeObservationId],
    afterObservationIds: [afterObservationId, statusObservationId, childProcessObservationId],
    evidenceRefs: [`runtime:${sessionId}`],
    environmentRevision,
  };
  const transitionId = await createPendingRuntimeStartTransition(transitionInput);
  if (options.accepted !== false) {
    await acceptTransitionFixture({
      projectId,
      executionId: actualExecutionId,
      operationId,
      effectBundleId,
    });
  }
  return {
    projectId,
    executionId: actualExecutionId,
    episodeId: episode.episodeId,
    sessionId,
    workerId,
    transitionId,
    operationId,
    effectBundleId,
    environmentRevision,
    sourceRevision,
    beforeObservationId,
    afterObservationId,
    statusObservationId,
    childProcessObservationId,
    transitionInput,
  };
}

type TransitionFixture = Awaited<ReturnType<typeof transitionFixture>>;

async function createRuntimeStartMissionHandoff(fixture: TransitionFixture) {
  const missionId = crypto.randomUUID();
  const sourceGoalId = crypto.randomUUID();
  const targetGoalId = crypto.randomUUID();
  const userId = `runtime-transition-test:${fixture.projectId}`;
  const planRevision = `plan-runtime-start:${fixture.projectId}`;
  const now = new Date();
  const requirement = {
    kind: "runtime.start",
    version: 1,
    sourceStepId: "runtime-start",
    targetStepId: "target-step",
    from: "stopped",
    to: "running",
  };
  const plan = { hash: planRevision, transitionRequirements: [requirement] };

  await db.insert(aiMissionsTable).values({
    id: missionId,
    projectId: fixture.projectId,
    userId,
    title: "Runtime transition handoff",
    intent: "Verify the exact runtime transition before dispatching its successor",
    status: "active",
    scope: { kind: "project", projectId: fixture.projectId },
    autonomyPolicy: { activePlanRevision: planRevision },
    createdAt: now,
    updatedAt: now,
  });
  await db.insert(aiGoalsTable).values([
    {
      id: sourceGoalId,
      missionId,
      projectId: fixture.projectId,
      title: "Start runtime",
      status: "completed",
      nextAction: { kind: "recipe", recipeId: "runtime.start", recipeVersion: 1 },
      successCriteria: { stepId: "runtime-start", planRevision: plan },
      outcomeContract: { planRevision: { hash: planRevision } },
      createdAt: now,
      updatedAt: now,
    },
    {
      id: targetGoalId,
      missionId,
      projectId: fixture.projectId,
      title: "Verify runtime",
      status: "waiting_for_event",
      nextAction: {
        kind: "recipe",
        recipeId: "candidate.verify",
        recipeVersion: 1,
        approvedPaths: ["package.json"],
      },
      successCriteria: {
        stepId: "target-step",
        planRevision: plan,
        transitionRequirement: requirement,
      },
      outcomeContract: { planRevision: { hash: planRevision } },
      blockedReason: "runtime_transition_pending",
      createdAt: now,
      updatedAt: now,
    },
  ]);
  await db.update(aiMissionsTable)
    .set({ status: "waiting", updatedAt: now })
    .where(eq(aiMissionsTable.id, missionId));
  await db.update(aiExecutionsTable)
    .set({ goalId: sourceGoalId })
    .where(eq(aiExecutionsTable.id, fixture.executionId));
  await db.update(aiAgentEpisodesTable)
    .set({ missionId, goalId: sourceGoalId, planRevision })
    .where(eq(aiAgentEpisodesTable.id, fixture.episodeId));

  return { missionId, sourceGoalId, targetGoalId, planRevision };
}

async function insertValidRuntimeStartObservations(
  fixture: TransitionFixture,
  childOverrides: {
    completeness?: "complete" | "partial" | "failed";
    freshness?: "fresh" | "stale" | "unknown";
    environmentFreshness?: "fresh" | "stale" | "unknown";
    value?: Record<string, unknown>;
  } = {},
): Promise<void> {
  const now = new Date();
  const common = {
    projectId: fixture.projectId,
    executionId: fixture.executionId,
    episodeId: fixture.episodeId,
    taskScope: "project" as const,
    environmentRevisionKey: `revision:${fixture.environmentRevision}`,
    provenance: "DIRECT_OBSERVATION" as const,
    sourceVersion: fixture.sourceRevision,
    sourceRefs: [],
    observedAt: now,
    projectRevision: fixture.sourceRevision,
    environmentRevision: fixture.environmentRevision,
    completeness: "complete" as const,
    freshness: "fresh" as const,
    environmentFreshness: "fresh" as const,
    evidenceRefs: [],
    createdAt: now,
  };
  const childBinding = childProcessBindingDigest({
    projectId: fixture.projectId,
    sessionId: fixture.sessionId,
    executionId: fixture.executionId,
    executionAttempt: 0,
    episodeId: fixture.episodeId,
    operationId: fixture.operationId,
    revision: fixture.sourceRevision,
  });
  await db.insert(aiAgentObservationsTable).values({
    ...common,
    id: fixture.beforeObservationId,
    kind: "direct_observation",
    observationRole: "runtime.before_state",
    sourceType: "direct_observation",
    sourceId: fixture.beforeObservationId,
    subject: `runtime:${fixture.projectId}`,
    predicate: "runtime.before_state",
    value: {
      status: "observed",
      runtimeStatus: "stopped",
      inventoryComplete: true,
      unknownListenerPorts: [],
      sessionId: null,
      projectId: fixture.projectId,
      revision: fixture.sourceRevision,
      environmentRevision: fixture.environmentRevision,
      observedAt: now.toISOString(),
    },
    valueHash: "1".repeat(64),
    sequence: 0,
  });
  await db.insert(aiAgentObservationsTable).values({
    ...common,
    id: fixture.afterObservationId,
    kind: "direct_observation",
    observationRole: "runtime.after_state",
    sourceType: "direct_observation",
    sourceId: fixture.afterObservationId,
    subject: `runtime:${fixture.sessionId}`,
    predicate: "runtime.after_state",
    value: {
      status: "passed",
      runtimeStatus: "running",
      projectId: fixture.projectId,
      revision: fixture.sourceRevision,
      sessionId: fixture.sessionId,
      environmentRevision: fixture.environmentRevision,
      processAlive: true,
      portReady: true,
      pid: 4321,
      port: 3000,
      observedAt: now.toISOString(),
    },
    valueHash: "2".repeat(64),
    sequence: 1,
  });
  await db.insert(aiAgentObservationsTable).values({
    ...common,
    id: fixture.statusObservationId,
    kind: "direct_observation",
    observationRole: "runtime.status",
    sourceType: "direct_observation",
    sourceId: fixture.statusObservationId,
    subject: `runtime:${fixture.sessionId}`,
    predicate: "runtime.status",
    value: "running",
    valueHash: "3".repeat(64),
    sequence: 2,
  });
  const childProcessObservation: typeof aiAgentObservationsTable.$inferInsert = {
    ...common,
    id: fixture.childProcessObservationId,
    kind: "child_process_attestation",
    observationRole: "runtime.child_process_environment",
    sourceType: "child_process_attestation",
    sourceId: `runtime-child-process:${fixture.sessionId}`,
    subject: `runtime:${fixture.sessionId}`,
    predicate: "runtime.child_process_environment",
    value: {
      status: "known",
      reasonCode: "child_process_observed",
      sessionId: fixture.sessionId,
      operationId: fixture.operationId,
      bindingDigest: childBinding,
      attestationDigest: "4".repeat(64),
      processEnvironmentDigest: "5".repeat(64),
      ...childOverrides.value,
    },
    valueHash: "6".repeat(64),
    sequence: 3,
    completeness: childOverrides.completeness ?? common.completeness,
    freshness: childOverrides.freshness ?? common.freshness,
    environmentFreshness: childOverrides.environmentFreshness ?? common.environmentFreshness,
  };
  await db.insert(aiAgentObservationsTable).values(childProcessObservation);
}

describe("runtime.start transition retry scheduling", () => {
  it("leaves an active transition pending without consuming retries before acceptance", async () => {
    const fixture = await transitionFixture({ accepted: false });

    expect(await retryPendingRuntimeStartTransitions(1)).toBe(1);
    const [transition] = await db.select({
      status: aiWorldTransitionsTable.status,
      retryCount: aiWorldTransitionsTable.retryCount,
      failureCode: aiWorldTransitionsTable.failureCode,
      nextRetryAt: aiWorldTransitionsTable.nextRetryAt,
    }).from(aiWorldTransitionsTable)
      .where(eq(aiWorldTransitionsTable.id, fixture.transitionId));

    expect(transition).toMatchObject({
      status: "pending",
      retryCount: 0,
      failureCode: null,
      nextRetryAt: null,
    });
  });

  it("fails explicitly when execution ends without a successful acceptance", async () => {
    const fixture = await transitionFixture({ accepted: false });
    const now = new Date();
    await db.update(aiExecutionsTable)
      .set({ status: "failed", completedAt: now, updatedAt: now })
      .where(eq(aiExecutionsTable.id, fixture.executionId));

    expect(await retryPendingRuntimeStartTransitions(1)).toBe(1);
    const [transition] = await db.select({
      status: aiWorldTransitionsTable.status,
      failureCode: aiWorldTransitionsTable.failureCode,
      retryCount: aiWorldTransitionsTable.retryCount,
      nextRetryAt: aiWorldTransitionsTable.nextRetryAt,
    }).from(aiWorldTransitionsTable)
      .where(eq(aiWorldTransitionsTable.id, fixture.transitionId));

    expect(transition).toMatchObject({
      status: "terminal_failed",
      failureCode: "runtime_start_transition_acceptance_missing",
      retryCount: 0,
      nextRetryAt: null,
    });
  });

  it("fails closed when acceptance is not bound to the transition EffectBundle", async () => {
    const fixture = await transitionFixture();
    await db.update(aiExecutionAcceptancesTable)
      .set({ effectBundleId: null })
      .where(eq(aiExecutionAcceptancesTable.executionId, fixture.executionId));

    expect(await retryPendingRuntimeStartTransitions(1)).toBe(1);
    const [transition] = await db.select({
      status: aiWorldTransitionsTable.status,
      failureCode: aiWorldTransitionsTable.failureCode,
      retryCount: aiWorldTransitionsTable.retryCount,
    }).from(aiWorldTransitionsTable)
      .where(eq(aiWorldTransitionsTable.id, fixture.transitionId));

    expect(transition).toMatchObject({
      status: "terminal_failed",
      failureCode: "runtime_start_transition_acceptance_effect_bundle_mismatch",
      retryCount: 0,
    });
  });

  it("resumes transition processing after the active execution is accepted", async () => {
    const fixture = await transitionFixture({ accepted: false });
    expect(await retryPendingRuntimeStartTransitions(1)).toBe(1);
    await acceptTransitionFixture(fixture);

    expect(await retryPendingRuntimeStartTransitions(1)).toBe(1);
    const [transition] = await db.select({
      status: aiWorldTransitionsTable.status,
      failureCode: aiWorldTransitionsTable.failureCode,
    }).from(aiWorldTransitionsTable)
      .where(eq(aiWorldTransitionsTable.id, fixture.transitionId));

    // The fixture intentionally lacks direct before/after observation rows;
    // reaching this failure proves the accepted transition passed the wait gate.
    expect(transition).toMatchObject({
      status: "terminal_failed",
      failureCode: "runtime_start_transition_observations_incomplete",
    });
  });

  it("returns the same transition for an identical retry", async () => {
    const fixture = await transitionFixture({ accepted: false });

    await expect(createPendingRuntimeStartTransition(fixture.transitionInput))
      .resolves.toBe(fixture.transitionId);
  });

  it.each([
    ["environmentRevision", { environmentRevision: `env-v1:${"e".repeat(64)}` }],
    ["parentFactRefs", { parentFactRefs: ["fact:different"] }],
    ["evidenceRefs", { evidenceRefs: ["evidence:different"] }],
  ] as const)("rejects an idempotency retry with changed %s", async (_field, changed) => {
    const fixture = await transitionFixture({ accepted: false });

    await expect(createPendingRuntimeStartTransition({
      ...fixture.transitionInput,
      ...changed,
    })).rejects.toThrow("runtime_start_transition_idempotency_conflict");
  });

  it("does not claim a pending transition before its backoff is due", async () => {
    const fixture = await transitionFixture();
    const nextRetryAt = new Date(Date.now() + 60_000);
    await db.update(aiWorldTransitionsTable)
      .set({ status: "retrying", nextRetryAt, retryCount: 1 })
      .where(eq(aiWorldTransitionsTable.id, fixture.transitionId));

    expect(await retryPendingRuntimeStartTransitions()).toBe(0);
    const [transition] = await db.select({
      status: aiWorldTransitionsTable.status,
      retryCount: aiWorldTransitionsTable.retryCount,
      nextRetryAt: aiWorldTransitionsTable.nextRetryAt,
    }).from(aiWorldTransitionsTable)
      .where(eq(aiWorldTransitionsTable.id, fixture.transitionId));
    expect(transition).toMatchObject({
      status: "retrying",
      retryCount: 1,
      nextRetryAt,
    });
  });

  it("keeps Gate C acceptance when due transition projection fails", async () => {
    const fixture = await transitionFixture();
    expect(await retryPendingRuntimeStartTransitions(1)).toBe(1);

    const [transition] = await db.select({
      status: aiWorldTransitionsTable.status,
      failureCode: aiWorldTransitionsTable.failureCode,
      retryCount: aiWorldTransitionsTable.retryCount,
    }).from(aiWorldTransitionsTable)
      .where(and(
        eq(aiWorldTransitionsTable.id, fixture.transitionId),
        eq(aiWorldTransitionsTable.executionId, fixture.executionId),
      ));
    expect(transition).toMatchObject({
      status: "terminal_failed",
      retryCount: 0,
    });
    const [acceptance] = await db.select({
      outcome: aiExecutionAcceptancesTable.outcome,
      effectBundleId: aiExecutionAcceptancesTable.effectBundleId,
    }).from(aiExecutionAcceptancesTable)
      .where(eq(aiExecutionAcceptancesTable.executionId, fixture.executionId));
    expect(acceptance).toMatchObject({
      outcome: "SUCCEEDED",
      effectBundleId: expect.any(String),
    });
  });

  it("dispatches one Mission successor only after the exact runtime.start transition materializes", async () => {
    const fixture = await transitionFixture();
    const mission = await createRuntimeStartMissionHandoff(fixture);
    await insertValidRuntimeStartObservations(fixture);
    const enqueue = vi.spyOn(heavyJobQueue, "enqueueWithId").mockReturnValue(true);

    const finalized = await finalizeRuntimeStartTransition({
      projectId: fixture.projectId,
      executionId: fixture.executionId,
      attempt: 0,
      episodeId: fixture.episodeId,
      actionId: fixture.transitionInput.actionId,
      effectBundleId: fixture.effectBundleId,
    });
    expect(finalized.status).toBe("materialized");

    const [transition] = await db.select().from(aiWorldTransitionsTable)
      .where(eq(aiWorldTransitionsTable.id, fixture.transitionId));
    expect(transition).toMatchObject({
      status: "materialized",
      effectBundleId: fixture.effectBundleId,
      parentWorldRevision: fixture.transitionInput.parentWorldRevision,
      resultingWorldRevision: expect.stringMatching(/^[a-f0-9]{64}$/),
      beforeObservationIds: [fixture.beforeObservationId],
      afterObservationIds: [
        fixture.afterObservationId,
        fixture.statusObservationId,
        fixture.childProcessObservationId,
      ],
    });

    const woken = await wakeRuntimeTransitionMissionGoals();
    const [targetAfterWake] = await db.select({
      status: aiGoalsTable.status,
      blockedReason: aiGoalsTable.blockedReason,
    }).from(aiGoalsTable).where(eq(aiGoalsTable.id, mission.targetGoalId));
    expect(woken).toBe(1);
    expect(targetAfterWake).toMatchObject({
      status: "running",
      blockedReason: null,
    });
    expect(await wakeRuntimeTransitionMissionGoals()).toBe(0);

    const dispatches = await db.select({
      type: eventsTable.type,
      goalId: eventsTable.goalId,
      payload: eventsTable.payload,
    }).from(eventsTable).where(eq(eventsTable.projectId, fixture.projectId));
    const targetDispatches = dispatches.filter((event) =>
      event.type === "AiGoalRecipeDispatchRequested"
      && event.goalId === mission.targetGoalId,
    );
    expect(targetDispatches).toHaveLength(1);
    expect(targetDispatches[0]?.payload).toMatchObject({
      transitionProof: {
        transitionId: fixture.transitionId,
        executionId: fixture.executionId,
        attempt: 0,
        episodeId: fixture.episodeId,
        actionId: fixture.transitionInput.actionId,
        effectBundleId: fixture.effectBundleId,
        parentWorldRevision: fixture.transitionInput.parentWorldRevision,
        resultingWorldRevision: transition?.resultingWorldRevision,
        projectRevision: fixture.sourceRevision,
        environmentRevision: fixture.environmentRevision,
        beforeObservationIds: [fixture.beforeObservationId],
        afterObservationIds: [
          fixture.afterObservationId,
          fixture.statusObservationId,
          fixture.childProcessObservationId,
        ],
        sourceStepId: "runtime-start",
        targetStepId: "target-step",
        activePlanHash: mission.planRevision,
      },
    });
    expect(enqueue).toHaveBeenCalledTimes(1);
  });

  const invalidChildEvidenceScenarios: Array<{
    label: string;
    expectedFailure: string;
    omitChildReference?: boolean;
    childOverrides?: NonNullable<Parameters<typeof insertValidRuntimeStartObservations>[1]>;
  }> = [
    {
      label: "missing from the transition's linked evidence",
      expectedFailure: "runtime_start_transition_child_process_attestation_missing",
      omitChildReference: true,
    },
    {
      label: "incomplete",
      expectedFailure: "runtime_start_transition_observations_incomplete",
      childOverrides: { completeness: "partial" },
    },
    {
      label: "stale",
      expectedFailure: "runtime_start_transition_observations_incomplete",
      childOverrides: { freshness: "stale", environmentFreshness: "stale" },
    },
    {
      label: "unknown",
      expectedFailure: "runtime_start_transition_child_process_attestation_unproven",
      childOverrides: { value: { status: "unknown", reasonCode: "child_process_unknown" } },
    },
    {
      label: "bound to a different runtime session",
      expectedFailure: "runtime_start_transition_child_process_attestation_unproven",
      childOverrides: { value: { sessionId: "other-runtime-session" } },
    },
    {
      label: "with a mismatched binding digest",
      expectedFailure: "runtime_start_transition_child_process_attestation_unproven",
      childOverrides: { value: { bindingDigest: "f".repeat(64) } },
    },
  ];
  it.each(invalidChildEvidenceScenarios)("blocks World Delta when child-process evidence is $label", async (scenario) => {
    const fixture = await transitionFixture();
    const mission = await createRuntimeStartMissionHandoff(fixture);
    const parent = await getProjectWorldState(fixture.projectId, {
      excludeEpisodeIds: [fixture.episodeId],
    });
    const enqueue = vi.spyOn(heavyJobQueue, "enqueueWithId").mockReturnValue(true);
    await insertValidRuntimeStartObservations(fixture, scenario.childOverrides);
    if (scenario.omitChildReference) {
      await db.update(aiWorldTransitionsTable)
        .set({
          afterObservationIds: [
            fixture.afterObservationId,
            fixture.statusObservationId,
          ],
        })
        .where(eq(aiWorldTransitionsTable.id, fixture.transitionId));
    }

    const result = await finalizeRuntimeStartTransition({
      projectId: fixture.projectId,
      executionId: fixture.executionId,
      attempt: 0,
      episodeId: fixture.episodeId,
      actionId: fixture.transitionInput.actionId,
      effectBundleId: fixture.effectBundleId,
    });
    expect(result).toMatchObject({
      status: "terminal_failed",
      failureCode: scenario.expectedFailure,
    });

    const [transition] = await db.select({
      status: aiWorldTransitionsTable.status,
      failureCode: aiWorldTransitionsTable.failureCode,
      retryCount: aiWorldTransitionsTable.retryCount,
    }).from(aiWorldTransitionsTable)
      .where(eq(aiWorldTransitionsTable.id, fixture.transitionId));
    expect(transition).toMatchObject({
      status: "terminal_failed",
      failureCode: scenario.expectedFailure,
      retryCount: 0,
    });

    const [acceptance] = await db.select({
      outcome: aiExecutionAcceptancesTable.outcome,
      effectBundleId: aiExecutionAcceptancesTable.effectBundleId,
    }).from(aiExecutionAcceptancesTable)
      .where(eq(aiExecutionAcceptancesTable.executionId, fixture.executionId));
    expect(acceptance).toMatchObject({
      outcome: "SUCCEEDED",
      effectBundleId: fixture.effectBundleId,
    });

    const after = await getProjectWorldState(fixture.projectId, {
      excludeEpisodeIds: [fixture.episodeId],
    });
    expect(after.worldRevision).toBe(parent.worldRevision);
    expect(after.facts).toEqual(parent.facts);

    expect(await wakeRuntimeTransitionMissionGoals()).toBe(0);
    const dispatches = await db.select({
      type: eventsTable.type,
      goalId: eventsTable.goalId,
    }).from(eventsTable).where(eq(eventsTable.projectId, fixture.projectId));
    expect(dispatches.some((event) =>
      event.type === "AiGoalRecipeDispatchRequested"
      && event.goalId === mission.targetGoalId,
    )).toBe(false);
    const [target] = await db.select({
      status: aiGoalsTable.status,
      blockedReason: aiGoalsTable.blockedReason,
    }).from(aiGoalsTable).where(eq(aiGoalsTable.id, mission.targetGoalId));
    expect(target).toMatchObject({
      status: "needs_replan",
      blockedReason: "runtime_start_transition_unproven",
    });
    expect(enqueue).not.toHaveBeenCalled();
  });

  it("terminalizes due retry-exhausted work without attempting projection", async () => {
    const fixture = await transitionFixture();
    await db.update(aiWorldTransitionsTable)
      .set({ status: "retrying", retryCount: 8, nextRetryAt: new Date(Date.now() - 1_000) })
      .where(eq(aiWorldTransitionsTable.id, fixture.transitionId));

    expect(await retryPendingRuntimeStartTransitions(1)).toBe(1);
    const [transition] = await db.select({
      status: aiWorldTransitionsTable.status,
      failureCode: aiWorldTransitionsTable.failureCode,
      nextRetryAt: aiWorldTransitionsTable.nextRetryAt,
    }).from(aiWorldTransitionsTable)
      .where(eq(aiWorldTransitionsTable.id, fixture.transitionId));
    expect(transition).toMatchObject({
      status: "terminal_failed",
      failureCode: "world_state_materialization_retry_exhausted",
      nextRetryAt: null,
    });
  });

  it("rolls back World State facts if the transition commit fails in the same transaction", async () => {
    const fixture = await transitionFixture();
    const observationId = crypto.randomUUID();
    const environmentRevision = `env-v1:${"c".repeat(64)}`;
    const projectRevision = "a".repeat(64);
    const now = new Date();
    await db.insert(aiAgentObservationsTable).values({
      id: observationId,
      projectId: fixture.projectId,
      executionId: fixture.executionId,
      episodeId: fixture.episodeId,
      taskScope: "project",
      environmentRevisionKey: `revision:${environmentRevision}`,
      kind: "direct_observation",
      provenance: "DIRECT_OBSERVATION",
      observationRole: "runtime.test",
      sourceType: "direct_observation",
      sourceId: observationId,
      sourceVersion: projectRevision,
      subject: `runtime:${fixture.projectId}`,
      predicate: "runtime.test_state",
      value: { status: "observed" },
      valueHash: "d".repeat(64),
      sourceRefs: [],
      observedAt: now,
      projectRevision,
      environmentRevision,
      completeness: "complete",
      freshness: "fresh",
      environmentFreshness: "fresh",
      evidenceRefs: [],
      sequence: 1,
      createdAt: now,
    });
    const parent = await getProjectWorldState(fixture.projectId, {
      excludeEpisodeIds: [fixture.episodeId],
    });

    await expect(materializeWorldStateForProject(fixture.projectId, {
      observationIds: [observationId],
      expectedWorldRevision: parent.worldRevision,
      expectedRevisionExcludeEpisodeIds: [fixture.episodeId],
    }, async () => {
      throw new Error("transition_commit_test_failure");
    })).rejects.toThrow("transition_commit_test_failure");

    const after = await getProjectWorldState(fixture.projectId, {
      excludeEpisodeIds: [fixture.episodeId],
    });
    expect(after.worldRevision).toBe(parent.worldRevision);
    expect(after.facts).toHaveLength(0);
  });
});