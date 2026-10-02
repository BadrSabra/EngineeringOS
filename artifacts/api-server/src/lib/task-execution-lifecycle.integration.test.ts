import { afterEach, describe, expect, it, vi } from "vitest";
import { and, eq, sql } from "drizzle-orm";
import { randomUUID } from "node:crypto";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import {
  buildMissionRepairEffectContract,
  MISSION_REPAIR_TOOL_CAPABILITY_ID,
} from "./agent-state/mission-repair-effect.js";
import { verifyAndPersistEffect } from "./agent-state/effect-observer.js";
import { materializeServerOwnedObservations } from "./agent-state/observation-materializer.js";
import { assertMissionRepairToolActionRequested } from "./agent-state/mission-repair-tool-action-ledger.js";
import type { AgentAction, AgentStep } from "@workspace/ai-orchestrator";
type ChatWithFallbackFunction = (typeof import("./ai-route-helpers.js"))["chatWithFallback"];
type MissionValidationRunner = NonNullable<
  Parameters<ChatWithFallbackFunction>[1]["validationRunner"]
>;
import {
  aiAgentEffectBundlesTable,
  aiAgentEffectsTable,
  aiAgentEpisodeEventsTable,
  aiExecutionAcceptancesTable,
  aiAgentEpisodesTable,
  aiAgentObservationsTable,
  aiExecutionsTable,
  aiGoalsTable,
  aiMissionsTable,
  aiUsageEventsTable,
  db,
  operatorAlertsTable,
  projectsTable,
  tasksTable,
  workflowsTable,
} from "@workspace/db";

const runAgentWithFallback = vi.hoisted(() => vi.fn(async (..._args: unknown[]) => ({
  result: {
    summary: "Fixture execution completed.",
    confidence: "high",
    needsHumanReview: false,
    steps: ["Server-owned fixture output accepted."],
  },
  effectiveProvider: "groq" as const,
})));
const chatWithFallback = vi.hoisted(() => vi.fn(async (..._args: unknown[]) => ({
  result: {
    response: "Mission tool-loop fixture completed.",
    pendingChanges: [] as Array<{ path: string; newContent: string }>,
    sources: [],
  },
  effectiveProvider: "groq" as const,
})));
const actualChatWithFallbackRef = vi.hoisted(() => ({
  fn: undefined as ((...args: unknown[]) => Promise<unknown>) | undefined,
}));
const providerStrategyState = vi.hoisted(() => ({
  callCount: 0,
  toolCallId: "",
  toolName: "read_file" as "read_file" | "run_validation",
  toolArguments: {} as Record<string, string>,
  requestedToolName: "",
  callOptionsSummary: [] as Array<{
    keys: string[];
    toolNames: string[];
    toolChoice: string;
    toolsType: string;
    toolsCount: number;
  }>,
}));
const runRepairValidation = vi.hoisted(() => vi.fn(async (..._args: unknown[]) => ({
  status: "passed" as const,
  evidence: { artifactRef: "fixture-validation-receipt" },
})));
const pendingObservationMaterializations = vi.hoisted(() => [] as Promise<unknown>[]);

vi.mock("./ai-route-helpers.js", async () => {
  const actual = await vi.importActual<typeof import("./ai-route-helpers.js")>("./ai-route-helpers.js");
  actualChatWithFallbackRef.fn = actual.chatWithFallback as unknown as (
    ...args: unknown[]
  ) => Promise<unknown>;
  return {
    ...actual,
    runAgentWithFallback,
    chatWithFallback,
  };
});

vi.mock("@workspace/ai-orchestrator", async () => {
  const actual = await vi.importActual<typeof import("@workspace/ai-orchestrator")>("@workspace/ai-orchestrator");
  return {
    ...actual,
    buildProjectContext: vi.fn(async () => ({ fixture: true })),
    invalidateContextCache: vi.fn(),
    getProviderLifecycleSnapshot: vi.fn(async () => ({
      provider: "groq" as const,
      source: "server" as const,
      keyIdentity: null,
      revision: 1,
      generation: 1,
      checkedAt: null,
      expiresAt: null,
      lastKnownGoodAt: null,
      lastKnownGoodExpiresAt: null,
      credentialStatus: "credentials_valid" as const,
      modelStatus: "model_not_checked" as const,
      capabilityStatus: "capability_healthy" as const,
      overallStatus: "ready" as const,
      selectable: true,
      roles: [] as const,
      capabilities: [] as const,
      reasonCodes: ["capability_not_checked"] as const,
    })),
    isCircuitOpen: vi.fn(() => false),
  };
});

vi.mock("../../../../lib/ai-orchestrator/src/provider-registry.js", async () => {
  const actual = await vi.importActual<
    typeof import("../../../../lib/ai-orchestrator/src/provider-registry.js")
  >("../../../../lib/ai-orchestrator/src/provider-registry.js");
  return {
    ...actual,
    getStrategy: vi.fn(() => ({
      providerId: "groq",
      supportsNativeStream: false,
      call: async (_messages: unknown[], options?: unknown) => {
        providerStrategyState.callCount += 1;
        const callOptions = options && typeof options === "object"
          ? options as {
              tools?: unknown;
              toolChoice?: unknown;
              tool_choice?: unknown;
            }
          : {};
        const rawTools = callOptions.tools;
        const toolEntries = Array.isArray(rawTools) ? rawTools : [];
        providerStrategyState.callOptionsSummary.push({
          keys: Object.keys(callOptions).sort(),
          toolNames: toolEntries.flatMap((tool) => {
                if (!tool || typeof tool !== "object") return [];
                const fn = (tool as { function?: { name?: unknown } }).function;
                return typeof fn?.name === "string" ? [fn.name] : [];
              }),
          toolChoice: String(callOptions.toolChoice ?? callOptions.tool_choice ?? ""),
          toolsType: rawTools === undefined
            ? "undefined"
            : Array.isArray(rawTools)
              ? "array"
              : typeof rawTools,
          toolsCount: Array.isArray(rawTools)
            ? rawTools.length
            : rawTools && typeof rawTools === "object"
              ? Object.keys(rawTools).length
              : 0,
        });
        if (providerStrategyState.callCount === 1) {
          providerStrategyState.requestedToolName = providerStrategyState.toolName;
          return {
            content: "",
            toolCalls: [{
              id: providerStrategyState.toolCallId,
              type: "function",
              function: {
                name: providerStrategyState.toolName,
                arguments: JSON.stringify(providerStrategyState.toolArguments),
              },
            }],
            model: `db-handoff-${providerStrategyState.toolName}-fixture`,
            usage: { promptTokens: 0, completionTokens: 0 },
            finishReason: "tool_calls",
          };
        }
        return {
          content: "Read the authorized fixture file successfully.",
          toolCalls: null,
          model: "db-handoff-read-fixture",
          usage: { promptTokens: 0, completionTokens: 0 },
          finishReason: "stop",
        };
      },
      stream: async function* () {
        yield "The fixture defines the base value.";
      },
    })),
  };
});

vi.mock("./task-progress.js", () => ({
  createTaskProgressEmitter: vi.fn(() => ({
    start: vi.fn(async () => undefined),
    finish: vi.fn(async () => undefined),
    terminal: vi.fn(async () => undefined),
  })),
}));

vi.mock("./agent-state/observation-materializer.js", async () => {
  const actual = await vi.importActual<typeof import("./agent-state/observation-materializer.js")>(
    "./agent-state/observation-materializer.js",
  );
  return {
    ...actual,
    materializeServerOwnedObservations: (
      ...args: Parameters<typeof actual.materializeServerOwnedObservations>
    ) => {
      const pending = actual.materializeServerOwnedObservations(...args);
      pendingObservationMaterializations.push(pending);
      return pending;
    },
  };
});

vi.mock("./ai-repair-validation.js", async () => {
  const actual = await vi.importActual<typeof import("./ai-repair-validation.js")>("./ai-repair-validation.js");
  return {
    ...actual,
    runRepairValidation,
  };
});

import {
  executeTaskLifecycle,
  parseMissionToolLoopCheckpoint,
} from "./task-execution-service.js";
import {
  checkpointAiExecution,
  requestAiExecutionCancel,
} from "./ai-execution-state.js";
import { appendEpisodeEvent } from "./agent-state/agent-episode-ledger.js";
import { createValidationWorkspace } from "./ai-repair-validation.js";

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

async function drainPendingObservationMaterializations(): Promise<unknown[]> {
  const materializationFailures: unknown[] = [];
  while (pendingObservationMaterializations.length > 0) {
    const pending = pendingObservationMaterializations.splice(0);
    const results = await Promise.allSettled(pending);
    materializationFailures.push(
      ...results.flatMap((result) => result.status === "rejected" ? [result.reason] : []),
    );
  }
  return materializationFailures;
}

async function cleanupProjectExecutionData(projectId: string) {
  const materializationFailures = await drainPendingObservationMaterializations();
  await db.delete(aiUsageEventsTable).where(eq(aiUsageEventsTable.projectId, projectId));
  await db.delete(operatorAlertsTable).where(and(
    eq(operatorAlertsTable.ownerId, "mission-effect-test-user"),
    eq(operatorAlertsTable.projectId, projectId),
  ));
  await db.delete(aiAgentEpisodeEventsTable).where(eq(aiAgentEpisodeEventsTable.projectId, projectId));
  await db.delete(aiAgentObservationsTable).where(eq(aiAgentObservationsTable.projectId, projectId));
  await db.delete(aiAgentEffectsTable).where(eq(aiAgentEffectsTable.projectId, projectId));
  await db.delete(aiExecutionAcceptancesTable).where(
    eq(aiExecutionAcceptancesTable.projectId, projectId),
  );
  await db.delete(aiAgentEffectBundlesTable).where(eq(aiAgentEffectBundlesTable.projectId, projectId));
  await db.delete(aiAgentEpisodesTable).where(eq(aiAgentEpisodesTable.projectId, projectId));
  await db.delete(aiExecutionsTable).where(eq(aiExecutionsTable.projectId, projectId));
  if (materializationFailures.length > 0) {
    throw new AggregateError(
      materializationFailures,
      "Observation materialization failed before fixture cleanup.",
    );
  }
}

async function createMissionToolLoopFixture(input: {
  phase: "execute" | "validate";
  approvalRequired: boolean;
  prompt?: string;
  targetPaths?: string[];
}) {
  const projectId = randomUUID();
  const missionId = randomUUID();
  const goalId = randomUUID();
  const taskId = randomUUID();
  const now = new Date();
  const targetPaths = input.targetPaths ?? ["src/target.ts"];
  const workspaceRoot = process.env.WORKSPACE_PATH ?? "/home/runner/workspace";
  const rootPath = await mkdtemp(join(workspaceRoot, "mission-tool-loop-"));
  await mkdir(join(rootPath, "src"), { recursive: true });
  await writeFile(join(rootPath, "src", "target.ts"), "export const value = 'base';\n", "utf8");

  await db.insert(projectsTable).values({
    id: projectId,
    ownerId: "mission-effect-test-user",
    name: `mission-effect-${projectId.slice(0, 8)}`,
    rootPath,
    language: "typescript",
    status: "active",
    createdAt: now,
    updatedAt: now,
  });
  await db.insert(aiMissionsTable).values({
    id: missionId,
    projectId,
    userId: "mission-effect-test-user",
    title: "Mission repair effect fixture",
    intent: "Verify a bounded Mission task.",
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
    title: "Verify the candidate",
    description: "Run the server-owned Mission tool loop.",
    status: "running",
    priority: "p1",
    successCriteria: { objective: "Verify the target source file." },
    evidenceContract: {},
    outcomeContract: {
      planRevision: {
        hash: `mission-plan-${goalId}`,
        steps: [{
          kind: input.phase,
          files: targetPaths,
          validationProfile: "workspace-typecheck",
          approvalRequired: input.approvalRequired,
        }],
      },
    },
    nextAction: { kind: "task", taskId },
    createdAt: now,
    updatedAt: now,
  });
  await db.insert(tasksTable).values({
    id: taskId,
    projectId,
    goalId,
    phase: input.phase,
    title: `Mission ${input.phase} fixture`,
    prompt: input.prompt ?? "Use only the server-authorized project scope.",
    relatedFiles: targetPaths,
    status: "verifying",
    retryCount: 0,
    maxRetries: 2,
    createdAt: now,
    updatedAt: now,
  });

  return {
    projectId,
    missionId,
    goalId,
    taskId,
    rootPath,
    now,
    cleanup: async () => {
      await cleanupProjectExecutionData(projectId);
      await db.delete(tasksTable).where(eq(tasksTable.id, taskId));
      await db.delete(aiGoalsTable).where(eq(aiGoalsTable.id, goalId));
      await db.delete(aiMissionsTable).where(eq(aiMissionsTable.id, missionId));
      await db.delete(projectsTable).where(eq(projectsTable.id, projectId));
      await rm(rootPath, { recursive: true, force: true });
    },
  };
}

