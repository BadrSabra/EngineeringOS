/**
 * Task #26 — prove the full chat flow keeps a grounded, no-Finding behavior
 * answer from flipping to NOT PROVEN.
 *
 * Task #18 changed the reject gate so a BEHAVIOR_QUERY answer is only replaced
 * by the "NOT PROVEN —" string when it carries ZERO source evidence. This file
 * exercises the WHOLE chat() pipeline (plan-prefetch real read + mocked provider
 * registry) for two cases:
 *
 *   1. grounded: the model links a source excerpt that is READ_CONFIRMED but
 *      does NOT reach BEHAVIOR_PROVEN (no Finding). Because evidence.length > 0,
 *      the answer must be returned as BEHAVIOR_ANSWER_RESULT with the model's
 *      grounded text — NOT the NOT PROVEN replacement.
 *
 *   2. zero-evidence: the model response cites no exact source excerpt. The gate
 *      must still yield the "NOT PROVEN —" replacement string.
 *
 * If the wiring between finalResponse assembly and taskResult ever regresses, a
 * grounded answer could silently degrade to NOT PROVEN again — these tests lock
 * the current contract in end to end.
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
    project: "test | grounded behavior e2e",
    workflows: "No workflows defined yet",
    recentTasks: "",
    latestMetrics: "",
    graphSummary: "",
    recentEvents: "",
    metricsVerified: false,
  };
}

async function mockChatProviders(fakeStrategy: unknown, plan: unknown): Promise<void> {
  vi.resetModules();
  vi.doUnmock("../tools/file-tools.js");
  vi.doUnmock("../tools/git-tools.js");
  vi.doMock("../provider-registry.js", async () => {
    const actual = await vi.importActual<Record<string, unknown>>("../provider-registry.js");
    return { ...actual, getStrategy: vi.fn(() => fakeStrategy) };
  });
  // Non-null plan with targetFiles routes the source through the plan-prefetch
  // path, which records the real file body into forensicFileContents.
  vi.doMock("../agents/query-planner.js", () => ({
    planQuery: vi.fn(() => Promise.resolve(plan)),
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

const FILE = "src/loop.ts";
const FILE_CONTENT = [
  "export const MAX_ITERATIONS = 20;",
  "export function run() {",
  "  return MAX_ITERATIONS;",
  "}",
].join("\n");

async function makeRoot(): Promise<string> {
  const rootPath = await fs.mkdtemp(path.join(tmpdir(), "eos-grounded-behavior-"));
  await fs.mkdir(path.join(rootPath, "src"), { recursive: true });
  await fs.writeFile(path.join(rootPath, FILE), FILE_CONTENT, "utf8");
  return rootPath;
}

function fakeStrategyFor(modelResponse: string, calls: { count: number }): unknown {
  return {
    providerId: "openrouter",
    supportsNativeStream: false,
    call: vi.fn(async () => {
      calls.count += 1;
      return {
        content: JSON.stringify({ response: modelResponse, sources: [FILE] }),
        toolCalls: [],
        model: "initial-model",
        usage: {},
      };
    }),
    stream: vi.fn(),
  };
}

const PLAN = {
  targetFiles: [FILE],
  targetEntities: [],
  scopeEstimate: "narrow",
  suggestedIterations: 8,
  requiresToolUse: true,
  subQueries: [],
};

const MESSAGE = "Does the loop run at most 20 iterations?";

describe("chat() keeps a grounded no-Finding behavior answer (task #26)", () => {
  beforeEach(() => {
    process.env.GROQ_API_KEY = "test-key";
  });

  afterEach(() => {
    if (originalApiKey === undefined) delete process.env.GROQ_API_KEY;
    else process.env.GROQ_API_KEY = originalApiKey;
  });

  it("returns a READ_CONFIRMED grounded answer as BEHAVIOR_ANSWER_RESULT, not NOT PROVEN", async () => {
    const rootPath = await makeRoot();
    const groundedResponse =
      "Source: `src/loop.ts`\n" +
      "The loop iteration cap is `MAX_ITERATIONS = 20`, so the loop runs at most 20 iterations.";

    const calls = { count: 0 };
    await mockChatProviders(fakeStrategyFor(groundedResponse, calls), PLAN);

    try {
      const steps: AgentStep[] = [];
      const { chat } = await import("../agents/chat-agent.js");
      const result = await chat({
        message: MESSAGE,
        history: [],
        projectContext: makeContext(),
        rootPath,
        provider: "openrouter",
        apiKey: "test-or-key",
        onStep: (step) => steps.push(step),
      });

      expect(calls.count).toBeGreaterThan(0);

      // The grounded, no-Finding answer must NOT degrade to the NOT PROVEN
      // replacement — even though its excerpt is only READ_CONFIRMED.
      expect(result.response).toBe(groundedResponse);
      expect(result.response).not.toMatch(/^NOT PROVEN/);
      expect(result.taskResult?.kind).toBe("BEHAVIOR_ANSWER_RESULT");

      // The gate observed real (non-empty) source evidence for this query and
      // did not reject on "missing evidence".
      const verification = [...steps].reverse().find((s) => s.kind === "verification");
      expect(verification?.kind).toBe("verification");
      if (verification?.kind === "verification") {
        expect(verification.trace.evidenceCount).toBeGreaterThan(0);
        expect(verification.trace.rejectionReasons ?? []).not.toContain("behavior:missingEvidence");
      }

      if (result.taskResult?.kind === "BEHAVIOR_ANSWER_RESULT") {
        // The answer object still carries the grounded text verbatim.
        expect(result.taskResult.answer.answer).toBe(groundedResponse);
      }
    } finally {
      await fs.rm(rootPath, { recursive: true, force: true });
    }
  });

  it("still returns the NOT PROVEN replacement when the answer has zero source evidence", async () => {
    const rootPath = await makeRoot();
    // Model cites NO exact source excerpt and no source/label, so evidence [].
    const ungroundedResponse = "The loop runs up to its configured limit without exceeding it.";

    const calls = { count: 0 };
    await mockChatProviders(fakeStrategyFor(ungroundedResponse, calls), PLAN);

    try {
      const steps: AgentStep[] = [];
      const { chat } = await import("../agents/chat-agent.js");
      const result = await chat({
        message: MESSAGE,
        history: [],
        projectContext: makeContext(),
        rootPath,
        provider: "openrouter",
        apiKey: "test-or-key",
        onStep: (step) => steps.push(step),
      });

      expect(calls.count).toBeGreaterThan(0);

      // Zero-evidence behavior answer must be replaced by the NOT PROVEN string.
      expect(result.response).toMatch(/^NOT PROVEN —/);
      expect(result.taskResult?.kind).toBe("BEHAVIOR_ANSWER_RESULT");
      if (result.taskResult?.kind === "BEHAVIOR_ANSWER_RESULT") {
        expect(result.taskResult.answer.answer.startsWith("NOT PROVEN —")).toBe(true);
        expect(result.taskResult.answer.evidence).toEqual([]);
      }

      const verification = [...steps].reverse().find((s) => s.kind === "verification");
      expect(verification?.kind).toBe("verification");
    } finally {
      await fs.rm(rootPath, { recursive: true, force: true });
    }
  });
});
