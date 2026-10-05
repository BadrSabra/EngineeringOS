import { afterEach, describe, expect, it, vi } from "vitest";
import { createHash, randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import {
  aiAgentEffectBundlesTable,
  aiAgentEffectsTable,
  aiAgentEpisodesTable,
  aiAgentObservationsTable,
  aiChangeProposalsTable,
  aiChatMessagesTable,
  aiChatSessionsTable,
  aiExecutionAcceptancesTable,
  aiExecutionEvidenceReadsTable,
  aiExecutionEvidenceSnapshotsTable,
  aiExecutionsTable,
  aiGoalDependenciesTable,
  aiGoalsTable,
  aiMissionsTable,
  aiWorldTransitionsTable,
  db,
  eventsTable,
  projectsTable,
  tasksTable,
} from "@workspace/db";
import {
  APPLY_CHANGE_CAPABILITY_ID,
  buildApplyChangeEffectProofExpectation,
} from "./agent-state/apply-change-effect.js";
import { buildExecutionProofProjection } from "./execution-proof.js";

const { scheduleTaskExecution } = vi.hoisted(() => ({
  scheduleTaskExecution: vi.fn(),
}));

vi.mock("../routes/ai/tasks.js", async () => {
  const actual = await vi.importActual<typeof import("../routes/ai/tasks.js")>(
    "../routes/ai/tasks.js",
  );
  return { ...actual, scheduleAiTaskExecution: scheduleTaskExecution };
});

import { wakeApplyChangesMissionGoals } from "./mission-runtime.js";

const projectIds: string[] = [];

async function createApplyChangesFixture() {
  const projectId = randomUUID();
  const missionId = randomUUID();
  const applyGoalId = randomUUID();
  const reportGoalId = randomUUID();
  const reportTaskId = randomUUID();
  const sessionId = randomUUID();
  const messageId = randomUUID();
  const proposalId = randomUUID();
  const executionId = randomUUID();
  const episodeId = randomUUID();
  const effectBundleId = randomUUID();
  const effectId = randomUUID();
  const transitionId = randomUUID();
  const beforeObservationId = randomUUID();
  const afterObservationId = randomUUID();
  const effectBeforeObservationId = randomUUID();
  const effectAfterObservationId = randomUUID();
  const now = new Date();
  const baseRevision = "a".repeat(40);
  const baseTreeHash = "b".repeat(64);
  const candidateTreeHash = "c".repeat(64);
  const changeSetHash = "d".repeat(64);
  const planRevision = "e".repeat(64);
  const environmentRevision = `env-v1:${"f".repeat(64)}`;
  const applyActionId = `action:${executionId}:0:apply`;
  const parentWorldRevision = "1".repeat(64);
  const resultingWorldRevision = "2".repeat(64);
  const operationId = `operation:${executionId}`;
  const evidenceSnapshotId = `apply-evidence:${executionId}`;
  const sourceBody = "Source retained before the approved change.\n";
  const candidateIdentity = `${proposalId}:${candidateTreeHash}`;
  const applyEffectExpectation = buildApplyChangeEffectProofExpectation({
    executionId,
    attempt: 0,
    proposalId,
    candidateTreeHash,
  });
  const requirement = {
    kind: "apply.changes" as const,
    version: 1 as const,
    sourceStepId: "apply-changes" as const,
    proposalId,
    baseRevision,
    candidateTreeHash,
    changeSetHash,
    from: "candidate" as const,
    to: "applied" as const,
  };
  const plan = {
    hash: planRevision,
    applyRequirement: requirement,
    steps: [
      { id: "apply-changes", dependencies: [] },
      { id: "report-applied", dependencies: ["apply-changes"] },
    ],
  };
  const proof = buildExecutionProofProjection({
    outcome: "SUCCEEDED",
    evidenceRequired: true,
    evidenceComplete: true,
    evidenceSnapshotId,
    sourceRevision: baseRevision,
    candidateIdentity,
  });

  await db.insert(projectsTable).values({
    id: projectId,
    ownerId: "test-user",
    name: `mission-runtime-apply-${projectId.slice(0, 8)}`,
    rootPath: `/tmp/mission-runtime-apply-${projectId}`,
    language: "typescript",
    status: "active",
    createdAt: now,
    updatedAt: now,
  });
  projectIds.push(projectId);

  await db.insert(aiMissionsTable).values({
    id: missionId,
    projectId,
    userId: "test-user",
    title: "Apply changes mission",
    intent: "Apply a verified proposal and report the result",
    status: "waiting",
    scope: { kind: "project", projectId },
    autonomyPolicy: {
      activePlanRevision: planRevision,
      applyMission: { proposalId, requirement },
    },
    createdAt: now,
    updatedAt: now,
  });
  await db.insert(aiGoalsTable).values([
    {
      id: applyGoalId,
      missionId,
      projectId,
      title: "Apply approved changes",
      status: "waiting_for_event",
      blockedReason: "apply_changes_pending",
      nextAction: { kind: "wait", reason: "event", wakeAt: null },
      successCriteria: {
        stepId: "apply-changes",
        applyRequirement: requirement,
        planRevision: plan,
      },
      outcomeContract: {
        stepId: "apply-changes",
        applyRequirement: requirement,
        candidateIdentity,
        planRevision: plan,
      },
      createdAt: now,
      updatedAt: now,
    },
    {
      id: reportGoalId,
      missionId,
      projectId,
      title: "Report applied changes",
      status: "waiting_for_event",
      blockedReason: "dependencies_pending",
      nextAction: { kind: "task", taskId: reportTaskId, purpose: "execution" },
      successCriteria: {
        stepId: "report-applied",
        planRevision: { hash: planRevision },
      },
      outcomeContract: {
        stepId: "report-applied",
        planRevision: { hash: planRevision },
      },
      createdAt: now,
      updatedAt: now,
    },
  ]);
  await db.insert(aiGoalDependenciesTable).values({
    id: randomUUID(),
    missionId,
    projectId,
    goalId: reportGoalId,
    dependsOnGoalId: applyGoalId,
    planRevision,
    createdAt: now,
  });
  await db.insert(tasksTable).values({
    id: reportTaskId,
    projectId,
    goalId: reportGoalId,
    title: "Prepare the apply report",
    status: "verifying",
    prompt: "Report the verified changes that were applied.",
    createdAt: now,
    updatedAt: now,
  });

  await db.insert(aiChatSessionsTable).values({
    id: sessionId,
    projectId,
    title: "Apply proof fixture",
    createdAt: now,
    updatedAt: now,
  });
  await db.insert(aiChatMessagesTable).values({
    id: messageId,
    sessionId,
    role: "user",
    content: "Apply the approved change.",
    createdAt: now,
  });
  await db.insert(aiChangeProposalsTable).values({
    id: proposalId,
    projectId,
    sessionId,
    messageId,
    changes: "[]",
    status: "applied",
    lifecycle: "applied",
    baseRevision,
    baseTreeHash,
    candidateTreeHash,
    promotedTreeHash: candidateTreeHash,
    changeSetHash,
    createdAt: now,
  });

  await db.insert(aiExecutionsTable).values({
    id: executionId,
    projectId,
    goalId: applyGoalId,
    operationId,
    proposalId,
    userId: "test-user",
    idempotencyKey: `execution:${executionId}`,
    resumeTokenHash: `resume:${executionId}`,
    request: "{}",
    checkpoint: "{}",
    status: "completed",
    attempt: 0,
    baseRevision,
    completedAt: now,
    createdAt: now,
    updatedAt: now,
  });
  const sourceBodyBytes = Buffer.byteLength(sourceBody);
  const sourceContentHash = createHash("sha256").update(sourceBody, "utf8").digest("hex");
  await db.insert(aiExecutionEvidenceSnapshotsTable).values({
    id: evidenceSnapshotId,
    executionId,
    projectId,
    attempt: 0,
    operationId,
    sourceRevision: baseRevision,
    candidateIdentity,
    verdict: "PROVEN",
    complete: 1,
    readCount: 1,
    totalBytes: sourceBodyBytes,
    artifactRefs: [],
    createdAt: now,
  });
  await db.insert(aiExecutionEvidenceReadsTable).values({
    id: randomUUID(),
    snapshotId: evidenceSnapshotId,
    path: "README.md",
    readType: "source",
    contentHash: sourceContentHash,
    byteLength: sourceBodyBytes,
    complete: 1,
    truncated: 0,
    body: sourceBody,
    createdAt: now,
  });
  await db.insert(aiAgentEpisodesTable).values({
    id: episodeId,
    projectId,
    executionId,
    attempt: 0,
    missionId,
    goalId: applyGoalId,
    projectRevision: baseRevision,
    environmentRevision,
    worldRevision: parentWorldRevision,
    planRevision,
    intentKind: "recipe",
    scope: { kind: "project" },
    workerId: "test-worker",
    leaseUntil: new Date(Date.now() + 60_000),
    idempotencyKey: `episode:${episodeId}`,
    createdAt: now,
    updatedAt: now,
  });
  await db.insert(aiAgentEffectBundlesTable).values({
    id: effectBundleId,
    projectId,
    executionId,
    attempt: 0,
    episodeId,
    effectIds: [effectId],
    effectContractHashes: [applyEffectExpectation.effectContractHash],
    verdict: "OBSERVED",
    createdAt: now,
  });
  await db.insert(aiAgentEffectsTable).values({
    id: effectId,
    projectId,
    executionId,
    episodeId,
    attempt: 0,
    actionId: applyActionId,
    capabilityId: APPLY_CHANGE_CAPABILITY_ID,
    effectContractHash: applyEffectExpectation.effectContractHash,
    beforeObservationIds: [effectBeforeObservationId],
    afterObservationIds: [effectAfterObservationId],
    expectedEffects: applyEffectExpectation.contract.expectedStateChanges,
    status: "observed",
    missingEffects: [],
    contradictionRefs: [],
    evidenceRefs: ["apply-effect-proof"],
    createdAt: now,
  });
  await db.insert(aiExecutionAcceptancesTable).values({
    id: randomUUID(),
    executionId,
    projectId,
    attempt: 0,
    finalizationKey: `final:${executionId}`,
    operationId,
    workerId: "test-worker",
    terminalStatus: "completed",
    outcome: "SUCCEEDED",
    reasonCode: "CANONICAL_PROOF_PROVEN",
    nextActionCode: "none",
    disposition: { proof },
    evidenceSnapshotId,
    evidenceRequired: 1,
    evidenceComplete: 1,
    sourceRevision: baseRevision,
    candidateIdentity,
    effectBundleId,
    createdAt: now,
  });

  for (const [id, treeHash, sequence] of [
    [beforeObservationId, baseTreeHash, 0],
    [afterObservationId, candidateTreeHash, 1],
  ] as const) {
    const valueHash = createHash("sha256").update(JSON.stringify(treeHash)).digest("hex");
    await db.insert(aiAgentObservationsTable).values({
      id,
      projectId,
      executionId,
      episodeId,
      taskScope: "project",
      environmentRevisionKey: `revision:${environmentRevision}`,
      kind: "direct_observation",
      provenance: "DIRECT_OBSERVATION",
      observationRole: "workspace.tree_hash",
      sourceType: "direct_observation",
      sourceId: id,
      sourceVersion: treeHash,
      subject: `project:${projectId}`,
      predicate: "workspace.tree_hash",
      value: treeHash,
      valueHash,
      sourceRefs: [],
      observedAt: now,
      projectRevision: treeHash,
      environmentRevision,
      completeness: "complete",
      freshness: "fresh",
      environmentFreshness: "fresh",
      evidenceRefs: [`apply-tree:${treeHash}`],
      sequence,
      createdAt: now,
    });
  }
  for (const [id, treeHash, sequence, evidenceRef] of [
    [effectBeforeObservationId, baseTreeHash, 2, `apply:${executionId}:0:before`],
    [effectAfterObservationId, candidateTreeHash, 3, `apply:${executionId}:0:after`],
  ] as const) {
    const valueHash = createHash("sha256").update(JSON.stringify(treeHash)).digest("hex");
    await db.insert(aiAgentObservationsTable).values({
      id,
      projectId,
      executionId,
      episodeId,
      taskScope: "project",
      environmentRevisionKey: `revision:${environmentRevision}`,
      kind: "direct_observation",
      provenance: "DIRECT_OBSERVATION",
      observationRole: "workspace.tree_hash",
      sourceType: "direct_observation",
      sourceId: id,
      sourceVersion: baseRevision,
      subject: `project:${candidateIdentity}`,
      predicate: "workspace.tree_hash",
      value: treeHash,
      valueHash,
      sourceRefs: [],
      observedAt: now,
      projectRevision: baseRevision,
      environmentRevision,
      completeness: "complete",
      freshness: "fresh",
      environmentFreshness: "fresh",
      evidenceRefs: [evidenceRef],
      sequence,
      createdAt: now,
    });
  }
  await db.insert(aiWorldTransitionsTable).values({
    id: transitionId,
    projectId,
    executionId,
    attempt: 0,
    episodeId,
    actionId: applyActionId,
    effectBundleId,
    parentWorldRevision,
    resultingWorldRevision,
    taskScope: "project",
    environmentRevisionKey: `revision:${environmentRevision}`,
    environmentRevision,
    freshness: "fresh",
    beforeObservationIds: [beforeObservationId],
    afterObservationIds: [afterObservationId],
    materializedObservationIds: [beforeObservationId, afterObservationId],
    parentFactRefs: [],
    changedFactRefs: [],
    evidenceRefs: [
      `apply-binding:v1:${JSON.stringify({
        proposalId,
        goalId: applyGoalId,
        planRevision,
        promotedTreeHash: candidateTreeHash,
      })}`,
    ],
    status: "materialized",
    idempotencyKey: `apply.changes:${applyGoalId}:${planRevision}`,
    retryCount: 0,
    createdAt: now,
    updatedAt: now,
  });

  return {
    projectId,
    missionId,
    episodeId,
    applyGoalId,
    reportGoalId,
    reportTaskId,
    proposalId,
    executionId,
    effectBundleId,
    effectId,
    applyActionId,
    transitionId,
    beforeObservationId,
    afterObservationId,
    planRevision,
  };
}

type ApplyChangesFixture = Awaited<ReturnType<typeof createApplyChangesFixture>>;

const invalidApplyProofCases: Array<{
  name: string;
  expectedReason: string;
  expectedAcceptanceOutcome?: "SUCCEEDED" | "FAILED";
  mutate: (fixture: ApplyChangesFixture) => Promise<void>;
}> = [
  {
    name: "candidate-only evidence",
    expectedReason: "apply_transition_observations_invalid",
    mutate: async (fixture) => {
      await db.update(aiAgentObservationsTable)
        .set({ subject: `candidate:${fixture.proposalId}` })
        .where(eq(aiAgentObservationsTable.id, fixture.afterObservationId));
    },
  },
  {
    name: "environment mismatch",
    expectedReason: "apply_transition_observations_invalid",
    mutate: async (fixture) => {
      await db.update(aiAgentObservationsTable)
        .set({ environmentRevision: `env-v1:${"9".repeat(64)}` })
        .where(eq(aiAgentObservationsTable.id, fixture.afterObservationId));
    },
  },
  {
    name: "live tree mismatch",
    expectedReason: "apply_transition_tree_observations_invalid",
    mutate: async (fixture) => {
      await db.update(aiAgentObservationsTable)
        .set({ value: "8".repeat(64) })
        .where(eq(aiAgentObservationsTable.id, fixture.afterObservationId));
    },
  },
  {
    name: "stale after observation",
    expectedReason: "apply_transition_observations_invalid",
    mutate: async (fixture) => {
      await db.update(aiAgentObservationsTable)
        .set({ freshness: "stale" })
        .where(eq(aiAgentObservationsTable.id, fixture.afterObservationId));
    },
  },
  {
    name: "wrong transition attempt",
    expectedReason: "apply_transition_missing",
    mutate: async (fixture) => {
      await db.update(aiWorldTransitionsTable)
        .set({ attempt: 1 })
        .where(eq(aiWorldTransitionsTable.id, fixture.transitionId));
    },
  },
  {
    name: "Episode belongs to a different attempt",
    expectedReason: "apply_transition_episode_invalid",
    mutate: async (fixture) => {
      const wrongEpisodeId = randomUUID();
      const now = new Date();
      await db.insert(aiAgentEpisodesTable).values({
        id: wrongEpisodeId,
        projectId: fixture.projectId,
        executionId: fixture.executionId,
        attempt: 1,
        projectRevision: "a".repeat(40),
        intentKind: "recipe",
        scope: { kind: "project" },
        workerId: "test-worker",
        leaseUntil: new Date(now.getTime() + 60_000),
        idempotencyKey: `episode:${wrongEpisodeId}`,
        createdAt: now,
        updatedAt: now,
      });
      await db.update(aiWorldTransitionsTable)
        .set({ episodeId: wrongEpisodeId })
        .where(eq(aiWorldTransitionsTable.id, fixture.transitionId));
    },
  },
  {
    name: "failed Gate-C acceptance",
    expectedReason: "apply_acceptance_missing",
    expectedAcceptanceOutcome: "FAILED",
    mutate: async (fixture) => {
      await db.update(aiExecutionAcceptancesTable)
        .set({ outcome: "FAILED" })
        .where(eq(aiExecutionAcceptancesTable.executionId, fixture.executionId));
    },
  },
  {
    name: "prior-attempt acceptance after recovery rotation",
    expectedReason: "apply_acceptance_missing",
    mutate: async (fixture) => {
      await db.update(aiExecutionsTable)
        .set({ attempt: 1 })
        .where(eq(aiExecutionsTable.id, fixture.executionId));
    },
  },
  {
    name: "empty observed effect bundle",
    expectedReason: "apply_effect_unproven",
    mutate: async (fixture) => {
      await db.update(aiAgentEffectBundlesTable)
        .set({ effectIds: [], effectContractHashes: [] })
        .where(eq(aiAgentEffectBundlesTable.id, fixture.effectBundleId));
    },
  },
  {
    name: "effect class mismatch",
    expectedReason: "apply_effect_unproven",
    mutate: async (fixture) => {
      await db.update(aiAgentEffectsTable)
        .set({ capabilityId: "unrelated.capability" })
        .where(eq(aiAgentEffectsTable.id, fixture.effectId));
    },
  },
  {
    name: "effect action mismatch",
    expectedReason: "apply_effect_unproven",
    mutate: async (fixture) => {
      await db.update(aiAgentEffectsTable)
        .set({ actionId: "action:unrelated" })
        .where(eq(aiAgentEffectsTable.id, fixture.effectId));
    },
  },
  {
    name: "promoted proposal mismatch",
    expectedReason: "apply_proposal_binding_invalid",
    mutate: async (fixture) => {
      await db.update(aiChangeProposalsTable)
        .set({ promotedTreeHash: "7".repeat(64) })
        .where(eq(aiChangeProposalsTable.id, fixture.proposalId));
    },
  },
  {
    name: "Apply Mission requirement binding mismatch",
    expectedReason: "apply_plan_binding_invalid",
    mutate: async (fixture) => {
      const [mission] = await db.select({ autonomyPolicy: aiMissionsTable.autonomyPolicy })
        .from(aiMissionsTable).where(eq(aiMissionsTable.id, fixture.missionId));
      const policy = mission?.autonomyPolicy as Record<string, unknown>;
      const applyMission = policy.applyMission as Record<string, unknown>;
      const requirement = applyMission.requirement as Record<string, unknown>;
      await db.update(aiMissionsTable).set({
        autonomyPolicy: {
          ...policy,
          applyMission: {
            ...applyMission,
            requirement: { ...requirement, candidateTreeHash: "6".repeat(64) },
          },
        },
      }).where(eq(aiMissionsTable.id, fixture.missionId));
    },
  },
];

afterEach(async () => {
  scheduleTaskExecution.mockReset();
  for (const projectId of projectIds.splice(0)) {
    await db.delete(projectsTable).where(eq(projectsTable.id, projectId)).catch(() => undefined);
  }
});

describe("Apply Changes Mission D2 dispatch", () => {
  it("dispatches the report-applied task once after live proof, including on repeated wake", async () => {
    const fixture = await createApplyChangesFixture();

    const concurrentWakes = await Promise.all([
      wakeApplyChangesMissionGoals(),
      wakeApplyChangesMissionGoals(),
    ]);
    expect(concurrentWakes.every((count) => count <= 1)).toBe(true);
    expect(concurrentWakes.some((count) => count === 1)).toBe(true);
    expect(await wakeApplyChangesMissionGoals()).toBe(0);

    const [applyGoal] = await db.select({
      status: aiGoalsTable.status,
      outcomeContract: aiGoalsTable.outcomeContract,
    }).from(aiGoalsTable).where(eq(aiGoalsTable.id, fixture.applyGoalId));
    const [reportGoal] = await db.select({ status: aiGoalsTable.status })
      .from(aiGoalsTable).where(eq(aiGoalsTable.id, fixture.reportGoalId));
    expect(applyGoal?.status).toBe("completed");
    expect(applyGoal?.outcomeContract).toMatchObject({
      acceptance: {
        verdict: "PROVEN",
        reasonCode: "APPLY_CHANGES_D2_PROVEN",
        stateProjection: {
          transitionId: fixture.transitionId,
        },
      },
    });
    expect(reportGoal?.status).toBe("running");

    const events = await db.select({
      type: eventsTable.type,
      goalId: eventsTable.goalId,
      taskId: eventsTable.taskId,
      payload: eventsTable.payload,
    }).from(eventsTable).where(eq(eventsTable.projectId, fixture.projectId));
    const reportDispatches = events.filter((event) =>
      event.type === "AiGoalDispatchRequested" && event.goalId === fixture.reportGoalId,
    );
    expect(reportDispatches).toHaveLength(1);
    expect(reportDispatches[0]).toMatchObject({
      taskId: fixture.reportTaskId,
      payload: { action: "task", trigger: "wake" },
    });
    expect(events.filter((event) =>
      event.type === "AiGoalApplyChangesProofAccepted" && event.goalId === fixture.applyGoalId,
    )).toHaveLength(1);
    expect(scheduleTaskExecution).toHaveBeenCalledTimes(1);
    expect(scheduleTaskExecution).toHaveBeenCalledWith(
      fixture.reportTaskId,
      "test-user",
      { parentExecutionId: null },
    );

    const [acceptance] = await db.select({
      outcome: aiExecutionAcceptancesTable.outcome,
      effectBundleId: aiExecutionAcceptancesTable.effectBundleId,
    }).from(aiExecutionAcceptancesTable)
      .where(eq(aiExecutionAcceptancesTable.executionId, fixture.executionId));
    expect(acceptance).toEqual({
      outcome: "SUCCEEDED",
      effectBundleId: fixture.effectBundleId,
    });
  });

  it.each(invalidApplyProofCases)(
    "blocks dispatch and preserves Gate-C acceptance for $name",
    async ({ mutate, expectedReason, expectedAcceptanceOutcome = "SUCCEEDED" }) => {
      const fixture = await createApplyChangesFixture();
      await mutate(fixture);

      expect(await wakeApplyChangesMissionGoals()).toBe(1);
      expect(await wakeApplyChangesMissionGoals()).toBe(0);

      const [applyGoal] = await db.select({
        status: aiGoalsTable.status,
        blockedReason: aiGoalsTable.blockedReason,
      }).from(aiGoalsTable).where(eq(aiGoalsTable.id, fixture.applyGoalId));
      const [reportGoal] = await db.select({
        status: aiGoalsTable.status,
        blockedReason: aiGoalsTable.blockedReason,
      }).from(aiGoalsTable).where(eq(aiGoalsTable.id, fixture.reportGoalId));
      expect(applyGoal).toEqual({
        status: "needs_replan",
        blockedReason: expectedReason,
      });
      expect(reportGoal).toEqual({
        status: "waiting_for_event",
        blockedReason: "dependencies_pending",
      });

      const events = await db.select({
        type: eventsTable.type,
        goalId: eventsTable.goalId,
      }).from(eventsTable).where(eq(eventsTable.projectId, fixture.projectId));
      expect(events.some((event) =>
        event.type === "AiGoalDispatchRequested" && event.goalId === fixture.reportGoalId,
      )).toBe(false);
      expect(events.some((event) =>
        event.type === "AiGoalApplyChangesProofAccepted" && event.goalId === fixture.applyGoalId,
      )).toBe(false);
      expect(events.some((event) =>
        event.type === "AiGoalApplyChangesProofBlocked" && event.goalId === fixture.applyGoalId,
      )).toBe(true);
      expect(scheduleTaskExecution).not.toHaveBeenCalled();

      const [acceptance] = await db.select({
        outcome: aiExecutionAcceptancesTable.outcome,
        terminalStatus: aiExecutionAcceptancesTable.terminalStatus,
        effectBundleId: aiExecutionAcceptancesTable.effectBundleId,
      }).from(aiExecutionAcceptancesTable)
        .where(eq(aiExecutionAcceptancesTable.executionId, fixture.executionId));
      expect(acceptance).toEqual({
        outcome: expectedAcceptanceOutcome,
        terminalStatus: "completed",
        effectBundleId: fixture.effectBundleId,
      });
    },
  );

  it("leaves a stale-plan apply pending without dispatch or changing Gate-C acceptance", async () => {
    const fixture = await createApplyChangesFixture();
    const [mission] = await db.select({ autonomyPolicy: aiMissionsTable.autonomyPolicy })
      .from(aiMissionsTable).where(eq(aiMissionsTable.id, fixture.missionId));
    const policy = mission?.autonomyPolicy as Record<string, unknown>;
    await db.update(aiMissionsTable).set({
      autonomyPolicy: { ...policy, activePlanRevision: "6".repeat(64) },
    }).where(eq(aiMissionsTable.id, fixture.missionId));

    expect(await wakeApplyChangesMissionGoals()).toBe(0);

    const [applyGoal] = await db.select({
      status: aiGoalsTable.status,
      blockedReason: aiGoalsTable.blockedReason,
    }).from(aiGoalsTable).where(eq(aiGoalsTable.id, fixture.applyGoalId));
    const [reportGoal] = await db.select({
      status: aiGoalsTable.status,
      blockedReason: aiGoalsTable.blockedReason,
    }).from(aiGoalsTable).where(eq(aiGoalsTable.id, fixture.reportGoalId));
    expect(applyGoal).toEqual({
      status: "waiting_for_event",
      blockedReason: "apply_changes_pending",
    });
    expect(reportGoal).toEqual({
      status: "waiting_for_event",
      blockedReason: "dependencies_pending",
    });

    const events = await db.select({
      type: eventsTable.type,
      goalId: eventsTable.goalId,
    }).from(eventsTable).where(eq(eventsTable.projectId, fixture.projectId));
    expect(events.some((event) =>
      event.type === "AiGoalDispatchRequested" && event.goalId === fixture.reportGoalId,
    )).toBe(false);
    expect(events.some((event) =>
      event.type === "AiGoalApplyChangesProofAccepted" && event.goalId === fixture.applyGoalId,
    )).toBe(false);
    expect(scheduleTaskExecution).not.toHaveBeenCalled();

    const [acceptance] = await db.select({
      outcome: aiExecutionAcceptancesTable.outcome,
      terminalStatus: aiExecutionAcceptancesTable.terminalStatus,
      effectBundleId: aiExecutionAcceptancesTable.effectBundleId,
    }).from(aiExecutionAcceptancesTable)
      .where(eq(aiExecutionAcceptancesTable.executionId, fixture.executionId));
    expect(acceptance).toEqual({
      outcome: "SUCCEEDED",
      terminalStatus: "completed",
      effectBundleId: fixture.effectBundleId,
    });
  });
});