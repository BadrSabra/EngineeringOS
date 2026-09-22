import { afterEach, describe, expect, it, vi } from "vitest";
import { createHash, randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import {
  aiExecutionsTable,
  aiChangeProposalsTable,
  aiChatMessagesTable,
  aiChatSessionsTable,
  aiGoalsTable,
  aiMissionsTable,
  db,
  projectsTable,
} from "@workspace/db";

const { recipeRunner, githubDeliveryRunner } = vi.hoisted(() => ({
  recipeRunner: vi.fn(),
  githubDeliveryRunner: vi.fn(),
}));

vi.mock("./recipe-operation-runner.js", () => ({
  runRecipeOperation: recipeRunner,
}));

vi.mock("./github-delivery-service.js", () => ({
  executeVerifiedGitHubDelivery: githubDeliveryRunner,
}));

import { dispatchPendingMissionRecipes, runMissionGoal } from "./mission-runtime.js";

const projectIds: string[] = [];

afterEach(async () => {
  recipeRunner.mockReset();
  githubDeliveryRunner.mockReset();
  for (const projectId of projectIds.splice(0)) {
    await db.delete(projectsTable).where(eq(projectsTable.id, projectId)).catch(() => undefined);
  }
});

describe("Mission recipe dispatch", () => {
  it("rebuilds the server-owned GitHub runner from a committed proposal", async () => {
    recipeRunner.mockImplementation(async (params: Record<string, unknown>) => {
      const runner = params.githubDeliveryRunner as ((args: Record<string, unknown>) => Promise<unknown>) | undefined;
      expect(runner).toBeTypeOf("function");
      await runner?.({
        rootPath: process.cwd(),
        projectId: params.projectId,
        operationId: params.operationId,
        message: "Ship the verified change",
      });
      return {
        executionId: "delivery-execution-1",
        status: "completed",
        completedNodeIds: ["push"],
        receipt: {
          contractVersion: 1,
          executionId: "delivery-execution-1",
          operationId: params.operationId,
          recipeId: "delivery.push.github",
          recipeVersion: 1,
          status: "completed",
          completedNodeIds: ["push"],
          nodes: [{
            nodeId: "push",
            status: "passed",
            attempts: 1,
            elapsedMs: 10,
            evidenceId: "github-evidence-1",
            excerpt: "GitHub delivery passed.",
          }],
          evidenceRefs: ["github-evidence-1"],
          createdAt: "2026-09-22T15:00:00.000Z",
          completedAt: "2026-09-22T15:00:00.010Z",
        },
      };
    });
    githubDeliveryRunner.mockResolvedValue({
      status: "passed",
      evidence: {
        evidenceId: "github:delivery-1",
        resultHash: "a".repeat(64),
        artifactRef: "github-delivery:delivery-1",
      },
    });

    const projectId = randomUUID();
    const missionId = randomUUID();
    const goalId = randomUUID();
    const sessionId = randomUUID();
    const messageId = randomUUID();
    const proposalId = randomUUID();
    const proposalOperationId = randomUUID();
    const now = new Date();
    projectIds.push(projectId);
    await db.insert(projectsTable).values({
      id: projectId,
      ownerId: "test-user",
      name: `mission-delivery-${projectId.slice(0, 8)}`,
      rootPath: process.cwd(),
      language: "typescript",
      status: "active",
      gitRemoteUrl: "https://github.com/example/project.git",
      gitDefaultBranch: "main",
      createdAt: now,
      updatedAt: now,
    });
    await db.insert(aiChatSessionsTable).values({
      id: sessionId,
      projectId,
      title: "Mission delivery fixture",
      createdAt: now,
      updatedAt: now,
    });
    await db.insert(aiChatMessagesTable).values({
      id: messageId,
      sessionId,
      role: "assistant",
      content: "Verified delivery",
      createdAt: now,
    });
    await db.insert(aiChangeProposalsTable).values({
      id: proposalId,
      projectId,
      sessionId,
      messageId,
      changes: "[]",
      appliedChanges: "[]",
      status: "applied",
      lifecycle: "committed",
      operationId: proposalOperationId,
      createdAt: now,
    });
    await db.insert(aiMissionsTable).values({
      id: missionId,
      projectId,
      userId: "test-user",
      title: "Mission delivery",
      intent: "Deliver the verified proposal",
      status: "active",
      scope: { kind: "project", projectId },
      createdAt: now,
      updatedAt: now,
    });
    await db.insert(aiGoalsTable).values({
      id: goalId,
      missionId,
      projectId,
      title: "Push verified proposal",
      status: "queued",
      outcomeContract: { deliveryRequired: true },
      nextAction: {
        kind: "recipe",
        recipeId: "delivery.push.github",
        recipeVersion: 1,
        approvedPaths: [],
        candidateIdentity: null,
        proposalId,
      },
      createdAt: now,
      updatedAt: now,
    });

    await expect(runMissionGoal({
      goalId,
      userId: "test-user",
      trigger: "activation",
    })).resolves.toMatchObject({
      status: "scheduled",
      goalId,
    });
    await vi.waitFor(() => expect(recipeRunner).toHaveBeenCalledOnce());
    expect(recipeRunner).toHaveBeenCalledWith(expect.objectContaining({
      operationId: proposalOperationId,
      recipeId: "delivery.push.github",
    }));
    expect(githubDeliveryRunner).toHaveBeenCalledWith(expect.objectContaining({
      projectId,
      proposalId,
      operationId: proposalOperationId,
      remoteUrl: "https://github.com/example/project.git",
      branch: "main",
    }));
  });

  it("blocks a Mission delivery when the committed proposal is absent", async () => {
    const projectId = randomUUID();
    const missionId = randomUUID();
    const goalId = randomUUID();
    const now = new Date();
    projectIds.push(projectId);
    await db.insert(projectsTable).values({
      id: projectId,
      ownerId: "test-user",
      name: `mission-delivery-blocked-${projectId.slice(0, 8)}`,
      rootPath: process.cwd(),
      language: "typescript",
      status: "active",
      gitRemoteUrl: "https://github.com/example/project.git",
      createdAt: now,
      updatedAt: now,
    });
    await db.insert(aiMissionsTable).values({
      id: missionId,
      projectId,
      userId: "test-user",
      title: "Blocked mission delivery",
      intent: "Deliver without a committed proposal",
      status: "active",
      scope: { kind: "project", projectId },
      createdAt: now,
      updatedAt: now,
    });
    await db.insert(aiGoalsTable).values({
      id: goalId,
      missionId,
      projectId,
      title: "Missing proposal",
      status: "queued",
      outcomeContract: { deliveryRequired: true },
      nextAction: {
        kind: "recipe",
        recipeId: "delivery.push.github",
        recipeVersion: 1,
        approvedPaths: [],
        candidateIdentity: null,
        proposalId: randomUUID(),
      },
      createdAt: now,
      updatedAt: now,
    });

    await expect(runMissionGoal({
      goalId,
      userId: "test-user",
      trigger: "activation",
    })).resolves.toMatchObject({
      status: "blocked",
      reason: "delivery_proposal_not_committed",
    });
    expect(recipeRunner).not.toHaveBeenCalled();
  });

  it("binds a typed recipe action to the existing recipe runner and projects completion", async () => {
    recipeRunner.mockResolvedValue({
      executionId: "recipe-execution-1",
      status: "completed",
      completedNodeIds: ["verify"],
      receipt: {
        contractVersion: 1,
        executionId: "recipe-execution-1",
        operationId: "mission-recipe-operation-1",
        recipeId: "candidate.verify",
        recipeVersion: 1,
        status: "completed",
        completedNodeIds: ["verify"],
        nodes: [{
          nodeId: "verify",
          status: "passed",
          attempts: 1,
          elapsedMs: 10,
          evidenceId: "evidence-1",
          excerpt: "Candidate verification passed.",
        }],
        evidenceRefs: ["evidence-1"],
        createdAt: "2026-09-22T15:00:00.000Z",
        completedAt: "2026-09-22T15:00:00.010Z",
      },
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
      outcomeContract: { deliveryRequired: true },
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
      .select({ status: aiGoalsTable.status, outcomeContract: aiGoalsTable.outcomeContract })
        .from(aiGoalsTable)
        .where(eq(aiGoalsTable.id, goalId));
      const [mission] = await db
        .select({ status: aiMissionsTable.status })
        .from(aiMissionsTable)
        .where(eq(aiMissionsTable.id, missionId));
      expect(goal?.status).toBe("completed");
      expect(goal?.outcomeContract).toMatchObject({
        acceptance: {
          verdict: "PROVEN",
          deliveryReceipt: {
            kind: "recipe",
            status: "completed",
          },
        },
      });
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

  it("reconstructs queued GitHub delivery after restart without duplicating execution", async () => {
    recipeRunner.mockImplementation(async (params: Record<string, unknown>) => {
      const runner = params.githubDeliveryRunner as ((args: Record<string, unknown>) => Promise<unknown>) | undefined;
      await runner?.({
        rootPath: process.cwd(),
        projectId: params.projectId,
        operationId: params.operationId,
        message: "Resume the verified delivery",
      });
      return {
        executionId: "delivery-execution-recovered",
        status: "completed",
        completedNodeIds: ["push"],
        receipt: {
          contractVersion: 1,
          executionId: "delivery-execution-recovered",
          operationId: params.operationId,
          recipeId: "delivery.push.github",
          recipeVersion: 1,
          status: "completed",
          completedNodeIds: ["push"],
          nodes: [{
            nodeId: "push",
            status: "passed",
            attempts: 1,
            elapsedMs: 10,
            evidenceId: "github-evidence-recovered",
            excerpt: "GitHub delivery recovered after restart.",
          }],
          evidenceRefs: ["github-evidence-recovered"],
          createdAt: "2026-09-22T15:00:00.000Z",
          completedAt: "2026-09-22T15:00:00.010Z",
        },
      };
    });
    githubDeliveryRunner.mockResolvedValue({
      status: "passed",
      evidence: {
        evidenceId: "github:delivery-recovered",
        resultHash: "b".repeat(64),
        artifactRef: "github-delivery:recovered",
      },
    });

    const projectId = randomUUID();
    const missionId = randomUUID();
    const goalId = randomUUID();
    const executionId = randomUUID();
    const sessionId = randomUUID();
    const messageId = randomUUID();
    const proposalId = randomUUID();
    const operationId = randomUUID();
    const now = new Date();
    const action = {
      kind: "recipe" as const,
      recipeId: "delivery.push.github",
      recipeVersion: 1,
      approvedPaths: [],
      candidateIdentity: null,
      proposalId,
    };
    const binding = {
      projectId,
      operationId,
      sourceRevision: "source-revision-delivery",
      candidateIdentity: null,
      candidateWorkspace: null,
      approvedPaths: [],
      phase: "queued" as const,
      leaseOwner: null,
      leaseUntil: null,
      missionBudget: {
        maxNodes: 24,
        maxParallelNodes: 1,
        maxTotalTimeoutMs: 120_000,
        maxProcessCount: 1,
        maxOutputBytes: 200_000,
      },
      concurrencyBudget: {
        maxInFlightNodes: 1,
        maxProcesses: 1,
      },
    };
    projectIds.push(projectId);
    await db.insert(projectsTable).values({
      id: projectId,
      ownerId: "test-user",
      name: `mission-delivery-recovery-${projectId.slice(0, 8)}`,
      rootPath: process.cwd(),
      language: "typescript",
      status: "active",
      gitRemoteUrl: "https://github.com/example/project.git",
      gitDefaultBranch: "main",
      createdAt: now,
      updatedAt: now,
    });
    await db.insert(aiChatSessionsTable).values({
      id: sessionId,
      projectId,
      title: "Mission delivery recovery fixture",
      createdAt: now,
      updatedAt: now,
    });
    await db.insert(aiChatMessagesTable).values({
      id: messageId,
      sessionId,
      role: "assistant",
      content: "Resume verified delivery",
      createdAt: now,
    });
    await db.insert(aiChangeProposalsTable).values({
      id: proposalId,
      projectId,
      sessionId,
      messageId,
      changes: "[]",
      appliedChanges: "[]",
      status: "applied",
      lifecycle: "committed",
      operationId,
      createdAt: now,
    });
    await db.insert(aiMissionsTable).values({
      id: missionId,
      projectId,
      userId: "test-user",
      title: "Recover Mission delivery",
      intent: "Resume verified GitHub delivery after restart",
      status: "active",
      scope: { kind: "project", projectId },
      createdAt: now,
      updatedAt: now,
    });
    await db.insert(aiGoalsTable).values({
      id: goalId,
      missionId,
      projectId,
      title: "Recovered GitHub delivery",
      status: "running",
      outcomeContract: { deliveryRequired: true },
      nextAction: action,
      createdAt: now,
      updatedAt: now,
    });
    await db.insert(aiExecutionsTable).values({
      id: executionId,
      projectId,
      goalId,
      userId: "test-user",
      operationId,
      idempotencyKey: `mission-delivery:${goalId}:${proposalId}:${operationId}`,
      resumeTokenHash: "delivery-restart-fixture",
      request: JSON.stringify({
        projectId,
        operationId,
        message: `recipe:${operationId}`,
        modelMessage: `recipe:${operationId}`,
        workspaceRevision: binding.sourceRevision,
      }),
      checkpoint: JSON.stringify({
        stage: "queued",
        sequence: 0,
        recipeBinding: binding,
        updatedAt: now.toISOString(),
      }),
      status: "queued",
      createdAt: now,
      updatedAt: now,
    });

    const [firstDispatch, secondDispatch] = await Promise.all([
      dispatchPendingMissionRecipes(),
      dispatchPendingMissionRecipes(),
    ]);
    expect(firstDispatch + secondDispatch).toBe(1);
    await vi.waitFor(async () => {
      expect(recipeRunner).toHaveBeenCalledOnce();
      const [goal] = await db
        .select({ status: aiGoalsTable.status })
        .from(aiGoalsTable)
        .where(eq(aiGoalsTable.id, goalId));
      expect(goal?.status).toBe("completed");
    });
    expect(recipeRunner).toHaveBeenCalledWith(expect.objectContaining({
      operationId,
      recipeId: "delivery.push.github",
    }));
    expect(githubDeliveryRunner).toHaveBeenCalledOnce();
    expect(githubDeliveryRunner).toHaveBeenCalledWith(expect.objectContaining({
      projectId,
      proposalId,
      operationId,
      remoteUrl: "https://github.com/example/project.git",
      branch: "main",
    }));

    const executions = await db
      .select({ id: aiExecutionsTable.id })
      .from(aiExecutionsTable)
      .where(eq(aiExecutionsTable.goalId, goalId));
    expect(executions).toHaveLength(1);
  });

  it("re-dispatches a queued Mission recipe after a process restart without duplicating its execution", async () => {
    recipeRunner.mockResolvedValue({
      executionId: "recipe-execution-recovered",
      status: "completed",
      completedNodeIds: ["verify"],
      receipt: {
        contractVersion: 1,
        executionId: "recipe-execution-recovered",
        operationId: "mission-recipe-operation-recovered",
        recipeId: "validation.recover",
        recipeVersion: 1,
        status: "completed",
        completedNodeIds: ["verify"],
        nodes: [{
          nodeId: "verify",
          status: "passed",
          attempts: 1,
          elapsedMs: 10,
          evidenceId: "evidence-recovered",
          excerpt: "Validation recovered after restart.",
        }],
        evidenceRefs: ["evidence-recovered"],
        createdAt: "2026-09-22T15:00:00.000Z",
        completedAt: "2026-09-22T15:00:00.010Z",
      },
    });

    const projectId = randomUUID();
    const missionId = randomUUID();
    const goalId = randomUUID();
    const executionId = randomUUID();
    const now = new Date();
    const action = {
      kind: "recipe" as const,
      recipeId: "validation.recover",
      recipeVersion: 1,
      approvedPaths: ["lib/ai-orchestrator/src/index.ts"],
      candidateIdentity: null,
    };
    const digest = createHash("sha256").update(JSON.stringify({
      goalId,
      recipeId: action.recipeId,
      recipeVersion: action.recipeVersion,
      approvedPaths: action.approvedPaths,
      candidateIdentity: null,
    })).digest("hex");
    const operationId = `mission-goal-${goalId}-${digest.slice(0, 16)}`;
    const binding = {
      projectId,
      operationId,
      sourceRevision: "source-revision-recovered",
      candidateIdentity: null,
      candidateWorkspace: null,
      approvedPaths: action.approvedPaths,
      phase: "queued" as const,
      leaseOwner: null,
      leaseUntil: null,
      missionBudget: {
        maxNodes: 24,
        maxParallelNodes: 1,
        maxTotalTimeoutMs: 120_000,
        maxProcessCount: 1,
        maxOutputBytes: 200_000,
      },
      concurrencyBudget: {
        maxInFlightNodes: 1,
        maxProcesses: 1,
      },
    };
    projectIds.push(projectId);
    await db.insert(projectsTable).values({
      id: projectId,
      ownerId: "test-user",
      name: `mission-recovery-${projectId.slice(0, 8)}`,
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
      title: "Recover validation",
      intent: "Resume the server-owned validation recipe",
      status: "active",
      scope: { kind: "project", projectId },
      createdAt: now,
      updatedAt: now,
    });
    await db.insert(aiGoalsTable).values({
      id: goalId,
      missionId,
      projectId,
      title: "Recovered validation",
      status: "running",
      outcomeContract: { deliveryRequired: false },
      nextAction: action,
      createdAt: now,
      updatedAt: now,
    });
    await db.insert(aiExecutionsTable).values({
      id: executionId,
      projectId,
      goalId,
      userId: "test-user",
      operationId,
      idempotencyKey: `mission-goal:${goalId}:${digest.slice(0, 32)}`,
      resumeTokenHash: "restart-fixture",
      request: JSON.stringify({
        projectId,
        operationId,
        message: `recipe:${operationId}`,
        modelMessage: `recipe:${operationId}`,
        workspaceRevision: binding.sourceRevision,
      }),
      checkpoint: JSON.stringify({
        stage: "queued",
        sequence: 0,
        recipeBinding: binding,
        updatedAt: now.toISOString(),
      }),
      status: "queued",
      createdAt: now,
      updatedAt: now,
    });

    expect(await dispatchPendingMissionRecipes()).toBe(1);
    await vi.waitFor(async () => {
      expect(recipeRunner).toHaveBeenCalledOnce();
      const [goal] = await db
        .select({ status: aiGoalsTable.status })
        .from(aiGoalsTable)
        .where(eq(aiGoalsTable.id, goalId));
      expect(goal?.status).toBe("completed");
    });

    const executions = await db
      .select({ id: aiExecutionsTable.id })
      .from(aiExecutionsTable)
      .where(eq(aiExecutionsTable.goalId, goalId));
    expect(executions).toHaveLength(1);
  });
});