import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  buildApiCodeAgentBenchmarkPreflightBlockedRun,
  validateApiCodeAgentBenchmarkRuntimeOracles,
} from "./ai-code-agent-benchmark.js";
import {
  CODE_AGENT_BENCHMARK_VERSION,
  getCodeAgentBenchmarkCases,
} from "@workspace/ai-orchestrator";

describe("Code Agent benchmark runtime-oracle preflight", () => {
  it("runs every maintained runtime oracle against its focused candidate", async () => {
    await validateApiCodeAgentBenchmarkRuntimeOracles({
      rootPath: path.resolve(process.cwd(), "../.."),
    });
  }, 120_000);

  it("builds an incomplete redacted run without consuming provider cases", () => {
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
    const run = buildApiCodeAgentBenchmarkPreflightBlockedRun({
      runtimeOraclePreflight,
      cases: getCodeAgentBenchmarkCases(),
      providerOrder: ["openrouter", "gemini"],
      runId: "airlock-preflight-blocked",
      generatedAt: "2026-09-01T19:00:00.000Z",
      sourceRevision: "b234a1970fcf2f9f47f742e8e7fd0bd47a9d226a",
      candidateHash: "a".repeat(64),
    });

    expect(run.campaignStatus).toBe("incomplete");
    expect(run.observations).toEqual([]);
    expect(run.providerHealth).toEqual([]);
    expect(run.runtimeOraclePreflight).toEqual(runtimeOraclePreflight);
    expect(run.scorecard).toMatchObject({
      suiteVersion: CODE_AGENT_BENCHMARK_VERSION,
      candidateHash: "a".repeat(64),
      sourceRevision: "b234a1970fcf2f9f47f742e8e7fd0bd47a9d226a",
      rolloutAllowed: false,
    });
    expect(run.scorecard.metrics).toMatchObject({
      observedCases: 0,
      totalCases: 34,
      complete: false,
    });
    expect(run.scorecard.rolloutBlockers).toContain(
      "benchmark runtime-oracle preflight failed",
    );
    expect(JSON.stringify(run)).not.toContain("provider output");
  });
});