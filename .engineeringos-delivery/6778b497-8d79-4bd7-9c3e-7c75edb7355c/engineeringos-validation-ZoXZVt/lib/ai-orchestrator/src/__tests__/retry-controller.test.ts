import { describe, expect, it } from "vitest";
import type { QualityAssessment } from "../quality-engine.js";
import { decideRetry } from "../quality/retry-controller.js";

describe("decideRetry", () => {
  it("retries on parse failure while budget remains", () => {
    const decision = decideRetry({
      attempt: 1,
      limit: 2,
      parseError: { code: "MALFORMED_JSON", message: "bad json" },
    });

    expect(decision.shouldRetry).toBe(true);
    expect(decision.useRelaxedHints).toBe(true);
  });

  it("retries on low-quality structured output", () => {
    const assessment: QualityAssessment = {
      profile: "workflow",
      score: 0.4,
      threshold: 0.72,
      decision: "retry",
      reasons: ["missing reasoning"],
    };

    const decision = decideRetry({ attempt: 1, limit: 2, assessment });
    expect(decision.shouldRetry).toBe(true);
  });

  it("stops when the retry budget is exhausted", () => {
    const decision = decideRetry({
      attempt: 2,
      limit: 2,
      parseError: { code: "SCHEMA_VALIDATION_FAILED", message: "schema" },
    });

    expect(decision.shouldRetry).toBe(false);
  });
});
