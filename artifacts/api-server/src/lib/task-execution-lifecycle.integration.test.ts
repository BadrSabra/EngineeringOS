import { afterEach, describe, expect, it, vi } from "vitest";
import { eq } from "drizzle-orm";
import { randomUUID } from "node:crypto";
import {
  aiExecutionAcceptancesTable,
  aiAgentEpisodesTable,
  aiExecutionsTable,
  aiGoalsTable,
  aiMissionsTable,
  db,
  projectsTable,
  tasksTable,
} from "@workspace/db";

const runAgentWithFallback = vi.hoisted(() => vi.fn(async () => ({
  result: {
    summary: "Fixture execution completed.",
    confidence: "high",
    needsHumanReview: false,
    steps: ["Server-owned fixture output accepted."],
  },
  effectiveProvider: "groq" as const,
})));

vi.mock("./ai-route-helpers.js", async () => {
  const actual = await vi.importActual<typeof import("./ai-route-helpers.js")>("./ai-route-helpers.js");
  return {
    ...actual,
    runAgentWithFallback,
  };
});

vi.mock("@workspace/ai-orchestrator", async () => {
  const actual = await vi.importActual<typeof import("@workspace/ai-orchestrator")>("@workspace/ai-orchestrator");
  return {
    ...actual,
    buildProjectContext: vi.fn(async () => ({ fixture: true })),
    invalidateContextCache: vi.fn(),
  };
});

vi.mock("./task-progress.js", () => ({
  createTaskProgressEmitter: vi.fn(() => ({
    start: vi.fn(async () => undefined),
    finish: vi.fn(async () => undefined),
    terminal: vi.fn(async () => undefined),
  })),
}));

import { executeTaskLifecycle } from "./task-execution-service.js";

