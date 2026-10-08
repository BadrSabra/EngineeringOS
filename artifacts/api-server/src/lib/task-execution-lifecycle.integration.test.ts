import { afterEach, describe, expect, it, vi } from "vitest";
import { and, eq, sql } from "drizzle-orm";
import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { basename, dirname, join, resolve } from "node:path";
import {
  buildMissionRepairEffectContract,
  MISSION_REPAIR_TOOL_CAPABILITY_ID,
} from "./agent-state/mission-repair-effect.js";
import { seedCanonicalMissionGoalCompletion } from "../__tests__/mission-dependency-proof-fixture.js";
import * as effectObserver from "./agent-state/effect-observer.js";
import { materializeServerOwnedObservations } from "./agent-state/observation-materializer.js";
import { assertMissionRepairToolActionRequested } from "./agent-state/mission-repair-tool-action-ledger.js";
import type { AgentAction, AgentStep } from "@workspace/ai-orchestrator";
type ChatWithFallbackFunction = (typeof import("./ai-route-helpers.js"))["chatWithFallback"];
type MissionValidationRunner = NonNullable<
  Parameters<ChatWithFallbackFunction>[1]["validationRunner"]
>;
import {
  auditLogsTable,
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
import app from "../app.js";
import request from "supertest";

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
const missionRepairProcessFixture = vi.hoisted(() => ({
  candidateWorkspacePath: null as string | null,
}));
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
    createValidationWorkspace: async (
      ...args: Parameters<typeof actual.createValidationWorkspace>
    ) => {
      const workspace = await actual.createValidationWorkspace(...args);
      if (process.env.MISSION_REPAIR_PROCESS_CHILD === "worker") {
        missionRepairProcessFixture.candidateWorkspacePath = workspace.rootPath;
        const pathSignal = process.env.MISSION_REPAIR_WORKSPACE_SIGNAL_FILE;
        if (!pathSignal) {
          throw new Error("Mission repair worker child is missing its workspace signal path.");
        }
        const fs = await import("node:fs/promises");
        await fs.writeFile(pathSignal, workspace.rootPath, "utf8");
      }
      return workspace;
    },
    runRepairValidation,
  };
});

vi.mock("./ai-execution-acceptance.js", async () => {
  const actual = await vi.importActual<typeof import("./ai-execution-acceptance.js")>(
    "./ai-execution-acceptance.js",
  );
  return {
    ...actual,
    finalizeExecutionAcceptance: async (
      ...args: Parameters<typeof actual.finalizeExecutionAcceptance>
    ) => {
      const result = await actual.finalizeExecutionAcceptance(...args);
      if (process.env.TASK_ROUTE_PROCESS_CHILD === "accepted-worker" && result.accepted) {
        const signalFile = process.env.TASK_ROUTE_PROCESS_READY_SIGNAL_FILE;
        if (!signalFile) {
          throw new Error("AI task acceptance worker is missing its ready signal path.");
        }
        const fs = await import("node:fs/promises");
        await fs.writeFile(signalFile, JSON.stringify({
          executionId: args[0].executionId,
          stage: "acceptance_committed_before_http_response",
        }), "utf8");
        await new Promise<never>(() => {});
      }
      return result;
    },
  };
});

