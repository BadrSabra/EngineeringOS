import { afterEach, describe, expect, it } from "vitest";
import { and, eq } from "drizzle-orm";
import {
  aiGoalDependenciesTable,
  aiGoalsTable,
  aiMissionsTable,
  db,
  eventsTable,
  projectsTable,
} from "@workspace/db";
import { seedCanonicalMissionGoalCompletion } from "../__tests__/mission-dependency-proof-fixture.js";
import {
  dispatchPendingMissionGoalWakes,
  insertMissionGoalWakeIntent,
  MISSION_GOAL_WAKE_DISPATCHED,
  MISSION_GOAL_WAKE_SUPERSEDED,
  missionGoalWakeIntentId,
} from "./mission-goal-wake-outbox.js";

const projectIds: string[] = [];

async function createProject(): Promise<string> {
  const projectId = `mission-goal-wake-outbox-${crypto.randomUUID()}`;
  const now = new Date();
  projectIds.push(projectId);
  await db.insert(projectsTable).values({
    id: projectId,
    ownerId: "mission-goal-wake-outbox-test",
    name: "Mission Goal wake outbox test",
    rootPath: `/tmp/${projectId}`,
    language: "typescript",
    status: "active",
    createdAt: now,
    updatedAt: now,
  });
  return projectId;
}

async function createPlanFixture() {
  const projectId = await createProject();
  const missionId = crypto.randomUUID();
  const prerequisiteGoalId = crypto.randomUUID();
  const successorGoalId = crypto.randomUUID();
  const planRevision = `mission-goal-wake-${crypto.randomUUID()}`;
  const now = new Date();

  await db.insert(aiMissionsTable).values({
    id: missionId,
    projectId,
    userId: "mission-goal-wake-outbox-test",
    title: "Event-driven continuation",
    intent: "Wake the successor after a proven prerequisite",
    status: "active",
    scope: { kind: "project", projectId },
    autonomyPolicy: { activePlanRevision: planRevision },
    createdAt: now,
    updatedAt: now,
  });
  await db.insert(aiGoalsTable).values([
    {
      id: prerequisiteGoalId,
      missionId,
      projectId,
      title: "Proven prerequisite",
      status: "queued",
      successCriteria: { kind: "mission_plan_step", objective: "Produce canonical evidence" },
      outcomeContract: { planRevision: { hash: planRevision } },
      nextAction: { kind: "wait", reason: "event", wakeAt: null },
      createdAt: now,
      updatedAt: now,
    },
    {
      id: successorGoalId,
      missionId,
      projectId,
      title: "Dependent successor",
      status: "queued",
      successCriteria: { kind: "mission_plan_step", objective: "Continue after proof" },
      outcomeContract: { planRevision: { hash: planRevision } },
      nextAction: { kind: "wait", reason: "event", wakeAt: null },
      createdAt: now,
      updatedAt: now,
    },
  ]);
  await db.insert(aiGoalDependenciesTable).values({
    id: crypto.randomUUID(),
    missionId,
    projectId,
    goalId: successorGoalId,
    dependsOnGoalId: prerequisiteGoalId,
    planRevision,
    createdAt: now,
  });
  await seedCanonicalMissionGoalCompletion({
    projectId,
    missionId,
    goalId: prerequisiteGoalId,
    planRevision,
  });
  const [completedGoal] = await db.select({
    completedAt: aiGoalsTable.completedAt,
  }).from(aiGoalsTable)
    .where(eq(aiGoalsTable.id, prerequisiteGoalId))
    .limit(1);
  if (!completedGoal?.completedAt) throw new Error("Canonical proof fixture did not complete its Goal");

  return {
    projectId,
    missionId,
    prerequisiteGoalId,
    successorGoalId,
    completedAt: completedGoal.completedAt,
  };
}

afterEach(async () => {
  for (const projectId of projectIds.splice(0)) {
    await db.delete(projectsTable).where(eq(projectsTable.id, projectId));
  }
});

describe("Mission Goal wake outbox", () => {
  it("recovers a committed Goal wake after the immediate process path is lost", async () => {
    const fixture = await createPlanFixture();
    const intentId = await db.transaction((tx) => insertMissionGoalWakeIntent(tx, {
      missionId: fixture.missionId,
      projectId: fixture.projectId,
      goalId: fixture.prerequisiteGoalId,
      completedAt: fixture.completedAt,
    }));

    expect(intentId).toBe(missionGoalWakeIntentId(
      fixture.prerequisiteGoalId,
      fixture.completedAt,
    ));

    // This models a process interruption after the proof-gated Goal update
    // committed its wake intent but before its low-latency post-commit dispatch.
    expect(await dispatchPendingMissionGoalWakes(10, fixture.projectId)).toBe(1);

    const [successor] = await db.select({
      status: aiGoalsTable.status,
    }).from(aiGoalsTable)
      .where(eq(aiGoalsTable.id, fixture.successorGoalId))
      .limit(1);
    expect(successor?.status).toBe("waiting_for_event");

    const [intent] = await db.select({
      type: eventsTable.type,
      payload: eventsTable.payload,
    }).from(eventsTable)
      .where(eq(eventsTable.id, intentId))
      .limit(1);
    expect(intent?.type).toBe(MISSION_GOAL_WAKE_DISPATCHED);
    expect(intent?.payload).toMatchObject({
      missionId: fixture.missionId,
      goalId: fixture.prerequisiteGoalId,
      completedAt: fixture.completedAt.toISOString(),
      attemptCount: 0,
    });

    // A later durable pass cannot repeat the completed wake.
    expect(await dispatchPendingMissionGoalWakes(10, fixture.projectId)).toBe(0);
    const [afterReplay] = await db.select({
      status: aiGoalsTable.status,
    }).from(aiGoalsTable)
      .where(eq(aiGoalsTable.id, fixture.successorGoalId))
      .limit(1);
    expect(afterReplay?.status).toBe("waiting_for_event");
  });

  it("retires a wake intent when a newer Goal state supersedes its completion generation", async () => {
    const fixture = await createPlanFixture();
    const intentId = await db.transaction((tx) => insertMissionGoalWakeIntent(tx, {
      missionId: fixture.missionId,
      projectId: fixture.projectId,
      goalId: fixture.prerequisiteGoalId,
      completedAt: fixture.completedAt,
    }));
    await db.update(aiGoalsTable)
      .set({ status: "needs_replan", completedAt: null })
      .where(eq(aiGoalsTable.id, fixture.prerequisiteGoalId));

    expect(await dispatchPendingMissionGoalWakes(10, fixture.projectId)).toBe(0);
    const [intent] = await db.select({
      type: eventsTable.type,
      payload: eventsTable.payload,
    }).from(eventsTable)
      .where(and(
        eq(eventsTable.id, intentId),
        eq(eventsTable.projectId, fixture.projectId),
      ))
      .limit(1);
    expect(intent?.type).toBe(MISSION_GOAL_WAKE_SUPERSEDED);
    expect(intent?.payload).toMatchObject({
      goalId: fixture.prerequisiteGoalId,
      reason: "goal_completion_generation_changed",
    });
  });
});
