import { describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { randomUUID } from "node:crypto";
import {
  aiExecutionAcceptancesTable,
  aiExecutionsTable,
  aiChatSessionsTable,
  db,
  projectsTable,
} from "@workspace/db";
import {
  claimAiExecution,
  checkpointAiExecution,
  completeAiExecution,
  createAiExecution,
  createRecipeOperationBinding,
  persistAiExecutionOrientationManifest,
  reconcileAiExecutions,
  recoverAiExecutionRetryToken,
  type AiOrientationRoleManifest,
} from "./ai-execution-state.js";

function orientationManifest(projectRevision: string, rootPath: string): AiOrientationRoleManifest {
  return {
    projectRevision,
    rootPath,
    paths: {
      purpose: ["README.md"],
      components: ["src/App.tsx"],
      primaryFlow: ["src/routes.ts"],
      uncertainty: ["tests/app.test.ts"],
    },
  };
}

describe("durable conversational retry authorization", () => {
  it("rejects idempotency-key reuse when the recipe candidate binding changes", async () => {
    const projectId = randomUUID();
    const userId = "recipe-idempotency-user";
    const sessionId = randomUUID();
    const operationId = randomUUID();
    const idempotencyKey = `${operationId}:candidate-generation`;
    const workspaceRevision = new Date().toISOString();
    const rootPath = `/tmp/recipe-idempotency-${projectId}`;
    const candidateA = `/tmp/eos-disposable/recipe-candidate-a-${projectId}`;
    const candidateB = `/tmp/eos-disposable/recipe-candidate-b-${projectId}`;
    const request = {
      projectId,
      sessionId,
      operationId,
      message: "Validate the approved candidate",
      modelMessage: "Validate the approved candidate",
      workspaceRevision,
      workspaceRoot: rootPath,
      validationTargetPaths: ["src/changed.ts"],
      turnIntent: "DELIVERY" as const,
    };
    const bindingA = createRecipeOperationBinding({
      projectId,
      operationId,
      sourceRevision: workspaceRevision,
      candidateIdentity: "candidate-tree-a",
      candidateWorkspace: candidateA,
      approvedPaths: ["src/changed.ts"],
      phase: "planned",
      missionBudget: { maxProcessCount: 8 },
    });
    const bindingB = createRecipeOperationBinding({
      projectId,
      operationId,
      sourceRevision: workspaceRevision,
      candidateIdentity: "candidate-tree-b",
      candidateWorkspace: candidateB,
      approvedPaths: ["src/changed.ts"],
      phase: "planned",
      missionBudget: { maxProcessCount: 8 },
    });

    await db.insert(projectsTable).values({
      id: projectId,
      ownerId: userId,
      name: `recipe-idempotency-${projectId.slice(0, 8)}`,
      rootPath,
      language: "typescript",
      status: "active",
      createdAt: new Date(),
      updatedAt: new Date(),
    });
    await db.insert(aiChatSessionsTable).values({
      id: sessionId,
      projectId,
      title: "Recipe idempotency test",
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    try {
      const first = await createAiExecution({
        userId,
        request,
        idempotencyKey,
        projectId,
        sessionId,
        workspaceRoot: rootPath,
        recipeBinding: bindingA,
      });
      expect(first.created).toBe(true);

      const sameBindingReplay = await createAiExecution({
        userId,
        request,
        idempotencyKey,
        projectId,
        sessionId,
        workspaceRoot: rootPath,
        recipeBinding: bindingA,
      });
      expect(sameBindingReplay, "the same recipe generation remains idempotent").toMatchObject({
        created: false,
        execution: { id: first.execution.id },
      });

      await expect(createAiExecution({
        userId,
        request,
        idempotencyKey,
        projectId,
        sessionId,
        workspaceRoot: rootPath,
        recipeBinding: bindingB,
      })).rejects.toThrow("Execution idempotency key is bound to a different request");

      const raceKey = `${operationId}:candidate-generation-race`;
      const raceResults = await Promise.allSettled([
        createAiExecution({
          userId,
          request,
          idempotencyKey: raceKey,
          projectId,
          sessionId,
          workspaceRoot: rootPath,
          recipeBinding: bindingA,
        }),
        createAiExecution({
          userId,
          request,
          idempotencyKey: raceKey,
          projectId,
          sessionId,
          workspaceRoot: rootPath,
          recipeBinding: bindingB,
        }),
      ]);
      expect(raceResults.filter((result) => result.status === "fulfilled")).toHaveLength(1);
      expect(raceResults.filter((result) => result.status === "rejected")).toHaveLength(1);
      const raceWinner = raceResults.find(
        (result): result is PromiseFulfilledResult<{ execution: typeof first.execution; created: boolean }> =>
          result.status === "fulfilled",
      )!.value;
      expect(raceWinner.created).toBe(true);

      const [stored] = await db
        .select({ checkpoint: aiExecutionsTable.checkpoint })
        .from(aiExecutionsTable)
        .where(eq(aiExecutionsTable.id, first.execution.id))
        .limit(1);
      expect(JSON.parse(stored!.checkpoint).recipeBinding, "candidate binding must remain generation A").toEqual(bindingA);
    } finally {
      await db.delete(aiExecutionsTable).where(eq(aiExecutionsTable.userId, userId));
      await db.delete(aiChatSessionsTable).where(eq(aiChatSessionsTable.id, sessionId));
      await db.delete(projectsTable).where(eq(projectsTable.id, projectId));
    }
  });

  it("reclaims an expired recipe lease with a new worker without accepting stale binding state", async () => {
    const projectId = randomUUID();
    const userId = "recipe-reclaim-user";
    const sessionId = randomUUID();
    const operationId = randomUUID();
    const sourceRevision = new Date().toISOString();
    const rootPath = `/tmp/recipe-reclaim-${projectId}`;
    const candidateWorkspace = `/tmp/eos-disposable/recipe-reclaim-candidate-${projectId}`;
    const workerA = "recipe-reclaim-worker-a";
    const workerB = "recipe-reclaim-worker-b";
    const binding = createRecipeOperationBinding({
      projectId,
      operationId,
      sourceRevision,
      candidateIdentity: "candidate-reclaim-generation",
      candidateWorkspace,
      approvedPaths: ["src/changed.ts"],
      phase: "planned",
      missionBudget: { maxProcessCount: 8 },
    });
    const request = {
      projectId,
      sessionId,
      operationId,
      message: `recipe:${operationId}`,
      modelMessage: `recipe:${operationId}`,
      workspaceRevision: sourceRevision,
      validationTargetPaths: ["src/changed.ts"],
    };

    await db.insert(projectsTable).values({
      id: projectId,
      ownerId: userId,
      name: `recipe-reclaim-${projectId.slice(0, 8)}`,
      rootPath,
      language: "typescript",
      status: "active",
      createdAt: new Date(),
      updatedAt: new Date(),
    });
    await db.insert(aiChatSessionsTable).values({
      id: sessionId,
      projectId,
      title: "Recipe reclaim test",
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    let createdExecutionId: string | undefined;
    try {
      const created = await createAiExecution({
        userId,
        request,
        idempotencyKey: `${operationId}:reclaim`,
        projectId,
        sessionId,
        recipeBinding: binding,
      });
      createdExecutionId = created.execution.id;
      const firstClaim = await claimAiExecution({
        executionId: created.execution.id,
        userId,
        workerId: workerA,
        recipeBinding: binding,
      });
      expect(firstClaim).toMatchObject({
        id: created.execution.id,
        status: "running",
        workerId: workerA,
      });
      const replayAfterClaim = await createAiExecution({
        userId,
        request,
        idempotencyKey: `${operationId}:reclaim`,
        projectId,
        sessionId,
        recipeBinding: binding,
      });
      expect(replayAfterClaim, "lifecycle fields must not break same-generation idempotency").toMatchObject({
        created: false,
        execution: { id: created.execution.id },
      });

      const firstWorkerBinding = {
        ...binding,
        phase: "running" as const,
        leaseOwner: workerA,
        leaseUntil: new Date(Date.now() + 60_000).toISOString(),
      };
      expect(await checkpointAiExecution({
        executionId: created.execution.id,
        workerId: workerA,
        recipeBinding: firstWorkerBinding,
        checkpoint: {
          stage: "tool_loop",
          sequence: 2,
          recipeBinding: firstWorkerBinding,
          completedNodes: [],
          updatedAt: new Date().toISOString(),
        },
      })).toBe(true);

      await db
        .update(aiExecutionsTable)
        .set({ leaseUntil: new Date(Date.now() - 1_000) })
        .where(eq(aiExecutionsTable.id, created.execution.id));

      expect(await reconcileAiExecutions({ expiredOnly: true })).toBe(1);

      const [reconciled] = await db
        .select({
          status: aiExecutionsTable.status,
          workerId: aiExecutionsTable.workerId,
          checkpoint: aiExecutionsTable.checkpoint,
        })
        .from(aiExecutionsTable)
        .where(eq(aiExecutionsTable.id, created.execution.id))
        .limit(1);
      expect(reconciled).toMatchObject({
        status: "paused",
        workerId: null,
      });
      expect(JSON.parse(reconciled!.checkpoint).recipeBinding).toMatchObject({
        candidateIdentity: binding.candidateIdentity,
        candidateWorkspace: binding.candidateWorkspace,
        phase: "running",
        leaseOwner: workerA,
      });

      const secondClaim = await claimAiExecution({
        executionId: created.execution.id,
        userId,
        workerId: workerB,
        recipeBinding: binding,
      });
      expect(secondClaim, "a new worker must reclaim the same candidate generation").toMatchObject({
        id: created.execution.id,
        status: "running",
        workerId: workerB,
      });

      expect(await checkpointAiExecution({
        executionId: created.execution.id,
        workerId: workerA,
        recipeBinding: firstWorkerBinding,
        checkpoint: {
          stage: "tool_loop",
          sequence: 3,
          recipeBinding: firstWorkerBinding,
          completedNodes: ["stale-worker-node"],
          updatedAt: new Date().toISOString(),
        },
      })).toBe(false);
      expect(await completeAiExecution({
        executionId: created.execution.id,
        workerId: workerA,
        finalMessageId: `recipe-receipt:stale-${operationId}`,
        evidenceVerdict: "PROVEN",
        evidenceRefs: ["evidence:stale-reclaim"],
        recipeBinding: firstWorkerBinding,
      })).toBe(false);

      const secondWorkerBinding = {
        ...binding,
        phase: "running" as const,
        leaseOwner: workerB,
        leaseUntil: new Date(Date.now() + 60_000).toISOString(),
      };
      expect(await completeAiExecution({
        executionId: created.execution.id,
        workerId: workerB,
        finalMessageId: `recipe-receipt:${operationId}`,
        evidenceVerdict: "PROVEN",
        evidenceRefs: ["evidence:reclaim"],
        recipeBinding: secondWorkerBinding,
      })).toBe(true);
    } finally {
      if (createdExecutionId) {
        await db.delete(aiExecutionAcceptancesTable).where(eq(aiExecutionAcceptancesTable.executionId, createdExecutionId));
        await db.delete(aiExecutionsTable).where(eq(aiExecutionsTable.id, createdExecutionId));
      }
      await db.delete(aiChatSessionsTable).where(eq(aiChatSessionsTable.id, sessionId));
      await db.delete(projectsTable).where(eq(projectsTable.id, projectId));
    }
  });

  it.each(["PROJECT_QUERY", "CHAT"] as const)(
    "rotates a retry token and creates a new auditable attempt for %s",
    async (turnIntent) => {
    const projectId = randomUUID();
    const executionId = randomUUID();
    const now = new Date();
    const workspaceRevision = now.toISOString();
      const manifest = turnIntent === "PROJECT_QUERY"
        ? orientationManifest(workspaceRevision, `/tmp/retry-${projectId}`)
        : undefined;

    await db.insert(projectsTable).values({
      id: projectId,
      ownerId: "retry-test-user",
      name: `retry-${projectId.slice(0, 8)}`,
      rootPath: `/tmp/retry-${projectId}`,
      language: "typescript",
      status: "active",
      createdAt: now,
      updatedAt: now,
    });
    await db.insert(aiExecutionsTable).values({
      id: executionId,
      projectId,
      sessionId: null,
      operationId: executionId,
      userId: "retry-test-user",
      idempotencyKey: `${executionId}:original`,
      attempt: 0,
      resumeTokenHash: "old-token-hash",
      request: JSON.stringify({
        projectId,
        turnIntent,
        sessionId: randomUUID(),
        message: "Explain the project flow",
        modelMessage: "Explain the project flow",
        workspaceRevision,
         ...(manifest ? { projectOrientation: true, workspaceRoot: manifest.rootPath } : {}),
        validationTargetPaths: [],
        ...(turnIntent === "PROJECT_QUERY"
          ? {
              proofRequired: true,
              resumeContract: {
                taskType: "BEHAVIOR_QUERY",
                outputContract: "BEHAVIOR_ANSWER",
                contextProfile: "project_query",
                sessionId: randomUUID(),
                projectRevision: workspaceRevision,
                requiresEvidence: true,
                 ...(manifest ? { orientationManifest: manifest } : {}),
                scope: { projectId, rootPath: null, linkedTaskId: null },
              },
            }
          : {}),
      }),
      checkpoint: "{}",
      status: "failed",
      createdAt: now,
      updatedAt: now,
    });
    await db.insert(aiExecutionAcceptancesTable).values({
      id: randomUUID(),
      executionId,
      projectId,
      attempt: 0,
      finalizationKey: `${executionId}:attempt:0`,
      operationId: executionId,
      terminalStatus: "failed",
      outcome: "FAILED",
      reasonCode: "EXECUTION_PROVIDER_FAILURE",
      nextActionCode: "RETRY_AFTER_TIMEOUT",
      disposition: {
        reasonCodes: ["EXECUTION_PROVIDER_FAILURE"],
        outcome: "FAILED",
        recoveryState: "REQUIRED",
        nextActionCode: "RETRY_AFTER_TIMEOUT",
        operatorAction: "RETRY_AFTER_TIMEOUT",
        retryAt: "2020-01-01T00:00:00.000Z",
      },
      evidenceRequired: 1,
      evidenceComplete: 0,
      resumable: 0,
      sourceRevision: workspaceRevision,
      createdAt: now,
    });

    try {
      const recovered = await recoverAiExecutionRetryToken({
        executionId,
        userId: "retry-test-user",
        expectedAttempt: 0,
      });
      expect(recovered?.resumeToken).toEqual(expect.any(String));
      expect(recovered?.execution.attempt).toBe(0);

      const claimed = await claimAiExecution({
        executionId,
        userId: "retry-test-user",
        workerId: "retry-test-worker",
        resumeToken: recovered!.resumeToken,
      });
      expect(claimed).toMatchObject({
        id: executionId,
        status: "running",
        attempt: 1,
        workerId: "retry-test-worker",
      });
       if (manifest) {
         const [executionRow] = await db
           .select({ request: aiExecutionsTable.request })
           .from(aiExecutionsTable)
           .where(eq(aiExecutionsTable.id, executionId));
         expect(JSON.parse(executionRow!.request).resumeContract.orientationManifest).toEqual(manifest);
       }

      const acceptances = await db
        .select({ attempt: aiExecutionAcceptancesTable.attempt })
        .from(aiExecutionAcceptancesTable)
        .where(eq(aiExecutionAcceptancesTable.executionId, executionId));
      expect(acceptances).toEqual([{ attempt: 0 }]);
    } finally {
      await db.delete(aiExecutionAcceptancesTable).where(eq(aiExecutionAcceptancesTable.executionId, executionId));
      await db.delete(aiExecutionsTable).where(eq(aiExecutionsTable.id, executionId));
      await db.delete(projectsTable).where(eq(projectsTable.id, projectId));
    }
    },
  );

  it("persists one verified orientation manifest and rejects drift, incomplete, or stale replacements", async () => {
    const projectId = randomUUID();
    const executionId = randomUUID();
    const sessionId = randomUUID();
    const workerId = "orientation-manifest-worker";
    const now = new Date();
    const workspaceRevision = now.toISOString();
    const rootPath = `/tmp/orientation-${projectId}`;
    const manifest = orientationManifest(workspaceRevision, rootPath);

    await db.insert(projectsTable).values({
      id: projectId,
      ownerId: "orientation-test-user",
      name: `orientation-${projectId.slice(0, 8)}`,
      rootPath,
      language: "typescript",
      status: "active",
      createdAt: now,
      updatedAt: now,
    });
    await db.insert(aiChatSessionsTable).values({
      id: sessionId,
      projectId,
      title: "Orientation test",
      createdAt: now,
      updatedAt: now,
    });
    await db.insert(aiExecutionsTable).values({
      id: executionId,
      projectId,
      sessionId,
      operationId: executionId,
      userId: "orientation-test-user",
      idempotencyKey: `${executionId}:orientation`,
      attempt: 0,
      resumeTokenHash: "orientation-manifest-resume-hash",
      request: JSON.stringify({
        projectId,
        turnIntent: "PROJECT_QUERY",
        projectOrientation: true,
        sessionId,
        message: "Explain the project",
        modelMessage: "Explain the project",
        workspaceRevision,
        workspaceRoot: rootPath,
        validationTargetPaths: [],
        proofRequired: true,
        resumeContract: {
          taskType: "BEHAVIOR_QUERY",
          outputContract: "BEHAVIOR_ANSWER",
          contextProfile: "project_query",
          sessionId,
          projectRevision: workspaceRevision,
          requiresEvidence: true,
          scope: { projectId, rootPath, linkedTaskId: null },
        },
      }),
      checkpoint: "{}",
      status: "running",
      workerId,
      leaseUntil: new Date(Date.now() + 60_000),
      createdAt: now,
      updatedAt: now,
    });

    try {
      await expect(persistAiExecutionOrientationManifest({
        executionId,
        workerId,
        manifest,
      })).resolves.toBe(true);

      await expect(persistAiExecutionOrientationManifest({
        executionId,
        workerId: "stale-orientation-worker",
        manifest,
      })).resolves.toBe(false);

      await expect(persistAiExecutionOrientationManifest({
        executionId,
        workerId,
        manifest: {
          ...manifest,
          rootPath: `${rootPath}-drift`,
        },
      })).resolves.toBe(false);

      const [stored] = await db
        .select({ request: aiExecutionsTable.request })
        .from(aiExecutionsTable)
        .where(eq(aiExecutionsTable.id, executionId));
      expect(JSON.parse(stored!.request).resumeContract.orientationManifest).toEqual(manifest);

      await expect(persistAiExecutionOrientationManifest({
        executionId,
        workerId,
        manifest,
      })).resolves.toBe(true);

      await expect(persistAiExecutionOrientationManifest({
        executionId,
        workerId,
        manifest: {
          ...manifest,
          projectRevision: `${workspaceRevision}-drift`,
        },
      })).resolves.toBe(false);

      await expect(persistAiExecutionOrientationManifest({
        executionId,
        workerId,
        manifest: {
          ...manifest,
          paths: { ...manifest.paths, uncertainty: [] },
        },
      })).resolves.toBe(false);

      await db
        .update(aiExecutionsTable)
        .set({ leaseUntil: new Date(Date.now() - 1_000) })
        .where(eq(aiExecutionsTable.id, executionId));
      await expect(persistAiExecutionOrientationManifest({
        executionId,
        workerId,
        manifest,
      })).resolves.toBe(false);
    } finally {
      await db.delete(aiExecutionsTable).where(eq(aiExecutionsTable.id, executionId));
      await db.delete(aiChatSessionsTable).where(eq(aiChatSessionsTable.id, sessionId));
      await db.delete(projectsTable).where(eq(projectsTable.id, projectId));
    }
  });
});