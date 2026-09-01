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
    sourceRevision: "b234a1970fcf2f9f47f742e8e7fd0bd47a9d226a",
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
    sourceRevision: "b234a1970fcf2f9f47f742e8e7fd0bd47a9d226a",
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

  it("blocks missing, malformed, stale, and mismatched source revisions", () => {
    const base = {
      targetedRun: run({
        runId: "targeted-run",
        completedAt: "2026-08-19T01:20:00.000Z",
        targetCaseCount: 4,
        diagnosticOnly: true,
        targeted: true,
        partial: true,
        baselineEligibility: "not-eligible",
        targetProfile: "repair-loop",
      }),
      cleanWitnessRun: run(),
      baseline: baseline(),
    };
    const missing = evaluateBenchmarkReleaseGate({
      ...base,
      targetedRun: run({ ...base.targetedRun, sourceRevision: undefined, scorecard: scorecard({ sourceRevision: undefined }) }),
    });
    expect(missing.blockers).toContain("targeted benchmark artifact is missing a server-owned source revision");

    const malformed = evaluateBenchmarkReleaseGate({
      ...base,
      targetedRun: run({ ...base.targetedRun, sourceRevision: "not-a-revision" }),
    });
    expect(malformed.blockers).toContain("targeted benchmark artifact contains a malformed source revision");

    const stale = evaluateBenchmarkReleaseGate({
      ...base,
      targetedRun: run({ ...base.targetedRun, sourceRevision: "a".repeat(40) }),
    });
    expect(stale.blockers).toContain("targeted benchmark artifact contains a stale source revision");

    const mismatched = evaluateBenchmarkReleaseGate({
      ...base,
      cleanWitnessRun: run({ sourceRevision: "b".repeat(64) }),
    });
    expect(mismatched.blockers).toContain("clean-witness benchmark artifact contains a stale source revision");
    expect(mismatched.blockers).toContain("targeted and clean-witness benchmarks use different source revisions");
  });

  it("blocks a clean witness with mixed per-case provenance", () => {
    const cleanWitness = run({
      observations: [{
        caseId: "single-file-001",
        provider: "openrouter",
        model: "model",
        providerAttempts: 1,
        observation: {
          caseId: "single-file-001",
          candidateHash: "b".repeat(64),
          sourceRevision: "b234a1970fcf2f9f47f742e8e7fd0bd47a9d226a",
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
          testsPassed: null,
          filesRead: 1,
          toolCalls: 1,
          repairAttempts: 0,
          rejectedChanges: 0,
        },
      }],
    });
    const decision = evaluateBenchmarkReleaseGate({
      targetedRun: run({
        runId: "targeted-run",
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
      cleanWitnessRun: cleanWitness,
      baseline: baseline(),
    });

    expect(decision.status).toBe("blocked");
    expect(decision.blockers).toContain(
      "clean-witness benchmark per-case observations do not share the server-owned candidate hash",
    );
  });

  it("blocks a clean witness that still has recovery work", () => {
    const decision = evaluateBenchmarkReleaseGate({
      targetedRun: run({
        runId: "targeted-run",
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
      cleanWitnessRun: run({ recoveryCaseIds: ["single-file-001"] }),
      baseline: baseline(),
    });

    expect(decision.status).toBe("blocked");
    expect(decision.blockers).toContain("clean witness must be a fresh complete 34-case run");
  });

  it("blocks a clean witness compared against a different baseline", () => {
    const decision = evaluateBenchmarkReleaseGate({
      targetedRun: run({
        runId: "targeted-run",
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
      cleanWitnessRun: run({
        scorecard: scorecard({
          baselineComparison: {
            status: "passed",
            baselineId: "different-baseline",
            blockers: [],
          },
        }),
      }),
      baseline: baseline(),
    });

    expect(decision.status).toBe("blocked");
    expect(decision.blockers).toContain(
      "clean witness compared against a different approved baseline",
    );
  });

  it("retains a bounded runtime-oracle preflight report and blocks failures", () => {
    const runtimeOraclePreflight = {
      status: "failed" as const,
      checks: [{
        scenarioId: "test-failure-001",
        command: "pnpm --dir lib/ai-orchestrator exec vitest run src/fixture.test.ts",
        status: "failed" as const,
        failureCode: "RUNTIME_ORACLE_FAILED",
      }],
      failureIds: ["test-failure-001"],
    };
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
      cleanWitnessRun: run(),
      baseline: baseline(),
      runtimeOraclePreflight,
    });

    expect(decision.status).toBe("blocked");
    expect(decision.runtimeOraclePreflight).toEqual(runtimeOraclePreflight);
    expect(decision.blockers).toContain("benchmark runtime-oracle preflight failed");
    expect(JSON.stringify(decision)).not.toContain("provider output");
  });
});