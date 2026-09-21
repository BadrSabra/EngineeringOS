import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { eq } from "drizzle-orm";
import { describe, expect, it, vi } from "vitest";
import {
  aiExecutionAcceptancesTable,
  aiExecutionsTable,
  aiChatSessionsTable,
  db,
  projectsTable,
} from "@workspace/db";
import {
  checkpointAiExecution,
  claimAiExecution,
  createAiExecution,
  reconcileAiExecutions,
  type AiExecutionNodeCheckpoint,
} from "./ai-execution-state.js";
import { HOST_DISPOSABLE_TEMP_ROOT } from "./disposable-temp.js";
import { prepareRecipeOperation, runRecipeOperation } from "./recipe-operation-runner.js";

const validationCalls: string[] = [];

vi.mock("./ai-repair-validation.js", () => ({
  runRepairValidation: vi.fn(async (_rootPath: string, profile: string) => {
    validationCalls.push(profile);
    return {
      status: "passed",
      profile,
      detail: `mock validation for ${profile}`,
      evidence: {
        evidenceId: `mock-evidence-${validationCalls.length}`,
        observedAt: new Date().toISOString(),
        artifactRef: `mock-validation:${profile}`,
      },
    };
  }),
}));

async function createReclaimedRecipeFixture(options: {
  includePassedEvidence?: boolean;
  mutateCheckpointNode?: (
    nodeId: string,
    index: number,
  ) => Partial<AiExecutionNodeCheckpoint> | undefined;
} = {}) {
  const projectId = crypto.randomUUID();
  const operationId = crypto.randomUUID();
  const sessionId = crypto.randomUUID();
  const userId = "recipe-runner-recovery-user";
  const sourceRevision = "recipe-runner-recovery-revision";
  const candidateWorkspace = await mkdtemp(path.join(HOST_DISPOSABLE_TEMP_ROOT, "recipe-runner-recovery-"));
  const approvedFile = path.join(candidateWorkspace, "lib/ai-orchestrator/src/index.ts");
  await mkdir(path.dirname(approvedFile), { recursive: true });
  await writeFile(approvedFile, "export const recoveryFixture = true;\n", "utf8");
  const params = {
    projectId,
    operationId,
    sessionId,
    userId,
    idempotencyKey: `${operationId}:recovery`,
    rootPath: process.cwd(),
    sourceRevision,
    recipeId: "candidate.verify",
    recipeVersion: 1,
    approvedPaths: ["lib/ai-orchestrator/src/index.ts"],
    candidateIdentity: "recovery-candidate",
    candidateWorkspace,
  } as const;
  const prepared = prepareRecipeOperation(params);
  let executionId: string | undefined;

  await db.insert(projectsTable).values({
    id: projectId,
    ownerId: userId,
    name: `recipe-runner-recovery-${projectId.slice(0, 8)}`,
    rootPath: params.rootPath,
    language: "typescript",
    status: "active",
    createdAt: new Date(),
    updatedAt: new Date(),
  });
  await db.insert(aiChatSessionsTable).values({
    id: sessionId,
    projectId,
    title: "Recipe runner recovery test",
    createdAt: new Date(),
    updatedAt: new Date(),
  });

  const cleanup = async () => {
    if (executionId) {
      await db.delete(aiExecutionAcceptancesTable).where(eq(aiExecutionAcceptancesTable.executionId, executionId));
      await db.delete(aiExecutionsTable).where(eq(aiExecutionsTable.id, executionId));
    }
    await db.delete(aiChatSessionsTable).where(eq(aiChatSessionsTable.id, sessionId));
    await db.delete(projectsTable).where(eq(projectsTable.id, projectId));
    await rm(candidateWorkspace, { recursive: true, force: true });
  };

  try {
    const created = await createAiExecution({
      userId,
      request: {
        projectId,
        operationId,
        sessionId,
        message: `recipe:${operationId}`,
        modelMessage: `recipe:${operationId}`,
        workspaceRevision: sourceRevision,
        validationTargetPaths: [...params.approvedPaths],
      },
      idempotencyKey: params.idempotencyKey,
      projectId,
      sessionId,
      recipeBinding: prepared.binding,
    });
    executionId = created.execution.id;
    const workerA = "recipe-runner-recovery-worker-a";
    const firstClaim = await claimAiExecution({
      executionId,
      userId,
      workerId: workerA,
      recipeBinding: prepared.binding,
    });
    expect(firstClaim).toMatchObject({ status: "running", workerId: workerA });

    const firstBinding = {
      ...prepared.binding,
      phase: "running" as const,
      leaseOwner: workerA,
      leaseUntil: new Date(Date.now() + 60_000).toISOString(),
    };
    const checkpointNodes = prepared.plan.nodes.map((node, index) => ({
      id: node.id,
      title: node.title,
      status: index === 0 ? "passed" as const : "queued" as const,
      allowedFiles: [...node.allowedFiles],
      dependencies: [...node.dependencies],
      validationProfile: node.validationProfile,
      attempts: index === 0 ? 1 : 0,
      validationAttempts: index === 0 ? 1 : 0,
      evidenceRefs: index === 0 && options.includePassedEvidence !== false
        ? ["mock-evidence-previous"]
        : [],
      ...(options.mutateCheckpointNode?.(node.id, index) ?? {}),
    }));
    expect(await checkpointAiExecution({
      executionId,
      workerId: workerA,
      recipeBinding: firstBinding,
      checkpoint: {
        stage: "tool_loop",
        sequence: 2,
        nodeStates: checkpointNodes,
        completedNodes: [prepared.plan.nodes[0]!.id],
        recipeBinding: firstBinding,
        updatedAt: new Date().toISOString(),
      },
    })).toBe(true);

    await db
      .update(aiExecutionsTable)
      .set({ leaseUntil: new Date(Date.now() - 1_000) })
      .where(eq(aiExecutionsTable.id, executionId));
    expect(await reconcileAiExecutions({ expiredOnly: true })).toBe(1);

    return { params, prepared, executionId, cleanup };
  } catch (error) {
    await cleanup();
    throw error;
  }
}

