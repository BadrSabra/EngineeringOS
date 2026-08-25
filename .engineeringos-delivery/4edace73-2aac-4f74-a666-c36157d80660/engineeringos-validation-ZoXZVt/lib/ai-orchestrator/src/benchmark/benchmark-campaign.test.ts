import { describe, expect, it } from "vitest";
import {
  getBenchmarkCampaignStatus,
  getBenchmarkRecoveryCaseIds,
  isCleanWitnessScorecard,
  summarizeBenchmarkCampaign,
} from "./benchmark-campaign.js";
import type { CodeAgentBenchmarkObservation, CodeAgentBenchmarkScorecard } from "./code-agent-benchmark.js";

function observation(caseId: string, grade: CodeAgentBenchmarkObservation["grade"]): CodeAgentBenchmarkObservation {
  return {
    caseId,
    grade,
    correct: grade === "A" || grade === "B",
    completedFirstAttempt: grade === "A",
    repairedWithinThreeAttempts: grade === "B",
    usefulButIncomplete: grade === "C",
    safelyBlocked: grade === "D",
    falseSuccess: false,
    scopeEscape: false,
    conflict: false,
    typecheckPassed: grade === "U" ? null : true,
    testsPassed: grade === "U" ? null : true,
    filesRead: grade === "U" ? 0 : 1,
    toolCalls: grade === "U" ? 0 : 1,
    repairAttempts: grade === "B" ? 1 : 0,
    rejectedChanges: 0,
    providerUnavailable: grade === "U",
  };
}

function scorecard(overrides: Partial<CodeAgentBenchmarkScorecard["metrics"]> = {}): CodeAgentBenchmarkScorecard {
  const metrics: CodeAgentBenchmarkScorecard["metrics"] = {
    totalCases: 2,
    observedCases: 2,
    complete: true,
    firstAttemptRate: 1,
    repairedWithinThreeRate: 0,
    correctCompletionRate: 1,
    usefulIncompleteRate: 0,
    safelyBlockedRate: 0,
    falseSuccessRate: 0,
    scopeEscapeRate: 0,
    conflictRate: 0,
    typecheckSuccessRate: 1,
    testSuccessRate: 1,
    averageFilesRead: 1,
    averageToolCalls: 1,
    averageRepairAttempts: 0,
    averageRejectedChanges: 0,
    averageLatencyMs: null,
    gradeCounts: { A: 2, B: 0, C: 0, D: 0, F: 0, U: 0 },
    providerUnavailableCount: 0,
    ...overrides,
  };
  return {
    kind: "code-agent-benchmark",
    version: 1,
    suiteVersion: "flight-deck-v2",
    generatedAt: "2026-08-19T00:00:00.000Z",
    cases: [],
    missingCaseIds: [],
    metrics,
    rolloutAllowed: true,
    rolloutBlockers: [],
  };
}

describe("benchmark campaign contract", () => {
  it("routes U and F observations into the recovery queue", () => {
    expect(getBenchmarkRecoveryCaseIds([
      observation("pass", "A"),
      observation("provider-u", "U"),
      observation("quality-f", "F"),
    ])).toEqual(["provider-u", "quality-f"]);
  });

  it("distinguishes complete coverage from a clean witness", () => {
    const coverage = scorecard({
      providerUnavailableCount: 1,
      gradeCounts: { A: 1, B: 0, C: 0, D: 0, F: 0, U: 1 },
    });
    expect(getBenchmarkCampaignStatus(coverage, "coverage")).toBe("coverage-complete");
    expect(getBenchmarkCampaignStatus(coverage, "clean-witness")).toBe("coverage-complete");
    expect(isCleanWitnessScorecard(coverage)).toBe(false);
    expect(isCleanWitnessScorecard(scorecard())).toBe(true);
  });

  it("summarizes a complete coverage campaign without treating U as F", () => {
    const summary = summarizeBenchmarkCampaign({
      mode: "coverage",
      caseIds: ["a", "b", "c"],
      observations: [
        { caseId: "a", provider: "openrouter", model: "m", providerAttempts: 1, observation: observation("a", "A") },
        { caseId: "b", provider: null, model: null, providerAttempts: 0, observation: observation("b", "U") },
        { caseId: "c", provider: "openrouter", model: "m", providerAttempts: 1, observation: observation("c", "F") },
      ],
    });
    expect(summary).toMatchObject({
      status: "coverage-complete",
      observedCases: 3,
      environmentUnavailableCases: 1,
      qualityFailures: 1,
      qualityEligible: false,
      cleanWitness: false,
      recoveryCaseIds: ["b", "c"],
    });
  });
});