import { describe, expect, it } from "vitest";
import {
  buildCodeReviewCampaignReceipt,
  type CodeReviewResult,
} from "../agents/code-reviewer.js";
import { GroqClientError } from "../errors.js";

const selectedFile = "src/provider-review-fixture.ts";
const base = {
  scenario: "rate-limit" as const,
  provider: "openrouter" as const,
  operationId: "operation-123",
  projectId: "disposable-project",
  projectRevision: "revision-123",
  selectedFile,
};

function review(overrides: Partial<CodeReviewResult> = {}): CodeReviewResult {
  return {
    summary: "A bounded review",
    overallScore: 70,
    strengths: [],
    issues: [{
      type: "style",
      severity: "low",
      file: selectedFile,
      title: "Use a named constant",
      description: "The value is inline.",
      suggestion: "Name the value.",
    }],
    refactoringOpportunities: [],
    securityConcerns: [],
    verdict: "needs_changes",
    ...overrides,
  };
}

describe("structured live review receipts", () => {
  it("accepts structured-review evidence only when it cites the selected file", () => {
    const receipt = buildCodeReviewCampaignReceipt({
      ...base,
      scenario: "structured-review",
      result: review(),
    });

    expect(receipt).toMatchObject({
      scenario: "structured-review",
      outcomeClass: "fallback-success",
      terminalStatus: "COMPLETE",
      evidenceStatus: "complete",
      accepted: true,
    });
    expect(receipt.evidence).toHaveLength(1);
    expect(receipt.evidence[0]?.file).toBe(selectedFile);
  });

  it("accepts only a selected-file finding as fallback success", () => {
    const receipt = buildCodeReviewCampaignReceipt({
      ...base,
      result: review(),
      attemptedModels: ["first-model:free", "second-model:free", "model?token=secret"],
    });

    expect(receipt).toMatchObject({
      kind: "code-review-provider-campaign-receipt",
      outcomeClass: "fallback-success",
      terminalStatus: "COMPLETE",
      recoveryAction: "retry-review",
    });
    expect(receipt.evidence).toHaveLength(1);
    expect(receipt.attemptedModels).toEqual(["first-model:free", "second-model:free"]);
  });

  it("accepts a requested-model measurement only when exactly that model was attempted", () => {
    const requestedModel = "expected/model:free";
    const receipt = buildCodeReviewCampaignReceipt({
      ...base,
      scenario: "structured-review",
      requestedModel,
      attemptedModels: [requestedModel],
      modelCatalogSnapshot: {
        checkedAt: "2026-10-31T01:00:00.000Z",
        freeModelSetHash: "0123456789abcdef",
        requestedModelListed: true,
        requestedModelStaticEligible: true,
        requestedModelSupportsJsonSchema: true,
      },
      result: review(),
    });

    expect(receipt).toMatchObject({
      outcomeClass: "fallback-success",
      requestedModel,
      attemptedModels: [requestedModel],
      modelIdentityMatched: true,
      modelCatalogSnapshot: {
        requestedModelListed: true,
        requestedModelStaticEligible: true,
        requestedModelSupportsJsonSchema: true,
      },
    });
    expect(receipt.accepted).toBe(true);
  });

  it("keeps a model-attribution mismatch incomplete and without evidence", () => {
    const receipt = buildCodeReviewCampaignReceipt({
      ...base,
      scenario: "structured-review",
      requestedModel: "expected/model:free",
      attemptedModels: ["actual/model:free"],
      result: review(),
    });

    expect(receipt).toMatchObject({
      outcomeClass: "terminal-incomplete",
      terminalStatus: "INCOMPLETE",
      failureCode: "CAMPAIGN_MODEL_MISMATCH",
      requestedModel: "expected/model:free",
      attemptedModels: ["actual/model:free"],
      modelIdentityMatched: false,
      accepted: false,
      evidence: [],
    });
  });

  it("keeps malformed output and provider outages terminally incomplete", () => {
    const parseReceipt = buildCodeReviewCampaignReceipt({
      ...base,
      scenario: "malformed",
      result: review({
        issues: [],
        _parseError: {
          code: "MALFORMED_JSON",
          message: "raw provider body sk-or-v1-secret",
          raw: "prompt and provider response",
        },
      }),
    });
    const outageReceipt = buildCodeReviewCampaignReceipt({
      ...base,
      error: new GroqClientError("RATE_LIMITED", "raw provider response sk-or-v1-secret", {
        context: {
          providerMessage: "raw provider response",
          providerModel: "second-model:free",
          providerAttemptedModels: ["first-model:free", "second-model?token=secret"],
          providerStatus: 422,
          rateLimitScope: "upstream_shared_pool",
          retryAfterMs: 1750,
        },
      }),
      attemptedModels: ["first-model:free", "second-model?token=secret"],
    });

    for (const receipt of [parseReceipt, outageReceipt]) {
      expect(receipt.outcomeClass).toBe("terminal-incomplete");
      expect(receipt.terminalStatus).toBe("INCOMPLETE");
      expect(receipt.evidence).toEqual([]);
      expect(JSON.stringify(receipt)).not.toContain("raw provider");
      expect(JSON.stringify(receipt)).not.toContain("sk-or-v1-secret");
      expect(JSON.stringify(receipt)).not.toContain("token=secret");
    }
    expect(parseReceipt.failureCode).toBe("MALFORMED_JSON");
    expect(outageReceipt.failureCode).toBe("RATE_LIMITED");
    expect(outageReceipt.rateLimitScope).toBe("upstream_shared_pool");
    expect(outageReceipt.retryAfterMs).toBe(1750);
    expect(outageReceipt.providerStatus).toBe(422);
    expect(outageReceipt.failureModel).toBe("second-model:free");
    expect(outageReceipt.recoveryAction).toBe("wait");
  });

  it("does not invent a retry delay when the provider supplied none", () => {
    const receipt = buildCodeReviewCampaignReceipt({
      ...base,
      error: new GroqClientError("RATE_LIMITED", "rate limited"),
    });
    expect(receipt.failureCode).toBe("RATE_LIMITED");
    expect(receipt.retryAfterMs).toBeUndefined();
  });

  it("does not treat a finding in another file as verified evidence", () => {
    const receipt = buildCodeReviewCampaignReceipt({
      ...base,
      result: review({
        issues: [review().issues[0] ? { ...review().issues[0]!, file: "src/other.ts" } : {
          type: "bug",
          severity: "low",
          file: "src/other.ts",
          title: "Other",
          description: "Other",
          suggestion: "Other",
        }],
      }),
    });

    expect(receipt.outcomeClass).toBe("terminal-incomplete");
    expect(receipt.evidence).toEqual([]);
  });
});