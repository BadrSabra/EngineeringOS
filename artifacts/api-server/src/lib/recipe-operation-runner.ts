import path from "node:path";
import { createHash, randomUUID } from "node:crypto";
import { realpath } from "node:fs/promises";
import {
  advanceCompiledRecipeTransition,
  compileCapabilityRecipe,
  createServerCapabilityRegistry,
  buildCapabilityEnvironment,
  createServerRecipeDefinitionRegistry,
  evaluateRecipeEvidencePredicate,
  executeExecutionNodePlan,
  canonicalJsonHash,
  type ActiveTaskExecutionPlan,
  type ExecutionNode,
  type BrowserValidationRunner,
  type GitHubDeliveryRunner,
  type RuntimeStartRunner,
  type RuntimeRestartRunner,
  type RuntimeStopRunner,
  type RecipeCapabilityRuntime,
  type RecipeEvidence,
  type ValidationRunner,
  type AgentAction,
  type EffectContract,
  type EpisodeVerdict,
  type JsonValue,
} from "@workspace/ai-orchestrator";
import { and, desc, eq, inArray, sql } from "drizzle-orm";
import {
  aiAgentEpisodeEventsTable,
  aiAgentObservationsTable,
  aiGoalsTable,
  db,
  eventsTable,
  projectsTable,
} from "@workspace/db";
import type { AiExternalEffectCheckpoint } from "./ai-execution-state.js";
import {
  assertRecipeNodeBinding,
  authorizeRecipeNodeExecution,
  checkpointAiExecution,
  claimAiExecution,
  completeAiExecution,
  createAiExecution,
  createRecipeOperationBinding,
  failAiExecution,
  getAiExecutionForUser,
  heartbeatAiExecution,
  ownsAiExecutionLease,
  parseAiExecutionCheckpoint,
  persistCancelledRecipeReceipt,
  recoverAiExecutionResumeToken,
  reconcileExecutionNodeCheckpoint,
  registerAiExecutionController,
  unregisterAiExecutionController,
  type RecipeOperationBinding,
  type RecipeSkillRegistryBinding,
} from "./ai-execution-state.js";
import { RecipeReceiptSchema, type RecipeReceipt } from "@workspace/ai-orchestrator";
import { runRepairValidation } from "./ai-repair-validation.js";
import { HOST_DISPOSABLE_TEMP_ROOT } from "./disposable-temp.js";
import { logger } from "./logger.js";
import {
  parseTaskObjectiveContract,
  type TaskObjectiveValidatorReceipt,
} from "./task-objective-contract.js";
import {
  requireActiveSkillRegistry,
  type ActiveSkillRegistryBinding,
} from "./skill-registry.js";
import type { ExecutionDelegationBudget } from "./execution-lineage.js";
import {
  appendEpisodeEvent,
  closeEpisode,
  terminalizeP75MeasurementContinuationEpisode,
  startEpisode,
  startEpisodeShadow,
} from "./agent-state/agent-episode-ledger.js";
import {
  buildRecipeReadOnlyInvocationContract,
  hashJsonValue,
  isReadOnlyRecipeCapability,
  recipeInvocationNodeId,
} from "./recipe-invocation-contract.js";
import {
  captureEnvironmentAttestation,
  serverEnvironmentProfile,
} from "./agent-state/environment-attestation.js";
import { materializeServerOwnedObservations } from "./agent-state/observation-materializer.js";
import { hashDeliveryTree } from "./delivery-workspace.js";
import { verifyAndPersistEffect } from "./agent-state/effect-observer.js";
import { getProjectWorldState } from "./agent-state/world-state.js";
import {
  createPendingRuntimeStartTransition,
  finalizeRuntimeStartTransition,
} from "./agent-state/runtime-start-transition.js";
import {
  RUNTIME_START_OBJECTIVE_CONTRACT_ID,
  RUNTIME_START_HYPOTHESIS_SET_ID,
  RUNTIME_START_CALIBRATION_PARTITION,
  RUNTIME_START_CALIBRATION_POLICY_VERSION,
  buildRuntimeStartHypothesisExperimentRegistration,
  buildRuntimeStartHypothesisExperimentResult,
  parseRuntimeStartHypothesisExperimentRegistration,
  parseRuntimeStartHypothesisExperimentResult,
  runtimeStartHypothesisCalibrationScopeRef,
  type RuntimeStartHypothesisExperimentRegistration,
} from "./agent-state/runtime-start-hypothesis-experiment.js";
import {
  RUNTIME_START_HYPOTHESIS_COLLECTION_AUTHORIZED,
} from "./agent-state/runtime-start-hypothesis-collection-policy.js";
import {
  evaluateRuntimeStartHypothesisCalibration,
  RuntimeStartHypothesisCalibrationAssessmentSchema,
  type RuntimeStartCalibrationExperiment,
} from "./agent-state/runtime-start-hypothesis-calibration.js";
import {
  runRuntimeStartHypothesisMeasurementContinuation,
  type RuntimeStartMeasurementContinuationContext,
  type RuntimeStartMeasurementContinuationDisposition,
} from "./agent-state/runtime-start-hypothesis-measurement-continuation-runner.js";
import {
  buildCandidateValidationAction,
  buildCandidateValidationEffectContract,
} from "./agent-state/candidate-validation-effect.js";
import {
  buildGateCAction,
  buildGateCEffectContract,
  buildBrowserGateCAfterObservation,
  buildDeliveryGateCAfterObservation,
  buildRuntimeGateCAfterObservation,
  gateCEffectIdentity,
  gateCEffectKind,
} from "./agent-state/gate-c-effect.js";
import { workspaceRuntime, WorkspaceRuntimeError } from "./workspace-runtime.js";

type RuntimeStateEvidence = Awaited<ReturnType<typeof workspaceRuntime.observeAfterState>>;
type RuntimeStartBeforeStateEvidence = Awaited<
  ReturnType<typeof workspaceRuntime.observeStartBeforeState>
>;

function runtimeStateEvidence(state: RuntimeStateEvidence) {
  return {
    status: state.status,
    projectId: state.projectId,
    sessionId: state.sessionId,
    revision: state.revision,
    pid: state.pid,
    port: state.port,
    processAlive: state.processAlive,
    portReady: state.portReady,
    healthPath: state.healthPath,
    healthStatus: state.healthStatus,
    servingRevision: state.servingRevision,
    markerMatched: state.markerMatched,
    childProcessAttestation: state.childProcessAttestation,
    listener: state.listener,
    observedAt: state.observedAt,
  };
}

function runtimeStartBeforeStateEvidence(
  state: RuntimeStartBeforeStateEvidence,
  environmentRevision: string | null = null,
) {
  return {
    status: state.status,
    runtimeStatus: state.runtimeStatus,
    projectId: state.projectId,
    revision: state.revision,
    sessionId: state.sessionId,
    pid: state.pid,
    port: state.port,
    processAlive: state.processAlive,
    portReady: state.portReady,
    source: state.source,
    inventoryComplete: state.inventoryComplete,
    unknownListenerPorts: state.unknownListenerPorts,
    observedAt: state.observedAt,
    detail: state.detail,
    environmentRevision,
  };
}

function runtimeStartHypothesisProbeEvidence(
  state: RuntimeStartBeforeStateEvidence,
  environmentRevision: string | null,
) {
  return {
    status: state.status,
    runtimeStatus: state.runtimeStatus,
    projectId: state.projectId,
    revision: state.revision,
    sessionId: state.sessionId,
    pid: state.pid,
    port: state.port,
    processAlive: state.processAlive,
    portReady: state.portReady,
    source: state.source,
    inventoryComplete: state.inventoryComplete,
    unknownListenerPorts: state.unknownListenerPorts,
    observedAt: state.observedAt,
    environmentRevision,
  };
}

function runtimeStartBeforeObservationValue(
  value: unknown,
  projectId: string,
  revision: string,
): JsonValue | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  const state = value as Record<string, unknown>;
  if (
    state.status !== "observed"
    || state.projectId !== projectId
    || state.revision !== revision
    || (state.runtimeStatus !== "stopped" && state.runtimeStatus !== "running")
    || state.inventoryComplete !== true
    || !Array.isArray(state.unknownListenerPorts)
    || state.unknownListenerPorts.length !== 0
    || typeof state.observedAt !== "string"
    || !Number.isFinite(Date.parse(state.observedAt))
    || !["supervisor_inventory", "managed_session", "test_observer"].includes(String(state.source))
  ) {
    return undefined;
  }
  return {
    status: "observed",
    runtimeStatus: state.runtimeStatus,
    projectId,
    revision,
    sessionId: typeof state.sessionId === "string" ? state.sessionId : null,
    pid: Number.isInteger(state.pid) ? state.pid as number : null,
    port: Number.isInteger(state.port) ? state.port as number : null,
    processAlive: typeof state.processAlive === "boolean" ? state.processAlive : null,
    portReady: typeof state.portReady === "boolean" ? state.portReady : null,
    source: state.source as string,
    inventoryComplete: true,
    unknownListenerPorts: [],
    observedAt: state.observedAt,
    environmentRevision: typeof state.environmentRevision === "string"
      ? state.environmentRevision
      : null,
  };
}

function runtimeStartHypothesisProbeValue(
  value: unknown,
  projectId: string,
  revision: string,
  expectedEnvironmentRevision: string,
  observedEnvironmentRevision: string | null,
): { outcomeKey: "runtime_running" | "runtime_not_running"; observedAt: string } | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  const state = value as Record<string, unknown>;
  if (
    state.status !== "observed"
    || state.projectId !== projectId
    || state.revision !== revision
    || state.environmentRevision !== expectedEnvironmentRevision
    || observedEnvironmentRevision !== expectedEnvironmentRevision
    || typeof state.observedAt !== "string"
    || !Number.isFinite(Date.parse(state.observedAt))
    || state.inventoryComplete !== true
    || !Array.isArray(state.unknownListenerPorts)
    || state.unknownListenerPorts.length !== 0
  ) {
    return undefined;
  }
  if (
    state.runtimeStatus === "running"
    && typeof state.sessionId === "string"
    && state.sessionId.trim().length > 0
    && Number.isInteger(state.pid)
    && (state.pid as number) > 0
    && Number.isInteger(state.port)
    && (state.port as number) > 0
    && state.processAlive === true
    && state.portReady === true
    && ["managed_session", "test_observer"].includes(String(state.source))
  ) {
    return { outcomeKey: "runtime_running", observedAt: state.observedAt };
  }
  if (
    state.runtimeStatus === "stopped"
    && state.sessionId === null
    && state.pid === null
    && state.port === null
    && state.processAlive === false
    && state.portReady === false
    && ["supervisor_inventory", "test_observer"].includes(String(state.source))
  ) {
    return { outcomeKey: "runtime_not_running", observedAt: state.observedAt };
  }
  return undefined;
}

function runtimeChildProcessObservationSource(input: {
  projectId: string;
  executionId: string;
  attempt: number;
  episodeId: string;
  operationId: string;
  sessionId: unknown;
  revision: string;
  environmentRevision: string | null;
  afterState: unknown;
}) {
  if (
    typeof input.sessionId !== "string"
    || !input.afterState
    || typeof input.afterState !== "object"
    || Array.isArray(input.afterState)
  ) {
    return undefined;
  }
  const afterState = input.afterState as Record<string, unknown>;
  const attestation = afterState.childProcessAttestation
    && typeof afterState.childProcessAttestation === "object"
    && !Array.isArray(afterState.childProcessAttestation)
    ? afterState.childProcessAttestation as Record<string, unknown>
    : undefined;
  if (
    !attestation
    || typeof attestation.bindingDigest !== "string"
    || !["known", "mismatch", "unknown"].includes(String(attestation.status))
    || typeof attestation.reasonCode !== "string"
    || typeof attestation.observedAt !== "string"
  ) {
    return undefined;
  }
  return {
    kind: "child_process_attestation" as const,
    projectId: input.projectId,
    executionId: input.executionId,
    attempt: input.attempt,
    episodeId: input.episodeId,
    operationId: input.operationId,
    sessionId: input.sessionId,
    revision: input.revision,
    status: attestation.status as "known" | "mismatch" | "unknown",
    reasonCode: attestation.reasonCode as import("./agent-state/child-process-attestation.js").ChildProcessEnvironmentAttestation["reasonCode"],
    bindingDigest: attestation.bindingDigest,
    attestationDigest: typeof attestation.attestationDigest === "string"
      ? attestation.attestationDigest
      : null,
    processEnvironmentDigest: typeof attestation.processEnvironmentDigest === "string"
      ? attestation.processEnvironmentDigest
      : null,
    environmentRevision: input.environmentRevision,
    observedAt: attestation.observedAt,
  };
}

async function loadRuntimeStartCalibrationExperiments(
  projectId: string,
  calibrationScopeRef: string,
): Promise<RuntimeStartCalibrationExperiment[]> {
  const eventRows = await db.select({
    eventType: aiAgentEpisodeEventsTable.eventType,
    payload: aiAgentEpisodeEventsTable.payload,
  }).from(aiAgentEpisodeEventsTable)
    .where(and(
      eq(aiAgentEpisodeEventsTable.projectId, projectId),
      inArray(aiAgentEpisodeEventsTable.eventType, [
        "OBSERVATION_REQUESTED",
        "OBSERVATION_RECORDED",
      ]),
      sql`${aiAgentEpisodeEventsTable.payload} ->> 'calibrationScopeRef' = ${calibrationScopeRef}`,
    ));

  const registrations: RuntimeStartCalibrationExperiment[] = [];
  const resultsByExperimentId = new Map<
    string,
    Array<ReturnType<typeof parseRuntimeStartHypothesisExperimentResult>>
  >();
  const malformedResultIds = new Set<string>();
  const resultPlaceholders = new Map<string, { missionId: string; calibrationScopeRef: string }>();

  for (const event of eventRows) {
    const payload = event.payload;
    if (!payload || typeof payload !== "object" || Array.isArray(payload)) continue;
    const record = payload as Record<string, unknown>;
    if (record.calibrationScopeRef !== calibrationScopeRef) continue;

    if (record.recordKind === "P75_HYPOTHESIS_EXPERIMENT_REGISTERED") {
      if (typeof record.experimentId !== "string" || typeof record.missionId !== "string") {
        throw new Error("A scoped runtime-start registration is missing its durable identity.");
      }
      if (event.eventType !== "OBSERVATION_REQUESTED") {
        registrations.push({
          experimentId: record.experimentId,
          missionId: record.missionId,
          calibrationScopeRef,
        });
        continue;
      }
      try {
        const registration = parseRuntimeStartHypothesisExperimentRegistration(record);
        const registrationMatchesScope = registration.projectId === projectId
          && registration.calibrationScopeRef === calibrationScopeRef
          && registration.evaluationPartition === RUNTIME_START_CALIBRATION_PARTITION;
        registrations.push({
          experimentId: registration.experimentId,
          missionId: registration.missionId,
          calibrationScopeRef,
          ...(registrationMatchesScope ? { registration } : {}),
        });
      } catch {
        registrations.push({
          experimentId: record.experimentId,
          missionId: record.missionId,
          calibrationScopeRef,
        });
      }
      continue;
    }

    if (record.recordKind !== "P75_HYPOTHESIS_EXPERIMENT_RESULT") continue;
    if (typeof record.experimentId !== "string" || typeof record.missionId !== "string") {
      throw new Error("A scoped runtime-start result is missing its durable identity.");
    }
    if (event.eventType !== "OBSERVATION_RECORDED") {
      malformedResultIds.add(record.experimentId);
      resultPlaceholders.set(record.experimentId, {
        missionId: record.missionId,
        calibrationScopeRef,
      });
      continue;
    }
    resultPlaceholders.set(record.experimentId, {
      missionId: record.missionId,
      calibrationScopeRef,
    });
    try {
      const result = parseRuntimeStartHypothesisExperimentResult(record);
      const values = resultsByExperimentId.get(result.experimentId) ?? [];
      values.push(result);
      resultsByExperimentId.set(result.experimentId, values);
    } catch {
      malformedResultIds.add(record.experimentId);
    }
  }

  const registeredIds = new Set(registrations.map(({ experimentId }) => experimentId));
  const experiments = registrations.map((registration) => {
    const candidates = resultsByExperimentId.get(registration.experimentId) ?? [];
    const uniqueCandidates = new Map(candidates.map((result) => [result.resultId, result]));
    const result = !malformedResultIds.has(registration.experimentId)
      && uniqueCandidates.size === 1
      && [...uniqueCandidates.values()][0]?.missionId === registration.missionId
      ? [...uniqueCandidates.values()][0]
      : undefined;
    return { ...registration, ...(result ? { result } : {}) };
  });

  for (const [experimentId, placeholder] of resultPlaceholders) {
    if (!registeredIds.has(experimentId)) {
      experiments.push({ experimentId, ...placeholder });
    }
  }
  return experiments;
}

function runtimeStartAfterObservationValue(
  value: unknown,
  projectId: string,
  revision: string,
  environmentRevision: string | null,
): JsonValue | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  const state = value as Record<string, unknown>;
  if (
    state.status !== "passed"
    || state.projectId !== projectId
    || state.revision !== revision
    || typeof state.sessionId !== "string"
    || !state.sessionId.trim()
    || state.environmentRevision !== environmentRevision
    || typeof environmentRevision !== "string"
    || !/^env-v1:[a-f0-9]{64}$/.test(environmentRevision)
    || state.processAlive !== true
    || state.portReady !== true
    || !Number.isInteger(state.pid)
    || !Number.isInteger(state.port)
    || typeof state.observedAt !== "string"
    || !Number.isFinite(Date.parse(state.observedAt))
  ) {
    return undefined;
  }
  return {
    status: "passed",
    runtimeStatus: "running",
    projectId,
    revision,
    sessionId: state.sessionId,
    environmentRevision,
    processAlive: true,
    portReady: true,
    pid: state.pid as number,
    port: state.port as number,
    observedAt: state.observedAt,
  };
}
import { extractAcceptedEpisodeStrategy } from "./agent-state/strategy-candidate-extractor.js";
import { registerProspectiveStrategyReplayCase } from "./agent-state/strategy-replay-case-registry.js";

