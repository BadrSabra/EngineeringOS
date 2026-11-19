import { and, eq, sql } from "drizzle-orm";
import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { createServer } from "node:net";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  aiAgentEffectBundlesTable,
  aiAgentEffectsTable,
  aiAgentEpisodesTable,
  aiAgentEpisodeEventsTable,
  aiAgentObservationsTable,
  aiApplyJournalTable,
  aiChatSessionsTable,
  aiChatMessagesTable,
  aiChangeProposalsTable,
  aiExecutionAcceptancesTable,
  aiExecutionEvidenceSnapshotsTable,
  aiExecutionsTable,
  aiGoalDependenciesTable,
  aiGoalsTable,
  aiMissionsTable,
  aiWorldFactsTable,
  aiWorldTransitionsTable,
  db,
  eventsTable,
  projectsTable,
} from "@workspace/db";
import {
  claimAiExecution,
  createAiExecution,
  recoverAiExecutionResumeToken,
} from "../ai-execution-state.js";
import { finalizeExecutionAcceptance } from "../ai-execution-acceptance.js";
import { appendEpisodeEvent, startEpisode } from "./agent-episode-ledger.js";
import {
  bindGitHubDeliveryTransitionEffect,
  createPendingGitHubDeliveryTransition,
  createPendingRuntimeStartTransition,
  createPendingApplyChangesTransition,
  terminalizeUnmutatedGitHubDeliveryTransition,
  buildApplyChangesWorldTransitionIntent,
  recoverAcceptedApplyChangesTransition,
  finalizeApplyChangesTransition,
  finalizeRuntimeStartTransition,
  retryPendingRuntimeStartTransitions,
} from "./runtime-start-transition.js";
import { wakeApplyChangesMissionGoals, wakeRuntimeTransitionMissionGoals } from "../mission-runtime.js";
import { startDurableJobDispatcher } from "../job-reconciliation.js";
import { evaluateApplyChangesD2 } from "./apply-changes-mission-gate.js";
import { heavyJobQueue } from "../job-queue.js";
import { childProcessBindingDigest } from "./child-process-attestation.js";
import {
  getProjectWorldState,
  materializeWorldStateForProject,
} from "./world-state.js";
import * as worldStateModule from "./world-state.js";
import { DELIVERY_TREE_DIGEST_VERSION, hashDeliveryTree } from "../delivery-workspace.js";
import {
  AGENT_STATE_LIMITS,
  type ApplyPreconditionReceipt,
  buildApplyAuthorizationDecision,
  buildApplyPreconditionReceipt,
  canonicalJsonHash,
  GoalNextActionSchema,
  parseBoundedJson,
} from "@workspace/ai-orchestrator";
import { taskScopeIdentity } from "./observation-materializer.js";
import {
  APPLY_CHANGE_CAPABILITY_ID,
  buildApplyChangeAction,
  buildApplyChangeEffectProofExpectation,
} from "./apply-change-effect.js";
import { APPLY_CHANGES_PROOF_MODE_V2 } from "./apply-changes-proof.js";

function hashBoundedAgentStateJson(value: unknown, maxBytes: number): string {
  return canonicalJsonHash(parseBoundedJson(value, maxBytes));
}

function hashEpisodeEventPayload(payload: unknown): string {
  return hashBoundedAgentStateJson(payload, AGENT_STATE_LIMITS.episodeEventPayloadBytes);
}

const createdProjects: string[] = [];
const createdExecutionIds: string[] = [];
const createdWorkspaceRoots: string[] = [];

type RuntimeTransitionApiProcess = {
  child: ChildProcessWithoutNullStreams;
  applicationName: string;
  exit: Promise<{ code: number | null; signal: NodeJS.Signals | null }>;
  output: () => string;
};

function requireRuntimeTransitionDisposableDatabaseUrl(): URL {
  const rawDatabaseUrl = process.env.DATABASE_URL;
  if (!rawDatabaseUrl) {
    throw new Error("Runtime transition startup recovery requires an explicit disposable DATABASE_URL.");
  }
  const databaseUrl = new URL(rawDatabaseUrl);
  const databaseName = decodeURIComponent(databaseUrl.pathname.replace(/^\/+/, ""));
  if (
    !["127.0.0.1", "localhost", "::1", "[::1]"].includes(databaseUrl.hostname)
    || !/(?:^|[_-])(?:test|disposable)(?:[_-]|$)/i.test(databaseName)
  ) {
    throw new Error("Runtime transition startup recovery requires a loopback disposable/test database.");
  }
  return databaseUrl;
}

