import { createHash, randomUUID } from "node:crypto";
import { spawn, type ChildProcess } from "node:child_process";
import { createConnection, createServer as createTcpServer } from "node:net";
import { fileURLToPath } from "node:url";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { and, eq, inArray, sql } from "drizzle-orm";
import { afterEach, describe, expect, it } from "vitest";
import {
  aiAgentEffectBundlesTable,
  aiAgentEffectsTable,
  aiAgentEpisodesTable,
  aiAgentObservationsTable,
  aiChatMessagesTable,
  aiChatSessionsTable,
  aiChangeProposalsTable,
  aiExecutionAcceptancesTable,
  aiExecutionsTable,
  aiGoalDependenciesTable,
  aiGoalsTable,
  aiMissionsTable,
  aiWorldFactsTable,
  aiWorldTransitionsTable,
  db,
  projectsTable,
} from "@workspace/db";
import { claimAiExecution, createAiExecution } from "../ai-execution-state.js";
import { startEpisode } from "./agent-episode-ledger.js";
import {
  APPLY_CHANGE_CAPABILITY_ID,
  buildApplyChangeEffectProofExpectation,
} from "./apply-change-effect.js";
import { evaluateApplyChangesD2 } from "./apply-changes-mission-gate.js";
import {
  DELIVERY_TREE_DIGEST_VERSION,
  hashChangeSet,
  hashDeliveryTree,
} from "../delivery-workspace.js";
import { establishProjectRoot } from "../project-root.js";
import { getProjectWorldState } from "./world-state.js";
import {
  createPendingApplyChangesTransition,
  finalizeApplyChangesTransition,
  retryPendingRuntimeStartTransitions,
} from "./runtime-start-transition.js";

const apiRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../");
const workspaceRoot = path.resolve(apiRoot, "../..");
const childProcesses: ApiProcess[] = [];
const createdFixtures: ApplyFixture[] = [];
const createdTriggers: Array<{ functionName: string; triggerName: string }> = [];

type ApplyFixture = {
  projectId: string;
  sessionId: string;
  executionId: string;
  attempt: number;
  episodeId: string;
  workerId: string;
  operationId: string;
  proposalId: string;
  missionId: string;
  goalId: string;
  reportGoalId: string;
  planRevision: string;
  effectBundleId: string;
  effectId: string;
  acceptanceId: string;
  transitionId: string;
  beforeObservationId: string;
  afterObservationId: string;
  environmentRevision: string;
  baseTreeHash: string;
  candidateTreeHash: string;
  rootPath: string;
  targetPath: string;
  baseContent: string;
  candidateContent: string;
  finalizeInput: {
    projectId: string;
    executionId: string;
    attempt: number;
    episodeId: string;
    actionId: string;
    effectBundleId: string;
  };
};

type ApiProcess = {
  child: ChildProcess;
  applicationName: string;
  port: number;
  exit: Promise<{ code: number | null; signal: NodeJS.Signals | null }>;
  output: () => string;
  diagnostics: () => string;
  waitFor: (pattern: RegExp, label: string, timeoutMs?: number) => Promise<void>;
};

function isLoopbackDatabase(): boolean {
  try {
    const hostname = new URL(process.env.DATABASE_URL ?? "").hostname.replace(/^\[|\]$/g, "");
    return hostname === "127.0.0.1" || hostname === "localhost" || hostname === "::1";
  } catch {
    return false;
  }
}

