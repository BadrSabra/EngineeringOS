import { describe, expect, it } from "vitest";
import { resolveMissionDecisionShadowProjectScope } from "./mission-decision-shadow-scope.js";

const canaryProjectId = "cfb1a4f5-68c7-4f65-9fe3-4ef71d0653d2";

describe("resolveMissionDecisionShadowProjectScope", () => {
  it("is disabled unless the server-side mode flag is enabled", () => {
    expect(resolveMissionDecisionShadowProjectScope({
      enabled: false,
      configuredProjectId: canaryProjectId,
    })).toBeNull();
  });

  it("fails closed when the project allowlist is absent or malformed", () => {
    expect(resolveMissionDecisionShadowProjectScope({ enabled: true })).toBeNull();
    expect(resolveMissionDecisionShadowProjectScope({
      enabled: true,
      configuredProjectId: "all",
    })).toBeNull();
  });

  it("uses only the configured project for global scheduler ticks", () => {
    expect(resolveMissionDecisionShadowProjectScope({
      enabled: true,
      configuredProjectId: ` ${canaryProjectId} `,
    })).toBe(canaryProjectId);
  });

  it("rejects per-project scheduler ticks outside the configured canary", () => {
    expect(resolveMissionDecisionShadowProjectScope({
      enabled: true,
      configuredProjectId: canaryProjectId,
      requestedProjectId: "7a2fe3de-b1f4-48ba-8dc9-aebde944d294",
    })).toBeNull();
    expect(resolveMissionDecisionShadowProjectScope({
      enabled: true,
      configuredProjectId: canaryProjectId,
      requestedProjectId: canaryProjectId,
    })).toBe(canaryProjectId);
  });
});
