import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { GroqClientError, type EmpiricalQualityCorpus } from "@workspace/ai-orchestrator";
import {
  EMPIRICAL_QUALITY_MAX_SELECTED_FILE_BYTES,
  reviewWithOneSameModelJsonRepair,
  runApiEmpiricalQualityCampaign,
} from "./run-empirical-quality-campaign.js";

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

async function workspaceFor(
  testCase: typeof corpus.cases[number],
  _timeoutMs?: number,
  _signal?: AbortSignal,
  contents = "bounded source fixture\n",
) {
  const rootPath = await fs.mkdtemp(path.join(os.tmpdir(), "engineeringos-empirical-test-"));
  roots.push(rootPath);
  await fs.mkdir(path.dirname(path.join(rootPath, testCase.selectedFiles[0]!)), { recursive: true });
  await fs.writeFile(path.join(rootPath, testCase.selectedFiles[0]!), contents, "utf8");
  return {
    rootPath,
    cleanup: async () => fs.rm(rootPath, { recursive: true, force: true }),
  };
}

describe("empirical provider campaign adapter", () => {
  it("makes at most one repair call while keeping the pinned runner", async () => {
    const invoked: Array<{ repair: boolean; model: string }> = [];
    const priorErrors: unknown[] = [];
    const result = await reviewWithOneSameModelJsonRepair(async (repairAttempt, priorError) => {
      invoked.push({ repair: repairAttempt, model: "liquid/lfm-2.5-2.6b:free" });
      priorErrors.push(priorError);
      return repairAttempt
        ? { _parseError: undefined, accepted: true }
        : { _parseError: { code: "MALFORMED_JSON" }, accepted: false };
    });

    expect(invoked).toEqual([
      { repair: false, model: "liquid/lfm-2.5-2.6b:free" },
      { repair: true, model: "liquid/lfm-2.5-2.6b:free" },
    ]);
    expect(priorErrors).toEqual([undefined, { code: "MALFORMED_JSON" }]);
    expect(result.accepted).toBe(true);
  });

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
    const reviewed: string[] = [];
    const scorecard = await runApiEmpiricalQualityCampaign({
      corpus,
      provider: "openrouter",
      apiKey: "provider-key-is-test-only",
      workspaceFactory: workspaceFor,
      reviewCase: async ({ testCase }) => {
        reviewed.push(testCase.id);
        throw new GroqClientError("RATE_LIMITED", "provider response must not escape");
      },
    });

    expect(scorecard.status).toBe("UNAVAILABLE");
    expect(scorecard.metrics.providerUnavailableCount).toBe(1);
    expect(scorecard.metrics.errorCount).toBe(0);
    expect(scorecard.cases).toHaveLength(1);
    expect(scorecard.notRunCaseIds).toEqual(["clean-001"]);
    expect(reviewed).toEqual(["defect-001"]);
    expect(JSON.stringify(scorecard)).not.toContain("provider response");
  });

  it("classifies an empty provider response as unavailable, not an execution error", async () => {
    const scorecard = await runApiEmpiricalQualityCampaign({
      corpus,
      provider: "openrouter",
      apiKey: "provider-key-is-test-only",
      workspaceFactory: workspaceFor,
      reviewCase: async () => {
        throw new GroqClientError("EMPTY_RESPONSE", "provider returned no choices");
      },
    });

    expect(scorecard.status).toBe("UNAVAILABLE");
    expect(scorecard.metrics.providerUnavailableCount).toBe(1);
    expect(scorecard.metrics.errorCount).toBe(0);
    expect(scorecard.cases).toHaveLength(1);
    expect(scorecard.notRunCaseIds).toEqual(["clean-001"]);
  });

  it("classifies malformed model output as an incomplete contract result, not provider unavailability", async () => {
    const scorecard = await runApiEmpiricalQualityCampaign({
      corpus,
      provider: "openrouter",
      apiKey: "provider-key-is-test-only",
      workspaceFactory: workspaceFor,
      reviewCase: async () => ({
        summary: "Code review completed",
        overallScore: 0,
        strengths: [],
        issues: [],
        refactoringOpportunities: [],
        securityConcerns: [],
        verdict: "needs_changes",
        _parseError: {
          code: "MALFORMED_JSON",
          message: "Malformed output",
          raw: "private provider text must not enter the receipt",
        },
      }),
    });

    expect(scorecard.status).toBe("INCOMPLETE");
    expect(scorecard.empiricalQualityStatus).toBe("INCOMPLETE");
    expect(scorecard.metrics.providerUnavailableCount).toBe(0);
    expect(scorecard.metrics.errorCount).toBe(2);
    expect(scorecard.cases.every((entry) => entry.errorCode === "MALFORMED_JSON")).toBe(true);
    expect(JSON.stringify(scorecard)).not.toContain("private provider text");
  });

  it("quarantines remaining empirical cases after a typed shared-pool limit", async () => {
    const reviewed: string[] = [];
    const scorecard = await runApiEmpiricalQualityCampaign({
      corpus,
      provider: "openrouter",
      apiKey: "provider-key-is-test-only",
      workspaceFactory: workspaceFor,
      reviewCase: async ({ testCase }) => {
        reviewed.push(testCase.id);
        throw new GroqClientError("RATE_LIMITED", "provider response must not escape", {
          context: {
            rateLimitScope: "upstream_shared_pool",
          },
        });
      },
    });

    expect(scorecard.status).toBe("UNAVAILABLE");
    expect(scorecard.metrics.providerUnavailableCount).toBe(1);
    expect(reviewed).toEqual(["defect-001"]);
    expect(scorecard.notRunCaseIds).toEqual(["clean-001"]);
    expect(scorecard.cases.every((entry) => entry.errorCode === "PROVIDER_UNAVAILABLE")).toBe(true);
    expect(JSON.stringify(scorecard)).not.toContain("upstream_shared_pool");
  });

  it("records the structured-output mode and provider-reported model", async () => {
    const scorecard = await runApiEmpiricalQualityCampaign({
      corpus,
      provider: "openrouter",
      apiKey: "provider-key-is-test-only",
      model: "inclusionai/ling-3.1-flash",
      workspaceFactory: workspaceFor,
      reviewCase: async ({ testCase, onProviderModel }) => {
        onProviderModel?.("inclusionai/ling-3.1-flash");
        return {
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
        };
      },
    });

    expect(scorecard.structuredOutputMode).toBe("prompt_only_json");
    expect(scorecard.model).toBe("inclusionai/ling-3.1-flash");
    expect(scorecard.cases.map((entry) => entry.providerModel)).toEqual([
      "inclusionai/ling-3.1-flash",
      "inclusionai/ling-3.1-flash",
    ]);
  });

  it("allows reasoning-capable models enough output tokens to return the review JSON", async () => {
    const budgets: Array<number | undefined> = [];
    const scorecard = await runApiEmpiricalQualityCampaign({
      corpus,
      provider: "openrouter",
      apiKey: "provider-key-is-test-only",
      model: "nvidia/nemotron-3-super-120b-a12b:free",
      workspaceFactory: workspaceFor,
      reviewCase: async ({ testCase, maxTokens }) => {
        budgets.push(maxTokens);
        return {
          summary: "Bounded review",
          overallScore: testCase.outcome === "defect" ? 40 : 90,
          strengths: [],
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
        };
      },
    });

    expect(budgets).toEqual([8_192, 8_192]);
    expect(scorecard.status).toBe("COMPLETE");
    expect(scorecard.structuredOutputMode).toBe("native_json_object");
  });

  it("records oversized selected-file evidence as incomplete instead of scoring it", async () => {
    const reviewed: string[] = [];
    const scorecard = await runApiEmpiricalQualityCampaign({
      corpus,
      provider: "openrouter",
      apiKey: "provider-key-is-test-only",
      workspaceFactory: async (testCase) => workspaceFor(
        testCase,
        undefined,
        undefined,
        testCase.outcome === "defect"
          ? "x".repeat(EMPIRICAL_QUALITY_MAX_SELECTED_FILE_BYTES + 1)
          : "bounded source fixture\n",
      ),
      reviewCase: async ({ testCase }) => {
        reviewed.push(testCase.id);
        return {
          summary: "Bounded review",
          overallScore: 90,
          strengths: [],
          issues: [],
          refactoringOpportunities: [],
          securityConcerns: [],
          verdict: "approved",
        };
      },
    });

    expect(scorecard.status).toBe("INCOMPLETE");
    expect(scorecard.metrics.incompleteCases).toBe(1);
    expect(scorecard.cases.find((entry) => entry.caseId === "defect-001")).toMatchObject({
      outcome: "ERROR",
      errorCode: "INCOMPLETE_EVIDENCE",
      contractPassed: false,
    });
    expect(reviewed).toEqual(["clean-001"]);
    expect(JSON.stringify(scorecard)).not.toContain("xxxxx");
  });

  it("admits the bounded 65 KB Flask corpus source file", async () => {
    const reviewedLengths: number[] = [];
    const flaskFileBytes = 65_472;
    const scorecard = await runApiEmpiricalQualityCampaign({
      corpus,
      provider: "openrouter",
      apiKey: "provider-key-is-test-only",
      workspaceFactory: async (testCase) => workspaceFor(
        testCase,
        undefined,
        undefined,
        testCase.outcome === "defect"
          ? "x".repeat(flaskFileBytes)
          : "bounded source fixture\n",
      ),
      reviewCase: async ({ fileContents }) => {
        reviewedLengths.push(Buffer.byteLength(fileContents["src/auth.ts"] ?? "", "utf8"));
        return {
          summary: "Bounded review",
          overallScore: 90,
          strengths: [],
          issues: [],
          refactoringOpportunities: [],
          securityConcerns: [],
          verdict: "approved",
        };
      },
    });

    expect(scorecard.cases.find((entry) => entry.caseId === "defect-001")).toMatchObject({
      outcome: "COMPLETE",
      contractPassed: true,
    });
    expect(reviewedLengths[0]).toBe(flaskFileBytes);
    expect(reviewedLengths).toHaveLength(corpus.cases.length);
  });

  it("records missing selected-file evidence as incomplete", async () => {
    const reviewed: string[] = [];
    const scorecard = await runApiEmpiricalQualityCampaign({
      corpus,
      provider: "openrouter",
      apiKey: "provider-key-is-test-only",
      workspaceFactory: async (testCase) => {
        const workspace = await fs.mkdtemp(path.join(os.tmpdir(), "engineeringos-empirical-test-"));
        roots.push(workspace);
        if (testCase.outcome === "clean") {
          await fs.writeFile(path.join(workspace, testCase.selectedFiles[0]!), "bounded source fixture\n", "utf8");
        }
        return {
          rootPath: workspace,
          cleanup: async () => fs.rm(workspace, { recursive: true, force: true }),
        };
      },
      reviewCase: async ({ testCase }) => {
        reviewed.push(testCase.id);
        return {
          summary: "Bounded review",
          overallScore: 90,
          strengths: [],
          issues: [],
          refactoringOpportunities: [],
          securityConcerns: [],
          verdict: "approved",
        };
      },
    });

    expect(scorecard.status).toBe("INCOMPLETE");
    expect(scorecard.cases.find((entry) => entry.caseId === "defect-001")?.errorCode)
      .toBe("INCOMPLETE_EVIDENCE");
    expect(reviewed).toEqual(["clean-001"]);
  });
});