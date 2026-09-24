import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { and, eq } from "drizzle-orm";
import {
  aiAgentEffectBundlesTable,
  aiAgentEffectsTable,
  aiAgentEpisodeEventsTable,
  aiAgentObservationsTable,
  aiExecutionAcceptancesTable,
  aiExecutionsTable,
  db,
  projectsTable,
} from "@workspace/db";
import { finalizeExecutionAcceptance } from "../ai-execution-acceptance.js";
import { startEpisode } from "./agent-episode-ledger.js";
import { materializeServerOwnedObservations } from "./observation-materializer.js";
import { verifyAndPersistEffect } from "./effect-observer.js";

const userId = "effect-observer-test-user";
let projectId = "";
let executionId = "";
let episodeId = "";
let workerId = "";

async function createFixture() {
  projectId = `effect-project-${randomUUID()}`;
  executionId = `effect-execution-${randomUUID()}`;
  workerId = `effect-worker-${randomUUID()}`;
  await db.insert(projectsTable).values({
    id: projectId,
    ownerId: userId,
    name: "Effect observer fixture",
    rootPath: `/tmp/${projectId}`,
    language: "typescript",
  });
  await db.insert(aiExecutionsTable).values({
    id: executionId,
    projectId,
    userId,
    idempotencyKey: `effect-idempotency-${randomUUID()}`,
    resumeTokenHash: "effect-resume-token-hash",
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
    idempotencyKey: `effect-episode-${randomUUID()}`,
    projectRevision: "revision-1",
    intentKind: "TEST",
    scope: { kind: "test", projectId },
  });
  episodeId = episode.episodeId;
}

async function removeFixture() {
  if (projectId) await db.delete(projectsTable).where(eq(projectsTable.id, projectId));
}

const action = {
  schemaVersion: "1" as const,
  actionId: "action-1",
  episodeId: "",
  capabilityId: "workspace.write",
  intent: "Mark the workspace as validated.",
  scope: { projectId: "" },
  preconditions: ["workspace is available"],
  expectedEffects: ["effect-1"],
  authorization: { source: "server" },
  risk: "LOW" as const,
  idempotencyKey: "action-1",
  observationProfile: "WORKSPACE",
  failureSemantics: ["Do not claim success without a direct after observation."],
};

const effectContract = {
  schemaVersion: "1" as const,
  effectId: "effect-1",
  expectedStateChanges: [{
    subject: "workspace",
    predicate: "validated",
    expectedValue: true,
  }],
  observationProfile: "WORKSPACE" as const,
  requiredEvidence: ["runtime:after"],
  allowedResult: "OBSERVED" as const,
};

async function materializePair(afterRevision = "revision-1") {
  const result = await materializeServerOwnedObservations({
    projectId,
    executionId,
    attempt: 0,
    projectRevision: "revision-1",
    episodeId,
    sources: [
      {
        kind: "direct_observation",
        sourceId: "runtime:before",
        sourceRevision: "revision-1",
        subject: "workspace",
        predicate: "validated",
        value: false,
        evidenceRefs: ["runtime:before"],
      },
      {
        kind: "direct_observation",
        sourceId: "runtime:after",
        sourceRevision: afterRevision,
        subject: "workspace",
        predicate: "validated",
        value: true,
        evidenceRefs: ["runtime:after"],
      },
    ],
  });
  const rows = await db.select()
    .from(aiAgentObservationsTable)
    .where(eq(aiAgentObservationsTable.episodeId, episodeId));
  return {
    result,
    beforeId: rows.find((row) => row.sourceId === "runtime:before")!.id,
    afterId: rows.find((row) => row.sourceId === "runtime:after")!.id,
  };
}

function actionForFixture() {
  return {
    ...action,
    episodeId,
    scope: { projectId },
  };
}