async function createApplyFixture(label: string): Promise<ApplyFixture> {
  const projectId = randomUUID();
  const sessionId = randomUUID();
  const operationId = randomUUID();
  const userId = `e2-apply-recovery:${projectId}`;
  const workerId = `e2-apply-worker:${projectId}`;
  const rootPath = await mkdtemp(path.join(workspaceRoot, ".e2-apply-recovery-"));
  const targetPath = path.join(rootPath, "src", "target.ts");
  const baseContent = `export const value = ${JSON.stringify(`${label}-before`)};\n`;
  const candidateContent = `export const value = ${JSON.stringify(`${label}-after`)};\n`;
  await mkdir(path.dirname(targetPath), { recursive: true });
  await writeFile(targetPath, baseContent, "utf8");
  const baseTreeHash = await hashDeliveryTree(rootPath);
  await writeFile(targetPath, candidateContent, "utf8");
  const candidateTreeHash = await hashDeliveryTree(rootPath);
  const sourceRevision = "a".repeat(64);
  const changeSetHash = hashChangeSet([{ path: "src/target.ts", newContent: candidateContent }]);
  const planRevision = "f".repeat(64);
  const environmentRevision = `env-v1:${"c".repeat(64)}`;
  const effectBundleId = `effect:${operationId}`;
  const now = new Date();

  createdFixtures.push({
    projectId,
    rootPath,
  } as ApplyFixture);

  await db.insert(projectsTable).values({
    id: projectId,
    ownerId: userId,
    name: `apply-recovery-${projectId.slice(0, 8)}`,
    rootPath,
    language: "typescript",
    status: "active",
    createdAt: now,
    updatedAt: now,
  });
  await db.insert(aiChatSessionsTable).values({
    id: sessionId,
    projectId,
    title: `Apply Changes recovery ${label}`,
    createdAt: now,
    updatedAt: now,
  });
  await db.insert(aiChatMessagesTable).values({
    id: randomUUID(),
    sessionId,
    role: "user",
    content: "Apply the approved change.",
    createdAt: now,
  });

  const created = await createAiExecution({
    userId,
    projectId,
    sessionId,
    idempotencyKey: `${operationId}:apply-recovery`,
    request: {
      projectId,
      operationId,
      sessionId,
      message: "Apply the approved change.",
      modelMessage: "Apply the approved change.",
      workspaceRevision: sourceRevision,
      validationTargetPaths: [],
    },
  });
  const executionId = created.execution.id;
  const claimed = await claimAiExecution({ executionId, userId, workerId });
  if (!claimed) throw new Error("Could not claim the Apply Changes recovery fixture.");
  const episode = await startEpisode({
    projectId,
    executionId,
    attempt: claimed.attempt,
    workerId,
    idempotencyKey: `${operationId}:episode:${claimed.attempt}`,
    projectRevision: sourceRevision,
    intentKind: "RUNTIME_START",
    scope: { kind: "project", paths: [] },
  });
  const episodeId = episode.episodeId;
  await db.insert(aiAgentEffectBundlesTable).values({
    id: effectBundleId,
    projectId,
    executionId,
    attempt: claimed.attempt,
    episodeId,
    effectIds: [],
    effectContractHashes: [],
    verdict: "OBSERVED",
  });

  const proposalId = randomUUID();
  const missionId = randomUUID();
  const goalId = randomUUID();
  const reportGoalId = randomUUID();
  const baseRevision = sourceRevision;
  const requirement = {
    kind: "apply.changes",
    version: 1,
    sourceStepId: "apply-changes",
    proposalId,
    baseRevision,
    candidateTreeHash,
    changeSetHash,
    from: "candidate",
    to: "applied",
  };
  const plan = {
    hash: planRevision,
    applyRequirement: requirement,
    steps: [
      { id: "apply-changes", dependencies: [] },
      { id: "report-applied", dependencies: ["apply-changes"] },
    ],
  };
  await db.insert(aiChangeProposalsTable).values({
    id: proposalId,
    projectId,
    sessionId,
    messageId: (await db.select({ id: aiChatMessagesTable.id })
      .from(aiChatMessagesTable)
      .where(eq(aiChatMessagesTable.sessionId, sessionId))
      .limit(1))[0]!.id,
    changes: JSON.stringify([{
      path: "src/target.ts",
      originalContent: baseContent,
      newContent: candidateContent,
    }]),
    appliedChanges: JSON.stringify([{
      path: "src/target.ts",
      originalContent: baseContent,
      newContent: candidateContent,
    }]),
    status: "applied",
    lifecycle: "applied",
    operationId,
    baseRevision,
    changeSetHash,
    baseTreeHash,
    candidateTreeHash,
    promotedTreeHash: candidateTreeHash,
    treeDigestVersion: DELIVERY_TREE_DIGEST_VERSION,
    createdAt: now,
    consumedAt: now,
  });
  await db.insert(aiMissionsTable).values({
    id: missionId,
    projectId,
    userId,
    title: `Apply Changes recovery ${label}`,
    intent: "Apply the approved candidate and report the result.",
    status: "waiting",
    scope: { kind: "project", projectId },
    autonomyPolicy: {
      activePlanRevision: planRevision,
      applyMission: { proposalId, requirement },
    },
    createdAt: now,
    updatedAt: now,
  });
  await db.insert(aiGoalsTable).values({
    id: goalId,
    missionId,
    projectId,
    title: "Apply approved candidate",
    status: "waiting_for_event",
    blockedReason: "apply_changes_pending",
    nextAction: { kind: "wait", reason: "event", wakeAt: null },
    successCriteria: {
      stepId: "apply-changes",
      applyRequirement: requirement,
      planRevision: plan,
    },
    outcomeContract: {
      stepId: "apply-changes",
      applyRequirement: requirement,
      candidateIdentity: `${proposalId}:${candidateTreeHash}`,
      planRevision: plan,
    },
    createdAt: now,
    updatedAt: now,
  });
  await db.insert(aiGoalsTable).values({
    id: reportGoalId,
    missionId,
    projectId,
    title: "Report applied changes",
    status: "blocked",
    nextAction: { kind: "wait", reason: "event", wakeAt: null },
    successCriteria: { stepId: "report-applied", planRevision: { hash: planRevision } },
    outcomeContract: { planRevision: { hash: planRevision } },
    createdAt: now,
    updatedAt: now,
  });
  await db.insert(aiGoalDependenciesTable).values({
    id: randomUUID(),
    missionId,
    projectId,
    goalId: reportGoalId,
    dependsOnGoalId: goalId,
    planRevision,
    createdAt: now,
  });
  await db.update(aiExecutionsTable)
    .set({ goalId, proposalId })
    .where(eq(aiExecutionsTable.id, executionId));
  await db.update(aiAgentEpisodesTable)
    .set({ missionId, goalId, planRevision })
    .where(eq(aiAgentEpisodesTable.id, episodeId));

  const beforeObservationId = randomUUID();
  const afterObservationId = randomUUID();
  const observation = (input: {
    id: string;
    value: string;
    sequence: number;
  }) => ({
    id: input.id,
    projectId,
    executionId,
    episodeId,
    kind: "direct_observation" as const,
    observationRole: "workspace.tree_hash",
    sourceType: "direct_observation",
    sourceId: input.id,
    subject: `project:${projectId}`,
    predicate: "workspace.tree_hash",
    value: input.value,
    valueHash: createHash("sha256").update(JSON.stringify(input.value)).digest("hex"),
    sequence: input.sequence,
    taskScope: "project",
    environmentRevisionKey: `revision:${environmentRevision}`,
    provenance: "DIRECT_OBSERVATION" as const,
    sourceVersion: input.value,
    sourceRefs: [],
    observedAt: now,
    projectRevision: input.value,
    environmentRevision,
    completeness: "complete" as const,
    freshness: "fresh" as const,
    environmentFreshness: "fresh" as const,
    evidenceRefs: [`apply-recovery:${operationId}`],
    createdAt: now,
  });
  await db.insert(aiAgentObservationsTable).values([
    observation({ id: beforeObservationId, value: baseTreeHash, sequence: 0 }),
    observation({ id: afterObservationId, value: candidateTreeHash, sequence: 1 }),
  ]);

  const parent = await getProjectWorldState(projectId, { excludeEpisodeIds: [episodeId] });
  const actionId = `apply:${operationId}`;
  const transitionId = await createPendingApplyChangesTransition({
    projectId,
    executionId,
    attempt: claimed.attempt,
    episodeId,
    actionId,
    effectBundleId,
    proposalId,
    goalId,
    planRevision,
    workerId,
    parentWorldRevision: parent.worldRevision,
    parentFactRefs: [],
    beforeObservationIds: [beforeObservationId],
    afterObservationIds: [afterObservationId],
    evidenceRefs: [`apply-recovery:${operationId}`],
    environmentRevision,
    promotedTreeHash: candidateTreeHash,
  });

  const expectedEffect = buildApplyChangeEffectProofExpectation({
    executionId,
    attempt: claimed.attempt,
    proposalId,
    candidateTreeHash,
  });
  const effectId = randomUUID();
  await db.insert(aiAgentEffectsTable).values({
    id: effectId,
    projectId,
    executionId,
    episodeId,
    attempt: claimed.attempt,
    actionId,
    capabilityId: APPLY_CHANGE_CAPABILITY_ID,
    effectContractHash: expectedEffect.effectContractHash,
    beforeObservationIds: [beforeObservationId],
    afterObservationIds: [afterObservationId],
    expectedEffects: expectedEffect.contract.expectedStateChanges,
    status: "observed",
    missingEffects: [],
    contradictionRefs: [],
    evidenceRefs: [`apply-effect:${operationId}`],
    createdAt: now,
  });
  await db.update(aiAgentEffectBundlesTable)
    .set({
      effectIds: [effectId],
      effectContractHashes: [expectedEffect.effectContractHash],
      verdict: "OBSERVED",
    })
    .where(eq(aiAgentEffectBundlesTable.id, effectBundleId));

  const acceptanceId = randomUUID();
  await db.transaction(async (tx) => {
    await tx.update(aiExecutionsTable)
      .set({ status: "completed", completedAt: now, updatedAt: now })
      .where(eq(aiExecutionsTable.id, executionId));
    await tx.insert(aiExecutionAcceptancesTable).values({
      id: acceptanceId,
      executionId,
      projectId,
      attempt: claimed.attempt,
      finalizationKey: `final:${executionId}:${claimed.attempt}`,
      operationId,
      workerId,
      terminalStatus: "completed",
      outcome: "SUCCEEDED",
      reasonCode: "CANONICAL_PROOF_PROVEN",
      nextActionCode: "none",
      effectBundleId,
      createdAt: now,
    });
  });

  const finalizeInput = {
    projectId,
    executionId,
    attempt: claimed.attempt,
    episodeId,
    actionId,
    effectBundleId,
  };
  const fixture: ApplyFixture = {
    projectId,
    sessionId,
    executionId,
    attempt: claimed.attempt,
    episodeId,
    workerId,
    operationId,
    proposalId,
    missionId,
    goalId,
    reportGoalId,
    planRevision,
    effectBundleId,
    effectId,
    acceptanceId,
    transitionId,
    beforeObservationId,
    afterObservationId,
    environmentRevision,
    baseTreeHash,
    candidateTreeHash,
    rootPath,
    targetPath,
    baseContent,
    candidateContent,
    finalizeInput,
  };
  createdFixtures[createdFixtures.length - 1] = fixture;
  const establishedRoot = await establishProjectRoot(rootPath);
  if (!establishedRoot.ok) throw new Error("Apply recovery fixture root is not admissible.");
  return fixture;
}

