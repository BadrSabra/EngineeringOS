import { afterEach, describe, expect, it, vi } from "vitest";
import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { aiGoalsTable, aiMissionsTable, db, eventsTable, projectsTable } from "@workspace/db";
import * as missionRuntime from "./mission-runtime.js";
import {
  dispatchMissionGoalStartIntent,
  dispatchPendingMissionGoalStarts,
  insertMissionGoalStartIntent,
  MISSION_GOAL_START_DEFERRED,
  MISSION_GOAL_START_DISPATCHED,
  MISSION_GOAL_START_SUPERSEDED,
} from "./mission-goal-start-outbox.js";

const projectIds: string[] = [];

async function createStartFixture() {
  const projectId = `mission-goal-start-outbox-${randomUUID()}`;
  const missionId = randomUUID();
  const goalId = randomUUID();
  const planRevision = `manual-root-${randomUUID()}`;
  const now = new Date();
  projectIds.push(projectId);
  await db.insert(projectsTable).values({
    id: projectId,
    ownerId: "mission-goal-start-outbox-test",
    name: "Mission Goal start Outbox test",
    rootPath: `/tmp/${projectId}`,
    language: "typescript",
    status: "active",
    createdAt: now,
    updatedAt: now,
  });
  await db.insert(aiMissionsTable).values({
    id: missionId,
    projectId,
    userId: "mission-goal-start-outbox-test",
    title: "Current-plan manual root",
    intent: "Start a manual plan root through the durable Outbox",
    status: "active",
    scope: { kind: "project", projectId },
    autonomyPolicy: { activePlanRevision: planRevision },
    createdAt: now,
    updatedAt: now,
  });
  await db.insert(aiGoalsTable).values({
    id: goalId,
    missionId,
    projectId,
    title: "Manual plan root",
    status: "queued",
    successCriteria: { kind: "mission_manual_step", validator: "test" },
    outcomeContract: { planRevision: { hash: planRevision } },
    nextAction: { kind: "wait", reason: "event", wakeAt: null },
    createdAt: now,
    updatedAt: now,
  });
  const intentId = await db.transaction((tx) => insertMissionGoalStartIntent(tx, {
    missionId,
    projectId,
    goalId,
    planRevision,
    createdAt: now,
  }));
  return { projectId, missionId, goalId, planRevision, intentId };
}

afterEach(async () => {
  vi.restoreAllMocks();
  while (projectIds.length > 0) {
    const projectId = projectIds.pop();
    if (!projectId) continue;
    await db.delete(eventsTable).where(eq(eventsTable.projectId, projectId));
    await db.delete(aiGoalsTable).where(eq(aiGoalsTable.projectId, projectId));
    await db.delete(aiMissionsTable).where(eq(aiMissionsTable.projectId, projectId));
    await db.delete(projectsTable).where(eq(projectsTable.id, projectId));
  }
});

describe("Mission Goal start Outbox", () => {
  it("dispatches only the exact current-plan manual root through the normal runtime", async () => {
    const fixture = await createStartFixture();
    const run = vi.spyOn(missionRuntime, "runMissionGoal").mockResolvedValue({
      status: "waiting",
      goalId: fixture.goalId,
    });

    await expect(dispatchMissionGoalStartIntent(fixture.intentId)).resolves.toBe(true);
    expect(run).toHaveBeenCalledOnce();
    expect(run).toHaveBeenCalledWith({
      goalId: fixture.goalId,
      userId: "mission-goal-start-outbox-test",
      trigger: "activation",
    });
    const [intent] = await db.select().from(eventsTable)
      .where(eq(eventsTable.id, fixture.intentId));
    expect(intent?.type).toBe(MISSION_GOAL_START_DISPATCHED);
    expect(intent?.payload).toMatchObject({
      missionId: fixture.missionId,
      goalId: fixture.goalId,
      planRevision: fixture.planRevision,
      runStatus: "waiting",
    });
  });

  it("recovers a committed start intent after the post-commit wake is lost", async () => {
    const fixture = await createStartFixture();
    const run = vi.spyOn(missionRuntime, "runMissionGoal").mockResolvedValue({
      status: "scheduled",
      goalId: fixture.goalId,
    });

    await expect(dispatchPendingMissionGoalStarts(10, fixture.projectId)).resolves.toBe(1);
    expect(run).toHaveBeenCalledOnce();
    const [intent] = await db.select().from(eventsTable)
      .where(eq(eventsTable.id, fixture.intentId));
    expect(intent?.type).toBe(MISSION_GOAL_START_DISPATCHED);
  });

  it("supersedes a start request when the Mission plan revision changes", async () => {
    const fixture = await createStartFixture();
    await db.update(aiMissionsTable)
      .set({ autonomyPolicy: { activePlanRevision: `replacement-${fixture.planRevision}` } })
      .where(eq(aiMissionsTable.id, fixture.missionId));
    const run = vi.spyOn(missionRuntime, "runMissionGoal");

    await expect(dispatchMissionGoalStartIntent(fixture.intentId)).resolves.toBe(false);
    expect(run).not.toHaveBeenCalled();
    const [intent] = await db.select().from(eventsTable)
      .where(eq(eventsTable.id, fixture.intentId));
    expect(intent?.type).toBe(MISSION_GOAL_START_SUPERSEDED);
  });

  it("keeps one replica inside the dispatch lease while another attempts the same intent", async () => {
    const fixture = await createStartFixture();
    let release!: () => void;
    let announce!: () => void;
    const entered = new Promise<void>((resolve) => { announce = resolve; });
    const gate = new Promise<void>((resolve) => { release = resolve; });
    const run = vi.spyOn(missionRuntime, "runMissionGoal").mockImplementation(async (input) => {
      announce();
      await gate;
      return { status: "waiting", goalId: input.goalId };
    });

    const first = dispatchMissionGoalStartIntent(fixture.intentId);
    await entered;
    await expect(dispatchMissionGoalStartIntent(fixture.intentId)).resolves.toBe(false);
    release();
    await expect(first).resolves.toBe(true);
    expect(run).toHaveBeenCalledOnce();
  });

  it("defers runtime failures and retries the same intent after its backoff expires", async () => {
    const fixture = await createStartFixture();
    const run = vi.spyOn(missionRuntime, "runMissionGoal")
      .mockRejectedValueOnce(new Error("synthetic_runtime_failure"))
      .mockResolvedValueOnce({ status: "waiting", goalId: fixture.goalId });

    await expect(dispatchMissionGoalStartIntent(fixture.intentId)).resolves.toBe(false);
    const [deferred] = await db.select().from(eventsTable)
      .where(eq(eventsTable.id, fixture.intentId));
    expect(deferred?.type).toBe(MISSION_GOAL_START_DEFERRED);
    expect(deferred?.payload).toMatchObject({ attemptCount: 1 });
    await db.update(eventsTable).set({
      payload: {
        ...(deferred?.payload ?? {}),
        nextAttemptAt: "2000-01-01T00:00:00.000Z",
      },
    }).where(eq(eventsTable.id, fixture.intentId));

    await expect(dispatchMissionGoalStartIntent(fixture.intentId)).resolves.toBe(true);
    expect(run).toHaveBeenCalledTimes(2);
  });
});
