import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { eq } from "drizzle-orm";
import {
  aiAgentObservationsTable,
  aiExecutionsTable,
  db,
  projectsTable,
} from "@workspace/db";
import type { JsonValue } from "@workspace/ai-orchestrator";
import { startEpisode } from "./agent-episode-ledger.js";
import { materializeServerOwnedObservations } from "./observation-materializer.js";
import {
  getProjectWorldState,
  materializeWorldStateForProject,
} from "./world-state.js";

const userId = "world-state-test-user";
let projectId = "";
let executionId = "";
let episodeId = "";
let workerId = "";

async function createFixture() {
  projectId = `world-state-project-${randomUUID()}`;
  executionId = `world-state-execution-${randomUUID()}`;
  workerId = `world-state-worker-${randomUUID()}`;

  await db.insert(projectsTable).values({
    id: projectId,
    ownerId: userId,
    name: "World State fixture",
    rootPath: `/tmp/${projectId}`,
    language: "typescript",
  });
  await db.insert(aiExecutionsTable).values({
    id: executionId,
    projectId,
    userId,
    idempotencyKey: `world-state-idempotency-${randomUUID()}`,
    resumeTokenHash: "world-state-resume-token-hash",
    request: JSON.stringify({ projectId, message: "fixture" }),
    checkpoint: "{}",
    status: "running",
    workerId,
    leaseUntil: new Date(Date.now() + 300_000),
    baseRevision: "revision-1",
  });
  const episode = await startEpisode({
    projectId,
    executionId,
    attempt: 0,
    workerId,
    idempotencyKey: `world-state-episode-${randomUUID()}`,
    projectRevision: "revision-1",
    intentKind: "TEST",
    scope: { kind: "test", projectId },
  });
  episodeId = episode.episodeId;
}

async function removeFixture() {
  if (projectId) {
    await db.delete(projectsTable).where(eq(projectsTable.id, projectId));
  }
}

async function addRuntimeObservation(input: {
  sourceId: string;
  revision: string;
  profile: string;
  projectRevision?: string;
  environmentRevision?: string;
  targetEpisodeId?: string;
  targetExecutionId?: string;
}) {
  return materializeServerOwnedObservations({
    projectId,
    executionId: input.targetExecutionId ?? executionId,
    attempt: 0,
    episodeId: input.targetEpisodeId ?? episodeId,
    projectRevision: input.projectRevision ?? input.revision,
    sources: [{
      kind: "runtime_receipt",
      sourceId: input.sourceId,
      sourceRevision: input.revision,
      status: "passed",
      profile: input.profile,
      environmentRevision: input.environmentRevision,
    }],
  });
}

async function createScopedEpisode(
  scope: JsonValue,
  suffix: string,
  options: { intentKind?: string; environmentRootPath?: string } = {},
) {
  const scopedExecutionId = `world-state-execution-${suffix}-${randomUUID()}`;
  const scopedWorkerId = `world-state-worker-${suffix}-${randomUUID()}`;
  await db.insert(aiExecutionsTable).values({
    id: scopedExecutionId,
    projectId,
    userId,
    idempotencyKey: `world-state-idempotency-${suffix}-${randomUUID()}`,
    resumeTokenHash: `world-state-resume-token-hash-${suffix}`,
    request: JSON.stringify({ projectId, message: "fixture" }),
    checkpoint: "{}",
    status: "running",
    workerId: scopedWorkerId,
    leaseUntil: new Date(Date.now() + 300_000),
    baseRevision: "revision-1",
  });
  const episode = await startEpisode({
    projectId,
    executionId: scopedExecutionId,
    attempt: 0,
    workerId: scopedWorkerId,
    idempotencyKey: `world-state-episode-${suffix}-${randomUUID()}`,
    projectRevision: "revision-1",
    intentKind: options.intentKind ?? "TEST",
    scope,
    ...(options.environmentRootPath ? { environmentRootPath: options.environmentRootPath } : {}),
  });
  return {
    executionId: scopedExecutionId,
    episodeId: episode.episodeId,
    environmentRevision: episode.environmentRevision,
  };
}

