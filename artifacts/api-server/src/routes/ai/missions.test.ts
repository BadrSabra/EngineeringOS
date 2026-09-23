import { afterEach, describe, expect, it } from "vitest";
import request from "supertest";
import { randomUUID } from "crypto";
import { promises as fs } from "node:fs";
import { and, eq, inArray } from "drizzle-orm";
import app from "../../app.js";
import {
  aiChangeProposalsTable,
  aiGoalDependenciesTable,
  aiChatMessagesTable,
  aiChatSessionsTable,
  aiExecutionAcceptancesTable,
  aiExecutionEvidenceSnapshotsTable,
  aiExecutionsTable,
  aiShadowReplaysTable,
  aiGoalsTable,
  aiMissionsTable,
  db,
  eventsTable,
  projectsTable,
  tasksTable,
  workflowsTable,
} from "@workspace/db";
import { waitForScheduledAiTaskExecutions } from "./tasks.js";
import { runMissionGoal, wakeReadyMissionGoals } from "../../lib/mission-runtime.js";
import { buildExecutionProofProjection } from "../../lib/execution-proof.js";
import {
  createDeliveryWorkspace,
  DELIVERY_TREE_DIGEST_VERSION,
  hashDeliveryTree,
} from "../../lib/delivery-workspace.js";
import { createValidationWorkspace } from "../../lib/ai-repair-validation.js";
import {
  createAiExecution,
  reconcileAiExecutions,
} from "../../lib/ai-execution-state.js";
import { prepareRecipeOperation } from "../../lib/recipe-operation-runner.js";
import { runShadowReplayAttempt } from "../../lib/shadow-replay.js";

const projectIds: string[] = [];
const shadowWorkspaceRoots: string[] = [];

async function insertProject(ownerId = "test-user") {
  const id = randomUUID();
  const now = new Date();
  await db.insert(projectsTable).values({
    id,
    ownerId,
    name: `mission-test-${id.slice(0, 8)}`,
    rootPath: `/tmp/mission-test-${id}`,
    language: "typescript",
    status: "active",
    createdAt: now,
    updatedAt: now,
  });
  projectIds.push(id);
  return id;
}

afterEach(async () => {
  await waitForScheduledAiTaskExecutions();
  for (const projectId of projectIds.splice(0)) {
    await db.delete(projectsTable).where(eq(projectsTable.id, projectId)).catch(() => undefined);
  }
  for (const workspaceRoot of shadowWorkspaceRoots.splice(0)) {
    await fs.rm(workspaceRoot, { recursive: true, force: true }).catch(() => undefined);
  }
});

