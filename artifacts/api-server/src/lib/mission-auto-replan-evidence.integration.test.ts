import { afterEach, describe, expect, it } from "vitest";
import { createHash, randomUUID } from "node:crypto";
import { eq, inArray } from "drizzle-orm";
import {
  aiAgentEpisodesTable,
  aiAgentObservationsTable,
  aiExecutionAcceptancesTable,
  aiExecutionsTable,
  aiGoalsTable,
  aiMissionsTable,
  aiWorldFactsTable,
  aiWorldTransitionsTable,
  db,
  projectsTable,
  tasksTable,
} from "@workspace/db";
import { buildMissionPlanPreview } from "@workspace/ai-orchestrator";
import { autoReplanMission, buildReplanContext } from "./mission-auto-replan.js";
import { taskScopeIdentity } from "./agent-state/observation-materializer.js";
import { diagnoseRuntimeStartWorldStateFailure } from "./world-state-failure-diagnosis.js";
import {
  loadMissionWorldStatePlanningRead,
} from "./mission-world-state-planning-read.js";
import { executionProfileForMissionStep } from "./mission-execution-profile.js";
import {
  getMissionDecisionDispatchBatch,
  getMissionDecisionTrace,
} from "./mission-decision-trace-store.js";

const projectIds: string[] = [];
const MISSION_INTENT = "Inspect the source, then fix the blocking issue.";
const PROJECT_REVISION = "a".repeat(40);
const ENVIRONMENT_REVISION = `env-v1:${"b".repeat(64)}`;

const FAILURE_DIAGNOSIS = {
  kind: "EVIDENCE_INCOMPLETE",
  reasonCode: "EVIDENCE_INCOMPLETE",
  nextActionCode: "GATHER_REQUIRED_EVIDENCE",
  retryable: true,
  requiresApproval: false,
} as const;

type ReplanEvidenceFixture = {
  projectId: string;
  missionId: string;
  goalId: string;
  executionId: string;
  acceptanceId: string;
  episodeId: string;
  observationId: string;
  worldFactId: string;
  taskScope: string;
  episodeScope: { kind: "mission-task"; missionId: string; goalId: string };
  projectRevision: string;
  environmentRevision: string;
  now: Date;
  outcomeContract: {
    planRevision: { hash: string };
    acceptance: {
      failureDiagnosis: typeof FAILURE_DIAGNOSIS;
      executionId: string;
      acceptanceId: string;
      outcome: "FAILED";
      sourceRevision: string;
      receipt: { kind: "execution_acceptance"; id: string };
    };
  };
  nextAction: { kind: "replan"; reason: string };
  successCriteria: { kind: "historical_failure"; planRevision: { hash: string } };
};

afterEach(async () => {
  for (const projectId of projectIds.splice(0)) {
    await db.delete(projectsTable).where(eq(projectsTable.id, projectId)).catch(() => undefined);
  }
});

