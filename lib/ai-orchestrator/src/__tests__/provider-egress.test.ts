import { describe, expect, it } from "vitest";
import {
  assertProviderEgressEnabled,
  isProviderEgressDisabled,
  ProviderEgressDisabledError,
  type ProviderEgressEnvironment,
} from "../provider-egress.js";

const fixtureEnvironment: ProviderEgressEnvironment = {
  AI_PROVIDER_EGRESS_DISABLED: "1",
  RUN_CONTROLLED_RELEASE_VALIDATION: "1",
  DASHBOARD_E2E_TEST_MODE: "fixture",
  NODE_ENV: "development",
};

describe("provider egress guard", () => {
  it("activates only for controlled non-production fixture validation", () => {
    expect(isProviderEgressDisabled(fixtureEnvironment)).toBe(true);
    expect(
      isProviderEgressDisabled({
        ...fixtureEnvironment,
        DASHBOARD_E2E_TEST_MODE: "live-provider",
      }),
    ).toBe(false);
    expect(
      isProviderEgressDisabled({
        ...fixtureEnvironment,
        RUN_CONTROLLED_RELEASE_VALIDATION: "0",
      }),
    ).toBe(false);
    expect(
      isProviderEgressDisabled({
        ...fixtureEnvironment,
        AI_PROVIDER_EGRESS_DISABLED: "true",
      }),
    ).toBe(false);
    expect(
      isProviderEgressDisabled({
        ...fixtureEnvironment,
        NODE_ENV: "production",
      }),
    ).toBe(false);
  });

  it("fails explicitly when fixture validation attempts provider egress", () => {
    expect(() => assertProviderEgressEnabled(fixtureEnvironment)).toThrow(
      ProviderEgressDisabledError,
    );
    expect(() =>
      assertProviderEgressEnabled({
        ...fixtureEnvironment,
        AI_PROVIDER_EGRESS_DISABLED: undefined,
      }),
    ).not.toThrow();
  });
});