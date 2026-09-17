import { afterEach, describe, expect, it, vi } from "vitest";
import { eq } from "drizzle-orm";
import { randomUUID } from "node:crypto";
import {
  aiExecutionAcceptancesTable,
  aiExecutionsTable,
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
});