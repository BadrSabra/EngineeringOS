import { describe, expect, it } from "vitest";
import { buildActionCreditAssignment } from "./action-credit-assignment.js";

const baseInput = {
  actionId: "action-1",
  effectId: "effect-1",
  effectBundleId: "bundle-1",
  observedEffectCount: 1,
  expectedEffectCount: 1,
  beforeObservationIds: ["before-1"],
  afterObservationIds: ["after-1"],
};

describe("buildActionCreditAssignment", () => {
  it("measures observed effect coverage without claiming causality", () => {
    const assignment = buildActionCreditAssignment({
      ...baseInput,
      effectStatus: "observed",
    });

    expect(assignment).toMatchObject({
      schemaVersion: 1,
      actionId: "action-1",
      effectId: "effect-1",
      effectBundleId: "bundle-1",
      causalAttribution: {
        status: "unproven",
        reasonCode: "NO_CONTROLLED_COUNTERFACTUAL",
      },
      contributions: {
        claim: { status: "unknown", score: null, reasonCode: "CLAIM_CLOSURE_NOT_BOUND" },
        effect: { status: "measured", score: 1, reasonCode: "EXPECTED_EFFECT_COVERAGE" },
        informationGain: { status: "unknown", score: null, reasonCode: "BELIEF_DELTA_NOT_AVAILABLE" },
        failure: { status: "unknown", score: null, reasonCode: "FAILURE_CAUSE_NOT_BOUND" },
        redundancy: { status: "unknown", score: null, reasonCode: "ACTION_COMPARISON_NOT_AVAILABLE" },
      },
      evidenceRefs: ["effect-1", "bundle-1", "before-1", "after-1"],
    });
  });

  it("scores partial effect coverage against the complete expected set", () => {
    const assignment = buildActionCreditAssignment({
      ...baseInput,
      effectStatus: "partial",
      observedEffectCount: 1,
      expectedEffectCount: 2,
    });

    expect(assignment.contributions.effect).toEqual({
      status: "measured",
      score: 0.5,
      reasonCode: "EXPECTED_EFFECT_COVERAGE",
    });
    expect(assignment.causalAttribution.status).toBe("unproven");
  });

  it("records a measured zero only when direct comparison resolved no expected transition", () => {
    const assignment = buildActionCreditAssignment({
      ...baseInput,
      effectStatus: "contradicted",
      observedEffectCount: 0,
      expectedEffectCount: 1,
    });

    expect(assignment.contributions.effect).toEqual({
      status: "measured",
      score: 0,
      reasonCode: "EXPECTED_EFFECT_NOT_OBSERVED",
    });
  });

  it("keeps missing observation coverage unknown instead of treating it as failure", () => {
    const assignment = buildActionCreditAssignment({
      ...baseInput,
      effectStatus: "not_observed",
      observedEffectCount: 0,
    });

    expect(assignment.contributions.effect).toEqual({
      status: "unknown",
      score: null,
      reasonCode: "OBSERVATION_COVERAGE_INCOMPLETE",
    });
  });

  it("keeps empty effect contracts unknown and rejects invalid counts", () => {
    const empty = buildActionCreditAssignment({
      ...baseInput,
      effectStatus: "observed",
      observedEffectCount: 0,
      expectedEffectCount: 0,
    });
    expect(empty.contributions.effect).toEqual({
      status: "unknown",
      score: null,
      reasonCode: "NO_EXPECTED_EFFECTS",
    });

    expect(() => buildActionCreditAssignment({
      ...baseInput,
      effectStatus: "observed",
      observedEffectCount: 2,
      expectedEffectCount: 1,
    })).toThrow("invalid_effect_credit_counts");
  });
});