function strategyActionContract(action: AgentAction): {
  contractVersion: 1;
  triggerConditions: JsonValue[];
  preconditions: string[];
  expectedEffects: string[];
  observationProfile: string;
  failureSemantics: string[];
} {
  return {
    contractVersion: 1,
    triggerConditions: (action.triggerConditions ?? []) as JsonValue[],
    preconditions: action.preconditions,
    expectedEffects: action.expectedEffects,
    observationProfile: action.observationProfile,
    failureSemantics: action.failureSemantics,
  };
}

async function appendRecipeInvocationEvent(
  input: Parameters<typeof appendEpisodeEvent>[0],
): Promise<boolean> {
  try {
    await appendEpisodeEvent(input);
    return true;
  } catch (error) {
    logger.warn(
      {
        scope: "recipe-operation",
        code: "recipe_invocation_event_write_failed",
        executionId: input.executionId,
        episodeId: input.episodeId,
        eventType: input.eventType,
        error,
      },
      "Recipe invocation provenance could not be recorded",
    );
    return false;
  }
}

export type PrepareRecipeOperationParams = {
  projectId: string;
  operationId: string;
  rootPath: string;
  sourceRevision: string;
  recipeId: string;
  recipeVersion: number;
  approvedPaths?: readonly string[];
  candidateIdentity?: string | null;
  candidateWorkspace?: string | null;
  validationProfiles?: readonly ("workspace-typecheck" | "ai-orchestrator-tests")[];
  deliveryMessage?: string;
  browserValidationRunner?: BrowserValidationRunner;
  githubDeliveryRunner?: GitHubDeliveryRunner;
  runtimeStartRunner?: RuntimeStartRunner;
  runtimeRestartRunner?: RuntimeRestartRunner;
  runtimeStopRunner?: RuntimeStopRunner;
  databaseReadRunner?: NonNullable<RecipeCapabilityRuntime["databaseReadRunner"]>;
  validationRunner?: ValidationRunner;
  skillBinding?: ActiveSkillRegistryBinding;
};

export type PreparedRecipeOperation = {
  plan: ActiveTaskExecutionPlan;
  binding: RecipeOperationBinding;
};

export function createRuntimeStartRunner(
  manager = workspaceRuntime,
): RuntimeStartRunner {
  return async ({
    projectId,
    operationId,
    rootPath,
    revision,
    executionId,
    executionAttempt,
    episodeId,
    signal,
    beforeEffectGate,
  }) => {
    if (signal?.aborted) {
      return { status: "blocked", detail: "Runtime action was cancelled before startup." };
    }
    let environmentRevision: string | null = null;
    let hypothesisExperimentId: string | undefined;
    const collectHypothesisProbe = async () => {
      if (!hypothesisExperimentId || signal?.aborted) return undefined;
      try {
        const probe = await manager.observeStartBeforeState({
          projectId,
          revision,
          signal,
        });
        let observedEnvironmentRevision: string | null = null;
        try {
          const attestation = await captureEnvironmentAttestation({
            rootPath,
            profile: serverEnvironmentProfile("RUNTIME_START", {
              kind: "recipe",
              recipeId: "runtime.start",
            }),
          });
          observedEnvironmentRevision = attestation.status === "known"
            ? attestation.environmentRevision
            : null;
        } catch {
          observedEnvironmentRevision = null;
        }
        return {
          experimentId: hypothesisExperimentId,
          environmentRevisionBefore: environmentRevision,
          environmentRevisionAfter: observedEnvironmentRevision,
          state: runtimeStartHypothesisProbeEvidence(probe, observedEnvironmentRevision),
        };
      } catch {
        return {
          experimentId: hypothesisExperimentId,
          environmentRevisionBefore: environmentRevision,
          environmentRevisionAfter: null,
          state: null,
        };
      }
    };
    try {
      const attestationIdentity = executionId
        && Number.isInteger(executionAttempt)
        && episodeId
        ? {
            projectId,
            operationId,
            executionId,
            executionAttempt: executionAttempt!,
            episodeId,
            revision,
          }
        : undefined;
      const before = await manager.observeStartBeforeState({
        projectId,
        revision,
        signal,
      });
      if (beforeEffectGate) {
        const attestation = await captureEnvironmentAttestation({
          rootPath,
          profile: serverEnvironmentProfile("RUNTIME_START", {
            kind: "recipe",
            recipeId: "runtime.start",
          }),
        });
        environmentRevision = attestation.status === "known"
          ? attestation.environmentRevision
          : null;
      }
      const beforeState = runtimeStartBeforeStateEvidence(before, environmentRevision);
      const d1Decision = beforeEffectGate
        ? await beforeEffectGate({ beforeState, environmentRevision })
        : undefined;
      hypothesisExperimentId = d1Decision?.hypothesisExperimentId;
      if (beforeEffectGate && !d1Decision?.allowEffect) {
        return {
          status: "blocked",
          detail: d1Decision?.decisionCode ?? "runtime_start_d1_denied",
        };
      }
      const alreadyRunning = d1Decision?.decisionCode === "runtime_start_d1_already_running";
      const snapshot = await manager.start({
        projectId,
        projectRoot: rootPath,
        revision,
        ...(d1Decision?.allowEffect && environmentRevision
          ? { expectedEnvironmentRevision: environmentRevision }
          : {}),
        ...(attestationIdentity && !alreadyRunning ? { attestationIdentity } : {}),
      });
      if (snapshot.status !== "running" || !snapshot.sessionId) {
        const hypothesisProbe = await collectHypothesisProbe();
        return {
          status: "unavailable",
          detail: snapshot.error ?? "The workspace runtime did not reach running state.",
          ...(hypothesisProbe ? { evidence: { hypothesisProbe } } : {}),
        };
      }
      const after = alreadyRunning
        ? await manager.observeExistingRuntimeAfterState({
            projectId,
            sessionId: snapshot.sessionId,
            revision,
            signal,
          })
        : await manager.observeAfterState({
            projectId,
            sessionId: snapshot.sessionId,
            revision,
            ...(attestationIdentity ? {
              attestationBinding: {
                ...attestationIdentity,
                sessionId: snapshot.sessionId,
              },
            } : {}),
            signal,
          });
      const hypothesisProbe = after.status === "passed"
        ? undefined
        : await collectHypothesisProbe();
      const evidenceId = `runtime:${projectId}:${operationId}:${snapshot.sessionId}:after`;
      const resultHash = createHash("sha256")
        .update(JSON.stringify(after))
        .digest("hex");
      return {
        status: after.status === "passed" ? "passed" as const : after.status === "failed" ? "blocked" as const : "unavailable" as const,
        evidence: {
          evidenceId,
          resultHash,
          artifactRef: `runtime:${snapshot.sessionId}`,
          sessionId: snapshot.sessionId,
          environmentRevision: snapshot.environmentRevision,
          beforeState,
          afterState: {
            ...runtimeStateEvidence(after),
            environmentRevision: snapshot.environmentRevision,
          },
          ...(hypothesisProbe ? { hypothesisProbe } : {}),
          ...(d1Decision ? { d1Decision } : {}),
        },
        detail: after.detail,
      };
    } catch (error) {
      const detail = error instanceof Error ? error.message.slice(0, 4_000) : "Runtime action failed.";
      const hypothesisProbe = await collectHypothesisProbe();
      return {
        status: error instanceof WorkspaceRuntimeError && error.code === "RUNTIME_OBSERVATION_STALE"
          ? "blocked" as const
          : "unavailable" as const,
        detail,
        ...(hypothesisProbe ? { evidence: { hypothesisProbe } } : {}),
      };
    }
  };
}

function createRuntimeModeRunner(
  mode: "restart" | "stop",
  manager = workspaceRuntime,
): RuntimeRestartRunner | RuntimeStopRunner {
  return async ({
    projectId,
    operationId,
    rootPath,
    revision,
    executionId,
    executionAttempt,
    episodeId,
    signal,
  }) => {
    if (signal?.aborted) return { status: "blocked", detail: `Runtime ${mode} was cancelled.` };
    try {
      const before = await manager.get(projectId);
      if (mode === "stop" && (
        !before.sessionId
        || before.status !== "running"
        || before.revision !== revision
        || before.pid === null
        || before.port === null
      )) {
        return { status: "unavailable", detail: "Runtime stop requires a running session matching the requested revision with PID and port identity." };
      }
      const preStopPid = before.pid;
      const preStopPort = before.port;
      const stopBeforeState = mode === "stop"
        ? await manager.observeRunningBeforeStop({
            projectId,
            sessionId: before.sessionId!,
            revision,
            pid: preStopPid!,
            port: preStopPort!,
          })
        : undefined;
      if (stopBeforeState && stopBeforeState.status !== "passed") {
        return {
          status: "unavailable",
          detail: stopBeforeState.detail ?? "Runtime process and port were not available before stop.",
        };
      }
      const snapshot = mode === "restart"
        ? await manager.start({
            projectId,
            projectRoot: rootPath,
            revision,
            restart: true,
            ...(executionId && Number.isInteger(executionAttempt) && episodeId
              ? {
                  attestationIdentity: {
                    projectId,
                    operationId,
                    executionId,
                    executionAttempt: executionAttempt!,
                    episodeId,
                    revision,
                  },
                }
              : {}),
          })
        : await manager.stop(projectId);
      if (mode === "restart") {
        if (snapshot.status !== "running" || !snapshot.sessionId) {
          return { status: "unavailable", detail: snapshot.error ?? "Runtime restart did not reach running state." };
        }
        const after = await manager.observeAfterState({
          projectId,
          sessionId: snapshot.sessionId,
          revision,
          ...(executionId && Number.isInteger(executionAttempt) && episodeId
            ? {
                attestationBinding: {
                  projectId,
                  sessionId: snapshot.sessionId,
                  operationId,
                  executionId,
                  executionAttempt: executionAttempt!,
                  episodeId,
                  revision,
                },
              }
            : {}),
          signal,
        });
        return {
          status: after.status === "passed" ? "passed" : after.status === "failed" ? "blocked" : "unavailable",
          evidence: {
            evidenceId: `runtime:${projectId}:${operationId}:${snapshot.sessionId}:after`,
            resultHash: createHash("sha256").update(JSON.stringify(after)).digest("hex"),
            artifactRef: `runtime:${snapshot.sessionId}`,
            sessionId: snapshot.sessionId,
            environmentRevision: snapshot.environmentRevision,
            afterState: runtimeStateEvidence(after),
          },
          detail: after.detail,
        };
      }
      if (!snapshot.sessionId) return { status: "unavailable", detail: "Runtime stop did not retain session identity." };
      const after = await manager.observeStoppedAfterState({
        projectId, sessionId: before.sessionId!, revision, pid: preStopPid!, port: preStopPort!,
      });
      return {
        status: after.status === "passed" ? "passed" : "unavailable",
        evidence: {
          evidenceId: `runtime:${projectId}:${operationId}:${before.sessionId}:after`,
          resultHash: createHash("sha256")
            .update(JSON.stringify({ before: stopBeforeState, after }))
            .digest("hex"),
          artifactRef: `runtime:${before.sessionId}`,
          sessionId: before.sessionId,
          environmentRevision: before.environmentRevision,
          beforeState: stopBeforeState ? runtimeStateEvidence(stopBeforeState) : undefined,
          afterState: { ...runtimeStateEvidence(after), pid: preStopPid, port: preStopPort },
        },
        detail: after.detail,
      };
    } catch (error) {
      return {
        status: error instanceof WorkspaceRuntimeError && error.code === "RUNTIME_OBSERVATION_STALE"
          ? "blocked" : "unavailable",
        detail: error instanceof Error ? error.message.slice(0, 4_000) : `Runtime ${mode} failed.`,
      };
    }
  };
}

export function createRuntimeRestartRunner(manager = workspaceRuntime): RuntimeRestartRunner {
  return createRuntimeModeRunner("restart", manager);
}

export function createRuntimeStopRunner(manager = workspaceRuntime): RuntimeStopRunner {
  return createRuntimeModeRunner("stop", manager);
}

function normalizedPaths(paths: readonly string[] | undefined): string[] {
  return [...new Set((paths ?? []).map((value) => value.trim().replaceAll("\\", "/")).filter(Boolean))];
}

function assertCandidateWorkspace(candidateWorkspace: string | null | undefined): void {
  if (candidateWorkspace === null || candidateWorkspace === undefined) return;
  const candidate = path.resolve(candidateWorkspace);
  const disposableRoot = path.resolve(HOST_DISPOSABLE_TEMP_ROOT);
  const relative = path.relative(disposableRoot, candidate);
  if (!path.isAbsolute(candidateWorkspace) || !relative || relative === ".." || relative.startsWith(`..${path.sep}`)) {
    throw new Error("Recipe candidate workspace must be an absolute path inside the host disposable temp root.");
  }
}

async function canonicalCandidateWorkspace(candidateWorkspace: string | null | undefined): Promise<string | undefined> {
  if (!candidateWorkspace) return undefined;
  const [candidate, disposableRoot] = await Promise.all([
    realpath(path.resolve(candidateWorkspace)),
    realpath(path.resolve(HOST_DISPOSABLE_TEMP_ROOT)),
  ]);
  const relative = path.relative(disposableRoot, candidate);
  if (!relative || relative === ".." || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) {
    throw new Error("Recipe candidate workspace resolves outside the host disposable temp root.");
  }
  return candidate;
}

export function prepareRecipeOperation(params: PrepareRecipeOperationParams): PreparedRecipeOperation {
  assertCandidateWorkspace(params.candidateWorkspace);
  const approvedPaths = normalizedPaths(params.approvedPaths);
  const definitions = createServerRecipeDefinitionRegistry();
  const definition = definitions.resolve(params.recipeId, params.recipeVersion);
  if (!definition) throw new Error(`Unknown server recipe "${params.recipeId}" version ${params.recipeVersion}.`);
  const recipe = definition.buildRecipe({
    recipeId: params.recipeId,
    recipeVersion: params.recipeVersion,
    approvedPaths,
    candidateIdentity: params.candidateIdentity ?? null,
    ...(params.validationProfiles ? { validationProfiles: [...params.validationProfiles] } : {}),
    ...(params.deliveryMessage ? { deliveryMessage: params.deliveryMessage } : {}),
  });
  const registry = createServerCapabilityRegistry(
    {
      ...(params.browserValidationRunner ? { browserProfiles: ["default"] } : {}),
      ...(params.githubDeliveryRunner ? { githubDeliveryRunner: params.githubDeliveryRunner } : {}),
      ...(params.runtimeStartRunner ? { runtimeStartRunner: params.runtimeStartRunner } : {}),
      ...(params.runtimeRestartRunner ? { runtimeRestartRunner: params.runtimeRestartRunner } : {}),
      ...(params.runtimeStopRunner ? { runtimeStopRunner: params.runtimeStopRunner } : {}),
      databaseReadRunner: params.databaseReadRunner ?? DEFAULT_DATABASE_READ_RUNNER,
    },
  );
  const capabilityEnvironment = buildCapabilityEnvironment(registry);
  const compiled = compileCapabilityRecipe(recipe, {
    registry,
    context: {
      projectId: params.projectId,
      rootPath: params.rootPath,
      revision: params.sourceRevision,
      operation: "recipe",
      operationId: params.operationId,
      // Validation and browser profiles operate on a bounded set, even when
      // that set contains one file. "file" is reserved for file-native tools.
      scope: params.recipeId === "runtime.start"
        || params.recipeId === "runtime.restart"
        || params.recipeId === "runtime.stop"
        || params.recipeId === "database.inspect.project"
        ? { kind: "project", paths: [] }
        : approvedPaths.length > 0
          ? { kind: "paths", paths: approvedPaths }
          : { kind: "none", paths: [] },
      allowedFiles: approvedPaths,
      authorized: true,
      approvalState: "APPROVED",
      maxRisk: definition.maxRisk,
      validationProfile: "workspace-typecheck",
    },
    policy: definition.executionPolicy,
  });
  if (!compiled.ok) {
    throw new Error(compiled.diagnostics.map((diagnostic) => diagnostic.code).join(", "));
  }
  if (compiled.plan.nodes.length > definition.executionPolicy.maxNodes) {
    throw new Error("Recipe exceeds its server-owned mission node budget.");
  }
  const binding = createRecipeOperationBinding({
    projectId: params.projectId,
    operationId: params.operationId,
    sourceRevision: params.sourceRevision,
    approvedPaths,
    candidateIdentity: params.candidateIdentity,
    candidateWorkspace: params.candidateWorkspace,
    missionBudget: {
      maxNodes: definition.executionPolicy.maxNodes,
      maxParallelNodes: definition.maxParallelNodes,
      maxTotalTimeoutMs: definition.executionPolicy.maxTotalTimeoutMs,
      maxProcessCount: definition.maxParallelNodes,
      maxOutputBytes: 200_000,
    },
    concurrencyBudget: {
      maxInFlightNodes: definition.maxParallelNodes,
      maxProcesses: definition.maxParallelNodes,
    },
    capabilityEnvironment,
    ...(params.skillBinding
      ? {
          skillRegistryBinding: {
            registryId: params.skillBinding.registryId,
            skillId: params.skillBinding.skillId,
            skillVersion: params.skillBinding.skillVersion,
            candidateId: params.skillBinding.candidateId,
            sourceRevision: params.skillBinding.sourceRevision,
            candidateTreeHash: params.skillBinding.candidateTreeHash,
            proofReceiptId: params.skillBinding.proofReceiptId,
            shadowReplayId: params.skillBinding.shadowReplayId,
          } satisfies RecipeSkillRegistryBinding,
        }
      : {}),
  });
  if (compiled.plan.nodes.length > binding.missionBudget.maxNodes
    || definition.maxParallelNodes !== binding.concurrencyBudget.maxInFlightNodes) {
    throw new Error("Recipe plan does not fit its durable mission budget.");
  }
  for (const node of compiled.plan.nodes) assertRecipeNodeBinding(binding, node);
  return { plan: compiled.plan, binding };
}

