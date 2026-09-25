import { execFile } from "node:child_process";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import { and, desc, eq } from "drizzle-orm";
import { describe, expect, it, vi } from "vitest";
import {
  aiAgentEffectBundlesTable,
  aiAgentEffectsTable,
  aiAgentEpisodeEventsTable,
  aiAgentEpisodesTable,
  aiAgentObservationsTable,
  aiExecutionAcceptancesTable,
  aiExecutionsTable,
  aiChatSessionsTable,
  aiStrategyCandidatesTable,
  aiStrategyReplayCaseRunsTable,
  aiStrategyReplayCasesTable,
  db,
  projectsTable,
} from "@workspace/db";
import {
  checkpointAiExecution,
  claimAiExecution,
  createAiExecution,
  reconcileAiExecutions,
  requestAiExecutionCancel,
  type AiExecutionNodeCheckpoint,
} from "./ai-execution-state.js";
import * as aiExecutionState from "./ai-execution-state.js";
import { HOST_DISPOSABLE_TEMP_ROOT } from "./disposable-temp.js";
import {
  createRuntimeStartRunner,
  prepareRecipeOperation,
  runRecipeOperation,
} from "./recipe-operation-runner.js";
import { WorkspaceRuntimeManager } from "./workspace-runtime.js";
import { createInMemoryWorkspaceRuntimeStore } from "./workspace-runtime-store.js";
import { extractAcceptedEpisodeStrategy } from "./agent-state/strategy-candidate-extractor.js";
import {
  materializeStrategyReplayCaseProofBinding,
  verifyStrategyReplayCaseProofBinding,
} from "./agent-state/strategy-replay-case-proof.js";
import {
  deleteUnreplayedStrategyReplayCases,
  registerProspectiveStrategyReplayCase,
} from "./agent-state/strategy-replay-case-registry.js";
import { runRegisteredStrategyReplayCase } from "./agent-state/strategy-replay-case-runner.js";

const validationCalls: string[] = [];
const execFileAsync = promisify(execFile);

vi.mock("./ai-repair-validation.js", async () => {
  const actual = await vi.importActual<typeof import("./ai-repair-validation.js")>(
    "./ai-repair-validation.js",
  );
  return {
    ...actual,
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
  };
});

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
      expectedAttempt: 0,
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

async function createGateCRecipeFixture(
  recipeId: "browser.verify" | "delivery.push.github",
  approvedPaths: readonly string[] = [],
) {
  const projectId = crypto.randomUUID();
  const operationId = crypto.randomUUID();
  const sessionId = crypto.randomUUID();
  const userId = `gate-c-recipe-user:${projectId}`;
  const sourceRevision = `gate-c-recipe-revision:${projectId}`;
  const now = new Date();
  await db.insert(projectsTable).values({
    id: projectId,
    ownerId: userId,
    name: `gate-c-recipe-${projectId.slice(0, 8)}`,
    rootPath: process.cwd(),
    language: "typescript",
    status: "active",
    createdAt: now,
    updatedAt: now,
  });
  await db.insert(aiChatSessionsTable).values({
    id: sessionId,
    projectId,
    title: `Gate C recipe ${recipeId}`,
    createdAt: now,
    updatedAt: now,
  });
  const params = {
    projectId,
    operationId,
    sessionId,
    userId,
    idempotencyKey: `${operationId}:gate-c-reconnect`,
    rootPath: process.cwd(),
    sourceRevision,
    recipeId,
    recipeVersion: 1,
    approvedPaths: [...approvedPaths],
    ...(recipeId === "delivery.push.github"
      ? { deliveryMessage: "Deliver the verified proposal" }
      : {}),
  };
  return {
    params,
    cleanup: async (executionId?: string) => {
      if (executionId) {
        await db.delete(aiExecutionAcceptancesTable)
          .where(eq(aiExecutionAcceptancesTable.executionId, executionId));
        await db.delete(aiExecutionsTable).where(eq(aiExecutionsTable.id, executionId));
      }
      await db.delete(aiChatSessionsTable).where(eq(aiChatSessionsTable.id, sessionId));
      await db.delete(projectsTable).where(eq(projectsTable.id, projectId));
    },
  };
}

async function assertSuccessfulGateCEffect(executionId: string, capabilityId: string) {
  const [bundle] = await db.select().from(aiAgentEffectBundlesTable)
    .where(eq(aiAgentEffectBundlesTable.executionId, executionId))
    .limit(1);
  expect(bundle).toMatchObject({ verdict: "OBSERVED" });
  const effects = await db.select().from(aiAgentEffectsTable)
    .where(eq(aiAgentEffectsTable.executionId, executionId));
  expect(effects).toHaveLength(1);
  expect(effects[0]).toMatchObject({ capabilityId, status: "observed" });
  const [acceptance] = await db.select({
    effectBundleId: aiExecutionAcceptancesTable.effectBundleId,
  }).from(aiExecutionAcceptancesTable).where(and(
    eq(aiExecutionAcceptancesTable.executionId, executionId),
    eq(aiExecutionAcceptancesTable.outcome, "SUCCEEDED"),
  )).limit(1);
  expect(acceptance?.effectBundleId).toBe(bundle?.id);
  const observations = await db.select().from(aiAgentObservationsTable)
    .where(eq(aiAgentObservationsTable.executionId, executionId));
  expect(observations.filter((row) => row.provenance === "DIRECT_OBSERVATION")).toHaveLength(2);
  const events = await db.select({ eventType: aiAgentEpisodeEventsTable.eventType })
    .from(aiAgentEpisodeEventsTable)
    .where(eq(aiAgentEpisodeEventsTable.executionId, executionId));
  expect(events.map((event) => event.eventType)).toEqual(
    expect.arrayContaining(["ACTION_REQUESTED", "ACTION_COMMITTED", "EFFECT_CLASSIFIED"]),
  );
  return bundle?.id;
}

