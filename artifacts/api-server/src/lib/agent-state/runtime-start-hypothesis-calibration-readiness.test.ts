import { describe, expect, it } from "vitest";
import {
  buildRuntimeStartHypothesisExperimentRegistration,
  buildRuntimeStartHypothesisExperimentResult,
  runtimeStartHypothesisCalibrationScopeRef,
  type RuntimeStartHypothesisExperimentBinding,
} from "./runtime-start-hypothesis-experiment.js";
import {
  buildRuntimeStartHypothesisMeasurementContinuationRequest,
  buildRuntimeStartHypothesisMeasurementContinuationResult,
} from "./runtime-start-hypothesis-measurement-continuation.js";
import {
  evaluateRuntimeStartHypothesisCalibrationReadiness,
  RUNTIME_START_CALIBRATION_READINESS_MAX_EXPERIMENTS,
  type RuntimeStartCalibrationReadinessInput,
} from "./runtime-start-hypothesis-calibration-readiness.js";

const baseScope = {
  projectId: "p75-readiness-project",
  projectRevision: "p75-readiness-source",
  environmentRevision: `env-v1:${"a".repeat(64)}`,
};

function binding(index: number, missionId = `mission-${index}`): RuntimeStartHypothesisExperimentBinding {
  return {
    projectId: baseScope.projectId,
    missionId,
    goalId: `goal-${index}`,
    executionId: `execution-${index}`,
    attempt: 0,
    episodeId: `episode-${index}`,
    actionId: `action-${index}`,
    planRevision: "p75-readiness-plan",
    projectRevision: baseScope.projectRevision,
    environmentRevision: baseScope.environmentRevision,
    parentWorldRevision: "b".repeat(64),
    beforeObservationIds: [`observation-before-${index}`],
    predictionRegisteredAt: "2026-09-28T10:00:00.000Z",
  };
}

function experiment(index: number, withResult = true, missionId = `mission-${index}`) {
  const registration = buildRuntimeStartHypothesisExperimentRegistration(binding(index, missionId));
  return {
    experimentId: registration.experimentId,
    missionId: registration.missionId,
    calibrationScopeRef: registration.calibrationScopeRef,
    registration,
    ...(withResult
      ? {
          result: buildRuntimeStartHypothesisExperimentResult({
            registration,
            observationRefs: [`observation-after-${index}`],
            measurementValidity: "complete_fresh",
            environmentStatus: "same_scope",
            actualOutcomeKey: "runtime_running",
            resolvedAt: "2026-09-28T10:01:00.000Z",
          }),
        }
      : {}),
  };
}

function readinessInput(
  experiments: readonly unknown[] = [],
  overrides: Partial<RuntimeStartCalibrationReadinessInput> = {},
): RuntimeStartCalibrationReadinessInput {
  return {
    candidateScope: baseScope,
    experiments,
    ...overrides,
  };
}

