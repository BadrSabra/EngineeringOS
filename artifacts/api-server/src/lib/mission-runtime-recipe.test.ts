import { afterEach, describe, expect, it, vi } from "vitest";
import { execFile } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import { and, eq } from "drizzle-orm";
import request from "supertest";
import app from "../app.js";
import { seedCanonicalMissionGoalCompletion } from "../__tests__/mission-dependency-proof-fixture.js";
import {
  aiExecutionAcceptancesTable,
  aiExecutionEvidenceSnapshotsTable,
  aiExecutionsTable,
  aiGoalDependenciesTable,
  aiChangeProposalsTable,
  aiChatMessagesTable,
  aiChatSessionsTable,
  aiGoalsTable,
  aiMissionHandoffsTable,
  aiMissionsTable,
  db,
  projectsTable,
} from "@workspace/db";
import { buildExecutionProofProjection } from "./execution-proof.js";
import { dispatchMissionChatHandoff } from "./mission-chat-handoffs.js";

const { recipeRunner, githubDeliveryRunner } = vi.hoisted(() => ({
  recipeRunner: vi.fn(),
  githubDeliveryRunner: vi.fn(),
}));
const { scheduleTaskExecution } = vi.hoisted(() => ({
  scheduleTaskExecution: vi.fn(),
}));

vi.mock("./recipe-operation-runner.js", () => ({
  runRecipeOperation: recipeRunner,
  createRuntimeStartRunner: vi.fn(() => async () => ({
    status: "passed",
    evidence: { evidenceId: "runtime-test-evidence" },
  })),
}));

vi.mock("./github-delivery-service.js", () => ({
  executeVerifiedGitHubDelivery: githubDeliveryRunner,
}));

vi.mock("../routes/ai/tasks.js", async () => {
  const actual = await vi.importActual<typeof import("../routes/ai/tasks.js")>("../routes/ai/tasks.js");
  return {
    ...actual,
    scheduleAiTaskExecution: scheduleTaskExecution,
  };
});

import { dispatchPendingMissionRecipes, runMissionGoal } from "./mission-runtime.js";

const projectIds: string[] = [];
const testRoots: string[] = [];
const execFileAsync = promisify(execFile);

async function createTestRoot(label: string): Promise<string> {
  const rootPath = await mkdtemp(path.join(process.cwd(), `.engineeringos-delivery-test-${label}-`));
  await execFileAsync("git", ["-C", rootPath, "init", "-q"]);
  await execFileAsync("git", ["-C", rootPath, "config", "user.name", "EngineeringOS Fixture"]);
  await execFileAsync("git", ["-C", rootPath, "config", "user.email", "fixture@example.com"]);
  await execFileAsync("git", ["-C", rootPath, "commit", "--allow-empty", "-qm", "fixture"]);
  testRoots.push(rootPath);
  return rootPath;
}

