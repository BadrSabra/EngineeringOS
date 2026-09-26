import { describe, expect, it } from "vitest";
import {
  buildRuntimeStartHypothesisExperimentRegistration,
  buildRuntimeStartHypothesisExperimentResult,
  parseRuntimeStartHypothesisExperimentRegistration,
} from "./runtime-start-hypothesis-experiment.js";

const registration = (
  overrides: Partial<Parameters<typeof buildRuntimeStartHypothesisExperimentRegistration>[0]> = {},
) => buildRuntimeStartHypothesisExperimentRegistration({
  projectId: "project-p75",
  missionId: "mission-p75",
  goalId: "goal-p75",
  executionId: "execution-p75",
  attempt: 0,
  episodeId: "episode-p75",
  actionId: "action:execution-p75:0:runtime-start",
  planRevision: "plan-revision-p75",
  projectRevision: "project-revision-p75",
  environmentRevision: `env-v1:${"a".repeat(64)}`,
  parentWorldRevision: "b".repeat(64),
  beforeObservationIds: ["observation-before-p75"],
  predictionRegisteredAt: "2026-09-26T10:00:00.000Z",
  ...overrides,
});

describe("runtime-start hypothesis experiment", () => {
  it("shares calibration only across missions with the same project and environment revisions", () => {
    const base = registration();
    expect(registration({ missionId: "mission-another" }).calibrationScopeRef)
      .toBe(base.calibrationScopeRef);
    expect(registration({ projectRevision: "project-revision-next" }).calibrationScopeRef)
      .not.toBe(base.calibrationScopeRef);
    expect(registration({ environmentRevision: `env-v1:${"c".repeat(64)}` }).calibrationScopeRef)
      .not.toBe(base.calibrationScopeRef);
  });

  it("requires an assessment reference before marking forecasts calibrated", () => {
    expect(() => registration({
      calibrationAssessment: { status: "validated_for_scope" },
    })).toThrow();
  });

  it("registers a normalized exhaustive bootstrap belief and a fixed safe probe", () => {
    const contract = registration();
    const weights = contract.hypotheses.map(({ beliefWeight }) => beliefWeight);

    expect(contract).toMatchObject({
      objectiveContractId: "runtime.start.verified-serving-state.v1",
      hypothesisSetId: "runtime.start.effect-outcome.v1",
      selectionMode: "fixed_safe_probe",
      calibrationStatus: "unvalidated",
      evaluationPartition: "runtime-start-fixed-policy-held-out-v1",
      candidate: {
        decisionValueStatus: "not_computed_bootstrap",
        authorizationDecision: "allowed",
        forecasts: expect.arrayContaining([
          expect.objectContaining({ calibrationStatus: "unvalidated" }),
        ]),
      },
      contextObservationIds: ["observation-before-p75"],
    });
    expect(weights.reduce((sum, weight) => sum + weight, 0)).toBeCloseTo(1);
    expect(contract.hypotheses.map(({ hypothesisId }) => hypothesisId)).toContain("OTHER_UNKNOWN");
    expect(contract.candidate.expectedInformationGain).toBeGreaterThan(0);
    expect(contract.candidate.expectedInformationGain).toBeLessThan(Math.log2(3));
    expect(parseRuntimeStartHypothesisExperimentRegistration(contract)).toEqual(contract);
    const reorderedForecasts = {
      ...contract,
      candidate: {
        ...contract.candidate,
        forecasts: [...contract.candidate.forecasts].reverse(),
      },
    };
    expect(parseRuntimeStartHypothesisExperimentRegistration(reorderedForecasts))
      .toEqual(reorderedForecasts);
  });

  it("records supported and contradicted hypotheses without updating uncalibrated belief", () => {
    const contract = registration();
    const result = buildRuntimeStartHypothesisExperimentResult({
      registration: contract,
      observationRefs: ["observation-runtime-status"],
      measurementValidity: "complete_fresh",
      environmentStatus: "same_scope",
      actualOutcomeKey: "runtime_running",
      resolvedAt: "2026-09-26T10:00:01.000Z",
    });

    expect(result).toMatchObject({
      experimentId: contract.experimentId,
      verdict: "matched",
      actualOutcomeKey: "runtime_running",
      supportingHypothesisIds: [
        "runtime_effect_applied_but_not_observed",
        "OTHER_UNKNOWN",
      ],
      contradictingHypothesisIds: ["runtime_effect_not_applied"],
      beliefUpdateStatus: "unresolved_unvalidated_forecast",
      observationRefs: ["observation-runtime-status"],
    });
    expect(result.predictionErrorScore).toBeCloseTo(14 / 27);
    expect(result.marginalOutcomeProbabilities).toHaveLength(4);
    expect(buildRuntimeStartHypothesisExperimentResult({
      registration: contract,
      observationRefs: ["observation-runtime-status"],
      measurementValidity: "complete_fresh",
      environmentStatus: "same_scope",
      actualOutcomeKey: "runtime_running",
      resolvedAt: "2026-09-26T10:00:02.000Z",
    }).resultId).toBe(result.resultId);
  });

  it("keeps stale, partial, or changed-scope measurements inconclusive", () => {
    const result = buildRuntimeStartHypothesisExperimentResult({
      registration: registration(),
      observationRefs: ["stale-runtime-status"],
      measurementValidity: "stale",
      environmentStatus: "changed",
      resolvedAt: "2026-09-26T10:00:02.000Z",
    });

    expect(result).toMatchObject({
      verdict: "inconclusive",
      measurementValidity: "stale",
      environmentStatus: "changed",
      observationRefs: ["stale-runtime-status"],
      supportingHypothesisIds: [],
      contradictingHypothesisIds: [],
    });
    expect(result).not.toHaveProperty("actualOutcomeKey");
    expect(result).not.toHaveProperty("predictionErrorScore");
  });

  it("rejects non-normalized server-owned weights", () => {
    const contract = registration();
    const invalid = {
      ...contract,
      hypotheses: contract.hypotheses.map((hypothesis, index) =>
        index === 0
          ? { ...hypothesis, beliefWeight: hypothesis.beliefWeight + 0.2 }
          : hypothesis,
      ),
    };

    expect(() => parseRuntimeStartHypothesisExperimentRegistration(invalid)).toThrow();
  });
});