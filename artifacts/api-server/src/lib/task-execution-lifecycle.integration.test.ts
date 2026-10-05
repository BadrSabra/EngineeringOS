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
  aiGoalDependenciesTable,
  aiChatMessagesTable,
  aiChatSessionsTable,
  aiExecutionsTable,
  aiGoalsTable,
  aiMissionsTable,
  aiUsageEventsTable,
  db,
  eventsTable,
  operatorAlertsTable,
  projectsTable,
  taskLogsTable,
  tasksTable,
  workflowExecutionsTable,
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
const taskProgressFixture = vi.hoisted(() => ({
  failTerminalOutcome: null as "SUCCEEDED" | "FAILED" | "INTERRUPTED" | null,
  terminalOutcomes: [] as Array<"SUCCEEDED" | "FAILED" | "INTERRUPTED">,
}));

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
    terminal: vi.fn(async (outcome: "SUCCEEDED" | "FAILED" | "INTERRUPTED") => {
      taskProgressFixture.terminalOutcomes.push(outcome);
      if (taskProgressFixture.failTerminalOutcome === outcome) {
        taskProgressFixture.failTerminalOutcome = null;
        throw new Error("fixture_terminal_progress_write_failed");
      }
    }),
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
import { executeWorkflowPhase } from "./workflow-phase-execution.js";
import {
  AI_EXECUTION_LEASE_MS,
  checkpointAiExecution,
  requestAiExecutionCancel,
} from "./ai-execution-state.js";
import * as aiExecutionState from "./ai-execution-state.js";
import { reconcileStuckJobs } from "./job-reconciliation.js";
import { startStructuredExecution } from "./structured-task-execution.js";
import { appendEpisodeEvent } from "./agent-state/agent-episode-ledger.js";
import { createValidationWorkspace } from "./ai-repair-validation.js";
import { getPublicTaskExecutionAcceptance } from "./ai-execution-acceptance.js";

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
    taskProgressFixture.failTerminalOutcome = null;
    taskProgressFixture.terminalOutcomes = [];
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

  it("rolls back task success projections when finalization fails after acceptance insert", async () => {
    const projectId = randomUUID();
    const taskId = randomUUID();
    const userId = "lifecycle-test-user";
    const now = new Date();

    await db.insert(projectsTable).values({
      id: projectId,
      ownerId: userId,
      name: `lifecycle-w8-rollback-${projectId.slice(0, 8)}`,
      rootPath: `/tmp/lifecycle-${projectId}`,
      language: "typescript",
      status: "active",
      createdAt: now,
      updatedAt: now,
    });
    await db.insert(tasksTable).values({
      id: taskId,
      projectId,
      title: "W8 finalization rollback fixture",
      prompt: "Return the deterministic fixture result",
      status: "verifying",
      retryCount: 0,
      maxRetries: 2,
      createdAt: now,
      updatedAt: now,
    });

    try {
      await db.execute(sql`
        CREATE OR REPLACE FUNCTION fixture_fail_success_task_completion_log()
        RETURNS trigger LANGUAGE plpgsql AS $$
        BEGIN
          IF NEW.message LIKE 'AI task completed:%' THEN
            RAISE EXCEPTION 'fixture_success_task_log_failure';
          END IF;
          RETURN NEW;
        END;
        $$
      `);
      await db.execute(sql`
        CREATE TRIGGER fixture_fail_success_task_completion_log
        BEFORE INSERT ON task_logs
        FOR EACH ROW EXECUTE FUNCTION fixture_fail_success_task_completion_log()
      `);

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
        errorCode: "execution_finalize_failed",
      });
      expect(outcome.executionId).toEqual(expect.any(String));
      expect(taskProgressFixture.terminalOutcomes).toEqual(["FAILED"]);

      const [task] = await db
        .select({
          status: tasksTable.status,
          workerId: tasksTable.workerId,
          completedAt: tasksTable.completedAt,
          verificationResult: tasksTable.verificationResult,
        })
        .from(tasksTable)
        .where(eq(tasksTable.id, taskId));
      expect(task).toMatchObject({
        status: "verifying",
        workerId: null,
        completedAt: null,
        verificationResult: { passed: false, decision: "failed" },
      });

      const [execution] = await db
        .select({
          status: aiExecutionsTable.status,
          recipeReceipt: aiExecutionsTable.recipeReceipt,
        })
        .from(aiExecutionsTable)
        .where(eq(aiExecutionsTable.id, outcome.executionId!));
      expect(execution).toMatchObject({
        status: "failed",
        recipeReceipt: {
          terminalStatus: "FAILED",
          terminalReason: "execution_finalize_failed",
        },
      });

      const acceptances = await db
        .select({
          outcome: aiExecutionAcceptancesTable.outcome,
          terminalStatus: aiExecutionAcceptancesTable.terminalStatus,
          reasonCode: aiExecutionAcceptancesTable.reasonCode,
        })
        .from(aiExecutionAcceptancesTable)
        .where(eq(aiExecutionAcceptancesTable.executionId, outcome.executionId!));
      expect(acceptances).toEqual([{
        outcome: "FAILED",
        terminalStatus: "failed",
        reasonCode: "EXECUTION_FINALIZATION_FAILED",
      }]);

      const taskLogs = await db
        .select({ message: taskLogsTable.message })
        .from(taskLogsTable)
        .where(eq(taskLogsTable.taskId, taskId));
      expect(taskLogs.some(({ message }) => message.startsWith("AI task completed:"))).toBe(false);

      const completionEvents = await db
        .select({ type: eventsTable.type })
        .from(eventsTable)
        .where(and(
          eq(eventsTable.projectId, projectId),
          eq(eventsTable.taskId, taskId),
        ));
      expect(completionEvents.some(({ type }) => type === "TaskCompleted")).toBe(false);
    } finally {
      await db.execute(sql`DROP TRIGGER IF EXISTS fixture_fail_success_task_completion_log ON task_logs`);
      await db.execute(sql`DROP FUNCTION IF EXISTS fixture_fail_success_task_completion_log()`);
      await cleanupProjectExecutionData(projectId);
      await db.delete(tasksTable).where(eq(tasksTable.id, taskId));
      await db.delete(projectsTable).where(eq(projectsTable.id, projectId));
    }
  });

  it("keeps accepted task success authoritative when terminal progress delivery fails", async () => {
    const projectId = randomUUID();
    const taskId = randomUUID();
    const userId = "lifecycle-test-user";
    const now = new Date();

    await db.insert(projectsTable).values({
      id: projectId,
      ownerId: userId,
      name: `lifecycle-post-acceptance-${projectId.slice(0, 8)}`,
      rootPath: `/tmp/lifecycle-${projectId}`,
      language: "typescript",
      status: "active",
      createdAt: now,
      updatedAt: now,
    });
    await db.insert(tasksTable).values({
      id: taskId,
      projectId,
      title: "Post-acceptance response-loss fixture",
      prompt: "Return the deterministic fixture result",
      status: "verifying",
      retryCount: 0,
      maxRetries: 2,
      createdAt: now,
      updatedAt: now,
    });
    taskProgressFixture.failTerminalOutcome = "SUCCEEDED";

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
        ok: true,
        status: "completed",
        executionId: expect.any(String),
      });
      expect(runAgentWithFallback).toHaveBeenCalledTimes(1);
      expect(taskProgressFixture.terminalOutcomes).toEqual(["SUCCEEDED"]);

      const [task] = await db
        .select({ status: tasksTable.status, workerId: tasksTable.workerId })
        .from(tasksTable)
        .where(eq(tasksTable.id, taskId));
      expect(task).toEqual({ status: "completed", workerId: null });

      const [execution] = await db
        .select({ status: aiExecutionsTable.status, workerId: aiExecutionsTable.workerId })
        .from(aiExecutionsTable)
        .where(eq(aiExecutionsTable.id, outcome.executionId!));
      expect(execution).toEqual({ status: "completed", workerId: null });

      const acceptances = await db
        .select({
          outcome: aiExecutionAcceptancesTable.outcome,
          terminalStatus: aiExecutionAcceptancesTable.terminalStatus,
          reasonCode: aiExecutionAcceptancesTable.reasonCode,
        })
        .from(aiExecutionAcceptancesTable)
        .where(eq(aiExecutionAcceptancesTable.executionId, outcome.executionId!));
      expect(acceptances).toEqual([{
        outcome: "SUCCEEDED",
        terminalStatus: "completed",
        reasonCode: "ACCEPTED",
      }]);
      expect(await getPublicTaskExecutionAcceptance(taskId)).toMatchObject({
        outcome: "SUCCEEDED",
        terminalStatus: "completed",
        reasonCode: "ACCEPTED",
      });
    } finally {
      taskProgressFixture.failTerminalOutcome = null;
      await cleanupProjectExecutionData(projectId);
      await db.delete(tasksTable).where(eq(tasksTable.id, taskId));
      await db.delete(projectsTable).where(eq(projectsTable.id, projectId));
    }
  });

  it.each([
    { lostLease: "execution", errorCode: "execution_lease_lost" },
    { lostLease: "task", errorCode: "task_lease_lost" },
  ] as const)(
    "does not renew either lease or terminalize after losing the $lostLease lease",
    async ({ lostLease, errorCode }) => {
    const projectId = randomUUID();
    const taskId = randomUUID();
    const userId = "lifecycle-test-user";
    const now = new Date();
    await db.insert(projectsTable).values({
      id: projectId,
      ownerId: userId,
      name: `lifecycle-lease-loss-${projectId.slice(0, 8)}`,
      rootPath: `/tmp/lifecycle-${projectId}`,
      language: "typescript",
      status: "active",
      createdAt: now,
      updatedAt: now,
    });
    await db.insert(tasksTable).values({
      id: taskId,
      projectId,
      title: "Lease-loss lifecycle fixture",
      prompt: "Wait for lease ownership to be withdrawn",
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
    let providerSignal: AbortSignal | undefined;
    let executionPromise: ReturnType<typeof executeTaskLifecycle> | undefined;
    const intervalSpy = vi.spyOn(globalThis, "setInterval");
    const intervalCallStart = intervalSpy.mock.calls.length;

    runAgentWithFallback.mockImplementationOnce(async (...args: unknown[]) => {
      const options = args[3] as { signal?: AbortSignal } | undefined;
      const signal = options?.signal;
      providerSignal = signal;
      if (!signal) throw new Error("Task execution did not forward its lease signal.");
      resolveProviderStarted();
      return new Promise<never>((_resolve, reject) => {
        const rejectAfterLeaseLoss = () => {
          const error = new Error("Fixture execution lost its lease.");
          error.name = "AbortError";
          reject(error);
        };
        if (signal.aborted) {
          rejectAfterLeaseLoss();
          return;
        }
        signal.addEventListener("abort", rejectAfterLeaseLoss, { once: true });
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
      await providerStarted;

      const [execution] = await db
        .select({
          id: aiExecutionsTable.id,
          workerId: aiExecutionsTable.workerId,
          attempt: aiExecutionsTable.attempt,
          leaseUntil: aiExecutionsTable.leaseUntil,
        })
        .from(aiExecutionsTable)
        .where(and(
          eq(aiExecutionsTable.linkedTaskId, taskId),
          eq(aiExecutionsTable.projectId, projectId),
        ))
        .limit(1);
      expect(execution?.workerId).toEqual(expect.any(String));
      const [taskBeforeHeartbeat] = await db
        .select({
          status: tasksTable.status,
          workerId: tasksTable.workerId,
          leaseUntil: tasksTable.leaseUntil,
        })
        .from(tasksTable)
        .where(eq(tasksTable.id, taskId));
      expect(taskBeforeHeartbeat).toMatchObject({
        status: "running",
        workerId: execution?.workerId,
      });

      const expiredLease = new Date(Date.now() - 1_000);
      if (lostLease === "execution") {
        await db.update(aiExecutionsTable)
          .set({ leaseUntil: expiredLease })
          .where(eq(aiExecutionsTable.id, execution!.id));
      } else {
        await db.update(tasksTable)
          .set({ leaseUntil: expiredLease })
          .where(eq(tasksTable.id, taskId));
      }

      const heartbeatIntervalMs = Math.max(1_000, Math.floor(AI_EXECUTION_LEASE_MS / 3));
      const heartbeatCall = intervalSpy.mock.calls
        .slice(intervalCallStart)
        .find(([, delay]) => delay === heartbeatIntervalMs);
      const heartbeatCallback = heartbeatCall?.[0];
      expect(typeof heartbeatCallback).toBe("function");
      const aborted = new Promise<void>((resolve) => {
        if (providerSignal!.aborted) {
          resolve();
          return;
        }
        providerSignal!.addEventListener("abort", () => resolve(), { once: true });
      });
      heartbeatCallback!();
      await aborted;

      const outcome = await executionPromise;
      expect(outcome).toMatchObject({
        ok: false,
        status: "conflict",
        executionId: execution!.id,
        errorCode,
      });
      const [taskAfterHeartbeat] = await db
        .select({
          status: tasksTable.status,
          workerId: tasksTable.workerId,
          leaseUntil: tasksTable.leaseUntil,
        })
        .from(tasksTable)
        .where(eq(tasksTable.id, taskId));
      expect(taskAfterHeartbeat).toEqual(
        lostLease === "task"
          ? { ...taskBeforeHeartbeat, leaseUntil: expiredLease }
          : taskBeforeHeartbeat,
      );
      const [executionAfterHeartbeat] = await db
        .select({ leaseUntil: aiExecutionsTable.leaseUntil })
        .from(aiExecutionsTable)
        .where(eq(aiExecutionsTable.id, execution!.id));
      expect(executionAfterHeartbeat?.leaseUntil).toEqual(
        lostLease === "execution" ? expiredLease : execution!.leaseUntil,
      );
      const [acceptance] = await db
        .select({ id: aiExecutionAcceptancesTable.id })
        .from(aiExecutionAcceptancesTable)
        .where(eq(aiExecutionAcceptancesTable.executionId, execution!.id));
      expect(acceptance).toBeUndefined();
    } finally {
      intervalSpy.mockRestore();
      await cleanupProjectExecutionData(projectId);
      await db.delete(tasksTable).where(eq(tasksTable.id, taskId));
      await db.delete(projectsTable).where(eq(projectsTable.id, projectId));
    }
    },
  );

  it("aborts structured provider work when heartbeat renewal rejects", async () => {
    const projectId = randomUUID();
    const userId = `structured-heartbeat-${projectId}`;
    const now = new Date();
    await db.insert(projectsTable).values({
      id: projectId,
      ownerId: userId,
      name: `structured-heartbeat-${projectId.slice(0, 8)}`,
      rootPath: `/tmp/structured-heartbeat-${projectId}`,
      language: "typescript",
      status: "active",
      createdAt: now,
      updatedAt: now,
    });

    const intervalSpy = vi.spyOn(globalThis, "setInterval");
    const heartbeatSpy = vi.spyOn(aiExecutionState, "heartbeatAiExecution")
      .mockRejectedValueOnce(new Error("Fixture heartbeat storage failure."));
    let structuredExecution: Awaited<ReturnType<typeof startStructuredExecution>> | undefined;
    try {
      structuredExecution = await startStructuredExecution({
        userId,
        projectId,
        projectRevision: "a".repeat(64),
        task: "analyze",
        prompt: "Wait for the heartbeat ownership check.",
      });

      const heartbeatCall = intervalSpy.mock.calls
        .find(([, delay]) => delay === aiExecutionState.AI_EXECUTION_HEARTBEAT_INTERVAL_MS);
      const heartbeatCallback = heartbeatCall?.[0];
      expect(typeof heartbeatCallback).toBe("function");
      const aborted = new Promise<void>((resolve) => {
        if (structuredExecution!.signal.aborted) {
          resolve();
          return;
        }
        structuredExecution!.signal.addEventListener("abort", () => resolve(), { once: true });
      });
      heartbeatCallback!();
      await aborted;
      expect(structuredExecution.signal.aborted).toBe(true);
    } finally {
      structuredExecution?.cleanup();
      heartbeatSpy.mockRestore();
      intervalSpy.mockRestore();
      await cleanupProjectExecutionData(projectId);
      await db.delete(projectsTable).where(eq(projectsTable.id, projectId));
    }
  });

  it("W8 rolls back structured success acceptance when the assistant projection fails", async () => {
    const projectId = randomUUID();
    const userId = `structured-w8-${projectId}`;
    const now = new Date();
    let structuredExecution: Awaited<ReturnType<typeof startStructuredExecution>> | undefined;

    await db.insert(projectsTable).values({
      id: projectId,
      ownerId: userId,
      name: `structured-w8-${projectId.slice(0, 8)}`,
      rootPath: `/tmp/structured-w8-${projectId}`,
      language: "typescript",
      status: "active",
      createdAt: now,
      updatedAt: now,
    });

    try {
      structuredExecution = await startStructuredExecution({
        userId,
        projectId,
        projectRevision: "a".repeat(64),
        task: "analyze",
        prompt: "Persist a DB-only structured result fixture.",
      });
      const assistantMessageId = await structuredExecution.persistAssistant({
        content: "Fixture result; no provider or project files are used.",
        outcome: "SUCCEEDED",
        toolTrace: "w8_structured_finalization_fixture",
      });

      await db.execute(sql`
        CREATE OR REPLACE FUNCTION fixture_fail_structured_success_message_projection()
        RETURNS trigger LANGUAGE plpgsql AS $$
        BEGIN
          IF OLD.tool_trace = 'w8_structured_finalization_fixture'
            AND NEW.outcome = 'SUCCEEDED' THEN
            RAISE EXCEPTION 'fixture_structured_success_message_projection_failure';
          END IF;
          RETURN NEW;
        END;
        $$
      `);
      await db.execute(sql`
        CREATE TRIGGER fixture_fail_structured_success_message_projection
        BEFORE UPDATE OF outcome ON ai_chat_messages
        FOR EACH ROW EXECUTE FUNCTION fixture_fail_structured_success_message_projection()
      `);

      const accepted = await structuredExecution.complete({
        messageId: assistantMessageId,
        content: "Fixture result; no provider or project files are used.",
      });
      expect(accepted).toBe(false);

      const [execution] = await db
        .select({
          status: aiExecutionsTable.status,
          workerId: aiExecutionsTable.workerId,
        })
        .from(aiExecutionsTable)
        .where(eq(aiExecutionsTable.id, structuredExecution.started.executionId));
      expect(execution).toEqual({ status: "failed", workerId: null });

      const acceptances = await db
        .select({
          outcome: aiExecutionAcceptancesTable.outcome,
          terminalStatus: aiExecutionAcceptancesTable.terminalStatus,
          reasonCode: aiExecutionAcceptancesTable.reasonCode,
        })
        .from(aiExecutionAcceptancesTable)
        .where(eq(aiExecutionAcceptancesTable.executionId, structuredExecution.started.executionId));
      expect(acceptances).toEqual([{
        outcome: "FAILED",
        terminalStatus: "failed",
        reasonCode: "EXECUTION_FAILED",
      }]);

      const [assistantMessage] = await db
        .select({
          outcome: aiChatMessagesTable.outcome,
          errorCode: aiChatMessagesTable.errorCode,
          content: aiChatMessagesTable.content,
        })
        .from(aiChatMessagesTable)
        .where(eq(aiChatMessagesTable.id, assistantMessageId));
      expect(assistantMessage).toEqual({
        outcome: "FAILED",
        errorCode: "EXECUTION_FINALIZATION_FAILED",
        content: "",
      });
    } finally {
      structuredExecution?.cleanup();
      await db.execute(sql`
        DROP TRIGGER IF EXISTS fixture_fail_structured_success_message_projection ON ai_chat_messages
      `);
      await db.execute(sql`DROP FUNCTION IF EXISTS fixture_fail_structured_success_message_projection()`);
      await cleanupProjectExecutionData(projectId);
      await db.delete(aiChatSessionsTable).where(eq(aiChatSessionsTable.projectId, projectId));
      await db.delete(projectsTable).where(eq(projectsTable.id, projectId));
    }
  });

  it("does not let a replaced structured worker record a stale failure", async () => {
    const projectId = randomUUID();
    const userId = `structured-fence-${projectId}`;
    const now = new Date();
    let structuredExecution: Awaited<ReturnType<typeof startStructuredExecution>> | undefined;
    const completionSpy = vi.spyOn(aiExecutionState, "completeAiExecution");

    try {
      await db.insert(projectsTable).values({
        id: projectId,
        ownerId: userId,
        name: `structured-fence-${projectId.slice(0, 8)}`,
        rootPath: `/tmp/structured-fence-${projectId}`,
        language: "typescript",
        status: "active",
        createdAt: now,
        updatedAt: now,
      });
      structuredExecution = await startStructuredExecution({
        userId,
        projectId,
        projectRevision: "b".repeat(64),
        task: "analyze",
        prompt: "Exercise the structured execution lease fence.",
      });
      const assistantMessageId = await structuredExecution.persistAssistant({
        content: "Fixture result; no provider or project files are used.",
        outcome: "SUCCEEDED",
        toolTrace: "structured_lease_replacement_fixture",
      });
      const replacementWorkerId = randomUUID();

      completionSpy.mockImplementationOnce(async ({ executionId }) => {
        await db.update(aiExecutionsTable)
          .set({
            workerId: replacementWorkerId,
            leaseUntil: new Date(Date.now() + 60_000),
            updatedAt: new Date(),
          })
          .where(eq(aiExecutionsTable.id, executionId));
        throw new Error("fixture_completion_failed_after_ownership_transfer");
      });

      await expect(structuredExecution.complete({
        messageId: assistantMessageId,
        content: "Fixture result; no provider or project files are used.",
      })).rejects.toThrow("fixture_completion_failed_after_ownership_transfer");

      const [execution] = await db
        .select({
          status: aiExecutionsTable.status,
          workerId: aiExecutionsTable.workerId,
        })
        .from(aiExecutionsTable)
        .where(eq(aiExecutionsTable.id, structuredExecution.started.executionId));
      expect(execution).toEqual({
        status: "running",
        workerId: replacementWorkerId,
      });

      const acceptances = await db
        .select({ outcome: aiExecutionAcceptancesTable.outcome })
        .from(aiExecutionAcceptancesTable)
        .where(eq(aiExecutionAcceptancesTable.executionId, structuredExecution.started.executionId));
      expect(acceptances).toEqual([]);

      const [assistantMessage] = await db
        .select({
          outcome: aiChatMessagesTable.outcome,
          errorCode: aiChatMessagesTable.errorCode,
          content: aiChatMessagesTable.content,
        })
        .from(aiChatMessagesTable)
        .where(eq(aiChatMessagesTable.id, assistantMessageId));
      expect(assistantMessage).toEqual({
        outcome: "INTERRUPTED",
        errorCode: null,
        content: "",
      });
    } finally {
      structuredExecution?.cleanup();
      completionSpy.mockRestore();
      await cleanupProjectExecutionData(projectId);
      await db.delete(aiChatSessionsTable).where(eq(aiChatSessionsTable.projectId, projectId));
      await db.delete(projectsTable).where(eq(projectsTable.id, projectId));
    }
  });

  it("returns unaccepted when structured completion loses its lease without recording failure", async () => {
    const projectId = randomUUID();
    const userId = `structured-false-fence-${projectId}`;
    const now = new Date();
    let structuredExecution: Awaited<ReturnType<typeof startStructuredExecution>> | undefined;

    try {
      await db.insert(projectsTable).values({
        id: projectId,
        ownerId: userId,
        name: `structured-false-fence-${projectId.slice(0, 8)}`,
        rootPath: `/tmp/structured-false-fence-${projectId}`,
        language: "typescript",
        status: "active",
        createdAt: now,
        updatedAt: now,
      });
      structuredExecution = await startStructuredExecution({
        userId,
        projectId,
        projectRevision: "d".repeat(64),
        task: "analyze",
        prompt: "Exercise explicit terminal-fence rejection.",
      });
      const assistantMessageId = await structuredExecution.persistAssistant({
        content: "Fixture result; no provider or project files are used.",
        outcome: "SUCCEEDED",
        toolTrace: "structured_false_fence_fixture",
      });
      const replacementWorkerId = randomUUID();
      await db.update(aiExecutionsTable)
        .set({
          workerId: replacementWorkerId,
          leaseUntil: new Date(Date.now() + 60_000),
          updatedAt: new Date(),
        })
        .where(eq(aiExecutionsTable.id, structuredExecution.started.executionId));

      const accepted = await structuredExecution.complete({
        messageId: assistantMessageId,
        content: "Fixture result; no provider or project files are used.",
      });
      expect(accepted).toBe(false);

      const [execution] = await db
        .select({
          status: aiExecutionsTable.status,
          workerId: aiExecutionsTable.workerId,
        })
        .from(aiExecutionsTable)
        .where(eq(aiExecutionsTable.id, structuredExecution.started.executionId));
      expect(execution).toEqual({
        status: "running",
        workerId: replacementWorkerId,
      });

      const acceptances = await db
        .select({ outcome: aiExecutionAcceptancesTable.outcome })
        .from(aiExecutionAcceptancesTable)
        .where(eq(aiExecutionAcceptancesTable.executionId, structuredExecution.started.executionId));
      expect(acceptances).toEqual([]);

      const [assistantMessage] = await db
        .select({
          outcome: aiChatMessagesTable.outcome,
          content: aiChatMessagesTable.content,
        })
        .from(aiChatMessagesTable)
        .where(eq(aiChatMessagesTable.id, assistantMessageId));
      expect(assistantMessage).toEqual({
        outcome: "INTERRUPTED",
        content: "",
      });
    } finally {
      structuredExecution?.cleanup();
      await cleanupProjectExecutionData(projectId);
      await db.delete(aiChatSessionsTable).where(eq(aiChatSessionsTable.projectId, projectId));
      await db.delete(projectsTable).where(eq(projectsTable.id, projectId));
    }
  });

  it("keeps structured success durable when the finalizer reports an error after commit", async () => {
    const projectId = randomUUID();
    const userId = `structured-post-acceptance-${projectId}`;
    const now = new Date();
    let structuredExecution: Awaited<ReturnType<typeof startStructuredExecution>> | undefined;
    let acceptedBeforeInjectedError: boolean | undefined;
    const realCompleteAiExecution = aiExecutionState.completeAiExecution;
    const completionSpy = vi.spyOn(aiExecutionState, "completeAiExecution");

    try {
      await db.insert(projectsTable).values({
        id: projectId,
        ownerId: userId,
        name: `structured-post-acceptance-${projectId.slice(0, 8)}`,
        rootPath: `/tmp/structured-post-acceptance-${projectId}`,
        language: "typescript",
        status: "active",
        createdAt: now,
        updatedAt: now,
      });
      structuredExecution = await startStructuredExecution({
        userId,
        projectId,
        projectRevision: "c".repeat(64),
        task: "analyze",
        prompt: "Exercise post-acceptance structured recovery.",
      });
      const acceptedContent = "Structured fixture accepted.";
      const assistantMessageId = await structuredExecution.persistAssistant({
        content: acceptedContent,
        outcome: "SUCCEEDED",
        toolTrace: "structured_post_acceptance_fixture",
      });

      completionSpy.mockImplementationOnce(async (params) => {
        acceptedBeforeInjectedError = await realCompleteAiExecution(params);
        throw new Error("fixture_structured_error_after_acceptance_commit");
      });

      await expect(structuredExecution.complete({
        messageId: assistantMessageId,
        content: acceptedContent,
      })).rejects.toThrow("fixture_structured_error_after_acceptance_commit");
      expect(acceptedBeforeInjectedError).toBe(true);

      const [execution] = await db
        .select({
          status: aiExecutionsTable.status,
          workerId: aiExecutionsTable.workerId,
        })
        .from(aiExecutionsTable)
        .where(eq(aiExecutionsTable.id, structuredExecution.started.executionId));
      expect(execution).toEqual({ status: "completed", workerId: null });

      const acceptances = await db
        .select({ outcome: aiExecutionAcceptancesTable.outcome })
        .from(aiExecutionAcceptancesTable)
        .where(eq(aiExecutionAcceptancesTable.executionId, structuredExecution.started.executionId));
      expect(acceptances).toEqual([{ outcome: "SUCCEEDED" }]);

      const [assistantMessage] = await db
        .select({
          outcome: aiChatMessagesTable.outcome,
          errorCode: aiChatMessagesTable.errorCode,
          content: aiChatMessagesTable.content,
        })
        .from(aiChatMessagesTable)
        .where(eq(aiChatMessagesTable.id, assistantMessageId));
      expect(assistantMessage).toEqual({
        outcome: "SUCCEEDED",
        errorCode: null,
        content: acceptedContent,
      });
    } finally {
      structuredExecution?.cleanup();
      completionSpy.mockRestore();
      await cleanupProjectExecutionData(projectId);
      await db.delete(aiChatSessionsTable).where(eq(aiChatSessionsTable.projectId, projectId));
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
    taskProgressFixture.failTerminalOutcome = "FAILED";

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
      expect(taskProgressFixture.terminalOutcomes).toEqual(["FAILED"]);
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

  it("fails closed for a non-final workflow phase without acceptance evidence", async () => {
    const projectId = randomUUID();
    const missionId = randomUUID();
    const goalId = randomUUID();
    const workflowId = randomUUID();
    const workflowExecutionId = randomUUID();
    const now = new Date();
    const userId = "workflow-phase-proof-test-user";

    await db.insert(projectsTable).values({
      id: projectId,
      ownerId: userId,
      name: `workflow-phase-proof-${projectId.slice(0, 8)}`,
      rootPath: `/tmp/workflow-phase-proof-${projectId}`,
      language: "typescript",
      status: "active",
      createdAt: now,
      updatedAt: now,
    });
    await db.insert(aiMissionsTable).values({
      id: missionId,
      projectId,
      userId,
      title: "Workflow phase proof fixture",
      intent: "Record a phase-local workflow boundary",
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
      title: "Complete the workflow",
      description: "Only a later final phase may complete this Goal.",
      status: "running",
      priority: "p1",
      successCriteria: {},
      evidenceContract: {},
      outcomeContract: {},
      nextAction: { kind: "workflow", workflowId },
      createdAt: now,
      updatedAt: now,
    });
    await db.insert(workflowsTable).values({
      id: workflowId,
      projectId,
      goalId,
      name: "Workflow phase proof fixture",
      status: "running",
      phases: [
        { name: "prepare", steps: ["Inspect the workflow boundary"] },
        { name: "deliver", steps: ["Complete the Goal"] },
      ],
      currentPhase: "prepare",
      executionCount: 1,
      createdAt: now,
      updatedAt: now,
    });
    await db.insert(workflowExecutionsTable).values({
      id: workflowExecutionId,
      workflowId,
      status: "running",
      currentPhase: "prepare",
      completedPhases: [],
      startedAt: now,
    });

    try {
      const result = await executeWorkflowPhase({
        userId,
        projectId,
        workflowId,
        workflowExecutionId,
        workflowName: "Workflow phase proof fixture",
        phaseName: "prepare",
        phaseSteps: ["Inspect the workflow boundary"],
        revision: now.toISOString(),
        completedPhaseNames: [],
        goalId,
        isFinalPhase: false,
      });
      expect(result.status).toBe("failed");

      const [execution] = await db
        .select({
          status: aiExecutionsTable.status,
          checkpoint: aiExecutionsTable.checkpoint,
        })
        .from(aiExecutionsTable)
        .where(eq(aiExecutionsTable.id, result.executionId));
      const [goal] = await db
        .select({ status: aiGoalsTable.status, outcomeContract: aiGoalsTable.outcomeContract })
        .from(aiGoalsTable)
        .where(eq(aiGoalsTable.id, goalId));
      const [mission] = await db
        .select({ status: aiMissionsTable.status })
        .from(aiMissionsTable)
        .where(eq(aiMissionsTable.id, missionId));
      const [acceptance] = await db
        .select({
          terminalStatus: aiExecutionAcceptancesTable.terminalStatus,
          outcome: aiExecutionAcceptancesTable.outcome,
          evidenceRequired: aiExecutionAcceptancesTable.evidenceRequired,
          evidenceComplete: aiExecutionAcceptancesTable.evidenceComplete,
          disposition: aiExecutionAcceptancesTable.disposition,
        })
        .from(aiExecutionAcceptancesTable)
        .where(eq(aiExecutionAcceptancesTable.executionId, result.executionId));
      const projection = (goal?.outcomeContract as Record<string, unknown>).acceptance as Record<string, unknown>;

      expect(execution?.status).toBe("failed");
      expect(execution?.checkpoint).toContain("required acceptance evidence is missing");
      expect(acceptance).toMatchObject({
        terminalStatus: "failed",
        outcome: "FAILED",
      });
      expect(projection).toMatchObject({
        executionId: result.executionId,
        outcome: "FAILED",
        verdict: "FAILED",
      });
      expect(goal?.status).toBe("running");
      expect(mission?.status).toBe("active");
    } finally {
      await cleanupProjectExecutionData(projectId);
      await db.delete(workflowExecutionsTable).where(eq(workflowExecutionsTable.id, workflowExecutionId));
      await db.delete(workflowsTable).where(eq(workflowsTable.id, workflowId));
      await db.delete(aiGoalsTable).where(eq(aiGoalsTable.id, goalId));
      await db.delete(aiMissionsTable).where(eq(aiMissionsTable.id, missionId));
      await db.delete(projectsTable).where(eq(projectsTable.id, projectId));
    }
  });

  it("W9 keeps a successful no-op workflow phase incomplete for a Goal when acceptance response is lost", async () => {
    const projectId = randomUUID();
    const missionId = randomUUID();
    const goalId = randomUUID();
    const userId = `workflow-phase-post-acceptance-${projectId}`;
    const workflowId = randomUUID();
    const workflowExecutionId = randomUUID();
    const now = new Date();
    let acceptedBeforeInjectedError: boolean | undefined;
    const realCompleteAiExecution = aiExecutionState.completeAiExecution;
    const completionSpy = vi.spyOn(aiExecutionState, "completeAiExecution");

    try {
      await db.insert(projectsTable).values({
        id: projectId,
        ownerId: userId,
        name: `workflow-phase-post-acceptance-${projectId.slice(0, 8)}`,
        rootPath: `/tmp/workflow-phase-post-acceptance-${projectId}`,
        language: "typescript",
        status: "active",
        createdAt: now,
        updatedAt: now,
      });
      await db.insert(aiMissionsTable).values({
        id: missionId,
        projectId,
        userId,
        title: "Workflow no-op projection fixture",
        intent: "Keep a non-final workflow phase from proving its Goal",
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
        title: "Complete the workflow",
        description: "A successful intermediate phase is not a completed Goal.",
        status: "running",
        priority: "p1",
        successCriteria: {},
        evidenceContract: {},
        outcomeContract: {},
        nextAction: { kind: "workflow", workflowId },
        createdAt: now,
        updatedAt: now,
      });
      await db.insert(workflowsTable).values({
        id: workflowId,
        projectId,
        goalId,
        name: "Workflow no-op response recovery",
        status: "running",
        phases: [{ name: "prepare", steps: [] }],
        currentPhase: "prepare",
        executionCount: 1,
        createdAt: now,
        updatedAt: now,
      });
      await db.insert(workflowExecutionsTable).values({
        id: workflowExecutionId,
        workflowId,
        status: "running",
        currentPhase: "prepare",
        completedPhases: [],
        startedAt: now,
      });

      completionSpy.mockImplementationOnce(async (params) => {
        acceptedBeforeInjectedError = await realCompleteAiExecution({
          ...params,
          goalProjection: {
            goalId,
            workflowId,
            workflowExecutionId,
            phase: "prepare",
            finalPhase: false,
          },
        });
        throw new Error("fixture_workflow_phase_response_lost_after_acceptance");
      });

      const result = await executeWorkflowPhase({
        userId,
        projectId,
        workflowId,
        workflowExecutionId,
        workflowName: "Workflow no-op response recovery",
        phaseName: "prepare",
        phaseSteps: [],
        revision: now.toISOString(),
        completedPhaseNames: [],
        goalId,
        isFinalPhase: false,
      });

      expect(acceptedBeforeInjectedError).toBe(true);
      expect(result).toMatchObject({ created: true, status: "completed" });

      const replayResult = await executeWorkflowPhase({
        userId,
        projectId,
        workflowId,
        workflowExecutionId,
        workflowName: "Workflow no-op response recovery",
        phaseName: "prepare",
        phaseSteps: [],
        revision: now.toISOString(),
        completedPhaseNames: [],
      });
      expect(replayResult).toEqual({
        executionId: result.executionId,
        operationId: result.operationId,
        created: false,
        status: "already_completed",
      });
      expect(completionSpy).toHaveBeenCalledOnce();

      const [execution] = await db
        .select({
          status: aiExecutionsTable.status,
          attempt: aiExecutionsTable.attempt,
          operationId: aiExecutionsTable.operationId,
        })
        .from(aiExecutionsTable)
        .where(eq(aiExecutionsTable.id, result.executionId));
      expect(execution).toMatchObject({
        status: "completed",
        attempt: 0,
        operationId: result.operationId,
      });

      const acceptances = await db
        .select({
          attempt: aiExecutionAcceptancesTable.attempt,
          operationId: aiExecutionAcceptancesTable.operationId,
          terminalStatus: aiExecutionAcceptancesTable.terminalStatus,
          outcome: aiExecutionAcceptancesTable.outcome,
        })
        .from(aiExecutionAcceptancesTable)
        .where(eq(aiExecutionAcceptancesTable.executionId, result.executionId));
      expect(acceptances).toEqual([{
        attempt: 0,
        operationId: result.operationId,
        terminalStatus: "completed",
        outcome: "SUCCEEDED",
      }]);
      const [goal] = await db.select({
        status: aiGoalsTable.status,
        outcomeContract: aiGoalsTable.outcomeContract,
      }).from(aiGoalsTable).where(eq(aiGoalsTable.id, goalId));
      expect(goal?.status).toBe("running");
      expect((goal?.outcomeContract as Record<string, unknown>).acceptance).toMatchObject({
        executionId: result.executionId,
        outcome: "SUCCEEDED",
        verdict: "INCOMPLETE",
      });
    } finally {
      completionSpy.mockRestore();
      await cleanupProjectExecutionData(projectId);
      await db.delete(workflowExecutionsTable).where(eq(workflowExecutionsTable.id, workflowExecutionId));
      await db.delete(workflowsTable).where(eq(workflowsTable.id, workflowId));
      await db.delete(aiGoalsTable).where(eq(aiGoalsTable.id, goalId));
      await db.delete(aiMissionsTable).where(eq(aiMissionsTable.id, missionId));
      await db.delete(projectsTable).where(eq(projectsTable.id, projectId));
    }
  });

  it("W8 rolls back a workflow Goal success projection and records the failed attempt", async () => {
    const projectId = randomUUID();
    const missionId = randomUUID();
    const goalId = randomUUID();
    const workflowId = randomUUID();
    const workflowExecutionId = randomUUID();
    const now = new Date();
    const userId = "workflow-phase-w8-rollback-user";
    const realCompleteAiExecution = aiExecutionState.completeAiExecution;
    const completionSpy = vi.spyOn(aiExecutionState, "completeAiExecution");

    await db.insert(projectsTable).values({
      id: projectId,
      ownerId: userId,
      name: `workflow-phase-w8-${projectId.slice(0, 8)}`,
      rootPath: `/tmp/workflow-phase-w8-${projectId}`,
      language: "typescript",
      status: "active",
      createdAt: now,
      updatedAt: now,
    });
    await db.insert(aiMissionsTable).values({
      id: missionId,
      projectId,
      userId,
      title: "Workflow W8 fixture",
      intent: "Record a phase boundary without running file-changing work",
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
      title: "Complete the workflow",
      description: "Keep the non-final phase projection bound to its transaction.",
      status: "running",
      priority: "p1",
      successCriteria: {},
      evidenceContract: {},
      outcomeContract: { w8_fault_injection: "workflow_success_projection" },
      nextAction: { kind: "workflow", workflowId },
      createdAt: now,
      updatedAt: now,
    });
    await db.insert(workflowsTable).values({
      id: workflowId,
      projectId,
      goalId,
      name: "Workflow W8 fixture",
      status: "running",
      phases: [
        { name: "prepare", steps: [] },
        { name: "deliver", steps: [] },
      ],
      currentPhase: "prepare",
      executionCount: 1,
      createdAt: now,
      updatedAt: now,
    });
    await db.insert(workflowExecutionsTable).values({
      id: workflowExecutionId,
      workflowId,
      status: "running",
      currentPhase: "prepare",
      completedPhases: [],
      startedAt: now,
    });

    try {
      await db.execute(sql`DROP SEQUENCE IF EXISTS fixture_w8_goal_projection_attempts`);
      await db.execute(sql`CREATE SEQUENCE fixture_w8_goal_projection_attempts`);
      await db.execute(sql`
        CREATE OR REPLACE FUNCTION fixture_fail_workflow_success_goal_projection()
        RETURNS trigger LANGUAGE plpgsql AS $$
        BEGIN
          IF OLD.outcome_contract->>'w8_fault_injection' = 'workflow_success_projection'
            AND NEW.outcome_contract->'acceptance'->>'outcome' = 'SUCCEEDED' THEN
            PERFORM nextval('fixture_w8_goal_projection_attempts');
            RAISE EXCEPTION 'fixture_workflow_success_goal_projection_failure';
          END IF;
          RETURN NEW;
        END;
        $$
      `);
      await db.execute(sql`
        CREATE TRIGGER fixture_fail_workflow_success_goal_projection
        BEFORE UPDATE OF outcome_contract ON ai_goals
        FOR EACH ROW EXECUTE FUNCTION fixture_fail_workflow_success_goal_projection()
      `);

      completionSpy.mockImplementationOnce((params) => realCompleteAiExecution({
        ...params,
        goalProjection: {
          goalId,
          workflowId,
          workflowExecutionId,
          phase: "prepare",
          finalPhase: false,
        },
      }));

      const result = await executeWorkflowPhase({
        userId,
        projectId,
        workflowId,
        workflowExecutionId,
        workflowName: "Workflow W8 fixture",
        phaseName: "prepare",
        phaseSteps: [],
        revision: now.toISOString(),
        completedPhaseNames: [],
        goalId,
        isFinalPhase: false,
      });
      expect(result).toMatchObject({ created: true, status: "failed" });
      const triggerHits = await db.execute(sql`
        SELECT last_value, is_called FROM fixture_w8_goal_projection_attempts
      `);
      expect(triggerHits.rows[0]?.is_called).toBe(true);
      expect(Number(triggerHits.rows[0]?.last_value)).toBe(1);

      const [execution] = await db
        .select({
          status: aiExecutionsTable.status,
          workerId: aiExecutionsTable.workerId,
        })
        .from(aiExecutionsTable)
        .where(eq(aiExecutionsTable.id, result.executionId));
      expect(execution).toEqual({ status: "failed", workerId: null });

      const acceptances = await db
        .select({
          outcome: aiExecutionAcceptancesTable.outcome,
          terminalStatus: aiExecutionAcceptancesTable.terminalStatus,
        })
        .from(aiExecutionAcceptancesTable)
        .where(eq(aiExecutionAcceptancesTable.executionId, result.executionId));
      expect(acceptances).toEqual([{ outcome: "FAILED", terminalStatus: "failed" }]);

      const [goal] = await db
        .select({
          status: aiGoalsTable.status,
          outcomeContract: aiGoalsTable.outcomeContract,
        })
        .from(aiGoalsTable)
        .where(eq(aiGoalsTable.id, goalId));
      const projection = (goal?.outcomeContract as Record<string, unknown>).acceptance as Record<string, unknown>;
      expect(goal?.status).toBe("running");
      expect(projection).toBeUndefined();
    } finally {
      completionSpy.mockRestore();
      await db.execute(sql`DROP TRIGGER IF EXISTS fixture_fail_workflow_success_goal_projection ON ai_goals`);
      await db.execute(sql`DROP FUNCTION IF EXISTS fixture_fail_workflow_success_goal_projection()`);
      await db.execute(sql`DROP SEQUENCE IF EXISTS fixture_w8_goal_projection_attempts`);
      await cleanupProjectExecutionData(projectId);
      await db.delete(workflowExecutionsTable).where(eq(workflowExecutionsTable.id, workflowExecutionId));
      await db.delete(workflowsTable).where(eq(workflowsTable.id, workflowId));
      await db.delete(aiGoalsTable).where(eq(aiGoalsTable.id, goalId));
      await db.delete(aiMissionsTable).where(eq(aiMissionsTable.id, missionId));
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
          request: aiExecutionsTable.request,
          checkpoint: aiExecutionsTable.checkpoint,
          checkpointVersion: aiExecutionsTable.checkpointVersion,
        })
        .from(aiExecutionsTable)
        .where(eq(aiExecutionsTable.id, evidenceContext.operationId))
        .limit(1);
      expect(execution).toBeDefined();
      if (!execution) throw new Error("Mission repair checkpoint was not persisted before validation.");
      expect(JSON.parse(execution.request)).toMatchObject({
        proofRequired: true,
        proofEvidenceMode: "mission_validation_v1",
      });
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
    const validationEvidenceId = randomUUID();
    runRepairValidation.mockImplementation(async (...args: unknown[]) => ({
      status: "passed" as const,
      evidence: {
        evidenceId: validationEvidenceId,
        artifactRef: `mission-tool-handoff-validation:${validationEvidenceId}`,
        validatorProfile: String(args[1]),
      },
    }));
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

  it("resumes a candidate-ready Mission repair after startup recovery rotates the execution attempt", async () => {
    const fixture = await createMissionToolLoopFixture({
      phase: "execute",
      approvalRequired: false,
    });
    const candidateContent = "export const value = 'startup-recovered-candidate';\n";
    let executionId: string | undefined;

    chatWithFallback.mockImplementationOnce(async (...args: unknown[]) => {
      const baseParams = args[1] as {
        onMutationInvocation?: import("@workspace/ai-orchestrator").MutationToolInvocationCallback;
      };
      const invocation = {
        toolCallId: "provider-call-mission-startup-recovery",
        toolName: "write_file" as const,
        path: "src/target.ts",
        inputHash: "c".repeat(64),
      };
      await baseParams.onMutationInvocation?.({ ...invocation, phase: "requested" });
      await baseParams.onMutationInvocation?.({ ...invocation, phase: "committed" });
      return {
        result: {
          response: "Prepared the candidate for restart recovery.",
          pendingChanges: [{ path: "src/target.ts", newContent: candidateContent }],
          sources: [],
        },
        effectiveProvider: "groq" as const,
      };
    });
    runRepairValidation.mockImplementationOnce(async (...args: unknown[]) => {
      const evidenceContext = args[5] as { operationId: string };
      executionId = evidenceContext.operationId;
      const [execution] = await db
        .select({ checkpoint: aiExecutionsTable.checkpoint })
        .from(aiExecutionsTable)
        .where(eq(aiExecutionsTable.id, evidenceContext.operationId))
        .limit(1);
      expect(execution).toBeDefined();
      if (!execution) throw new Error("Mission repair checkpoint missing before simulated process exit.");
      const checkpoint = JSON.parse(execution.checkpoint) as { detail: string };
      const detail = JSON.parse(checkpoint.detail) as {
        missionRepairRecovery: { phase: string; attempt: number };
      };
      expect(detail.missionRepairRecovery).toMatchObject({
        phase: "candidate_ready",
        attempt: 0,
      });

      // Leave both durable leases expired and the execution running, as after
      // the process disappears before it can report a terminal result.
      await db.update(aiExecutionsTable)
        .set({ leaseUntil: new Date(0), updatedAt: new Date() })
        .where(eq(aiExecutionsTable.id, evidenceContext.operationId));
      await db.update(tasksTable)
        .set({ leaseUntil: new Date(0), updatedAt: new Date() })
        .where(eq(tasksTable.id, fixture.taskId));
      throw new Error("simulated_process_exit_after_candidate_ready");
    });
    runRepairValidation.mockImplementationOnce(async (...args: unknown[]) => ({
      status: "passed" as const,
      evidence: {
        evidenceId: "mission-repair-validator-evidence-startup-recovery",
        artifactRef: "fixture-validation-receipt",
        validatorProfile: String(args[1]),
      },
    }));

    try {
      const initial = await executeTaskLifecycle({
        taskId: fixture.taskId,
        userId: "mission-effect-test-user",
        provider: { provider: "groq", apiKey: "fixture-provider" },
        trigger: "reconciliation",
        expectedStatuses: ["verifying"],
        workspaceRevision: fixture.now.toISOString(),
      });
      expect(initial.ok).toBe(false);
      expect(executionId).toEqual(expect.any(String));

      await reconcileStuckJobs();
      const [pausedExecution] = await db
        .select({
          attempt: aiExecutionsTable.attempt,
          status: aiExecutionsTable.status,
        })
        .from(aiExecutionsTable)
        .where(eq(aiExecutionsTable.id, executionId!))
        .limit(1);
      expect(pausedExecution).toEqual({ attempt: 0, status: "paused" });
      const [reconciledCheckpointRow] = await db
        .select({ checkpoint: aiExecutionsTable.checkpoint })
        .from(aiExecutionsTable)
        .where(eq(aiExecutionsTable.id, executionId!))
        .limit(1);
      expect(reconciledCheckpointRow).toBeDefined();
      if (!reconciledCheckpointRow) throw new Error("Reconciled execution checkpoint missing.");
      const reconciledCheckpoint = JSON.parse(reconciledCheckpointRow.checkpoint) as {
        stage: string;
        sequence: number;
        detail: string;
      };
      const reconciledToolLoopState = JSON.parse(reconciledCheckpoint.detail) as {
        missionRepairRecovery: {
          phase: string;
          attempt: number;
          checkpointSequence: number;
        };
      };
      expect(reconciledCheckpoint.stage).toBe("tool_loop");
      expect(reconciledCheckpoint.detail.length).toBeGreaterThan(500);
      expect(reconciledToolLoopState.missionRepairRecovery).toMatchObject({
        phase: "candidate_ready",
        attempt: 0,
        checkpointSequence: reconciledCheckpoint.sequence,
      });

      const [acceptance] = await db
        .select({
          outcome: aiExecutionAcceptancesTable.outcome,
          nextActionCode: aiExecutionAcceptancesTable.nextActionCode,
          resumable: aiExecutionAcceptancesTable.resumable,
        })
        .from(aiExecutionAcceptancesTable)
        .where(and(
          eq(aiExecutionAcceptancesTable.executionId, executionId!),
          eq(aiExecutionAcceptancesTable.attempt, 0),
        ))
        .limit(1);
      expect(acceptance).toMatchObject({
        outcome: "FAILED",
        nextActionCode: "RESUME_ALLOWED",
        resumable: 1,
      });

      const recovery = await aiExecutionState.recoverAiExecutionResumeToken({
        executionId: executionId!,
        userId: "mission-effect-test-user",
        linkedTaskId: fixture.taskId,
        expectedAttempt: 0,
      });
      expect(recovery).toBeDefined();
      if (!recovery) throw new Error("Startup recovery did not issue a resume token.");

      const resumed = await executeTaskLifecycle({
        taskId: fixture.taskId,
        userId: "mission-effect-test-user",
        provider: { provider: "groq", apiKey: "fixture-provider" },
        trigger: "reconciliation",
        expectedStatuses: ["verifying"],
        workspaceRevision: fixture.now.toISOString(),
        resumeExecutionId: executionId!,
        resumeToken: recovery.resumeToken,
      });

      expect(
        resumed.ok,
        !resumed.ok
          ? `${resumed.errorCode}: ${String(resumed.error)}`
          : "Mission recovery did not complete.",
      ).toBe(true);
      expect(resumed).toMatchObject({
        ok: true,
        status: "completed",
        executionId,
      });
      const [recoveredExecution] = await db
        .select({ attempt: aiExecutionsTable.attempt })
        .from(aiExecutionsTable)
        .where(eq(aiExecutionsTable.id, executionId!))
        .limit(1);
      expect(recoveredExecution?.attempt).toBe(1);
    } finally {
      const materializationFailures = await drainPendingObservationMaterializations();
      await fixture.cleanup();
      if (materializationFailures.length > 0) {
        throw new AggregateError(materializationFailures, "Startup Mission recovery observation cleanup failed.");
      }
    }
  });

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

  it("rejects a candidate-ready recovery manifest bound to another Episode before rebuilding observations", async () => {
    const fixture = await createMissionToolLoopFixture({
      phase: "execute",
      approvalRequired: false,
    });
    const candidateContent = "export const value = 'episode-mismatch-candidate';\n";
    let recoveredOutcome: Awaited<ReturnType<typeof executeTaskLifecycle>> | undefined;
    let observationsBeforeRecovery = -1;
    let observationsAfterRecovery = -1;
    let validationCalls = 0;

    chatWithFallback.mockImplementationOnce(async (...args: unknown[]) => {
      const baseParams = args[1] as {
        onMutationInvocation?: import("@workspace/ai-orchestrator").MutationToolInvocationCallback;
      };
      const invocation = {
        toolCallId: "provider-call-mission-episode-mismatch",
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
    runRepairValidation.mockImplementationOnce(async (...args: unknown[]) => {
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
      if (!execution?.workerId) throw new Error("Mission repair worker missing before recovery.");
      const checkpoint = JSON.parse(execution.checkpoint) as { sequence: number; detail: string };
      const detail = JSON.parse(checkpoint.detail) as {
        missionRepairRecovery: { episodeId: string; checkpointSequence: number };
      };
      expect(detail.missionRepairRecovery.episodeId).toEqual(expect.any(String));

      const nextSequence = checkpoint.sequence + 1;
      const persisted = await checkpointAiExecution({
        executionId: evidenceContext.operationId,
        expectedAttempt: execution.attempt,
        workerId: execution.workerId,
        checkpoint: {
          stage: "tool_loop",
          sequence: nextSequence,
          detail: JSON.stringify({
            ...detail,
            missionRepairRecovery: {
              ...detail.missionRepairRecovery,
              episodeId: `wrong-episode:${fixture.taskId}`,
              checkpointSequence: nextSequence,
            },
          }),
          updatedAt: new Date().toISOString(),
        },
      });
      expect(persisted).toBe(true);

      const countWorkspaceObservations = async () => (await db
        .select({ id: aiAgentObservationsTable.id })
        .from(aiAgentObservationsTable)
        .where(and(
          eq(aiAgentObservationsTable.executionId, evidenceContext.operationId),
          eq(aiAgentObservationsTable.predicate, "workspace.tree_hash"),
        ))).length;
      observationsBeforeRecovery = await countWorkspaceObservations();

      await db.update(aiExecutionsTable)
        .set({ status: "paused", workerId: null, leaseUntil: null, updatedAt: new Date() })
        .where(eq(aiExecutionsTable.id, evidenceContext.operationId));
      await db.update(tasksTable)
        .set({ status: "verifying", workerId: null, leaseUntil: null, updatedAt: new Date() })
        .where(eq(tasksTable.id, fixture.taskId));

      recoveredOutcome = await executeTaskLifecycle({
        taskId: fixture.taskId,
        userId: "mission-effect-test-user",
        provider: { provider: "groq", apiKey: "fixture-provider" },
        trigger: "reconciliation",
        expectedStatuses: ["verifying"],
        workspaceRevision: fixture.now.toISOString(),
      });
      observationsAfterRecovery = await countWorkspaceObservations();
      throw new Error("simulated_worker_exit_after_episode_mismatch_rejection");
    });

    try {
      await executeTaskLifecycle({
        taskId: fixture.taskId,
        userId: "mission-effect-test-user",
        provider: { provider: "groq", apiKey: "fixture-provider" },
        trigger: "reconciliation",
        expectedStatuses: ["verifying"],
        workspaceRevision: fixture.now.toISOString(),
      });

      expect(recoveredOutcome).toBeDefined();
      expect(recoveredOutcome).not.toMatchObject({ ok: true, status: "completed" });
      expect(validationCalls).toBe(1);
      expect(observationsAfterRecovery).toBe(observationsBeforeRecovery);
      expect(await readFile(join(fixture.rootPath, "src", "target.ts"), "utf8"))
        .toBe("export const value = 'base';\n");
    } finally {
      runRepairValidation.mockReset().mockImplementation(async (..._args: unknown[]) => ({
        status: "passed" as const,
        evidence: { artifactRef: "fixture-validation-receipt" },
      }));
      await fixture.cleanup();
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
    runRepairValidation.mockImplementationOnce(async (...args: unknown[]) => ({
      status: "passed" as const,
      evidence: {
        evidenceId: "mission-validate-only-evidence",
        artifactRef: "mission-validate-only-receipt",
        validatorProfile: String(args[1]),
      },
    }));

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
        userId: "mission-effect-test-user",
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

  it("records local task completion without completing the delivery Goal or Mission", async () => {
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
      const [task] = await db
        .select({ status: tasksTable.status, phase: tasksTable.phase })
        .from(tasksTable)
        .where(eq(tasksTable.id, taskId));
      const [durableAcceptance] = await db
        .select({
          outcome: aiExecutionAcceptancesTable.outcome,
          terminalStatus: aiExecutionAcceptancesTable.terminalStatus,
          disposition: aiExecutionAcceptancesTable.disposition,
        })
        .from(aiExecutionAcceptancesTable)
        .where(eq(aiExecutionAcceptancesTable.executionId, outcome.executionId!));
      expect(task).toMatchObject({ status: "completed", phase: null });
      expect(durableAcceptance).toMatchObject({
        outcome: "SUCCEEDED",
        terminalStatus: "completed",
      });
      expect(durableAcceptance?.disposition).not.toHaveProperty("taskObjective");
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

  it("does not start a linked task when its completed Goal dependency has no current proof", async () => {
    const projectId = randomUUID();
    const missionId = randomUUID();
    const sourceGoalId = randomUUID();
    const goalId = randomUUID();
    const taskId = randomUUID();
    const planRevision = "mission-dependency-admission-v1";
    const now = new Date();
    const rootPath = await mkdtemp(join("/tmp", "mission-dependency-admission-"));

    await db.insert(projectsTable).values({
      id: projectId,
      ownerId: "mission-dependency-test-user",
      name: `mission-dependency-${projectId.slice(0, 8)}`,
      rootPath,
      language: "typescript",
      status: "active",
      createdAt: now,
      updatedAt: now,
    });
    await db.insert(aiMissionsTable).values({
      id: missionId,
      projectId,
      userId: "mission-dependency-test-user",
      title: "Dependency admission fixture",
      intent: "Do not execute a dependent task without current ancestor proof",
      status: "active",
      scope: { kind: "project", projectId },
      autonomyPolicy: { activePlanRevision: planRevision },
      budget: {},
      createdAt: now,
      updatedAt: now,
    });
    await db.insert(aiGoalsTable).values([
      {
        id: sourceGoalId,
        missionId,
        projectId,
        title: "Completed but unproven prerequisite",
        status: "completed",
        successCriteria: { planRevision: { hash: planRevision } },
        outcomeContract: { planRevision: { hash: planRevision } },
        createdAt: now,
        updatedAt: now,
      },
      {
        id: goalId,
        missionId,
        projectId,
        title: "Dependent Goal",
        status: "queued",
        successCriteria: { planRevision: { hash: planRevision } },
        outcomeContract: { planRevision: { hash: planRevision } },
        createdAt: now,
        updatedAt: now,
      },
    ]);
    await db.insert(aiGoalDependenciesTable).values({
      id: randomUUID(),
      missionId,
      projectId,
      goalId,
      dependsOnGoalId: sourceGoalId,
      planRevision,
      createdAt: now,
    });
    await db.insert(tasksTable).values({
      id: taskId,
      projectId,
      goalId,
      title: "Dependent task",
      prompt: "Run only after the prerequisite proof is current",
      status: "verifying",
      retryCount: 0,
      maxRetries: 2,
      createdAt: now,
      updatedAt: now,
    });

    try {
      const executionCountBefore = await db
        .select({ id: aiExecutionsTable.id })
        .from(aiExecutionsTable)
        .where(eq(aiExecutionsTable.linkedTaskId, taskId));
      const outcome = await executeTaskLifecycle({
        taskId,
        userId: "mission-dependency-test-user",
        provider: { provider: "groq", apiKey: "fixture-provider" },
        trigger: "manual",
        expectedStatuses: ["verifying"],
        workspaceRevision: now.toISOString(),
      });

      expect(outcome).toMatchObject({
        ok: false,
        status: "conflict",
        errorCode: "mission_dependency_proof_unproven",
      });
      const executionCountAfter = await db
        .select({ id: aiExecutionsTable.id })
        .from(aiExecutionsTable)
        .where(eq(aiExecutionsTable.linkedTaskId, taskId));
      expect(executionCountAfter).toHaveLength(executionCountBefore.length);
      const [task] = await db.select({ status: tasksTable.status })
        .from(tasksTable)
        .where(eq(tasksTable.id, taskId));
      expect(task?.status).toBe("verifying");
    } finally {
      await cleanupProjectExecutionData(projectId);
      await db.delete(tasksTable).where(eq(tasksTable.id, taskId));
      await db.delete(aiGoalDependenciesTable).where(eq(aiGoalDependenciesTable.missionId, missionId));
      await db.delete(aiGoalsTable).where(eq(aiGoalsTable.missionId, missionId));
      await db.delete(aiMissionsTable).where(eq(aiMissionsTable.id, missionId));
      await db.delete(projectsTable).where(eq(projectsTable.id, projectId));
      await rm(rootPath, { recursive: true, force: true });
    }
  });
});