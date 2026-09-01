import { describe, expect, it } from "vitest";
import {
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