describe("AI missions and goals", () => {
  it("previews admission and a general plan without creating durable rows", async () => {
    const projectId = await insertProject();
    const beforeMissions = await db
      .select({ id: aiMissionsTable.id })
      .from(aiMissionsTable)
      .where(eq(aiMissionsTable.projectId, projectId));

    const response = await request(app)
      .post("/api/ai/missions/plan-preview")
      .send({
        projectId,
        message: "Inspect the source, then fix the blocking issue.",
      });

    expect(response.status).toBe(200);
    expect(response.body.version).toBe(1);
    expect(response.body.admission).toBe("mission");
    expect(response.body.plan.steps.length).toBeGreaterThan(1);

    const afterMissions = await db
      .select({ id: aiMissionsTable.id })
      .from(aiMissionsTable)
      .where(eq(aiMissionsTable.projectId, projectId));
    expect(afterMissions).toEqual(beforeMissions);
  });

  it("requires an explicit chat handoff and reuses the preview plan revision", async () => {
    const projectId = await insertProject();
    const message = "Inspect the source, then fix the blocking issue.";
    const preview = await request(app)
      .post("/api/ai/missions/plan-preview")
      .send({ projectId, message });
    expect(preview.status).toBe(200);

    const handoff = await request(app)
      .post("/api/ai/missions/from-chat")
      .send({
        projectId,
        message,
        expectedPlanHash: preview.body.plan.planHash,
      });
    expect(handoff.status).toBe(201);
    expect(handoff.body.preview.plan.planHash).toBe(preview.body.plan.planHash);
    expect(handoff.body.mission.status).toBe("active");
    expect(handoff.body.activation.goalId).toBeTruthy();
  });

  it("runs the provider-free Chat-to-Mission dependency handoff and preserves history on replan", async () => {
    const projectId = await insertProject();
    const message = "Inspect the source, then fix the blocking issue.";
    const preview = await request(app)
      .post("/api/ai/missions/plan-preview")
      .send({ projectId, message });
    expect(preview.status).toBe(200);
    expect(preview.body.admission).toBe("mission");
    expect(preview.body.plan.steps.length).toBeGreaterThan(2);

    const handoff = await request(app)
      .post("/api/ai/missions/from-chat")
      .send({
        projectId,
        message,
        expectedPlanHash: preview.body.plan.planHash,
      });
    expect(handoff.status).toBe(201);
    const missionId = handoff.body.mission.id as string;
    const planRevision = preview.body.plan.planHash as string;

    const [mission] = await db
      .select({
        status: aiMissionsTable.status,
        autonomyPolicy: aiMissionsTable.autonomyPolicy,
      })
      .from(aiMissionsTable)
      .where(eq(aiMissionsTable.id, missionId));
    expect(mission?.status).toBe("active");
    expect(mission?.autonomyPolicy).toMatchObject({
      handoffSource: { kind: "chat" },
      activePlanRevision: planRevision,
    });

    const materializedGoals = await db
      .select({
        id: aiGoalsTable.id,
        status: aiGoalsTable.status,
        successCriteria: aiGoalsTable.successCriteria,
        outcomeContract: aiGoalsTable.outcomeContract,
      })
      .from(aiGoalsTable)
      .where(eq(aiGoalsTable.missionId, missionId));
    expect(materializedGoals).toHaveLength(preview.body.plan.steps.length);

    const dependencies = await db
      .select({
        goalId: aiGoalDependenciesTable.goalId,
        dependsOnGoalId: aiGoalDependenciesTable.dependsOnGoalId,
        planRevision: aiGoalDependenciesTable.planRevision,
      })
      .from(aiGoalDependenciesTable)
      .where(eq(aiGoalDependenciesTable.missionId, missionId));
    expect(dependencies.length).toBeGreaterThan(0);
    expect(dependencies.every((dependency) => dependency.planRevision === planRevision)).toBe(true);
    expect(materializedGoals.every((goal) => (
      goal.successCriteria
      && typeof goal.successCriteria === "object"
      && !Array.isArray(goal.successCriteria)
      && (goal.successCriteria as { planRevision?: { hash?: string } }).planRevision?.hash === planRevision
    ))).toBe(true);

    const dependentGoal = materializedGoals.find((goal) =>
      dependencies.some((dependency) => dependency.goalId === goal.id),
    );
    expect(dependentGoal).toBeDefined();
    if (!dependentGoal) return;

    await expect(runMissionGoal({
      goalId: dependentGoal.id,
      userId: "test-user",
      trigger: "resume",
    })).resolves.toMatchObject({
      status: "waiting",
      goalId: dependentGoal.id,
      reason: "dependencies_pending",
    });

    const predecessorIds = dependencies
      .filter((dependency) => dependency.goalId === dependentGoal.id)
      .map((dependency) => dependency.dependsOnGoalId);
    await db.update(aiGoalsTable)
      .set({
        status: "completed",
        blockedReason: null,
        outcomeContract: {
          ...(materializedGoals.find((goal) => predecessorIds.includes(goal.id))?.outcomeContract ?? {}),
          acceptance: {
            executionId: "provider-free-accepted-execution",
            outcome: "SUCCEEDED",
            verdict: "PROVEN",
            acceptedRefs: ["provider-free-evidence"],
          },
        },
        updatedAt: new Date(),
      })
      .where(and(
        eq(aiGoalsTable.missionId, missionId),
        inArray(aiGoalsTable.id, predecessorIds),
      ));

    expect(await wakeReadyMissionGoals()).toBeGreaterThanOrEqual(1);
    const [wokenGoal] = await db
      .select({ status: aiGoalsTable.status })
      .from(aiGoalsTable)
      .where(eq(aiGoalsTable.id, dependentGoal.id));
    expect(["running", "verifying"]).toContain(wokenGoal?.status);

    const replan = await request(app)
      .post(`/api/ai/missions/${missionId}/replan`)
      .send({
        message: "Inspect the source, then fix the newly discovered issue.",
        reason: "The accepted execution exposed a new bounded objective.",
      });
    expect(replan.status).toBe(201);
    expect(replan.body.plan.planHash).not.toBe(planRevision);

    const historicalGoals = await db
      .select({
        id: aiGoalsTable.id,
        status: aiGoalsTable.status,
        successCriteria: aiGoalsTable.successCriteria,
      })
      .from(aiGoalsTable)
      .where(eq(aiGoalsTable.missionId, missionId));
    expect(historicalGoals.length).toBeGreaterThan(materializedGoals.length);
    expect(historicalGoals.some((goal) => (
      goal.successCriteria
      && typeof goal.successCriteria === "object"
      && !Array.isArray(goal.successCriteria)
      && (goal.successCriteria as { planRevision?: { hash?: string } }).planRevision?.hash === planRevision
    ))).toBe(true);
    expect(historicalGoals.some((goal) => (
      goal.successCriteria
      && typeof goal.successCriteria === "object"
      && !Array.isArray(goal.successCriteria)
      && (goal.successCriteria as { planRevision?: { hash?: string } }).planRevision?.hash === replan.body.plan.planHash
    ))).toBe(true);
  });

  it("persists revision-bound goal dependencies and rejects cycles", async () => {
    const projectId = await insertProject();
    const mission = await request(app).post("/api/ai/missions").send({
      projectId,
      title: "Dependency mission",
      intent: "Coordinate dependent work",
    });
    const first = await request(app)
      .post(`/api/ai/missions/${mission.body.id}/goals`)
      .send({ title: "Prepare evidence" });
    const second = await request(app)
      .post(`/api/ai/missions/${mission.body.id}/goals`)
      .send({
        title: "Apply follow-up",
        dependsOnGoalIds: [first.body.id],
        planRevision: "revision-1",
      });
    expect(second.status).toBe(201);

    const persisted = await db
      .select()
      .from(aiGoalDependenciesTable)
      .where(eq(aiGoalDependenciesTable.goalId, second.body.id));
    expect(persisted).toHaveLength(1);
    expect(persisted[0]?.dependsOnGoalId).toBe(first.body.id);
    expect(persisted[0]?.planRevision).toBe("revision-1");

    const cycle = await request(app)
      .patch(`/api/ai/goals/${first.body.id}`)
      .send({
        dependsOnGoalIds: [second.body.id],
        planRevision: "revision-1",
      });
    expect(cycle.status).toBe(400);
    expect(cycle.body.code).toBe("INVALID_GOAL_DEPENDENCIES");
  });

  it("creates a fresh replan Goal without replacing the prior Mission history", async () => {
    const projectId = await insertProject();
    const mission = await request(app).post("/api/ai/missions").send({
      projectId,
      title: "Replan mission",
      intent: "Inspect the source, then fix the blocking issue.",
    });
    const replan = await request(app)
      .post(`/api/ai/missions/${mission.body.id}/replan`)
      .send({
        message: "Inspect the source, then fix the newly discovered issue.",
        reason: "The first execution found a changed objective.",
      });
    expect(replan.status).toBe(201);
    expect(replan.body.goal.goalId).toBeTruthy();
    expect(replan.body.plan.planHash).toBeTruthy();

    const goals = await db
      .select()
      .from(aiGoalsTable)
      .where(eq(aiGoalsTable.missionId, mission.body.id));
    expect(goals.length).toBeGreaterThan(1);
    expect(goals.every((goal) =>
      (goal.successCriteria as Record<string, unknown>).kind === "mission_replan_step",
    )).toBe(true);
  });

  it("creates project-owned missions and goals, then returns their read-only projection", async () => {
    const projectId = await insertProject();
    const createdMission = await request(app).post("/api/ai/missions").send({
      projectId,
      title: "Ship the release",
      intent: "Coordinate the existing delivery systems",
    });
    expect(createdMission.status).toBe(201);
    expect(createdMission.body.scope).toEqual({ kind: "project", projectId });
    expect(createdMission.body.userId).toBe("test-user");

    const createdGoal = await request(app)
      .post(`/api/ai/missions/${createdMission.body.id}/goals`)
      .send({
        title: "Validate the candidate",
        successCriteria: { validator: "release" },
        evidenceContract: { required: true },
      });
    expect(createdGoal.status).toBe(201);
    expect(createdGoal.body.missionId).toBe(createdMission.body.id);

    const fetchedGoal = await request(app).get(`/api/ai/goals/${createdGoal.body.id}`);
    expect(fetchedGoal.status).toBe(200);
    expect(fetchedGoal.body.id).toBe(createdGoal.body.id);

    const listed = await request(app).get(`/api/ai/missions?projectId=${projectId}`);
    expect(listed.status).toBe(200);
    expect(listed.body).toHaveLength(1);

    const projection = await request(app).get(`/api/ai/missions/${createdMission.body.id}/projection`);
    expect(projection.status).toBe(200);
    expect(projection.body.mission.id).toBe(createdMission.body.id);
    expect(projection.body.goals).toHaveLength(1);
    expect(projection.body.goals[0].goal.id).toBe(createdGoal.body.id);
    expect(projection.body.counts).toEqual({
      goals: 1,
      tasks: 0,
      workflows: 0,
      executions: 0,
      events: 1,
    });
  });

  it("accepts an authenticated Goal event idempotently and wakes the waiting Goal", async () => {
    const projectId = await insertProject();
    const mission = await request(app).post("/api/ai/missions").send({
      projectId,
      title: "Event-driven mission",
      intent: "Wait for an external validation event",
    });
    const goal = await request(app)
      .post(`/api/ai/missions/${mission.body.id}/goals`)
      .send({
        title: "Wait for validation",
        nextAction: { kind: "wait", reason: "event", wakeAt: null },
      });
    expect(goal.status).toBe(201);
    await db.update(aiGoalsTable)
      .set({ status: "waiting_for_event" })
      .where(eq(aiGoalsTable.id, goal.body.id));

    const eventId = randomUUID();
    const delivered = await request(app)
      .post(`/api/ai/goals/${goal.body.id}/events`)
      .send({
        eventId,
        type: "ExternalValidationCompleted",
        payload: { validationId: "validation-1" },
      });
    expect(delivered.status).toBe(202);
    expect(delivered.body).toMatchObject({
      accepted: true,
      woken: true,
      duplicate: false,
      eventId,
      replayPending: false,
    });

    const duplicate = await request(app)
      .post(`/api/ai/goals/${goal.body.id}/events`)
      .send({
        eventId,
        type: "ExternalValidationCompleted",
        payload: { validationId: "validation-1" },
      });
    expect(duplicate.status).toBe(202);
    expect(duplicate.body).toMatchObject({
      accepted: true,
      duplicate: true,
      eventId,
    });

    const [persistedGoal] = await db
      .select({ status: aiGoalsTable.status })
      .from(aiGoalsTable)
      .where(eq(aiGoalsTable.id, goal.body.id));
    const [inboxEvent] = await db
      .select({ type: eventsTable.type })
      .from(eventsTable)
      .where(eq(eventsTable.id, eventId));
    expect(persistedGoal?.status).toBe("needs_replan");
    expect(inboxEvent?.type).toBe("AiMissionExternalEventReceived");
  });

  it("binds only a committed project proposal to a delivery Goal", async () => {
    const projectId = await insertProject();
    await db.update(projectsTable)
      .set({
        gitRemoteUrl: "https://github.com/example/project.git",
        gitDefaultBranch: "main",
      })
      .where(eq(projectsTable.id, projectId));
    const mission = await request(app).post("/api/ai/missions").send({
      projectId,
      title: "Verified delivery mission",
      intent: "Deliver the verified change",
    });
    const prerequisite = await request(app)
      .post(`/api/ai/missions/${mission.body.id}/goals`)
      .send({ title: "Complete verification first" });
    const goal = await request(app)
      .post(`/api/ai/missions/${mission.body.id}/goals`)
      .send({
        title: "Push verified change",
        dependsOnGoalIds: [prerequisite.body.id],
        planRevision: "delivery-plan-1",
        nextAction: {
          kind: "recipe",
          recipeId: "delivery.push.github",
          recipeVersion: 1,
          approvedPaths: [],
          candidateIdentity: null,
        },
      });
    expect(goal.status).toBe(201);

    const rejected = await request(app)
      .post(`/api/ai/goals/${goal.body.id}/delivery`)
      .send({ proposalId: randomUUID() });
    expect(rejected.status).toBe(409);
    expect(rejected.body.code).toBe("DELIVERY_PROPOSAL_NOT_COMMITTED");

    const sessionId = randomUUID();
    const messageId = randomUUID();
    const proposalId = randomUUID();
    const operationId = randomUUID();
    const now = new Date();
    await db.insert(aiChatSessionsTable).values({
      id: sessionId,
      projectId,
      title: "Delivery proposal fixture",
      createdAt: now,
      updatedAt: now,
    });
    await db.insert(aiChatMessagesTable).values({
      id: messageId,
      sessionId,
      role: "assistant",
      content: "Verified change",
      createdAt: now,
    });
    await db.insert(aiChangeProposalsTable).values({
      id: proposalId,
      projectId,
      sessionId,
      messageId,
      changes: "[]",
      appliedChanges: "[]",
      status: "applied",
      lifecycle: "committed",
      operationId,
      createdAt: now,
    });

    const bound = await request(app)
      .post(`/api/ai/goals/${goal.body.id}/delivery`)
      .send({ proposalId });
    expect(bound.status).toBe(202);
    expect(bound.body).toMatchObject({
      proposalId,
      operationId,
      run: {
        status: "waiting",
        reason: "dependencies_pending",
      },
    });
    expect(bound.body.goal.nextAction).toMatchObject({
      kind: "recipe",
      recipeId: "delivery.push.github",
      proposalId,
    });

    const [persistedGoal] = await db
      .select({ status: aiGoalsTable.status, nextAction: aiGoalsTable.nextAction })
      .from(aiGoalsTable)
      .where(eq(aiGoalsTable.id, goal.body.id));
    expect(persistedGoal?.status).toBe("waiting_for_event");
    expect(persistedGoal?.nextAction).toMatchObject({ proposalId });
    const [bindingEvent] = await db
      .select({ type: eventsTable.type, correlationId: eventsTable.correlationId })
      .from(eventsTable)
      .where(and(
        eq(eventsTable.goalId, goal.body.id),
        eq(eventsTable.type, "AiGoalDeliveryProposalBound"),
      ));
    expect(bindingEvent).toMatchObject({
      type: "AiGoalDeliveryProposalBound",
      correlationId: operationId,
    });
  });

  it("persists a server-owned skill candidate and performs read-only shadow replay", async () => {
    const projectId = await insertProject();
    const sessionId = randomUUID();
    const messageId = randomUUID();
    const proposalId = randomUUID();
    const executionId = randomUUID();
    const operationId = randomUUID();
    const missionId = randomUUID();
    const goalId = randomUUID();
    const planRevision = `shadow-plan-${operationId}`;
    const sourceRevision = "b".repeat(40);
    const now = new Date();
    const sourceRoot = `/tmp/mission-shadow-source-${operationId}`;
    await fs.mkdir(`${sourceRoot}/src`, { recursive: true });
    await fs.writeFile(`${sourceRoot}/package.json`, "{}\n", "utf8");
    await fs.writeFile(`${sourceRoot}/src/index.ts`, "export const old = false;\n", "utf8");
    const deliveryWorkspace = await createDeliveryWorkspace({
      rootPath: sourceRoot,
      operationId,
      baseRevision: sourceRevision,
      changes: [{ path: "src/index.ts", newContent: "export const ok = true;" }],
    });
    shadowWorkspaceRoots.push(deliveryWorkspace.workspaceRoot);
    await fs.rm(sourceRoot, { recursive: true, force: true });
    const candidateTreeHash = deliveryWorkspace.candidateTreeHash;
    const changeSetHash = deliveryWorkspace.changeSetHash;
    await db.insert(aiChatSessionsTable).values({
      id: sessionId,
      projectId,
      title: "Skill candidate fixture",
      createdAt: now,
      updatedAt: now,
    });
    await db.insert(aiChatMessagesTable).values({
      id: messageId,
      sessionId,
      role: "assistant",
      content: "Verified candidate",
      createdAt: now,
    });
    await db.insert(aiMissionsTable).values({
      id: missionId,
      projectId,
      userId: "test-user",
      title: "Shadow replay mission",
      intent: "Replay the verified candidate",
      status: "completed",
      scope: { kind: "project", projectId },
      autonomyPolicy: { activePlanRevision: planRevision },
      budget: {},
      createdAt: now,
      updatedAt: now,
      completedAt: now,
    });
    await db.insert(aiGoalsTable).values({
      id: goalId,
      missionId,
      projectId,
      title: "Replay the verified candidate",
      status: "completed",
      priority: "p2",
      successCriteria: {},
      evidenceContract: {},
      outcomeContract: { planRevision: { hash: planRevision } },
      nextAction: {},
      createdAt: now,
      updatedAt: now,
      completedAt: now,
    });
    await db.insert(aiChangeProposalsTable).values({
      id: proposalId,
      projectId,
      sessionId,
      messageId,
      changes: JSON.stringify([{ path: "src/index.ts", newContent: "export const ok = true;" }]),
      appliedChanges: "[]",
      status: "applied",
      lifecycle: "committed",
      operationId,
      baseRevision: sourceRevision,
      candidateTreeHash,
      changeSetHash,
      baseTreeHash: deliveryWorkspace.baseTreeHash,
      treeDigestVersion: DELIVERY_TREE_DIGEST_VERSION,
      workspaceRoot: deliveryWorkspace.workspaceRoot,
      createdAt: now,
    });
    await db.insert(aiExecutionsTable).values({
      id: executionId,
      projectId,
      sessionId,
      operationId,
      proposalId,
      goalId,
      userId: "test-user",
      idempotencyKey: `skill-candidate-${executionId}`,
      resumeTokenHash: "resume-hash",
      request: JSON.stringify({ workspaceRevision: sourceRevision }),
      checkpoint: "{}",
      status: "completed",
      createdAt: now,
      updatedAt: now,
      completedAt: now,
    });
    await db.insert(aiExecutionEvidenceSnapshotsTable).values({
      id: "evidence-1",
      executionId,
      projectId,
      attempt: 0,
      operationId,
      sourceRevision,
      candidateIdentity: candidateTreeHash,
      verdict: "PROVEN",
      complete: 1,
      readCount: 1,
      totalBytes: 128,
      createdAt: now,
    });
    const proof = buildExecutionProofProjection({
      outcome: "SUCCEEDED",
      evidenceRequired: true,
      evidenceComplete: true,
      evidenceSnapshotId: "evidence-1",
      sourceRevision,
      candidateIdentity: candidateTreeHash,
    });
    await db.insert(aiExecutionAcceptancesTable).values({
      id: randomUUID(),
      executionId,
      projectId,
      attempt: 0,
      finalizationKey: `final-${executionId}`,
      operationId,
      terminalStatus: "completed",
      outcome: "SUCCEEDED",
      reasonCode: "COMPLETED",
      nextActionCode: "NONE",
      disposition: { proof },
      evidenceSnapshotId: "evidence-1",
      evidenceRequired: 1,
      evidenceComplete: 1,
      resumable: 0,
      sourceRevision,
      candidateIdentity: candidateTreeHash,
      createdAt: now,
    });

    const bound = await request(app)
      .post(`/api/ai/proposals/${proposalId}/skill-candidate`)
      .send({});
    expect(bound.status).toBe(201);
    expect(bound.body).toMatchObject({
      candidate: {
        projectId,
        sourceRevision,
        candidateTreeHash,
        verification: { recipeId: "candidate.verify", recipeVersion: 1 },
        shadow: { mode: "shadow-replay", productionExecution: false },
      },
      lifecycle: "committed",
      productionExecution: false,
    });

    const replay = await request(app)
      .post(`/api/ai/proposals/${proposalId}/skill-candidate/shadow-replay`)
      .send({});
    expect(replay.status).toBe(200);
    expect(replay.body).toMatchObject({
      receipt: {
        candidateTreeHash,
        productionExecution: false,
        proof: { verdict: "PROVEN" },
        validator: { profile: "shadow-replay", status: "passed" },
      },
      productionExecution: false,
    });
    const replayAgain = await request(app)
      .post(`/api/ai/proposals/${proposalId}/skill-candidate/shadow-replay`)
      .send({});
    expect(replayAgain.status).toBe(200);
    expect(replayAgain.body.replay.id).toBe(replay.body.replay.id);
    const boundAgain = await request(app)
      .post(`/api/ai/proposals/${proposalId}/skill-candidate`)
      .send({});
    expect(boundAgain.status).toBe(200);

    const [persistedProposal] = await db
      .select({
        lifecycle: aiChangeProposalsTable.lifecycle,
        validationEvidence: aiChangeProposalsTable.validationEvidence,
      })
      .from(aiChangeProposalsTable)
      .where(eq(aiChangeProposalsTable.id, proposalId));
    expect(persistedProposal?.lifecycle).toBe("committed");
    expect(JSON.parse(persistedProposal?.validationEvidence ?? "{}")).toMatchObject({
      skillCandidate: {
        candidateTreeHash,
        sourceRevision,
      },
    });
    const executions = await db
      .select({ id: aiExecutionsTable.id })
      .from(aiExecutionsTable)
      .where(eq(aiExecutionsTable.proposalId, proposalId));
    expect(executions).toHaveLength(1);
    expect(executions[0]?.id).toBe(executionId);
    const [persistedReplay] = await db
      .select({
        status: aiShadowReplaysTable.status,
        executionId: aiShadowReplaysTable.executionId,
        preTreeHash: aiShadowReplaysTable.preTreeHash,
        postTreeHash: aiShadowReplaysTable.postTreeHash,
        replayWorkspaceCleaned: aiShadowReplaysTable.replayWorkspaceCleaned,
        receipt: aiShadowReplaysTable.receipt,
      })
      .from(aiShadowReplaysTable)
      .where(eq(aiShadowReplaysTable.proposalId, proposalId));
    const [replayExecution] = await db
      .select({
        id: aiExecutionsTable.id,
        proposalId: aiExecutionsTable.proposalId,
        status: aiExecutionsTable.status,
        request: aiExecutionsTable.request,
        recipeReceipt: aiExecutionsTable.recipeReceipt,
        executionProfile: aiShadowReplaysTable.executionProfile,
      })
      .from(aiExecutionsTable)
      .innerJoin(aiShadowReplaysTable, eq(aiShadowReplaysTable.executionId, aiExecutionsTable.id))
      .where(eq(aiShadowReplaysTable.proposalId, proposalId));
    expect(replayExecution).toMatchObject({
      id: persistedReplay?.executionId,
      proposalId: null,
      executionProfile: "shadow-replay",
    });
    const [replayAcceptance] = await db
      .select({
        executionId: aiExecutionAcceptancesTable.executionId,
        outcome: aiExecutionAcceptancesTable.outcome,
        terminalStatus: aiExecutionAcceptancesTable.terminalStatus,
        operationId: aiExecutionAcceptancesTable.operationId,
        sourceRevision: aiExecutionAcceptancesTable.sourceRevision,
        candidateIdentity: aiExecutionAcceptancesTable.candidateIdentity,
        evidenceSnapshotId: aiExecutionAcceptancesTable.evidenceSnapshotId,
        evidenceComplete: aiExecutionAcceptancesTable.evidenceComplete,
      })
      .from(aiExecutionAcceptancesTable)
      .where(eq(aiExecutionAcceptancesTable.executionId, persistedReplay!.executionId));
    const [replayEvidence] = await db
      .select({
        id: aiExecutionEvidenceSnapshotsTable.id,
        executionId: aiExecutionEvidenceSnapshotsTable.executionId,
        operationId: aiExecutionEvidenceSnapshotsTable.operationId,
        sourceRevision: aiExecutionEvidenceSnapshotsTable.sourceRevision,
        candidateIdentity: aiExecutionEvidenceSnapshotsTable.candidateIdentity,
        verdict: aiExecutionEvidenceSnapshotsTable.verdict,
        complete: aiExecutionEvidenceSnapshotsTable.complete,
      })
      .from(aiExecutionEvidenceSnapshotsTable)
      .where(eq(aiExecutionEvidenceSnapshotsTable.executionId, persistedReplay!.executionId));
    expect(replayExecution).toMatchObject({
      status: "completed",
      proposalId: null,
    });
    expect(JSON.parse(replayExecution?.request ?? "{}")).toMatchObject({
      executionProfile: "shadow-replay",
      operationId: expect.stringContaining("shadow-replay:"),
    });
    expect(replayExecution?.recipeReceipt).toMatchObject({
      recipeId: "candidate.verify",
      recipeVersion: 1,
      status: "completed",
      executionId: persistedReplay?.executionId,
    });
    expect(replayAcceptance).toMatchObject({
      executionId: persistedReplay?.executionId,
      outcome: "SUCCEEDED",
      terminalStatus: "completed",
      operationId: expect.stringContaining("shadow-replay:"),
      sourceRevision,
      candidateIdentity: candidateTreeHash,
      evidenceComplete: 1,
    });
    expect(replayEvidence).toMatchObject({
      executionId: persistedReplay?.executionId,
      operationId: replayAcceptance?.operationId,
      sourceRevision,
      candidateIdentity: candidateTreeHash,
      verdict: "PROVEN",
      complete: 1,
    });
    expect(replayAcceptance?.evidenceSnapshotId).toBe(replayEvidence?.id);
    expect(replay.body.receipt.proof.receiptId).toBeTruthy();
    expect(replay.body.receipt.proof.receiptId).not.toBe("evidence-1");
    expect(persistedReplay).toMatchObject({
      status: "completed",
      preTreeHash: candidateTreeHash,
      postTreeHash: candidateTreeHash,
      replayWorkspaceCleaned: true,
      receipt: {
        replayExecutionId: persistedReplay?.executionId,
        evidenceRefs: expect.arrayContaining([
          expect.stringContaining(":tree:pre"),
          expect.stringContaining(":tree:post"),
        ]),
        sideEffects: { apply: false, push: false, browser: false, commands: false },
      },
    });
  });

  it("resumes a shadow replay whose recipe execution was interrupted by a crash", async () => {
    const projectId = await insertProject();
    const userId = "test-user";
    const sessionId = randomUUID();
    const messageId = randomUUID();
    const proposalId = randomUUID();
    const replayId = randomUUID();
    const executionIdempotencyKey = `shadow-recovery-${replayId}`;
    const operationId = `shadow-replay:${replayId}`;
    const missionId = randomUUID();
    const goalId = randomUUID();
    const planRevision = `shadow-recovery-plan-${replayId}`;
    const sourceRevision = "c".repeat(40);
    const now = new Date();
    const sourceRoot = `/tmp/mission-shadow-recovery-source-${replayId}`;
    await fs.mkdir(`${sourceRoot}/src`, { recursive: true });
    await fs.writeFile(`${sourceRoot}/src/index.ts`, "export const recovered = true;\n", "utf8");
    shadowWorkspaceRoots.push(sourceRoot);
    const replayWorkspace = await createValidationWorkspace(sourceRoot, [], async () => undefined);
    shadowWorkspaceRoots.push(replayWorkspace.rootPath);
    const candidateTreeHash = await hashDeliveryTree(replayWorkspace.rootPath);

    await db.insert(aiChatSessionsTable).values({
      id: sessionId,
      projectId,
      title: "Shadow replay recovery fixture",
      createdAt: now,
      updatedAt: now,
    });
    await db.insert(aiChatMessagesTable).values({
      id: messageId,
      sessionId,
      role: "assistant",
      content: "Recovery fixture",
      createdAt: now,
    });
    await db.insert(aiMissionsTable).values({
      id: missionId,
      projectId,
      userId,
      title: "Shadow replay recovery mission",
      intent: "Recover the candidate replay",
      status: "completed",
      scope: { kind: "project", projectId },
      autonomyPolicy: { activePlanRevision: planRevision },
      budget: {},
      createdAt: now,
      updatedAt: now,
      completedAt: now,
    });
    await db.insert(aiGoalsTable).values({
      id: goalId,
      missionId,
      projectId,
      title: "Recover the candidate replay",
      status: "completed",
      priority: "p2",
      successCriteria: {},
      evidenceContract: {},
      outcomeContract: { planRevision: { hash: planRevision } },
      nextAction: {},
      createdAt: now,
      updatedAt: now,
      completedAt: now,
    });
    await db.insert(aiChangeProposalsTable).values({
      id: proposalId,
      projectId,
      sessionId,
      messageId,
      changes: JSON.stringify([{ path: "src/index.ts", newContent: "export const recovered = true;" }]),
      appliedChanges: "[]",
      status: "applied",
      lifecycle: "committed",
      operationId,
      baseRevision: sourceRevision,
      candidateTreeHash,
      changeSetHash: "recovery-change-set",
      baseTreeHash: candidateTreeHash,
      treeDigestVersion: DELIVERY_TREE_DIGEST_VERSION,
      workspaceRoot: replayWorkspace.rootPath,
      createdAt: now,
    });

    const prepared = prepareRecipeOperation({
      projectId,
      operationId,
      rootPath: sourceRoot,
      sourceRevision,
      recipeId: "candidate.verify",
      recipeVersion: 1,
      approvedPaths: ["src/index.ts"],
      candidateIdentity: candidateTreeHash,
      candidateWorkspace: replayWorkspace.rootPath,
    });
    const created = await createAiExecution({
      userId,
      request: {
        projectId,
        executionProfile: "shadow-replay",
        turnIntent: "TASK_EXECUTION",
        operationId,
        message: "Server-owned candidate shadow replay.",
        modelMessage: "Server-owned candidate shadow replay.",
        workspaceRevision: sourceRevision,
        workspaceRoot: replayWorkspace.rootPath,
        validationTargetPaths: ["src/index.ts"],
        proofRequired: true,
      },
      idempotencyKey: executionIdempotencyKey,
      correlationId: operationId,
      projectId,
      goalId,
      recipeBinding: prepared.binding,
      workspaceRoot: replayWorkspace.rootPath,
    });
    expect(created.execution.id).toBeTruthy();
    await db.update(aiExecutionsTable)
      .set({
        status: "running",
        workerId: "crashed-shadow-replay-worker",
        leaseUntil: new Date(now.getTime() - 1_000),
        lastHeartbeatAt: new Date(now.getTime() - 1_000),
        startedAt: now,
        updatedAt: now,
      })
      .where(eq(aiExecutionsTable.id, created.execution.id));
    await db.insert(aiShadowReplaysTable).values({
      id: replayId,
      executionId: created.execution.id,
      projectId,
      proposalId,
      userId,
      idempotencyKey: executionIdempotencyKey,
      operationId,
      candidateId: "recovery-candidate",
      canonicalAcceptanceId: "recovery-acceptance",
      trajectoryDigest: "recovery-trajectory",
      sourceRevision,
      candidateTreeHash,
      changeSetHash: "recovery-change-set",
      executionProfile: "shadow-replay",
      sourceWorkspaceRoot: sourceRoot,
      replayWorkspaceRoot: replayWorkspace.rootPath,
      status: "running",
      attempt: created.execution.attempt,
      workerId: "crashed-shadow-replay-worker",
      leaseUntil: new Date(now.getTime() - 1_000),
      createdAt: now,
      updatedAt: now,
    });

    const reconciled = await reconcileAiExecutions();
    expect(reconciled).toBe(1);
    const [pausedExecution] = await db
      .select({ status: aiExecutionsTable.status })
      .from(aiExecutionsTable)
      .where(eq(aiExecutionsTable.id, created.execution.id));
    expect(pausedExecution?.status).toBe("paused");

    expect(await runShadowReplayAttempt(replayId, userId)).toBe(true);
    const [recoveredReplay] = await db
      .select({
        status: aiShadowReplaysTable.status,
        receipt: aiShadowReplaysTable.receipt,
        replayWorkspaceCleaned: aiShadowReplaysTable.replayWorkspaceCleaned,
      })
      .from(aiShadowReplaysTable)
      .where(eq(aiShadowReplaysTable.id, replayId));
    const [recoveredExecution] = await db
      .select({ status: aiExecutionsTable.status })
      .from(aiExecutionsTable)
      .where(eq(aiExecutionsTable.id, created.execution.id));
    expect(recoveredReplay).toMatchObject({
      status: "completed",
      replayWorkspaceCleaned: true,
      receipt: { status: "completed", productionExecution: false },
    });
    expect(recoveredExecution?.status).toBe("completed");
  });

  it("binds active mission activation to the same server-owned plan revision", async () => {
    const projectId = await insertProject();
    const response = await request(app).post("/api/ai/missions").send({
      projectId,
      title: "Repair the release flow",
      intent: "Inspect the source, then fix the blocking issue.",
      status: "active",
    });

    expect(response.status).toBe(201);
    const goals = await db
      .select()
      .from(aiGoalsTable)
      .where(eq(aiGoalsTable.missionId, response.body.id));
    expect(goals.length).toBeGreaterThan(1);
    const revisions = goals.map((goal) => {
      const successCriteria = goal.successCriteria as Record<string, unknown>;
      const outcomeContract = goal.outcomeContract as Record<string, unknown>;
      const successPlan = successCriteria.planRevision as Record<string, unknown>;
      const outcomePlan = outcomeContract.planRevision as Record<string, unknown>;
      expect(successPlan.hash).toBeTruthy();
      expect(outcomePlan.hash).toBe(successPlan.hash);
      expect(successPlan.steps).toEqual(outcomePlan.steps);
      return successPlan.hash;
    });
    expect(new Set(revisions).size).toBe(1);
  });

  it("includes existing task, workflow, execution, and event rows linked to a goal", async () => {
    const projectId = await insertProject();
    const mission = await request(app).post("/api/ai/missions").send({
      projectId,
      title: "Coordinate work",
      intent: "Track delivery progress",
    });
    const goal = await request(app).post(`/api/ai/missions/${mission.body.id}/goals`).send({
      title: "Run the existing systems",
    });
    const goalId = goal.body.id as string;
    const taskId = randomUUID();
    const workflowId = randomUUID();
    const executionId = randomUUID();
    const now = new Date();

    await db.insert(tasksTable).values({
      id: taskId,
      projectId,
      goalId,
      title: "Existing task",
      status: "pending",
      priority: "p2",
      createdAt: now,
      updatedAt: now,
    });
    await db.insert(workflowsTable).values({
      id: workflowId,
      projectId,
      goalId,
      name: "Existing workflow",
      phases: [],
      createdAt: now,
      updatedAt: now,
    });
    await db.insert(aiExecutionsTable).values({
      id: executionId,
      projectId,
      goalId,
      userId: "test-user",
      idempotencyKey: `mission-test-${executionId}`,
      resumeTokenHash: "test-hash",
      request: "{}",
      checkpoint: "{}",
      createdAt: now,
      updatedAt: now,
    });
    await db.insert(eventsTable).values({
      id: randomUUID(),
      projectId,
      goalId,
      type: "GoalProgressed",
      severity: "success",
      message: "Goal evidence retained",
      timestamp: now,
    });

    const projection = await request(app).get(`/api/ai/missions/${mission.body.id}/projection`);
    expect(projection.status).toBe(200);
    expect(projection.body.counts).toEqual({
      goals: 1,
      tasks: 1,
      workflows: 1,
      executions: 1,
      events: 2,
    });
    expect(projection.body.goals[0].tasks[0].id).toBe(taskId);
    expect(projection.body.goals[0].workflows[0].id).toBe(workflowId);
    expect(projection.body.goals[0].executions[0].id).toBe(executionId);
  });

  it("updates owned missions and goals while preserving project ownership", async () => {
    const projectId = await insertProject();
    const mission = await request(app).post("/api/ai/missions").send({
      projectId,
      title: "Initial mission",
      intent: "Initial intent",
    });
    const goal = await request(app).post(`/api/ai/missions/${mission.body.id}/goals`).send({
      title: "Initial goal",
    });

    const updatedMission = await request(app)
      .patch(`/api/ai/missions/${mission.body.id}`)
      .send({
        title: "Updated mission",
        status: "active",
        deadline: "2027-01-15T12:00:00.000Z",
      });
    expect(updatedMission.status).toBe(200);
    expect(updatedMission.body.title).toBe("Updated mission");
    expect(updatedMission.body.status).toBe("active");
    expect(updatedMission.body.deadline).toBe("2027-01-15T12:00:00.000Z");

    const updatedGoal = await request(app)
      .patch(`/api/ai/goals/${goal.body.id}`)
      .send({
        title: "Updated goal",
        status: "blocked",
        blockedReason: "Waiting for approval",
        nextAction: { kind: "wait", reason: "approval", wakeAt: null },
      });
    expect(updatedGoal.status).toBe(200);
    expect(updatedGoal.body.title).toBe("Updated goal");
    expect(updatedGoal.body.status).toBe("blocked");
    expect(updatedGoal.body.nextAction).toEqual({
      kind: "wait",
      reason: "approval",
      wakeAt: null,
    });

    const projection = await request(app).get(`/api/ai/missions/${mission.body.id}/projection`);
    expect(projection.body.mission.title).toBe("Updated mission");
    expect(projection.body.goals[0].goal.title).toBe("Updated goal");
    expect(projection.body.counts.events).toBe(5);
  });

  it("materializes an activation plan into durable steps when a mission becomes active", async () => {
    const projectId = await insertProject();
    const mission = await request(app).post("/api/ai/missions").send({
      projectId,
      title: "Explain the project",
      intent: "Inspect the source, then fix the blocking issue.",
    });

    const activated = await request(app)
      .patch(`/api/ai/missions/${mission.body.id}`)
      .send({ status: "active" });
    expect(activated.status).toBe(200);
    expect(activated.body.status).toBe("active");

    const projection = await request(app)
      .get(`/api/ai/missions/${mission.body.id}/projection`);
    expect(projection.status).toBe(200);
    expect(projection.body.goals.length).toBeGreaterThan(1);
    expect(projection.body.goals.every((item: { tasks: unknown[] }) => item.tasks.length === 1)).toBe(true);
    const validationGoal = projection.body.goals.find((item: { goal: { title: string } }) =>
      item.goal.title === "Validate the resulting workspace",
    );
    expect(validationGoal?.goal.nextAction).toMatchObject({
      kind: "recipe",
      recipeId: "validation.recover",
      recipeVersion: 1,
      candidateIdentity: null,
    });
    expect(projection.body.goals
      .filter((item: { goal: { title: string } }) => item.goal.title !== "Validate the resulting workspace")
      .every((item: { goal: { nextAction: unknown } }) =>
        (item.goal.nextAction as { kind?: string; purpose?: string }).kind === "task"
        && (item.goal.nextAction as { purpose?: string }).purpose === "activation",
      ))
      .toBe(true);
    expect(projection.body.goals.some((item: { goal: { dependencies?: unknown[] } }) =>
      Array.isArray(item.goal.dependencies) && item.goal.dependencies.length > 0,
    )).toBe(true);

    const activatedAgain = await request(app)
      .patch(`/api/ai/missions/${mission.body.id}`)
      .send({ status: "active" });
    expect(activatedAgain.status).toBe(200);

    const afterRepeat = await request(app)
      .get(`/api/ai/missions/${mission.body.id}/projection`);
    expect(afterRepeat.body.goals).toHaveLength(projection.body.goals.length);
    expect(afterRepeat.body.goals.every((item: { tasks: unknown[] }) => item.tasks.length === 1)).toBe(true);
  });

  it("starts the activation plan during one active mission creation request", async () => {
    const projectId = await insertProject();
    const created = await request(app).post("/api/ai/missions").send({
      projectId,
      title: "Start in one step",
      intent: "Create the plan and begin execution without a second status change",
      status: "active",
    });

    expect(created.status).toBe(201);
    expect(created.body.status).toBe("active");

    const projection = await request(app)
      .get(`/api/ai/missions/${created.body.id}/projection`);
    expect(projection.status).toBe(200);
    expect(projection.body.goals.length).toBeGreaterThan(1);
    expect(projection.body.goals.every((item: { tasks: unknown[] }) => item.tasks.length === 1)).toBe(true);
  });

  it("rejects invalid goal parent updates and empty patches", async () => {
    const projectId = await insertProject();
    const mission = await request(app).post("/api/ai/missions").send({
      projectId,
      title: "Parent validation",
      intent: "Keep hierarchy safe",
    });
    const goal = await request(app).post(`/api/ai/missions/${mission.body.id}/goals`).send({
      title: "Child candidate",
    });

    const emptyMissionPatch = await request(app).patch(`/api/ai/missions/${mission.body.id}`).send({});
    expect(emptyMissionPatch.status).toBe(400);

    const selfParent = await request(app).patch(`/api/ai/goals/${goal.body.id}`).send({
      parentGoalId: goal.body.id,
    });
    expect(selfParent.status).toBe(400);

    const missingParent = await request(app).patch(`/api/ai/goals/${goal.body.id}`).send({
      parentGoalId: randomUUID(),
    });
    expect(missingParent.status).toBe(400);
  });

  it("rejects untyped goal next actions", async () => {
    const projectId = await insertProject();
    const mission = await request(app).post("/api/ai/missions").send({
      projectId,
      title: "Typed actions",
      intent: "Keep goal dispatch server-owned",
    });
    const goal = await request(app).post(`/api/ai/missions/${mission.body.id}/goals`).send({
      title: "Dispatch safely",
    });

    const response = await request(app)
      .patch(`/api/ai/goals/${goal.body.id}`)
      .send({
        nextAction: {
          owner: "operator",
          action: "approve",
        },
      });

    expect(response.status).toBe(400);
  });

  it("does not create or reveal missions for another project owner", async () => {
    const foreignProjectId = await insertProject("another-user");
    const create = await request(app).post("/api/ai/missions").send({
      projectId: foreignProjectId,
      title: "Should be rejected",
      intent: "No cross-owner access",
    });
    expect(create.status).toBe(403);

    const missionId = randomUUID();
    await db.insert(aiMissionsTable).values({
      id: missionId,
      projectId: foreignProjectId,
      userId: "another-user",
      title: "Foreign mission",
      intent: "Hidden",
      scope: { kind: "project", projectId: foreignProjectId },
    });
    const get = await request(app).get(`/api/ai/missions/${missionId}`);
    expect(get.status).toBe(404);

    const foreignGoalId = randomUUID();
    await db.insert(aiGoalsTable).values({
      id: foreignGoalId,
      missionId,
      projectId: foreignProjectId,
      title: "Foreign goal",
    });
    const patch = await request(app).patch(`/api/ai/goals/${foreignGoalId}`).send({
      title: "Should remain hidden",
    });
    expect(patch.status).toBe(404);
  });
});