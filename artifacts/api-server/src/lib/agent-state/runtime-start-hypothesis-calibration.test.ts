import { describe, expect, it } from "vitest";
import {
  buildRuntimeStartHypothesisExperimentRegistration,
  buildRuntimeStartHypothesisExperimentResult,
  type RuntimeStartHypothesisExperimentResult,
} from "./runtime-start-hypothesis-experiment.js";
import {
  evaluateRuntimeStartHypothesisCalibration,
  RUNTIME_START_CALIBRATION_MINIMUM_MISSIONS,
  type RuntimeStartCalibrationExperiment,
} from "./runtime-start-hypothesis-calibration.js";

const calibrationScopeRef = () => buildRuntimeStartHypothesisExperimentRegistration({
  projectId: "project-calibration",
  missionId: "mission-scope",
  goalId: "goal-scope",
  executionId: "execution-scope",
  attempt: 0,
  episodeId: "episode-scope",
  actionId: "action-scope",
  planRevision: "plan-calibration",
  projectRevision: "project-calibration-revision",
  environmentRevision: `env-v1:${"a".repeat(64)}`,
  parentWorldRevision: "b".repeat(64),
  beforeObservationIds: ["observation-before-scope"],
  predictionRegisteredAt: "2026-09-26T10:00:00.000Z",
}).calibrationScopeRef;

function experiment(
  index: number,
  actualOutcomeKey: "runtime_running" | "runtime_not_running" | "runtime_other" = "runtime_running",
): RuntimeStartCalibrationExperiment {
  const registration = buildRuntimeStartHypothesisExperimentRegistration({
    projectId: "project-calibration",
    missionId: `mission-${index}`,
    goalId: `goal-${index}`,
    executionId: `execution-${index}`,
    attempt: 0,
    episodeId: `episode-${index}`,
    actionId: `action-${index}`,
    planRevision: "plan-calibration",
    projectRevision: "project-calibration-revision",
    environmentRevision: `env-v1:${"a".repeat(64)}`,
    parentWorldRevision: "b".repeat(64),
    beforeObservationIds: [`observation-before-${index}`],
    predictionRegisteredAt: "2026-09-26T10:00:00.000Z",
  });
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
}

describe("runtime-start hypothesis calibration", () => {
  it("validates only pre-registered, complete same-scope held-out outcomes", () => {
    const outcomes: Array<"runtime_running" | "runtime_not_running" | "runtime_other"> = [
      ...Array.from({ length: 40 }, () => "runtime_running" as const),
      ...Array.from({ length: 40 }, () => "runtime_not_running" as const),
      ...Array.from({ length: 10 }, () => "runtime_other" as const),
    ];
    const experiments = outcomes.map((outcome, index) => experiment(index, outcome));
    const evaluation = evaluateRuntimeStartHypothesisCalibration({
      calibrationScopeRef: calibrationScopeRef(),
      experiments,
    });

    expect(evaluation.status).toBe("validated_for_scope");
    expect(evaluation.independentMissionCount).toBe(90);
    expect(evaluation.expectedCalibrationError).toBeLessThanOrEqual(0.15);
    expect(evaluation.eceUpperBound95).toBeLessThanOrEqual(0.15);
    expect(evaluateRuntimeStartHypothesisCalibration({
      calibrationScopeRef: calibrationScopeRef(),
      experiments,
    }).assessmentRef).toBe(evaluation.assessmentRef);
  });

  it("keeps a good-looking score unvalidated when any registered experiment is unresolved", () => {
    const complete = Array.from({ length: 90 }, (_, index) => {
      const outcome = index < 40
        ? "runtime_running"
        : index < 80 ? "runtime_not_running" : "runtime_other";
      return experiment(index, outcome);
    });
    const pending = experiment(90);
    const evaluation = evaluateRuntimeStartHypothesisCalibration({
      calibrationScopeRef: calibrationScopeRef(),
      experiments: [...complete, { ...pending, result: undefined }],
    });

    expect(evaluation.status).toBe("incomplete_measurements");
    expect(evaluation.unresolvedExperimentCount).toBe(1);
    expect(evaluation.assessmentRef).toMatch(/^p75-runtime-start-calibration:[a-f0-9]{64}$/);
  });

  it("does not validate a forecast that misses the held-out outcome frequencies", () => {
    const experiments = Array.from(
      { length: RUNTIME_START_CALIBRATION_MINIMUM_MISSIONS },
      (_, index) => experiment(index, "runtime_running"),
    );
    const evaluation = evaluateRuntimeStartHypothesisCalibration({
      calibrationScopeRef: calibrationScopeRef(),
      experiments,
    });

    expect(evaluation.status).toBe("threshold_not_met");
    expect(evaluation.expectedCalibrationError).toBeGreaterThan(0.15);
    expect(evaluation.eceUpperBound95).toBeGreaterThan(0.15);
  });

  it("marks too few independent missions as insufficient", () => {
    const experiments = Array.from(
      { length: RUNTIME_START_CALIBRATION_MINIMUM_MISSIONS - 1 },
      (_, index) => experiment(index),
    );
    const evaluation = evaluateRuntimeStartHypothesisCalibration({
      calibrationScopeRef: calibrationScopeRef(),
      experiments,
    });

    expect(evaluation.status).toBe("insufficient_data");
    expect(evaluation.independentMissionCount).toBe(29);
  });

  it("treats a result whose forecast differs from its immutable registration as unresolved", () => {
    const valid = experiment(1);
    const result = valid.result!;
    const mismatchedResult = {
      ...result,
      marginalOutcomeProbabilities: result.marginalOutcomeProbabilities!.map((item) => ({
        ...item,
        probability: item.outcomeKey === "runtime_running"
          ? item.probability + 0.1
          : item.outcomeKey === "runtime_not_running"
            ? item.probability - 0.1
            : item.probability,
      })),
    } as RuntimeStartHypothesisExperimentResult;
    const evaluation = evaluateRuntimeStartHypothesisCalibration({
      calibrationScopeRef: valid.calibrationScopeRef,
      experiments: [{ ...valid, result: mismatchedResult }],
    });

    expect(evaluation.status).toBe("incomplete_measurements");
    expect(evaluation.unresolvedExperimentCount).toBe(1);
  });
});