async function seedSuccessfulRecipeProof(
  params: Record<string, unknown>,
  preferredExecutionId: string,
): Promise<string> {
  const projectId = String(params.projectId);
  const goalId = String(params.goalId);
  const operationId = String(params.operationId);
  const sourceRevision = typeof params.sourceRevision === "string"
    ? params.sourceRevision
    : "recipe-test-source-revision";
  const workspaceRoot = typeof params.rootPath === "string" ? params.rootPath : null;
  const candidateIdentity = typeof params.candidateIdentity === "string"
    ? params.candidateIdentity
    : null;
  const recipeId = typeof params.recipeId === "string" ? params.recipeId : "delivery.push.github";
  const recipeVersion = typeof params.recipeVersion === "number" ? params.recipeVersion : 1;
  const now = new Date();
  const [execution] = await db
    .select({ id: aiExecutionsTable.id, attempt: aiExecutionsTable.attempt })
    .from(aiExecutionsTable)
    .where(and(
      eq(aiExecutionsTable.goalId, goalId),
      eq(aiExecutionsTable.operationId, operationId),
    ))
    .limit(1);
  const executionId = execution?.id ?? preferredExecutionId;
  const recipeReceipt = {
    contractVersion: 1,
    executionId,
    attempt: execution?.attempt ?? 0,
    operationId,
    sourceRevision,
    candidateTreeHash: "a".repeat(64),
    treeHash: "b".repeat(64),
    recipeId,
    recipeVersion,
    status: "completed",
    completedNodeIds: ["push"],
    nodes: [{
      nodeId: "push",
      status: "passed",
      attempts: 1,
      elapsedMs: 10,
      evidenceId: "recipe-proof-evidence",
      excerpt: "Server-owned delivery receipt.",
    }],
    evidenceRefs: ["recipe-proof-evidence"],
    createdAt: now.toISOString(),
    completedAt: now.toISOString(),
  };
  if (execution) {
    await db.update(aiExecutionsTable)
      .set({
        status: "completed",
        recipeReceipt,
        request: JSON.stringify({
          projectId,
          operationId,
          message: "recipe proof fixture",
          modelMessage: "recipe proof fixture",
          workspaceRevision: sourceRevision,
          workspaceRoot,
          proofRequired: true,
          proofEvidenceMode: "artifact_only",
        }),
        workspaceRoot,
        baseRevision: sourceRevision,
        completedAt: now,
        updatedAt: now,
      })
      .where(eq(aiExecutionsTable.id, executionId));
  } else {
    await db.insert(aiExecutionsTable).values({
      id: executionId,
      projectId,
      goalId,
      userId: "test-user",
      operationId,
      idempotencyKey: typeof params.idempotencyKey === "string"
        ? params.idempotencyKey
        : `recipe-proof:${executionId}`,
      resumeTokenHash: `recipe-proof-token:${executionId}`,
      request: JSON.stringify({
        projectId,
        operationId,
        message: "recipe proof fixture",
        modelMessage: "recipe proof fixture",
        workspaceRevision: sourceRevision,
        workspaceRoot,
        proofRequired: true,
        proofEvidenceMode: "artifact_only",
      }),
      workspaceRoot,
      checkpoint: "{}",
      status: "completed",
      recipeReceipt,
      baseRevision: sourceRevision,
      createdAt: now,
      updatedAt: now,
      completedAt: now,
    });
  }

  const [acceptance] = await db
    .select({ id: aiExecutionAcceptancesTable.id })
    .from(aiExecutionAcceptancesTable)
    .where(eq(aiExecutionAcceptancesTable.executionId, executionId))
    .limit(1);
  if (acceptance) return executionId;

  const evidenceSnapshotId = `recipe-evidence:${executionId}`;
  const artifactRefs = [{
    kind: "recipe_evidence",
    recipeId,
    recipeVersion,
    nodeId: "push",
    evidenceId: "recipe-proof-evidence",
    artifactRef: "recipe-proof-artifact",
    executionId,
    operationId,
    workspaceRevision: sourceRevision,
    candidateHash: candidateIdentity ?? "fixture-candidate-hash",
  }];
  await db.insert(aiExecutionEvidenceSnapshotsTable).values({
    id: evidenceSnapshotId,
    executionId,
    projectId,
    attempt: execution?.attempt ?? 0,
    operationId,
    sourceRevision,
    candidateIdentity,
    verdict: "PROVEN",
    complete: 1,
    readCount: 0,
    totalBytes: 0,
    artifactRefs,
    createdAt: now,
  });
  const proof = buildExecutionProofProjection({
    outcome: "SUCCEEDED",
    evidenceRequired: true,
    evidenceComplete: true,
    evidenceSnapshotId,
    sourceRevision,
    candidateIdentity,
  });
  const attempt = execution?.attempt ?? 0;
  await db.insert(aiExecutionAcceptancesTable).values({
    id: `recipe-acceptance:${executionId}`,
    executionId,
    projectId,
    attempt,
    finalizationKey: `recipe-proof-finalization:${executionId}`,
    operationId,
    workerId: "recipe-proof-worker",
    terminalStatus: "completed",
    outcome: "SUCCEEDED",
    reasonCode: "CANONICAL_PROOF_PROVEN",
    nextActionCode: "none",
    disposition: { proof },
    evidenceSnapshotId,
    evidenceRequired: 1,
    evidenceComplete: 1,
    resumable: 0,
    messageId: null,
    sourceRevision,
    candidateIdentity,
    createdAt: now,
  });
  return executionId;
}

afterEach(async () => {
  recipeRunner.mockReset();
  githubDeliveryRunner.mockReset();
  scheduleTaskExecution.mockReset();
  for (const projectId of projectIds.splice(0)) {
    await db.delete(projectsTable).where(eq(projectsTable.id, projectId)).catch(() => undefined);
  }
  for (const rootPath of testRoots.splice(0)) {
    await rm(rootPath, { recursive: true, force: true });
  }
});

