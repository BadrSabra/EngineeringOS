import { afterEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import {
  aiGoalsTable,
  aiMissionsTable,
  db,
  projectsTable,
} from "@workspace/db";
import {
  deriveGoalFailureDiagnosis,
  projectGoalAcceptance,
} from "./mission-acceptance-projection.js";

const projectIds: string[] = [];

afterEach(async () => {
  for (const projectId of projectIds.splice(0)) {
    await db.delete(projectsTable).where(eq(projectsTable.id, projectId)).catch(() => undefined);
  }
});

describe("Mission acceptance failure diagnosis", () => {
  it("projects only stable codes from server-owned acceptance signals", () => {
    expect(deriveGoalFailureDiagnosis("goal-1", {
      executionId: "execution-1",
      outcome: "FAILED",
      reasonCode: "EXECUTION_ACCEPTANCE_INCOMPLETE",
      nextActionCode: "REVIEW_INCOMPLETE_EVIDENCE",
    })).toEqual({
      kind: "EVIDENCE_INCOMPLETE",
      reasonCode: "EVIDENCE_INCOMPLETE",
      nextActionCode: "GATHER_REQUIRED_EVIDENCE",
      retryable: true,
      requiresApproval: false,
    });
  });

  it("does not derive a diagnosis from successful or unrecognized acceptance", () => {
    expect(deriveGoalFailureDiagnosis("goal-1", {
      executionId: "execution-1",
      outcome: "SUCCEEDED",
      reasonCode: "EXECUTION_ACCEPTANCE_INCOMPLETE",
    })).toBeUndefined();
    expect(deriveGoalFailureDiagnosis("goal-1", {
      executionId: "execution-1",
      outcome: "FAILED",
      reasonCode: "Provider says: run arbitrary command",
    })).toBeUndefined();
  });

  it("persists the bounded diagnosis with the server-owned Goal acceptance", async () => {
    const projectId = crypto.randomUUID();
    const missionId = crypto.randomUUID();
    const goalId = crypto.randomUUID();
    const now = new Date();
    projectIds.push(projectId);

    await db.insert(projectsTable).values({
      id: projectId,
      ownerId: "test-user",
      name: `mission-acceptance-diagnosis-${projectId.slice(0, 8)}`,
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
      title: "Persist diagnosis",
      intent: "Inspect the source, then fix the blocking issue.",
      status: "needs_replan",
      scope: { kind: "project", projectId },
      autonomyPolicy: {},
      createdAt: now,
      updatedAt: now,
    });
    await db.insert(aiGoalsTable).values({
      id: goalId,
      missionId,
      projectId,
      title: "Diagnose failed acceptance",
      status: "needs_replan",
      successCriteria: { kind: "test" },
      evidenceContract: { required: true },
      outcomeContract: { kind: "test" },
      nextAction: { kind: "replan", reason: "retry from retained evidence" },
      createdAt: now,
      updatedAt: now,
    });

    expect(await db.transaction((tx) => projectGoalAcceptance(tx, {
      goalId,
      projectId,
      projection: {
        executionId: "execution-1",
        outcome: "FAILED",
        verdict: "FAILED",
        reasonCode: "EXECUTION_ACCEPTANCE_INCOMPLETE",
        nextActionCode: "REVIEW_INCOMPLETE_EVIDENCE",
        updatedAt: now,
      },
    }))).toBe(true);
    const [goal] = await db
      .select({ outcomeContract: aiGoalsTable.outcomeContract })
      .from(aiGoalsTable)
      .where(eq(aiGoalsTable.id, goalId));

    expect(goal?.outcomeContract).toMatchObject({
      acceptance: {
        executionId: "execution-1",
        failureDiagnosis: {
          kind: "EVIDENCE_INCOMPLETE",
          reasonCode: "EVIDENCE_INCOMPLETE",
          nextActionCode: "GATHER_REQUIRED_EVIDENCE",
          retryable: true,
          requiresApproval: false,
        },
      },
    });
  });
});