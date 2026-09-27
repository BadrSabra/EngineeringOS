import { and, eq } from "drizzle-orm";
import { afterEach, describe, expect, it } from "vitest";
import {
  aiAgentEffectBundlesTable,
  aiAgentObservationsTable,
  aiChatSessionsTable,
  aiExecutionAcceptancesTable,
  aiExecutionsTable,
  aiWorldTransitionsTable,
  db,
  projectsTable,
} from "@workspace/db";
import { createAiExecution, claimAiExecution } from "../ai-execution-state.js";
import { startEpisode } from "./agent-episode-ledger.js";
import {
  createPendingRuntimeStartTransition,
  retryPendingRuntimeStartTransitions,
} from "./runtime-start-transition.js";
import {
  getProjectWorldState,
  materializeWorldStateForProject,
} from "./world-state.js";

const createdProjects: string[] = [];
const createdExecutionIds: string[] = [];

afterEach(async () => {
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
    rootPath: process.cwd(),
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
  const transitionInput = {
    projectId,
    executionId: actualExecutionId,
    attempt: 0,
    episodeId: episode.episodeId,
    actionId: `action:${operationId}`,
    effectBundleId,
    workerId,
    parentWorldRevision: "b".repeat(64),
    parentFactRefs: [],
    beforeObservationIds: ["before"],
    afterObservationIds: ["after"],
    evidenceRefs: ["evidence"],
    environmentRevision: "env-v1:" + "c".repeat(64),
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
    transitionId,
    operationId,
    effectBundleId,
    transitionInput,
  };
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
      failureCode: "runtime_start_transition_observations_missing",
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