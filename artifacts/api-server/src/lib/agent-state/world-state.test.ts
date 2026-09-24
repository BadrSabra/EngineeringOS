import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import {
  aiExecutionsTable,
  db,
  projectsTable,
} from "@workspace/db";
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
}) {
  return materializeServerOwnedObservations({
    projectId,
    executionId,
    attempt: 0,
    episodeId,
    projectRevision: input.projectRevision ?? input.revision,
    sources: [{
      kind: "runtime_receipt",
      sourceId: input.sourceId,
      sourceRevision: input.revision,
      status: "passed",
      profile: input.profile,
    }],
  });
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
});