export type RunRecipeOperationParams = PrepareRecipeOperationParams & {
  userId: string;
  missionId?: string;
  goalId?: string;
  sessionId?: string;
  idempotencyKey: string;
  executionProfile?: string;
  planRevision?: string;
  /** Test seam for the bounded, read-only P7.5 resume continuation. */
  runtimeStartMeasurementContinuationRunner?: (
    context: RuntimeStartMeasurementContinuationContext,
  ) => Promise<RuntimeStartMeasurementContinuationDisposition | undefined>;
  proofRequired?: boolean;
  parentExecutionId?: string | null;
  delegationBudget?: Partial<ExecutionDelegationBudget>;
  strategyReplayContext?: {
    caseRegistrationId: string;
    caseId: string;
    candidateId: string;
    candidateHash: string;
    sourceEpisodeId: string;
    sourceCanonicalProofHash: string;
    expectedActionContractHash: string;
  };
};

function evidenceForNodes(
  nodes: readonly ActiveTaskExecutionPlan["nodes"][number][],
  outputs: ReadonlyMap<string, Record<string, unknown>>,
): RecipeEvidence {
  return Object.fromEntries(nodes.map((node) => {
    const evidenceType = node.capabilityId?.startsWith("browser.verify.")
      ? "browser_verified" as const
      : node.capabilityId === "runtime.start"
        || node.capabilityId === "runtime.restart"
        || node.capabilityId === "runtime.stop"
        ? "runtime_verified" as const
      : node.capabilityId?.startsWith("github.push")
        ? "integration_verified" as const
        : node.capabilityId?.startsWith("database.read")
          ? "database_read" as const
      : "validation_passed" as const;
    const evidenceId = outputs.get(node.id)?.evidence
      && typeof outputs.get(node.id)?.evidence === "object"
      && typeof (outputs.get(node.id)?.evidence as { evidenceId?: unknown }).evidenceId === "string"
      ? (outputs.get(node.id)?.evidence as { evidenceId: string }).evidenceId
      : undefined;
    return [node.id, {
      status: node.status,
      outputs: outputs.get(node.id),
      evidence: node.status === "passed" && evidenceId ? [{ type: evidenceType, evidenceId }] : [],
    }];
  }));
}

const DEFAULT_DATABASE_READ_RUNNER: NonNullable<RecipeCapabilityRuntime["databaseReadRunner"]> = async ({
  projectId,
  operationId,
  resource,
  limit,
  signal,
}) => {
  if (signal?.aborted) return { status: "blocked" as const, detail: "Database read was cancelled." };
  try {
    let rows: Array<Record<string, unknown>>;
    if (resource === "project_summary") {
      const projects = await db
        .select({
          id: projectsTable.id,
          name: projectsTable.name,
          language: projectsTable.language,
          status: projectsTable.status,
          updatedAt: projectsTable.updatedAt,
        })
        .from(projectsTable)
        .where(eq(projectsTable.id, projectId))
        .limit(1);
      rows = projects.map((project) => ({
        id: project.id,
        name: project.name,
        language: project.language,
        status: project.status,
        updatedAt: project.updatedAt.toISOString(),
      }));
    } else if (resource === "active_goals") {
      const goals = await db
        .select({
          id: aiGoalsTable.id,
          title: aiGoalsTable.title,
          status: aiGoalsTable.status,
          priority: aiGoalsTable.priority,
          updatedAt: aiGoalsTable.updatedAt,
        })
        .from(aiGoalsTable)
        .where(and(
          eq(aiGoalsTable.projectId, projectId),
          inArray(aiGoalsTable.status, ["queued", "planning", "running", "waiting_for_event", "waiting_for_approval", "verifying", "needs_replan"]),
        ))
        .orderBy(desc(aiGoalsTable.updatedAt), desc(aiGoalsTable.id))
        .limit(limit);
      rows = goals.map((goal) => ({
        id: goal.id,
        title: goal.title,
        status: goal.status,
        priority: goal.priority,
        updatedAt: goal.updatedAt.toISOString(),
      }));
    } else {
      const events = await db
        .select({
          id: eventsTable.id,
          goalId: eventsTable.goalId,
          workflowId: eventsTable.workflowId,
          type: eventsTable.type,
          severity: eventsTable.severity,
          message: eventsTable.message,
          correlationId: eventsTable.correlationId,
          timestamp: eventsTable.timestamp,
        })
        .from(eventsTable)
        .where(eq(eventsTable.projectId, projectId))
        .orderBy(desc(eventsTable.timestamp), desc(eventsTable.id))
        .limit(limit);
      rows = events.map((event) => ({
        id: event.id,
        goalId: event.goalId,
        workflowId: event.workflowId,
        type: event.type,
        severity: event.severity,
        message: event.message.slice(0, 500),
        correlationId: event.correlationId,
        timestamp: event.timestamp.toISOString(),
      }));
    }
    const resultHash = createHash("sha256").update(JSON.stringify({ projectId, resource, rows })).digest("hex");
    return {
      status: "passed" as const,
      rows,
      evidence: {
        evidenceId: `database:${operationId}:${resultHash}`,
        resultHash,
      },
    };
  } catch {
    return { status: "unavailable" as const, detail: "The approved project data view is unavailable." };
  }
};

function externalEffectForNodes(
  nodes: readonly ExecutionNode[],
  operationId: string,
): AiExternalEffectCheckpoint | undefined {
  const node = nodes.find((candidate) =>
    candidate.status === "running" && candidate.capabilityId?.startsWith("github.push."));
  if (!node || !node.capabilityId) return undefined;
  const intentHash = createHash("sha256").update(JSON.stringify({
    operationId,
    capabilityId: node.capabilityId,
    recipeVersion: node.recipeVersion,
    capabilityInput: node.capabilityInput,
  })).digest("hex");
  return {
    kind: "github_delivery",
    operationId,
    capabilityId: node.capabilityId,
    intentHash,
    state: "pending",
    updatedAt: new Date().toISOString(),
  };
}

function receiptIdForEvidence(entry: RecipeEvidence[string]): string | undefined {
  const receipt = entry.outputs?.evidence;
  return receipt
    && typeof receipt === "object"
    && !Array.isArray(receipt)
    && typeof (receipt as { evidenceId?: unknown }).evidenceId === "string"
    ? (receipt as { evidenceId: string }).evidenceId
    : undefined;
}

function buildRecipeReceipt(
  params: RunRecipeOperationParams,
  executionId: string,
  attempt: number,
  status: RecipeReceipt["status"],
  nodes: readonly ActiveTaskExecutionPlan["nodes"][number][],
  outputs: ReadonlyMap<string, Record<string, unknown>>,
  completedNodeIds: readonly string[],
): RecipeReceipt {
  const deliveryOutput = [...outputs.values()].find((output) =>
    typeof output.candidateTreeHash === "string"
    || typeof output.treeHash === "string"
    || typeof output.committedTreeHash === "string"
  );
  const receipt = {
    contractVersion: 1 as const,
    executionId,
    operationId: params.operationId,
    attempt,
    sourceRevision: params.sourceRevision,
    candidateTreeHash: params.candidateIdentity ?? null,
    treeHash: typeof deliveryOutput?.treeHash === "string"
      ? deliveryOutput.treeHash
      : typeof deliveryOutput?.committedTreeHash === "string"
        ? deliveryOutput.committedTreeHash
        : null,
    recipeId: params.recipeId,
    recipeVersion: params.recipeVersion,
    status,
    completedNodeIds: [...completedNodeIds],
    nodes: nodes.map((node) => ({
      nodeId: node.id,
      status: node.status === "passed" ? "passed" as const
        : node.status === "failed" ? "failed" as const : "blocked" as const,
      attempts: node.attempts,
      elapsedMs: 0,
      evidenceId: receiptIdForEvidence({
        status: node.status,
        outputs: outputs.get(node.id),
      }) ?? null,
      excerpt: outputs.get(node.id)?.detail
        && typeof outputs.get(node.id)?.detail === "string"
        ? String(outputs.get(node.id)?.detail).slice(0, 500)
        : null,
    })),
    evidenceRefs: nodes.map((node) => receiptIdForEvidence({
      status: node.status,
      outputs: outputs.get(node.id),
    })).filter((id): id is string => typeof id === "string"),
    createdAt: new Date().toISOString(),
    completedAt: new Date().toISOString(),
  };
  return RecipeReceiptSchema.parse(receipt);
}

function advanceRecipeToTerminal(
  plan: ActiveTaskExecutionPlan,
  evidence: RecipeEvidence,
  signal: AbortSignal,
): { plan: ActiveTaskExecutionPlan; status: "succeeded" | "failed" | "blocked" | "cancelled" } {
  let current = plan;
  for (let index = 0; index <= plan.nodes.length; index += 1) {
    const advanced = advanceCompiledRecipeTransition(current, evidence, signal);
    if (advanced.status !== "advanced") return { plan: { ...current, recipeState: advanced.state }, status: advanced.status };
    current = { ...current, recipeState: advanced.state };
  }
  return { plan: current, status: "blocked" };
}

