import { describe, expect, it } from "vitest";
import { canonicalJsonHash } from "@workspace/ai-orchestrator";
import {
  buildRuntimeStartHypothesisExperimentRegistration,
  buildRuntimeStartHypothesisExperimentResult,
} from "./runtime-start-hypothesis-experiment.js";
import {
  evaluateRuntimeStartHypothesisCalibration,
  RuntimeStartHypothesisCalibrationAssessmentSchema,
  type RuntimeStartCalibrationExperiment,
} from "./runtime-start-hypothesis-calibration.js";
import {
  resolveRuntimeStartHypothesisReplanEvidence,
  type RuntimeStartHypothesisEpisodeEvent,
} from "./runtime-start-hypothesis-replan-context.js";

const registrationFor = (
  index: number,
  missionId = `mission-${index}`,
) => buildRuntimeStartHypothesisExperimentRegistration({
  projectId: "project-p75",
  missionId,
  goalId: `goal-${index}`,
  executionId: `execution-${index}`,
  attempt: 0,
  episodeId: `episode-${index}`,
  actionId: `action-${index}`,
  planRevision: "plan-p75",
  projectRevision: "project-revision-p75",
  environmentRevision: `env-v1:${"a".repeat(64)}`,
  parentWorldRevision: "b".repeat(64),
  beforeObservationIds: [`observation-before-${index}`],
  predictionRegisteredAt: "2026-09-26T10:00:00.000Z",
});

function fixture(legacyValidated = true) {
  const calibrationExperiments: RuntimeStartCalibrationExperiment[] =
    Array.from({ length: 90 }, (_, index) => {
      const registration = registrationFor(index);
      const actualOutcomeKey = index < 40
        ? "runtime_running"
        : index < 80
          ? "runtime_not_running"
          : "runtime_other";
      const result = buildRuntimeStartHypothesisExperimentResult({
        registration,
        observationRefs: [`observation-result-${index}`],
        measurementValidity: "complete_fresh",
        environmentStatus: "same_scope",
        actualOutcomeKey,
        resolvedAt: "2026-09-26T10:01:00.000Z",
      });
      return {
        experimentId: registration.experimentId,
        missionId: registration.missionId,
        calibrationScopeRef: registration.calibrationScopeRef,
        registration,
        result,
      };
    });
  const firstRegistration = calibrationExperiments[0]!.registration;
  if (!firstRegistration) throw new Error("Calibration fixture is missing its registration.");
  const scopeRef = firstRegistration.calibrationScopeRef;
  const thresholdAssessment = evaluateRuntimeStartHypothesisCalibration({
    calibrationScopeRef: scopeRef,
    experiments: calibrationExperiments,
  });
  expect(thresholdAssessment.status).toBe("thresholds_met_unverified");
  // Historical assessments may already have the old numeric-only validated
  // status. Keep their advisory replay compatibility without allowing new
  // evaluations to produce that status.
  const { schemaVersion, recordKind, assessmentRef, ...hashFields } = thresholdAssessment;
  const assessment = legacyValidated
    ? RuntimeStartHypothesisCalibrationAssessmentSchema.parse({
      ...thresholdAssessment,
      status: "validated_for_scope",
      assessmentRef: `p75-runtime-start-calibration:${canonicalJsonHash({
        ...hashFields,
        status: "validated_for_scope",
      })}`,
    })
    : thresholdAssessment;

  const registration = buildRuntimeStartHypothesisExperimentRegistration({
    projectId: "project-p75",
    missionId: "mission-target",
    goalId: "goal-target",
    executionId: "execution-target",
    attempt: 2,
    episodeId: "episode-target",
    actionId: "action-target",
    planRevision: "plan-target",
    projectRevision: "project-revision-p75",
    environmentRevision: `env-v1:${"a".repeat(64)}`,
    parentWorldRevision: "c".repeat(64),
    beforeObservationIds: ["observation-before-target"],
    predictionRegisteredAt: "2026-09-26T11:00:00.000Z",
    calibrationAssessment: {
      status: legacyValidated ? "validated_for_scope" : "unvalidated",
      assessmentRef: assessment.assessmentRef,
    },
  });
  const result = buildRuntimeStartHypothesisExperimentResult({
    registration,
    observationRefs: ["observation-runtime-status"],
    measurementValidity: "complete_fresh",
    environmentStatus: "same_scope",
    actualOutcomeKey: "runtime_running",
    resolvedAt: "2026-09-26T11:00:01.000Z",
  });

  const event = (
    id: string,
    sequence: number,
    eventType: string,
    payload: unknown,
  ): RuntimeStartHypothesisEpisodeEvent => ({
    id,
    episodeId: registration.episodeId,
    projectId: registration.projectId,
    executionId: registration.executionId,
    attempt: registration.attempt,
    sequence,
    eventType,
    actorType: "server",
    correlationId: registration.executionId,
    payload,
  });
  const episodeEvents = [
    event("assessment-event", 0, "OBSERVATION_RECORDED", assessment),
    event("registration-event", 1, "OBSERVATION_REQUESTED", registration),
    event("result-event", 2, "OBSERVATION_RECORDED", result),
  ];

  return {
    registration,
    result,
    assessment,
    episodeEvents,
    resultEvents: [episodeEvents[2]!],
    identity: {
      projectId: registration.projectId,
      missionId: registration.missionId,
      goalId: registration.goalId,
      planRevision: registration.planRevision,
    },
  };
}