async function reserveRuntimeTransitionApiPort(): Promise<number> {
  const server = createServer();
  await new Promise<void>((resolve, reject) => {
    const onError = (error: Error) => reject(error);
    server.once("error", onError);
    server.listen(0, "127.0.0.1", () => {
      server.off("error", onError);
      resolve();
    });
  });
  const address = server.address();
  if (!address || typeof address === "string") {
    throw new Error("Could not reserve a loopback API port for runtime transition recovery.");
  }
  await new Promise<void>((resolve, reject) => {
    server.close((error) => error ? reject(error) : resolve());
  });
  return address.port;
}

function startRuntimeTransitionApiProcess(
  databaseUrl: URL,
  applicationName: string,
  port: number,
): RuntimeTransitionApiProcess {
  const childDatabaseUrl = new URL(databaseUrl.toString());
  childDatabaseUrl.searchParams.set("application_name", applicationName);
  const source = [
    "(async () => {",
    '  const { isProviderEgressDisabled } = await import("@workspace/ai-orchestrator");',
    '  if (!isProviderEgressDisabled()) throw new Error("Provider egress guard is not active.");',
    '  await import("./src/index.ts");',
    '  process.stdout.write("RUNTIME_START_TRANSITION_INDEX_IMPORTED");',
    "})().catch((error) => {",
    "  console.error(error);",
    "  process.exitCode = 1;",
    "});",
  ].join("\n");
  const child = spawn(process.execPath, ["--import", "tsx", "-e", source], {
    cwd: process.cwd(),
    env: {
      DATABASE_URL: childDatabaseUrl.toString(),
      NODE_ENV: "test",
      LOG_LEVEL: "warn",
      PATH: process.env.PATH ?? "",
      HOME: os.homedir(),
      PGAPPNAME: applicationName,
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
  child.stdin.end();
  let output = "";
  child.stdout.setEncoding("utf8").on("data", (chunk: string) => {
    output = `${output}${chunk}`.slice(-32_000);
  });
  child.stderr.setEncoding("utf8").on("data", (chunk: string) => {
    output = `${output}${chunk}`.slice(-32_000);
  });
  return {
    child,
    applicationName,
    exit: new Promise((resolve) => {
      child.once("exit", (code, signal) => resolve({ code, signal }));
    }),
    output: () => output,
  };
}

async function waitForRuntimeTransitionApiReady(
  api: RuntimeTransitionApiProcess,
  port: number,
): Promise<void> {
  const deadline = Date.now() + 90_000;
  while (Date.now() < deadline) {
    if (api.child.exitCode !== null || api.child.signalCode !== null) {
      throw new Error(`Runtime transition API exited before healthz was ready; ${api.output()}`);
    }
    try {
      const response = await fetch(`http://127.0.0.1:${port}/api/healthz`, {
        signal: AbortSignal.timeout(1_000),
      });
      await response.arrayBuffer();
      if (response.ok) return;
    } catch {
      // Keep waiting while the isolated API finishes its startup sequence.
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(`Timed out waiting for runtime transition API healthz; ${api.output()}`);
}

async function waitForRuntimeTransitionApiLockWait(
  api: RuntimeTransitionApiProcess,
  timeoutMs = 90_000,
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (api.child.exitCode !== null || api.child.signalCode !== null) {
      throw new Error(`Runtime transition API exited before the materialization lock wait; ${api.output()}`);
    }
    const result = await db.execute(sql`
      SELECT pid
      FROM pg_stat_activity
      WHERE datname = current_database()
        AND application_name = ${api.applicationName}
        AND state = 'active'
        AND wait_event_type = 'Lock'
        AND query ILIKE '%ai_world_transitions%'
    `);
    if (result.rows.length > 0) return;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(`Timed out waiting for runtime transition API to block on its transition row; ${api.output()}`);
}

async function waitForRuntimeTransitionApiMaterializationSleep(
  api: RuntimeTransitionApiProcess,
  timeoutMs = 90_000,
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (api.child.exitCode !== null || api.child.signalCode !== null) {
      throw new Error(`Runtime transition API exited before the materialization commit pause; ${api.output()}`);
    }
    const result = await db.execute(sql`
      SELECT pid
      FROM pg_stat_activity
      WHERE datname = current_database()
        AND application_name = ${api.applicationName}
        AND wait_event = 'PgSleep'
        AND query ILIKE '%ai_world_transitions%'
    `);
    if (result.rows.length > 0) return;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(`Timed out waiting for runtime transition materialization commit pause; ${api.output()}`);
}

type RuntimeTransitionCommitPause = {
  functionName: string;
  triggerName: string;
};

async function installRuntimeTransitionCommitPause(
  projectId: string,
): Promise<RuntimeTransitionCommitPause> {
  const suffix = projectId.replaceAll("-", "");
  const functionName = `e2_runtime_transition_pause_${suffix}`;
  const triggerName = `e2_runtime_transition_trigger_${suffix}`;
  await db.execute(sql.raw(`
    CREATE FUNCTION ${functionName}() RETURNS trigger LANGUAGE plpgsql AS $$
    BEGIN
      IF NEW.project_id = '${projectId}'
        AND NEW.status = 'materialized'
        AND OLD.status IS DISTINCT FROM 'materialized' THEN
        PERFORM pg_sleep(5);
      END IF;
      RETURN NEW;
    END;
    $$
  `));
  await db.execute(sql.raw(`
    CREATE TRIGGER ${triggerName}
    BEFORE UPDATE OF status ON ai_world_transitions
    FOR EACH ROW EXECUTE FUNCTION ${functionName}()
  `));
  return { functionName, triggerName };
}

async function dropRuntimeTransitionCommitPause(
  pause: RuntimeTransitionCommitPause,
): Promise<void> {
  await db.execute(sql.raw(
    `DROP TRIGGER IF EXISTS ${pause.triggerName} ON ai_world_transitions`,
  ));
  await db.execute(sql.raw(`DROP FUNCTION IF EXISTS ${pause.functionName}()`));
}

async function waitForRuntimeTransitionApiDatabaseDisconnect(
  applicationName: string,
  timeoutMs = 20_000,
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const result = await db.execute(sql`
      SELECT pid
      FROM pg_stat_activity
      WHERE datname = current_database()
        AND application_name = ${applicationName}
    `);
    if (result.rows.length === 0) return;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(`Runtime transition API kept a PostgreSQL session open: ${applicationName}`);
}

async function stopRuntimeTransitionApiProcess(
  api: RuntimeTransitionApiProcess,
): Promise<void> {
  if (api.child.exitCode === null && api.child.signalCode === null) {
    api.child.kill("SIGTERM");
    const gracefullyExited = await Promise.race([
      api.exit.then(() => true),
      new Promise<false>((resolve) => setTimeout(() => resolve(false), 20_000)),
    ]);
    if (!gracefullyExited && api.child.exitCode === null && api.child.signalCode === null) {
      api.child.kill("SIGKILL");
      await api.exit;
    }
  }
  await waitForRuntimeTransitionApiDatabaseDisconnect(api.applicationName);
}

afterEach(async () => {
  vi.restoreAllMocks();
  for (const rootPath of createdWorkspaceRoots.splice(0)) {
    await rm(rootPath, { recursive: true, force: true });
  }
  for (const executionId of createdExecutionIds.splice(0)) {
    await db.delete(aiExecutionAcceptancesTable)
      .where(eq(aiExecutionAcceptancesTable.executionId, executionId));
    await db.delete(aiExecutionsTable).where(eq(aiExecutionsTable.id, executionId));
  }
  for (const projectId of createdProjects.splice(0)) {
    await db.delete(projectsTable).where(eq(projectsTable.id, projectId));
  }
});

async function acceptTransitionFixture(fixture: {
  projectId: string;
  executionId: string;
  operationId: string;
  effectBundleId: string;
}) {
  const now = new Date();
  await db.transaction(async (tx) => {
    await tx.update(aiExecutionsTable)
      .set({ status: "completed", completedAt: now, updatedAt: now })
      .where(eq(aiExecutionsTable.id, fixture.executionId));
    await tx.insert(aiExecutionAcceptancesTable).values({
      id: crypto.randomUUID(),
      executionId: fixture.executionId,
      projectId: fixture.projectId,
      attempt: 0,
      finalizationKey: `final:${fixture.executionId}`,
      operationId: fixture.operationId,
      workerId: `runtime-transition-worker:${fixture.projectId}`,
      terminalStatus: "completed",
      outcome: "SUCCEEDED",
      reasonCode: "CANONICAL_PROOF_PROVEN",
      nextActionCode: "none",
      effectBundleId: fixture.effectBundleId,
      createdAt: now,
    });
  });
}

async function waitForLockWaiter(tables: readonly string[]): Promise<string> {
  const deadline = Date.now() + 10_000;
  while (Date.now() < deadline) {
    const result = await db.execute(sql`
      SELECT waiting.query
      FROM pg_stat_activity AS waiting
      WHERE waiting.pid <> pg_backend_pid()
        AND waiting.datname = current_database()
        AND waiting.wait_event_type = 'Lock'
        AND cardinality(pg_blocking_pids(waiting.pid)) > 0
    `);
    const rows = (result as unknown as {
      rows?: Array<{ query: string | null }>;
    }).rows ?? [];
    for (const table of tables) {
      if (rows.some((row) => (row.query ?? "").toLowerCase().includes(table.toLowerCase()))) {
        return table;
      }
    }
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  throw new Error(`Timed out waiting on any of: ${tables.join(", ")}.`);
}

function startApplyRecoveryProcess(
  databaseUrl: URL,
  applicationName: string,
  input: {
    projectId: string;
    executionId: string;
    attempt: number;
    episodeId: string;
    actionId: string;
    proposalId: string;
  },
): RuntimeTransitionApiProcess {
  const childDatabaseUrl = new URL(databaseUrl.toString());
  childDatabaseUrl.searchParams.set("application_name", applicationName);
  const source = [
    "(async () => {",
    '  process.stdout.write("APPLY_RECOVERY_WORKER_BOOT:" + JSON.stringify({ pid: process.pid, cwd: process.cwd(), applicationName: process.env.PGAPPNAME }) + "\\n");',
    '  const { recoverAcceptedApplyChangesTransition } = await import("./src/lib/agent-state/runtime-start-transition.ts");',
    '  const { pool } = await import("@workspace/db");',
    '  process.stdout.write("APPLY_RECOVERY_WORKER_MODULES_READY\\n");',
    '  const input = JSON.parse(process.env.APPLY_RECOVERY_INPUT ?? "{}");',
    "  try {",
    "    const result = await recoverAcceptedApplyChangesTransition(input);",
    '    process.stdout.write("APPLY_RECOVERY_RESULT:" + JSON.stringify(result) + "\\n");',
    "  } finally {",
    "    await pool.end();",
    "  }",
    "})().catch((error) => {",
    "  console.error(error);",
    "  process.exitCode = 1;",
    "});",
  ].join("\n");
  const child = spawn(process.execPath, ["--import", "tsx", "-e", source], {
    cwd: process.cwd(),
    env: {
      ...process.env,
      DATABASE_URL: childDatabaseUrl.toString(),
      APPLY_RECOVERY_INPUT: JSON.stringify(input),
      NODE_ENV: "test",
      LOG_LEVEL: "warn",
      PGAPPNAME: applicationName,
      AI_PROVIDER_EGRESS_DISABLED: "1",
      AI_CREDENTIALS_ENCRYPTION_KEY:
        `${crypto.randomUUID().replaceAll("-", "")}${crypto.randomUUID().replaceAll("-", "")}`,
    },
    stdio: "pipe",
  });
  child.stdin.end();
  let output = "";
  child.stdout.setEncoding("utf8").on("data", (chunk: string) => {
    output = `${output}${chunk}`.slice(-32_000);
  });
  child.stderr.setEncoding("utf8").on("data", (chunk: string) => {
    output = `${output}${chunk}`.slice(-32_000);
  });
  return {
    child,
    applicationName,
    exit: new Promise((resolve, reject) => {
      child.once("error", reject);
      child.once("exit", (code, signal) => resolve({ code, signal }));
    }),
    output: () => output,
  };
}

async function waitForApplyRecoveryProcessLockWaiters(
  projectLockHolderPid: number,
  applicationNames: readonly [string, string],
  workers: readonly RuntimeTransitionApiProcess[],
  timeoutMs = 15_000,
): Promise<number[]> {
  const deadline = Date.now() + timeoutMs;
  let lastObserved: string[] = [];
  while (Date.now() < deadline) {
    const result = await db.execute(sql`
      SELECT
        waiting.pid,
        waiting.application_name,
        waiting.state,
        waiting.wait_event_type,
        waiting.wait_event,
        pg_blocking_pids(waiting.pid) AS blocking_pids,
        left(waiting.query, 240) AS query
      FROM pg_stat_activity AS waiting
      WHERE waiting.pid <> pg_backend_pid()
        AND waiting.datname = current_database()
        AND (waiting.application_name = ${applicationNames[0]}
          OR waiting.application_name = ${applicationNames[1]})
    `);
    const rows = result.rows as Array<{
      pid: number | string;
      application_name: string;
      state: string | null;
      wait_event_type: string | null;
      wait_event: string | null;
      blocking_pids: Array<number | string> | null;
      query: string | null;
    }>;
    const rowsByPid = new Map(rows.map((row) => [Number(row.pid), row]));
    const isTransitivelyBlockedByProjectHolder = (
      pid: number,
      visited = new Set<number>(),
    ): boolean => {
      if (pid === projectLockHolderPid) return true;
      if (visited.has(pid)) return false;
      const nextVisited = new Set(visited);
      nextVisited.add(pid);
      const row = rowsByPid.get(pid);
      return (row?.blocking_pids ?? []).some((blocker) =>
        isTransitivelyBlockedByProjectHolder(Number(blocker), nextVisited)
      );
    };
    lastObserved = rows.map((row) => {
      const blockingPids = (row.blocking_pids ?? []).map(Number);
      const blockedByProjectHolder = isTransitivelyBlockedByProjectHolder(Number(row.pid));
      return `pid=${row.pid}, app=${row.application_name}, state=${row.state}, wait=${row.wait_event_type ?? "none"}/${row.wait_event ?? "none"}, blockers=[${blockingPids.join(",")}], blockedByProjectHolder=${blockedByProjectHolder}, query=${row.query ?? "none"}`;
    });
    const blockedPids = [...new Set(rows
      .filter((row) => row.state === "active"
        && row.wait_event_type === "Lock"
        && isTransitivelyBlockedByProjectHolder(Number(row.pid)))
      .map((row) => Number(row.pid))
      .filter((pid) => Number.isSafeInteger(pid)))];
    if (blockedPids.length >= 2) return blockedPids;

    const exitedWorkers = workers.filter((worker) =>
      worker.child.exitCode !== null || worker.child.signalCode !== null
    );
    if (exitedWorkers.length > 0) {
      throw new Error(
        `Apply recovery worker exited before reaching the Project lock. Database observations: ${lastObserved.join(" | ") || "none"}. Worker output: ${workers.map((worker) =>
          `${worker.applicationName} exit=${worker.child.exitCode ?? "running"} signal=${worker.child.signalCode ?? "none"} output=${worker.output() || "empty"}`
        ).join(" || ")}`,
      );
    }
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  throw new Error(
    `Timed out waiting for both Apply recovery worker processes to block on the Project row. Database observations: ${lastObserved.join(" | ") || "none"}. Worker output: ${workers.map((worker) =>
      `${worker.applicationName} exit=${worker.child.exitCode ?? "running"} signal=${worker.child.signalCode ?? "none"} output=${worker.output() || "empty"}`
    ).join(" || ")}`,
  );
}

function readApplyRecoveryProcessResult(
  worker: RuntimeTransitionApiProcess,
): Awaited<ReturnType<typeof recoverAcceptedApplyChangesTransition>> {
  const exitCode = worker.child.exitCode;
  if (exitCode !== 0) {
    throw new Error(
      `Apply recovery worker ${worker.applicationName} exited with ${exitCode}; ${worker.output()}`,
    );
  }
  const match = worker.output().match(/APPLY_RECOVERY_RESULT:(\{[^\r\n]*\})/);
  if (!match?.[1]) {
    throw new Error(
      `Apply recovery worker ${worker.applicationName} returned no structured result; ${worker.output()}`,
    );
  }
  return JSON.parse(match[1]) as Awaited<ReturnType<typeof recoverAcceptedApplyChangesTransition>>;
}

function postgresErrorCodes(value: unknown): string[] {
  const codes: string[] = [];
  const seen = new Set<unknown>();
  let current: unknown = value;
  while (current && typeof current === "object" && !seen.has(current)) {
    seen.add(current);
    const error = current as { code?: unknown; cause?: unknown };
    if (typeof error.code === "string") codes.push(error.code);
    current = error.cause;
  }
  return codes;
}

function createRuntimeStartMissionHandoffFixture(projectId: string) {
  const missionId = crypto.randomUUID();
  const sourceGoalId = crypto.randomUUID();
  const targetGoalId = crypto.randomUUID();
  const planRevision = `plan-runtime-start:${projectId}`;
  const requirement = {
    kind: "runtime.start",
    version: 1,
    sourceStepId: "runtime-start",
    targetStepId: "target-step",
    from: "stopped",
    to: "running",
  } as const;
  const plan = { hash: planRevision, transitionRequirements: [requirement] };
  return { missionId, sourceGoalId, targetGoalId, planRevision, requirement, plan };
}

async function transitionFixture(options: {
  accepted?: boolean;
  missionHandoff?: boolean;
} = {}) {
  const projectId = crypto.randomUUID();
  const sessionId = crypto.randomUUID();
  const operationId = crypto.randomUUID();
  const userId = `runtime-transition-test:${projectId}`;
  const workerId = `runtime-transition-worker:${projectId}`;
  const now = new Date();
  const missionHandoff = options.missionHandoff
    ? createRuntimeStartMissionHandoffFixture(projectId)
    : undefined;
  await db.insert(projectsTable).values({
    id: projectId,
    ownerId: userId,
    name: "runtime transition retry test",
    rootPath: `${process.cwd()}/.runtime-start-transition-test/${projectId}`,
    language: "typescript",
    status: "active",
    createdAt: now,
    updatedAt: now,
  });
  createdProjects.push(projectId);
  if (missionHandoff) {
    await db.insert(aiMissionsTable).values({
      id: missionHandoff.missionId,
      projectId,
      userId,
      title: "Runtime transition handoff",
      intent: "Verify the exact runtime transition before dispatching its successor",
      status: "waiting",
      scope: { kind: "project", projectId },
      autonomyPolicy: { activePlanRevision: missionHandoff.planRevision },
      createdAt: now,
      updatedAt: now,
    });
    await db.insert(aiGoalsTable).values([
      {
        id: missionHandoff.sourceGoalId,
        missionId: missionHandoff.missionId,
        projectId,
        title: "Start runtime",
        status: "completed",
        nextAction: { kind: "recipe", recipeId: "runtime.start", recipeVersion: 1 },
        successCriteria: {
          stepId: "runtime-start",
          planRevision: missionHandoff.plan,
        },
        outcomeContract: { planRevision: { hash: missionHandoff.planRevision } },
        createdAt: now,
        updatedAt: now,
      },
      {
        id: missionHandoff.targetGoalId,
        missionId: missionHandoff.missionId,
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
          planRevision: missionHandoff.plan,
          transitionRequirement: missionHandoff.requirement,
        },
        outcomeContract: { planRevision: { hash: missionHandoff.planRevision } },
        blockedReason: "runtime_transition_pending",
        createdAt: now,
        updatedAt: now,
      },
    ]);
  }
  await db.insert(aiChatSessionsTable).values({
    id: sessionId,
    projectId,
    title: "Runtime transition retry test",
    createdAt: now,
    updatedAt: now,
  });

  const created = await createAiExecution({
    userId,
    projectId,
    sessionId,
    idempotencyKey: `${operationId}:retry`,
    request: {
      projectId,
      operationId,
      sessionId,
      message: "runtime transition retry test",
      modelMessage: "runtime transition retry test",
      workspaceRevision: "a".repeat(64),
      validationTargetPaths: [],
    },
  });
  const actualExecutionId = created.execution.id;
  createdExecutionIds.push(actualExecutionId);
  if (missionHandoff) {
    await db.update(aiExecutionsTable)
      .set({ goalId: missionHandoff.sourceGoalId })
      .where(eq(aiExecutionsTable.id, actualExecutionId));
  }
  const claimed = await claimAiExecution({
    executionId: actualExecutionId,
    userId,
    workerId,
  });
  expect(claimed?.status).toBe("running");
  const episodeScope = { kind: "project", paths: [] };
  const episode = await startEpisode({
    projectId,
    executionId: actualExecutionId,
    attempt: 0,
    workerId,
    idempotencyKey: `${operationId}:episode`,
    projectRevision: "a".repeat(64),
    intentKind: "RUNTIME_START",
    scope: episodeScope,
    ...(missionHandoff
      ? {
          missionId: missionHandoff.missionId,
          goalId: missionHandoff.sourceGoalId,
          planRevision: missionHandoff.planRevision,
        }
      : {}),
  });
  const taskScope = taskScopeIdentity({
    id: episode.episodeId,
    projectId,
    missionId: missionHandoff?.missionId ?? null,
    goalId: missionHandoff?.sourceGoalId ?? null,
    scope: episodeScope,
  });
  const effectBundleId = `effect:${operationId}`;
  await db.insert(aiAgentEffectBundlesTable).values({
    id: effectBundleId,
    projectId,
    executionId: actualExecutionId,
    attempt: 0,
    episodeId: episode.episodeId,
    effectIds: [],
    effectContractHashes: [],
    verdict: "OBSERVED",
  });
  const parent = await getProjectWorldState(projectId, {
    excludeEpisodeIds: [episode.episodeId],
  });
  const environmentRevision = `env-v1:${"c".repeat(64)}`;
  const sourceRevision = "a".repeat(64);
  const beforeObservationId = crypto.randomUUID();
  const afterObservationId = crypto.randomUUID();
  const statusObservationId = crypto.randomUUID();
  const childProcessObservationId = crypto.randomUUID();
  const transitionInput = {
    projectId,
    executionId: actualExecutionId,
    attempt: 0,
    episodeId: episode.episodeId,
    actionId: `action:${operationId}`,
    effectBundleId,
    workerId,
    taskScope,
    parentWorldRevision: parent.worldRevision,
    parentFactRefs: [],
    beforeObservationIds: [beforeObservationId],
    afterObservationIds: [afterObservationId, statusObservationId, childProcessObservationId],
    evidenceRefs: [`runtime:${sessionId}`],
    environmentRevision,
  };
  const transitionId = await createPendingRuntimeStartTransition(transitionInput);
  if (options.accepted !== false) {
    await acceptTransitionFixture({
      projectId,
      executionId: actualExecutionId,
      operationId,
      effectBundleId,
    });
  }
  return {
    projectId,
    executionId: actualExecutionId,
    episodeId: episode.episodeId,
    sessionId,
    workerId,
    transitionId,
    operationId,
    effectBundleId,
    environmentRevision,
    sourceRevision,
    beforeObservationId,
    afterObservationId,
    statusObservationId,
    childProcessObservationId,
    taskScope,
    missionHandoff,
    transitionInput,
  };
}

type TransitionFixture = Awaited<ReturnType<typeof transitionFixture>>;

async function insertValidRuntimeStartObservations(
  fixture: TransitionFixture,
  childOverrides: {
    completeness?: "complete" | "partial" | "failed";
    freshness?: "fresh" | "stale" | "unknown";
    environmentFreshness?: "fresh" | "stale" | "unknown";
    value?: Record<string, unknown>;
  } = {},
): Promise<void> {
  const now = new Date();
  const common = {
    projectId: fixture.projectId,
    executionId: fixture.executionId,
    episodeId: fixture.episodeId,
    taskScope: fixture.taskScope,
    environmentRevisionKey: `revision:${fixture.environmentRevision}`,
    provenance: "DIRECT_OBSERVATION" as const,
    sourceVersion: fixture.sourceRevision,
    sourceRefs: [],
    observedAt: now,
    projectRevision: fixture.sourceRevision,
    environmentRevision: fixture.environmentRevision,
    completeness: "complete" as const,
    freshness: "fresh" as const,
    environmentFreshness: "fresh" as const,
    evidenceRefs: [],
    createdAt: now,
  };
  const childBinding = childProcessBindingDigest({
    projectId: fixture.projectId,
    sessionId: fixture.sessionId,
    executionId: fixture.executionId,
    executionAttempt: 0,
    episodeId: fixture.episodeId,
    operationId: fixture.operationId,
    revision: fixture.sourceRevision,
  });
  await db.insert(aiAgentObservationsTable).values({
    ...common,
    id: fixture.beforeObservationId,
    kind: "direct_observation",
    observationRole: "runtime.before_state",
    sourceType: "direct_observation",
    sourceId: fixture.beforeObservationId,
    subject: `runtime:${fixture.projectId}`,
    predicate: "runtime.before_state",
    value: {
      status: "observed",
      runtimeStatus: "stopped",
      inventoryComplete: true,
      unknownListenerPorts: [],
      sessionId: null,
      projectId: fixture.projectId,
      revision: fixture.sourceRevision,
      environmentRevision: fixture.environmentRevision,
      observedAt: now.toISOString(),
    },
    valueHash: "1".repeat(64),
    sequence: 0,
  });
  await db.insert(aiAgentObservationsTable).values({
    ...common,
    id: fixture.afterObservationId,
    kind: "direct_observation",
    observationRole: "runtime.after_state",
    sourceType: "direct_observation",
    sourceId: fixture.afterObservationId,
    subject: `runtime:${fixture.sessionId}`,
    predicate: "runtime.after_state",
    value: {
      status: "passed",
      runtimeStatus: "running",
      projectId: fixture.projectId,
      revision: fixture.sourceRevision,
      sessionId: fixture.sessionId,
      environmentRevision: fixture.environmentRevision,
      processAlive: true,
      portReady: true,
      pid: 4321,
      port: 3000,
      observedAt: now.toISOString(),
    },
    valueHash: "2".repeat(64),
    sequence: 1,
  });
  await db.insert(aiAgentObservationsTable).values({
    ...common,
    id: fixture.statusObservationId,
    kind: "direct_observation",
    observationRole: "runtime.status",
    sourceType: "direct_observation",
    sourceId: fixture.statusObservationId,
    subject: `runtime:${fixture.sessionId}`,
    predicate: "runtime.status",
    value: "running",
    valueHash: "3".repeat(64),
    sequence: 2,
  });
  const childProcessObservation: typeof aiAgentObservationsTable.$inferInsert = {
    ...common,
    id: fixture.childProcessObservationId,
    kind: "child_process_attestation",
    observationRole: "runtime.child_process_environment",
    sourceType: "child_process_attestation",
    sourceId: `runtime-child-process:${fixture.sessionId}`,
    subject: `runtime:${fixture.sessionId}`,
    predicate: "runtime.child_process_environment",
    value: {
      status: "known",
      reasonCode: "child_process_observed",
      sessionId: fixture.sessionId,
      operationId: fixture.operationId,
      bindingDigest: childBinding,
      attestationDigest: "4".repeat(64),
      processEnvironmentDigest: "5".repeat(64),
      ...childOverrides.value,
    },
    valueHash: "6".repeat(64),
    sequence: 3,
    completeness: childOverrides.completeness ?? common.completeness,
    freshness: childOverrides.freshness ?? common.freshness,
    environmentFreshness: childOverrides.environmentFreshness ?? common.environmentFreshness,
  };
  await db.insert(aiAgentObservationsTable).values(childProcessObservation);
}

describe("Agent State transition ownership uses PostgreSQL lease time", () => {
  function applyInput(fixture: TransitionFixture) {
    return {
      projectId: fixture.projectId,
      executionId: fixture.executionId,
      attempt: 0,
      episodeId: fixture.episodeId,
      actionId: "clock-skew:apply",
      effectBundleId: fixture.effectBundleId,
      proposalId: "proposal:clock-skew",
      goalId: "goal:clock-skew",
      planRevision: "a".repeat(64),
      workerId: fixture.workerId,
      parentWorldRevision: fixture.transitionInput.parentWorldRevision,
      parentFactRefs: [],
      beforeObservationIds: [],
      afterObservationIds: [],
      evidenceRefs: [],
      environmentRevision: fixture.environmentRevision,
      promotedTreeHash: "b".repeat(64),
    };
  }

  function deliveryInput(fixture: TransitionFixture, operationId: string) {
    return {
      projectId: fixture.projectId,
      executionId: fixture.executionId,
      attempt: 0,
      episodeId: fixture.episodeId,
      actionId: "clock-skew:github-delivery:" + operationId,
      workerId: fixture.workerId,
      operationId,
      proposalId: "proposal:" + operationId,
      remoteUrl: "https://github.com/example/project.git",
      branch: "main",
      parentWorldRevision: fixture.transitionInput.parentWorldRevision,
      parentFactRefs: [],
      taskScope: "project",
      beforeObservationIds: ["before:" + operationId],
    };
  }

  it("accepts a live PostgreSQL lease when the API clock is 24 hours ahead", async () => {
    const fixture = await transitionFixture({ accepted: false });
    const bindOperationId = crypto.randomUUID();
    const terminalizeOperationId = crypto.randomUUID();
    const bindTransitionId = await createPendingGitHubDeliveryTransition(
      deliveryInput(fixture, bindOperationId),
    );
    const terminalizeTransitionId = await createPendingGitHubDeliveryTransition(
      deliveryInput(fixture, terminalizeOperationId),
    );
    const databaseNearNow = Date.now();
    await db.update(aiExecutionsTable).set({
      leaseUntil: new Date(databaseNearNow + 5 * 60_000),
    }).where(eq(aiExecutionsTable.id, fixture.executionId));

    vi.useFakeTimers({ toFake: ["Date"] });
    try {
      vi.setSystemTime(new Date(databaseNearNow + 24 * 60 * 60_000));

      await expect(createPendingApplyChangesTransition(applyInput(fixture))).resolves.toBeTruthy();
      await expect(createPendingRuntimeStartTransition(fixture.transitionInput))
        .resolves.toBe(fixture.transitionId);
      await expect(createPendingGitHubDeliveryTransition(
        deliveryInput(fixture, crypto.randomUUID()),
      )).resolves.toBeTruthy();
      await expect(bindGitHubDeliveryTransitionEffect({
        projectId: fixture.projectId,
        executionId: fixture.executionId,
        attempt: 0,
        episodeId: fixture.episodeId,
        actionId: "clock-skew:github-delivery:" + bindOperationId,
        effectBundleId: fixture.effectBundleId,
        workerId: fixture.workerId,
        operationId: bindOperationId,
        afterObservationIds: ["after:" + bindOperationId],
      })).resolves.toBe(bindTransitionId);

      await terminalizeUnmutatedGitHubDeliveryTransition({
        projectId: fixture.projectId,
        executionId: fixture.executionId,
        attempt: 0,
        operationId: terminalizeOperationId,
        workerId: fixture.workerId,
        failureCode: "clock_skew_test",
      });
      const [terminalized] = await db.select().from(aiWorldTransitionsTable)
        .where(eq(aiWorldTransitionsTable.id, terminalizeTransitionId)).limit(1);
      expect(terminalized?.status).toBe("terminal_failed");
    } finally {
      vi.useRealTimers();
    }
  });

  it("rejects an expired PostgreSQL lease when the API clock is 24 hours behind", async () => {
    const fixture = await transitionFixture({ accepted: false });
    const bindOperationId = crypto.randomUUID();
    const terminalizeOperationId = crypto.randomUUID();
    await createPendingGitHubDeliveryTransition(
      deliveryInput(fixture, bindOperationId),
    );
    const terminalizeTransitionId = await createPendingGitHubDeliveryTransition(