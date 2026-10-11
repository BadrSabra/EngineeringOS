import { promises as fs } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { APPROVED_BENCHMARK_SOURCE_REVISION } from "./benchmark-source-policy.js";
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
  it("states the exact seeded edit for the multi-file acceptance case", () => {
    const testCase = getCodeAgentBenchmarkCases().find(
      (candidate) => candidate.id === "multi-file-004",
    )!;

    expect(defaultApiBenchmarkPrompt(testCase)).toContain(
      'Implement this code change in both approved files. They are small; after reading their complete contents, use write_file to submit each complete updated file, replacing the exact declaration `export const MIGRATION_EDGE = "broken";` with `export const MIGRATION_EDGE = "fixed";`. Do not use replace_text.',
    );
  });

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
      expect(handoff?.message).toContain(`Approved files: ${fixture.allowedPaths.join(", ")}`);
      expect(handoff?.message).toContain("use one of these exact full paths as the path argument");
      expect(handoff?.turnIntent).toMatchObject({
        kind: "DELIVERY",
        operationMode: "DELIVERY",
        outputContract: "GENERIC_RESPONSE",
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
          steps: expect.arrayContaining([
            testCase.prompt,
            fixture.postcondition,
            "Read only approved files, prepare scoped pending changes, and run the registered validation profile.",
          ]),
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
      steps: expect.arrayContaining([
        testCase.prompt,
        getCodeAgentBenchmarkFixture(testCase).postcondition,
        "Read only approved files, prepare scoped pending changes, and run the registered validation profile.",
      ]),
    });
  });

  it("keeps every persisted fixture-plan step within the repair-plan schema limit", () => {
    for (const testCase of getCodeAgentBenchmarkCases()) {
      const plan = defaultApiBenchmarkHistory(testCase)[0]?.repairPlan?.[0];
      expect(plan?.steps.every((step) => step.length <= 600)).toBe(true);
    }
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
      sourceRevision: APPROVED_BENCHMARK_SOURCE_REVISION,
      candidateHash: "a".repeat(64),
    });

    expect(run.campaignStatus).toBe("incomplete");
    expect(run.observations).toEqual([]);
    expect(run.providerHealth).toEqual([]);
    expect(run.runtimeOraclePreflight).toEqual(runtimeOraclePreflight);
    expect(run.scorecard).toMatchObject({
      suiteVersion: CODE_AGENT_BENCHMARK_VERSION,
      candidateHash: "a".repeat(64),
      sourceRevision: APPROVED_BENCHMARK_SOURCE_REVISION,
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