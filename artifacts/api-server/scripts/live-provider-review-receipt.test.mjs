import assert from "node:assert/strict";
import test from "node:test";
import {
  summarizeCampaignChildFailure,
  validateAndSummarizeCampaignReceipt,
} from "./live-provider-review-receipt.mjs";

function validReceipt(overrides = {}) {
  return {
    kind: "code-review-provider-campaign-receipt",
    version: 1,
    scenario: "agent-harness",
    provider: "openrouter",
    operationId: "operation-1",
    projectId: "isolated-project",
    projectRevision: "revision-1",
    outcomeClass: "terminal-incomplete",
    terminalStatus: "INCOMPLETE",
    failureCode: "RATE_LIMITED",
    rateLimitScope: "upstream_shared_pool",
    recoveryAction: "wait",
    attemptedModels: ["example/model:free"],
    modelAttempts: [{ model: "example/model:free", tier: "free" }],
    latencyMs: 100,
    evidenceStatus: "incomplete",
    accepted: false,
    evidence: [],
    ...overrides,
  };
}

test("safe receipt summary retains only bounded campaign and model status", () => {
  const summary = validateAndSummarizeCampaignReceipt(validReceipt());
  assert.deepEqual(summary, {
    kind: "code-review-provider-campaign-receipt",
    scenario: "agent-harness",
    outcome: "terminal-incomplete",
    terminal: "INCOMPLETE",
    evidenceCount: 0,
    modelAttempts: [{ model: "example/model:free", tier: "free" }],
    failureCode: "RATE_LIMITED",
    rateLimitScope: "upstream_shared_pool",
  });
});

test("structured-review is a valid receipt scenario with a selected-file finding", () => {
  const summary = validateAndSummarizeCampaignReceipt(validReceipt({
    scenario: "structured-review",
    outcomeClass: "fallback-success",
    terminalStatus: "COMPLETE",
    evidenceStatus: "complete",
    accepted: true,
    evidence: [{ file: "src/provider-review-fixture.ts", findingHash: "abc123" }],
  }));
  assert.equal(summary.scenario, "structured-review");
  assert.equal(summary.outcome, "fallback-success");
  assert.equal(summary.terminal, "COMPLETE");
  assert.equal(summary.evidenceCount, 1);
});

test("provider credential cooldown scope is preserved as a safe enum", () => {
  const summary = validateAndSummarizeCampaignReceipt(validReceipt({
    rateLimitScope: "provider_credential",
  }));
  assert.equal(summary.rateLimitScope, "provider_credential");
});

test("retry delay is preserved only when it is a positive safe integer", () => {
  const summary = validateAndSummarizeCampaignReceipt(validReceipt({
    retryAfterMs: 1750,
  }));
  assert.equal(summary.retryAfterMs, 1750);
  assert.throws(
    () => validateAndSummarizeCampaignReceipt(validReceipt({ retryAfterMs: 0 })),
    /invalid_receipt/,
  );
});

test("provider HTTP status is retained only as a valid numeric status", () => {
  const summary = validateAndSummarizeCampaignReceipt(validReceipt({
    providerStatus: 422,
  }));
  assert.equal(summary.providerStatus, 422);
  assert.throws(
    () => validateAndSummarizeCampaignReceipt(validReceipt({ providerStatus: 200 })),
    /invalid_receipt/,
  );
  assert.throws(
    () => validateAndSummarizeCampaignReceipt(validReceipt({ providerStatus: "422" })),
    /invalid_receipt/,
  );
});

test("success receipts require exactly one accepted finding", () => {
  assert.throws(
    () => validateAndSummarizeCampaignReceipt(validReceipt({
      outcomeClass: "fallback-success",
      terminalStatus: "COMPLETE",
      evidence: [],
    })),
    /invalid_receipt/,
  );
});

test("unsafe receipt content is rejected without echoing it", () => {
  assert.throws(
    () => validateAndSummarizeCampaignReceipt(validReceipt({
      evidence: [{ file: "src/source.ts", findingHash: "abc" }],
      outcomeClass: "fallback-success",
      terminalStatus: "COMPLETE",
    })),
    (error) => error.message === "invalid_receipt",
  );
});

test("child failure summary distinguishes missing and validated receipts", () => {
  assert.deepEqual(
    summarizeCampaignChildFailure({ code: 1, signal: null, receiptStatus: "missing" }),
    {
      kind: "live-provider-review-campaign",
      status: "child_failed",
      childStatus: "exit_1",
      receiptStatus: "missing",
    },
  );
  assert.deepEqual(
    summarizeCampaignChildFailure({
      code: 1,
      signal: null,
      receiptStatus: "validated",
      receipt: validReceipt(),
    }),
    {
      kind: "live-provider-review-campaign",
      status: "child_failed",
      childStatus: "exit_1",
      receiptStatus: "validated",
      receipt: validateAndSummarizeCampaignReceipt(validReceipt()),
    },
  );
});