export async function runRecipeOperation(params: RunRecipeOperationParams): Promise<{
  executionId: string;
  status: "completed" | "blocked";
  completedNodeIds: string[];
  receipt: RecipeReceipt;
  measurementContinuation?: RuntimeStartMeasurementContinuationDisposition;
}> {
  let runtimeStartParentWorldState: Awaited<ReturnType<typeof getProjectWorldState>> | undefined;
  let runtimeStartBeforeObservationIds: string[] = [];
  let runtimeStartAfterObservationIds: string[] = [];
  let runtimeStartChildProcessObservationRetained = false;
  let runtimeStartTransitionQueued = false;
  let runtimeStartD1Decision: {
    allowEffect: boolean;
    transitionEligible: boolean;
    parentWorldRevision?: string;
    beforeObservationIds: string[];
    decisionCode: string;
    hypothesisExperimentId?: string;
  } | undefined;
  let runtimeStartHypothesisRegistration: RuntimeStartHypothesisExperimentRegistration | undefined;
  const runtimeStartRunner = params.runtimeStartRunner
    ? async (args: Parameters<RuntimeStartRunner>[0]) => params.runtimeStartRunner!({
        ...args,
        beforeEffectGate: async ({ beforeState, environmentRevision }) => {
          const executionId = args.executionId;
          const executionAttempt = args.executionAttempt;
          const parent = runtimeStartParentWorldState;
          const beforeValue = runtimeStartBeforeObservationValue(
            beforeState,
            params.projectId,
            params.sourceRevision,
          );
          const beforeStateRecord = beforeValue as Record<string, unknown> | undefined;
          let beforeObservationIds: string[] = [];
          let decisionCode = "runtime_start_d1_prestate_unproven";
          let allowEffect = false;
          let transitionEligible = false;
          if (
            !episode
            || !gateCAction
            || !executionId
            || typeof executionAttempt !== "number"
            || !Number.isInteger(executionAttempt)
          ) {
            decisionCode = "runtime_start_d1_episode_binding_missing";
          } else if (beforeValue && beforeStateRecord) {
            const beforeEvidenceRef = `runtime-start:${executionId}:${executionAttempt}:${gateCAction.actionId}:before`;
            if (!parent || !/^[a-f0-9]{64}$/.test(parent.worldRevision)) {
              decisionCode = "runtime_start_d1_parent_unavailable";
            } else if (
              environmentRevision === null
              || !/^env-v1:[a-f0-9]{64}$/.test(environmentRevision)
              || beforeStateRecord.environmentRevision !== environmentRevision
            ) {
              decisionCode = "runtime_start_d1_environment_unavailable";
            } else {
              try {
                const current = await getProjectWorldState(params.projectId, {
                  excludeEpisodeIds: [episode.episodeId],
                });
                const priorStatuses = parent.currentFacts
                  .filter((fact) => fact.predicate === "runtime.status")
                  .map((fact) => fact.value);
                const directStatus = beforeStateRecord.runtimeStatus;
                const worldStateConflicts = priorStatuses.some((status) =>
                  (directStatus === "stopped" && status === "running")
                  || (directStatus === "running" && status === "stopped"),
                );
                if (current.worldRevision !== parent.worldRevision) {
                  decisionCode = "runtime_start_d1_world_revision_changed";
                } else if (worldStateConflicts) {
                  decisionCode = "runtime_start_d1_fact_conflicts_with_direct_prestate";
                } else if (directStatus === "stopped") {
                  allowEffect = true;
                  transitionEligible = true;
                  decisionCode = "runtime_start_d1_approved";
                } else if (directStatus === "running") {
                  allowEffect = true;
                  decisionCode = "runtime_start_d1_already_running";
                } else {
                  decisionCode = "runtime_start_d1_prestate_not_stopped";
                }
              } catch {
                decisionCode = "runtime_start_d1_world_state_unavailable";
              }
            }
            try {
              const before = await materializeServerOwnedObservations({
                projectId: params.projectId,
                executionId,
                attempt: executionAttempt,
                episodeId: episode.episodeId,
                environmentRootPath: executionRoot,
                projectRevision: params.sourceRevision,
                materializeWorldState: false,
                sources: [{
                  kind: "direct_observation",
                  sourceId: `${beforeEvidenceRef}:runtime.before_state`,
                  sourceRevision: params.sourceRevision,
                  subject: `runtime:${params.projectId}`,
                  predicate: "runtime.before_state",
                  value: beforeValue,
                  evidenceRefs: [beforeEvidenceRef],
                  observedAt: String((beforeValue as Record<string, unknown>).observedAt),
                }],
              });
              beforeObservationIds = before.observationIds;
              runtimeStartBeforeObservationIds = beforeObservationIds;
            } catch (error) {
              logger.warn(
                {
                  scope: "recipe-operation",
                  code: "runtime_start_d1_observation_failed",
                  executionId,
                  attempt: executionAttempt,
                  episodeId: episode.episodeId,
                  actionId: gateCAction.actionId,
                  error,
                },
                "Runtime start D1 pre-state could not be persisted",
              );
              decisionCode = "runtime_start_d1_observation_persist_failed";
              allowEffect = false;
              transitionEligible = false;
            }
            if (beforeObservationIds.length === 0) {
              allowEffect = false;
              transitionEligible = false;
              decisionCode = "runtime_start_d1_observation_missing";
            }
          } else {
            decisionCode = "runtime_start_d1_prestate_unproven";
          }

          const result: {
            allowEffect: boolean;
            transitionEligible: boolean;
            parentWorldRevision?: string;
            beforeObservationIds: string[];
            decisionCode: string;
            hypothesisExperimentId?: string;
          } = {
            allowEffect,
            transitionEligible,
            ...(parent ? { parentWorldRevision: parent.worldRevision } : {}),
            beforeObservationIds,
            decisionCode,
          };
          if (
            !episode
            || !gateCAction
            || !executionId
            || typeof executionAttempt !== "number"
            || !Number.isInteger(executionAttempt)
          ) {
            runtimeStartD1Decision = result;
            return result;
          }
          await appendEpisodeEvent({
            episodeId: episode.episodeId,
            projectId: params.projectId,
            executionId,
            attempt: executionAttempt,
            workerId,
            eventType: "OBSERVATION_RECORDED",
            payload: {
              gate: "P6_D1_RUNTIME_START",
              decision: allowEffect
                ? transitionEligible ? "approved" : "not_a_transition"
                : "denied",
              decisionCode,
              actionId: gateCAction.actionId,
              parentWorldRevision: parent?.worldRevision ?? null,
              beforeObservationIds,
              runtimeStatus: typeof beforeStateRecord?.runtimeStatus === "string"
                ? beforeStateRecord.runtimeStatus
                : null,
              environmentRevision,
            },
            actorType: "worker",
            actorId: workerId,
            correlationId: executionId,
          });
          if (
            RUNTIME_START_HYPOTHESIS_COLLECTION_AUTHORIZED
            && params.recipeId === "runtime.start"
            && allowEffect
            && transitionEligible
            && params.missionId
            && params.goalId
            && params.planRevision
            && environmentRevision
            && parent
            && beforeObservationIds.length > 0
          ) {
            try {
              const calibrationScopeRef = runtimeStartHypothesisCalibrationScopeRef({
                projectId: params.projectId,
                projectRevision: params.sourceRevision,
                environmentRevision,
              });
              const experimentId = `p75-runtime-start:${canonicalJsonHash({
                projectId: params.projectId,
                missionId: params.missionId,
                goalId: params.goalId,
                executionId,
                attempt: executionAttempt,
                episodeId: episode.episodeId,
                actionId: gateCAction.actionId,
                planRevision: params.planRevision,
                projectRevision: params.sourceRevision,
                environmentRevision,
                parentWorldRevision: parent.worldRevision,
                contextObservationIds: beforeObservationIds,
                calibrationScopeRef,
                calibrationPolicyVersion: RUNTIME_START_CALIBRATION_POLICY_VERSION,
                evaluationPartition: RUNTIME_START_CALIBRATION_PARTITION,
                objectiveContractId: RUNTIME_START_OBJECTIVE_CONTRACT_ID,
                hypothesisSetId: RUNTIME_START_HYPOTHESIS_SET_ID,
              })}`;
              const existingEvents = await db.select()
                .from(aiAgentEpisodeEventsTable)
                .where(and(
                  eq(aiAgentEpisodeEventsTable.episodeId, episode.episodeId),
                  eq(aiAgentEpisodeEventsTable.eventType, "OBSERVATION_REQUESTED"),
                ));
              const conflictingRegistration = existingEvents.some((event) => {
                const payload = event.payload;
                return payload
                  && typeof payload === "object"
                  && !Array.isArray(payload)
                  && (payload as Record<string, unknown>).recordKind
                    === "P75_HYPOTHESIS_EXPERIMENT_REGISTERED"
                  && (payload as Record<string, unknown>).actionId === gateCAction.actionId
                  && (payload as Record<string, unknown>).experimentId !== experimentId;
              });
              if (conflictingRegistration) {
                throw new Error("A prior runtime-start registration for this action uses a different policy identity.");
              }
              const existingRegistration = existingEvents.find((event) => {
                const payload = event.payload;
                return payload
                  && typeof payload === "object"
                  && !Array.isArray(payload)
                  && (payload as Record<string, unknown>).recordKind
                    === "P75_HYPOTHESIS_EXPERIMENT_REGISTERED"
                  && (payload as Record<string, unknown>).experimentId === experimentId;
              });
              let registration: RuntimeStartHypothesisExperimentRegistration;
              if (existingRegistration) {
                registration = parseRuntimeStartHypothesisExperimentRegistration(
                  existingRegistration.payload,
                );
                const expected = buildRuntimeStartHypothesisExperimentRegistration({
                  projectId: params.projectId,
                  missionId: params.missionId,
                  goalId: params.goalId,
                  executionId,
                  attempt: executionAttempt,
                  episodeId: episode.episodeId,
                  actionId: gateCAction.actionId,
                  planRevision: params.planRevision,
                  projectRevision: params.sourceRevision,
                  environmentRevision,
                  parentWorldRevision: parent.worldRevision,
                  beforeObservationIds,
                  predictionRegisteredAt: registration.predictionRegisteredAt,
                  calibrationAssessment: {
                    status: registration.calibrationStatus,
                    ...(registration.calibrationAssessmentRef
                      ? { assessmentRef: registration.calibrationAssessmentRef }
                      : {}),
                  },
                });
                if (canonicalJsonHash(registration) !== canonicalJsonHash(expected)) {
                  throw new Error("Existing P7.5 registration conflicts with the current runtime-start binding.");
                }
              } else {
                const calibrationAssessment = RuntimeStartHypothesisCalibrationAssessmentSchema.parse(
                  evaluateRuntimeStartHypothesisCalibration({
                    calibrationScopeRef,
                    experiments: await loadRuntimeStartCalibrationExperiments(
                      params.projectId,
                      calibrationScopeRef,
                    ),
                  }),
                );
                await appendEpisodeEvent({
                  episodeId: episode.episodeId,
                  projectId: params.projectId,
                  executionId,
                  attempt: executionAttempt,
                  workerId,
                  eventType: "OBSERVATION_RECORDED",
                  payload: calibrationAssessment as unknown as JsonValue,
                  actorType: "server",
                  actorId: workerId,
                  correlationId: executionId,
                });
                registration = buildRuntimeStartHypothesisExperimentRegistration({
                  projectId: params.projectId,
                  missionId: params.missionId,
                  goalId: params.goalId,
                  executionId,
                  attempt: executionAttempt,
                  episodeId: episode.episodeId,
                  actionId: gateCAction.actionId,
                  planRevision: params.planRevision,
                  projectRevision: params.sourceRevision,
                  environmentRevision,
                  parentWorldRevision: parent.worldRevision,
                  beforeObservationIds,
                  predictionRegisteredAt: new Date().toISOString(),
                  calibrationAssessment: {
                    // Numerical calibration is advisory until independently
                    // verified sampling and held-out provenance are available.
                    // Do not promote even a legacy "validated" assessment here.
                    status: "unvalidated",
                    assessmentRef: calibrationAssessment.assessmentRef,
                  },
                });
                if (registration.experimentId !== experimentId) {
                  throw new Error("P7.5 experiment identity did not match its server-owned binding.");
                }
                await appendEpisodeEvent({
                  episodeId: episode.episodeId,
                  projectId: params.projectId,
                  executionId,
                  attempt: executionAttempt,
                  workerId,
                  eventType: "OBSERVATION_REQUESTED",
                  payload: registration as unknown as JsonValue,
                  actorType: "server",
                  actorId: workerId,
                  correlationId: executionId,
                  observationRefs: beforeObservationIds,
                });
              }
              runtimeStartHypothesisRegistration = registration;
              result.hypothesisExperimentId = registration.experimentId;
            } catch (error) {
              logger.warn(
                {
                  scope: "recipe-operation",
                  code: "runtime_start_hypothesis_registration_failed",
                  executionId,
                  attempt: executionAttempt,
                  episodeId: episode.episodeId,
                  actionId: gateCAction.actionId,
                  error,
                },
                "P7.5 runtime-start experiment was not registered; the existing action remains unchanged",
              );
            }
          }
          runtimeStartD1Decision = result;
          return result;
        },
      })
    : undefined;
  const prepared = prepareRecipeOperation({
    ...params,
    ...(runtimeStartRunner ? { runtimeStartRunner } : {}),
  });
  if (params.skillBinding) {
    await requireActiveSkillRegistry({
      projectId: params.projectId,
      skillId: params.skillBinding.skillId,
      skillVersion: params.skillBinding.skillVersion,
      candidateId: params.candidateIdentity,
      sourceRevision: params.sourceRevision,
      candidateTreeHash: params.candidateIdentity,
      registryId: params.skillBinding.registryId,
      proofReceiptId: params.skillBinding.proofReceiptId,
      shadowReplayId: params.skillBinding.shadowReplayId,
    });
  }
  const candidateRoot = await canonicalCandidateWorkspace(params.candidateWorkspace);
  const executionRoot = candidateRoot ?? path.resolve(params.rootPath);
  const executionRequest = {
    projectId: params.projectId,
    ...(params.executionProfile ? { executionProfile: params.executionProfile } : {}),
    operationId: params.operationId,
    sessionId: params.sessionId,
    message: `recipe:${params.operationId}`,
    modelMessage: `recipe:${params.operationId}`,
    workspaceRevision: params.sourceRevision,
    validationTargetPaths: normalizedPaths(params.approvedPaths),
    ...(params.validationProfiles ? { validationProfiles: [...params.validationProfiles] } : {}),
    ...(params.proofRequired ? { proofRequired: true } : {}),
    ...(params.skillBinding
      ? {
          skillRegistryBinding: {
            registryId: params.skillBinding.registryId,
            skillId: params.skillBinding.skillId,
            skillVersion: params.skillBinding.skillVersion,
            candidateId: params.skillBinding.candidateId,
            sourceRevision: params.skillBinding.sourceRevision,
            candidateTreeHash: params.skillBinding.candidateTreeHash,
            proofReceiptId: params.skillBinding.proofReceiptId,
            shadowReplayId: params.skillBinding.shadowReplayId,
          },
        }
      : {}),
  };
  const created = await createAiExecution({
    userId: params.userId,
    request: executionRequest,
    idempotencyKey: params.idempotencyKey,
    projectId: params.projectId,
    ...(params.goalId ? { goalId: params.goalId } : {}),
    sessionId: params.sessionId,
    recipeBinding: prepared.binding,
    parentExecutionId: params.parentExecutionId,
    delegationBudget: params.delegationBudget,
  });
  const workerId = `recipe:${params.operationId}:${randomUUID()}`;
  const recovery = created.execution.status === "paused"
    ? await recoverAiExecutionResumeToken({
        executionId: created.execution.id,
        userId: params.userId,
        expectedAttempt: created.execution.attempt,
      })
    : undefined;
  if (created.execution.status === "paused" && !recovery) {
    throw new Error("Paused recipe execution is not eligible for durable recovery.");
  }
  const claimed = await claimAiExecution({
    executionId: created.execution.id,
    userId: params.userId,
    workerId,
    ...(recovery?.resumeToken ? { resumeToken: recovery.resumeToken } : {}),
    recipeBinding: prepared.binding,
  });
  if (!claimed) {
    const existingReceipt = created.execution.recipeReceipt
      ? RecipeReceiptSchema.safeParse(created.execution.recipeReceipt).data
      : undefined;
    if (existingReceipt) return {
      executionId: created.execution.id,
      status: existingReceipt.status === "completed" ? "completed" : "blocked",
      completedNodeIds: existingReceipt.completedNodeIds,
      receipt: existingReceipt,
    };
    throw new Error("Recipe operation could not acquire its durable lease.");
  }
  const candidateValidation = params.recipeId === "candidate.verify";
  const recipeGateCEffectKind = gateCEffectKind(params.recipeId);
  const authoritativeEffectRecipe = candidateValidation || Boolean(recipeGateCEffectKind);
  const tracksReadOnlyRecipeInvocation = !authoritativeEffectRecipe
    && prepared.plan.nodes.some((node) => isReadOnlyRecipeCapability(node.capabilityId));
  const validationEnvironmentProfile = candidateValidation
    ? serverEnvironmentProfile("CANDIDATE_VALIDATION", {
        kind: "recipe",
        operationId: params.operationId,
        recipeId: params.recipeId,
        candidateIdentity: params.candidateIdentity ?? null,
        ...(params.validationProfiles
          ? { validationProfiles: [...params.validationProfiles] }
          : {}),
      })
    : null;
  const episode = authoritativeEffectRecipe
    ? await startEpisode({
        projectId: params.projectId,
        executionId: claimed.id,
        attempt: claimed.attempt,
        workerId,
        idempotencyKey: `${params.operationId}:episode:${claimed.attempt}`,
        projectRevision: params.sourceRevision,
        environmentRootPath: executionRoot,
         intentKind: candidateValidation
           ? "CANDIDATE_VALIDATION"
           : recipeGateCEffectKind === "browser"
             ? "BROWSER_VALIDATION"
             : recipeGateCEffectKind === "runtime"
               ? "RUNTIME_START"
               : "GITHUB_DELIVERY",
        scope: {
          kind: "recipe",
          operationId: params.operationId,
          recipeId: params.recipeId,
          candidateIdentity: params.candidateIdentity ?? null,
          ...(candidateValidation && params.validationProfiles
            ? { validationProfiles: [...params.validationProfiles] }
            : {}),
          ...(params.strategyReplayContext
            ? {
                strategyReplayCase: {
                  caseRegistrationId: params.strategyReplayContext.caseRegistrationId,
                  caseId: params.strategyReplayContext.caseId,
                  candidateId: params.strategyReplayContext.candidateId,
                  candidateHash: params.strategyReplayContext.candidateHash,
                  sourceEpisodeId: params.strategyReplayContext.sourceEpisodeId,
                  sourceCanonicalProofHash: params.strategyReplayContext.sourceCanonicalProofHash,
                },
              }
            : {}),
        },
        ...(params.missionId ? { missionId: params.missionId } : {}),
        ...(params.goalId ? { goalId: params.goalId } : {}),
         ...(params.recipeId === "runtime.start" && params.goalId && params.planRevision
           ? {
               planRevision: params.planRevision,
               objectiveContractId: RUNTIME_START_OBJECTIVE_CONTRACT_ID,
             }
           : {}),
      })
    : undefined;
  const recipeEpisodeInput = {
    projectId: params.projectId,
    executionId: claimed.id,
    attempt: claimed.attempt,
    workerId,
    idempotencyKey: `${params.operationId}:episode:${claimed.attempt}`,
    projectRevision: params.sourceRevision,
    intentKind: "RECIPE_OPERATION",
    scope: { kind: "recipe", operationId: params.operationId, recipeId: params.recipeId },
    ...(params.goalId ? { goalId: params.goalId } : {}),
    ...(params.recipeId === "runtime.start" && params.goalId && params.planRevision
      ? {
          planRevision: params.planRevision,
          objectiveContractId: RUNTIME_START_OBJECTIVE_CONTRACT_ID,
        }
      : {}),
  };
  let readOnlyInvocationEpisode: Awaited<ReturnType<typeof startEpisode>> | undefined;
  if (tracksReadOnlyRecipeInvocation) {
    try {
      readOnlyInvocationEpisode = await startEpisode(recipeEpisodeInput);
    } catch (error) {
      logger.warn(
        {
          scope: "recipe-operation",
          code: "read_only_recipe_episode_start_failed",
          executionId: claimed.id,
          attempt: claimed.attempt,
          error,
        },
        "Read-only recipe execution stopped because its Episode could not be created",
      );
      const checkpoint = parseAiExecutionCheckpoint(claimed.checkpoint);
      await failAiExecution({
        executionId: claimed.id,
        workerId,
        error: "Read-only recipe invocation provenance could not be established.",
        recipeBinding: checkpoint?.recipeBinding ?? {
          ...prepared.binding,
          phase: "running",
          leaseOwner: workerId,
          leaseUntil: new Date(Date.now() + 300_000).toISOString(),
        },
      });
      throw new Error("Read-only recipe invocation provenance could not be established.");
    }
  }
  let readOnlyInvocationEpisodeCloseAttempted = false;
  const closeReadOnlyInvocationEpisode = async (
    verdict: EpisodeVerdict,
    reasonCode: string,
  ): Promise<void> => {
    if (!readOnlyInvocationEpisode || readOnlyInvocationEpisodeCloseAttempted) return;
    readOnlyInvocationEpisodeCloseAttempted = true;
    try {
      await closeEpisode({
        episodeId: readOnlyInvocationEpisode.episodeId,
        projectId: params.projectId,
        executionId: claimed.id,
        attempt: claimed.attempt,
        workerId,
        eventType: verdict === "cancelled" ? "EPISODE_CANCELLED" : "EPISODE_TERMINAL",
        payload: { verdict, reasonCode },
        verdict,
        reasonCode,
        actorType: "worker",
        actorId: workerId,
        correlationId: claimed.id,
      });
    } catch (error) {
      logger.warn(
        {
          scope: "recipe-operation",
          code: "read_only_recipe_episode_close_failed",
          executionId: claimed.id,
          episodeId: readOnlyInvocationEpisode.episodeId,
          verdict,
          error,
        },
        "Read-only recipe Episode could not be closed",
      );
    }
  };
  if (!authoritativeEffectRecipe && !tracksReadOnlyRecipeInvocation) {
    startEpisodeShadow(recipeEpisodeInput);
  }
  let candidateValidationAction: AgentAction | undefined;
  let candidateValidationEffectContract: EffectContract | undefined;
  let candidateValidationBeforeObservationIds: string[] | undefined;
  let candidateValidationRequestedAt: number | undefined;
  let gateCAction: AgentAction | undefined;
  let gateCEffectContract: EffectContract | undefined;
  let gateCBeforeObservationIds: string[] | undefined;
  let gateCEffectBundleId: string | undefined;
  let strategyReplayActionContractMatches = true;
  if (candidateValidation) {
    if (!episode || !params.candidateIdentity || !candidateRoot) {
      throw new Error("Candidate validation requires an identity and disposable workspace.");
    }
    const beforeTreeHash = await hashDeliveryTree(executionRoot);
    const beforeEvidenceRef = `candidate-validation:${claimed.id}:${claimed.attempt}:before`;
    const afterEvidenceRef = `candidate-validation:${claimed.id}:${claimed.attempt}:after`;
    const action = buildCandidateValidationAction({
      actionId: `action:${claimed.id}:${claimed.attempt}:candidate-validation`,
      episodeId: episode.episodeId,
      projectId: params.projectId,
      operationId: params.operationId,
      sourceRevision: params.sourceRevision,
      candidateIdentity: params.candidateIdentity,
      approvedPaths: normalizedPaths(params.approvedPaths),
    });
    const actionContract = strategyActionContract(action);
    candidateValidationAction = action;
    candidateValidationEffectContract = buildCandidateValidationEffectContract({
      candidateIdentity: params.candidateIdentity,
      beforeEvidenceRef,
      afterEvidenceRef,
    });
    candidateValidationRequestedAt = Date.now();
    await appendEpisodeEvent({
      episodeId: episode.episodeId,
      projectId: params.projectId,
      executionId: claimed.id,
      attempt: claimed.attempt,
      workerId,
      eventType: "ACTION_REQUESTED",
      payload: {
        actionId: action.actionId,
        capabilityId: action.capabilityId,
        expectedEffects: action.expectedEffects,
        action,
        observationProfile: action.observationProfile,
        actionContract,
        actionContractHash: canonicalJsonHash(actionContract),
      },
      actorType: "worker",
      actorId: workerId,
      correlationId: claimed.id,
    });
    const before = await materializeServerOwnedObservations({
      projectId: params.projectId,
      executionId: claimed.id,
      attempt: claimed.attempt,
      episodeId: episode.episodeId,
      environmentRootPath: executionRoot,
      projectRevision: params.sourceRevision,
      materializeWorldState: false,
      sources: [
        {
          kind: "direct_observation",
          sourceId: `${beforeEvidenceRef}:workspace`,
          sourceRevision: params.sourceRevision,
          subject: `candidate:${params.candidateIdentity}`,
          predicate: "workspace.tree_hash",
          value: beforeTreeHash,
          evidenceRefs: [beforeEvidenceRef],
        },
        {
          kind: "direct_observation",
          sourceId: `${beforeEvidenceRef}:status`,
          sourceRevision: params.sourceRevision,
          subject: `candidate:${params.candidateIdentity}`,
          predicate: "validation.status",
          value: "pending",
          evidenceRefs: [beforeEvidenceRef],
        },
      ],
    });
    candidateValidationBeforeObservationIds = before.observationIds;
  }
  if (recipeGateCEffectKind && episode) {
    const gateNode = prepared.plan.nodes[0];
    if (!gateNode?.capabilityId) {
      throw new Error("Gate C recipe is missing a server-owned capability.");
    }
    const identity = gateCEffectIdentity({
      kind: recipeGateCEffectKind,
      operationId: params.operationId,
    });
    const beforeEvidenceRef = `gate-c:${claimed.id}:${claimed.attempt}:before`;
    const afterEvidenceRef = `gate-c:${claimed.id}:${claimed.attempt}:after`;
    const action = buildGateCAction({
      actionId: `action:${claimed.id}:${claimed.attempt}:gate-c`,
      episodeId: episode.episodeId,
      projectId: params.projectId,
      operationId: params.operationId,
      sourceRevision: params.sourceRevision,
      recipeId: params.recipeId,
      capabilityId: gateNode.capabilityId,
      approvedPaths: normalizedPaths(params.approvedPaths),
      candidateIdentity: params.candidateIdentity,
    });
    const actionContract = strategyActionContract(action);
    strategyReplayActionContractMatches = !params.strategyReplayContext
      || canonicalJsonHash(actionContract) === params.strategyReplayContext.expectedActionContractHash;
    gateCAction = action;
    gateCEffectContract = buildGateCEffectContract({
      kind: recipeGateCEffectKind,
      operationId: params.operationId,
      beforeEvidenceRef,
      afterEvidenceRef,
    });
    await appendEpisodeEvent({
      episodeId: episode.episodeId,
      projectId: params.projectId,
      executionId: claimed.id,
      attempt: claimed.attempt,
      workerId,
      eventType: "ACTION_REQUESTED",
      payload: {
        actionId: action.actionId,
        capabilityId: action.capabilityId,
        expectedEffects: action.expectedEffects,
        action,
        observationProfile: action.observationProfile,
        actionContract,
        actionContractHash: canonicalJsonHash(actionContract),
      },
      actorType: "worker",
      actorId: workerId,
      correlationId: claimed.id,
    });
    const before = await materializeServerOwnedObservations({
      projectId: params.projectId,
      executionId: claimed.id,
      attempt: claimed.attempt,
      episodeId: episode.episodeId,
      environmentRootPath: executionRoot,
      projectRevision: params.sourceRevision,
      materializeWorldState: false,
      sources: [{
        kind: "direct_observation",
        sourceId: `${beforeEvidenceRef}:${identity.subject}:${identity.predicate}`,
        sourceRevision: params.sourceRevision,
        subject: identity.subject,
        predicate: identity.predicate,
        value: "pending",
        evidenceRefs: [beforeEvidenceRef],
      }],
    });
    gateCBeforeObservationIds = before.observationIds;
    if (params.recipeId === "runtime.start") {
      try {
        runtimeStartParentWorldState = await getProjectWorldState(params.projectId, {
          excludeEpisodeIds: [episode.episodeId],
        });
      } catch (error) {
        logger.warn(
          {
            scope: "recipe-operation",
            code: "runtime_start_parent_world_state_read_failed",
            executionId: claimed.id,
            attempt: claimed.attempt,
            error,
          },
          "Runtime start will retain the D1 read failure and fail World State projection closed",
        );
      }
    }
  }
  const checkpoint = parseAiExecutionCheckpoint(claimed.checkpoint);
  const runningRecipeBinding = checkpoint?.recipeBinding ?? {
    ...prepared.binding,
    phase: "running" as const,
    leaseOwner: workerId,
    leaseUntil: new Date(Date.now() + 300_000).toISOString(),
  };
  const resumedNodes = reconcileExecutionNodeCheckpoint(prepared.plan.nodes, checkpoint?.nodeStates);
  if (!resumedNodes) {
    await failAiExecution({
      executionId: claimed.id,
      workerId,
      error: "Recipe checkpoint does not match the server-owned recipe plan.",
      recipeBinding: runningRecipeBinding,
    });
    throw new Error("Recipe checkpoint could not be reconciled with the server-owned plan.");
  }
  const outputs = new Map<string, Record<string, unknown>>();
  for (const node of checkpoint?.nodeStates ?? []) {
    if (node.status !== "passed") continue;
    const evidenceId = node.evidenceRefs?.find((value): value is string => typeof value === "string" && value.length > 0);
    if (!evidenceId) {
      await failAiExecution({
        executionId: claimed.id,
        workerId,
        error: "Recipe checkpoint passed node has no retained evidence receipt.",
        recipeBinding: runningRecipeBinding,
      });
      throw new Error("Recipe checkpoint passed node is missing retained evidence.");
    }
    outputs.set(node.id, { evidence: { evidenceId } });
  }

  const registry = createServerCapabilityRegistry({
    validationRunner: params.validationRunner ?? (async (profile, targetPaths, signal) =>
      runRepairValidation(
        executionRoot,
        profile as Parameters<typeof runRepairValidation>[1],
        targetPaths,
        signal,
        undefined,
        {
          operationId: claimed.id,
          projectRevision: params.sourceRevision,
          candidateHash: params.candidateIdentity ?? undefined,
          environmentProfile: validationEnvironmentProfile,
          childProcessIdentity: episode ? {
            projectId: params.projectId,
            executionId: claimed.id,
            executionAttempt: claimed.attempt,
            episodeId: episode.episodeId,
            operationId: params.operationId,
            revision: params.sourceRevision,
          } : undefined,
        },
      )),
    ...(params.githubDeliveryRunner ? { githubDeliveryRunner: params.githubDeliveryRunner } : {}),
    ...(runtimeStartRunner ? { runtimeStartRunner } : {}),
    ...(params.runtimeRestartRunner ? { runtimeRestartRunner: params.runtimeRestartRunner } : {}),
    ...(params.runtimeStopRunner ? { runtimeStopRunner: params.runtimeStopRunner } : {}),
    databaseReadRunner: params.databaseReadRunner ?? DEFAULT_DATABASE_READ_RUNNER,
    ...(params.browserValidationRunner
      ? {
          browserValidationRunner: params.browserValidationRunner,
          browserProfiles: ["default"],
        }
      : {}),
  });
  const overallController = new AbortController();
  await registerAiExecutionController(claimed.id, overallController);
  const heartbeatTimer = setInterval(() => {
    void heartbeatAiExecution({
      executionId: claimed.id,
      expectedAttempt: claimed.attempt,
      workerId,
    }).then((ok) => {
      if (!ok) overallController.abort();
    }).catch(() => overallController.abort());
  }, 30_000);
  const abortOverall = () => overallController.abort();
  const totalTimer = setTimeout(abortOverall, prepared.binding.missionBudget.maxTotalTimeoutMs);
  // checkpoint_version is a PostgreSQL integer. Continue from the durable
  // version claimed above instead of using wall-clock milliseconds, which
  // overflow the column on the first progress checkpoint.
  let checkpointSequence = claimed.checkpointVersion;
  let latestNodes = resumedNodes;
  try {
    const injectedMeasurementContinuationRunner =
      params.runtimeStartMeasurementContinuationRunner;
    if (
      episode
      && params.recipeId === "runtime.start"
      && (
        RUNTIME_START_HYPOTHESIS_COLLECTION_AUTHORIZED
        || injectedMeasurementContinuationRunner !== undefined
      )
    ) {
      // The injectable runner is a server-internal test seam; production does
      // not supply it and remains behind the closed collection policy gate.
      const continuationRunner = injectedMeasurementContinuationRunner
        ?? runRuntimeStartHypothesisMeasurementContinuation;
      const measurementContinuation = await continuationRunner({
        projectId: params.projectId,
        userId: params.userId,
        operationId: params.operationId,
        executionId: claimed.id,
        attempt: claimed.attempt,
        episodeId: episode.episodeId,
        workerId,
        missionId: params.missionId,
        goalId: params.goalId,
        planRevision: params.planRevision,
        projectRevision: params.sourceRevision,
        rootPath: executionRoot,
        signal: overallController.signal,
      });
      if (measurementContinuation) {
        if (overallController.signal.aborted) {
          throw new Error("P7.5 measurement continuation was cancelled before terminalization.");
        }
        await terminalizeP75MeasurementContinuationEpisode({
          episodeId: episode.episodeId,
          projectId: params.projectId,
          executionId: claimed.id,
          attempt: claimed.attempt,
          workerId,
          userId: params.userId,
          operationId: params.operationId,
          missionId: params.missionId!,
          goalId: params.goalId!,
          planRevision: params.planRevision!,
          projectRevision: params.sourceRevision,
          sourceExperimentId: measurementContinuation.sourceExperimentId,
          continuationId: measurementContinuation.continuationId,
          resultId: measurementContinuation.resultId,
          measurementValidity: measurementContinuation.measurementValidity,
          resultOwnerEpisodeId: measurementContinuation.resultOwnerEpisodeId,
          resultOwnerAttempt: measurementContinuation.resultOwnerAttempt,
          sourceEpisodeId: measurementContinuation.sourceEpisodeId,
          sourceAttempt: measurementContinuation.sourceAttempt,
          observationOwnerEpisodeId: measurementContinuation.observationOwnerEpisodeId,
          observationOwnerAttempt: measurementContinuation.observationOwnerAttempt,
          observationContinuationId: measurementContinuation.observationContinuationId,
          observationId: measurementContinuation.observationId,
          reasonCode: measurementContinuation.reasonCode,
        });
        const continuationReceipt = buildRecipeReceipt(
          params,
          claimed.id,
          claimed.attempt,
          "blocked",
          [],
          new Map(),
          [],
        );
        return {
          executionId: claimed.id,
          status: "blocked",
          completedNodeIds: [],
          receipt: continuationReceipt,
          measurementContinuation,
        };
      }
    }
    const result = await executeExecutionNodePlan({
      nodes: resumedNodes,
      maxParallelNodes: prepared.binding.concurrencyBudget.maxInFlightNodes,
      signal: overallController.signal,
      authorizeNodeExecution: ({ phase }) => authorizeRecipeNodeExecution({
        executionId: claimed.id,
        userId: params.userId,
        workerId,
        binding: {
          ...prepared.binding,
          phase: "running",
          leaseOwner: workerId,
          leaseUntil: new Date(Date.now() + 300_000).toISOString(),
        },
        phase,
      }),
      runNode: async (node, context) => {
        if (context.signal?.aborted || overallController.signal.aborted) {
          return { status: "blocked" as const, detail: "recipe execution cancelled" };
        }
        assertRecipeNodeBinding(prepared.binding, node, {
          projectId: params.projectId,
          operationId: params.operationId,
          sourceRevision: params.sourceRevision,
          candidateIdentity: params.candidateIdentity ?? null,
          candidateWorkspace: params.candidateWorkspace ?? null,
          approvedPaths: normalizedPaths(params.approvedPaths),
        });
        if (params.candidateWorkspace) {
          const currentCandidateRoot = await canonicalCandidateWorkspace(params.candidateWorkspace);
          if (currentCandidateRoot !== executionRoot) {
            return { status: "blocked" as const, detail: "Recipe candidate workspace canonical identity changed." };
          }
        }
        if (params.skillBinding) {
          await requireActiveSkillRegistry({
            projectId: params.projectId,
            skillId: params.skillBinding.skillId,
            skillVersion: params.skillBinding.skillVersion,
            candidateId: params.candidateIdentity,
            sourceRevision: params.sourceRevision,
            candidateTreeHash: params.candidateIdentity,
            registryId: params.skillBinding.registryId,
            proofReceiptId: params.skillBinding.proofReceiptId,
            shadowReplayId: params.skillBinding.shadowReplayId,
          });
        }
        const nodeController = new AbortController();
        const abortNode = () => nodeController.abort();
        const nodeTimer = setTimeout(abortNode, node.executionTimeoutMs);
        const abortFromOverall = () => nodeController.abort();
        overallController.signal.addEventListener("abort", abortFromOverall, { once: true });
        context.signal?.addEventListener("abort", abortFromOverall, { once: true });
        try {
          const checkpointNodes = latestNodes.some((candidate) => candidate.id === node.id)
            ? latestNodes
            : [...latestNodes, { ...node, status: "running" as const }];
          const externalEffect = externalEffectForNodes(
            checkpointNodes.map((candidate) => candidate.id === node.id
              ? { ...candidate, status: "running" as const }
              : candidate),
            params.operationId,
          );
          if (externalEffect) {
            const liveBinding = {
              ...prepared.binding,
              phase: "running" as const,
              leaseOwner: workerId,
              leaseUntil: new Date(Date.now() + 300_000).toISOString(),
            };
            const checkpointed = await checkpointAiExecution({
              executionId: claimed.id,
              expectedAttempt: claimed.attempt,
              workerId,
              recipeBinding: liveBinding,
              checkpoint: {
                stage: "running",
                sequence: ++checkpointSequence,
                currentNode: node.id,
                externalEffect,
                ...(checkpoint?.operation ? { operation: { ...checkpoint.operation, binding: liveBinding } } : {}),
                recipeBinding: liveBinding,
                nodeStates: checkpointNodes.map((candidate) => ({
                  ...candidate,
                  evidenceRefs: candidate.status === "passed"
                    ? [receiptIdForEvidence({ status: candidate.status, outputs: outputs.get(candidate.id) })]
                      .filter((id): id is string => typeof id === "string")
                    : [],
                })),
                completedNodes: checkpointNodes.filter((candidate) => candidate.status === "passed").map((candidate) => candidate.id),
                updatedAt: new Date().toISOString(),
              },
            });
            if (!checkpointed) {
              return { status: "blocked" as const, detail: "Recipe could not durably record the external delivery intent." };
            }
          }
          if (params.strategyReplayContext && !strategyReplayActionContractMatches) {
            return {
              status: "blocked" as const,
              detail: "The registered strategy action contract no longer matches the server recipe.",
            };
          }
          const tracksThisInvocation = tracksReadOnlyRecipeInvocation
            && !authoritativeEffectRecipe
            && isReadOnlyRecipeCapability(node.capabilityId)
            && Boolean(node.capabilityId && registry.has(node.capabilityId));
          const invocationContract = tracksThisInvocation && readOnlyInvocationEpisode
            ? buildRecipeReadOnlyInvocationContract({
                episodeId: readOnlyInvocationEpisode.episodeId,
                executionId: claimed.id,
                executionAttempt: claimed.attempt,
                node,
                nodeAttempt: context.attempt,
                projectId: params.projectId,
                projectRevision: params.sourceRevision,
              })
            : undefined;
          if (tracksThisInvocation && !invocationContract) {
            logger.warn(
              {
                scope: "recipe-operation",
                code: "recipe_invocation_contract_unavailable",
                executionId: claimed.id,
                nodeId: recipeInvocationNodeId(node.capabilityId, node.id),
                capabilityId: node.capabilityId,
              },
              "Read-only recipe invocation identity is incomplete; blocking the capability call",
            );
            return {
              status: "blocked" as const,
              detail: "Read-only recipe invocation provenance is unavailable.",
              validationAttempts: 1,
            };
          }
          const invocationRequestRecorded = invocationContract
            ? await appendRecipeInvocationEvent({
                episodeId: readOnlyInvocationEpisode!.episodeId,
                projectId: params.projectId,
                executionId: claimed.id,
                attempt: claimed.attempt,
                workerId,
                eventType: "OBSERVATION_REQUESTED",
                payload: invocationContract,
                actorType: "worker",
                actorId: workerId,
                correlationId: claimed.id,
              })
            : false;
          if (tracksThisInvocation && !invocationRequestRecorded) {
            return {
              status: "blocked" as const,
              detail: "Read-only recipe request provenance could not be recorded.",
              validationAttempts: 1,
            };
          }
          const recordInvocationResult = async (result: {
            outcome: "completed" | "failed" | "rejected";
            resultHash?: string;
            capabilityStatus?: string;
            failureCode?: string;
            evidenceRefs: string[];
          }): Promise<boolean> => {
            if (!tracksThisInvocation) return true;
            if (!invocationContract || !invocationRequestRecorded || !readOnlyInvocationEpisode) return false;
            return appendRecipeInvocationEvent({
              episodeId: readOnlyInvocationEpisode.episodeId,
              projectId: params.projectId,
              executionId: claimed.id,
              attempt: claimed.attempt,
              workerId,
              eventType: "OBSERVATION_RECORDED",
              payload: { ...invocationContract, ...result },
              actorType: "worker",
              actorId: workerId,
              correlationId: claimed.id,
              ...(result.evidenceRefs.length ? { evidenceRefs: result.evidenceRefs } : {}),
            });
          };
          let invocation: Awaited<ReturnType<typeof registry.invoke>>;
          try {
            invocation = await registry.invoke(
              node.capabilityId!,
              node.recipeVersion!,
              node.capabilityInput,
              {
                rootPath: executionRoot,
                operation: "recipe",
                projectId: params.projectId,
                operationId: params.operationId,
                executionId: claimed.id,
                executionAttempt: claimed.attempt,
                ...((episode ?? readOnlyInvocationEpisode)
                  ? { episodeId: (episode ?? readOnlyInvocationEpisode)!.episodeId }
                  : {}),
                signal: nodeController.signal,
                scope: node.executionContext?.scope,
                allowedFiles: node.allowedFiles,
                approvalState: "APPROVED",
                authorized: true,
                revision: node.executionContext?.revision,
              },
            );
          } catch (error) {
            logger.warn(
              {
                scope: "recipe-operation",
                code: "recipe_capability_invocation_threw",
                executionId: claimed.id,
                nodeId: recipeInvocationNodeId(node.capabilityId, node.id),
                error,
              },
              "Recipe capability invocation threw",
            );
            await recordInvocationResult({
              outcome: "failed",
              resultHash: canonicalJsonHash({ outcome: "failed", failureCode: "INVOCATION_THROWN" }),
              failureCode: "INVOCATION_THROWN",
              evidenceRefs: [],
            });
            return { status: "failed" as const, detail: "Recipe capability invocation failed.", validationAttempts: 1 };
          }
          if (!invocation.ok) {
            await recordInvocationResult({
              outcome: "rejected",
              resultHash: canonicalJsonHash({ outcome: "rejected", failureCode: invocation.code }),
              failureCode: invocation.code,
              evidenceRefs: [],
            });
            return { status: "failed" as const, detail: invocation.code };
          }
          const output = invocation.output as Record<string, unknown>;
          outputs.set(node.id, output);
          const evidence = output.evidence;
          if (
            params.recipeId === "runtime.start"
            && runtimeStartD1Decision?.transitionEligible === true
            && episode
            && gateCAction
          ) {
            const evidenceRecord = evidence
              && typeof evidence === "object"
              && !Array.isArray(evidence)
              ? evidence as Record<string, unknown>
              : undefined;
            const environmentRevision = typeof evidenceRecord?.environmentRevision === "string"
              ? evidenceRecord.environmentRevision
              : null;
            const afterValue = runtimeStartAfterObservationValue(
              evidenceRecord?.afterState,
              params.projectId,
              params.sourceRevision,
              environmentRevision,
            );
            if (afterValue) {
              const afterEvidenceRef = `runtime-start:${claimed.id}:${claimed.attempt}:${gateCAction.actionId}:after`;
              const childProcessObservation = runtimeChildProcessObservationSource({
                projectId: params.projectId,
                executionId: claimed.id,
                attempt: claimed.attempt,
                episodeId: episode.episodeId,
                operationId: params.operationId,
                sessionId: evidenceRecord?.sessionId,
                revision: params.sourceRevision,
                environmentRevision,
                afterState: evidenceRecord?.afterState,
              });
              try {
                const after = await materializeServerOwnedObservations({
                  projectId: params.projectId,
                  executionId: claimed.id,
                  attempt: claimed.attempt,
                  episodeId: episode.episodeId,
                  environmentRootPath: executionRoot,
                  projectRevision: params.sourceRevision,
                  materializeWorldState: false,
                  sources: [{
                    kind: "direct_observation",
                    sourceId: `${afterEvidenceRef}:runtime.after_state`,
                    sourceRevision: params.sourceRevision,
                    subject: `runtime:${params.projectId}`,
                    predicate: "runtime.after_state",
                    value: afterValue,
                    evidenceRefs: [
                      afterEvidenceRef,
                      ...(typeof evidenceRecord?.evidenceId === "string"
                        ? [evidenceRecord.evidenceId]
                        : []),
                    ],
                    observedAt: String((afterValue as Record<string, unknown>).observedAt),
                  }, ...(childProcessObservation ? [childProcessObservation] : [])],
                });
                runtimeStartAfterObservationIds = after.observationIds;
                runtimeStartChildProcessObservationRetained = Boolean(childProcessObservation);
              } catch (error) {
                logger.warn(
                  {
                    scope: "recipe-operation",
                    code: "runtime_start_after_observation_failed",
                    executionId: claimed.id,
                    attempt: claimed.attempt,
                    episodeId: episode.episodeId,
                    actionId: gateCAction.actionId,
                    error,
                  },
                  "Runtime start after-state evidence could not be retained",
                );
              }
            }
          }
          const hasVerifiedReceipt = Boolean(
            evidence
            && typeof evidence === "object"
            && !Array.isArray(evidence)
            && typeof (evidence as { evidenceId?: unknown }).evidenceId === "string",
          );
          if (recipeGateCEffectKind && episode && gateCAction && gateCEffectContract && gateCBeforeObservationIds) {
            const identity = gateCEffectIdentity({
              kind: recipeGateCEffectKind,
              operationId: params.operationId,
            });
            const afterEvidenceRef = `gate-c:${claimed.id}:${claimed.attempt}:after`;
            const isRuntimeGateC = recipeGateCEffectKind === "runtime"
              || recipeGateCEffectKind === "runtime-restart"
              || recipeGateCEffectKind === "runtime-stop";
            const runtimeAfterObservation = isRuntimeGateC
              ? buildRuntimeGateCAfterObservation({
                  recipeId: params.recipeId,
                  projectId: params.projectId,
                  sourceRevision: params.sourceRevision,
                  evidence,
                })
              : undefined;
            const expectedProfileName = gateCAction.capabilityId.startsWith("browser.verify.")
              ? gateCAction.capabilityId.slice("browser.verify.".length)
              : "default";
            const browserAfterObservation = recipeGateCEffectKind === "browser"
              ? buildBrowserGateCAfterObservation({
                  projectId: params.projectId,
                  operationId: params.operationId,
                  executionId: claimed.id,
                  executionAttempt: claimed.attempt,
                  sourceRevision: params.sourceRevision,
                  expectedProfileName,
                  output,
                })
              : undefined;
            const deliveryAfterObservation = recipeGateCEffectKind === "delivery"
              ? buildDeliveryGateCAfterObservation({
                  projectId: params.projectId,
                  operationId: params.operationId,
                  executionId: claimed.id,
                  executionAttempt: claimed.attempt,
                  sourceRevision: params.sourceRevision,
                  output,
                })
              : undefined;
            const gateCAfterObservation = runtimeAfterObservation
              ?? browserAfterObservation
              ?? deliveryAfterObservation;
            const afterStatus = gateCAfterObservation?.effectValue ?? "failed";
            const statePredicate = isRuntimeGateC
              ? "runtime.after_state"
              : recipeGateCEffectKind === "browser"
                ? "browser.after_state"
                : "delivery.after_state";
            const stateSubject = isRuntimeGateC && runtimeAfterObservation
              ? `runtime:${runtimeAfterObservation.sessionId}`
              : identity.subject;
            const passedRuntimeStartObservation = params.recipeId === "runtime.start"
              && gateCAfterObservation?.effectValue === "passed"
              ? gateCAfterObservation
              : undefined;
            const afterSources = gateCAfterObservation
              ? [
                  {
                    kind: "direct_observation" as const,
                    sourceId: `${afterEvidenceRef}:${identity.subject}:${identity.predicate}`,
                    sourceRevision: params.sourceRevision,
                    subject: identity.subject,
                    predicate: identity.predicate,
                    value: afterStatus,
                    evidenceRefs: [afterEvidenceRef, ...gateCAfterObservation.sourceRefs],
                    observedAt: gateCAfterObservation.observedAt,
                  },
                  {
                    kind: "direct_observation" as const,
                    sourceId: `${afterEvidenceRef}:${statePredicate}`,
                    sourceRevision: params.sourceRevision,
                    subject: stateSubject,
                    predicate: statePredicate,
                    value: gateCAfterObservation.facts,
                    evidenceRefs: [afterEvidenceRef, ...gateCAfterObservation.sourceRefs],
                    observedAt: gateCAfterObservation.observedAt,
                  },
                  ...(passedRuntimeStartObservation
                    ? [{
                        kind: "direct_observation" as const,
                        sourceId: `${afterEvidenceRef}:runtime.status`,
                        sourceRevision: params.sourceRevision,
                        subject: `runtime:${params.projectId}`,
                        predicate: "runtime.status",
                        value: "running" as JsonValue,
                        evidenceRefs: [afterEvidenceRef, ...passedRuntimeStartObservation.sourceRefs],
                        observedAt: passedRuntimeStartObservation.observedAt,
                      }]
                    : []),
                ]
              : [];
            const after = afterSources.length > 0
              ? await materializeServerOwnedObservations({
                  projectId: params.projectId,
                  executionId: claimed.id,
                  attempt: claimed.attempt,
                  episodeId: episode.episodeId,
                  environmentRootPath: executionRoot,
                  projectRevision: params.sourceRevision,
                  materializeWorldState: false,
                  sources: afterSources,
                })
              : undefined;
            const afterObservationIds = after?.observationIds ?? [];
            await appendEpisodeEvent({
              episodeId: episode.episodeId,
              projectId: params.projectId,
              executionId: claimed.id,
              attempt: claimed.attempt,
              workerId,
              eventType: "ACTION_COMMITTED",
              payload: {
                actionId: gateCAction.actionId,
                capabilityId: gateCAction.capabilityId,
                status: afterStatus,
              },
              actorType: "worker",
              actorId: workerId,
              correlationId: claimed.id,
              actionRefs: [gateCAction.actionId],
              observationRefs: afterObservationIds,
              evidenceRefs: gateCAfterObservation
                ? [afterEvidenceRef, ...gateCAfterObservation.sourceRefs]
                : [],
            });
            if (params.recipeId === "runtime.start" && runtimeStartHypothesisRegistration) {
              try {
                const registration = runtimeStartHypothesisRegistration;
                let observationRefs: string[] = [];
                let measurementValidity:
                  | "complete_fresh"
                  | "partial"
                  | "stale"
                  | "failed"
                  | "unknown" = "unknown";
                let environmentStatus: "same_scope" | "changed" | "unknown" = "unknown";
                let actualOutcomeKey:
                  | "runtime_running"
                  | "runtime_not_running"
                  | "runtime_other"
                  | "runtime_unexpected"
                  | undefined;
                let resolvedAt = new Date().toISOString();
                const evidenceRecord = evidence
                  && typeof evidence === "object"
                  && !Array.isArray(evidence)
                  ? evidence as Record<string, unknown>
                  : undefined;

                if (passedRuntimeStartObservation && after) {
                  const evidenceEnvironmentRevision = evidenceRecord?.environmentRevision;
                  environmentStatus = evidenceEnvironmentRevision === registration.environmentRevision
                    ? "same_scope"
                    : typeof evidenceEnvironmentRevision === "string"
                      ? "changed"
                      : "unknown";
                  const observations = afterObservationIds.length > 0
                    ? await db.select({
                        id: aiAgentObservationsTable.id,
                        predicate: aiAgentObservationsTable.predicate,
                        freshness: aiAgentObservationsTable.freshness,
                        environmentFreshness: aiAgentObservationsTable.environmentFreshness,
                      }).from(aiAgentObservationsTable)
                        .where(inArray(aiAgentObservationsTable.id, afterObservationIds))
                    : [];
                  const statusObservations = observations.filter(
                    (observation) => observation.predicate === "runtime.status",
                  );
                  observationRefs = statusObservations.map(({ id }) => id);
                  resolvedAt = passedRuntimeStartObservation.observedAt;
                  if (
                    environmentStatus === "same_scope"
                    && statusObservations.length > 0
                    && statusObservations.every((observation) =>
                      observation.freshness === "fresh"
                      && observation.environmentFreshness === "fresh")
                    && after.stale === 0
                    && after.environmentStale === 0
                  ) {
                    measurementValidity = "complete_fresh";
                    actualOutcomeKey = "runtime_running";
                  } else {
                    measurementValidity = environmentStatus === "changed"
                      || statusObservations.some((observation) =>
                        observation.freshness === "stale"
                        || observation.environmentFreshness === "stale")
                      ? "stale"
                      : "unknown";
                  }
                } else {
                  const probeRecord = evidenceRecord?.hypothesisProbe
                    && typeof evidenceRecord.hypothesisProbe === "object"
                    && !Array.isArray(evidenceRecord.hypothesisProbe)
                    ? evidenceRecord.hypothesisProbe as Record<string, unknown>
                    : undefined;
                  const beforeEnvironmentRevision = probeRecord?.environmentRevisionBefore;
                  const afterEnvironmentRevision = probeRecord?.environmentRevisionAfter;
                  environmentStatus = beforeEnvironmentRevision === registration.environmentRevision
                    && afterEnvironmentRevision === registration.environmentRevision
                    ? "same_scope"
                    : typeof afterEnvironmentRevision === "string"
                      ? "changed"
                      : "unknown";
                  const validProbe = probeRecord?.experimentId === registration.experimentId
                    ? runtimeStartHypothesisProbeValue(
                        probeRecord.state,
                        params.projectId,
                        params.sourceRevision,
                        registration.environmentRevision,
                        typeof afterEnvironmentRevision === "string"
                          ? afterEnvironmentRevision
                          : null,
                      )
                    : undefined;
                  if (validProbe && environmentStatus === "same_scope") {
                    const value = validProbe.outcomeKey === "runtime_running"
                      ? "running"
                      : "stopped";
                    try {
                      const probeMaterialization = await materializeServerOwnedObservations({
                        projectId: params.projectId,
                        executionId: claimed.id,
                        attempt: claimed.attempt,
                        episodeId: episode.episodeId,
                        environmentRootPath: executionRoot,
                        projectRevision: params.sourceRevision,
                        materializeWorldState: false,
                        sources: [{
                          kind: "direct_observation",
                          sourceId: `${registration.experimentId}:runtime.status`,
                          sourceRevision: params.sourceRevision,
                          environmentRevision: registration.environmentRevision,
                          subject: `runtime:${params.projectId}`,
                          predicate: "runtime.status",
                          value,
                          evidenceRefs: [registration.experimentId],
                          observedAt: validProbe.observedAt,
                        }],
                      });
                      observationRefs = probeMaterialization.observationIds;
                      resolvedAt = validProbe.observedAt;
                      if (
                        probeMaterialization.observationIds.length > 0
                        && probeMaterialization.stale === 0
                        && probeMaterialization.environmentStale === 0
                      ) {
                        measurementValidity = "complete_fresh";
                        actualOutcomeKey = validProbe.outcomeKey;
                      } else {
                        measurementValidity = "stale";
                      }
                    } catch (error) {
                      measurementValidity = "failed";
                      logger.warn(
                        {
                          scope: "recipe-operation",
                          code: "runtime_start_hypothesis_probe_materialization_failed",
                          executionId: claimed.id,
                          attempt: claimed.attempt,
                          episodeId: episode.episodeId,
                          experimentId: registration.experimentId,
                          error,
                        },
                        "P7.5 runtime status evidence could not be retained",
                      );
                    }
                  } else if (environmentStatus === "changed") {
                    measurementValidity = "stale";
                  } else if (probeRecord?.state === null) {
                    measurementValidity = "failed";
                  } else if (probeRecord?.state !== undefined) {
                    measurementValidity = "partial";
                  }
                  if (probeRecord?.state && typeof probeRecord.state === "object") {
                    const probeState = probeRecord.state as Record<string, unknown>;
                    if (typeof probeState.observedAt === "string"
                      && Number.isFinite(Date.parse(probeState.observedAt))) {
                      resolvedAt = new Date(probeState.observedAt).toISOString();
                    }
                  }
                }

                const experimentResult = buildRuntimeStartHypothesisExperimentResult({
                  registration,
                  observationRefs,
                  measurementValidity,
                  environmentStatus,
                  ...(actualOutcomeKey ? { actualOutcomeKey } : {}),
                  resolvedAt,
                });
                const priorResults = await db.select({
                  payload: aiAgentEpisodeEventsTable.payload,
                }).from(aiAgentEpisodeEventsTable)
                  .where(and(
                    eq(aiAgentEpisodeEventsTable.episodeId, episode.episodeId),
                    eq(aiAgentEpisodeEventsTable.eventType, "OBSERVATION_RECORDED"),
                  ));
                const priorResult = priorResults.find(({ payload }) => (
                  payload
                  && typeof payload === "object"
                  && !Array.isArray(payload)
                  && (payload as Record<string, unknown>).recordKind
                    === "P75_HYPOTHESIS_EXPERIMENT_RESULT"
                  && (payload as Record<string, unknown>).experimentId
                    === registration.experimentId
                ));
                if (priorResult) {
                  const parsedPriorResult = parseRuntimeStartHypothesisExperimentResult(
                    priorResult.payload,
                  );
                  if (parsedPriorResult.resultId !== experimentResult.resultId) {
                    throw new Error("A different result is already recorded for this runtime-start experiment.");
                  }
                } else {
                  await appendEpisodeEvent({
                    episodeId: episode.episodeId,
                    projectId: params.projectId,
                    executionId: claimed.id,
                    attempt: claimed.attempt,
                    workerId,
                    eventType: "OBSERVATION_RECORDED",
                    payload: experimentResult as unknown as JsonValue,
                    actorType: "server",
                    actorId: workerId,
                    correlationId: claimed.id,
                    observationRefs,
                  });
                }
                try {
                  const calibrationAssessment = evaluateRuntimeStartHypothesisCalibration({
                    calibrationScopeRef: registration.calibrationScopeRef,
                    experiments: await loadRuntimeStartCalibrationExperiments(
                      params.projectId,
                      registration.calibrationScopeRef,
                    ),
                  });
                  await appendEpisodeEvent({
                    episodeId: episode.episodeId,
                    projectId: params.projectId,
                    executionId: claimed.id,
                    attempt: claimed.attempt,
                    workerId,
                    eventType: "OBSERVATION_RECORDED",
                    payload: calibrationAssessment as unknown as JsonValue,
                    actorType: "server",
                    actorId: workerId,
                    correlationId: claimed.id,
                  });
                } catch (error) {
                  logger.warn(
                    {
                      scope: "recipe-operation",
                      code: "runtime_start_calibration_assessment_failed",
                      executionId: claimed.id,
                      attempt: claimed.attempt,
                      episodeId: episode.episodeId,
                      experimentId: registration.experimentId,
                      error,
                    },
                    "P7.5 calibration assessment remains unavailable; fixed-safe selection is unchanged",
                  );
                }
              } catch (error) {
                logger.warn(
                  {
                    scope: "recipe-operation",
                    code: "runtime_start_hypothesis_result_failed",
                    executionId: claimed.id,
                    attempt: claimed.attempt,
                    episodeId: episode.episodeId,
                    experimentId: runtimeStartHypothesisRegistration.experimentId,
                    error,
                  },
                  "P7.5 result could not be recorded; Gate C remains authoritative",
                );
              }
            }
            if (gateCBeforeObservationIds.length === 0 || afterObservationIds.length === 0) {
              return {
                status: "failed" as const,
                detail: "Gate C effect is missing a verified before-state or after-state.",
                validationAttempts: 1,
              };
            }
            const effect = await verifyAndPersistEffect({
              projectId: params.projectId,
              executionId: claimed.id,
              attempt: claimed.attempt,
              episodeId: episode.episodeId,
              workerId,
              action: gateCAction,
              effectContract: gateCEffectContract,
              beforeObservationIds: gateCBeforeObservationIds,
              afterObservationIds,
            });
            if (effect.status !== "observed") {
              return {
                status: "failed" as const,
                detail: `Gate C effect was ${effect.status}.`,
                validationAttempts: 1,
              };
            }
            gateCEffectBundleId = effect.effectBundleId;
            if (
              params.recipeId === "runtime.start"
              && runtimeStartD1Decision?.transitionEligible === true
              && runtimeStartBeforeObservationIds.length > 0
            ) {
              const evidenceRecord = evidence
                && typeof evidence === "object"
                && !Array.isArray(evidence)
                ? evidence as Record<string, unknown>
                : undefined;
              try {
                await createPendingRuntimeStartTransition({
                  projectId: params.projectId,
                  executionId: claimed.id,
                  attempt: claimed.attempt,
                  episodeId: episode.episodeId,
                  actionId: gateCAction.actionId,
                  effectBundleId: effect.effectBundleId,
                  workerId,
                  parentWorldRevision: runtimeStartD1Decision.parentWorldRevision ?? "unavailable",
                  parentFactRefs: runtimeStartParentWorldState?.currentFacts.map((fact) => fact.id) ?? [],
                  beforeObservationIds: runtimeStartBeforeObservationIds,
                  afterObservationIds: [...afterObservationIds, ...runtimeStartAfterObservationIds],
                  evidenceRefs: [
                    `runtime-start:${claimed.id}:${claimed.attempt}:${gateCAction.actionId}:before`,
                    afterEvidenceRef,
                    ...(runtimeAfterObservation?.sourceRefs ?? []),
                  ],
                  environmentRevision: typeof evidenceRecord?.environmentRevision === "string"
                    ? evidenceRecord.environmentRevision
                    : null,
                });
                runtimeStartTransitionQueued = true;
              } catch (error) {
                logger.warn(
                  {
                    scope: "recipe-operation",
                    code: "runtime_start_transition_pending_write_failed",
                    executionId: claimed.id,
                    attempt: claimed.attempt,
                    episodeId: episode.episodeId,
                    actionId: gateCAction.actionId,
                    error,
                  },
                  "Runtime start transition could not be queued without changing Gate C effect evidence",
                );
              }
            }
          }
          const passed = output.status === "passed" && hasVerifiedReceipt;
          const invocationEvidenceRefs = evidence
            && typeof evidence === "object"
            && !Array.isArray(evidence)
            && typeof (evidence as { evidenceId?: unknown }).evidenceId === "string"
            ? [(evidence as { evidenceId: string }).evidenceId]
            : [];
          const outputHash = hashJsonValue(output);
          const invocationResultRecorded = await recordInvocationResult({
            outcome: passed ? "completed" : "failed",
            ...(outputHash ? { resultHash: outputHash } : {}),
            ...(typeof output.status === "string" ? { capabilityStatus: output.status } : {}),
            ...(!passed
              ? {
                  failureCode: output.status === "passed"
                    ? "VERIFIED_EVIDENCE_MISSING"
                    : "CAPABILITY_RESULT_NOT_PASSED",
                }
              : {}),
            evidenceRefs: invocationEvidenceRefs,
          });
          if (tracksThisInvocation && !invocationResultRecorded) {
            outputs.delete(node.id);
            return {
              status: "blocked" as const,
              detail: "Read-only recipe result provenance could not be recorded.",
              validationAttempts: 1,
            };
          }
          return {
            status: passed ? "passed" as const : "failed" as const,
            detail: JSON.stringify(output).slice(0, prepared.binding.missionBudget.maxOutputBytes),
            validationAttempts: 1,
          };
        } finally {
          clearTimeout(nodeTimer);
          overallController.signal.removeEventListener("abort", abortFromOverall);
          context.signal?.removeEventListener("abort", abortFromOverall);
        }
      },
      onChange: ({ nodes }) => {
        latestNodes = nodes;
        const externalEffect = externalEffectForNodes(nodes, params.operationId);
        const liveBinding = {
          ...prepared.binding,
          phase: "running" as const,
          leaseOwner: workerId,
          leaseUntil: new Date(Date.now() + 300_000).toISOString(),
        };
        void checkpointAiExecution({
          executionId: claimed.id,
          expectedAttempt: claimed.attempt,
          workerId,
          recipeBinding: liveBinding,
          checkpoint: {
            stage: "running",
            sequence: ++checkpointSequence,
            ...(checkpoint?.operation ? { operation: { ...checkpoint.operation, binding: liveBinding } } : {}),
            recipeBinding: liveBinding,
            ...(externalEffect ? { externalEffect } : {}),
            nodeStates: nodes.map((node) => ({
              ...node,
              evidenceRefs: node.status === "passed"
                ? [receiptIdForEvidence({ status: node.status, outputs: outputs.get(node.id) })]
                  .filter((id): id is string => typeof id === "string")
                : [],
            })),
            completedNodes: nodes.filter((node) => node.status === "passed").map((node) => node.id),
            updatedAt: new Date().toISOString(),
          },
        }).then(async (ok) => {
          if (ok) return;
          const stillOwnsLease = await ownsAiExecutionLease({
            executionId: claimed.id,
            workerId,
          });
          if (!stillOwnsLease) overallController.abort();
        }).catch(() => overallController.abort());
      },
    });
    if (result.status !== "passed" || overallController.signal.aborted) {
      await closeReadOnlyInvocationEpisode(
        overallController.signal.aborted ? "cancelled" : "blocked",
        overallController.signal.aborted ? "RECIPE_EXECUTION_CANCELLED" : "RECIPE_NODE_EXECUTION_FAILED",
      );
      if (candidateValidation && episode && candidateValidationAction) {
        await appendEpisodeEvent({
          episodeId: episode.episodeId,
          projectId: params.projectId,
          executionId: claimed.id,
          attempt: claimed.attempt,
          workerId,
          eventType: "ACTION_COMMITTED",
          payload: {
            actionId: candidateValidationAction.actionId,
            capabilityId: candidateValidationAction.capabilityId,
            status: "failed",
            reason: overallController.signal.aborted ? "deadline" : "node_failed",
          },
          actorType: "worker",
          actorId: workerId,
          correlationId: claimed.id,
        });
      }
      await failAiExecution({
        executionId: claimed.id,
        workerId,
        error: overallController.signal.aborted ? "Recipe execution exceeded its overall deadline." : "Recipe node execution was blocked.",
        nodeStates: result.nodes.map((node) => ({
          ...node,
          evidenceRefs: node.status === "passed"
            ? [receiptIdForEvidence({ status: node.status, outputs: outputs.get(node.id) })]
              .filter((id): id is string => typeof id === "string")
            : [],
        })),
        recipeBinding: { ...prepared.binding, phase: "running", leaseOwner: workerId, leaseUntil: new Date(Date.now() + 300_000).toISOString() },
      });
      const receipt = buildRecipeReceipt(params, claimed.id, claimed.attempt, "blocked", result.nodes, outputs, result.completedNodeIds);
      return { executionId: claimed.id, status: "blocked", completedNodeIds: result.completedNodeIds, receipt };
    }

    const evidence = evidenceForNodes(result.nodes, outputs);
    const advanced = advanceRecipeToTerminal(prepared.plan, evidence, overallController.signal);
    const outcome = prepared.plan.outcomeContract
      ? evaluateRecipeEvidencePredicate(prepared.plan.outcomeContract.success, evidence)
      : false;
    if (advanced.status !== "succeeded" || outcome !== true) {
      await closeReadOnlyInvocationEpisode("blocked", "RECIPE_OUTCOME_CONTRACT_FAILED");
      await failAiExecution({
        executionId: claimed.id,
        workerId,
        error: "Recipe outcome contract was not satisfied.",
        nodeStates: result.nodes.map((node) => ({ ...node, evidenceRefs: [] })),
        recipeBinding: { ...prepared.binding, phase: "running", leaseOwner: workerId, leaseUntil: new Date(Date.now() + 300_000).toISOString() },
      });
      const receipt = buildRecipeReceipt(params, claimed.id, claimed.attempt, "blocked", result.nodes, outputs, result.completedNodeIds);
      return { executionId: claimed.id, status: "blocked", completedNodeIds: result.completedNodeIds, receipt };
    }
    const evidenceRefs = Object.values(evidence)
      .map(receiptIdForEvidence)
      .filter((id): id is string => typeof id === "string");
    const completionEvidence = Object.values(evidence)
      .map((entry) => entry.outputs?.evidence)
      .filter((value): value is {
        evidenceId: string;
        artifactRef: string;
        operationId: string;
        projectRevision: string;
        candidateHash: string;
        environmentRevision?: string | null;
        validatorProfile?: string;
        childProcessAttestation?: {
          status: "known" | "mismatch" | "unknown";
          reasonCode: string;
          bindingDigest: string | null;
          attestationDigest: string | null;
          processEnvironmentDigest: string | null;
          observedAt: string;
        };
        validatorProcessTreeAttestation?: {
          status: "known" | "mismatch" | "unknown";
          reasonCode: string;
          bindingDigest: string | null;
          treeDigest: string | null;
          treeDigestVersion: "validator-process-tree-v1";
          processEnvironmentDigest: string | null;
          visibleProcessCount: number | null;
          sampledProcessCount: number | null;
          observedAt: string;
        };
      } => Boolean(
        value
        && typeof value === "object"
        && !Array.isArray(value)
        && typeof (value as { evidenceId?: unknown }).evidenceId === "string"
        && typeof (value as { artifactRef?: unknown }).artifactRef === "string"
        && typeof (value as { operationId?: unknown }).operationId === "string"
        && typeof (value as { projectRevision?: unknown }).projectRevision === "string"
        && typeof (value as { candidateHash?: unknown }).candidateHash === "string"
        && (
          (value as { environmentRevision?: unknown }).environmentRevision === undefined
          || (value as { environmentRevision?: unknown }).environmentRevision === null
          || typeof (value as { environmentRevision?: unknown }).environmentRevision === "string"
        ),
      ));
    const validatorProcessObservations = episode
      ? completionEvidence.flatMap((evidence) => {
          const attestation = evidence.childProcessAttestation;
          const treeAttestation = evidence.validatorProcessTreeAttestation;
          if (!evidence.validatorProfile) return [];
          return [
            ...(attestation
              && typeof attestation.bindingDigest === "string"
              && typeof attestation.observedAt === "string"
              ? [{
                  kind: "validator_process_attestation" as const,
                  projectId: params.projectId,
                  executionId: claimed.id,
                  attempt: claimed.attempt,
                  episodeId: episode.episodeId,
                  operationId: params.operationId,
                  sessionId: evidence.evidenceId,
                  validatorProfile: evidence.validatorProfile,
                  revision: params.sourceRevision,
                  status: attestation.status,
                  reasonCode: attestation.reasonCode as import("./agent-state/child-process-attestation.js").ChildProcessEnvironmentAttestation["reasonCode"],
                  bindingDigest: attestation.bindingDigest,
                  attestationDigest: attestation.attestationDigest,
                  processEnvironmentDigest: attestation.processEnvironmentDigest,
                  environmentRevision: evidence.environmentRevision ?? null,
                  observedAt: attestation.observedAt,
                }]
              : []),
            ...(treeAttestation
              && typeof treeAttestation.bindingDigest === "string"
              && typeof treeAttestation.observedAt === "string"
              ? [{
                  kind: "validator_process_tree_attestation" as const,
                  projectId: params.projectId,
                  executionId: claimed.id,
                  attempt: claimed.attempt,
                  episodeId: episode.episodeId,
                  operationId: params.operationId,
                  sessionId: evidence.evidenceId,
                  validatorProfile: evidence.validatorProfile,
                  revision: params.sourceRevision,
                  status: treeAttestation.status,
                  reasonCode: treeAttestation.reasonCode as import("@workspace/ai-orchestrator").ValidationProcessTreeAttestation["reasonCode"],
                  bindingDigest: treeAttestation.bindingDigest,
                  treeDigest: treeAttestation.treeDigest,
                  treeDigestVersion: treeAttestation.treeDigestVersion,
                  processEnvironmentDigest: treeAttestation.processEnvironmentDigest,
                  visibleProcessCount: treeAttestation.visibleProcessCount,
                  sampledProcessCount: treeAttestation.sampledProcessCount,
                  environmentRevision: evidence.environmentRevision ?? null,
                  observedAt: treeAttestation.observedAt,
                }]
              : []),
          ];
        })
      : [];
    let candidateValidationProcessObservationIds: string[] = [];
    if (evidenceRefs.length !== result.nodes.length) {
      await closeReadOnlyInvocationEpisode("blocked", "RECIPE_EVIDENCE_INCOMPLETE");
      await failAiExecution({
        executionId: claimed.id,
        workerId,
        error: "Recipe completed without a verified evidence receipt for every node.",
        nodeStates: result.nodes.map((node) => ({ ...node, evidenceRefs: [] })),
        recipeBinding: { ...prepared.binding, phase: "running", leaseOwner: workerId, leaseUntil: new Date(Date.now() + 300_000).toISOString() },
      });
      const receipt = buildRecipeReceipt(params, claimed.id, claimed.attempt, "blocked", result.nodes, outputs, result.completedNodeIds);
      return { executionId: claimed.id, status: "blocked", completedNodeIds: result.completedNodeIds, receipt };
    }
    const completedReceipt = buildRecipeReceipt(params, claimed.id, claimed.attempt, "completed", result.nodes, outputs, result.completedNodeIds);
    let taskObjective;
    try {
      taskObjective = parseTaskObjectiveContract(
        (JSON.parse(claimed.request) as { taskObjective?: unknown }).taskObjective,
      );
    } catch {
      taskObjective = undefined;
    }
    const validatorEvidence = completionEvidence[0];
    const validatorReceipts: TaskObjectiveValidatorReceipt[] = taskObjective && validatorEvidence
      ? taskObjective.validatorIds.map((validatorId) => {
          const evidence = validatorEvidence;
          return {
            validatorId,
            status: "PROVEN" as const,
            operationId: evidence.operationId,
            projectId: params.projectId,
            workspaceRevision: evidence.projectRevision,
            artifactRef: evidence.artifactRef,
            environmentRevision: typeof evidence.environmentRevision === "string"
              ? evidence.environmentRevision
              : null,
          };
        })
      : [];
    let candidateEffectBundleId: string | undefined;
    if (
      candidateValidation
      && episode
      && candidateValidationAction
      && candidateValidationEffectContract
      && candidateValidationBeforeObservationIds
      && params.candidateIdentity
    ) {
      await appendEpisodeEvent({
        episodeId: episode.episodeId,
        projectId: params.projectId,
        executionId: claimed.id,
        attempt: claimed.attempt,
        workerId,
        eventType: "ACTION_COMMITTED",
        payload: {
          actionId: candidateValidationAction.actionId,
          capabilityId: candidateValidationAction.capabilityId,
          status: "completed",
        },
        actorType: "worker",
        actorId: workerId,
        correlationId: claimed.id,
      });
      let validatorObservationAccepted = false;
      const validationEvidence = [...new Map(
        completionEvidence
          .filter((evidence) => typeof evidence.validatorProfile === "string")
          .map((evidence) => [
            `${evidence.evidenceId}:${evidence.validatorProfile}`,
            evidence,
          ]),
      ).values()];
      const processAttestations = validatorProcessObservations.filter(
        (observation) => observation.kind === "validator_process_attestation",
      );
      const expectedAttestationsMatch = validationEvidence.length > 0
        && processAttestations.length === validationEvidence.length
        && validationEvidence.every((evidence) => processAttestations.some((observation) => (
          observation.sessionId === evidence.evidenceId
          && observation.validatorProfile === evidence.validatorProfile
          && observation.status === "known"
          && observation.projectId === params.projectId
          && observation.executionId === claimed.id
          && observation.attempt === claimed.attempt
          && observation.episodeId === episode.episodeId
          && observation.operationId === params.operationId
          && observation.revision === params.sourceRevision
          && Number.isFinite(Date.parse(observation.observedAt))
          && Date.parse(observation.observedAt) >= (candidateValidationRequestedAt ?? Number.MAX_SAFE_INTEGER)
          && Date.parse(observation.observedAt) <= Date.now()
        )));
      const contradictoryTreeAttestation = validatorProcessObservations.some(
        (observation) => observation.kind === "validator_process_tree_attestation"
          && observation.status === "mismatch",
      );
      if (validatorProcessObservations.length > 0) {
        try {
          const materializedValidatorObservations = await materializeServerOwnedObservations({
            projectId: params.projectId,
            executionId: claimed.id,
            attempt: claimed.attempt,
            episodeId: episode.episodeId,
            workerLease: { workerId },
            projectRevision: params.sourceRevision,
            materializeWorldState: false,
            sources: validatorProcessObservations,
          });
          candidateValidationProcessObservationIds = materializedValidatorObservations.observationIds;
          validatorObservationAccepted = expectedAttestationsMatch
            && !contradictoryTreeAttestation
            && materializedValidatorObservations.observationIds.length
              === validatorProcessObservations.length
            && materializedValidatorObservations.stale === 0
            && materializedValidatorObservations.environmentStale === 0;
        } catch (error) {
          logger.warn(
            {
              scope: "recipe-operation",
              code: "candidate_validation_process_observation_unavailable",
              executionId: claimed.id,
              attempt: claimed.attempt,
              episodeId: episode.episodeId,
              error,
            },
            "Candidate validation process observation could not be materialized",
          );
        }
      }
      if (!validatorObservationAccepted) {
        const blockedReceipt = buildRecipeReceipt(
          params,
          claimed.id,
          claimed.attempt,
          "blocked",
          result.nodes,
          outputs,
          result.completedNodeIds,
        );
        await failAiExecution({
          executionId: claimed.id,
          workerId,
          error: "Candidate validator process evidence is missing, stale, or contradictory.",
          nodeStates: result.nodes.map((node) => ({
            ...node,
            evidenceRefs: node.status === "passed"
              ? [receiptIdForEvidence({ status: node.status, outputs: outputs.get(node.id) })]
                .filter((id): id is string => typeof id === "string")
              : [],
          })),
          recipeBinding: runningRecipeBinding,
        });
        return {
          executionId: claimed.id,
          status: "blocked",
          completedNodeIds: result.completedNodeIds,
          receipt: blockedReceipt,
        };
      }
      const afterTreeHash = await hashDeliveryTree(executionRoot);
      const afterEvidenceRef = `candidate-validation:${claimed.id}:${claimed.attempt}:after`;
      const after = await materializeServerOwnedObservations({
        projectId: params.projectId,
        executionId: claimed.id,
        attempt: claimed.attempt,
        episodeId: episode.episodeId,
        environmentRootPath: executionRoot,
        projectRevision: params.sourceRevision,
        materializeWorldState: false,
        sources: [
          {
            kind: "direct_observation",
            sourceId: `${afterEvidenceRef}:workspace`,
            sourceRevision: params.sourceRevision,
            subject: `candidate:${params.candidateIdentity}`,
            predicate: "workspace.tree_hash",
            value: afterTreeHash,
            evidenceRefs: [afterEvidenceRef],
          },
          {
            kind: "direct_observation",
            sourceId: `${afterEvidenceRef}:status`,
            sourceRevision: params.sourceRevision,
            subject: `candidate:${params.candidateIdentity}`,
            predicate: "validation.status",
            value: "passed",
            evidenceRefs: [afterEvidenceRef],
          },
        ],
      });
      const effect = await verifyAndPersistEffect({
        projectId: params.projectId,
        executionId: claimed.id,
        attempt: claimed.attempt,
        episodeId: episode.episodeId,
        workerId,
        action: candidateValidationAction,
        effectContract: candidateValidationEffectContract,
        beforeObservationIds: candidateValidationBeforeObservationIds,
        afterObservationIds: [
          ...after.observationIds,
          ...candidateValidationProcessObservationIds,
        ],
      });
      if (effect.status !== "observed") {
        throw new Error(`candidate_validation_effect_${effect.status}`);
      }
      candidateEffectBundleId = effect.effectBundleId;
    }
    const terminalEffectBundleId = candidateEffectBundleId ?? gateCEffectBundleId;
    await closeReadOnlyInvocationEpisode("achieved", "READ_ONLY_INVOCATIONS_RECORDED");
    const completed = await completeAiExecution({
      executionId: claimed.id,
      workerId,
      finalMessageId: `recipe-receipt:${params.operationId}`,
      evidenceVerdict: "PROVEN",
      evidenceRefs,
      evidence: completionEvidence,
      operationId: params.operationId,
      candidateIdentity: params.candidateIdentity ?? null,
      ...(taskObjective
        ? {
            taskObjective,
            validatorReceipts,
            objectiveValidated: true,
          }
        : {}),
      recipeBinding: { ...prepared.binding, phase: "running", leaseOwner: workerId, leaseUntil: new Date(Date.now() + 300_000).toISOString() },
      nodeStates: result.nodes.map((node) => ({
        id: node.id,
        title: node.title,
        kind: "inspect" as const,
        dependencies: node.dependencies,
        status: node.status,
        attempts: node.attempts,
        validationAttempts: node.validationAttempts,
        allowedFiles: node.allowedFiles,
        validationProfile: node.validationProfile,
        evidenceRefs: evidence[node.id] ? [receiptIdForEvidence(evidence[node.id])]
          .filter((id): id is string => typeof id === "string") : [],
      })),
      recipeReceipt: completedReceipt,
      ...(terminalEffectBundleId
        ? { effectRequired: true, effectBundleId: terminalEffectBundleId }
        : {}),
    });
    if (!completed) {
      const cancelledReceipt = buildRecipeReceipt(
        params,
        claimed.id,
        claimed.attempt,
        "cancelled",
        result.nodes,
        outputs,
        result.completedNodeIds,
      );
      const cancelled = await failAiExecution({
        executionId: claimed.id,
        workerId,
        cancelled: true,
        error: "Recipe execution was cancelled before terminal acceptance.",
        nodeStates: result.nodes.map((node) => ({
          id: node.id,
          title: node.title,
          kind: "inspect" as const,
          dependencies: node.dependencies,
          status: node.status,
          attempts: node.attempts,
          validationAttempts: node.validationAttempts,
          allowedFiles: node.allowedFiles,
          validationProfile: node.validationProfile,
          evidenceRefs: evidence[node.id] ? [receiptIdForEvidence(evidence[node.id])]
            .filter((id): id is string => typeof id === "string") : [],
        })),
        recipeBinding: { ...prepared.binding, phase: "running", leaseOwner: workerId, leaseUntil: new Date(Date.now() + 300_000).toISOString() },
        recipeReceipt: cancelledReceipt,
      });
      if (cancelled) {
        return {
          executionId: claimed.id,
          status: "blocked",
          completedNodeIds: result.completedNodeIds,
          receipt: cancelledReceipt,
        };
      }
      const terminalExecution = await getAiExecutionForUser(claimed.id, params.userId);
      if (terminalExecution?.status === "cancelled") {
        await persistCancelledRecipeReceipt({
          executionId: claimed.id,
          userId: params.userId,
          recipeReceipt: cancelledReceipt,
        });
        return {
          executionId: claimed.id,
          status: "blocked",
          completedNodeIds: result.completedNodeIds,
          receipt: cancelledReceipt,
        };
      }
      throw new Error("Recipe completion lost its durable ownership fence.");
    }
    const receipt = completedReceipt;
    if (episode && !params.strategyReplayContext) {
      try {
        const extraction = await extractAcceptedEpisodeStrategy({
          projectId: params.projectId,
          episodeId: episode.episodeId,
        });
        if (extraction.status === "stored") {
          logger.info(
            {
              scope: "recipe-operation",
              executionId: claimed.id,
              episodeId: episode.episodeId,
              candidateId: extraction.candidate.candidateId,
              created: extraction.created,
            },
            "Accepted episode strategy candidate extracted",
          );
        } else {
          logger.info(
            {
              scope: "recipe-operation",
              executionId: claimed.id,
              episodeId: episode.episodeId,
              reason: extraction.reason,
            },
            "Accepted episode was not eligible for strategy extraction",
          );
        }
    if (
      extraction.status === "not_eligible"
      && extraction.reason === "candidate_evaluation_started"
    ) {
      try {
        const registration = await registerProspectiveStrategyReplayCase({
          projectId: params.projectId,
          episodeId: episode.episodeId,
        });
        if (registration.status === "registered") {
          logger.info(
            {
              scope: "recipe-operation",
              executionId: claimed.id,
              episodeId: episode.episodeId,
              caseId: registration.caseId,
              candidateId: registration.candidateId,
            },
            "Prospective Strategy Replay case registered",
          );
        }
      } catch (error) {
        logger.warn(
          {
            scope: "recipe-operation",
            code: "strategy_replay_case_registration_failed",
            executionId: claimed.id,
            episodeId: episode.episodeId,
            error,
          },
          "Strategy Replay case registration failed without changing the accepted recipe outcome",
        );
      }
    }
      } catch (error) {
        logger.warn(
          {
            scope: "recipe-operation",
            code: "strategy_candidate_extraction_failed",
            executionId: claimed.id,
            episodeId: episode.episodeId,
            error,
          },
          "Strategy extraction failed without changing the accepted recipe outcome",
        );
      }
    }
    const isRuntimeRecipe = ["runtime.start", "runtime.restart", "runtime.stop"]
      .includes(params.recipeId);
    const runtimeEvidence = isRuntimeRecipe
      ? [...outputs.values()]
          .map((output) => output.evidence)
          .find((value): value is Record<string, unknown> => (
            typeof value === "object"
            && value !== null
            && !Array.isArray(value)
          ))
      : undefined;
    const runtimeGateCEffectKind = gateCEffectKind(params.recipeId);
    const runtimeAfterObservation = runtimeEvidence
      && runtimeGateCEffectKind
      && runtimeGateCEffectKind.startsWith("runtime")
      ? buildRuntimeGateCAfterObservation({
          recipeId: params.recipeId,
          projectId: params.projectId,
          sourceRevision: params.sourceRevision,
          evidence: runtimeEvidence,
        })
      : undefined;
    const rawRuntimeAfterState = runtimeEvidence?.afterState
      && typeof runtimeEvidence.afterState === "object"
      && !Array.isArray(runtimeEvidence.afterState)
      ? runtimeEvidence.afterState as Record<string, unknown>
      : undefined;
    const rawChildProcessAttestation = rawRuntimeAfterState?.childProcessAttestation
      && typeof rawRuntimeAfterState.childProcessAttestation === "object"
      && !Array.isArray(rawRuntimeAfterState.childProcessAttestation)
      ? rawRuntimeAfterState.childProcessAttestation as Record<string, unknown>
      : undefined;
    const runtimeChildProcessObservation = episode
      && rawChildProcessAttestation
      && typeof runtimeEvidence?.sessionId === "string"
      && typeof rawChildProcessAttestation.bindingDigest === "string"
      && ["known", "mismatch", "unknown"].includes(String(rawChildProcessAttestation.status))
      && typeof rawChildProcessAttestation.reasonCode === "string"
      && typeof rawChildProcessAttestation.observedAt === "string"
      ? [{
          kind: "child_process_attestation" as const,
          projectId: params.projectId,
          executionId: claimed.id,
          attempt: receipt.attempt ?? claimed.attempt,
          episodeId: episode.episodeId,
          operationId: params.operationId,
          sessionId: runtimeEvidence.sessionId,
          revision: params.sourceRevision,
          status: rawChildProcessAttestation.status as "known" | "mismatch" | "unknown",
          reasonCode: rawChildProcessAttestation.reasonCode as import("./agent-state/child-process-attestation.js").ChildProcessEnvironmentAttestation["reasonCode"],
          bindingDigest: rawChildProcessAttestation.bindingDigest,
          attestationDigest: typeof rawChildProcessAttestation.attestationDigest === "string"
            ? rawChildProcessAttestation.attestationDigest
            : null,
          processEnvironmentDigest: typeof rawChildProcessAttestation.processEnvironmentDigest === "string"
            ? rawChildProcessAttestation.processEnvironmentDigest
            : null,
          environmentRevision: typeof runtimeEvidence.environmentRevision === "string"
            ? runtimeEvidence.environmentRevision
            : null,
          observedAt: rawChildProcessAttestation.observedAt,
        }]
      : [];
    await materializeServerOwnedObservations({
      projectId: params.projectId,
      executionId: claimed.id,
      attempt: receipt.attempt ?? claimed.attempt,
      ...(episode ? { episodeId: episode.episodeId } : {}),
      ...(episode ? { environmentRootPath: executionRoot } : {}),
      projectRevision: receipt.sourceRevision,
      materializeWorldState: params.recipeId !== "runtime.start",
      sources: [
        {
          kind: "acceptance",
          sourceId: `acceptance:${claimed.id}:${receipt.attempt ?? claimed.attempt}`,
          sourceRevision: receipt.sourceRevision,
          terminalStatus: "completed",
          outcome: "SUCCEEDED",
          reasonCode: "ACCEPTED",
          evidenceComplete: true,
          evidenceRefs: receipt.evidenceRefs,
        },
        {
          kind: "runtime_receipt",
          sourceId: `runtime:${claimed.id}:${receipt.attempt ?? claimed.attempt}`,
          sourceRevision: receipt.sourceRevision,
          status: "passed",
          profile: "recipe",
          candidateIdentity: params.candidateIdentity,
          ...(isRuntimeRecipe ? {
            sessionId: typeof runtimeEvidence?.sessionId === "string"
              ? runtimeEvidence.sessionId
              : null,
            environmentRevision: typeof runtimeEvidence?.environmentRevision === "string"
              ? runtimeEvidence.environmentRevision
              : null,
          } : {}),
        },
        ...(
          runtimeStartChildProcessObservationRetained
            ? []
            : runtimeChildProcessObservation
        ),
        ...validatorProcessObservations,
        ...(runtimeAfterObservation && runtimeGateCEffectKind ? [{
          kind: "direct_observation" as const,
          sourceId: `gate-c:${claimed.id}:${claimed.attempt}:after:runtime-state`,
          sourceRevision: params.sourceRevision,
          subject: `runtime:${runtimeAfterObservation.sessionId}`,
          predicate: "runtime.after_state",
          value: runtimeAfterObservation.facts,
          evidenceRefs: [
            `gate-c:${claimed.id}:${claimed.attempt}:after`,
            ...runtimeAfterObservation.sourceRefs,
          ],
          observedAt: runtimeAfterObservation.observedAt,
        }] : []),
        {
          kind: "delivery_receipt",
          sourceId: `delivery:${claimed.id}:${receipt.attempt ?? claimed.attempt}`,
          sourceRevision: receipt.sourceRevision,
          status: "passed",
          candidateIdentity: params.candidateIdentity,
          treeHash: receipt.treeHash ?? receipt.candidateTreeHash,
        },
        ...validatorReceipts.map((validator) => ({
          kind: "validator_receipt" as const,
          validatorId: validator.validatorId,
          operationId: validator.operationId,
          projectId: validator.projectId,
          workspaceRevision: validator.workspaceRevision,
          status: validator.status,
          artifactRef: validator.artifactRef,
          environmentRevision: validator.environmentRevision ?? null,
        })),
      ],
    }).catch((error: unknown) => {
      logger.warn(
        { scope: "recipe-operation", code: "observation_materialization_failed", executionId: claimed.id, error },
        "Server-owned recipe observation materialization failed after acceptance",
      );
    });
    if (
      params.recipeId === "runtime.start"
      && episode
      && gateCAction
      && gateCEffectBundleId
      && runtimeStartTransitionQueued
    ) {
      try {
        const transition = await finalizeRuntimeStartTransition({
          projectId: params.projectId,
          executionId: claimed.id,
          attempt: receipt.attempt ?? claimed.attempt,
          episodeId: episode.episodeId,
          actionId: gateCAction.actionId,
          effectBundleId: gateCEffectBundleId,
        });
        if (transition.status !== "materialized") {
          logger.warn(
            {
              scope: "recipe-operation",
              code: "runtime_start_transition_not_materialized",
              executionId: claimed.id,
              attempt: receipt.attempt ?? claimed.attempt,
              episodeId: episode.episodeId,
              actionId: gateCAction.actionId,
              failureCode: transition.failureCode,
            },
            "Runtime start acceptance remains intact; its World State transition is explicitly incomplete",
          );
        }
      } catch (error) {
        logger.warn(
          {
            scope: "recipe-operation",
            code: "runtime_start_transition_finalize_failed",
            executionId: claimed.id,
            attempt: receipt.attempt ?? claimed.attempt,
            episodeId: episode.episodeId,
            actionId: gateCAction.actionId,
            error,
          },
          "Runtime start acceptance remains intact after transition finalization failure",
        );
      }
    }
    return { executionId: claimed.id, status: "completed", completedNodeIds: result.completedNodeIds, receipt };
  } finally {
    if (readOnlyInvocationEpisode && !readOnlyInvocationEpisodeCloseAttempted) {
      await closeReadOnlyInvocationEpisode("failed", "RECIPE_EXECUTION_INTERRUPTED");
    }
    clearTimeout(totalTimer);
    clearInterval(heartbeatTimer);
    unregisterAiExecutionController(claimed.id, overallController);
  }
}