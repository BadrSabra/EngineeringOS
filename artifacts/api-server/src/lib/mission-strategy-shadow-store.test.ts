import { afterEach, describe, expect, it } from "vitest";
import {
  getMissionDecisionShadowQueueAlertStatus,
  getMissionDecisionShadowQueueAlertThresholdMs,
} from "./mission-strategy-shadow-store.js";

const originalThreshold = process.env.MISSION_DECISION_SHADOW_QUEUE_ALERT_AGE_MS;

afterEach(() => {
  if (originalThreshold === undefined) {
    delete process.env.MISSION_DECISION_SHADOW_QUEUE_ALERT_AGE_MS;
  } else {
    process.env.MISSION_DECISION_SHADOW_QUEUE_ALERT_AGE_MS = originalThreshold;
  }
});

describe("Mission strategy shadow queue delay alert", () => {
  it("opens at the configured age boundary and stays closed below it", () => {
    expect(getMissionDecisionShadowQueueAlertStatus({
      pendingCount: 2,
      oldestPendingAgeMs: 14 * 60_000 + 59_999,
    }, 15 * 60_000)).toBe("closed");
    expect(getMissionDecisionShadowQueueAlertStatus({
      pendingCount: 2,
      oldestPendingAgeMs: 15 * 60_000,
    }, 15 * 60_000)).toBe("open");
  });

  it("closes after the queue recovers or no pending age remains", () => {
    expect(getMissionDecisionShadowQueueAlertStatus({
      pendingCount: 0,
      oldestPendingAgeMs: null,
    }, 15 * 60_000)).toBe("closed");
    expect(getMissionDecisionShadowQueueAlertStatus({
      pendingCount: 1,
      oldestPendingAgeMs: null,
    }, 15 * 60_000)).toBe("closed");
  });

  it("uses a 15-minute default and rejects invalid configured thresholds", () => {
    expect(getMissionDecisionShadowQueueAlertThresholdMs(undefined)).toBe(15 * 60_000);
    expect(getMissionDecisionShadowQueueAlertThresholdMs("240000")).toBe(240_000);
    expect(() => getMissionDecisionShadowQueueAlertThresholdMs("0")).toThrow(
      "queue_alert_threshold_invalid",
    );
  });
});
