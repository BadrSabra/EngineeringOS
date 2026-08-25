import { describe, expect, it } from "vitest";
import {
  CODE_AGENT_BENCHMARK_CASE_COUNT,
  buildCodeAgentBenchmarkScorecard,
  getCodeAgentBenchmarkCases,
  type CodeAgentBenchmarkObservation,
  type CodeAgentBenchmarkScorecard,
} from "./code-agent-benchmark.js";
import { approveCodeAgentBenchmarkBaseline } from "./baseline-approval.js";

const oneCase = [{
  id: "baseline-test-case",
  title: "baseline test case",
  category: "single-file-edit" as const,
  projectShape: "single-file" as const,
  prompt: "make a safe change",
  expected: {
    terminal: "READY_FOR_REVIEW" as const,
    validation: "tests" as const,
    maxRepairAttempts: 3 as const,
    filesMustRemainScoped: true,
    approvalRequired: true as const,
  },
}];

const passingObservation: CodeAgentBenchmarkObservation = {
  caseId: "baseline-test-case",
  grade: "A",
  correct: true,
  completedFirstAttempt: true,
  repairedWithinThreeAttempts: false,
  usefulButIncomplete: false,
  safelyBlocked: false,
  falseSuccess: false,
  scopeEscape: false,
  conflict: false,
  typecheckPassed: true,
  testsPassed: true,
  filesRead: 1,
  toolCalls: 2,
  repairAttempts: 0,
  rejectedChanges: 0,
};

function scorecard(): CodeAgentBenchmarkScorecard {
  return buildCodeAgentBenchmarkScorecard({
    cases: oneCase,
    results: [passingObservation],
    generatedAt: "2026-08-18T00:00:00.000Z",
  });
}

function completeScorecard(): CodeAgentBenchmarkScorecard {
  const cases = getCodeAgentBenchmarkCases();
  return buildCodeAgentBenchmarkScorecard({
    cases,
    results: cases.map((testCase) => ({
      ...passingObservation,
      caseId: testCase.id,
    })),
    generatedAt: "2026-08-18T00:00:00.000Z",
  });
}

describe("approveCodeAgentBenchmarkBaseline", () => {
  it("allows only the explicit missing-baseline blocker", () => {
    const complete = completeScorecard();
    expect(complete.metrics.totalCases).toBe(CODE_AGENT_BENCHMARK_CASE_COUNT);
    const candidate = {
      ...complete,
      rolloutAllowed: false,
      rolloutBlockers: ["benchmark baseline unavailable"],
    };

    const baseline = approveCodeAgentBenchmarkBaseline(candidate, {
      baselineId: "approved-test-baseline",
    });

    expect(baseline).toMatchObject({
      kind: "code-agent-benchmark-baseline",
      baselineId: "approved-test-baseline",
      rolloutAllowed: true,
    });
  });

  it("rejects a complete-looking targeted scorecard as a baseline", () => {
    expect(() =>
      approveCodeAgentBenchmarkBaseline(scorecard(), { baselineId: "targeted-baseline" }),
    ).toThrow(/complete 34-case clean witness/i);
  });

  it("rejects provider-unavailable quality evidence", () => {
    const candidate = scorecard();
    const blocked = {
      ...candidate,
      rolloutAllowed: false,
      rolloutBlockers: ["provider unavailable for 1 observed case"],
      metrics: {
        ...candidate.metrics,
        providerUnavailableCount: 1,
        gradeCounts: { ...candidate.metrics.gradeCounts, U: 1 },
      },
    };

    expect(() =>
      approveCodeAgentBenchmarkBaseline(blocked, { baselineId: "unsafe-baseline" }),
    ).toThrow(/provider-unavailable cases/i);
  });

  it("rejects false success, scope escape, and incomplete runs", () => {
    const candidate = scorecard();
    const blocked = {
      ...candidate,
      rolloutAllowed: false,
      rolloutBlockers: ["false success rate increased", "scope escape detected"],
      missingCaseIds: ["missing-case"],
      metrics: {
        ...candidate.metrics,
        complete: false,
        observedCases: 0,
        falseSuccessRate: 0.1,
        scopeEscapeRate: 0.1,
      },
    };

    expect(() =>
      approveCodeAgentBenchmarkBaseline(blocked, { baselineId: "unsafe-baseline" }),
    ).toThrow(/incomplete benchmark|false success|scope escape/i);
  });

  it("rejects metrics that claim completion without matching observations", () => {
    const candidate = scorecard();
    const fabricated = {
      ...candidate,
      metrics: {
        ...candidate.metrics,
        totalCases: 30,
        observedCases: 30,
        complete: true,
      },
    };

    expect(() =>
      approveCodeAgentBenchmarkBaseline(fabricated, { baselineId: "fabricated-baseline" }),
    ).toThrow(/observations do not match/i);
  });
});