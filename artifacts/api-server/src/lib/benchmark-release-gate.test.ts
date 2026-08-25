import { describe, expect, it } from "vitest";
import type {
  BenchmarkAirlockRun,
  CodeAgentBenchmarkBaseline,
  CodeAgentBenchmarkScorecard,
} from "@workspace/ai-orchestrator";
import { evaluateBenchmarkReleaseGate } from "./benchmark-release-gate.js";

function scorecard(overrides: Partial<CodeAgentBenchmarkScorecard> = {}): CodeAgentBenchmarkScorecard {
  return {
    kind: "code-agent-benchmark",
    version: 1,
    suiteVersion: "flight-deck-v2",
    generatedAt: "2026-08-19T00:00:00.000Z",
    cases: [],
    candidateHash: "a".repeat(64),
    missingCaseIds: [],
    metrics: {
      totalCases: 34,
      observedCases: 34,
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
      averageLatencyMs: 1,
      gradeCounts: { A: 34, B: 0, C: 0, D: 0, F: 0, U: 0 },
      providerUnavailableCount: 0,
    },
    rolloutAllowed: true,
    rolloutBlockers: [],
    baselineComparison: { status: "passed", blockers: [] },
    ...overrides,
  };
}

function run(overrides: Partial<BenchmarkAirlockRun> = {}): BenchmarkAirlockRun {
  return {
    kind: "code-agent-benchmark-airlock",
    version: 1,
    mode: "live",
    campaignMode: "clean-witness",
    campaignStatus: "clean-witness",
    recoveryCaseIds: [],
    recoveryOnly: false,
    diagnosticOnly: false,
    targeted: false,
    partial: false,
    baselineEligibility: "quality-gates-required",
    suiteVersion: "flight-deck-v2",
    runId: "clean-witness-run",
    startedAt: "2026-08-19T02:00:00.000Z",
    completedAt: "2026-08-19T02:10:00.000Z",
    targetCaseCount: 34,
    providerOrder: ["openrouter"],
    providerHealth: [],
    observations: [],
    scorecard: scorecard(),
    ...overrides,
  };
}

function baseline(): CodeAgentBenchmarkBaseline {
  return {
    kind: "code-agent-benchmark-baseline",
    version: 1,
    baselineId: "approved-flight-deck-v2",
    suiteVersion: "flight-deck-v2",
    generatedAt: "2026-08-18T00:00:00.000Z",
    rolloutAllowed: true,
    metrics: scorecard().metrics,
  };
}

describe("benchmark release gate", () => {
  it("allows rollout only after targeted, clean witness, comparison, and approval", () => {
    const decision = evaluateBenchmarkReleaseGate({
      targetedRun: run({
        runId: "repair-loop-run",
        startedAt: "2026-08-19T01:00:00.000Z",
        completedAt: "2026-08-19T01:20:00.000Z",
        targetCaseCount: 4,
        diagnosticOnly: true,
        targeted: true,
        partial: true,
        baselineEligibility: "not-eligible",
        targetProfile: "repair-loop",
        scorecard: scorecard({ rolloutAllowed: false }),
      }),
      cleanWitnessRun: run(),
      baseline: baseline(),
    });

    expect(decision.status).toBe("ready-for-rollout");
    expect(decision.blockers).toEqual([]);
    expect(decision.monitoring).toMatchObject({
      required: true,
      surface: "Mission Control",
      endpoint: "/api/ai/mission-control",
    });
  });

  it("blocks F/U outcomes and an out-of-order clean witness", () => {
    const targeted = run({
      runId: "targeted-run",
      completedAt: "2026-08-19T03:00:00.000Z",
      targetCaseCount: 4,
      diagnosticOnly: true,
      targeted: true,
      partial: true,
      baselineEligibility: "not-eligible",
      targetProfile: "repair-loop",
      scorecard: scorecard({
        rolloutAllowed: false,
        metrics: {
          ...scorecard().metrics,
          gradeCounts: { A: 2, B: 0, C: 0, D: 0, F: 1, U: 1 },
          providerUnavailableCount: 1,
        },
      }),
    });
    const decision = evaluateBenchmarkReleaseGate({
      targetedRun: targeted,
      cleanWitnessRun: run({ startedAt: "2026-08-19T02:00:00.000Z" }),
      baseline: baseline(),
    });

    expect(decision.status).toBe("blocked");
    expect(decision.blockers).toEqual(expect.arrayContaining([
      "targeted benchmark still contains F/U or unsafe outcomes; fix regressions first",
      "clean witness did not start after the successful targeted benchmark",
    ]));
  });

  it("blocks release when targeted and clean-witness hashes differ", () => {
    const decision = evaluateBenchmarkReleaseGate({
      targetedRun: run({
        runId: "targeted-run",
        completedAt: "2026-08-19T01:20:00.000Z",
        targetCaseCount: 4,
        diagnosticOnly: true,
        targeted: true,
        partial: true,
        baselineEligibility: "not-eligible",
        targetProfile: "repair-loop",
        scorecard: scorecard({ rolloutAllowed: false }),
      }),
      cleanWitnessRun: run({
        scorecard: scorecard({ candidateHash: "b".repeat(64) }),
      }),
      baseline: baseline(),
    });

    expect(decision.status).toBe("blocked");
    expect(decision.blockers).toContain(
      "targeted and clean-witness benchmarks use different candidate hashes",
    );
  });
});