async function insertAttemptEpisode(fixture: ApplyFixture, attempt: number): Promise<string> {
  const episodeId = randomUUID();
  const now = new Date();
  await db.insert(aiAgentEpisodesTable).values({
    id: episodeId,
    projectId: fixture.projectId,
    executionId: fixture.executionId,
    attempt,
    projectRevision: fixture.baseTreeHash,
    intentKind: "RUNTIME_START",
    scope: { kind: "project", paths: [] },
    workerId: fixture.workerId,
    leaseUntil: new Date(now.getTime() + 60_000),
    idempotencyKey: `e2-apply-recovery-episode:${episodeId}`,
    createdAt: now,
    updatedAt: now,
  });
  return episodeId;
}

async function installSecondFactTrigger(
  fixture: ApplyFixture,
  behavior: "raise" | "sleep",
): Promise<{ functionName: string; triggerName: string }> {
  const suffix = fixture.projectId.replaceAll("-", "");
  const functionName = `e2_apply_fault_${suffix}`;
  const triggerName = `e2_apply_trigger_${suffix}`;
  const secondInsertAction = behavior === "raise"
    ? "RAISE EXCEPTION 'e2_apply_materialization_injected_failure' USING ERRCODE = '40001';"
    : "PERFORM pg_sleep(5);";
  await db.execute(sql.raw(`
    CREATE FUNCTION ${functionName}() RETURNS trigger LANGUAGE plpgsql AS $$
    DECLARE
      insert_count integer;
    BEGIN
      IF NEW.project_id = '${fixture.projectId}' THEN
        insert_count := COALESCE(
          NULLIF(current_setting('e2.apply_fact_count', true), '')::integer,
          0
        ) + 1;
        PERFORM set_config('e2.apply_fact_count', insert_count::text, true);
        IF insert_count >= 2 THEN
          ${secondInsertAction}
        END IF;
      END IF;
      RETURN NEW;
    END;
    $$;
  `));
  await db.execute(sql.raw(`
    CREATE TRIGGER ${triggerName}
    BEFORE INSERT ON ai_world_facts
    FOR EACH ROW EXECUTE FUNCTION ${functionName}()
  `));
  const trigger = { functionName, triggerName };
  createdTriggers.push(trigger);
  return trigger;
}

