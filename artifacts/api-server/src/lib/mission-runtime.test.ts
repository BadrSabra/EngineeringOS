import { afterEach, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import {
  aiExecutionsTable,
  aiGoalsTable,
  aiMissionsTable,
  db,
  projectsTable,
  tasksTable,
} from "@workspace/db";
import { runMissionGoal } from "./mission-runtime.js";

const projectIds: string[] = [];

async function createMissionFixture(nextAction: Record<string, unknown>) {
  const projectId = randomUUID();
  const missionId = randomUUID();
  const goalId = randomUUID();
  const now = new Date();
  await db.insert(projectsTable).values({
    id: projectId,
    ownerId: "test-user",
    name: `mission-runtime-${projectId.slice(0, 8)}`,
    rootPath: `/tmp/mission-runtime-${projectId}`,
    language: "typescript",
    status: "active",
    createdAt: now,
    updatedAt: now,
  });
  await db.insert(aiMissionsTable).values({
    id: missionId,
    projectId,
    userId: "test-user",
    title: "Runtime fixture",
    intent: "Exercise the existing objective runtime",
    status: "active",
    scope: { kind: "project", projectId },
    createdAt: now,
    updatedAt: now,
  });
  await db.insert(aiGoalsTable).values({
    id: goalId,
    missionId,
    projectId,
    title: "Runtime goal",
    status: "queued",
    nextAction,
    createdAt: now,
    updatedAt: now,
  });
  projectIds.push(projectId);
  return { projectId, missionId, goalId, now };
}

afterEach(async () => {
  for (const projectId of projectIds.splice(0)) {
    await db.delete(projectsTable).where(eq(projectsTable.id, projectId)).catch(() => undefined);
  }
});

describe("Mission goal runtime", () => {
  it("persists a server-owned wait transition", async () => {
    const fixture = await createMissionFixture({
      kind: "wait",
      reason: "event",
      wakeAt: "2026-09-22T05:00:00.000Z",
    });

    const result = await runMissionGoal({
      goalId: fixture.goalId,
      userId: "test-user",
      trigger: "wake",
    });

    expect(result).toEqual({
      status: "waiting",
      goalId: fixture.goalId,
    });
    const [goal] = await db
      .select({ status: aiGoalsTable.status, nextWakeAt: aiGoalsTable.nextWakeAt })
      .from(aiGoalsTable)
      .where(eq(aiGoalsTable.id, fixture.goalId));
    expect(goal?.status).toBe("waiting_for_event");
    expect(goal?.nextWakeAt?.toISOString()).toBe("2026-09-22T05:00:00.000Z");
  });

  it("moves a replan action to needs_replan without creating another execution", async () => {
    const fixture = await createMissionFixture({
      kind: "replan",
      reason: "source revision changed",
    });

    const result = await runMissionGoal({
      goalId: fixture.goalId,
      userId: "test-user",
      trigger: "resume",
    });

    expect(result.status).toBe("blocked");
    expect(result.reason).toBe("replan_required");
    const [goal] = await db
      .select({ status: aiGoalsTable.status, blockedReason: aiGoalsTable.blockedReason })
      .from(aiGoalsTable)
      .where(eq(aiGoalsTable.id, fixture.goalId));
    const [mission] = await db
      .select({ status: aiMissionsTable.status })
      .from(aiMissionsTable)
      .where(eq(aiMissionsTable.id, fixture.missionId));
    expect(goal).toEqual({
      status: "needs_replan",
      blockedReason: "source revision changed",
    });
    expect(mission?.status).toBe("needs_replan");
  });

  it("returns the existing active execution instead of scheduling the task again", async () => {
    const taskId = randomUUID();
    const fixture = await createMissionFixture({
      kind: "task",
      taskId,
      purpose: "execution",
    });
    await db.insert(tasksTable).values({
      id: taskId,
      projectId: fixture.projectId,
      goalId: fixture.goalId,
      title: "Existing task",
      description: "Already running",
      status: "verifying",
      priority: "p1",
      phase: "execute",
      prompt: "Already running",
      createdAt: fixture.now,
      updatedAt: fixture.now,
    });
    const executionId = randomUUID();
    await db.insert(aiExecutionsTable).values({
      id: executionId,
      projectId: fixture.projectId,
      goalId: fixture.goalId,
      linkedTaskId: taskId,
      userId: "test-user",
      idempotencyKey: `mission-runtime-${executionId}`,
      resumeTokenHash: "test-hash",
      request: "{}",
      checkpoint: "{}",
      status: "queued",
      createdAt: fixture.now,
      updatedAt: fixture.now,
    });

    const result = await runMissionGoal({
      goalId: fixture.goalId,
      userId: "test-user",
      trigger: "resume",
    });

    expect(result).toMatchObject({
      status: "scheduled",
      goalId: fixture.goalId,
      taskId,
      executionId,
      reason: "execution_already_active",
    });
  });
});