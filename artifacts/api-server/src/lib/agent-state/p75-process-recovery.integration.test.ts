import { spawn, type ChildProcess } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import { and, asc, eq, inArray } from "drizzle-orm";
import {
  aiAgentEpisodeEventsTable,
  aiAgentObservationsTable,
  aiAgentEpisodesTable,
  aiChatSessionsTable,
  aiExecutionAcceptancesTable,
  aiExecutionsTable,
  aiGoalsTable,
  aiMissionsTable,
  db,
  projectsTable,
} from "@workspace/db";
import {
  claimAiExecution,
  createAiExecution,
  reconcileAiExecutions,
} from "../ai-execution-state.js";
import {
  appendEpisodeEvent,
  startEpisode,
} from "./agent-episode-ledger.js";
import {
  captureEnvironmentAttestation,
  serverEnvironmentProfile,
} from "./environment-attestation.js";
import { buildRuntimeStartHypothesisExperimentRegistration } from "./runtime-start-hypothesis-experiment.js";
import { prepareRecipeOperation } from "../recipe-operation-runner.js";

const apiRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../");
const workspaceRoot = path.resolve(apiRoot, "../..");
const workerPath = path.join(apiRoot, "scripts/p75-process-recovery-worker.ts");
const childProcesses: ChildProcess[] = [];

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

afterEach(async () => {
  await Promise.all(childProcesses.splice(0).map(async (child) => {
    if (child.exitCode !== null || child.signalCode !== null) return;
    signalProcessGroup(child, "SIGKILL");
    await Promise.race([
      new Promise<void>((resolve) => child.once("close", () => resolve())),
      new Promise<void>((resolve) => setTimeout(resolve, 1_000)),
    ]);
  }));
});

function runWorker(mode: string, inputPath: string, onOutput?: (text: string) => void): Promise<{
  code: number | null;
  signal: NodeJS.Signals | null;
  stdout: string;
  stderr: string;
}> {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, ["--import", "tsx", workerPath, mode, inputPath], {
      cwd: apiRoot,
      env: process.env,
      stdio: ["ignore", "pipe", "pipe"],
      detached: true,
    });
    childProcesses.push(child);
    let stdout = "";
    let stderr = "";
    let settled = false;
    let timeout: NodeJS.Timeout;
    const finish = (result: {
      code: number | null;
      signal: NodeJS.Signals | null;
      stdout: string;
      stderr: string;
    }) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      resolve(result);
    };
    child.stdout.setEncoding("utf8").on("data", (chunk: string) => {
      stdout += chunk;
      onOutput?.(stdout);
    });
    child.stderr.setEncoding("utf8").on("data", (chunk: string) => { stderr += chunk; });
    child.once("error", (error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      reject(error);
    });
    child.once("close", (code, signal) => finish({ code, signal, stdout, stderr }));
    timeout = setTimeout(() => {
      stderr += "\nP75 worker process-group timeout";
      signalProcessGroup(child, "SIGTERM");
      setTimeout(() => signalProcessGroup(child, "SIGKILL"), 1_000).unref();
    }, 45_000);
  });
}

function parseWorkerRecord<T>(output: string, label: string): T {
  const line = output.split(/\r?\n/).find((entry) => entry.startsWith(`${label} `));
  if (!line) throw new Error(`Worker output did not contain ${label}: ${output}`);
  return JSON.parse(line.slice(label.length + 1)) as T;
}

async function terminateRuntimeGroup(pid: number | undefined): Promise<void> {
  if (!pid) return;
  try {
    process.kill(-pid, "SIGTERM");
  } catch {
    try {
      process.kill(pid, "SIGTERM");
    } catch {
      return;
    }
  }
  await new Promise((resolve) => setTimeout(resolve, 100));
  try {
    process.kill(-pid, "SIGKILL");
  } catch {
    try {
      process.kill(pid, "SIGKILL");
    } catch {
      // The detached runtime already exited.
    }
  }
}

