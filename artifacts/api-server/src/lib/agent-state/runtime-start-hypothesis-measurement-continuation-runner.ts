import { and, asc, eq, inArray, lte } from "drizzle-orm";
import {
  aiAgentObservationsTable,
  aiAgentEpisodeEventsTable,
  db,
} from "@workspace/db";
import {
  canonicalJsonHash,
  type JsonValue,
} from "@workspace/ai-orchestrator";
import { appendEpisodeEvent } from "./agent-episode-ledger.js";
import {
  captureEnvironmentAttestation,
  serverEnvironmentProfile,
} from "./environment-attestation.js";
import { materializeServerOwnedObservations } from "./observation-materializer.js";
import {
  buildRuntimeStartHypothesisMeasurementContinuationRequest,
  buildRuntimeStartHypothesisMeasurementContinuationResult,
  parseRuntimeStartHypothesisMeasurementContinuationRequest,
  parseRuntimeStartHypothesisMeasurementContinuationResult,
  type RuntimeStartHypothesisMeasurementContinuationResult,
  type RuntimeStartHypothesisMeasurementContinuationRequest,
} from "./runtime-start-hypothesis-measurement-continuation.js";
import {
  parseRuntimeStartHypothesisExperimentRegistration,
  type RuntimeStartHypothesisExperimentRegistration,
} from "./runtime-start-hypothesis-experiment.js";
import { workspaceRuntime } from "../workspace-runtime.js";

type RuntimeStatusEvidence = Awaited<
  ReturnType<typeof workspaceRuntime.observeExistingRuntimeAfterState>
>;

type PriorEpisodeEvent = {
  episodeId: string;
  projectId: string;
  executionId: string;
  attempt: number;
  eventType: string;
  payload: unknown;
  sequence: number;
};

export type RuntimeStartMeasurementContinuationContext = {
  projectId: string;
  userId: string;
  operationId: string;
  executionId: string;
  attempt: number;
  episodeId: string;
  workerId: string;
  missionId?: string;
  goalId?: string;
  planRevision?: string;
  projectRevision: string;
  rootPath: string;
  signal: AbortSignal;
};

export type RuntimeStartMeasurementContinuationDisposition = {
  reasonCode: string;
  sourceExperimentId: string;
  continuationId?: string;
  resultId?: string;
  measurementValidity?: "complete_fresh" | "partial" | "stale" | "failed" | "unknown";
  resultOwnerEpisodeId?: string;
  resultOwnerAttempt?: number;
};

type AppendEpisodeEventInput = Parameters<typeof appendEpisodeEvent>[0];
type MaterializeObservationInput = Parameters<typeof materializeServerOwnedObservations>[0];
type MaterializedObservation = Awaited<ReturnType<typeof materializeServerOwnedObservations>>;
type PersistedRuntimeStatusObservation = {
  id: string;
  projectId: string;
  executionId: string;
  episodeId: string;
  sourceId: string;
  predicate: string;
  value: unknown;
  observedAt: Date | string;
  environmentRevision: string | null;
  freshness: string;
  environmentFreshness: string;
};

export type RuntimeStartMeasurementContinuationDependencies = {
  loadPriorEvents(
    context: RuntimeStartMeasurementContinuationContext,
  ): Promise<PriorEpisodeEvent[]>;
  captureEnvironmentRevision(rootPath: string): Promise<string | null>;
  observeRuntime(input: {
    projectId: string;
    revision: string;
    signal: AbortSignal;
  }): Promise<RuntimeStatusEvidence>;
  materializeObservation(input: MaterializeObservationInput): Promise<MaterializedObservation>;
  loadPriorObservations(input: {
    projectId: string;
    sourceIds: string[];
  }): Promise<PersistedRuntimeStatusObservation[]>;
  appendEvent(input: AppendEpisodeEventInput): Promise<unknown>;
  now(): string;
};

function recordPayload(payload: unknown): Record<string, unknown> | undefined {
  return payload && typeof payload === "object" && !Array.isArray(payload)
    ? payload as Record<string, unknown>
    : undefined;
}

function hasSignal(value: unknown): boolean {
  if (Array.isArray(value)) return value.length > 0;
  if (typeof value === "number") return value > 0;
  return Boolean(value);
}