async function createReplanEvidenceFixture(): Promise<ReplanEvidenceFixture> {
  const projectId = randomUUID();
  const missionId = randomUUID();
  const goalId = randomUUID();
  const executionId = randomUUID();
  const acceptanceId = randomUUID();
  const episodeId = randomUUID();
  const observationId = randomUUID();
  const worldFactId = randomUUID();
  const now = new Date();
  const episodeScope = { kind: "mission-task" as const, missionId, goalId };
  const observedValue = "main";
  const valueHash = createHash("sha256")
    .update(JSON.stringify(observedValue))
    .digest("hex");
  const outcomeContract: ReplanEvidenceFixture["outcomeContract"] = {
    planRevision: { hash: "failed-plan-revision" },
    acceptance: {
      failureDiagnosis: FAILURE_DIAGNOSIS,
      executionId,
      acceptanceId,
      outcome: "FAILED",
      sourceRevision: PROJECT_REVISION,
      receipt: { kind: "execution_acceptance", id: acceptanceId },
    },
  };
  const nextAction = { kind: "replan" as const, reason: "use current scoped evidence" };
  const successCriteria = {
    kind: "historical_failure" as const,
    planRevision: { hash: "failed-plan-revision" },
  };
  projectIds.push(projectId);

  await db.insert(projectsTable).values({
    id: projectId,
    ownerId: "test-user",
    name: `mission-replan-evidence-${projectId.slice(0, 8)}`,
    rootPath: `${process.cwd()}/mission-replan-test/${projectId}`,
    language: "typescript",
    status: "active",
    createdAt: now,
    updatedAt: now,
  });
  await db.insert(aiMissionsTable).values({
    id: missionId,
    projectId,
    userId: "test-user",
    title: "Recover the release",
    intent: MISSION_INTENT,
    status: "needs_replan",
    scope: { kind: "project", projectId },
    autonomyPolicy: { mode: "autonomous", maxAutoReplans: 3 },
    createdAt: now,
    updatedAt: now,
  });
  await db.insert(aiGoalsTable).values({
    id: goalId,
    missionId,
    projectId,
    title: "Previous failed plan",
    status: "needs_replan",
    successCriteria,
    evidenceContract: { required: true },
    outcomeContract,
    nextAction,
    createdAt: now,
    updatedAt: now,
  });
  await db.insert(aiExecutionsTable).values({
    id: executionId,
    projectId,
    goalId,
    operationId: `operation:${executionId}`,
    userId: "test-user",
    idempotencyKey: `execution:${executionId}`,
    resumeTokenHash: `resume:${executionId}`,
    request: JSON.stringify({ intent: MISSION_INTENT }),
    checkpoint: "{}",
    status: "failed",
    attempt: 2,
    createdAt: now,
    updatedAt: now,
  });
  await db.insert(aiExecutionAcceptancesTable).values({
    id: acceptanceId,
    executionId,
    projectId,
    attempt: 2,
    finalizationKey: `final:${executionId}:2`,
    operationId: `operation:${executionId}`,
    workerId: "test-worker",
    terminalStatus: "failed",
    outcome: "FAILED",
    reasonCode: FAILURE_DIAGNOSIS.reasonCode,
    nextActionCode: FAILURE_DIAGNOSIS.nextActionCode,
    sourceRevision: PROJECT_REVISION,
    createdAt: now,
  });
  await db.insert(aiAgentEpisodesTable).values({
    id: episodeId,
    projectId,
    executionId,
    attempt: 2,
    missionId,
    goalId,
    projectRevision: PROJECT_REVISION,
    environmentRevision: ENVIRONMENT_REVISION,
    planRevision: "failed-plan-revision",
    intentKind: "mission_task",
    scope: episodeScope,
    state: "failed",
    verdict: "failed",
    reasonCode: FAILURE_DIAGNOSIS.reasonCode,
    nextActionCode: FAILURE_DIAGNOSIS.nextActionCode,
    workerId: "test-worker",
    leaseUntil: now,
    idempotencyKey: `episode:${executionId}:2`,
    createdAt: now,
    updatedAt: now,
    closedAt: now,
  });
  const [persistedEpisode] = await db.select().from(aiAgentEpisodesTable)
    .where(eq(aiAgentEpisodesTable.id, episodeId));
  if (!persistedEpisode) throw new Error("mission_replan_test_episode_missing");
  const taskScope = taskScopeIdentity(persistedEpisode);
  await db.insert(aiAgentObservationsTable).values({
    id: observationId,
    projectId,
    executionId,
    episodeId,
    taskScope,
    environmentRevisionKey: `revision:${ENVIRONMENT_REVISION}`,
    kind: "direct_observation",
    provenance: "DIRECT_OBSERVATION",
    observationRole: "repository.branch",
    sourceType: "direct_observation",
    sourceId: `direct:${observationId}`,
    sourceVersion: PROJECT_REVISION,
    subject: "repository",
    predicate: "branch",
    value: observedValue,
    valueHash,
    sourceRefs: [],
    observedAt: now,
    projectRevision: PROJECT_REVISION,
    environmentRevision: ENVIRONMENT_REVISION,
    completeness: "complete",
    freshness: "fresh",
    environmentFreshness: "fresh",
    evidenceRefs: [],
    sequence: 1,
    createdAt: now,
  });
  await db.insert(aiWorldFactsTable).values({
    id: worldFactId,
    projectId,
    taskScope,
    environmentRevisionKey: `revision:${ENVIRONMENT_REVISION}`,
    subject: "repository",
    predicate: "branch",
    value: observedValue,
    valueHash,
    version: 1,
    status: "confirmed",
    sourceObservationIds: [observationId],
    projectRevision: PROJECT_REVISION,
    environmentRevision: ENVIRONMENT_REVISION,
    environmentFreshness: "fresh",
    createdAt: now,
    updatedAt: now,
  });

  return {
    projectId,
    missionId,
    goalId,
    executionId,
    acceptanceId,
    episodeId,
    observationId,
    worldFactId,
    taskScope,
    episodeScope,
    projectRevision: PROJECT_REVISION,
    environmentRevision: ENVIRONMENT_REVISION,
    now,
    outcomeContract,
    nextAction,
    successCriteria,
  };
}

async function addForeignEpisodeWorldFactSource(fixture: ReplanEvidenceFixture) {
  const executionId = randomUUID();
  const episodeId = randomUUID();
  const observationId = randomUUID();

  await db.insert(aiExecutionsTable).values({
    id: executionId,
    projectId: fixture.projectId,
    goalId: fixture.goalId,
    operationId: `operation:${executionId}`,
    userId: "test-user",
    idempotencyKey: `execution:${executionId}`,
    resumeTokenHash: `resume:${executionId}`,
    request: JSON.stringify({ intent: MISSION_INTENT }),
    checkpoint: "{}",
    status: "failed",
    attempt: 1,
    createdAt: fixture.now,
    updatedAt: fixture.now,
  });
  await db.insert(aiAgentEpisodesTable).values({
    id: episodeId,
    projectId: fixture.projectId,
    executionId,
    attempt: 1,
    missionId: fixture.missionId,
    goalId: fixture.goalId,
    projectRevision: fixture.projectRevision,
    environmentRevision: fixture.environmentRevision,
    planRevision: "other-episode-plan",
    intentKind: "mission_task",
    scope: fixture.episodeScope,
    state: "failed",
    verdict: "failed",
    reasonCode: FAILURE_DIAGNOSIS.reasonCode,
    nextActionCode: FAILURE_DIAGNOSIS.nextActionCode,
    workerId: "other-test-worker",
    leaseUntil: fixture.now,
    idempotencyKey: `episode:${executionId}:1`,
    createdAt: fixture.now,
    updatedAt: fixture.now,
    closedAt: fixture.now,
  });
  const [persistedEpisode] = await db.select().from(aiAgentEpisodesTable)
    .where(eq(aiAgentEpisodesTable.id, episodeId));
  if (!persistedEpisode) throw new Error("mission_replan_test_foreign_episode_missing");
  const taskScope = taskScopeIdentity(persistedEpisode);
  expect(taskScope).toBe(fixture.taskScope);
  await db.insert(aiAgentObservationsTable).values({
    id: observationId,
    projectId: fixture.projectId,
    executionId,
    episodeId,
    taskScope,
    environmentRevisionKey: `revision:${fixture.environmentRevision}`,
    kind: "direct_observation",
    provenance: "DIRECT_OBSERVATION",
    observationRole: "repository.branch",
    sourceType: "direct_observation",
    sourceId: `direct:${observationId}`,
    sourceVersion: fixture.projectRevision,
    subject: "repository",
    predicate: "branch",
    value: "main",
    valueHash: createHash("sha256").update(JSON.stringify("main")).digest("hex"),
    sourceRefs: [],
    observedAt: fixture.now,
    projectRevision: fixture.projectRevision,
    environmentRevision: fixture.environmentRevision,
    completeness: "complete",
    freshness: "fresh",
    environmentFreshness: "fresh",
    evidenceRefs: [],
    sequence: 1,
    createdAt: fixture.now,
  });
  await db.update(aiWorldFactsTable)
    .set({ sourceObservationIds: [observationId] })
    .where(eq(aiWorldFactsTable.id, fixture.worldFactId));
}

