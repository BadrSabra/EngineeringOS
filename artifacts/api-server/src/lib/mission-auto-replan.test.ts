import { afterEach, describe, expect, it } from "vitest";
import { createHash, randomUUID } from "node:crypto";
import { and, eq } from "drizzle-orm";
import {
  aiAgentEpisodesTable,
  aiAgentObservationsTable,
  aiExecutionAcceptancesTable,
  aiExecutionsTable,
  aiGoalsTable,
  aiMissionsTable,
  aiWorldFactsTable,
  db,
  eventsTable,
  projectsTable,
} from "@workspace/db";
import { autoReplanMission, buildReplanContext } from "./mission-auto-replan.js";
import { taskScopeIdentity } from "./agent-state/observation-materializer.js";
import { loadMissionWorldStatePlanningRead } from "./mission-world-state-planning-read.js";
import { diagnoseRuntimeStartWorldStateFailure } from "./world-state-failure-diagnosis.js";

const projectIds: string[] = [];

afterEach(async () => {
  for (const projectId of projectIds.splice(0)) {
    await db.delete(projectsTable).where(eq(projectsTable.id, projectId)).catch(() => undefined);
  }
});

describe("automatic Mission replanning", () => {
  it("materializes a fresh revision after a recoverable Goal failure and keeps history", async () => {
    const projectId = crypto.randomUUID();
    const missionId = crypto.randomUUID();
    const failedGoalId = crypto.randomUUID();
    const now = new Date();
    projectIds.push(projectId);

    await db.insert(projectsTable).values({
      id: projectId,
      ownerId: "test-user",
      name: `mission-auto-replan-${projectId.slice(0, 8)}`,
      rootPath: process.cwd(),
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
      intent: "Inspect the source, then fix the blocking issue.",
      status: "needs_replan",
      scope: { kind: "project", projectId },
      autonomyPolicy: {},
      createdAt: now,
      updatedAt: now,
    });
    await db.insert(aiGoalsTable).values({
      id: failedGoalId,
      missionId,
      projectId,
      title: "Previous failed plan",
      status: "needs_replan",
      successCriteria: { kind: "historical_failure" },
      evidenceContract: { required: true },
      outcomeContract: {
        acceptance: {
          failureDiagnosis: {
            kind: "EVIDENCE_INCOMPLETE",
            reasonCode: "EVIDENCE_INCOMPLETE",
            nextActionCode: "GATHER_REQUIRED_EVIDENCE",
            retryable: true,
            requiresApproval: false,
          },
        },
      },
      nextAction: { kind: "replan", reason: "retry from current evidence" },
      createdAt: now,
      updatedAt: now,
    });

    const result = await autoReplanMission(
      missionId,
      async ({ goalId }) => ({
        status: "scheduled",
        goalId,
        reason: "scheduled_by_test_fixture",
      }),
    );

    expect(result.status).toBe("replanned");
    if (result.status !== "replanned") return;
    expect(result.plan.goals.length).toBeGreaterThan(1);
    expect(result.plan.revision).toContain(`auto:${failedGoalId}:`);
    expect(result.runs.some((run) => run.status === "scheduled" || run.status === "waiting")).toBe(true);

    const goals = await db
      .select({
        id: aiGoalsTable.id,
        status: aiGoalsTable.status,
        successCriteria: aiGoalsTable.successCriteria,
      })
      .from(aiGoalsTable)
      .where(and(
        eq(aiGoalsTable.missionId, missionId),
        eq(aiGoalsTable.projectId, projectId),
      ));
    expect(goals.some((goal) => goal.id === failedGoalId && goal.status === "needs_replan")).toBe(true);
    expect(goals.length).toBeGreaterThan(2);
    const replannedGoal = goals.find((goal) => goal.id !== failedGoalId);
    expect(replannedGoal?.successCriteria).toMatchObject({
      planRevision: {
        replanContext: {
          failedGoalId,
          failureClass: "EVIDENCE_INCOMPLETE",
          failureCode: "EVIDENCE_INCOMPLETE",
          failureDiagnosis: {
            kind: "EVIDENCE_INCOMPLETE",
            reasonCode: "EVIDENCE_INCOMPLETE",
            nextActionCode: "GATHER_REQUIRED_EVIDENCE",
            retryable: true,
            requiresApproval: false,
          },
          affectedPaths: [],
          affectedClaims: [],
          evidenceRefs: [],
          nextActions: ["GATHER_REQUIRED_EVIDENCE", "retry from current evidence"],
        },
      },
    });
    expect(replannedGoal?.successCriteria).not.toHaveProperty(
      "planRevision.replanContext.worldStatePlanningRead",
    );

    const [mission] = await db
      .select({ status: aiMissionsTable.status })
      .from(aiMissionsTable)
      .where(eq(aiMissionsTable.id, missionId));
    expect(mission?.status).toBe("active");
  });

  it("loads the exact failed acceptance Episode's fresh World State fact into the persisted replan", async () => {
    const projectId = randomUUID();
    const missionId = randomUUID();
    const failedGoalId = randomUUID();
    const executionId = randomUUID();
    const acceptanceId = randomUUID();
    const episodeId = randomUUID();
    const observationId = randomUUID();
    const now = new Date();
    const projectRevision = "a".repeat(40);
    const environmentRevision = `env-v1:${"b".repeat(64)}`;
    const episodeScope = { kind: "mission-task", missionId, goalId: failedGoalId };
    const observedValue = "main";
    const valueHash = createHash("sha256")
      .update(JSON.stringify(observedValue))
      .digest("hex");
    projectIds.push(projectId);

    await db.insert(projectsTable).values({
      id: projectId,
      ownerId: "test-user",
      name: `mission-world-state-replan-${projectId.slice(0, 8)}`,
      rootPath: process.cwd(),
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
      intent: "Inspect the source, then fix the blocking issue.",
      status: "needs_replan",
      scope: { kind: "project", projectId },
      autonomyPolicy: {},
      createdAt: now,
      updatedAt: now,
    });
    await db.insert(aiGoalsTable).values({
      id: failedGoalId,
      missionId,
      projectId,
      title: "Previous failed plan",
      status: "needs_replan",
      successCriteria: {
        kind: "historical_failure",
        planRevision: { hash: "failed-plan-revision" },
      },
      evidenceContract: { required: true },
      outcomeContract: {
        acceptance: {
          failureDiagnosis: {
            kind: "EVIDENCE_INCOMPLETE",
            reasonCode: "EVIDENCE_INCOMPLETE",
            nextActionCode: "GATHER_REQUIRED_EVIDENCE",
            retryable: true,
            requiresApproval: false,
          },
          executionId,
          acceptanceId,
          outcome: "FAILED",
          sourceRevision: projectRevision,
          receipt: { kind: "execution_acceptance", id: acceptanceId },
        },
      },
      nextAction: { kind: "replan", reason: "use current scoped evidence" },
      createdAt: now,
      updatedAt: now,
    });
    await db.insert(aiExecutionsTable).values({
      id: executionId,
      projectId,
      goalId: failedGoalId,
      operationId: `operation:${executionId}`,
      userId: "test-user",
      idempotencyKey: `execution:${executionId}`,
      resumeTokenHash: `resume:${executionId}`,
      request: JSON.stringify({ intent: "Inspect the source, then fix the blocking issue." }),
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
      reasonCode: "EVIDENCE_INCOMPLETE",
      nextActionCode: "GATHER_REQUIRED_EVIDENCE",
      sourceRevision: projectRevision,
      createdAt: now,
    });
    await db.insert(aiAgentEpisodesTable).values({
      id: episodeId,
      projectId,
      executionId,
      attempt: 2,
      missionId,
      goalId: failedGoalId,
      projectRevision,
      environmentRevision,
      planRevision: "failed-plan-revision",
      intentKind: "mission_task",
      scope: episodeScope,
      state: "failed",
      verdict: "failed",
      reasonCode: "EVIDENCE_INCOMPLETE",
      nextActionCode: "GATHER_REQUIRED_EVIDENCE",
      workerId: "test-worker",
      leaseUntil: now,
      idempotencyKey: `episode:${executionId}:2`,
      createdAt: now,
      updatedAt: now,
      closedAt: now,
    });
    const [persistedEpisode] = await db.select().from(aiAgentEpisodesTable)
      .where(eq(aiAgentEpisodesTable.id, episodeId));
    if (!persistedEpisode) throw new Error("test_episode_fixture_missing_after_insert");
    const taskScope = taskScopeIdentity(persistedEpisode);
    await db.insert(aiAgentObservationsTable).values({
      id: observationId,
      projectId,
      executionId,
      episodeId,
      taskScope,
      environmentRevisionKey: `revision:${environmentRevision}`,
      kind: "direct_observation",
      provenance: "DIRECT_OBSERVATION",
      observationRole: "repository.branch",
      sourceType: "direct_observation",
      sourceId: `direct:${observationId}`,
      sourceVersion: projectRevision,
      subject: "repository",
      predicate: "branch",
      value: observedValue,
      valueHash,
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
    await db.insert(aiWorldFactsTable).values({
      id: randomUUID(),
      projectId,
      taskScope,
      environmentRevisionKey: `revision:${environmentRevision}`,
      subject: "repository",
      predicate: "branch",
      value: observedValue,
      valueHash,
      version: 1,
      status: "confirmed",
      sourceObservationIds: [observationId],
      projectRevision,
      environmentRevision,
      environmentFreshness: "fresh",
      createdAt: now,
      updatedAt: now,
    });

    const planningRead = await db.transaction((tx) => loadMissionWorldStatePlanningRead(tx, {
      missionId,
      projectId,
      goalId: failedGoalId,
      outcomeContract: {
        acceptance: {
          executionId,
          acceptanceId,
          outcome: "FAILED",
        },
      },
      nextAction: { kind: "replan" },
      successCriteria: { kind: "historical_failure" },
    }));
    expect(planningRead).toMatchObject({
      sourceEpisodeId: episodeId,
      sourceExecutionId: executionId,
      sourceAttempt: 2,
      facts: [{
        subject: "repository",
        predicate: "branch",
        value: observedValue,
        sourceObservationIds: [observationId],
      }],
    });

    const result = await autoReplanMission(
      missionId,
      async ({ goalId }) => ({
        status: "scheduled",
        goalId,
        reason: "scheduled_by_test_fixture",
      }),
    );

    expect(result.status).toBe("replanned");
    if (result.status !== "replanned") return;
    expect(result.revision).toMatch(new RegExp(`^auto:${failedGoalId}:[a-f0-9]{64}$`));
    const goals = await db
      .select({
        id: aiGoalsTable.id,
        successCriteria: aiGoalsTable.successCriteria,
      })
      .from(aiGoalsTable)
      .where(and(
        eq(aiGoalsTable.missionId, missionId),
        eq(aiGoalsTable.projectId, projectId),
      ));
    const replannedGoal = goals.find((goal) => goal.id !== failedGoalId);
    expect(replannedGoal?.successCriteria).toMatchObject({
      planRevision: {
        replanContext: {
          worldStatePlanningRead: {
            kind: "advisory_world_state_read",
            sourceEpisodeId: episodeId,
            sourceExecutionId: executionId,
            sourceAttempt: 2,
            taskScope,
            projectRevision,
            environmentRevision,
            facts: [{
              subject: "repository",
              predicate: "branch",
              value: observedValue,
              sourceObservationIds: [observationId],
            }],
            planningReadRevision: expect.stringMatching(/^[a-f0-9]{64}$/),
          },
        },
      },
    });
  });

  it("uses a server-owned World State diagnosis in the fresh replan context", () => {
    const failedGoalId = crypto.randomUUID();
    const diagnosis = diagnoseRuntimeStartWorldStateFailure({
      reasonCode: "after_state_missing",
      transition: {
        id: "world-transition-1",
        executionId: "execution-1",
        attempt: 1,
        episodeId: "episode-1",
        actionId: "action-1",
        status: "materialized",
        parentWorldRevision: "a".repeat(64),
        resultingWorldRevision: "b".repeat(64),
        environmentRevision: `env-v1:${"c".repeat(64)}`,
        parentFactRefs: ["runtime.session"],
        changedFactRefs: ["runtime.status"],
      },
      supportingObservationIds: ["before-observation-1"],
    });
    const context = buildReplanContext({
      id: failedGoalId,
      blockedReason: "runtime_start_transition_unproven",
      nextAction: { kind: "replan", reason: "collect direct runtime observations" },
      outcomeContract: { worldStateFailureDiagnosis: diagnosis },
      successCriteria: { kind: "historical_failure" },
    });

    expect(context).toMatchObject({
      failedGoalId,
      failureClass: "EVIDENCE_INCOMPLETE",
      failureCode: "EVIDENCE_INCOMPLETE",
      failureDiagnosis: {
        kind: "EVIDENCE_INCOMPLETE",
        retryable: true,
        requiresApproval: false,
      },
      affectedFacts: ["runtime.session", "runtime.status"],
      evidenceRefs: [
        "world-transition:world-transition-1",
        "observation:before-observation-1",
      ],
      hypothesisImpact: "assumption=runtime_is_running_after_start;expectedEffect=runtime_status_stopped_to_running;disposition=observe;remaining=runtime_effect_not_applied,runtime_effect_applied_but_not_observed",
      nextActions: expect.arrayContaining([
        "world-state:after_state_missing",
        "world-state-assumption:runtime_is_running_after_start",
        "world-state-expected-effect:runtime_status_stopped_to_running",
        "world-state-disposition:observe",
        "runtime:after_state",
        "runtime:direct_status",
      ]),
    });
  });

  it("terminalizes a Mission when its automatic replan budget is exhausted", async () => {
    const projectId = crypto.randomUUID();
    const missionId = crypto.randomUUID();
    const failedGoalId = crypto.randomUUID();
    const now = new Date();
    projectIds.push(projectId);

    await db.insert(projectsTable).values({
      id: projectId,
      ownerId: "test-user",
      name: `mission-auto-replan-budget-${projectId.slice(0, 8)}`,
      rootPath: process.cwd(),
      language: "typescript",
      status: "active",
      createdAt: now,
      updatedAt: now,
    });
    await db.insert(aiMissionsTable).values({
      id: missionId,
      projectId,
      userId: "test-user",
      title: "Exhausted recovery",
      intent: "Inspect the source, then fix the blocking issue.",
      status: "needs_replan",
      scope: { kind: "project", projectId },
      autonomyPolicy: {
        automaticReplanCount: 2,
        maxAutomaticReplans: 2,
      },
      createdAt: now,
      updatedAt: now,
    });
    await db.insert(aiGoalsTable).values({
      id: failedGoalId,
      missionId,
      projectId,
      title: "Previous failed plan",
      status: "needs_replan",
      successCriteria: { kind: "historical_failure" },
      evidenceContract: { required: true },
      outcomeContract: {},
      nextAction: { kind: "replan", reason: "retry budget exhausted" },
      createdAt: now,
      updatedAt: now,
    });

    const result = await autoReplanMission(missionId);

    expect(result).toEqual({
      status: "skipped",
      missionId,
      reason: "automatic_replan_budget_exhausted",
    });
    const [mission] = await db
      .select({ status: aiMissionsTable.status })
      .from(aiMissionsTable)
      .where(eq(aiMissionsTable.id, missionId));
    expect(mission?.status).toBe("blocked");

    const [event] = await db
      .select({
        type: eventsTable.type,
        severity: eventsTable.severity,
        payload: eventsTable.payload,
      })
      .from(eventsTable)
      .where(eq(eventsTable.projectId, projectId))
      .orderBy(eventsTable.timestamp);
    expect(event).toMatchObject({
      type: "AiMissionReplanBlocked",
      severity: "warning",
      payload: {
        missionId,
        reason: "automatic_replan_budget_exhausted",
        nextStatus: "blocked",
      },
    });

    expect(await autoReplanMission(missionId)).toEqual({
      status: "skipped",
      missionId,
      reason: "mission_not_ready",
    });
    const events = await db
      .select({ type: eventsTable.type })
      .from(eventsTable)
      .where(eq(eventsTable.projectId, projectId));
    expect(events.filter((item) => item.type === "AiMissionReplanBlocked")).toHaveLength(1);
  });

  it("blocks automatic replanning for approval-required or malformed diagnoses", async () => {
    const projectId = crypto.randomUUID();
    const missionId = crypto.randomUUID();
    const now = new Date();
    projectIds.push(projectId);

    await db.insert(projectsTable).values({
      id: projectId,
      ownerId: "test-user",
      name: `mission-auto-replan-approval-${projectId.slice(0, 8)}`,
      rootPath: process.cwd(),
      language: "typescript",
      status: "active",
      createdAt: now,
      updatedAt: now,
    });
    await db.insert(aiMissionsTable).values({
      id: missionId,
      projectId,
      userId: "test-user",
      title: "Approval-bound recovery",
      intent: "Inspect the source, then fix the blocking issue.",
      status: "needs_replan",
      scope: { kind: "project", projectId },
      autonomyPolicy: {},
      createdAt: now,
      updatedAt: now,
    });
    await db.insert(aiGoalsTable).values({
      id: crypto.randomUUID(),
      missionId,
      projectId,
      title: "Authorization failure",
      status: "needs_replan",
      successCriteria: { kind: "historical_failure" },
      evidenceContract: { required: true },
      outcomeContract: {
        acceptance: {
          failureDiagnosis: {
            kind: "AUTHORIZATION_REQUIRED",
            reasonCode: "OWNER_AUTHORIZATION_MISSING",
            nextActionCode: "REQUEST_APPROVAL",
            retryable: false,
            requiresApproval: true,
          },
        },
      },
      nextAction: { kind: "replan", reason: "owner authorization required" },
      createdAt: now,
      updatedAt: now,
    });

    expect(await autoReplanMission(missionId)).toEqual({
      status: "skipped",
      missionId,
      reason: "failure_requires_owner_approval",
    });
    const [mission] = await db
      .select({ status: aiMissionsTable.status })
      .from(aiMissionsTable)
      .where(eq(aiMissionsTable.id, missionId));
    expect(mission?.status).toBe("blocked");

    const malformedMissionId = crypto.randomUUID();
    await db.insert(aiMissionsTable).values({
      id: malformedMissionId,
      projectId,
      userId: "test-user",
      title: "Malformed diagnosis recovery",
      intent: "Inspect the source, then fix the blocking issue.",
      status: "needs_replan",
      scope: { kind: "project", projectId },
      autonomyPolicy: {},
      createdAt: now,
      updatedAt: now,
    });
    await db.insert(aiGoalsTable).values({
      id: crypto.randomUUID(),
      missionId: malformedMissionId,
      projectId,
      title: "Malformed diagnosis",
      status: "needs_replan",
      successCriteria: { kind: "historical_failure" },
      evidenceContract: { required: true },
      outcomeContract: {
        acceptance: {
          failureDiagnosis: {
            kind: "AUTHORIZATION_REQUIRED",
            reasonCode: "PROVIDER_INVENTED_CODE",
            nextActionCode: "REQUEST_APPROVAL",
            retryable: false,
            requiresApproval: true,
          },
        },
      },
      nextAction: { kind: "replan", reason: "diagnosis is malformed" },
      createdAt: now,
      updatedAt: now,
    });
    expect(await autoReplanMission(malformedMissionId)).toEqual({
      status: "skipped",
      missionId: malformedMissionId,
      reason: "failure_diagnosis_invalid",
    });
    const [malformedMission] = await db
      .select({ status: aiMissionsTable.status })
      .from(aiMissionsTable)
      .where(eq(aiMissionsTable.id, malformedMissionId));
    expect(malformedMission?.status).toBe("blocked");
  });
});