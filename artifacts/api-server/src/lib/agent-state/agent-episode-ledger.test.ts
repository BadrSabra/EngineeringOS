import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import {
  aiAgentShadowCampaignEventsTable,
  aiExecutionsTable,
  db,
  projectsTable,
} from "@workspace/db";
import {
  EpisodeLedgerError,
  appendEpisodeEvent,
  closeEpisode,
  loadEpisodeForOwner,
  publicEpisodeProjection,
  replayEpisode,
  startEpisode,
} from "./agent-episode-ledger.js";
import {
  loadLatestAgentEpisodeShadowCampaignScorecard,
  persistAgentEpisodeShadowAttempt,
} from "./agent-episode-shadow-campaign.js";
import { resetOperationalCounters } from "../operational-counters.js";

const userId = "agent-episode-ledger-test-user";
let projectId = "";
let executionId = "";
let workerId = "";
let idempotencyKey = "";

async function createFixture() {
  projectId = `agent-episode-project-${randomUUID()}`;
  executionId = `agent-episode-execution-${randomUUID()}`;
  workerId = `agent-episode-worker-${randomUUID()}`;
  idempotencyKey = `agent-episode-idempotency-${randomUUID()}`;
  await db.insert(projectsTable).values({
    id: projectId,
    ownerId: userId,
    name: "Agent episode ledger fixture",
    rootPath: `/tmp/${projectId}`,
    language: "typescript",
  });
  await db.insert(aiExecutionsTable).values({
    id: executionId,
    projectId,
    userId,
    idempotencyKey,
    resumeTokenHash: "fixture-resume-token-hash",
    request: JSON.stringify({ projectId, message: "fixture", modelMessage: "fixture" }),
    checkpoint: "{}",
    status: "running",
    workerId,
    leaseUntil: new Date(Date.now() + 300_000),
    baseRevision: "revision-1",
  });
}

async function removeFixture() {
  await db.delete(aiAgentShadowCampaignEventsTable)
    .where(eq(aiAgentShadowCampaignEventsTable.executionId, executionId));
  if (projectId) {
    await db.delete(projectsTable).where(eq(projectsTable.id, projectId));
  }
}

function startInput(overrides: Record<string, unknown> = {}) {
  return {
    projectId,
    executionId,
    attempt: 0,
    workerId,
    idempotencyKey,
    projectRevision: "revision-1",
    intentKind: "TEST",
    scope: { kind: "test", projectId },
    ...overrides,
  } as Parameters<typeof startEpisode>[0];
}

function eventInput(episodeId: string, overrides: Record<string, unknown> = {}) {
  return {
    episodeId,
    projectId,
    executionId,
    attempt: 0,
    workerId,
    eventType: "OBSERVATION_REQUESTED" as const,
    payload: { role: "test" },
    ...overrides,
  } as Parameters<typeof appendEpisodeEvent>[0];
}

describe("agent episode ledger", () => {
  beforeEach(createFixture);
  afterEach(removeFixture);

  it("is idempotent for one execution attempt and rejects conflicting keys", async () => {
    const first = await startEpisode(startInput());
    const retry = await startEpisode(startInput());
    expect(retry.episodeId).toBe(first.episodeId);
    await expect(startEpisode(startInput({ idempotencyKey: `${idempotencyKey}-conflict` })))
      .rejects.toMatchObject({ code: "invalid_contract" });
  });

  it("rejects attempt mismatch, cross-project access, and stale workers", async () => {
    await expect(startEpisode(startInput({ attempt: 1 })))
      .rejects.toMatchObject({ code: "attempt_mismatch" });
    await expect(startEpisode(startInput({ projectId: "other-project" })))
      .rejects.toMatchObject({ code: "not_found" });
    await expect(startEpisode(startInput({ workerId: "stale-worker" })))
      .rejects.toMatchObject({ code: "stale_worker" });
  });

  it("keeps sequence coherent, replays in order, and deduplicates events", async () => {
    const episode = await startEpisode(startInput());
    const first = await appendEpisodeEvent(eventInput(episode.episodeId));
    const retry = await appendEpisodeEvent(eventInput(episode.episodeId));
    const second = await appendEpisodeEvent(eventInput(episode.episodeId, {
      eventType: "OBSERVATION_RECORDED",
      payload: { role: "test", complete: true },
    }));
    const replay = await replayEpisode({ userId, projectId, episodeId: episode.episodeId });
    expect(first.sequence).toBe(1);
    expect(retry.eventId).toBe(first.eventId);
    expect(second.sequence).toBe(2);
    expect(replay.events.map((event) => event.sequence)).toEqual([0, 1, 2]);
  });

  it("keeps terminal outcomes immutable, including cancellation", async () => {
    const episode = await startEpisode(startInput());
    const closed = await closeEpisode({
      ...eventInput(episode.episodeId),
      eventType: "EPISODE_CANCELLED",
      payload: { reason: "operator_cancelled" },
      verdict: "cancelled",
      reasonCode: "USER_CANCELLED",
    });
    expect(closed.state).toBe("cancelled");
    expect((await closeEpisode({
      ...eventInput(episode.episodeId),
      eventType: "EPISODE_CANCELLED",
      payload: { reason: "operator_cancelled" },
      verdict: "cancelled",
      reasonCode: "USER_CANCELLED",
    })).episodeId).toBe(episode.episodeId);
    await expect(appendEpisodeEvent(eventInput(episode.episodeId, {
      eventType: "OBSERVATION_RECORDED",
      payload: { late: true },
    }))).rejects.toMatchObject({ code: "terminal_immutable" });
  });

  it("loads only owner-scoped episodes and redacts private episode scope", async () => {
    const episode = await startEpisode(startInput({
      scope: { privatePath: "/tmp/secret", providerDiagnostics: "do-not-persist-publicly" },
    }));
    const loaded = await loadEpisodeForOwner({ userId, projectId, episodeId: episode.episodeId });
    const publicProjection = publicEpisodeProjection(loaded);
    expect(publicProjection).not.toHaveProperty("scope");
    expect(JSON.stringify(publicProjection)).not.toContain("/tmp/secret");
    await expect(loadEpisodeForOwner({ userId: "other-user", projectId, episodeId: episode.episodeId }))
      .rejects.toBeInstanceOf(EpisodeLedgerError);
  });

  it("reads a durable scorecard after in-process counters reset", async () => {
    await persistAgentEpisodeShadowAttempt({
      projectId,
      executionId,
      attempt: 0,
      idempotencyKey: `${idempotencyKey}:success`,
      outcome: "success",
      latencyMs: 12,
    });
    await persistAgentEpisodeShadowAttempt({
      projectId,
      executionId,
      attempt: 0,
      idempotencyKey: `${idempotencyKey}:success`,
      outcome: "success",
      latencyMs: 12,
    });
    await persistAgentEpisodeShadowAttempt({
      projectId,
      executionId,
      attempt: 0,
      idempotencyKey: `${idempotencyKey}:failure`,
      outcome: "failure",
      failureCode: "stale_worker",
      latencyMs: 20,
    });
    resetOperationalCounters();

    const scorecard = await loadLatestAgentEpisodeShadowCampaignScorecard();
    expect(scorecard).toMatchObject({
      writes: 2,
      successes: 1,
      failures: 1,
      staleWorkerRejections: 1,
      p95LatencyMs: 20,
    });
  });
});