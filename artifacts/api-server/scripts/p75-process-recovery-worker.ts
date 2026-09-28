import { readFileSync } from "node:fs";
import { writeSync } from "node:fs";
import {
  aiAgentObservationsTable,
  db,
  pool,
} from "@workspace/db";
import { and, eq } from "drizzle-orm";
import { appendEpisodeEvent } from "../src/lib/agent-state/agent-episode-ledger.js";
import {
  runRuntimeStartHypothesisMeasurementContinuation,
} from "../src/lib/agent-state/runtime-start-hypothesis-measurement-continuation-runner.js";
import {
  workspaceRuntime,
} from "../src/lib/workspace-runtime.js";
import { runRecipeOperation } from "../src/lib/recipe-operation-runner.js";

type WorkerInput = {
  params: {
    projectId: string;
    operationId: string;
    sessionId: string;
    userId: string;
    idempotencyKey: string;
    rootPath: string;
    sourceRevision: string;
    recipeId: "runtime.start";
    recipeVersion: 1;
    approvedPaths: string[];
    missionId: string;
    goalId: string;
    planRevision: string;
  };
  executionId: string;
  recipeBinding: unknown;
  environmentRevision: string;
  sourceEpisodeId: string;
  sourceAttempt: number;
};

function emit(label: string, value: unknown): void {
  writeSync(1, `${label} ${JSON.stringify(value)}\n`);
}

async function observeAndCrash(input: WorkerInput): Promise<never> {
  const { params } = input;
  emit("P75_PHASE", "worker-a-begin");
  const runtimeManager = workspaceRuntime;
  await runRecipeOperation({
    ...params,
    runtimeStartRunner: async () => {
      throw new Error("P75 recovery must not replay runtime.start.");
    },
    runtimeStartMeasurementContinuationRunner: async (context) => {
      emit("P75_PHASE", { phase: "continuation-entered", attempt: context.attempt });
      emit("P75_RECOVERY_EPISODE", {
        episodeId: context.episodeId,
        attempt: context.attempt,
      });
      if (context.attempt !== input.sourceAttempt + 1) {
        throw new Error("P75 process fixture claimed an unexpected continuation attempt.");
      }
      emit("P75_PHASE", "runtime-start-begin");
      const runtime = await runtimeManager.start({
        projectId: params.projectId,
        projectRoot: params.rootPath,
        revision: params.sourceRevision,
        expectedEnvironmentRevision: input.environmentRevision,
        attestationIdentity: {
          projectId: params.projectId,
          executionId: input.executionId,
          executionAttempt: input.sourceAttempt,
          episodeId: input.sourceEpisodeId,
          operationId: params.operationId,
          revision: params.sourceRevision,
        },
      });
      if (runtime.status !== "running" || !runtime.pid || !runtime.port || !runtime.sessionId) {
        throw new Error(`P75 process fixture runtime did not start: ${runtime.error ?? runtime.status}`);
      }
      emit("P75_RUNTIME_STARTED", {
        pid: runtime.pid,
        port: runtime.port,
        sessionId: runtime.sessionId,
      });

      emit("P75_PHASE", "observer-begin");
      return runRuntimeStartHypothesisMeasurementContinuation(context, {
        observeRuntime: async ({ projectId, revision, signal }) => {
          const current = await runtimeManager.get(projectId);
          if (!current.sessionId) throw new Error("Test runtime session disappeared.");
          return runtimeManager.observeExistingRuntimeAfterState({
            projectId,
            sessionId: current.sessionId,
            revision,
            signal,
          });
        },
        appendEvent: async (event) => {
          const payload = event.payload && typeof event.payload === "object" && !Array.isArray(event.payload)
            ? event.payload as Record<string, unknown>
            : undefined;
          if (payload?.recordKind === "P75_HYPOTHESIS_MEASUREMENT_CONTINUATION_RESULT") {
            const observations = await db.select({
              id: aiAgentObservationsTable.id,
              value: aiAgentObservationsTable.value,
            }).from(aiAgentObservationsTable).where(and(
              eq(aiAgentObservationsTable.projectId, params.projectId),
              eq(aiAgentObservationsTable.executionId, input.executionId),
              eq(aiAgentObservationsTable.predicate, "runtime.status"),
            ));
            if (observations.length !== 1) {
              throw new Error("P75 crash point was reached without exactly one retained runtime observation.");
            }
            emit("P75_OBSERVATION_DURABLE_BEFORE_RESULT", observations[0]);
            // Model a hard API-worker loss after the independent observation commit
            // and before the continuation result event can be appended.
            process.exit(73);
          }
          return appendEpisodeEvent(event);
        },
      });
    },
  });

  throw new Error("P75 worker did not reach its deterministic crash point.");
}

async function recover(input: WorkerInput): Promise<void> {
  emit("P75_PHASE", "worker-b-recovery-begin");
  const result = await runRecipeOperation({
    ...input.params,
    runtimeStartRunner: async () => {
      throw new Error("P75 recovery must not replay runtime.start.");
    },
    runtimeStartMeasurementContinuationRunner: async (context) => {
      let observerCalls = 0;
      const disposition = await runRuntimeStartHypothesisMeasurementContinuation(context, {
        observeRuntime: async () => {
          observerCalls += 1;
          throw new Error("Worker B must recover the retained observation without a second runtime read.");
        },
      });
      emit("P75_WORKER_B_OBSERVER_CALLS", observerCalls);
      return disposition;
    },
  });
  emit("P75_RECOVERY_RESULT", {
    status: result.status,
    measurementContinuation: result.measurementContinuation,
  });
  emit("P75_PHASE", "worker-b-recovery-done");
  await pool.end();
}

async function main(): Promise<void> {
  const mode = process.argv[2];
  const inputPath = process.argv[3];
  if ((mode !== "observe-and-crash" && mode !== "recover") || !inputPath) {
    throw new Error("Expected mode and fixture JSON path.");
  }
  emit("P75_PHASE", { phase: "worker-main", mode });
  const input = JSON.parse(readFileSync(inputPath, "utf8")) as WorkerInput;
  if (mode === "observe-and-crash") {
    await observeAndCrash(input);
    return;
  }
  await recover(input);
}

main().catch(async (error: unknown) => {
  writeSync(2, `${error instanceof Error ? error.stack ?? error.message : String(error)}\n`);
  await pool.end().catch(() => undefined);
  process.exitCode = 1;
});