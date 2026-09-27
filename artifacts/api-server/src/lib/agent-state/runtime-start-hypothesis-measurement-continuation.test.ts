import { describe, expect, it } from "vitest";
import {
  buildRuntimeStartHypothesisMeasurementContinuationRequest,
  buildRuntimeStartHypothesisMeasurementContinuationResult,
  parseRuntimeStartHypothesisMeasurementContinuationRequest,
  parseRuntimeStartHypothesisMeasurementContinuationResult,
  RuntimeStartHypothesisMeasurementContinuationRequestSchema,
} from "./runtime-start-hypothesis-measurement-continuation.js";
import { buildRuntimeStartHypothesisExperimentRegistration } from "./runtime-start-hypothesis-experiment.js";

const registration = buildRuntimeStartHypothesisExperimentRegistration({
  projectId: "project-p75",
  missionId: "mission-p75",
  goalId: "goal-p75",
  executionId: "execution-p75",
  attempt: 2,
  episodeId: "episode-original",
  actionId: "action-original",
  planRevision: "plan-revision-p75",
  projectRevision: "project-revision-p75",
  environmentRevision: `env-v1:${"a".repeat(64)}`,
  parentWorldRevision: "b".repeat(64),
  beforeObservationIds: ["observation-before-p75"],
  predictionRegisteredAt: "2026-09-28T10:00:00.000Z",
});

const buildRequest = (overrides: {
  attempt?: number;
  episodeId?: string;
  projectId?: string;
  missionId?: string;
  goalId?: string;
  planRevision?: string;
  projectRevision?: string;
  environmentRevision?: string;
  requestedAt?: string;
} = {}) => buildRuntimeStartHypothesisMeasurementContinuationRequest({
  registration,
  measurement: {
    projectId: overrides.projectId ?? registration.projectId,
    missionId: overrides.missionId ?? registration.missionId,
    goalId: overrides.goalId ?? registration.goalId,
    executionId: registration.executionId,
    attempt: overrides.attempt ?? 3,
    episodeId: overrides.episodeId ?? "episode-recovery",
    planRevision: overrides.planRevision ?? registration.planRevision,
    projectRevision: overrides.projectRevision ?? registration.projectRevision,
    environmentRevision: overrides.environmentRevision ?? registration.environmentRevision,
  },
  requestedAt: overrides.requestedAt ?? "2026-09-28T10:01:00.000Z",
});

