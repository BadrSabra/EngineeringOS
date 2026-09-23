import { describe, expect, it } from "vitest";
import {
  buildCodeAgentBenchmarkScorecard,
  getCodeAgentBenchmarkCases,
  type CodeAgentBenchmarkObservation,
} from "./code-agent-benchmark.js";
import {
  comparePairedBaseline,
  runPairedCodeAgentBenchmark,
  type PairedBaselineContract,
  type PairedBaselineRun,
} from "./paired-baseline.js";

const sourceRevision = "a".repeat(40);
const baselineWorkspaceHash = "b".repeat(64);
const candidateWorkspaceHash = "c".repeat(64);

function observation(
  caseId: string,
  overrides: Partial<CodeAgentBenchmarkObservation> = {},
): CodeAgentBenchmarkObservation {
  return {
    caseId,
    candidateHash: "d".repeat(64),
    sourceRevision,
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
    providerUnavailable: false,
    evidenceCoverage: 1,
    validatorOutcome: "passed",
    duplicateCalls: 0,
    unauthorizedCalls: 0,
    recoveryCount: 0,
    terminalOutcome: "completed",
    durationMs: 100,
    costUnits: 1,
    ...overrides,
  };
}

function contract(overrides: Partial<PairedBaselineContract> = {}): PairedBaselineContract {
  return {
    kind: "code-agent-benchmark-paired-contract",
    version: 1,
    pairId: "pair-001",
    suiteVersion: "flight-deck-v2",
    sourceRevision,
    objectiveDigest: "objective-digest",
    scopeDigest: "scope-digest",
    budgetDigest: "budget-digest",
    baselineRunId: "baseline-run",
    candidateRunId: "candidate-run",
    baselineWorkspaceHash,
    candidateWorkspaceHash,
    candidateId: "candidate-001",
    ...overrides,
  };
}

function run(
  runId: string,
  workspaceHash: string,
  results: readonly CodeAgentBenchmarkObservation[],
  overrides: Partial<PairedBaselineRun> = {},
): PairedBaselineRun {
  const scorecard = buildCodeAgentBenchmarkScorecard({
    results,
    cases: getCodeAgentBenchmarkCases().slice(0, results.length),
  });
  return {
    runId,
    workspaceHash,
    sourceRevision,
    objectiveDigest: "objective-digest",
    scopeDigest: "scope-digest",
    budgetDigest: "budget-digest",
    scorecard,
    observations: results,
    ...overrides,
  };
}

