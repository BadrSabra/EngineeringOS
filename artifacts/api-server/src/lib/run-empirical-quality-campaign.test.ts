import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { GroqClientError, type EmpiricalQualityCorpus } from "@workspace/ai-orchestrator";
import { runApiEmpiricalQualityCampaign } from "./run-empirical-quality-campaign.js";

const roots: string[] = [];

const corpus: EmpiricalQualityCorpus = {
  kind: "empirical-ai-quality-corpus",
  version: 1,
  corpusRevision: "adapter-test-v1",
  cases: [
    {
      id: "defect-001",
      repositoryId: "public-repo-a",
      repositoryUrl: "https://github.com/OWASP/NodeGoat.git",
      sourceRevision: "c5cb68a7084e4ae7dcc60e6a98768720a81841e8",
      selectedFiles: ["src/auth.ts"],
      outcome: "defect",
      expectedVerdict: "findings",
      expectedGateDecision: "reject",
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

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => fs.rm(root, { recursive: true, force: true })));
});

async function workspaceFor(testCase: typeof corpus.cases[number]) {
  const rootPath = await fs.mkdtemp(path.join(os.tmpdir(), "engineeringos-empirical-test-"));
  roots.push(rootPath);
  await fs.mkdir(path.dirname(path.join(rootPath, testCase.selectedFiles[0]!)), { recursive: true });
  await fs.writeFile(path.join(rootPath, testCase.selectedFiles[0]!), "bounded source fixture\n", "utf8");
  return {
    rootPath,
    cleanup: async () => fs.rm(rootPath, { recursive: true, force: true }),
  };
}

describe("empirical provider campaign adapter", () => {
  it("runs the isolated review path and records scoring, citation, normalization, and latency", async () => {
    const cleaned: string[] = [];
    const scorecard = await runApiEmpiricalQualityCampaign({
      corpus,
      provider: "openrouter",
      apiKey: "provider-key-is-test-only",
      generatedAt: "2026-09-01T00:00:00.000Z",
      workspaceFactory: async (testCase) => {
        const workspace = await workspaceFor(testCase);
        return {
          ...workspace,
          cleanup: async () => {
            cleaned.push(testCase.id);
            await workspace.cleanup();
          },
        };
      },
      reviewCase: async ({ testCase }) => ({
        summary: "Bounded review",
        overallScore: testCase.outcome === "defect" ? 40 : 90,
        strengths: ["Selected fixture"],
        issues: testCase.outcome === "defect" ? [{
          type: "security",
          severity: "high",
          file: "src/auth.ts",
          title: "Unsafe authentication",
          description: "The selected fixture is unsafe.",
          suggestion: "Validate the input.",
        }] : [],
        refactoringOpportunities: [],
        securityConcerns: [],
        verdict: testCase.outcome === "defect" ? "needs_changes" : "approved",
      }),
    });

    expect(scorecard.status).toBe("COMPLETE");
    expect(scorecard.empiricalQualityStatus).toBe("PROVEN");
    expect(scorecard.metrics.truePositiveCount).toBe(1);
    expect(scorecard.metrics.citationCoverage).toBe(1);
    expect(scorecard.metrics.normalizationCounters).toEqual({
      changedFindingType: 0,
      changedSeverity: 0,
      droppedCitation: 0,
    });
    expect(scorecard.metrics.latencyMs.p50).not.toBeNull();
    expect(cleaned).toEqual(["defect-001", "clean-001"]);
    expect(JSON.stringify(scorecard)).not.toContain("bounded source fixture");
  });

  it("keeps provider outages separate from quality failures", async () => {
    const scorecard = await runApiEmpiricalQualityCampaign({
      corpus,
      provider: "openrouter",
      apiKey: "provider-key-is-test-only",
      workspaceFactory: workspaceFor,
      reviewCase: async () => {
        throw new GroqClientError("RATE_LIMITED", "provider response must not escape");
      },
    });

    expect(scorecard.status).toBe("UNAVAILABLE");
    expect(scorecard.metrics.providerUnavailableCount).toBe(2);
    expect(scorecard.metrics.errorCount).toBe(0);
    expect(scorecard.cases.every((entry) => entry.errorCode === "PROVIDER_UNAVAILABLE")).toBe(true);
    expect(JSON.stringify(scorecard)).not.toContain("provider response");
  });
});