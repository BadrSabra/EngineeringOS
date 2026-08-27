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
          providerAttemptedModels: ["first-model:free", "second-model?token=secret"],
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
    expect(outageReceipt.recoveryAction).toBe("wait");
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