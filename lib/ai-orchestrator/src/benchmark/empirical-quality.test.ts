import { describe, expect, it } from "vitest";
import { readFile } from "node:fs/promises";
import {
  buildEmpiricalQualityScorecard,
  scoreEmpiricalQualityCase,
  runEmpiricalQualityCampaign,
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
      repositoryUrl: "https://github.com/OWASP/NodeGoat.git",
      sourceRevision: "c5cb68a7084e4ae7dcc60e6a98768720a81841e8",
      selectedFiles: ["app/routes/session.js"],
      outcome: "defect",
      expectedVerdict: "findings",
      expectedGateDecision: "reject",
      findings: [{
        id: "finding-001",
          file: "app/routes/session.js",
        lineStart: 42,
        type: "security",
        severity: "high",
      }],
    },
    {
      id: "clean-001",
      repositoryId: "public-repo-b",
      repositoryUrl: "https://github.com/octocat/Hello-World.git",
      sourceRevision: "7fd1a60b01f91b314f59955a4e4d4e80d8edf11d",
      selectedFiles: ["README"],
      outcome: "clean",
      expectedVerdict: "clean",
      expectedGateDecision: "accept",
      findings: [],
    },
  ],
};

describe("empirical AI quality oracle", () => {
  it("loads the checked-in v2 corpus and verifies its balanced coverage matrix", async () => {
    const fixture = JSON.parse(await readFile(
      new URL("../benchmark-fixtures/reviewed-empirical-quality-corpus-v2.json", import.meta.url),
      "utf8",
    )) as unknown;
    const reviewedCorpus = validateEmpiricalQualityCorpus(fixture);
    expect(reviewedCorpus.version).toBe(2);
    expect(reviewedCorpus.cases).toHaveLength(12);
    expect(reviewedCorpus.cases.filter((entry) => entry.outcome === "defect")).toHaveLength(6);
    expect(reviewedCorpus.cases.filter((entry) => entry.outcome === "clean")).toHaveLength(6);
    expect(reviewedCorpus.coverage).toMatchObject({
      minimumCasesPerOutcome: 6,
      requiredLanguages: ["javascript", "python", "go", "rust", "java", "csharp"],
      requiredReviewPatterns: ["single-file", "multi-file"],
      requiredIssueTypes: ["bug", "security", "performance", "style", "architecture"],
      requiredSeverities: ["critical", "high", "medium", "low"],
    });
  });

  it("requires defect and clean controls with complete ground truth", () => {
    expect(validateEmpiricalQualityCorpus(corpus)).toEqual(corpus);
    expect(() => validateEmpiricalQualityCorpus({
      ...corpus,
      cases: [corpus.cases[0]],
    })).toThrow(/both defect and clean/);
  });

  it("keeps the historical v1 format readable while rejecting unsupported corpus metadata", async () => {
    expect(validateEmpiricalQualityCorpus(corpus).version).toBe(1);
    expect(() => validateEmpiricalQualityCorpus({
      ...corpus,
      version: 3,
    })).toThrow(/kind or version is unsupported/);

    const fixture = JSON.parse(await readFile(
      new URL("../benchmark-fixtures/reviewed-empirical-quality-corpus-v2.json", import.meta.url),
      "utf8",
    )) as EmpiricalQualityCorpus;
    expect(() => validateEmpiricalQualityCorpus({
      ...fixture,
      cases: fixture.cases.map((entry, index) =>
        index === 1 ? { ...entry, id: fixture.cases[0]!.id } : entry),
    })).toThrow(/IDs must be unique/);
    expect(() => validateEmpiricalQualityCorpus({
      ...fixture,
      cases: fixture.cases.map((entry, index) =>
        index === 0
          ? { ...entry, metadata: { ...entry.metadata!, language: "elixir" as never } }
          : entry),
    })).toThrow(/metadata does not match ground truth|unsupported metadata/);
    expect(() => validateEmpiricalQualityCorpus({
      ...fixture,
      coverage: {
        ...fixture.coverage!,
        requiredLanguages: ["javascript", "typescript"],
      },
    })).toThrow(/required coverage matrix/);
  });

  it("rejects findings outside selected files and duplicate finding metadata", () => {
    expect(() => validateEmpiricalQualityCorpus({
      ...corpus,
      cases: [{
        ...corpus.cases[0]!,
        findings: [{
          ...corpus.cases[0]!.findings[0]!,
          file: "other.js",
        }],
      }],
    })).toThrow(/outside its selected files/);
    expect(() => validateEmpiricalQualityCorpus({
      ...corpus,
      cases: [{
        ...corpus.cases[0]!,
        findings: [
          corpus.cases[0]!.findings[0]!,
          { ...corpus.cases[0]!.findings[0]! },
        ],
      }],
    })).toThrow(/duplicate finding IDs/);
  });

  it("rejects mutable or credential-bearing reviewed repository provenance", () => {
    expect(() => validateEmpiricalQualityCorpus({
      ...corpus,
      cases: [{
        ...corpus.cases[0]!,
        repositoryUrl: "https://user:secret@github.com/example/repository.git",
      }],
    })).toThrow(/public HTTPS GitHub repository/);
    expect(() => validateEmpiricalQualityCorpus({
      ...corpus,
      cases: [{ ...corpus.cases[0]!, sourceRevision: "main" }],
    })).toThrow(/immutable Git revision/);
    expect(() => validateEmpiricalQualityCorpus({
      ...corpus,
      cases: [{ ...corpus.cases[0]!, selectedFiles: ["../secrets.txt"] }],
    })).toThrow(/invalid selected files/);
  });

  it("bounds a case that ignores abort and records a timeout", async () => {
    const scorecard = await runEmpiricalQualityCampaign({
      corpus: { ...corpus, cases: [corpus.cases[0]!] },
      provider: "openrouter",
      caseTimeoutMs: 10,
      executeCase: async () => new Promise<never>(() => undefined),
    });

    expect(scorecard.status).toBe("UNAVAILABLE");
    expect(scorecard.cases[0]?.outcome).toBe("TIMEOUT");
    expect(scorecard.cases[0]?.errorCode).toBe("TIMEOUT");
  });

  it("calculates discovery, citation, verdict, and gate metrics without raw text", () => {
    const results = corpus.cases.map((testCase) => scoreEmpiricalQualityCase(testCase, {
      caseId: testCase.id,
      outcome: "COMPLETE",
      contractPassed: true,
       qualityGateAccepted: testCase.outcome === "clean",
      semanticVerdict: testCase.outcome === "defect" ? "findings" : "clean",
      observedFindings: testCase.outcome === "defect" ? [{
         file: "app/routes/session.js",
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