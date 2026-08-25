import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { getCodeAgentBenchmarkCases } from "./code-agent-benchmark.js";
import { evaluateCodeAgentBenchmarkContract } from "./contract-oracle.js";

const roots: string[] = [];

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => fs.rm(root, { recursive: true, force: true })));
});

function telemetry(overrides: Partial<Parameters<typeof evaluateCodeAgentBenchmarkContract>[0]["telemetry"]> = {}) {
  return {
    actualTerminal: "READY_FOR_REVIEW" as const,
    validationStatus: "passed" as const,
    changedPaths: ["src/feature.ts"],
    allowedPaths: ["src/feature.ts"],
    filesRead: 1,
    toolCalls: 2,
    repairAttempts: 0,
    rejectedChanges: 0,
    conflict: false,
    typecheckPassed: null,
    testsPassed: true,
    ...overrides,
  };
}

async function createRoot() {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "code-agent-contract-oracle-"));
  roots.push(root);
  await fs.mkdir(path.join(root, "src"), { recursive: true });
  await fs.writeFile(path.join(root, "src/feature.ts"), "const before = true;\n", "utf8");
  return root;
}

describe("Code Agent contract oracle", () => {
  it("passes a scoped review-ready result with a real net diff", async () => {
    const rootPath = await createRoot();
    const result = await evaluateCodeAgentBenchmarkContract({
      rootPath,
      testCase: getCodeAgentBenchmarkCases()[0]!,
      telemetry: telemetry(),
      pendingChanges: [{ path: "src/feature.ts", newContent: "const before = false;\n" }],
    });

    expect(result).toEqual({ status: "passed" });
  });

  it("fails review-ready results without a pending diff or with scope escape", async () => {
    const rootPath = await createRoot();
    const testCase = getCodeAgentBenchmarkCases()[0]!;

    await expect(evaluateCodeAgentBenchmarkContract({
      rootPath,
      testCase,
      telemetry: telemetry(),
      pendingChanges: [],
    })).resolves.toEqual({ status: "failed", code: "READY_WITHOUT_PENDING_CHANGES" });

    await expect(evaluateCodeAgentBenchmarkContract({
      rootPath,
      testCase,
      telemetry: telemetry({ allowedPaths: ["src/feature.ts"] }),
      pendingChanges: [{ path: "src/unapproved.ts", newContent: "export {};\n" }],
    })).resolves.toEqual({ status: "failed", code: "PENDING_CHANGE_OUTSIDE_SCOPE" });
  });
});