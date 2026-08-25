import { describe, expect, it } from "vitest";
import { buildBenchmarkParityReport, benchmarkParityReportToMarkdown } from "./benchmark-parity-report.js";
import type { CodeAgentBenchmarkCase, CodeAgentBenchmarkScorecard } from "./code-agent-benchmark.js";

const testCase: CodeAgentBenchmarkCase = {
  id: "single-file-001",
  title: "fixture",
  category: "single-file-edit",
  projectShape: "single-file",
  prompt: "fixture",
  expected: {
    terminal: "READY_FOR_REVIEW",
    validation: "typecheck",
    maxRepairAttempts: 3,
    filesMustRemainScoped: true,
    approvalRequired: true,
  },
};

const scorecard: CodeAgentBenchmarkScorecard = {
  kind: "code-agent-benchmark",
  version: 1,
  suiteVersion: "flight-deck-v2",
  generatedAt: "2026-08-24T00:00:00.000Z",
  cases: [],
  missingCaseIds: [],
  metrics: {
    totalCases: 1,
    observedCases: 1,
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
    testSuccessRate: null,
    averageFilesRead: 1,
    averageToolCalls: 2,
    averageRepairAttempts: 0,
    averageRejectedChanges: 0,
    averageLatencyMs: null,
    gradeCounts: { A: 1, B: 0, C: 0, D: 0, F: 0, U: 0 },
    providerUnavailableCount: 0,
  },
  rolloutAllowed: true,
  rolloutBlockers: [],
};

const observation = {
  caseId: testCase.id,
  grade: "A" as const,
  correct: true,
  completedFirstAttempt: true,
  repairedWithinThreeAttempts: false,
  usefulButIncomplete: false,
  safelyBlocked: false,
  falseSuccess: false,
  scopeEscape: false,
  conflict: false,
  typecheckPassed: true,
  testsPassed: null,
  filesRead: 2,
  toolCalls: 2,
  repairAttempts: 0,
  rejectedChanges: 0,
};

describe("observable parity report", () => {
  it("reports retained outcomes without inventing comparator claims", () => {
    const report = buildBenchmarkParityReport({
      mode: "clean-witness",
      cases: [testCase],
      scorecard,
      observations: [{ caseId: testCase.id, observation }],
    });
    expect(report.basis).toBe("observable-engineeringos-outcomes");
    expect(report.comparator).toBe("undocumented-behavior-not-asserted");
    expect(report.campaign.cleanWitness).toBe(true);
    expect(report.gaps).toHaveLength(0);
    expect(benchmarkParityReportToMarkdown(report)).toContain("Gap table");
  });

  it("prioritizes unsafe outcomes and separates unavailable observations", () => {
    const report = buildBenchmarkParityReport({
      mode: "coverage",
      cases: [testCase],
      scorecard: {
        ...scorecard,
        metrics: {
          ...scorecard.metrics,
          falseSuccessRate: 1,
          providerUnavailableCount: 1,
        },
      },
      observations: [{
        caseId: testCase.id,
        observation: { ...observation, grade: "U", correct: false, providerUnavailable: true },
      }],
    });
    expect(report.gaps[0]).toMatchObject({ dimension: "safety-invariants", priority: "critical" });
    expect(report.gaps.some((gap) => gap.dimension === "provider-availability" && gap.status === "environment-gap")).toBe(true);
  });
});