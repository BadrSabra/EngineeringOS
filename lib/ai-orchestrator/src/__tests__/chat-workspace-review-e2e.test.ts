/**
 * Workspace-review evidence contract E2E.
 *
 * A broad workspace review may begin with inventory, but directory inventory is
 * not source evidence. This test drives the real chat() path with a provider
 * that lists the workspace and then returns unsupported quality/scan claims.
 * The dedicated WORKSPACE_REVIEW route must keep the run in NOT PROVEN rather
 * than surfacing the inventory as a completed review.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { promises as fs } from "node:fs";
import path from "node:path";
import { tmpdir } from "node:os";
import type { ProjectContext } from "../context-builder.js";
import type { AgentStep } from "../tool-execution-engine.js";

const originalApiKey = process.env.GROQ_API_KEY;

function makeContext(): ProjectContext {
  return {
    project: "test | workspace review evidence e2e",
    workflows: "No workflows defined yet",
    recentTasks: "",
    latestMetrics: "",
    graphSummary: "",
    recentEvents: "",
    metricsVerified: false,
  };
}

async function mockChatProviders(fakeStrategy: unknown): Promise<void> {
  vi.resetModules();
  vi.doUnmock("../tools/file-tools.js");
  vi.doUnmock("../tools/git-tools.js");
  vi.doMock("../provider-registry.js", async () => {
    const actual = await vi.importActual<Record<string, unknown>>("../provider-registry.js");
    return { ...actual, getStrategy: vi.fn(() => fakeStrategy) };
  });
  vi.doMock("../agents/query-planner.js", () => ({
    planQuery: vi.fn().mockResolvedValue(null),
  }));
  vi.doMock("../model-selection/decision-engine.js", () => ({
    resolveExecutionDecision: vi.fn((scope: string) => ({ taskProfile: { taskType: scope } })),
  }));
  vi.doMock("../model-selection/provider-strategy.js", () => ({
    resolveExecutionProvider: vi.fn((_, provider: string) => ({ providerId: provider })),
  }));
  vi.doMock("../model-selection/model-resolver.js", () => ({
    resolveExecutionModel: vi.fn(() => ({
      model: "initial-model",
      powerModel: "initial-model",
      fallbackChain: ["initial-model"],
    })),
  }));
  vi.doMock("../openrouter/model-resolver.js", () => ({
    resolveFallbackChain: vi.fn(() => [{ id: "initial-model" }]),
  }));
}

async function makeRoot(): Promise<string> {
  const rootPath = await fs.mkdtemp(path.join(tmpdir(), "eos-workspace-review-"));
  await fs.mkdir(path.join(rootPath, "src"), { recursive: true });
  await fs.writeFile(path.join(rootPath, "package.json"), '{"name":"fixture"}\n', "utf8");
  await fs.writeFile(
    path.join(rootPath, "src", "index.ts"),
    "export const answer = 42;\n",
    "utf8",
  );
  return rootPath;
}

describe("chat() WORKSPACE_REVIEW evidence contract", () => {
  beforeEach(() => {
    process.env.GROQ_API_KEY = "test-key";
  });

  afterEach(() => {
    vi.doUnmock("../provider-registry.js");
    vi.doUnmock("../agents/query-planner.js");
    vi.doUnmock("../model-selection/decision-engine.js");
    vi.doUnmock("../model-selection/provider-strategy.js");
    vi.doUnmock("../model-selection/model-resolver.js");
    vi.doUnmock("../openrouter/model-resolver.js");
    if (originalApiKey === undefined) delete process.env.GROQ_API_KEY;
    else process.env.GROQ_API_KEY = originalApiKey;
  });

  it("does not complete after list_directory inventory with unsupported workspace claims", async () => {
    const rootPath = await makeRoot();
    let callCount = 0;
    const fakeStrategy = {
      providerId: "openrouter",
      supportsNativeStream: false,
      ownsModelFallback: true,
      call: vi.fn(async () => {
        callCount += 1;
        if (callCount === 1) {
          return {
            content: "",
            toolCalls: [{
              id: "inventory-1",
              type: "function",
              function: {
                name: "list_directory",
                arguments: JSON.stringify({ path: "." }),
              },
            }],
            model: "initial-model",
            usage: {},
          };
        }
        return {
          content: JSON.stringify({
            response: [
              "## 1) Executive Verdict",
              "The workspace quality score is 92 and the latest scan is healthy.",
              "## 2) Evidence Map",
              "The repository contains the expected source folders.",
              "## 3) Findings",
              "No issues were found.",
              "## 4) Repair Plan",
              "No repair is needed.",
              "## 5) Validation Checklist",
              "- PASS — workspace reviewed.",
              "## 6) Final Judgment",
              "COMPLETE",
            ].join("\n"),
            sources: [],
          }),
          toolCalls: [],
          model: "initial-model",
          usage: {},
        };
      }),
      stream: vi.fn(),
    };

    await mockChatProviders(fakeStrategy);

    try {
      const steps: AgentStep[] = [];
      const { chat } = await import("../agents/chat-agent.js");
      const result = await chat({
        message: "review workspace",
        history: [],
        projectContext: makeContext(),
        rootPath,
        provider: "openrouter",
        apiKey: "test-key",
        onStep: (step) => steps.push(step),
      });

      const decision = [...steps]
        .reverse()
        .find((step): step is Extract<AgentStep, { kind: "decision_trace" }> =>
          step.kind === "decision_trace",
        );
      expect(decision?.trace.taskType).toBe("WORKSPACE_REVIEW");
      expect(steps.some((step) => step.kind === "tool_call" && step.tool === "list_directory")).toBe(true);
      expect(steps.some(
        (step) =>
          (step.kind === "tool_call" || step.kind === "tool_result") &&
          (step.tool === "read_file" || step.tool === "read_file_range"),
      )).toBe(false);

      expect(result.response).toMatch(/NOT PROVEN/i);
      expect(result.response).not.toContain("quality score is 92");
      expect(result.response).not.toContain("latest scan is healthy");
      expect(result.taskResult?.kind).toBe("WORKSPACE_REVIEW_RESULT");
      if (result.taskResult?.kind === "WORKSPACE_REVIEW_RESULT") {
        expect(result.taskResult.evidence).toEqual([]);
        expect(result.taskResult.report).toMatch(/NOT PROVEN/i);
      }

      const verification = [...steps].reverse().find((step) => step.kind === "verification");
      expect(verification?.kind).toBe("verification");
      if (verification?.kind === "verification") {
        expect(verification.trace.acceptedEvidenceCount).toBe(0);
      }
      expect(steps.some(
        (step) =>
          step.kind === "diagnostic" &&
          step.code === "FORENSIC_CONTRACT_RECOVERY_SKIPPED_NO_EVIDENCE",
      )).toBe(true);
    } finally {
      await fs.rm(rootPath, { recursive: true, force: true });
    }
  });

  it("downgrades a search-only finding because search snippets are not source reads", async () => {
    const rootPath = await makeRoot();
    let callCount = 0;
    const fakeStrategy = {
      providerId: "openrouter",
      supportsNativeStream: false,
      ownsModelFallback: true,
      call: vi.fn(async () => {
        callCount += 1;
        if (callCount === 1) {
          return {
            content: "",
            toolCalls: [{
              id: "search-1",
              type: "function",
              function: {
                name: "search_code",
                arguments: JSON.stringify({ pattern: "answer", file_glob: "src/**/*.ts" }),
              },
            }],
            model: "initial-model",
            usage: {},
          };
        }
        return {
          content: JSON.stringify({
            response: [
              "## 1) Executive Verdict",
              "PROVEN",
              "## 2) Evidence Map",
              "File: `src/index.ts`",
              "Evidence: `export const answer = 42;`",
              "## 3) Findings",
              "ID: F-01 · The workspace exposes a verified answer constant.",
              "File: `src/index.ts`",
              "Evidence: `export const answer = 42;`",
              "Severity: HIGH",
              "## 4) Repair Plan",
              "No repair phases identified.",
              "## 5) Validation Checklist",
              "Verify the answer constant behavior.",
              "## 6) Final Judgment",
              "PROVEN",
            ].join("\n"),
            sources: ["src/index.ts"],
          }),
          toolCalls: [],
          model: "initial-model",
          usage: {},
        };
      }),
      stream: vi.fn(),
    };

    await mockChatProviders(fakeStrategy);

    try {
      const steps: AgentStep[] = [];
      const { chat } = await import("../agents/chat-agent.js");
      const result = await chat({
        message: "review workspace",
        history: [],
        projectContext: makeContext(),
        rootPath,
        provider: "openrouter",
        apiKey: "test-key",
        onStep: (step) => steps.push(step),
      });

      expect(steps.some((step) => step.kind === "tool_call" && step.tool === "search_code")).toBe(true);
      expect(steps.some(
        (step) =>
          (step.kind === "tool_call" || step.kind === "tool_result") &&
          (step.tool === "read_file" || step.tool === "read_file_range"),
      )).toBe(false);
      expect(result.response).toMatch(/NOT PROVEN/i);
      expect(result.response).not.toMatch(/F-01[^\n]*PROVEN/i);
      if (result.taskResult?.kind === "WORKSPACE_REVIEW_RESULT") {
        expect(result.taskResult.evidence).toEqual([]);
      }
    } finally {
      await fs.rm(rootPath, { recursive: true, force: true });
    }
  });
});