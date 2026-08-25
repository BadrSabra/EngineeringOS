import { describe, expect, it } from "vitest";
import {
  buildFreeTierFailureAnalysis,
  getKnownFreeTierFailureAnalysis,
} from "./free-tier-failure-analysis.js";
import { getCodeAgentBenchmarkCases, type CodeAgentBenchmarkObservation } from "./code-agent-benchmark.js";

function failure(caseId: string): CodeAgentBenchmarkObservation {
  return {
    caseId,
    grade: "F",
    correct: false,
    completedFirstAttempt: false,
    repairedWithinThreeAttempts: false,
    usefulButIncomplete: false,
    safelyBlocked: false,
    falseSuccess: true,
    scopeEscape: false,
    conflict: false,
    typecheckPassed: null,
    testsPassed: null,
    filesRead: 1,
    toolCalls: 1,
    repairAttempts: 0,
    rejectedChanges: 0,
  };
}

describe("free-tier failure analysis", () => {
  it("has a documented root cause for every current quality failure", () => {
    const known = getKnownFreeTierFailureAnalysis();
    const expectedFailureIds = [
      "multi-file-003",
      "typecheck-failure-001",
      "multi-file-004",
      "typecheck-failure-002",
      "conflict-001",
      "broad-004",
      "single-file-003",
      "test-failure-001",
      "typecheck-failure-003",
      "single-file-004",
      "test-failure-002",
      "multi-file-001",
      "multi-file-002",
      "dependency-graph-002",
      "broad-002",
    ];

    expect(Object.keys(known).sort()).toEqual([...expectedFailureIds].sort());
    expect(buildFreeTierFailureAnalysis(expectedFailureIds.map(failure))).toHaveLength(15);
    expect(buildFreeTierFailureAnalysis(expectedFailureIds.map(failure)).find(
      (entry) => entry.caseId === "single-file-003",
    )).toMatchObject({
      rootCause: "fixture-oracle-contract",
      disposition: "fixed-requires-rerun",
    });
  });

  it("fails closed when a new F has no diagnosis", () => {
    const unknownCaseId = getCodeAgentBenchmarkCases().find(
      (testCase) => !getKnownFreeTierFailureAnalysis()[testCase.id],
    )?.id;
    expect(unknownCaseId).toBeDefined();
    expect(() => buildFreeTierFailureAnalysis([failure(unknownCaseId!)])).toThrow(
      `Missing free-tier failure analysis for ${unknownCaseId}`,
    );
  });

  it("does not emit analysis for non-failing observations", () => {
    const observation = failure("single-file-003");
    expect(buildFreeTierFailureAnalysis([{ ...observation, grade: "B" }])).toEqual([]);
  });
});