function disposition(
  reasonCode: string,
  sourceExperimentId: string,
  values: Partial<RuntimeStartMeasurementContinuationDisposition> = {},
): RuntimeStartMeasurementContinuationDisposition {
  return { reasonCode, sourceExperimentId, ...values };
}

function sourceResultExists(events: PriorEpisodeEvent[], experimentId: string): boolean {
  return events.some((event) => {
    const payload = recordPayload(event.payload);
    return payload?.recordKind === "P75_HYPOTHESIS_EXPERIMENT_RESULT"
      && payload.experimentId === experimentId;
  });
}

function readPriorContinuationRequests(
  events: PriorEpisodeEvent[],
  sourceExperimentId: string,
  sourceRegistrationHash: string,
): {
  requests: Map<string, RuntimeStartHypothesisMeasurementContinuationRequest>;
  disposition?: RuntimeStartMeasurementContinuationDisposition;
} {
  const requests = new Map<string, RuntimeStartHypothesisMeasurementContinuationRequest>();
  for (const event of events) {
    const payload = recordPayload(event.payload);
    if (payload?.recordKind !== "P75_HYPOTHESIS_MEASUREMENT_CONTINUATION_REQUESTED") continue;
    const rawSource = recordPayload(payload.source);
    if (rawSource?.experimentId !== sourceExperimentId) continue;
    if (event.eventType !== "OBSERVATION_REQUESTED") {
      return {
        requests,
        disposition: disposition("P75_CONTINUATION_REQUEST_EVENT_TYPE_MISMATCH", sourceExperimentId),
      };
    }
    try {
      const request = parseRuntimeStartHypothesisMeasurementContinuationRequest(payload);
      if (request.source.registrationHash !== sourceRegistrationHash) {
        return {
          requests,
          disposition: disposition("P75_CONTINUATION_SOURCE_HASH_CONFLICT", sourceExperimentId),
        };
      }
      if (
        event.projectId !== request.measurement.projectId
        || event.executionId !== request.measurement.executionId
        || event.attempt !== request.measurement.attempt
        || event.episodeId !== request.measurement.episodeId
      ) {
        return {
          requests,
          disposition: disposition("P75_CONTINUATION_REQUEST_EVENT_IDENTITY_MISMATCH", sourceExperimentId),
        };
      }
      const existing = requests.get(request.continuationId);
      if (existing && canonicalJsonHash(existing) !== canonicalJsonHash(request)) {
        return {
          requests,
          disposition: disposition("P75_CONTINUATION_REQUEST_ID_CONFLICT", sourceExperimentId),
        };
      }
      requests.set(request.continuationId, request);
    } catch {
      return {
        requests,
        disposition: disposition("P75_CONTINUATION_REQUEST_INVALID", sourceExperimentId),
      };
    }
  }

  return { requests };
}

function readPriorContinuationResult(
  events: PriorEpisodeEvent[],
  requests: Map<string, RuntimeStartHypothesisMeasurementContinuationRequest>,
  sourceExperimentId: string,
): RuntimeStartMeasurementContinuationDisposition | undefined {
  const existingResults = new Map<string, {
    continuationId: string;
    resultId: string;
    measurementValidity: "complete_fresh" | "partial" | "stale" | "failed" | "unknown";
    resultOwnerEpisodeId: string;
    resultOwnerAttempt: number;
  }>();
  let resultEventCount = 0;
  for (const event of events) {
    const payload = recordPayload(event.payload);
    if (payload?.recordKind !== "P75_HYPOTHESIS_MEASUREMENT_CONTINUATION_RESULT") continue;
    if (payload.sourceExperimentId !== sourceExperimentId) continue;
    if (event.eventType !== "OBSERVATION_RECORDED") {
      return disposition("P75_CONTINUATION_RESULT_EVENT_TYPE_MISMATCH", sourceExperimentId);
    }
    const request = typeof payload.continuationId === "string"
      ? requests.get(payload.continuationId)
      : undefined;
    if (!request) {
      return disposition("P75_CONTINUATION_RESULT_WITHOUT_REQUEST", sourceExperimentId);
    }
    if (
      event.projectId !== request.measurement.projectId
      || event.executionId !== request.measurement.executionId
      || event.attempt !== request.measurement.attempt
      || event.episodeId !== request.measurement.episodeId
    ) {
      return disposition("P75_CONTINUATION_RESULT_EVENT_IDENTITY_MISMATCH", sourceExperimentId);
    }
    try {
      const result = parseRuntimeStartHypothesisMeasurementContinuationResult(payload, request);
      resultEventCount += 1;
      existingResults.set(result.resultId, {
        continuationId: result.continuationId,
        resultId: result.resultId,
        measurementValidity: result.measurementValidity,
        resultOwnerEpisodeId: request.measurement.episodeId,
        resultOwnerAttempt: request.measurement.attempt,
      });
    } catch {
      return disposition("P75_CONTINUATION_RESULT_INVALID", sourceExperimentId);
    }
  }
  if (existingResults.size > 1) {
    return disposition("P75_CONTINUATION_MULTIPLE_RESULTS", sourceExperimentId);
  }
  if (resultEventCount > 1) {
    return disposition("P75_CONTINUATION_MULTIPLE_RESULTS", sourceExperimentId);
  }
  const existingResult = [...existingResults.values()][0];
  if (existingResult) {
    return disposition("P75_CONTINUATION_RESULT_ALREADY_RECORDED", sourceExperimentId, {
      ...existingResult,
    });
  }
  return undefined;
}