describe("P7.5 Mission replan evidence adapter", () => {
  it("preserves advisory replay for a historical validated result bound to its episode", () => {
    const data = fixture();

    expect(resolveRuntimeStartHypothesisReplanEvidence({
      identity: data.identity,
      episodeEvents: data.episodeEvents,
      experimentResultEvents: data.resultEvents,
    })).toEqual({
      experimentId: data.registration.experimentId,
      planRevision: data.registration.planRevision,
      calibrationScopeRef: data.registration.calibrationScopeRef,
      calibrationAssessmentRef: data.assessment.assessmentRef,
      resultId: data.result.resultId,
      actualOutcomeKey: "runtime_running",
      verdict: data.result.verdict,
      observationRefs: ["observation-runtime-status"],
      supportingHypothesisIds: data.result.supportingHypothesisIds,
      contradictingHypothesisIds: data.result.contradictingHypothesisIds,
      beliefUpdateStatus: "unresolved_unvalidated_forecast",
    });
  });

  it("does not treat threshold-passing new assessments as validated replan evidence", () => {
    const data = fixture(false);
    expect(data.registration.calibrationStatus).toBe("unvalidated");
    expect(data.registration.candidate.forecasts.every(
      (forecast) => forecast.calibrationStatus === "unvalidated",
    )).toBe(true);
    expect(resolveRuntimeStartHypothesisReplanEvidence({
      identity: data.identity,
      episodeEvents: data.episodeEvents,
      experimentResultEvents: data.resultEvents,
    })).toBeUndefined();
  });

  it("fails closed on a different plan revision, duplicate result, or attempt mismatch", () => {
    const data = fixture();
    expect(resolveRuntimeStartHypothesisReplanEvidence({
      identity: { ...data.identity, planRevision: "stale-plan" },
      episodeEvents: data.episodeEvents,
      experimentResultEvents: data.resultEvents,
    })).toBeUndefined();

    expect(resolveRuntimeStartHypothesisReplanEvidence({
      identity: data.identity,
      episodeEvents: data.episodeEvents,
      experimentResultEvents: [...data.resultEvents, ...data.resultEvents],
    })).toBeUndefined();

    const duplicateRegistration = {
      ...data.episodeEvents[1]!,
      id: "duplicate-registration-event",
      sequence: 3,
    };
    expect(resolveRuntimeStartHypothesisReplanEvidence({
      identity: data.identity,
      episodeEvents: [...data.episodeEvents, duplicateRegistration],
      experimentResultEvents: data.resultEvents,
    })).toBeUndefined();

    const mismatchedAttempt = {
      ...data.resultEvents[0]!,
      attempt: data.registration.attempt + 1,
    };
    expect(resolveRuntimeStartHypothesisReplanEvidence({
      identity: data.identity,
      episodeEvents: data.episodeEvents,
      experimentResultEvents: [mismatchedAttempt],
    })).toBeUndefined();
  });

  it("does not expose unresolved measurements or a post-registration calibration assessment", () => {
    const data = fixture();
    const unresolved = buildRuntimeStartHypothesisExperimentResult({
      registration: data.registration,
      observationRefs: [],
      measurementValidity: "stale",
      environmentStatus: "unknown",
      resolvedAt: "2026-09-26T11:00:02.000Z",
    });
    const unresolvedEvent = {
      ...data.episodeEvents[2]!,
      id: "unresolved-result-event",
      payload: unresolved,
    };
    expect(resolveRuntimeStartHypothesisReplanEvidence({
      identity: data.identity,
      episodeEvents: [
        data.episodeEvents[0]!,
        data.episodeEvents[1]!,
        unresolvedEvent,
      ],
      experimentResultEvents: [unresolvedEvent],
    })).toBeUndefined();

    const assessmentAfterRegistration = [
      { ...data.episodeEvents[1]!, sequence: 0 },
      { ...data.episodeEvents[2]!, sequence: 1 },
      { ...data.episodeEvents[0]!, sequence: 2 },
    ];
    expect(resolveRuntimeStartHypothesisReplanEvidence({
      identity: data.identity,
      episodeEvents: assessmentAfterRegistration,
      experimentResultEvents: [assessmentAfterRegistration[1]!],
    })).toBeUndefined();
  });
});