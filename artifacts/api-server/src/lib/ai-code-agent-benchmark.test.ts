import { promises as fs } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  buildApiCodeAgentBenchmarkBuildHandoff,
  buildApiCodeAgentBenchmarkPreflightBlockedRun,
  defaultApiBenchmarkHistory,
  defaultApiBenchmarkPrompt,
  validateApiCodeAgentBenchmarkRuntimeOracles,
} from "./ai-code-agent-benchmark.js";
import { createHostDisposableTempDirectory } from "./disposable-temp.js";
import {
  createBenchmarkDisposableRootLease,
  revokeBenchmarkDisposableRootLease,
} from "./benchmark-fixture-authorization.js";
import {
  CODE_AGENT_BENCHMARK_VERSION,
  getCodeAgentBenchmarkFixture,
  getCodeAgentBenchmarkCases,
} from "@workspace/ai-orchestrator";

describe("Code Agent benchmark Build handoff", () => {
  it("routes the exact repair fixture prompt through a server-owned scoped handoff", async () => {
    const testCase = getCodeAgentBenchmarkCases().find(
      (candidate) => candidate.expected.terminal === "READY_FOR_REVIEW",
    )!;
    const fixture = getCodeAgentBenchmarkFixture(testCase);
    const prompt = defaultApiBenchmarkPrompt(testCase);
    const rootPath = await createHostDisposableTempDirectory("engineeringos-code-agent-test-");
    const lease = await createBenchmarkDisposableRootLease(rootPath);
    try {
      const handoff = await buildApiCodeAgentBenchmarkBuildHandoff({
        rootPath,
        projectId: "benchmark-project",
        testCase,
        prompt,
        allowedPaths: fixture.allowedPaths,
        validationProfile: fixture.validationProfile,
        benchmarkRootLease: lease,
      });

      expect(prompt).toBe(fixture.prompt);
      expect(handoff).toBeDefined();
      expect(handoff?.message.startsWith(`${prompt}\n\nBUILD HANDOFF`)).toBe(true);
      expect(handoff?.turnIntent).toMatchObject({
        kind: "DELIVERY",
        operationMode: "DELIVERY",
        allowsBuildHandoff: true,
      });
      expect(handoff?.executionPlan).toMatchObject({
        readiness: "READY",
        boundaries: {
          projectId: "benchmark-project",
          rootPath,
          allowedWriteFiles: [...fixture.allowedPaths],
        },
        phases: [{
          verdictScope: "FIXTURE_LOCAL",
          scopedFindingStatus: "FIXTURE_PROVEN",
        }],
      });
      expect(handoff?.approvedValidationProfiles).toEqual([fixture.validationProfile]);
      expect(handoff?.benchmarkFixtureRepairAuthorization.caseId).toBe(testCase.id);
    } finally {
      revokeBenchmarkDisposableRootLease(lease);
      await fs.rm(rootPath, { recursive: true, force: true });
    }
  });

  it("does not grant a Build handoff to blocked safety fixtures", async () => {
    const testCase = getCodeAgentBenchmarkCases().find(
      (candidate) => candidate.expected.terminal === "BLOCKED",
    )!;
    const fixture = getCodeAgentBenchmarkFixture(testCase);
    const rootPath = await createHostDisposableTempDirectory("engineeringos-code-agent-test-");
    const lease = await createBenchmarkDisposableRootLease(rootPath);

    try {
      expect(await buildApiCodeAgentBenchmarkBuildHandoff({
        rootPath,
        projectId: "benchmark-project",
        testCase,
        prompt: defaultApiBenchmarkPrompt(testCase),
        allowedPaths: fixture.allowedPaths,
        validationProfile: fixture.validationProfile,
        benchmarkRootLease: lease,
      })).toBeUndefined();
    } finally {
      revokeBenchmarkDisposableRootLease(lease);
      await fs.rm(rootPath, { recursive: true, force: true });
    }
  });

  it("keeps fixture history explicitly fixture-local", () => {
    const testCase = getCodeAgentBenchmarkCases().find(
      (candidate) => candidate.expected.terminal === "READY_FOR_REVIEW",
    )!;
    expect(defaultApiBenchmarkHistory(testCase)[0]?.repairPlan?.[0]).toMatchObject({
      verdictScope: "FIXTURE_LOCAL",
      scopedFindingStatus: "FIXTURE_PROVEN",
    });
  });
});

describe("Code Agent benchmark runtime-oracle preflight", () => {
  it("runs every maintained runtime oracle against its focused candidate", async () => {
    await validateApiCodeAgentBenchmarkRuntimeOracles({
      rootPath: path.resolve(process.cwd(), "../.."),
    });
  }, 120_000);

  it("limits a partial preflight to runtime oracles in the selected cases", async () => {
    const testCase = getCodeAgentBenchmarkCases().find(
      (candidate) => Boolean(getCodeAgentBenchmarkFixture(candidate).runtimeOracle),
    )!;
    const report = await validateApiCodeAgentBenchmarkRuntimeOracles({
      rootPath: path.resolve(process.cwd(), "../.."),
      cases: [testCase],
    });

    expect(report.checks.map((check) => check.scenarioId)).toEqual([testCase.id]);
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