describe("runtime-start calibration readiness preflight", () => {
  it("never authorizes collection or computes calibration metrics", () => {
    const report = evaluateRuntimeStartHypothesisCalibrationReadiness(readinessInput());

    expect(report).toMatchObject({
      status: "review_required",
      collectionAuthorized: false,
      aggregateCalibrationAssessmentComputed: false,
      writesPerformed: false,
      selectionMode: "fixed_safe_probe",
      registeredExperimentCount: 0,
      completeCalibrationV1OutcomeCount: 0,
      unresolvedExperimentCount: 0,
      missionCountIsIndependenceProof: false,
    });
    expect(report.reviewRequired).toEqual(expect.arrayContaining([
      "controlled-environment-reset",
      "independent-sampling-definition",
      "held-out-provenance",
      "forecast-and-policy-freeze",
      "evaluator-applicability",
    ]));
    expect(report).not.toHaveProperty("expectedCalibrationError");
    expect(report).not.toHaveProperty("eceUpperBound95");
  });

  it("keeps independent Mission IDs descriptive and still requires an independence review", () => {
    const records = Array.from({ length: 30 }, (_, index) => experiment(index));
    const report = evaluateRuntimeStartHypothesisCalibrationReadiness(readinessInput(records));
    const independenceCheck = report.checks.find(
      (item) => item.id === "independent-sampling-definition",
    );

    expect(report.status).toBe("review_required");
    expect(report.distinctMissionIdCount).toBe(30);
    expect(report.missionCountIsIndependenceProof).toBe(false);
    expect(independenceCheck?.status).toBe("review_required");
    expect(report.collectionAuthorized).toBe(false);
  });

  it("blocks an unresolved registration instead of treating it as a missing sample", () => {
    const report = evaluateRuntimeStartHypothesisCalibrationReadiness(
      readinessInput([experiment(1, false)]),
    );

    expect(report.status).toBe("blocked");
    expect(report.unresolvedExperimentCount).toBe(1);
    expect(report.blockers).toContain("unresolved-registrations");
    expect(report.collectionAuthorized).toBe(false);
  });

  it("blocks an oversized snapshot and reports records that were not inspected", () => {
    const report = evaluateRuntimeStartHypothesisCalibrationReadiness(
      readinessInput(Array.from({
        length: RUNTIME_START_CALIBRATION_READINESS_MAX_EXPERIMENTS + 1,
      }, () => null)),
    );

    expect(report.status).toBe("blocked");
    expect(report.inputExperimentCount).toBe(
      RUNTIME_START_CALIBRATION_READINESS_MAX_EXPERIMENTS + 1,
    );
    expect(report.unprocessedExperimentCount).toBe(1);
    expect(report.blockers).toContain("bounded-input");
    expect(report.collectionAuthorized).toBe(false);
  });

  it("blocks a record whose registration belongs to another source or environment scope", () => {
    const otherScope = {
      ...baseScope,
      projectRevision: "p75-readiness-other-source",
    };
    const otherRegistration = buildRuntimeStartHypothesisExperimentRegistration({
      ...binding(2),
      projectRevision: otherScope.projectRevision,
    });
    const report = evaluateRuntimeStartHypothesisCalibrationReadiness(readinessInput([{
      experimentId: otherRegistration.experimentId,
      missionId: otherRegistration.missionId,
      calibrationScopeRef: otherRegistration.calibrationScopeRef,
      registration: otherRegistration,
      result: buildRuntimeStartHypothesisExperimentResult({
        registration: otherRegistration,
        observationRefs: ["observation-after-2"],
        measurementValidity: "complete_fresh",
        environmentStatus: "same_scope",
        actualOutcomeKey: "runtime_running",
        resolvedAt: "2026-09-28T10:01:00.000Z",
      }),
    }]));

    expect(otherRegistration.calibrationScopeRef).not.toBe(
      runtimeStartHypothesisCalibrationScopeRef(baseScope),
    );
    expect(report.status).toBe("blocked");
    expect(report.blockers).toContain("scope-and-record-integrity");
    expect(report.completeCalibrationV1OutcomeCount).toBe(0);
  });

  it("blocks continuation receipts from being counted as calibration-v1 outcomes", () => {
    const source = experiment(3);
    const registration = source.registration;
    const request = buildRuntimeStartHypothesisMeasurementContinuationRequest({
      registration,
      measurement: {
        projectId: registration.projectId,
        missionId: registration.missionId,
        goalId: registration.goalId,
        executionId: registration.executionId,
        attempt: registration.attempt + 1,
        episodeId: "episode-continuation-3",
        planRevision: registration.planRevision,
        projectRevision: registration.projectRevision,
        environmentRevision: registration.environmentRevision,
      },
      requestedAt: "2026-09-28T10:02:00.000Z",
    });
    const continuation = buildRuntimeStartHypothesisMeasurementContinuationResult({
      request,
      observation: {
        id: "observation-continuation-3",
        predicate: "runtime.status",
        projectRevision: registration.projectRevision,
        environmentRevision: registration.environmentRevision,
        freshness: "fresh",
        environmentFreshness: "fresh",
        outcomeKey: "runtime_running",
        observedAt: "2026-09-28T10:02:05.000Z",
      },
      resolvedAt: "2026-09-28T10:02:05.000Z",
    });
    const report = evaluateRuntimeStartHypothesisCalibrationReadiness(readinessInput([{
      ...source,
      result: continuation,
    }]));

    expect(report.status).toBe("blocked");
    expect(report.excludedContinuationResultCount).toBe(1);
    expect(report.completeCalibrationV1OutcomeCount).toBe(0);
    expect(report.blockers).toContain("continuation-exclusion");
    expect(report.collectionAuthorized).toBe(false);
  });

  it("deduplicates identical snapshots deterministically but blocks conflicting identities", () => {
    const source = experiment(4);
    const duplicate = evaluateRuntimeStartHypothesisCalibrationReadiness(
      readinessInput([source, source]),
    );
    const repeatedDuplicate = evaluateRuntimeStartHypothesisCalibrationReadiness(
      readinessInput([source, source]),
    );
    const conflicting = evaluateRuntimeStartHypothesisCalibrationReadiness(
      readinessInput([
        source,
        {
          ...source,
          result: buildRuntimeStartHypothesisExperimentResult({
            registration: source.registration,
            observationRefs: ["different-observation"],
            measurementValidity: "complete_fresh",
            environmentStatus: "same_scope",
            actualOutcomeKey: "runtime_not_running",
            resolvedAt: "2026-09-28T10:03:00.000Z",
          }),
        },
      ]),
    );

    expect(duplicate.duplicateRecordCount).toBe(1);
    expect(duplicate.readinessRef).toBe(repeatedDuplicate.readinessRef);
    expect(conflicting.status).toBe("blocked");
    expect(conflicting.blockers).toContain("unresolved-registrations");
  });

  it("returns the same report identity for the same metadata in any order", () => {
    const records = [experiment(5), experiment(6)];
    const first = evaluateRuntimeStartHypothesisCalibrationReadiness(readinessInput(records));
    const second = evaluateRuntimeStartHypothesisCalibrationReadiness(
      readinessInput([...records].reverse()),
    );

    expect(second).toEqual(first);
  });
});