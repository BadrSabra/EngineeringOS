import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { and, eq } from "drizzle-orm";
import {
  aiAgentEpisodeEventsTable,
  aiAgentEpisodesTable,
  aiAgentObservationsTable,
  aiAgentShadowCampaignEventsTable,
  aiExecutionAcceptancesTable,
  aiExecutionsTable,
  aiGoalsTable,
  aiMissionsTable,
  db,
  projectsTable,
} from "@workspace/db";
import {
  EpisodeLedgerError,
  appendEpisodeEvent,
  closeEpisode,
  createToolInvocationEpisodeEventInput,
  loadEpisodeForOwner,
  publicEpisodeProjection,
  replayEpisode,
  startEpisode,
  terminalizeP75MeasurementContinuationEpisode,
} from "./agent-episode-ledger.js";
import { requestAiExecutionCancel } from "../ai-execution-state.js";
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
    await db.delete(aiExecutionAcceptancesTable)
      .where(eq(aiExecutionAcceptancesTable.executionId, executionId));
    await db.delete(aiAgentEpisodeEventsTable)
      .where(eq(aiAgentEpisodeEventsTable.executionId, executionId));
    await db.delete(aiAgentObservationsTable)
      .where(eq(aiAgentObservationsTable.executionId, executionId));
    await db.delete(aiAgentEpisodesTable)
      .where(eq(aiAgentEpisodesTable.executionId, executionId));
    await db.delete(aiExecutionsTable).where(eq(aiExecutionsTable.id, executionId));
    await db.delete(aiGoalsTable).where(eq(aiGoalsTable.projectId, projectId));
    await db.delete(aiMissionsTable).where(eq(aiMissionsTable.projectId, projectId));
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

