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

test("provider credential cooldown scope is preserved as a safe enum", () => {
  const summary = validateAndSummarizeCampaignReceipt(validReceipt({
    rateLimitScope: "provider_credential",
  }));
  assert.equal(summary.rateLimitScope, "provider_credential");
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
