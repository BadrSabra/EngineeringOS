import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { CodeAgentExecutionTelemetry } from "./code-agent-benchmark.js";
import {
  getCodeAgentBenchmarkCases,
  type CodeAgentBenchmarkCase,
} from "./code-agent-benchmark.js";
import {
  getCodeAgentBenchmarkFixture,
  validateCodeAgentBenchmarkFixtureBehavior,
  validateCodeAgentBenchmarkFixtureContracts,
} from "./code-agent-benchmark-fixtures.js";
import { classifyRequest } from "../prompts/profile-classifier.js";

const roots: string[] = [];

afterEach(async () => {
  await Promise.all(
    roots.splice(0).map((root) => fs.rm(root, { recursive: true, force: true })),
  );
});

function singleFileCase(): CodeAgentBenchmarkCase {
  const testCase = getCodeAgentBenchmarkCases().find((candidate) => candidate.id === "single-file-001");
  if (!testCase) throw new Error("single-file-001 fixture case is missing");
  return testCase;
}

function benchmarkCase(id: string): CodeAgentBenchmarkCase {
  const testCase = getCodeAgentBenchmarkCases().find((candidate) => candidate.id === id);
  if (!testCase) throw new Error(`${id} fixture case is missing`);
  return testCase;
}

const telemetry = {
  actualTerminal: "READY_FOR_REVIEW",
  validationStatus: "passed",
  changedPaths: ["lib/ai-orchestrator/src/benchmark-fixtures/single-file-001.ts"],
  allowedPaths: ["lib/ai-orchestrator/src/benchmark-fixtures/single-file-001.ts"],
  filesRead: 1,
  toolCalls: 2,
  repairAttempts: 0,
  rejectedChanges: 0,
  conflict: false,
  typecheckPassed: true,
  testsPassed: null,
} satisfies CodeAgentExecutionTelemetry;