describe("Mission recipe dispatch", () => {
  it("completes one Chat-to-Mission delivery loop with server-owned identity and receipt", async () => {
    const rootPath = await createTestRoot("unified");
    const projectId = randomUUID();
    const sessionId = randomUUID();
    const messageId = randomUUID();
    const proposalMessageId = randomUUID();
    const proposalId = randomUUID();
    const operationId = randomUUID();
    const now = new Date();
    projectIds.push(projectId);

    await db.insert(projectsTable).values({
      id: projectId,
      ownerId: "test-user",
      name: `mission-unified-${projectId.slice(0, 8)}`,
      rootPath,
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
      title: "Unified Mission fixture",
      createdAt: now,
      updatedAt: now,
    });
    await db.insert(aiChatMessagesTable).values([
      {
        id: messageId,
        sessionId,
        role: "user",
        content: "Inspect the repository, then implement and validate the approved fix.",
        createdAt: now,
      },
      {
        id: proposalMessageId,
        sessionId,
        role: "assistant",
        content: "The approved fix is committed and ready for delivery.",
        createdAt: now,
      },
    ]);

    recipeRunner.mockImplementation(async (params: Record<string, unknown>) => {
      await seedSuccessfulRecipeProof(params, "unified-delivery-execution");
      const runner = params.githubDeliveryRunner as
        ((args: Record<string, unknown>) => Promise<unknown>) | undefined;
      await runner?.({
        rootPath,
        projectId: params.projectId,
        operationId: params.operationId,
        message: "Deliver the verified Mission result",
      });
      return {
        executionId: "unified-delivery-execution",
        status: "completed",
        completedNodeIds: ["push"],
        receipt: {
          contractVersion: 1,
          executionId: "unified-delivery-execution",
          attempt: 0,
          operationId: params.operationId,
          sourceRevision: params.sourceRevision,
          candidateTreeHash: "a".repeat(64),
          treeHash: "b".repeat(64),
          recipeId: "delivery.push.github",
          recipeVersion: 1,
          status: "completed",
          completedNodeIds: ["push"],
          nodes: [{
            nodeId: "push",
            status: "passed",
            attempts: 1,
            elapsedMs: 10,
            evidenceId: "unified-delivery-evidence",
            excerpt: "Server-owned delivery receipt.",
          }],
          evidenceRefs: ["unified-delivery-evidence"],
          createdAt: "2026-09-23T10:00:00.000Z",
          completedAt: "2026-09-23T10:00:00.010Z",
        },
      };
    });
    githubDeliveryRunner.mockResolvedValue({
      status: "passed",
      evidence: {
        evidenceId: "github:unified-delivery",
        resultHash: "c".repeat(64),
        artifactRef: "github-delivery:unified",
      },
    });

    const message = "Inspect the repository, then implement and validate the approved fix.";
    const preview = await request(app)
      .post("/api/ai/missions/plan-preview")
      .send({ projectId, message });
    expect(preview.status).toBe(200);
    expect(preview.body.admission).toBe("mission");
    expect(preview.body.plan.steps.map((step: { id: string }) => step.id))
      .toEqual(["inspect", "execute", "validate", "deliver"]);

    const handoff = await request(app)
      .post("/api/ai/missions/from-chat")
      .send({
        projectId,
        idempotencyKey: randomUUID(),
        message,
        sessionId,
        messageId,
        expectedPlanHash: preview.body.plan.planHash,
      });
    expect(handoff.status).toBe(201);
    expect(handoff.body.preview.plan.planHash).toBe(preview.body.plan.planHash);
    expect(handoff.body.mission.status).toBe("active");
    const [persistedHandoffMission] = await db
      .select({ autonomyPolicy: aiMissionsTable.autonomyPolicy })
      .from(aiMissionsTable)
      .where(eq(aiMissionsTable.id, handoff.body.mission.id));
    expect(persistedHandoffMission?.autonomyPolicy.activePlanRevision)
      .toBe(preview.body.plan.planHash);
    expect(scheduleTaskExecution).toHaveBeenCalledOnce();

    const missionId = handoff.body.mission.id as string;
    const materializedGoals = await db
      .select()
      .from(aiGoalsTable)
      .where(eq(aiGoalsTable.missionId, missionId));
    const finalGoal = materializedGoals.find((goal) => (
      (goal.successCriteria as { stepId?: unknown }).stepId === "deliver"
    ));
    const validationGoal = materializedGoals.find((goal) => (
      (goal.successCriteria as { stepId?: unknown }).stepId === "validate"
    ));
    expect(finalGoal).toBeDefined();
    expect(validationGoal).toBeDefined();
    if (!finalGoal || !validationGoal) return;

    await db.insert(aiChangeProposalsTable).values({
      id: proposalId,
      projectId,
      sessionId,
      messageId: proposalMessageId,
      changes: "[]",
      appliedChanges: "[]",
      status: "applied",
      lifecycle: "committed",
      operationId,
      baseRevision: "recipe-source-revision",
      candidateTreeHash: "a".repeat(64),
      promotedTreeHash: "b".repeat(64),
      committedTreeHash: "b".repeat(64),
      createdAt: now,
    });

    const stepOrder = new Map<string, number>(
      preview.body.plan.steps.map((step: { id: string }, index: number) => [step.id, index] as const),
    );
    const prerequisiteGoals = materializedGoals
      .filter((goal) => goal.id !== finalGoal.id)
      .sort((left, right) => {
        const leftStepId = (left.successCriteria as { stepId?: string }).stepId ?? "";
        const rightStepId = (right.successCriteria as { stepId?: string }).stepId ?? "";
        return (stepOrder.get(leftStepId) ?? Number.MAX_SAFE_INTEGER)
          - (stepOrder.get(rightStepId) ?? Number.MAX_SAFE_INTEGER);
      });
    const proofBaseTime = new Date(Date.now() - 10 * 60_000);
    for (const [sequence, predecessor] of prerequisiteGoals.entries()) {
      await seedCanonicalMissionGoalCompletion({
        projectId,
        missionId,
        goalId: predecessor.id,
        planRevision: preview.body.plan.planHash,
        sequence,
        baseTime: proofBaseTime,
      });
    }
    await db.update(aiGoalsTable)
      .set({
        nextAction: {
          kind: "recipe",
          recipeId: "delivery.push.github",
          recipeVersion: 1,
          approvedPaths: [],
          candidateIdentity: null,
        },
        outcomeContract: {
          ...finalGoal.outcomeContract,
          deliveryRequired: true,
        },
        updatedAt: now,
      })
      .where(eq(aiGoalsTable.id, finalGoal.id));

    const bound = await request(app)
      .post(`/api/ai/goals/${finalGoal.id}/delivery`)
      .send({ proposalId });
    expect(bound.status).toBe(202);
    expect(bound.body).toMatchObject({
      proposalId,
      operationId,
      run: {
        status: "scheduled",
        goalId: finalGoal.id,
      },
    });
    expect(bound.body.goal.nextAction).toMatchObject({
      kind: "recipe",
      recipeId: "delivery.push.github",
      proposalId,
    });

    await vi.waitFor(async () => {
      const [goal] = await db
        .select({ status: aiGoalsTable.status, outcomeContract: aiGoalsTable.outcomeContract })
        .from(aiGoalsTable)
        .where(eq(aiGoalsTable.id, finalGoal.id));
      const [mission] = await db
        .select({ status: aiMissionsTable.status })
        .from(aiMissionsTable)
        .where(eq(aiMissionsTable.id, missionId));
      expect(goal?.status).toBe("completed");
      expect(mission?.status).toBe("completed");
      expect((goal?.outcomeContract as { planRevision?: { hash?: string } }).planRevision?.hash)
        .toBe(preview.body.plan.planHash);
      expect(goal?.outcomeContract).toMatchObject({
        deliveryRequired: true,
        acceptance: {
          executionId: "unified-delivery-execution",
          outcome: "SUCCEEDED",
          verdict: "PROVEN",
          acceptedRefs: ["unified-delivery-execution"],
          receipt: {
            kind: "recipe",
            executionId: "unified-delivery-execution",
            status: "completed",
          },
          deliveryReceipt: {
            kind: "recipe",
            status: "completed",
          },
        },
      });
    });

    expect(recipeRunner).toHaveBeenCalledOnce();
    expect(recipeRunner).toHaveBeenCalledWith(expect.objectContaining({
      projectId,
      goalId: finalGoal.id,
      operationId,
      recipeId: "delivery.push.github",
      sourceRevision: expect.stringMatching(/^[0-9a-f]{40}$/i),
      rootPath,
    }));
    expect(githubDeliveryRunner).toHaveBeenCalledWith(expect.objectContaining({
      projectId,
      proposalId,
      operationId,
      remoteUrl: "https://github.com/example/project.git",
      branch: "main",
    }));

    const [persistedMission] = await db
      .select({ status: aiMissionsTable.status, completedAt: aiMissionsTable.completedAt })
      .from(aiMissionsTable)
      .where(eq(aiMissionsTable.id, missionId));
    expect(persistedMission?.status).toBe("completed");
    expect(persistedMission?.completedAt).toBeInstanceOf(Date);
    expect(recipeRunner).toHaveBeenCalledOnce();
  });

  it("rebuilds the server-owned GitHub runner from a committed proposal", async () => {
    const rootPath = await createTestRoot("delivery");
    const deliveryExecutionId = randomUUID();
    recipeRunner.mockImplementation(async (params: Record<string, unknown>) => {
      await seedSuccessfulRecipeProof(params, deliveryExecutionId);
      const runner = params.githubDeliveryRunner as ((args: Record<string, unknown>) => Promise<unknown>) | undefined;
      expect(runner).toBeTypeOf("function");
      await runner?.({
        rootPath,
        projectId: params.projectId,
        operationId: params.operationId,
        message: "Ship the verified change",
      });
      return {
        executionId: deliveryExecutionId,
        status: "completed",
        completedNodeIds: ["push"],
        receipt: {
          contractVersion: 1,
          executionId: deliveryExecutionId,
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
      rootPath,
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
      baseRevision: "recipe-source-revision",
      candidateTreeHash: "a".repeat(64),
      promotedTreeHash: "b".repeat(64),
      committedTreeHash: "b".repeat(64),
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
    await vi.waitFor(() => expect(githubDeliveryRunner).toHaveBeenCalledOnce());
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
    await vi.waitFor(async () => {
      const [goal] = await db.select({ status: aiGoalsTable.status })
        .from(aiGoalsTable)
        .where(eq(aiGoalsTable.id, goalId));
      expect(goal?.status).toBe("completed");
    });
  });

  it("blocks a Mission delivery when the committed proposal is absent", async () => {
    const rootPath = await createTestRoot("delivery-blocked");
    const projectId = randomUUID();
    const missionId = randomUUID();
    const goalId = randomUUID();
    const now = new Date();
    projectIds.push(projectId);
    await db.insert(projectsTable).values({
      id: projectId,
      ownerId: "test-user",
      name: `mission-delivery-blocked-${projectId.slice(0, 8)}`,
      rootPath,
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
    const rootPath = await createTestRoot("recipe");
    recipeRunner.mockImplementation(async (params: Record<string, unknown>) => {
      await seedSuccessfulRecipeProof(params, "recipe-execution-1");
      return {
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
      };
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
      rootPath,
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
      rootPath,
    }));
  });

  it("reconstructs queued GitHub delivery after restart without duplicating execution", async () => {
    const rootPath = await createTestRoot("delivery-recovery");
    recipeRunner.mockImplementation(async (params: Record<string, unknown>) => {
      const runner = params.githubDeliveryRunner as ((args: Record<string, unknown>) => Promise<unknown>) | undefined;
      await runner?.({
        rootPath,
        projectId: params.projectId,
        operationId: params.operationId,
        message: "Resume the verified delivery",
      });
      const executionId = await seedSuccessfulRecipeProof(params, "delivery-execution-recovered");
      return {
        executionId,
        status: "completed",
        completedNodeIds: ["push"],
        receipt: {
          contractVersion: 1,
          executionId,
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
      rootPath,
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
      baseRevision: "recipe-source-revision",
      candidateTreeHash: "a".repeat(64),
      promotedTreeHash: "b".repeat(64),
      committedTreeHash: "b".repeat(64),
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
    const rootPath = await createTestRoot("recipe-recovery");
    recipeRunner.mockImplementation(async (params: Record<string, unknown>) => {
      const executionId = await seedSuccessfulRecipeProof(params, "recipe-execution-recovered");
      return {
      executionId,
      status: "completed",
      completedNodeIds: ["verify"],
      receipt: {
        contractVersion: 1,
          executionId,
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
      };
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
      rootPath,
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

  it.each([
    {
      stateName: "operator-blocked Mission",
      missionStatus: "blocked" as const,
      goalStatus: "queued" as const,
    },
    {
      stateName: "failed Mission",
      missionStatus: "failed" as const,
      goalStatus: "queued" as const,
    },
    {
      stateName: "draft Mission",
      missionStatus: "draft" as const,
      goalStatus: "queued" as const,
    },
    {
      stateName: "Mission awaiting replan",
      missionStatus: "needs_replan" as const,
      goalStatus: "queued" as const,
    },
    {
      stateName: "failed Goal",
      missionStatus: "active" as const,
      goalStatus: "failed" as const,
    },
    {
      stateName: "Goal awaiting replan",
      missionStatus: "active" as const,
      goalStatus: "needs_replan" as const,
    },
    {
      stateName: "Goal missing its active plan revision",
      missionStatus: "active" as const,
      goalStatus: "queued" as const,
      activePlanRevision: "active-plan-v2",
    },
    {
      stateName: "Goal carrying a stale plan revision",
      missionStatus: "active" as const,
      goalStatus: "queued" as const,
      activePlanRevision: "active-plan-v2",
      goalPlanRevision: "old-plan-v1",
    },
    {
      stateName: "pending dependency",
      missionStatus: "active" as const,
      goalStatus: "queued" as const,
      dependencyStatus: "queued" as const,
    },
    {
      stateName: "failed dependency",
      missionStatus: "active" as const,
      goalStatus: "queued" as const,
      dependencyStatus: "failed" as const,
    },
    {
      stateName: "execution request with a mismatched persisted source revision",
      missionStatus: "active" as const,
      goalStatus: "running" as const,
      checkpointSourceRevision: "different-request-revision",
    },
    {
      stateName: "candidate checkpoint whose workspace differs from its execution request",
      missionStatus: "active" as const,
      goalStatus: "running" as const,
      candidateWorkspaceMismatch: true,
    },
  ])("denies queued recipe recovery when $stateName", async ({
    missionStatus,
    goalStatus,
    activePlanRevision,
    goalPlanRevision,
    dependencyStatus,
    checkpointSourceRevision,
    candidateWorkspaceMismatch,
  }) => {
    recipeRunner.mockReset();
    const projectId = randomUUID();
    const missionId = randomUUID();
    const goalId = randomUUID();
    const dependencyGoalId = randomUUID();
    const executionId = randomUUID();
    const candidateIdentity = candidateWorkspaceMismatch
      ? "candidate-tree-hash-fixture"
      : null;
    const checkpointCandidateWorkspace = candidateWorkspaceMismatch
      ? await createTestRoot("mismatched-checkpoint-candidate")
      : null;
    const requestWorkspaceRoot = candidateWorkspaceMismatch
      ? await createTestRoot("mismatched-request-candidate")
      : undefined;
    const now = new Date();
    const action = {
      kind: "recipe" as const,
      recipeId: "validation.recover",
      recipeVersion: 1,
      approvedPaths: ["lib/ai-orchestrator/src/index.ts"],
      candidateIdentity,
    };
    const digest = createHash("sha256").update(JSON.stringify({
      goalId,
      recipeId: action.recipeId,
      recipeVersion: action.recipeVersion,
      approvedPaths: action.approvedPaths,
      candidateIdentity,
    })).digest("hex");
    const operationId = `mission-goal-${goalId}-${digest.slice(0, 16)}`;
    const idempotencyKey = `mission-goal:${goalId}:${digest.slice(0, 32)}`;
    const binding = {
      projectId,
      operationId,
      sourceRevision: "source-revision-recovered",
      candidateIdentity,
      candidateWorkspace: checkpointCandidateWorkspace,
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
      name: `mission-blocked-recovery-${projectId.slice(0, 8)}`,
      rootPath: `/tmp/unneeded-blocked-recovery-root-${projectId}`,
      language: "typescript",
      status: "active",
      createdAt: now,
      updatedAt: now,
    });
    await db.insert(aiMissionsTable).values({
      id: missionId,
      projectId,
      userId: "test-user",
      title: "Blocked recovery",
      intent: "Do not resume operator-blocked work",
      status: missionStatus,
      scope: { kind: "project", projectId },
      autonomyPolicy: activePlanRevision ? { activePlanRevision } : {},
      createdAt: now,
      updatedAt: now,
    });
    await db.insert(aiGoalsTable).values({
      id: goalId,
      missionId,
      projectId,
      title: "Queued validation",
      status: goalStatus,
      outcomeContract: {
        deliveryRequired: false,
        ...(goalPlanRevision ? { planRevision: { hash: goalPlanRevision } } : {}),
      },
      nextAction: action,
      createdAt: now,
      updatedAt: now,
    });
    if (dependencyStatus) {
      await db.insert(aiGoalsTable).values({
        id: dependencyGoalId,
        missionId,
        projectId,
        title: "Recipe prerequisite",
        status: dependencyStatus,
        outcomeContract: { deliveryRequired: false },
        nextAction: { kind: "task" },
        createdAt: now,
        updatedAt: now,
      });
      await db.insert(aiGoalDependenciesTable).values({
        id: randomUUID(),
        missionId,
        projectId,
        goalId,
        dependsOnGoalId: dependencyGoalId,
        planRevision: activePlanRevision ?? "legacy-plan",
        createdAt: now,
      });
    }
    await db.insert(aiExecutionsTable).values({
      id: executionId,
      projectId,
      goalId,
      userId: "test-user",
      operationId,
      idempotencyKey,
      resumeTokenHash: "blocked-recovery-fixture",
      request: JSON.stringify({
        projectId,
        operationId,
        message: `recipe:${operationId}`,
        modelMessage: `recipe:${operationId}`,
        workspaceRevision: checkpointSourceRevision ?? binding.sourceRevision,
        ...(requestWorkspaceRoot ? { workspaceRoot: requestWorkspaceRoot } : {}),
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

    expect(await dispatchPendingMissionRecipes()).toBe(0);
    const [execution] = await db.select({ status: aiExecutionsTable.status })
      .from(aiExecutionsTable)
      .where(eq(aiExecutionsTable.id, executionId));
    const [goal] = await db.select({ status: aiGoalsTable.status })
      .from(aiGoalsTable)
      .where(eq(aiGoalsTable.id, goalId));
    const [mission] = await db.select({ status: aiMissionsTable.status })
      .from(aiMissionsTable)
      .where(eq(aiMissionsTable.id, missionId));
    expect(execution?.status).toBe("cancelled");
    expect(goal?.status).toBe(goalStatus);
    expect(mission?.status).toBe(missionStatus);
    expect(recipeRunner).not.toHaveBeenCalled();
  });

  it("does not replay a Chat handoff whose persisted plan hash is stale", async () => {
    const rootPath = await createTestRoot("stale-chat-handoff");
    const projectId = randomUUID();
    const missionId = randomUUID();
    const goalId = randomUUID();
    const handoffId = randomUUID();
    const activePlanRevision = "active-plan-v2";
    const stalePlanRevision = "handoff-plan-v1";
    const now = new Date();
    const action = {
      kind: "recipe" as const,
      recipeId: "validation.recover",
      recipeVersion: 1,
      approvedPaths: ["lib/ai-orchestrator/src/index.ts"],
      candidateIdentity: null,
    };
    projectIds.push(projectId);
    await db.insert(projectsTable).values({
      id: projectId,
      ownerId: "test-user",
      name: `stale-handoff-${projectId.slice(0, 8)}`,
      rootPath,
      language: "typescript",
      status: "active",
      createdAt: now,
      updatedAt: now,
    });
    await db.insert(aiMissionsTable).values({
      id: missionId,
      projectId,
      userId: "test-user",
      title: "Stale Chat handoff",
      intent: "Do not replay an outdated plan",
      status: "active",
      scope: { kind: "project", projectId },
      autonomyPolicy: { activePlanRevision },
      createdAt: now,
      updatedAt: now,
    });
    await db.insert(aiGoalsTable).values({
      id: goalId,
      missionId,
      projectId,
      title: "Current validation",
      status: "queued",
      outcomeContract: {
        deliveryRequired: false,
        planRevision: { hash: activePlanRevision },
      },
      nextAction: action,
      createdAt: now,
      updatedAt: now,
    });
    await db.insert(aiMissionHandoffsTable).values({
      id: handoffId,
      projectId,
      userId: "test-user",
      missionId,
      sessionId: null,
      messageId: null,
      assistantMessageId: null,
      idempotencyKey: randomUUID(),
      requestHash: "stale-handoff-fixture",
      planHash: stalePlanRevision,
      preview: {},
      activationPlan: {
        revision: stalePlanRevision,
        goals: [{
          stepId: "validate",
          goalId,
          taskId: null,
          dependencies: [],
        }],
        primary: {
          stepId: "validate",
          goalId,
          taskId: null,
          dependencies: [],
        },
      },
      dispatchGoalIds: [goalId],
      dispatchStatus: "pending",
      createdAt: now,
      updatedAt: now,
    });

    await db.update(aiMissionHandoffsTable)
      .set({ dispatchGoalIds: [randomUUID()] })
      .where(eq(aiMissionHandoffsTable.id, handoffId));
    await expect(dispatchMissionChatHandoff(handoffId))
      .rejects.toThrow("Mission handoff outbox no longer matches its persisted activation plan.");
    await db.update(aiMissionHandoffsTable)
      .set({ dispatchGoalIds: [goalId] })
      .where(eq(aiMissionHandoffsTable.id, handoffId));

    const runs = await dispatchMissionChatHandoff(handoffId);
    expect(runs).toEqual([expect.objectContaining({
      status: "conflict",
      reason: "handoff_plan_revision_changed",
    })]);
    expect(recipeRunner).not.toHaveBeenCalled();
    const [goal] = await db.select({ status: aiGoalsTable.status })
      .from(aiGoalsTable)
      .where(eq(aiGoalsTable.id, goalId));
    expect(goal?.status).toBe("queued");
  });

  it.each([
    {
      name: "a Mission awaiting replan",
      missionStatus: "needs_replan" as const,
      goalStatus: "queued" as const,
      pendingDependency: false,
      expectedStatus: "blocked",
      expectedReason: "mission_needs_replan",
    },
    {
      name: "a Goal awaiting replan",
      missionStatus: "active" as const,
      goalStatus: "needs_replan" as const,
      pendingDependency: false,
      expectedStatus: "blocked",
      expectedReason: "goal_needs_replan",
    },
    {
      name: "a dependency added after handoff persistence",
      missionStatus: "active" as const,
      goalStatus: "queued" as const,
      pendingDependency: true,
      expectedStatus: "waiting",
      expectedReason: "dependencies_pending",
    },
  ])("revalidates $name before replaying a Chat handoff", async ({
    missionStatus,
    goalStatus,
    pendingDependency,
    expectedStatus,
    expectedReason,
  }) => {
    const rootPath = await createTestRoot("handoff-revalidation");
    const projectId = randomUUID();
    const missionId = randomUUID();
    const goalId = randomUUID();
    const dependencyGoalId = randomUUID();
    const handoffId = randomUUID();
    const planRevision = "active-plan-v2";
    const now = new Date();
    const action = {
      kind: "recipe" as const,
      recipeId: "validation.recover",
      recipeVersion: 1,
      approvedPaths: ["lib/ai-orchestrator/src/index.ts"],
      candidateIdentity: null,
    };
    projectIds.push(projectId);
    await db.insert(projectsTable).values({
      id: projectId,
      ownerId: "test-user",
      name: `handoff-revalidation-${projectId.slice(0, 8)}`,
      rootPath,
      language: "typescript",
      status: "active",
      createdAt: now,
      updatedAt: now,
    });
    await db.insert(aiMissionsTable).values({
      id: missionId,
      projectId,
      userId: "test-user",
      title: "Handoff revalidation",
      intent: "Recheck Mission state before dispatch",
      status: missionStatus,
      scope: { kind: "project", projectId },
      autonomyPolicy: { activePlanRevision: planRevision },
      createdAt: now,
      updatedAt: now,
    });
    await db.insert(aiGoalsTable).values({
      id: goalId,
      missionId,
      projectId,
      title: "Handoff root Goal",
      status: goalStatus,
      outcomeContract: {
        deliveryRequired: false,
        planRevision: { hash: planRevision },
      },
      nextAction: action,
      createdAt: now,
      updatedAt: now,
    });
    if (pendingDependency) {
      await db.insert(aiGoalsTable).values({
        id: dependencyGoalId,
        missionId,
        projectId,
        title: "New pending prerequisite",
        status: "queued",
        outcomeContract: { deliveryRequired: false },
        nextAction: { kind: "task" },
        createdAt: now,
        updatedAt: now,
      });
      await db.insert(aiGoalDependenciesTable).values({
        id: randomUUID(),
        missionId,
        projectId,
        goalId,
        dependsOnGoalId: dependencyGoalId,
        planRevision,
        createdAt: now,
      });
    }
    await db.insert(aiMissionHandoffsTable).values({
      id: handoffId,
      projectId,
      userId: "test-user",
      missionId,
      sessionId: null,
      messageId: null,
      assistantMessageId: null,
      idempotencyKey: randomUUID(),
      requestHash: "handoff-revalidation-fixture",
      planHash: planRevision,
      preview: {},
      activationPlan: {
        revision: planRevision,
        goals: [{
          stepId: "root",
          goalId,
          taskId: null,
          dependencies: [],
        }],
        primary: {
          stepId: "root",
          goalId,
          taskId: null,
          dependencies: [],
        },
      },
      dispatchGoalIds: [goalId],
      dispatchStatus: "pending",
      createdAt: now,
      updatedAt: now,
    });

    const runs = await dispatchMissionChatHandoff(handoffId);
    expect(runs).toEqual([expect.objectContaining({
      status: expectedStatus,
      reason: expectedReason,
    })]);
    expect(recipeRunner).not.toHaveBeenCalled();
    const [goal] = await db.select({ status: aiGoalsTable.status })
      .from(aiGoalsTable)
      .where(eq(aiGoalsTable.id, goalId));
    expect(goal?.status).toBe(pendingDependency ? "waiting_for_event" : goalStatus);
  });
});