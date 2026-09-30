import { describe, expect, it, vi } from "vitest";
import {
  runRuntimeStartHypothesisMeasurementContinuation,
  type RuntimeStartMeasurementContinuationContext,
  type RuntimeStartMeasurementContinuationDependencies,
} from "./runtime-start-hypothesis-measurement-continuation-runner.js";
import {
  buildRuntimeStartHypothesisMeasurementContinuationRequest,
  buildRuntimeStartHypothesisMeasurementContinuationResult,
} from "./runtime-start-hypothesis-measurement-continuation.js";
import { buildRuntimeStartHypothesisExperimentRegistration } from "./runtime-start-hypothesis-experiment.js";

const environmentRevision = `env-v1:${"a".repeat(64)}`;
const registration = buildRuntimeStartHypothesisExperimentRegistration({
  projectId: "project-p75",
  missionId: "mission-p75",
  goalId: "goal-p75",
  executionId: "execution-p75",
  attempt: 2,
  episodeId: "episode-original",
  actionId: "runtime-start-action",
  planRevision: "plan-revision-p75",
  projectRevision: "project-revision-p75",
  environmentRevision,
  parentWorldRevision: "b".repeat(64),
  beforeObservationIds: ["observation-before-p75"],
  predictionRegisteredAt: "2026-09-28T10:00:00.000Z",
});

type EventFixture = {
  episodeId: string;
  projectId: string;
  executionId: string;
  attempt: number;
  eventType: string;
  payload: unknown;
  sequence: number;
};

function sourceEvent(): EventFixture {
  return {
    episodeId: registration.episodeId,
    projectId: registration.projectId,
    executionId: registration.executionId,
    attempt: registration.attempt,
    eventType: "OBSERVATION_REQUESTED",
    payload: registration,
    sequence: 1,
  };
}

function context(overrides: Partial<RuntimeStartMeasurementContinuationContext> = {}) {
  return {
    projectId: registration.projectId,
    userId: "user-p75",
    operationId: "operation-p75",
    executionId: registration.executionId,
    attempt: 3,
    episodeId: "episode-recovery",
    workerId: "worker-current",
    missionId: registration.missionId,
    goalId: registration.goalId,
    planRevision: registration.planRevision,
    projectRevision: registration.projectRevision,
    rootPath: "/managed/project-p75",
    signal: new AbortController().signal,
    ...overrides,
  } satisfies RuntimeStartMeasurementContinuationContext;
}

function dependencies(
  events: EventFixture[],
  options: {
    environmentRevision?: string | null;
    runtimeStatus?: Record<string, unknown>;
  } = {},
) {
  const trace: string[] = [];
  const appended: Array<{
    eventType: string;
    payload: unknown;
    episodeId: string;
    attempt: number;
    workerId: string;
    observationRefs?: string[];
  }> = [];
  const runtimeStatus = {
    status: "passed",
    projectId: registration.projectId,
    sessionId: "server-owned-session",
    revision: registration.projectRevision,
    processAlive: true,
    portReady: true,
    servingRevision: registration.projectRevision,
    markerMatched: true,
    observedAt: "2026-09-28T10:01:05.000Z",
    ...options.runtimeStatus,
  };
  let timeIndex = 0;
  const times = [
    "2026-09-28T10:01:00.000Z",
    "2026-09-28T10:01:05.000Z",
  ];
  const deps: RuntimeStartMeasurementContinuationDependencies = {
    loadPriorEvents: vi.fn(async () => events as never),
    captureEnvironmentRevision: vi.fn(async () => options.environmentRevision === undefined
      ? environmentRevision
      : options.environmentRevision),
    observeRuntime: vi.fn(async () => {
      trace.push("observe");
      return runtimeStatus as Awaited<
        ReturnType<RuntimeStartMeasurementContinuationDependencies["observeRuntime"]>
      >;
    }),
    loadPriorObservations: vi.fn(async () => []),
    materializeObservation: vi.fn(async (input) => {
      trace.push("materialize");
      expect(input.materializeWorldState).toBe(false);
      expect(input.workerLease).toEqual({ workerId: "worker-current" });
      expect(input.sources).toHaveLength(1);
      expect(input.sources[0]).toMatchObject({
        predicate: "runtime.status",
        subject: "runtime",
      });
      return {
        observationIds: ["observation-runtime-status-current"],
        stale: 0,
        environmentStale: 0,
      } as unknown as Awaited<
        ReturnType<RuntimeStartMeasurementContinuationDependencies["materializeObservation"]>
      >;
    }),
    appendEvent: vi.fn(async (event) => {
      trace.push(event.eventType);
      appended.push(event);
    }),
    now: () => times[Math.min(timeIndex++, times.length - 1)]!,
  };
  return { deps, trace, appended };
}

