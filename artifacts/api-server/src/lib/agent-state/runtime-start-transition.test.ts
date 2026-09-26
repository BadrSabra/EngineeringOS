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

async function transitionFixture() {
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
  const transitionId = await createPendingRuntimeStartTransition({
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
  });
  await db.update(aiExecutionsTable)
    .set({ status: "completed", completedAt: now, updatedAt: now })
    .where(eq(aiExecutionsTable.id, actualExecutionId));
  await db.insert(aiExecutionAcceptancesTable).values({
    id: crypto.randomUUID(),
    executionId: actualExecutionId,
    projectId,
    attempt: 0,
    finalizationKey: `final:${actualExecutionId}`,
    operationId,
    workerId,
    terminalStatus: "completed",
    outcome: "SUCCEEDED",
    reasonCode: "CANONICAL_PROOF_PROVEN",
    nextActionCode: "none",
    effectBundleId,
    createdAt: now,
  });
  return {
    projectId,
    executionId: actualExecutionId,
    episodeId: episode.episodeId,
    transitionId,
  };
}

describe("runtime.start transition retry scheduling", () => {
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