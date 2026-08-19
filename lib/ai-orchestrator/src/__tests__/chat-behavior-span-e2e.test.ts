/**
 * Task #25 — rule out the duplicated-fragment gap on the answer the analyst
 * actually sees.
 *
 * Drives the FULL chat() pipeline (non-forensic BEHAVIOR_QUERY) with a real
 * source file whose exact fragment `return "partial"` appears in TWO branches.
 * The tool loop performs a genuine read_file against rootPath, so the file body
 * reaches forensicFileContents exactly like a live repo read. The provider then
 * answers the behavior query by citing the fragment in the context of the
 * SECOND (safe fallback) branch. We assert the produced BEHAVIOR_ANSWER_RESULT
 * evidence carries the correctly-located span ({7,7}), NOT a first-occurrence
 * line ({4,4}) — the gap a naive indexOf would introduce.
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
    project: "test | behavior span e2e",
    workflows: "No workflows defined yet",
    recentTasks: "",
    latestMetrics: "",
    graphSummary: "",
    recentEvents: "",
    metricsVerified: false,
  };
}

async function mockChatProviders(fakeStrategy: unknown, plan?: unknown): Promise<void> {
  vi.resetModules();
  vi.doUnmock("../tools/file-tools.js");
  vi.doUnmock("../tools/git-tools.js");
  vi.doMock("../provider-registry.js", async () => {
    const actual = await vi.importActual<Record<string, unknown>>("../provider-registry.js");
    return { ...actual, getStrategy: vi.fn(() => fakeStrategy) };
  });
  // Non-null plan with targetFiles routes the requested source through the
  // plan-prefetch path, which stores the RAW file body (source-aligned line
  // numbers) rather than the wrapped read_file tool output.
  vi.doMock("../agents/query-planner.js", () => ({
    planQuery: vi.fn(() => (plan !== undefined ? Promise.resolve(plan) : Promise.resolve(null))),
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

describe("chat() BEHAVIOR_ANSWER_RESULT — duplicated-fragment span (task #25)", () => {
  beforeEach(() => {
    process.env.GROQ_API_KEY = "test-key";
  });

  afterEach(() => {
    if (originalApiKey === undefined) delete process.env.GROQ_API_KEY;
    else process.env.GROQ_API_KEY = originalApiKey;
  });

  it("locates the evidence span at the second occurrence (safe fallback), not the first match", async () => {
    const rootPath = await fs.mkdtemp(path.join(tmpdir(), "eos-behavior-span-"));
    const file = "src/pick.ts";
    // `return "partial"` appears on line 4 (flag) and line 7 (else). A blind
    // first-occurrence search would report line 4; the model answers from the
    // safe fallback branch, so the ground-truth span must be line 7.
    const fileContent =
      "export function pick(flag: boolean): string {\n" +
      "  if (flag) {\n" +
      '    console.log("fast path");\n' +
      '    return "partial";\n' +
      "  } else {\n" +
      '    console.log("safe fallback");\n' +
      '    return "partial";\n' +
      "  }\n" +
      "}\n";
    await fs.mkdir(path.join(rootPath, "src"), { recursive: true });
    await fs.writeFile(path.join(rootPath, file), fileContent, "utf8");

    const calls: Array<{ toolCalls?: unknown }> = [];
    const fakeStrategy = {
      providerId: "openrouter",
      supportsNativeStream: false,
      // The plan-prefetch already read src/pick.ts raw into the model's first
      // turn, so the provider answers directly (no extra tool call needed).
      // It cites the safe fallback branch, mentions the source, and quotes the
      // exact duplicated fragment.
      call: vi.fn(async (_messages: unknown) => {
        calls.push({ toolCalls: [] });
        return {
          content: JSON.stringify({
            response:
              "Source: `src/pick.ts`\n" +
              "In the safe fallback branch:\n" +
              'Evidence: `return "partial"`\n' +
              "The function returns the partial result in the fallback.",
            sources: [file],
          }),
          toolCalls: [],
          model: "initial-model",
          usage: {},
        };
      }),
      stream: vi.fn(),
    };

    // The planner names src/pick.ts, so the plan-prefetch path performs a real
    // rootPath read and stores the RAW body (source-aligned line numbers) in
    // forensicFileContents — the same content the analyst sees on the real file.
    await mockChatProviders(fakeStrategy, {
      targetFiles: [file],
      targetEntities: [],
      scopeEstimate: "narrow",
      suggestedIterations: 8,
      requiresToolUse: true,
      subQueries: [],
    });

    try {
      const steps: AgentStep[] = [];
      const { chat } = await import("../agents/chat-agent.js");
      const result = await chat({
        message: "What does pick return when flag is false?",
        history: [],
        projectContext: makeContext(),
        rootPath,
        provider: "openrouter",
        apiKey: "test-or-key",
        onStep: (step) => steps.push(step),
      });

      // The provider produced an answer (task #25 premise).
      expect(calls.length).toBeGreaterThan(0);

      // Routing: typed behavior result, not a forensic report.
      expect(result.taskResult?.kind).toBe("BEHAVIOR_ANSWER_RESULT");
      expect(steps.some((step) => step.kind === "verification")).toBe(true);

      if (result.taskResult?.kind === "BEHAVIOR_ANSWER_RESULT") {
        const answerEvidence = result.taskResult.answer.evidence ?? [];
        const partialEvidence = answerEvidence.find(
          (item) => item.excerpt === 'return "partial"',
        );
        expect(partialEvidence).toBeDefined();
        // The raw file has `return "partial"` on line 4 (flag) and line 7
        // (else). Every read path (prefetch + tool-loop) normalizes its body to
        // the raw source-aligned content before evidence validation, so the
        // stored span points at the TRUE source line. computeSourceSpan must
        // pick the SECOND occurrence (else => line 7), not the first (line 4) —
        // the duplicated-fragment gap this test locks in.
        expect(partialEvidence?.sourceSpan).toEqual({ startLine: 7, endLine: 7 });
        // Guard the gap explicitly: the span must NOT be the first occurrence
        // (the flag branch, raw line 4).
        expect(partialEvidence?.sourceSpan).not.toEqual({ startLine: 4, endLine: 4 });
        expect(partialEvidence?.supportsClaim).toBe(true);
        expect(partialEvidence?.evidenceClass).toBe("BEHAVIOR_PROVEN");
      }

      // Sanity: the final answer survived the behavior evidence gate.
      expect(result.response).toContain("safe fallback");
      expect(result.response).not.toContain("NOT PROVEN");
    } finally {
      await fs.rm(rootPath, { recursive: true, force: true });
    }
  });
});
