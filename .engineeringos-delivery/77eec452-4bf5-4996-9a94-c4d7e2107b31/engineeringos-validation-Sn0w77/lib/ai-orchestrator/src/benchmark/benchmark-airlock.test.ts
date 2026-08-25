import { describe, expect, it, vi } from "vitest";
import {
  runCodeAgentBenchmarkAirlock,
  type BenchmarkAirlockProvider,
} from "./benchmark-airlock.js";
import type {
  CodeAgentBenchmarkCase,
  CodeAgentBenchmarkObservation,
  CodeAgentExecutionTelemetry,
} from "./code-agent-benchmark.js";
import type { ProviderHealthProbeResult } from "./provider-health-probe.js";

const cases: CodeAgentBenchmarkCase[] = [
  {
    id: "airlock-case-1",
    title: "airlock case one",
    category: "single-file-edit",
    projectShape: "single-file",
    prompt: "make a safe change",
    expected: {
      terminal: "READY_FOR_REVIEW",
      validation: "tests",
      maxRepairAttempts: 3,
      filesMustRemainScoped: true,
      approvalRequired: true,
    },
  },
  {
    id: "airlock-case-2",
    title: "airlock case two",
    category: "single-file-edit",
    projectShape: "single-file",
    prompt: "make another safe change",
    expected: {
      terminal: "READY_FOR_REVIEW",
      validation: "tests",
      maxRepairAttempts: 3,
      filesMustRemainScoped: true,
      approvalRequired: true,
    },
  },
];

function health(
  provider: "openrouter" | "gemini",
  status: "usable" | "unavailable",
  model = `${provider}-model`,
): ProviderHealthProbeResult {
  return {
    provider,
    model,
    status,
    providerUnavailable: status !== "usable",
    toolCalling: status === "usable",
    structuredArguments: status === "usable",
    latencyMs: 4,
    ...(status === "unavailable"
      ? { failureCode: "RATE_LIMITED" as const, failureReason: "probe unavailable" }
      : {}),
  };
}

function passedTelemetry(): CodeAgentExecutionTelemetry {
  return {
    actualTerminal: "READY_FOR_REVIEW",
    validationStatus: "passed",
    changedPaths: ["src/example.ts"],
    allowedPaths: ["src/example.ts"],
    filesRead: 1,
    toolCalls: 3,
    repairAttempts: 0,
    rejectedChanges: 0,
    conflict: false,
    typecheckPassed: null,
    testsPassed: true,
  };
}

function unavailableTelemetry(): CodeAgentExecutionTelemetry {
  return {
    actualTerminal: "BLOCKED",
    validationStatus: "unavailable",
    changedPaths: [],
    allowedPaths: [],
    filesRead: 0,
    toolCalls: 0,
    repairAttempts: 0,
    rejectedChanges: 0,
    conflict: false,
    typecheckPassed: null,
    testsPassed: null,
    providerUnavailable: true,
  };
}

function provider(
  providerId: "openrouter" | "gemini",
  providerHealth: ProviderHealthProbeResult,
  executor: (testCase: CodeAgentBenchmarkCase) => Promise<CodeAgentExecutionTelemetry>,
  model?: string,
): BenchmarkAirlockProvider {
  return {
    provider: providerId,
    model,
    health: providerHealth,
    executeCase: executor,
  };
}