async function dropTrigger(trigger: { functionName: string; triggerName: string }): Promise<void> {
  await db.execute(sql.raw(`DROP TRIGGER IF EXISTS ${trigger.triggerName} ON ai_world_facts`));
  await db.execute(sql.raw(`DROP FUNCTION IF EXISTS ${trigger.functionName}()`));
  const index = createdTriggers.findIndex((item) => item.triggerName === trigger.triggerName);
  if (index >= 0) createdTriggers.splice(index, 1);
}

function signalProcessGroup(child: ChildProcess, signal: NodeJS.Signals): void {
  if (!child.pid) return;
  try {
    process.kill(-child.pid, signal);
  } catch {
    try {
      child.kill(signal);
    } catch {
      // The process group already exited.
    }
  }
}

async function reserveLoopbackPort(): Promise<number> {
  const server = createTcpServer();
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("Could not reserve a loopback port.");
  await new Promise<void>((resolve, reject) => {
    server.close((error) => error ? reject(error) : resolve());
  });
  return address.port;
}

async function isPortOpen(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = createConnection({ host: "127.0.0.1", port });
    let finished = false;
    const finish = (connected: boolean) => {
      if (finished) return;
      finished = true;
      socket.destroy();
      resolve(connected);
    };
    socket.setTimeout(500, () => finish(false));
    socket.once("connect", () => finish(true));
    socket.once("error", () => finish(false));
  });
}

async function waitUntil(
  label: string,
  predicate: () => Promise<boolean>,
  timeoutMs = 45_000,
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await predicate()) return;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error(`Timed out waiting for ${label}.`);
}

async function startApiProcess(
  fixture: ApplyFixture,
  phase: "crash" | "restart",
  port: number,
): Promise<ApiProcess> {
  const applicationName = `e2-apply-${phase}-${fixture.projectId.slice(0, 8)}`;
  const childDatabaseUrl = new URL(process.env.DATABASE_URL!);
  childDatabaseUrl.searchParams.set("application_name", applicationName);
  const source = [
    "(async () => {",
    '  const { isProviderEgressDisabled } = await import("@workspace/ai-orchestrator");',
    '  if (!isProviderEgressDisabled()) throw new Error("Provider egress guard is not active.");',
    '  await import("./src/index.ts");',
    '  process.stdout.write("E2_APPLY_INDEX_IMPORTED\\\\n");',
    "})().catch((error) => {",
    "  console.error(error);",
    "  process.exitCode = 1;",
    "});",
  ].join("\n");
  const child = spawn(process.execPath, ["--import", "tsx", "-e", source], {
    cwd: apiRoot,
    env: {
      DATABASE_URL: childDatabaseUrl.toString(),
      NODE_ENV: "test",
      PATH: process.env.PATH ?? "",
      HOME: os.homedir(),
      PGAPPNAME: applicationName,
      PORT: String(port),
      AI_PROVIDER_EGRESS_DISABLED: "1",
      RUN_CONTROLLED_RELEASE_VALIDATION: "1",
      DASHBOARD_E2E_TEST_MODE: "fixture",
    },
    stdio: ["ignore", "pipe", "pipe"],
    detached: true,
  });
  childProcesses.push({
    child,
    applicationName,
    port,
    exit: new Promise((resolve) => {
      child.once("exit", (code, signal) => resolve({ code, signal }));
    }),
    output: () => output,
    diagnostics: () => diagnostics,
    waitFor: async () => undefined,
  });
  const handle = childProcesses[childProcesses.length - 1]!;
  let output = "";
  let diagnostics = "";
  child.stdout?.setEncoding("utf8").on("data", (chunk: string) => { output += chunk; });
  child.stderr?.setEncoding("utf8").on("data", (chunk: string) => { diagnostics += chunk; });
  handle.output = () => output;
  handle.diagnostics = () => diagnostics;
  handle.waitFor = async (pattern, label, timeoutMs = 45_000) => {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      if (pattern.test(output)) return;
      if (child.exitCode !== null || child.signalCode !== null) {
        throw new Error(
          `API process exited before ${label}; stderr=${diagnostics}; stdout=${output}`,
        );
      }
      await new Promise((resolve) => setTimeout(resolve, 25));
    }
    throw new Error(`Timed out waiting for ${label}; stderr=${diagnostics}; stdout=${output}`);
  };
  await handle.waitFor(/E2_APPLY_INDEX_IMPORTED/, "full src/index.ts import");
  await waitUntil("full API listener", () => isPortOpen(port));
  return handle;
}