describe("real durable task execution lifecycle", () => {
  afterEach(() => {
    vi.clearAllMocks();
    runAgentWithFallback.mockReset().mockImplementation(async (..._args: unknown[]) => ({
      result: {
        summary: "Fixture execution completed.",
        confidence: "high" as const,
        needsHumanReview: false,
        steps: ["Server-owned fixture output accepted."],
      },
      effectiveProvider: "groq" as const,
    }));
    chatWithFallback.mockReset().mockImplementation(async () => ({
      result: {
        response: "Mission tool-loop fixture completed.",
        pendingChanges: [] as Array<{ path: string; newContent: string }>,
        sources: [],
      },
      effectiveProvider: "groq" as const,
    }));
    runRepairValidation.mockReset().mockImplementation(async () => ({
      status: "passed" as const,
      evidence: { artifactRef: "fixture-validation-receipt" },
    }));
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
      await waitForEpisode(outcome.executionId!);

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
      await cleanupProjectExecutionData(projectId);
      await db.delete(tasksTable).where(eq(tasksTable.id, taskId));
      await db.delete(projectsTable).where(eq(projectsTable.id, projectId));
    }
  });

  it("persists active execution cancellation and restores the task state", async () => {
    const projectId = randomUUID();
    const taskId = randomUUID();
    const userId = "lifecycle-test-user";
    const now = new Date();
    await db.insert(projectsTable).values({
      id: projectId,
      ownerId: userId,
      name: `lifecycle-cancel-${projectId.slice(0, 8)}`,
      rootPath: `/tmp/lifecycle-${projectId}`,
      language: "typescript",
      status: "active",
      createdAt: now,
      updatedAt: now,
    });
    await db.insert(tasksTable).values({
      id: taskId,
      projectId,
      title: "Durable cancellation fixture",
      prompt: "Wait for the server cancellation signal",
      status: "verifying",
      retryCount: 0,
      maxRetries: 2,
      createdAt: now,
      updatedAt: now,
    });

    let resolveProviderStarted!: () => void;
    const providerStarted = new Promise<void>((resolve) => {
      resolveProviderStarted = resolve;
    });
    let executionPromise: ReturnType<typeof executeTaskLifecycle> | undefined;
    let executionId: string | undefined;
    let startupTimeout: ReturnType<typeof setTimeout> | undefined;

    runAgentWithFallback.mockImplementationOnce(async (...args: unknown[]) => {
      const options = args[3] as { signal?: AbortSignal } | undefined;
      const signal = options?.signal;
      if (!signal) throw new Error("Task execution did not forward its cancellation signal.");
      resolveProviderStarted();
      return new Promise<never>((_resolve, reject) => {
        const rejectAsCancelled = () => {
          const error = new Error("Fixture execution cancelled.");
          error.name = "AbortError";
          reject(error);
        };
        if (signal.aborted) {
          rejectAsCancelled();
          return;
        }
        signal.addEventListener("abort", rejectAsCancelled, { once: true });
      });
    });

    try {
      executionPromise = executeTaskLifecycle({
        taskId,
        userId,
        provider: { provider: "groq", apiKey: "fixture-provider" },
        trigger: "reconciliation",
        expectedStatuses: ["verifying"],
        workspaceRevision: now.toISOString(),
      });
      await Promise.race([
        providerStarted,
        new Promise<never>((_resolve, reject) => {
          startupTimeout = setTimeout(
            () => reject(new Error("Provider execution did not start before cancellation fixture timeout.")),
            10_000,
          );
        }),
      ]);
      if (startupTimeout) clearTimeout(startupTimeout);

      const [executionBeforeCancel] = await db
        .select({
          id: aiExecutionsTable.id,
          status: aiExecutionsTable.status,
        })
        .from(aiExecutionsTable)
        .where(and(
          eq(aiExecutionsTable.linkedTaskId, taskId),
          eq(aiExecutionsTable.projectId, projectId),
        ))
        .limit(1);
      expect(executionBeforeCancel).toMatchObject({ status: "running" });
      executionId = executionBeforeCancel.id;

      await requestAiExecutionCancel({ executionId, userId });
      const outcome = await executionPromise;
      expect(outcome).toMatchObject({
        ok: false,
        status: "failed",
        executionId,
        errorCode: "cancelled",
      });

      const [task] = await db
        .select({
          status: tasksTable.status,
          workerId: tasksTable.workerId,
          verificationResult: tasksTable.verificationResult,
        })
        .from(tasksTable)
        .where(eq(tasksTable.id, taskId));
      expect(task).toMatchObject({
        status: "verifying",
        workerId: null,
        verificationResult: { passed: false, decision: "cancelled" },
      });

      const [execution] = await db
        .select({
          status: aiExecutionsTable.status,
          workerId: aiExecutionsTable.workerId,
          recipeReceipt: aiExecutionsTable.recipeReceipt,
        })
        .from(aiExecutionsTable)
        .where(eq(aiExecutionsTable.id, executionId));
      expect(execution).toMatchObject({
        status: "cancelled",
        workerId: null,
        recipeReceipt: {
          terminalStatus: "CANCELLED",
          terminalReason: "cancelled",
          failureClass: "internal",
          retryable: false,
          stages: expect.arrayContaining(["provider_call"]),
        },
      });

      const [acceptance] = await db
        .select({
          outcome: aiExecutionAcceptancesTable.outcome,
          terminalStatus: aiExecutionAcceptancesTable.terminalStatus,
          reasonCode: aiExecutionAcceptancesTable.reasonCode,
          resumable: aiExecutionAcceptancesTable.resumable,
        })
        .from(aiExecutionAcceptancesTable)
        .where(eq(aiExecutionAcceptancesTable.executionId, executionId));
      expect(acceptance).toEqual({
        outcome: "INTERRUPTED",
        terminalStatus: "cancelled",
        reasonCode: "EXECUTION_CANCELLED",
        resumable: 0,
      });
    } finally {
      if (startupTimeout) clearTimeout(startupTimeout);
      if (executionPromise) {
        if (!executionId) {
          const [pendingExecution] = await db
            .select({ id: aiExecutionsTable.id })
            .from(aiExecutionsTable)
            .where(and(
              eq(aiExecutionsTable.linkedTaskId, taskId),
              eq(aiExecutionsTable.projectId, projectId),
            ))
            .limit(1);
          executionId = pendingExecution?.id;
        }
        if (executionId) {
          const [pendingExecution] = await db
            .select({ status: aiExecutionsTable.status })
            .from(aiExecutionsTable)
            .where(eq(aiExecutionsTable.id, executionId))
            .limit(1);
          if (pendingExecution?.status === "running" || pendingExecution?.status === "cancelling") {
            await requestAiExecutionCancel({ executionId, userId }).catch(() => undefined);
          }
        }
        await executionPromise.catch(() => undefined);
      }
      await cleanupProjectExecutionData(projectId);
      await db.delete(tasksTable).where(eq(tasksTable.id, taskId));
      await db.delete(projectsTable).where(eq(projectsTable.id, projectId));
    }
  }, 20_000);

  it("persists provider failure as retryable terminal acceptance", async () => {
    const projectId = randomUUID();
    const taskId = randomUUID();
    const userId = "lifecycle-test-user";
    const privateProviderFailure = "T8_PRIVATE_PROVIDER_FAILURE";
    const now = new Date();
    await db.insert(projectsTable).values({
      id: projectId,
      ownerId: userId,
      name: `lifecycle-provider-failure-${projectId.slice(0, 8)}`,
      rootPath: `/tmp/lifecycle-${projectId}`,
      language: "typescript",
      status: "active",
      createdAt: now,
      updatedAt: now,
    });
    await db.insert(tasksTable).values({
      id: taskId,
      projectId,
      title: "Durable provider failure fixture",
      prompt: "Fail during the provider call",
      status: "verifying",
      retryCount: 0,
      maxRetries: 2,
      createdAt: now,
      updatedAt: now,
    });
    runAgentWithFallback.mockImplementationOnce(async (..._args: unknown[]) => {
      throw new Error(privateProviderFailure);
    });

    try {
      const outcome = await executeTaskLifecycle({
        taskId,
        userId,
        provider: { provider: "groq", apiKey: "fixture-provider" },
        trigger: "reconciliation",
        expectedStatuses: ["verifying"],
        workspaceRevision: now.toISOString(),
      });
      expect(outcome).toMatchObject({
        ok: false,
        status: "failed",
        errorCode: "provider_call_failed",
      });
      expect(outcome.executionId).toEqual(expect.any(String));

      const [task] = await db
        .select({
          status: tasksTable.status,
          workerId: tasksTable.workerId,
          verificationResult: tasksTable.verificationResult,
        })
        .from(tasksTable)
        .where(eq(tasksTable.id, taskId));
      expect(task).toMatchObject({
        status: "verifying",
        workerId: null,
        verificationResult: { passed: false, decision: "failed" },
      });

      const [execution] = await db
        .select({
          status: aiExecutionsTable.status,
          workerId: aiExecutionsTable.workerId,
          recipeReceipt: aiExecutionsTable.recipeReceipt,
        })
        .from(aiExecutionsTable)
        .where(eq(aiExecutionsTable.id, outcome.executionId!));
      expect(execution).toMatchObject({
        status: "failed",
        workerId: null,
        recipeReceipt: {
          terminalStatus: "FAILED",
          terminalReason: "provider_call_failed",
          failureClass: "provider",
          retryable: true,
          stages: expect.arrayContaining(["provider_call"]),
        },
      });
      expect(JSON.stringify(execution.recipeReceipt)).not.toContain(privateProviderFailure);

      const [acceptance] = await db
        .select({
          outcome: aiExecutionAcceptancesTable.outcome,
          terminalStatus: aiExecutionAcceptancesTable.terminalStatus,
          reasonCode: aiExecutionAcceptancesTable.reasonCode,
          resumable: aiExecutionAcceptancesTable.resumable,
        })
        .from(aiExecutionAcceptancesTable)
        .where(eq(aiExecutionAcceptancesTable.executionId, outcome.executionId!));
      expect(acceptance).toEqual({
        outcome: "FAILED",
        terminalStatus: "failed",
        reasonCode: "EXECUTION_PROVIDER_FAILURE",
        resumable: 1,
      });
    } finally {
      await cleanupProjectExecutionData(projectId);
      await db.delete(tasksTable).where(eq(tasksTable.id, taskId));
      await db.delete(projectsTable).where(eq(projectsTable.id, projectId));
    }
  }, 20_000);

  it("binds workflow task episodes to the workflow scope", async () => {
    const projectId = randomUUID();
    const workflowId = randomUUID();
    const taskId = randomUUID();
    const now = new Date();

    await db.insert(projectsTable).values({
      id: projectId,
      ownerId: "workflow-episode-test-user",
      name: `workflow-episode-${projectId.slice(0, 8)}`,
      rootPath: `/tmp/workflow-episode-${projectId}`,
      language: "typescript",
      status: "active",
      createdAt: now,
      updatedAt: now,
    });
    await db.insert(workflowsTable).values({
      id: workflowId,
      projectId,
      name: "Episode identity workflow",
      description: "Fixture for workflow-scoped episode identity.",
      status: "idle",
      phases: [],
      executionCount: 0,
      createdAt: now,
      updatedAt: now,
    });
    await db.insert(tasksTable).values({
      id: taskId,
      projectId,
      workflowId,
      title: "Workflow episode task",
      prompt: "Complete the deterministic workflow fixture task",
      status: "verifying",
      retryCount: 0,
      maxRetries: 2,
      createdAt: now,
      updatedAt: now,
    });

    try {
      const outcome = await executeTaskLifecycle({
        taskId,
        userId: "workflow-episode-test-user",
        provider: { provider: "groq", apiKey: "fixture-provider" },
        trigger: "reconciliation",
        expectedStatuses: ["verifying"],
        workspaceRevision: now.toISOString(),
      });

      expect(outcome.ok).toBe(true);
      const episode = await waitForEpisode(outcome.executionId!);
      expect(episode).toMatchObject({
        missionId: null,
        goalId: null,
        planRevision: null,
        scope: {
          kind: "workflow-task",
          taskId,
          workflowId,
        },
      });
    } finally {
      await cleanupProjectExecutionData(projectId);
      await db.delete(tasksTable).where(eq(tasksTable.id, taskId));
      await db.delete(workflowsTable).where(eq(workflowsTable.id, workflowId));
      await db.delete(projectsTable).where(eq(projectsTable.id, projectId));
    }
  });

  it("requires a directly observed candidate effect for an approved Mission repair", async () => {
    const fixture = await createMissionToolLoopFixture({
      phase: "execute",
      approvalRequired: false,
    });
    const candidateContent = "export const value = 'candidate';\n";
    chatWithFallback.mockImplementationOnce(async (...args: unknown[]) => {
      const baseParams = args[1] as {
        onMutationInvocation?: import("@workspace/ai-orchestrator").MutationToolInvocationCallback;
      };
      const invocation = {
        toolCallId: "provider-call-mission-repair-1",
        toolName: "write_file" as const,
        path: "src/target.ts",
        inputHash: "a".repeat(64),
      };
      const mutationCallback = baseParams.onMutationInvocation;
      expect(mutationCallback).toBeDefined();
      await expect(mutationCallback!({ ...invocation, phase: "committed" }))
        .rejects.toThrow("mission_repair_tool_action_request_missing");
      await baseParams.onMutationInvocation?.({ ...invocation, phase: "requested" });
      await baseParams.onMutationInvocation?.({ ...invocation, phase: "committed" });
      // A replay of the same provider call must be idempotent in the Episode ledger.
      await baseParams.onMutationInvocation?.({ ...invocation, phase: "requested" });
      await baseParams.onMutationInvocation?.({ ...invocation, phase: "committed" });
      return {
        result: {
          response: "Prepared and verified the bounded repair.",
          pendingChanges: [{ path: "src/target.ts", newContent: candidateContent }],
          sources: [],
        },
        effectiveProvider: "groq" as const,
      };
    });
    runRepairValidation.mockImplementationOnce(async (...args: unknown[]) => {
      const evidenceContext = args[5] as {
        operationId: string;
        projectRevision?: string;
        candidateHash?: string;
      };
      const [execution] = await db
        .select({
          checkpoint: aiExecutionsTable.checkpoint,
          checkpointVersion: aiExecutionsTable.checkpointVersion,
        })
        .from(aiExecutionsTable)
        .where(eq(aiExecutionsTable.id, evidenceContext.operationId))
        .limit(1);
      expect(execution).toBeDefined();
      if (!execution) throw new Error("Mission repair checkpoint was not persisted before validation.");
      const checkpoint = JSON.parse(execution.checkpoint) as { sequence: number; detail: string };
      const detail = JSON.parse(checkpoint.detail) as {
        pendingChanges: Array<{ path: string; newContent: string }>;
        missionRepairRecovery: {
          phase: string;
          executionId: string;
          projectId: string;
          attempt: number;
          actionId: string;
          sourceRevision: string;
          candidateIdentity: string;
          pendingChangesHash: string;
          approvedPathsHash: string;
          checkpointSequence: number;
        };
      };
      expect(checkpoint.sequence).toBe(execution.checkpointVersion);
      expect(detail.pendingChanges).toEqual([
        { path: "src/target.ts", newContent: candidateContent },
      ]);
      expect(detail.missionRepairRecovery).toMatchObject({
        phase: "candidate_ready",
        executionId: evidenceContext.operationId,
        projectId: fixture.projectId,
        sourceRevision: evidenceContext.projectRevision,
        candidateIdentity: evidenceContext.candidateHash,
        actionId: `mission-repair:${evidenceContext.operationId}:${detail.missionRepairRecovery.attempt}`,
      });
      expect(detail.missionRepairRecovery.pendingChangesHash).toMatch(/^[a-f0-9]{64}$/);
      expect(detail.missionRepairRecovery.approvedPathsHash).toMatch(/^[a-f0-9]{64}$/);
      expect(detail.missionRepairRecovery.checkpointSequence).toBe(checkpoint.sequence);
      const parsedCheckpoint = parseMissionToolLoopCheckpoint({
        stage: "tool_loop",
        sequence: checkpoint.sequence,
        detail: checkpoint.detail,
        updatedAt: new Date().toISOString(),
      });
      expect(parsedCheckpoint?.recoveryBlockedReason).toBeUndefined();
      const committedCheckpoint = parseMissionToolLoopCheckpoint({
        stage: "tool_loop",
        sequence: checkpoint.sequence,
        detail: JSON.stringify({
          ...detail,
          missionRepairRecovery: {
            ...detail.missionRepairRecovery,
            phase: "committed",
            validatorStatus: "passed",
            validatorEvidenceId: "mission-repair-validator-evidence",
          },
        }),
        updatedAt: new Date().toISOString(),
      });
      expect(committedCheckpoint?.recoveryBlockedReason).toBeUndefined();
      const postCommitCheckpoint = parseMissionToolLoopCheckpoint({
        stage: "tool_loop",
        sequence: checkpoint.sequence,
        detail: JSON.stringify({
          ...detail,
          missionRepairRecovery: {
            ...detail.missionRepairRecovery,
            phase: "effect_classified",
            validatorStatus: "passed",
            validatorEvidenceId: "mission-repair-validator-evidence",
            afterObservationId: "mission-repair-after-observation",
            effectBundleId: "mission-repair-effect-bundle",
            effectObserved: true,
          },
        }),
        updatedAt: new Date().toISOString(),
      });
      expect(postCommitCheckpoint?.recoveryBlockedReason).toBeUndefined();
      const missingManifestCheckpoint = parseMissionToolLoopCheckpoint({
        stage: "tool_loop",
        sequence: checkpoint.sequence + 1,
        detail: JSON.stringify({
          schemaVersion: 2,
          executionProfile: "mission_repair",
          iteration: 1,
          toolCalls: 0,
          noProgressStreak: 0,
          claimState: [],
          missingEvidencePaths: [],
          lastObservation: "candidate setup interrupted",
          completedToolCalls: [],
          pendingChanges: [],
        }),
        updatedAt: new Date().toISOString(),
      });
      expect(missingManifestCheckpoint?.recoveryBlockedReason).toBe("manifest_missing");
      const malformedCheckpoint = parseMissionToolLoopCheckpoint({
        stage: "tool_loop",
        sequence: checkpoint.sequence + 2,
        detail: "{malformed",
        updatedAt: new Date().toISOString(),
      });
      expect(malformedCheckpoint?.recoveryBlockedReason).toBe("manifest_invalid");
      return {
        status: "passed",
        evidence: {
          evidenceId: "mission-repair-validator-evidence",
          artifactRef: "mission-repair-validator-pass",
          validatorProfile: String(args[1]),
        },
      };
    });

    try {
      const outcome = await executeTaskLifecycle({
        taskId: fixture.taskId,
        userId: "mission-effect-test-user",
        provider: { provider: "groq", apiKey: "fixture-provider" },
        trigger: "reconciliation",
        expectedStatuses: ["verifying"],
        workspaceRevision: fixture.now.toISOString(),
      });

      expect(outcome.ok).toBe(true);
      expect(outcome.status).toBe("completed");
      expect(await readFile(join(fixture.rootPath, "src", "target.ts"), "utf8"))
        .toBe("export const value = 'base';\n");
      expect(runRepairValidation).toHaveBeenCalledTimes(1);
      expect(runRepairValidation.mock.calls[0]?.[4]).toEqual([
        { path: "src/target.ts", newContent: candidateContent },
      ]);

      const [acceptance] = await db
        .select({
          outcome: aiExecutionAcceptancesTable.outcome,
          effectBundleId: aiExecutionAcceptancesTable.effectBundleId,
        })
        .from(aiExecutionAcceptancesTable)
        .where(eq(aiExecutionAcceptancesTable.projectId, fixture.projectId))
        .limit(1);
      expect(acceptance).toMatchObject({
        outcome: "SUCCEEDED",
        effectBundleId: expect.any(String),
      });

      const [bundle] = await db
        .select({ verdict: aiAgentEffectBundlesTable.verdict })
        .from(aiAgentEffectBundlesTable)
        .where(eq(aiAgentEffectBundlesTable.executionId, outcome.executionId!))
        .limit(1);
      expect(bundle?.verdict).toBe("OBSERVED");
      const effects = await db
        .select({ status: aiAgentEffectsTable.status })
        .from(aiAgentEffectsTable)
        .where(eq(aiAgentEffectsTable.executionId, outcome.executionId!));
      expect(effects).toEqual([{ status: "observed" }]);

      const observations = await db
        .select({
          provenance: aiAgentObservationsTable.provenance,
          predicate: aiAgentObservationsTable.predicate,
          value: aiAgentObservationsTable.value,
        })
        .from(aiAgentObservationsTable)
        .where(eq(aiAgentObservationsTable.executionId, outcome.executionId!));
      expect(observations).toHaveLength(2);
      expect(observations.every((observation) =>
        observation.provenance === "DIRECT_OBSERVATION"
        && observation.predicate === "workspace.tree_hash"
      )).toBe(true);
      expect(observations[0]?.value).not.toEqual(observations[1]?.value);

      const episodeEvents = await db
        .select({
          eventType: aiAgentEpisodeEventsTable.eventType,
          episodeId: aiAgentEpisodeEventsTable.episodeId,
          executionId: aiAgentEpisodeEventsTable.executionId,
          attempt: aiAgentEpisodeEventsTable.attempt,
          actorId: aiAgentEpisodeEventsTable.actorId,
          payload: aiAgentEpisodeEventsTable.payload,
        })
        .from(aiAgentEpisodeEventsTable)
        .where(eq(aiAgentEpisodeEventsTable.executionId, outcome.executionId!));
      const eventTypes = episodeEvents.map((event) => event.eventType);
      expect(eventTypes).toContain("ACTION_REQUESTED");
      expect(eventTypes).toContain("ACTION_COMMITTED");
      expect(eventTypes).toContain("EFFECT_CLASSIFIED");
      const toolRequests = episodeEvents.filter((event) => {
        const action = (event.payload as { action?: { capabilityId?: string } } | null)?.action;
        return event.eventType === "ACTION_REQUESTED"
          && action?.capabilityId === MISSION_REPAIR_TOOL_CAPABILITY_ID;
      });
      const toolCommits = episodeEvents.filter((event) =>
        event.eventType === "ACTION_COMMITTED"
        && String(
          (event.payload as { actionId?: unknown } | null)?.actionId ?? "",
        ).startsWith("mission-repair-tool:")
      );
      expect(toolRequests).toHaveLength(1);
      expect(toolCommits).toHaveLength(1);

      const requestPayload = toolRequests[0]?.payload as
        | { action?: AgentAction }
        | null
        | undefined;
      const requestedAction = requestPayload?.action;
      expect(requestedAction).toBeDefined();
      if (!requestedAction || !toolRequests[0]) {
        throw new Error("Mission repair fixture did not retain its canonical action request.");
      }
      const requestedEvent = toolRequests[0];
      expect(requestedEvent.actorId).toBeTruthy();
      if (!requestedEvent.actorId) {
        throw new Error("Mission repair request did not retain its worker identity.");
      }
      const recoveryBinding = {
        projectId: fixture.projectId,
        episodeId: requestedEvent.episodeId,
        executionId: requestedEvent.executionId,
        attempt: requestedEvent.attempt,
        expectedAction: requestedAction,
      };
      // A replacement worker may own the same attempt after a restart. The
      // request's actorId remains provenance; the commit append rechecks lease
      // ownership for whichever worker currently owns the execution.
      expect(requestedEvent.actorId).not.toBe("task-worker:replacement-after-claim");
      await expect(assertMissionRepairToolActionRequested(recoveryBinding)).resolves.toBeUndefined();
      const conflictingAction = {
        ...requestedAction,
        scope: {
          ...(requestedAction.scope as unknown as Record<string, unknown>),
          targetPath: "src/other.ts",
        },
      } as AgentAction;
      await expect(assertMissionRepairToolActionRequested({
        ...recoveryBinding,
        expectedAction: conflictingAction,
      })).rejects.toThrow("mission_repair_tool_action_request_conflict");
      await expect(assertMissionRepairToolActionRequested({
        ...recoveryBinding,
        attempt: recoveryBinding.attempt + 1,
      })).rejects.toThrow("mission_repair_tool_action_request_missing");
    } finally {
      await fixture.cleanup();
    }
  });

  const durableToolMarkers = [
    {
      tool: "run_validation",
      args: { profile: "workspace-typecheck" },
      key: 'run_validation:{"profile":"workspace-typecheck"}',
    },
    {
      tool: "read_file",
      args: { path: "src/target.ts" },
      key: 'read_file:{"path":"src/target.ts"}',
    },
  ] as const;
  const durableToolHandoffCases = durableToolMarkers.flatMap((marker) =>
    (["started", "completed"] as const).map((markerStatus) => ({ ...marker, markerStatus })),
  );

  it.each(durableToolHandoffCases)(
    "reloads a durable $markerStatus $tool marker after worker handoff",
    async ({ markerStatus, tool, args: markerArgs, key }) => {
    const fixture = await createMissionToolLoopFixture({
      phase: "validate",
      approvalRequired: false,
      ...(tool === "run_validation" ? { targetPaths: [] } : {}),
      ...(tool === "run_validation"
        ? { prompt: "Run the server-authorized validation profile workspace-typecheck and report its status." }
        : {}),
    });
    let recoveredOutcome: Awaited<ReturnType<typeof executeTaskLifecycle>> | undefined;
    let resumedHelperResult: unknown;
    const resumedStepKinds: string[] = [];
    const resumedToolResults: Array<{
      tool: string;
      outputLength: number;
      cached: boolean;
      resultKind?: string;
      resultSummary?: string;
    }> = [];
    const resumedToolCallNames: string[] = [];
    let toolValidationRunnerCalls = 0;
    let checkpointedExecutionId: string | undefined;
    let reloadedToolCalls: Array<{
      key: string;
      tool: string;
      args: Record<string, string>;
      status: "started" | "completed";
    }> = [];

    chatWithFallback
      .mockImplementationOnce(async (...args: unknown[]) => {
        const request = args[1] as {
          telemetryContext?: { operationId?: string };
        };
        const executionId = request.telemetryContext?.operationId;
        checkpointedExecutionId = executionId;
        const onStep = args[6] as ((step: AgentStep) => Promise<void>) | undefined;
        expect(executionId).toEqual(expect.any(String));
        expect(onStep).toBeTypeOf("function");
        if (!executionId || !onStep) {
          throw new Error("Missing Mission tool-loop checkpoint callback.");
        }

        await onStep({
          kind: "tool_call",
          tool,
          args: markerArgs,
          cached: false,
        });
        if (markerStatus === "completed") {
          await onStep({
            kind: "tool_result",
            tool,
            cached: false,
            outputLength: 0,
            resultKind: "ok",
          });
        }

        const [persisted] = await db
          .select({ checkpoint: aiExecutionsTable.checkpoint })
          .from(aiExecutionsTable)
          .where(eq(aiExecutionsTable.id, executionId))
          .limit(1);
        expect(persisted).toBeDefined();
        if (!persisted) throw new Error("Started tool call checkpoint was not persisted.");
        const parsed = parseMissionToolLoopCheckpoint(persisted.checkpoint);
        expect(parsed?.completedToolCalls).toEqual([{
          key,
          tool,
          args: markerArgs,
          status: markerStatus,
        }]);

        await db.update(aiExecutionsTable)
          .set({
            status: "paused",
            workerId: null,
            leaseUntil: null,
            updatedAt: new Date(),
          })
          .where(eq(aiExecutionsTable.id, executionId));
        await db.update(tasksTable)
          .set({
            status: "verifying",
            workerId: null,
            leaseUntil: null,
            updatedAt: new Date(),
          })
          .where(eq(tasksTable.id, fixture.taskId));

        recoveredOutcome = await executeTaskLifecycle({
          taskId: fixture.taskId,
          userId: "mission-effect-test-user",
          provider: { provider: "groq", apiKey: "fixture-provider" },
          trigger: "reconciliation",
          expectedStatuses: ["verifying"],
          workspaceRevision: fixture.now.toISOString(),
        });
        throw new Error("simulated_worker_exit_after_started_tool_checkpoint");
      })
      .mockImplementationOnce(async (...args: unknown[]) => {
        const request = args[1] as {
          priorToolCalls?: typeof reloadedToolCalls;
        };
        reloadedToolCalls = request.priorToolCalls ?? [];
        const actualChatWithFallback = actualChatWithFallbackRef.fn;
        if (!actualChatWithFallback) {
          throw new Error("The real chatWithFallback helper was not captured.");
        }
        providerStrategyState.callCount = 0;
        providerStrategyState.toolCallId = `db-handoff-${tool}-${markerStatus}`;
        providerStrategyState.toolName = tool;
        providerStrategyState.toolArguments = markerArgs;
        providerStrategyState.requestedToolName = "";
        providerStrategyState.callOptionsSummary = [];
        const actualArgs = [...args];
        const requestParams = actualArgs[1] as Parameters<ChatWithFallbackFunction>[1];
        if (tool === "run_validation") {
          expect(requestParams.allowValidationTools).toBe(true);
          expect(requestParams.allowedToolNames).toContain("run_validation");
          expect(requestParams.authorizedToolManifestNames).toContain("run_validation");
          expect(requestParams.approvedValidationProfiles).toEqual(["workspace-typecheck"]);
          const serverValidationRunner = requestParams.validationRunner;
          expect(serverValidationRunner).toBeTypeOf("function");
          if (!serverValidationRunner) {
            throw new Error("The server-owned Mission validation runner was not supplied.");
          }
          const instrumentedValidationRunner: MissionValidationRunner = (...runnerArgs) => {
            toolValidationRunnerCalls += 1;
            return serverValidationRunner(...runnerArgs);
          };
          actualArgs[1] = {
            ...requestParams,
            validationRunner: instrumentedValidationRunner,
          };
        }
        const onStep = actualArgs[6] as ((step: AgentStep) => Promise<void>) | undefined;
        actualArgs[6] = async (step: AgentStep) => {
          resumedStepKinds.push(step.kind);
          if (step.kind === "tool_call") resumedToolCallNames.push(step.tool);
          if (step.kind === "tool_result") {
            resumedToolResults.push({
              tool: step.tool,
              outputLength: step.outputLength,
              cached: step.cached,
              ...(step.resultKind ? { resultKind: step.resultKind } : {}),
              ...(step.resultSummary ? { resultSummary: step.resultSummary } : {}),
            });
          }
          await onStep?.(step);
        };
        resumedHelperResult = await actualChatWithFallback(...actualArgs);
        return resumedHelperResult as Awaited<ReturnType<typeof chatWithFallback>>;
      });

    vi.stubEnv("OPENROUTER_API_KEY", "");
    vi.stubEnv("GEMINI_API_KEY", "");
    vi.stubEnv("DEEPSEEK_API_KEY", "");
    vi.stubEnv("GROQ_API_KEY", "fixture-groq-api-key");

    try {
      await executeTaskLifecycle({
        taskId: fixture.taskId,
        userId: "mission-effect-test-user",
        provider: { provider: "groq", apiKey: "fixture-provider" },
        trigger: "reconciliation",
        expectedStatuses: ["verifying"],
        workspaceRevision: fixture.now.toISOString(),
      });

      if (markerStatus === "started" && tool === "run_validation") {
        expect(recoveredOutcome).toMatchObject({
          ok: false,
          status: "failed",
          errorCode: "mission_tool_outcome_uncertain",
        });
        expect(chatWithFallback).toHaveBeenCalledTimes(1);
        expect(reloadedToolCalls).toEqual([]);
        expect(resumedHelperResult).toBeUndefined();
        expect(toolValidationRunnerCalls).toBe(0);
        if (!checkpointedExecutionId) {
          throw new Error("Mission execution identity was not checkpointed.");
        }
        const [execution] = await db
          .select({ status: aiExecutionsTable.status })
          .from(aiExecutionsTable)
          .where(eq(aiExecutionsTable.id, checkpointedExecutionId))
          .limit(1);
        expect(execution?.status).toBe("failed");
        const acceptances = await db
          .select({
            outcome: aiExecutionAcceptancesTable.outcome,
            terminalStatus: aiExecutionAcceptancesTable.terminalStatus,
            reasonCode: aiExecutionAcceptancesTable.reasonCode,
            resumable: aiExecutionAcceptancesTable.resumable,
          })
          .from(aiExecutionAcceptancesTable)
          .where(eq(aiExecutionAcceptancesTable.executionId, checkpointedExecutionId));
        expect(acceptances).toEqual([{
          outcome: "FAILED",
          terminalStatus: "failed",
          reasonCode: "MISSION_TOOL_OUTCOME_UNCERTAIN",
          resumable: 0,
        }]);
      } else {
        expect(recoveredOutcome).toMatchObject({ ok: true, status: "completed" });
        expect(chatWithFallback).toHaveBeenCalledTimes(2);
        expect(reloadedToolCalls).toContainEqual({
          key,
          tool,
          args: markerArgs,
          status: markerStatus,
        });

        expect(resumedHelperResult).toMatchObject({
          effectiveProvider: "groq",
          result: { response: expect.any(String) },
        });
        expect(providerStrategyState.callCount).toBeGreaterThan(0);
        expect(providerStrategyState.requestedToolName).toBe(tool);
        expect(resumedStepKinds).toContain("tool_call");
        expect(resumedStepKinds).toContain("tool_result");
        expect(
          resumedToolResults,
          JSON.stringify({
            observedToolCalls: resumedToolCallNames,
            providerOptions: providerStrategyState.callOptionsSummary,
          }),
        ).toEqual(expect.arrayContaining([expect.objectContaining({ tool })]));

        if (tool === "read_file") {
          expect(resumedToolResults.find((result) => result.tool === "read_file")?.outputLength)
            .toBeGreaterThan(0);
          while (pendingObservationMaterializations.length > 0) {
            const pending = pendingObservationMaterializations.splice(0);
            await Promise.all(pending);
          }
          const observations = await db
            .select({ id: aiAgentObservationsTable.id })
            .from(aiAgentObservationsTable)
            .where(eq(aiAgentObservationsTable.projectId, fixture.projectId));
          expect(observations.length).toBeGreaterThan(0);
        } else {
          expect(
            providerStrategyState.callOptionsSummary.some((call) =>
              call.toolNames.includes("run_validation")
            ),
            JSON.stringify(providerStrategyState.callOptionsSummary),
          ).toBe(true);
          expect(resumedToolResults).toContainEqual({
            tool: "run_validation",
            outputLength: 0,
            cached: true,
            resultKind: "ok",
            resultSummary: "replayed action skipped by durable marker",
          });
          expect(toolValidationRunnerCalls).toBe(0);
        }
      }
    } finally {
      vi.unstubAllEnvs();
      await fixture.cleanup();
    }
    },
  );

  it("resumes a candidate-ready Mission repair with a new validator receipt after lease handoff", async () => {
    const fixture = await createMissionToolLoopFixture({
      phase: "execute",
      approvalRequired: false,
    });
    const candidateContent = "export const value = 'recovered-candidate';\n";
    let recoveredOutcome: Awaited<ReturnType<typeof executeTaskLifecycle>> | undefined;
    let firstBeforeObservationId: string | undefined;
    let recoveryBeforeObservationId: string | undefined;
    let recoveryRun = 0;
    let diagnosticPhase = "initial_lifecycle";
    let activeExecutionId: string | undefined;
    let deadlockObserved = false;
    let lockSamplerRunning = false;
    let lockSamplerFailed = false;
    let lockSamplerPromise: Promise<void> | undefined;
    const lockWaitSamples: unknown[] = [];
    const collectPostgresErrorMetadata = (error: unknown) => {
      const metadata: Array<{
        code?: string;
        detail?: string;
        hint?: string;
        where?: string;
        routine?: string;
      }> = [];
      const seen = new Set<object>();
      let current = error;
      const boundedText = (value: unknown): string | undefined =>
        typeof value === "string" ? value.slice(0, 2_000) : undefined;
      while (
        current
        && typeof current === "object"
        && !seen.has(current)
        && metadata.length < 5
      ) {
        seen.add(current);
        const record = current as Record<string, unknown>;
        metadata.push({
          code: boundedText(record.code),
          detail: boundedText(record.detail),
          hint: boundedText(record.hint),
          where: boundedText(record.where),
          routine: boundedText(record.routine),
        });
        current = record.cause;
      }
      return metadata;
    };
    const logDeadlockMetadata = (phase: string, executionId: string | undefined, error: unknown) => {
      const deadlocks = collectPostgresErrorMetadata(error).filter((entry) => entry.code === "40P01");
      if (deadlocks.length === 0) return;
      deadlockObserved = true;
      console.error("[candidate-ready-recovery-postgres-deadlock]", JSON.stringify({
        phase,
        taskId: fixture.taskId,
        executionId: executionId ?? null,
        errors: deadlocks,
      }));
    };
    const logOutcomeDeadlock = (
      phase: string,
      executionId: string | undefined,
      outcome: unknown,
    ) => {
      if (outcome && typeof outcome === "object" && "error" in outcome) {
        logDeadlockMetadata(phase, executionId, outcome.error);
      }
    };
    const startLockWaitSampler = () => {
      lockSamplerRunning = true;
      lockSamplerPromise = (async () => {
        while (lockSamplerRunning && lockWaitSamples.length < 100) {
          try {
            const result = await db.execute(sql`
              SELECT
                waiting.pid AS waiting_pid,
                waiting.application_name AS waiting_application,
                waiting.query_start AS waiting_query_start,
                left(waiting.query, 1000) AS waiting_query,
                waiting.wait_event_type,
                waiting.wait_event,
                blocker.pid AS blocking_pid,
                blocker.application_name AS blocking_application,
                blocker.query_start AS blocking_query_start,
                left(blocker.query, 1000) AS blocking_query,
                blocker.state AS blocking_state,
                waiting.backend_xid::text AS waiting_xid,
                blocker.backend_xid::text AS blocking_xid
              FROM pg_stat_activity AS waiting
              LEFT JOIN LATERAL unnest(pg_blocking_pids(waiting.pid)) AS blocker_ids(pid) ON TRUE
              LEFT JOIN pg_stat_activity AS blocker ON blocker.pid = blocker_ids.pid
              WHERE waiting.pid <> pg_backend_pid()
                AND waiting.datname = current_database()
                AND waiting.wait_event_type = 'Lock'
                AND (
                  waiting.query ILIKE '%ai_agent_episodes%'
                  OR blocker.query ILIKE '%ai_agent_episodes%'
                )
            `);
            const rows = (result as unknown as { rows?: unknown[] }).rows ?? [];
            for (const row of rows) {
              if (lockWaitSamples.length >= 100) break;
              lockWaitSamples.push(row);
            }
          } catch {
            lockSamplerFailed = true;
          }
          await new Promise((resolve) => setTimeout(resolve, 50));
        }
      })();
    };
    const stopLockWaitSampler = async () => {
      lockSamplerRunning = false;
      await lockSamplerPromise;
      if (deadlockObserved) {
        console.error("[candidate-ready-recovery-lock-waits]", JSON.stringify({
          samples: lockWaitSamples.slice(-20),
          samplerFailed: lockSamplerFailed,
        }));
      }
    };
    chatWithFallback.mockImplementationOnce(async (...args: unknown[]) => {
      const baseParams = args[1] as {
        onMutationInvocation?: import("@workspace/ai-orchestrator").MutationToolInvocationCallback;
      };
      const invocation = {
        toolCallId: "provider-call-mission-recovery-1",
        toolName: "write_file" as const,
        path: "src/target.ts",
        inputHash: "b".repeat(64),
      };
      await baseParams.onMutationInvocation?.({ ...invocation, phase: "requested" });
      await baseParams.onMutationInvocation?.({ ...invocation, phase: "committed" });
      return {
        result: {
          response: "Prepared the approved candidate.",
          pendingChanges: [{ path: "src/target.ts", newContent: candidateContent }],
          sources: [],
        },
        effectiveProvider: "groq" as const,
      };
    });
    runRepairValidation
      .mockImplementationOnce(async (...args: unknown[]) => {
        const evidenceContext = args[5] as { operationId: string };
        activeExecutionId = evidenceContext.operationId;
        diagnosticPhase = "first_validator_checkpoint_read";
        const [execution] = await db
          .select({
            checkpoint: aiExecutionsTable.checkpoint,
          })
          .from(aiExecutionsTable)
          .where(eq(aiExecutionsTable.id, evidenceContext.operationId))
          .limit(1);
        expect(execution).toBeDefined();
        if (!execution) throw new Error("Mission repair execution missing during simulated crash.");
        const checkpoint = JSON.parse(execution.checkpoint) as { sequence: number; detail: string };
        const detail = JSON.parse(checkpoint.detail) as {
          missionRepairRecovery: { phase: string; beforeObservationId: string };
        };
        expect(detail.missionRepairRecovery.phase).toBe("candidate_ready");
        firstBeforeObservationId = detail.missionRepairRecovery.beforeObservationId;

        diagnosticPhase = "handoff_execution_update";
        await db.update(aiExecutionsTable)
          .set({
            status: "paused",
            workerId: null,
            leaseUntil: null,
            updatedAt: new Date(),
          })
          .where(eq(aiExecutionsTable.id, evidenceContext.operationId));
        diagnosticPhase = "handoff_task_update";
        await db.update(tasksTable)
          .set({
            status: "verifying",
            workerId: null,
            leaseUntil: null,
            updatedAt: new Date(),
          })
          .where(eq(tasksTable.id, fixture.taskId));
        diagnosticPhase = "nested_recovery_lifecycle";
        recoveredOutcome = await executeTaskLifecycle({
          taskId: fixture.taskId,
          userId: "mission-effect-test-user",
          provider: { provider: "groq", apiKey: "fixture-provider" },
          trigger: "reconciliation",
          expectedStatuses: ["verifying"],
          workspaceRevision: fixture.now.toISOString(),
        });
        logOutcomeDeadlock("nested_recovery_result", evidenceContext.operationId, recoveredOutcome);
        // Separate the simulated old-worker exit from the recovered run's
        // best-effort observation transaction; recovery handoff is the subject
        // of this test, not overlap between two lifecycle side effects.
        const materializationFailures = await drainPendingObservationMaterializations();
        if (materializationFailures.length > 0) {
          throw new AggregateError(
            materializationFailures,
            "Observation materialization failed after candidate-ready recovery.",
          );
        }
        diagnosticPhase = "simulated_worker_exit";
        throw new Error("simulated_worker_exit_after_candidate_ready");
      })
      .mockImplementationOnce(async (...args: unknown[]) => {
        recoveryRun += 1;
        const evidenceContext = args[5] as { operationId: string };
        activeExecutionId = evidenceContext.operationId;
        diagnosticPhase = "recovery_validator_checkpoint_read";
        const [execution] = await db
          .select({ checkpoint: aiExecutionsTable.checkpoint })
          .from(aiExecutionsTable)
          .where(eq(aiExecutionsTable.id, evidenceContext.operationId))
          .limit(1);
        if (!execution) throw new Error("Mission recovery checkpoint missing before fresh validation.");
        const checkpoint = JSON.parse(execution.checkpoint) as { detail: string };
        const detail = JSON.parse(checkpoint.detail) as {
          missionRepairRecovery: { phase: string; beforeObservationId: string };
        };
        expect(detail.missionRepairRecovery.phase).toBe("candidate_ready");
        recoveryBeforeObservationId = detail.missionRepairRecovery.beforeObservationId;
        expect(recoveryBeforeObservationId).not.toBe(firstBeforeObservationId);
        return {
          status: "passed" as const,
          evidence: {
            evidenceId: "mission-repair-validator-evidence-recovery",
            artifactRef: "mission-repair-validator-pass-recovery",
            validatorProfile: String(args[1]),
          },
        };
      });

    startLockWaitSampler();
    try {
      const initialOutcome = await executeTaskLifecycle({
        taskId: fixture.taskId,
        userId: "mission-effect-test-user",
        provider: { provider: "groq", apiKey: "fixture-provider" },
        trigger: "reconciliation",
        expectedStatuses: ["verifying"],
        workspaceRevision: fixture.now.toISOString(),
      });
      logOutcomeDeadlock("initial_execution_result", initialOutcome.executionId, initialOutcome);

      if (!recoveredOutcome) {
        throw new Error(`Candidate-ready recovery did not reach lease handoff: ${JSON.stringify(initialOutcome)}`);
      }
      expect(recoveredOutcome).toMatchObject({ ok: true, status: "completed" });
      expect(chatWithFallback).toHaveBeenCalledTimes(1);
      expect(runRepairValidation).toHaveBeenCalledTimes(2);
      expect(recoveryRun).toBe(1);
      expect(await readFile(join(fixture.rootPath, "src", "target.ts"), "utf8"))
        .toBe("export const value = 'base';\n");

      const [acceptance] = await db
        .select({
          outcome: aiExecutionAcceptancesTable.outcome,
          effectBundleId: aiExecutionAcceptancesTable.effectBundleId,
        })
        .from(aiExecutionAcceptancesTable)
        .where(eq(aiExecutionAcceptancesTable.executionId, recoveredOutcome!.executionId!))
        .limit(1);
      expect(acceptance).toMatchObject({
        outcome: "SUCCEEDED",
        effectBundleId: expect.any(String),
      });

      const aggregateActions = await db
        .select({
          eventType: aiAgentEpisodeEventsTable.eventType,
          payload: aiAgentEpisodeEventsTable.payload,
        })
        .from(aiAgentEpisodeEventsTable)
        .where(eq(aiAgentEpisodeEventsTable.executionId, recoveredOutcome!.executionId!));
      expect(aggregateActions.filter((event) =>
        event.eventType === "ACTION_REQUESTED"
        && (event.payload as { action?: { actionId?: unknown } } | null)?.action?.actionId
          === `mission-repair:${recoveredOutcome!.executionId}:0`
      )).toHaveLength(1);
      expect(aggregateActions.filter((event) =>
        event.eventType === "ACTION_COMMITTED"
        && String((event.payload as { actionId?: unknown } | null)?.actionId ?? "")
          .startsWith("mission-repair:")
      )).toHaveLength(1);
    } catch (error) {
      logDeadlockMetadata(diagnosticPhase, activeExecutionId, error);
      throw error;
    } finally {
      runRepairValidation.mockReset().mockImplementation(async (..._args: unknown[]) => ({
        status: "passed" as const,
        evidence: { artifactRef: "fixture-validation-receipt" },
      }));
      try {
        await fixture.cleanup();
      } catch (error) {
        logDeadlockMetadata("fixture_cleanup", activeExecutionId, error);
        throw error;
      } finally {
        await stopLockWaitSampler();
      }
    }
  });

  it("reconciles a committed Mission repair after lease handoff without another provider call", async () => {
    const fixture = await createMissionToolLoopFixture({
      phase: "execute",
      approvalRequired: false,
    });
    const candidateContent = "export const value = 'committed-recovery';\n";
    let recoveredOutcome: Awaited<ReturnType<typeof executeTaskLifecycle>> | undefined;
    let firstBeforeObservationId: string | undefined;
    let recoveredBeforeObservationId: string | undefined;
    let validationCalls = 0;
    chatWithFallback.mockImplementationOnce(async (...args: unknown[]) => {
      const baseParams = args[1] as {
        onMutationInvocation?: import("@workspace/ai-orchestrator").MutationToolInvocationCallback;
      };
      const invocation = {
        toolCallId: "provider-call-mission-committed-recovery",
        toolName: "write_file" as const,
        path: "src/target.ts",
        inputHash: "c".repeat(64),
      };
      await baseParams.onMutationInvocation?.({ ...invocation, phase: "requested" });
      await baseParams.onMutationInvocation?.({ ...invocation, phase: "committed" });
      return {
        result: {
          response: "Prepared the approved candidate.",
          pendingChanges: [{ path: "src/target.ts", newContent: candidateContent }],
          sources: [],
        },
        effectiveProvider: "groq" as const,
      };
    });
    runRepairValidation
      .mockImplementationOnce(async (...args: unknown[]) => {
        validationCalls += 1;
        const evidenceContext = args[5] as { operationId: string };
        const [execution] = await db
          .select({
            checkpoint: aiExecutionsTable.checkpoint,
            workerId: aiExecutionsTable.workerId,
            attempt: aiExecutionsTable.attempt,
          })
          .from(aiExecutionsTable)
          .where(eq(aiExecutionsTable.id, evidenceContext.operationId))
          .limit(1);
        expect(execution?.workerId).toEqual(expect.any(String));
        if (!execution?.workerId) throw new Error("Mission repair worker missing at simulated commit.");
        const checkpoint = JSON.parse(execution.checkpoint) as { sequence: number; detail: string };
        const detail = JSON.parse(checkpoint.detail) as {
          missionRepairRecovery: {
            phase: string;
            checkpointSequence: number;
            episodeId: string;
            actionId: string;
            projectId: string;
            attempt: number;
            candidateIdentity: string;
            baseTreeHash: string;
            candidateTreeHash: string;
            beforeObservationId: string;
          };
        };
        const candidateReady = detail.missionRepairRecovery;
        expect(candidateReady.phase).toBe("candidate_ready");
        firstBeforeObservationId = candidateReady.beforeObservationId;

        const validatedSequence = checkpoint.sequence + 1;
        const validatedManifest = {
          ...candidateReady,
          phase: "validated",
          checkpointSequence: validatedSequence,
          validatorStatus: "passed",
          validatorEvidenceId: "mission-repair-validator-before-commit",
          validatorProfile: String(args[1]),
          validatorEnvironmentRevision: null,
        };
        const validated = await checkpointAiExecution({
          executionId: evidenceContext.operationId,
          expectedAttempt: execution.attempt,
          workerId: execution.workerId,
          checkpoint: {
            stage: "tool_loop",
            sequence: validatedSequence,
            detail: JSON.stringify({ ...detail, missionRepairRecovery: validatedManifest }),
            updatedAt: new Date().toISOString(),
          },
        });
        expect(validated).toBe(true);

        await appendEpisodeEvent({
          episodeId: candidateReady.episodeId,
          projectId: candidateReady.projectId,
          executionId: evidenceContext.operationId,
          attempt: candidateReady.attempt,
          workerId: execution.workerId,
          eventType: "ACTION_COMMITTED",
          payload: {
            actionId: candidateReady.actionId,
            candidateIdentity: candidateReady.candidateIdentity,
            baseTreeHash: candidateReady.baseTreeHash,
            candidateTreeHash: candidateReady.candidateTreeHash,
            validationStatus: "passed",
            liveTreeUnchanged: true,
          },
          actorType: "worker",
          actorId: execution.workerId,
          correlationId: evidenceContext.operationId,
        });

        const committedSequence = validatedSequence + 1;
        const committed = await checkpointAiExecution({
          executionId: evidenceContext.operationId,
          expectedAttempt: execution.attempt,
          workerId: execution.workerId,
          checkpoint: {
            stage: "tool_loop",
            sequence: committedSequence,
            detail: JSON.stringify({
              ...detail,
              missionRepairRecovery: {
                ...validatedManifest,
                phase: "committed",
                checkpointSequence: committedSequence,
              },
            }),
            updatedAt: new Date().toISOString(),
          },
        });
        expect(committed).toBe(true);

        await db.update(aiExecutionsTable)
          .set({
            status: "paused",
            workerId: null,
            leaseUntil: null,
            updatedAt: new Date(),
          })
          .where(eq(aiExecutionsTable.id, evidenceContext.operationId));
        await db.update(tasksTable)
          .set({
            status: "verifying",
            workerId: null,
            leaseUntil: null,
            updatedAt: new Date(),
          })
          .where(eq(tasksTable.id, fixture.taskId));
        recoveredOutcome = await executeTaskLifecycle({
          taskId: fixture.taskId,
          userId: "mission-effect-test-user",
          provider: { provider: "groq", apiKey: "fixture-provider" },
          trigger: "reconciliation",
          expectedStatuses: ["verifying"],
          workspaceRevision: fixture.now.toISOString(),
        });
        throw new Error("simulated_worker_exit_after_committed_checkpoint");
      })
      .mockImplementationOnce(async (...args: unknown[]) => {
        validationCalls += 1;
        const evidenceContext = args[5] as { operationId: string };
        const [execution] = await db
          .select({ checkpoint: aiExecutionsTable.checkpoint })
          .from(aiExecutionsTable)
          .where(eq(aiExecutionsTable.id, evidenceContext.operationId))
          .limit(1);
        if (!execution) throw new Error("Committed Mission recovery checkpoint missing.");
        const checkpoint = JSON.parse(execution.checkpoint) as { detail: string };
        const detail = JSON.parse(checkpoint.detail) as {
          missionRepairRecovery: { phase: string; beforeObservationId: string };
        };
        expect(detail.missionRepairRecovery.phase).toBe("committed");
        recoveredBeforeObservationId = detail.missionRepairRecovery.beforeObservationId;
        expect(recoveredBeforeObservationId).not.toBe(firstBeforeObservationId);
        return {
          status: "passed" as const,
          evidence: {
            evidenceId: "mission-repair-validator-after-commit-recovery",
            artifactRef: "mission-repair-validator-pass-after-commit-recovery",
            validatorProfile: String(args[1]),
          },
        };
      });

    try {
      const initialOutcome = await executeTaskLifecycle({
        taskId: fixture.taskId,
        userId: "mission-effect-test-user",
        provider: { provider: "groq", apiKey: "fixture-provider" },
        trigger: "reconciliation",
        expectedStatuses: ["verifying"],
        workspaceRevision: fixture.now.toISOString(),
      });

      if (!recoveredOutcome) {
        throw new Error(`Committed recovery did not reach lease handoff: ${JSON.stringify(initialOutcome)}`);
      }
      expect(recoveredOutcome).toMatchObject({ ok: true, status: "completed" });
      expect(validationCalls).toBe(2);
      expect(chatWithFallback).toHaveBeenCalledTimes(1);
      expect(await readFile(join(fixture.rootPath, "src", "target.ts"), "utf8"))
        .toBe("export const value = 'base';\n");

      const [acceptance] = await db
        .select({
          outcome: aiExecutionAcceptancesTable.outcome,
          effectBundleId: aiExecutionAcceptancesTable.effectBundleId,
        })
        .from(aiExecutionAcceptancesTable)
        .where(eq(aiExecutionAcceptancesTable.executionId, recoveredOutcome!.executionId!))
        .limit(1);
      expect(acceptance).toMatchObject({
        outcome: "SUCCEEDED",
        effectBundleId: expect.any(String),
      });

      const aggregateCommits = await db
        .select({
          eventType: aiAgentEpisodeEventsTable.eventType,
          payload: aiAgentEpisodeEventsTable.payload,
        })
        .from(aiAgentEpisodeEventsTable)
        .where(eq(aiAgentEpisodeEventsTable.executionId, recoveredOutcome!.executionId!))
        .then((events) => events.filter((event) =>
          event.eventType === "ACTION_COMMITTED"
          && (event.payload as { actionId?: unknown } | null)?.actionId
            === `mission-repair:${recoveredOutcome!.executionId}:0`
        ));
      expect(aggregateCommits).toHaveLength(1);
    } finally {
      runRepairValidation.mockReset().mockImplementation(async (..._args: unknown[]) => ({
        status: "passed" as const,
        evidence: { artifactRef: "fixture-validation-receipt" },
      }));
      await fixture.cleanup();
    }
  });

  it("reuses effect-classified Mission evidence after lease handoff", async () => {
    const fixture = await createMissionToolLoopFixture({
      phase: "execute",
      approvalRequired: false,
    });
    const candidateContent = "export const value = 'effect-classified-recovery';\n";
    let recoveredOutcome: Awaited<ReturnType<typeof executeTaskLifecycle>> | undefined;
    let originalBeforeObservationId: string | undefined;
    let originalAfterObservationId: string | undefined;
    let originalEffectBundleId: string | undefined;
    let validationCalls = 0;
    chatWithFallback.mockImplementationOnce(async (...args: unknown[]) => {
      const baseParams = args[1] as {
        onMutationInvocation?: import("@workspace/ai-orchestrator").MutationToolInvocationCallback;
      };
      const invocation = {
        toolCallId: "provider-call-mission-effect-classified-recovery",
        toolName: "write_file" as const,
        path: "src/target.ts",
        inputHash: "d".repeat(64),
      };
      await baseParams.onMutationInvocation?.({ ...invocation, phase: "requested" });
      await baseParams.onMutationInvocation?.({ ...invocation, phase: "committed" });
      return {
        result: {
          response: "Prepared the approved candidate.",
          pendingChanges: [{ path: "src/target.ts", newContent: candidateContent }],
          sources: [],
        },
        effectiveProvider: "groq" as const,
      };
    });
    runRepairValidation
      .mockImplementationOnce(async (...args: unknown[]) => {
        validationCalls += 1;
        const evidenceContext = args[5] as { operationId: string };
        const [execution] = await db
          .select({
            checkpoint: aiExecutionsTable.checkpoint,
            workerId: aiExecutionsTable.workerId,
            attempt: aiExecutionsTable.attempt,
          })
          .from(aiExecutionsTable)
          .where(eq(aiExecutionsTable.id, evidenceContext.operationId))
          .limit(1);
        if (!execution?.workerId) throw new Error("Mission repair worker missing at simulated effect classification.");
        const checkpoint = JSON.parse(execution.checkpoint) as { sequence: number; detail: string };
        const detail = JSON.parse(checkpoint.detail) as Record<string, unknown>;
        const candidateReady = detail.missionRepairRecovery as {
          phase: string;
          episodeId: string;
          actionId: string;
          projectId: string;
          attempt: number;
          taskId: string;
          sourceRevision: string;
          candidateIdentity: string;
          baseTreeHash: string;
          candidateTreeHash: string;
          beforeObservationId: string;
        };
        expect(candidateReady.phase).toBe("candidate_ready");
        originalBeforeObservationId = candidateReady.beforeObservationId;

        let sequence = checkpoint.sequence;
        let recoveryManifest: Record<string, unknown> = { ...candidateReady };
        const persistManifest = async (patch: Record<string, unknown>) => {
          sequence += 1;
          recoveryManifest = {
            ...recoveryManifest,
            ...patch,
            checkpointSequence: sequence,
          };
          const persisted = await checkpointAiExecution({
            executionId: evidenceContext.operationId,
            expectedAttempt: execution.attempt,
            workerId: execution.workerId!,
            checkpoint: {
              stage: "tool_loop",
              sequence,
              detail: JSON.stringify({ ...detail, missionRepairRecovery: recoveryManifest }),
              updatedAt: new Date().toISOString(),
            },
          });
          expect(persisted).toBe(true);
        };

        await persistManifest({
          phase: "validated",
          validatorStatus: "passed",
          validatorEvidenceId: "mission-repair-validator-before-effect-classification",
          validatorProfile: String(args[1]),
          validatorEnvironmentRevision: null,
        });
        await appendEpisodeEvent({
          episodeId: candidateReady.episodeId,
          projectId: candidateReady.projectId,
          executionId: evidenceContext.operationId,
          attempt: candidateReady.attempt,
          workerId: execution.workerId,
          eventType: "ACTION_COMMITTED",
          payload: {
            actionId: candidateReady.actionId,
            candidateIdentity: candidateReady.candidateIdentity,
            baseTreeHash: candidateReady.baseTreeHash,
            candidateTreeHash: candidateReady.candidateTreeHash,
            validationStatus: "passed",
            liveTreeUnchanged: true,
          },
          actorType: "worker",
          actorId: execution.workerId,
          correlationId: evidenceContext.operationId,
        });
        await persistManifest({ phase: "committed" });

        const episodeEvents = await db
          .select({
            eventType: aiAgentEpisodeEventsTable.eventType,
            payload: aiAgentEpisodeEventsTable.payload,
          })
          .from(aiAgentEpisodeEventsTable)
          .where(eq(aiAgentEpisodeEventsTable.episodeId, candidateReady.episodeId));
        const requestedActionEvent = episodeEvents.find((event) =>
          event.eventType === "ACTION_REQUESTED"
          && (event.payload as { action?: { actionId?: unknown } } | null)?.action?.actionId
            === candidateReady.actionId
        );
        const action = (requestedActionEvent?.payload as { action?: AgentAction } | null)?.action;
        if (!action) throw new Error("Mission repair action request missing in test fixture.");

        const candidateWorkspace = await createValidationWorkspace(
          fixture.rootPath,
          [{ path: "src/target.ts", newContent: candidateContent }],
        );
        try {
          const after = await materializeServerOwnedObservations({
            projectId: fixture.projectId,
            executionId: evidenceContext.operationId,
            attempt: execution.attempt,
            episodeId: candidateReady.episodeId,
            environmentRootPath: candidateWorkspace.rootPath,
            projectRevision: candidateReady.sourceRevision,
            materializeWorldState: false,
            sources: [{
              kind: "direct_observation",
              sourceId: `mission-repair:${evidenceContext.operationId}:${execution.attempt}:after:recovery-fixture`,
              subject: `project:${fixture.projectId}:task:${candidateReady.taskId}:candidate:${candidateReady.candidateIdentity}`,
              predicate: "workspace.tree_hash",
              value: candidateReady.candidateTreeHash,
              sourceRevision: candidateReady.sourceRevision,
              observedAt: new Date(),
            }],
          });
          originalAfterObservationId = after.observationIds[0];
          if (!originalAfterObservationId || after.stale > 0) {
            throw new Error("Mission repair recovery after-observation fixture was unavailable.");
          }
          await persistManifest({ afterObservationId: originalAfterObservationId });

          const verification = await verifyAndPersistEffect({
            projectId: fixture.projectId,
            executionId: evidenceContext.operationId,
            attempt: execution.attempt,
            workerId: execution.workerId!,
            episodeId: candidateReady.episodeId,
            action,
            effectContract: buildMissionRepairEffectContract({
              projectId: fixture.projectId,
              taskId: candidateReady.taskId,
              candidateIdentity: candidateReady.candidateIdentity,
              candidateTreeHash: candidateReady.candidateTreeHash,
              beforeEvidenceRef: candidateReady.beforeObservationId,
              afterEvidenceRef: originalAfterObservationId,
            }),
            beforeObservationIds: [candidateReady.beforeObservationId],
            afterObservationIds: [originalAfterObservationId],
          });
          expect(verification.status).toBe("observed");
          originalEffectBundleId = verification.effectBundleId;
          await persistManifest({
            phase: "effect_classified",
            effectBundleId: originalEffectBundleId,
            effectObserved: true,
          });
        } finally {
          await candidateWorkspace.cleanup();
        }

        await db.update(aiExecutionsTable)
          .set({
            status: "paused",
            workerId: null,
            leaseUntil: null,
            updatedAt: new Date(),
          })
          .where(eq(aiExecutionsTable.id, evidenceContext.operationId));
        await db.update(tasksTable)
          .set({
            status: "verifying",
            workerId: null,
            leaseUntil: null,
            updatedAt: new Date(),
          })
          .where(eq(tasksTable.id, fixture.taskId));
        recoveredOutcome = await executeTaskLifecycle({
          taskId: fixture.taskId,
          userId: "mission-effect-test-user",
          provider: { provider: "groq", apiKey: "fixture-provider" },
          trigger: "reconciliation",
          expectedStatuses: ["verifying"],
          workspaceRevision: fixture.now.toISOString(),
        });
        throw new Error("simulated_worker_exit_after_effect_classification");
      })
      .mockImplementationOnce(async (...args: unknown[]) => {
        validationCalls += 1;
        const evidenceContext = args[5] as { operationId: string };
        const [execution] = await db
          .select({ checkpoint: aiExecutionsTable.checkpoint })
          .from(aiExecutionsTable)
          .where(eq(aiExecutionsTable.id, evidenceContext.operationId))
          .limit(1);
        if (!execution) throw new Error("Effect-classified Mission recovery checkpoint missing.");
        const checkpoint = JSON.parse(execution.checkpoint) as { detail: string };
        const detail = JSON.parse(checkpoint.detail) as {
          missionRepairRecovery: {
            phase: string;
            beforeObservationId: string;
            afterObservationId: string;
            effectBundleId: string;
            effectObserved: boolean;
          };
        };
        expect(detail.missionRepairRecovery).toMatchObject({
          phase: "effect_classified",
          beforeObservationId: originalBeforeObservationId,
          afterObservationId: originalAfterObservationId,
          effectBundleId: originalEffectBundleId,
          effectObserved: true,
        });
        return {
          status: "passed" as const,
          evidence: {
            evidenceId: "mission-repair-validator-after-effect-classification",
            artifactRef: "mission-repair-validator-pass-after-effect-classification",
            validatorProfile: String(args[1]),
          },
        };
      });

    try {
      const initialOutcome = await executeTaskLifecycle({
        taskId: fixture.taskId,
        userId: "mission-effect-test-user",
        provider: { provider: "groq", apiKey: "fixture-provider" },
        trigger: "reconciliation",
        expectedStatuses: ["verifying"],
        workspaceRevision: fixture.now.toISOString(),
      });

      if (!recoveredOutcome) {
        throw new Error(`Effect-classified recovery did not reach lease handoff: ${JSON.stringify(initialOutcome)}`);
      }
      expect(recoveredOutcome).toMatchObject({ ok: true, status: "completed" });
      expect(validationCalls).toBe(2);
      expect(chatWithFallback).toHaveBeenCalledTimes(1);
      expect(await readFile(join(fixture.rootPath, "src", "target.ts"), "utf8"))
        .toBe("export const value = 'base';\n");
      const effects = await db
        .select({
          status: aiAgentEffectsTable.status,
          beforeObservationIds: aiAgentEffectsTable.beforeObservationIds,
          afterObservationIds: aiAgentEffectsTable.afterObservationIds,
        })
        .from(aiAgentEffectsTable)
        .where(eq(aiAgentEffectsTable.executionId, recoveredOutcome!.executionId!));
      expect(effects).toHaveLength(1);
      expect(effects[0]).toMatchObject({
        status: "observed",
        beforeObservationIds: [originalBeforeObservationId],
        afterObservationIds: [originalAfterObservationId],
      });
      const [acceptance] = await db
        .select({
          outcome: aiExecutionAcceptancesTable.outcome,
          effectBundleId: aiExecutionAcceptancesTable.effectBundleId,
        })
        .from(aiExecutionAcceptancesTable)
        .where(eq(aiExecutionAcceptancesTable.executionId, recoveredOutcome!.executionId!))
        .limit(1);
      expect(acceptance).toMatchObject({
        outcome: "SUCCEEDED",
        effectBundleId: originalEffectBundleId,
      });
    } finally {
      runRepairValidation.mockReset().mockImplementation(async (..._args: unknown[]) => ({
        status: "passed" as const,
        evidence: { artifactRef: "fixture-validation-receipt" },
      }));
      await fixture.cleanup();
    }
  });

  it("keeps Mission validation read-only and outside the effect gate", async () => {
    const fixture = await createMissionToolLoopFixture({
      phase: "validate",
      approvalRequired: false,
    });
    await db.update(tasksTable)
      .set({ updatedAt: new Date(fixture.now.getTime() - 60_000) })
      .where(eq(tasksTable.id, fixture.taskId));
    const liveContent = "export const value = 'base';\n";
    chatWithFallback.mockResolvedValue({
      result: {
        response: "Validated the current workspace.",
        // A provider-shaped patch must not turn a validation task into a repair.
        pendingChanges: [{ path: "src/target.ts", newContent: "export const value = 'injected';\n" }],
        sources: [],
      },
      effectiveProvider: "groq",
    });
    chatWithFallback.mockImplementationOnce(async (...args: unknown[]) => {
      const baseParams = args[1] as {
        onReadOnlyInvocation?: import("@workspace/ai-orchestrator").ReadOnlyToolInvocationCallback;
        allowedToolNames?: readonly string[];
        authorizedToolManifestNames?: readonly string[];
        missionReadPathScope?: readonly string[];
      };
      expect(baseParams.allowedToolNames).toEqual(
        expect.arrayContaining([
          "read_file",
          "read_file_range",
          "project.list_tree",
          "git_status",
          "git_diff",
          "git_log",
          "run_validation",
        ]),
      );
      expect(baseParams.allowedToolNames).not.toEqual(
        expect.arrayContaining(["list_directory", "search_code"]),
      );
      expect(baseParams.authorizedToolManifestNames).toEqual(baseParams.allowedToolNames);
      expect(baseParams.missionReadPathScope).toEqual(["src/target.ts"]);
      const invocation = {
        toolCallId: "provider-read-mission-1",
        toolName: "git_diff" as const,
        inputHash: "c".repeat(64),
        manifestHash: "d".repeat(64),
      };
      await baseParams.onReadOnlyInvocation?.({ ...invocation, phase: "requested" });
      await baseParams.onReadOnlyInvocation?.({
        ...invocation,
        phase: "recorded",
        status: "completed",
        outputHash: "e".repeat(64),
      });
      const treeInvocation = {
        toolCallId: "provider-tree-mission-1",
        toolName: "project.list_tree" as const,
        inputHash: "f".repeat(64),
        manifestHash: "d".repeat(64),
      };
      await baseParams.onReadOnlyInvocation?.({ ...treeInvocation, phase: "requested" });
      await baseParams.onReadOnlyInvocation?.({
        ...treeInvocation,
        phase: "recorded",
        status: "completed",
        outputHash: "a".repeat(64),
      });
      return {
        result: {
          response: "Validated the current workspace.",
          pendingChanges: [{ path: "src/target.ts", newContent: "export const value = 'injected';\n" }],
          sources: [],
        },
        effectiveProvider: "groq" as const,
      };
    });
    runRepairValidation.mockResolvedValue({
      status: "passed",
      evidence: { artifactRef: "mission-validate-only-receipt" },
    });

    try {
      const outcome = await executeTaskLifecycle({
        taskId: fixture.taskId,
        userId: "mission-effect-test-user",
        provider: { provider: "groq", apiKey: "fixture-provider" },
        trigger: "reconciliation",
        expectedStatuses: ["verifying"],
      });

      expect(outcome.ok).toBe(true);
      expect(outcome.status).toBe("completed");
      expect(await readFile(join(fixture.rootPath, "src", "target.ts"), "utf8")).toBe(liveContent);
      expect(runRepairValidation).toHaveBeenCalledTimes(1);
      expect(runRepairValidation.mock.calls[0]?.[4]).toEqual([]);
      expect(await db.select().from(aiAgentEffectBundlesTable)
        .where(eq(aiAgentEffectBundlesTable.projectId, fixture.projectId))).toEqual([]);
      expect(await db.select().from(aiAgentEffectsTable)
        .where(eq(aiAgentEffectsTable.projectId, fixture.projectId))).toEqual([]);
      const events = await db
        .select({
          episodeId: aiAgentEpisodeEventsTable.episodeId,
          executionId: aiAgentEpisodeEventsTable.executionId,
          attempt: aiAgentEpisodeEventsTable.attempt,
          eventType: aiAgentEpisodeEventsTable.eventType,
          payload: aiAgentEpisodeEventsTable.payload,
        })
        .from(aiAgentEpisodeEventsTable)
        .where(eq(aiAgentEpisodeEventsTable.projectId, fixture.projectId));
      expect(events
        .filter((event) => /^(ACTION|EFFECT|PROOF|ACCEPTANCE)/.test(event.eventType)))
        .toHaveLength(0);
      expect(events.map((event) => event.eventType)).toEqual(
        expect.arrayContaining(["OBSERVATION_REQUESTED", "OBSERVATION_RECORDED"]),
      );
      const observationRequest = events.find((event) =>
        event.eventType === "OBSERVATION_REQUESTED"
        && (event.payload as { toolCallId?: unknown } | undefined)?.toolCallId === "provider-read-mission-1"
      );
      const gitScopeHash = (observationRequest?.payload as { scopeHash?: string } | undefined)?.scopeHash;
      const observationId = (observationRequest?.payload as { observationId?: string } | undefined)?.observationId;
      expect(observationRequest?.payload).toMatchObject({
        observationId: expect.any(String),
        toolCallId: "provider-read-mission-1",
        toolName: "git_diff",
        inputHash: "c".repeat(64),
        manifestHash: "d".repeat(64),
        scopeHash: expect.stringMatching(/^[a-f0-9]{64}$/),
        scopePolicyVersion: "mission-read-scope-v1",
        projectRevision: fixture.now.toISOString(),
        authorization: "server_owned",
      });
      const observationRecorded = events.find((event) =>
        event.eventType === "OBSERVATION_RECORDED"
        && (event.payload as { observationId?: unknown } | undefined)?.observationId === observationId
      );
      expect(observationRecorded?.payload).toMatchObject({
        observationId: (observationRequest?.payload as { observationId: string }).observationId,
        scopeHash: gitScopeHash,
        scopePolicyVersion: "mission-read-scope-v1",
        status: "completed",
        outputHash: "e".repeat(64),
        projectRevision: fixture.now.toISOString(),
      });
      expect(observationRequest?.episodeId).toEqual(expect.any(String));
      expect(observationRecorded?.episodeId).toBe(observationRequest?.episodeId);
      expect(observationRequest?.executionId).toEqual(expect.any(String));
      expect(observationRecorded?.executionId).toBe(observationRequest?.executionId);
      expect(observationRequest?.attempt).toEqual(expect.any(Number));
      expect(observationRecorded?.attempt).toBe(observationRequest?.attempt);
      expect(JSON.stringify(observationRequest?.payload)).not.toContain("src/target.ts");
      expect(JSON.stringify(observationRecorded?.payload)).not.toContain("Validated the current workspace.");
      const treeRequest = events.find((event) =>
        event.eventType === "OBSERVATION_REQUESTED"
        && (event.payload as { toolName?: string }).toolName === "project.list_tree",
      );
      const treeRecorded = events.find((event) =>
        event.eventType === "OBSERVATION_RECORDED"
        && (event.payload as { toolName?: string }).toolName === "project.list_tree",
      );
      const treeScopeHash = (treeRequest?.payload as { scopeHash?: string } | undefined)?.scopeHash;
      expect(treeRequest?.payload).toMatchObject({
        toolCallId: "provider-tree-mission-1",
        scopeHash: expect.stringMatching(/^[a-f0-9]{64}$/),
        scopePolicyVersion: "mission-read-scope-v1",
        projectRevision: fixture.now.toISOString(),
        authorization: "server_owned",
      });
      expect(treeRecorded?.payload).toMatchObject({
        observationId: (treeRequest?.payload as { observationId: string }).observationId,
        scopeHash: treeScopeHash,
        scopePolicyVersion: "mission-read-scope-v1",
        status: "completed",
        outputHash: "a".repeat(64),
        projectRevision: fixture.now.toISOString(),
      });
      expect(treeScopeHash).not.toBe(gitScopeHash);
      const baseParams = chatWithFallback.mock.calls.at(-1)?.[1] as {
        onMutationInvocation?: unknown;
      } | undefined;
      expect(baseParams?.onMutationInvocation).toBeUndefined();
    } finally {
      await fixture.cleanup();
    }
  });

  it("records a failed Mission observation when the project revision changes mid-read", async () => {
    const fixture = await createMissionToolLoopFixture({
      phase: "validate",
      approvalRequired: false,
    });
    chatWithFallback.mockImplementationOnce(async (...args: unknown[]) => {
      const baseParams = args[1] as {
        onReadOnlyInvocation?: import("@workspace/ai-orchestrator").ReadOnlyToolInvocationCallback;
      };
      const invocation = {
        toolCallId: "provider-tree-revision-drift",
        toolName: "project.list_tree" as const,
        inputHash: "1".repeat(64),
        manifestHash: "2".repeat(64),
      };
      await baseParams.onReadOnlyInvocation?.({ ...invocation, phase: "requested" });
      await db.update(projectsTable)
        .set({ updatedAt: new Date(fixture.now.getTime() + 1_000) })
        .where(eq(projectsTable.id, fixture.projectId));
      await expect(
        baseParams.onReadOnlyInvocation?.({
          ...invocation,
          phase: "recorded",
          status: "completed",
          outputHash: "3".repeat(64),
        }),
      ).rejects.toThrow("mission_project_revision_changed_after_read");
      return {
        result: {
          response: "The project changed during the read; no tree result was delivered.",
          pendingChanges: [],
          sources: [],
        },
        effectiveProvider: "groq" as const,
      };
    });

    try {
      await executeTaskLifecycle({
        taskId: fixture.taskId,
        userId: "mission-revision-drift-test-user",
        provider: { provider: "groq", apiKey: "fixture-provider" },
        trigger: "reconciliation",
        expectedStatuses: ["verifying"],
      });
      const events = await db
        .select({
          eventType: aiAgentEpisodeEventsTable.eventType,
          payload: aiAgentEpisodeEventsTable.payload,
        })
        .from(aiAgentEpisodeEventsTable)
        .where(eq(aiAgentEpisodeEventsTable.projectId, fixture.projectId));
      const request = events.find((event) =>
        event.eventType === "OBSERVATION_REQUESTED"
        && (event.payload as { toolCallId?: string }).toolCallId === "provider-tree-revision-drift",
      );
      const recorded = events.find((event) =>
        event.eventType === "OBSERVATION_RECORDED"
        && (event.payload as { toolCallId?: string }).toolCallId === "provider-tree-revision-drift",
      );

      expect(request?.payload).toMatchObject({
        projectRevision: fixture.now.toISOString(),
        authorization: "server_owned",
      });
      expect(recorded?.payload).toMatchObject({
        status: "failed",
        diagnosticCode: "PROJECT_REVISION_CHANGED",
        projectRevision: fixture.now.toISOString(),
      });
      expect(recorded?.payload).not.toHaveProperty("outputHash");
    } finally {
      await fixture.cleanup();
    }
  });

  it("rejects a Mission repair candidate when plan approval is still pending", async () => {
    const fixture = await createMissionToolLoopFixture({
      phase: "execute",
      approvalRequired: true,
    });
    chatWithFallback.mockResolvedValue({
      result: {
        response: "A candidate was returned.",
        pendingChanges: [{ path: "src/target.ts", newContent: "export const value = 'unapproved';\n" }],
        sources: [],
      },
      effectiveProvider: "groq",
    });
    runRepairValidation.mockResolvedValue({
      status: "passed",
      evidence: { artifactRef: "must-not-run" },
    });

    try {
      const outcome = await executeTaskLifecycle({
        taskId: fixture.taskId,
        userId: "mission-effect-test-user",
        provider: { provider: "groq", apiKey: "fixture-provider" },
        trigger: "reconciliation",
        expectedStatuses: ["verifying"],
        workspaceRevision: fixture.now.toISOString(),
      });
      await waitForEpisode(outcome.executionId!);

      expect(outcome.ok).toBe(true);
      expect(outcome.status).toBe("verifying");
      expect(await readFile(join(fixture.rootPath, "src", "target.ts"), "utf8"))
        .toBe("export const value = 'base';\n");
      expect(runRepairValidation).not.toHaveBeenCalled();
      expect(await db.select().from(aiAgentEffectBundlesTable)
        .where(eq(aiAgentEffectBundlesTable.projectId, fixture.projectId))).toEqual([]);
      expect(await db.select().from(aiAgentEffectsTable)
        .where(eq(aiAgentEffectsTable.projectId, fixture.projectId))).toEqual([]);
      const events = await db
        .select({ eventType: aiAgentEpisodeEventsTable.eventType })
        .from(aiAgentEpisodeEventsTable)
        .where(eq(aiAgentEpisodeEventsTable.projectId, fixture.projectId));
      expect(events.map((event) => event.eventType)).not.toContain("ACTION_REQUESTED");
      const [acceptance] = await db
        .select({
          outcome: aiExecutionAcceptancesTable.outcome,
          effectBundleId: aiExecutionAcceptancesTable.effectBundleId,
        })
        .from(aiExecutionAcceptancesTable)
        .where(eq(aiExecutionAcceptancesTable.projectId, fixture.projectId))
        .limit(1);
      expect(acceptance).toMatchObject({
        outcome: "FAILED",
        effectBundleId: null,
      });
    } finally {
      await fixture.cleanup();
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
      await cleanupProjectExecutionData(projectId);
      await db.delete(tasksTable).where(eq(tasksTable.id, taskId));
      await db.delete(aiGoalsTable).where(eq(aiGoalsTable.id, goalId));
      await db.delete(aiMissionsTable).where(eq(aiMissionsTable.id, missionId));
      await db.delete(projectsTable).where(eq(projectsTable.id, projectId));
    }
  });
});