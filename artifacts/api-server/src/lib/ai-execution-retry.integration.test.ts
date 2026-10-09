import { describe, expect, it } from "vitest";
import { eq, sql } from "drizzle-orm";
import { randomUUID } from "node:crypto";
import {
  aiExecutionAcceptancesTable,
  aiExecutionsTable,
  aiChatSessionsTable,
  db,
  projectsTable,
} from "@workspace/db";
import {
  buildCapabilityEnvironment,
  createServerCapabilityRegistry,
} from "@workspace/ai-orchestrator";
import {
  claimAiExecution,
  checkpointAiExecution,
  completeAiExecution,
  createAiExecution,
  createAutonomousOperationContract,
  createRecipeOperationBinding,
  persistAiExecutionOrientationManifest,
  reconcileAiExecutions,
  recoverAiExecutionRetryToken,
  type AiOrientationRoleManifest,
} from "./ai-execution-state.js";

const testCapabilityEnvironment = buildCapabilityEnvironment(createServerCapabilityRegistry());

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

function postgresErrorCode(error: unknown): string | undefined {
  if (!error || typeof error !== "object") return undefined;
  const candidate = error as { code?: unknown; cause?: unknown };
  if (typeof candidate.code === "string") return candidate.code;
  return postgresErrorCode(candidate.cause);
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
      capabilityEnvironment: testCapabilityEnvironment,
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
      capabilityEnvironment: testCapabilityEnvironment,
    });
    const legacyBindingA = { ...bindingA };
    delete legacyBindingA.bindingVersion;
    delete legacyBindingA.capabilityEnvironment;

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
        recipeBinding: legacyBindingA,
      });
      expect(first.created).toBe(true);

      const sameBindingReplay = await createAiExecution({
        userId,
        request,
        idempotencyKey,
        projectId,
        sessionId,
        workspaceRoot: rootPath,
        recipeBinding: legacyBindingA,
      });
      expect(sameBindingReplay, "the same recipe generation remains idempotent").toMatchObject({
        created: false,
        execution: { id: first.execution.id },
      });

      const versionedReplay = await createAiExecution({
        userId,
        request,
        idempotencyKey,
        projectId,
        sessionId,
        workspaceRoot: rootPath,
        recipeBinding: bindingA,
      });
      expect(versionedReplay, "legacy bindings remain resumable without gaining a fabricated environment").toMatchObject({
        created: false,
        execution: { id: first.execution.id },
      });
      const claimed = await claimAiExecution({
        executionId: first.execution.id,
        userId,
        workerId: "legacy-binding-resume-worker",
        recipeBinding: bindingA,
      });
      expect(claimed).toMatchObject({ status: "running", workerId: "legacy-binding-resume-worker" });
      const claimedCheckpoint = JSON.parse(claimed!.checkpoint);
      expect(claimedCheckpoint.recipeBinding).not.toHaveProperty("bindingVersion");
      expect(claimedCheckpoint.recipeBinding).not.toHaveProperty("capabilityEnvironment");

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
        const storedBinding = JSON.parse(stored!.checkpoint).recipeBinding;
        expect(storedBinding.candidateIdentity, "candidate binding must remain generation A").toBe("candidate-tree-a");
        expect(storedBinding).not.toHaveProperty("bindingVersion");
        expect(storedBinding).not.toHaveProperty("capabilityEnvironment");
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
      capabilityEnvironment: testCapabilityEnvironment,
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
        expectedAttempt: 0,
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
        expectedAttempt: 0,
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

  it("holds the current acceptance locked until retry-token recovery commits", async () => {
    const projectId = randomUUID();
    const executionId = randomUUID();
    const now = new Date();
    const userId = "retry-lock-test-user";
    await db.insert(projectsTable).values({
      id: projectId,
      ownerId: userId,
      name: `retry-lock-${projectId.slice(0, 8)}`,
      rootPath: `/tmp/retry-lock-${projectId}`,
      language: "typescript",
      status: "active",
      createdAt: now,
      updatedAt: now,
    });
    await db.insert(aiExecutionsTable).values({
      id: executionId,
      projectId,
      userId,
      idempotencyKey: `${executionId}:retry-lock`,
      operationId: executionId,
      attempt: 0,
      resumeTokenHash: "old-retry-lock-token",
      request: JSON.stringify({
        projectId,
        turnIntent: "CHAT",
        message: "Retry this response",
        modelMessage: "Retry this response",
        validationTargetPaths: [],
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
        recoveryState: "REQUIRED",
        nextActionCode: "RETRY_AFTER_TIMEOUT",
      },
      evidenceRequired: 1,
      evidenceComplete: 0,
      resumable: 0,
      sourceRevision: null,
      createdAt: now,
    });

    try {
      await db.transaction(async (tx) => {
        const recovered = await recoverAiExecutionRetryToken({
          executionId,
          userId,
          expectedAttempt: 0,
          transaction: tx,
        });
        expect(recovered).toBeDefined();

        let competingUpdateError: unknown;
        try {
          await db.transaction(async (competingTx) => {
            await competingTx.execute(sql`SET LOCAL lock_timeout = '200ms'`);
            await competingTx.update(aiExecutionAcceptancesTable)
              .set({ nextActionCode: "NONE" })
              .where(eq(aiExecutionAcceptancesTable.executionId, executionId));
          });
        } catch (error) {
          competingUpdateError = error;
        }
        expect(postgresErrorCode(competingUpdateError)).toBe("55P03");
      });

      const [acceptance] = await db.select({
        nextActionCode: aiExecutionAcceptancesTable.nextActionCode,
      }).from(aiExecutionAcceptancesTable)
        .where(eq(aiExecutionAcceptancesTable.executionId, executionId));
      expect(acceptance?.nextActionCode).toBe("RETRY_AFTER_TIMEOUT");
    } finally {
      await db.delete(aiExecutionAcceptancesTable).where(eq(aiExecutionAcceptancesTable.executionId, executionId));
      await db.delete(aiExecutionsTable).where(eq(aiExecutionsTable.id, executionId));
      await db.delete(projectsTable).where(eq(projectsTable.id, projectId));
    }
  });

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
        expectedAttempt: 0,
        workerId,
        manifest,
      })).resolves.toBe(true);

      await expect(persistAiExecutionOrientationManifest({
        executionId,
        expectedAttempt: 0,
        workerId: "stale-orientation-worker",
        manifest,
      })).resolves.toBe(false);

      await expect(persistAiExecutionOrientationManifest({
        executionId,
        expectedAttempt: 0,
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
        expectedAttempt: 0,
        workerId,
        manifest,
      })).resolves.toBe(true);

      await expect(persistAiExecutionOrientationManifest({
        executionId,
        expectedAttempt: 0,
        workerId,
        manifest: {
          ...manifest,
          projectRevision: `${workspaceRevision}-drift`,
        },
      })).resolves.toBe(false);

      await expect(persistAiExecutionOrientationManifest({
        executionId,
        expectedAttempt: 0,
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
        expectedAttempt: 0,
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

describe("canonical completion evidence", () => {
  it("does not accept a proof-required operation from complete reads alone", async () => {
    const projectId = randomUUID();
    const sessionId = randomUUID();
    const userId = "read-only-proof-user";
    const workerId = "read-only-proof-worker";
    const workspaceRevision = new Date().toISOString();
    const workspaceRoot = `/tmp/read-only-proof-${projectId}`;
    let executionId: string | undefined;

    await db.insert(projectsTable).values({
      id: projectId,
      ownerId: userId,
      name: `read-only-proof-${projectId.slice(0, 8)}`,
      rootPath: workspaceRoot,
      language: "typescript",
      status: "active",
      createdAt: new Date(),
      updatedAt: new Date(),
    });
    await db.insert(aiChatSessionsTable).values({
      id: sessionId,
      projectId,
      title: "Read-only proof boundary test",
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    try {
      const created = await createAiExecution({
        userId,
        request: {
          projectId,
          sessionId,
          message: "Inspect the source file",
          modelMessage: "Inspect the source file",
          workspaceRevision,
          workspaceRoot,
          proofRequired: true,
          validationTargetPaths: ["src/example.ts"],
        },
        idempotencyKey: `${projectId}:read-only-proof`,
        projectId,
        sessionId,
        workspaceRoot,
      });
      executionId = created.execution.id;

      const claimed = await claimAiExecution({
        executionId,
        userId,
        workerId,
      });
      expect(claimed).toMatchObject({ id: executionId, status: "running", workerId });

      const operation = createAutonomousOperationContract({
        operationId: created.execution.operationId ?? executionId,
        objective: "Inspect the requested source file",
        revisionManifest: workspaceRevision,
        targetPaths: ["src/example.ts"],
        expectedBehavior: "Return an accepted, revision-bound result.",
        nodes: [{
          id: "inspect-source",
          kind: "inspect",
          dependencies: [],
          status: "passed",
          attempts: 1,
          validationAttempts: 0,
          allowedFiles: ["src/example.ts"],
          validationProfile: "read-only",
          evidenceRefs: [],
        }],
      });
      expect(await checkpointAiExecution({
        executionId,
        expectedAttempt: claimed!.attempt,
        workerId,
        checkpoint: {
          stage: "finalizing",
          sequence: 1,
          operation,
          updatedAt: new Date().toISOString(),
        },
      })).toBe(true);

      const completed = await completeAiExecution({
        executionId,
        workerId,
        operation,
        evidenceReads: [{
          path: "src/example.ts",
          readType: "source",
          body: "export const answer = 42;",
          complete: true,
          truncated: false,
        }],
      });

      expect(completed).toBe(false);
      const [execution] = await db
        .select({
          status: aiExecutionsTable.status,
          checkpoint: aiExecutionsTable.checkpoint,
        })
        .from(aiExecutionsTable)
        .where(eq(aiExecutionsTable.id, executionId));
      expect(execution?.status).toBe("running");
      expect(JSON.parse(execution!.checkpoint).evidenceVerdict).not.toBe("PROVEN");

      const acceptances = await db
        .select({ outcome: aiExecutionAcceptancesTable.outcome })
        .from(aiExecutionAcceptancesTable)
        .where(eq(aiExecutionAcceptancesTable.executionId, executionId));
      expect(acceptances).toEqual([]);
    } finally {
      if (executionId) {
        await db.delete(aiExecutionAcceptancesTable).where(eq(aiExecutionAcceptancesTable.executionId, executionId));
        await db.delete(aiExecutionsTable).where(eq(aiExecutionsTable.id, executionId));
      }
      await db.delete(aiChatSessionsTable).where(eq(aiChatSessionsTable.id, sessionId));
      await db.delete(projectsTable).where(eq(projectsTable.id, projectId));
    }
  });
});