describe("Benchmark Airlock", () => {
  it("skips unhealthy providers and uses a preflighted healthy provider", async () => {
    const unavailable = vi.fn(async () => unavailableTelemetry());
    const usable = vi.fn(async () => passedTelemetry());

    const run = await runCodeAgentBenchmarkAirlock({
      runId: "airlock-healthy",
      cases,
      providers: [
        provider("openrouter", health("openrouter", "unavailable"), unavailable),
        provider("gemini", health("gemini", "usable"), usable),
      ],
    });

    expect(unavailable).not.toHaveBeenCalled();
    expect(usable).toHaveBeenCalledTimes(2);
    expect(run.observations.every((entry) => entry.provider === "gemini")).toBe(true);
    expect(run.scorecard.metrics.providerUnavailableCount).toBe(0);
    expect(Date.parse(run.completedAt)).toBeGreaterThanOrEqual(Date.parse(run.startedAt));
  });

  it("falls back to another healthy provider on a runtime U without adding repair attempts", async () => {
    const first = vi.fn(async () => unavailableTelemetry());
    const second = vi.fn(async () => passedTelemetry());

    const run = await runCodeAgentBenchmarkAirlock({
      runId: "airlock-fallback",
      cases: [cases[0]!],
      providers: [
        provider("openrouter", health("openrouter", "usable"), first),
        provider("gemini", health("gemini", "usable"), second),
      ],
    });

    expect(first).toHaveBeenCalledTimes(1);
    expect(second).toHaveBeenCalledTimes(1);
    expect(run.observations[0]).toMatchObject({
      provider: "gemini",
      providerAttempts: 2,
    });
    expect(run.observations[0]?.observation.grade).toBe("A");
    expect(run.observations[0]?.observation.repairAttempts).toBe(0);
  });

  it("blocks preflight before consuming cases when every provider is unavailable", async () => {
    const run = await runCodeAgentBenchmarkAirlock({
      runId: "airlock-blocked",
      cases: [cases[0]!],
      providers: [
        provider("openrouter", health("openrouter", "unavailable"), vi.fn()),
        provider("gemini", health("gemini", "unavailable"), vi.fn()),
      ],
    });

    expect(run.observations).toHaveLength(0);
    expect(run.preflight).toMatchObject({ status: "blocked" });
    expect(run.scorecard.metrics.observedCases).toBe(0);
    expect(run.scorecard.metrics.providerUnavailableCount).toBe(0);
    expect(run.scorecard.rolloutBlockers).toContain(
      "provider preflight blocked; no usable provider lane",
    );
    expect(run.scorecard.rolloutAllowed).toBe(false);
  });

  it("retries checkpointed U observations instead of treating them as complete", async () => {
    const unavailableRun = await runCodeAgentBenchmarkAirlock({
      runId: "airlock-u-checkpoint",
      cases: [cases[0]!],
      providers: [
        provider("openrouter", health("openrouter", "unavailable"), vi.fn()),
      ],
    });
    const retry = vi.fn(async () => passedTelemetry());

    const resumed = await runCodeAgentBenchmarkAirlock({
      runId: "airlock-u-resume",
      cases: [cases[0]!],
      initialResults: unavailableRun.observations,
      providers: [
        provider("gemini", health("gemini", "usable"), retry),
      ],
    });

    expect(retry).toHaveBeenCalledTimes(1);
    expect(resumed.observations).toHaveLength(1);
    expect(resumed.observations[0]?.observation.grade).toBe("A");
    expect(resumed.scorecard.metrics.providerUnavailableCount).toBe(0);
  });

  it("can retry the same provider through a second model lane", async () => {
    const first = vi.fn(async () => unavailableTelemetry());
    const second = vi.fn(async () => passedTelemetry());

    const run = await runCodeAgentBenchmarkAirlock({
      runId: "airlock-model-lane-fallback",
      cases: [cases[0]!],
      providers: [
        provider("openrouter", health("openrouter", "usable", "model-a"), first, "model-a"),
        provider("openrouter", health("openrouter", "usable", "model-b"), second, "model-b"),
      ],
    });

    expect(first).toHaveBeenCalledTimes(1);
    expect(second).toHaveBeenCalledTimes(1);
    expect(run.observations[0]).toMatchObject({
      provider: "openrouter",
      model: "model-b",
      providerAttempts: 2,
    });
    expect(run.observations[0]?.observation.grade).toBe("A");
  });

  it("quarantines a runtime-U lane for later cases in the same window", async () => {
    const failingLane = vi.fn(async () => unavailableTelemetry());
    const healthyLane = vi.fn(async () => passedTelemetry());

    const run = await runCodeAgentBenchmarkAirlock({
      runId: "airlock-quarantine",
      cases,
      providers: [
        provider("openrouter", health("openrouter", "usable", "model-a"), failingLane, "model-a"),
        provider("openrouter", health("openrouter", "usable", "model-b"), healthyLane, "model-b"),
      ],
    });

    expect(failingLane).toHaveBeenCalledTimes(1);
    expect(healthyLane).toHaveBeenCalledTimes(2);
    expect(run.observations.map((entry) => entry.observation.grade)).toEqual(["A", "A"]);
  });

  it("stops instead of cascading U across the remaining cases when all lanes fail", async () => {
    const failingLane = vi.fn(async () => unavailableTelemetry());

    const run = await runCodeAgentBenchmarkAirlock({
      runId: "airlock-runtime-exhausted",
      cases,
      providers: [
        provider("openrouter", health("openrouter", "usable"), failingLane),
      ],
    });

    expect(failingLane).toHaveBeenCalledTimes(1);
    expect(run.observations).toHaveLength(1);
    expect(run.observations[0]?.observation.grade).toBe("U");
    expect(run.preflight).toMatchObject({
      status: "blocked",
      blockers: [
        "provider lanes exhausted after runtime unavailability; resume from the saved checkpoint",
      ],
    });
    expect(run.scorecard.rolloutBlockers).toContain(
      "provider lanes exhausted after runtime unavailability; resume from the saved checkpoint",
    );

    const resumedExecutor = vi.fn(async () => passedTelemetry());
    const resumed = await runCodeAgentBenchmarkAirlock({
      runId: "airlock-runtime-exhausted-resumed",
      cases,
      initialResults: run.observations,
      providers: [
        provider("gemini", health("gemini", "usable"), resumedExecutor),
      ],
    });

    expect(resumedExecutor).toHaveBeenCalledTimes(2);
    expect(resumed.observations).toHaveLength(2);
    expect(resumed.observations.every((entry) => entry.observation.grade === "A")).toBe(true);
  });

  it("blocks rollout for a shard even when every case in that shard passes", async () => {
    const run = await runCodeAgentBenchmarkAirlock({
      runId: "airlock-shard",
      cases: [cases[0]!],
      shard: { index: 0, count: 2 },
      providers: [
        provider("gemini", health("gemini", "usable"), vi.fn(async () => passedTelemetry())),
      ],
    });

    expect(run.shard).toEqual({
      index: 0,
      count: 2,
      caseIds: ["airlock-case-1"],
    });
    expect(run.scorecard.rolloutAllowed).toBe(false);
    expect(run.scorecard.rolloutBlockers).toContain(
      "benchmark shard is partial; combine all shards before rollout",
    );
  });

  it("marks targeted profiles as diagnostic-only even when every selected case passes", async () => {
    const run = await runCodeAgentBenchmarkAirlock({
      runId: "airlock-targeted-profile",
      targetProfile: "repair-loop",
      diagnosticOnly: true,
      cases: [cases[0]!],
      providers: [
        provider("gemini", health("gemini", "usable"), vi.fn(async () => passedTelemetry())),
      ],
    });

    expect(run.diagnosticOnly).toBe(true);
    expect(run.targeted).toBe(true);
    expect(run.partial).toBe(true);
    expect(run.baselineEligibility).toBe("not-eligible");
    expect(run.targetProfile).toBe("repair-loop");
    expect(run.scorecard.metrics.complete).toBe(true);
    expect(run.scorecard.rolloutAllowed).toBe(false);
    expect(run.scorecard.rolloutBlockers).toContain(
      "targeted or partial benchmark run is diagnostic only; run a full clean witness before baseline approval",
    );
  });

  it("completes coverage after all provider lanes become unavailable", async () => {
    const failingLane = vi.fn(async () => unavailableTelemetry());

    const run = await runCodeAgentBenchmarkAirlock({
      runId: "airlock-coverage-u",
      campaignMode: "coverage",
      cases,
      providers: [
        provider("openrouter", health("openrouter", "usable"), failingLane),
      ],
    });

    expect(failingLane).toHaveBeenCalledTimes(1);
    expect(run.observations).toHaveLength(cases.length);
    expect(run.observations.every((entry) => entry.observation.grade === "U")).toBe(true);
    expect(run.campaignStatus).toBe("coverage-complete");
    expect(run.recoveryCaseIds).toEqual(cases.map((testCase) => testCase.id));
    expect(run.scorecard.metrics.complete).toBe(true);
    expect(run.scorecard.metrics.providerUnavailableCount).toBe(cases.length);
    expect(run.scorecard.rolloutAllowed).toBe(false);
  });

  it("does not rerun passed observations during a recovery-only campaign", async () => {
    const executor = vi.fn(async () => passedTelemetry());
    const run = await runCodeAgentBenchmarkAirlock({
      runId: "airlock-recovery-only",
      campaignMode: "clean-witness",
      recoveryOnly: true,
      cases,
      initialResults: [
        {
          caseId: cases[0]!.id,
          provider: "openrouter",
          model: "model-a",
          providerAttempts: 1,
          observation: {
            ...({
              caseId: cases[0]!.id,
              grade: "U",
              correct: false,
              completedFirstAttempt: false,
              repairedWithinThreeAttempts: false,
              usefulButIncomplete: false,
              safelyBlocked: false,
              falseSuccess: false,
              scopeEscape: false,
              conflict: false,
              typecheckPassed: null,
              testsPassed: null,
              filesRead: 0,
              toolCalls: 0,
              repairAttempts: 0,
              rejectedChanges: 0,
              providerUnavailable: true,
            } as CodeAgentBenchmarkObservation),
          },
        },
        {
          caseId: cases[1]!.id,
          provider: "openrouter",
          model: "model-a",
          providerAttempts: 1,
          observation: {
            ...({
              caseId: cases[1]!.id,
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
              toolCalls: 1,
              repairAttempts: 0,
              rejectedChanges: 0,
              providerUnavailable: false,
            } as CodeAgentBenchmarkObservation),
          },
        },
      ],
      providers: [
        provider("openrouter", health("openrouter", "usable"), executor),
      ],
    });

    expect(executor).toHaveBeenCalledTimes(1);
    expect(run.observations).toHaveLength(1);
    expect(run.observations[0]?.caseId).toBe(cases[0]?.id);
    expect(run.observations[0]?.observation.grade).toBe("A");
  });

  it("retains the recovery queue when preflight blocks before any retry", async () => {
    const run = await runCodeAgentBenchmarkAirlock({
      runId: "airlock-recovery-preflight-blocked",
      campaignMode: "clean-witness",
      recoveryOnly: true,
      cases,
      initialResults: cases.map((testCase) => ({
        caseId: testCase.id,
        provider: null,
        model: null,
        providerAttempts: 0,
        observation: {
          caseId: testCase.id,
          grade: "U" as const,
          correct: false,
          completedFirstAttempt: false,
          repairedWithinThreeAttempts: false,
          usefulButIncomplete: false,
          safelyBlocked: false,
          falseSuccess: false,
          scopeEscape: false,
          conflict: false,
          typecheckPassed: null,
          testsPassed: null,
          filesRead: 0,
          toolCalls: 0,
          repairAttempts: 0,
          rejectedChanges: 0,
          providerUnavailable: true,
        },
      })),
      providers: [
        provider("openrouter", health("openrouter", "unavailable"), vi.fn()),
      ],
    });

    expect(run.observations).toHaveLength(0);
    expect(run.campaignStatus).toBe("incomplete");
    expect(run.recoveryCaseIds).toEqual(cases.map((testCase) => testCase.id));
  });
});