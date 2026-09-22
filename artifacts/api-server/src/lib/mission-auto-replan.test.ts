import { afterEach, describe, expect, it } from "vitest";
import { and, eq } from "drizzle-orm";
import {
  aiGoalsTable,
  aiMissionsTable,
  db,
  eventsTable,
  projectsTable,
} from "@workspace/db";
import { autoReplanMission } from "./mission-auto-replan.js";

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
      outcomeContract: {},
      nextAction: { kind: "replan", reason: "retry from current evidence" },
      createdAt: now,
      updatedAt: now,
    });

    const result = await autoReplanMission(missionId);

    expect(result.status).toBe("replanned");
    if (result.status !== "replanned") return;
    expect(result.plan.goals.length).toBeGreaterThan(1);
    expect(result.plan.revision).toContain(`auto:${failedGoalId}:`);
    expect(result.runs.some((run) => run.status === "scheduled" || run.status === "waiting")).toBe(true);

    const goals = await db
      .select({ id: aiGoalsTable.id, status: aiGoalsTable.status })
      .from(aiGoalsTable)
      .where(and(
        eq(aiGoalsTable.missionId, missionId),
        eq(aiGoalsTable.projectId, projectId),
      ));
    expect(goals.some((goal) => goal.id === failedGoalId && goal.status === "needs_replan")).toBe(true);
    expect(goals.length).toBeGreaterThan(2);

    const [mission] = await db
      .select({ status: aiMissionsTable.status })
      .from(aiMissionsTable)
      .where(eq(aiMissionsTable.id, missionId));
    expect(mission?.status).toBe("active");
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
});