describe("read-only World State projection", () => {
  beforeEach(createFixture);
  afterEach(removeFixture);

  it("is idempotent, records same-revision contradictions, and supersedes across revisions", async () => {
    await addRuntimeObservation({
      sourceId: "runtime:one",
      revision: "revision-1",
      profile: "profile-a",
    });
    const retry = await addRuntimeObservation({
      sourceId: "runtime:one",
      revision: "revision-1",
      profile: "profile-a",
    });
    expect(retry.inserted).toBe(0);

    await addRuntimeObservation({
      sourceId: "runtime:one",
      revision: "revision-1",
      profile: "profile-b",
    });
    let state = await getProjectWorldState(projectId);
    expect(state.facts).toHaveLength(2);
    expect(state.facts.every((fact) => fact.status === "contradicted")).toBe(true);
    expect(state.currentFacts).toHaveLength(0);
    expect(state.contradictions).toHaveLength(2);

    await addRuntimeObservation({
      sourceId: "runtime:one",
      revision: "revision-2",
      profile: "profile-c",
    });
    await addRuntimeObservation({
      sourceId: "runtime:two",
      revision: "revision-1",
      profile: "profile-old",
    });
    await addRuntimeObservation({
      sourceId: "runtime:two",
      revision: "revision-2",
      profile: "profile-new",
    });
    state = await getProjectWorldState(projectId);
    expect(state.currentFacts).toHaveLength(2);
    expect(state.currentFacts).toEqual(expect.arrayContaining([
      expect.objectContaining({
        subject: "execution:runtime:one",
        projectRevision: "revision-2",
        status: "believed",
      }),
      expect.objectContaining({
        subject: "execution:runtime:two",
        projectRevision: "revision-2",
        status: "believed",
      }),
    ]));
    expect(state.facts.filter((fact) => fact.status === "superseded")).toHaveLength(1);
    expect(state.contradictions).toHaveLength(2);
    expect(state.worldRevision).toMatch(/^[a-f0-9]{64}$/);
  });

  it("excludes stale observations and remains stable under concurrent materialization", async () => {
    await addRuntimeObservation({
      sourceId: "runtime:stale",
      revision: "old-revision",
      projectRevision: "revision-1",
      profile: "stale-profile",
    });
    let state = await getProjectWorldState(projectId);
    expect(state.facts).toHaveLength(0);

    await addRuntimeObservation({
      sourceId: "runtime:fresh",
      revision: "revision-1",
      profile: "fresh-profile",
    });
    const results = await Promise.all([
      materializeWorldStateForProject(projectId),
      materializeWorldStateForProject(projectId),
    ]);
    expect(results.map((result) => result.inserted).sort()).toEqual([0, 0]);
    state = await getProjectWorldState(projectId);
    expect(state.facts).toHaveLength(1);
    expect(state.currentFacts[0]?.projectRevision).toBe("revision-1");
  });

  it("isolates facts and contradictions by task scope and environment", async () => {
    const taskA = await createScopedEpisode({ kind: "task", taskId: "task-a" }, "task-a");
    const taskB = await createScopedEpisode({ kind: "task", taskId: "task-b" }, "task-b");
    await addRuntimeObservation({
      sourceId: "runtime:shared",
      revision: "revision-1",
      profile: "profile-a",
      environmentRevision: "env-a",
      targetEpisodeId: taskA.episodeId,
      targetExecutionId: taskA.executionId,
    });
    await addRuntimeObservation({
      sourceId: "runtime:shared",
      revision: "revision-1",
      profile: "profile-b",
      environmentRevision: "env-a",
      targetEpisodeId: taskB.episodeId,
      targetExecutionId: taskB.executionId,
    });
    await addRuntimeObservation({
      sourceId: "runtime:shared",
      revision: "revision-1",
      profile: "profile-b",
      environmentRevision: "env-b",
      targetEpisodeId: taskA.episodeId,
      targetExecutionId: taskA.executionId,
    });

    const state = await getProjectWorldState(projectId);
    expect(state.currentFacts).toHaveLength(3);
    expect(state.contradictions).toHaveLength(0);
    expect(new Set(state.facts.map((fact) => fact.taskScope)).size).toBe(2);
    expect(new Set(state.facts.map((fact) => fact.environmentRevision)).size).toBe(2);
    expect(new Set(state.facts.map((fact) => `${fact.taskScope}:${fact.environmentRevision}`)).size).toBe(3);
  });

  it("keeps task scope stable across separate execution attempts", async () => {
    const taskScope = { kind: "task", taskId: "stable-task" } as const;
    const firstAttempt = await createScopedEpisode(taskScope, "stable-first");
    const secondAttempt = await createScopedEpisode(taskScope, "stable-second");
    const first = await addRuntimeObservation({
      sourceId: "runtime:stable",
      revision: "revision-1",
      profile: "profile-a",
      environmentRevision: "env-a",
      targetEpisodeId: firstAttempt.episodeId,
      targetExecutionId: firstAttempt.executionId,
    });
    const second = await addRuntimeObservation({
      sourceId: "runtime:stable",
      revision: "revision-1",
      profile: "profile-a",
      environmentRevision: "env-a",
      targetEpisodeId: secondAttempt.episodeId,
      targetExecutionId: secondAttempt.executionId,
    });

    expect(first.inserted).toBe(1);
    expect(second.inserted).toBe(0);
    expect(second.duplicates).toBe(1);
    expect(second.observationIds).toEqual(first.observationIds);
  });

  it("changes the scoped world revision when a new observation sequence is added", async () => {
    const scoped = await createScopedEpisode({ kind: "task", taskId: "revision-task" }, "revision");
    await addRuntimeObservation({
      sourceId: "runtime:revision",
      revision: "revision-1",
      profile: "profile-a",
      environmentRevision: "env-a",
      targetEpisodeId: scoped.episodeId,
      targetExecutionId: scoped.executionId,
    });
    const first = await getProjectWorldState(projectId);
    const scope = first.facts[0]?.taskScope;
    expect(scope).toBeTruthy();
    const firstScoped = await getProjectWorldState(projectId, {
      taskScope: scope,
      environmentRevision: "env-a",
    });
    expect(firstScoped.facts).toHaveLength(1);
    await addRuntimeObservation({
      sourceId: "runtime:revision",
      revision: "revision-2",
      profile: "profile-a",
      projectRevision: "revision-2",
      environmentRevision: "env-a",
      targetEpisodeId: scoped.episodeId,
      targetExecutionId: scoped.executionId,
    });
    const secondScoped = await getProjectWorldState(projectId, {
      taskScope: scope,
      environmentRevision: "env-a",
    });
    expect(secondScoped.facts).toHaveLength(1);
    expect(secondScoped.worldRevision).not.toBe(firstScoped.worldRevision);
  });

  it("binds environment freshness to the server-owned episode snapshot", async () => {
    const rootPath = await mkdtemp(join(process.cwd(), "world-environment-"));
    try {
      await writeFile(join(rootPath, "package.json"), JSON.stringify({
        name: "world-environment-fixture",
        dependencies: { example: "1.0.0" },
      }));
      const scoped = await createScopedEpisode(
        { kind: "mission-task", taskId: "environment-binding" },
        "environment-binding",
        { intentKind: "TASK_EXECUTION", environmentRootPath: rootPath },
      );
      expect(scoped.environmentRevision).toMatch(/^env-v1:[a-f0-9]{64}$/);

      const receiptEnvironment = "env-v1:deliberately-different";
      const materialized = await materializeServerOwnedObservations({
        projectId,
        executionId: scoped.executionId,
        attempt: 0,
        episodeId: scoped.episodeId,
        environmentRootPath: rootPath,
        projectRevision: "revision-1",
        sources: [{
          kind: "runtime_receipt",
          sourceId: "runtime:environment-mismatch",
          sourceRevision: "revision-1",
          status: "passed",
          profile: "dev",
          environmentRevision: receiptEnvironment,
        }],
      });

      expect(materialized.stale).toBe(0);
      expect(materialized.environmentStale).toBe(1);
      const state = await getProjectWorldState(projectId, {
        environmentRevision: receiptEnvironment,
      });
      expect(state.facts).toHaveLength(0);

      await materializeServerOwnedObservations({
        projectId,
        executionId: scoped.executionId,
        attempt: 0,
        episodeId: scoped.episodeId,
        environmentRootPath: rootPath,
        projectRevision: "revision-1",
        sources: [{
          kind: "runtime_receipt",
          sourceId: "runtime:environment-match",
          sourceRevision: "revision-1",
          status: "passed",
          profile: "dev",
        }],
      });
      const matchingState = await getProjectWorldState(projectId, {
        environmentRevision: scoped.environmentRevision!,
      });
      expect(matchingState.facts).toHaveLength(1);
      expect(matchingState.facts[0]?.environmentFreshness).toBe("fresh");
    } finally {
      await rm(rootPath, { recursive: true, force: true });
    }
  });

  it("detects a manifest change at receipt time without changing project freshness", async () => {
    const rootPath = await mkdtemp(join(process.cwd(), "world-environment-change-"));
    try {
      await writeFile(join(rootPath, "package.json"), JSON.stringify({ name: "before" }));
      const scoped = await createScopedEpisode(
        { kind: "mission-task", taskId: "environment-change" },
        "environment-change",
        { intentKind: "TASK_EXECUTION", environmentRootPath: rootPath },
      );
      await writeFile(join(rootPath, "package.json"), JSON.stringify({ name: "after" }));
      const sourceId = "runtime:environment-change-during-attempt";
      const result = await materializeServerOwnedObservations({
        projectId,
        executionId: scoped.executionId,
        attempt: 0,
        episodeId: scoped.episodeId,
        environmentRootPath: rootPath,
        projectRevision: "revision-1",
        sources: [{
          kind: "runtime_receipt",
          sourceId,
          sourceRevision: "revision-1",
          status: "passed",
          profile: "dev",
        }],
      });

      expect(result.stale).toBe(0);
      expect(result.environmentStale).toBe(1);
      const [observation] = await db.select().from(aiAgentObservationsTable)
        .where(eq(aiAgentObservationsTable.sourceId, sourceId));
      expect(observation?.freshness).toBe("fresh");
      expect(observation?.environmentFreshness).toBe("stale");
      expect(observation?.environmentRevision).toBeTruthy();
      expect(observation?.environmentRevision).not.toBe(scoped.environmentRevision);
      const state = await getProjectWorldState(projectId, {
        taskScope: observation!.taskScope,
        environmentRevision: observation!.environmentRevision!,
      });
      expect(state.facts).toHaveLength(0);
    } finally {
      await rm(rootPath, { recursive: true, force: true });
    }
  });

  it("keeps environment freshness unknown if the receipt-time provider is unavailable", async () => {
    const rootPath = await mkdtemp(join(process.cwd(), "world-environment-unavailable-"));
    try {
      await writeFile(join(rootPath, "package.json"), JSON.stringify({ name: "fixture" }));
      const scoped = await createScopedEpisode(
        { kind: "mission-task", taskId: "environment-unavailable" },
        "environment-unavailable",
        { intentKind: "TASK_EXECUTION", environmentRootPath: rootPath },
      );
      await rm(rootPath, { recursive: true, force: true });

      const sourceId = "runtime:environment-provider-unavailable";
      const result = await materializeServerOwnedObservations({
        projectId,
        executionId: scoped.executionId,
        attempt: 0,
        episodeId: scoped.episodeId,
        environmentRootPath: rootPath,
        projectRevision: "revision-1",
        sources: [{
          kind: "runtime_receipt",
          sourceId,
          sourceRevision: "revision-1",
          status: "passed",
          profile: "dev",
        }],
      });

      expect(result.stale).toBe(0);
      expect(result.environmentStale).toBe(0);
      const [observation] = await db.select().from(aiAgentObservationsTable)
        .where(eq(aiAgentObservationsTable.sourceId, sourceId));
      expect(observation?.freshness).toBe("fresh");
      expect(observation?.environmentFreshness).toBe("unknown");
      expect(observation?.environmentRevision).toBe(scoped.environmentRevision);
    } finally {
      await rm(rootPath, { recursive: true, force: true });
    }
  });
});