describe("P7.5 process recovery", () => {
  it("recovers one retained observer result in a second API worker without a second runtime read", async () => {
    const rootPath = await mkdtemp(path.join(workspaceRoot, ".p75-process-recovery-"));
    const projectId = crypto.randomUUID();
    const operationId = crypto.randomUUID();
    const sessionId = crypto.randomUUID();
    const missionId = crypto.randomUUID();
    const goalId = crypto.randomUUID();
    const userId = `p75-process-recovery:${projectId}`;
    const sourceRevision = `p75-process-revision:${projectId}`;
    const planRevision = `p75-process-plan:${projectId}`;
    const projectName = `p75-process-${projectId.slice(0, 8)}`;
    let executionId: string | undefined;
    let runtimePid: number | undefined;
    let fixturePath: string | undefined;

    try {
      await writeFile(
        path.join(rootPath, "package.json"),
        JSON.stringify({ private: true, scripts: { dev: "node runtime-server.cjs" } }),
        "utf8",
      );
      await writeFile(
        path.join(rootPath, "runtime-server.cjs"),
        [
          'const http = require("node:http");',
          'const server = http.createServer((_request, response) => {',
          `  response.setHeader("x-engineeringos-revision", ${JSON.stringify(sourceRevision)});`,
          '  response.end("p75 runtime recovery fixture");',
          "});",
          'server.listen(Number(process.env.PORT), "0.0.0.0");',
        ].join("\n"),
        "utf8",
      );
      const environment = await captureEnvironmentAttestation({
        rootPath,
        profile: serverEnvironmentProfile("RUNTIME_START", {
          kind: "recipe",
          recipeId: "runtime.start",
        }),
      });
      if (environment.status !== "known") {
        throw new Error(`P7.5 process fixture environment is unavailable: ${environment.reason}`);
      }

      const now = new Date();
      await db.insert(projectsTable).values({
        id: projectId,
        ownerId: userId,
        name: projectName,
        rootPath,
        language: "javascript",
        status: "active",
        createdAt: now,
        updatedAt: now,
      });
      await db.insert(aiChatSessionsTable).values({
        id: sessionId,
        projectId,
        title: "P7.5 process recovery fixture",
        createdAt: now,
        updatedAt: now,
      });
      await db.insert(aiMissionsTable).values({
        id: missionId,
        projectId,
        userId,
        title: "Recover runtime measurement",
        intent: "Recover one persisted runtime observation",
        status: "active",
        scope: { kind: "project", projectId },
      });
      await db.insert(aiGoalsTable).values({
        id: goalId,
        missionId,
        projectId,
        title: "Record the recovered measurement",
        status: "running",
      });

      const params = {
        projectId,
        operationId,
        sessionId,
        userId,
        idempotencyKey: `${operationId}:p75-process-recovery`,
        rootPath,
        sourceRevision,
        recipeId: "runtime.start" as const,
        recipeVersion: 1 as const,
        approvedPaths: [] as string[],
        missionId,
        goalId,
        planRevision,
      };
      const prepared = prepareRecipeOperation({
        ...params,
        runtimeStartRunner: async () => {
          throw new Error("P7.5 recovery fixture must not start the recipe runtime action.");
        },
      });
      const created = await createAiExecution({
        userId,
        request: {
          projectId,
          operationId,
          sessionId,
          message: `recipe:${operationId}`,
          modelMessage: `recipe:${operationId}`,
          workspaceRevision: sourceRevision,
          validationTargetPaths: [],
        },
        idempotencyKey: params.idempotencyKey,
        projectId,
        goalId,
        sessionId,
        recipeBinding: prepared.binding,
      });
      executionId = created.execution.id;
      const sourceWorkerId = `p75-source-worker:${executionId}`;
      const sourceClaim = await claimAiExecution({
        executionId,
        userId,
        workerId: sourceWorkerId,
        recipeBinding: prepared.binding,
      });
      if (!sourceClaim) throw new Error("Could not claim the P7.5 source attempt.");
      const sourceEpisode = await startEpisode({
        projectId,
        executionId,
        attempt: sourceClaim.attempt,
        workerId: sourceWorkerId,
        idempotencyKey: `${operationId}:episode:${sourceClaim.attempt}`,
        projectRevision: sourceRevision,
        intentKind: "RUNTIME_START",
        scope: {
          kind: "recipe",
          operationId,
          recipeId: "runtime.start",
          candidateIdentity: null,
        },
        missionId,
        goalId,
        planRevision,
      });
      const registration = buildRuntimeStartHypothesisExperimentRegistration({
        projectId,
        missionId,
        goalId,
        executionId,
        attempt: sourceClaim.attempt,
        episodeId: sourceEpisode.episodeId,
        actionId: `${operationId}:runtime-start-action`,
        planRevision,
        projectRevision: sourceRevision,
        environmentRevision: environment.environmentRevision,
        parentWorldRevision: "b".repeat(64),
        beforeObservationIds: [`${operationId}:runtime-start-before`],
        predictionRegisteredAt: new Date().toISOString(),
      });
      await appendEpisodeEvent({
        episodeId: sourceEpisode.episodeId,
        projectId,
        executionId,
        attempt: sourceClaim.attempt,
        workerId: sourceWorkerId,
        eventType: "OBSERVATION_REQUESTED",
        payload: registration as never,
        actorType: "server",
        actorId: sourceWorkerId,
        correlationId: executionId,
      });

      await db.update(aiExecutionsTable)
        .set({ leaseUntil: new Date(Date.now() - 1_000) })
        .where(eq(aiExecutionsTable.id, executionId));
      expect(await reconcileAiExecutions({ expiredOnly: true })).toBeGreaterThanOrEqual(1);

      const workerInput = {
        params,
        executionId,
        recipeBinding: prepared.binding,
        environmentRevision: environment.environmentRevision,
        sourceEpisodeId: sourceEpisode.episodeId,
        sourceAttempt: sourceClaim.attempt,
      };
      fixturePath = path.join(rootPath, "p75-worker-input.json");
      await writeFile(fixturePath, JSON.stringify(workerInput), "utf8");

      const firstWorker = await runWorker("observe-and-crash", fixturePath, (chunk) => {
        const runtimeLine = chunk.split(/\r?\n/)
          .find((entry) => entry.startsWith("P75_RUNTIME_STARTED "));
        if (runtimeLine) {
          runtimePid = (JSON.parse(runtimeLine.slice("P75_RUNTIME_STARTED ".length)) as { pid?: number }).pid;
        }
      });
      const runtimeLine = firstWorker.stdout.split(/\r?\n/)
        .find((entry) => entry.startsWith("P75_RUNTIME_STARTED "));
      if (runtimeLine) {
        runtimePid = (JSON.parse(runtimeLine.slice("P75_RUNTIME_STARTED ".length)) as { pid?: number }).pid;
      }
      expect(firstWorker.code, `${firstWorker.stdout}\n${firstWorker.stderr}`).toBe(73);
      expect(firstWorker.signal, `${firstWorker.stdout}\n${firstWorker.stderr}`).toBeNull();
      const runtime = parseWorkerRecord<{ pid: number; port: number; sessionId: string }>(
        firstWorker.stdout,
        "P75_RUNTIME_STARTED",
      );
      runtimePid = runtime.pid;
      expect(runtime.port).toBeGreaterThan(0);
      expect(runtime.sessionId).toBeTruthy();
      const retained = parseWorkerRecord<{
        id: string;
        value: Record<string, unknown>;
      }>(firstWorker.stdout, "P75_OBSERVATION_DURABLE_BEFORE_RESULT");
      expect(retained.value).toMatchObject({
        status: "passed",
        processAlive: true,
        portReady: true,
        servingRevisionMatches: true,
      });
      const sourceRecoveryEpisode = parseWorkerRecord<{
        episodeId: string;
        attempt: number;
      }>(firstWorker.stdout, "P75_RECOVERY_EPISODE");
      expect(sourceRecoveryEpisode.attempt).toBe(sourceClaim.attempt + 1);

      const afterFirstWorker = await db.select({
        attempt: aiAgentEpisodeEventsTable.attempt,
        payload: aiAgentEpisodeEventsTable.payload,
      }).from(aiAgentEpisodeEventsTable)
        .where(eq(aiAgentEpisodeEventsTable.executionId, executionId));
      expect(afterFirstWorker.some((event) => (
        (event.payload as Record<string, unknown>)?.recordKind
          === "P75_HYPOTHESIS_MEASUREMENT_CONTINUATION_RESULT"
      ))).toBe(false);
      const observationsAfterCrash = await db.select()
        .from(aiAgentObservationsTable).where(and(
          eq(aiAgentObservationsTable.executionId, executionId),
          eq(aiAgentObservationsTable.predicate, "runtime.status"),
        ));
      expect(observationsAfterCrash).toHaveLength(1);
      expect(observationsAfterCrash[0]?.id).toBe(retained.id);

      await db.update(aiExecutionsTable)
        .set({ leaseUntil: new Date(Date.now() - 1_000) })
        .where(eq(aiExecutionsTable.id, executionId));
      expect(await reconcileAiExecutions({ expiredOnly: true })).toBeGreaterThanOrEqual(1);

      const secondWorker = await runWorker("recover", fixturePath);
      expect(secondWorker.code, secondWorker.stderr).toBe(0);
      const recovery = parseWorkerRecord<{
        status: string;
        measurementContinuation?: {
          reasonCode?: string;
          measurementValidity?: string;
          resultId?: string;
          resultOwnerEpisodeId?: string;
        };
      }>(secondWorker.stdout, "P75_RECOVERY_RESULT");
      expect(recovery).toMatchObject({
        status: "blocked",
        measurementContinuation: {
          reasonCode: "P75_MEASUREMENT_CONTINUATION_RECORDED",
          measurementValidity: "complete_fresh",
          resultId: expect.any(String),
        },
      });
      const finalObservations = await db.select()
        .from(aiAgentObservationsTable).where(and(
          eq(aiAgentObservationsTable.executionId, executionId),
          eq(aiAgentObservationsTable.predicate, "runtime.status"),
        ));
      expect(finalObservations).toHaveLength(1);
      expect(finalObservations[0]?.id).toBe(retained.id);

      const finalEvents = await db.select({
        episodeId: aiAgentEpisodeEventsTable.episodeId,
        attempt: aiAgentEpisodeEventsTable.attempt,
        eventType: aiAgentEpisodeEventsTable.eventType,
        payload: aiAgentEpisodeEventsTable.payload,
      }).from(aiAgentEpisodeEventsTable)
        .where(eq(aiAgentEpisodeEventsTable.executionId, executionId))
        .orderBy(asc(aiAgentEpisodeEventsTable.attempt), asc(aiAgentEpisodeEventsTable.sequence));
      const continuationResults = finalEvents.filter((event) => (
        (event.payload as Record<string, unknown>)?.recordKind
          === "P75_HYPOTHESIS_MEASUREMENT_CONTINUATION_RESULT"
      ));
      expect(continuationResults).toHaveLength(1);
      expect(continuationResults[0]?.payload).toMatchObject({
        observationId: retained.id,
        measurementValidity: "complete_fresh",
        calibrationEligibility: "not_eligible_without_versioned_policy_review",
      });
      const terminalEvents = finalEvents.filter((event) => event.eventType === "EPISODE_TERMINAL");
      expect(terminalEvents).toHaveLength(3);
      const finalEpisodeId = recovery.measurementContinuation?.resultOwnerEpisodeId;
      expect(finalEpisodeId).toBeTruthy();
      const finalTerminalEvent = terminalEvents.find((event) => event.episodeId === finalEpisodeId);
      expect(finalTerminalEvent?.payload).toMatchObject({
        verdict: "replan_required",
        reasonCode: "P75_MEASUREMENT_CONTINUATION_RECORDED",
      });
      const [finalExecution] = await db.select({
        status: aiExecutionsTable.status,
        workerId: aiExecutionsTable.workerId,
      }).from(aiExecutionsTable).where(eq(aiExecutionsTable.id, executionId));
      expect(finalExecution).toMatchObject({ status: "completed", workerId: null });
      const acceptances = await db.select()
        .from(aiExecutionAcceptancesTable)
        .where(eq(aiExecutionAcceptancesTable.executionId, executionId));
      expect(acceptances.some((acceptance) => acceptance.outcome === "SUCCEEDED")).toBe(false);
      expect(acceptances.some((acceptance) => acceptance.attempt >= 2)).toBe(false);
      const [finalGoal] = await db.select({ status: aiGoalsTable.status })
        .from(aiGoalsTable).where(eq(aiGoalsTable.id, goalId));
      expect(finalGoal?.status).toBe("needs_replan");
      const closedEpisodes = await db.select({
        state: aiAgentEpisodesTable.state,
        verdict: aiAgentEpisodesTable.verdict,
      }).from(aiAgentEpisodesTable).where(inArray(aiAgentEpisodesTable.id, [
        sourceEpisode.episodeId,
        sourceRecoveryEpisode.episodeId,
        finalEpisodeId!,
      ]));
      expect(closedEpisodes).toHaveLength(3);
      expect(closedEpisodes.every((episode) => episode.state === "completed")).toBe(true);
    } finally {
      await terminateRuntimeGroup(runtimePid);
      if (executionId) {
        await db.delete(aiExecutionAcceptancesTable)
          .where(eq(aiExecutionAcceptancesTable.executionId, executionId));
        await db.delete(aiExecutionsTable).where(eq(aiExecutionsTable.id, executionId));
      }
      await db.delete(aiChatSessionsTable).where(eq(aiChatSessionsTable.id, sessionId));
      await db.delete(aiMissionsTable).where(eq(aiMissionsTable.id, missionId));
      await db.delete(projectsTable).where(eq(projectsTable.id, projectId));
      await rm(rootPath, { recursive: true, force: true });
    }
  }, 100_000);
});