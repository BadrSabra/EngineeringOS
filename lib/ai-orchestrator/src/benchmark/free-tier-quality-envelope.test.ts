import { describe, expect, it } from "vitest";
import {
  CODE_AGENT_BENCHMARK_VERSION,
  getCodeAgentBenchmarkCases,
  observationFromCodeAgentExecution,
  type CodeAgentBenchmarkCase,
} from "./code-agent-benchmark.js";
import {
  buildFreeTierQualityEnvelope,
  buildFreeTierQualityEnvelopeFromRuns,
  buildFreeTierReplayCorpus,
} from "./free-tier-quality-envelope.js";

function makeRun(
  index: number,
  count: number,
  selectedCases: readonly CodeAgentBenchmarkCase[],
  unavailableCaseId?: string,
): Record<string, unknown> {
  return {
    kind: "code-agent-benchmark-airlock",
    version: 1,
    mode: "free-only",
    suiteVersion: CODE_AGENT_BENCHMARK_VERSION,
    runId: `free-run-${index}`,
    targetCaseCount: selectedCases.length,
    providerOrder: ["openrouter"],
    shard: {
      index,
      count,
      caseIds: selectedCases.map((testCase) => testCase.id),
    },
    observations: selectedCases.map((testCase) => {
      const unavailable = testCase.id === unavailableCaseId;
      const telemetry = {
        actualTerminal: unavailable ? "BLOCKED" as const : testCase.expected.terminal,
        validationStatus: unavailable
          ? "unavailable" as const
          : testCase.expected.validation === "unavailable"
            ? "unavailable" as const
            : "passed" as const,
        changedPaths: unavailable || testCase.expected.terminal === "BLOCKED" ? [] : ["src/approved.ts"],
        allowedPaths: unavailable || testCase.expected.terminal === "BLOCKED" ? [] : ["src/approved.ts"],
        filesRead: 1,
        toolCalls: 2,
        repairAttempts: 0,
        rejectedChanges: 0,
        conflict: false,
        typecheckPassed: null,
        testsPassed: testCase.expected.validation === "typecheck" ? null : true,
        providerUnavailable: unavailable,
      };
      const observation = observationFromCodeAgentExecution(testCase, telemetry);
      return {
        caseId: testCase.id,
        provider: unavailable ? null : "openrouter",
        model: unavailable ? null : "test-model:free",
        providerAttempts: unavailable ? 0 : 1,
        observation,
      };
    }),
  };
}

describe("free-tier quality envelope", () => {
  it("aggregates complete shards while excluding U from quality grades", () => {
    const cases = getCodeAgentBenchmarkCases();
    const split = Math.ceil(cases.length / 2);
    const runs = [
      makeRun(0, 2, cases.slice(0, split), cases[0]!.id),
      makeRun(1, 2, cases.slice(split)),
    ];
    const { corpus, envelope } = buildFreeTierQualityEnvelopeFromRuns({
      runs,
      generatedAt: "2026-08-18T00:00:00.000Z",
    });

    expect(corpus.entries).toHaveLength(cases.length);
    expect(envelope.corpus.complete).toBe(true);
    expect(envelope.coverage.providerUnavailableCases).toBe(1);
    expect(envelope.coverage.qualityEligibleCases).toBe(cases.length - 1);
    expect(envelope.qualityGradeCounts).not.toHaveProperty("U");
    expect(envelope.qualityComparisonAllowed).toBe(false);
    expect(envelope.rolloutAllowed).toBe(false);
    expect(envelope.failureAnalysis).toHaveLength(envelope.qualityGradeCounts.F);
    expect(envelope.failureAnalysis.every((failure) => failure.caseId)).toBe(true);
  });

  it("emits a partial envelope instead of treating one shard as a baseline", () => {
    const cases = getCodeAgentBenchmarkCases();
    const run = makeRun(0, 6, cases.slice(0, 5));
    const corpus = buildFreeTierReplayCorpus({ runs: [run] });
    const envelope = buildFreeTierQualityEnvelope({ corpus });

    expect(envelope.corpus.observedCases).toBe(5);
    expect(envelope.corpus.complete).toBe(false);
    expect(envelope.corpus.missingCaseIds).toHaveLength(cases.length - 5);
    expect(envelope.rolloutAllowed).toBe(false);
    expect(envelope.rolloutBlockers).toContain("free-tier replay corpus is incomplete");
    expect(envelope.failureAnalysis).toHaveLength(0);
  });

  it("accepts a single-case rerun as a bounded partial shard", () => {
    const caseToRerun = getCodeAgentBenchmarkCases()[0]!;
    const run = makeRun(0, 1, [caseToRerun], caseToRerun.id);
    const corpus = buildFreeTierReplayCorpus({ runs: [run] });
    const envelope = buildFreeTierQualityEnvelope({ corpus });

    expect(corpus.shardCount).toBe(1);
    expect(envelope.corpus.observedCases).toBe(1);
    expect(envelope.corpus.complete).toBe(false);
    expect(envelope.corpus.missingCaseIds).toHaveLength(33);
  });

  it("rejects raw payloads, paid models, and duplicate runs", () => {
    const cases = getCodeAgentBenchmarkCases();
    const run = makeRun(0, 2, cases.slice(0, 2));

    expect(() => buildFreeTierReplayCorpus({
      runs: [{ ...run, rawResponse: "must not enter corpus" }],
    })).toThrow("raw payload field is not allowed");

    const paidRun = {
      ...run,
      observations: (run.observations as Array<Record<string, unknown>>).map((entry) => ({
        ...entry,
        model: "paid-model",
      })),
    };
    expect(() => buildFreeTierReplayCorpus({ runs: [paidRun] })).toThrow(
      "model is not a bounded free-tier model",
    );
    expect(() => buildFreeTierReplayCorpus({ runs: [run, run] })).toThrow(
      "Duplicate free-tier replay run",
    );
  });
});