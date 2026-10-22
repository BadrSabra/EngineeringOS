import { describe, expect, it } from "vitest";
import {
  normalizeMissionAutonomyPolicy,
  updateCanonicalMissionAutonomyPolicy,
  writeCanonicalMissionAutonomyPolicy,
} from "./mission-autonomy-policy.js";

describe("Mission autonomy policy normalization", () => {
  it("defaults to assisted and fails closed for malformed or absent replan limits", () => {
    expect(normalizeMissionAutonomyPolicy({})).toMatchObject({
      mode: "assisted",
      allowAutoContinue: false,
      maxAutoReplans: 0,
      automaticReplanCount: 0,
      allowAutoPush: false,
      requireHumanForExternalDelivery: true,
    });
    expect(normalizeMissionAutonomyPolicy({
      mode: "unknown",
      allowAutoContinue: true,
      maxAutoReplans: 4,
    })).toMatchObject({
      mode: "assisted",
      allowAutoContinue: false,
      maxAutoReplans: 0,
    });
    expect(normalizeMissionAutonomyPolicy({
      mode: "autonomous",
      maxAutoReplans: "4",
      maxAutomaticReplans: 7,
    }).maxAutoReplans).toBe(0);
  });

  it("normalizes canonical and legacy bounds without widening or exceeding the hard limit", () => {
    expect(normalizeMissionAutonomyPolicy({
      mode: "autonomous",
      maxAutoReplans: 1,
      maxAutomaticReplans: 4,
    }).maxAutoReplans).toBe(1);
    expect(normalizeMissionAutonomyPolicy({
      mode: "autonomous",
      maxAutomaticReplans: 4,
    }).maxAutoReplans).toBe(4);
    expect(normalizeMissionAutonomyPolicy({
      mode: "autonomous",
      maxAutoReplans: 10,
    }).maxAutoReplans).toBe(10);
    for (const value of [-1, 1.5, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(normalizeMissionAutonomyPolicy({
        mode: "autonomous",
        maxAutoReplans: value,
      }).maxAutoReplans).toBe(0);
    }
    expect(normalizeMissionAutonomyPolicy({
      mode: "autonomous",
      maxAutoReplans: 11,
    }).maxAutoReplans).toBe(10);
  });

  it("treats malformed persisted counts as exhausted and canonicalizes legacy values safely", () => {
    expect(normalizeMissionAutonomyPolicy({
      mode: "autonomous",
      maxAutoReplans: 3,
      automaticReplanCount: "1",
    }).automaticReplanCount).toBe(10);

    const canonical = writeCanonicalMissionAutonomyPolicy({
      mode: "autonomous",
      maxAutomaticReplans: 2,
      automaticReplanCount: 1,
      allowAutoContinue: true,
      allowAutoPush: true,
      requireHumanForExternalDelivery: false,
      operatorNote: "preserved",
    });
    expect(canonical).toMatchObject({
      mode: "autonomous",
      maxAutoReplans: 2,
      automaticReplanCount: 1,
      allowAutoContinue: true,
      allowAutoPush: false,
      requireHumanForExternalDelivery: true,
      operatorNote: "preserved",
    });
    expect(canonical).not.toHaveProperty("maxAutomaticReplans");
  });

  it("migrates policy updates while preserving the server-owned replan budget and identity", () => {
    const updated = updateCanonicalMissionAutonomyPolicy(
      {
        mode: "autonomous",
        maxAutomaticReplans: 5,
        automaticReplanCount: 2,
        lastAutomaticReplanRevision: "auto:goal:revision",
        activePlanRevision: "plan-current",
        handoffSource: { sessionId: "session-current" },
        operatorNote: "existing note",
      },
      {
        maxAutoReplans: 3,
        automaticReplanCount: 0,
        lastAutomaticReplanRevision: "attacker-selected-revision",
        activePlanRevision: "attacker-selected-plan",
        handoffSource: { sessionId: "another-session" },
        operatorNote: "updated note",
      },
    );

    expect(updated).toMatchObject({
      mode: "autonomous",
      maxAutoReplans: 3,
      automaticReplanCount: 2,
      lastAutomaticReplanRevision: "auto:goal:revision",
      activePlanRevision: "plan-current",
      handoffSource: { sessionId: "session-current" },
      operatorNote: "updated note",
    });
    expect(updated).not.toHaveProperty("maxAutomaticReplans");
  });
});