vi.mock("../services/task-service.js", async () => {
  const actual = await vi.importActual<typeof import("../services/task-service.js")>(
    "../services/task-service.js",
  );
  return {
    ...actual,
    runTaskVerification: async (
      ...args: Parameters<typeof actual.runTaskVerification>
    ) => {
      if (process.env.TASK_ROUTE_PROCESS_CHILD === "manual-worker") {
        const signalFile = process.env.TASK_ROUTE_PROCESS_READY_SIGNAL_FILE;
        if (!signalFile) {
          throw new Error("Manual task route worker is missing its ready signal path.");
        }
        const fs = await import("node:fs/promises");
        await fs.writeFile(signalFile, JSON.stringify({
          taskId: args[0].id,
          stage: "verification_pending",
        }), "utf8");
        const releaseSignalFile = process.env.TASK_ROUTE_PROCESS_RELEASE_SIGNAL_FILE;
        if (releaseSignalFile) {
          const deadline = Date.now() + 60_000;
          while (Date.now() < deadline) {
            try {
              await fs.readFile(releaseSignalFile);
              return actual.runTaskVerification(...args);
            } catch (error) {
              if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
            }
            await new Promise((resolveDelay) => setTimeout(resolveDelay, 50));
          }
          throw new Error("Manual task route worker did not receive its release signal.");
        }
        await new Promise<never>(() => {});
      }
      return actual.runTaskVerification(...args);
    },
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

async function waitForTaskUpdateLock(timeoutMs = 10_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const result = await db.execute(sql`
      SELECT waiting.query
      FROM pg_stat_activity AS waiting
      WHERE waiting.pid <> pg_backend_pid()
        AND waiting.datname = current_database()
        AND waiting.wait_event_type = 'Lock'
        AND cardinality(pg_blocking_pids(waiting.pid)) > 0
        AND waiting.query ILIKE '%update%'
        AND waiting.query ILIKE '%tasks%'
    `);
    const rows = (result as unknown as { rows?: Array<{ query: string | null }> }).rows ?? [];
    const blockedTaskUpdate = rows.find((row) => /update/i.test(row.query ?? "") && /tasks/i.test(row.query ?? ""));
    if (blockedTaskUpdate) return blockedTaskUpdate.query;
    await new Promise((resolveDelay) => setTimeout(resolveDelay, 25));
  }
  throw new Error("Task execution did not reach its row-locked Task claim.");
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

function createDeferred<T = void>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

function startApiStartupProcess(applicationName: string) {
  const rawDatabaseUrl = process.env.DATABASE_URL;
  if (!rawDatabaseUrl) {
    throw new Error("Mission repair process recovery requires an explicit disposable DATABASE_URL.");
  }
  const databaseUrl = new URL(rawDatabaseUrl);
  if (!["127.0.0.1", "localhost", "::1", "[::1]"].includes(databaseUrl.hostname)) {
    throw new Error("Mission repair process recovery is restricted to a loopback PostgreSQL database.");
  }
  databaseUrl.searchParams.set("application_name", applicationName);

  const source = [
    "(async () => {",
    '  const { createServer } = await import("node:net");',
    "  const reservation = createServer();",
    '  await new Promise((resolve, reject) => reservation.listen(0, "127.0.0.1", resolve));',
    "  const address = reservation.address();",
    '  if (!address || typeof address === "string") throw new Error("Could not reserve an API port.");',
    '  await new Promise((resolve, reject) => reservation.close((error) => error ? reject(error) : resolve()));',
    "  process.env.PORT = String(address.port);",
    '  await import("./src/index.ts");',
    '  process.stdout.write("API_INDEX_READY\\n");',
    "  await new Promise(() => {});",
    "})().catch((error) => {",
    "  console.error(error);",
    "  process.exitCode = 1;",
    "});",
  ].join("\n");
  const child = spawn(process.execPath, ["--import", "tsx", "-e", source], {
    cwd: process.cwd(),
    env: {
      DATABASE_URL: databaseUrl.toString(),
      NODE_ENV: "test",
      PATH: process.env.PATH ?? "",
      AI_PROVIDER_EGRESS_DISABLED: "1",
      RUN_CONTROLLED_RELEASE_VALIDATION: "1",
      DASHBOARD_E2E_TEST_MODE: "fixture",
      PGAPPNAME: applicationName,
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  let stdout = "";
  let stderr = "";
  child.stdout?.setEncoding("utf8");
  child.stderr?.setEncoding("utf8");
  child.stdout?.on("data", (chunk: string) => {
    stdout += chunk;
  });
  child.stderr?.on("data", (chunk: string) => {
    stderr += chunk;
  });
  const exit = new Promise<{ code: number | null; signal: NodeJS.Signals | null }>((resolve) => {
    child.once("exit", (code, signal) => resolve({ code, signal }));
  });
  const output = () => `stdout=${stdout}; stderr=${stderr}`;
  const waitForReady = async () => {
    const deadline = Date.now() + 60_000;
    while (!stdout.includes("API_INDEX_READY")) {
      if (child.exitCode !== null || child.signalCode !== null) {
        throw new Error(`API startup child exited early; ${output()}`);
      }
      if (Date.now() >= deadline) {
        throw new Error(`Timed out waiting for API startup; ${output()}`);
      }
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
  };
  return { applicationName, child, exit, output, waitForReady };
}

type MissionRepairProcessChildMode = "worker" | "recovery";

function requireMissionRepairDisposableDatabaseUrl() {
  const rawDatabaseUrl = process.env.DATABASE_URL;
  if (!rawDatabaseUrl) {
    throw new Error("Mission repair worker recovery requires an explicit disposable DATABASE_URL.");
  }
  const databaseUrl = new URL(rawDatabaseUrl);
  if (!["127.0.0.1", "localhost", "::1", "[::1]"].includes(databaseUrl.hostname)) {
    throw new Error("Mission repair worker recovery is restricted to a loopback PostgreSQL database.");
  }
  const databaseName = decodeURIComponent(databaseUrl.pathname.replace(/^\/+/, ""));
  if (!/(?:^|[_-])(?:test|disposable)(?:[_-]|$)/i.test(databaseName)) {
    throw new Error("Mission repair worker recovery requires a disposable or test-named database.");
  }
  return databaseUrl;
}

function startMissionRepairTestProcess(
  mode: MissionRepairProcessChildMode,
  input: {
    taskId: string;
    userId: string;
    workspaceRevision: string;
    crashPhase?: "candidate_ready" | "committed" | "effect_classified";
    executionId?: string;
    readySignalFile?: string;
    workspaceSignalFile?: string;
  },
) {
  const databaseUrl = requireMissionRepairDisposableDatabaseUrl();
  const applicationName = `mission-repair-${mode}-${randomUUID()}`;
  databaseUrl.searchParams.set("application_name", applicationName);
  const child = spawn(process.execPath, [
    join(process.cwd(), "node_modules", "vitest", "vitest.mjs"),
    "run",
    "src/lib/task-execution-lifecycle.integration.test.ts",
    "--pool=threads",
    "--maxWorkers=1",
    "--no-file-parallelism",
    "-t",
    "process-level Mission repair worker fixture",
  ], {
    cwd: process.cwd(),
    env: {
      DATABASE_URL: databaseUrl.toString(),
      PGAPPNAME: applicationName,
      NODE_ENV: "test",
      PATH: process.env.PATH ?? "",
      HOME: process.env.HOME ?? "",
      WORKSPACE_PATH: process.env.WORKSPACE_PATH ?? "/home/runner/workspace",
      AI_PROVIDER_EGRESS_DISABLED: "1",
      RUN_CONTROLLED_RELEASE_VALIDATION: "1",
      DASHBOARD_E2E_TEST_MODE: "fixture",
      MISSION_REPAIR_PROCESS_CHILD: mode,
      MISSION_REPAIR_PROCESS_TASK_ID: input.taskId,
      MISSION_REPAIR_PROCESS_USER_ID: input.userId,
      MISSION_REPAIR_PROCESS_WORKSPACE_REVISION: input.workspaceRevision,
      ...(input.executionId ? { MISSION_REPAIR_PROCESS_EXECUTION_ID: input.executionId } : {}),
      MISSION_REPAIR_PROCESS_CRASH_PHASE: input.crashPhase ?? "candidate_ready",
      ...(input.readySignalFile ? { MISSION_REPAIR_READY_SIGNAL_FILE: input.readySignalFile } : {}),
      ...(input.workspaceSignalFile
        ? { MISSION_REPAIR_WORKSPACE_SIGNAL_FILE: input.workspaceSignalFile }
        : {}),
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  let stdout = "";
  let stderr = "";
  child.stdout?.setEncoding("utf8");
  child.stderr?.setEncoding("utf8");
  child.stdout?.on("data", (chunk: string) => {
    stdout += chunk;
  });
  child.stderr?.on("data", (chunk: string) => {
    stderr += chunk;
  });
  const exit = new Promise<{ code: number | null; signal: NodeJS.Signals | null }>((resolveExit) => {
    child.once("exit", (code, signal) => resolveExit({ code, signal }));
  });
  const output = () => {
    const databaseUrlWithoutCredentials = `${databaseUrl.protocol}//${databaseUrl.hostname}${databaseUrl.pathname}`;
    let captured = `stdout=${stdout}; stderr=${stderr}`
      .replaceAll(databaseUrl.toString(), databaseUrlWithoutCredentials);
    if (databaseUrl.password) captured = captured.replaceAll(databaseUrl.password, "[redacted]");
    if (databaseUrl.username) captured = captured.replaceAll(databaseUrl.username, "[redacted]");
    return captured;
  };
  return { applicationName, child, exit, output };
}

function startTaskRouteTestProcess(input: {
  mode: "worker" | "resume-worker" | "resume" | "accepted-worker" | "manual-worker";
  taskId: string;
  readySignalFile?: string;
  releaseSignalFile?: string;
  resultSignalFile?: string;
  leaseMs?: number;
  heartbeatIntervalMs?: number;
}) {
  const databaseUrl = requireMissionRepairDisposableDatabaseUrl();
  const applicationName = `ai-task-route-worker-${randomUUID()}`;
  databaseUrl.searchParams.set("application_name", applicationName);
  const child = spawn(process.execPath, [
    join(process.cwd(), "node_modules", "vitest", "vitest.mjs"),
    "run",
    "src/lib/task-execution-lifecycle.integration.test.ts",
    "--pool=threads",
    "--maxWorkers=1",
    "--no-file-parallelism",
    "-t",
    input.mode === "worker"
      ? "process-level AI task route worker fixture"
      : input.mode === "resume-worker"
        ? "process-level AI task route resume worker fixture"
        : input.mode === "accepted-worker"
          ? "process-level AI task route accepted worker fixture"
          : input.mode === "manual-worker"
            ? "process-level manual task route worker fixture"
            : "process-level AI task route resume fixture",
  ], {
    cwd: process.cwd(),
    env: {
      DATABASE_URL: databaseUrl.toString(),
      PGAPPNAME: applicationName,
      NODE_ENV: "test",
      PATH: process.env.PATH ?? "",
      HOME: process.env.HOME ?? "",
      WORKSPACE_PATH: process.env.WORKSPACE_PATH ?? "/home/runner/workspace",
      AI_PROVIDER_EGRESS_DISABLED: "1",
      RUN_CONTROLLED_RELEASE_VALIDATION: "1",
      DASHBOARD_E2E_TEST_MODE: "fixture",
      GROQ_API_KEY: "test-dummy-key-for-mocked-tests",
      TASK_ROUTE_PROCESS_CHILD: input.mode,
      TASK_ROUTE_PROCESS_TASK_ID: input.taskId,
      TASK_ROUTE_PROCESS_READY_SIGNAL_FILE: input.readySignalFile ?? "",
      TASK_ROUTE_PROCESS_RELEASE_SIGNAL_FILE: input.releaseSignalFile ?? "",
      TASK_ROUTE_PROCESS_RESULT_SIGNAL_FILE: input.resultSignalFile ?? "",
      ...(input.leaseMs !== undefined ? { AI_TASK_LEASE_MS: String(input.leaseMs) } : {}),
      ...(input.heartbeatIntervalMs !== undefined
        ? { AI_TASK_HEARTBEAT_INTERVAL_MS: String(input.heartbeatIntervalMs) }
        : {}),
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  let stdout = "";
  let stderr = "";
  child.stdout?.setEncoding("utf8");
  child.stderr?.setEncoding("utf8");
  child.stdout?.on("data", (chunk: string) => {
    stdout += chunk;
  });
  child.stderr?.on("data", (chunk: string) => {
    stderr += chunk;
  });
  const exit = new Promise<{ code: number | null; signal: NodeJS.Signals | null }>((resolveExit) => {
    child.once("exit", (code, signal) => resolveExit({ code, signal }));
  });
  const output = () => {
    const databaseUrlWithoutCredentials = `${databaseUrl.protocol}//${databaseUrl.hostname}${databaseUrl.pathname}`;
    let captured = `stdout=${stdout}; stderr=${stderr}`
      .replaceAll(databaseUrl.toString(), databaseUrlWithoutCredentials);
    if (databaseUrl.password) captured = captured.replaceAll(databaseUrl.password, "[redacted]");
    if (databaseUrl.username) captured = captured.replaceAll(databaseUrl.username, "[redacted]");
    return captured;
  };
  return { applicationName, child, exit, output };
}

function startStructuredRouteTestProcess(input: {
  mode: "worker" | "resume";
  task: "analyze" | "review";
  projectId: string;
  executionId?: string;
  resumeToken?: string;
  readySignalFile?: string;
}) {
  const databaseUrl = requireMissionRepairDisposableDatabaseUrl();
  const applicationName = `structured-route-${input.mode}-${randomUUID()}`;
  databaseUrl.searchParams.set("application_name", applicationName);
  const child = spawn(process.execPath, [
    join(process.cwd(), "node_modules", "vitest", "vitest.mjs"),
    "run",
    "src/lib/task-execution-lifecycle.integration.test.ts",
    "--pool=threads",
    "--maxWorkers=1",
    "--no-file-parallelism",
    "-t",
    "process-level structured route fixture",
  ], {
    cwd: process.cwd(),
    env: {
      DATABASE_URL: databaseUrl.toString(),
      PGAPPNAME: applicationName,
      NODE_ENV: "test",
      PATH: process.env.PATH ?? "",
      HOME: process.env.HOME ?? "",
      WORKSPACE_PATH: process.env.WORKSPACE_PATH ?? "/home/runner/workspace",
      AI_PROVIDER_EGRESS_DISABLED: "1",
      RUN_CONTROLLED_RELEASE_VALIDATION: "1",
      DASHBOARD_E2E_TEST_MODE: "fixture",
      GROQ_API_KEY: "test-dummy-key-for-mocked-tests",
      STRUCTURED_ROUTE_PROCESS_CHILD: input.mode,
      STRUCTURED_ROUTE_PROCESS_TASK: input.task,
      STRUCTURED_ROUTE_PROCESS_PROJECT_ID: input.projectId,
      STRUCTURED_ROUTE_PROCESS_EXECUTION_ID: input.executionId ?? "",
      STRUCTURED_ROUTE_PROCESS_RESUME_TOKEN: input.resumeToken ?? "",
      STRUCTURED_ROUTE_PROCESS_READY_SIGNAL_FILE: input.readySignalFile ?? "",
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  let stdout = "";
  let stderr = "";
  child.stdout?.setEncoding("utf8");
  child.stderr?.setEncoding("utf8");
  child.stdout?.on("data", (chunk: string) => {
    stdout += chunk;
  });
  child.stderr?.on("data", (chunk: string) => {
    stderr += chunk;
  });
  const exit = new Promise<{ code: number | null; signal: NodeJS.Signals | null }>((resolveExit) => {
    child.once("exit", (code, signal) => resolveExit({ code, signal }));
  });
  const output = () => {
    const databaseUrlWithoutCredentials = `${databaseUrl.protocol}//${databaseUrl.hostname}${databaseUrl.pathname}`;
    let captured = `stdout=${stdout}; stderr=${stderr}`
      .replaceAll(databaseUrl.toString(), databaseUrlWithoutCredentials);
    if (databaseUrl.password) captured = captured.replaceAll(databaseUrl.password, "[redacted]");
    if (databaseUrl.username) captured = captured.replaceAll(databaseUrl.username, "[redacted]");
    return captured;
  };
  return { applicationName, child, exit, output };
}

type ChildProcessMonitor = {
  child: {
    exitCode: number | null;
    signalCode: NodeJS.Signals | null;
    kill: (signal: NodeJS.Signals) => boolean;
  };
  exit: Promise<{ code: number | null; signal: NodeJS.Signals | null }>;
  output: () => string;
};

async function waitForProcessSignalFile(
  path: string,
  processHandle: ChildProcessMonitor,
  timeoutMs = 60_000,
) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      return await readFile(path, "utf8");
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
    if (processHandle.child.exitCode !== null || processHandle.child.signalCode !== null) {
      throw new Error(`Child process exited before writing its signal; ${processHandle.output()}`);
    }
    await new Promise((resolveDelay) => setTimeout(resolveDelay, 100));
  }
  throw new Error(`Timed out waiting for child process signal; ${processHandle.output()}`);
}

async function waitForChildProcessExit(
  processHandle: ChildProcessMonitor,
  timeoutMs = 120_000,
) {
  const deadline = Date.now() + timeoutMs;
  while (processHandle.child.exitCode === null && processHandle.child.signalCode === null) {
    if (Date.now() >= deadline) {
      processHandle.child.kill("SIGKILL");
      await processHandle.exit;
      throw new Error(`Timed out waiting for child process exit; ${processHandle.output()}`);
    }
    await new Promise((resolveDelay) => setTimeout(resolveDelay, 100));
  }
  return processHandle.exit;
}

async function waitForChildDatabaseDisconnect(applicationName: string, timeoutMs = 30_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const result = await db.execute(sql`
      SELECT pid
      FROM pg_stat_activity
      WHERE application_name = ${applicationName}
        AND pid <> pg_backend_pid()
    `);
    const rows = (result as unknown as { rows?: Array<{ pid: number }> }).rows ?? [];
    if (rows.length === 0) return;
    await new Promise((resolveDelay) => setTimeout(resolveDelay, 100));
  }
  throw new Error(`Child PostgreSQL client did not disconnect: ${applicationName}`);
}

async function removeMissionRepairCandidateWorkspace(path: string | undefined) {
  if (!path) return;
  const absolutePath = resolve(path);
  if (
    dirname(absolutePath) !== "/tmp"
    || !basename(absolutePath).startsWith("engineeringos-validation-")
  ) {
    throw new Error("Refusing to remove an unrecognized Mission repair candidate workspace.");
  }
  await rm(absolutePath, { recursive: true, force: true });
}

async function waitForMissionRepairRecoveryLock(output: () => string) {
  const deadline = Date.now() + 60_000;
  while (Date.now() < deadline) {
    const result = await db.execute(sql`
      SELECT waiting.wait_event_type, waiting.query
      FROM pg_stat_activity AS waiting
      WHERE waiting.pid <> pg_backend_pid()
        AND waiting.datname = current_database()
        AND waiting.wait_event_type = 'Lock'
        AND cardinality(pg_blocking_pids(waiting.pid)) > 0
        AND waiting.query ILIKE '%update%'
        AND (
          waiting.query ILIKE '%ai_executions%'
          OR waiting.query ILIKE '%tasks%'
        )
    `);
    const rows = (result as unknown as {
      rows?: Array<{ wait_event_type: string | null; query: string | null }>;
    }).rows ?? [];
    const blocked = rows.find((row) =>
      row.wait_event_type === "Lock"
      && /(?:ai_executions|tasks)/i.test(row.query ?? "")
    );
    if (blocked?.query) return blocked.query;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(`Timed out waiting for Mission repair startup reconciliation to block; ${output()}`);
}

async function runMissionRepairStartupRecoveryWithProcessKill(taskId: string, executionId: string) {
  const lockAcquired = createDeferred<void>();
  const releaseRowLocks = createDeferred<void>();
  const lockTransaction = db.transaction(async (tx) => {
    await tx.execute(sql`SELECT id FROM tasks WHERE id = ${taskId} FOR UPDATE`);
    await tx.execute(sql`SELECT id FROM ai_executions WHERE id = ${executionId} FOR UPDATE`);
    lockAcquired.resolve();
    await releaseRowLocks.promise;
  });
  void lockTransaction.catch((error: unknown) => lockAcquired.reject(error));

  let firstStartup: ReturnType<typeof startApiStartupProcess> | undefined;
  let secondStartup: ReturnType<typeof startApiStartupProcess> | undefined;
  try {
    await lockAcquired.promise;
    const firstApplicationName = `mission-repair-recovery-kill-${randomUUID()}`;
    firstStartup = startApiStartupProcess(firstApplicationName);
    await waitForMissionRepairRecoveryLock(firstStartup.output);
    expect(firstStartup.child.kill("SIGKILL")).toBe(true);
    expect(await firstStartup.exit).toMatchObject({ code: null, signal: "SIGKILL" });
  } finally {
    releaseRowLocks.resolve();
    await lockTransaction;
    if (firstStartup && firstStartup.child.exitCode === null && firstStartup.child.signalCode === null) {
      firstStartup.child.kill("SIGKILL");
      await firstStartup.exit;
    }
  }

  secondStartup = startApiStartupProcess(`mission-repair-recovery-restart-${randomUUID()}`);
  try {
    await secondStartup.waitForReady();
  } finally {
    if (secondStartup.child.exitCode === null && secondStartup.child.signalCode === null) {
      secondStartup.child.kill("SIGKILL");
      await secondStartup.exit;
    }
  }
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
    missionRepairProcessFixture.candidateWorkspacePath = null;
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

  it("rejects a stale retry generation or execution pointer before creating an execution", async () => {
    const projectId = randomUUID();
    const taskId = randomUUID();
    const currentCorrelationId = randomUUID();
    const now = new Date();
    await db.insert(projectsTable).values({
      id: projectId,
      ownerId: "lifecycle-test-user",
      name: `lifecycle-stale-retry-${projectId.slice(0, 8)}`,
      rootPath: `/tmp/lifecycle-${projectId}`,
      language: "typescript",
      status: "active",
      createdAt: now,
      updatedAt: now,
    });
    await db.insert(tasksTable).values({
      id: taskId,
      projectId,
      title: "Stale retry generation fixture",
      prompt: "Reject execution from an old retry generation",
      status: "verifying",
      correlationId: currentCorrelationId,
      retryCount: 1,
      maxRetries: 3,
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
        expectedRetryCount: 0,
        expectedCorrelationId: currentCorrelationId,
      });

      expect(outcome).toMatchObject({
        ok: false,
        status: "conflict",
        errorCode: "task_state_changed",
      });
      const stalePointerOutcome = await executeTaskLifecycle({
        taskId,
        userId: "lifecycle-test-user",
        provider: { provider: "groq", apiKey: "fixture-provider" },
        trigger: "reconciliation",
        expectedStatuses: ["verifying"],
        expectedRetryCount: 1,
        expectedCorrelationId: randomUUID(),
      });
      expect(stalePointerOutcome).toMatchObject({
        ok: false,
        status: "conflict",
        errorCode: "task_state_changed",
      });
      expect(runAgentWithFallback).not.toHaveBeenCalled();
      const executions = await db
        .select({ id: aiExecutionsTable.id })
        .from(aiExecutionsTable)
        .where(eq(aiExecutionsTable.linkedTaskId, taskId));
      expect(executions).toEqual([]);
    } finally {
      await cleanupProjectExecutionData(projectId);
      await db.delete(tasksTable).where(eq(tasksTable.id, taskId));
      await db.delete(projectsTable).where(eq(projectsTable.id, projectId));
    }
  });

  it("rolls back resume token and execution claims when the Task pointer changes concurrently", async () => {
    const projectId = randomUUID();
    const taskId = randomUUID();
    const userId = "lifecycle-test-user";
    const currentCorrelationId = randomUUID();
    const replacementCorrelationId = randomUUID();
    const now = new Date();
    const runCountBefore = runAgentWithFallback.mock.calls.length;
    await db.insert(projectsTable).values({
      id: projectId,
      ownerId: userId,
      name: `lifecycle-resume-race-${projectId.slice(0, 8)}`,
      rootPath: `/tmp/lifecycle-${projectId}`,
      language: "typescript",
      status: "active",
      createdAt: now,
      updatedAt: now,
    });
    await db.insert(tasksTable).values({
      id: taskId,
      projectId,
      title: "Resume claim race fixture",
      prompt: "Do not start if the current execution pointer changes",
      status: "verifying",
      correlationId: currentCorrelationId,
      retryCount: 0,
      maxRetries: 2,
      createdAt: now,
      updatedAt: now,
    });

    try {
      const created = await aiExecutionState.createAiExecution({
        userId,
        projectId,
        linkedTaskId: taskId,
        idempotencyKey: `${taskId}:attempt:0`,
        correlationId: currentCorrelationId,
        request: {
          projectId,
          linkedTaskId: taskId,
          message: "Resume the current Task execution.",
          modelMessage: "Resume the current Task execution.",
          validationTargetPaths: [],
        },
      });
      await db.update(aiExecutionsTable)
        .set({ status: "failed", updatedAt: new Date() })
        .where(eq(aiExecutionsTable.id, created.execution.id));
      await db.insert(aiExecutionAcceptancesTable).values({
        id: randomUUID(),
        executionId: created.execution.id,
        projectId,
        attempt: created.execution.attempt,
        finalizationKey: randomUUID(),
        terminalStatus: "failed",
        outcome: "FAILED",
        reasonCode: "PROVIDER_FAILURE",
        nextActionCode: "RESUME_ALLOWED",
        disposition: {
          outcome: "FAILED",
          recoveryState: "REQUIRED",
          nextActionCode: "RESUME_ALLOWED",
          operatorAction: "Resume the saved task checkpoint.",
          reasonCodes: ["PROVIDER_FAILURE"],
        },
        resumable: 1,
      });
      const [beforeExecution] = await db
        .select({
          attempt: aiExecutionsTable.attempt,
          status: aiExecutionsTable.status,
          resumeTokenHash: aiExecutionsTable.resumeTokenHash,
          workerId: aiExecutionsTable.workerId,
        })
        .from(aiExecutionsTable)
        .where(eq(aiExecutionsTable.id, created.execution.id))
        .limit(1);

      let releaseBlocker!: () => void;
      let signalBlockerReady!: () => void;
      const blockerReady = new Promise<void>((resolveReady) => {
        signalBlockerReady = resolveReady;
      });
      const waitForRelease = new Promise<void>((resolveRelease) => {
        releaseBlocker = resolveRelease;
      });
      const blocker = db.transaction(async (tx) => {
        await tx.update(tasksTable)
          .set({ correlationId: replacementCorrelationId, updatedAt: new Date() })
          .where(eq(tasksTable.id, taskId));
        signalBlockerReady();
        await waitForRelease;
      });
      await blockerReady;

      const lifecyclePromise = executeTaskLifecycle({
        taskId,
        userId,
        provider: { provider: "groq", apiKey: "fixture-provider" },
        trigger: "manual",
        expectedStatuses: ["verifying"],
        expectedRetryCount: 0,
        expectedCorrelationId: currentCorrelationId,
        expectedResumeAttempt: created.execution.attempt,
        resumeExecutionId: created.execution.id,
      });
      let lockWaitError: unknown;
      try {
        await waitForTaskUpdateLock();
      } catch (error) {
        lockWaitError = error;
      } finally {
        releaseBlocker();
        await blocker;
      }
      if (lockWaitError) {
        await lifecyclePromise.catch(() => undefined);
        throw lockWaitError;
      }

      const outcome = await lifecyclePromise;
      expect(outcome).toMatchObject({
        ok: false,
        status: "conflict",
        errorCode: "task_state_changed",
      });
      const [task] = await db
        .select({
          status: tasksTable.status,
          correlationId: tasksTable.correlationId,
          workerId: tasksTable.workerId,
        })
        .from(tasksTable)
        .where(eq(tasksTable.id, taskId))
        .limit(1);
      expect(task).toEqual({
        status: "verifying",
        correlationId: replacementCorrelationId,
        workerId: null,
      });
      const [afterExecution] = await db
        .select({
          attempt: aiExecutionsTable.attempt,
          status: aiExecutionsTable.status,
          resumeTokenHash: aiExecutionsTable.resumeTokenHash,
          workerId: aiExecutionsTable.workerId,
        })
        .from(aiExecutionsTable)
        .where(eq(aiExecutionsTable.id, created.execution.id))
        .limit(1);
      expect(afterExecution).toEqual(beforeExecution);
      const episodes = await db
        .select({ id: aiAgentEpisodesTable.id })
        .from(aiAgentEpisodesTable)
        .where(eq(aiAgentEpisodesTable.executionId, created.execution.id));
      expect(episodes).toEqual([]);
      expect(runAgentWithFallback).toHaveBeenCalledTimes(runCountBefore);
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

  it.each(["analyze", "review"] as const)(
    "reconciles and resumes structured %s after an expired execution lease",
    async (task) => {
      const projectId = randomUUID();
      const userId = `structured-recovery-${task}-${projectId}`;
      const now = new Date();
      const prompt = task === "analyze"
        ? "Analyze the latest scan results."
        : "Review the supplied project files.";
      let original: Awaited<ReturnType<typeof startStructuredExecution>> | undefined;
      let resumed: Awaited<ReturnType<typeof startStructuredExecution>> | undefined;

      await db.insert(projectsTable).values({
        id: projectId,
        ownerId: userId,
        name: `structured-recovery-${task}-${projectId.slice(0, 8)}`,
        rootPath: `/tmp/structured-recovery-${projectId}`,
        language: "typescript",
        status: "active",
        createdAt: now,
        updatedAt: now,
      });

      try {
        original = await startStructuredExecution({
          userId,
          projectId,
          projectRevision: "b".repeat(64),
          task,
          prompt,
        });
        expect(original.started.resumable).toBe(false);
        original.cleanup();

        await db.update(aiExecutionsTable)
          .set({ leaseUntil: new Date(Date.now() - 1_000), updatedAt: new Date() })
          .where(eq(aiExecutionsTable.id, original.started.executionId));

        expect(await aiExecutionState.reconcileAiExecutions({ expiredOnly: true })).toBe(1);

        const [interrupted] = await db.select({
          status: aiExecutionsTable.status,
          attempt: aiExecutionsTable.attempt,
          workerId: aiExecutionsTable.workerId,
        }).from(aiExecutionsTable)
          .where(eq(aiExecutionsTable.id, original.started.executionId));
        expect(interrupted).toEqual({
          status: "paused",
          attempt: 0,
          workerId: null,
        });

        const [expiredAcceptance] = await db.select({
          outcome: aiExecutionAcceptancesTable.outcome,
          terminalStatus: aiExecutionAcceptancesTable.terminalStatus,
          reasonCode: aiExecutionAcceptancesTable.reasonCode,
          resumable: aiExecutionAcceptancesTable.resumable,
        }).from(aiExecutionAcceptancesTable)
          .where(and(
            eq(aiExecutionAcceptancesTable.executionId, original.started.executionId),
            eq(aiExecutionAcceptancesTable.attempt, 0),
          ));
        expect(expiredAcceptance).toMatchObject({
          outcome: "FAILED",
          terminalStatus: "paused",
          reasonCode: "EXECUTION_LEASE_EXPIRED",
          resumable: 1,
        });

        const recovery = await aiExecutionState.recoverAiExecutionResumeToken({
          executionId: original.started.executionId,
          userId,
          expectedAttempt: 0,
        });
        expect(recovery).toBeDefined();

        resumed = await startStructuredExecution({
          userId,
          projectId,
          projectRevision: "b".repeat(64),
          task,
          prompt,
          executionId: original.started.executionId,
          resumeToken: recovery!.resumeToken,
        });
        expect(resumed.started.resumable).toBe(true);
        expect(resumed.execution.attempt).toBe(1);

        const content = `Recovered ${task} fixture result.`;
        const messageId = await resumed.persistAssistant({
          content,
          outcome: "SUCCEEDED",
          toolTrace: `structured_recovery_${task}_fixture`,
        });
        expect(await resumed.complete({ messageId, content })).toBe(true);

        const [completed] = await db.select({
          status: aiExecutionsTable.status,
          attempt: aiExecutionsTable.attempt,
          workerId: aiExecutionsTable.workerId,
        }).from(aiExecutionsTable)
          .where(eq(aiExecutionsTable.id, original.started.executionId));
        expect(completed).toEqual({
          status: "completed",
          attempt: 1,
          workerId: null,
        });

        const [currentAcceptance] = await db.select({
          outcome: aiExecutionAcceptancesTable.outcome,
          terminalStatus: aiExecutionAcceptancesTable.terminalStatus,
        }).from(aiExecutionAcceptancesTable)
          .where(and(
            eq(aiExecutionAcceptancesTable.executionId, original.started.executionId),
            eq(aiExecutionAcceptancesTable.attempt, 1),
          ));
        expect(currentAcceptance).toEqual({
          outcome: "SUCCEEDED",
          terminalStatus: "completed",
        });

        const userMessages = await db.select({
          id: aiChatMessagesTable.id,
          turnIntent: aiChatMessagesTable.turnIntent,
        }).from(aiChatMessagesTable)
          .where(and(
            eq(aiChatMessagesTable.sessionId, original.started.sessionId),
            eq(aiChatMessagesTable.role, "user"),
          ));
        expect(userMessages).toHaveLength(1);
        expect(userMessages[0]?.turnIntent).toBe(
          task === "analyze" ? "STRUCTURED_ANALYZE" : "STRUCTURED_REVIEW",
        );
      } finally {
        original?.cleanup();
        resumed?.cleanup();
        await cleanupProjectExecutionData(projectId);
        await db.delete(aiChatSessionsTable).where(eq(aiChatSessionsTable.projectId, projectId));
        await db.delete(projectsTable).where(eq(projectsTable.id, projectId));
      }
    },
  );

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

  const taskRouteWorkerProcessChildTest =
    process.env.TASK_ROUTE_PROCESS_CHILD === "worker" ? it : it.skip;
  taskRouteWorkerProcessChildTest(
    "process-level AI task route worker fixture",
    async () => {
      const taskId = process.env.TASK_ROUTE_PROCESS_TASK_ID;
      const readySignalFile = process.env.TASK_ROUTE_PROCESS_READY_SIGNAL_FILE;
      if (!taskId || !readySignalFile) {
        throw new Error("AI task route worker child is missing its durable fixture identity.");
      }
      process.env.GROQ_API_KEY = "test-dummy-key-for-mocked-tests";
      runAgentWithFallback.mockImplementation(async () => {
        await writeFile(readySignalFile, JSON.stringify({
          taskId,
          stage: "model_call_pending",
        }), "utf8");
        return await new Promise<never>(() => {});
      });

      const response = await request(app).post(`/api/ai/tasks/${taskId}/execute`);
      throw new Error(
        `AI task route returned before the parent terminated its process: ${response.status} ${JSON.stringify(response.body)}`,
      );
    },
    120_000,
  );
  const taskRouteResumeProcessChildTest =
    process.env.TASK_ROUTE_PROCESS_CHILD === "resume" ? it : it.skip;
  taskRouteResumeProcessChildTest(
    "process-level AI task route resume fixture",
    async () => {
      const taskId = process.env.TASK_ROUTE_PROCESS_TASK_ID;
      if (!taskId) throw new Error("AI task route resume child is missing its task identity.");
      process.env.GROQ_API_KEY = "test-dummy-key-for-mocked-tests";
      runAgentWithFallback.mockResolvedValue({
        result: {
          summary: "Task completed after process recovery.",
          confidence: "high",
          steps: ["Resumed through the task HTTP route."],
          needsHumanReview: false,
        },
        effectiveProvider: "groq",
      });

      const response = await request(app).post(`/api/ai/tasks/${taskId}/resume`);
      expect(response.status).toBe(202);
      expect(["completed", "verifying"]).toContain(response.body.status);
    },
    120_000,
  );
  const taskRouteResumeWorkerProcessChildTest =
    process.env.TASK_ROUTE_PROCESS_CHILD === "resume-worker" ? it : it.skip;
  taskRouteResumeWorkerProcessChildTest(
    "process-level AI task route resume worker fixture",
    async () => {
      const taskId = process.env.TASK_ROUTE_PROCESS_TASK_ID;
      const readySignalFile = process.env.TASK_ROUTE_PROCESS_READY_SIGNAL_FILE;
      if (!taskId || !readySignalFile) {
        throw new Error("AI task route resume worker child is missing its durable fixture identity.");
      }
      process.env.GROQ_API_KEY = "test-dummy-key-for-mocked-tests";
      runAgentWithFallback.mockImplementation(async () => {
        await writeFile(readySignalFile, JSON.stringify({
          taskId,
          stage: "resumed_model_call_pending",
        }), "utf8");
        return await new Promise<never>(() => {});
      });

      const response = await request(app).post(`/api/ai/tasks/${taskId}/resume`);
      throw new Error(
        `AI task resume route returned before the parent terminated its process: ${response.status} ${JSON.stringify(response.body)}`,
      );
    },
    120_000,
  );

  const taskRouteAcceptedWorkerProcessChildTest =
    process.env.TASK_ROUTE_PROCESS_CHILD === "accepted-worker" ? it : it.skip;
  taskRouteAcceptedWorkerProcessChildTest(
    "process-level AI task route accepted worker fixture",
    async () => {
      const taskId = process.env.TASK_ROUTE_PROCESS_TASK_ID;
      if (!taskId) {
        throw new Error("AI task accepted worker is missing its task identity.");
      }
      process.env.GROQ_API_KEY = "test-dummy-key-for-mocked-tests";

      const response = await request(app).post(`/api/ai/tasks/${taskId}/execute`);
      throw new Error(
        `AI task route returned after acceptance but before the parent terminated its process: ${response.status} ${JSON.stringify(response.body)}`,
      );
    },
    120_000,
  );

  const manualTaskRouteWorkerProcessChildTest =
    process.env.TASK_ROUTE_PROCESS_CHILD === "manual-worker" ? it : it.skip;
  manualTaskRouteWorkerProcessChildTest(
    "process-level manual task route worker fixture",
    async () => {
      const taskId = process.env.TASK_ROUTE_PROCESS_TASK_ID;
      if (!taskId) throw new Error("Manual task route worker is missing its task identity.");

      const response = await request(app).post(`/api/tasks/${taskId}/execute`);
      const resultSignalFile = process.env.TASK_ROUTE_PROCESS_RESULT_SIGNAL_FILE;
      if (resultSignalFile) {
        const fs = await import("node:fs/promises");
        await fs.writeFile(resultSignalFile, JSON.stringify({
          status: response.status,
          body: response.body,
        }), "utf8");
        return;
      }
      throw new Error(
        `Manual task route returned before the parent terminated its process: ${response.status} ${JSON.stringify(response.body)}`,
      );
    },
    120_000,
  );

  const structuredRouteProcessChildMode = process.env.STRUCTURED_ROUTE_PROCESS_CHILD;
  const structuredRouteProcessChildTest =
    structuredRouteProcessChildMode === "worker" || structuredRouteProcessChildMode === "resume"
      ? it
      : it.skip;
  structuredRouteProcessChildTest(
    "process-level structured route fixture",
    async () => {
      const task = process.env.STRUCTURED_ROUTE_PROCESS_TASK;
      const projectId = process.env.STRUCTURED_ROUTE_PROCESS_PROJECT_ID;
      if (
        (task !== "analyze" && task !== "review")
        || !projectId
      ) {
        throw new Error("Structured route child process is missing its task or project identity.");
      }
      process.env.GROQ_API_KEY = "test-dummy-key-for-mocked-tests";
      const path = `/api/ai/projects/${projectId}/${task}/stream`;

      if (structuredRouteProcessChildMode === "worker") {
        const readySignalFile = process.env.STRUCTURED_ROUTE_PROCESS_READY_SIGNAL_FILE;
        if (!readySignalFile) {
          throw new Error("Structured route worker is missing its ready signal path.");
        }
        const executionStarted = createDeferred<{
          executionId: string;
          sessionId: string;
          resumeToken: string;
          resumable: boolean;
        }>();
        let parsedExecutionStarted = false;
        runAgentWithFallback.mockImplementation(async () => {
          const started = await executionStarted.promise;
          await writeFile(readySignalFile, JSON.stringify(started), "utf8");
          return await new Promise<never>(() => {});
        });

        const response = await request(app)
          .post(path)
          .set("Accept", "text/event-stream")
          .buffer(false)
          .parse((stream, callback) => {
            let body = "";
            stream.setEncoding("utf8");
            stream.on("data", (chunk: string) => {
              body += chunk;
              if (parsedExecutionStarted) return;
              for (const line of body.split(/\r?\n/)) {
                if (!line.startsWith("data: ")) continue;
                let event: unknown;
                try {
                  event = JSON.parse(line.slice("data: ".length));
                } catch {
                  continue;
                }
                if (
                  !event
                  || typeof event !== "object"
                  || (event as { type?: unknown }).type !== "execution_started"
                ) continue;
                const candidate = event as {
                  executionId?: unknown;
                  sessionId?: unknown;
                  resumeToken?: unknown;
                  resumable?: unknown;
                };
                if (
                  typeof candidate.executionId !== "string"
                  || typeof candidate.sessionId !== "string"
                  || typeof candidate.resumeToken !== "string"
                  || typeof candidate.resumable !== "boolean"
                ) {
                  throw new Error("Structured route omitted its initial execution resume identity.");
                }
                parsedExecutionStarted = true;
                executionStarted.resolve({
                  executionId: candidate.executionId,
                  sessionId: candidate.sessionId,
                  resumeToken: candidate.resumeToken,
                  resumable: candidate.resumable,
                });
                break;
              }
            });
            stream.on("end", () => callback(null, body));
          })
          .send(task === "review"
            ? { fileContents: { "src/fixture.ts": "export const value = 1;\n" } }
            : {});
        throw new Error(
          `Structured route returned before its parent terminated the worker: ${response.status}`,
        );
      }

      const executionId = process.env.STRUCTURED_ROUTE_PROCESS_EXECUTION_ID;
      const resumeToken = process.env.STRUCTURED_ROUTE_PROCESS_RESUME_TOKEN;
      if (!executionId || !resumeToken) {
        throw new Error("Structured route resume child is missing its execution identity.");
      }
      const result = task === "analyze"
        ? {
            summary: "Recovered structured analysis fixture.",
            confidence: "high",
            needsHumanReview: false,
            steps: ["Resumed after process recovery."],
            overallAssessment: "The execution resumed after API startup.",
          }
        : {
            summary: "Recovered structured review fixture.",
            confidence: "high",
            needsHumanReview: false,
            steps: ["Reviewed the supplied fixture file."],
            verdict: "approved",
            overallScore: 92,
            reviewScope: "provided_files",
          };
      runAgentWithFallback.mockResolvedValue({
        result,
        effectiveProvider: "groq",
      });
      const body = task === "review"
        ? {
            executionId,
            resumeToken,
            fileContents: { "src/fixture.ts": "export const value = 1;\n" },
          }
        : { executionId, resumeToken };
      const response = await request(app).post(path).send(body);
      expect(response.status).toBe(200);
      expect(response.text).toContain('"type":"task_done"');
    },
    120_000,
  );

  const missionRepairProcessChildMode = process.env.MISSION_REPAIR_PROCESS_CHILD;
  const missionRepairProcessChildTest =
    missionRepairProcessChildMode === "worker" || missionRepairProcessChildMode === "recovery"
      ? it
      : it.skip;
  missionRepairProcessChildTest(
    "process-level Mission repair worker fixture",
    async () => {
      const taskId = process.env.MISSION_REPAIR_PROCESS_TASK_ID;
      const userId = process.env.MISSION_REPAIR_PROCESS_USER_ID;
      const workspaceRevision = process.env.MISSION_REPAIR_PROCESS_WORKSPACE_REVISION;
      if (!taskId || !userId || !workspaceRevision) {
        throw new Error("Mission repair child process is missing its durable fixture identity.");
      }

      if (missionRepairProcessChildMode === "worker") {
        const readySignalFile = process.env.MISSION_REPAIR_READY_SIGNAL_FILE;
        const requestedCrashPhase = process.env.MISSION_REPAIR_PROCESS_CRASH_PHASE;
        if (
          requestedCrashPhase !== undefined
          && requestedCrashPhase !== "candidate_ready"
          && requestedCrashPhase !== "committed"
          && requestedCrashPhase !== "effect_classified"
        ) {
          throw new Error(`Unsupported Mission repair crash phase: ${requestedCrashPhase}`);
        }
        const crashPhase = requestedCrashPhase === "committed"
          ? "committed"
          : requestedCrashPhase === "effect_classified"
            ? "effect_classified"
            : "candidate_ready";
        if (!readySignalFile) {
          throw new Error("Mission repair worker child is missing its ready signal path.");
        }
        const candidateContent = "export const value = 'process-crashed-candidate';\n";
        chatWithFallback.mockImplementationOnce(async (...args: unknown[]) => {
          const baseParams = args[1] as {
            onMutationInvocation?: import("@workspace/ai-orchestrator").MutationToolInvocationCallback;
          };
          const invocation = {
            toolCallId: "provider-call-mission-worker-process-crash",
            toolName: "write_file" as const,
            path: "src/target.ts",
            inputHash: "d".repeat(64),
          };
          await baseParams.onMutationInvocation?.({ ...invocation, phase: "requested" });
          await baseParams.onMutationInvocation?.({ ...invocation, phase: "committed" });
          return {
            result: {
              response: "Prepared the candidate before the worker process was interrupted.",
              pendingChanges: [{ path: "src/target.ts", newContent: candidateContent }],
              sources: [],
            },
            effectiveProvider: "groq" as const,
          };
        });
        if (crashPhase === "committed") {
          runRepairValidation.mockImplementationOnce(async (...args: unknown[]) => ({
            status: "passed" as const,
            evidence: {
              evidenceId: "mission-repair-process-worker-validator-before-crash",
              artifactRef: "mission-repair-process-worker-validator-receipt",
              validatorProfile: String(args[1]),
            },
          }));
          vi.spyOn(effectObserver, "verifyAndPersistEffect").mockImplementationOnce(async (input) => {
            const [execution] = await db
              .select({ checkpoint: aiExecutionsTable.checkpoint })
              .from(aiExecutionsTable)
              .where(eq(aiExecutionsTable.id, input.executionId))
              .limit(1);
            if (!execution) throw new Error("Mission worker lost its execution before effect verification.");
            const checkpoint = JSON.parse(execution.checkpoint) as { detail: string };
            const detail = JSON.parse(checkpoint.detail) as {
              missionRepairRecovery: {
                attempt: number;
                candidateIdentity: string;
                executionId: string;
                phase: string;
                taskId: string;
                afterObservationId?: string;
              };
            };
            expect(detail.missionRepairRecovery).toMatchObject({
              attempt: 0,
              candidateIdentity: expect.any(String),
              executionId: input.executionId,
              phase: "committed",
              taskId,
              afterObservationId: expect.any(String),
            });
            const workspacePath = missionRepairProcessFixture.candidateWorkspacePath;
            if (!workspacePath) {
              throw new Error("Mission worker child did not retain its disposable candidate workspace path.");
            }
            await writeFile(readySignalFile, JSON.stringify({
              executionId: input.executionId,
              candidateIdentity: detail.missionRepairRecovery.candidateIdentity,
              attempt: detail.missionRepairRecovery.attempt,
              phase: detail.missionRepairRecovery.phase,
              taskId,
              candidateWorkspacePath: workspacePath,
            }), "utf8");
            return await new Promise<never>(() => {});
          });
        } else if (crashPhase === "effect_classified") {
          runRepairValidation.mockImplementationOnce(async (...args: unknown[]) => ({
            status: "passed" as const,
            evidence: {
              evidenceId: "mission-repair-process-worker-validator-before-finalization",
              artifactRef: "mission-repair-process-worker-validator-finalization-receipt",
              validatorProfile: String(args[1]),
            },
          }));
          const realCheckpointAiExecution = aiExecutionState.checkpointAiExecution;
          vi.spyOn(aiExecutionState, "checkpointAiExecution").mockImplementation(async (params) => {
            const checkpointed = await realCheckpointAiExecution(params);
            if (!checkpointed || !params.checkpoint.detail) return checkpointed;
            let recoveryManifest: {
              attempt: number;
              candidateIdentity: string;
              executionId: string;
              phase: string;
              afterObservationId?: string;
              effectBundleId?: string;
              effectObserved?: boolean;
            } | undefined;
            try {
              recoveryManifest = JSON.parse(params.checkpoint.detail).missionRepairRecovery;
            } catch {
              return checkpointed;
            }
            if (recoveryManifest?.phase !== "effect_classified") return checkpointed;
            const [execution] = await db
              .select({ checkpoint: aiExecutionsTable.checkpoint })
              .from(aiExecutionsTable)
              .where(eq(aiExecutionsTable.id, params.executionId))
              .limit(1);
            if (!execution) {
              throw new Error("Mission worker lost its execution after effect classification.");
            }
            const persistedDetail = JSON.parse(execution.checkpoint) as { detail: string };
            const persistedManifest = JSON.parse(persistedDetail.detail) as {
              missionRepairRecovery: typeof recoveryManifest;
            };
            expect(persistedManifest.missionRepairRecovery).toMatchObject({
              attempt: 0,
              candidateIdentity: expect.any(String),
              executionId: params.executionId,
              phase: "effect_classified",
              afterObservationId: expect.any(String),
              effectBundleId: expect.any(String),
              effectObserved: true,
            });
            const priorAcceptances = await db
              .select({ id: aiExecutionAcceptancesTable.id })
              .from(aiExecutionAcceptancesTable)
              .where(eq(aiExecutionAcceptancesTable.executionId, params.executionId));
            expect(priorAcceptances).toEqual([]);
            const workspacePath = missionRepairProcessFixture.candidateWorkspacePath;
            if (!workspacePath) {
              throw new Error("Mission worker child did not retain its disposable candidate workspace path.");
            }
            await writeFile(readySignalFile, JSON.stringify({
              executionId: params.executionId,
              candidateIdentity: persistedManifest.missionRepairRecovery?.candidateIdentity,
              attempt: persistedManifest.missionRepairRecovery?.attempt,
              phase: persistedManifest.missionRepairRecovery?.phase,
              taskId,
              candidateWorkspacePath: workspacePath,
              effectBundleId: persistedManifest.missionRepairRecovery?.effectBundleId,
            }), "utf8");
            return await new Promise<never>(() => {});
          });
        } else {
          runRepairValidation.mockImplementationOnce(async (...args: unknown[]) => {
            const evidenceContext = args[5] as { operationId: string };
            const [execution] = await db
              .select({ checkpoint: aiExecutionsTable.checkpoint })
              .from(aiExecutionsTable)
              .where(eq(aiExecutionsTable.id, evidenceContext.operationId))
              .limit(1);
            if (!execution) throw new Error("Mission worker child lost its durable execution.");
            const checkpoint = JSON.parse(execution.checkpoint) as { detail: string };
            const detail = JSON.parse(checkpoint.detail) as {
              missionRepairRecovery: {
                attempt: number;
                candidateIdentity: string;
                executionId: string;
                phase: string;
                taskId: string;
              };
            };
            expect(detail.missionRepairRecovery).toMatchObject({
              attempt: 0,
              executionId: evidenceContext.operationId,
              phase: "candidate_ready",
              taskId,
            });
            const workspacePath = missionRepairProcessFixture.candidateWorkspacePath;
            if (!workspacePath) {
              throw new Error("Mission worker child did not retain its disposable candidate workspace path.");
            }
            await writeFile(readySignalFile, JSON.stringify({
              executionId: evidenceContext.operationId,
              candidateIdentity: detail.missionRepairRecovery.candidateIdentity,
              attempt: detail.missionRepairRecovery.attempt,
              phase: detail.missionRepairRecovery.phase,
              taskId,
              candidateWorkspacePath: workspacePath,
            }), "utf8");
            return await new Promise<never>(() => {});
          });
        }

        await executeTaskLifecycle({
          taskId,
          userId,
          provider: { provider: "groq", apiKey: "fixture-provider" },
          trigger: "reconciliation",
          expectedStatuses: ["verifying"],
          workspaceRevision,
        });
        throw new Error("Mission worker returned before the parent could terminate the process.");
      }

      const executionId = process.env.MISSION_REPAIR_PROCESS_EXECUTION_ID;
      const requestedCrashPhase = process.env.MISSION_REPAIR_PROCESS_CRASH_PHASE;
      if (
        requestedCrashPhase !== undefined
        && requestedCrashPhase !== "candidate_ready"
        && requestedCrashPhase !== "committed"
        && requestedCrashPhase !== "effect_classified"
      ) {
        throw new Error(`Unsupported Mission repair crash phase: ${requestedCrashPhase}`);
      }
      const crashPhase = requestedCrashPhase === "committed"
        ? "committed"
        : requestedCrashPhase === "effect_classified"
          ? "effect_classified"
          : "candidate_ready";
      if (!executionId) {
        throw new Error("Mission repair recovery child is missing its execution identity.");
      }
      await reconcileStuckJobs();
      const [pausedExecution] = await db
        .select({
          attempt: aiExecutionsTable.attempt,
          checkpoint: aiExecutionsTable.checkpoint,
          status: aiExecutionsTable.status,
        })
        .from(aiExecutionsTable)
        .where(and(
          eq(aiExecutionsTable.id, executionId),
          eq(aiExecutionsTable.linkedTaskId, taskId),
        ))
        .limit(1);
      expect(pausedExecution).toBeDefined();
      if (!pausedExecution) throw new Error("Recovery child could not find the interrupted execution.");
      expect(pausedExecution).toMatchObject({ attempt: 0, status: "paused" });
      const checkpoint = JSON.parse(pausedExecution.checkpoint) as { detail: string };
      const detail = JSON.parse(checkpoint.detail) as {
        missionRepairRecovery: { attempt: number; phase: string; taskId: string };
      };
      expect(detail.missionRepairRecovery).toMatchObject({
        attempt: 0,
        phase: crashPhase,
        taskId,
      });
      const [interruptedAcceptance] = await db
        .select({
          outcome: aiExecutionAcceptancesTable.outcome,
          nextActionCode: aiExecutionAcceptancesTable.nextActionCode,
          resumable: aiExecutionAcceptancesTable.resumable,
        })
        .from(aiExecutionAcceptancesTable)
        .where(and(
          eq(aiExecutionAcceptancesTable.executionId, executionId),
          eq(aiExecutionAcceptancesTable.attempt, 0),
        ))
        .limit(1);
      expect(interruptedAcceptance).toMatchObject({
        outcome: "FAILED",
        nextActionCode: "RESUME_ALLOWED",
        resumable: 1,
      });

      const recovery = await aiExecutionState.recoverAiExecutionResumeToken({
        executionId,
        userId,
        linkedTaskId: taskId,
        expectedAttempt: 0,
      });
      expect(recovery).toBeDefined();
      if (!recovery) throw new Error("Recovery child did not receive a server-owned resume token.");
      runRepairValidation.mockImplementationOnce(async (...args: unknown[]) => ({
        status: "passed" as const,
        evidence: {
          evidenceId: "mission-repair-worker-process-validator-evidence",
          artifactRef: "mission-repair-worker-process-validator-pass",
          validatorProfile: String(args[1]),
        },
      }));
      const resumed = await executeTaskLifecycle({
        taskId,
        userId,
        provider: { provider: "groq", apiKey: "fixture-provider" },
        trigger: "reconciliation",
        expectedStatuses: ["verifying"],
        workspaceRevision,
        resumeExecutionId: executionId,
        resumeToken: recovery.resumeToken,
      });
      expect(resumed).toMatchObject({ ok: true, status: "completed", executionId });
      expect(chatWithFallback).not.toHaveBeenCalled();
      const [completedExecution] = await db
        .select({
          attempt: aiExecutionsTable.attempt,
          status: aiExecutionsTable.status,
        })
        .from(aiExecutionsTable)
        .where(eq(aiExecutionsTable.id, executionId))
        .limit(1);
      expect(completedExecution).toEqual({ attempt: 1, status: "completed" });
      const [completedAcceptance] = await db
        .select({
          outcome: aiExecutionAcceptancesTable.outcome,
          terminalStatus: aiExecutionAcceptancesTable.terminalStatus,
          resumable: aiExecutionAcceptancesTable.resumable,
        })
        .from(aiExecutionAcceptancesTable)
        .where(and(
          eq(aiExecutionAcceptancesTable.executionId, executionId),
          eq(aiExecutionAcceptancesTable.attempt, 1),
        ))
        .limit(1);
      expect(completedAcceptance).toEqual({
        outcome: "SUCCEEDED",
        terminalStatus: "completed",
        resumable: 0,
      });
      const materializationFailures = await drainPendingObservationMaterializations();
      expect(materializationFailures).toEqual([]);
    },
    180_000,
  );

  const structuredRouteProcessRecoveryTest =
    process.env.RUN_STRUCTURED_ROUTE_PROCESS_RECOVERY === "1" ? it : it.skip;
  for (const task of ["analyze", "review"] as const) {
    structuredRouteProcessRecoveryTest(
      `recovers the structured ${task} HTTP route after worker SIGKILL and API startup`,
      async () => {
        requireMissionRepairDisposableDatabaseUrl();
        const projectId = randomUUID();
        const now = new Date();
        let signalRoot: string | undefined;
        let workerProcess: ReturnType<typeof startStructuredRouteTestProcess> | undefined;
        let apiProcess: ReturnType<typeof startApiStartupProcess> | undefined;
        let resumeProcess: ReturnType<typeof startStructuredRouteTestProcess> | undefined;
        let executionId: string | undefined;
        let sessionId: string | undefined;
        let resumeToken: string | undefined;

        try {
          await db.insert(projectsTable).values({
            id: projectId,
            ownerId: "test-user",
            name: `structured-route-${task}-${projectId.slice(0, 8)}`,
            rootPath: process.cwd(),
            language: "typescript",
            status: "active",
            createdAt: now,
            updatedAt: now,
          });
          signalRoot = await mkdtemp(join("/tmp", `structured-route-${task}-`));
          const readySignalFile = join(signalRoot, "execution-started.json");
          workerProcess = startStructuredRouteTestProcess({
            mode: "worker",
            task,
            projectId,
            readySignalFile,
          });
          const started = JSON.parse(
            await waitForProcessSignalFile(readySignalFile, workerProcess),
          ) as {
            executionId: string;
            sessionId: string;
            resumeToken: string;
            resumable: boolean;
          };
          expect(started.resumable).toBe(false);
          expect(typeof started.executionId).toBe("string");
          expect(typeof started.sessionId).toBe("string");
          expect(typeof started.resumeToken).toBe("string");
          executionId = started.executionId;
          sessionId = started.sessionId;
          resumeToken = started.resumeToken;

          const [runningExecution] = await db
            .select({
              status: aiExecutionsTable.status,
              attempt: aiExecutionsTable.attempt,
              workerId: aiExecutionsTable.workerId,
              leaseUntil: aiExecutionsTable.leaseUntil,
              sessionId: aiExecutionsTable.sessionId,
            })
            .from(aiExecutionsTable)
            .where(and(
              eq(aiExecutionsTable.id, executionId),
              eq(aiExecutionsTable.projectId, projectId),
            ))
            .limit(1);
          expect(runningExecution).toMatchObject({
            status: "running",
            attempt: 0,
            workerId: expect.any(String),
            sessionId,
          });
          expect(runningExecution?.leaseUntil?.getTime()).toBeGreaterThan(Date.now());

          const userMessagesBeforeCrash = await db
            .select({ role: aiChatMessagesTable.role, turnIntent: aiChatMessagesTable.turnIntent })
            .from(aiChatMessagesTable)
            .where(eq(aiChatMessagesTable.sessionId, sessionId));
          expect(userMessagesBeforeCrash).toEqual([{
            role: "user",
            turnIntent: task === "analyze" ? "STRUCTURED_ANALYZE" : "STRUCTURED_REVIEW",
          }]);
          expect(await db.select()
            .from(aiExecutionAcceptancesTable)
            .where(eq(aiExecutionAcceptancesTable.executionId, executionId)))
            .toHaveLength(0);

          expect(workerProcess.child.kill("SIGKILL")).toBe(true);
          expect(await waitForChildProcessExit(workerProcess)).toMatchObject({
            code: null,
            signal: "SIGKILL",
          });
          await waitForChildDatabaseDisconnect(workerProcess.applicationName);
          workerProcess = undefined;

          const [expiredExecution] = await db
            .update(aiExecutionsTable)
            .set({ leaseUntil: new Date(Date.now() - 1), updatedAt: new Date() })
            .where(and(
              eq(aiExecutionsTable.id, executionId),
              eq(aiExecutionsTable.status, "running"),
              eq(aiExecutionsTable.attempt, 0),
            ))
            .returning({ id: aiExecutionsTable.id });
          expect(expiredExecution?.id).toBe(executionId);

          apiProcess = startApiStartupProcess(`structured-route-startup-${task}-${randomUUID()}`);
          await apiProcess.waitForReady();
          const recoveryDeadline = Date.now() + 60_000;
          let recoveredExecution: {
            status: string;
            attempt: number;
            workerId: string | null;
            leaseUntil: Date | null;
          } | undefined;
          while (Date.now() < recoveryDeadline) {
            const [current] = await db
              .select({
                status: aiExecutionsTable.status,
                attempt: aiExecutionsTable.attempt,
                workerId: aiExecutionsTable.workerId,
                leaseUntil: aiExecutionsTable.leaseUntil,
              })
              .from(aiExecutionsTable)
              .where(eq(aiExecutionsTable.id, executionId))
              .limit(1);
            if (current?.status === "paused") {
              recoveredExecution = current;
              break;
            }
            if (apiProcess.child.exitCode !== null || apiProcess.child.signalCode !== null) {
              throw new Error(`API startup process exited during structured recovery; ${apiProcess.output()}`);
            }
            await new Promise((resolveDelay) => setTimeout(resolveDelay, 100));
          }
          expect(recoveredExecution).toEqual({
            status: "paused",
            attempt: 0,
            workerId: null,
            leaseUntil: null,
          });

          const [expiredAcceptance] = await db
            .select({
              outcome: aiExecutionAcceptancesTable.outcome,
              terminalStatus: aiExecutionAcceptancesTable.terminalStatus,
              reasonCode: aiExecutionAcceptancesTable.reasonCode,
              nextActionCode: aiExecutionAcceptancesTable.nextActionCode,
              resumable: aiExecutionAcceptancesTable.resumable,
            })
            .from(aiExecutionAcceptancesTable)
            .where(and(
              eq(aiExecutionAcceptancesTable.executionId, executionId),
              eq(aiExecutionAcceptancesTable.attempt, 0),
            ))
            .limit(1);
          expect(expiredAcceptance).toEqual({
            outcome: "FAILED",
            terminalStatus: "paused",
            reasonCode: "EXECUTION_LEASE_EXPIRED",
            nextActionCode: "RESUME_ALLOWED",
            resumable: 1,
          });

          expect(apiProcess.child.kill("SIGKILL")).toBe(true);
          expect(await waitForChildProcessExit(apiProcess)).toMatchObject({
            code: null,
            signal: "SIGKILL",
          });
          await waitForChildDatabaseDisconnect(apiProcess.applicationName);
          apiProcess = undefined;

          resumeProcess = startStructuredRouteTestProcess({
            mode: "resume",
            task,
            projectId,
            executionId,
            resumeToken,
          });
          expect(await waitForChildProcessExit(resumeProcess), resumeProcess.output()).toEqual({
            code: 0,
            signal: null,
          });
          await waitForChildDatabaseDisconnect(resumeProcess.applicationName);

          const [completedExecution] = await db
            .select({
              status: aiExecutionsTable.status,
              attempt: aiExecutionsTable.attempt,
              workerId: aiExecutionsTable.workerId,
            })
            .from(aiExecutionsTable)
            .where(eq(aiExecutionsTable.id, executionId))
            .limit(1);
          expect(completedExecution).toEqual({
            status: "completed",
            attempt: 1,
            workerId: null,
          });

          const acceptanceHistory = await db
            .select({
              attempt: aiExecutionAcceptancesTable.attempt,
              outcome: aiExecutionAcceptancesTable.outcome,
              terminalStatus: aiExecutionAcceptancesTable.terminalStatus,
            })
            .from(aiExecutionAcceptancesTable)
            .where(eq(aiExecutionAcceptancesTable.executionId, executionId))
            .then((rows) => rows.sort((left, right) => left.attempt - right.attempt));
          expect(acceptanceHistory).toEqual([
            { attempt: 0, outcome: "FAILED", terminalStatus: "paused" },
            { attempt: 1, outcome: "SUCCEEDED", terminalStatus: "completed" },
          ]);

          const finalMessages = await db
            .select({
              role: aiChatMessagesTable.role,
              outcome: aiChatMessagesTable.outcome,
              turnIntent: aiChatMessagesTable.turnIntent,
            })
            .from(aiChatMessagesTable)
            .where(eq(aiChatMessagesTable.sessionId, sessionId));
          const userMessages = finalMessages.filter((message) => message.role === "user");
          const successfulAssistantMessages = finalMessages.filter(
            (message) => message.role === "assistant" && message.outcome === "SUCCEEDED",
          );
          expect(userMessages).toHaveLength(1);
          expect(userMessages[0]?.turnIntent).toBe(
            task === "analyze" ? "STRUCTURED_ANALYZE" : "STRUCTURED_REVIEW",
          );
          expect(successfulAssistantMessages).toHaveLength(1);

          const completionType = task === "analyze"
            ? "AiScanAnalysisCompleted"
            : "AiCodeReviewCompleted";
          const completionEvents = await db
            .select({ id: eventsTable.id })
            .from(eventsTable)
            .where(and(
              eq(eventsTable.projectId, projectId),
              eq(eventsTable.type, completionType),
            ));
          expect(completionEvents).toHaveLength(1);
          const completionAudits = await db
            .select({ action: auditLogsTable.action })
            .from(auditLogsTable)
            .where(and(
              eq(auditLogsTable.projectId, projectId),
              eq(auditLogsTable.action, task === "analyze" ? "ai_analyzed" : "ai_reviewed"),
            ));
          expect(completionAudits).toHaveLength(1);
        } finally {
          if (workerProcess) {
            if (workerProcess.child.exitCode === null && workerProcess.child.signalCode === null) {
              workerProcess.child.kill("SIGKILL");
            }
            await workerProcess.exit;
            await waitForChildDatabaseDisconnect(workerProcess.applicationName).catch(() => undefined);
          }
          if (apiProcess) {
            if (apiProcess.child.exitCode === null && apiProcess.child.signalCode === null) {
              apiProcess.child.kill("SIGKILL");
            }
            await apiProcess.exit;
            await waitForChildDatabaseDisconnect(apiProcess.applicationName).catch(() => undefined);
          }
          if (resumeProcess) {
            if (resumeProcess.child.exitCode === null && resumeProcess.child.signalCode === null) {
              resumeProcess.child.kill("SIGKILL");
            }
            await resumeProcess.exit;
            await waitForChildDatabaseDisconnect(resumeProcess.applicationName).catch(() => undefined);
          }
          await cleanupProjectExecutionData(projectId);
          await db.delete(aiChatSessionsTable).where(eq(aiChatSessionsTable.projectId, projectId));
          await db.delete(eventsTable).where(eq(eventsTable.projectId, projectId));
          await db.delete(auditLogsTable).where(eq(auditLogsTable.projectId, projectId));
          await db.delete(projectsTable).where(eq(projectsTable.id, projectId));
          if (signalRoot) await rm(signalRoot, { recursive: true, force: true });
        }
      },
      180_000,
    );
  }

  const taskRouteProcessRecoveryTest =
    process.env.RUN_TASK_ROUTE_PROCESS_RECOVERY === "1" ? it : it.skip;
  taskRouteProcessRecoveryTest(
    "recovers the HTTP AI task route after crashes during execute and resume attempts",
    async () => {
      requireMissionRepairDisposableDatabaseUrl();
      const projectId = randomUUID();
      const taskId = randomUUID();
      const now = new Date();
      let signalRoot: string | undefined;
      let workerProcess: ReturnType<typeof startTaskRouteTestProcess> | undefined;
      let apiProcess: ReturnType<typeof startApiStartupProcess> | undefined;
      let resumeWorkerProcess: ReturnType<typeof startTaskRouteTestProcess> | undefined;
      let resumeApiProcess: ReturnType<typeof startApiStartupProcess> | undefined;
      let resumeProcess: ReturnType<typeof startTaskRouteTestProcess> | undefined;
      let executionId: string | undefined;

      try {
        await db.insert(projectsTable).values({
          id: projectId,
          ownerId: "test-user",
          name: `task-route-crash-${projectId.slice(0, 8)}`,
          rootPath: process.cwd(),
          language: "typescript",
          status: "active",
          createdAt: now,
          updatedAt: now,
        });
        await db.insert(tasksTable).values({
          id: taskId,
          projectId,
          title: `AI task ${taskId.slice(0, 6)}`,
          description: "A task for the HTTP route crash-recovery fixture.",
          status: "pending",
          priority: "p2",
          createdAt: now,
          updatedAt: now,
        });
        signalRoot = await mkdtemp(join("/tmp", "ai-task-route-crash-"));
        const readySignalFile = join(signalRoot, "worker-ready.json");
        workerProcess = startTaskRouteTestProcess({ mode: "worker", taskId, readySignalFile });
        const ready = JSON.parse(await waitForProcessSignalFile(readySignalFile, workerProcess)) as {
          taskId: string;
          stage: string;
        };
        expect(ready).toEqual({ taskId, stage: "model_call_pending" });
        const [claimedTask] = await db
          .select({ status: tasksTable.status })
          .from(tasksTable)
          .where(eq(tasksTable.id, taskId))
          .limit(1);
        expect(claimedTask?.status).toBe("running");
        const [claimedExecution] = await db
          .select()
          .from(aiExecutionsTable)
          .where(eq(aiExecutionsTable.linkedTaskId, taskId))
          .limit(1);
        executionId = claimedExecution?.id;
        expect(executionId).toBeTruthy();
        expect(claimedExecution).toMatchObject({
          linkedTaskId: taskId,
          attempt: 0,
          status: "running",
        });
        const beforeCrashAcceptances = await db
          .select()
          .from(aiExecutionAcceptancesTable)
          .where(eq(aiExecutionAcceptancesTable.executionId, executionId));
        expect(beforeCrashAcceptances).toHaveLength(0);

        expect(workerProcess.child.kill("SIGKILL")).toBe(true);
        expect(await waitForChildProcessExit(workerProcess)).toMatchObject({
          code: null,
          signal: "SIGKILL",
        });
        await waitForChildDatabaseDisconnect(workerProcess.applicationName);

        const expiredAt = new Date(Date.now() - 60_000);
        await db.update(aiExecutionsTable).set({
          leaseUntil: expiredAt,
          updatedAt: new Date(),
        }).where(eq(aiExecutionsTable.id, executionId));
        await db.update(tasksTable).set({
          leaseUntil: expiredAt,
          updatedAt: new Date(),
        }).where(eq(tasksTable.id, taskId));

        apiProcess = startApiStartupProcess(`ai-task-route-recovery-${randomUUID()}`);
        await apiProcess.waitForReady();

        const [recoveredExecution] = await db
          .select()
          .from(aiExecutionsTable)
          .where(eq(aiExecutionsTable.id, executionId))
          .limit(1);
        expect(recoveredExecution).toMatchObject({
          linkedTaskId: taskId,
          attempt: 0,
          status: "paused",
          workerId: null,
          leaseUntil: null,
        });
        const recoveryAcceptances = await db
          .select()
          .from(aiExecutionAcceptancesTable)
          .where(eq(aiExecutionAcceptancesTable.executionId, executionId));
        expect(recoveryAcceptances).toHaveLength(1);
        expect(recoveryAcceptances[0]).toMatchObject({
          attempt: 0,
          terminalStatus: "paused",
          outcome: "FAILED",
          reasonCode: "EXECUTION_LEASE_EXPIRED",
          nextActionCode: "RESUME_ALLOWED",
          resumable: 1,
          disposition: expect.objectContaining({ recoveryState: "REQUIRED" }),
        });
        expect(recoveryAcceptances.some((acceptance) => acceptance.outcome === "SUCCEEDED")).toBe(false);

        const [recoveredTask] = await db
          .select({ status: tasksTable.status })
          .from(tasksTable)
          .where(eq(tasksTable.id, taskId))
          .limit(1);
        expect(["pending", "queued", "verifying"]).toContain(recoveredTask?.status);
        const taskEvents = await db
          .select({ type: eventsTable.type })
          .from(eventsTable)
          .where(eq(eventsTable.taskId, taskId));
        expect(taskEvents.some((event) => event.type === "TaskCompleted")).toBe(false);

        expect(apiProcess.child.kill("SIGKILL")).toBe(true);
        expect(await waitForChildProcessExit(apiProcess)).toMatchObject({
          code: null,
          signal: "SIGKILL",
        });
        await waitForChildDatabaseDisconnect(apiProcess.applicationName);
        apiProcess = undefined;

        const resumeWorkerReadyFile = join(signalRoot, "resume-worker-ready.json");
        resumeWorkerProcess = startTaskRouteTestProcess({
          mode: "resume-worker",
          taskId,
          readySignalFile: resumeWorkerReadyFile,
        });
        const resumeWorkerReady = JSON.parse(
          await waitForProcessSignalFile(resumeWorkerReadyFile, resumeWorkerProcess),
        ) as { taskId: string; stage: string };
        expect(resumeWorkerReady).toEqual({
          taskId,
          stage: "resumed_model_call_pending",
        });

        const [resumingExecution] = await db
          .select({
            attempt: aiExecutionsTable.attempt,
            status: aiExecutionsTable.status,
            workerId: aiExecutionsTable.workerId,
          })
          .from(aiExecutionsTable)
          .where(eq(aiExecutionsTable.id, executionId))
          .limit(1);
        expect(resumingExecution).toMatchObject({
          attempt: 1,
          status: "running",
          workerId: expect.any(String),
        });
        const beforeResumeCrashAcceptances = await db
          .select({
            attempt: aiExecutionAcceptancesTable.attempt,
            outcome: aiExecutionAcceptancesTable.outcome,
          })
          .from(aiExecutionAcceptancesTable)
          .where(eq(aiExecutionAcceptancesTable.executionId, executionId));
        expect(beforeResumeCrashAcceptances).toEqual([
          expect.objectContaining({ attempt: 0, outcome: "FAILED" }),
        ]);
        const [runningResumeTask] = await db
          .select({ status: tasksTable.status })
          .from(tasksTable)
          .where(eq(tasksTable.id, taskId))
          .limit(1);
        expect(runningResumeTask?.status).toBe("running");
        const preResumeCrashEvents = await db
          .select({ type: eventsTable.type })
          .from(eventsTable)
          .where(eq(eventsTable.taskId, taskId));
        expect(preResumeCrashEvents.some((event) => event.type === "TaskCompleted")).toBe(false);

        expect(resumeWorkerProcess.child.kill("SIGKILL")).toBe(true);
        expect(await waitForChildProcessExit(resumeWorkerProcess)).toMatchObject({
          code: null,
          signal: "SIGKILL",
        });
        await waitForChildDatabaseDisconnect(resumeWorkerProcess.applicationName);
        resumeWorkerProcess = undefined;
        const resumeExpiredAt = new Date(Date.now() - 60_000);
        await db.update(aiExecutionsTable).set({
          leaseUntil: resumeExpiredAt,
          updatedAt: new Date(),
        }).where(eq(aiExecutionsTable.id, executionId));
        await db.update(tasksTable).set({
          leaseUntil: resumeExpiredAt,
          updatedAt: new Date(),
        }).where(eq(tasksTable.id, taskId));

        resumeApiProcess = startApiStartupProcess(`ai-task-resume-recovery-${randomUUID()}`);
        await resumeApiProcess.waitForReady();
        const [recoveredResumeExecution] = await db
          .select({
            attempt: aiExecutionsTable.attempt,
            status: aiExecutionsTable.status,
            workerId: aiExecutionsTable.workerId,
            leaseUntil: aiExecutionsTable.leaseUntil,
          })
          .from(aiExecutionsTable)
          .where(eq(aiExecutionsTable.id, executionId))
          .limit(1);
        expect(recoveredResumeExecution).toEqual({
          attempt: 1,
          status: "paused",
          workerId: null,
          leaseUntil: null,
        });
        const resumedCrashAcceptance = await db
          .select({
            attempt: aiExecutionAcceptancesTable.attempt,
            terminalStatus: aiExecutionAcceptancesTable.terminalStatus,
            outcome: aiExecutionAcceptancesTable.outcome,
            reasonCode: aiExecutionAcceptancesTable.reasonCode,
            nextActionCode: aiExecutionAcceptancesTable.nextActionCode,
            resumable: aiExecutionAcceptancesTable.resumable,
          })
          .from(aiExecutionAcceptancesTable)
          .where(and(
            eq(aiExecutionAcceptancesTable.executionId, executionId),
            eq(aiExecutionAcceptancesTable.attempt, 1),
          ))
          .limit(1);
        expect(resumedCrashAcceptance[0]).toMatchObject({
          attempt: 1,
          terminalStatus: "paused",
          outcome: "FAILED",
          reasonCode: "EXECUTION_LEASE_EXPIRED",
          nextActionCode: "RESUME_ALLOWED",
          resumable: 1,
        });
        const allResumeCrashAcceptances = await db
          .select({
            attempt: aiExecutionAcceptancesTable.attempt,
            outcome: aiExecutionAcceptancesTable.outcome,
          })
          .from(aiExecutionAcceptancesTable)
          .where(eq(aiExecutionAcceptancesTable.executionId, executionId))
          .then((acceptances) => acceptances.sort((left, right) => left.attempt - right.attempt));
        expect(allResumeCrashAcceptances).toEqual([
          expect.objectContaining({ attempt: 0, outcome: "FAILED" }),
          expect.objectContaining({ attempt: 1, outcome: "FAILED" }),
        ]);
        expect(allResumeCrashAcceptances.some((acceptance) => acceptance.outcome === "SUCCEEDED"))
          .toBe(false);
        const [recoveredResumeTask] = await db
          .select({ status: tasksTable.status })
          .from(tasksTable)
          .where(eq(tasksTable.id, taskId))
          .limit(1);
        expect(["pending", "queued", "verifying"]).toContain(recoveredResumeTask?.status);
        const eventsAfterResumeCrash = await db
          .select({ type: eventsTable.type })
          .from(eventsTable)
          .where(eq(eventsTable.taskId, taskId));
        expect(eventsAfterResumeCrash.some((event) => event.type === "TaskCompleted")).toBe(false);

        expect(resumeApiProcess.child.kill("SIGKILL")).toBe(true);
        expect(await waitForChildProcessExit(resumeApiProcess)).toMatchObject({
          code: null,
          signal: "SIGKILL",
        });
        await waitForChildDatabaseDisconnect(resumeApiProcess.applicationName);
        resumeApiProcess = undefined;

        resumeProcess = startTaskRouteTestProcess({ mode: "resume", taskId });
        expect(await waitForChildProcessExit(resumeProcess), resumeProcess.output()).toEqual({
          code: 0,
          signal: null,
        });
        await waitForChildDatabaseDisconnect(resumeProcess.applicationName);
        const [completedExecution] = await db
          .select({
            attempt: aiExecutionsTable.attempt,
            status: aiExecutionsTable.status,
          })
          .from(aiExecutionsTable)
          .where(eq(aiExecutionsTable.id, executionId))
          .limit(1);
        expect(completedExecution).toEqual({ attempt: 2, status: "completed" });
        const [completedAcceptance] = await db
          .select({
            attempt: aiExecutionAcceptancesTable.attempt,
            outcome: aiExecutionAcceptancesTable.outcome,
            terminalStatus: aiExecutionAcceptancesTable.terminalStatus,
          })
          .from(aiExecutionAcceptancesTable)
          .where(and(
            eq(aiExecutionAcceptancesTable.executionId, executionId),
            eq(aiExecutionAcceptancesTable.attempt, 2),
          ))
          .limit(1);
        expect(completedAcceptance).toEqual({
          attempt: 2,
          outcome: "SUCCEEDED",
          terminalStatus: "completed",
        });
        const finalAcceptanceHistory = await db
          .select({
            attempt: aiExecutionAcceptancesTable.attempt,
            outcome: aiExecutionAcceptancesTable.outcome,
            terminalStatus: aiExecutionAcceptancesTable.terminalStatus,
          })
          .from(aiExecutionAcceptancesTable)
          .where(eq(aiExecutionAcceptancesTable.executionId, executionId))
          .then((acceptances) => acceptances.sort((left, right) => left.attempt - right.attempt));
        expect(finalAcceptanceHistory).toEqual([
          { attempt: 0, outcome: "FAILED", terminalStatus: "paused" },
          { attempt: 1, outcome: "FAILED", terminalStatus: "paused" },
          { attempt: 2, outcome: "SUCCEEDED", terminalStatus: "completed" },
        ]);
        const [completedTask] = await db
          .select({ status: tasksTable.status })
          .from(tasksTable)
          .where(eq(tasksTable.id, taskId))
          .limit(1);
        expect(completedTask?.status).toBe("completed");
        const completedEvents = await db
          .select({ type: eventsTable.type })
          .from(eventsTable)
          .where(eq(eventsTable.taskId, taskId));
        expect(completedEvents.some((event) => event.type === "TaskCompleted")).toBe(true);
      } finally {
        if (workerProcess) {
          if (workerProcess.child.exitCode === null && workerProcess.child.signalCode === null) {
            workerProcess.child.kill("SIGKILL");
          }
          await workerProcess.exit;
          await waitForChildDatabaseDisconnect(workerProcess.applicationName).catch(() => undefined);
        }
        if (apiProcess) {
          if (apiProcess.child.exitCode === null && apiProcess.child.signalCode === null) {
            apiProcess.child.kill("SIGKILL");
          }
          await apiProcess.exit;
          await waitForChildDatabaseDisconnect(apiProcess.applicationName).catch(() => undefined);
        }
        if (resumeWorkerProcess) {
          if (
            resumeWorkerProcess.child.exitCode === null
            && resumeWorkerProcess.child.signalCode === null
          ) {
            resumeWorkerProcess.child.kill("SIGKILL");
          }
          await resumeWorkerProcess.exit;
          await waitForChildDatabaseDisconnect(resumeWorkerProcess.applicationName).catch(() => undefined);
        }
        if (resumeApiProcess) {
          if (resumeApiProcess.child.exitCode === null && resumeApiProcess.child.signalCode === null) {
            resumeApiProcess.child.kill("SIGKILL");
          }
          await resumeApiProcess.exit;
          await waitForChildDatabaseDisconnect(resumeApiProcess.applicationName).catch(() => undefined);
        }
        if (resumeProcess) {
          if (resumeProcess.child.exitCode === null && resumeProcess.child.signalCode === null) {
            resumeProcess.child.kill("SIGKILL");
          }
          await resumeProcess.exit;
          await waitForChildDatabaseDisconnect(resumeProcess.applicationName).catch(() => undefined);
        }
        await cleanupProjectExecutionData(projectId);
        await db.delete(taskLogsTable).where(eq(taskLogsTable.taskId, taskId));
        await db.delete(eventsTable).where(eq(eventsTable.taskId, taskId));
        await db.delete(tasksTable).where(eq(tasksTable.id, taskId));
        await db.delete(projectsTable).where(eq(projectsTable.id, projectId));
        if (signalRoot) await rm(signalRoot, { recursive: true, force: true });
      }
    },
    180_000,
  );

  const taskRouteAcceptanceCrashTest =
    process.env.RUN_TASK_ROUTE_ACCEPTANCE_CRASH === "1" ? it : it.skip;
  taskRouteAcceptanceCrashTest(
    "preserves an accepted HTTP AI task when the process crashes before its response",
    async () => {
      requireMissionRepairDisposableDatabaseUrl();
      const projectId = randomUUID();
      const taskId = randomUUID();
      const now = new Date();
      let signalRoot: string | undefined;
      let workerProcess: ReturnType<typeof startTaskRouteTestProcess> | undefined;
      let apiProcess: ReturnType<typeof startApiStartupProcess> | undefined;

      try {
        await db.insert(projectsTable).values({
          id: projectId,
          ownerId: "test-user",
          name: `task-route-accepted-crash-${projectId.slice(0, 8)}`,
          rootPath: process.cwd(),
          language: "typescript",
          status: "active",
          createdAt: now,
          updatedAt: now,
        });
        await db.insert(tasksTable).values({
          id: taskId,
          projectId,
          title: `Accepted AI task ${taskId.slice(0, 6)}`,
          description: "A task for the post-acceptance HTTP crash fixture.",
          status: "pending",
          priority: "p2",
          createdAt: now,
          updatedAt: now,
        });

        signalRoot = await mkdtemp(join("/tmp", "ai-task-route-accepted-crash-"));
        const readySignalFile = join(signalRoot, "accepted-worker-ready.json");
        workerProcess = startTaskRouteTestProcess({
          mode: "accepted-worker",
          taskId,
          readySignalFile,
        });
        const ready = JSON.parse(
          await waitForProcessSignalFile(readySignalFile, workerProcess),
        ) as { executionId: string; stage: string };
        expect(ready).toMatchObject({
          stage: "acceptance_committed_before_http_response",
          executionId: expect.any(String),
        });

        const [acceptedExecution] = await db
          .select({
            id: aiExecutionsTable.id,
            attempt: aiExecutionsTable.attempt,
            status: aiExecutionsTable.status,
          })
          .from(aiExecutionsTable)
          .where(eq(aiExecutionsTable.linkedTaskId, taskId))
          .limit(1);
        expect(acceptedExecution).toEqual({
          id: ready.executionId,
          attempt: 0,
          status: "completed",
        });
        const acceptedRows = await db
          .select({
            attempt: aiExecutionAcceptancesTable.attempt,
            outcome: aiExecutionAcceptancesTable.outcome,
            terminalStatus: aiExecutionAcceptancesTable.terminalStatus,
          })
          .from(aiExecutionAcceptancesTable)
          .where(eq(aiExecutionAcceptancesTable.executionId, ready.executionId));
        expect(acceptedRows).toEqual([{
          attempt: 0,
          outcome: "SUCCEEDED",
          terminalStatus: "completed",
        }]);
        const [acceptedTask] = await db
          .select({ status: tasksTable.status })
          .from(tasksTable)
          .where(eq(tasksTable.id, taskId))
          .limit(1);
        expect(acceptedTask?.status).toBe("completed");
        const completedEventsBeforeCrash = await db
          .select({ type: eventsTable.type })
          .from(eventsTable)
          .where(and(
            eq(eventsTable.taskId, taskId),
            eq(eventsTable.type, "TaskCompleted"),
          ));
        expect(completedEventsBeforeCrash).toHaveLength(1);

        expect(workerProcess.child.kill("SIGKILL")).toBe(true);
        expect(await waitForChildProcessExit(workerProcess)).toMatchObject({
          code: null,
          signal: "SIGKILL",
        });
        await waitForChildDatabaseDisconnect(workerProcess.applicationName);
        workerProcess = undefined;

        apiProcess = startApiStartupProcess(`ai-task-accepted-recovery-${randomUUID()}`);
        await apiProcess.waitForReady();

        const [recoveredExecution] = await db
          .select({
            id: aiExecutionsTable.id,
            attempt: aiExecutionsTable.attempt,
            status: aiExecutionsTable.status,
          })
          .from(aiExecutionsTable)
          .where(eq(aiExecutionsTable.linkedTaskId, taskId))
          .limit(1);
        expect(recoveredExecution).toEqual(acceptedExecution);
        const recoveredAcceptanceRows = await db
          .select({
            attempt: aiExecutionAcceptancesTable.attempt,
            outcome: aiExecutionAcceptancesTable.outcome,
            terminalStatus: aiExecutionAcceptancesTable.terminalStatus,
          })
          .from(aiExecutionAcceptancesTable)
          .where(eq(aiExecutionAcceptancesTable.executionId, ready.executionId));
        expect(recoveredAcceptanceRows).toEqual(acceptedRows);
        const [recoveredTask] = await db
          .select({ status: tasksTable.status })
          .from(tasksTable)
          .where(eq(tasksTable.id, taskId))
          .limit(1);
        expect(recoveredTask?.status).toBe("completed");
        const completedEventsAfterStartup = await db
          .select({ type: eventsTable.type })
          .from(eventsTable)
          .where(and(
            eq(eventsTable.taskId, taskId),
            eq(eventsTable.type, "TaskCompleted"),
          ));
        expect(completedEventsAfterStartup).toHaveLength(1);

        const recoveredResponse = await request(app).get(`/api/tasks/${taskId}`);
        expect(recoveredResponse.status).toBe(200);
        expect(recoveredResponse.body).toMatchObject({
          id: taskId,
          status: "completed",
          acceptance: {
            attempt: 0,
            outcome: "SUCCEEDED",
            terminalStatus: "completed",
          },
        });
      } finally {
        if (workerProcess) {
          if (workerProcess.child.exitCode === null && workerProcess.child.signalCode === null) {
            workerProcess.child.kill("SIGKILL");
          }
          await workerProcess.exit;
          await waitForChildDatabaseDisconnect(workerProcess.applicationName).catch(() => undefined);
        }
        if (apiProcess) {
          if (apiProcess.child.exitCode === null && apiProcess.child.signalCode === null) {
            apiProcess.child.kill("SIGKILL");
          }
          await apiProcess.exit;
          await waitForChildDatabaseDisconnect(apiProcess.applicationName).catch(() => undefined);
        }
        await cleanupProjectExecutionData(projectId);
        await db.delete(taskLogsTable).where(eq(taskLogsTable.taskId, taskId));
        await db.delete(eventsTable).where(eq(eventsTable.taskId, taskId));
        await db.delete(tasksTable).where(eq(tasksTable.id, taskId));
        await db.delete(projectsTable).where(eq(projectsTable.id, projectId));
        if (signalRoot) await rm(signalRoot, { recursive: true, force: true });
      }
    },
    180_000,
  );

  const manualTaskRouteProcessRecoveryTest =
    process.env.RUN_MANUAL_TASK_ROUTE_PROCESS_RECOVERY === "1" ? it : it.skip;
  manualTaskRouteProcessRecoveryTest(
    "recovers a manual task execution after a crash during verification",
    async () => {
      requireMissionRepairDisposableDatabaseUrl();
      const projectId = randomUUID();
      const taskId = randomUUID();
      const now = new Date();
      let signalRoot: string | undefined;
      let workerProcess: ReturnType<typeof startTaskRouteTestProcess> | undefined;
      let apiProcess: ReturnType<typeof startApiStartupProcess> | undefined;

      try {
        await db.insert(projectsTable).values({
          id: projectId,
          ownerId: "test-user",
          name: `manual-task-crash-${projectId.slice(0, 8)}`,
          rootPath: process.cwd(),
          language: "typescript",
          status: "active",
          createdAt: now,
          updatedAt: now,
        });
        await db.insert(tasksTable).values({
          id: taskId,
          projectId,
          title: `Manual task ${taskId.slice(0, 6)}`,
          description: "A task for manual verification process recovery.",
          status: "pending",
          priority: "p2",
          retryCount: 0,
          maxRetries: 2,
          createdAt: now,
          updatedAt: now,
        });

        signalRoot = await mkdtemp(join("/tmp", "manual-task-route-crash-"));
        const readySignalFile = join(signalRoot, "verification-pending.json");
        workerProcess = startTaskRouteTestProcess({
          mode: "manual-worker",
          taskId,
          readySignalFile,
        });
        const ready = JSON.parse(
          await waitForProcessSignalFile(readySignalFile, workerProcess),
        ) as { taskId: string; stage: string };
        expect(ready).toEqual({ taskId, stage: "verification_pending" });

        const [runningTask] = await db
          .select({
            status: tasksTable.status,
            retryCount: tasksTable.retryCount,
            workerId: tasksTable.workerId,
            leaseUntil: tasksTable.leaseUntil,
            lastHeartbeatAt: tasksTable.lastHeartbeatAt,
          })
          .from(tasksTable)
          .where(eq(tasksTable.id, taskId))
          .limit(1);
        expect(runningTask).toMatchObject({
          status: "running",
          retryCount: 0,
          workerId: expect.any(String),
        });
        if (!runningTask?.workerId) throw new Error("Manual task worker did not claim a lease.");
        const crashedWorkerId = runningTask.workerId;
        expect(runningTask.leaseUntil).toBeInstanceOf(Date);
        expect(runningTask.leaseUntil?.getTime()).toBeGreaterThan(Date.now());
        expect(runningTask.lastHeartbeatAt).toBeInstanceOf(Date);
        const startedEventsBeforeCrash = await db
          .select({ type: eventsTable.type })
          .from(eventsTable)
          .where(eq(eventsTable.taskId, taskId));
        expect(startedEventsBeforeCrash).toEqual([{ type: "TaskExecutionStarted" }]);
        const startedLogsBeforeCrash = await db
          .select({ message: taskLogsTable.message })
          .from(taskLogsTable)
          .where(eq(taskLogsTable.taskId, taskId));
        expect(startedLogsBeforeCrash).toEqual([{
          message: "Task execution started — running verification against project root",
        }]);

        expect(workerProcess.child.kill("SIGKILL")).toBe(true);
        expect(await waitForChildProcessExit(workerProcess)).toMatchObject({
          code: null,
          signal: "SIGKILL",
        });
        await waitForChildDatabaseDisconnect(workerProcess.applicationName);
        workerProcess = undefined;

        const [expiredTask] = await db
          .update(tasksTable)
          .set({ leaseUntil: new Date(Date.now() - 1), updatedAt: new Date() })
          .where(and(
            eq(tasksTable.id, taskId),
            eq(tasksTable.status, "running"),
            eq(tasksTable.workerId, crashedWorkerId),
          ))
          .returning({ id: tasksTable.id });
        expect(expiredTask?.id).toBe(taskId);

        apiProcess = startApiStartupProcess(`manual-task-recovery-${randomUUID()}`);
        await apiProcess.waitForReady();

        const [recoveredTask] = await db
          .select({
            status: tasksTable.status,
            retryCount: tasksTable.retryCount,
            workerId: tasksTable.workerId,
            leaseUntil: tasksTable.leaseUntil,
          })
          .from(tasksTable)
          .where(eq(tasksTable.id, taskId))
          .limit(1);
        expect(recoveredTask).toEqual({
          status: "verifying",
          retryCount: 1,
          workerId: null,
          leaseUntil: null,
        });
        const recoveredEvents = await db
          .select({ type: eventsTable.type })
          .from(eventsTable)
          .where(eq(eventsTable.taskId, taskId));
        expect(recoveredEvents).toEqual([{ type: "TaskExecutionStarted" }]);
        const recoveredLogs = await db
          .select({ message: taskLogsTable.message })
          .from(taskLogsTable)
          .where(eq(taskLogsTable.taskId, taskId));
        expect(recoveredLogs.map(({ message }) => message).sort()).toEqual([
          "Task execution started — running verification against project root",
          'Task reset to "verifying" after process restart (retry 1/2). Re-trigger to execute.',
        ].sort());

        const recoveredResponse = await request(app).get(`/api/tasks/${taskId}`);
        expect(recoveredResponse.status).toBe(200);
        expect(recoveredResponse.body).toMatchObject({
          id: taskId,
          status: "verifying",
          retryCount: 1,
        });
        expect(recoveredResponse.body.acceptance).toBeUndefined();
      } finally {
        if (workerProcess) {
          if (workerProcess.child.exitCode === null && workerProcess.child.signalCode === null) {
            workerProcess.child.kill("SIGKILL");
          }
          await workerProcess.exit;
          await waitForChildDatabaseDisconnect(workerProcess.applicationName).catch(() => undefined);
        }
        if (apiProcess) {
          if (apiProcess.child.exitCode === null && apiProcess.child.signalCode === null) {
            apiProcess.child.kill("SIGKILL");
          }
          await apiProcess.exit;
          await waitForChildDatabaseDisconnect(apiProcess.applicationName).catch(() => undefined);
        }
        await cleanupProjectExecutionData(projectId);
        await db.delete(taskLogsTable).where(eq(taskLogsTable.taskId, taskId));
        await db.delete(eventsTable).where(eq(eventsTable.taskId, taskId));
        await db.delete(tasksTable).where(eq(tasksTable.id, taskId));
        await db.delete(projectsTable).where(eq(projectsTable.id, projectId));
        if (signalRoot) await rm(signalRoot, { recursive: true, force: true });
      }
    },
    180_000,
  );

  const manualTaskLiveStartupRaceTest =
    process.env.RUN_MANUAL_TASK_LIVE_STARTUP_RACE === "1" ? it : it.skip;
  manualTaskLiveStartupRaceTest(
    "preserves a live manual task and fences its worker after lease recovery",
    async () => {
      requireMissionRepairDisposableDatabaseUrl();
      const projectId = randomUUID();
      const taskId = randomUUID();
      const now = new Date();
      const leaseMs = 3_000;
      const heartbeatIntervalMs = 400;
      let signalRoot: string | undefined;
      let workerProcess: ReturnType<typeof startTaskRouteTestProcess> | undefined;
      let apiProcess: ReturnType<typeof startApiStartupProcess> | undefined;
      let recoveryApiProcess: ReturnType<typeof startApiStartupProcess> | undefined;

      try {
        await db.insert(projectsTable).values({
          id: projectId,
          ownerId: "test-user",
          name: `manual-task-live-race-${projectId.slice(0, 8)}`,
          rootPath: process.cwd(),
          language: "typescript",
          status: "active",
          createdAt: now,
          updatedAt: now,
        });
        await db.insert(tasksTable).values({
          id: taskId,
          projectId,
          title: `Live manual task ${taskId.slice(0, 6)}`,
          description: "A task for overlapping manual verification and API startup.",
          status: "pending",
          priority: "p2",
          retryCount: 0,
          maxRetries: 2,
          createdAt: now,
          updatedAt: now,
        });

        signalRoot = await mkdtemp(join("/tmp", "manual-task-live-race-"));
        const readySignalFile = join(signalRoot, "verification-pending.json");
        const releaseSignalFile = join(signalRoot, "release-verification");
        const resultSignalFile = join(signalRoot, "route-result.json");
        workerProcess = startTaskRouteTestProcess({
          mode: "manual-worker",
          taskId,
          readySignalFile,
          releaseSignalFile,
          resultSignalFile,
          leaseMs,
          heartbeatIntervalMs,
        });
        const ready = JSON.parse(
          await waitForProcessSignalFile(readySignalFile, workerProcess),
        ) as { taskId: string; stage: string };
        expect(ready).toEqual({ taskId, stage: "verification_pending" });

        const [liveTaskBeforeStartup] = await db
          .select({
            status: tasksTable.status,
            retryCount: tasksTable.retryCount,
            workerId: tasksTable.workerId,
            leaseUntil: tasksTable.leaseUntil,
            lastHeartbeatAt: tasksTable.lastHeartbeatAt,
          })
          .from(tasksTable)
          .where(eq(tasksTable.id, taskId))
          .limit(1);
        expect(liveTaskBeforeStartup?.status).toBe("running");
        expect(liveTaskBeforeStartup?.workerId).toEqual(expect.any(String));
        expect(liveTaskBeforeStartup?.leaseUntil?.getTime()).toBeGreaterThan(Date.now());
        const workerId = liveTaskBeforeStartup?.workerId;
        const initialHeartbeatAt = liveTaskBeforeStartup?.lastHeartbeatAt?.getTime();
        if (!workerId || !initialHeartbeatAt) {
          throw new Error("Manual task worker did not persist its lease identity and heartbeat.");
        }

        await new Promise((resolveDelay) => setTimeout(resolveDelay, heartbeatIntervalMs * 3));
        const [heartbeatingTask] = await db
          .select({
            status: tasksTable.status,
            retryCount: tasksTable.retryCount,
            workerId: tasksTable.workerId,
            leaseUntil: tasksTable.leaseUntil,
            lastHeartbeatAt: tasksTable.lastHeartbeatAt,
          })
          .from(tasksTable)
          .where(eq(tasksTable.id, taskId))
          .limit(1);
        expect(heartbeatingTask?.workerId).toBe(workerId);
        expect(heartbeatingTask?.lastHeartbeatAt?.getTime()).toBeGreaterThan(initialHeartbeatAt);
        expect(heartbeatingTask?.leaseUntil?.getTime()).toBeGreaterThan(Date.now());

        apiProcess = startApiStartupProcess(`manual-task-live-race-${randomUUID()}`);
        await apiProcess.waitForReady();

        const [liveTaskAfterStartup] = await db
          .select({
            status: tasksTable.status,
            retryCount: tasksTable.retryCount,
            workerId: tasksTable.workerId,
            leaseUntil: tasksTable.leaseUntil,
          })
          .from(tasksTable)
          .where(eq(tasksTable.id, taskId))
          .limit(1);
        expect(liveTaskAfterStartup).toMatchObject({
          status: "running",
          retryCount: 0,
          workerId,
        });
        expect(liveTaskAfterStartup?.leaseUntil).toBeInstanceOf(Date);
        expect(liveTaskAfterStartup?.leaseUntil?.getTime()).toBeGreaterThan(Date.now());
        expect(workerProcess.child.exitCode).toBeNull();
        expect(workerProcess.child.signalCode).toBeNull();

        const [expiredTask] = await db
          .update(tasksTable)
          .set({ leaseUntil: new Date(Date.now() - 1), updatedAt: new Date() })
          .where(and(
            eq(tasksTable.id, taskId),
            eq(tasksTable.status, "running"),
            eq(tasksTable.workerId, workerId),
          ))
          .returning({ id: tasksTable.id });
        expect(expiredTask?.id).toBe(taskId);

        recoveryApiProcess = startApiStartupProcess(`manual-task-live-race-recovery-${randomUUID()}`);
        await recoveryApiProcess.waitForReady();
        const [recoveredTask] = await db
          .select({
            status: tasksTable.status,
            retryCount: tasksTable.retryCount,
            workerId: tasksTable.workerId,
            leaseUntil: tasksTable.leaseUntil,
          })
          .from(tasksTable)
          .where(eq(tasksTable.id, taskId))
          .limit(1);
        expect(recoveredTask).toEqual({
          status: "verifying",
          retryCount: 1,
          workerId: null,
          leaseUntil: null,
        });

        await writeFile(releaseSignalFile, "release");
        const staleWorkerResponse = JSON.parse(
          await waitForProcessSignalFile(resultSignalFile, workerProcess),
        ) as { status: number; body: { error?: string } };
        expect(staleWorkerResponse).toMatchObject({
          status: 409,
          body: { error: "task_lease_lost" },
        });
        expect(await waitForChildProcessExit(workerProcess)).toMatchObject({ code: 0 });
        await waitForChildDatabaseDisconnect(workerProcess.applicationName);
        workerProcess = undefined;

        const [taskAfterStaleWorkerReturns] = await db
          .select({
            status: tasksTable.status,
            retryCount: tasksTable.retryCount,
            verificationResult: tasksTable.verificationResult,
          })
          .from(tasksTable)
          .where(eq(tasksTable.id, taskId))
          .limit(1);
        expect(taskAfterStaleWorkerReturns).toMatchObject({
          status: "verifying",
          retryCount: 1,
          verificationResult: null,
        });
      } finally {
        if (workerProcess) {
          if (workerProcess.child.exitCode === null && workerProcess.child.signalCode === null) {
            workerProcess.child.kill("SIGKILL");
          }
          await workerProcess.exit;
          await waitForChildDatabaseDisconnect(workerProcess.applicationName).catch(() => undefined);
        }
        if (apiProcess) {
          if (apiProcess.child.exitCode === null && apiProcess.child.signalCode === null) {
            apiProcess.child.kill("SIGKILL");
          }
          await apiProcess.exit;
          await waitForChildDatabaseDisconnect(apiProcess.applicationName).catch(() => undefined);
        }
        if (recoveryApiProcess) {
          if (
            recoveryApiProcess.child.exitCode === null
            && recoveryApiProcess.child.signalCode === null
          ) {
            recoveryApiProcess.child.kill("SIGKILL");
          }
          await recoveryApiProcess.exit;
          await waitForChildDatabaseDisconnect(recoveryApiProcess.applicationName).catch(() => undefined);
        }
        await cleanupProjectExecutionData(projectId);
        await db.delete(taskLogsTable).where(eq(taskLogsTable.taskId, taskId));
        await db.delete(eventsTable).where(eq(eventsTable.taskId, taskId));
        await db.delete(tasksTable).where(eq(tasksTable.id, taskId));
        await db.delete(projectsTable).where(eq(projectsTable.id, projectId));
        if (signalRoot) await rm(signalRoot, { recursive: true, force: true });
      }
    },
    180_000,
  );

  const missionRepairWorkerProcessRecoveryTest =
    process.env.RUN_MISSION_REPAIR_WORKER_PROCESS_RECOVERY === "1" ? it : it.skip;
  missionRepairWorkerProcessRecoveryTest(
    "recovers a Mission repair after SIGKILL at a persisted recovery phase",
    async () => {
      requireMissionRepairDisposableDatabaseUrl();
      const configuredCrashPhase = process.env.MISSION_REPAIR_PROCESS_CRASH_PHASE;
      if (
        configuredCrashPhase !== undefined
        && configuredCrashPhase !== "candidate_ready"
        && configuredCrashPhase !== "committed"
        && configuredCrashPhase !== "effect_classified"
      ) {
        throw new Error(`Unsupported Mission repair crash phase: ${configuredCrashPhase}`);
      }
      const crashPhase = configuredCrashPhase === "committed"
        ? "committed"
        : configuredCrashPhase === "effect_classified"
          ? "effect_classified"
          : "candidate_ready";
      const fixture = await createMissionToolLoopFixture({
        phase: "execute",
        approvalRequired: false,
      });
      let signalRoot: string | undefined;
      const userId = "mission-effect-test-user";
      let workerProcess: ReturnType<typeof startMissionRepairTestProcess> | undefined;
      let apiProcess: ReturnType<typeof startApiStartupProcess> | undefined;
      let recoveryProcess: ReturnType<typeof startMissionRepairTestProcess> | undefined;
      let executionId: string | undefined;
      let candidateWorkspacePath: string | undefined;

      try {
        signalRoot = await mkdtemp(join("/tmp", "mission-repair-worker-recovery-"));
        const readySignalFile = join(signalRoot, "worker-ready.json");
        const workspaceSignalFile = join(signalRoot, "candidate-workspace-path");
        workerProcess = startMissionRepairTestProcess("worker", {
          taskId: fixture.taskId,
          userId,
          workspaceRevision: fixture.now.toISOString(),
          crashPhase,
          readySignalFile,
          workspaceSignalFile,
        });
        const ready = JSON.parse(await waitForProcessSignalFile(readySignalFile, workerProcess)) as {
          executionId: string;
          candidateIdentity: string;
          attempt: number;
          phase: string;
          taskId: string;
          candidateWorkspacePath: string;
          effectBundleId?: string;
        };
        executionId = ready.executionId;
        candidateWorkspacePath = await readFile(workspaceSignalFile, "utf8");
        expect(ready).toMatchObject({
          attempt: 0,
          candidateIdentity: expect.any(String),
          candidateWorkspacePath,
          phase: crashPhase,
          taskId: fixture.taskId,
        });
        expect(candidateWorkspacePath).toMatch(/^\/tmp\/engineeringos-validation-/);
        expect(await readFile(join(candidateWorkspacePath, "src", "target.ts"), "utf8"))
          .toBe("export const value = 'process-crashed-candidate';\n");
        expect(await readFile(join(fixture.rootPath, "src", "target.ts"), "utf8"))
          .toBe("export const value = 'base';\n");

        const [runningExecution] = await db
          .select({
            attempt: aiExecutionsTable.attempt,
            checkpoint: aiExecutionsTable.checkpoint,
            status: aiExecutionsTable.status,
            workerId: aiExecutionsTable.workerId,
          })
          .from(aiExecutionsTable)
          .where(and(
            eq(aiExecutionsTable.id, executionId),
            eq(aiExecutionsTable.linkedTaskId, fixture.taskId),
          ))
          .limit(1);
        expect(runningExecution).toBeDefined();
        if (!runningExecution) throw new Error("Worker child did not persist its execution.");
        expect(runningExecution).toMatchObject({
          attempt: 0,
          status: "running",
          workerId: expect.any(String),
        });
        const checkpoint = JSON.parse(runningExecution.checkpoint) as { detail: string };
        const detail = JSON.parse(checkpoint.detail) as {
          missionRepairRecovery: { candidateIdentity: string; executionId: string; phase: string };
        };
        expect(detail.missionRepairRecovery).toMatchObject({
          candidateIdentity: ready.candidateIdentity,
          executionId,
          phase: crashPhase,
        });
        if (crashPhase !== "candidate_ready") {
          expect(detail.missionRepairRecovery).toMatchObject({
            afterObservationId: expect.any(String),
            validatorStatus: "passed",
          });
          const committedBeforeRecovery = await db
            .select({ payload: aiAgentEpisodeEventsTable.payload })
            .from(aiAgentEpisodeEventsTable)
            .where(and(
              eq(aiAgentEpisodeEventsTable.executionId, executionId),
              eq(aiAgentEpisodeEventsTable.eventType, "ACTION_COMMITTED"),
            ))
            .then((events) => events.filter((event) =>
              (event.payload as { actionId?: unknown } | null)?.actionId
                === `mission-repair:${executionId}:0`
            ));
          expect(committedBeforeRecovery).toHaveLength(1);
        }
        if (crashPhase === "effect_classified") {
          expect(ready.effectBundleId).toEqual(expect.any(String));
          expect(detail.missionRepairRecovery).toMatchObject({
            effectBundleId: ready.effectBundleId,
            effectObserved: true,
          });
        }
        const priorAcceptances = await db
          .select({ id: aiExecutionAcceptancesTable.id })
          .from(aiExecutionAcceptancesTable)
          .where(eq(aiExecutionAcceptancesTable.executionId, executionId));
        expect(priorAcceptances).toEqual([]);

        expect(workerProcess.child.kill("SIGKILL")).toBe(true);
        expect(await waitForChildProcessExit(workerProcess)).toMatchObject({
          code: null,
          signal: "SIGKILL",
        });
        await waitForChildDatabaseDisconnect(workerProcess.applicationName);
        const [crashedExecution] = await db
          .select({
            attempt: aiExecutionsTable.attempt,
            checkpoint: aiExecutionsTable.checkpoint,
            status: aiExecutionsTable.status,
          })
          .from(aiExecutionsTable)
          .where(eq(aiExecutionsTable.id, executionId))
          .limit(1);
        expect(crashedExecution).toBeDefined();
        if (!crashedExecution) throw new Error("SIGKILL removed the durable execution unexpectedly.");
        expect(crashedExecution).toMatchObject({ attempt: 0, status: "running" });
        const durableCrashCheckpoint = JSON.parse(crashedExecution.checkpoint) as { detail: string };
        expect(JSON.parse(durableCrashCheckpoint.detail)).toMatchObject({
          missionRepairRecovery: {
            candidateIdentity: ready.candidateIdentity,
            executionId,
            phase: crashPhase,
          },
        });

        // Model the lease deadline after the real worker has been killed; do
        // not wait for the production lease duration in this isolated fixture.
        await db.update(aiExecutionsTable)
          .set({ leaseUntil: new Date(0), updatedAt: new Date() })
          .where(eq(aiExecutionsTable.id, executionId));
        await db.update(tasksTable)
          .set({ leaseUntil: new Date(0), updatedAt: new Date() })
          .where(eq(tasksTable.id, fixture.taskId));

        // Recovery rebuilds from durable checkpoint content, not the dead
        // worker's disposable validation workspace.
        if (!candidateWorkspacePath) throw new Error("Candidate workspace path was not recorded.");
        await removeMissionRepairCandidateWorkspace(candidateWorkspacePath);
        await expect(readFile(join(candidateWorkspacePath, "src", "target.ts")))
          .rejects.toMatchObject({ code: "ENOENT" });

        apiProcess = startApiStartupProcess(`mission-repair-startup-recovery-${randomUUID()}`);
        await apiProcess.waitForReady();
        const [startupRecoveredExecution] = await db
          .select({
            attempt: aiExecutionsTable.attempt,
            status: aiExecutionsTable.status,
            workerId: aiExecutionsTable.workerId,
            leaseUntil: aiExecutionsTable.leaseUntil,
          })
          .from(aiExecutionsTable)
          .where(and(
            eq(aiExecutionsTable.id, executionId),
            eq(aiExecutionsTable.linkedTaskId, fixture.taskId),
          ))
          .limit(1);
        expect(startupRecoveredExecution).toEqual({
          attempt: 0,
          status: "paused",
          workerId: null,
          leaseUntil: null,
        });
        const [startupRecoveredCheckpoint] = await db
          .select({ checkpoint: aiExecutionsTable.checkpoint })
          .from(aiExecutionsTable)
          .where(eq(aiExecutionsTable.id, executionId))
          .limit(1);
        if (!startupRecoveredCheckpoint) {
          throw new Error("API startup removed the Mission repair checkpoint.");
        }
        const startupManifest = JSON.parse(
          JSON.parse(startupRecoveredCheckpoint.checkpoint).detail,
        ) as { missionRepairRecovery: { phase: string; effectBundleId?: string } };
        expect(startupManifest.missionRepairRecovery.phase).toBe(crashPhase);
        if (crashPhase === "effect_classified") {
          expect(startupManifest.missionRepairRecovery.effectBundleId).toBe(ready.effectBundleId);
        }
        const [startupRecoveryAcceptance] = await db
          .select({
            attempt: aiExecutionAcceptancesTable.attempt,
            terminalStatus: aiExecutionAcceptancesTable.terminalStatus,
            outcome: aiExecutionAcceptancesTable.outcome,
            reasonCode: aiExecutionAcceptancesTable.reasonCode,
            nextActionCode: aiExecutionAcceptancesTable.nextActionCode,
            resumable: aiExecutionAcceptancesTable.resumable,
          })
          .from(aiExecutionAcceptancesTable)
          .where(and(
            eq(aiExecutionAcceptancesTable.executionId, executionId),
            eq(aiExecutionAcceptancesTable.attempt, 0),
          ))
          .limit(1);
        expect(startupRecoveryAcceptance).toMatchObject({
          attempt: 0,
          terminalStatus: "paused",
          outcome: "FAILED",
          reasonCode: "EXECUTION_LEASE_EXPIRED",
          nextActionCode: "RESUME_ALLOWED",
          resumable: 1,
        });
        const [startupRecoveryTask] = await db
          .select({ status: tasksTable.status })
          .from(tasksTable)
          .where(eq(tasksTable.id, fixture.taskId))
          .limit(1);
        expect(["pending", "queued", "verifying"]).toContain(startupRecoveryTask?.status);
        const startupRecoveryEvents = await db
          .select({ type: eventsTable.type })
          .from(eventsTable)
          .where(eq(eventsTable.taskId, fixture.taskId));
        expect(startupRecoveryEvents.some((event) => event.type === "TaskCompleted")).toBe(false);

        expect(apiProcess.child.kill("SIGKILL")).toBe(true);
        expect(await apiProcess.exit).toMatchObject({ code: null, signal: "SIGKILL" });
        await waitForChildDatabaseDisconnect(apiProcess.applicationName);
        apiProcess = undefined;

        recoveryProcess = startMissionRepairTestProcess("recovery", {
          taskId: fixture.taskId,
          userId,
          workspaceRevision: fixture.now.toISOString(),
          crashPhase,
          executionId,
        });
        const recoveryExit = await waitForChildProcessExit(recoveryProcess);
        expect(
          recoveryExit,
          recoveryExit.code !== 0 ? recoveryProcess.output() : "Mission repair recovery child failed.",
        ).toEqual({ code: 0, signal: null });
        await waitForChildDatabaseDisconnect(recoveryProcess.applicationName);

        const [completedExecution] = await db
          .select({
            attempt: aiExecutionsTable.attempt,
            status: aiExecutionsTable.status,
          })
          .from(aiExecutionsTable)
          .where(eq(aiExecutionsTable.id, executionId))
          .limit(1);
        expect(completedExecution).toEqual({ attempt: 1, status: "completed" });
        const [completedTask] = await db
          .select({ status: tasksTable.status })
          .from(tasksTable)
          .where(eq(tasksTable.id, fixture.taskId))
          .limit(1);
        expect(completedTask).toEqual({ status: "completed" });
        const [failedAcceptance] = await db
          .select({
            outcome: aiExecutionAcceptancesTable.outcome,
            nextActionCode: aiExecutionAcceptancesTable.nextActionCode,
            resumable: aiExecutionAcceptancesTable.resumable,
          })
          .from(aiExecutionAcceptancesTable)
          .where(and(
            eq(aiExecutionAcceptancesTable.executionId, executionId),
            eq(aiExecutionAcceptancesTable.attempt, 0),
          ))
          .limit(1);
        expect(failedAcceptance).toMatchObject({
          outcome: "FAILED",
          nextActionCode: "RESUME_ALLOWED",
          resumable: 1,
        });
        const [completedAcceptance] = await db
          .select({
            outcome: aiExecutionAcceptancesTable.outcome,
            terminalStatus: aiExecutionAcceptancesTable.terminalStatus,
            resumable: aiExecutionAcceptancesTable.resumable,
            effectBundleId: aiExecutionAcceptancesTable.effectBundleId,
          })
          .from(aiExecutionAcceptancesTable)
          .where(and(
            eq(aiExecutionAcceptancesTable.executionId, executionId),
            eq(aiExecutionAcceptancesTable.attempt, 1),
          ))
          .limit(1);
        expect(completedAcceptance).toMatchObject({
          outcome: "SUCCEEDED",
          terminalStatus: "completed",
          resumable: 0,
          effectBundleId: expect.any(String),
        });
        if (crashPhase === "effect_classified") {
          // A rotated attempt must rebuild effect evidence rather than accept
          // the classified bundle from the crashed attempt.
          expect(completedAcceptance?.effectBundleId).not.toBe(ready.effectBundleId);
        }
        expect(await readFile(join(fixture.rootPath, "src", "target.ts"), "utf8"))
          .toBe("export const value = 'base';\n");
        const expectedAggregateActionId = `mission-repair:${executionId}:${
          crashPhase === "candidate_ready" ? 1 : 0
        }`;
        const committedAfterRecovery = await db
          .select({ payload: aiAgentEpisodeEventsTable.payload })
          .from(aiAgentEpisodeEventsTable)
          .where(and(
            eq(aiAgentEpisodeEventsTable.executionId, executionId),
            eq(aiAgentEpisodeEventsTable.eventType, "ACTION_COMMITTED"),
          ))
          .then((events) => events.filter((event) =>
            (event.payload as { actionId?: unknown } | null)?.actionId
              === expectedAggregateActionId
          ));
        expect(committedAfterRecovery).toHaveLength(1);
      } finally {
        if (workerProcess && workerProcess.child.exitCode === null && workerProcess.child.signalCode === null) {
          workerProcess.child.kill("SIGKILL");
          await workerProcess.exit;
        }
        if (apiProcess && apiProcess.child.exitCode === null && apiProcess.child.signalCode === null) {
          apiProcess.child.kill("SIGKILL");
          await apiProcess.exit;
        }
        if (recoveryProcess && recoveryProcess.child.exitCode === null && recoveryProcess.child.signalCode === null) {
          recoveryProcess.child.kill("SIGKILL");
          await recoveryProcess.exit;
        }
        if (apiProcess) {
          await waitForChildDatabaseDisconnect(apiProcess.applicationName).catch(() => undefined);
        }
        if (workerProcess) {
          await waitForChildDatabaseDisconnect(workerProcess.applicationName).catch(() => undefined);
        }
        if (recoveryProcess) {
          await waitForChildDatabaseDisconnect(recoveryProcess.applicationName).catch(() => undefined);
        }
        if (!candidateWorkspacePath && signalRoot) {
          candidateWorkspacePath = await readFile(join(signalRoot, "candidate-workspace-path"), "utf8")
            .catch(() => undefined);
        }
        try {
          await removeMissionRepairCandidateWorkspace(candidateWorkspacePath);
        } finally {
          await fixture.cleanup();
          if (signalRoot) await rm(signalRoot, { recursive: true, force: true });
        }
      }
    },
    300_000,
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

      if (process.env.RUN_MISSION_REPAIR_PROCESS_RECOVERY === "1") {
        if (!executionId) throw new Error("Mission repair execution identity is missing before startup recovery.");
        await runMissionRepairStartupRecoveryWithProcessKill(fixture.taskId, executionId);
      } else {
        await reconcileStuckJobs();
      }
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
  }, process.env.RUN_MISSION_REPAIR_PROCESS_RECOVERY === "1" ? 180_000 : 30_000);

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

          const verification = await effectObserver.verifyAndPersistEffect({
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
        readStatus: "READ_COMPLETE",
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
        readStatus: "READ_COMPLETE",
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
        readStatus: "READ_COMPLETE",
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
        readStatus: "READ_COMPLETE",
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

  it("admits a linked task when its completed Goal dependency has current proof", async () => {
    const projectId = randomUUID();
    const missionId = randomUUID();
    const sourceGoalId = randomUUID();
    const goalId = randomUUID();
    const taskId = randomUUID();
    const planRevision = "mission-dependency-admission-v1";
    const sourceRevision = "a".repeat(40);
    const now = new Date();
    const rootPath = await mkdtemp(join("/tmp", "mission-dependency-proof-admission-"));

    try {
      await db.insert(projectsTable).values({
        id: projectId,
        ownerId: "test-user",
        name: `mission-proof-admission-${projectId.slice(0, 8)}`,
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
        title: "Dependency proof admission fixture",
        intent: "Start the dependent task only after current proof exists",
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
          title: "Verified prerequisite",
          status: "running",
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
          nextAction: { kind: "task", taskId },
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
        title: "Proof-gated dependent task",
        prompt: "Run after the prerequisite proof is current",
        status: "verifying",
        retryCount: 0,
        maxRetries: 2,
        createdAt: now,
        updatedAt: now,
      });
      const sourceProof = await seedCanonicalMissionGoalCompletion({
        projectId,
        missionId,
        goalId: sourceGoalId,
        planRevision,
        sourceRevision,
      });

      const outcome = await executeTaskLifecycle({
        taskId,
        userId: "test-user",
        provider: { provider: "groq", apiKey: "fixture-provider" },
        trigger: "manual",
        expectedStatuses: ["verifying"],
        workspaceRevision: sourceRevision,
      });

      expect(outcome).toMatchObject({
        ok: true,
        status: "completed",
        executionId: expect.any(String),
      });
      const linkedExecutions = await db.select({
        id: aiExecutionsTable.id,
        goalId: aiExecutionsTable.goalId,
        status: aiExecutionsTable.status,
        attempt: aiExecutionsTable.attempt,
      }).from(aiExecutionsTable)
        .where(eq(aiExecutionsTable.linkedTaskId, taskId));
      expect(linkedExecutions).toEqual([expect.objectContaining({
        id: outcome.executionId,
        goalId,
        status: "completed",
        attempt: 0,
      })]);
      if (!outcome.executionId) throw new Error("Expected linked Task execution ID");
      const linkedAcceptances = await db.select({
        outcome: aiExecutionAcceptancesTable.outcome,
        terminalStatus: aiExecutionAcceptancesTable.terminalStatus,
        attempt: aiExecutionAcceptancesTable.attempt,
      }).from(aiExecutionAcceptancesTable)
        .where(eq(aiExecutionAcceptancesTable.executionId, outcome.executionId));
      expect(linkedAcceptances).toEqual([{
        outcome: "SUCCEEDED",
        terminalStatus: "completed",
        attempt: 0,
      }]);
      const [sourceGoal] = await db.select({
        status: aiGoalsTable.status,
        outcomeContract: aiGoalsTable.outcomeContract,
      }).from(aiGoalsTable).where(eq(aiGoalsTable.id, sourceGoalId));
      expect(sourceGoal?.status).toBe("completed");
      expect(sourceGoal?.outcomeContract).toMatchObject({
        acceptance: {
          executionId: sourceProof.executionId,
          verdict: "PROVEN",
          scope: { planRevision },
        },
      });
      const [task] = await db.select({ status: tasksTable.status })
        .from(tasksTable).where(eq(tasksTable.id, taskId));
      expect(task?.status).toBe("completed");
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