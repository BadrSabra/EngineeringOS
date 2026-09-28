import { describe, expect, it } from "vitest";
import {
  buildRuntimeStartHypothesisExperimentRegistration,
  buildRuntimeStartHypothesisExperimentResult,
  parseRuntimeStartHypothesisExperimentResult,
  type RuntimeStartHypothesisExperimentResult,
} from "./runtime-start-hypothesis-experiment.js";
import {
  buildRuntimeStartHypothesisMeasurementContinuationRequest,
  buildRuntimeStartHypothesisMeasurementContinuationResult,
} from "./runtime-start-hypothesis-measurement-continuation.js";
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
  missionId = `mission-${index}`,
): RuntimeStartCalibrationExperiment {
  const registration = buildRuntimeStartHypothesisExperimentRegistration({
    projectId: "project-calibration",
    missionId,
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

function continuationResultFor(source: RuntimeStartCalibrationExperiment) {
  const registration = source.registration!;
  const request = buildRuntimeStartHypothesisMeasurementContinuationRequest({
    registration,
    measurement: {
      projectId: registration.projectId,
      missionId: registration.missionId,
      goalId: registration.goalId,
      executionId: registration.executionId,
      attempt: registration.attempt + 1,
      episodeId: `episode-continuation-${registration.episodeId}`,
      planRevision: registration.planRevision,
      projectRevision: registration.projectRevision,
      environmentRevision: registration.environmentRevision,
    },
    requestedAt: "2026-09-26T10:02:00.000Z",
  });
  return buildRuntimeStartHypothesisMeasurementContinuationResult({
    request,
    observation: {
      id: `observation-continuation-${registration.episodeId}`,
      predicate: "runtime.status",
      projectRevision: registration.projectRevision,
      environmentRevision: registration.environmentRevision,
      freshness: "fresh",
      environmentFreshness: "fresh",
      outcomeKey: "runtime_running",
      observedAt: "2026-09-26T10:02:05.000Z",
    },
    resolvedAt: "2026-09-26T10:02:05.000Z",
  });
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
    const resumedAttempt = experiment(91, "runtime_running", pending.missionId);
    const evaluation = evaluateRuntimeStartHypothesisCalibration({
      calibrationScopeRef: calibrationScopeRef(),
      experiments: [...complete, { ...pending, result: undefined }, resumedAttempt],
    });

    expect(evaluation.status).toBe("incomplete_measurements");
    expect(evaluation.unresolvedExperimentCount).toBe(1);
    expect(evaluation.usableOutcomeCount).toBe(91);
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

  it("matches a hand-calculated classwise ECE with a rare observed class and an absent class", () => {
    const outcomes: Array<"runtime_running" | "runtime_not_running" | "runtime_other"> = [
      ...Array.from({ length: 49 }, () => "runtime_running" as const),
      ...Array.from({ length: 40 }, () => "runtime_not_running" as const),
      "runtime_other",
    ];
    const evaluation = evaluateRuntimeStartHypothesisCalibration({
      calibrationScopeRef: calibrationScopeRef(),
      experiments: outcomes.map((outcome, index) => experiment(index, outcome)),
    });

    // The fixed forecast is 4/9, 4/9, 1/9, 0. The running and rare
    // runtime_other classes each differ by 0.1; their mean over four classes
    // is 0.05. runtime_unexpected is absent from observations and forecasts.
    expect(evaluation.expectedCalibrationError).toBeCloseTo(0.05, 10);
    expect(evaluation.independentMissionCount).toBe(90);
  });

  it("counts repeated samples from one Mission as one independent cluster", () => {
    const experiments = Array.from({ length: 30 }, (_, index) =>
      experiment(index, "runtime_running", `mission-${index % 15}`));
    const evaluation = evaluateRuntimeStartHypothesisCalibration({
      calibrationScopeRef: calibrationScopeRef(),
      experiments,
    });

    expect(evaluation.status).toBe("insufficient_data");
    expect(evaluation.usableOutcomeCount).toBe(30);
    expect(evaluation.independentMissionCount).toBe(15);
    expect(evaluation.eceUpperBound95).not.toBeNull();
  });

  it("uses Mission clusters for the bootstrap uncertainty bound", () => {
    const clustered: RuntimeStartCalibrationExperiment[] = [];
    const dispersed: RuntimeStartCalibrationExperiment[] = [];
    const addPair = (
      target: RuntimeStartCalibrationExperiment[],
      counter: { value: number },
      missionId: string,
      first: "runtime_running" | "runtime_not_running" | "runtime_other",
      second: "runtime_running" | "runtime_not_running" | "runtime_other",
    ) => {
      target.push(experiment(counter.value++, first, missionId));
      target.push(experiment(counter.value++, second, missionId));
    };
    const clusteredCounter = { value: 0 };
    const dispersedCounter = { value: 0 };

    // Same marginal outcome counts (27 running, 27 not running, 6 other),
    // with the rare outcome either concentrated into three clusters or spread
    // across six clusters.
    for (let mission = 0; mission < 3; mission += 1) {
      addPair(clustered, clusteredCounter, `clustered-${mission}`, "runtime_other", "runtime_other");
    }
    for (let mission = 3; mission < 16; mission += 1) {
      addPair(clustered, clusteredCounter, `clustered-${mission}`, "runtime_running", "runtime_running");
    }
    for (let mission = 16; mission < 29; mission += 1) {
      addPair(clustered, clusteredCounter, `clustered-${mission}`, "runtime_not_running", "runtime_not_running");
    }
    addPair(clustered, clusteredCounter, "clustered-29", "runtime_running", "runtime_not_running");

    for (let mission = 0; mission < 3; mission += 1) {
      addPair(dispersed, dispersedCounter, `dispersed-${mission}`, "runtime_other", "runtime_running");
    }
    for (let mission = 3; mission < 6; mission += 1) {
      addPair(dispersed, dispersedCounter, `dispersed-${mission}`, "runtime_other", "runtime_not_running");
    }
    for (let mission = 6; mission < 18; mission += 1) {
      addPair(dispersed, dispersedCounter, `dispersed-${mission}`, "runtime_running", "runtime_running");
    }
    for (let mission = 18; mission < 30; mission += 1) {
      addPair(dispersed, dispersedCounter, `dispersed-${mission}`, "runtime_not_running", "runtime_not_running");
    }

    const clusteredEvaluation = evaluateRuntimeStartHypothesisCalibration({
      calibrationScopeRef: calibrationScopeRef(),
      experiments: clustered,
    });
    const dispersedEvaluation = evaluateRuntimeStartHypothesisCalibration({
      calibrationScopeRef: calibrationScopeRef(),
      experiments: dispersed,
    });
    const repeatedClusteredEvaluation = evaluateRuntimeStartHypothesisCalibration({
      calibrationScopeRef: calibrationScopeRef(),
      experiments: [...clustered].reverse(),
    });

    expect(clusteredEvaluation.usableOutcomeCount).toBe(60);
    expect(clusteredEvaluation.independentMissionCount).toBe(30);
    expect(dispersedEvaluation.independentMissionCount).toBe(30);
    expect(clusteredEvaluation.expectedCalibrationError)
      .toBeCloseTo(dispersedEvaluation.expectedCalibrationError!, 12);
    expect(clusteredEvaluation.eceUpperBound95).toBeGreaterThan(
      dispersedEvaluation.eceUpperBound95!,
    );
    expect(repeatedClusteredEvaluation.eceUpperBound95)
      .toBe(clusteredEvaluation.eceUpperBound95);
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

  it("does not count a fresh P7.5 continuation result in the calibration cohort", () => {
    const source = experiment(222);
    const continuationResult = continuationResultFor(source);

    expect(continuationResult).toMatchObject({
      measurementValidity: "complete_fresh",
      actualOutcomeKey: "runtime_running",
      calibrationEligibility: "not_eligible_without_versioned_policy_review",
    });
    expect(() => parseRuntimeStartHypothesisExperimentResult(continuationResult)).toThrow();

    const evaluation = evaluateRuntimeStartHypothesisCalibration({
      calibrationScopeRef: source.calibrationScopeRef,
      experiments: [{
        ...source,
        result: continuationResult as unknown as RuntimeStartHypothesisExperimentResult,
      }],
    });

    expect(evaluation.status).toBe("incomplete_measurements");
    expect(evaluation.registeredExperimentCount).toBe(1);
    expect(evaluation.usableOutcomeCount).toBe(0);
    expect(evaluation.unresolvedExperimentCount).toBe(1);
    expect(evaluation.independentMissionCount).toBe(0);
  });
});