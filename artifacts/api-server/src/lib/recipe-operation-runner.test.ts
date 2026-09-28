import { execFile } from "node:child_process";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import { and, asc, desc, eq, inArray, lt } from "drizzle-orm";
import { describe, expect, it, vi } from "vitest";
import {
  aiAgentEffectBundlesTable,
  aiAgentEffectsTable,
  aiAgentEpisodeEventsTable,
  aiAgentEpisodesTable,
  aiAgentObservationsTable,
  aiExecutionAcceptancesTable,
  aiExecutionsTable,
  aiGoalsTable,
  aiMissionsTable,
  aiWorldTransitionsTable,
  aiChatSessionsTable,
  aiStrategyCandidatesTable,
  aiStrategyReplayCaseRunsTable,
  aiStrategyReplayCasesTable,
  aiWorldFactsTable,
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
import {
  appendEpisodeEvent,
  startEpisode,
} from "./agent-state/agent-episode-ledger.js";
import { materializeServerOwnedObservations } from "./agent-state/observation-materializer.js";
import { buildRuntimeStartHypothesisExperimentRegistration } from "./agent-state/runtime-start-hypothesis-experiment.js";
import { runRuntimeStartHypothesisMeasurementContinuation } from "./agent-state/runtime-start-hypothesis-measurement-continuation-runner.js";
import {
  captureEnvironmentAttestation,
  serverEnvironmentProfile,
} from "./agent-state/environment-attestation.js";
import { HOST_DISPOSABLE_TEMP_ROOT } from "./disposable-temp.js";
import {
  createRuntimeStartRunner,
  prepareRecipeOperation,
  runRecipeOperation,
} from "./recipe-operation-runner.js";
import { WorkspaceRuntimeManager } from "./workspace-runtime.js";
import { createInMemoryWorkspaceRuntimeStore } from "./workspace-runtime-store.js";
import { readWorldStateForDecision } from "./agent-state/runtime-start-transition.js";
import * as worldState from "./agent-state/world-state.js";
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
const validationEvidenceContexts: unknown[] = [];
const execFileAsync = promisify(execFile);

vi.mock("./ai-repair-validation.js", async () => {
  const actual = await vi.importActual<typeof import("./ai-repair-validation.js")>(
    "./ai-repair-validation.js",
  );
  return {
    ...actual,
    runRepairValidation: vi.fn(async (
      _rootPath: string,
      profile: string,
      _targetPaths?: string[],
      _signal?: AbortSignal,
      _pendingChanges?: unknown,
      evidenceContext?: unknown,
    ) => {
      validationCalls.push(profile);
      validationEvidenceContexts.push(evidenceContext);
      return {
        status: "passed",
        profile,
        detail: `mock validation for ${profile}`,
        evidence: {
          evidenceId: `mock-evidence-${validationCalls.length}`,
          observedAt: new Date().toISOString(),
          artifactRef: `mock-validation:${profile}`,
          environmentRevision: "env-v1:recipe-test",
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

async function createDatabaseReadRecipeFixture() {
  const projectId = crypto.randomUUID();
  const operationId = crypto.randomUUID();
  const sessionId = crypto.randomUUID();
  const userId = `recipe-database-read-user:${projectId}`;
  const sourceRevision = `recipe-database-read-revision:${projectId}`;
  const now = new Date();
  await db.insert(projectsTable).values({
    id: projectId,
    ownerId: userId,
    name: `recipe-database-read-${projectId.slice(0, 8)}`,
    rootPath: process.cwd(),
    language: "typescript",
    status: "active",
    createdAt: now,
    updatedAt: now,
  });
  await db.insert(aiChatSessionsTable).values({
    id: sessionId,
    projectId,
    title: "Database read recipe invocation test",
    createdAt: now,
    updatedAt: now,
  });
  return {
    params: {
      projectId,
      operationId,
      sessionId,
      userId,
      idempotencyKey: `${operationId}:database-read`,
      rootPath: process.cwd(),
      sourceRevision,
      recipeId: "database.inspect.project",
      recipeVersion: 1,
    },
    cleanup: async () => {
      const executions = await db.select({ id: aiExecutionsTable.id })
        .from(aiExecutionsTable)
        .where(eq(aiExecutionsTable.projectId, projectId));
      for (const execution of executions) {
        await db.delete(aiExecutionAcceptancesTable)
          .where(eq(aiExecutionAcceptancesTable.executionId, execution.id));
        await db.delete(aiAgentEpisodeEventsTable)
          .where(eq(aiAgentEpisodeEventsTable.executionId, execution.id));
        await db.delete(aiAgentObservationsTable)
          .where(eq(aiAgentObservationsTable.executionId, execution.id));
        await db.delete(aiAgentEpisodesTable)
          .where(eq(aiAgentEpisodesTable.executionId, execution.id));
      }
      await db.delete(aiExecutionsTable).where(eq(aiExecutionsTable.projectId, projectId));
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
  expect(observations.filter((row) => row.provenance === "DIRECT_OBSERVATION")).toHaveLength(3);
  const events = await db.select({
    eventType: aiAgentEpisodeEventsTable.eventType,
    payload: aiAgentEpisodeEventsTable.payload,
  })
    .from(aiAgentEpisodeEventsTable)
    .where(eq(aiAgentEpisodeEventsTable.executionId, executionId));
  expect(events.map((event) => event.eventType)).toEqual(
    expect.arrayContaining(["ACTION_REQUESTED", "ACTION_COMMITTED", "EFFECT_CLASSIFIED"]),
  );
  const requestedAction = (
    events.find((event) => event.eventType === "ACTION_REQUESTED")?.payload as {
      action?: {
        actionId?: string;
        capabilityId?: string;
        episodeId?: string;
        expectedEffects?: string[];
      };
    } | undefined
  )?.action;
  expect(requestedAction).toMatchObject({
    actionId: expect.any(String),
    capabilityId,
    episodeId: expect.any(String),
    expectedEffects: [expect.any(String)],
  });
  if (!requestedAction?.actionId || !requestedAction.expectedEffects?.[0]) {
    throw new Error("Recipe ACTION_REQUESTED event did not retain its canonical action.");
  }
  const [episode] = await db.select().from(aiAgentEpisodesTable)
    .where(eq(aiAgentEpisodesTable.executionId, executionId))
    .limit(1);
  expect(episode?.actionRefs).toContain(requestedAction.actionId);
  expect(episode?.expectedEffectRefs).toContain(requestedAction.expectedEffects[0]);
  return bundle?.id;
}

describe("read-only recipe invocation events", () => {
  it("records a database read invocation before exposing data on its canonical Episode", async () => {
    const fixture = await createDatabaseReadRecipeFixture();
    try {
      const result = await runRecipeOperation({
        ...fixture.params,
        databaseReadRunner: async ({ projectId, operationId, resource }) => {
          const episodes = await db.select({ id: aiAgentEpisodesTable.id })
            .from(aiAgentEpisodesTable)
            .where(eq(aiAgentEpisodesTable.projectId, projectId));
          expect(episodes).toHaveLength(1);
          const episodeId = episodes[0]?.id;
          if (!episodeId) throw new Error("read-only recipe Episode was not created");
          const requests = await db.select({ id: aiAgentEpisodeEventsTable.id })
            .from(aiAgentEpisodeEventsTable)
            .where(and(
              eq(aiAgentEpisodeEventsTable.episodeId, episodeId),
              eq(aiAgentEpisodeEventsTable.eventType, "OBSERVATION_REQUESTED"),
            ));
          expect(requests).toHaveLength(1);
          return {
            status: "passed",
            rows: [{ id: projectId, resource }],
            evidence: {
              evidenceId: `database-read:${operationId}`,
              resultHash: "database-read-result-hash",
            },
          };
        },
      });
      expect(result.status).toBe("completed");

      const events = await db.select({
        episodeId: aiAgentEpisodeEventsTable.episodeId,
        eventType: aiAgentEpisodeEventsTable.eventType,
        payload: aiAgentEpisodeEventsTable.payload,
      }).from(aiAgentEpisodeEventsTable)
        .where(eq(aiAgentEpisodeEventsTable.executionId, result.executionId));
      const requested = events.find((event) => event.eventType === "OBSERVATION_REQUESTED");
      const recorded = events.find((event) => event.eventType === "OBSERVATION_RECORDED");
      const created = events.find((event) => event.eventType === "EPISODE_CREATED");
      const terminal = events.find((event) => event.eventType === "EPISODE_TERMINAL");
      expect(requested).toBeDefined();
      expect(recorded).toBeDefined();
      expect(created).toBeDefined();
      expect(terminal).toBeDefined();
      expect(events.filter((event) => event.eventType === "OBSERVATION_REQUESTED")).toHaveLength(1);
      expect(events.filter((event) => event.eventType === "OBSERVATION_RECORDED")).toHaveLength(1);
      expect(events.filter((event) => event.eventType === "EPISODE_CREATED")).toHaveLength(1);
      expect(events.filter((event) => event.eventType === "EPISODE_TERMINAL")).toHaveLength(1);
      expect(recorded?.episodeId).toBe(requested?.episodeId);
      expect(created?.episodeId).toBe(requested?.episodeId);
      expect(terminal?.episodeId).toBe(requested?.episodeId);
      expect(terminal?.payload).toMatchObject({
        verdict: "achieved",
        reasonCode: "READ_ONLY_INVOCATIONS_RECORDED",
      });
      expect(events.filter((event) => [
        "ACTION_REQUESTED",
        "ACTION_COMMITTED",
        "EFFECT_CLASSIFIED",
      ].includes(event.eventType))).toHaveLength(0);

      const requestPayload = requested!.payload as Record<string, unknown>;
      const resultPayload = recorded!.payload as Record<string, unknown>;
      expect(requestPayload).toMatchObject({
        contractVersion: 1,
        recordKind: "recipe_capability_invocation",
        nodeId: "recipe:database.inspect.project:read-project-data",
        nodeAttempt: 1,
        capabilityId: "database.read_project",
        recipeVersion: 1,
        projectRevision: fixture.params.sourceRevision,
        capabilityRevision: fixture.params.sourceRevision,
        scope: expect.any(Object),
        scopeHash: expect.stringMatching(/^[a-f0-9]{64}$/),
        inputHash: expect.stringMatching(/^[a-f0-9]{64}$/),
        invocationId: expect.stringMatching(/^[a-f0-9]{64}$/),
      });
      expect(resultPayload).toMatchObject({
        ...requestPayload,
        outcome: "completed",
        capabilityStatus: "passed",
        resultHash: expect.stringMatching(/^[a-f0-9]{64}$/),
        evidenceRefs: [`database-read:${fixture.params.operationId}`],
      });
      expect(JSON.stringify(resultPayload)).not.toContain('"rows"');

      const episodes = await db.select({
        id: aiAgentEpisodesTable.id,
        state: aiAgentEpisodesTable.state,
        verdict: aiAgentEpisodesTable.verdict,
        evidenceRefs: aiAgentEpisodesTable.evidenceRefs,
      }).from(aiAgentEpisodesTable)
        .where(eq(aiAgentEpisodesTable.executionId, result.executionId));
      expect(episodes).toHaveLength(1);
      const [episode] = episodes;
      expect(episode).toMatchObject({
        id: requested?.episodeId,
        state: "completed",
        verdict: "achieved",
      });
      expect(episode?.evidenceRefs).toContain(`database-read:${fixture.params.operationId}`);
      const effects = await db.select().from(aiAgentEffectsTable)
        .where(eq(aiAgentEffectsTable.executionId, result.executionId));
      const effectBundles = await db.select().from(aiAgentEffectBundlesTable)
        .where(eq(aiAgentEffectBundlesTable.executionId, result.executionId));
      expect(effects).toHaveLength(0);
      expect(effectBundles).toHaveLength(0);
    } finally {
      await fixture.cleanup();
    }
  });

  it("records a failed database read without persisting its detail text", async () => {
    const fixture = await createDatabaseReadRecipeFixture();
    try {
      const result = await runRecipeOperation({
        ...fixture.params,
        databaseReadRunner: async ({ resource }) => ({
          status: "unavailable",
          resource,
          detail: "sensitive database failure detail",
        }),
      });
      expect(result.status).toBe("blocked");

      const events = await db.select({
        eventType: aiAgentEpisodeEventsTable.eventType,
        payload: aiAgentEpisodeEventsTable.payload,
      }).from(aiAgentEpisodeEventsTable)
        .where(eq(aiAgentEpisodeEventsTable.executionId, result.executionId));
      const requested = events.find((event) => event.eventType === "OBSERVATION_REQUESTED");
      const recorded = events.find((event) => event.eventType === "OBSERVATION_RECORDED");
      expect(requested).toBeDefined();
      expect(recorded?.payload).toMatchObject({
        outcome: "failed",
        capabilityStatus: "unavailable",
        failureCode: "CAPABILITY_RESULT_NOT_PASSED",
        evidenceRefs: [],
      });
      expect(JSON.stringify(recorded?.payload)).not.toContain("sensitive database failure detail");
    } finally {
      await fixture.cleanup();
    }
  });
});

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

  it("does not infer a stopped runtime from a missing independent inventory", async () => {
    const manager = new WorkspaceRuntimeManager({
      store: createInMemoryWorkspaceRuntimeStore(),
    });
    const state = await manager.observeStartBeforeState({
      projectId: "project-runtime-unknown",
      revision: "revision-runtime",
    });
    expect(state).toMatchObject({
      status: "unavailable",
      runtimeStatus: "unknown",
      inventoryComplete: false,
    });
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

  it("bounds runtime.start when the parent World State revision is unavailable", async () => {
    const fixture = await createGateCRecipeFixture("browser.verify");
    const manager = new WorkspaceRuntimeManager({
      store: createInMemoryWorkspaceRuntimeStore(),
      startPreStateObserver: async ({ projectId, revision }) => ({
        status: "observed",
        runtimeStatus: "stopped",
        projectId,
        revision,
        sessionId: null,
        pid: null,
        port: null,
        processAlive: false,
        portReady: false,
        source: "test_observer",
        inventoryComplete: true,
        unknownListenerPorts: [],
        observedAt: new Date().toISOString(),
        detail: "Independent test pre-state confirms no runtime is running.",
      }),
    });
    const startSpy = vi.spyOn(manager, "start");
    const worldStateSpy = vi.spyOn(worldState, "getProjectWorldState")
      .mockRejectedValue(new Error("parent World State revision unavailable"));
    let executionId: string | undefined;
    try {
      const result = await runRecipeOperation({
        ...fixture.params,
        recipeId: "runtime.start",
        runtimeStartRunner: createRuntimeStartRunner(manager),
      });
      executionId = result.executionId;
      expect(result.status).toBe("blocked");
      expect(startSpy).not.toHaveBeenCalled();
      expect(await db.select().from(aiWorldTransitionsTable)
        .where(eq(aiWorldTransitionsTable.executionId, executionId))).toHaveLength(0);
      expect(await db.select().from(aiExecutionAcceptancesTable).where(and(
        eq(aiExecutionAcceptancesTable.executionId, executionId),
        eq(aiExecutionAcceptancesTable.outcome, "SUCCEEDED"),
      ))).toHaveLength(0);
    } finally {
      startSpy.mockRestore();
      worldStateSpy.mockRestore();
      await fixture.cleanup(executionId);
    }
  });

  it("records one fixed-safe runtime.start status probe without changing Gate C acceptance", async () => {
    const fixture = await createGateCRecipeFixture("browser.verify");
    const missionId = crypto.randomUUID();
    const goalId = crypto.randomUUID();
    const planRevision = "runtime-start-p75-test-plan";
    await db.insert(aiMissionsTable).values({
      id: missionId,
      projectId: fixture.params.projectId,
      userId: fixture.params.userId,
      title: "Runtime start experiment",
      intent: "Verify the runtime start outcome",
      status: "active",
      scope: { kind: "project", projectId: fixture.params.projectId },
    });
    await db.insert(aiGoalsTable).values({
      id: goalId,
      missionId,
      projectId: fixture.params.projectId,
      title: "Start the workspace runtime",
      status: "running",
    });
    const preStateObserver = vi.fn(async ({ projectId, revision }: {
      projectId: string;
      revision: string;
    }) => ({
      status: "observed" as const,
      runtimeStatus: "stopped" as const,
      projectId,
      revision,
      sessionId: null,
      pid: null,
      port: null,
      processAlive: false,
      portReady: false,
      source: "test_observer" as const,
      inventoryComplete: true,
      unknownListenerPorts: [],
      observedAt: new Date().toISOString(),
      detail: "Test supervisor confirms the runtime is stopped.",
    }));
    const manager = new WorkspaceRuntimeManager({
      store: createInMemoryWorkspaceRuntimeStore(),
      startPreStateObserver: preStateObserver,
    });
    const stoppedSnapshot = await manager.get(fixture.params.projectId);
    const startSpy = vi.spyOn(manager, "start").mockResolvedValue({
      ...stoppedSnapshot,
      status: "failed",
      error: "simulated start failure",
    });
    let executionId: string | undefined;
    try {
      const result = await runRecipeOperation({
        ...fixture.params,
        recipeId: "runtime.start",
        missionId,
        goalId,
        planRevision,
        runtimeStartRunner: createRuntimeStartRunner(manager),
      });
      executionId = result.executionId;
      expect(result.status).not.toBe("completed");
      expect(startSpy).toHaveBeenCalledTimes(1);
      expect(preStateObserver).toHaveBeenCalledTimes(2);

      const events = await db.select().from(aiAgentEpisodeEventsTable)
        .where(eq(aiAgentEpisodeEventsTable.executionId, executionId));
      const registrationEvent = events.find((event) => {
        const payload = event.payload;
        return payload
          && typeof payload === "object"
          && !Array.isArray(payload)
          && (payload as Record<string, unknown>).recordKind
            === "P75_HYPOTHESIS_EXPERIMENT_REGISTERED";
      });
      const resultEvent = events.find((event) => {
        const payload = event.payload;
        return payload
          && typeof payload === "object"
          && !Array.isArray(payload)
          && (payload as Record<string, unknown>).recordKind
            === "P75_HYPOTHESIS_EXPERIMENT_RESULT";
      });
      expect(registrationEvent?.eventType).toBe("OBSERVATION_REQUESTED");
      expect(registrationEvent?.payload).toMatchObject({
        goalId,
        planRevision,
        selectionMode: "fixed_safe_probe",
        candidate: { decisionValueStatus: "not_computed_bootstrap" },
      });
      expect(resultEvent?.payload).toMatchObject({
        verdict: "matched",
        actualOutcomeKey: "runtime_not_running",
        measurementValidity: "complete_fresh",
        environmentStatus: "same_scope",
        beliefUpdateStatus: "unresolved_unvalidated_forecast",
        observationRefs: [expect.any(String)],
      });
      expect(await db.select().from(aiExecutionAcceptancesTable).where(and(
        eq(aiExecutionAcceptancesTable.executionId, executionId),
        eq(aiExecutionAcceptancesTable.outcome, "SUCCEEDED"),
      ))).toHaveLength(0);
    } finally {
      startSpy.mockRestore();
      await fixture.cleanup(executionId);
    }
  });

  it("blocks runtime.start when measurement continuation returns a disposition", async () => {
    const fixture = await createGateCRecipeFixture("browser.verify");
    const missionId = crypto.randomUUID();
    const goalId = crypto.randomUUID();
    await db.insert(aiMissionsTable).values({
      id: missionId,
      projectId: fixture.params.projectId,
      userId: fixture.params.userId,
      title: "Runtime start experiment",
      intent: "Verify the runtime start outcome",
      status: "active",
      scope: { kind: "project", projectId: fixture.params.projectId },
    });
    await db.insert(aiGoalsTable).values({
      id: goalId,
      missionId,
      projectId: fixture.params.projectId,
      title: "Start the workspace runtime",
      status: "running",
    });
    const continuationRunner = vi.fn(async () => ({
      reasonCode: "P75_CONTINUATION_RESULT_ALREADY_RECORDED",
      sourceExperimentId: "source-experiment",
      continuationId: "continuation-recovered",
      resultId: "result-recovered",
      measurementValidity: "complete_fresh" as const,
    }));
    const runtimeStartRunner = vi.fn(async () => ({
      status: "passed" as const,
      evidence: { evidenceId: "runtime-start-not-called" },
    }));
    let executionId: string | undefined;
    try {
      const result = await runRecipeOperation({
        ...fixture.params,
        recipeId: "runtime.start",
        missionId,
        goalId,
        planRevision: "runtime-start-p75-test-plan",
        runtimeStartMeasurementContinuationRunner: continuationRunner,
        runtimeStartRunner,
      });
      executionId = result.executionId;
      expect(result).toMatchObject({
        status: "blocked",
        measurementContinuation: {
          reasonCode: "P75_CONTINUATION_RESULT_ALREADY_RECORDED",
          sourceExperimentId: "source-experiment",
        },
      });
      expect(continuationRunner).toHaveBeenCalledTimes(1);
      expect(runtimeStartRunner).not.toHaveBeenCalled();

      const [execution] = await db.select({
        status: aiExecutionsTable.status,
        workerId: aiExecutionsTable.workerId,
        leaseUntil: aiExecutionsTable.leaseUntil,
        checkpoint: aiExecutionsTable.checkpoint,
      }).from(aiExecutionsTable).where(eq(aiExecutionsTable.id, executionId));
      expect(execution).toMatchObject({
        status: "completed",
        workerId: null,
        leaseUntil: null,
      });
      const checkpoint = JSON.parse(execution!.checkpoint) as Record<string, unknown>;
      expect(checkpoint).toMatchObject({
        observationOnlyTerminalization: {
          kind: "P75_HYPOTHESIS_MEASUREMENT_CONTINUATION",
          createsAcceptance: false,
        },
      });
      expect(await db.select().from(aiExecutionAcceptancesTable).where(
        eq(aiExecutionAcceptancesTable.executionId, executionId),
      )).toHaveLength(0);
      const terminalEvents = await db.select({
        eventType: aiAgentEpisodeEventsTable.eventType,
        payload: aiAgentEpisodeEventsTable.payload,
      }).from(aiAgentEpisodeEventsTable).where(and(
        eq(aiAgentEpisodeEventsTable.executionId, executionId),
        eq(aiAgentEpisodeEventsTable.eventType, "EPISODE_TERMINAL"),
      ));
      expect(terminalEvents).toHaveLength(1);
      expect(terminalEvents[0]?.payload).toMatchObject({
        verdict: "replan_required",
        reasonCode: "P75_CONTINUATION_RESULT_ALREADY_RECORDED",
        continuationId: "continuation-recovered",
        resultId: "result-recovered",
        measurementValidity: "complete_fresh",
      });
    } finally {
      await fixture.cleanup(executionId);
    }
  });

  it("reclaims a durable P7.5 result after a worker crash without rereading runtime.status", async () => {
    const fixture = await createGateCRecipeFixture("browser.verify");
    const missionId = crypto.randomUUID();
    const goalId = crypto.randomUUID();
    const params = {
      ...fixture.params,
      recipeId: "runtime.start" as const,
      missionId,
      goalId,
      planRevision: "runtime-start-p75-crash-recovery-plan",
    };
    const environmentAttestation = await captureEnvironmentAttestation({
      rootPath: params.rootPath,
      profile: serverEnvironmentProfile("RUNTIME_START", {
        kind: "recipe",
        recipeId: "runtime.start",
      }),
    });
    if (environmentAttestation.status !== "known") {
      throw new Error("P7.5 recovery fixture requires a known environment revision.");
    }
    const environmentRevision = environmentAttestation.environmentRevision;
    const runtimeStartRunner = vi.fn(async () => {
      throw new Error("runtime.start must not run during measurement recovery");
    });
    const observedAt = "2026-09-28T10:01:05.000Z";
    const observeRuntime = vi.fn(async () => ({
      status: "passed",
      projectId: params.projectId,
      sessionId: "server-owned-runtime-session",
      revision: params.sourceRevision,
      processAlive: true,
      portReady: true,
      servingRevision: params.sourceRevision,
      markerMatched: true,
      observedAt,
    } as never));
    let failBeforeResultPersistence = true;
    const materializeObservation = vi.fn(materializeServerOwnedObservations);
    const continuationDependencies = {
      loadPriorEvents: async (context: { projectId: string; executionId: string; attempt: number }) =>
        db.select({
          episodeId: aiAgentEpisodeEventsTable.episodeId,
          projectId: aiAgentEpisodeEventsTable.projectId,
          executionId: aiAgentEpisodeEventsTable.executionId,
          attempt: aiAgentEpisodeEventsTable.attempt,
          eventType: aiAgentEpisodeEventsTable.eventType,
          payload: aiAgentEpisodeEventsTable.payload,
          sequence: aiAgentEpisodeEventsTable.sequence,
        }).from(aiAgentEpisodeEventsTable).where(and(
          eq(aiAgentEpisodeEventsTable.projectId, context.projectId),
          eq(aiAgentEpisodeEventsTable.executionId, context.executionId),
          lt(aiAgentEpisodeEventsTable.attempt, context.attempt),
          inArray(aiAgentEpisodeEventsTable.eventType, [
            "OBSERVATION_REQUESTED",
            "OBSERVATION_RECORDED",
          ]),
        )).orderBy(
          asc(aiAgentEpisodeEventsTable.attempt),
          asc(aiAgentEpisodeEventsTable.sequence),
        ),
      captureEnvironmentRevision: async () => environmentRevision,
      observeRuntime,
      materializeObservation,
      appendEvent: async (event: Parameters<typeof appendEpisodeEvent>[0]) => {
        const payload = event.payload && typeof event.payload === "object" && !Array.isArray(event.payload)
          ? event.payload as Record<string, unknown>
          : undefined;
        if (
          payload?.recordKind === "P75_HYPOTHESIS_MEASUREMENT_CONTINUATION_RESULT"
          && failBeforeResultPersistence
        ) {
          failBeforeResultPersistence = false;
          throw new Error("simulated worker loss before durable P7.5 result");
        }
        return appendEpisodeEvent(event);
      },
      now: () => observedAt,
    };
    let executionId: string | undefined;
    try {
      await db.insert(aiMissionsTable).values({
        id: missionId,
        projectId: params.projectId,
        userId: params.userId,
        title: "P7.5 worker recovery",
        intent: "Recover a durable runtime observation",
        status: "active",
        scope: { kind: "project", projectId: params.projectId },
      });
      await db.insert(aiGoalsTable).values({
        id: goalId,
        missionId,
        projectId: params.projectId,
        title: "Replan from the recorded runtime state",
        status: "running",
      });

      const prepared = prepareRecipeOperation({
        ...params,
        runtimeStartRunner,
      });
      const created = await createAiExecution({
        userId: params.userId,
        request: {
          projectId: params.projectId,
          operationId: params.operationId,
          sessionId: params.sessionId,
          message: `recipe:${params.operationId}`,
          modelMessage: `recipe:${params.operationId}`,
          workspaceRevision: params.sourceRevision,
          validationTargetPaths: [...params.approvedPaths],
        },
        idempotencyKey: params.idempotencyKey,
        projectId: params.projectId,
        goalId,
        sessionId: params.sessionId,
        recipeBinding: prepared.binding,
      });
      executionId = created.execution.id;
      const initialWorkerId = `p75-source-worker:${executionId}`;
      const initialClaim = await claimAiExecution({
        executionId,
        userId: params.userId,
        workerId: initialWorkerId,
        recipeBinding: prepared.binding,
      });
      if (!initialClaim) throw new Error("Could not claim the initial P7.5 source attempt.");

      const sourceEpisode = await startEpisode({
        projectId: params.projectId,
        executionId,
        attempt: initialClaim.attempt,
        workerId: initialWorkerId,
        idempotencyKey: `${params.operationId}:episode:${initialClaim.attempt}`,
        projectRevision: params.sourceRevision,
        intentKind: "RUNTIME_START",
        scope: {
          kind: "recipe",
          operationId: params.operationId,
          recipeId: "runtime.start",
          candidateIdentity: null,
        },
        missionId,
        goalId,
        planRevision: params.planRevision,
      });
      const registration = buildRuntimeStartHypothesisExperimentRegistration({
        projectId: params.projectId,
        missionId,
        goalId,
        executionId,
        attempt: initialClaim.attempt,
        episodeId: sourceEpisode.episodeId,
        actionId: "runtime-start-p75-source-action",
        planRevision: params.planRevision,
        projectRevision: params.sourceRevision,
        environmentRevision,
        parentWorldRevision: "b".repeat(64),
        beforeObservationIds: ["observation-p75-before"],
        predictionRegisteredAt: "2026-09-28T10:00:00.000Z",
      });
      await appendEpisodeEvent({
        episodeId: sourceEpisode.episodeId,
        projectId: params.projectId,
        executionId,
        attempt: initialClaim.attempt,
        workerId: initialWorkerId,
        eventType: "OBSERVATION_REQUESTED",
        payload: registration as never,
        actorType: "server",
        actorId: initialWorkerId,
        correlationId: executionId,
      });

      await db.update(aiExecutionsTable).set({
        leaseUntil: new Date(Date.now() - 1_000),
      }).where(eq(aiExecutionsTable.id, executionId));
      expect(await reconcileAiExecutions({ expiredOnly: true })).toBeGreaterThanOrEqual(1);

      const runAndLoseWorker = vi.fn(async (context: Parameters<
        typeof runRuntimeStartHypothesisMeasurementContinuation
      >[0]) => {
        const result = await runRuntimeStartHypothesisMeasurementContinuation(
          context,
          continuationDependencies,
        );
        expect(result?.reasonCode).toBe("P75_MEASUREMENT_CONTINUATION_RECORDED");
        throw new Error("simulated worker crash after durable P7.5 result");
      });
      await expect(runRecipeOperation({
        ...params,
        runtimeStartMeasurementContinuationRunner: runAndLoseWorker,
        runtimeStartRunner,
      })).rejects.toThrow(/before durable P7\.5 result/);
      expect(runAndLoseWorker).toHaveBeenCalledWith(expect.objectContaining({ attempt: 1 }));

      const afterCrashEvents = await db.select({
        attempt: aiAgentEpisodeEventsTable.attempt,
        eventType: aiAgentEpisodeEventsTable.eventType,
        payload: aiAgentEpisodeEventsTable.payload,
      }).from(aiAgentEpisodeEventsTable)
        .where(eq(aiAgentEpisodeEventsTable.executionId, executionId));
      const resultBeforeRecovery = afterCrashEvents.find((event) => (
        (event.payload as Record<string, unknown>)?.recordKind
          === "P75_HYPOTHESIS_MEASUREMENT_CONTINUATION_RESULT"
      ));
      expect(resultBeforeRecovery).toBeUndefined();
      expect(afterCrashEvents.filter((event) => (
        (event.payload as Record<string, unknown>)?.recordKind
          === "P75_HYPOTHESIS_MEASUREMENT_CONTINUATION_REQUESTED"
      ))).toHaveLength(1);
      const materializedObservations = await db.select()
        .from(aiAgentObservationsTable)
        .where(and(
          eq(aiAgentObservationsTable.executionId, executionId),
          eq(aiAgentObservationsTable.predicate, "runtime.status"),
        ));
      expect(materializedObservations).toHaveLength(1);
      const materializedObservation = materializedObservations[0]!;

      await db.update(aiExecutionsTable).set({
        leaseUntil: new Date(Date.now() - 1_000),
      }).where(eq(aiExecutionsTable.id, executionId));
      expect(await reconcileAiExecutions({ expiredOnly: true })).toBeGreaterThanOrEqual(1);

      await expect(runRecipeOperation({
        ...params,
        runtimeStartMeasurementContinuationRunner: runAndLoseWorker,
        runtimeStartRunner,
      })).rejects.toThrow(/simulated worker crash after durable P7\.5 result/);
      expect(runAndLoseWorker).toHaveBeenCalledWith(expect.objectContaining({ attempt: 2 }));
      expect(observeRuntime).toHaveBeenCalledTimes(1);
      expect(materializeObservation).toHaveBeenCalledTimes(1);

      const afterResultCrashEvents = await db.select({
        attempt: aiAgentEpisodeEventsTable.attempt,
        eventType: aiAgentEpisodeEventsTable.eventType,
        payload: aiAgentEpisodeEventsTable.payload,
      }).from(aiAgentEpisodeEventsTable)
        .where(eq(aiAgentEpisodeEventsTable.executionId, executionId));
      const recoveredResultEvent = afterResultCrashEvents.find((event) => (
        (event.payload as Record<string, unknown>)?.recordKind
          === "P75_HYPOTHESIS_MEASUREMENT_CONTINUATION_RESULT"
      ));
      expect(recoveredResultEvent).toMatchObject({
        attempt: 2,
        eventType: "OBSERVATION_RECORDED",
      });
      const firstResult = recoveredResultEvent?.payload as {
        resultId?: string;
        observationId?: string;
        measurementValidity?: string;
      };
      expect(firstResult).toMatchObject({
        resultId: expect.any(String),
        observationId: materializedObservation.id,
        measurementValidity: "complete_fresh",
        calibrationEligibility: "not_eligible_without_versioned_policy_review",
      });
      expect(recoveredResultEvent?.payload).toHaveProperty(
        "observationId",
        materializedObservation.id,
      );

      await db.update(aiExecutionsTable).set({
        leaseUntil: new Date(Date.now() - 1_000),
      }).where(eq(aiExecutionsTable.id, executionId));
      expect(await reconcileAiExecutions({ expiredOnly: true })).toBeGreaterThanOrEqual(1);

      const recovered = await runRecipeOperation({
        ...params,
        runtimeStartMeasurementContinuationRunner: (context) =>
          runRuntimeStartHypothesisMeasurementContinuation(context, continuationDependencies),
        runtimeStartRunner,
      });
      expect(recovered).toMatchObject({
        status: "blocked",
        measurementContinuation: {
          reasonCode: "P75_CONTINUATION_RESULT_ALREADY_RECORDED",
          resultId: firstResult.resultId,
          measurementValidity: "complete_fresh",
        },
      });
      expect(observeRuntime).toHaveBeenCalledTimes(1);
      expect(materializeObservation).toHaveBeenCalledTimes(1);
      expect(runtimeStartRunner).not.toHaveBeenCalled();

      const finalEvents = await db.select({
        attempt: aiAgentEpisodeEventsTable.attempt,
        eventType: aiAgentEpisodeEventsTable.eventType,
        payload: aiAgentEpisodeEventsTable.payload,
      }).from(aiAgentEpisodeEventsTable)
        .where(eq(aiAgentEpisodeEventsTable.executionId, executionId));
      expect(finalEvents.filter((event) => (
        (event.payload as Record<string, unknown>)?.recordKind
          === "P75_HYPOTHESIS_MEASUREMENT_CONTINUATION_RESULT"
      ))).toHaveLength(1);
      const terminalEvents = finalEvents.filter((event) => event.eventType === "EPISODE_TERMINAL");
      expect(terminalEvents).toHaveLength(1);
      expect(terminalEvents[0]).toMatchObject({
        attempt: 3,
        payload: {
          verdict: "replan_required",
          resultId: firstResult.resultId,
        },
      });
      const terminalAcceptances = await db.select({
        attempt: aiExecutionAcceptancesTable.attempt,
        outcome: aiExecutionAcceptancesTable.outcome,
      }).from(aiExecutionAcceptancesTable)
        .where(eq(aiExecutionAcceptancesTable.executionId, executionId));
      expect(terminalAcceptances.some((acceptance) => acceptance.outcome === "SUCCEEDED")).toBe(false);
      expect(terminalAcceptances.some((acceptance) => acceptance.attempt === 3)).toBe(false);
      const [execution] = await db.select({
        attempt: aiExecutionsTable.attempt,
        status: aiExecutionsTable.status,
        workerId: aiExecutionsTable.workerId,
        checkpoint: aiExecutionsTable.checkpoint,
      }).from(aiExecutionsTable).where(eq(aiExecutionsTable.id, executionId));
      expect(execution).toMatchObject({
        attempt: 3,
        status: "completed",
        workerId: null,
      });
      expect(JSON.parse(execution!.checkpoint ?? "{}").observationOnlyTerminalization)
        .toMatchObject({
          kind: "P75_HYPOTHESIS_MEASUREMENT_CONTINUATION",
          resultId: firstResult.resultId,
          createsAcceptance: false,
        });
    } finally {
      if (executionId) {
        await db.delete(aiAgentEpisodeEventsTable)
          .where(eq(aiAgentEpisodeEventsTable.executionId, executionId));
        await db.delete(aiAgentObservationsTable)
          .where(eq(aiAgentObservationsTable.executionId, executionId));
        await db.delete(aiAgentEpisodesTable)
          .where(eq(aiAgentEpisodesTable.executionId, executionId));
      }
      await fixture.cleanup(executionId);
    }
  });

  it("bounds runtime.start when server-owned runtime.status conflicts with an independent stopped pre-state", async () => {
    const fixture = await createGateCRecipeFixture("browser.verify");
    await db.insert(aiWorldFactsTable).values({
      id: crypto.randomUUID(),
      projectId: fixture.params.projectId,
      subject: `runtime:${fixture.params.projectId}`,
      predicate: "runtime.status",
      value: "running",
      valueHash: "runtime-status-running-fixture",
      version: 1,
      status: "believed",
      sourceObservationIds: [],
      projectRevision: fixture.params.sourceRevision,
    });
    const manager = new WorkspaceRuntimeManager({
      store: createInMemoryWorkspaceRuntimeStore(),
      startPreStateObserver: async ({ projectId, revision }) => ({
        status: "observed",
        runtimeStatus: "stopped",
        projectId,
        revision,
        sessionId: null,
        pid: null,
        port: null,
        processAlive: false,
        portReady: false,
        source: "test_observer",
        inventoryComplete: true,
        unknownListenerPorts: [],
        observedAt: new Date().toISOString(),
        detail: "Independent test pre-state confirms no runtime is running.",
      }),
    });
    const startSpy = vi.spyOn(manager, "start");
    let executionId: string | undefined;
    try {
      const result = await runRecipeOperation({
        ...fixture.params,
        recipeId: "runtime.start",
        runtimeStartRunner: createRuntimeStartRunner(manager),
      });
      executionId = result.executionId;
      expect(result.status).toBe("blocked");
      expect(startSpy).not.toHaveBeenCalled();
      expect(await db.select().from(aiWorldTransitionsTable)
        .where(eq(aiWorldTransitionsTable.executionId, executionId))).toHaveLength(0);
      expect(await db.select().from(aiExecutionAcceptancesTable).where(and(
        eq(aiExecutionAcceptancesTable.executionId, executionId),
        eq(aiExecutionAcceptancesTable.outcome, "SUCCEEDED"),
      ))).toHaveLength(0);
    } finally {
      startSpy.mockRestore();
      await db.delete(aiWorldFactsTable)
        .where(eq(aiWorldFactsTable.projectId, fixture.params.projectId));
      await fixture.cleanup(executionId);
    }
  });

  it("resumes a reclaimed recipe from passed checkpoint nodes instead of rerunning them", async () => {
    validationCalls.length = 0;
    validationEvidenceContexts.length = 0;
    const fixture = await createReclaimedRecipeFixture();
    try {
      const result = await runRecipeOperation(fixture.params);
      expect(result.status).toBe("completed");
      expect(result.completedNodeIds).toEqual(fixture.prepared.plan.nodes.map((node) => node.id));
      expect(validationCalls).toEqual(["ai-orchestrator-tests"]);
      expect(validationEvidenceContexts[0]).toMatchObject({
        operationId: fixture.executionId,
        projectRevision: fixture.params.sourceRevision,
        candidateHash: fixture.params.candidateIdentity,
        environmentProfile: { id: "candidate-validation" },
      });
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
    let preStateRuntime: {
      running: boolean;
      sessionId: string | null;
      pid: number | null;
      port: number | null;
    } | undefined;
    let manager = new WorkspaceRuntimeManager({
      store: createInMemoryWorkspaceRuntimeStore(),
      workerId: `runtime-recipe-test:${operationId}`,
      startPreStateObserver: async ({ projectId: observedProjectId, revision }) => {
        const running = preStateRuntime?.running === true;
        return {
          status: "observed",
          runtimeStatus: running ? "running" : "stopped",
          projectId: observedProjectId,
          revision,
          sessionId: running ? preStateRuntime?.sessionId ?? null : null,
          pid: running ? preStateRuntime?.pid ?? null : null,
          port: running ? preStateRuntime?.port ?? null : null,
          processAlive: running,
          portReady: running,
          source: "test_observer",
          inventoryComplete: true,
          unknownListenerPorts: [],
          observedAt: new Date().toISOString(),
          detail: running
            ? "Independent test pre-state confirms the runtime is already running."
            : "Independent test pre-state confirms no runtime is running.",
        };
      },
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
      const directObservations = observations.filter((row) => row.provenance === "DIRECT_OBSERVATION");
      const runtimeReceipt = observations.find((row) => row.sourceType === "runtime_receipt");
      const runtimeSnapshot = await manager.get(projectId);
      expect(runtimeReceipt?.value).toMatchObject({ sessionId: runtimeSnapshot.sessionId });
      expect(runtimeReceipt?.environmentRevision).toBe(runtimeSnapshot.environmentRevision);
      expect(runtimeReceipt?.environmentFreshness).toBe("fresh");
      const childProcessObservation = directObservations.find(
        (row) => row.sourceType === "child_process_attestation",
      );
      expect(directObservations.map((row) => row.sourceId).length).toBe(
        new Set(directObservations.map((row) => row.sourceId)).size,
      );
      expect(directObservations.filter(
        (row) => row.sourceType === "child_process_attestation",
      )).toHaveLength(1);
      expect(childProcessObservation).toMatchObject({
        predicate: "runtime.child_process_environment",
        provenance: "DIRECT_OBSERVATION",
        subject: `runtime:${runtimeSnapshot.sessionId}`,
        sourceId: `runtime-child-process:${runtimeSnapshot.sessionId}`,
        sourceRefs: expect.arrayContaining([`runtime:${runtimeSnapshot.sessionId}`]),
      });
      expect(childProcessObservation?.value).toMatchObject({
        bindingDigest: expect.stringMatching(/^[a-f0-9]{64}$/),
        sessionId: runtimeSnapshot.sessionId,
      });
      const runtimeAfterState = observations.find((row) => (
        row.sourceType === "direct_observation"
        && row.predicate === "runtime.after_state"
        && row.sourceId.startsWith(`runtime-start:${executionId}:`)
        && row.sourceId.endsWith(":runtime.after_state")
      ));
      expect(runtimeAfterState).toMatchObject({
        provenance: "DIRECT_OBSERVATION",
        environmentFreshness: "fresh",
      });
      expect(runtimeAfterState?.value).toMatchObject({
        status: "passed",
        runtimeStatus: "running",
        projectId,
        sessionId: runtimeSnapshot.sessionId,
        revision: sourceRevision,
        processAlive: true,
        portReady: true,
        environmentRevision: expect.stringMatching(/^env-v1:[a-f0-9]{64}$/),
      });
      const beforeStateObservation = directObservations.find(
        (row) => row.predicate === "runtime.before_state",
      );
      const runtimeStatusObservation = directObservations.find(
        (row) => row.predicate === "runtime.status",
      );
      expect(beforeStateObservation?.value).toMatchObject({
        status: "observed",
        runtimeStatus: "stopped",
        projectId,
        revision: sourceRevision,
        inventoryComplete: true,
        unknownListenerPorts: [],
      });
      expect(runtimeStatusObservation?.value).toBe("running");
      const [transition] = await db.select().from(aiWorldTransitionsTable)
        .where(eq(aiWorldTransitionsTable.executionId, executionId))
        .limit(1);
      expect(transition).toMatchObject({
        status: "materialized",
        effectBundleId: bundle?.id,
        parentWorldRevision: expect.stringMatching(/^[a-f0-9]{64}$/),
        resultingWorldRevision: expect.stringMatching(/^[a-f0-9]{64}$/),
      });
      expect(transition?.beforeObservationIds).toContain(beforeStateObservation?.id);
      expect(transition?.afterObservationIds).toContain(runtimeStatusObservation?.id);
      expect(transition?.materializedObservationIds).toEqual(expect.arrayContaining([
        beforeStateObservation?.id,
        runtimeStatusObservation?.id,
      ]));

      const d2 = await readWorldStateForDecision({
        projectId,
        transitionId: transition!.id,
      });
      expect(d2.worldRevision).toBe(transition?.resultingWorldRevision);
      expect(d2.worldRevision).not.toBe(transition?.parentWorldRevision);
      expect(d2.currentFacts).toEqual(expect.arrayContaining([
        expect.objectContaining({
          subject: `runtime:${projectId}`,
          predicate: "runtime.status",
          value: "running",
        }),
      ]));
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

      const runningSnapshot = await manager.get(projectId);
      preStateRuntime = {
        running: runningSnapshot.status === "running",
        sessionId: runningSnapshot.sessionId,
        pid: runningSnapshot.pid,
        port: runningSnapshot.port,
      };
      expect(preStateRuntime.running).toBe(true);
      const secondOperationId = crypto.randomUUID();
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
      const secondExecutionTransitions = await db.select()
        .from(aiWorldTransitionsTable)
        .where(eq(aiWorldTransitionsTable.executionId, secondResult.executionId));
      expect(secondExecutionTransitions).toHaveLength(0);
      const secondExecutionObservations = await db.select()
        .from(aiAgentObservationsTable)
        .where(eq(aiAgentObservationsTable.executionId, secondResult.executionId));
      const secondBeforeState = secondExecutionObservations.find((row) => (
        row.predicate === "runtime.before_state"
        && row.sourceId.startsWith(`runtime-start:${secondResult.executionId}:`)
      ));
      const secondAfterState = secondExecutionObservations.find((row) => (
        row.predicate === "runtime.after_state"
      ));
      expect(secondBeforeState?.value).toMatchObject({
        runtimeStatus: "running",
        sessionId: runtimeSnapshot.sessionId,
      });
      expect(secondAfterState?.value).toMatchObject({
        after: {
          status: "passed",
          projectId,
          sessionId: runtimeSnapshot.sessionId,
          processAlive: true,
          portReady: true,
        },
      });

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
      const thirdOperationId = crypto.randomUUID();
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
      expect(replayResult.status).toBe("incomplete");
      expect(replayResult.recovered).toBe(false);
      expect(replayResult.receipt).toMatchObject({
        status: "incomplete",
        incompleteReason: "runner_blocked",
        partition: "held_out",
        projectId,
        caseRegistrationId: registeredReplayCase!.id,
        candidateId: candidateAfterThirdEpisode[0]?.id,
        candidateHash: candidateAfterThirdEpisode[0]?.candidateHash,
        sourceEpisodeId: registeredReplayCase!.sourceEpisodeId,
        sourceExecutionId: thirdResult.executionId,
        replayExecutionId: expect.any(String),
        replayEpisodeId: expect.any(String),
        replayAcceptanceId: null,
        replayEffectBundleId: null,
        replayCanonicalProofHash: null,
        workspaceTreeHash: expect.stringMatching(/^[a-f0-9]{64}$/),
      });
      expect(replayResult.receipt.replayExecutionId).not.toBe(thirdResult.executionId);
      expect(replayResult.receipt.replayEpisodeId).not.toBe(registeredReplayCase!.sourceEpisodeId);
      expect(replayResult.receipt.replayAcceptanceId).toBeNull();
      expect(replayResult.receipt.replayEffectBundleId).toBeNull();
      expect(replayResult.receipt.replayCanonicalProofHash).toBeNull();

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
        status: "incomplete",
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
        status: "incomplete",
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
        const nextOperationId = crypto.randomUUID();
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
          incompleteReason: "runner_blocked",
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
    const browserCalls: Array<{
      profile: string;
      projectId?: string;
      operationId?: string;
      executionId?: string;
      executionAttempt?: number;
      revision?: string;
    }> = [];
    const params = {
      ...fixture.params,
      browserValidationRunner: async ({
        profile,
        projectId,
        operationId: runnerOperationId,
        executionId: runnerExecutionId,
        executionAttempt,
        revision,
      }: {
        profile: string;
        projectId?: string;
        operationId?: string;
        executionId?: string;
        executionAttempt?: number;
        revision?: string;
      }) => {
        browserCalls.push({
          profile,
          projectId,
          operationId: runnerOperationId,
          executionId: runnerExecutionId,
          executionAttempt,
          revision,
        });
        const sessionId = "browser-preview-session";
        const origin = "http://127.0.0.1:43123";
        const executionId = runnerExecutionId ?? "";
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
            kind: "browser_preview",
            evidenceId: `browser:${sessionId}:${runnerOperationId}:${executionId}`,
            observedAt: new Date().toISOString(),
            projectId,
            operationId: runnerOperationId,
            executionId,
            executionAttempt,
            sessionId,
            status: "passed",
            artifactRef: `browser-preview:${sessionId}:${runnerOperationId}:${executionId}`,
            profileName: profile,
            origin,
            permittedOrigin: origin,
            revision,
            sourceRevision: revision,
            consoleErrorCount: 0,
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
        projectId: fixture.params.projectId,
        operationId: fixture.params.operationId,
        executionId,
        executionAttempt: expect.any(Number),
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
      githubDeliveryRunner: async ({
        projectId,
        operationId,
        executionId,
        executionAttempt,
        sourceRevision,
        message,
      }: {
        projectId: string;
        operationId: string;
        executionId?: string;
        executionAttempt?: number;
        sourceRevision?: string;
        message: string;
      }) => {
        deliveryCalls.push(`${projectId}:${operationId}:${message}`);
        const marker = `EngineeringOS-Operation: ${operationId}`;
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
          operationMarker: marker,
          afterState: {
            status: "passed" as const,
            projectId,
            operationId,
            executionId,
            executionAttempt,
            sourceRevision,
            proposalId: "proposal-delivery",
            remoteUrl: "https://github.com/example/project.git",
            branch: "main",
            expectedCommitHash: "remote-commit",
            remoteCommitHash: "remote-commit",
            expectedParentHash: "parent-commit",
            remoteParentHash: "parent-commit",
            expectedTreeHash: "remote-tree",
            remoteTreeHash: "remote-tree",
            remoteParentCount: 1,
            candidateTreeHash: "candidate-tree",
            committedTreeHash: "candidate-tree",
            operationMarker: marker,
            markerMatched: true,
            observedAt: new Date().toISOString(),
          },
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