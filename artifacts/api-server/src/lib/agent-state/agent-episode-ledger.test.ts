import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import {
  aiAgentEpisodesTable,
  aiAgentObservationsTable,
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
import { materializeServerOwnedObservations } from "./observation-materializer.js";

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

  it("requires canonical actions on request events and records their episode references", async () => {
    const episode = await startEpisode(startInput());
    await expect(appendEpisodeEvent(eventInput(episode.episodeId, {
      eventType: "ACTION_REQUESTED",
      payload: { actionId: "action-invalid", capabilityId: "test.capability" },
    }))).rejects.toMatchObject({ code: "invalid_contract" });

    const action = {
      schemaVersion: "1",
      actionId: "action-ledger-test",
      episodeId: episode.episodeId,
      capabilityId: "test.capability",
      intent: "Exercise the canonical action event contract.",
      scope: { projectId },
      preconditions: ["The execution lease belongs to this worker."],
      expectedEffects: ["test.effect.observed"],
      authorization: { source: "server" },
      risk: "LOW",
      idempotencyKey: `${idempotencyKey}:action`,
      observationProfile: "WORKSPACE",
      failureSemantics: ["Missing evidence remains incomplete."],
    } as const;
    const requestPayload = {
      action,
      actionId: action.actionId,
      capabilityId: action.capabilityId,
      expectedEffects: action.expectedEffects,
    };
    const requestedEvent = await appendEpisodeEvent(eventInput(episode.episodeId, {
      eventType: "ACTION_REQUESTED",
      payload: requestPayload,
    }));
    await db.update(aiAgentEpisodesTable).set({
      actionRefs: [],
      expectedEffectRefs: [],
    }).where(eq(aiAgentEpisodesTable.id, episode.episodeId));
    const exactRetry = await appendEpisodeEvent(eventInput(episode.episodeId, {
      eventType: "ACTION_REQUESTED",
      payload: requestPayload,
    }));
    expect(exactRetry.eventId).toBe(requestedEvent.eventId);
    const retriedRequest = await appendEpisodeEvent(eventInput(episode.episodeId, {
      eventType: "ACTION_REQUESTED",
      payload: { action },
    }));

    const replay = await replayEpisode({ userId, projectId, episodeId: episode.episodeId });
    expect(retriedRequest.eventId).toBe(requestedEvent.eventId);
    expect(replay.episode.actionRefs).toContain(action.actionId);
    expect(replay.episode.expectedEffectRefs).toContain("test.effect.observed");

    await expect(appendEpisodeEvent(eventInput(episode.episodeId, {
      eventType: "ACTION_REQUESTED",
      payload: {
        action: { ...action, episodeId: "another-episode" },
      },
    }))).rejects.toMatchObject({ code: "invalid_contract" });
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

  it("materializes trusted receipts idempotently and records stale revisions", async () => {
    const episode = await startEpisode(startInput());
    const sources = [
      {
        kind: "acceptance" as const,
        sourceId: `acceptance:${executionId}:0`,
        sourceRevision: "revision-1",
        terminalStatus: "completed",
        outcome: "SUCCEEDED",
        reasonCode: "ACCEPTED",
        evidenceComplete: true,
        evidenceRefs: ["validator:one"],
      },
      {
        kind: "validator_receipt" as const,
        validatorId: "registered-validation.v1",
        operationId: executionId,
        projectId,
        workspaceRevision: "revision-1",
        status: "PROVEN" as const,
        artifactRef: "validation-result:one",
      },
      {
        kind: "runtime_receipt" as const,
        sourceId: `runtime:${executionId}:0`,
        sourceRevision: "revision-1",
        status: "passed" as const,
        profile: "mission",
      },
      {
        kind: "delivery_receipt" as const,
        sourceId: `delivery:${executionId}:0`,
        sourceRevision: "old-revision",
        status: "failed" as const,
        treeHash: "tree-hash",
      },
    ];

    const first = await materializeServerOwnedObservations({
      projectId,
      executionId,
      attempt: 0,
      projectRevision: "revision-1",
      episodeId: episode.episodeId,
      sources,
    });
    const retry = await materializeServerOwnedObservations({
      projectId,
      executionId,
      attempt: 0,
      projectRevision: "revision-1",
      episodeId: episode.episodeId,
      sources,
    });
    const observations = await db.select()
      .from(aiAgentObservationsTable)
      .where(eq(aiAgentObservationsTable.episodeId, episode.episodeId));

    expect(first).toMatchObject({ inserted: 4, duplicates: 0, stale: 1 });
    expect(retry).toMatchObject({ inserted: 0, duplicates: 4, stale: 0 });
    expect(observations).toHaveLength(4);
    expect(observations.some((observation) => observation.freshness === "stale")).toBe(true);
    expect(observations.every((observation) => observation.executionId === executionId)).toBe(true);
    expect(JSON.stringify(observations)).not.toContain("provider");
  });
});