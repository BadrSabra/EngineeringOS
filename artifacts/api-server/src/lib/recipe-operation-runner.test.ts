import { execFile, spawn } from "node:child_process";
import { createServer as createHttpServer } from "node:http";
import { createServer } from "node:net";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import { and, asc, desc, eq, inArray, lt, sql } from "drizzle-orm";
import { describe, expect, it, vi } from "vitest";
import {
  aiAgentEffectBundlesTable,
  aiAgentEffectsTable,
  aiAgentEpisodeEventsTable,
  aiAgentEpisodesTable,
  aiAgentObservationsTable,
  aiChangeProposalsTable,
  aiExecutionAcceptancesTable,
  aiExecutionEvidenceSnapshotsTable,
  aiExecutionsTable,
  aiGoalsTable,
  aiMissionsTable,
  aiWorldTransitionsTable,
  aiChatSessionsTable,
  aiChatMessagesTable,
  aiStrategyCandidatesTable,
  aiStrategyReplayCaseRunsTable,
  aiStrategyReplayCasesTable,
  aiWorldFactsTable,
  db,
  eventsTable,
  projectsTable,
} from "@workspace/db";
import {
  checkpointAiExecution,
  claimAiExecution,
  createAiExecution,
  parseAiExecutionCheckpoint,
  reconcileAiExecutions,
  requestAiExecutionCancel,
  type AiExecutionNodeCheckpoint,
} from "./ai-execution-state.js";
import * as aiExecutionState from "./ai-execution-state.js";
import {
  appendEpisodeEvent,
  startEpisode,
} from "./agent-state/agent-episode-ledger.js";
import { childProcessBindingDigest } from "./agent-state/child-process-attestation.js";
import { materializeServerOwnedObservations } from "./agent-state/observation-materializer.js";
import { buildRuntimeStartHypothesisExperimentRegistration } from "./agent-state/runtime-start-hypothesis-experiment.js";
import { runRuntimeStartHypothesisMeasurementContinuation } from "./agent-state/runtime-start-hypothesis-measurement-continuation-runner.js";
import {
  captureEnvironmentAttestation,
  serverEnvironmentProfile,
} from "./agent-state/environment-attestation.js";
import { HOST_DISPOSABLE_TEMP_ROOT } from "./disposable-temp.js";
import { heavyJobQueue } from "./job-queue.js";
import { runMissionGoal, wakeRuntimeTransitionMissionGoals } from "./mission-runtime.js";
import {
  createRuntimeStartRunner,
  collectTrustedRecipeValidationEvidence,
  buildRecipeTaskObjectiveValidatorReceipts,
  prepareRecipeOperation,
  runRecipeOperation,
} from "./recipe-operation-runner.js";
import * as recipeOperationRunnerModule from "./recipe-operation-runner.js";
import { buildTaskObjectiveContract } from "./task-objective-contract.js";
import { WorkspaceRuntimeManager } from "./workspace-runtime.js";
import { createInMemoryWorkspaceRuntimeStore } from "./workspace-runtime-store.js";
import {
  readWorldStateForDecision,
  retryPendingRuntimeStartTransitions,
} from "./agent-state/runtime-start-transition.js";
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
import {
  runRegisteredStrategyReplayCase,
  StrategyReplayCaseBusyError,
} from "./agent-state/strategy-replay-case-runner.js";
import { loadCanonicalProof } from "./proof-foundation.js";
import { executeVerifiedGitHubDelivery } from "./github-delivery-service.js";
import {
  DELIVERY_TREE_DIGEST_VERSION,
  hashDeliveryTree,
  resolveWorkspaceTreeRevision,
} from "./delivery-workspace.js";

const validationCalls: string[] = [];
const validationEvidenceContexts: unknown[] = [];
let validationAttestationMode:
  | "known"
  | "missing"
  | "unknown"
  | "mismatch"
  | "stale"
  | "old_timestamp" = "known";
const execFileAsync = promisify(execFile);

describe("recipe task-objective validator receipts", () => {
  it("binds generic validation evidence only to the registered-validation objective", () => {
    const completionEvidence = [{
      evidenceId: "validation-evidence-1",
      artifactRef: "validation-result:workspace-typecheck",
      projectRevision: "revision-1",
      operationId: "execution-1",
      validatorProfile: "workspace-typecheck",
      environmentRevision: null,
    }];
    const trustedValidationEvidence = [{
      evidenceId: "validation-evidence-1",
      artifactRef: "validation-result:workspace-typecheck",
      projectRevision: "revision-1",
      operationId: "execution-1",
      validatorProfile: "workspace-typecheck",
    }];
    const common = {
      completionEvidence,
      trustedValidationEvidence,
      operationId: "operation-1",
      projectId: "project-1",
    };
    const bugFixObjective = buildTaskObjectiveContract({
      message: "Fix the bug in checkout",
      projectId: "project-1",
      workspaceRevision: "revision-1",
      proofRequired: true,
    })!;
    const browserObjective = buildTaskObjectiveContract({
      message: "Run the browser workflow and verify checkout",
      projectId: "project-1",
      workspaceRevision: "revision-1",
      proofRequired: true,
    })!;

    expect(buildRecipeTaskObjectiveValidatorReceipts({
      ...common,
      taskObjective: bugFixObjective,
    })).toEqual([{
      validatorId: "registered-validation.v1",
      status: "PROVEN",
      operationId: "operation-1",
      projectId: "project-1",
      workspaceRevision: "revision-1",
      artifactRef: "validation-result:workspace-typecheck",
      validatorProfile: "workspace-typecheck",
      environmentRevision: null,
    }]);
    expect(buildRecipeTaskObjectiveValidatorReceipts({
      ...common,
      trustedValidationEvidence: [],
      taskObjective: bugFixObjective,
    })).toEqual([]);
    expect(buildRecipeTaskObjectiveValidatorReceipts({
      ...common,
      taskObjective: browserObjective,
    })).toEqual([]);
  });

  it("does not issue a registered-validation receipt for an unknown profile", () => {
    const taskObjective = buildTaskObjectiveContract({
      message: "Fix the bug in checkout",
      projectId: "project-1",
      workspaceRevision: "revision-1",
      proofRequired: true,
    })!;

    expect(buildRecipeTaskObjectiveValidatorReceipts({
      taskObjective,
      operationId: "operation-1",
      projectId: "project-1",
      completionEvidence: [{
        evidenceId: "validation-evidence-unknown",
        artifactRef: "validation-result:unregistered",
        projectRevision: "revision-1",
        operationId: "execution-1",
        validatorProfile: "browser-preview",
      }],
      trustedValidationEvidence: [{
        evidenceId: "validation-evidence-unknown",
        artifactRef: "validation-result:unregistered",
        projectRevision: "revision-1",
        operationId: "execution-1",
        validatorProfile: "browser-preview",
      }],
    })).toEqual([]);
  });

  it("trusts profile evidence only from a matching server validation capability output", () => {
    const evidence = {
      evidenceId: "validation-evidence-1",
      artifactRef: "validation-result:workspace-typecheck",
      operationId: "execution-1",
      projectRevision: "revision-1",
      candidateHash: "candidate-1",
      validatorProfile: "workspace-typecheck",
    };
    const nodes = [
      {
        id: "registered-validation",
        capabilityId: "validation.run.workspace-typecheck",
        status: "passed",
      },
      {
        id: "arbitrary-task-output",
        capabilityId: "project.read_file",
        status: "passed",
      },
      {
        id: "wrong-profile",
        capabilityId: "validation.run.ai-orchestrator-tests",
        status: "passed",
      },
    ] as const;
    const outputs = new Map<string, Record<string, unknown>>([
      ["registered-validation", {
        status: "passed",
        profile: "workspace-typecheck",
        evidence,
      }],
      ["arbitrary-task-output", {
        status: "passed",
        profile: "workspace-typecheck",
        evidence,
      }],
      ["wrong-profile", {
        status: "passed",
        profile: "ai-orchestrator-tests",
        evidence,
      }],
    ]);

    expect(collectTrustedRecipeValidationEvidence({
      nodes,
      outputs,
      executionId: "execution-1",
      projectRevision: "revision-1",
      candidateHash: "candidate-1",
    })).toEqual([{
      evidenceId: "validation-evidence-1",
      artifactRef: "validation-result:workspace-typecheck",
      operationId: "execution-1",
      projectRevision: "revision-1",
      validatorProfile: "workspace-typecheck",
    }]);
    expect(collectTrustedRecipeValidationEvidence({
      nodes,
      outputs,
      executionId: "another-execution",
      projectRevision: "revision-1",
      candidateHash: "candidate-1",
    })).toEqual([]);
  });
});

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
      const evidenceId = `mock-evidence-${validationCalls.length}`;
      const context = evidenceContext as {
        operationId?: string;
        projectRevision?: string;
        candidateHash?: string;
        childProcessIdentity?: {
          projectId: string;
          executionId: string;
          executionAttempt: number;
          episodeId: string;
          operationId: string;
          revision: string;
        };
      } | undefined;
      const identity = context?.childProcessIdentity;
      const binding = identity && validationAttestationMode !== "missing"
        ? {
            ...identity,
            ...(validationAttestationMode === "stale" ? { revision: "stale-revision" } : {}),
            sessionId: evidenceId,
            processRole: "validator" as const,
            validatorProfile: profile,
          }
        : undefined;
      const attestationStatus = validationAttestationMode === "unknown"
        ? "unknown" as const
        : validationAttestationMode === "mismatch"
          ? "mismatch" as const
          : "known" as const;
      return {
        status: "passed",
        profile,
        detail: `mock validation for ${profile}`,
        evidence: {
          evidenceId,
          observedAt: new Date().toISOString(),
          artifactRef: `mock-validation:${profile}`,
          environmentRevision: null,
          validatorProfile: profile,
          ...(typeof context?.operationId === "string" ? { operationId: context.operationId } : {}),
          ...(typeof context?.projectRevision === "string" ? { projectRevision: context.projectRevision } : {}),
          ...(typeof context?.candidateHash === "string" ? { candidateHash: context.candidateHash } : {}),
          ...(binding ? {
            childProcessAttestation: {
              status: attestationStatus,
              reasonCode: attestationStatus === "known"
                ? "child_process_observed"
                : attestationStatus === "mismatch"
                  ? "child_environment_mismatch"
                  : "procfs_unavailable",
              bindingDigest: childProcessBindingDigest(binding),
              attestationDigest: attestationStatus === "unknown" ? null : "a".repeat(64),
              processEnvironmentDigest: attestationStatus === "unknown" ? null : "b".repeat(64),
              observedAt: validationAttestationMode === "old_timestamp"
                ? "2000-01-01T00:00:00.000Z"
                : new Date().toISOString(),
            },
          } : {}),
        },
      };
    }),
  };
});

async function createReclaimedRecipeFixture(options: {
  includePassedEvidence?: boolean;
  proofRequired?: boolean;
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
  const projectRoot = await mkdtemp(path.join(process.cwd(), ".recipe-runner-project-"));
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
    rootPath: projectRoot,
    sourceRevision,
    recipeId: "candidate.verify",
    recipeVersion: 1,
    approvedPaths: ["lib/ai-orchestrator/src/index.ts"],
    candidateIdentity: "recovery-candidate",
    candidateWorkspace,
    ...(options.proofRequired ? { proofRequired: true } : {}),
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
    await rm(projectRoot, { recursive: true, force: true });
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
        workspaceRoot: params.candidateWorkspace,
        validationTargetPaths: [...params.approvedPaths],
        ...(params.proofRequired
          ? {
              proofRequired: true,
              ...(prepared.proofEvidenceMode === "artifact_only"
                ? { proofEvidenceMode: "artifact_only" as const }
                : {}),
            }
          : {}),
      },
      idempotencyKey: params.idempotencyKey,
      projectId,
      workspaceRoot: params.candidateWorkspace,
      sessionId,
      recipeBinding: prepared.binding,
    });
    executionId = created.execution.id;
    const checkpointOperation = options.proofRequired
      ? parseAiExecutionCheckpoint(created.execution.checkpoint)?.operation
      : undefined;
    if (options.proofRequired && !checkpointOperation) {
      throw new Error("proof-required recipe fixture has no durable operation contract");
    }
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
        ...(checkpointOperation ? { operation: checkpointOperation } : {}),
        nodeStates: checkpointNodes,
        completedNodes: checkpointNodes
          .filter((node) => node.status === "passed")
          .map((node) => node.id),
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
  recipeId: "browser.verify" | "delivery.push.github" | "runtime.start",
  approvedPaths: readonly string[] = [],
) {
  const projectId = crypto.randomUUID();
  const operationId = crypto.randomUUID();
  const sessionId = crypto.randomUUID();
  const userId = `gate-c-recipe-user:${projectId}`;
  const sourceRevision = `gate-c-recipe-revision:${projectId}`;
  const rootPath = await mkdtemp(path.join(process.cwd(), ".gate-c-recipe-root-"));
  await writeFile(
    path.join(rootPath, "package.json"),
    JSON.stringify({ name: "gate-c-recipe-fixture", version: "1.0.0" }),
    "utf8",
  );
  const now = new Date();
  await db.insert(projectsTable).values({
    id: projectId,
    ownerId: userId,
    name: `gate-c-recipe-${projectId.slice(0, 8)}`,
    rootPath,
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
    rootPath,
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
      await rm(rootPath, { recursive: true, force: true });
    },
  };
}

async function createDatabaseReadRecipeFixture() {
  const projectId = crypto.randomUUID();
  const operationId = crypto.randomUUID();
  const sessionId = crypto.randomUUID();
  const userId = `recipe-database-read-user:${projectId}`;
  const sourceRevision = `recipe-database-read-revision:${projectId}`;
  const rootPath = await mkdtemp(path.join(process.cwd(), ".database-read-recipe-root-"));
  const now = new Date();
  await db.insert(projectsTable).values({
    id: projectId,
    ownerId: userId,
    name: `recipe-database-read-${projectId.slice(0, 8)}`,
    rootPath,
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
      rootPath,
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
      await rm(rootPath, { recursive: true, force: true });
    },
  };
}

