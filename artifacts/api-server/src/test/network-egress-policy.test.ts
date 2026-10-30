import { describe, expect, it } from "vitest";
import { isAllowedApiTestEgress } from "./network-egress-policy.js";

const liveOpenRouterEnv = {
  RUN_LIVE_EMPTY_MODEL_RESPONSE: "1",
  API_TEST_OPENROUTER_EGRESS: "1",
  EMPTY_MODEL_RESPONSE_TEST_PROVIDER: "openrouter",
  EMPTY_MODEL_RESPONSE_TEST_MODEL: "nvidia/nemotron-3.5-lightning:free",
};

describe("API test egress policy", () => {
  it("keeps loopback requests available without a live-provider opt-in", () => {
    expect(isAllowedApiTestEgress("http://127.0.0.1:5432/health", {})).toBe(true);
  });

  it("allows only HTTPS OpenRouter for an explicitly opted-in free empty-response test", () => {
    expect(isAllowedApiTestEgress("https://openrouter.ai/api/v1/chat/completions", liveOpenRouterEnv)).toBe(true);
    expect(isAllowedApiTestEgress("https://api.clerk.com/v1/users", liveOpenRouterEnv)).toBe(false);
    expect(isAllowedApiTestEgress("https://example.com", liveOpenRouterEnv)).toBe(false);
    expect(isAllowedApiTestEgress("http://openrouter.ai/api/v1/chat/completions", liveOpenRouterEnv)).toBe(false);
  });

  it("fails closed when the model is not free or paid configuration is present", () => {
    expect(isAllowedApiTestEgress("https://openrouter.ai/api/v1/models", {
      ...liveOpenRouterEnv,
      EMPTY_MODEL_RESPONSE_TEST_MODEL: "provider/model",
    })).toBe(false);
    expect(isAllowedApiTestEgress("https://openrouter.ai/api/v1/models", {
      ...liveOpenRouterEnv,
      OPENROUTER_ALLOW_PAID_FALLBACK: "1",
    })).toBe(false);
    expect(isAllowedApiTestEgress("https://openrouter.ai/api/v1/models", {
      ...liveOpenRouterEnv,
      OPENROUTER_PAID_MODEL: "provider/paid-model",
    })).toBe(false);
  });

  it("blocks OpenRouter calls unless both live-test gates are present", () => {
    expect(isAllowedApiTestEgress("https://openrouter.ai/api/v1/models", {})).toBe(false);
    expect(isAllowedApiTestEgress("https://openrouter.ai/api/v1/models", {
      ...liveOpenRouterEnv,
      API_TEST_OPENROUTER_EGRESS: undefined,
    })).toBe(false);
  });
});
