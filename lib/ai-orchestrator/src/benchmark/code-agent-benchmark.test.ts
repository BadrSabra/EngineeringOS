import { describe, expect, it } from "vitest";
import {
  CODE_AGENT_BENCHMARK_CASE_COUNT,
  CODE_AGENT_BENCHMARK_TARGET_PROFILES,
  applyCodeAgentBenchmarkBaselineGate,
  buildCodeAgentBenchmarkReplayRecord,
  buildCodeAgentBenchmarkScorecard,
  codeAgentBenchmarkManifestToMarkdown,
  codeAgentBenchmarkScorecardToMarkdown,
  getCodeAgentBenchmarkCases,
  getCodeAgentBenchmarkCategoryCounts,
  getCodeAgentBenchmarkTargetProfileCases,
  getTargetedCodeAgentBenchmarkCases,
  TARGETED_CODE_AGENT_BENCHMARK_CASE_IDS,
  observationFromCodeAgentExecution,
  runCodeAgentBenchmark,
  runCodeAgentBenchmarkReplay,
  validateCodeAgentBenchmarkManifest,
  type CodeAgentBenchmarkObservation,
  type CodeAgentBenchmarkBaseline,
  type CodeAgentBenchmarkReplayEntry,
} from "./code-agent-benchmark.js";

function observation(
  caseId: string,
  overrides: Partial<CodeAgentBenchmarkObservation> = {},
): CodeAgentBenchmarkObservation {
  return {
    caseId,
    candidateHash: "a".repeat(64),
    sourceRevision: "672a2447a0604e4f562796dab969b5d136582277",
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
    filesRead: 2,
    toolCalls: 4,
    repairAttempts: 1,
    rejectedChanges: 0,
    diagnosis: "Test fixture outcome is bounded and explained.",
    latencyMs: 120,
    ...overrides,
  };
}

