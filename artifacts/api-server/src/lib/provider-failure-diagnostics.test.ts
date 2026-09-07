import { describe, expect, it } from "vitest";
import {
  classifyProviderFailure,
  decideProviderFailurePolicy,
  isProviderFailureCategory,
  PROVIDER_FAILURE_CATEGORIES,
} from "./provider-failure-diagnostics.js";

describe("classifyProviderFailure", () => {
  it.each([
    ["TIMEOUT", { code: "TIMEOUT" }],
    ["MODEL_REJECTED", { code: "MODEL_NOT_FOUND" }],
    ["MODEL_UNAVAILABLE", { code: "MODEL_UNAVAILABLE" }],
    ["RATE_LIMITED", { code: "RATE_LIMITED" }],
    ["FALLBACK_EXHAUSTED", { fallbackExhausted: true }],
    ["TRANSPORT_FAILURE", { code: "NETWORK_ERROR" }],
    ["MALFORMED_RESPONSE", { code: "EMPTY_RESPONSE" }],
    ["UNKNOWN", { code: "UNRECOGNIZED_TYPED_FAILURE" }],
  ] as const)("returns the bounded %s category", (category, input) => {
    expect(classifyProviderFailure(input)).toBe(category);
  });

  it("applies typed precedence before fallback exhaustion", () => {
    expect(classifyProviderFailure({
      code: "RATE_LIMITED",
      providerCode: "FALLBACK_EXHAUSTED",
      providerStatus: 429,
      fallbackExhausted: true,
    })).toBe("RATE_LIMITED");
    expect(classifyProviderFailure({
      code: "MODEL_UNAVAILABLE",
      providerStatus: 410,
      fallbackExhausted: true,
    })).toBe("MODEL_UNAVAILABLE");
    expect(classifyProviderFailure({
      code: "SERVER_ERROR",
      providerStatus: 503,
      providerCode: "UNAVAILABLE",
      fallbackExhausted: true,
    })).toBe("MODEL_UNAVAILABLE");
    expect(classifyProviderFailure({
      code: "MODEL_NOT_FOUND",
      fallbackExhausted: true,
    })).toBe("MODEL_REJECTED");
  });

  it("preserves cancellation precedence and does not emit a provider category", () => {
    expect(classifyProviderFailure({
      code: "RATE_LIMITED",
      fallbackExhausted: true,
      cancelled: true,
    })).toBeUndefined();
  });
});

describe("provider failure category allowlist", () => {
  it("accepts only server-owned categories", () => {
    expect(PROVIDER_FAILURE_CATEGORIES).toHaveLength(8);
    for (const category of PROVIDER_FAILURE_CATEGORIES) {
      expect(isProviderFailureCategory(category)).toBe(true);
    }
    expect(isProviderFailureCategory("provider raw response")).toBe(false);
    expect(isProviderFailureCategory({ category: "TIMEOUT" })).toBe(false);
  });
});

describe("provider failure policy", () => {
  it("allows one bounded fallback for transient failures", () => {
    expect(decideProviderFailurePolicy({
      category: "TIMEOUT",
      fallbackAttempted: false,
      synthesisAvailable: false,
      deterministicRecoveryAvailable: false,
      attempt: 1,
    })).toMatchObject({ action: "FALLBACK_ONCE", retryable: true, maxFallbacks: 1 });
  });

  it("does not reopen exhausted fallback and prefers deterministic recovery", () => {
    expect(decideProviderFailurePolicy({
      category: "MALFORMED_RESPONSE",
      fallbackAttempted: true,
      synthesisAvailable: true,
      deterministicRecoveryAvailable: true,
      attempt: 2,
    })).toMatchObject({ action: "DETERMINISTIC_RECOVERY", retryable: true });
    expect(decideProviderFailurePolicy({
      category: "MODEL_REJECTED",
      fallbackAttempted: true,
      synthesisAvailable: false,
      deterministicRecoveryAvailable: false,
      attempt: 2,
    })).toMatchObject({ action: "TERMINAL_FAILURE", retryable: false, nextActionCode: "ABANDON_EXECUTION" });
  });
});