describe("recipe operation preparation", () => {
  it("prepares runtime startup with a server runner and project scope", () => {
    const prepared = prepareRecipeOperation({
      projectId: "project-runtime",
      operationId: "operation-runtime",
      rootPath: process.cwd(),
      sourceRevision: "revision-runtime",
      recipeId: "runtime.start",
      recipeVersion: 1,
      runtimeStartRunner: async () => ({
        status: "passed",
        evidence: { evidenceId: "runtime-after-state" },
      }),
    });
    expect(prepared.plan.nodes).toMatchObject([{
      capabilityId: "runtime.start",
      executionContext: {
        scope: { kind: "project", paths: [] },
        revision: "revision-runtime",
      },
    }]);
  });

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
      const [bundle] = await db.select().from(aiAgentEffectBundlesTable)
        .where(eq(aiAgentEffectBundlesTable.executionId, fixture.executionId))
        .limit(1);
      expect(bundle).toMatchObject({ verdict: "OBSERVED" });
      const effects = bundle
        ? await db.select().from(aiAgentEffectsTable)
          .where(eq(aiAgentEffectsTable.executionId, fixture.executionId))
        : [];
      expect(effects).toHaveLength(1);
      expect(effects[0]).toMatchObject({
        capabilityId: "candidate.validation",
        status: "observed",
      });
      const directObservations = await db.select()
        .from(aiAgentObservationsTable)
        .where(eq(aiAgentObservationsTable.executionId, fixture.executionId));
      expect(directObservations.filter((row) => row.provenance === "DIRECT_OBSERVATION")).toHaveLength(4);
      const episodeEvents = await db.select({ eventType: aiAgentEpisodeEventsTable.eventType })
        .from(aiAgentEpisodeEventsTable)
        .where(eq(aiAgentEpisodeEventsTable.executionId, fixture.executionId));
      expect(episodeEvents.map((event) => event.eventType)).toEqual(
        expect.arrayContaining(["ACTION_REQUESTED", "ACTION_COMMITTED", "EFFECT_CLASSIFIED"]),
      );
      const [acceptance] = await db.select({ effectBundleId: aiExecutionAcceptancesTable.effectBundleId })
        .from(aiExecutionAcceptancesTable)
        .where(and(
          eq(aiExecutionAcceptancesTable.executionId, fixture.executionId),
          eq(aiExecutionAcceptancesTable.outcome, "SUCCEEDED"),
        ))
        .limit(1);
      expect(acceptance?.effectBundleId).toBe(bundle?.id);
    } finally {
      await fixture.cleanup();
    }
  });

  it("classifies a verified runtime after-state before successful acceptance", async () => {
    const projectId = crypto.randomUUID();
    const operationId = crypto.randomUUID();
    const sessionId = crypto.randomUUID();
    const userId = "runtime-recipe-effect-user";
    let sourceRevision: string;
    const rootPath = await mkdtemp(
      path.join(process.cwd(), ".engineeringos-delivery-test-runtime-replay-"),
    );
    await writeFile(
      path.join(rootPath, "package.json"),
      JSON.stringify({ scripts: { dev: "node server.mjs" } }),
    );
    await writeFile(
      path.join(rootPath, "server.mjs"),
      [
        "import http from 'node:http';",
        "import { existsSync, readFileSync, unlinkSync, writeFileSync } from 'node:fs';",
        "const revision = readFileSync('node_modules/.cache/revision.txt', 'utf8').trim();",
        "const replayMutationMarker = 'node_modules/.cache/mutate-next-replay';",
        "if (existsSync(replayMutationMarker)) { unlinkSync(replayMutationMarker); writeFileSync('.strategy-replay-mutated', 'mutated'); }",
        "const server = http.createServer((_req, res) => { res.setHeader('x-engineeringos-revision', revision); res.end('runtime-ready'); });",
        "server.listen(Number(process.env.PORT), '127.0.0.1');",
        "process.once('SIGTERM', () => server.close(() => process.exit(0)));",
      ].join("\n"),
    );
    await writeFile(path.join(rootPath, ".gitignore"), "node_modules/\n", "utf8");
    await execFileAsync("git", ["-C", rootPath, "init", "-q"]);
    await execFileAsync("git", ["-C", rootPath, "config", "user.name", "EngineeringOS Fixture"]);
    await execFileAsync("git", ["-C", rootPath, "config", "user.email", "fixture@example.com"]);
    await execFileAsync("git", ["-C", rootPath, "add", ".gitignore", "package.json", "server.mjs"]);
    await execFileAsync("git", ["-C", rootPath, "commit", "-qm", "runtime replay fixture"]);
    sourceRevision = (await execFileAsync("git", ["-C", rootPath, "rev-parse", "HEAD"])).stdout.trim();
    await mkdir(path.join(rootPath, "node_modules/.cache"), { recursive: true });
    await writeFile(
      path.join(rootPath, "node_modules/.cache/revision.txt"),
      `${sourceRevision}\n`,
      "utf8",
    );
    let manager = new WorkspaceRuntimeManager({
      store: createInMemoryWorkspaceRuntimeStore(),
      workerId: `runtime-recipe-test:${operationId}`,
    });
    let executionId: string | undefined;
    const executionIds: string[] = [];
    try {
      await db.insert(projectsTable).values({
        id: projectId,
        ownerId: userId,
        name: `runtime-recipe-${projectId.slice(0, 8)}`,
        rootPath,
        language: "typescript",
        status: "active",
        createdAt: new Date(),
        updatedAt: new Date(),
      });
      await db.insert(aiChatSessionsTable).values({
        id: sessionId,
        projectId,
        title: "Runtime recipe effect test",
        createdAt: new Date(),
        updatedAt: new Date(),
      });

      const result = await runRecipeOperation({
        projectId,
        operationId,
        sessionId,
        userId,
        idempotencyKey: `${operationId}:runtime-effect`,
        rootPath,
        sourceRevision,
        recipeId: "runtime.start",
        recipeVersion: 1,
        runtimeStartRunner: createRuntimeStartRunner(manager),
      });
      executionId = result.executionId;
      executionIds.push(result.executionId);
      expect(result.status).toBe("completed");

      const [bundle] = await db.select().from(aiAgentEffectBundlesTable)
        .where(eq(aiAgentEffectBundlesTable.executionId, executionId))
        .limit(1);
      expect(bundle).toMatchObject({ verdict: "OBSERVED" });
      const effects = await db.select().from(aiAgentEffectsTable)
        .where(eq(aiAgentEffectsTable.executionId, executionId));
      expect(effects).toHaveLength(1);
      expect(effects[0]).toMatchObject({
        capabilityId: "runtime.start",
        status: "observed",
      });
      const [acceptance] = await db.select({
        effectBundleId: aiExecutionAcceptancesTable.effectBundleId,
      }).from(aiExecutionAcceptancesTable).where(and(
        eq(aiExecutionAcceptancesTable.executionId, executionId),
        eq(aiExecutionAcceptancesTable.outcome, "SUCCEEDED"),
      )).limit(1);
      expect(acceptance?.effectBundleId).toBe(bundle?.id);
      const observations = await db.select().from(aiAgentObservationsTable)
        .where(eq(aiAgentObservationsTable.executionId, executionId));
      expect(observations.filter((row) => row.provenance === "DIRECT_OBSERVATION")).toHaveLength(2);
      const runtimeReceipt = observations.find((row) => row.sourceType === "runtime_receipt");
      const runtimeSnapshot = await manager.get(projectId);
      expect(runtimeReceipt?.value).toMatchObject({ sessionId: runtimeSnapshot.sessionId });
      expect(runtimeReceipt?.environmentRevision).toBe(runtimeSnapshot.environmentRevision);
      expect(runtimeReceipt?.environmentFreshness).toBe("fresh");
      const events = await db.select({ eventType: aiAgentEpisodeEventsTable.eventType })
        .from(aiAgentEpisodeEventsTable)
        .where(eq(aiAgentEpisodeEventsTable.executionId, executionId));
      expect(events.map((event) => event.eventType)).toEqual(
        expect.arrayContaining(["ACTION_REQUESTED", "ACTION_COMMITTED", "EFFECT_CLASSIFIED"]),
      );
      const [episode] = await db.select().from(aiAgentEpisodesTable)
        .where(eq(aiAgentEpisodesTable.executionId, executionId))
        .limit(1);
      expect(episode).toMatchObject({
        state: "completed",
        verdict: "achieved",
        reasonCode: "CANONICAL_PROOF_PROVEN",
      });
      const proofBinding = await materializeStrategyReplayCaseProofBinding({
        projectId,
        episodeId: episode!.id,
      });
      expect(proofBinding.status).toBe("verified");
      if (proofBinding.status === "verified") {
        expect(proofBinding.binding).toMatchObject({
          projectId,
          sourceRevision,
          sourceEpisodeId: episode!.id,
          executionId,
          attempt: 0,
          acceptanceId: expect.any(String),
          effectBundleId: expect.any(String),
        });
        expect(proofBinding.binding.sourceCanonicalProofHash).toMatch(
          /^[a-f0-9]{64}$/,
        );
        expect(await verifyStrategyReplayCaseProofBinding(proofBinding.binding))
          .toEqual(proofBinding);
        expect(await verifyStrategyReplayCaseProofBinding({
          ...proofBinding.binding,
          sourceCanonicalProofHash: "f".repeat(64),
        })).toEqual({
          status: "not_eligible",
          reason: "binding_mismatch",
        });
      }
      expect(await materializeStrategyReplayCaseProofBinding({
        projectId: crypto.randomUUID(),
        episodeId: episode!.id,
      })).toEqual({
        status: "not_eligible",
        reason: "episode_not_found",
      });
      const candidates = await db.select().from(aiStrategyCandidatesTable)
        .where(eq(aiStrategyCandidatesTable.projectId, projectId));
      expect(candidates).toHaveLength(1);
      expect(candidates[0]).toMatchObject({
        evaluationStatus: "discovered",
        confidence: "0",
        supportingEpisodeIds: [episode?.id],
      });
      expect(candidates[0]?.candidate).toMatchObject({
        triggerConditions: [{ kind: "server_recipe", recipeId: "runtime.start" }],
        preconditions: [
          "The runtime root and revision are server-owned.",
          "The current worker lease owns the runtime session.",
        ],
        observationRequirements: [{
          kind: "direct_before_after",
          profile: "RUNTIME",
          completeness: "complete",
          freshness: "fresh",
        }],
        recommendedActionOrder: ["runtime.start"],
        failureSemantics: [
          "A missing, stale, or unavailable after-state cannot produce PROVEN.",
          "A contradictory after-state requires a bounded failure or replan.",
        ],
        evaluationStatus: "discovered",
      });
      const extractionRetry = await extractAcceptedEpisodeStrategy({
        projectId,
        episodeId: episode!.id,
      });
      expect(extractionRetry).toMatchObject({
        status: "stored",
        created: false,
        candidateHash: candidates[0]?.candidateHash,
      });

      await manager.shutdown();
      const secondOperationId = crypto.randomUUID();
      manager = new WorkspaceRuntimeManager({
        store: createInMemoryWorkspaceRuntimeStore(),
        workerId: `runtime-recipe-test:${secondOperationId}`,
      });
      const secondResult = await runRecipeOperation({
        projectId,
        operationId: secondOperationId,
        sessionId,
        userId,
        idempotencyKey: `${secondOperationId}:runtime-effect`,
        rootPath,
        sourceRevision,
        recipeId: "runtime.start",
        recipeVersion: 1,
        runtimeStartRunner: createRuntimeStartRunner(manager),
      });
      executionIds.push(secondResult.executionId);
      expect(secondResult.status).toBe("completed");

      const candidatesAfterSecondSupport = await db.select().from(aiStrategyCandidatesTable)
        .where(eq(aiStrategyCandidatesTable.projectId, projectId));
      expect(candidatesAfterSecondSupport).toHaveLength(1);
      expect(candidatesAfterSecondSupport[0]).toMatchObject({
        evaluationStatus: "pending_replay",
        supportingEpisodeIds: expect.arrayContaining([episode?.id]),
      });
      expect(candidatesAfterSecondSupport[0]?.supportingEpisodeIds).toHaveLength(2);
      expect(candidatesAfterSecondSupport[0]?.candidate).toMatchObject({
        evaluationStatus: "pending_replay",
        supportingEpisodeIds: expect.arrayContaining([episode?.id]),
      });
      const replayAdmissionRetry = await extractAcceptedEpisodeStrategy({
        projectId,
        episodeId: episode!.id,
      });
      expect(replayAdmissionRetry).toMatchObject({
        status: "stored",
        candidate: { evaluationStatus: "pending_replay" },
        candidateHash: candidatesAfterSecondSupport[0]?.candidateHash,
      });

      const casesBeforeOptIn = await db.select().from(aiStrategyReplayCasesTable)
        .where(eq(aiStrategyReplayCasesTable.projectId, projectId));
      expect(casesBeforeOptIn).toHaveLength(0);
      const [projectBeforeOptIn] = await db.select().from(projectsTable)
        .where(eq(projectsTable.id, projectId));
      expect(projectBeforeOptIn?.strategyReplayOptIn).toBe(false);

      await db.update(projectsTable)
        .set({ strategyReplayOptIn: true })
        .where(eq(projectsTable.id, projectId));
      await manager.shutdown();
      const thirdOperationId = crypto.randomUUID();
      manager = new WorkspaceRuntimeManager({
        store: createInMemoryWorkspaceRuntimeStore(),
        workerId: `runtime-recipe-test:${thirdOperationId}`,
      });
      const thirdResult = await runRecipeOperation({
        projectId,
        operationId: thirdOperationId,
        sessionId,
        userId,
        idempotencyKey: `${thirdOperationId}:runtime-effect`,
        rootPath,
        sourceRevision,
        recipeId: "runtime.start",
        recipeVersion: 1,
        runtimeStartRunner: createRuntimeStartRunner(manager),
      });
      executionIds.push(thirdResult.executionId);
      expect(thirdResult.status).toBe("completed");

      const [thirdEpisode] = await db.select().from(aiAgentEpisodesTable).where(and(
        eq(aiAgentEpisodesTable.projectId, projectId),
        eq(aiAgentEpisodesTable.executionId, thirdResult.executionId),
      ));
      expect(thirdEpisode).toBeDefined();
      const registrationCheck = await registerProspectiveStrategyReplayCase({
        projectId,
        episodeId: thirdEpisode!.id,
      });
      if (registrationCheck.status === "skipped") {
        throw new Error(`Expected eligible replay case registration, received ${JSON.stringify(registrationCheck)}`);
      }
      expect(["registered", "already_registered"]).toContain(registrationCheck.status);

      const casesAfterOptIn = await db.select().from(aiStrategyReplayCasesTable)
        .where(eq(aiStrategyReplayCasesTable.projectId, projectId));
      expect(casesAfterOptIn).toHaveLength(1);
      expect(casesAfterOptIn[0]).toMatchObject({
        candidateId: candidatesAfterSecondSupport[0]?.id,
        sourceEpisodeId: expect.any(String),
      });
      expect(casesAfterOptIn[0]?.caseDefinition).toMatchObject({
        schemaVersion: 1,
        projectId,
        candidateId: candidatesAfterSecondSupport[0]?.id,
        candidateHash: candidatesAfterSecondSupport[0]?.candidateHash,
        sourceRevision,
        sourceEpisodeId: casesAfterOptIn[0]?.sourceEpisodeId,
        sourceExecutionId: thirdResult.executionId,
        recipeId: "runtime.start",
        actionContractHash: expect.stringMatching(/^[a-f0-9]{64}$/),
        sourceCanonicalProofHash: expect.stringMatching(/^[a-f0-9]{64}$/),
      });
      expect(casesAfterOptIn[0]?.caseDefinition).not.toHaveProperty("prompt");
      expect(casesAfterOptIn[0]?.caseDefinition).not.toHaveProperty("chatText");
      expect(casesAfterOptIn[0]?.caseDefinition).not.toHaveProperty("sourceContents");

      const candidateAfterThirdEpisode = await db.select().from(aiStrategyCandidatesTable)
        .where(eq(aiStrategyCandidatesTable.projectId, projectId));
      expect(candidateAfterThirdEpisode[0]?.supportingEpisodeIds).toHaveLength(2);
      expect(candidateAfterThirdEpisode[0]?.supportingEpisodeIds)
        .not.toContain(casesAfterOptIn[0]?.sourceEpisodeId);
      await expect(registerProspectiveStrategyReplayCase({
        projectId,
        episodeId: casesAfterOptIn[0]!.sourceEpisodeId,
      })).resolves.toMatchObject({ status: "already_registered" });
      await expect(db.transaction((tx) =>
        deleteUnreplayedStrategyReplayCases(tx, projectId),
      )).resolves.toBe(1);
      expect(await db.select().from(aiStrategyReplayCasesTable)
        .where(eq(aiStrategyReplayCasesTable.projectId, projectId))).toHaveLength(0);
      const replayRegistration = await registerProspectiveStrategyReplayCase({
        projectId,
        episodeId: thirdEpisode!.id,
      });
      expect(["registered", "already_registered"]).toContain(replayRegistration.status);
      const [registeredReplayCase] = await db.select().from(aiStrategyReplayCasesTable)
        .where(eq(aiStrategyReplayCasesTable.projectId, projectId));
      expect(registeredReplayCase).toBeDefined();

      const replayResult = await runRegisteredStrategyReplayCase({
        projectId,
        caseRegistrationId: registeredReplayCase!.id,
        userId,
      });
      expect(replayResult.status, JSON.stringify(replayResult.receipt, null, 2)).toBe("proven");
      expect(replayResult.recovered).toBe(false);
      expect(replayResult.receipt).toMatchObject({
        status: "proven",
        partition: "held_out",
        projectId,
        caseRegistrationId: registeredReplayCase!.id,
        candidateId: candidateAfterThirdEpisode[0]?.id,
        candidateHash: candidateAfterThirdEpisode[0]?.candidateHash,
        sourceEpisodeId: registeredReplayCase!.sourceEpisodeId,
        sourceExecutionId: thirdResult.executionId,
        replayExecutionId: expect.any(String),
        replayEpisodeId: expect.any(String),
        replayAcceptanceId: expect.any(String),
        replayEffectBundleId: expect.any(String),
        replayCanonicalProofHash: expect.stringMatching(/^[a-f0-9]{64}$/),
        workspaceTreeHash: expect.stringMatching(/^[a-f0-9]{64}$/),
      });
      expect(replayResult.receipt.replayExecutionId).not.toBe(thirdResult.executionId);
      expect(replayResult.receipt.replayEpisodeId).not.toBe(registeredReplayCase!.sourceEpisodeId);
      expect(replayResult.receipt.replayAcceptanceId).not.toBe(
        (registeredReplayCase!.caseDefinition as { acceptanceId: string }).acceptanceId,
      );
      expect(replayResult.receipt.replayEffectBundleId).not.toBe(
        (registeredReplayCase!.caseDefinition as { effectBundleId: string }).effectBundleId,
      );
      expect(replayResult.receipt.replayCanonicalProofHash).not.toBe(
        (registeredReplayCase!.caseDefinition as { sourceCanonicalProofHash: string }).sourceCanonicalProofHash,
      );

      const replayExecutionId = replayResult.receipt.replayExecutionId!;
      executionIds.push(replayExecutionId);
      const [replayEpisode] = await db.select().from(aiAgentEpisodesTable).where(and(
        eq(aiAgentEpisodesTable.projectId, projectId),
        eq(aiAgentEpisodesTable.id, replayResult.receipt.replayEpisodeId!),
      ));
      expect(replayEpisode).toMatchObject({
        executionId: replayExecutionId,
        projectRevision: sourceRevision,
      });
      expect(replayEpisode?.scope).toMatchObject({
        strategyReplayCase: {
          caseRegistrationId: registeredReplayCase!.id,
          caseId: (registeredReplayCase!.caseDefinition as { caseId: string }).caseId,
          candidateId: candidateAfterThirdEpisode[0]?.id,
          candidateHash: candidateAfterThirdEpisode[0]?.candidateHash,
          sourceEpisodeId: registeredReplayCase!.sourceEpisodeId,
          sourceCanonicalProofHash:
            (registeredReplayCase!.caseDefinition as { sourceCanonicalProofHash: string }).sourceCanonicalProofHash,
        },
      });

      const runsAfterReplay = await db.select().from(aiStrategyReplayCaseRunsTable)
        .where(eq(aiStrategyReplayCaseRunsTable.caseRegistrationId, registeredReplayCase!.id));
      expect(runsAfterReplay).toHaveLength(1);
      expect(runsAfterReplay[0]).toMatchObject({
        status: "proven",
        replayExecutionId,
        replayEpisodeId: replayResult.receipt.replayEpisodeId,
        replayAttempt: replayResult.receipt.replayAttempt,
      });
      expect(runsAfterReplay[0]?.receipt).toEqual(replayResult.receipt);

      const episodesBeforeRecovery = await db.select({ id: aiAgentEpisodesTable.id })
        .from(aiAgentEpisodesTable).where(eq(aiAgentEpisodesTable.projectId, projectId));
      const executionsBeforeRecovery = await db.select({ id: aiExecutionsTable.id })
        .from(aiExecutionsTable).where(eq(aiExecutionsTable.projectId, projectId));
      const recoveredReplay = await runRegisteredStrategyReplayCase({
        projectId,
        caseRegistrationId: registeredReplayCase!.id,
        userId,
      });
      expect(recoveredReplay).toEqual({
        status: "proven",
        receipt: replayResult.receipt,
        recovered: true,
      });
      expect(await db.select({ id: aiAgentEpisodesTable.id }).from(aiAgentEpisodesTable)
        .where(eq(aiAgentEpisodesTable.projectId, projectId))).toHaveLength(episodesBeforeRecovery.length);
      expect(await db.select({ id: aiExecutionsTable.id }).from(aiExecutionsTable)
        .where(eq(aiExecutionsTable.projectId, projectId))).toHaveLength(executionsBeforeRecovery.length);
      expect(await db.select().from(aiStrategyReplayCaseRunsTable)
        .where(eq(aiStrategyReplayCaseRunsTable.caseRegistrationId, registeredReplayCase!.id)))
        .toHaveLength(1);

      await expect(runRegisteredStrategyReplayCase({
        projectId: crypto.randomUUID(),
        caseRegistrationId: registeredReplayCase!.id,
        userId,
      })).rejects.toThrow("Registered Strategy Replay case is not eligible.");
      await expect(db.transaction((tx) =>
        deleteUnreplayedStrategyReplayCases(tx, projectId),
      )).resolves.toBe(0);
      const candidateAfterReplay = await db.select().from(aiStrategyCandidatesTable)
        .where(eq(aiStrategyCandidatesTable.projectId, projectId));
      expect(candidateAfterReplay[0]).toMatchObject({
        evaluationStatus: "pending_replay",
        supportingEpisodeIds: candidateAfterThirdEpisode[0]?.supportingEpisodeIds,
      });
      expect(candidateAfterReplay[0]?.supportingEpisodeIds)
        .not.toContain(replayResult.receipt.replayEpisodeId);

      const createNextRegisteredReplayCase = async () => {
        await manager.shutdown();
        const nextOperationId = crypto.randomUUID();
        manager = new WorkspaceRuntimeManager({
          store: createInMemoryWorkspaceRuntimeStore(),
          workerId: `runtime-recipe-test:${nextOperationId}`,
        });
        const nextResult = await runRecipeOperation({
          projectId,
          operationId: nextOperationId,
          sessionId,
          userId,
          idempotencyKey: `${nextOperationId}:runtime-effect`,
          rootPath,
          sourceRevision,
          recipeId: "runtime.start",
          recipeVersion: 1,
          runtimeStartRunner: createRuntimeStartRunner(manager),
        });
        executionIds.push(nextResult.executionId);
        expect(nextResult.status).toBe("completed");
        const [sourceEpisode] = await db.select().from(aiAgentEpisodesTable).where(and(
          eq(aiAgentEpisodesTable.projectId, projectId),
          eq(aiAgentEpisodesTable.executionId, nextResult.executionId),
        )).limit(1);
        expect(sourceEpisode).toBeDefined();
        const [replayCase] = await db.select().from(aiStrategyReplayCasesTable).where(and(
          eq(aiStrategyReplayCasesTable.projectId, projectId),
          eq(aiStrategyReplayCasesTable.sourceEpisodeId, sourceEpisode!.id),
        )).limit(1);
        expect(replayCase).toBeDefined();
        return replayCase!;
      };

      const dirtySourceCase = await createNextRegisteredReplayCase();
      const dirtySourceMarker = path.join(rootPath, "dirty-source-marker.txt");
      await writeFile(dirtySourceMarker, "dirty\n", "utf8");
      const dirtySourceReplay = await runRegisteredStrategyReplayCase({
        projectId,
        caseRegistrationId: dirtySourceCase.id,
        userId,
      });
      expect(dirtySourceReplay).toMatchObject({
        status: "incomplete",
        recovered: false,
        receipt: {
          incompleteReason: "source_revision_mismatch",
          replayExecutionId: null,
          replayCanonicalProofHash: null,
        },
      });
      await rm(dirtySourceMarker, { force: true });

      const mutatedWorkspaceCase = await createNextRegisteredReplayCase();
      await writeFile(
        path.join(rootPath, "node_modules/.cache/mutate-next-replay"),
        "mutate\n",
        "utf8",
      );
      const mutatedWorkspaceReplay = await runRegisteredStrategyReplayCase({
        projectId,
        caseRegistrationId: mutatedWorkspaceCase.id,
        userId,
      });
      expect(mutatedWorkspaceReplay).toMatchObject({
        status: "incomplete",
        recovered: false,
        receipt: {
          incompleteReason: "replay_identity_mismatch",
          replayExecutionId: expect.any(String),
          replayEpisodeId: expect.any(String),
          replayCanonicalProofHash: null,
        },
      });
      if (mutatedWorkspaceReplay.receipt.replayExecutionId) {
        executionIds.push(mutatedWorkspaceReplay.receipt.replayExecutionId);
      }

      const changedHeadCase = await createNextRegisteredReplayCase();
      await writeFile(path.join(rootPath, "head-change-marker.txt"), "new head\n", "utf8");
      await execFileAsync("git", ["-C", rootPath, "add", "head-change-marker.txt"]);
      await execFileAsync("git", ["-C", rootPath, "commit", "-qm", "replay revision drift fixture"]);
      const changedHeadReplay = await runRegisteredStrategyReplayCase({
        projectId,
        caseRegistrationId: changedHeadCase.id,
        userId,
      });
      expect(changedHeadReplay).toMatchObject({
        status: "incomplete",
        recovered: false,
        receipt: {
          incompleteReason: "source_revision_mismatch",
          replayExecutionId: null,
          replayCanonicalProofHash: null,
        },
      });

      const candidateAfterFailClosedCases = await db.select().from(aiStrategyCandidatesTable)
        .where(eq(aiStrategyCandidatesTable.projectId, projectId));
      expect(candidateAfterFailClosedCases[0]).toMatchObject({
        evaluationStatus: "pending_replay",
        supportingEpisodeIds: candidateAfterThirdEpisode[0]?.supportingEpisodeIds,
      });
      expect(candidateAfterFailClosedCases[0]?.supportingEpisodeIds)
        .not.toContain(mutatedWorkspaceReplay.receipt.replayEpisodeId);
    } finally {
      await manager.shutdown();
      for (const executionId of executionIds) {
        await db.delete(aiExecutionAcceptancesTable).where(eq(aiExecutionAcceptancesTable.executionId, executionId));
        await db.delete(aiExecutionsTable).where(eq(aiExecutionsTable.id, executionId));
      }
      await db.delete(aiChatSessionsTable).where(eq(aiChatSessionsTable.id, sessionId));
      await db.delete(projectsTable).where(eq(projectsTable.id, projectId));
      await rm(rootPath, { recursive: true, force: true });
    }
  });

  it("replays browser verification without losing its accepted effect bundle", async () => {
    const fixture = await createGateCRecipeFixture("browser.verify", ["package.json"]);
    let executionId: string | undefined;
    const browserCalls: Array<{ profile: string; operationId?: string; revision?: string }> = [];
    const params = {
      ...fixture.params,
      browserValidationRunner: async ({ profile, operationId: runnerOperationId, revision }: {
        profile: string;
        operationId?: string;
        revision?: string;
      }) => {
        browserCalls.push({ profile, operationId: runnerOperationId, revision });
        return {
          profile,
          status: "passed" as const,
          scenario: "registered browser profile passed",
          exitCode: 0,
          command: "server-owned browser profile",
          stdout: "",
          stderr: "",
          failedTests: [],
          changedFiles: [],
          evidence: {
            evidenceId: `browser:${runnerOperationId}`,
            observedAt: new Date().toISOString(),
            artifactRef: `browser-preview:${runnerOperationId}`,
            profileName: profile,
            revision,
            operationId: runnerOperationId,
          },
        };
      },
    };
    try {
      const completed = await runRecipeOperation(params);
      executionId = completed.executionId;
      expect(completed.status).toBe("completed");
      const bundleId = await assertSuccessfulGateCEffect(executionId, "browser.verify.default");
      expect(browserCalls).toEqual([{
        profile: "default",
        operationId: fixture.params.operationId,
        revision: fixture.params.sourceRevision,
      }]);

      const replay = await runRecipeOperation(params);
      expect(replay).toMatchObject({
        executionId,
        status: "completed",
        receipt: { status: "completed" },
      });
      expect(await assertSuccessfulGateCEffect(executionId, "browser.verify.default")).toBe(bundleId);
      expect(browserCalls).toHaveLength(1);
    } finally {
      await fixture.cleanup(executionId);
    }
  });

  it("replays GitHub delivery without duplicating it or detaching acceptance proof", async () => {
    const fixture = await createGateCRecipeFixture("delivery.push.github");
    let executionId: string | undefined;
    const deliveryCalls: string[] = [];
    const params = {
      ...fixture.params,
      githubDeliveryRunner: async ({ projectId, operationId, message }: {
        projectId: string;
        operationId: string;
        message: string;
      }) => {
        deliveryCalls.push(`${projectId}:${operationId}:${message}`);
        return {
          status: "passed" as const,
          evidence: {
            evidenceId: `delivery:${operationId}`,
            resultHash: "d".repeat(64),
            artifactRef: `github-delivery:${operationId}`,
          },
          remoteCommitHash: "remote-commit",
          remoteParentHash: "parent-commit",
          remoteTreeHash: "remote-tree",
          operationMarker: `EngineeringOS-Operation: ${operationId}`,
        };
      },
    };
    try {
      const completed = await runRecipeOperation(params);
      executionId = completed.executionId;
      expect(completed.status).toBe("completed");
      const bundleId = await assertSuccessfulGateCEffect(executionId, "github.push_verified_commit");
      expect(deliveryCalls).toEqual([
        `${fixture.params.projectId}:${fixture.params.operationId}:Deliver the verified proposal`,
      ]);

      const replay = await runRecipeOperation(params);
      expect(replay).toMatchObject({
        executionId,
        status: "completed",
        receipt: { status: "completed" },
      });
      expect(await assertSuccessfulGateCEffect(executionId, "github.push_verified_commit")).toBe(bundleId);
      expect(deliveryCalls).toHaveLength(1);
    } finally {
      await fixture.cleanup(executionId);
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

  it("does not abort a live worker when an older async checkpoint loses a sequence race", async () => {
    validationCalls.length = 0;
    const fixture = await createReclaimedRecipeFixture();
    const realCheckpoint = aiExecutionState.checkpointAiExecution;
    const realComplete = aiExecutionState.completeAiExecution;
    let checkpointCalls = 0;
    let releaseFirst!: () => void;
    let resolveFirstFinished!: () => void;
    let resolveSecondFinished!: () => void;
    const firstBlocked = new Promise<void>((resolve) => {
      releaseFirst = resolve;
    });
    const firstFinished = new Promise<void>((resolve) => {
      resolveFirstFinished = resolve;
    });
    const secondFinished = new Promise<void>((resolve) => {
      resolveSecondFinished = resolve;
    });
    const checkpointSpy = vi.spyOn(aiExecutionState, "checkpointAiExecution").mockImplementation(async (checkpoint) => {
      const call = ++checkpointCalls;
      if (call === 1) await firstBlocked;
      const accepted = await realCheckpoint(checkpoint);
      if (call === 1) resolveFirstFinished();
      if (call === 2) {
        resolveSecondFinished();
        releaseFirst();
      }
      return accepted;
    });
    const completeSpy = vi.spyOn(aiExecutionState, "completeAiExecution").mockImplementation(async (params) => {
      await firstFinished;
      return realComplete(params);
    });
    try {
      const result = await runRecipeOperation(fixture.params);
      await secondFinished;
      expect(checkpointCalls).toBeGreaterThanOrEqual(2);
      expect(result.status).toBe("completed");
      expect(validationCalls).toEqual(["ai-orchestrator-tests"]);
    } finally {
      releaseFirst();
      checkpointSpy.mockRestore();
      completeSpy.mockRestore();
      await fixture.cleanup();
    }
  });

  it("exposes a cancellation race after all nodes pass but before terminal acceptance", async () => {
    validationCalls.length = 0;
    const fixture = await createReclaimedRecipeFixture();
    const realComplete = aiExecutionState.completeAiExecution;
    let signalCompletionEntered!: () => void;
    let releaseCompletion!: () => void;
    const completionEntered = new Promise<void>((resolve) => {
      signalCompletionEntered = resolve;
    });
    const completionReleased = new Promise<void>((resolve) => {
      releaseCompletion = resolve;
    });
    const completeSpy = vi.spyOn(aiExecutionState, "completeAiExecution").mockImplementation(async (params) => {
      signalCompletionEntered();
      await completionReleased;
      return realComplete(params);
    });
    try {
      const running = runRecipeOperation(fixture.params);
      await completionEntered;
      const cancelling = await requestAiExecutionCancel({
        executionId: fixture.executionId,
        userId: fixture.params.userId,
      });
      expect(cancelling).toMatchObject({
        id: fixture.executionId,
        status: "cancelling",
      });
      releaseCompletion();

      const result = await running;
      expect(result.status).toBe("blocked");
      expect(result.receipt.status).toBe("cancelled");
      expect(validationCalls).toEqual(["ai-orchestrator-tests"]);
      const [execution] = await db
        .select({
          status: aiExecutionsTable.status,
          recipeReceipt: aiExecutionsTable.recipeReceipt,
          checkpoint: aiExecutionsTable.checkpoint,
        })
        .from(aiExecutionsTable)
        .where(eq(aiExecutionsTable.id, fixture.executionId))
        .limit(1);
      expect(execution?.status).toBe("cancelled");
      expect(execution?.recipeReceipt).toMatchObject({ status: "cancelled" });
      expect(JSON.parse(execution!.checkpoint ?? "{}")).toMatchObject({
        stage: "cancelled",
        detail: "Recipe execution was cancelled before terminal acceptance.",
      });
      const [acceptance] = await db
        .select({
          terminalStatus: aiExecutionAcceptancesTable.terminalStatus,
          outcome: aiExecutionAcceptancesTable.outcome,
          reasonCode: aiExecutionAcceptancesTable.reasonCode,
        })
        .from(aiExecutionAcceptancesTable)
        .where(eq(aiExecutionAcceptancesTable.executionId, fixture.executionId))
        .orderBy(desc(aiExecutionAcceptancesTable.attempt))
        .limit(1);
      expect(acceptance).toMatchObject({
        terminalStatus: "cancelled",
        outcome: "INTERRUPTED",
        reasonCode: "EXECUTION_CANCELLED",
      });
    } finally {
      releaseCompletion();
      completeSpy.mockRestore();
      await fixture.cleanup();
    }
  });

  it("returns the cancelled receipt when reconciliation terminalizes cancellation before the worker fallback", async () => {
    validationCalls.length = 0;
    const fixture = await createReclaimedRecipeFixture();
    const realComplete = aiExecutionState.completeAiExecution;
    const completeSpy = vi.spyOn(aiExecutionState, "completeAiExecution").mockImplementation(async (params) => {
      const cancelling = await requestAiExecutionCancel({
        executionId: fixture.executionId,
        userId: fixture.params.userId,
      });
      expect(cancelling).toMatchObject({
        id: fixture.executionId,
        status: "cancelling",
      });
      expect(await reconcileAiExecutions({ expiredOnly: true })).toBe(1);
      return realComplete(params);
    });
    try {
      const result = await runRecipeOperation(fixture.params);
      expect(result.status).toBe("blocked");
      expect(result.receipt.status).toBe("cancelled");
      expect(validationCalls).toEqual(["ai-orchestrator-tests"]);

      const [execution] = await db
        .select({
          status: aiExecutionsTable.status,
          recipeReceipt: aiExecutionsTable.recipeReceipt,
        })
        .from(aiExecutionsTable)
        .where(eq(aiExecutionsTable.id, fixture.executionId))
        .limit(1);
      expect(execution).toMatchObject({
        status: "cancelled",
        recipeReceipt: { status: "cancelled" },
      });
    } finally {
      completeSpy.mockRestore();
      await fixture.cleanup();
    }
  });
});