describe("paired baseline gate", () => {
  it("passes only when both sides have complete, equivalent evidence", () => {
    const cases = getCodeAgentBenchmarkCases().slice(0, 2);
    const baselineResults = cases.map((testCase) => observation(testCase.id));
    const candidateResults = cases.map((testCase) => observation(testCase.id));
    const result = comparePairedBaseline({
      contract: contract(),
      baseline: run("baseline-run", baselineWorkspaceHash, baselineResults),
      candidate: run("candidate-run", candidateWorkspaceHash, candidateResults),
    });

    expect(result.status).toBe("passed");
    expect(result.promotionAllowed).toBe(true);
    expect(result.metricDeltas).toMatchObject({
      evidenceCoverage: 0,
      validatorPassRate: 0,
      duplicateCalls: 0,
      unauthorizedCalls: 0,
    });
  });

  it("fails closed when paired evidence is missing", () => {
    const testCase = getCodeAgentBenchmarkCases()[0];
    const result = comparePairedBaseline({
      contract: contract(),
      baseline: run("baseline-run", baselineWorkspaceHash, [observation(testCase.id)]),
      candidate: run("candidate-run", candidateWorkspaceHash, [
        observation(testCase.id, { evidenceCoverage: undefined }),
      ]),
    });

    expect(result.status).toBe("incomplete");
    expect(result.promotionAllowed).toBe(false);
    expect(result.blockers).toContain(`paired evidence is incomplete for case ${testCase.id}`);
  });

  it("blocks evidence, validator, authorization, terminal, and resource regressions", () => {
    const testCase = getCodeAgentBenchmarkCases()[0];
    const result = comparePairedBaseline({
      contract: contract(),
      baseline: run("baseline-run", baselineWorkspaceHash, [observation(testCase.id)]),
      candidate: run("candidate-run", candidateWorkspaceHash, [
        observation(testCase.id, {
          evidenceCoverage: 0.5,
          validatorOutcome: "failed",
          unauthorizedCalls: 1,
          terminalOutcome: "failed",
          durationMs: 200,
          costUnits: 2,
        }),
      ]),
    });

    expect(result.status).toBe("regressed");
    expect(result.promotionAllowed).toBe(false);
    expect(result.blockers).toEqual(expect.arrayContaining([
      `evidence coverage regressed for ${testCase.id}`,
      `validator outcome regressed for ${testCase.id}`,
      `unauthorized calls detected for ${testCase.id}`,
      `terminal outcome changed for ${testCase.id}`,
      `duration regressed for ${testCase.id}`,
      `cost regressed for ${testCase.id}`,
    ]));
  });

  it("rejects a contract that aliases the workspaces or changes the objective", () => {
    const testCase = getCodeAgentBenchmarkCases()[0];
    const result = comparePairedBaseline({
      contract: contract({
        candidateWorkspaceHash: baselineWorkspaceHash,
        scopeDigest: "different-scope",
      }),
      baseline: run("baseline-run", baselineWorkspaceHash, [observation(testCase.id)]),
      candidate: run("candidate-run", candidateWorkspaceHash, [
        observation(testCase.id, { scopeEscape: false }),
      ], { scopeDigest: "different-scope" }),
    });

    expect(result.status).toBe("incomplete");
    expect(result.promotionAllowed).toBe(false);
    expect(result.blockers).toEqual(expect.arrayContaining([
      "paired baseline and candidate workspaces are not distinct",
      "paired baseline objective, scope, or budget differs",
    ]));
  });

  it("rejects a run whose workspace identity was not the one in the contract", () => {
    const testCase = getCodeAgentBenchmarkCases()[0];
    const result = comparePairedBaseline({
      contract: contract(),
      baseline: run("baseline-run", "e".repeat(64), [observation(testCase.id)]),
      candidate: run("candidate-run", candidateWorkspaceHash, [observation(testCase.id)]),
    });

    expect(result.status).toBe("incomplete");
    expect(result.blockers).toContain(
      "paired baseline workspace identity does not match the contract",
    );
  });

  it("runs baseline and candidate through the same case manifest", async () => {
    const testCase = getCodeAgentBenchmarkCases()[0];
    const telemetry = {
      actualTerminal: "READY_FOR_REVIEW" as const,
      validationStatus: "passed" as const,
      changedPaths: ["docs/guide.md"],
      allowedPaths: ["docs/guide.md"],
      filesRead: 1,
      toolCalls: 1,
      repairAttempts: 0,
      rejectedChanges: 0,
      conflict: false,
      typecheckPassed: true,
      testsPassed: true,
      candidateHash: baselineWorkspaceHash,
      sourceRevision,
      evidenceCoverage: 1,
      validatorOutcome: "passed" as const,
      duplicateCalls: 0,
      unauthorizedCalls: 0,
      recoveryCount: 0,
      terminalOutcome: "completed" as const,
      durationMs: 10,
      costUnits: 1,
    };
    const result = await runPairedCodeAgentBenchmark({
      contract: contract(),
      cases: [testCase],
      baseline: {
        runId: "baseline-run",
        workspaceHash: baselineWorkspaceHash,
        sourceRevision,
        objectiveDigest: "objective-digest",
        scopeDigest: "scope-digest",
        budgetDigest: "budget-digest",
        executeCase: async () => telemetry,
      },
      candidate: {
        runId: "candidate-run",
        workspaceHash: candidateWorkspaceHash,
        sourceRevision,
        objectiveDigest: "objective-digest",
        scopeDigest: "scope-digest",
        budgetDigest: "budget-digest",
        executeCase: async () => ({ ...telemetry, candidateHash: candidateWorkspaceHash }),
      },
    });

    expect(result.baseline.observations).toHaveLength(1);
    expect(result.candidate.observations).toHaveLength(1);
    expect(result.comparison.status).toBe("passed");
  });
});