describe("Code Agent benchmark manifest", () => {
  it("defines a stable high-signal targeted aggregate order", () => {
    expect(getTargetedCodeAgentBenchmarkCases().map((testCase) => testCase.id)).toEqual(
      [...TARGETED_CODE_AGENT_BENCHMARK_CASE_IDS],
    );
    expect(getTargetedCodeAgentBenchmarkCases()).toHaveLength(6);
    expect(validateCodeAgentBenchmarkManifest(getTargetedCodeAgentBenchmarkCases(), {
      requireComplete: false,
    })).toEqual([]);
  });

  it("provides deterministic focused profiles for common change areas", () => {
    expect(Object.keys(CODE_AGENT_BENCHMARK_TARGET_PROFILES)).toEqual([
      "repair-loop",
      "scope-enforcement",
      "provider-fallback",
      "forensic-routing",
    ]);
    expect(getCodeAgentBenchmarkTargetProfileCases("repair-loop").map((testCase) => testCase.id)).toEqual([
      "test-failure-001",
      "test-failure-002",
      "test-failure-004",
      "typecheck-failure-001",
    ]);
    expect(getCodeAgentBenchmarkTargetProfileCases("scope-enforcement").map((testCase) => testCase.id)).toEqual([
      "scope-001",
      "conflict-001",
      "conflict-002",
      "conflict-003",
      "blocked-003",
    ]);
    for (const profile of Object.keys(CODE_AGENT_BENCHMARK_TARGET_PROFILES) as Array<keyof typeof CODE_AGENT_BENCHMARK_TARGET_PROFILES>) {
      const profileCases = getCodeAgentBenchmarkTargetProfileCases(profile);
      expect(validateCodeAgentBenchmarkManifest(profileCases, { requireComplete: false })).toEqual([]);
      expect(new Set(profileCases.map((testCase) => testCase.id)).size).toBe(profileCases.length);
    }
  });

  it("contains the complete 34-case matrix from the plan", () => {
    const cases = getCodeAgentBenchmarkCases();
    expect(cases).toHaveLength(CODE_AGENT_BENCHMARK_CASE_COUNT);
    expect(new Set(cases.map((testCase) => testCase.id)).size).toBe(cases.length);
    expect(validateCodeAgentBenchmarkManifest()).toEqual([]);
    expect(getCodeAgentBenchmarkCategoryCounts(cases)).toEqual({
      "single-file-edit": 4,
      "multi-file-change": 4,
      "test-failure-repair": 4,
      "typecheck-failure-repair": 4,
      "dependency-graph-change": 3,
      "conflict-recovery": 3,
      "cancellation-recovery": 1,
      "scope-safety": 1,
      "malformed-output": 1,
      "blocked-proof": 1,
      "broad-decomposition": 4,
      "safely-blocked": 4,
    });
  });

  it("renders a bounded manifest without model or source payloads", () => {
    const markdown = codeAgentBenchmarkManifestToMarkdown();
    expect(markdown).toContain("Suite: flight-deck-v2");
    expect(markdown).toContain("Cases: 34");
    expect(markdown).toContain("safely-blocked");
    expect(markdown).not.toContain("rawResponse");
    expect(markdown).not.toContain("sourceContent");
  });

  it("blocks rollout for incomplete observations and any false success", () => {
    const scorecard = buildCodeAgentBenchmarkScorecard({
      generatedAt: "2026-08-17T00:00:00.000Z",
      results: [
        observation("single-file-001", {
          grade: "F",
          correct: false,
          falseSuccess: true,
          scopeEscape: true,
        }),
      ],
    });

    expect(scorecard.metrics.totalCases).toBe(34);
    expect(scorecard.metrics.observedCases).toBe(1);
    expect(scorecard.metrics.complete).toBe(false);
    expect(scorecard.metrics.falseSuccessRate).toBe(1);
    expect(scorecard.metrics.scopeEscapeRate).toBe(1);
    expect(scorecard.rolloutAllowed).toBe(false);
    expect(scorecard.rolloutBlockers).toEqual(expect.arrayContaining([
      expect.stringContaining("incomplete"),
      "false success detected",
      "scope escape detected",
    ]));
    expect(scorecard.missingCaseIds).toHaveLength(33);
    expect(JSON.stringify(scorecard)).not.toContain("rawResponse");
  });

  it("allows a complete safe scorecard and separates repair from first-attempt success", () => {
    const results = getCodeAgentBenchmarkCases().map((testCase) =>
      observation(testCase.id, {
        completedFirstAttempt: testCase.id === "single-file-001",
        repairedWithinThreeAttempts: testCase.id !== "single-file-001",
        safelyBlocked: testCase.expected.terminal === "BLOCKED",
        typecheckPassed: testCase.expected.validation === "tests" ? null : true,
        testsPassed: testCase.expected.validation === "typecheck" ? null : true,
      }),
    );
    const scorecard = buildCodeAgentBenchmarkScorecard({
      generatedAt: "2026-08-17T00:00:00.000Z",
      results,
    });

    expect(scorecard.rolloutAllowed).toBe(true);
    expect(scorecard.rolloutBlockers).toEqual([]);
    expect(scorecard.metrics.complete).toBe(true);
    expect(scorecard.metrics.firstAttemptRate).toBeCloseTo(1 / 34);
    expect(scorecard.metrics.repairedWithinThreeRate).toBeCloseTo(33 / 34);
    expect(scorecard.metrics.safelyBlockedRate).toBeCloseTo(14 / 34);
    expect(scorecard.metrics.typecheckSuccessRate).toBe(1);
    expect(scorecard.metrics.testSuccessRate).toBe(1);
    expect(scorecard.metrics.gradeCounts.A).toBe(34);
  });

  it("derives safe grades from execution telemetry", () => {
    const firstAttempt = observationFromCodeAgentExecution(
      getCodeAgentBenchmarkCases()[0]!,
      {
        actualTerminal: "READY_FOR_REVIEW",
        validationStatus: "passed",
        changedPaths: ["src/feature.ts"],
        allowedPaths: ["src/feature.ts"],
        filesRead: 1,
        toolCalls: 3,
        repairAttempts: 0,
        rejectedChanges: 0,
        conflict: false,
        typecheckPassed: null,
        testsPassed: true,
      },
    );
    expect(firstAttempt.grade).toBe("A");
    expect(firstAttempt.correct).toBe(true);

    const unsafe = observationFromCodeAgentExecution(
      getCodeAgentBenchmarkCases()[0]!,
      {
        actualTerminal: "READY_FOR_REVIEW",
        validationStatus: "not-run",
        changedPaths: ["src/feature.ts", "src/unapproved.ts"],
        allowedPaths: ["src/feature.ts"],
        filesRead: 1,
        toolCalls: 3,
        repairAttempts: 1,
        rejectedChanges: 0,
        conflict: false,
        typecheckPassed: null,
        testsPassed: null,
      },
    );
    expect(unsafe.grade).toBe("F");
    expect(unsafe.falseSuccess).toBe(true);
    expect(unsafe.scopeEscape).toBe(true);
  });

  it("does not let a drifted oracle verdict become a successful observation", () => {
    const testCase = getCodeAgentBenchmarkCases().find(
      (candidate) => candidate.expected.terminal === "READY_FOR_REVIEW",
    )!;
    const result = observationFromCodeAgentExecution(testCase, {
      actualTerminal: "READY_FOR_REVIEW",
      validationStatus: "passed",
      changedPaths: ["src/feature.ts"],
      allowedPaths: ["src/feature.ts"],
      filesRead: 1,
      toolCalls: 2,
      repairAttempts: 0,
      rejectedChanges: 0,
      conflict: false,
      typecheckPassed: true,
      testsPassed: null,
      oracleStatus: "failed",
      oracleCode: "VERDICT_DRIFT",
    });

    expect(result.grade).toBe("F");
    expect(result.correct).toBe(false);
    expect(result.falseSuccess).toBe(true);
    expect(result.diagnosis).toMatch(/false success|behavioral proof/i);
  });

  it("blocks rollout when an otherwise passing observation has incomplete oracle evidence", () => {
    const testCase = getCodeAgentBenchmarkCases()[0]!;
    const result = observation(testCase.id, {
      behavioralOracleStatus: "not-run",
    });
    const scorecard = buildCodeAgentBenchmarkScorecard({
      cases: [testCase],
      results: [result],
    });

    expect(result.grade).toBe("A");
    expect(scorecard.rolloutAllowed).toBe(false);
    expect(scorecard.rolloutBlockers).toContain(
      "behavioral oracle missing or failed for 1 observed case",
    );
  });

  it("binds rollout proof to one exact candidate hash without changing grades", () => {
    const testCase = getCodeAgentBenchmarkCases()[0]!;
    const candidateHash = "a".repeat(64);
    const matching = buildCodeAgentBenchmarkScorecard({
      cases: [testCase],
      results: [observation(testCase.id, { candidateHash })],
    });
    expect(matching.rolloutAllowed).toBe(true);
    expect(matching.cases[0]?.grade).toBe("A");
    expect(matching.candidateHash).toBe(candidateHash);

    const stale = buildCodeAgentBenchmarkScorecard({
      cases: [testCase, getCodeAgentBenchmarkCases()[1]!],
      results: [
        observation(testCase.id, { candidateHash }),
        observation("single-file-002", { candidateHash: "b".repeat(64) }),
      ],
    });
    expect(stale.rolloutAllowed).toBe(false);
    expect(stale.rolloutBlockers).toContain("candidate hash mismatch across benchmark observations");
    expect(stale.cases.map((result) => result.grade)).toEqual(["A", "A"]);

    const missing = buildCodeAgentBenchmarkScorecard({
      cases: [testCase],
      results: [observation(testCase.id, { candidateHash: undefined })],
    });
    expect(missing.rolloutAllowed).toBe(false);
    expect(missing.rolloutBlockers).toContain("candidate hash missing for 1 observed case");
    expect(missing.cases[0]?.grade).toBe("A");

    const malformed = buildCodeAgentBenchmarkScorecard({
      cases: [testCase],
      results: [observation(testCase.id, { candidateHash: "caller-supplied-stale-hash" })],
    });
    expect(malformed.rolloutAllowed).toBe(false);
    expect(malformed.rolloutBlockers).toContain("candidate hash malformed for 1 observed case");
    expect(malformed.cases[0]?.grade).toBe("A");
  });

  it("does not treat skipped validation as proof for a review-ready terminal", () => {
    const testCase = getCodeAgentBenchmarkCases().find(
      (candidate) => candidate.expected.terminal === "READY_FOR_REVIEW",
    )!;
    const result = observationFromCodeAgentExecution(testCase, {
      actualTerminal: "READY_FOR_REVIEW",
      validationStatus: "not-run",
      changedPaths: ["src/feature.ts"],
      allowedPaths: ["src/feature.ts"],
      filesRead: 1,
      toolCalls: 1,
      repairAttempts: 0,
      rejectedChanges: 0,
      conflict: false,
      typecheckPassed: null,
      testsPassed: null,
    });

    expect(result.grade).toBe("F");
    expect(result.falseSuccess).toBe(true);
    expect(result.correct).toBe(false);
  });

  it("keeps terminal mismatches distinct from safely blocked outcomes", () => {
    const readyCase = getCodeAgentBenchmarkCases().find(
      (candidate) => candidate.expected.terminal === "READY_FOR_REVIEW",
    )!;
    const blockedCase = getCodeAgentBenchmarkCases().find(
      (candidate) => candidate.expected.terminal === "BLOCKED",
    )!;

    const incomplete = observationFromCodeAgentExecution(readyCase, {
      actualTerminal: "BLOCKED",
      validationStatus: "not-run",
      changedPaths: ["src/feature.ts"],
      allowedPaths: ["src/feature.ts"],
      filesRead: 1,
      toolCalls: 1,
      repairAttempts: 1,
      rejectedChanges: 0,
      conflict: false,
      typecheckPassed: null,
      testsPassed: null,
    });
    const falseSuccess = observationFromCodeAgentExecution(blockedCase, {
      actualTerminal: "READY_FOR_REVIEW",
      validationStatus: "passed",
      changedPaths: [],
      allowedPaths: [],
      filesRead: 1,
      toolCalls: 1,
      repairAttempts: 0,
      rejectedChanges: 0,
      conflict: false,
      typecheckPassed: null,
      testsPassed: null,
    });

    expect(incomplete.grade).toBe("C");
    expect(incomplete.usefulButIncomplete).toBe(true);
    expect(incomplete.safelyBlocked).toBe(false);
    expect(falseSuccess.grade).toBe("F");
    expect(falseSuccess.falseSuccess).toBe(true);
  });

  it("separates provider unavailability from agent-quality failures", () => {
    const unavailable = observationFromCodeAgentExecution(
      getCodeAgentBenchmarkCases()[0]!,
      {
        actualTerminal: "BLOCKED",
        validationStatus: "unavailable",
        changedPaths: [],
        allowedPaths: ["src/feature.ts"],
        filesRead: 0,
        toolCalls: 1,
        repairAttempts: 0,
        rejectedChanges: 0,
        conflict: false,
        typecheckPassed: null,
        testsPassed: null,
        providerUnavailable: true,
      },
    );

    expect(unavailable.grade).toBe("U");
    expect(unavailable.providerUnavailable).toBe(true);
    expect(unavailable.falseSuccess).toBe(false);
    expect(unavailable.diagnosis).toContain("Provider unavailable");

    const scorecard = buildCodeAgentBenchmarkScorecard({
      results: [
        observation("single-file-001", {
          grade: "U",
          correct: false,
          completedFirstAttempt: false,
          providerUnavailable: true,
        }),
        observation("single-file-002"),
      ],
    });

    expect(scorecard.metrics.providerUnavailableCount).toBe(1);
    expect(scorecard.metrics.gradeCounts.U).toBe(1);
    expect(scorecard.metrics.gradeCounts.F).toBe(0);
    expect(scorecard.metrics.correctCompletionRate).toBe(1);
    expect(scorecard.rolloutBlockers).toContain("provider unavailable for 1 observed case");
    expect(scorecard.rolloutBlockers).not.toContain("failing benchmark case detected");
  });

  it("keeps a provider timeout classified as U even when the executor reports a ready terminal", () => {
    const unavailable = observationFromCodeAgentExecution(
      getCodeAgentBenchmarkCases()[0]!,
      {
        actualTerminal: "READY_FOR_REVIEW",
        validationStatus: "unavailable",
        changedPaths: [],
        allowedPaths: ["src/feature.ts"],
        filesRead: 0,
        toolCalls: 8,
        repairAttempts: 0,
        rejectedChanges: 0,
        conflict: false,
        typecheckPassed: null,
        testsPassed: null,
        providerUnavailable: true,
      },
    );

    expect(unavailable.grade).toBe("U");
    expect(unavailable.falseSuccess).toBe(false);
  });

  it("blocks a review-ready result when the server-owned oracle fails", () => {
    const result = observationFromCodeAgentExecution(
      getCodeAgentBenchmarkCases()[0]!,
      {
        actualTerminal: "READY_FOR_REVIEW",
        validationStatus: "passed",
        changedPaths: ["src/feature.ts"],
        allowedPaths: ["src/feature.ts"],
        filesRead: 1,
        toolCalls: 3,
        repairAttempts: 0,
        rejectedChanges: 0,
        conflict: false,
        typecheckPassed: null,
        testsPassed: true,
        oracleStatus: "failed",
        oracleCode: "READY_WITHOUT_PENDING_CHANGES",
      },
    );

    expect(result.grade).toBe("F");
    expect(result.correct).toBe(false);
    expect(result.falseSuccess).toBe(true);
  });

  it("runs all cases through a real-executor boundary without retaining payloads", async () => {
    const scorecard = await runCodeAgentBenchmark({
      generatedAt: "2026-08-17T00:00:00.000Z",
      executeCase: async (testCase) => ({
        actualTerminal: testCase.expected.terminal,
        validationStatus: testCase.expected.validation === "unavailable" ? "unavailable" as const : "passed" as const,
        changedPaths: testCase.expected.terminal === "BLOCKED" ? [] : ["src/approved.ts"],
        allowedPaths: testCase.expected.terminal === "BLOCKED" ? [] : ["src/approved.ts"],
        filesRead: 1,
        toolCalls: 2,
        repairAttempts: 0,
        rejectedChanges: 0,
        conflict: false,
        typecheckPassed: testCase.expected.validation === "tests" ? null : true,
        testsPassed: testCase.expected.validation === "typecheck" ? null : true,
         candidateHash: "a".repeat(64),
        sourceRevision: "672a2447a0604e4f562796dab969b5d136582277",
      }),
    });

    expect(scorecard.metrics.complete).toBe(true);
    expect(scorecard.metrics.gradeCounts.A).toBe(20);
    expect(scorecard.metrics.gradeCounts.D).toBe(14);
    expect(scorecard.rolloutAllowed).toBe(true);
    expect(JSON.stringify(scorecard)).not.toContain("providerResponse");
  });

  it("checkpoints each new case and resumes without rerunning completed observations", async () => {
    const cases = getCodeAgentBenchmarkCases().slice(0, 2);
    const executed: string[] = [];
    const checkpoints: number[] = [];
    const scorecard = await runCodeAgentBenchmark({
      cases,
      initialResults: [observation(cases[0]!.id)],
      executeCase: async (testCase) => {
        executed.push(testCase.id);
        return {
          actualTerminal: testCase.expected.terminal,
          validationStatus: "passed" as const,
          changedPaths: [],
          allowedPaths: [],
          filesRead: 1,
          toolCalls: 1,
          repairAttempts: 0,
          rejectedChanges: 0,
          conflict: false,
          typecheckPassed: null,
          testsPassed: null,
         candidateHash: "a".repeat(64),
          sourceRevision: "672a2447a0604e4f562796dab969b5d136582277",
        };
      },
      onCaseComplete: async (_result, results) => {
        checkpoints.push(results.length);
      },
    });

    expect(executed).toEqual([cases[1]!.id]);
    expect(checkpoints).toEqual([2]);
    expect(scorecard.cases.map((result) => result.caseId)).toEqual(
      cases.map((testCase) => testCase.id),
    );
  });

  it("records bounded telemetry and replays the full matrix without a provider", async () => {
    const replayEntries: CodeAgentBenchmarkReplayEntry[] = [];
    const scorecard = await runCodeAgentBenchmark({
      executeCase: async (testCase) => ({
        actualTerminal: testCase.expected.terminal,
        validationStatus: testCase.expected.validation === "unavailable" ? "unavailable" as const : "passed" as const,
        changedPaths: testCase.expected.terminal === "BLOCKED" ? [] : ["src/approved.ts"],
        allowedPaths: testCase.expected.terminal === "BLOCKED" ? [] : ["src/approved.ts"],
        filesRead: 1,
        toolCalls: 2,
        repairAttempts: 0,
        rejectedChanges: 0,
        conflict: false,
        typecheckPassed: testCase.expected.validation === "tests" ? null : true,
        testsPassed: testCase.expected.validation === "typecheck" ? null : true,
         candidateHash: "a".repeat(64),
        sourceRevision: "672a2447a0604e4f562796dab969b5d136582277",
      }),
      onTelemetryComplete: async (testCase, telemetry) => {
        replayEntries.push({ caseId: testCase.id, telemetry });
      },
    });

    expect(scorecard.metrics.complete).toBe(true);
    expect(replayEntries).toHaveLength(CODE_AGENT_BENCHMARK_CASE_COUNT);
    const record = buildCodeAgentBenchmarkReplayRecord({
      entries: replayEntries,
      recordedAt: "2026-08-18T00:00:00.000Z",
    });
    const replayed = runCodeAgentBenchmarkReplay({
      record,
      generatedAt: "2026-08-18T00:01:00.000Z",
    });

    expect(replayed.metrics.complete).toBe(true);
    expect(replayed.metrics.gradeCounts.A).toBe(20);
    expect(replayed.metrics.gradeCounts.D).toBe(14);
    expect(replayed.rolloutAllowed).toBe(true);
    expect(JSON.stringify(record)).not.toContain("rawResponse");
    expect(JSON.stringify(record)).not.toContain("sourceContent");
  });

  it("requires an approved baseline and blocks quality regression beyond tolerance", () => {
    const cases = getCodeAgentBenchmarkCases();
    const baselineScorecard = buildCodeAgentBenchmarkScorecard({
      results: cases.map((testCase) => observation(testCase.id)),
    });
    const baseline: CodeAgentBenchmarkBaseline = {
      kind: "code-agent-benchmark-baseline",
      version: 1,
      baselineId: "approved-baseline",
      suiteVersion: baselineScorecard.suiteVersion,
      generatedAt: "2026-08-18T00:00:00.000Z",
      metrics: baselineScorecard.metrics,
      rolloutAllowed: true,
    };

    const passing = applyCodeAgentBenchmarkBaselineGate({
      scorecard: baselineScorecard,
      baseline,
    });
    expect(passing.baselineComparison?.status).toBe("passed");
    expect(passing.rolloutAllowed).toBe(true);

    const regressed = buildCodeAgentBenchmarkScorecard({
      results: cases.map((testCase, index) =>
        observation(testCase.id, index < 2
          ? { completedFirstAttempt: false, repairedWithinThreeAttempts: true }
          : {}),
      ),
    });
    const gated = applyCodeAgentBenchmarkBaselineGate({ scorecard: regressed, baseline });
    expect(gated.baselineComparison?.status).toBe("regressed");
    expect(gated.rolloutAllowed).toBe(false);
    expect(gated.rolloutBlockers).toContain("first-attempt rate regressed by 0.059 vs baseline");

    const missing = applyCodeAgentBenchmarkBaselineGate({ scorecard: baselineScorecard });
    expect(missing.baselineComparison?.status).toBe("missing");
    expect(missing.rolloutAllowed).toBe(false);
    expect(missing.rolloutBlockers).toContain("benchmark baseline unavailable");
  });

  it("blocks rollout when a D result has no bounded explanation", () => {
    const cases = getCodeAgentBenchmarkCases();
    const results = cases.map((testCase) =>
      observation(testCase.id, {
        grade: testCase.expected.terminal === "BLOCKED" ? "D" : "A",
        correct: true,
        safelyBlocked: testCase.expected.terminal === "BLOCKED",
        diagnosis: testCase.expected.terminal === "BLOCKED" ? undefined : "passed",
      }),
    );
    const scorecard = buildCodeAgentBenchmarkScorecard({ results });

    expect(scorecard.rolloutAllowed).toBe(false);
    expect(scorecard.rolloutBlockers).toContain("D result missing diagnosis for 14 cases");
  });

  it("retains bounded explanations in the scorecard report projection", () => {
    const testCase = getCodeAgentBenchmarkCases().find((entry) => entry.id === "blocked-proof-001")!;
    const result = observation(testCase.id, {
      grade: "D",
      safelyBlocked: true,
      diagnosis: "Missing executable behavioral proof.",
    });
    const scorecard = buildCodeAgentBenchmarkScorecard({
      cases: [testCase],
      results: [result],
    });
    const markdown = codeAgentBenchmarkScorecardToMarkdown(scorecard);

    expect(markdown).toContain("## D explanations");
    expect(markdown).toContain("blocked-proof-001: Missing executable behavioral proof.");
    expect(markdown).not.toContain("rawResponse");
    expect(markdown).not.toContain("sourceContent");
  });
});