async function waitForPostgresSleep(applicationName: string): Promise<void> {
  await waitUntil("Apply Changes recovery inside the injected database transaction", async () => {
    const result = await db.execute(sql`
      SELECT 1
      FROM pg_stat_activity
      WHERE application_name = ${applicationName}
        AND wait_event = 'PgSleep'
      LIMIT 1
    `);
    const rows = (result as unknown as { rows?: unknown[] }).rows ?? [];
    return rows.length > 0;
  });
}

async function waitForDatabaseSessionToClose(applicationName: string, timeoutMs = 45_000): Promise<void> {
  await waitUntil("killed API database session to close", async () => {
    const result = await db.execute(sql`
      SELECT count(*)::integer AS count
      FROM pg_stat_activity
      WHERE application_name = ${applicationName}
    `);
    const rows = (result as unknown as { rows?: Array<{ count: number | string }> }).rows ?? [];
    return Number(rows[0]?.count ?? 0) === 0;
  }, timeoutMs);
}

async function stopApiProcess(handle: ApiProcess, signal: NodeJS.Signals): Promise<void> {
  if (handle.child.exitCode !== null || handle.child.signalCode !== null) return;
  signalProcessGroup(handle.child, signal);
  await Promise.race([
    handle.exit,
    new Promise((resolve) => setTimeout(resolve, 8_000)),
  ]);
  if (handle.child.exitCode === null && handle.child.signalCode === null) {
    signalProcessGroup(handle.child, "SIGKILL");
    await Promise.race([
      handle.exit,
      new Promise((resolve) => setTimeout(resolve, 2_000)),
    ]);
  }
}

afterEach(async () => {
  for (const handle of childProcesses.splice(0)) {
    if (handle.child.exitCode === null && handle.child.signalCode === null) {
      await stopApiProcess(handle, "SIGKILL");
    }
  }
  for (const trigger of createdTriggers.splice(0)) {
    await db.execute(sql.raw(`DROP TRIGGER IF EXISTS ${trigger.triggerName} ON ai_world_facts`))
      .catch(() => undefined);
    await db.execute(sql.raw(`DROP FUNCTION IF EXISTS ${trigger.functionName}()`))
      .catch(() => undefined);
  }
  for (const fixture of createdFixtures.splice(0)) {
    if (!fixture.projectId) continue;
    await db.delete(projectsTable).where(eq(projectsTable.id, fixture.projectId));
    if (fixture.rootPath) await rm(fixture.rootPath, { recursive: true, force: true });
  }
});

