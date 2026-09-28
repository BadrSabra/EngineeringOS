import { describe, expect, it } from "vitest";
import { buildMissionPlanPreview } from "@workspace/ai-orchestrator";
import {
  buildMissionWorldStatePlanningRead,
  loadMissionWorldStatePlanningRead,
} from "./mission-world-state-planning-read.js";
import { taskScopeIdentity } from "./agent-state/observation-materializer.js";
import type {
  ProjectWorldStateProjection,
  WorldStateFactProjection,
} from "./agent-state/world-state.js";

type ObservationEvidence =
  Parameters<typeof buildMissionWorldStatePlanningRead>[0]["sourceObservations"][number];

const ENVIRONMENT_REVISION = `env-v1:${"a".repeat(64)}`;

function fixture() {
  const episode = {
    id: "episode-1",
    projectId: "project-1",
    executionId: "execution-1",
    attempt: 2,
    missionId: "mission-1",
    goalId: "goal-1",
    projectRevision: "revision-1",
    environmentRevision: ENVIRONMENT_REVISION,
    worldRevision: null,
    scope: { kind: "mission-task", missionId: "mission-1", goalId: "goal-1" },
    state: "completed",
    verdict: "failed",
    closedAt: new Date("2026-09-28T12:00:00.000Z"),
  } as const;
  const taskScope = taskScopeIdentity(episode);
  const observation = {
    id: "observation-1",
    projectId: episode.projectId,
    executionId: episode.executionId,
    episodeId: episode.id,
    taskScope,
    environmentRevisionKey: `revision:${ENVIRONMENT_REVISION}`,
    subject: "repository",
    predicate: "branch",
    valueHash: "b".repeat(64),
    sourceType: "git",
    sourceId: "direct-observation:repository",
    provenance: "DIRECT_OBSERVATION",
    projectRevision: episode.projectRevision,
    environmentRevision: episode.environmentRevision,
    completeness: "complete",
    freshness: "fresh",
    environmentFreshness: "fresh",
  } as const;
  const fact: WorldStateFactProjection = {
    id: "fact-1",
    subject: observation.subject,
    predicate: observation.predicate,
    value: "main",
    valueHash: observation.valueHash,
    taskScope,
    environmentRevision: episode.environmentRevision,
    version: 1,
    status: "confirmed",
    environmentFreshness: "fresh",
    sourceObservationIds: [observation.id],
    projectRevision: episode.projectRevision,
    supersedesFactId: null,
    createdAt: "2026-09-28T12:00:00.000Z",
    updatedAt: "2026-09-28T12:00:00.000Z",
  };
  const worldState: ProjectWorldStateProjection = {
    projectId: episode.projectId,
    worldRevision: "c".repeat(64),
    facts: [fact],
    currentFacts: [fact],
    contradictions: [],
    generatedAt: "2026-09-28T12:00:00.000Z",
  };
  return { episode, taskScope, observation, fact, worldState };
}