async function waitForEpisode(executionId: string) {
  for (let attempt = 0; attempt < 20; attempt += 1) {
    const [episode] = await db
      .select({
        missionId: aiAgentEpisodesTable.missionId,
        goalId: aiAgentEpisodesTable.goalId,
        planRevision: aiAgentEpisodesTable.planRevision,
        scope: aiAgentEpisodesTable.scope,
      })
      .from(aiAgentEpisodesTable)
      .where(eq(aiAgentEpisodesTable.executionId, executionId))
      .limit(1);
    if (episode) return episode;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error(`Episode was not materialized for execution ${executionId}`);
}

describe("real durable task execution lifecycle", () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  it("persists execution, checkpoint, task completion, and terminal acceptance", async () => {
    const projectId = randomUUID();
    const taskId = randomUUID();
    const now = new Date();

    await db.insert(projectsTable).values({
      id: projectId,
      ownerId: "lifecycle-test-user",
      name: `lifecycle-${projectId.slice(0, 8)}`,
      rootPath: `/tmp/lifecycle-${projectId}`,
      language: "typescript",
      status: "active",
      createdAt: now,
      updatedAt: now,
    });
    await db.insert(tasksTable).values({
      id: taskId,
      projectId,
      title: "Durable lifecycle fixture",
      prompt: "Complete the deterministic fixture task",
      status: "verifying",
      retryCount: 0,
      maxRetries: 2,
      createdAt: now,
      updatedAt: now,
    });

    try {
      const outcome = await executeTaskLifecycle({
        taskId,
        userId: "lifecycle-test-user",
        provider: { provider: "groq", apiKey: "fixture-provider" },
        trigger: "reconciliation",
        expectedStatuses: ["verifying"],
        workspaceRevision: now.toISOString(),
      });

      expect(outcome.ok).toBe(true);
      expect(outcome.status).toBe("completed");
      expect(outcome.executionId).toEqual(expect.any(String));
      expect(runAgentWithFallback).toHaveBeenCalledTimes(1);

      const [task] = await db
        .select({ status: tasksTable.status, workerId: tasksTable.workerId })
        .from(tasksTable)
        .where(eq(tasksTable.id, taskId));
      expect(task).toEqual({ status: "completed", workerId: null });

      const [execution] = await db
        .select({
          status: aiExecutionsTable.status,
          finalMessageId: aiExecutionsTable.finalMessageId,
          workerId: aiExecutionsTable.workerId,
        })
        .from(aiExecutionsTable)
        .where(eq(aiExecutionsTable.id, outcome.executionId!));
      expect(execution).toMatchObject({
        status: "completed",
        workerId: null,
      });

      const [acceptance] = await db
        .select({
          outcome: aiExecutionAcceptancesTable.outcome,
          terminalStatus: aiExecutionAcceptancesTable.terminalStatus,
          nextActionCode: aiExecutionAcceptancesTable.nextActionCode,
          resumable: aiExecutionAcceptancesTable.resumable,
        })
        .from(aiExecutionAcceptancesTable)
        .where(eq(aiExecutionAcceptancesTable.executionId, outcome.executionId!));
      expect(acceptance).toEqual({
        outcome: "SUCCEEDED",
        terminalStatus: "completed",
        nextActionCode: "NONE",
        resumable: 0,
      });
    } finally {
      await db.delete(aiExecutionAcceptancesTable).where(
        eq(aiExecutionAcceptancesTable.projectId, projectId),
      );
      await db.delete(aiExecutionsTable).where(eq(aiExecutionsTable.projectId, projectId));
      await db.delete(tasksTable).where(eq(tasksTable.id, taskId));
      await db.delete(projectsTable).where(eq(projectsTable.id, projectId));
    }
  });

  it("does not complete a delivery Goal or Mission without a server-owned receipt", async () => {
    const projectId = randomUUID();
    const missionId = randomUUID();
    const goalId = randomUUID();
    const taskId = randomUUID();
    const now = new Date();

    await db.insert(projectsTable).values({
      id: projectId,
      ownerId: "delivery-gate-test-user",
      name: `delivery-gate-${projectId.slice(0, 8)}`,
      rootPath: `/tmp/delivery-gate-${projectId}`,
      language: "typescript",
      status: "active",
      createdAt: now,
      updatedAt: now,
    });
    await db.insert(aiMissionsTable).values({
      id: missionId,
      projectId,
      userId: "delivery-gate-test-user",
      title: "Delivery gate fixture",
      intent: "Deliver the verified result",
      status: "active",
      scope: { kind: "project", projectId },
      autonomyPolicy: {},
      budget: {},
      createdAt: now,
      updatedAt: now,
    });
    await db.insert(aiGoalsTable).values({
      id: goalId,
      missionId,
      projectId,
      title: "Deliver the verified result",
      description: "A delivery goal requiring a server-owned receipt.",
      status: "running",
      priority: "p1",
      successCriteria: {},
      evidenceContract: {},
      outcomeContract: {
        deliveryRequired: true,
        planRevision: { hash: "mission-plan-episode-1" },
      },
      nextAction: { kind: "task", taskId },
      createdAt: now,
      updatedAt: now,
    });
    await db.insert(tasksTable).values({
      id: taskId,
      projectId,
      goalId,
      title: "Delivery gate task",
      prompt: "Complete the deterministic delivery fixture task",
      status: "verifying",
      retryCount: 0,
      maxRetries: 2,
      createdAt: now,
      updatedAt: now,
    });

    try {
      const outcome = await executeTaskLifecycle({
        taskId,
        userId: "delivery-gate-test-user",
        provider: { provider: "groq", apiKey: "fixture-provider" },
        trigger: "reconciliation",
        expectedStatuses: ["verifying"],
        workspaceRevision: now.toISOString(),
      });

      expect(outcome.ok).toBe(true);
      const episode = await waitForEpisode(outcome.executionId!);
      expect(episode).toMatchObject({
        missionId,
        goalId,
        planRevision: "mission-plan-episode-1",
        scope: {
          kind: "mission-task",
          taskId,
          missionId,
          goalId,
        },
      });
      const [goal] = await db
        .select({ status: aiGoalsTable.status, outcomeContract: aiGoalsTable.outcomeContract })
        .from(aiGoalsTable)
        .where(eq(aiGoalsTable.id, goalId));
      const [mission] = await db
        .select({ status: aiMissionsTable.status })
        .from(aiMissionsTable)
        .where(eq(aiMissionsTable.id, missionId));
      expect(goal).toMatchObject({
        status: "verifying",
        outcomeContract: {
          deliveryRequired: true,
          acceptance: {
            verdict: "INCOMPLETE",
          },
        },
      });
      const acceptance = (goal?.outcomeContract as Record<string, unknown>).acceptance as Record<string, unknown>;
      expect(acceptance.deliveryReceipt).toBeUndefined();
      expect(mission?.status).toBe("waiting");
    } finally {
      await db.delete(aiExecutionAcceptancesTable).where(
        eq(aiExecutionAcceptancesTable.projectId, projectId),
      );
      await db.delete(aiExecutionsTable).where(eq(aiExecutionsTable.projectId, projectId));
      await db.delete(tasksTable).where(eq(tasksTable.id, taskId));
      await db.delete(aiGoalsTable).where(eq(aiGoalsTable.id, goalId));
      await db.delete(aiMissionsTable).where(eq(aiMissionsTable.id, missionId));
      await db.delete(projectsTable).where(eq(projectsTable.id, projectId));
    }
  });
});