describe("recipe operation preparation", () => {
  it("prepares a candidate verification recipe with exactly one approved path", () => {
    const prepared = prepareRecipeOperation({
      projectId: "project-1",
      operationId: "operation-1",
      rootPath: process.cwd(),
      sourceRevision: "revision-1",
      recipeId: "candidate.verify",
      recipeVersion: 1,
      approvedPaths: ["lib/ai-orchestrator/src/index.ts"],
      candidateIdentity: "candidate-1",
    });
    expect(prepared.plan.nodes).toHaveLength(2);
    expect(prepared.plan.nodes[0]?.executionContext?.scope).toMatchObject({
      kind: "paths",
      paths: ["lib/ai-orchestrator/src/index.ts"],
    });
  });

  it("does not accept a raw graph or an unknown recipe ID", () => {
    expect(() => prepareRecipeOperation({
      projectId: "project-1",
      operationId: "operation-2",
      rootPath: process.cwd(),
      sourceRevision: "revision-1",
      recipeId: "unknown.recipe",
      recipeVersion: 1,
      approvedPaths: ["src/index.ts"],
    })).toThrow(/Unknown server recipe/);
  });

  it("resumes a reclaimed recipe from passed checkpoint nodes instead of rerunning them", async () => {
    validationCalls.length = 0;
    const fixture = await createReclaimedRecipeFixture();
    try {
      const result = await runRecipeOperation(fixture.params);
      expect(result.status).toBe("completed");
      expect(result.completedNodeIds).toEqual(fixture.prepared.plan.nodes.map((node) => node.id));
      expect(validationCalls).toEqual(["ai-orchestrator-tests"]);
    } finally {
      await fixture.cleanup();
    }
  });

  it("fails closed before capability execution when a passed checkpoint has no evidence", async () => {
    validationCalls.length = 0;
    const fixture = await createReclaimedRecipeFixture({ includePassedEvidence: false });
    try {
      await expect(runRecipeOperation(fixture.params)).rejects.toThrow(
        "Recipe checkpoint passed node is missing retained evidence.",
      );
      expect(validationCalls).toEqual([]);
      const [execution] = await db
        .select({ status: aiExecutionsTable.status })
        .from(aiExecutionsTable)
        .where(eq(aiExecutionsTable.id, fixture.executionId))
        .limit(1);
      expect(execution?.status).toBe("failed");
    } finally {
      await fixture.cleanup();
    }
  });

  it("fails closed before capability execution when checkpoint scope drifts", async () => {
    validationCalls.length = 0;
    const fixture = await createReclaimedRecipeFixture({
      mutateCheckpointNode: (_nodeId, index) => index === 0
        ? { allowedFiles: ["lib/ai-orchestrator/src/other.ts"] }
        : undefined,
    });
    try {
      await expect(runRecipeOperation(fixture.params)).rejects.toThrow(
        "Recipe checkpoint could not be reconciled with the server-owned plan.",
      );
      expect(validationCalls).toEqual([]);
      const [execution] = await db
        .select({ status: aiExecutionsTable.status })
        .from(aiExecutionsTable)
        .where(eq(aiExecutionsTable.id, fixture.executionId))
        .limit(1);
      expect(execution?.status).toBe("failed");
    } finally {
      await fixture.cleanup();
    }
  });
});