async function assertSuccessfulGateCEffect(
  executionId: string,
  capabilityId: string,
  expectedDirectObservationCount = 3,
) {
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
  expect(observations.filter((row) => row.provenance === "DIRECT_OBSERVATION"))
    .toHaveLength(expectedDirectObservationCount);
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

async function assertCanonicalRecipeProof(
  params: {
    projectId: string;
    operationId: string;
    sourceRevision: string;
    candidateIdentity?: string | null;
  },
  executionId: string,
) {
  const proof = await db.transaction((tx) => loadCanonicalProof({
    tx,
    executionId,
    scope: {
      projectId: params.projectId,
      executionId,
      operationId: params.operationId,
      sourceRevisionBinding: "execution",
      sourceRevision: params.sourceRevision,
      candidateIdentityBinding: params.candidateIdentity ? "required" : "not_applicable",
      ...(params.candidateIdentity ? { candidateIdentity: params.candidateIdentity } : {}),
    },
    goalStatus: "completed",
  }));
  expect(proof.accepted).toBe(true);
  expect(proof.verdict).toBe("PROVEN");
}

describe("read-only recipe invocation events", () => {
  it("produces Canonical Proof from a persisted, bound project-read artifact", async () => {
    const fixture = await createDatabaseReadRecipeFixture();
    let executionId: string | undefined;
    try {
      const result = await runRecipeOperation({
        ...fixture.params,
        proofRequired: true,
      });
      executionId = result.executionId;
      expect(result.status).toBe("completed");
      await assertCanonicalRecipeProof(fixture.params, executionId);

      const [acceptance] = await db.select({
        evidenceRequired: aiExecutionAcceptancesTable.evidenceRequired,
        evidenceComplete: aiExecutionAcceptancesTable.evidenceComplete,
        evidenceSnapshotId: aiExecutionAcceptancesTable.evidenceSnapshotId,
      }).from(aiExecutionAcceptancesTable).where(and(
        eq(aiExecutionAcceptancesTable.executionId, executionId),
        eq(aiExecutionAcceptancesTable.outcome, "SUCCEEDED"),
      )).limit(1);
      expect(acceptance).toMatchObject({
        evidenceRequired: 1,
        evidenceComplete: 1,
        evidenceSnapshotId: expect.any(String),
      });
    } finally {
      await fixture.cleanup();
    }
  });

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

      const [execution] = await db.select({
        attempt: aiExecutionsTable.attempt,
        request: aiExecutionsTable.request,
        baseRevision: aiExecutionsTable.baseRevision,
      }).from(aiExecutionsTable)
        .where(eq(aiExecutionsTable.id, result.executionId))
        .limit(1);
      if (!execution) throw new Error("completed recipe execution was not persisted");
      const [acceptance] = await db.select()
        .from(aiExecutionAcceptancesTable)
        .where(and(
          eq(aiExecutionAcceptancesTable.executionId, result.executionId),
          eq(aiExecutionAcceptancesTable.attempt, execution.attempt),
        ))
        .limit(1);
      expect(JSON.parse(execution.request).proofRequired).not.toBe(true);
      expect(acceptance).toMatchObject({
        evidenceRequired: 0,
        evidenceSnapshotId: null,
        disposition: expect.objectContaining({
          proof: expect.objectContaining({ verdict: "NOT_REQUIRED" }),
        }),
      });
      const canonicalProof = await db.transaction((tx) => loadCanonicalProof({
        tx,
        executionId: result.executionId,
        scope: {
          projectId: fixture.params.projectId,
          executionId: result.executionId,
          sourceRevisionBinding: "execution",
          candidateIdentityBinding: "not_applicable",
        },
        goalStatus: "completed",
      }));
      expect(canonicalProof.accepted).toBe(false);
      expect(canonicalProof.verdict).not.toBe("PROVEN");

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

  it("persists workspace-tree provenance in the bound runtime.start Canonical Proof", async () => {
    const fixture = await createGateCRecipeFixture("runtime.start");
    const { projectId, operationId, rootPath } = fixture.params;
    const manager = new WorkspaceRuntimeManager({
      store: createInMemoryWorkspaceRuntimeStore(),
      startPreStateObserver: async ({ projectId: observedProjectId, revision }) => ({
        status: "observed" as const,
        runtimeStatus: "stopped" as const,
        projectId: observedProjectId,
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
        detail: "The isolated test observer confirms the runtime is stopped.",
      }),
    });
    let executionId: string | undefined;

    try {
      await writeFile(
        path.join(rootPath, "package.json"),
        JSON.stringify({ scripts: { dev: "node server.mjs" } }),
        "utf8",
      );
      await writeFile(
        path.join(rootPath, "server.mjs"),
        [
          "import http from 'node:http';",
          "import { readFileSync } from 'node:fs';",
          "const revision = readFileSync('node_modules/.cache/revision.txt', 'utf8').trim();",
          "const server = http.createServer((_req, res) => { res.setHeader('x-engineeringos-revision', revision); res.end('runtime-ready'); });",
          "server.listen(Number(process.env.PORT), '127.0.0.1');",
          "process.once('SIGTERM', () => server.close(() => process.exit(0)));",
        ].join("\n"),
        "utf8",
      );
      await writeFile(path.join(rootPath, ".gitignore"), "node_modules/\n", "utf8");
      await execFileAsync("git", ["-C", rootPath, "init", "-q"]);
      await execFileAsync("git", ["-C", rootPath, "config", "user.name", "EngineeringOS Fixture"]);
      await execFileAsync("git", ["-C", rootPath, "config", "user.email", "fixture@example.com"]);
      await execFileAsync("git", ["-C", rootPath, "add", ".gitignore", "package.json", "server.mjs"]);
      await execFileAsync("git", ["-C", rootPath, "commit", "-qm", "workspace revision fixture"]);

      const sourceRevision = await resolveWorkspaceTreeRevision(rootPath);
      expect(sourceRevision).toMatch(/^workspace-tree-v1:[a-f0-9]{64}$/);
      await mkdir(path.join(rootPath, "node_modules/.cache"), { recursive: true });
      await writeFile(
        path.join(rootPath, "node_modules/.cache/revision.txt"),
        `${sourceRevision}\n`,
        "utf8",
      );
      expect(await resolveWorkspaceTreeRevision(rootPath)).toBe(sourceRevision);

      const result = await runRecipeOperation({
        ...fixture.params,
        sourceRevision,
        runtimeStartRunner: createRuntimeStartRunner(manager),
      });
      executionId = result.executionId;
      expect(result.status).toBe("completed");

      const [acceptance] = await db.select({
        id: aiExecutionAcceptancesTable.id,
        attempt: aiExecutionAcceptancesTable.attempt,
        outcome: aiExecutionAcceptancesTable.outcome,
        evidenceSnapshotId: aiExecutionAcceptancesTable.evidenceSnapshotId,
        sourceRevision: aiExecutionAcceptancesTable.sourceRevision,
      }).from(aiExecutionAcceptancesTable).where(and(
        eq(aiExecutionAcceptancesTable.executionId, executionId),
        eq(aiExecutionAcceptancesTable.outcome, "SUCCEEDED"),
      )).limit(1);
      expect(acceptance).toMatchObject({
        attempt: 0,
        outcome: "SUCCEEDED",
        evidenceSnapshotId: expect.any(String),
        sourceRevision,
      });
      if (!acceptance?.evidenceSnapshotId) {
        throw new Error("Workspace-tree runtime.start acceptance has no evidence snapshot.");
      }
      const [snapshot] = await db.select().from(aiExecutionEvidenceSnapshotsTable)
        .where(eq(aiExecutionEvidenceSnapshotsTable.id, acceptance.evidenceSnapshotId))
        .limit(1);
      expect(snapshot).toMatchObject({
        projectId,
        executionId,
        attempt: acceptance.attempt,
        sourceRevision,
        complete: 1,
        verdict: "PROVEN",
      });
      const gateCArtifact = Array.isArray(snapshot?.artifactRefs)
        ? snapshot.artifactRefs.find((artifact) => (
            Boolean(artifact)
            && typeof artifact === "object"
            && !Array.isArray(artifact)
            && (artifact as Record<string, unknown>).kind === "runtime_start_gate_c"
          ))
        : undefined;
      expect(gateCArtifact).toMatchObject({
        kind: "runtime_start_gate_c",
        version: 2,
        executionId,
        attempt: acceptance.attempt,
        operationId,
        sourceRevision,
        sourceRevisionKind: "workspace_tree",
        sourceRevisionSource: "delivery_tree_digest_v1",
      });
      await assertCanonicalRecipeProof({ projectId, operationId, sourceRevision }, executionId);
    } finally {
      await manager.shutdown();
      await fixture.cleanup(executionId);
    }
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

  it("keeps P7.5 collection closed while preserving normal Gate C runtime.start behavior", async () => {
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
      // The Gate C pre-state check remains; the separate P7.5 status read is closed.
      expect(preStateObserver).toHaveBeenCalledTimes(1);

      const events = await db.select().from(aiAgentEpisodeEventsTable)
        .where(eq(aiAgentEpisodeEventsTable.executionId, executionId));
      const p75RegistrationEvent = events.find((event) => {
        const payload = event.payload;
        return payload
          && typeof payload === "object"
          && !Array.isArray(payload)
          && String((payload as Record<string, unknown>).recordKind ?? "").startsWith("P75_HYPOTHESIS_");
      });
      expect(p75RegistrationEvent).toBeUndefined();
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
          workspaceRoot: params.rootPath,
          validationTargetPaths: [...params.approvedPaths],
        },
        idempotencyKey: params.idempotencyKey,
        projectId: params.projectId,
        workspaceRoot: params.rootPath,
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
        episodeId: aiAgentEpisodeEventsTable.episodeId,
        attempt: aiAgentEpisodeEventsTable.attempt,
        sequence: aiAgentEpisodeEventsTable.sequence,
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
      const resultOwnerEpisodeId = recoveredResultEvent?.episodeId;
      expect(firstResult).toMatchObject({
        resultId: expect.any(String),
        observationId: materializedObservation.id,
        measurementValidity: "complete_fresh",
        calibrationEligibility: "not_eligible_without_versioned_policy_review",
      });
      expect(resultOwnerEpisodeId).toEqual(expect.any(String));
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
        episodeId: aiAgentEpisodeEventsTable.episodeId,
        attempt: aiAgentEpisodeEventsTable.attempt,
        sequence: aiAgentEpisodeEventsTable.sequence,
        eventType: aiAgentEpisodeEventsTable.eventType,
        payload: aiAgentEpisodeEventsTable.payload,
      }).from(aiAgentEpisodeEventsTable)
        .where(eq(aiAgentEpisodeEventsTable.executionId, executionId));
      expect(finalEvents.filter((event) => (
        (event.payload as Record<string, unknown>)?.recordKind
          === "P75_HYPOTHESIS_MEASUREMENT_CONTINUATION_RESULT"
      ))).toHaveLength(1);
      const sourceRegistrationEvent = finalEvents.find((event) => (
        (event.payload as Record<string, unknown>)?.recordKind
          === "P75_HYPOTHESIS_EXPERIMENT_REGISTERED"
      ));
      expect(sourceRegistrationEvent?.payload).toMatchObject({
        calibrationStatus: "unvalidated",
        selectionMode: "fixed_safe_probe",
        selectedObservationRef: "workspace-runtime.status-after-start.v1",
        selectionPolicyVersion: "runtime-start-fixed-safe-probe-v1",
      });
      const terminalEvents = finalEvents.filter((event) => event.eventType === "EPISODE_TERMINAL");
      expect(terminalEvents).toHaveLength(3);
      const recoveredResultTerminal = terminalEvents.find(
        (event) => event.episodeId === resultOwnerEpisodeId,
      );
      expect(sourceRegistrationEvent?.episodeId).toBe(sourceEpisode.episodeId);
      const sourceRegistrationTerminal = terminalEvents.find(
        (event) => event.episodeId === sourceEpisode.episodeId,
      );
      const currentAttemptTerminal = terminalEvents.find((event) => event.attempt === 3);
      expect(recoveredResultTerminal).toMatchObject({
        attempt: 2,
        payload: {
          verdict: "replan_required",
          resultId: firstResult.resultId,
          resultOwnerEpisodeId,
          recoveredByEpisodeId: currentAttemptTerminal?.episodeId,
          recoveredByAttempt: 3,
        },
      });
      expect(recoveredResultTerminal?.sequence).toBe(recoveredResultEvent!.sequence + 1);
      expect(sourceRegistrationTerminal).toMatchObject({
        attempt: initialClaim.attempt,
        payload: {
          verdict: "replan_required",
          reasonCode: "P75_CONTINUATION_RESULT_ALREADY_RECORDED",
          resultId: firstResult.resultId,
          relatedEpisodeRole: "source_registration",
          recoveredByEpisodeId: currentAttemptTerminal?.episodeId,
          recoveredByAttempt: 3,
        },
      });
      expect(currentAttemptTerminal).toMatchObject({
        attempt: 3,
        payload: {
          verdict: "replan_required",
          resultId: firstResult.resultId,
          resultOwnerEpisodeId,
          resultOwnerAttempt: 2,
        },
      });
      const closedEpisodes = await db.select({
        id: aiAgentEpisodesTable.id,
        state: aiAgentEpisodesTable.state,
        verdict: aiAgentEpisodesTable.verdict,
        reasonCode: aiAgentEpisodesTable.reasonCode,
        closedAt: aiAgentEpisodesTable.closedAt,
      }).from(aiAgentEpisodesTable).where(inArray(aiAgentEpisodesTable.id, [
        resultOwnerEpisodeId!,
        sourceEpisode.episodeId,
        currentAttemptTerminal!.episodeId,
      ]));
      expect(closedEpisodes).toHaveLength(3);
      expect(closedEpisodes).toEqual(expect.arrayContaining([
        expect.objectContaining({
          id: resultOwnerEpisodeId,
          state: "completed",
          verdict: "replan_required",
          closedAt: expect.any(Date),
        }),
        expect.objectContaining({
          id: sourceEpisode.episodeId,
          state: "completed",
          verdict: "replan_required",
          closedAt: expect.any(Date),
        }),
        expect.objectContaining({
          id: currentAttemptTerminal!.episodeId,
          state: "completed",
          verdict: "replan_required",
          closedAt: expect.any(Date),
        }),
      ]));
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
      const [execution] = await db.select().from(aiExecutionsTable)
        .where(eq(aiExecutionsTable.id, fixture.executionId))
        .limit(1);
      const [episode] = await db.select().from(aiAgentEpisodesTable)
        .where(eq(aiAgentEpisodesTable.executionId, fixture.executionId))
        .limit(1);
      expect(bundle).toMatchObject({
        verdict: "OBSERVED",
        executionId: fixture.executionId,
        attempt: execution?.attempt,
        episodeId: episode?.id,
      });
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
      expect(directObservations.filter((row) => row.provenance === "DIRECT_OBSERVATION")).toHaveLength(5);
      const validatorObservation = directObservations.find(
        (row) => row.sourceType === "validator_process_attestation",
      );
      expect(validatorObservation).toMatchObject({
        executionId: fixture.executionId,
        episodeId: episode?.id,
        projectRevision: fixture.params.sourceRevision,
        provenance: "DIRECT_OBSERVATION",
        predicate: "validator.child_process_environment",
        completeness: "complete",
        freshness: "fresh",
        value: {
          status: "known",
          operationId: fixture.params.operationId,
          validationEvidenceId: "mock-evidence-1",
          validatorProfile: "ai-orchestrator-tests",
        },
      });
      expect(effects[0]?.afterObservationIds).toContain(validatorObservation?.id);
      expect(episode?.attempt).toBe(execution?.attempt);
      expect(episode?.projectRevision).toBe(fixture.params.sourceRevision);
      const episodeEvents = await db.select({
        eventType: aiAgentEpisodeEventsTable.eventType,
        payload: aiAgentEpisodeEventsTable.payload,
      })
        .from(aiAgentEpisodeEventsTable)
        .where(eq(aiAgentEpisodeEventsTable.executionId, fixture.executionId));
      expect(episodeEvents.map((event) => event.eventType)).toEqual(
        expect.arrayContaining(["ACTION_REQUESTED", "ACTION_COMMITTED", "EFFECT_CLASSIFIED"]),
      );
      const requestedActionId = (episodeEvents.find((event) => event.eventType === "ACTION_REQUESTED")
        ?.payload as { actionId?: unknown } | undefined)?.actionId;
      expect(typeof requestedActionId).toBe("string");
      expect(effects[0]).toMatchObject({
        actionId: requestedActionId,
        executionId: fixture.executionId,
        attempt: execution?.attempt,
        episodeId: episode?.id,
      });
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

  it("accepts current-attempt validation evidence bound to the execution and operation", async () => {
    validationCalls.length = 0;
    validationEvidenceContexts.length = 0;
    const fixture = await createReclaimedRecipeFixture({
      proofRequired: true,
      mutateCheckpointNode: (_nodeId, index) => index === 0
        ? { status: "queued", attempts: 0, validationAttempts: 0, evidenceRefs: [] }
        : undefined,
    });
    try {
      const result = await runRecipeOperation(fixture.params);
      expect(result.status).toBe("completed");
      expect(result.executionId).toBe(fixture.executionId);
      expect(result.receipt.status).toBe("completed");
      expect(validationCalls).toEqual(["workspace-typecheck", "ai-orchestrator-tests"]);
      expect(validationEvidenceContexts).toHaveLength(2);
      expect(validationEvidenceContexts[0]).toMatchObject({
        operationId: fixture.executionId,
        projectRevision: fixture.params.sourceRevision,
        candidateHash: fixture.params.candidateIdentity,
        environmentProfile: { id: "candidate-validation" },
      });
      expect(fixture.executionId).not.toBe(fixture.params.operationId);

      const [execution] = await db.select({
        attempt: aiExecutionsTable.attempt,
        request: aiExecutionsTable.request,
      }).from(aiExecutionsTable)
        .where(eq(aiExecutionsTable.id, fixture.executionId))
        .limit(1);
      if (!execution) throw new Error("candidate validation execution was not persisted");
      expect(JSON.parse(execution.request).proofRequired).toBe(true);
      expect(JSON.parse(execution.request).proofEvidenceMode).toBe("artifact_only");
      expect(JSON.parse(execution.request).operationId).toBe(fixture.params.operationId);

      const successfulAcceptances = await db.select({
        id: aiExecutionAcceptancesTable.id,
        evidenceRequired: aiExecutionAcceptancesTable.evidenceRequired,
        evidenceComplete: aiExecutionAcceptancesTable.evidenceComplete,
        evidenceSnapshotId: aiExecutionAcceptancesTable.evidenceSnapshotId,
      })
        .from(aiExecutionAcceptancesTable)
        .where(and(
          eq(aiExecutionAcceptancesTable.executionId, fixture.executionId),
          eq(aiExecutionAcceptancesTable.attempt, execution.attempt),
          eq(aiExecutionAcceptancesTable.outcome, "SUCCEEDED"),
        ));
      expect(successfulAcceptances).toHaveLength(1);
      expect(successfulAcceptances[0]).toMatchObject({
        evidenceRequired: 1,
        evidenceComplete: 1,
        evidenceSnapshotId: expect.any(String),
      });

      const proof = await db.transaction((tx) => loadCanonicalProof({
        tx,
        executionId: fixture.executionId,
        scope: {
          projectId: fixture.params.projectId,
          executionId: fixture.executionId,
          operationId: fixture.params.operationId,
          sourceRevisionBinding: "execution",
          sourceRevision: fixture.params.sourceRevision,
          candidateIdentityBinding: "required",
          candidateIdentity: fixture.params.candidateIdentity,
        },
        goalStatus: "completed",
      }));
      expect(proof.accepted).toBe(true);
      expect(proof.verdict).toBe("PROVEN");
    } finally {
      await fixture.cleanup();
    }
  });

  it.each(["missing", "unknown", "mismatch", "stale", "old_timestamp"] as const)(
    "blocks candidate validation when validator process evidence is %s",
    async (attestationMode) => {
      validationCalls.length = 0;
      validationEvidenceContexts.length = 0;
      validationAttestationMode = attestationMode;
      const fixture = await createReclaimedRecipeFixture();
      try {
        const result = await runRecipeOperation(fixture.params);
        expect(result.status).toBe("blocked");
        expect(await db.select().from(aiAgentEffectBundlesTable)
          .where(eq(aiAgentEffectBundlesTable.executionId, fixture.executionId)))
          .toHaveLength(0);
        expect(await db.select().from(aiAgentEffectsTable)
          .where(eq(aiAgentEffectsTable.executionId, fixture.executionId)))
          .toHaveLength(0);
        expect(await db.select().from(aiExecutionAcceptancesTable).where(and(
          eq(aiExecutionAcceptancesTable.executionId, fixture.executionId),
          eq(aiExecutionAcceptancesTable.outcome, "SUCCEEDED"),
        ))).toHaveLength(0);
        const episodeEvents = await db.select({ eventType: aiAgentEpisodeEventsTable.eventType })
          .from(aiAgentEpisodeEventsTable)
          .where(eq(aiAgentEpisodeEventsTable.executionId, fixture.executionId));
        expect(episodeEvents.map((event) => event.eventType)).toContain("ACTION_COMMITTED");
      } finally {
        validationAttestationMode = "known";
        await fixture.cleanup();
      }
    },
  );

  it("rejects prior-attempt node evidence when a proof-required recipe resumes", async () => {
    validationCalls.length = 0;
    validationEvidenceContexts.length = 0;
    const fixture = await createReclaimedRecipeFixture({ proofRequired: true });
    try {
      const result = await runRecipeOperation(fixture.params);
      expect(result.status).toBe("blocked");
      expect(result.receipt.status).toBe("cancelled");
      expect(validationCalls).toEqual(["ai-orchestrator-tests"]);

      const accepted = await db.select({ id: aiExecutionAcceptancesTable.id })
        .from(aiExecutionAcceptancesTable)
        .where(and(
          eq(aiExecutionAcceptancesTable.executionId, fixture.executionId),
          eq(aiExecutionAcceptancesTable.attempt, 1),
          eq(aiExecutionAcceptancesTable.outcome, "SUCCEEDED"),
        ));
      expect(accepted).toHaveLength(0);

      const interrupted = await db.select({
        outcome: aiExecutionAcceptancesTable.outcome,
        evidenceRequired: aiExecutionAcceptancesTable.evidenceRequired,
        evidenceComplete: aiExecutionAcceptancesTable.evidenceComplete,
      })
        .from(aiExecutionAcceptancesTable)
        .where(and(
          eq(aiExecutionAcceptancesTable.executionId, fixture.executionId),
          eq(aiExecutionAcceptancesTable.attempt, 1),
        ));
      expect(interrupted).toMatchObject([{
        outcome: "INTERRUPTED",
        evidenceRequired: 1,
        evidenceComplete: 0,
      }]);
    } finally {
      await fixture.cleanup();
    }
  });

  it("derives runtime.start Canonical Proof from Gate C before the separate World State transition", async () => {
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
    const stopSourceRuntime = async () => {
      await manager.stop(projectId);
      preStateRuntime = {
        running: false,
        sessionId: null,
        pid: null,
        port: null,
      };
    };
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
        id: aiExecutionAcceptancesTable.id,
        attempt: aiExecutionAcceptancesTable.attempt,
        effectBundleId: aiExecutionAcceptancesTable.effectBundleId,
        evidenceRequired: aiExecutionAcceptancesTable.evidenceRequired,
        evidenceComplete: aiExecutionAcceptancesTable.evidenceComplete,
        evidenceSnapshotId: aiExecutionAcceptancesTable.evidenceSnapshotId,
        sourceRevision: aiExecutionAcceptancesTable.sourceRevision,
        operationId: aiExecutionAcceptancesTable.operationId,
        candidateIdentity: aiExecutionAcceptancesTable.candidateIdentity,
      }).from(aiExecutionAcceptancesTable).where(and(
        eq(aiExecutionAcceptancesTable.executionId, executionId),
        eq(aiExecutionAcceptancesTable.attempt, 0),
        eq(aiExecutionAcceptancesTable.outcome, "SUCCEEDED"),
      )).limit(1);
      expect(acceptance).toMatchObject({
        effectBundleId: bundle?.id,
        sourceRevision,
        operationId,
      });
      const [evidenceSnapshot] = acceptance?.evidenceSnapshotId
        ? await db.select().from(aiExecutionEvidenceSnapshotsTable)
          .where(eq(aiExecutionEvidenceSnapshotsTable.id, acceptance.evidenceSnapshotId))
          .limit(1)
        : [];
      expect(evidenceSnapshot).toMatchObject({
        projectId,
        executionId,
        attempt: acceptance?.attempt,
        sourceRevision,
        complete: 1,
        verdict: "PROVEN",
      });
      const gateCArtifact = Array.isArray(evidenceSnapshot?.artifactRefs)
        ? evidenceSnapshot.artifactRefs.find((artifact) => (
            Boolean(artifact)
            && typeof artifact === "object"
            && !Array.isArray(artifact)
            && (artifact as Record<string, unknown>).kind === "runtime_start_gate_c"
          ))
        : undefined;
      expect(gateCArtifact).toMatchObject({
        kind: "runtime_start_gate_c",
        version: 2,
        executionId,
        attempt: acceptance?.attempt,
        operationId,
        sourceRevision,
        sourceRevisionKind: "git_commit",
        sourceRevisionSource: "git_commit_object_id",
      });
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
        completeness: "complete",
        freshness: "fresh",
        environmentFreshness: "fresh",
        environmentRevision: runtimeSnapshot.environmentRevision,
        projectRevision: sourceRevision,
        subject: `runtime:${runtimeSnapshot.sessionId}`,
        sourceId: `runtime-child-process:${runtimeSnapshot.sessionId}`,
        sourceRefs: expect.arrayContaining([`runtime:${runtimeSnapshot.sessionId}`]),
      });
      expect(childProcessObservation?.value).toMatchObject({
        status: "known",
        operationId,
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
      expect(transition?.afterObservationIds).toContain(childProcessObservation?.id);
      expect(transition?.materializedObservationIds).toEqual(expect.arrayContaining([
        beforeStateObservation?.id,
        runtimeStatusObservation?.id,
        childProcessObservation?.id,
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
      const proofBinding = await materializeStrategyReplayCaseProofBinding({
        projectId,
        episodeId: episode!.id,
      });
      const canonicalProof = await db.transaction((tx) => loadCanonicalProof({
        tx,
        executionId: result.executionId,
        goalStatus: "completed",
        scope: {
          projectId,
          executionId: result.executionId,
          operationId,
          sourceRevisionBinding: "scope",
          candidateIdentityBinding: acceptance?.candidateIdentity == null
            ? "not_applicable"
            : "required",
          sourceRevision,
          candidateIdentity: acceptance?.candidateIdentity ?? null,
        },
        attempt: acceptance?.attempt ?? 0,
      }));
      expect(acceptance).toMatchObject({
        evidenceRequired: 1,
        evidenceComplete: 1,
        evidenceSnapshotId: expect.any(String),
      });
      expect(canonicalProof.accepted, canonicalProof.failureReasons.join(", ")).toBe(true);
      expect(episode).toMatchObject({
        state: "completed",
        verdict: "achieved",
        reasonCode: "CANONICAL_PROOF_PROVEN",
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
      const [runtimeAfterObservation] = await db.select()
        .from(aiAgentObservationsTable)
        .where(and(
          eq(aiAgentObservationsTable.executionId, executionId),
          eq(
            aiAgentObservationsTable.sourceId,
            `gate-c:${executionId}:0:after:runtime.after_state`,
          ),
        ))
        .limit(1);
      expect(runtimeAfterObservation).toBeDefined();
      await db.update(aiAgentObservationsTable)
        .set({ environmentFreshness: "stale" })
        .where(eq(aiAgentObservationsTable.id, runtimeAfterObservation!.id));
      const mismatchedBindingProof = await db.transaction((tx) => loadCanonicalProof({
        tx,
        executionId: result.executionId,
        goalStatus: "completed",
        scope: {
          projectId,
          executionId: result.executionId,
          operationId,
          sourceRevisionBinding: "scope",
          candidateIdentityBinding: acceptance?.candidateIdentity == null
            ? "not_applicable"
            : "required",
          sourceRevision,
          candidateIdentity: acceptance?.candidateIdentity ?? null,
        },
        attempt: acceptance?.attempt ?? 0,
      }));
      expect(mismatchedBindingProof.accepted).toBe(false);
      expect(mismatchedBindingProof.failureReasons)
        .toContain("runtime_start_gate_c_proof_mismatch");
      const [stillSucceeded] = await db.select({
        outcome: aiExecutionAcceptancesTable.outcome,
        evidenceRequired: aiExecutionAcceptancesTable.evidenceRequired,
      }).from(aiExecutionAcceptancesTable)
        .where(eq(aiExecutionAcceptancesTable.executionId, executionId))
        .limit(1);
      expect(stillSucceeded).toMatchObject({
        outcome: "SUCCEEDED",
        evidenceRequired: 1,
      });
      await db.update(aiAgentObservationsTable)
        .set({ environmentFreshness: runtimeAfterObservation!.environmentFreshness })
        .where(eq(aiAgentObservationsTable.id, runtimeAfterObservation!.id));
      const restoredProof = await db.transaction((tx) => loadCanonicalProof({
        tx,
        executionId: result.executionId,
        goalStatus: "completed",
        scope: {
          projectId,
          executionId: result.executionId,
          operationId,
          sourceRevisionBinding: "scope",
          candidateIdentityBinding: acceptance?.candidateIdentity == null
            ? "not_applicable"
            : "required",
          sourceRevision,
          candidateIdentity: acceptance?.candidateIdentity ?? null,
        },
        attempt: acceptance?.attempt ?? 0,
      }));
      expect(restoredProof.accepted).toBe(true);
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

      await stopSourceRuntime();
      await writeFile(
        path.join(rootPath, "node_modules/.cache/mutate-next-replay"),
        "mutate\n",
        "utf8",
      );
      const concurrentReplayStarts = await Promise.allSettled([
        runRegisteredStrategyReplayCase({
          projectId,
          caseRegistrationId: registeredReplayCase!.id,
          userId,
        }),
        runRegisteredStrategyReplayCase({
          projectId,
          caseRegistrationId: registeredReplayCase!.id,
          userId,
        }),
      ]);
      const replayOwners = concurrentReplayStarts.filter(
        (start) => start.status === "fulfilled" && !start.value.recovered,
      );
      expect(replayOwners).toHaveLength(1);
      const replayOwner = replayOwners[0];
      if (!replayOwner || replayOwner.status !== "fulfilled") {
        throw new Error("Concurrent replay admission did not produce exactly one owned run.");
      }
      const replayResult = replayOwner.value;
      for (const start of concurrentReplayStarts) {
        if (start.status === "rejected") {
          expect(start.reason).toBeInstanceOf(StrategyReplayCaseBusyError);
        } else if (start.value.recovered) {
          expect(start.value.receipt).toEqual(replayResult.receipt);
        }
      }
      expect(replayResult.status).toBe("incomplete");
      expect(replayResult.recovered).toBe(false);
      expect(replayResult.receipt).toMatchObject({
        status: "incomplete",
        incompleteReason: "replay_identity_mismatch",
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

      const retryRequestId = crypto.randomUUID();
      await rm(path.join(rootPath, "node_modules/.cache/mutate-next-replay"), { force: true });
      const retryResult = await runRegisteredStrategyReplayCase({
        projectId,
        caseRegistrationId: registeredReplayCase!.id,
        userId,
        newAttemptRequestId: retryRequestId,
      });
      expect(retryResult.receipt.attemptNumber).toBe(2);
      const attemptsAfterRetry = await db.select().from(aiStrategyReplayCaseRunsTable)
        .where(eq(aiStrategyReplayCaseRunsTable.caseRegistrationId, registeredReplayCase!.id));
      const orderedAttempts = [...attemptsAfterRetry]
        .sort((left, right) => left.attemptNumber - right.attemptNumber);
      expect(orderedAttempts).toHaveLength(2);
      expect(orderedAttempts[0]?.receipt).toEqual(runsAfterReplay[0]?.receipt);
      expect(orderedAttempts[0]?.status).toBe("incomplete");
      expect(orderedAttempts[1]).toMatchObject({
        attemptNumber: 2,
        status: "proven",
        operationId: retryResult.receipt.operationId,
        replayExecutionId: expect.any(String),
        replayEpisodeId: expect.any(String),
        replayAttempt: expect.any(Number),
        replayCanonicalProofHash: expect.stringMatching(/^[a-f0-9]{64}$/),
      });
      expect(retryResult.status).toBe("proven");
      expect(retryResult.receipt).toMatchObject({
        status: "proven",
        incompleteReason: null,
        replayAcceptanceId: expect.any(String),
        replayEffectBundleId: expect.any(String),
        replayCanonicalProofHash: expect.stringMatching(/^[a-f0-9]{64}$/),
        workspaceTreeHash: expect.stringMatching(/^[a-f0-9]{64}$/),
      });
      expect(retryResult.receipt.replayCanonicalProofHash)
        .not.toBe((registeredReplayCase!.caseDefinition as { sourceCanonicalProofHash: string })
          .sourceCanonicalProofHash);
      const retryAttempt = orderedAttempts[1]!;
      expect(retryResult.receipt).toMatchObject({
        runId: retryAttempt.id,
        attemptNumber: 2,
        operationId: retryAttempt.operationId,
        sourceCanonicalProofHash: registeredReplayCase!.caseDefinition
          ? (registeredReplayCase!.caseDefinition as { sourceCanonicalProofHash: string })
            .sourceCanonicalProofHash
          : undefined,
      });
      expect(orderedAttempts[1]?.id).not.toBe(orderedAttempts[0]?.id);
      const [retryEpisode] = await db.select().from(aiAgentEpisodesTable).where(and(
        eq(aiAgentEpisodesTable.projectId, projectId),
        eq(aiAgentEpisodesTable.id, retryAttempt.replayEpisodeId!),
      )).limit(1);
      expect(retryEpisode).toMatchObject({
        executionId: retryAttempt.replayExecutionId,
        attempt: retryAttempt.replayAttempt,
        projectRevision: sourceRevision,
      });
      const replayProof = await materializeStrategyReplayCaseProofBinding({
        projectId,
        episodeId: retryAttempt.replayEpisodeId!,
      });
      expect(replayProof).toMatchObject({
        status: "verified",
        binding: {
          executionId: retryAttempt.replayExecutionId,
          attempt: retryAttempt.replayAttempt,
          acceptanceId: retryResult.receipt.replayAcceptanceId,
          effectBundleId: retryResult.receipt.replayEffectBundleId,
          sourceCanonicalProofHash: retryResult.receipt.replayCanonicalProofHash,
        },
      });
      const replayTransitions = await db.select().from(aiWorldTransitionsTable)
        .where(eq(aiWorldTransitionsTable.executionId, retryAttempt.replayExecutionId!));
      expect(replayTransitions).toHaveLength(1);
      expect(replayTransitions[0]).toMatchObject({
        status: "materialized",
        taskScope: expect.stringMatching(/^scope:/),
      });
      const replayObservations = await db.select({
        taskScope: aiAgentObservationsTable.taskScope,
      }).from(aiAgentObservationsTable).where(
        eq(aiAgentObservationsTable.executionId, retryAttempt.replayExecutionId!),
      );
      expect(replayObservations.length).toBeGreaterThan(0);
      expect(new Set(replayObservations.map((row) => row.taskScope)))
        .toEqual(new Set([replayTransitions[0]!.taskScope]));
      expect(retryEpisode?.scope).toMatchObject({
        strategyReplayCase: {
          caseRegistrationId: registeredReplayCase!.id,
          caseRunId: retryAttempt.id,
          caseAttemptNumber: retryAttempt.attemptNumber,
          caseId: (registeredReplayCase!.caseDefinition as { caseId: string }).caseId,
          sourceEpisodeId: registeredReplayCase!.sourceEpisodeId,
          sourceCanonicalProofHash:
            (registeredReplayCase!.caseDefinition as { sourceCanonicalProofHash: string })
              .sourceCanonicalProofHash,
        },
      });
      const retryEpisodesBeforeReplay = await db.select({ id: aiAgentEpisodesTable.id })
        .from(aiAgentEpisodesTable).where(eq(aiAgentEpisodesTable.projectId, projectId));
      const retryExecutionsBeforeReplay = await db.select({ id: aiExecutionsTable.id })
        .from(aiExecutionsTable).where(eq(aiExecutionsTable.projectId, projectId));
      const duplicateRetry = await runRegisteredStrategyReplayCase({
        projectId,
        caseRegistrationId: registeredReplayCase!.id,
        userId,
        newAttemptRequestId: retryRequestId,
      });
      expect(duplicateRetry).toEqual({
        status: retryResult.status,
        receipt: retryResult.receipt,
        recovered: true,
      });
      expect(await db.select().from(aiStrategyReplayCaseRunsTable)
        .where(eq(aiStrategyReplayCaseRunsTable.caseRegistrationId, registeredReplayCase!.id)))
        .toHaveLength(2);
      expect(await db.select({ id: aiAgentEpisodesTable.id }).from(aiAgentEpisodesTable)
        .where(eq(aiAgentEpisodesTable.projectId, projectId)))
        .toHaveLength(retryEpisodesBeforeReplay.length);
      expect(await db.select({ id: aiExecutionsTable.id }).from(aiExecutionsTable)
        .where(eq(aiExecutionsTable.projectId, projectId)))
        .toHaveLength(retryExecutionsBeforeReplay.length);

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
        await stopSourceRuntime();
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

      const proofUnavailableOperationId = crypto.randomUUID();
      const proofUnavailableRunnerBase = createRuntimeStartRunner(manager);
      const proofUnavailableRuntimeStartRunner = async (
        args: Parameters<typeof proofUnavailableRunnerBase>[0],
      ) => {
        const beforeEffectGate = args.beforeEffectGate;
        const proofUnavailableExecutionId = args.executionId;
        const proofUnavailableAttempt = args.executionAttempt;
        if (
          !beforeEffectGate
          || !proofUnavailableExecutionId
          || typeof proofUnavailableAttempt !== "number"
        ) {
          throw new Error("runtime start did not receive its attempt-bound pre-state gate");
        }
        return proofUnavailableRunnerBase({
          ...args,
          beforeEffectGate: async (input) => {
            const decision = await beforeEffectGate(input);
            if (decision.allowEffect) {
              const beforeStateSourceId = `runtime-start:${proofUnavailableExecutionId}:${proofUnavailableAttempt}:action:${proofUnavailableExecutionId}:${proofUnavailableAttempt}:gate-c:before:runtime.before_state`;
              const invalidated = await db.update(aiAgentObservationsTable)
                .set({ freshness: "stale" })
                .where(and(
                  eq(aiAgentObservationsTable.projectId, projectId),
                  eq(aiAgentObservationsTable.executionId, proofUnavailableExecutionId),
                  eq(aiAgentObservationsTable.sourceId, beforeStateSourceId),
                ))
                .returning({ id: aiAgentObservationsTable.id });
              expect(invalidated).toHaveLength(1);
            }
            return decision;
          },
        });
      };
      const proofUnavailableResult = await runRecipeOperation({
        projectId,
        operationId: proofUnavailableOperationId,
        sessionId,
        userId,
        idempotencyKey: `${proofUnavailableOperationId}:runtime-effect-without-proof`,
        rootPath,
        sourceRevision,
        recipeId: "runtime.start",
        recipeVersion: 1,
        runtimeStartRunner: proofUnavailableRuntimeStartRunner,
      });
      executionIds.push(proofUnavailableResult.executionId);
      expect(proofUnavailableResult.status).toBe("completed");
      const [proofUnavailableBundle] = await db.select()
        .from(aiAgentEffectBundlesTable)
        .where(eq(aiAgentEffectBundlesTable.executionId, proofUnavailableResult.executionId))
        .limit(1);
      expect(proofUnavailableBundle).toMatchObject({ verdict: "OBSERVED" });
      const [proofUnavailableAcceptance] = await db.select({
        outcome: aiExecutionAcceptancesTable.outcome,
        evidenceRequired: aiExecutionAcceptancesTable.evidenceRequired,
        evidenceSnapshotId: aiExecutionAcceptancesTable.evidenceSnapshotId,
      }).from(aiExecutionAcceptancesTable).where(and(
        eq(aiExecutionAcceptancesTable.executionId, proofUnavailableResult.executionId),
        eq(aiExecutionAcceptancesTable.outcome, "SUCCEEDED"),
      )).limit(1);
      expect(proofUnavailableAcceptance).toMatchObject({
        outcome: "SUCCEEDED",
        evidenceRequired: 0,
        evidenceSnapshotId: null,
      });
      const proofUnavailableObservations = await db.select()
        .from(aiAgentObservationsTable)
        .where(eq(aiAgentObservationsTable.executionId, proofUnavailableResult.executionId));
      expect(proofUnavailableObservations.find((row) => row.predicate === "runtime.before_state"))
        .toMatchObject({ freshness: "stale" });
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

  it("executes a Mission runtime.start action through its World Transition to the D2 dispatch decision", async () => {
    const fixture = await createGateCRecipeFixture("runtime.start");
    const exerciseApiStartupRecovery = process.env.RUN_E2_RUNTIME_START_API_STARTUP_RECOVERY === "1";
    const exerciseGateCWriterCrash = process.env.RUN_E2_RUNTIME_START_GATE_C_CRASH === "1"
      || exerciseApiStartupRecovery;
    const { projectId, userId, rootPath } = fixture.params;
    const missionId = crypto.randomUUID();
    const sourceGoalId = crypto.randomUUID();
    const targetGoalId = crypto.randomUUID();
    const planRevision = `mission-runtime-start-loop:${projectId}`;
    const transitionRequirement = {
      kind: "runtime.start",
      version: 1,
      sourceStepId: "runtime-start",
      targetStepId: "target-step",
      from: "stopped",
      to: "running",
    } as const;
    const plan = {
      hash: planRevision,
      transitionRequirements: [transitionRequirement],
    };
    const queuedJobs: Array<() => Promise<void>> = [];
    let recipeResult: Awaited<ReturnType<typeof runRecipeOperation>> | undefined;
    let executionId: string | undefined;
    let completionParams: Parameters<typeof aiExecutionState.completeAiExecution>[0] | undefined;
    let triggerInstalled = false;
    const crashApplicationName = `e2-runtime-start-writer-${projectId.replaceAll("-", "").slice(0, 12)}`;
    const crashFunctionName = `e2_runtime_start_writer_pause_${projectId.replaceAll("-", "")}`;
    const crashTriggerName = `e2_runtime_start_writer_trigger_${projectId.replaceAll("-", "")}`;
    const actualCompleteAiExecution = aiExecutionState.completeAiExecution;
    const manager = new WorkspaceRuntimeManager({
      store: createInMemoryWorkspaceRuntimeStore(),
      workerId: `mission-runtime-start-loop:${projectId}`,
      startPreStateObserver: async ({
        projectId: observedProjectId,
        revision,
      }: {
        projectId: string;
        revision: string;
      }) => ({
        status: "observed" as const,
        runtimeStatus: "stopped" as const,
        projectId: observedProjectId,
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
        detail: "The isolated test observer confirms the runtime is stopped.",
      }),
    });
    const actualRunRecipeOperation = recipeOperationRunnerModule.runRecipeOperation;
    const runnerSpy = vi.spyOn(recipeOperationRunnerModule, "runRecipeOperation")
      .mockImplementation(async (params) => {
        const result = await actualRunRecipeOperation({
          ...params,
          runtimeStartRunner: createRuntimeStartRunner(manager),
        });
        recipeResult = result;
        executionId = result.executionId;
        return result;
      });
    const completionSpy = exerciseGateCWriterCrash
      ? vi.spyOn(aiExecutionState, "completeAiExecution").mockImplementation(async (params) => {
          completionParams = params;
          const rawDatabaseUrl = process.env.DATABASE_URL;
          if (!rawDatabaseUrl) {
            throw new Error("Gate C writer crash test requires an explicit disposable DATABASE_URL.");
          }
          const childDatabaseUrl = new URL(rawDatabaseUrl);
          const databaseName = decodeURIComponent(childDatabaseUrl.pathname.replace(/^\/+/, ""));
          if (
            !["localhost", "127.0.0.1", "::1", "[::1]"].includes(childDatabaseUrl.hostname)
            || !/(?:^|[_-])(?:test|disposable)(?:[_-]|$)/i.test(databaseName)
          ) {
            throw new Error("Gate C writer crash test requires a loopback disposable/test database.");
          }

          childDatabaseUrl.searchParams.set("application_name", crashApplicationName);
          await db.execute(sql.raw(`
            CREATE FUNCTION ${crashFunctionName}() RETURNS trigger LANGUAGE plpgsql AS $$
            BEGIN
              IF NEW.operation_id = '${fixture.params.operationId}' THEN
                PERFORM pg_sleep(5);
              END IF;
              RETURN NEW;
            END;
            $$
          `));
          triggerInstalled = true;
          await db.execute(sql.raw(`
            CREATE TRIGGER ${crashTriggerName}
            BEFORE INSERT ON ai_execution_acceptances
            FOR EACH ROW EXECUTE FUNCTION ${crashFunctionName}()
          `));

          const moduleUrl = new URL("./ai-execution-state.ts", import.meta.url).href;
          const childSource = [
            "(async () => {",
            `  const { completeAiExecution } = await import(${JSON.stringify(moduleUrl)});`,
            `  await completeAiExecution(${JSON.stringify(params)});`,
            "  process.exit(0);",
            "})().catch((error) => { console.error(error); process.exit(1); });",
          ].join("\n");
          const child = spawn(process.execPath, ["--import", "tsx", "-e", childSource], {
            cwd: process.cwd(),
            env: {
              ...process.env,
              DATABASE_URL: childDatabaseUrl.toString(),
              PGAPPNAME: crashApplicationName,
            },
            stdio: "pipe",
          });
          child.stdin?.end();
          let childOutput = "";
          let childDiagnostics = "";
          child.stdout?.setEncoding("utf8");
          child.stderr?.setEncoding("utf8");
          child.stdout?.on("data", (chunk: string) => {
            childOutput += chunk;
          });
          child.stderr?.on("data", (chunk: string) => {
            childDiagnostics += chunk;
          });
          const childExit = new Promise<{ code: number | null; signal: NodeJS.Signals | null }>(
            (resolve) => child.once("exit", (code, signal) => resolve({ code, signal })),
          );
          try {
            const pauseDeadline = Date.now() + 120_000;
            let writerPaused = false;
            let lastWriterActivity: unknown[] = [];
            while (Date.now() < pauseDeadline) {
              if (child.exitCode !== null || child.signalCode !== null) {
                throw new Error(
                  "Gate C completion child exited before acceptance transaction pause. "
                  + `stderr=${childDiagnostics}; stdout=${childOutput}`,
                );
              }
              const activity = await db.execute(sql`
                SELECT pid, state, wait_event, left(query, 160) AS query
                FROM pg_stat_activity
                WHERE datname = current_database()
                  AND application_name = ${crashApplicationName}
              `);
              lastWriterActivity = activity.rows;
              if (activity.rows.some((row) =>
                row.state === "active"
                && row.wait_event === "PgSleep"
                && String(row.query).toLowerCase().includes("ai_execution_acceptances")
              )) {
                writerPaused = true;
                break;
              }
              await new Promise((resolve) => setTimeout(resolve, 100));
            }
            if (!writerPaused) {
              throw new Error(
                "Timed out waiting for Gate C acceptance transaction pause. "
                + `backendActivity=${JSON.stringify(lastWriterActivity)}; `
                + `stderr=${childDiagnostics}; stdout=${childOutput}`,
              );
            }
            child.kill("SIGKILL");
            expect(await childExit).toMatchObject({ code: null, signal: "SIGKILL" });
            const disconnectDeadline = Date.now() + 20_000;
            let disconnected = false;
            while (Date.now() < disconnectDeadline) {
              const sessions = await db.execute(sql`
                SELECT pid FROM pg_stat_activity
                WHERE datname = current_database() AND application_name = ${crashApplicationName}
              `);
              if (sessions.rows.length === 0) {
                disconnected = true;
                break;
              }
              await new Promise((resolve) => setTimeout(resolve, 100));
            }
            if (!disconnected) throw new Error("Killed Gate C writer retained its PostgreSQL session.");
          } finally {
            if (child.exitCode === null && child.signalCode === null) {
              child.kill("SIGKILL");
              await childExit;
            }
          }
          throw new Error("Injected interruption after SIGKILL inside the Gate C acceptance transaction.");
        })
      : undefined;
    const queueSpy = vi.spyOn(heavyJobQueue, "enqueueWithId")
      .mockImplementation((_id, job) => {
        queuedJobs.push(job);
        return true;
      });

    try {
      await writeFile(
        path.join(rootPath, "package.json"),
        JSON.stringify({ scripts: { dev: "node server.mjs" } }),
        "utf8",
      );
      await writeFile(
        path.join(rootPath, "server.mjs"),
        [
          "import http from 'node:http';",
          "import { readFileSync } from 'node:fs';",
          "const revision = readFileSync('node_modules/.cache/revision.txt', 'utf8').trim();",
          "const server = http.createServer((_req, res) => { res.setHeader('x-engineeringos-revision', revision); res.end('runtime-ready'); });",
          "server.listen(Number(process.env.PORT), '127.0.0.1');",
          "process.once('SIGTERM', () => server.close(() => process.exit(0)));",
        ].join("\n"),
        "utf8",
      );
      await writeFile(path.join(rootPath, ".gitignore"), "node_modules/\n", "utf8");
      await execFileAsync("git", ["-C", rootPath, "init", "-q"]);
      await execFileAsync("git", ["-C", rootPath, "config", "user.name", "EngineeringOS Fixture"]);
      await execFileAsync("git", ["-C", rootPath, "config", "user.email", "fixture@example.com"]);
      await execFileAsync("git", ["-C", rootPath, "add", ".gitignore", "package.json", "server.mjs"]);
      await execFileAsync("git", ["-C", rootPath, "commit", "-qm", "runtime start mission loop"]);
      const sourceRevision = (await execFileAsync(
        "git",
        ["-C", rootPath, "rev-parse", "HEAD"],
      )).stdout.trim();
      await mkdir(path.join(rootPath, "node_modules/.cache"), { recursive: true });
      await writeFile(
        path.join(rootPath, "node_modules/.cache/revision.txt"),
        `${sourceRevision}\n`,
        "utf8",
      );

      const now = new Date();
      await db.insert(aiMissionsTable).values({
        id: missionId,
        projectId,
        userId,
        title: "Runtime start decision loop",
        intent: "Start the runtime and dispatch its transition-bound successor",
        status: "active",
        scope: { kind: "project", projectId },
        autonomyPolicy: { activePlanRevision: planRevision },
        createdAt: now,
        updatedAt: now,
      });
      await db.insert(aiGoalsTable).values([
        {
          id: sourceGoalId,
          missionId,
          projectId,
          title: "Start runtime",
          status: exerciseGateCWriterCrash ? "completed" : "queued",
          nextAction: { kind: "recipe", recipeId: "runtime.start", recipeVersion: 1 },
          successCriteria: { stepId: "runtime-start", planRevision: plan },
          outcomeContract: { planRevision: { hash: planRevision } },
          createdAt: now,
          updatedAt: now,
        },
        {
          id: targetGoalId,
          missionId,
          projectId,
          title: "Verify runtime",
          status: "waiting_for_event",
          nextAction: {
            kind: "recipe",
            recipeId: "candidate.verify",
            recipeVersion: 1,
            approvedPaths: ["package.json"],
          },
          successCriteria: {
            stepId: "target-step",
            planRevision: plan,
            transitionRequirement,
          },
          outcomeContract: { planRevision: { hash: planRevision } },
          blockedReason: "runtime_transition_pending",
          createdAt: now,
          updatedAt: now,
        },
      ]);

      if (exerciseGateCWriterCrash) {
        const runtimeRunner = createRuntimeStartRunner(manager);
        let crashRunResult: Awaited<ReturnType<typeof runRecipeOperation>> | undefined;
        try {
          crashRunResult = await actualRunRecipeOperation({
            ...fixture.params,
            sourceRevision,
            missionId,
            goalId: sourceGoalId,
            planRevision,
            runtimeStartRunner: async (args) => {
              executionId = args.executionId;
              return runtimeRunner(args);
            },
          });
        } catch (error) {
          expect(String(error)).toContain("Injected interruption after SIGKILL");
        }
        executionId ??= crashRunResult?.executionId;
        if (!executionId || !completionParams) {
          throw new Error(`Gate C runtime.start did not reach the completion acceptance writer: ${
            JSON.stringify({ executionId, status: crashRunResult?.status, receipt: crashRunResult?.receipt })
          }`);
        }
        const [interruptedExecution] = await db.select({
          status: aiExecutionsTable.status,
        }).from(aiExecutionsTable).where(eq(aiExecutionsTable.id, executionId));
        const interruptedAcceptances = await db.select({
          id: aiExecutionAcceptancesTable.id,
        }).from(aiExecutionAcceptancesTable)
          .where(eq(aiExecutionAcceptancesTable.executionId, executionId));
        const [pendingTransition] = await db.select({
          status: aiWorldTransitionsTable.status,
          effectBundleId: aiWorldTransitionsTable.effectBundleId,
        }).from(aiWorldTransitionsTable)
          .where(eq(aiWorldTransitionsTable.executionId, executionId));
        const prematureDispatches = await db.select({ id: eventsTable.id })
          .from(eventsTable).where(and(
            eq(eventsTable.projectId, projectId),
            eq(eventsTable.goalId, targetGoalId),
            eq(eventsTable.type, "AiGoalRecipeDispatchRequested"),
          ));
        expect(interruptedExecution?.status).toBe("running");
        expect(interruptedAcceptances).toEqual([]);
        expect(pendingTransition).toMatchObject({
          status: "pending",
          effectBundleId: completionParams.effectBundleId,
        });
        expect(completionParams).toMatchObject({
          executionId,
          effectRequired: true,
          effectBundleId: expect.any(String),
        });
        expect(prematureDispatches).toEqual([]);

        if (exerciseApiStartupRecovery) {
          await db.update(aiExecutionsTable)
            .set({ leaseUntil: new Date(Date.now() - 1_000) })
            .where(eq(aiExecutionsTable.id, executionId));

          const portServer = createServer();
          await new Promise<void>((resolve, reject) => {
            portServer.once("error", reject);
            portServer.listen(0, "127.0.0.1", () => resolve());
          });
          const address = portServer.address();
          if (!address || typeof address === "string") {
            throw new Error("Could not reserve a loopback port for API startup recovery.");
          }
          const port = address.port;
          await new Promise<void>((resolve, reject) => {
            portServer.close((error) => error ? reject(error) : resolve());
          });

          const apiApplicationName = `e2-runtime-start-api-recovery-${projectId.replaceAll("-", "").slice(0, 12)}`;
          const apiDatabaseUrl = new URL(process.env.DATABASE_URL!);
          apiDatabaseUrl.searchParams.set("application_name", apiApplicationName);
          const apiSource = [
            "(async () => {",
            '  const { isProviderEgressDisabled } = await import("@workspace/ai-orchestrator");',
            '  if (!isProviderEgressDisabled()) throw new Error("Provider egress guard is not active.");',
            '  await import("./src/index.ts");',
            "})().catch((error) => { console.error(error); process.exitCode = 1; });",
          ].join("\n");
          const apiProcess = spawn(process.execPath, ["--import", "tsx", "-e", apiSource], {
            cwd: process.cwd(),
            env: {
              DATABASE_URL: apiDatabaseUrl.toString(),
              NODE_ENV: "test",
              LOG_LEVEL: "warn",
              PATH: process.env.PATH ?? "",
              HOME: process.env.HOME ?? "/tmp",
              PGAPPNAME: apiApplicationName,
              PORT: String(port),
              APP_ORIGINS: "",
              AI_PROVIDER_EGRESS_DISABLED: "1",
              RUN_CONTROLLED_RELEASE_VALIDATION: "1",
              DASHBOARD_E2E_TEST_MODE: "fixture",
              AI_CREDENTIALS_ENCRYPTION_KEY:
                `${crypto.randomUUID().replaceAll("-", "")}${crypto.randomUUID().replaceAll("-", "")}`,
            },
            stdio: "pipe",
          });
          apiProcess.stdin.end();
          let apiOutput = "";
          apiProcess.stdout.setEncoding("utf8").on("data", (chunk: string) => {
            apiOutput = `${apiOutput}${chunk}`.slice(-32_000);
          });
          apiProcess.stderr.setEncoding("utf8").on("data", (chunk: string) => {
            apiOutput = `${apiOutput}${chunk}`.slice(-32_000);
          });
          const apiExit = new Promise<{ code: number | null; signal: NodeJS.Signals | null }>(
            (resolve) => apiProcess.once("exit", (code, signal) => resolve({ code, signal })),
          );
          try {
            const recoveryDeadline = Date.now() + 90_000;
            let reconciled = false;
            while (Date.now() < recoveryDeadline) {
              if (apiProcess.exitCode !== null || apiProcess.signalCode !== null) {
                throw new Error(`Replacement API exited before startup reconciliation: ${apiOutput}`);
              }
              const [execution] = await db.select({ status: aiExecutionsTable.status })
                .from(aiExecutionsTable)
                .where(eq(aiExecutionsTable.id, executionId))
                .limit(1);
              const [acceptance] = await db.select({
                outcome: aiExecutionAcceptancesTable.outcome,
                terminalStatus: aiExecutionAcceptancesTable.terminalStatus,
                reasonCode: aiExecutionAcceptancesTable.reasonCode,
              }).from(aiExecutionAcceptancesTable)
                .where(eq(aiExecutionAcceptancesTable.executionId, executionId))
                .limit(1);
              if (execution?.status === "paused" && acceptance?.reasonCode === "EXECUTION_LEASE_EXPIRED") {
                expect(acceptance).toMatchObject({
                  outcome: "FAILED",
                  terminalStatus: "paused",
                  reasonCode: "EXECUTION_LEASE_EXPIRED",
                });
                reconciled = true;
                break;
              }
              await new Promise((resolve) => setTimeout(resolve, 100));
            }
            if (!reconciled) {
              throw new Error(`Replacement API did not reconcile the expired execution: ${apiOutput}`);
            }
            const [stillPending] = await db.select({ status: aiWorldTransitionsTable.status })
              .from(aiWorldTransitionsTable)
              .where(eq(aiWorldTransitionsTable.executionId, executionId));
            expect(stillPending?.status).toBe("pending");
            const dispatchesAfterStartup = await db.select({ id: eventsTable.id })
              .from(eventsTable).where(and(
                eq(eventsTable.projectId, projectId),
                eq(eventsTable.goalId, targetGoalId),
                eq(eventsTable.type, "AiGoalRecipeDispatchRequested"),
              ));
            expect(dispatchesAfterStartup).toEqual([]);
          } finally {
            if (apiProcess.exitCode === null && apiProcess.signalCode === null) {
              apiProcess.kill("SIGTERM");
              const graceful = await Promise.race([
                apiExit.then(() => true),
                new Promise<false>((resolve) => setTimeout(() => resolve(false), 20_000)),
              ]);
              if (!graceful && apiProcess.exitCode === null && apiProcess.signalCode === null) {
                apiProcess.kill("SIGKILL");
                await apiExit;
              }
            }
          }
          return;
        }

        expect(await actualCompleteAiExecution(completionParams)).toBe(true);
        expect(await retryPendingRuntimeStartTransitions(10)).toBeGreaterThan(0);
        expect(await wakeRuntimeTransitionMissionGoals()).toBe(1);
        const [accepted] = await db.select({
          outcome: aiExecutionAcceptancesTable.outcome,
          effectBundleId: aiExecutionAcceptancesTable.effectBundleId,
        }).from(aiExecutionAcceptancesTable).where(and(
          eq(aiExecutionAcceptancesTable.executionId, executionId),
          eq(aiExecutionAcceptancesTable.outcome, "SUCCEEDED"),
        )).limit(1);
        expect(accepted).toMatchObject({
          outcome: "SUCCEEDED",
          effectBundleId: completionParams.effectBundleId,
        });
        const [recoveredTransition] = await db.select({
          status: aiWorldTransitionsTable.status,
          effectBundleId: aiWorldTransitionsTable.effectBundleId,
        }).from(aiWorldTransitionsTable)
          .where(eq(aiWorldTransitionsTable.executionId, executionId));
        expect(recoveredTransition).toMatchObject({
          status: "materialized",
          effectBundleId: accepted?.effectBundleId,
        });
        const dispatches = await db.select({ id: eventsTable.id })
          .from(eventsTable).where(and(
            eq(eventsTable.projectId, projectId),
            eq(eventsTable.goalId, targetGoalId),
            eq(eventsTable.type, "AiGoalRecipeDispatchRequested"),
          ));
        expect(dispatches).toHaveLength(1);
        await assertCanonicalRecipeProof({ ...fixture.params, sourceRevision }, executionId);
        return;
      }

      const start = await runMissionGoal({
        goalId: sourceGoalId,
        userId,
        trigger: "wake",
      });
      expect(start).toMatchObject({ status: "scheduled", goalId: sourceGoalId });
      const sourceJob = queuedJobs.shift();
      if (!sourceJob) throw new Error("Mission runtime.start dispatch was not queued.");
      await sourceJob();
      if (!recipeResult || !executionId) {
        throw new Error("Mission recipe did not execute runtime.start.");
      }
      expect(recipeResult.status).toBe("completed");
      expect(runnerSpy).toHaveBeenCalledOnce();

      const [sourceGoal] = await db.select({
        status: aiGoalsTable.status,
      }).from(aiGoalsTable).where(eq(aiGoalsTable.id, sourceGoalId));
      expect(sourceGoal?.status).toBe("completed");
      const [acceptance] = await db.select({
        id: aiExecutionAcceptancesTable.id,
        attempt: aiExecutionAcceptancesTable.attempt,
        outcome: aiExecutionAcceptancesTable.outcome,
        effectBundleId: aiExecutionAcceptancesTable.effectBundleId,
        sourceRevision: aiExecutionAcceptancesTable.sourceRevision,
      }).from(aiExecutionAcceptancesTable).where(and(
        eq(aiExecutionAcceptancesTable.executionId, executionId),
        eq(aiExecutionAcceptancesTable.outcome, "SUCCEEDED"),
      )).limit(1);
      expect(acceptance).toMatchObject({
        attempt: 0,
        outcome: "SUCCEEDED",
        sourceRevision,
        effectBundleId: expect.any(String),
      });
      const [transition] = await db.select().from(aiWorldTransitionsTable)
        .where(eq(aiWorldTransitionsTable.executionId, executionId))
        .limit(1);
      expect(transition).toMatchObject({
        status: "materialized",
        freshness: "fresh",
        taskScope: expect.stringMatching(/^scope:[a-f0-9]{64}$/),
        attempt: acceptance?.attempt,
        episodeId: expect.any(String),
        effectBundleId: acceptance?.effectBundleId,
        parentWorldRevision: expect.stringMatching(/^[a-f0-9]{64}$/),
        resultingWorldRevision: expect.stringMatching(/^[a-f0-9]{64}$/),
        environmentRevision: expect.stringMatching(/^env-v1:/),
      });
      expect(transition?.resultingWorldRevision).not.toBe(transition?.parentWorldRevision);
      expect(queuedJobs).toHaveLength(0);

      const woken = await wakeRuntimeTransitionMissionGoals();
      const [targetAfterWake] = await db.select({
        status: aiGoalsTable.status,
        blockedReason: aiGoalsTable.blockedReason,
      }).from(aiGoalsTable).where(eq(aiGoalsTable.id, targetGoalId));
      const [missionAfterWake] = await db.select({
        status: aiMissionsTable.status,
      }).from(aiMissionsTable).where(eq(aiMissionsTable.id, missionId));
      const events = await db.select({
        type: eventsTable.type,
        goalId: eventsTable.goalId,
        payload: eventsTable.payload,
      }).from(eventsTable).where(eq(eventsTable.projectId, projectId));
      expect(woken, JSON.stringify({
        mission: missionAfterWake?.status,
        target: targetAfterWake,
        transitionEvents: events.filter((event) =>
          event.goalId === targetGoalId
          && (event.type.includes("Transition") || event.type === "AiGoalRecipeDispatchRequested"),
        ),
      })).toBe(1);
      expect(targetAfterWake).toEqual({ status: "running", blockedReason: null });
      const targetDispatches = events.filter((event) =>
        event.type === "AiGoalRecipeDispatchRequested"
        && event.goalId === targetGoalId,
      );
      expect(targetDispatches).toHaveLength(1);
      expect(targetDispatches[0]?.payload).toMatchObject({
        transitionProof: {
          transitionId: transition?.id,
          executionId,
          attempt: acceptance?.attempt,
          episodeId: transition?.episodeId,
          actionId: transition?.actionId,
          effectBundleId: acceptance?.effectBundleId,
          parentWorldRevision: transition?.parentWorldRevision,
          resultingWorldRevision: transition?.resultingWorldRevision,
          projectRevision: sourceRevision,
          environmentRevision: transition?.environmentRevision,
          beforeObservationIds: transition?.beforeObservationIds,
          afterObservationIds: transition?.afterObservationIds,
          sourceStepId: "runtime-start",
          targetStepId: "target-step",
          activePlanHash: planRevision,
        },
      });
      expect(queuedJobs).toHaveLength(1);
    } finally {
      completionSpy?.mockRestore();
      runnerSpy.mockRestore();
      queueSpy.mockRestore();
      await manager.shutdown();
      if (triggerInstalled) {
        await db.execute(sql.raw(`DROP TRIGGER IF EXISTS ${crashTriggerName} ON ai_execution_acceptances`));
        await db.execute(sql.raw(`DROP FUNCTION IF EXISTS ${crashFunctionName}()`));
      }
      await db.delete(eventsTable).where(eq(eventsTable.projectId, projectId));
      const executions = await db.select({ id: aiExecutionsTable.id })
        .from(aiExecutionsTable)
        .where(eq(aiExecutionsTable.projectId, projectId));
      for (const execution of executions) {
        await db.delete(aiExecutionAcceptancesTable)
          .where(eq(aiExecutionAcceptancesTable.executionId, execution.id));
        await db.delete(aiExecutionsTable).where(eq(aiExecutionsTable.id, execution.id));
      }
      await db.delete(aiGoalsTable).where(eq(aiGoalsTable.missionId, missionId));
      await db.delete(aiMissionsTable).where(eq(aiMissionsTable.id, missionId));
      await fixture.cleanup();
    }
  }, process.env.RUN_E2_RUNTIME_START_API_STARTUP_RECOVERY === "1"
    || process.env.RUN_E2_RUNTIME_START_GATE_C_CRASH === "1"
    ? 240_000
    : 20_000);

  it("rejects proof-required runtime recipes before execution", async () => {
    const fixture = await createGateCRecipeFixture("runtime.start");
    let runtimeCalled = false;
    try {
      await expect(runRecipeOperation({
        ...fixture.params,
        proofRequired: true,
        runtimeStartRunner: async () => {
          runtimeCalled = true;
          return { status: "passed" as const };
        },
      })).rejects.toThrow("uses its server-owned Gate C proof path");
      expect(runtimeCalled).toBe(false);
      const executions = await db.select({ id: aiExecutionsTable.id })
        .from(aiExecutionsTable)
        .where(eq(aiExecutionsTable.projectId, fixture.params.projectId));
      expect(executions).toHaveLength(0);
    } finally {
      await fixture.cleanup();
    }
  });

  it("keeps Mission plan admission locked through the recipe execution claim", async () => {
    const fixture = await createGateCRecipeFixture("runtime.start");
    const missionId = crypto.randomUUID();
    const goalId = crypto.randomUUID();
    const planRevision = "mission-recipe-claim-plan-v1";
    const now = new Date();
    let executionId: string | undefined;
    let authorizationTransaction:
      | Parameters<Parameters<typeof db.transaction>[0]>[0]
      | undefined;
    let claimTransaction:
      | Parameters<Parameters<typeof db.transaction>[0]>[0]
      | undefined;
    let planRevisionAtClaim: string | undefined;
    let planChangeCommittedAtClaim: boolean | undefined;
    let planChangeCommitted = false;
    let planChange: Promise<unknown> | undefined;
    const actualClaimAiExecution = aiExecutionState.claimAiExecution;
    const claimSpy = vi.spyOn(aiExecutionState, "claimAiExecution")
      .mockImplementation(async (params) => {
        claimTransaction = params.transaction;
        const [mission] = await db
          .select({ autonomyPolicy: aiMissionsTable.autonomyPolicy })
          .from(aiMissionsTable)
          .where(eq(aiMissionsTable.id, missionId))
          .limit(1);
        planRevisionAtClaim = typeof mission?.autonomyPolicy.activePlanRevision === "string"
          ? mission.autonomyPolicy.activePlanRevision
          : undefined;
        planChangeCommittedAtClaim = planChangeCommitted;
        await actualClaimAiExecution(params);
        return undefined;
      });

    try {
      await db.insert(aiMissionsTable).values({
        id: missionId,
        projectId: fixture.params.projectId,
        userId: fixture.params.userId,
        title: "Recipe claim plan gate",
        intent: "Keep Mission approval current through the claim boundary",
        status: "active",
        scope: { kind: "project", projectId: fixture.params.projectId },
        autonomyPolicy: { activePlanRevision: planRevision },
        createdAt: now,
        updatedAt: now,
      });
      await db.insert(aiGoalsTable).values({
        id: goalId,
        missionId,
        projectId: fixture.params.projectId,
        title: "Runtime recipe",
        status: "running",
        outcomeContract: {
          deliveryRequired: false,
          planRevision: { hash: planRevision },
        },
        nextAction: {
          kind: "recipe",
          recipeId: "runtime.start",
          recipeVersion: 1,
          approvedPaths: [],
          candidateIdentity: null,
        },
        createdAt: now,
        updatedAt: now,
      });

      await expect(runRecipeOperation({
        ...fixture.params,
        missionId,
        goalId,
        runtimeStartRunner: createRuntimeStartRunner(),
        beforeClaim: async (_claim, transaction) => {
          executionId = _claim.executionId;
          authorizationTransaction = transaction;
          const checkMission = async (
            tx: Parameters<Parameters<typeof db.transaction>[0]>[0],
          ) => {
            const [mission] = await tx
              .select({ autonomyPolicy: aiMissionsTable.autonomyPolicy })
              .from(aiMissionsTable)
              .where(eq(aiMissionsTable.id, missionId))
              .for("update");
            const [goal] = await tx
              .select({ outcomeContract: aiGoalsTable.outcomeContract })
              .from(aiGoalsTable)
              .where(and(
                eq(aiGoalsTable.id, goalId),
                eq(aiGoalsTable.missionId, missionId),
              ))
              .for("update");
            const currentPlanRevision = typeof mission?.autonomyPolicy.activePlanRevision === "string"
              ? mission.autonomyPolicy.activePlanRevision
              : undefined;
            const contract = goal?.outcomeContract as {
              planRevision?: { hash?: unknown };
            } | undefined;
            return currentPlanRevision === planRevision
              && contract?.planRevision?.hash === planRevision;
          };
          const allowed = transaction
            ? await checkMission(transaction)
            : await db.transaction(checkMission);
          if (!allowed) return false;

          const updatePlan = () => db.update(aiMissionsTable)
            .set({ autonomyPolicy: { activePlanRevision: "mission-recipe-claim-plan-v2" } })
            .where(eq(aiMissionsTable.id, missionId))
            .then(() => {
              planChangeCommitted = true;
            });
          if (transaction) {
            planChange = updatePlan();
            await new Promise((resolve) => setTimeout(resolve, 25));
          } else {
            await updatePlan();
          }
          return true;
        },
      })).rejects.toThrow("Recipe operation could not acquire its durable lease.");

      await planChange;
      expect.soft(authorizationTransaction).toBeDefined();
      expect.soft(claimTransaction).toBe(authorizationTransaction);
      expect.soft(planRevisionAtClaim).toBe(planRevision);
      expect.soft(planChangeCommittedAtClaim).toBe(false);
      expect.soft(planChangeCommitted).toBe(true);
    } finally {
      claimSpy.mockRestore();
      if (executionId) {
        await db.delete(aiExecutionAcceptancesTable)
          .where(eq(aiExecutionAcceptancesTable.executionId, executionId));
        await db.delete(aiExecutionsTable)
          .where(eq(aiExecutionsTable.id, executionId));
      }
      await db.delete(aiGoalsTable).where(eq(aiGoalsTable.id, goalId));
      await db.delete(aiMissionsTable).where(eq(aiMissionsTable.id, missionId));
      await fixture.cleanup();
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
      proofRequired: true,
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
      await assertCanonicalRecipeProof(fixture.params, executionId);
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
    const fixture = await createGateCRecipeFixture("delivery.push.github", ["README.md"]);
    let executionId: string | undefined;
    const deliveryCalls: string[] = [];
    const params = {
      ...fixture.params,
      proofRequired: true,
      githubDeliveryRunner: async ({
        projectId,
        operationId,
        executionId,
        executionAttempt,
        sourceRevision,
        message,
        beforeStateObserver,
      }: {
        projectId: string;
        operationId: string;
        executionId?: string;
        executionAttempt?: number;
        sourceRevision?: string;
        message: string;
        beforeStateObserver?: (state: {
          status: "observed";
          projectId: string;
          operationId: string;
          executionId: string;
          executionAttempt: number;
          sourceRevision: string;
          proposalId: string;
          remoteUrl: string;
          branch: string;
          expectedCommitHash: string;
          expectedParentHash: string;
          expectedParentTreeHash: string;
          expectedTreeHash: string;
          remoteCommitHash: string;
          remoteTreeHash: string;
          remoteParentCount: number;
          observedAt: string;
        }) => Promise<void>;
      }) => {
        deliveryCalls.push(`${projectId}:${operationId}:${message}`);
        const marker = `EngineeringOS-Operation: ${operationId}`;
        const observedAt = new Date().toISOString();
        if (beforeStateObserver && executionId && Number.isInteger(executionAttempt) && sourceRevision) {
          await beforeStateObserver({
            status: "observed",
            projectId,
            operationId,
            executionId,
            executionAttempt: executionAttempt!,
            sourceRevision,
            proposalId: "proposal-delivery",
            remoteUrl: "https://github.com/example/project.git",
            branch: "main",
            expectedCommitHash: "remote-commit",
            expectedParentHash: "parent-commit",
            expectedParentTreeHash: "parent-tree",
            expectedTreeHash: "remote-tree",
            remoteCommitHash: "parent-commit",
            remoteTreeHash: "parent-tree",
            remoteParentCount: 1,
            observedAt,
          });
        }
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
            observedAt,
          },
        };
      },
    };
    try {
      const completed = await runRecipeOperation(params);
      executionId = completed.executionId;
      expect(completed.status).toBe("completed");
      await assertCanonicalRecipeProof(fixture.params, executionId);
      const bundleId = await assertSuccessfulGateCEffect(executionId, "github.push_verified_commit", 5);
      const [deliveryTransition] = await db.select().from(aiWorldTransitionsTable).where(and(
        eq(aiWorldTransitionsTable.projectId, fixture.params.projectId),
        eq(aiWorldTransitionsTable.idempotencyKey, `github.delivery:${executionId}:${fixture.params.operationId}`),
      )).limit(1);
      expect(deliveryTransition).toMatchObject({
        status: "materialized",
        effectBundleId: bundleId,
      });
      expect(deliveryTransition?.attempt).toBe(0);
      const transitionObservationIds = [
        ...(deliveryTransition?.beforeObservationIds as string[] ?? []),
        ...(deliveryTransition?.afterObservationIds as string[] ?? []),
      ];
      const transitionObservations = await db.select().from(aiAgentObservationsTable)
        .where(inArray(aiAgentObservationsTable.id, transitionObservationIds));
      expect(transitionObservations).toHaveLength(2);
      expect(transitionObservations.map((observation) => observation.predicate).sort())
        .toEqual(["delivery.remote_branch_state", "delivery.remote_branch_state"]);
      const changedFacts = await db.select().from(aiWorldFactsTable).where(inArray(
        aiWorldFactsTable.id,
        deliveryTransition?.changedFactRefs as string[],
      ));
      expect(changedFacts.some((fact) => (
        fact.predicate === "delivery.remote_branch_state"
        && fact.status === "believed"
        && fact.projectRevision === "remote-commit"
        && typeof fact.value === "object"
        && fact.value !== null
        && !Array.isArray(fact.value)
        && (fact.value as Record<string, unknown>).remoteCommitHash === "remote-commit"
      ))).toBe(true);
      expect(deliveryCalls).toEqual([
        `${fixture.params.projectId}:${fixture.params.operationId}:Deliver the verified proposal`,
      ]);

      const replay = await runRecipeOperation(params);
      expect(replay).toMatchObject({
        executionId,
        status: "completed",
        receipt: { status: "completed" },
      });
      expect(await assertSuccessfulGateCEffect(executionId, "github.push_verified_commit", 5)).toBe(bundleId);
      expect(deliveryCalls).toHaveLength(1);
    } finally {
      await fixture.cleanup(executionId);
    }
  });

  it("binds runtime-start World State to a real GitHub receipt and observed delivery effect", async () => {
    const fixture = await createGateCRecipeFixture("delivery.push.github");
    const { projectId, rootPath, sessionId } = fixture.params;
    const remoteUrl = "https://github.com/example/project.git";
    const branchName = "main";
    const proposalId = crypto.randomUUID();
    const deliveryOperationId = crypto.randomUUID();
    const apiProblems: string[] = [];
    const remoteWrites = { blobs: 0, trees: 0, commits: 0, refUpdates: 0 };
    let fakeGithub: ReturnType<typeof createHttpServer> | undefined;
    let manager: WorkspaceRuntimeManager | undefined;
    let deliveryRunnerCalls = 0;
    let pendingMessage = "";
    let branch = {
      commitHash: "",
      treeHash: "",
      message: "initial",
      parents: [] as string[],
    };

    try {
      await writeFile(
        path.join(rootPath, "package.json"),
        JSON.stringify({ scripts: { dev: "node server.mjs" } }),
        "utf8",
      );
      await writeFile(
        path.join(rootPath, "server.mjs"),
        [
          "import http from 'node:http';",
          "import { readFileSync } from 'node:fs';",
          "const revision = readFileSync('node_modules/.cache/revision.txt', 'utf8').trim();",
          "const server = http.createServer((_req, res) => { res.setHeader('x-engineeringos-revision', revision); res.end('runtime-ready'); });",
          "server.listen(Number(process.env.PORT), '127.0.0.1');",
          "process.once('SIGTERM', () => server.close(() => process.exit(0)));",
        ].join("\n"),
        "utf8",
      );
      await writeFile(path.join(rootPath, ".gitignore"), "node_modules/\n", "utf8");
      await writeFile(path.join(rootPath, "README.md"), "before\n", "utf8");
      await execFileAsync("git", ["-C", rootPath, "init", "-q"]);
      await execFileAsync("git", ["-C", rootPath, "config", "user.name", "EngineeringOS Fixture"]);
      await execFileAsync("git", ["-C", rootPath, "config", "user.email", "fixture@example.com"]);
      await execFileAsync("git", ["-C", rootPath, "add", ".gitignore", "README.md", "package.json", "server.mjs"]);
      await execFileAsync("git", ["-C", rootPath, "commit", "-qm", "initial"]);
      const parentHash = (await execFileAsync("git", ["-C", rootPath, "rev-parse", "HEAD"])).stdout.trim();
      const parentTreeHash = (await execFileAsync(
        "git",
        ["-C", rootPath, "rev-parse", `${parentHash}^{tree}`],
      )).stdout.trim();
      const baseTreeHash = await hashDeliveryTree(rootPath);

      await writeFile(path.join(rootPath, "README.md"), "after\n", "utf8");
      await execFileAsync("git", ["-C", rootPath, "add", "README.md"]);
      await execFileAsync("git", [
        "-C",
        rootPath,
        "commit",
        "-m",
        "verified local delivery",
        "-m",
        `EngineeringOS-Operation: ${deliveryOperationId}`,
      ]);
      const commitHash = (await execFileAsync("git", ["-C", rootPath, "rev-parse", "HEAD"])).stdout.trim();
      const gitTreeHash = (await execFileAsync(
        "git",
        ["-C", rootPath, "rev-parse", `${commitHash}^{tree}`],
      )).stdout.trim();
      const blobHash = (await execFileAsync(
        "git",
        ["-C", rootPath, "rev-parse", `${commitHash}:README.md`],
      )).stdout.trim();
      const committedTreeHash = await hashDeliveryTree(rootPath);
      const sourceRevision = commitHash;
      await mkdir(path.join(rootPath, "node_modules/.cache"), { recursive: true });
      await writeFile(
        path.join(rootPath, "node_modules/.cache/revision.txt"),
        `${sourceRevision}\n`,
        "utf8",
      );

      branch = {
        commitHash: parentHash,
        treeHash: parentTreeHash,
        message: "initial",
        parents: [],
      };
      await db.update(projectsTable).set({
        gitRemoteUrl: remoteUrl,
        gitDefaultBranch: branchName,
      }).where(eq(projectsTable.id, projectId));
      const registerCommittedProposal = async (operationId: string, id: string) => {
        const messageId = crypto.randomUUID();
        const createdAt = new Date();
        await db.insert(aiChatMessagesTable).values({
          id: messageId,
          sessionId,
          role: "assistant",
          content: "Verified delivery candidate",
          createdAt,
        });
        await db.insert(aiChangeProposalsTable).values({
          id,
          projectId,
          sessionId,
          messageId,
          changes: JSON.stringify([{ path: "README.md", newContent: "after\n" }]),
          appliedChanges: JSON.stringify([{ path: "README.md", newContent: "after\n" }]),
          status: "applied",
          lifecycle: "committed",
          operationId,
          baseRevision: parentHash,
          changeSetHash: `integrated-delivery:${operationId}`,
          baseTreeHash,
          candidateTreeHash: committedTreeHash,
          promotedTreeHash: committedTreeHash,
          treeDigestVersion: DELIVERY_TREE_DIGEST_VERSION,
          commitHash,
          committedTreeHash,
          createdAt,
          consumedAt: createdAt,
        });
        await db.insert(eventsTable).values({
          id: crypto.randomUUID(),
          type: "GitCommitCreated",
          projectId,
          severity: "info",
          message: "Verified local commit created for integrated delivery test",
          correlationId: operationId,
          payload: {
            proposalId: id,
            operationId,
            commitHash,
            committedTreeHash,
            committedPaths: ["README.md"],
          },
        });
      };
      await registerCommittedProposal(deliveryOperationId, proposalId);

      fakeGithub = createHttpServer(async (req, res) => {
        const respond = (status: number, payload: Record<string, unknown>) => {
          res.writeHead(status, { "content-type": "application/json" });
          res.end(JSON.stringify(payload));
        };
        try {
          const chunks: Buffer[] = [];
          for await (const chunk of req) chunks.push(Buffer.from(chunk));
          const rawBody = Buffer.concat(chunks).toString("utf8");
          const body = rawBody ? JSON.parse(rawBody) as Record<string, unknown> : {};
          const requestPath = new URL(req.url ?? "/", "http://127.0.0.1").pathname;

          if (req.method === "GET" && requestPath.endsWith("/git/ref/heads/main")) {
            respond(200, { ref: "refs/heads/main", object: { sha: branch.commitHash } });
            return;
          }
          const commitMatch = requestPath.match(/\/git\/commits\/([^/]+)$/);
          if (req.method === "GET" && commitMatch) {
            const requestedHash = decodeURIComponent(commitMatch[1]!);
            if (requestedHash === parentHash) {
              respond(200, {
                sha: parentHash,
                tree: { sha: parentTreeHash },
                message: "initial",
                parents: [],
              });
              return;
            }
            if (requestedHash === commitHash && branch.commitHash === commitHash) {
              respond(200, {
                sha: commitHash,
                tree: { sha: branch.treeHash },
                message: branch.message,
                parents: branch.parents.map((sha) => ({ sha })),
              });
              return;
            }
            respond(404, { message: "Unknown fixture commit" });
            return;
          }
          if (req.method === "POST" && requestPath.endsWith("/git/blobs")) {
            remoteWrites.blobs += 1;
            if (
              body.encoding !== "base64"
              || Buffer.from(String(body.content ?? ""), "base64").toString("utf8") !== "after\n"
            ) {
              apiProblems.push("Blob request did not contain the committed README bytes.");
              respond(422, { message: "Unexpected blob request" });
              return;
            }
            respond(201, { sha: blobHash });
            return;
          }
          if (req.method === "POST" && requestPath.endsWith("/git/trees")) {
            remoteWrites.trees += 1;
            if (
              body.base_tree !== parentTreeHash
              || !Array.isArray(body.tree)
              || !body.tree.some((entry) =>
                entry
                && typeof entry === "object"
                && (entry as Record<string, unknown>).path === "README.md"
                && (entry as Record<string, unknown>).sha === blobHash)
            ) {
              apiProblems.push("Tree request did not use the verified parent and README blob.");
              respond(422, { message: "Unexpected tree request" });
              return;
            }
            respond(201, { sha: gitTreeHash });
            return;
          }
          if (req.method === "POST" && requestPath.endsWith("/git/commits")) {
            remoteWrites.commits += 1;
            const parents = Array.isArray(body.parents) ? body.parents : [];
            if (body.tree !== gitTreeHash || parents.length !== 1 || parents[0] !== parentHash) {
              apiProblems.push("Commit request did not match the verified tree and parent.");
              respond(422, { message: "Unexpected commit request" });
              return;
            }
            pendingMessage = String(body.message ?? "");
            respond(201, { sha: commitHash });
            return;
          }
          if (req.method === "PATCH" && requestPath.endsWith("/git/refs/heads/main")) {
            if (
              branch.commitHash !== parentHash
              || body.sha !== commitHash
              || body.force !== false
              || !pendingMessage.includes(`EngineeringOS-Operation: ${deliveryOperationId}`)
            ) {
              apiProblems.push("Ref update did not match the verified delivery commit.");
              respond(409, { message: "Unexpected ref update" });
              return;
            }
            branch = {
              commitHash,
              treeHash: gitTreeHash,
              message: pendingMessage,
              parents: [parentHash],
            };
            remoteWrites.refUpdates += 1;
            respond(200, { ref: "refs/heads/main", object: { sha: commitHash } });
            return;
          }
          apiProblems.push(`Unexpected fixture GitHub request: ${req.method} ${requestPath}`);
          respond(404, { message: "Unexpected fixture GitHub request" });
        } catch (error) {
          apiProblems.push(error instanceof Error ? error.message : String(error));
          respond(500, { message: "Fixture GitHub API failed" });
        }
      });
      await new Promise<void>((resolve, reject) => {
        fakeGithub!.once("error", reject);
        fakeGithub!.listen(0, "127.0.0.1", resolve);
      });
      const fixtureAddress = fakeGithub.address();
      if (!fixtureAddress || typeof fixtureAddress === "string") {
        throw new Error("Fixture GitHub API did not receive a TCP address.");
      }
      const fixtureUrl = `http://127.0.0.1:${fixtureAddress.port}`;
      const request = async (
        apiPath: string,
        init: { method?: string; headers?: Record<string, string>; body?: string } = {},
      ): Promise<Record<string, unknown>> => {
        const response = await fetch(`${fixtureUrl}${apiPath}`, {
          method: init.method ?? "GET",
          headers: init.headers,
          body: init.body,
        });
        const payload = await response.json() as Record<string, unknown>;
        if (!response.ok) throw new Error(JSON.stringify(payload));
        return payload;
      };

      manager = new WorkspaceRuntimeManager({
        store: createInMemoryWorkspaceRuntimeStore(),
        workerId: `runtime-github-integration:${projectId}`,
        startPreStateObserver: async ({
          projectId: observedProjectId,
          revision,
        }: {
          projectId: string;
          revision: string;
        }) => ({
          status: "observed" as const,
          runtimeStatus: "stopped" as const,
          projectId: observedProjectId,
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
          detail: "The isolated test observer confirms the runtime is stopped.",
        }),
      });
      const runtimeResult = await runRecipeOperation({
        ...fixture.params,
        recipeId: "runtime.start",
        sourceRevision,
        runtimeStartRunner: createRuntimeStartRunner(manager),
      });
      expect(runtimeResult.status).toBe("completed");
      const [runtimeAcceptance] = await db.select({
        attempt: aiExecutionAcceptancesTable.attempt,
        outcome: aiExecutionAcceptancesTable.outcome,
        effectBundleId: aiExecutionAcceptancesTable.effectBundleId,
      }).from(aiExecutionAcceptancesTable).where(and(
        eq(aiExecutionAcceptancesTable.executionId, runtimeResult.executionId),
        eq(aiExecutionAcceptancesTable.outcome, "SUCCEEDED"),
      )).limit(1);
      const [runtimeTransition] = await db.select().from(aiWorldTransitionsTable)
        .where(eq(aiWorldTransitionsTable.executionId, runtimeResult.executionId))
        .limit(1);
      expect(runtimeAcceptance).toMatchObject({
        attempt: 0,
        outcome: "SUCCEEDED",
        effectBundleId: expect.any(String),
      });
      expect(runtimeTransition).toMatchObject({
        status: "materialized",
        attempt: runtimeAcceptance?.attempt,
        effectBundleId: runtimeAcceptance?.effectBundleId,
        resultingWorldRevision: expect.stringMatching(/^[a-f0-9]{64}$/),
      });
      const runtimeWorld = await worldState.getProjectWorldState(projectId);
      const runtimeStatusFact = runtimeWorld.currentFacts.find((fact) =>
        fact.predicate === "runtime.status" && fact.value === "running",
      );
      expect(runtimeStatusFact).toBeDefined();
      await assertCanonicalRecipeProof({ ...fixture.params, sourceRevision }, runtimeResult.executionId);

      const makeDeliveryRunner = (
        boundProposalId: string,
        mismatchBeforeAttempt = false,
      ) => async (input: Parameters<
        NonNullable<Parameters<typeof runRecipeOperation>[0]["githubDeliveryRunner"]>
      >[0]) => {
          deliveryRunnerCalls += 1;
          if (
            !input.executionId
            || typeof input.executionAttempt !== "number"
            || !input.sourceRevision
            || !input.beforeStateObserver
          ) {
            throw new Error("GitHub recipe did not provide its attempt-bound delivery observer.");
          }
          return executeVerifiedGitHubDelivery({
            projectId: input.projectId,
            proposalId: boundProposalId,
            operationId: input.operationId,
            executionId: input.executionId,
            executionAttempt: input.executionAttempt,
            sourceRevision: input.sourceRevision,
            rootPath,
            remoteUrl,
            branch: branchName,
            message: input.message,
            signal: input.signal,
            beforeStateObserver: mismatchBeforeAttempt
              ? async (state) => input.beforeStateObserver!({
                  ...state,
                  executionAttempt: state.executionAttempt + 1,
                })
              : input.beforeStateObserver,
            request,
          });
      };
      const unboundProposalId = crypto.randomUUID();
      const unboundOperationId = crypto.randomUUID();
      await registerCommittedProposal(unboundOperationId, unboundProposalId);
      const unboundResult = await runRecipeOperation({
        ...fixture.params,
        operationId: unboundOperationId,
        idempotencyKey: `${unboundOperationId}:unbound-real-delivery`,
        sourceRevision,
        proofRequired: true,
        githubDeliveryRunner: makeDeliveryRunner(unboundProposalId, true),
      });
      expect(unboundResult.status).not.toBe("completed");
      const unboundSuccesses = await db.select({ id: aiExecutionAcceptancesTable.id })
        .from(aiExecutionAcceptancesTable).where(and(
          eq(aiExecutionAcceptancesTable.executionId, unboundResult.executionId),
          eq(aiExecutionAcceptancesTable.outcome, "SUCCEEDED"),
        ));
      const unboundEffects = await db.select({ id: aiAgentEffectsTable.id })
        .from(aiAgentEffectsTable)
        .where(eq(aiAgentEffectsTable.executionId, unboundResult.executionId));
      const unboundTransitions = await db.select({ id: aiWorldTransitionsTable.id })
        .from(aiWorldTransitionsTable)
        .where(eq(aiWorldTransitionsTable.executionId, unboundResult.executionId));
      expect(unboundSuccesses).toEqual([]);
      expect(unboundEffects).toEqual([]);
      expect(unboundTransitions).toEqual([]);
      expect(remoteWrites).toEqual({ blobs: 0, trees: 0, commits: 0, refUpdates: 0 });
      const worldAfterUnboundAttempt = await worldState.getProjectWorldState(projectId);
      // Revision includes eligible observation progress, so this rejection advances the evidence revision.
      // It records Gate C pending evidence without changing materialized World State facts.
      expect(worldAfterUnboundAttempt.worldRevision).not.toBe(runtimeWorld.worldRevision);
      expect(worldAfterUnboundAttempt.facts).toEqual(runtimeWorld.facts);

      const deliveryParams = {
        ...fixture.params,
        operationId: deliveryOperationId,
        deliveryProposalId: proposalId,
        idempotencyKey: `${deliveryOperationId}:integrated-real-delivery`,
        sourceRevision,
        proofRequired: true,
        githubDeliveryRunner: makeDeliveryRunner(proposalId),
      };
      const deliveryResult = await runRecipeOperation(deliveryParams);
      expect(deliveryResult.status).toBe("completed");
      const [persistedDeliveryExecution] = await db.select({
        proposalId: aiExecutionsTable.proposalId,
        recipeReceipt: aiExecutionsTable.recipeReceipt,
      }).from(aiExecutionsTable)
        .where(eq(aiExecutionsTable.id, deliveryResult.executionId))
        .limit(1);
      expect(persistedDeliveryExecution?.proposalId).toBeNull();
      expect(persistedDeliveryExecution?.recipeReceipt).toMatchObject({
        executionId: deliveryResult.executionId,
        operationId: deliveryOperationId,
        candidateTreeHash: committedTreeHash,
        treeHash: expect.any(String),
      });
      expect(deliveryRunnerCalls).toBe(2);
      expect(remoteWrites).toEqual({ blobs: 1, trees: 1, commits: 1, refUpdates: 1 });
      expect(apiProblems).toEqual([]);
      await assertCanonicalRecipeProof({
        ...fixture.params,
        operationId: deliveryOperationId,
        sourceRevision,
      }, deliveryResult.executionId);
      const deliveryBundleId = await assertSuccessfulGateCEffect(
        deliveryResult.executionId,
        "github.push_verified_commit",
        5,
      );
      const [deliveryAcceptance] = await db.select({
        attempt: aiExecutionAcceptancesTable.attempt,
        outcome: aiExecutionAcceptancesTable.outcome,
        effectBundleId: aiExecutionAcceptancesTable.effectBundleId,
      }).from(aiExecutionAcceptancesTable).where(and(
        eq(aiExecutionAcceptancesTable.executionId, deliveryResult.executionId),
        eq(aiExecutionAcceptancesTable.outcome, "SUCCEEDED"),
      )).limit(1);
      const [deliveryTransition] = await db.select().from(aiWorldTransitionsTable).where(and(
        eq(aiWorldTransitionsTable.projectId, projectId),
        eq(aiWorldTransitionsTable.idempotencyKey, `github.delivery:${deliveryResult.executionId}:${deliveryOperationId}`),
      )).limit(1);
      expect(deliveryAcceptance).toMatchObject({
        attempt: 0,
        outcome: "SUCCEEDED",
        effectBundleId: deliveryBundleId,
      });
      expect(deliveryTransition).toMatchObject({
        status: "materialized",
        attempt: deliveryAcceptance?.attempt,
        episodeId: expect.any(String),
        actionId: expect.any(String),
        effectBundleId: deliveryBundleId,
        parentWorldRevision: worldAfterUnboundAttempt.worldRevision,
        resultingWorldRevision: expect.stringMatching(/^[a-f0-9]{64}$/),
      });
      expect(deliveryTransition?.resultingWorldRevision)
        .not.toBe(deliveryTransition?.parentWorldRevision);
      expect(deliveryTransition?.parentFactRefs).toContain(runtimeStatusFact?.id);
      const [deliveryEpisode] = await db.select({
        executionId: aiAgentEpisodesTable.executionId,
        attempt: aiAgentEpisodesTable.attempt,
      }).from(aiAgentEpisodesTable).where(and(
        eq(aiAgentEpisodesTable.id, deliveryTransition!.episodeId),
        eq(aiAgentEpisodesTable.projectId, projectId),
      )).limit(1);
      expect(deliveryEpisode).toEqual({
        executionId: deliveryResult.executionId,
        attempt: deliveryAcceptance?.attempt,
      });

      const transitionObservationIds = [
        ...(deliveryTransition?.beforeObservationIds as string[] ?? []),
        ...(deliveryTransition?.afterObservationIds as string[] ?? []),
      ];
      const transitionObservations = await db.select().from(aiAgentObservationsTable)
        .where(inArray(aiAgentObservationsTable.id, transitionObservationIds));
      expect(transitionObservations).toHaveLength(2);
      expect(transitionObservations.every((observation) => (
        observation.projectId === projectId
        && observation.executionId === deliveryResult.executionId
        && observation.episodeId === deliveryTransition?.episodeId
        && observation.provenance === "DIRECT_OBSERVATION"
        && observation.completeness === "complete"
        && observation.freshness === "fresh"
      ))).toBe(true);
      const beforeObservation = transitionObservations.find((observation) =>
        (deliveryTransition?.beforeObservationIds as string[]).includes(observation.id),
      );
      const afterObservation = transitionObservations.find((observation) =>
        (deliveryTransition?.afterObservationIds as string[]).includes(observation.id),
      );
      expect(beforeObservation?.value).toMatchObject({
        status: "observed",
        projectId,
        operationId: deliveryOperationId,
        executionId: deliveryResult.executionId,
        executionAttempt: deliveryAcceptance?.attempt,
        proposalId,
        remoteUrl,
        branch: branchName,
        expectedCommitHash: commitHash,
        expectedParentHash: parentHash,
        remoteCommitHash: parentHash,
      });
      expect(afterObservation?.value).toMatchObject({
        status: "passed",
        projectId,
        operationId: deliveryOperationId,
        executionId: deliveryResult.executionId,
        executionAttempt: deliveryAcceptance?.attempt,
        proposalId,
        remoteUrl,
        branch: branchName,
        expectedCommitHash: commitHash,
        expectedParentHash: parentHash,
        remoteCommitHash: commitHash,
        remoteParentHash: parentHash,
        remoteTreeHash: gitTreeHash,
        markerMatched: true,
      });

      const deliveryEffects = await db.select().from(aiAgentEffectsTable)
        .where(eq(aiAgentEffectsTable.executionId, deliveryResult.executionId));
      expect(deliveryEffects).toHaveLength(1);
      expect(deliveryEffects[0]).toMatchObject({
        attempt: deliveryAcceptance?.attempt,
        episodeId: deliveryTransition?.episodeId,
        actionId: deliveryTransition?.actionId,
        capabilityId: "github.push_verified_commit",
        status: "observed",
      });
      const receiptEvents = await db.select({
        payload: eventsTable.payload,
      }).from(eventsTable).where(and(
        eq(eventsTable.projectId, projectId),
        eq(eventsTable.type, "GitPushed"),
        eq(eventsTable.correlationId, deliveryOperationId),
      ));
      expect(receiptEvents).toHaveLength(1);
      expect(receiptEvents[0]?.payload).toMatchObject({
        proposalId,
        operationId: deliveryOperationId,
        commitHash,
        remoteCommitHash: commitHash,
        remoteTreeHash: gitTreeHash,
      });

      const changedFacts = await db.select().from(aiWorldFactsTable).where(inArray(
        aiWorldFactsTable.id,
        deliveryTransition?.changedFactRefs as string[],
      ));
      expect(changedFacts.some((fact) => (
        fact.predicate === "delivery.remote_branch_state"
        && fact.projectRevision === commitHash
        && typeof fact.value === "object"
        && fact.value !== null
        && !Array.isArray(fact.value)
        && (fact.value as Record<string, unknown>).remoteCommitHash === commitHash
      ))).toBe(true);
      const finalWorld = await worldState.getProjectWorldState(projectId);
      expect(finalWorld.currentFacts).toEqual(expect.arrayContaining([
        expect.objectContaining({
          predicate: "runtime.status",
          value: "running",
        }),
        expect.objectContaining({
          predicate: "delivery.remote_branch_state",
          projectRevision: commitHash,
        }),
      ]));

      const replay = await runRecipeOperation(deliveryParams);
      expect(replay).toMatchObject({
        executionId: deliveryResult.executionId,
        status: "completed",
        receipt: { status: "completed" },
      });
      expect(deliveryRunnerCalls).toBe(2);
      expect(remoteWrites).toEqual({ blobs: 1, trees: 1, commits: 1, refUpdates: 1 });
    } finally {
      await manager?.shutdown();
      if (fakeGithub?.listening) {
        await new Promise<void>((resolve) => fakeGithub!.close(() => resolve()));
      }
      const projectExecutions = await db.select({ id: aiExecutionsTable.id })
        .from(aiExecutionsTable)
        .where(eq(aiExecutionsTable.projectId, projectId));
      for (const execution of projectExecutions) {
        await db.delete(aiExecutionAcceptancesTable)
          .where(eq(aiExecutionAcceptancesTable.executionId, execution.id));
        await db.delete(aiExecutionsTable).where(eq(aiExecutionsTable.id, execution.id));
      }
      await db.delete(eventsTable).where(eq(eventsTable.projectId, projectId));
      await db.delete(aiChangeProposalsTable)
        .where(eq(aiChangeProposalsTable.projectId, projectId));
      await db.delete(aiChatMessagesTable).where(eq(aiChatMessagesTable.sessionId, sessionId));
      await fixture.cleanup();
    }
  }, 90_000);

  it("fails closed after a recipe worker dies between GitHub ref update and receipt persistence", async () => {
    const fixture = await createGateCRecipeFixture("delivery.push.github");
    const { projectId, rootPath, sessionId } = fixture.params;
    const operationId = fixture.params.operationId;
    const proposalId = crypto.randomUUID();
    const remoteUrl = "https://github.com/example/project.git";
    const branchName = "main";
    const remoteWrites = { blobs: 0, trees: 0, commits: 0, refUpdates: 0 };
    const apiProblems: string[] = [];
    let fakeGithub: ReturnType<typeof createHttpServer> | undefined;
    let child: ReturnType<typeof spawn> | undefined;
    let childExit: Promise<{ code: number | null; signal: NodeJS.Signals | null }> | undefined;
    let postPushCommitReadHeld = false;
    let branch = {
      commitHash: "",
      treeHash: "",
      message: "initial",
      parents: [] as string[],
    };
    let pendingMessage = "";

    try {
      await writeFile(path.join(rootPath, ".gitignore"), "node_modules/\n", "utf8");
      await writeFile(path.join(rootPath, "README.md"), "before\n", "utf8");
      await execFileAsync("git", ["-C", rootPath, "init", "-q"]);
      await execFileAsync("git", ["-C", rootPath, "config", "user.name", "EngineeringOS Fixture"]);
      await execFileAsync("git", ["-C", rootPath, "config", "user.email", "fixture@example.com"]);
      await execFileAsync("git", ["-C", rootPath, "add", ".gitignore", "README.md", "package.json"]);
      await execFileAsync("git", ["-C", rootPath, "commit", "-qm", "initial"]);
      const parentHash = (await execFileAsync("git", ["-C", rootPath, "rev-parse", "HEAD"])).stdout.trim();
      const parentTreeHash = (await execFileAsync(
        "git",
        ["-C", rootPath, "rev-parse", `${parentHash}^{tree}`],
      )).stdout.trim();
      const baseTreeHash = await hashDeliveryTree(rootPath);

      await writeFile(path.join(rootPath, "README.md"), "after\n", "utf8");
      await execFileAsync("git", ["-C", rootPath, "add", "README.md"]);
      await execFileAsync("git", [
        "-C",
        rootPath,
        "commit",
        "-m",
        "verified local delivery",
        "-m",
        `EngineeringOS-Operation: ${operationId}`,
      ]);
      const commitHash = (await execFileAsync("git", ["-C", rootPath, "rev-parse", "HEAD"])).stdout.trim();
      const gitTreeHash = (await execFileAsync(
        "git",
        ["-C", rootPath, "rev-parse", `${commitHash}^{tree}`],
      )).stdout.trim();
      const blobHash = (await execFileAsync(
        "git",
        ["-C", rootPath, "rev-parse", `${commitHash}:README.md`],
      )).stdout.trim();
      const committedTreeHash = await hashDeliveryTree(rootPath);
      branch = {
        commitHash: parentHash,
        treeHash: parentTreeHash,
        message: "initial",
        parents: [],
      };

      await db.update(projectsTable).set({
        gitRemoteUrl: remoteUrl,
        gitDefaultBranch: branchName,
      }).where(eq(projectsTable.id, projectId));
      const now = new Date();
      await db.insert(aiChatMessagesTable).values({
        id: crypto.randomUUID(),
        sessionId,
        role: "assistant",
        content: "Verified delivery candidate",
        createdAt: now,
      });
      const messageId = (await db.select({ id: aiChatMessagesTable.id })
        .from(aiChatMessagesTable)
        .where(eq(aiChatMessagesTable.sessionId, sessionId))
        .limit(1))[0]!.id;
      await db.insert(aiChangeProposalsTable).values({
        id: proposalId,
        projectId,
        sessionId,
        messageId,
        changes: JSON.stringify([{ path: "README.md", newContent: "after\n" }]),
        appliedChanges: JSON.stringify([{ path: "README.md", newContent: "after\n" }]),
        status: "applied",
        lifecycle: "committed",
        operationId,
        baseRevision: parentHash,
        changeSetHash: `crash-recovery:${operationId}`,
        baseTreeHash,
        candidateTreeHash: committedTreeHash,
        promotedTreeHash: committedTreeHash,
        treeDigestVersion: DELIVERY_TREE_DIGEST_VERSION,
        commitHash,
        committedTreeHash,
        createdAt: now,
        consumedAt: now,
      });
      await db.insert(eventsTable).values({
        id: crypto.randomUUID(),
        type: "GitCommitCreated",
        projectId,
        severity: "info",
        message: "Verified local commit created for recipe crash recovery test",
        correlationId: operationId,
        payload: {
          proposalId,
          operationId,
          commitHash,
          committedTreeHash,
          committedPaths: ["README.md"],
        },
      });

      fakeGithub = createHttpServer(async (req, res) => {
        const respond = (status: number, payload: Record<string, unknown>) => {
          res.writeHead(status, { "content-type": "application/json" });
          res.end(JSON.stringify(payload));
        };
        try {
          const chunks: Buffer[] = [];
          for await (const chunk of req) chunks.push(Buffer.from(chunk));
          const rawBody = Buffer.concat(chunks).toString("utf8");
          const body = rawBody ? JSON.parse(rawBody) as Record<string, unknown> : {};
          const requestPath = new URL(req.url ?? "/", "http://127.0.0.1").pathname;

          if (req.method === "GET" && requestPath.endsWith("/git/ref/heads/main")) {
            respond(200, { ref: "refs/heads/main", object: { sha: branch.commitHash } });
            return;
          }
          const commitMatch = requestPath.match(/\/git\/commits\/([^/]+)$/);
          if (req.method === "GET" && commitMatch) {
            const requestedHash = decodeURIComponent(commitMatch[1]!);
            if (requestedHash === parentHash) {
              respond(200, {
                sha: parentHash,
                tree: { sha: parentTreeHash },
                message: "initial",
                parents: [],
              });
              return;
            }
            if (requestedHash === commitHash && branch.commitHash === commitHash) {
              if (!postPushCommitReadHeld) {
                postPushCommitReadHeld = true;
                return;
              }
              respond(200, {
                sha: commitHash,
                tree: { sha: branch.treeHash },
                message: branch.message,
                parents: branch.parents.map((sha) => ({ sha })),
              });
              return;
            }
            respond(404, { message: "Unknown fixture commit" });
            return;
          }
          if (req.method === "POST" && requestPath.endsWith("/git/blobs")) {
            remoteWrites.blobs += 1;
            if (
              body.encoding !== "base64"
              || Buffer.from(String(body.content ?? ""), "base64").toString("utf8") !== "after\n"
            ) {
              apiProblems.push("Blob request did not contain the committed README bytes.");
              respond(422, { message: "Unexpected blob request" });
              return;
            }
            respond(201, { sha: blobHash });
            return;
          }
          if (req.method === "POST" && requestPath.endsWith("/git/trees")) {
            remoteWrites.trees += 1;
            if (
              body.base_tree !== parentTreeHash
              || !Array.isArray(body.tree)
              || !body.tree.some((entry) =>
                entry
                && typeof entry === "object"
                && (entry as Record<string, unknown>).path === "README.md"
                && (entry as Record<string, unknown>).sha === blobHash)
            ) {
              apiProblems.push("Tree request did not use the verified parent and README blob.");
              respond(422, { message: "Unexpected tree request" });
              return;
            }
            respond(201, { sha: gitTreeHash });
            return;
          }
          if (req.method === "POST" && requestPath.endsWith("/git/commits")) {
            remoteWrites.commits += 1;
            const parents = Array.isArray(body.parents) ? body.parents : [];
            if (body.tree !== gitTreeHash || parents.length !== 1 || parents[0] !== parentHash) {
              apiProblems.push("Commit request did not match the verified tree and parent.");
              respond(422, { message: "Unexpected commit request" });
              return;
            }
            pendingMessage = String(body.message ?? "");
            respond(201, { sha: commitHash });
            return;
          }
          if (req.method === "PATCH" && requestPath.endsWith("/git/refs/heads/main")) {
            if (
              branch.commitHash !== parentHash
              || body.sha !== commitHash
              || body.force !== false
              || !pendingMessage.includes(`EngineeringOS-Operation: ${operationId}`)
            ) {
              apiProblems.push("Ref update did not match the verified delivery commit.");
              respond(409, { message: "Unexpected ref update" });
              return;
            }
            branch = {
              commitHash,
              treeHash: gitTreeHash,
              message: pendingMessage,
              parents: [parentHash],
            };
            remoteWrites.refUpdates += 1;
            respond(200, { ref: "refs/heads/main", object: { sha: commitHash } });
            return;
          }
          apiProblems.push(`Unexpected fixture GitHub request: ${req.method} ${requestPath}`);
          respond(404, { message: "Unexpected fixture GitHub request" });
        } catch (error) {
          apiProblems.push(error instanceof Error ? error.message : String(error));
          respond(500, { message: "Fixture GitHub API failed" });
        }
      });
      await new Promise<void>((resolve, reject) => {
        fakeGithub!.once("error", reject);
        fakeGithub!.listen(0, "127.0.0.1", resolve);
      });
      const fixtureAddress = fakeGithub.address();
      if (!fixtureAddress || typeof fixtureAddress === "string") {
        throw new Error("Fixture GitHub API did not receive a TCP address.");
      }
      const fixtureUrl = `http://127.0.0.1:${fixtureAddress.port}`;
      const rawDatabaseUrl = process.env.DATABASE_URL;
      if (!rawDatabaseUrl) {
        throw new Error("Recipe crash recovery requires an explicit disposable DATABASE_URL.");
      }
      const childDatabaseUrl = new URL(rawDatabaseUrl);
      if (!["localhost", "127.0.0.1", "::1", "[::1]"].includes(childDatabaseUrl.hostname)) {
        throw new Error("Recipe crash recovery requires a loopback-only PostgreSQL database.");
      }
      const childApplicationName = `e2-gh-recipe-${projectId}`;
      childDatabaseUrl.searchParams.set("application_name", childApplicationName);
      const runnerModuleUrl = new URL("./recipe-operation-runner.ts", import.meta.url).href;
      const deliveryModuleUrl = new URL("./github-delivery-service.ts", import.meta.url).href;
      const childSource = [
        "(async () => {",
        `  const { runRecipeOperation } = await import(${JSON.stringify(runnerModuleUrl)});`,
        `  const { executeVerifiedGitHubDelivery } = await import(${JSON.stringify(deliveryModuleUrl)});`,
        "  let rawInput = '';",
        "  const inputPromise = new Promise((resolve) => {",
        "    process.stdin.setEncoding('utf8');",
        "    process.stdin.on('data', (chunk) => { rawInput += chunk; });",
        "    process.stdin.on('end', () => resolve(rawInput));",
        "  });",
        "  const input = JSON.parse(await inputPromise);",
        "  const request = async (apiPath, init = {}) => {",
        "    const response = await fetch(process.env.E2_GITHUB_FIXTURE_URL + apiPath, {",
        "      method: init.method ?? 'GET', headers: init.headers, body: init.body,",
        "    });",
        "    const body = await response.json();",
        "    if (!response.ok) throw new Error(JSON.stringify(body));",
        "    return body;",
        "  };",
        "  await runRecipeOperation({",
        "    ...input.params,",
        "    githubDeliveryRunner: async (deliveryInput) => executeVerifiedGitHubDelivery({",
        "      projectId: deliveryInput.projectId,",
        "      proposalId: input.proposalId,",
        "      operationId: deliveryInput.operationId,",
        "      executionId: deliveryInput.executionId,",
        "      executionAttempt: deliveryInput.executionAttempt,",
        "      sourceRevision: deliveryInput.sourceRevision,",
        "      rootPath: input.params.rootPath,",
        "      remoteUrl: input.remoteUrl,",
        "      branch: input.branchName,",
        "      message: deliveryInput.message,",
        "      signal: deliveryInput.signal,",
        "      beforeStateObserver: deliveryInput.beforeStateObserver,",
        "      request,",
        "    }),",
        "  });",
        "})().catch((error) => { console.error(error); process.exitCode = 1; });",
      ].join("\n");
      child = spawn(process.execPath, ["--import", "tsx", "-e", childSource], {
        cwd: process.cwd(),
        env: {
          DATABASE_URL: childDatabaseUrl.toString(),
          NODE_ENV: "test",
          PATH: process.env.PATH ?? "",
          HOME: process.env.HOME ?? "/tmp",
          PGAPPNAME: childApplicationName,
          AI_PROVIDER_EGRESS_DISABLED: "1",
          RUN_CONTROLLED_RELEASE_VALIDATION: "1",
          DASHBOARD_E2E_TEST_MODE: "fixture",
          E2_GITHUB_FIXTURE_URL: fixtureUrl,
        },
        stdio: ["pipe", "pipe", "pipe"],
      });
      child.stdout?.setEncoding("utf8");
      child.stderr?.setEncoding("utf8");
      let childOutput = "";
      let childDiagnostics = "";
      child.stdout?.on("data", (chunk: string) => { childOutput += chunk; });
      child.stderr?.on("data", (chunk: string) => { childDiagnostics += chunk; });
      childExit = new Promise<{ code: number | null; signal: NodeJS.Signals | null }>(
        (resolve) => child!.once("exit", (code, signal) => resolve({ code, signal })),
      );
      const deliveryInput = {
        ...fixture.params,
        sourceRevision: commitHash,
        deliveryProposalId: proposalId,
        proofRequired: true,
      };
      child.stdin?.end(JSON.stringify({ params: deliveryInput, proposalId, remoteUrl, branchName }));

      const pushDeadline = Date.now() + 60_000;
      while (!postPushCommitReadHeld && Date.now() < pushDeadline) {
        if (child.exitCode !== null || child.signalCode !== null) {
          throw new Error(
            `Recipe child exited before the post-push commit read was held `
            + `(code=${child.exitCode}, signal=${child.signalCode}); `
            + `stderr=${childDiagnostics}; stdout=${childOutput}`,
          );
        }
        await new Promise((resolve) => setTimeout(resolve, 25));
      }
      expect(postPushCommitReadHeld).toBe(true);
      expect(branch.commitHash).toBe(commitHash);
      expect(remoteWrites).toEqual({ blobs: 1, trees: 1, commits: 1, refUpdates: 1 });
      expect(child.kill("SIGKILL")).toBe(true);
      expect(await childExit).toMatchObject({ code: null, signal: "SIGKILL" });

      const disconnectDeadline = Date.now() + 20_000;
      let childDisconnected = false;
      while (Date.now() < disconnectDeadline) {
        const sessions = await db.execute(sql`
          SELECT pid FROM pg_stat_activity
          WHERE datname = current_database() AND application_name = ${childApplicationName}
        `);
        if (sessions.rows.length === 0) {
          childDisconnected = true;
          break;
        }
        await new Promise((resolve) => setTimeout(resolve, 50));
      }
      expect(childDisconnected).toBe(true);

      const [interruptedExecution] = await db.select({
        id: aiExecutionsTable.id,
        status: aiExecutionsTable.status,
        attempt: aiExecutionsTable.attempt,
      }).from(aiExecutionsTable)
        .where(eq(aiExecutionsTable.operationId, operationId))
        .limit(1);
      expect(interruptedExecution).toMatchObject({ status: "running", attempt: 0 });
      if (!interruptedExecution) {
        throw new Error("Interrupted delivery recipe did not persist its execution.");
      }
      const interruptedAttemptEvents = await db.select({
        payload: eventsTable.payload,
      }).from(eventsTable).where(and(
        eq(eventsTable.type, "GitPushAttemptStarted"),
        eq(eventsTable.correlationId, operationId),
      ));
      expect(interruptedAttemptEvents).toHaveLength(1);
      expect(interruptedAttemptEvents[0]?.payload).toMatchObject({
        proposalId,
        operationId,
        executionId: interruptedExecution.id,
        executionAttempt: 0,
        commitHash,
      });
      const interruptedReceipts = await db.select({ id: eventsTable.id }).from(eventsTable)
        .where(and(
          eq(eventsTable.type, "GitPushed"),
          eq(eventsTable.correlationId, operationId),
        ));
      expect(interruptedReceipts).toEqual([]);
      const interruptedSuccesses = await db.select({ id: aiExecutionAcceptancesTable.id })
        .from(aiExecutionAcceptancesTable).where(and(
          eq(aiExecutionAcceptancesTable.executionId, interruptedExecution.id),
          eq(aiExecutionAcceptancesTable.outcome, "SUCCEEDED"),
        ));
      const interruptedEffects = await db.select({ id: aiAgentEffectsTable.id })
        .from(aiAgentEffectsTable).where(eq(aiAgentEffectsTable.executionId, interruptedExecution.id));
      const interruptedBundles = await db.select({ id: aiAgentEffectBundlesTable.id })
        .from(aiAgentEffectBundlesTable).where(eq(aiAgentEffectBundlesTable.executionId, interruptedExecution.id));
      const interruptedTransitions = await db.select().from(aiWorldTransitionsTable)
        .where(eq(aiWorldTransitionsTable.executionId, interruptedExecution.id));
      expect(interruptedSuccesses).toEqual([]);
      expect(interruptedEffects).toEqual([]);
      expect(interruptedBundles).toEqual([]);
      expect(interruptedTransitions).toHaveLength(1);
      expect(interruptedTransitions[0]).toMatchObject({
        status: "pending",
        attempt: 0,
        afterObservationIds: [],
      });
      expect(remoteWrites).toEqual({ blobs: 1, trees: 1, commits: 1, refUpdates: 1 });
      expect(apiProblems).toEqual([]);

      const interruptedWorld = await worldState.getProjectWorldState(projectId);
      await db.update(aiExecutionsTable)
        .set({ leaseUntil: new Date(Date.now() - 1_000) })
        .where(eq(aiExecutionsTable.id, interruptedExecution.id));
      expect(await reconcileAiExecutions({ expiredOnly: true })).toBeGreaterThanOrEqual(1);
      let recoveredRunnerCalls = 0;
      const recovered = await runRecipeOperation({
        ...deliveryInput,
        githubDeliveryRunner: makeTestRunner(),
      });
      function makeTestRunner() {
        return async (input: Parameters<
          NonNullable<Parameters<typeof runRecipeOperation>[0]["githubDeliveryRunner"]>
        >[0]) => {
          recoveredRunnerCalls += 1;
          return executeVerifiedGitHubDelivery({
            projectId: input.projectId,
            proposalId,
            operationId: input.operationId,
            executionId: input.executionId!,
            executionAttempt: input.executionAttempt!,
            sourceRevision: input.sourceRevision!,
            rootPath,
            remoteUrl,
            branch: branchName,
            message: input.message,
            signal: input.signal,
            beforeStateObserver: input.beforeStateObserver,
            request: async (apiPath, init = {}) => {
              const response = await fetch(`${fixtureUrl}${apiPath}`, {
                method: init.method ?? "GET",
                headers: init.headers,
                body: init.body,
              });
              const payload = await response.json() as Record<string, unknown>;
              if (!response.ok) throw new Error(JSON.stringify(payload));
              return payload;
            },
          });
        };
      }
      expect(recovered.status).toBe("blocked");
      expect(recovered).toMatchObject({
        executionId: interruptedExecution.id,
        completedNodeIds: [],
        receipt: {
          attempt: 1,
          status: "blocked",
          completedNodeIds: [],
          nodes: [{
            status: "blocked",
            attempts: 1,
            evidenceId: null,
          }],
        },
      });
      expect(recoveredRunnerCalls).toBe(0);
      const finalReceipts = await db.select({ id: eventsTable.id }).from(eventsTable)
        .where(and(
          eq(eventsTable.type, "GitPushed"),
          eq(eventsTable.correlationId, operationId),
        ));
      expect(finalReceipts).toEqual([]);
      const finalSuccesses = await db.select({ id: aiExecutionAcceptancesTable.id })
        .from(aiExecutionAcceptancesTable).where(and(
          eq(aiExecutionAcceptancesTable.executionId, interruptedExecution.id),
          eq(aiExecutionAcceptancesTable.outcome, "SUCCEEDED"),
        ));
      const finalEffects = await db.select({ id: aiAgentEffectsTable.id })
        .from(aiAgentEffectsTable).where(eq(aiAgentEffectsTable.executionId, interruptedExecution.id));
      const finalBundles = await db.select({ id: aiAgentEffectBundlesTable.id })
        .from(aiAgentEffectBundlesTable).where(eq(aiAgentEffectBundlesTable.executionId, interruptedExecution.id));
      const finalTransitions = await db.select().from(aiWorldTransitionsTable)
        .where(eq(aiWorldTransitionsTable.executionId, interruptedExecution.id));
      expect(finalSuccesses).toEqual([]);
      expect(finalEffects).toEqual([]);
      expect(finalBundles).toEqual([]);
      expect(finalTransitions).toHaveLength(1);
      expect(finalTransitions[0]).toMatchObject({
        id: interruptedTransitions[0]!.id,
        status: "pending",
        attempt: 0,
      });
      expect((await worldState.getProjectWorldState(projectId)).facts).toEqual(interruptedWorld.facts);
      expect(remoteWrites).toEqual({ blobs: 1, trees: 1, commits: 1, refUpdates: 1 });
      expect(apiProblems).toEqual([]);
    } finally {
      if (child && child.exitCode === null && child.signalCode === null) {
        child.kill("SIGKILL");
        await childExit;
      }
      if (fakeGithub?.listening) {
        await new Promise<void>((resolve) => fakeGithub!.close(() => resolve()));
      }
      const projectExecutions = await db.select({ id: aiExecutionsTable.id })
        .from(aiExecutionsTable).where(eq(aiExecutionsTable.projectId, projectId));
      for (const execution of projectExecutions) {
        await db.delete(aiExecutionAcceptancesTable)
          .where(eq(aiExecutionAcceptancesTable.executionId, execution.id));
        await db.delete(aiExecutionsTable).where(eq(aiExecutionsTable.id, execution.id));
      }
      await db.delete(eventsTable).where(eq(eventsTable.projectId, projectId));
      await db.delete(aiChangeProposalsTable)
        .where(eq(aiChangeProposalsTable.projectId, projectId));
      await db.delete(aiChatMessagesTable).where(eq(aiChatMessagesTable.sessionId, sessionId));
      await fixture.cleanup();
    }
  }, 120_000);

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