function outcomeFromPersistedRuntimeStatus(value: unknown) {
  const status = recordPayload(value);
  if (!status) return undefined;
  if (
    status.status === "passed"
    && status.processAlive === true
    && status.portReady === true
    && status.servingRevisionMatches === true
  ) {
    return "runtime_running" as const;
  }
  if (status.status === "failed" && status.processAlive === false) {
    return "runtime_not_running" as const;
  }
  if (status.status === "failed") return "runtime_unexpected" as const;
  return undefined;
}

function toRuntimeStatusEvidence(
  row: PersistedRuntimeStatusObservation,
  request: RuntimeStartHypothesisMeasurementContinuationRequest,
) {
  const value = recordPayload(row.value);
  const observedProjectRevision = typeof value?.observedProjectRevision === "string"
    ? value.observedProjectRevision
    : null;
  const observedAt = row.observedAt instanceof Date
    ? Number.isFinite(row.observedAt.getTime())
      ? row.observedAt.toISOString()
      : ""
    : row.observedAt;
  if (
    !Number.isFinite(Date.parse(observedAt))
    || Date.parse(observedAt) < Date.parse(request.requestedAt)
  ) {
    return undefined;
  }
  const outcomeKey = outcomeFromPersistedRuntimeStatus(row.value);

  return {
    id: row.id,
    predicate: "runtime.status" as const,
    projectRevision: observedProjectRevision,
    environmentRevision: row.environmentRevision,
    freshness: row.freshness === "fresh"
      && observedProjectRevision === request.measurement.projectRevision
      ? "fresh" as const
      : "stale" as const,
    environmentFreshness: row.environmentFreshness === "fresh"
      && row.environmentRevision === request.measurement.environmentRevision
      ? "fresh" as const
      : "stale" as const,
    ...(outcomeKey ? { outcomeKey } : {}),
    observedAt,
  };
}