type RejectedEvidenceCase = {
  name: string;
  mutate: (fixture: ReplanEvidenceFixture) => Promise<void>;
};

const rejectedEvidenceCases: RejectedEvidenceCase[] = [
  {
    name: "acceptance projection references a different execution",
    mutate: async (fixture) => {
      await db.update(aiGoalsTable).set({
        outcomeContract: {
          ...fixture.outcomeContract,
          acceptance: {
            ...fixture.outcomeContract.acceptance,
            executionId: randomUUID(),
          },
        },
      }).where(eq(aiGoalsTable.id, fixture.goalId));
    },
  },
  {
    name: "acceptance ID does not match the durable acceptance row",
    mutate: async (fixture) => {
      await db.update(aiGoalsTable).set({
        outcomeContract: {
          ...fixture.outcomeContract,
          acceptance: {
            ...fixture.outcomeContract.acceptance,
            acceptanceId: randomUUID(),
          },
        },
      }).where(eq(aiGoalsTable.id, fixture.goalId));
    },
  },
  {
    name: "execution attempt does not match the accepted attempt",
    mutate: async (fixture) => {
      await db.update(aiExecutionsTable)
        .set({ attempt: 3 })
        .where(eq(aiExecutionsTable.id, fixture.executionId));
    },
  },
  {
    name: "Episode attempt does not match the accepted attempt",
    mutate: async (fixture) => {
      await db.update(aiAgentEpisodesTable)
        .set({ attempt: 1 })
        .where(eq(aiAgentEpisodesTable.id, fixture.episodeId));
    },
  },
  {
    name: "Episode is bound to a different Goal",
    mutate: async (fixture) => {
      const otherGoalId = randomUUID();
      await db.insert(aiGoalsTable).values({
        id: otherGoalId,
        missionId: fixture.missionId,
        projectId: fixture.projectId,
        title: "Unrelated Goal",
        status: "blocked",
        successCriteria: { kind: "unrelated_test_goal" },
        evidenceContract: { required: true },
        outcomeContract: {},
        nextAction: { kind: "none" },
        createdAt: fixture.now,
        updatedAt: fixture.now,
      });
      await db.update(aiAgentEpisodesTable)
        .set({ goalId: otherGoalId })
        .where(eq(aiAgentEpisodesTable.id, fixture.episodeId));
    },
  },
  {
    name: "source observation is stale",
    mutate: async (fixture) => {
      await db.update(aiAgentObservationsTable)
        .set({ freshness: "stale" })
        .where(eq(aiAgentObservationsTable.id, fixture.observationId));
    },
  },
  {
    name: "source observation is from another project revision",
    mutate: async (fixture) => {
      await db.update(aiAgentObservationsTable)
        .set({ projectRevision: "different-project-revision" })
        .where(eq(aiAgentObservationsTable.id, fixture.observationId));
    },
  },
  {
    name: "World Fact source observation belongs to another Episode",
    mutate: addForeignEpisodeWorldFactSource,
  },
];

async function sourceRowsSnapshot(fixture: ReplanEvidenceFixture) {
  const [goal] = await db.select({
    status: aiGoalsTable.status,
    outcomeContract: aiGoalsTable.outcomeContract,
    successCriteria: aiGoalsTable.successCriteria,
  }).from(aiGoalsTable).where(eq(aiGoalsTable.id, fixture.goalId));
  const [acceptance] = await db.select().from(aiExecutionAcceptancesTable)
    .where(eq(aiExecutionAcceptancesTable.id, fixture.acceptanceId));
  const [execution] = await db.select().from(aiExecutionsTable)
    .where(eq(aiExecutionsTable.id, fixture.executionId));
  const [episode] = await db.select().from(aiAgentEpisodesTable)
    .where(eq(aiAgentEpisodesTable.id, fixture.episodeId));
  const [observation] = await db.select().from(aiAgentObservationsTable)
    .where(eq(aiAgentObservationsTable.id, fixture.observationId));
  const [worldFact] = await db.select().from(aiWorldFactsTable)
    .where(eq(aiWorldFactsTable.id, fixture.worldFactId));
  return { goal, acceptance, execution, episode, observation, worldFact };
}