describe("executable benchmark fixtures", () => {
  it("retains prompt, setup, postcondition, and executable proof for every case", () => {
    expect(validateCodeAgentBenchmarkFixtureContracts(getCodeAgentBenchmarkCases())).toEqual([]);
    for (const testCase of getCodeAgentBenchmarkCases()) {
      const fixture = getCodeAgentBenchmarkFixture(testCase);
      expect(fixture.setup, testCase.id).toBeTruthy();
      expect(fixture.postcondition, testCase.id).toBeTruthy();
      expect(fixture.prompt, testCase.id).toContain(testCase.prompt);
    }
  });

  it("executes the focused behavioral proof for every manifest scenario", async () => {
    const result = await validateCodeAgentBenchmarkFixtureBehavior(getCodeAgentBenchmarkCases());
    expect(result.failedScenarioIds, result.errors.join("; ")).toEqual([]);
    expect(result.passedScenarioIds).toHaveLength(getCodeAgentBenchmarkCases().length);
  });

  it("provides setup, scope, validation, and an oracle for every manifest case", () => {
    for (const testCase of getCodeAgentBenchmarkCases()) {
      const fixture = getCodeAgentBenchmarkFixture(testCase);
      expect(fixture.targetPaths.length, testCase.id).toBeGreaterThan(0);
      expect(fixture.allowedPaths, testCase.id).toEqual([...fixture.targetPaths]);
      expect(fixture.behavioralOracle, testCase.id).toBeTypeOf("function");

      if (testCase.expected.terminal === "READY_FOR_REVIEW") {
        expect(fixture.prepare, testCase.id).toBeTypeOf("function");
        expect(fixture.validationProfile, testCase.id).toBeDefined();
      }
    }
  });

  it("rejects missing executable proof for every review-ready fixture", async () => {
    for (const testCase of getCodeAgentBenchmarkCases()) {
      if (testCase.expected.terminal !== "READY_FOR_REVIEW") continue;
      const fixture = getCodeAgentBenchmarkFixture(testCase);
      const result = await fixture.behavioralOracle?.({
        rootPath: os.tmpdir(),
        telemetry,
        pendingChanges: [],
      });

      expect(result?.status, testCase.id).toBe("failed");
      expect(result?.code, testCase.id).toBeTruthy();
    }
  });

  it("rejects pending changes for every blocked fixture", async () => {
    for (const testCase of getCodeAgentBenchmarkCases()) {
      if (testCase.expected.terminal !== "BLOCKED") continue;
      const fixture = getCodeAgentBenchmarkFixture(testCase);
      const targetPath = fixture.targetPaths[0]!;
      const result = await fixture.behavioralOracle?.({
        rootPath: os.tmpdir(),
        telemetry: { ...telemetry, actualTerminal: "BLOCKED" },
        pendingChanges: [{ path: targetPath, newContent: "unexpected pending change\n" }],
      });

      expect(result?.status, testCase.id).toBe("failed");
      expect(result?.code, testCase.id).toBeTruthy();
    }
  });

  it("seeds the single-file defect and proves its behavioral postcondition", async () => {
    const rootPath = await fs.mkdtemp(path.join(os.tmpdir(), "code-agent-fixture-"));
    roots.push(rootPath);
    const testCase = singleFileCase();
    const fixture = getCodeAgentBenchmarkFixture(testCase);

    expect(fixture.validationProfile).toBe("workspace-typecheck");
    await fixture.prepare?.(rootPath);

    const targetPath = fixture.targetPaths[0]!;
    const seeded = await fs.readFile(path.join(rootPath, targetPath), "utf8");
    expect(seeded).toContain('FEATURE_ENABLED: boolean = "disabled"');

    await expect(fixture.behavioralOracle?.({
      rootPath,
      telemetry,
      pendingChanges: [{ path: targetPath, newContent: "export const FEATURE_ENABLED: boolean = true;\n" }],
    })).resolves.toEqual({
      status: "failed",
      code: "FEATURE_FLAG_DEFAULT_NOT_FALSE",
    });

    await expect(fixture.behavioralOracle?.({
      rootPath,
      telemetry,
      pendingChanges: [{ path: targetPath, newContent: "export const FEATURE_ENABLED: boolean = false;\n" }],
    })).resolves.toEqual({ status: "passed" });
  });

  it("seeds the typecheck defect and requires the typed return correction", async () => {
    const rootPath = await fs.mkdtemp(path.join(os.tmpdir(), "code-agent-fixture-"));
    roots.push(rootPath);
    const testCase = benchmarkCase("typecheck-failure-001");
    const fixture = getCodeAgentBenchmarkFixture(testCase);
    const targetPath = fixture.targetPaths[0]!;

    expect(fixture.validationProfile).toBe("workspace-typecheck");
    await fixture.prepare?.(rootPath);
    expect(await fs.readFile(path.join(rootPath, targetPath), "utf8")).toContain("return value;");

    await expect(fixture.behavioralOracle?.({
      rootPath,
      telemetry,
      pendingChanges: [{ path: targetPath, newContent: "export function getLength(value: string): number { return value; }\n" }],
    })).resolves.toEqual({
      status: "failed",
      code: "GET_LENGTH_RETURN_NOT_LENGTH",
    });

    await expect(fixture.behavioralOracle?.({
      rootPath,
      telemetry,
      pendingChanges: [{ path: targetPath, newContent: "export function getLength(value: string): number { return value.length; }\n" }],
    })).resolves.toEqual({ status: "passed" });
  });

  it("keeps the test-failure expectation strong while accepting the implementation repair", async () => {
    const rootPath = await fs.mkdtemp(path.join(os.tmpdir(), "code-agent-fixture-"));
    roots.push(rootPath);
    const testCase = benchmarkCase("test-failure-001");
    const fixture = getCodeAgentBenchmarkFixture(testCase);
    const implementationPath = fixture.targetPaths[0]!;
    const testPath = fixture.targetPaths[1]!;

    expect(fixture.validationProfile).toBe("ai-orchestrator-tests");
    await fixture.prepare?.(rootPath);
    expect(await fs.readFile(path.join(rootPath, testPath), "utf8")).toContain("toBe(2)");

    await expect(fixture.behavioralOracle?.({
      rootPath,
      telemetry,
      pendingChanges: [{ path: implementationPath, newContent: "export function addOne(value: number): number { return value; }\n" }],
    })).resolves.toEqual({
      status: "failed",
      code: "ADD_ONE_DOES_NOT_INCREMENT",
    });

    await expect(fixture.behavioralOracle?.({
      rootPath,
      telemetry,
      pendingChanges: [{ path: implementationPath, newContent: "export function addOne(value: number): number { return value + 1; }\n" }],
    })).resolves.toEqual({ status: "passed" });
  });

  it("covers the null guard, parser boundary, and union narrowing fixtures", async () => {
    const cases = [
      {
        id: "single-file-002",
        expected: "value?.trim() ?? \"\"",
      },
      {
        id: "single-file-003",
        expected: "Math.max(0, Number(input) - 1)",
      },
      {
        id: "typecheck-failure-002",
        expected: 'typeof value === "string" ? value.toUpperCase() : String(value)',
      },
    ];

    for (const entry of cases) {
      const rootPath = await fs.mkdtemp(path.join(os.tmpdir(), "code-agent-fixture-"));
      roots.push(rootPath);
      const fixture = getCodeAgentBenchmarkFixture(benchmarkCase(entry.id));
      const targetPath = fixture.targetPaths[0]!;
      await fixture.prepare?.(rootPath);
      const source = await fs.readFile(path.join(rootPath, targetPath), "utf8");
      expect(source.length).toBeGreaterThan(0);
      await expect(fixture.behavioralOracle?.({
        rootPath,
        telemetry,
        pendingChanges: [{ path: targetPath, newContent: `${entry.expected}\n` }],
      })).resolves.toEqual({ status: "passed" });
    }
  });

  it("does not accept a parser fix that removes the offset while clamping", async () => {
    const rootPath = await fs.mkdtemp(path.join(os.tmpdir(), "code-agent-fixture-"));
    roots.push(rootPath);
    const fixture = getCodeAgentBenchmarkFixture(benchmarkCase("single-file-003"));
    const targetPath = fixture.targetPaths[0]!;
    await fixture.prepare?.(rootPath);

    await expect(fixture.behavioralOracle?.({
      rootPath,
      telemetry,
      pendingChanges: [{
        path: targetPath,
        newContent: "function parsePage(input: string): number { return Math.max(0, Number(input)); }\n",
      }],
    })).resolves.toEqual({
      status: "failed",
      code: "PARSE_PAGE_BOUNDARY_NOT_CLAMPED",
    });

    await expect(fixture.behavioralOracle?.({
      rootPath,
      telemetry,
      pendingChanges: [{
        path: targetPath,
        newContent: "function parsePage(input: string): number { return Math.max(0, Number(input) - 1); }\n",
      }],
    })).resolves.toEqual({ status: "passed" });
  });

  it("accepts an explicit null guard as a semantic equivalent", async () => {
    const fixture = getCodeAgentBenchmarkFixture(benchmarkCase("single-file-002"));
    const targetPath = fixture.targetPaths[0]!;

    await expect(fixture.behavioralOracle?.({
      rootPath: os.tmpdir(),
      telemetry,
      pendingChanges: [{
        path: targetPath,
        newContent: [
          "function safeTrim(value: string | null): string {",
          '  if (value === null) return "";',
          "  return value.trim();",
          "}",
          "",
        ].join("\n"),
      }],
    })).resolves.toEqual({ status: "passed" });
  });

  it("accepts a renamed safeTrim parameter when the guard and trim behavior remain bounded", async () => {
    const fixture = getCodeAgentBenchmarkFixture(benchmarkCase("single-file-002"));
    const targetPath = fixture.targetPaths[0]!;

    await expect(fixture.behavioralOracle?.({
      rootPath: os.tmpdir(),
      telemetry,
      pendingChanges: [{
        path: targetPath,
        newContent: [
          "function safeTrim(input: string | null): string {",
          '  if (input === null) return "";',
          "  return input.trim();",
          "}",
          "",
        ].join("\n"),
      }],
    })).resolves.toEqual({ status: "passed" });
  });

  it("accepts a bounded ternary null guard", async () => {
    const fixture = getCodeAgentBenchmarkFixture(benchmarkCase("single-file-002"));
    const targetPath = fixture.targetPaths[0]!;

    await expect(fixture.behavioralOracle?.({
      rootPath: os.tmpdir(),
      telemetry,
      pendingChanges: [{
        path: targetPath,
        newContent: 'function safeTrim(value: string | null): string { return value ? value.trim() : ""; }\n',
      }],
    })).resolves.toEqual({ status: "passed" });
  });

  it("routes executable scenario prompts as implementation tasks, not fixture audits", () => {
    const fixture = getCodeAgentBenchmarkFixture(benchmarkCase("multi-file-004"));
    const classification = classifyRequest(fixture.prompt);

    expect(classification.implementationTaskMode).toBe(true);
    expect(classification.fixtureAuditMode).toBe(false);
    expect(classification.taskType).toBe("BEHAVIOR_QUERY");
    expect(classification.outputContract).toBe("GENERIC_RESPONSE");
  });
});