function productionDependencies(): RuntimeStartMeasurementContinuationDependencies {
  return {
    loadPriorEvents: async (context) => db.select({
      episodeId: aiAgentEpisodeEventsTable.episodeId,
      projectId: aiAgentEpisodeEventsTable.projectId,
      executionId: aiAgentEpisodeEventsTable.executionId,
      attempt: aiAgentEpisodeEventsTable.attempt,
      eventType: aiAgentEpisodeEventsTable.eventType,
      payload: aiAgentEpisodeEventsTable.payload,
      sequence: aiAgentEpisodeEventsTable.sequence,
    })
      .from(aiAgentEpisodeEventsTable)
      .where(and(
        eq(aiAgentEpisodeEventsTable.projectId, context.projectId),
        eq(aiAgentEpisodeEventsTable.executionId, context.executionId),
        lte(aiAgentEpisodeEventsTable.attempt, context.attempt),
        inArray(aiAgentEpisodeEventsTable.eventType, [
          "OBSERVATION_REQUESTED",
          "OBSERVATION_RECORDED",
        ]),
      ))
      .orderBy(asc(aiAgentEpisodeEventsTable.attempt), asc(aiAgentEpisodeEventsTable.sequence)),
    loadPriorObservations: async ({ projectId, sourceIds }) => {
      if (sourceIds.length === 0) return [];
      return db.select({
        id: aiAgentObservationsTable.id,
        projectId: aiAgentObservationsTable.projectId,
        executionId: aiAgentObservationsTable.executionId,
        episodeId: aiAgentObservationsTable.episodeId,
        sourceId: aiAgentObservationsTable.sourceId,
        predicate: aiAgentObservationsTable.predicate,
        value: aiAgentObservationsTable.value,
        observedAt: aiAgentObservationsTable.observedAt,
        environmentRevision: aiAgentObservationsTable.environmentRevision,
        freshness: aiAgentObservationsTable.freshness,
        environmentFreshness: aiAgentObservationsTable.environmentFreshness,
      })
        .from(aiAgentObservationsTable)
        .where(and(
          eq(aiAgentObservationsTable.projectId, projectId),
          eq(aiAgentObservationsTable.predicate, "runtime.status"),
          inArray(aiAgentObservationsTable.sourceId, sourceIds),
        ))
        .orderBy(asc(aiAgentObservationsTable.observedAt));
    },
    captureEnvironmentRevision: async (rootPath) => {
      try {
        const attestation = await captureEnvironmentAttestation({
          rootPath,
          profile: serverEnvironmentProfile("RUNTIME_START", {
            kind: "recipe",
            recipeId: "runtime.start",
          }),
        });
        return attestation.status === "known" ? attestation.environmentRevision : null;
      } catch {
        return null;
      }
    },
    observeRuntime: async ({ projectId, revision, signal }) => {
      const snapshot = await workspaceRuntime.get(projectId);
      if (snapshot.status !== "running" || !snapshot.sessionId) {
        throw new Error("No current server-owned runtime session is available for continuation.");
      }
      return workspaceRuntime.observeExistingRuntimeAfterState({
        projectId,
        sessionId: snapshot.sessionId,
        revision,
        signal,
      });
    },
    materializeObservation: materializeServerOwnedObservations,
    appendEvent: appendEpisodeEvent,
    now: () => new Date().toISOString(),
  };
}