describe("E2 Apply Changes failure and process-restart recovery", () => {
  it.runIf(isLoopbackDatabase())(
    "rolls back partial World State writes after a file effect and recovers the same proof once",
    async () => {
      expect(isLoopbackDatabase(), "this integration test requires a disposable loopback PostgreSQL URL")
        .toBe(true);
      const fixture = await createApplyFixture("transaction-failure");
      expect(await readFile(fixture.targetPath, "utf8")).toBe(fixture.candidateContent);
      expect(await hashDeliveryTree(fixture.rootPath)).toBe(fixture.candidateTreeHash);

      const trigger = await installSecondFactTrigger(fixture, "raise");
      const failedMaterialization = await finalizeApplyChangesTransition(fixture.finalizeInput);
      expect(failedMaterialization).toMatchObject({
        status: "pending",
        failureCode: "world_state_materialization_failed",
      });
      await dropTrigger(trigger);

      const [afterFailure] = await db.select({
        status: aiWorldTransitionsTable.status,
        retryCount: aiWorldTransitionsTable.retryCount,
        resultingWorldRevision: aiWorldTransitionsTable.resultingWorldRevision,
        materializedAt: aiWorldTransitionsTable.materializedAt,
      }).from(aiWorldTransitionsTable)
        .where(eq(aiWorldTransitionsTable.id, fixture.transitionId));
      expect(afterFailure).toMatchObject({
        status: "retrying",
        retryCount: 1,
        resultingWorldRevision: null,
        materializedAt: null,
      });
      expect(await db.select({ id: aiWorldFactsTable.id })
        .from(aiWorldFactsTable)
        .where(eq(aiWorldFactsTable.projectId, fixture.projectId))).toHaveLength(0);

      const [acceptance] = await db.select({
        outcome: aiExecutionAcceptancesTable.outcome,
        attempt: aiExecutionAcceptancesTable.attempt,
        effectBundleId: aiExecutionAcceptancesTable.effectBundleId,
      }).from(aiExecutionAcceptancesTable)
        .where(eq(aiExecutionAcceptancesTable.id, fixture.acceptanceId));
      expect(acceptance).toEqual({
        outcome: "SUCCEEDED",
        attempt: fixture.attempt,
        effectBundleId: fixture.effectBundleId,
      });
      const [bundle] = await db.select().from(aiAgentEffectBundlesTable)
        .where(eq(aiAgentEffectBundlesTable.id, fixture.effectBundleId));
      const [effect] = await db.select().from(aiAgentEffectsTable)
        .where(eq(aiAgentEffectsTable.id, fixture.effectId));
      expect(bundle).toMatchObject({
        verdict: "OBSERVED",
        effectIds: [fixture.effectId],
      });
      expect(effect).toMatchObject({
        projectId: fixture.projectId,
        executionId: fixture.executionId,
        attempt: fixture.attempt,
        episodeId: fixture.episodeId,
        status: "observed",
      });
      expect(await db.select({ id: aiAgentObservationsTable.id })
        .from(aiAgentObservationsTable)
        .where(and(
          eq(aiAgentObservationsTable.executionId, fixture.executionId),
          inArray(aiAgentObservationsTable.id, [
            fixture.beforeObservationId,
            fixture.afterObservationId,
          ]),
        ))).toHaveLength(2);

      const [goal] = await db.select().from(aiGoalsTable).where(eq(aiGoalsTable.id, fixture.goalId));
      const [mission] = await db.select().from(aiMissionsTable)
        .where(eq(aiMissionsTable.id, fixture.missionId));
      const pendingD2 = await db.transaction((tx) => evaluateApplyChangesD2(tx, {
        goal: goal!,
        mission: mission!,
        activePlanRevision: fixture.planRevision,
      }));
      expect(pendingD2).toMatchObject({ state: "pending", reason: "apply_transition_pending" });

      await db.update(aiWorldTransitionsTable)
        .set({ nextRetryAt: new Date(0) })
        .where(eq(aiWorldTransitionsTable.id, fixture.transitionId));
      expect(await retryPendingRuntimeStartTransitions(1)).toBe(1);
      expect(await retryPendingRuntimeStartTransitions(1)).toBe(0);
      expect(await hashDeliveryTree(fixture.rootPath)).toBe(fixture.candidateTreeHash);
      const [recovered] = await db.select({
        status: aiWorldTransitionsTable.status,
        attempt: aiWorldTransitionsTable.attempt,
        episodeId: aiWorldTransitionsTable.episodeId,
        resultingWorldRevision: aiWorldTransitionsTable.resultingWorldRevision,
        materializedObservationIds: aiWorldTransitionsTable.materializedObservationIds,
      }).from(aiWorldTransitionsTable)
        .where(eq(aiWorldTransitionsTable.id, fixture.transitionId));
      expect(recovered).toMatchObject({
        status: "materialized",
        attempt: fixture.attempt,
        episodeId: fixture.episodeId,
        resultingWorldRevision: expect.stringMatching(/^[a-f0-9]{64}$/),
        materializedObservationIds: expect.arrayContaining([
          fixture.beforeObservationId,
          fixture.afterObservationId,
        ]),
      });
      expect(await db.select({ id: aiWorldFactsTable.id })
        .from(aiWorldFactsTable)
        .where(eq(aiWorldFactsTable.projectId, fixture.projectId))).toHaveLength(2);
      expect(await db.select({ id: aiWorldTransitionsTable.id })
        .from(aiWorldTransitionsTable)
        .where(and(
          eq(aiWorldTransitionsTable.executionId, fixture.executionId),
          eq(aiWorldTransitionsTable.idempotencyKey, `apply.changes:${fixture.executionId}:${fixture.attempt}:${fixture.episodeId}:${fixture.finalizeInput.actionId}:${fixture.proposalId}:${fixture.planRevision}`),
        ))).toHaveLength(1);
    },
  );

  it.runIf(isLoopbackDatabase() && process.env.RUN_E2_APPLY_CHANGES_PROCESS_RESTART === "1")(
    "recovers an in-flight materialization after SIGKILL and rejects stale or rebound proof",
    async () => {
      expect(isLoopbackDatabase(), "process recovery requires a disposable loopback PostgreSQL URL")
        .toBe(true);
      const databaseUrl = process.env.DATABASE_URL;
      if (!databaseUrl) throw new Error("DATABASE_URL is required for isolated process recovery.");

      const crashFixture = await createApplyFixture("process-restart");
      const staleFixture = await createApplyFixture("stale-observation");
      const driftFixture = await createApplyFixture("live-tree-drift");
      const episodeFixture = await createApplyFixture("rebound-episode");
      const attemptFixture = await createApplyFixture("rotated-attempt");

      await db.update(aiAgentObservationsTable)
        .set({ freshness: "stale" })
        .where(eq(aiAgentObservationsTable.id, staleFixture.afterObservationId));
      await writeFile(driftFixture.targetPath, "export const value = 'changed after the observation';\n", "utf8");
      expect(await hashDeliveryTree(driftFixture.rootPath)).not.toBe(driftFixture.candidateTreeHash);

      await db.update(aiWorldTransitionsTable)
        .set({ episodeId: crashFixture.episodeId })
        .where(eq(aiWorldTransitionsTable.id, episodeFixture.transitionId));

      const newAttempt = attemptFixture.attempt + 1;
      await db.update(aiExecutionsTable)
        .set({ attempt: newAttempt, updatedAt: new Date() })
        .where(eq(aiExecutionsTable.id, attemptFixture.executionId));
      await insertAttemptEpisode(attemptFixture, newAttempt);
      await db.insert(aiExecutionAcceptancesTable).values({
        id: randomUUID(),
        executionId: attemptFixture.executionId,
        projectId: attemptFixture.projectId,
        attempt: newAttempt,
        finalizationKey: `failed-replay:${attemptFixture.executionId}:${newAttempt}`,
        operationId: attemptFixture.operationId,
        workerId: attemptFixture.workerId,
        terminalStatus: "failed",
        outcome: "FAILED",
        reasonCode: "RECOVERY_FIXTURE_REJECTED",
        nextActionCode: "none",
        effectBundleId: null,
        createdAt: new Date(),
      });

      await db.update(aiWorldTransitionsTable)
        .set({ createdAt: new Date(0) })
        .where(eq(aiWorldTransitionsTable.id, crashFixture.transitionId));
      const faultTrigger = await installSecondFactTrigger(crashFixture, "sleep");
      const port = await reserveLoopbackPort();
      const crashingApi = await startApiProcess(crashFixture, "crash", port);
      try {
        await waitForPostgresSleep(crashingApi.applicationName);
        expect(await readFile(crashFixture.targetPath, "utf8")).toBe(crashFixture.candidateContent);
        expect(await hashDeliveryTree(crashFixture.rootPath)).toBe(crashFixture.candidateTreeHash);
        const [inFlight] = await db.select({
          status: aiWorldTransitionsTable.status,
          retryCount: aiWorldTransitionsTable.retryCount,
        }).from(aiWorldTransitionsTable)
          .where(eq(aiWorldTransitionsTable.id, crashFixture.transitionId));
        expect(inFlight).toMatchObject({ status: "retrying", retryCount: 0 });
        expect(await db.select({ id: aiWorldFactsTable.id })
          .from(aiWorldFactsTable)
          .where(eq(aiWorldFactsTable.projectId, crashFixture.projectId))).toHaveLength(0);

        signalProcessGroup(crashingApi.child, "SIGKILL");
        expect(await crashingApi.exit).toMatchObject({ code: null, signal: "SIGKILL" });
        await waitForDatabaseSessionToClose(crashingApi.applicationName, 20_000);
      } finally {
        await dropTrigger(faultTrigger);
      }

      const [afterCrash] = await db.select({
        status: aiWorldTransitionsTable.status,
        resultingWorldRevision: aiWorldTransitionsTable.resultingWorldRevision,
        materializedAt: aiWorldTransitionsTable.materializedAt,
      }).from(aiWorldTransitionsTable)
        .where(eq(aiWorldTransitionsTable.id, crashFixture.transitionId));
      expect(afterCrash).toMatchObject({
        status: "retrying",
        resultingWorldRevision: null,
        materializedAt: null,
      });
      expect(await db.select({ id: aiWorldFactsTable.id })
        .from(aiWorldFactsTable)
        .where(eq(aiWorldFactsTable.projectId, crashFixture.projectId))).toHaveLength(0);

      await db.update(aiWorldTransitionsTable)
        .set({ nextRetryAt: new Date(0) })
        .where(eq(aiWorldTransitionsTable.id, crashFixture.transitionId));
      const restartedApi = await startApiProcess(crashFixture, "restart", port);
      try {
        const transitionIds = [
          crashFixture.transitionId,
          staleFixture.transitionId,
          driftFixture.transitionId,
          episodeFixture.transitionId,
          attemptFixture.transitionId,
        ];
        await waitUntil("all restarted Apply Changes transitions to reach terminal states", async () => {
          const rows = await db.select({
            id: aiWorldTransitionsTable.id,
            status: aiWorldTransitionsTable.status,
          }).from(aiWorldTransitionsTable)
            .where(inArray(aiWorldTransitionsTable.id, transitionIds));
          return rows.length === transitionIds.length
            && rows.every((row) => row.status === "materialized" || row.status === "terminal_failed");
        }, 90_000);
      } finally {
        await stopApiProcess(restartedApi, "SIGTERM");
      }

      const [replayed] = await db.select({
        status: aiWorldTransitionsTable.status,
        attempt: aiWorldTransitionsTable.attempt,
        episodeId: aiWorldTransitionsTable.episodeId,
        resultingWorldRevision: aiWorldTransitionsTable.resultingWorldRevision,
        materializedObservationIds: aiWorldTransitionsTable.materializedObservationIds,
      }).from(aiWorldTransitionsTable)
        .where(eq(aiWorldTransitionsTable.id, crashFixture.transitionId));
      expect(replayed).toMatchObject({
        status: "materialized",
        attempt: crashFixture.attempt,
        episodeId: crashFixture.episodeId,
        resultingWorldRevision: expect.stringMatching(/^[a-f0-9]{64}$/),
        materializedObservationIds: expect.arrayContaining([
          crashFixture.beforeObservationId,
          crashFixture.afterObservationId,
        ]),
      });
      expect(await readFile(crashFixture.targetPath, "utf8")).toBe(crashFixture.candidateContent);
      expect(await hashDeliveryTree(crashFixture.rootPath)).toBe(crashFixture.candidateTreeHash);

      const [bundle] = await db.select().from(aiAgentEffectBundlesTable)
        .where(eq(aiAgentEffectBundlesTable.id, crashFixture.effectBundleId));
      const [effect] = await db.select().from(aiAgentEffectsTable)
        .where(eq(aiAgentEffectsTable.id, crashFixture.effectId));
      const [acceptance] = await db.select({
        outcome: aiExecutionAcceptancesTable.outcome,
        attempt: aiExecutionAcceptancesTable.attempt,
        effectBundleId: aiExecutionAcceptancesTable.effectBundleId,
      }).from(aiExecutionAcceptancesTable)
        .where(eq(aiExecutionAcceptancesTable.id, crashFixture.acceptanceId));
      expect(bundle).toMatchObject({
        verdict: "OBSERVED",
        effectIds: [crashFixture.effectId],
      });
      expect(effect).toMatchObject({
        projectId: crashFixture.projectId,
        executionId: crashFixture.executionId,
        attempt: crashFixture.attempt,
        episodeId: crashFixture.episodeId,
        status: "observed",
      });
      expect(acceptance).toEqual({
        outcome: "SUCCEEDED",
        attempt: crashFixture.attempt,
        effectBundleId: crashFixture.effectBundleId,
      });

      const exactTransitionKey = `apply.changes:${crashFixture.executionId}:${crashFixture.attempt}:${crashFixture.episodeId}:${crashFixture.finalizeInput.actionId}:${crashFixture.proposalId}:${crashFixture.planRevision}`;
      expect(await db.select({ id: aiWorldTransitionsTable.id })
        .from(aiWorldTransitionsTable)
        .where(and(
          eq(aiWorldTransitionsTable.executionId, crashFixture.executionId),
          eq(aiWorldTransitionsTable.idempotencyKey, exactTransitionKey),
        ))).toHaveLength(1);
      const facts = await db.select({
        id: aiWorldFactsTable.id,
        sourceObservationIds: aiWorldFactsTable.sourceObservationIds,
      }).from(aiWorldFactsTable)
        .where(eq(aiWorldFactsTable.projectId, crashFixture.projectId));
      expect(facts).toHaveLength(2);
      expect(facts.some((fact) => Array.isArray(fact.sourceObservationIds)
        && fact.sourceObservationIds.includes(crashFixture.beforeObservationId))).toBe(true);
      expect(facts.some((fact) => Array.isArray(fact.sourceObservationIds)
        && fact.sourceObservationIds.includes(crashFixture.afterObservationId))).toBe(true);
      expect(await retryPendingRuntimeStartTransitions(32)).toBe(0);
      expect(await db.select({ id: aiWorldFactsTable.id })
        .from(aiWorldFactsTable)
        .where(eq(aiWorldFactsTable.projectId, crashFixture.projectId))).toHaveLength(2);

      const rejectedIds = [
        staleFixture.transitionId,
        driftFixture.transitionId,
        episodeFixture.transitionId,
        attemptFixture.transitionId,
      ];
      const rejected = await db.select({
        id: aiWorldTransitionsTable.id,
        status: aiWorldTransitionsTable.status,
        failureCode: aiWorldTransitionsTable.failureCode,
      }).from(aiWorldTransitionsTable)
        .where(inArray(aiWorldTransitionsTable.id, rejectedIds));
      expect(rejected).toHaveLength(rejectedIds.length);
      expect(rejected.every((row) => row.status === "terminal_failed")).toBe(true);
      expect(rejected.map((row) => row.failureCode)).toContain("apply_transition_live_tree_mismatch");
      expect(rejected.map((row) => row.failureCode)).toContain("apply_transition_observations_incomplete");
      expect(rejected.map((row) => row.failureCode)).toContain("apply_transition_execution_not_completed");
      for (const fixture of [staleFixture, driftFixture, episodeFixture, attemptFixture]) {
        expect(await db.select({ id: aiWorldFactsTable.id })
          .from(aiWorldFactsTable)
          .where(eq(aiWorldFactsTable.projectId, fixture.projectId))).toHaveLength(0);
      }
      const failedAttemptAcceptances = await db.select({
        outcome: aiExecutionAcceptancesTable.outcome,
        attempt: aiExecutionAcceptancesTable.attempt,
      }).from(aiExecutionAcceptancesTable)
        .where(eq(aiExecutionAcceptancesTable.executionId, attemptFixture.executionId));
      expect(failedAttemptAcceptances).toEqual(expect.arrayContaining([
        { outcome: "SUCCEEDED", attempt: attemptFixture.attempt },
        { outcome: "FAILED", attempt: attemptFixture.attempt + 1 },
      ]));
    },
  );
});