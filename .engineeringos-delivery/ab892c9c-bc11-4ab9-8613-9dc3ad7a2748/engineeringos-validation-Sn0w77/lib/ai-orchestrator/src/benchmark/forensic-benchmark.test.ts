import { describe, expect, it } from "vitest";
import {
  getForensicBenchmarkCases,
  runDeterministicForensicBenchmark,
  scorecardToMarkdown,
} from "./forensic-benchmark.js";

describe("forensic benchmark", () => {
  it("covers the fixed forensic reliability matrix", () => {
    expect(getForensicBenchmarkCases().map((testCase) => testCase.id)).toEqual([
      "source-inspection",
      "dependency-tracing",
      "unsupported-finding",
      "malformed-output",
      "empty-synthesis",
      "repair-plan-safety",
    ]);
  });

  it("passes the deterministic guardrail baseline", () => {
    const scorecard = runDeterministicForensicBenchmark();

    expect(scorecard.mode).toBe("deterministic");
    expect(scorecard.cases).toHaveLength(6);
    expect(scorecard.cases.every((result) => result.status === "passed")).toBe(true);
    expect(scorecard.metrics.validReportRate).toBe(1);
    expect(scorecard.metrics.rawFormatComplianceRate).toBeCloseTo(5 / 6);
    expect(scorecard.metrics.evidenceCitationAccuracy).toBe(1);
    expect(scorecard.metrics.unsupportedClaimBlockRate).toBe(1);
    expect(scorecard.metrics.recoveryRate).toBe(1);
    expect(scorecard.metrics.repairPlanSafetyRate).toBe(1);
    expect(scorecard.metrics.toolUseScore).toBe(1);
    expect(scorecard.metrics.overallScore).toBeCloseTo(71 / 72);
    expect(scorecard.metrics.maxSourceReads).toBeLessThanOrEqual(24);
    expect(scorecard.cases.every((result) => result.evidenceSetMatches)).toBe(true);
    expect(scorecard.cases.every((result) =>
      !("rawResponse" in result) && !("finalResponse" in result),
    )).toBe(true);
  });

  it("renders a provider-neutral scorecard", () => {
    const markdown = scorecardToMarkdown(runDeterministicForensicBenchmark());
    expect(markdown).toContain("Raw format compliance");
    expect(markdown).toContain("Evidence citation accuracy");
    expect(markdown).toContain("Read-budget violation rate");
    expect(markdown).toContain("unsupported-finding");
  });
});