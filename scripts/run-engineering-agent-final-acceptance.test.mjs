import assert from "node:assert/strict";
import test from "node:test";
import { classifyOpenRouterSmokeResult } from "./run-engineering-agent-final-acceptance.mjs";

function passingSmoke() {
  return {
    provider: "openrouter",
    status: "passed",
    actualModel: "provider/model:free",
    selectedModel: "provider/model:free",
    freePolicy: true,
    actualModelFreeVerified: true,
    responseValidation: "passed",
    paidFallbackEnabled: false,
    attemptCount: 1,
    maxAttempts: 1,
    failureCategory: null,
  };
}

test("only a verified free actual model with validated response passes the live gate", () => {
  const result = classifyOpenRouterSmokeResult(passingSmoke(), 0);
  assert.equal(result.status, "PASS");
  assert.equal(result.provider, "openrouter");
  assert.equal(result.actualModel, "provider/model:free");
  assert.equal(result.paidFallbackEnabled, false);

  const noActualModel = classifyOpenRouterSmokeResult({
    ...passingSmoke(),
    actualModel: null,
    actualModelFreeVerified: false,
  }, 0);
  assert.equal(noActualModel.status, "FAIL_ROUTING");

  const badResponse = classifyOpenRouterSmokeResult({
    ...passingSmoke(),
    responseValidation: "failed",
  }, 0);
  assert.equal(badResponse.status, "FAIL_RESPONSE");
});

test("rate limiting is an explicit blocked result with only safe retry metadata", () => {
  const result = classifyOpenRouterSmokeResult({
    ...passingSmoke(),
    status: "unavailable",
    actualModel: null,
    actualModelFreeVerified: null,
    responseValidation: "not_verified",
    failureCategory: "rate-limit",
    rateLimitScope: "upstream_shared_pool",
    retryAfterMs: 120_000,
    providerBody: "sk-or-private-value",
  }, 2);

  assert.equal(result.status, "BLOCKED_RATE_LIMIT");
  assert.equal(result.rateLimitScope, "upstream_shared_pool");
  assert.equal(result.retryAfterMs, 120_000);
  assert.equal(JSON.stringify(result).includes("sk-or-private-value"), false);
});

test("routing violations and missing smoke output never count as a provider pass", () => {
  const paidModel = classifyOpenRouterSmokeResult({
    ...passingSmoke(),
    status: "unavailable",
    actualModel: "paid/provider",
    actualModelFreeVerified: false,
    failureCategory: "routing",
  }, 2);
  assert.equal(paidModel.status, "FAIL_ROUTING");

  const missing = classifyOpenRouterSmokeResult(
    null,
    2,
    "BLOCKED: OPENROUTER_API_KEY is required for the opt-in smoke check.",
  );
  assert.equal(missing.status, "FAIL_INFRA");
  assert.equal(missing.failureCategory, "missing_credentials");
  assert.equal(missing.actualModel, null);
});
