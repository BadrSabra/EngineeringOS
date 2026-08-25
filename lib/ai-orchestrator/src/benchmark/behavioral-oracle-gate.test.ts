import { describe, expect, it } from "vitest";
import {
  buildCodeAgentBenchmarkScorecard,
  getCodeAgentBenchmarkCases,
  observationFromCodeAgentExecution,
} from "./code-agent-benchmark.js";

function observation(behavioralOracleStatus: "passed" | "not-available") {
  const testCase = getCodeAgentBenchmarkCases()[0]!;
  return observationFromCodeAgentExecution(testCase, {
    actualTerminal: "READY_FOR_REVIEW",
    candidateHash: "candidate-hash",
    validationStatus: "passed",
    changedPaths: ["lib/ai-orchestrator/src/benchmark-fixtures/single-file-001.ts"],
    allowedPaths: ["lib/ai-orchestrator/src/benchmark-fixtures/single-file-001.ts"],
    filesRead: 1,
    toolCalls: 2,
    repairAttempts: 0,
    rejectedChanges: 0,
    conflict: false,
    typecheckPassed: true,
    testsPassed: null,
    oracleStatus: "passed",
    behavioralOracleStatus,
  });
}

describe("behavioral oracle rollout gate", () => {
  it("blocks a live-quality scorecard when behavioral proof is unavailable", () => {
    const scorecard = buildCodeAgentBenchmarkScorecard({
      cases: [getCodeAgentBenchmarkCases()[0]!],
      results: [observation("not-available")],
    });

    expect(scorecard.rolloutAllowed).toBe(false);
    expect(scorecard.rolloutBlockers).toContain(
      "behavioral oracle missing or failed for 1 observed case",
    );
  });

  it("allows a scoped scorecard when the behavioral oracle passes", () => {
    const scorecard = buildCodeAgentBenchmarkScorecard({
      cases: [getCodeAgentBenchmarkCases()[0]!],
      results: [observation("passed")],
    });

    expect(scorecard.rolloutAllowed).toBe(true);
    expect(scorecard.rolloutBlockers).toEqual([]);
  });
});