describe("runtime-start hypothesis measurement continuation", () => {
  it("binds a new read-only measurement identity to the immutable source registration", () => {
    const request = buildRequest();
    const exactReplay = buildRequest();
    const differentRequestTime = buildRequest({ requestedAt: "2026-09-28T10:02:00.000Z" });

    expect(request).toMatchObject({
      recordKind: "P75_HYPOTHESIS_MEASUREMENT_CONTINUATION_REQUESTED",
      policyVersion: "runtime-start-observe-only-continuation-v1",
      source: {
        experimentId: registration.experimentId,
        attempt: registration.attempt,
        episodeId: registration.episodeId,
        actionId: registration.actionId,
      },
      measurement: {
        executionId: registration.executionId,
        attempt: registration.attempt + 1,
        episodeId: "episode-recovery",
      },
      operationKind: "server_owned_read_only_observation",
      observationProfile: "runtime.status",
      observationRef: "workspace-runtime.status-after-start.v1",
    });
    expect(request.source.registrationHash).toMatch(/^[a-f0-9]{64}$/);
    expect(request.continuationId).toBe(exactReplay.continuationId);
    expect(request.continuationId).not.toBe(differentRequestTime.continuationId);
    expect(parseRuntimeStartHypothesisMeasurementContinuationRequest(request)).toEqual(request);
  });

  it("fails closed on attempt, Episode, project revision, or environment revision drift", () => {
    expect(() => buildRequest({ attempt: registration.attempt })).toThrow();
    expect(() => buildRequest({ episodeId: registration.episodeId })).toThrow();
    expect(() => buildRequest({ projectId: "different-project" })).toThrow();
    expect(() => buildRequest({ missionId: "different-mission" })).toThrow();
    expect(() => buildRequest({ goalId: "different-goal" })).toThrow();
    expect(() => buildRequest({ planRevision: "different-plan-revision" })).toThrow();
    expect(() => buildRequest({ projectRevision: "different-project-revision" })).toThrow();
    expect(() => buildRequest({
      environmentRevision: `env-v1:${"c".repeat(64)}`,
    })).toThrow();
  });

  it("rejects effect-capable fields from the strict observe-only request", () => {
    const request = buildRequest();

    expect(RuntimeStartHypothesisMeasurementContinuationRequestSchema.safeParse({
      ...request,
      shellCommand: "start runtime",
    }).success).toBe(false);
  });

  it("records only a fresh, same-scope runtime-status observation as an outcome", () => {
    const request = buildRequest();
    const result = buildRuntimeStartHypothesisMeasurementContinuationResult({
      request,
      observation: {
        id: "observation-runtime-status-recovered",
        predicate: "runtime.status",
        projectRevision: registration.projectRevision,
        environmentRevision: registration.environmentRevision,
        freshness: "fresh",
        environmentFreshness: "fresh",
        outcomeKey: "runtime_running",
        observedAt: "2026-09-28T10:01:05.000Z",
      },
      resolvedAt: "2026-09-28T10:01:05.000Z",
    });

    expect(result).toMatchObject({
      recordKind: "P75_HYPOTHESIS_MEASUREMENT_CONTINUATION_RESULT",
      continuationId: request.continuationId,
      sourceExperimentId: registration.experimentId,
      measurementValidity: "complete_fresh",
      environmentStatus: "same_scope",
      actualOutcomeKey: "runtime_running",
      calibrationEligibility: "not_eligible_without_versioned_policy_review",
    });
    expect(parseRuntimeStartHypothesisMeasurementContinuationResult(result, request))
      .toEqual(result);
    expect(result.resultId).toBe(buildRuntimeStartHypothesisMeasurementContinuationResult({
      request,
      observation: {
        id: "observation-runtime-status-recovered",
        predicate: "runtime.status",
        projectRevision: registration.projectRevision,
        environmentRevision: registration.environmentRevision,
        freshness: "fresh",
        environmentFreshness: "fresh",
        outcomeKey: "runtime_running",
        observedAt: "2026-09-28T10:01:05.000Z",
      },
      resolvedAt: "2026-09-28T10:01:05.000Z",
    }).resultId);
  });

  it("keeps stale or changed-scope observations inconclusive and uncounted", () => {
    const request = buildRequest();
    const result = buildRuntimeStartHypothesisMeasurementContinuationResult({
      request,
      observation: {
        id: "observation-runtime-status-stale",
        predicate: "runtime.status",
        projectRevision: "new-project-revision",
        environmentRevision: registration.environmentRevision,
        freshness: "fresh",
        environmentFreshness: "fresh",
        outcomeKey: "runtime_running",
        observedAt: "2026-09-28T10:01:05.000Z",
      },
      resolvedAt: "2026-09-28T10:01:05.000Z",
    });

    expect(result).toMatchObject({
      measurementValidity: "stale",
      environmentStatus: "changed",
      calibrationEligibility: "not_eligible_without_versioned_policy_review",
    });
    expect(result).not.toHaveProperty("actualOutcomeKey");
  });

  it("rejects a measurement timestamp that predates the continuation request", () => {
    const request = buildRequest();

    expect(() => buildRuntimeStartHypothesisMeasurementContinuationResult({
      request,
      observation: {
        id: "observation-runtime-status-before-request",
        predicate: "runtime.status",
        projectRevision: registration.projectRevision,
        environmentRevision: registration.environmentRevision,
        freshness: "fresh",
        environmentFreshness: "fresh",
        outcomeKey: "runtime_running",
        observedAt: "2026-09-28T10:00:59.000Z",
      },
      resolvedAt: "2026-09-28T10:01:05.000Z",
    })).toThrow();
  });

  it("rejects a result replayed against a different continuation request", () => {
    const request = buildRequest();
    const otherRequest = buildRequest({ attempt: 4, episodeId: "episode-recovery-next" });
    const result = buildRuntimeStartHypothesisMeasurementContinuationResult({
      request,
      unavailableAs: "unknown",
      resolvedAt: "2026-09-28T10:01:05.000Z",
    });

    expect(() => parseRuntimeStartHypothesisMeasurementContinuationResult(
      result,
      otherRequest,
    )).toThrow();
  });
});