describe("DB-backed automatic Mission replan evidence boundary", () => {
  it("selects the outcome-bound current acceptance when historical attempts remain", async () => {
    const fixture = await createReplanEvidenceFixture();
    await db.insert(aiExecutionAcceptancesTable).values({
      id: randomUUID(),
      executionId: fixture.executionId,
      projectId: fixture.projectId,
      attempt: 1,
      finalizationKey: `final:${fixture.executionId}:1`,
      operationId: `operation:${fixture.executionId}`,
      workerId: "historical-test-worker",
      terminalStatus: "failed",
      outcome: "FAILED",
      reasonCode: FAILURE_DIAGNOSIS.reasonCode,
      nextActionCode: FAILURE_DIAGNOSIS.nextActionCode,
      sourceRevision: PROJECT_REVISION,
      createdAt: new Date(fixture.now.getTime() - 1_000),
    });

    const planningRead = await db.transaction((tx) =>
      loadMissionWorldStatePlanningRead(tx, {
        missionId: fixture.missionId,
        projectId: fixture.projectId,
        goalId: fixture.goalId,
        outcomeContract: fixture.outcomeContract,
        nextAction: fixture.nextAction,
        successCriteria: fixture.successCriteria,
      }),
    );

    expect(planningRead).toMatchObject({
      sourceExecutionId: fixture.executionId,
      sourceAttempt: 2,
    });
  });

  it("binds validator strategy provenance to the exact durable failed attempt", async () => {
    const fixture = await createReplanEvidenceFixture();
    const validatorDiagnosis = {
      kind: "VALIDATOR_FAILED",
      reasonCode: "VALIDATOR_FAILED",
      nextActionCode: "REPAIR_AND_REVALIDATE",
      retryable: true,
      requiresApproval: false,
    } as const;
    await db.update(aiMissionsTable)
      .set({ intent: MISSION_INTENT })
      .where(eq(aiMissionsTable.id, fixture.missionId));
    await db.update(aiGoalsTable).set({
      outcomeContract: {
        ...fixture.outcomeContract,
        acceptance: {
          ...fixture.outcomeContract.acceptance,
          failureDiagnosis: validatorDiagnosis,
          affectedPaths: ["src/auth/session.ts"],
          acceptedRefs: ["validation:run-12"],
        },
      },
    }).where(eq(aiGoalsTable.id, fixture.goalId));
    await db.update(aiExecutionAcceptancesTable).set({
      reasonCode: validatorDiagnosis.reasonCode,
      nextActionCode: validatorDiagnosis.nextActionCode,
    }).where(eq(aiExecutionAcceptancesTable.id, fixture.acceptanceId));
    await db.update(aiAgentEpisodesTable).set({
      reasonCode: validatorDiagnosis.reasonCode,
      nextActionCode: validatorDiagnosis.nextActionCode,
    }).where(eq(aiAgentEpisodesTable.id, fixture.episodeId));

    const dispatchExecutionIds: string[] = [];
    const result = await autoReplanMission(fixture.missionId, async (input) => {
      const executionId = randomUUID();
      const createdAt = new Date();
      await db.insert(aiExecutionsTable).values({
        id: executionId,
        projectId: fixture.projectId,
        goalId: input.goalId,
        operationId: `operation:${executionId}`,
        userId: input.userId,
        idempotencyKey: `mission-replan-dispatch:${executionId}`,
        resumeTokenHash: `resume:${executionId}`,
        request: JSON.stringify({ intent: "isolated validator replan dispatch fixture" }),
        checkpoint: "{}",
        status: "queued",
        attempt: 1,
        createdAt,
        updatedAt: createdAt,
      });
      dispatchExecutionIds.push(executionId);
      return {
        status: "scheduled",
        goalId: input.goalId,
        executionId,
        reason: "scheduled_by_test_fixture",
      };
    });

    expect(result.status, JSON.stringify(result)).toBe("replanned");
    if (result.status !== "replanned") return;
    const [materializedGoal] = await db.select({
      successCriteria: aiGoalsTable.successCriteria,
    }).from(aiGoalsTable).where(eq(aiGoalsTable.id, result.plan.goals[0]!.goalId));
    expect(materializedGoal?.successCriteria).toMatchObject({
      planRevision: {
        strategyDecision: {
          scenario: "validator_recovery",
          source: {
            sourceAcceptanceId: fixture.acceptanceId,
            sourceExecutionId: fixture.executionId,
            sourceEpisodeId: fixture.episodeId,
            sourceAttempt: 2,
          },
        },
      },
    });
    const planSnapshot = (materializedGoal?.successCriteria as {
      planRevision?: Record<string, unknown>;
    }).planRevision;
    const decisionTraceId = planSnapshot?.decisionTraceId;
    if (typeof decisionTraceId !== "string") {
      throw new Error("validator_replan_test_trace_missing");
    }
    const trace = await getMissionDecisionTrace(decisionTraceId);
    const planApplied = trace?.events.some(({ stage }) => stage === "PLAN_APPLIED") ?? false;
    const dispatchEvent = trace?.events.find(({ stage }) => stage === "DISPATCHED");
    expect(Boolean(dispatchEvent)).toBe(planApplied);
    if (dispatchEvent?.referenceId) {
      const batch = await getMissionDecisionDispatchBatch(dispatchEvent.referenceId);
      expect(batch?.items.map(({ executionId }) => executionId)).toEqual(dispatchExecutionIds);
    }
  });

  it("does not dispatch validator recovery when its acceptance projection is not durable", async () => {
    const fixture = await createReplanEvidenceFixture();
    const validatorDiagnosis = {
      kind: "VALIDATOR_FAILED",
      reasonCode: "VALIDATOR_FAILED",
      nextActionCode: "REPAIR_AND_REVALIDATE",
      retryable: true,
      requiresApproval: false,
    } as const;
    await db.update(aiGoalsTable).set({
      outcomeContract: {
        ...fixture.outcomeContract,
        acceptance: {
          ...fixture.outcomeContract.acceptance,
          acceptanceId: randomUUID(),
          failureDiagnosis: validatorDiagnosis,
          affectedPaths: ["src/auth/session.ts"],
          acceptedRefs: ["validation:run-12"],
        },
      },
    }).where(eq(aiGoalsTable.id, fixture.goalId));
    await db.update(aiExecutionAcceptancesTable).set({
      reasonCode: validatorDiagnosis.reasonCode,
      nextActionCode: validatorDiagnosis.nextActionCode,
    }).where(eq(aiExecutionAcceptancesTable.id, fixture.acceptanceId));
    await db.update(aiAgentEpisodesTable).set({
      reasonCode: validatorDiagnosis.reasonCode,
      nextActionCode: validatorDiagnosis.nextActionCode,
    }).where(eq(aiAgentEpisodesTable.id, fixture.episodeId));
    let dispatched = false;

    const result = await autoReplanMission(fixture.missionId, async () => {
      dispatched = true;
      return { status: "scheduled", goalId: "unexpected", reason: "unexpected" };
    });

    expect(result).toMatchObject({
      status: "skipped",
      reason: "failure_source_evidence_unbound",
    });
    expect(dispatched).toBe(false);
  });

  it("binds a changed trusted fact to the replan revision and advisory task prompt", async () => {
    const fixture = await createReplanEvidenceFixture();
    const [failedGoal] = await db.select({
      id: aiGoalsTable.id,
      blockedReason: aiGoalsTable.blockedReason,
      nextAction: aiGoalsTable.nextAction,
      outcomeContract: aiGoalsTable.outcomeContract,
      successCriteria: aiGoalsTable.successCriteria,
    }).from(aiGoalsTable).where(eq(aiGoalsTable.id, fixture.goalId));
    if (!failedGoal) throw new Error("mission_replan_test_goal_missing");

    const loadRead = () => db.transaction((tx) =>
      loadMissionWorldStatePlanningRead(tx, {
        missionId: fixture.missionId,
        projectId: fixture.projectId,
        goalId: fixture.goalId,
        outcomeContract: failedGoal.outcomeContract,
        nextAction: failedGoal.nextAction,
        successCriteria: failedGoal.successCriteria,
      }),
    );
    const initialRead = await loadRead();
    expect(initialRead?.facts).toEqual([
      expect.objectContaining({
        subject: "repository",
        predicate: "branch",
        value: "main",
      }),
    ]);
    if (!initialRead) throw new Error("mission_replan_test_initial_world_state_missing");

    const noReadPreview = buildMissionPlanPreview({
      message: MISSION_INTENT,
      objective: MISSION_INTENT,
      replanContext: buildReplanContext(failedGoal),
    });
    const initialPreview = buildMissionPlanPreview({
      message: MISSION_INTENT,
      objective: MISSION_INTENT,
      replanContext: buildReplanContext(failedGoal, undefined, initialRead),
    });
    expect(initialPreview.plan.steps).toEqual(noReadPreview.plan.steps);

    const changedValue = "release";
    const changedValueHash = createHash("sha256")
      .update(JSON.stringify(changedValue))
      .digest("hex");
    await db.update(aiAgentObservationsTable).set({
      value: changedValue,
      valueHash: changedValueHash,
    }).where(eq(aiAgentObservationsTable.id, fixture.observationId));
    await db.update(aiWorldFactsTable).set({
      value: changedValue,
      valueHash: changedValueHash,
    }).where(eq(aiWorldFactsTable.id, fixture.worldFactId));

    const changedRead = await loadRead();
    expect(changedRead?.facts).toEqual([
      expect.objectContaining({
        subject: "repository",
        predicate: "branch",
        value: changedValue,
      }),
    ]);
    if (!changedRead) throw new Error("mission_replan_test_changed_world_state_missing");
    expect(changedRead.planningReadRevision).not.toBe(initialRead.planningReadRevision);

    const changedPreview = buildMissionPlanPreview({
      message: MISSION_INTENT,
      objective: MISSION_INTENT,
      replanContext: buildReplanContext(failedGoal, undefined, changedRead),
    });
    expect(changedPreview.plan.steps).toEqual(initialPreview.plan.steps);

    const expectedRevision = `auto:${fixture.goalId}:${createHash("sha256")
      .update(JSON.stringify({
        sourcePlanHash: changedPreview.plan.planHash,
        worldStatePlanningReadRevision: changedRead.planningReadRevision,
      }))
      .digest("hex")}`;
    const result = await autoReplanMission(fixture.missionId, async (input) => ({
      status: "scheduled",
      goalId: input.goalId,
      reason: "scheduled_by_test_fixture",
    }));
    expect(result.status).toBe("replanned");
    if (result.status !== "replanned") return;
    expect(result.revision).toBe(expectedRevision);

    const prompts = await db.select({ prompt: tasksTable.prompt })
      .from(tasksTable)
      .where(inArray(tasksTable.goalId, result.plan.goals.map((goal) => goal.goalId)));
    const combinedPrompt = prompts.map((row) => row.prompt).join("\n");
    expect(combinedPrompt).toContain("Advisory World State facts");
    expect(combinedPrompt).toContain('"value":"release"');
    expect(combinedPrompt).not.toContain('"value":"main"');
    expect(combinedPrompt).toContain("Verify with fresh server-owned evidence before acting.");
  });

  it("materializes the selected runtime recovery strategy into a durable Mission plan and dispatches only its root Goals", async () => {
    const fixture = await createReplanEvidenceFixture();
    const priorPlanRevision = {
      hash: "failed-plan-revision",
      steps: [
        { id: "runtime-start", title: "Start runtime", kind: "execute" },
        { id: "deliver", title: "Verify runtime", kind: "validate" },
      ],
      transitionRequirements: [{
        kind: "runtime.start",
        version: 1,
        sourceStepId: "runtime-start",
        targetStepId: "deliver",
        from: "stopped",
        to: "running",
      }],
    };
    const worldStateFailureDiagnosis = diagnoseRuntimeStartWorldStateFailure({
      reasonCode: "accepted_transition_missing",
    });
    await db.update(aiMissionsTable)
      .set({ intent: "Start the workspace runtime and verify its status." })
      .where(eq(aiMissionsTable.id, fixture.missionId));
    await db.update(aiGoalsTable).set({
      successCriteria: {
        kind: "historical_failure",
        planRevision: priorPlanRevision,
      },
      outcomeContract: {
        ...fixture.outcomeContract,
        worldStateFailureDiagnosis,
      },
    }).where(eq(aiGoalsTable.id, fixture.goalId));
    const [failedGoal] = await db.select({
      id: aiGoalsTable.id,
      nextAction: aiGoalsTable.nextAction,
      outcomeContract: aiGoalsTable.outcomeContract,
      successCriteria: aiGoalsTable.successCriteria,
    }).from(aiGoalsTable).where(eq(aiGoalsTable.id, fixture.goalId));
    if (!failedGoal) throw new Error("mission_replan_test_goal_missing");
    const planningRead = await db.transaction((tx) =>
      loadMissionWorldStatePlanningRead(tx, {
        missionId: fixture.missionId,
        projectId: fixture.projectId,
        goalId: fixture.goalId,
        outcomeContract: failedGoal.outcomeContract,
        nextAction: failedGoal.nextAction,
        successCriteria: failedGoal.successCriteria,
      }),
    );
    // The advisory read intentionally rejects World State failure diagnoses;
    // this strategy binds the diagnosis through the exact accepted failure,
    // execution, Episode, and prior plan, while requiring fresh direct
    // observations whenever the diagnosis carries any.
    expect(planningRead).toBeUndefined();

    const dispatched: Array<{ goalId: string; userId: string; trigger: string }> = [];
    const dispatchExecutionIds: string[] = [];
    const result = await autoReplanMission(fixture.missionId, async (input) => {
      const executionId = randomUUID();
      const createdAt = new Date();
      await db.insert(aiExecutionsTable).values({
        id: executionId,
        projectId: fixture.projectId,
        goalId: input.goalId,
        operationId: `operation:${executionId}`,
        userId: input.userId,
        idempotencyKey: `mission-replan-dispatch:${executionId}`,
        resumeTokenHash: `resume:${executionId}`,
        request: JSON.stringify({ intent: "isolated mission replan dispatch fixture" }),
        checkpoint: "{}",
        status: "queued",
        attempt: 1,
        createdAt,
        updatedAt: createdAt,
      });
      dispatchExecutionIds.push(executionId);
      dispatched.push({
        goalId: input.goalId,
        userId: input.userId,
        trigger: input.trigger,
      });
      return {
        status: "scheduled",
        goalId: input.goalId,
        executionId,
        reason: "scheduled_by_test_fixture",
      };
    });

    expect(result.status, JSON.stringify(result)).toBe("replanned");
    if (result.status !== "replanned") return;
    expect(result.plan.goals.map((goal) => goal.stepId)).toContain("strategy-runtime-preflight");
    expect(result.plan.goals.map((goal) => goal.stepId)).toContain("runtime-start");
    const rootGoals = result.plan.goals.filter((goal) => goal.dependencies.length === 0);
    expect(dispatched).toEqual(rootGoals.map((goal) => ({
      goalId: goal.goalId,
      userId: "test-user",
      trigger: "replan",
    })));

    const materializedGoals = await db.select({
      id: aiGoalsTable.id,
      successCriteria: aiGoalsTable.successCriteria,
    }).from(aiGoalsTable)
      .where(inArray(aiGoalsTable.id, result.plan.goals.map((goal) => goal.goalId)));
    expect(materializedGoals).toHaveLength(result.plan.goals.length);
    const planSnapshot = materializedGoals
      .map((goal) => (goal.successCriteria as {
        planRevision?: Record<string, unknown>;
      }).planRevision)
      .find((snapshot) => snapshot?.hash === result.revision);
    expect(typeof planSnapshot?.decisionTraceId).toBe("string");
    if (typeof planSnapshot?.decisionTraceId !== "string") return;
    const storedTrace = await getMissionDecisionTrace(planSnapshot.decisionTraceId);
    expect(storedTrace?.trace.newPlanRevision).toBe(result.revision);
    const selectedProjection = (planSnapshot.strategyDecision as {
      selectedStrategyId: string;
      candidatePlanProjections: Array<{
        strategyId: string;
        actions: Array<{ approvalRequired: boolean }>;
      }>;
    }).candidatePlanProjections.find(
      ({ strategyId }) => strategyId === (planSnapshot.strategyDecision as { selectedStrategyId: string }).selectedStrategyId,
    );
    expect(selectedProjection).toBeDefined();
    const planApplied = storedTrace?.events.some(({ stage }) => stage === "PLAN_APPLIED") ?? false;
    expect(planApplied).toBe(
      !selectedProjection?.actions.some(({ approvalRequired }) => approvalRequired),
    );
    const dispatchEvent = storedTrace?.events.find(({ stage }) => stage === "DISPATCHED");
    expect(Boolean(dispatchEvent)).toBe(planApplied);
    if (dispatchEvent?.referenceId) {
      const batch = await getMissionDecisionDispatchBatch(dispatchEvent.referenceId);
      expect(batch?.batch.planRevision).toBe(result.revision);
      expect(batch?.items.map(({ goalId, executionId }) => ({ goalId, executionId }))).toEqual(
        rootGoals.map((goal, index) => ({
          goalId: goal.goalId,
          executionId: dispatchExecutionIds[index],
        })),
      );
    }
    expect(planSnapshot).toMatchObject({
      strategyDecision: {
        schemaVersion: 1,
        policyVersion: "mission-recovery-strategy-v1",
        scenario: "runtime_start_recovery",
        selectedStrategyId: "runtime.transition-provenance-first",
        source: {
          missionId: fixture.missionId,
          failedGoalId: fixture.goalId,
          priorPlanRevision: "failed-plan-revision",
          sourceEpisodeId: fixture.episodeId,
          sourceExecutionId: fixture.executionId,
          sourceAttempt: 2,
          sourceAcceptanceId: fixture.acceptanceId,
        },
      },
    });
    expect(planSnapshot?.steps).toEqual(expect.arrayContaining([
      expect.objectContaining({
        id: "strategy-runtime-preflight",
        kind: "inspect",
        readOnly: true,
      }),
      expect.objectContaining({
        id: "runtime-start",
        recipe: { recipeId: "runtime.start", recipeVersion: 1 },
        dependencies: ["strategy-runtime-preflight"],
      }),
    ]));
    expect(result.revision).toContain(fixture.goalId);

    const goalsAfterFirstReplan = await db.select({ id: aiGoalsTable.id })
      .from(aiGoalsTable)
      .where(eq(aiGoalsTable.missionId, fixture.missionId));
    const replayDispatches: string[] = [];
    const replay = await autoReplanMission(fixture.missionId, async (input) => {
      replayDispatches.push(input.goalId);
      return { status: "scheduled", goalId: input.goalId, reason: "unexpected_replay" };
    });
    const goalsAfterReplay = await db.select({ id: aiGoalsTable.id })
      .from(aiGoalsTable)
      .where(eq(aiGoalsTable.missionId, fixture.missionId));
    expect(replay.status).not.toBe("replanned");
    expect(replayDispatches).toEqual([]);
    expect(goalsAfterReplay).toHaveLength(goalsAfterFirstReplan.length);
  });

  it("rejects a runtime diagnosis whose linked observations describe unrelated repository state", async () => {
    const fixture = await createReplanEvidenceFixture();
    const priorPlanRevision = {
      hash: "failed-plan-revision",
      steps: [
        { id: "runtime-start", title: "Start runtime", kind: "execute" },
        { id: "deliver", title: "Verify runtime", kind: "validate" },
      ],
      transitionRequirements: [{
        kind: "runtime.start",
        version: 1,
        sourceStepId: "runtime-start",
        targetStepId: "deliver",
        from: "stopped",
        to: "running",
      }],
    };
    const worldStateFailureDiagnosis = diagnoseRuntimeStartWorldStateFailure({
      reasonCode: "runtime_status_missing",
      transition: {
        id: `transition:${fixture.episodeId}`,
        executionId: fixture.executionId,
        attempt: 2,
        episodeId: fixture.episodeId,
        actionId: "runtime-start",
        status: "materialized",
        parentWorldRevision: "world-parent",
        resultingWorldRevision: "world-result",
        environmentRevision: fixture.environmentRevision,
      },
      supportingObservationIds: [fixture.observationId],
    });
    await db.update(aiMissionsTable)
      .set({ intent: "Start the workspace runtime and verify its status." })
      .where(eq(aiMissionsTable.id, fixture.missionId));
    await db.update(aiGoalsTable).set({
      successCriteria: { kind: "historical_failure", planRevision: priorPlanRevision },
      outcomeContract: { ...fixture.outcomeContract, worldStateFailureDiagnosis },
    }).where(eq(aiGoalsTable.id, fixture.goalId));
    const [episode] = await db.select().from(aiAgentEpisodesTable)
      .where(eq(aiAgentEpisodesTable.id, fixture.episodeId));
    if (!episode) throw new Error("mission_replan_test_episode_missing");
    await db.insert(aiWorldTransitionsTable).values({
      id: `transition:${fixture.episodeId}`,
      projectId: fixture.projectId,
      executionId: fixture.executionId,
      attempt: 2,
      episodeId: fixture.episodeId,
      actionId: "runtime-start",
      effectBundleId: null,
      parentWorldRevision: "world-parent",
      resultingWorldRevision: "world-result",
      taskScope: taskScopeIdentity(episode),
      environmentRevisionKey: `revision:${fixture.environmentRevision}`,
      environmentRevision: fixture.environmentRevision,
      freshness: "fresh",
      beforeObservationIds: [],
      afterObservationIds: [fixture.observationId],
      materializedObservationIds: [],
      parentFactRefs: [],
      changedFactRefs: [],
      evidenceRefs: [],
      status: "materialized",
      idempotencyKey: `test-transition:${fixture.episodeId}`,
      retryCount: 0,
      failureCode: null,
      nextRetryAt: null,
      materializedAt: new Date(),
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    const dispatched: string[] = [];
    const result = await autoReplanMission(fixture.missionId, async (input) => {
      dispatched.push(input.goalId);
      return { status: "scheduled", goalId: input.goalId, reason: "test" };
    });

    expect(result).toMatchObject({
      status: "skipped",
      reason: "runtime_failure_evidence_unbound",
    });
    expect(dispatched).toEqual([]);
  });

  it.each(rejectedEvidenceCases)(
    "excludes $name from the durable plan and revision hash",
    async ({ mutate }) => {
      const fixture = await createReplanEvidenceFixture();
      await mutate(fixture);

      const [failedGoal] = await db.select({
        id: aiGoalsTable.id,
        blockedReason: aiGoalsTable.blockedReason,
        nextAction: aiGoalsTable.nextAction,
        outcomeContract: aiGoalsTable.outcomeContract,
        successCriteria: aiGoalsTable.successCriteria,
      }).from(aiGoalsTable).where(eq(aiGoalsTable.id, fixture.goalId));
      if (!failedGoal) throw new Error("mission_replan_test_goal_missing");

      const planningRead = await db.transaction((tx) =>
        loadMissionWorldStatePlanningRead(tx, {
          missionId: fixture.missionId,
          projectId: fixture.projectId,
          goalId: fixture.goalId,
          outcomeContract: failedGoal.outcomeContract,
          nextAction: failedGoal.nextAction,
          successCriteria: failedGoal.successCriteria,
        }),
      );
      expect(planningRead).toBeUndefined();

      const ordinaryPreview = buildMissionPlanPreview({
        message: MISSION_INTENT,
        objective: MISSION_INTENT,
        replanContext: buildReplanContext(failedGoal),
      });
      const before = await sourceRowsSnapshot(fixture);
      const dispatched: Array<{ goalId: string; userId: string; trigger: string }> = [];
      const result = await autoReplanMission(fixture.missionId, async (input) => {
        dispatched.push({
          goalId: input.goalId,
          userId: input.userId,
          trigger: input.trigger,
        });
        return {
          status: "scheduled",
          goalId: input.goalId,
          reason: "scheduled_by_test_fixture",
        };
      });

      expect(result.status).toBe("replanned");
      if (result.status !== "replanned") return;

      expect(result.revision).toBe(
        `auto:${fixture.goalId}:${ordinaryPreview.plan.planHash}`,
      );
      expect(result.plan.goals.map((goal) => goal.stepId)).toEqual(
        ordinaryPreview.plan.steps.map((step) => step.id),
      );
      expect(result.plan.goals.length).toBeGreaterThan(0);
      const rootGoals = result.plan.goals.filter((goal) => goal.dependencies.length === 0);
      expect(dispatched).toEqual(rootGoals.map((goal) => ({
        goalId: goal.goalId,
        userId: "test-user",
        trigger: "replan",
      })));

      const replannedGoalIds = result.plan.goals.map((goal) => goal.goalId);
      const materializedGoals = await db.select({
        id: aiGoalsTable.id,
        successCriteria: aiGoalsTable.successCriteria,
        outcomeContract: aiGoalsTable.outcomeContract,
      }).from(aiGoalsTable).where(inArray(aiGoalsTable.id, replannedGoalIds));
      expect(materializedGoals).toHaveLength(result.plan.goals.length);
      for (const materializedGoal of materializedGoals) {
        expect(materializedGoal.successCriteria).not.toHaveProperty(
          "planRevision.replanContext.worldStatePlanningRead",
        );
        expect(materializedGoal.outcomeContract).not.toHaveProperty("acceptance");
        const step = ordinaryPreview.plan.steps.find((candidate) =>
          candidate.id === (materializedGoal.successCriteria as { stepId?: string }).stepId,
        );
        expect(step).toBeDefined();
        expect(materializedGoal.outcomeContract).toHaveProperty(
          "executionProfile",
          executionProfileForMissionStep(step!.kind, Boolean(step!.recipe)),
        );
      }
      const newExecutions = await db.select({ id: aiExecutionsTable.id })
        .from(aiExecutionsTable)
        .where(inArray(aiExecutionsTable.goalId, replannedGoalIds));
      expect(newExecutions).toEqual([]);

      expect(await sourceRowsSnapshot(fixture)).toEqual(before);
    },
  );
});