async function p75TerminalizationInput() {
  const operationId = `agent-episode-p75-operation-${randomUUID()}`;
  const missionId = `agent-episode-p75-mission-${randomUUID()}`;
  const goalId = `agent-episode-p75-goal-${randomUUID()}`;
  const planRevision = "p75-terminalization-plan";
  await db.insert(aiMissionsTable).values({
    id: missionId,
    projectId,
    userId,
    title: "P7.5 continuation fixture",
    intent: "Recover a recorded runtime observation",
    status: "active",
    scope: { kind: "project", projectId },
  });
  await db.insert(aiGoalsTable).values({
    id: goalId,
    missionId,
    projectId,
    title: "Replan after runtime observation",
    status: "running",
  });
  await db.update(aiExecutionsTable).set({
    operationId,
    goalId,
  }).where(eq(aiExecutionsTable.id, executionId));
  const episode = await startEpisode(startInput({
    missionId,
    goalId,
    planRevision,
  }));
  return {
    episodeId: episode.episodeId,
    projectId,
    executionId,
    attempt: 0,
    workerId,
    userId,
    operationId,
    missionId,
    goalId,
    planRevision,
    projectRevision: "revision-1",
    sourceExperimentId: "p75-source-experiment",
    continuationId: "p75-continuation",
    resultId: "p75-result",
    measurementValidity: "complete_fresh",
    reasonCode: "P75_CONTINUATION_RESULT_ALREADY_RECORDED",
  };
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

  it("persists each bound tool invocation phase and replays it idempotently", async () => {
    const episode = await startEpisode(startInput());
    const phases = [
      { phase: "requested" as const },
      { phase: "started" as const },
      { phase: "completed" as const, outputHash: "d".repeat(64) },
    ];
    const recorded: Array<Awaited<ReturnType<typeof appendEpisodeEvent>>> = [];
    for (const phase of phases) {
      recorded.push(await appendEpisodeEvent(createToolInvocationEpisodeEventInput({
        episodeId: episode.episodeId,
        projectId,
        executionId,
        attempt: 0,
        workerId,
        projectRevision: "revision-1",
        invocation: {
          ...phase,
          toolCallId: "provider-call-17",
          executionId: "tool-loop-execution",
          scopeHash: "c".repeat(64),
          toolName: "read_file",
          inputHash: "a".repeat(64),
          manifestHash: "b".repeat(64),
        },
      })));
    }
    const requestedInput = createToolInvocationEpisodeEventInput({
      episodeId: episode.episodeId,
      projectId,
      executionId,
      attempt: 0,
      workerId,
      projectRevision: "revision-1",
      invocation: {
        phase: "requested",
        toolCallId: "provider-call-17",
        executionId: "tool-loop-execution",
        scopeHash: "c".repeat(64),
        toolName: "read_file",
        inputHash: "a".repeat(64),
        manifestHash: "b".repeat(64),
      },
    });
    const retry = await appendEpisodeEvent(requestedInput);
    const replay = await replayEpisode({ userId, projectId, episodeId: episode.episodeId });
    const toolEvents = replay.events.filter((event) =>
      event.eventType === "TOOL_INVOCATION_RECORDED",
    );
    const toolEventPayloads = toolEvents.map((event) =>
      event.payload as unknown as Record<string, unknown>,
    );

    expect(retry.eventId).toBe(recorded[0]?.eventId);
    expect(toolEventPayloads.map((payload) => payload.phase))
      .toEqual(["requested", "started", "completed"]);
    expect(new Set(toolEventPayloads.map((payload) => payload.invocationId)).size).toBe(1);
    expect(JSON.stringify(toolEvents)).not.toContain("src/private.ts");
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

  it("deduplicates aggregate Mission repair commits by action identity and rejects conflicts", async () => {
    const episode = await startEpisode(startInput());
    const actionId = `mission-repair:${executionId}:0`;
    const action = {
      schemaVersion: "1",
      actionId,
      episodeId: episode.episodeId,
      capabilityId: "mission.repair.candidate",
      intent: "Stage the approved Mission repair candidate.",
      scope: { projectId },
      preconditions: ["The current execution owns the live lease."],
      expectedEffects: ["The candidate tree matches the validated repair."],
      authorization: { source: "server" },
      risk: "LOW",
      idempotencyKey: `${idempotencyKey}:mission-repair`,
      observationProfile: "WORKSPACE",
      failureSemantics: ["Missing candidate evidence remains incomplete."],
    } as const;
    await appendEpisodeEvent(eventInput(episode.episodeId, {
      eventType: "ACTION_REQUESTED",
      payload: { action },
    }));

    const commitPayload = {
      actionId,
      candidateIdentity: `candidate:${executionId}:0`,
      baseTreeHash: "a".repeat(64),
      candidateTreeHash: "b".repeat(64),
      validationStatus: "passed",
      liveTreeUnchanged: true,
    };
    const first = await appendEpisodeEvent(eventInput(episode.episodeId, {
      eventType: "ACTION_COMMITTED",
      payload: commitPayload,
    }));
    const retry = await appendEpisodeEvent(eventInput(episode.episodeId, {
      eventType: "ACTION_COMMITTED",
      payload: commitPayload,
    }));
    expect(retry.eventId).toBe(first.eventId);
    expect(retry.sequence).toBe(first.sequence);

    await expect(appendEpisodeEvent(eventInput(episode.episodeId, {
      eventType: "ACTION_COMMITTED",
      payload: { ...commitPayload, candidateTreeHash: "c".repeat(64) },
    }))).rejects.toMatchObject({ code: "invalid_contract" });
    await expect(appendEpisodeEvent(eventInput(episode.episodeId, {
      eventType: "ACTION_COMMITTED",
      payload: { ...commitPayload, actionId: `mission-repair:${executionId}:1` },
    }))).rejects.toMatchObject({ code: "invalid_contract" });
    await expect(appendEpisodeEvent(eventInput(episode.episodeId, {
      eventType: "ACTION_COMMITTED",
      workerId: "stale-worker",
      payload: commitPayload,
    }))).rejects.toMatchObject({ code: "stale_worker" });

    const toolCallIdentity = "c".repeat(64);
    const toolActionId =
      `mission-repair-tool:${executionId}:0:${toolCallIdentity.slice(0, 32)}`;
    const toolAction = {
      ...action,
      actionId: toolActionId,
      capabilityId: "mission.repair.tool.write_file",
      intent: "Stage the approved tool result in the candidate overlay.",
      expectedEffects: ["The approved candidate overlay contains this tool result."],
      idempotencyKey: `${idempotencyKey}:mission-repair-tool`,
    } as const;
    await appendEpisodeEvent(eventInput(episode.episodeId, {
      eventType: "ACTION_REQUESTED",
      payload: {
        action: toolAction,
        expectedEffects: toolAction.expectedEffects,
        invocationKind: "candidate_overlay",
      },
    }));

    const toolCommitPayload = {
      actionId: toolActionId,
      toolName: "write_file",
      targetPath: "src/target.ts",
      toolCallIdentity,
      inputHash: "d".repeat(64),
      stagedInCandidateOverlay: true,
      liveWorkspaceWrites: false,
    };
    const toolCommit = await appendEpisodeEvent(eventInput(episode.episodeId, {
      eventType: "ACTION_COMMITTED",
      payload: toolCommitPayload,
    }));
    expect(toolCommit.eventId).not.toBe(first.eventId);
    const toolCommitRetry = await appendEpisodeEvent(eventInput(episode.episodeId, {
      eventType: "ACTION_COMMITTED",
      payload: toolCommitPayload,
    }));
    expect(toolCommitRetry.eventId).toBe(toolCommit.eventId);
    expect(toolCommitRetry.sequence).toBe(toolCommit.sequence);

    await expect(appendEpisodeEvent(eventInput(episode.episodeId, {
      eventType: "ACTION_COMMITTED",
      payload: { ...toolCommitPayload, targetPath: "src/other.ts" },
    }))).rejects.toMatchObject({ code: "invalid_contract" });
    await expect(appendEpisodeEvent(eventInput(episode.episodeId, {
      eventType: "ACTION_COMMITTED",
      payload: {
        ...toolCommitPayload,
        actionId: `mission-repair-tool:${executionId}:1:${toolCallIdentity.slice(0, 32)}`,
      },
    }))).rejects.toMatchObject({ code: "invalid_contract" });
    await expect(appendEpisodeEvent(eventInput(episode.episodeId, {
      eventType: "ACTION_COMMITTED",
      payload: { ...toolCommitPayload, liveWorkspaceWrites: true },
    }))).rejects.toMatchObject({ code: "invalid_contract" });
  });

  it("rejects conflicting terminal phases for the same tool invocation", async () => {
    const episode = await startEpisode(startInput());
    const lifecycleEvent = (
      phase: "requested" | "started" | "completed" | "failed" | "cancelled",
      details: { outputHash?: string; diagnosticCode?: string } = {},
    ) => createToolInvocationEpisodeEventInput({
      episodeId: episode.episodeId,
      projectId,
      executionId,
      attempt: episode.attempt,
      workerId,
      projectRevision: "revision-1",
      invocation: {
        phase,
        toolCallId: "provider-call-terminal-ambiguity",
        executionId: "tool-loop-terminal-ambiguity",
        scopeHash: "c".repeat(64),
        toolName: "read_file",
        inputHash: "a".repeat(64),
        manifestHash: "b".repeat(64),
        ...details,
      },
    });

    await appendEpisodeEvent(lifecycleEvent("requested"));
    await appendEpisodeEvent(lifecycleEvent("started"));
    const completed = await appendEpisodeEvent(lifecycleEvent("completed", {
      outputHash: "d".repeat(64),
    }));
    const acknowledgedRetry = await appendEpisodeEvent(lifecycleEvent("completed", {
      outputHash: "d".repeat(64),
    }));
    expect(acknowledgedRetry.eventId).toBe(completed.eventId);

    await expect(appendEpisodeEvent(lifecycleEvent("failed", {
      diagnosticCode: "TOOL_EXECUTION_FAILED",
    }))).rejects.toMatchObject({ code: "invalid_contract" });
    await expect(appendEpisodeEvent(lifecycleEvent("cancelled", {
      diagnosticCode: "TOOL_CANCELLED",
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

  it("does not terminalize a recorded P7.5 result after cancellation wins", async () => {
    const input = await p75TerminalizationInput();
    await db.update(aiExecutionsTable).set({
      cancelRequestedAt: new Date(),
    }).where(eq(aiExecutionsTable.id, executionId));

    await expect(terminalizeP75MeasurementContinuationEpisode(input))
      .rejects.toMatchObject({ code: "stale_worker" });

    const terminalEvents = await db.select().from(aiAgentEpisodeEventsTable).where(and(
      eq(aiAgentEpisodeEventsTable.executionId, executionId),
      eq(aiAgentEpisodeEventsTable.eventType, "EPISODE_TERMINAL"),
    ));
    const [episode] = await db.select().from(aiAgentEpisodesTable)
      .where(eq(aiAgentEpisodesTable.id, input.episodeId));
    const [execution] = await db.select().from(aiExecutionsTable)
      .where(eq(aiExecutionsTable.id, executionId));
    expect(terminalEvents).toHaveLength(0);
    expect(episode).toMatchObject({ state: "running", verdict: null, closedAt: null });
    expect(execution).toMatchObject({ status: "running", workerId });
    expect(execution?.cancelRequestedAt).toBeInstanceOf(Date);
    expect(await db.select().from(aiExecutionAcceptancesTable)
      .where(eq(aiExecutionAcceptancesTable.executionId, executionId))).toHaveLength(0);
  });

  it("serializes P7.5 terminalization against a concurrent cancellation request", async () => {
    const input = await p75TerminalizationInput();
    const [cancelResult, terminalResult] = await Promise.allSettled([
      requestAiExecutionCancel({ executionId, userId }),
      terminalizeP75MeasurementContinuationEpisode(input),
    ]);

    const [execution] = await db.select().from(aiExecutionsTable)
      .where(eq(aiExecutionsTable.id, executionId));
    const [episode] = await db.select().from(aiAgentEpisodesTable)
      .where(eq(aiAgentEpisodesTable.id, input.episodeId));
    const terminalEvents = await db.select().from(aiAgentEpisodeEventsTable).where(and(
      eq(aiAgentEpisodeEventsTable.executionId, executionId),
      eq(aiAgentEpisodeEventsTable.eventType, "EPISODE_TERMINAL"),
    ));
    const acceptances = await db.select().from(aiExecutionAcceptancesTable)
      .where(eq(aiExecutionAcceptancesTable.executionId, executionId));

    expect(cancelResult.status).toBe("fulfilled");
    expect(acceptances).toHaveLength(0);

    if (execution?.cancelRequestedAt) {
      expect(execution.status).toBe("cancelling");
      expect(episode).toMatchObject({ state: "running", verdict: null, closedAt: null });
      expect(terminalEvents).toHaveLength(0);
      expect(terminalResult).toMatchObject({
        status: "rejected",
        reason: expect.objectContaining({ code: "stale_worker" }),
      });
      if (cancelResult.status === "fulfilled") {
        expect(cancelResult.value?.status).toBe("cancelling");
      }
    } else {
      expect(execution).toMatchObject({ status: "completed", cancelRequestedAt: null });
      expect(episode).toMatchObject({
        state: "completed",
        verdict: "replan_required",
        closedAt: expect.any(Date),
      });
      expect(terminalEvents).toHaveLength(1);
      expect(terminalResult.status).toBe("fulfilled");
      if (terminalResult.status === "fulfilled") {
        expect(terminalResult.value.state).toBe("completed");
      }
      if (cancelResult.status === "fulfilled") {
        expect(cancelResult.value).toBeUndefined();
      }
    }
  });

  it("rejects P7.5 terminalization from a worker after the execution lease rotates", async () => {
    const input = await p75TerminalizationInput();
    await db.update(aiExecutionsTable).set({
      workerId: "replacement-p75-worker",
      leaseUntil: new Date(Date.now() + 300_000),
    }).where(eq(aiExecutionsTable.id, executionId));

    await expect(terminalizeP75MeasurementContinuationEpisode(input))
      .rejects.toMatchObject({ code: "stale_worker" });

    const terminalEvents = await db.select().from(aiAgentEpisodeEventsTable).where(and(
      eq(aiAgentEpisodeEventsTable.executionId, executionId),
      eq(aiAgentEpisodeEventsTable.eventType, "EPISODE_TERMINAL"),
    ));
    const [episode] = await db.select().from(aiAgentEpisodesTable)
      .where(eq(aiAgentEpisodesTable.id, input.episodeId));
    const [execution] = await db.select().from(aiExecutionsTable)
      .where(eq(aiExecutionsTable.id, executionId));
    expect(terminalEvents).toHaveLength(0);
    expect(episode).toMatchObject({ state: "running", verdict: null, closedAt: null });
    expect(execution).toMatchObject({
      status: "running",
      workerId: "replacement-p75-worker",
    });
    expect(await db.select().from(aiExecutionAcceptancesTable)
      .where(eq(aiExecutionAcceptancesTable.executionId, executionId))).toHaveLength(0);
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

  it.each([
    {
      cause: "a cancellation request",
      invalidate: () => db.update(aiExecutionsTable)
        .set({ cancelRequestedAt: new Date() })
        .where(eq(aiExecutionsTable.id, executionId)),
    },
    {
      cause: "an expired worker lease",
      invalidate: () => db.update(aiExecutionsTable)
        .set({ leaseUntil: new Date(Date.now() - 1_000) })
        .where(eq(aiExecutionsTable.id, executionId)),
    },
    {
      cause: "worker lease rotation",
      invalidate: () => db.update(aiExecutionsTable)
        .set({
          workerId: `replacement-worker:${randomUUID()}`,
          leaseUntil: new Date(Date.now() + 300_000),
        })
        .where(eq(aiExecutionsTable.id, executionId)),
    },
  ])("rejects P7.5 observation writes after $cause", async ({ invalidate }) => {
    const episode = await startEpisode(startInput());
    await invalidate();

    await expect(materializeServerOwnedObservations({
      projectId,
      executionId,
      attempt: 0,
      projectRevision: "revision-1",
      episodeId: episode.episodeId,
      workerLease: { workerId },
      sources: [{
        kind: "direct_observation",
        sourceId: `p75-lease-fence:${randomUUID()}`,
        subject: "runtime",
        predicate: "runtime.status",
        value: { status: "passed" },
        sourceRevision: "revision-1",
        observedAt: new Date(),
      }],
    })).rejects.toThrow("observation_materialization_stale_worker");

    expect(await db.select().from(aiAgentObservationsTable)
      .where(eq(aiAgentObservationsTable.episodeId, episode.episodeId))).toHaveLength(0);
  });
});