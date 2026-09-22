import { afterEach, describe, expect, it } from "vitest";
import request from "supertest";
import { randomUUID } from "crypto";
import { eq } from "drizzle-orm";
import app from "../../app.js";
import {
  aiGoalDependenciesTable,
  aiExecutionsTable,
  aiGoalsTable,
  aiMissionsTable,
  db,
  eventsTable,
  projectsTable,
  tasksTable,
  workflowsTable,
} from "@workspace/db";
import { waitForScheduledAiTaskExecutions } from "./tasks.js";

const projectIds: string[] = [];

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