export async function runRuntimeStartHypothesisMeasurementContinuation(
  context: RuntimeStartMeasurementContinuationContext,
  overrides: Partial<RuntimeStartMeasurementContinuationDependencies> = {},
): Promise<RuntimeStartMeasurementContinuationDisposition | undefined> {
  if (
    context.attempt <= 0
    || !context.missionId
    || !context.goalId
    || !context.planRevision
  ) {
    return undefined;
  }
  if (context.signal.aborted) {
    throw new Error("P7.5 measurement continuation was cancelled before it started.");
  }
  const dependencies = { ...productionDependencies(), ...overrides };
  const priorEvents = await dependencies.loadPriorEvents(context);
  const registrationRows = priorEvents.filter((event) => {
    return recordPayload(event.payload)?.recordKind === "P75_HYPOTHESIS_EXPERIMENT_REGISTERED";
  });
  if (registrationRows.length === 0) return undefined;

  const registrations: RuntimeStartHypothesisExperimentRegistration[] = [];
  for (const event of registrationRows) {
    if (event.eventType !== "OBSERVATION_REQUESTED") {
      const raw = recordPayload(event.payload);
      return disposition(
        "P75_SOURCE_REGISTRATION_EVENT_TYPE_MISMATCH",
        typeof raw?.experimentId === "string" ? raw.experimentId : "unknown",
      );
    }
    let registration: RuntimeStartHypothesisExperimentRegistration;
    try {
      registration = parseRuntimeStartHypothesisExperimentRegistration(event.payload);
    } catch {
      const raw = recordPayload(event.payload);
      return disposition(
        "P75_SOURCE_REGISTRATION_INVALID",
        typeof raw?.experimentId === "string" ? raw.experimentId : "unknown",
      );
    }
    if (
      event.projectId !== context.projectId
      || event.executionId !== context.executionId
      || event.attempt !== registration.attempt
      || event.episodeId !== registration.episodeId
      || registration.projectId !== context.projectId
      || registration.executionId !== context.executionId
      || registration.attempt >= context.attempt
    ) {
      return disposition("P75_SOURCE_REGISTRATION_IDENTITY_MISMATCH", registration.experimentId);
    }
    if (
      registration.missionId !== context.missionId
      || registration.goalId !== context.goalId
    ) {
      return disposition("P75_SOURCE_MISSION_SCOPE_MISMATCH", registration.experimentId);
    }
    registrations.push(registration);
  }

  const uniqueRegistrations = new Map(
    registrations.map((registration) => [
      registration.experimentId,
      registration,
    ]),
  );
  if (uniqueRegistrations.size !== 1) {
    return disposition("P75_SOURCE_REGISTRATION_AMBIGUOUS", registrations[0]!.experimentId);
  }
  const registration = [...uniqueRegistrations.values()][0]!;
  if (sourceResultExists(priorEvents, registration.experimentId)) {
    return disposition("P75_SOURCE_RESULT_ALREADY_RECORDED", registration.experimentId);
  }

  const sourceRegistrationHash = canonicalJsonHash(registration);
  const priorRequestState = readPriorContinuationRequests(
    priorEvents,
    registration.experimentId,
    sourceRegistrationHash,
  );
  if (priorRequestState.disposition) return priorRequestState.disposition;
  const previousContinuation = readPriorContinuationResult(
    priorEvents,
    priorRequestState.requests,
    registration.experimentId,
  );
  if (previousContinuation) return previousContinuation;

  const currentEnvironmentRevision = await dependencies.captureEnvironmentRevision(context.rootPath);
  if (
    !currentEnvironmentRevision
    || registration.projectRevision !== context.projectRevision
    || registration.planRevision !== context.planRevision
    || registration.environmentRevision !== currentEnvironmentRevision
  ) {
    return disposition("P75_CONTINUATION_SCOPE_CHANGED", registration.experimentId);
  }

  const priorRequests = [...priorRequestState.requests.values()];
  const requestedAt = priorRequests
    .map((priorRequest) => priorRequest.requestedAt)
    .sort((a, b) => Date.parse(a) - Date.parse(b))[0] ?? dependencies.now();
  const request = buildRuntimeStartHypothesisMeasurementContinuationRequest({
    registration,
    measurement: {
      projectId: context.projectId,
      missionId: context.missionId,
      goalId: context.goalId,
      executionId: context.executionId,
      attempt: context.attempt,
      episodeId: context.episodeId,
      planRevision: context.planRevision,
      projectRevision: context.projectRevision,
      environmentRevision: currentEnvironmentRevision,
    },
    requestedAt,
  });
  await dependencies.appendEvent({
    episodeId: context.episodeId,
    projectId: context.projectId,
    executionId: context.executionId,
    attempt: context.attempt,
    workerId: context.workerId,
    eventType: "OBSERVATION_REQUESTED",
    payload: request as unknown as JsonValue,
    actorType: "server",
    actorId: context.workerId,
    correlationId: context.executionId,
  });

  if (context.signal.aborted) throw new Error("P75 measurement continuation was cancelled.");
  let result: RuntimeStartHypothesisMeasurementContinuationResult;
  let observationRef: string | undefined;
  const sourceIdToRequest = new Map(priorRequests.map((priorRequest) => [
    `${priorRequest.continuationId}:runtime.status`,
    priorRequest,
  ]));
  const priorObservations = await dependencies.loadPriorObservations({
    projectId: context.projectId,
    sourceIds: [...sourceIdToRequest.keys()],
  });
  if (context.signal.aborted) throw new Error("P75 measurement continuation was cancelled.");
  if (priorObservations.length > 1) {
    return disposition("P75_CONTINUATION_MULTIPLE_PRIOR_OBSERVATIONS", registration.experimentId);
  }

  const priorObservation = priorObservations[0];
  let recoveredObservation: ReturnType<typeof toRuntimeStatusEvidence> | undefined;
  if (priorObservation) {
    const sourceRequest = sourceIdToRequest.get(priorObservation.sourceId);
    if (
      !sourceRequest
      || priorObservation.projectId !== context.projectId
      || priorObservation.executionId !== context.executionId
      || priorObservation.episodeId !== sourceRequest.measurement.episodeId
      || priorObservation.predicate !== "runtime.status"
    ) {
      return disposition("P75_CONTINUATION_PRIOR_OBSERVATION_IDENTITY_MISMATCH", registration.experimentId);
    }
    recoveredObservation = toRuntimeStatusEvidence(priorObservation, request);
    if (!recoveredObservation) {
      return disposition("P75_CONTINUATION_PRIOR_OBSERVATION_INVALID", registration.experimentId);
    }
    observationRef = priorObservation.id;
  }

  try {
    if (recoveredObservation) {
      result = buildRuntimeStartHypothesisMeasurementContinuationResult({
        request,
        observation: recoveredObservation,
        resolvedAt: dependencies.now(),
      });
    } else {
      const runtimeStatus = await dependencies.observeRuntime({
        projectId: context.projectId,
        revision: context.projectRevision,
        signal: context.signal,
      });
      if (context.signal.aborted) throw new Error("P75 measurement continuation was cancelled.");
      const observedEnvironmentRevision =
        await dependencies.captureEnvironmentRevision(context.rootPath);
      if (context.signal.aborted) throw new Error("P75 measurement continuation was cancelled.");
      const materialized = await dependencies.materializeObservation({
        projectId: context.projectId,
        executionId: context.executionId,
        attempt: context.attempt,
        episodeId: context.episodeId,
        workerLease: { workerId: context.workerId },
        environmentRootPath: context.rootPath,
        projectRevision: context.projectRevision,
        materializeWorldState: false,
        sources: [{
          kind: "direct_observation",
          sourceId: `${request.continuationId}:runtime.status`,
          subject: "runtime",
          predicate: "runtime.status",
          value: {
            status: runtimeStatus.status,
            processAlive: runtimeStatus.processAlive,
            portReady: runtimeStatus.portReady,
            servingRevisionMatches: runtimeStatus.servingRevision === context.projectRevision,
            observedProjectRevision: runtimeStatus.revision,
            markerMatched: runtimeStatus.markerMatched,
          },
          sourceRevision: runtimeStatus.revision,
          environmentRevision: observedEnvironmentRevision,
          observedAt: runtimeStatus.observedAt,
        }],
      });
      if (context.signal.aborted) throw new Error("P75 measurement continuation was cancelled.");
      const observationId = materialized.observationIds[0];
      if (observationId) observationRef = observationId;
      const outcomeKey = runtimeStatus.status === "passed"
        && runtimeStatus.processAlive
        && runtimeStatus.portReady
        && runtimeStatus.servingRevision === context.projectRevision
        ? "runtime_running" as const
        : runtimeStatus.status === "failed" && runtimeStatus.processAlive === false
          ? "runtime_not_running" as const
          : runtimeStatus.status === "failed"
            ? "runtime_unexpected" as const
            : undefined;
      const freshness = hasSignal(materialized.stale)
        || runtimeStatus.revision !== context.projectRevision
        ? "stale" as const
        : "fresh" as const;
      const environmentFreshness = hasSignal(materialized.environmentStale)
        || observedEnvironmentRevision !== registration.environmentRevision
        ? "stale" as const
        : "fresh" as const;
      result = buildRuntimeStartHypothesisMeasurementContinuationResult({
        request,
        ...(observationId ? {
          observation: {
            id: observationId,
            predicate: "runtime.status" as const,
            projectRevision: runtimeStatus.revision,
            environmentRevision: observedEnvironmentRevision,
            freshness,
            environmentFreshness,
            ...(outcomeKey ? { outcomeKey } : {}),
            observedAt: runtimeStatus.observedAt,
          },
        } : { unavailableAs: "unknown" as const }),
        resolvedAt: dependencies.now(),
      });
    }
  } catch (error) {
    if (context.signal.aborted) throw error;
    result = buildRuntimeStartHypothesisMeasurementContinuationResult({
      request,
      unavailableAs: "failed",
      resolvedAt: dependencies.now(),
    });
  }

  await dependencies.appendEvent({
    episodeId: context.episodeId,
    projectId: context.projectId,
    executionId: context.executionId,
    attempt: context.attempt,
    workerId: context.workerId,
    eventType: "OBSERVATION_RECORDED",
    payload: result as unknown as JsonValue,
    actorType: "server",
    actorId: context.workerId,
    correlationId: context.executionId,
    ...(observationRef ? { observationRefs: [observationRef] } : {}),
  });
  return disposition("P75_MEASUREMENT_CONTINUATION_RECORDED", registration.experimentId, {
    continuationId: result.continuationId,
    resultId: result.resultId,
    measurementValidity: result.measurementValidity,
    resultOwnerEpisodeId: context.episodeId,
    resultOwnerAttempt: context.attempt,
  });
}