describe("server-owned effect observer", () => {
  beforeEach(createFixture);
  afterEach(removeFixture);

  it("persists one observed effect, links acceptance, and is idempotent", async () => {
    const pair = await materializePair();
    const acceptanceId = `acceptance-${randomUUID()}`;
    await db.insert(aiExecutionAcceptancesTable).values({
      id: acceptanceId,
      executionId,
      projectId,
      attempt: 0,
      finalizationKey: `finalization-${randomUUID()}`,
      workerId,
      terminalStatus: "failed",
      outcome: "FAILED",
      reasonCode: "WAITING_FOR_EFFECT",
      nextActionCode: "RESUME_ALLOWED",
    });

    const first = await verifyAndPersistEffect({
      projectId,
      executionId,
      attempt: 0,
      episodeId,
      workerId,
      action: actionForFixture(),
      effectContract,
      beforeObservationIds: [pair.beforeId],
      afterObservationIds: [pair.afterId],
      acceptanceId,
    });
    const retry = await verifyAndPersistEffect({
      projectId,
      executionId,
      attempt: 0,
      episodeId,
      workerId,
      action: actionForFixture(),
      effectContract,
      beforeObservationIds: [pair.beforeId],
      afterObservationIds: [pair.afterId],
      acceptanceId,
    });
    const [bundle] = await db.select().from(aiAgentEffectBundlesTable)
      .where(eq(aiAgentEffectBundlesTable.id, first.effectBundleId));
    const [effect] = await db.select().from(aiAgentEffectsTable)
      .where(eq(aiAgentEffectsTable.id, first.effectId));
    const [acceptance] = await db.select().from(aiExecutionAcceptancesTable)
      .where(eq(aiExecutionAcceptancesTable.id, acceptanceId));
    const events = await db.select().from(aiAgentEpisodeEventsTable)
      .where(and(
        eq(aiAgentEpisodeEventsTable.episodeId, episodeId),
        eq(aiAgentEpisodeEventsTable.eventType, "EFFECT_CLASSIFIED"),
      ));

    expect(first).toMatchObject({
      status: "observed",
      acceptanceLinked: true,
      observedEffectCount: 1,
    });
    expect(retry).toEqual(first);
    expect(bundle).toMatchObject({ verdict: "OBSERVED" });
    expect(effect).toMatchObject({
      actionId: "action-1",
      capabilityId: "workspace.write",
      status: "observed",
    });
    expect(acceptance?.effectBundleId).toBe(first.effectBundleId);
    expect(events).toHaveLength(1);
    expect(events[0]?.payload).toMatchObject({
      creditAssignment: {
        actionId: "action-1",
        effectId: first.effectId,
        effectBundleId: first.effectBundleId,
        causalAttribution: {
          status: "unproven",
          reasonCode: "NO_CONTROLLED_COUNTERFACTUAL",
        },
        contributions: {
          effect: { status: "measured", score: 1 },
          claim: { status: "unknown", score: null },
          informationGain: { status: "unknown", score: null },
          failure: { status: "unknown", score: null },
          redundancy: { status: "unknown", score: null },
        },
      },
    });
  });

  it("keeps a stale after observation not observed and blocks PROVEN acceptance", async () => {
    const pair = await materializePair("old-revision");
    const result = await verifyAndPersistEffect({
      projectId,
      executionId,
      attempt: 0,
      episodeId,
      workerId,
      action: actionForFixture(),
      effectContract,
      beforeObservationIds: [pair.beforeId],
      afterObservationIds: [pair.afterId],
    });

    expect(result.status).toBe("not_observed");
    const finalization = await finalizeExecutionAcceptance({
      executionId,
      expectedAttempt: 0,
      workerId,
      finalizationKey: `proven-finalization-${randomUUID()}`,
      outcome: "SUCCEEDED",
      terminalStatus: "completed",
      reasonCode: "ACCEPTED",
      recoveryState: "NONE",
      effectRequired: true,
      effectBundleId: result.effectBundleId,
    });

    expect(finalization).toMatchObject({
      accepted: false,
      duplicate: false,
      reason: "Mutation effect evidence is not observed; PROVEN is unavailable.",
    });
    const acceptances = await db.select().from(aiExecutionAcceptancesTable)
      .where(eq(aiExecutionAcceptancesTable.executionId, executionId));
    expect(acceptances).toHaveLength(0);
  });

  it("rejects a worker that no longer owns the execution lease", async () => {
    const pair = await materializePair();
    await db.update(aiExecutionsTable)
      .set({ workerId: "other-worker" })
      .where(eq(aiExecutionsTable.id, executionId));

    await expect(verifyAndPersistEffect({
      projectId,
      executionId,
      attempt: 0,
      episodeId,
      workerId,
      action: actionForFixture(),
      effectContract,
      beforeObservationIds: [pair.beforeId],
      afterObservationIds: [pair.afterId],
    })).rejects.toThrow("effect_stale_worker");
  });
});