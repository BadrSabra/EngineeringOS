import { describe, expect, it } from "vitest";
import {
  buildAiReleaseCheckEnvironment,
  evaluateAiReleaseQuality,
  getAiReleaseChecks,
  type AiReleaseCheckResult,
} from "./ai-release-quality-gate.js";

function result(overrides: Partial<AiReleaseCheckResult> = {}): AiReleaseCheckResult {
  return {
    id: "fixture",
    kind: "contract",
    command: "fixture",
    blocking: true,
    enabled: true,
    coverage: ["fixture"],
    status: "passed",
    durationMs: 1,
    ...overrides,
  };
}

describe("AI release quality gate", () => {
  it("keeps preview and live-provider lanes opt-in", () => {
    const checks = getAiReleaseChecks();
    expect(checks.find((check) => check.id === "dashboard-preview-contract")?.enabled).toBe(false);
    expect(checks.some((check) => check.id === "live-provider-quality")).toBe(false);
  });

  it("adds only a non-blocking structured-review campaign when live checks are requested", () => {
    const live = getAiReleaseChecks({ enableLiveProvider: true });
    const check = live.find((candidate) => candidate.id === "live-provider-quality");
    expect(check).toMatchObject({
      enabled: true,
      blocking: false,
      command: expect.stringContaining("validate:live-provider-review"),
    });
    expect(check?.coverage).toEqual(expect.arrayContaining([
      "reasoning-only and agent-harness recovery",
      "rate-limit, empty, and malformed incomplete receipts",
    ]));
  });

  it("registers the blocking capability-probe provider matrix with safe contract coverage", () => {
    const check = getAiReleaseChecks().find(
      (candidate) => candidate.id === "ai-capability-probe-provider-matrix",
    );
    expect(check).toMatchObject({
      kind: "contract",
      blocking: true,
      enabled: true,
      command: "pnpm --filter @workspace/ai-orchestrator run test:capability-probe-release",
    });
    expect(check?.coverage).toEqual(expect.arrayContaining([
      "plain-text C1-C7 ordering",
      "server-owned C2/C5 runtime claims",
      "computed capability score",
      "fail-closed Evidence IDs",
      "provider fixture drift diagnostics",
    ]));
  });

  it("registers long-run ownership as a blocking provider-free acceptance milestone", () => {
    const check = getAiReleaseChecks().find(
      (candidate) => candidate.id === "ai-long-run-ownership",
    );
    expect(check).toMatchObject({
      kind: "operation",
      blocking: true,
      enabled: true,
      command: expect.stringContaining("beyond one heartbeat interval"),
      milestones: [
        "ownership-renewed",
        "terminal-completion",
        "heartbeat-cleanup",
      ],
    });
    expect(check?.coverage).toEqual(expect.arrayContaining([
      "bounded provider/tool phase beyond one heartbeat interval",
      "renewed durable execution ownership",
      "terminal completion",
      "heartbeat cleanup",
    ]));
  });

  it("registers a bounded stream lifecycle smoke as a blocking release check", () => {
    const check = getAiReleaseChecks().find(
      (candidate) => candidate.id === "ai-stream-release-smoke",
    );
    expect(check).toMatchObject({
      kind: "operation",
      blocking: true,
      enabled: true,
      command: "pnpm --filter @workspace/api-server run test:release-ai-stream-smoke",
      milestones: [
        "stream-success",
        "resumable-failure",
        "cancellation",
      ],
    });
    expect(check?.coverage).toEqual(expect.arrayContaining([
      "successful SSE stream",
      "resumable provider failure and reconnect",
      "cancellation with retained evidence",
    ]));
  });

  it("hands the campaign lock to focused stream checks without enabling live credentials", () => {
    const baseEnv = {
      DATABASE_URL: "provider-free-fixture",
      OPENROUTER_API_KEY: "should-not-be-used",
      RUN_CONTROLLED_RELEASE_VALIDATION: "stale",
    };
    for (const id of ["ai-long-run-ownership", "ai-stream-release-smoke"]) {
      const check = getAiReleaseChecks().find((candidate) => candidate.id === id)!;
      expect(buildAiReleaseCheckEnvironment(check, baseEnv)).toMatchObject({
        DATABASE_URL: "provider-free-fixture",
        RELEASE_AI_STREAM_LOCK_HELD: "1",
      });
      expect(buildAiReleaseCheckEnvironment(check, baseEnv)).not.toHaveProperty(
        "RUN_CONTROLLED_RELEASE_VALIDATION",
      );
    }
    const ordinaryCheck = getAiReleaseChecks().find((candidate) => candidate.id === "api-typecheck")!;
    expect(buildAiReleaseCheckEnvironment(ordinaryCheck, baseEnv)).not.toHaveProperty(
      "RELEASE_AI_STREAM_LOCK_HELD",
    );
  });

  it("retains ownership milestones in the release receipt after a passing check", () => {
    const check = getAiReleaseChecks().find(
      (candidate) => candidate.id === "ai-long-run-ownership",
    )!;
    const decision = evaluateAiReleaseQuality([{
      ...check,
      status: "passed",
      durationMs: 1,
    }]);
    expect(decision.status).toBe("passed");
    expect(decision.checks[0]?.milestones).toEqual([
      "ownership-renewed",
      "terminal-completion",
      "heartbeat-cleanup",
    ]);
  });

  it("retains a safe stream lifecycle stage when normalizing failure diagnostics", () => {
    const decision = evaluateAiReleaseQuality([result({
      id: "ai-stream-release-smoke",
      kind: "operation",
      status: "failed",
      failureCode: "AI_STREAM_RELEASE_SMOKE_FAILED_1",
      diagnostic: {
        classification: "assertion_failure",
        code: "TEST_ASSERTION_FAILED",
        testFiles: ["src/routes/ai-stream-integration.test.ts"],
        testIds: [
          "release-smoke-cancellation: retained evidence",
          "provider diagnostic: Bearer secret-value",
        ],
      },
    })]);
    expect(decision.checks[0]?.diagnostic).toEqual({
      classification: "assertion_failure",
      code: "TEST_ASSERTION_FAILED",
      testFiles: ["src/routes/ai-stream-integration.test.ts"],
      testIds: ["release-smoke-cancellation: retained evidence"],
    });
    expect(JSON.stringify(decision)).not.toMatch(/Bearer|secret-value|provider diagnostic/i);
  });

  it("blocks a failed typecheck or false-success benchmark without raw output", () => {
    const decision = evaluateAiReleaseQuality([
      result({ id: "api-typecheck", kind: "typecheck", failureCode: "API_TYPECHECK_FAILED_2", status: "failed" }),
      result({
        id: "benchmark",
        kind: "benchmark",
        failureCode: "provider output: leaked prompt and source diagnostics",
        status: "failed",
      }),
      result({ id: "informational", blocking: false, status: "failed", failureCode: "LATENCY_HIGH" }),
    ]);
    expect(decision.status).toBe("blocked");
    expect(decision.summary.blockingFailures).toBe(2);
    expect(decision.summary.informationalFailures).toBe(1);
    expect(JSON.stringify(decision)).not.toMatch(/provider output|leaked prompt|source diagnostics/i);
    expect(decision.blockers).toContain("BENCHMARK_FAILED");
  });

  it("keeps failure diagnostics bounded and classifies assertion evidence safely", () => {
    const decision = evaluateAiReleaseQuality([
      result({
        id: "ai-contract-and-json",
        status: "failed",
        failureCode: "AI_CONTRACT_AND_JSON_FAILED_1",
        diagnostic: {
          classification: "assertion_failure",
          code: "TEST_ASSERTION_FAILED",
          testFiles: ["src/routes/ai.test.ts", "/home/runner/workspace/provider-output.test.ts"],
          testIds: ["structured response contract", "Bearer provider-key-secret"],
        },
      }),
    ]);

    expect(decision.status).toBe("blocked");
    expect(decision.checks[0]?.diagnostic).toEqual({
      classification: "assertion_failure",
      code: "TEST_ASSERTION_FAILED",
      testFiles: ["src/routes/ai.test.ts"],
      testIds: ["structured response contract"],
    });
    expect(JSON.stringify(decision)).not.toMatch(/provider-key|raw-provider|Bearer|\/home\/runner/i);
  });

  it("preserves a stable harness diagnostic when no assertion is observable", () => {
    const decision = evaluateAiReleaseQuality([
      result({
        id: "ai-contract-and-json",
        status: "failed",
        diagnostic: {
          classification: "harness_failure",
          code: "HARNESS_EXECUTION_FAILED",
          testFiles: ["src/routes/ai-route-parity.test.ts"],
          testIds: [],
        },
      }),
    ]);

    expect(decision.checks[0]?.diagnostic).toMatchObject({
      classification: "harness_failure",
      code: "HARNESS_EXECUTION_FAILED",
      testIds: [],
    });
  });

  it("reports skipped preview cases while preserving a deterministic decision", () => {
    const checks = getAiReleaseChecks();
    const preview = checks.find((check) => check.id === "dashboard-preview-contract")!;
    const decision = evaluateAiReleaseQuality([
      result({ ...preview, status: "skipped" }),
    ]);
    expect(decision.status).toBe("passed");
    expect(decision.summary.skippedCases).toBe(1);
  });

  it("retains bounded runtime-oracle status and failure identifiers", () => {
    const decision = evaluateAiReleaseQuality(
      [result({
        id: "benchmark-runtime-oracle-preflight",
        kind: "benchmark",
        command: "server-registered benchmark runtime-oracle commands",
        status: "failed",
        failureCode: "BENCHMARK_RUNTIME_ORACLE_PREFLIGHT_FAILED",
      })],
      {
        runtimeOraclePreflight: {
          status: "failed",
          checks: [{
            scenarioId: "test-failure-001",
            command: "pnpm --dir lib/ai-orchestrator exec vitest run src/fixture.test.ts",
            status: "failed",
            failureCode: "RUNTIME_ORACLE_FAILED",
          }],
          failureIds: ["test-failure-001"],
        },
      },
    );

    expect(decision.status).toBe("blocked");
    expect(decision.runtimeOraclePreflight).toEqual({
      status: "failed",
      checks: [{
        scenarioId: "test-failure-001",
        command: "pnpm --dir lib/ai-orchestrator exec vitest run src/fixture.test.ts",
        status: "failed",
        failureCode: "RUNTIME_ORACLE_FAILED",
      }],
      failureIds: ["test-failure-001"],
    });
    expect(decision.blockers).toContain("BENCHMARK_RUNTIME_ORACLE_PREFLIGHT_FAILED");
    expect(JSON.stringify(decision)).not.toContain("provider output");
  });

  it("fails closed when a report claims passed despite failed checks", () => {
    const decision = evaluateAiReleaseQuality(
      [result()],
      {
        runtimeOraclePreflight: {
          status: "passed",
          checks: [{
            scenarioId: "test-failure-001",
            command: "pnpm --dir lib/ai-orchestrator exec vitest run src/fixture.test.ts",
            status: "failed",
            failureCode: "RUNTIME_ORACLE_FAILED",
          }],
          failureIds: ["test-failure-001"],
        },
      },
    );

    expect(decision.status).toBe("blocked");
    expect(decision.runtimeOraclePreflight?.status).toBe("failed");
    expect(decision.blockers).toContain("BENCHMARK_RUNTIME_ORACLE_PREFLIGHT_FAILED");
  });
});