describe("P7.5 runtime-start measurement continuation runner", () => {
  it("records a fresh same-scope runtime.status outcome without promoting calibration eligibility", async () => {
    const fixture = dependencies([sourceEvent()]);

    const result = await runRuntimeStartHypothesisMeasurementContinuation(
      context(),
      fixture.deps,
    );

    expect(result).toMatchObject({
      reasonCode: "P75_MEASUREMENT_CONTINUATION_RECORDED",
      measurementValidity: "complete_fresh",
    });
    expect(fixture.appended[1]?.payload).toMatchObject({
      recordKind: "P75_HYPOTHESIS_MEASUREMENT_CONTINUATION_RESULT",
      measurementValidity: "complete_fresh",
      actualOutcomeKey: "runtime_running",
      calibrationEligibility: "not_eligible_without_versioned_policy_review",
    });
    expect(fixture.appended[1]?.payload).toHaveProperty("observationId");
  });

  it("keeps unclassified runtime.status observations partial instead of mapping them to runtime_other", async () => {
    const events = [sourceEvent()];
    const fixture = dependencies(events, {
      runtimeStatus: {
        status: "unavailable",
        processAlive: false,
        portReady: false,
        servingRevision: null,
      },
    });

    const result = await runRuntimeStartHypothesisMeasurementContinuation(
      context(),
      fixture.deps,
    );

    expect(result).toMatchObject({
      reasonCode: "P75_MEASUREMENT_CONTINUATION_RECORDED",
      sourceExperimentId: registration.experimentId,
      measurementValidity: "partial",
    });
    expect(fixture.trace).toEqual([
      "OBSERVATION_REQUESTED",
      "observe",
      "materialize",
      "OBSERVATION_RECORDED",
    ]);
    expect(fixture.appended).toHaveLength(2);
    expect(fixture.appended.map(({ attempt, episodeId, workerId }) => ({
      attempt,
      episodeId,
      workerId,
    }))).toEqual([
      { attempt: 3, episodeId: "episode-recovery", workerId: "worker-current" },
      { attempt: 3, episodeId: "episode-recovery", workerId: "worker-current" },
    ]);
    expect(fixture.appended[0]?.payload).toMatchObject({
      recordKind: "P75_HYPOTHESIS_MEASUREMENT_CONTINUATION_REQUESTED",
      measurement: { attempt: 3, episodeId: "episode-recovery" },
      observationProfile: "runtime.status",
    });
    expect(fixture.appended[1]?.payload).toMatchObject({
      recordKind: "P75_HYPOTHESIS_MEASUREMENT_CONTINUATION_RESULT",
      measurementValidity: "partial",
      calibrationEligibility: "not_eligible_without_versioned_policy_review",
    });
    expect(fixture.appended[1]?.payload).not.toHaveProperty("actualOutcomeKey");
  });

  it("does not observe when environment scope changed", async () => {
    const fixture = dependencies([sourceEvent()], {
      environmentRevision: `env-v1:${"c".repeat(64)}`,
    });

    const result = await runRuntimeStartHypothesisMeasurementContinuation(
      context(),
      fixture.deps,
    );

    expect(result?.reasonCode).toBe("P75_CONTINUATION_SCOPE_CHANGED");
    expect(fixture.deps.observeRuntime).not.toHaveBeenCalled();
    expect(fixture.appended).toHaveLength(0);
  });

  it("reuses a prior complete continuation result without repeating runtime.status", async () => {
    const request = buildRuntimeStartHypothesisMeasurementContinuationRequest({
      registration,
      measurement: {
        projectId: registration.projectId,
        missionId: registration.missionId,
        goalId: registration.goalId,
        executionId: registration.executionId,
        attempt: 3,
        episodeId: "episode-previous-recovery",
        planRevision: registration.planRevision,
        projectRevision: registration.projectRevision,
        environmentRevision,
      },
      requestedAt: "2026-09-28T10:01:00.000Z",
    });
    const priorResult = buildRuntimeStartHypothesisMeasurementContinuationResult({
      request,
      observation: {
        id: "observation-prior-runtime-status",
        predicate: "runtime.status",
        projectRevision: registration.projectRevision,
        environmentRevision,
        freshness: "fresh",
        environmentFreshness: "fresh",
        outcomeKey: "runtime_running",
        observedAt: "2026-09-28T10:01:05.000Z",
      },
      resolvedAt: "2026-09-28T10:01:05.000Z",
    });
    const previousRequestEvent: EventFixture = {
      episodeId: request.measurement.episodeId,
      projectId: registration.projectId,
      executionId: registration.executionId,
      attempt: request.measurement.attempt,
      eventType: "OBSERVATION_REQUESTED",
      payload: request,
      sequence: 2,
    };
    const previousResultEvent: EventFixture = {
      ...previousRequestEvent,
      eventType: "OBSERVATION_RECORDED",
      payload: priorResult,
      sequence: 3,
    };
    const fixture = dependencies([
      sourceEvent(),
      previousRequestEvent,
      previousResultEvent,
    ]);

    const result = await runRuntimeStartHypothesisMeasurementContinuation(
      context({ attempt: 4, episodeId: "episode-next-recovery" }),
      fixture.deps,
    );

    expect(result).toMatchObject({
      reasonCode: "P75_CONTINUATION_RESULT_ALREADY_RECORDED",
      continuationId: priorResult.continuationId,
      resultId: priorResult.resultId,
      measurementValidity: "complete_fresh",
      resultOwnerEpisodeId: request.measurement.episodeId,
      resultOwnerAttempt: request.measurement.attempt,
    });
    expect(fixture.deps.observeRuntime).not.toHaveBeenCalled();
    expect(fixture.appended).toHaveLength(0);
  });

  it("fails closed when prior attempts contain conflicting complete continuation results", async () => {
    const requestForAttempt = (attempt: number, episodeId: string) =>
      buildRuntimeStartHypothesisMeasurementContinuationRequest({
        registration,
        measurement: {
          projectId: registration.projectId,
          missionId: registration.missionId,
          goalId: registration.goalId,
          executionId: registration.executionId,
          attempt,
          episodeId,
          planRevision: registration.planRevision,
          projectRevision: registration.projectRevision,
          environmentRevision,
        },
        requestedAt: `2026-09-28T10:0${attempt}:00.000Z`,
      });
    const firstRequest = requestForAttempt(3, "episode-recovery-3");
    const secondRequest = requestForAttempt(4, "episode-recovery-4");
    const makeResult = (request: typeof firstRequest, second: number) =>
      buildRuntimeStartHypothesisMeasurementContinuationResult({
        request,
        observation: {
          id: `observation-runtime-status-${second}`,
          predicate: "runtime.status",
          projectRevision: registration.projectRevision,
          environmentRevision,
          freshness: "fresh",
          environmentFreshness: "fresh",
          outcomeKey: "runtime_running",
          observedAt: `2026-09-28T10:0${second}:05.000Z`,
        },
        resolvedAt: `2026-09-28T10:0${second}:05.000Z`,
      });
    const firstResult = makeResult(firstRequest, 3);
    const secondResult = makeResult(secondRequest, 4);
    const events: EventFixture[] = [
      sourceEvent(),
      {
        ...sourceEvent(),
        episodeId: firstRequest.measurement.episodeId,
        attempt: firstRequest.measurement.attempt,
        eventType: "OBSERVATION_REQUESTED",
        payload: firstRequest,
        sequence: 2,
      },
      {
        ...sourceEvent(),
        episodeId: firstRequest.measurement.episodeId,
        attempt: firstRequest.measurement.attempt,
        eventType: "OBSERVATION_RECORDED",
        payload: firstResult,
        sequence: 3,
      },
      {
        ...sourceEvent(),
        episodeId: secondRequest.measurement.episodeId,
        attempt: secondRequest.measurement.attempt,
        eventType: "OBSERVATION_REQUESTED",
        payload: secondRequest,
        sequence: 4,
      },
      {
        ...sourceEvent(),
        episodeId: secondRequest.measurement.episodeId,
        attempt: secondRequest.measurement.attempt,
        eventType: "OBSERVATION_RECORDED",
        payload: secondResult,
        sequence: 5,
      },
    ];
    const fixture = dependencies(events);

    const result = await runRuntimeStartHypothesisMeasurementContinuation(
      context({ attempt: 5, episodeId: "episode-recovery-5" }),
      fixture.deps,
    );

    expect(result?.reasonCode).toBe("P75_CONTINUATION_MULTIPLE_RESULTS");
    expect(fixture.deps.observeRuntime).not.toHaveBeenCalled();
    expect(fixture.appended).toHaveLength(0);
  });

  it("reuses an earlier inconclusive result instead of taking a second observation", async () => {
    const request = buildRuntimeStartHypothesisMeasurementContinuationRequest({
      registration,
      measurement: {
        projectId: registration.projectId,
        missionId: registration.missionId,
        goalId: registration.goalId,
        executionId: registration.executionId,
        attempt: 3,
        episodeId: "episode-prior-inconclusive",
        planRevision: registration.planRevision,
        projectRevision: registration.projectRevision,
        environmentRevision,
      },
      requestedAt: "2026-09-28T10:01:00.000Z",
    });
    const priorResult = buildRuntimeStartHypothesisMeasurementContinuationResult({
      request,
      unavailableAs: "unknown",
      resolvedAt: "2026-09-28T10:01:05.000Z",
    });
    const fixture = dependencies([
      sourceEvent(),
      {
        ...sourceEvent(),
        episodeId: request.measurement.episodeId,
        attempt: request.measurement.attempt,
        eventType: "OBSERVATION_REQUESTED",
        payload: request,
        sequence: 2,
      },
      {
        ...sourceEvent(),
        episodeId: request.measurement.episodeId,
        attempt: request.measurement.attempt,
        eventType: "OBSERVATION_RECORDED",
        payload: priorResult,
        sequence: 3,
      },
    ]);

    const result = await runRuntimeStartHypothesisMeasurementContinuation(
      context({ attempt: 4, episodeId: "episode-current-recovery" }),
      fixture.deps,
    );

    expect(result).toMatchObject({
      reasonCode: "P75_CONTINUATION_RESULT_ALREADY_RECORDED",
      continuationId: priorResult.continuationId,
      resultId: priorResult.resultId,
      measurementValidity: "unknown",
    });
    expect(fixture.deps.observeRuntime).not.toHaveBeenCalled();
    expect(fixture.appended).toHaveLength(0);
  });

  it("reuses a committed result when its append acknowledgment is lost before terminalization", async () => {
    const fixture = dependencies([sourceEvent()]);
    vi.mocked(fixture.deps.appendEvent).mockImplementation(async (event) => {
      fixture.trace.push(event.eventType);
      fixture.appended.push(event);
      if (event.eventType === "OBSERVATION_RECORDED") {
        throw new Error("simulated worker loss after durable result append");
      }
    });

    await expect(runRuntimeStartHypothesisMeasurementContinuation(
      context(),
      fixture.deps,
    )).rejects.toThrow(/durable result append/);

    const persistedRequestAndResult = fixture.appended.map((event, index) => ({
      ...event,
      sequence: index + 2,
    }));
    vi.mocked(fixture.deps.loadPriorEvents).mockResolvedValue([
      sourceEvent(),
      ...persistedRequestAndResult,
    ] as never);

    const recovered = await runRuntimeStartHypothesisMeasurementContinuation(
      context({ attempt: 4, episodeId: "episode-after-crash" }),
      fixture.deps,
    );

    const recordedResult = fixture.appended.find(
      (event) => event.eventType === "OBSERVATION_RECORDED",
    )?.payload as { resultId?: string; continuationId?: string };
    expect(recovered).toMatchObject({
      reasonCode: "P75_CONTINUATION_RESULT_ALREADY_RECORDED",
      resultId: recordedResult.resultId,
      continuationId: recordedResult.continuationId,
      measurementValidity: "complete_fresh",
    });
    expect(fixture.deps.observeRuntime).toHaveBeenCalledTimes(1);
    expect(fixture.appended.filter(
      (event) => event.eventType === "OBSERVATION_RECORDED",
    )).toHaveLength(1);
  });

  it("recovers from a crash after the continuation request was stored but before observation", async () => {
    const fixture = dependencies([sourceEvent()]);
    vi.mocked(fixture.deps.appendEvent).mockImplementation(async (event) => {
      fixture.trace.push(event.eventType);
      fixture.appended.push(event);
      if (event.eventType === "OBSERVATION_REQUESTED" && event.attempt === 3) {
        throw new Error("simulated worker loss after durable request");
      }
    });

    await expect(runRuntimeStartHypothesisMeasurementContinuation(
      context(),
      fixture.deps,
    )).rejects.toThrow(/durable request/);
    expect(fixture.deps.observeRuntime).not.toHaveBeenCalled();

    const previousRequest = fixture.appended[0]!.payload as {
      requestedAt: string;
      continuationId: string;
    };
    vi.mocked(fixture.deps.loadPriorEvents).mockResolvedValue([
      sourceEvent(),
      ...fixture.appended.map((event, index) => ({
        episodeId: event.episodeId,
        projectId: registration.projectId,
        executionId: registration.executionId,
        attempt: event.attempt,
        eventType: event.eventType,
        payload: event.payload,
        sequence: index + 2,
      })),
    ] as never);
    vi.mocked(fixture.deps.appendEvent).mockImplementation(async (event) => {
      fixture.trace.push(event.eventType);
      fixture.appended.push(event);
    });

    const recovered = await runRuntimeStartHypothesisMeasurementContinuation(
      context({ attempt: 4, episodeId: "episode-after-request-crash" }),
      fixture.deps,
    );

    expect(recovered).toMatchObject({
      reasonCode: "P75_MEASUREMENT_CONTINUATION_RECORDED",
      measurementValidity: "complete_fresh",
    });
    expect(fixture.deps.observeRuntime).toHaveBeenCalledTimes(1);
    const recoveryRequest = fixture.appended.find(
      (event) => event.eventType === "OBSERVATION_REQUESTED" && event.attempt === 4,
    )?.payload as { requestedAt?: string };
    expect(recoveryRequest.requestedAt).toBe(previousRequest.requestedAt);
    expect(fixture.appended.filter(
      (event) => event.eventType === "OBSERVATION_RECORDED",
    )).toHaveLength(1);
  });

  it("reuses a materialized runtime.status observation after a crash before result persistence", async () => {
    const fixture = dependencies([sourceEvent()]);
    const persistedObservations: Array<{
      id: string;
      projectId: string;
      executionId: string;
      episodeId: string;
      sourceId: string;
      predicate: string;
      value: unknown;
      observedAt: string;
      environmentRevision: string;
      freshness: string;
      environmentFreshness: string;
    }> = [];
    vi.mocked(fixture.deps.loadPriorEvents).mockImplementation(async (current) => [
      sourceEvent(),
      ...fixture.appended
        .filter((event) => event.attempt < current.attempt)
        .map((event, index) => ({
          episodeId: event.episodeId,
          projectId: registration.projectId,
          executionId: registration.executionId,
          attempt: event.attempt,
          eventType: event.eventType,
          payload: event.payload,
          sequence: index + 2,
        })),
    ] as never);
    vi.mocked(fixture.deps.loadPriorObservations).mockImplementation(async ({ sourceIds }) =>
      persistedObservations.filter((observation) => sourceIds.includes(observation.sourceId)) as never);
    vi.mocked(fixture.deps.materializeObservation).mockImplementation(async (input) => {
      fixture.trace.push("materialize");
      const request = fixture.appended.find(
        (event) => event.eventType === "OBSERVATION_REQUESTED",
      )!.payload as { continuationId: string };
      const source = input.sources[0] as {
        sourceId: string;
        value: unknown;
        observedAt: string;
        environmentRevision?: string;
      };
      expect(source.sourceId).toBe(`${request.continuationId}:runtime.status`);
      persistedObservations.push({
        id: "observation-materialized-before-crash",
        projectId: registration.projectId,
        executionId: registration.executionId,
        episodeId: "episode-recovery",
        sourceId: source.sourceId,
        predicate: "runtime.status",
        value: source.value,
        observedAt: source.observedAt,
        environmentRevision: source.environmentRevision!,
        freshness: "fresh",
        environmentFreshness: "fresh",
      });
      return {
        observationIds: ["observation-materialized-before-crash"],
        stale: 0,
        environmentStale: 0,
      } as never;
    });
    vi.mocked(fixture.deps.appendEvent).mockImplementation(async (event) => {
      fixture.trace.push(event.eventType);
      if (event.eventType === "OBSERVATION_RECORDED" && event.attempt === 3) {
        throw new Error("simulated worker loss before result persistence");
      }
      fixture.appended.push(event);
    });

    await expect(runRuntimeStartHypothesisMeasurementContinuation(
      context(),
      fixture.deps,
    )).rejects.toThrow(/before result persistence/);
    expect(fixture.deps.observeRuntime).toHaveBeenCalledTimes(1);
    expect(persistedObservations).toHaveLength(1);
    expect(fixture.appended.filter(
      (event) => event.eventType === "OBSERVATION_RECORDED",
    )).toHaveLength(0);

    vi.mocked(fixture.deps.appendEvent).mockImplementation(async (event) => {
      fixture.trace.push(event.eventType);
      fixture.appended.push(event);
    });
    const recovered = await runRuntimeStartHypothesisMeasurementContinuation(
      context({ attempt: 4, episodeId: "episode-after-observation-crash" }),
      fixture.deps,
    );

    expect(recovered).toMatchObject({
      reasonCode: "P75_MEASUREMENT_CONTINUATION_RECORDED",
      measurementValidity: "complete_fresh",
    });
    expect(fixture.deps.observeRuntime).toHaveBeenCalledTimes(1);
    expect(fixture.deps.materializeObservation).toHaveBeenCalledTimes(1);
    const recoveredResult = fixture.appended.find(
      (event) => event.eventType === "OBSERVATION_RECORDED",
    );
    expect(recoveredResult?.payload).toMatchObject({
      observationId: "observation-materialized-before-crash",
      actualOutcomeKey: "runtime_running",
      calibrationEligibility: "not_eligible_without_versioned_policy_review",
    });
    expect(recoveredResult?.observationRefs).toEqual([
      "observation-materialized-before-crash",
    ]);
  });

  it("does not record a late P7.5 result when cancellation wins during materialization", async () => {
    const abortController = new AbortController();
    const fixture = dependencies([sourceEvent()]);
    vi.mocked(fixture.deps.materializeObservation).mockImplementation(async () => {
      abortController.abort();
      return {
        observationIds: ["observation-cancel-race"],
        stale: 0,
        environmentStale: 0,
      } as never;
    });

    await expect(runRuntimeStartHypothesisMeasurementContinuation(
      context({ signal: abortController.signal }),
      fixture.deps,
    )).rejects.toThrow(/cancelled/i);

    expect(fixture.deps.observeRuntime).toHaveBeenCalledTimes(1);
    expect(fixture.deps.materializeObservation).toHaveBeenCalledTimes(1);
    expect(fixture.appended.map((event) => event.eventType)).toEqual([
      "OBSERVATION_REQUESTED",
    ]);
  });

  it("does not turn a failed observation-store read into a runtime measurement result", async () => {
    const fixture = dependencies([sourceEvent()]);
    vi.mocked(fixture.deps.loadPriorObservations).mockRejectedValue(
      new Error("prior observation store unavailable"),
    );

    await expect(runRuntimeStartHypothesisMeasurementContinuation(
      context(),
      fixture.deps,
    )).rejects.toThrow(/prior observation store unavailable/);

    expect(fixture.deps.observeRuntime).not.toHaveBeenCalled();
    expect(fixture.appended.map((event) => event.eventType)).toEqual([
      "OBSERVATION_REQUESTED",
    ]);
  });

  it("fails before writing a request or reading runtime when already cancelled", async () => {
    const abortController = new AbortController();
    abortController.abort();
    const fixture = dependencies([sourceEvent()]);

    await expect(runRuntimeStartHypothesisMeasurementContinuation(
      context({ signal: abortController.signal }),
      fixture.deps,
    )).rejects.toThrow(/cancelled/i);

    expect(fixture.deps.loadPriorEvents).not.toHaveBeenCalled();
    expect(fixture.deps.observeRuntime).not.toHaveBeenCalled();
    expect(fixture.appended).toHaveLength(0);
  });
});