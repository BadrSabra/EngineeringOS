import { describe, expect, it } from "vitest";
import {
  buildEmpiricalQualityScorecard,
  scoreEmpiricalQualityCase,
  validateEmpiricalQualityCorpus,
  type EmpiricalQualityCorpus,
} from "./empirical-quality.js";

const corpus: EmpiricalQualityCorpus = {
  kind: "empirical-ai-quality-corpus",
  version: 1,
  corpusRevision: "public-disposable-v1",
  cases: [
    {
      id: "defect-001",
      repositoryId: "public-repo-a",
      sourceRevision: "sha256-aaa",
      outcome: "defect",
      expectedVerdict: "findings",
      expectedGateDecision: "accept",
      findings: [{
        id: "finding-001",
        file: "src/auth.ts",
        lineStart: 42,
        type: "security",
        severity: "high",
      }],
    },
    {
      id: "clean-001",
      repositoryId: "public-repo-b",
      sourceRevision: "sha256-bbb",
      outcome: "clean",
      expectedVerdict: "clean",
      expectedGateDecision: "accept",
      findings: [],
    },
  ],
};

describe("empirical AI quality oracle", () => {
  it("requires defect and clean controls with complete ground truth", () => {
    expect(validateEmpiricalQualityCorpus(corpus)).toEqual(corpus);
    expect(() => validateEmpiricalQualityCorpus({
      ...corpus,
      cases: [corpus.cases[0]],
    })).toThrow(/both defect and clean/);
  });

  it("calculates discovery, citation, verdict, and gate metrics without raw text", () => {
    const results = corpus.cases.map((testCase) => scoreEmpiricalQualityCase(testCase, {
      caseId: testCase.id,
      outcome: "COMPLETE",
      contractPassed: true,
      qualityGateAccepted: true,
      semanticVerdict: testCase.outcome === "defect" ? "findings" : "clean",
      observedFindings: testCase.outcome === "defect" ? [{
        file: "src/auth.ts",
        lineStart: 42,
        type: "security",
        severity: "high",
        citationValid: true,
        citationSupported: true,
      }] : [],
      latencyMs: testCase.id === "defect-001" ? 100 : 200,
    }));
    const scorecard = buildEmpiricalQualityScorecard({
      corpus,
      results,
      provider: "fixture-provider",
      model: "fixture-model",
    });
    expect(scorecard.empiricalQualityStatus).toBe("PROVEN");
    expect(scorecard.metrics.precision).toBe(1);
    expect(scorecard.metrics.recall).toBe(1);
    expect(scorecard.metrics.f1).toBe(1);
    expect(scorecard.metrics.citationCoverage).toBe(1);
    expect(scorecard.metrics.latencyMs).toEqual({ p50: 100, p95: 200, p99: 200 });
    expect(scorecard.measurementOnly).toBe(true);
  });

  it("separates provider unavailability from quality failures", () => {
    const result = scoreEmpiricalQualityCase(corpus.cases[0]!, {
      caseId: "defect-001",
      outcome: "PROVIDER_UNAVAILABLE",
      contractPassed: false,
      qualityGateAccepted: false,
      semanticVerdict: "unknown",
      observedFindings: [],
      errorCode: "PROVIDER_UNAVAILABLE",
    });
    const scorecard = buildEmpiricalQualityScorecard({
      corpus,
      results: [result],
      provider: "fixture-provider",
    });
    expect(scorecard.status).toBe("UNAVAILABLE");
    expect(scorecard.metrics.providerUnavailableCount).toBe(1);
    expect(scorecard.metrics.falseNegativeCount).toBe(0);
    expect(scorecard.blockers).toContain("provider unavailable");
  });
});