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
import {
  receiveMissionEvent,
  replayPendingMissionEvents,
  runMissionGoal,
  wakeDueMissionGoals,
  wakeMissionGoalsForEvent,
} from "./mission-runtime.js";
import { createMissionEventEnvelope } from "./mission-events.js";

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

  it("wakes due event waits exactly once and leaves approval waits untouched", async () => {
    const due = await createMissionFixture({
      kind: "wait",
      reason: "event",
      wakeAt: "2020-01-01T00:00:00.000Z",
    });
    const approval = await createMissionFixture({
      kind: "wait",
      reason: "approval",
      wakeAt: "2020-01-01T00:00:00.000Z",
    });
    await runMissionGoal({
      goalId: due.goalId,
      userId: "test-user",
      trigger: "resume",
    });
    await runMissionGoal({
      goalId: approval.goalId,
      userId: "test-user",
      trigger: "resume",
    });

    expect(await wakeDueMissionGoals()).toBe(1);
    expect(await wakeDueMissionGoals()).toBe(0);

    const [dueGoal] = await db
      .select({ status: aiGoalsTable.status, nextAction: aiGoalsTable.nextAction })
      .from(aiGoalsTable)
      .where(eq(aiGoalsTable.id, due.goalId));
    const [approvalGoal] = await db
      .select({ status: aiGoalsTable.status, nextAction: aiGoalsTable.nextAction })
      .from(aiGoalsTable)
      .where(eq(aiGoalsTable.id, approval.goalId));
    expect(dueGoal).toMatchObject({
      status: "needs_replan",
      nextAction: {
        kind: "replan",
      },
    });
    expect(approvalGoal).toMatchObject({
      status: "waiting_for_approval",
      nextAction: {
        kind: "wait",
        reason: "approval",
      },
    });
  });

  it("wakes only the targeted event wait and converts it into a revision-bound replan", async () => {
    const waiting = await createMissionFixture({
      kind: "wait",
      reason: "event",
      wakeAt: null,
    });
    await runMissionGoal({
      goalId: waiting.goalId,
      userId: "test-user",
      trigger: "activation",
    });

    const event = createMissionEventEnvelope({
      eventId: randomUUID(),
      type: "WorkflowPhaseAccepted",
      projectId: waiting.projectId,
      goalId: waiting.goalId,
      workflowId: randomUUID(),
      correlationId: randomUUID(),
      payload: { phase: "validate" },
    });
    expect(await wakeMissionGoalsForEvent(event)).toBe(1);
    expect(await wakeMissionGoalsForEvent(event)).toBe(0);

    const [goal] = await db
      .select({ status: aiGoalsTable.status, nextAction: aiGoalsTable.nextAction })
      .from(aiGoalsTable)
      .where(eq(aiGoalsTable.id, waiting.goalId));
    const [mission] = await db
      .select({ status: aiMissionsTable.status })
      .from(aiMissionsTable)
      .where(eq(aiMissionsTable.id, waiting.missionId));
    expect(goal).toMatchObject({
      status: "needs_replan",
      nextAction: { kind: "replan" },
    });
    expect(mission?.status).toBe("needs_replan");
  });

  it("durably replays an event delivered before the Goal enters its wait state", async () => {
    const waiting = await createMissionFixture({
      kind: "wait",
      reason: "event",
      wakeAt: null,
    });
    const event = createMissionEventEnvelope({
      eventId: randomUUID(),
      type: "ExternalValidationCompleted",
      projectId: waiting.projectId,
      goalId: waiting.goalId,
      payload: { validationId: "validation-1" },
    });

    await expect(receiveMissionEvent(event)).resolves.toMatchObject({
      persisted: true,
      woken: false,
      duplicate: false,
    });
    await runMissionGoal({
      goalId: waiting.goalId,
      userId: "test-user",
      trigger: "activation",
    });
    expect(await replayPendingMissionEvents()).toBe(1);
    expect(await replayPendingMissionEvents()).toBe(0);

    const [goal] = await db
      .select({ status: aiGoalsTable.status, nextAction: aiGoalsTable.nextAction })
      .from(aiGoalsTable)
      .where(eq(aiGoalsTable.id, waiting.goalId));
    expect(goal).toMatchObject({
      status: "needs_replan",
      nextAction: { kind: "replan" },
    });
    await expect(receiveMissionEvent(event)).resolves.toMatchObject({
      persisted: true,
      duplicate: true,
    });
  });
});