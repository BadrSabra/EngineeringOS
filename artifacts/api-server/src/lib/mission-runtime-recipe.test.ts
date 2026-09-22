import { afterEach, describe, expect, it, vi } from "vitest";
import { eq } from "drizzle-orm";
import {
  aiGoalsTable,
  aiMissionsTable,
  db,
  projectsTable,
} from "@workspace/db";

const { recipeRunner } = vi.hoisted(() => ({
  recipeRunner: vi.fn(),
}));

vi.mock("./recipe-operation-runner.js", () => ({
  runRecipeOperation: recipeRunner,
}));

import { runMissionGoal } from "./mission-runtime.js";

const projectIds: string[] = [];

afterEach(async () => {
  recipeRunner.mockReset();
  for (const projectId of projectIds.splice(0)) {
    await db.delete(projectsTable).where(eq(projectsTable.id, projectId)).catch(() => undefined);
  }
});

describe("Mission recipe dispatch", () => {
  it("binds a typed recipe action to the existing recipe runner and projects completion", async () => {
    recipeRunner.mockResolvedValue({
      executionId: "recipe-execution-1",
      status: "completed",
      completedNodeIds: ["verify"],
      receipt: {},
    });

    const projectId = crypto.randomUUID();
    const missionId = crypto.randomUUID();
    const goalId = crypto.randomUUID();
    const now = new Date();
    projectIds.push(projectId);
    await db.insert(projectsTable).values({
      id: projectId,
      ownerId: "test-user",
      name: `mission-recipe-${projectId.slice(0, 8)}`,
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
      title: "Verify candidate",
      intent: "Run the server-owned candidate verification recipe",
      status: "active",
      scope: { kind: "project", projectId },
      createdAt: now,
      updatedAt: now,
    });
    await db.insert(aiGoalsTable).values({
      id: goalId,
      missionId,
      projectId,
      title: "Candidate verification",
      status: "queued",
      nextAction: {
        kind: "recipe",
        recipeId: "candidate.verify",
        recipeVersion: 1,
        approvedPaths: ["lib/ai-orchestrator/src/index.ts"],
        candidateIdentity: null,
      },
      createdAt: now,
      updatedAt: now,
    });

    const result = await runMissionGoal({
      goalId,
      userId: "test-user",
      trigger: "resume",
    });
    expect(result).toMatchObject({
      status: "scheduled",
      goalId,
      reason: "recipe_dispatch_queued",
    });

    await vi.waitFor(async () => {
      expect(recipeRunner).toHaveBeenCalledOnce();
      const [goal] = await db
        .select({ status: aiGoalsTable.status })
        .from(aiGoalsTable)
        .where(eq(aiGoalsTable.id, goalId));
      const [mission] = await db
        .select({ status: aiMissionsTable.status })
        .from(aiMissionsTable)
        .where(eq(aiMissionsTable.id, missionId));
      expect(goal?.status).toBe("completed");
      expect(mission?.status).toBe("completed");
    });

    expect(recipeRunner).toHaveBeenCalledWith(expect.objectContaining({
      goalId,
      projectId,
      recipeId: "candidate.verify",
      recipeVersion: 1,
      sourceRevision: expect.stringMatching(/^[0-9a-f]{40}$/i),
      rootPath: process.cwd(),
    }));
  });
});