describe("Mission World State planning read", () => {
  it("binds bounded advisory facts to the failed Episode scope and revisions", () => {
    const { episode, taskScope, observation, worldState } = fixture();
    const read = buildMissionWorldStatePlanningRead({
      episode,
      taskScope,
      worldState,
      episodeObservations: [observation],
      sourceObservations: [observation],
    });

    expect(read).toMatchObject({
      kind: "advisory_world_state_read",
      sourceEpisodeId: episode.id,
      sourceExecutionId: episode.executionId,
      sourceAttempt: episode.attempt,
      taskScope,
      projectRevision: episode.projectRevision,
      environmentRevision: ENVIRONMENT_REVISION,
      worldRevision: "c".repeat(64),
      facts: [{
        id: "fact-1",
        subject: "repository",
        predicate: "branch",
        value: "main",
        status: "confirmed",
        sourceObservationIds: ["observation-1"],
      }],
    });
    expect(read?.planningReadRevision).toMatch(/^[a-f0-9]{64}$/);
  });

  it("fails closed for stale, unknown, cross-revision, or candidate-only sources", () => {
    const { episode, taskScope, observation, worldState } = fixture();
    const invalidSources: ObservationEvidence[] = [
      { ...observation, freshness: "stale" },
      { ...observation, environmentFreshness: "unknown" },
      { ...observation, environmentRevisionKey: "unknown" },
      { ...observation, projectRevision: "different-revision" },
      { ...observation, environmentRevision: `env-v1:${"d".repeat(64)}` },
      { ...observation, sourceId: "candidate-overlay:worktree" },
    ];

    for (const invalidSource of invalidSources) {
      expect(buildMissionWorldStatePlanningRead({
        episode,
        taskScope,
        worldState,
        episodeObservations: [observation],
        sourceObservations: [invalidSource],
      })).toBeUndefined();
    }
  });

  it("requires fact sources to include fresh evidence from the selected Episode", () => {
    const { episode, taskScope, observation, fact, worldState } = fixture();
    const priorEpisodeSource = {
      ...observation,
      id: "observation-from-another-episode",
      episodeId: "prior-episode",
    };
    const stateWithPriorFact: ProjectWorldStateProjection = {
      ...worldState,
      facts: [fact],
      currentFacts: [{
        ...fact,
        sourceObservationIds: [priorEpisodeSource.id],
      }],
    };

    expect(buildMissionWorldStatePlanningRead({
      episode,
      taskScope,
      worldState: stateWithPriorFact,
      episodeObservations: [observation],
      sourceObservations: [priorEpisodeSource],
    })).toBeUndefined();
  });

  it("bounds untrusted fact values before they enter persisted plan context", () => {
    const { episode, taskScope, observation, fact, worldState } = fixture();
    const longValue = "x".repeat(600);
    const longValueFact = { ...fact, value: longValue };
    const stateWithLongValue: ProjectWorldStateProjection = {
      ...worldState,
      facts: [longValueFact],
      currentFacts: [longValueFact],
    };
    const read = buildMissionWorldStatePlanningRead({
      episode,
      taskScope,
      worldState: stateWithLongValue,
      episodeObservations: [observation],
      sourceObservations: [observation],
    });

    expect(read?.facts[0]?.value).toBe("x".repeat(400));
  });

  it("redacts credentials and tokens from untrusted fact values", () => {
    const { episode, taskScope, observation, fact, worldState } = fixture();
    const credentialFact = {
      ...fact,
      value: {
        token: "private-token-value",
        note: "Bearer abcdef123456",
        database: "postgres://user:password-value@db.example/app",
        service: "stripe sk_live_abcdefghijklmnop",
        visibleStatus: "ready",
      },
    };
    const stateWithCredentials: ProjectWorldStateProjection = {
      ...worldState,
      facts: [credentialFact],
      currentFacts: [credentialFact],
    };
    const read = buildMissionWorldStatePlanningRead({
      episode,
      taskScope,
      worldState: stateWithCredentials,
      episodeObservations: [observation],
      sourceObservations: [observation],
    });

    expect(read?.facts[0]?.value).toEqual({
      database: "postgres://user:[redacted]@db.example/app",
      note: "Bearer [redacted]",
      service: "stripe [redacted token]",
      token: "[redacted]",
      visibleStatus: "ready",
    });
  });

  it("does not attach facts whose labels identify credentials", () => {
    const { episode, taskScope, observation, fact, worldState } = fixture();
    const credentialFact = {
      ...fact,
      predicate: "OPENAI_API_KEY",
      value: "sk-example-secret-value-1234567890",
    };
    const stateWithCredentialLabel: ProjectWorldStateProjection = {
      ...worldState,
      facts: [credentialFact],
      currentFacts: [credentialFact],
    };

    expect(buildMissionWorldStatePlanningRead({
      episode,
      taskScope,
      worldState: stateWithCredentialLabel,
      episodeObservations: [observation],
      sourceObservations: [observation],
    })).toBeUndefined();
  });

  it("carries the bounded read into the durable Mission plan preview", () => {
    const { episode, taskScope, observation, worldState } = fixture();
    const read = buildMissionWorldStatePlanningRead({
      episode,
      taskScope,
      worldState,
      episodeObservations: [observation],
      sourceObservations: [observation],
    });
    expect(read).toBeDefined();
    if (!read) return;

    const preview = buildMissionPlanPreview({
      message: "Inspect the project and use fresh evidence to correct the failed plan.",
      objective: "Correct the failed plan using current project evidence.",
      replanContext: {
        failedGoalId: episode.goalId ?? undefined,
        affectedPaths: [],
        affectedClaims: [],
        evidenceRefs: [],
        nextActions: ["verify before acting"],
        worldStatePlanningRead: read,
      },
    });

    expect(preview.replanContext?.worldStatePlanningRead).toEqual(read);
  });

  it("does not query World State for runtime.start replans", async () => {
    const tx = {
      select: () => {
        throw new Error("runtime.start replan must not read Mission World State");
      },
    };
    const result = await loadMissionWorldStatePlanningRead(tx as never, {
      missionId: "mission-1",
      projectId: "project-1",
      goalId: "goal-1",
      outcomeContract: { acceptance: {} },
      nextAction: { kind: "replan" },
      successCriteria: {
        planRevision: {
          transitionRequirements: [{ kind: "runtime.start" }],
        },
      },
    });

    expect(result).toBeUndefined();
  });
});