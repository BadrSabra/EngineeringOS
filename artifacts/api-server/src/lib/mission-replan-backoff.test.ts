import { describe, expect, it } from "vitest";
import {
  isMissionReplanBackoffActive,
  missionReplanBackoffDelayMs,
  parseMissionReplanBackoff,
} from "./mission-replan-backoff.js";
import { updateCanonicalMissionAutonomyPolicy } from "./mission-autonomy-policy.js";

describe("Mission replan durable backoff", () => {
  it("uses bounded exponential delays independent of the automatic replan budget", () => {
    expect([1, 2, 3, 4, 5, 6, 7, 8].map(missionReplanBackoffDelayMs)).toEqual([
      30_000,
      60_000,
      120_000,
      240_000,
      480_000,
      960_000,
      1_800_000,
      1_800_000,
    ]);
  });

  it("fails open for malformed legacy backoff state and waits only before the persisted deadline", () => {
    expect(parseMissionReplanBackoff({ attemptCount: -1 })).toBeNull();
    const state = {
      schemaVersion: 1,
      attemptCount: 2,
      lastAttemptAt: "2026-11-21T00:00:00.000Z",
      nextAttemptAt: "2026-11-21T00:01:00.000Z",
      lastFailureCode: "planner_unavailable",
    };
    expect(isMissionReplanBackoffActive(state, new Date("2026-11-21T00:00:30.000Z"))).toBe(true);
    expect(isMissionReplanBackoffActive(state, new Date("2026-11-21T00:01:00.000Z"))).toBe(false);
  });

  it("keeps the server-owned backoff marker when a client updates autonomy policy", () => {
    const current = {
      mode: "autonomous",
      maxAutoReplans: 3,
      automaticReplanBackoff: {
        schemaVersion: 1,
        attemptCount: 4,
        lastAttemptAt: "2026-11-21T00:00:00.000Z",
        nextAttemptAt: "2026-11-21T00:08:00.000Z",
        lastFailureCode: "planner_unavailable",
      },
    };
    const updated = updateCanonicalMissionAutonomyPolicy(current, {
      automaticReplanBackoff: null,
      maxAutoReplans: 5,
    });
    expect(updated.automaticReplanBackoff).toEqual(current.automaticReplanBackoff);
    expect(updated.maxAutoReplans).toBe(5);
  });
});
