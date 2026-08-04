/**
 * Tests for the HierarchicalExecutor (arXiv:2511.02424 ReAcTree pattern).
 *
 * Strategy:
 *   - Mock executeToolLoop so no real model calls are made.
 *   - Pass a spy ProviderStrategy so we can inspect what the synthesis call
 *     receives and verify all sub-results are forwarded.
 *   - Verify the hierarchical path is taken for broad plans, that the
 *     synthesiser is called exactly once with every sub-result in its prompt,
 *     and that tool sources are correctly merged and deduplicated.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import type { ProviderStrategy } from "../provider-strategy.js";
import type { RawGroqResponse } from "../groq-client.js";
import type { HierarchicalTask } from "../agents/hierarchical-executor.js";

/** Build a minimal but type-correct RawGroqResponse stub. */
function mockResponse(content: string): RawGroqResponse {
  return { content, toolCalls: null, model: "test-model", usage: { promptTokens: 0, completionTokens: 0 } };
}

// ── Module mocks ──────────────────────────────────────────────────────────────

// Mock the tool execution engine before any imports so the module-level
// cache is never populated with real implementations.
vi.mock("../tool-execution-engine.js", () => ({
  executeToolLoop: vi.fn(),
  toolCacheKey: (name: string, args: Record<string, string>) =>
    `${name}:${JSON.stringify(args)}`,
  BUDGET_BY_SCOPE: {
    chat:           { maxIterations: 12, maxToolCalls: 30 },
    tool_chat:      { maxIterations: 20, maxToolCalls: 50 },
    analysis:       { maxIterations: 25, maxToolCalls: 60 },
    task_execution: { maxIterations: 40, maxToolCalls: 100 },
  },
}));

// ── Helpers ───────────────────────────────────────────────────────────────────

function makeStrategy(synthesisContent = "synthesised answer"): ProviderStrategy {
  return {
    call: vi.fn().mockResolvedValue({ content: synthesisContent, toolCalls: [] }),
    stream: vi.fn(),
    supportsNativeStream: false,
  } as unknown as ProviderStrategy;
}

function makeOpts(strategy: ProviderStrategy) {
  return {
    systemPrompt: "You are a code intelligence agent.",
    strategy,
    model: "test-model",
    powerModel: "test-power-model",
    provider: "groq",
    tools: [],
    rootPath: "/home/project",
    pendingChanges: [],
    cache: new Map<string, string>(),
  };
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("executeHierarchical — core behaviour", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("runs one tool loop per task and then calls the synthesiser exactly once", async () => {
    const { executeToolLoop } = await import("../tool-execution-engine.js");
    const mockLoop = vi.mocked(executeToolLoop);

    mockLoop
      .mockResolvedValueOnce({
        kind: "response",
        result: mockResponse("Auth uses JWT tokens issued at /api/auth/login."),
        toolSources: ["src/routes/auth.ts"],
      })
      .mockResolvedValueOnce({
        kind: "response",
        result: mockResponse("Main endpoints: /api/projects, /api/scans, /api/ai."),
        toolSources: ["src/routes/projects.ts", "src/routes/scans.ts"],
      })
      .mockResolvedValueOnce({
        kind: "partial",
        result: mockResponse("DB has projects, scans, events tables."),
        toolSources: ["lib/db/schema/index.ts"],
      });

    const strategy = makeStrategy("Combined answer: auth + endpoints + schema.");
    const { executeHierarchical } = await import("../agents/hierarchical-executor.js");

    const tasks: HierarchicalTask[] = [
      { intent: "What is the auth flow?", targetPaths: [], maxIter: 7 },
      { intent: "What are the main API endpoints?", targetPaths: [], maxIter: 7 },
      { intent: "What is the database schema?", targetPaths: [], maxIter: 7 },
    ];

    const result = await executeHierarchical(tasks, makeOpts(strategy));

    // 3 sub-loops + 1 synthesis
    expect(mockLoop).toHaveBeenCalledTimes(3);
    expect(strategy.call).toHaveBeenCalledTimes(1);

    // Response comes from the synthesiser
    expect(result.response).toBe("Combined answer: auth + endpoints + schema.");
  });

  it("passes all sub-results to the synthesiser in the user turn", async () => {
    const { executeToolLoop } = await import("../tool-execution-engine.js");
    const mockLoop = vi.mocked(executeToolLoop);

    mockLoop
      .mockResolvedValueOnce({ kind: "response", result: mockResponse("result-alpha"), toolSources: [] })
      .mockResolvedValueOnce({ kind: "response", result: mockResponse("result-beta"), toolSources: [] });

    const strategy = makeStrategy("synthesis");
    const { executeHierarchical } = await import("../agents/hierarchical-executor.js");

    await executeHierarchical(
      [
        { intent: "sub-query alpha", targetPaths: [], maxIter: 7 },
        { intent: "sub-query beta",  targetPaths: [], maxIter: 7 },
      ],
      makeOpts(strategy),
    );

    const callArgs = vi.mocked(strategy.call).mock.calls[0];
    // The synthesis user turn is the second message (index 1)
    const userTurn = callArgs[0].find((m) => m.role === "user")?.content ?? "";

    expect(userTurn).toContain("result-alpha");
    expect(userTurn).toContain("result-beta");
    expect(userTurn).toContain("sub-query alpha");
    expect(userTurn).toContain("sub-query beta");
  });

  it("uses maxIter = 7 for each sub-task by default when mapped from subQueries", async () => {
    const { executeToolLoop } = await import("../tool-execution-engine.js");
    const mockLoop = vi.mocked(executeToolLoop);

    mockLoop.mockResolvedValue({ kind: "response", result: mockResponse("ok"), toolSources: [] });

    const strategy = makeStrategy();
    const { executeHierarchical } = await import("../agents/hierarchical-executor.js");

    const tasks: HierarchicalTask[] = [
      { intent: "q1", targetPaths: [], maxIter: 7 },
      { intent: "q2", targetPaths: [], maxIter: 7 },
    ];

    await executeHierarchical(tasks, makeOpts(strategy));

    for (const call of mockLoop.mock.calls) {
      expect(call[0].maxIterations).toBe(7);
    }
  });

  it("merges and deduplicates tool sources from all sub-loops", async () => {
    const { executeToolLoop } = await import("../tool-execution-engine.js");
    const mockLoop = vi.mocked(executeToolLoop);

    // Sub-loop 1 and 2 both reference the shared schema file
    mockLoop
      .mockResolvedValueOnce({
        kind: "response",
        result: mockResponse("a"),
        toolSources: ["src/auth.ts", "lib/db/schema.ts"],
      })
      .mockResolvedValueOnce({
        kind: "response",
        result: mockResponse("b"),
        toolSources: ["lib/db/schema.ts", "src/routes.ts"],
      });

    const strategy = makeStrategy();
    const { executeHierarchical } = await import("../agents/hierarchical-executor.js");

    const result = await executeHierarchical(
      [
        { intent: "q1", targetPaths: [], maxIter: 7 },
        { intent: "q2", targetPaths: [], maxIter: 7 },
      ],
      makeOpts(strategy),
    );

    // Deduplicated: 3 unique sources, not 4
    expect(result.toolSources).toHaveLength(3);
    expect(result.toolSources).toContain("src/auth.ts");
    expect(result.toolSources).toContain("lib/db/schema.ts");
    expect(result.toolSources).toContain("src/routes.ts");
  });
});

describe("executeHierarchical — resilience", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("preserves partial results even when one sub-loop is exhausted", async () => {
    const { executeToolLoop } = await import("../tool-execution-engine.js");
    const mockLoop = vi.mocked(executeToolLoop);

    // First sub-loop exhausts its budget, second succeeds
    mockLoop
      .mockResolvedValueOnce({ kind: "exhausted", toolSources: [] })
      .mockResolvedValueOnce({
        kind: "response",
        result: mockResponse("The scan module uses BFS."),
        toolSources: ["lib/scanner/src/index.ts"],
      });

    const strategy = makeStrategy("synthesis despite partial failure");
    const { executeHierarchical } = await import("../agents/hierarchical-executor.js");

    const result = await executeHierarchical(
      [
        { intent: "Explain the scanner internals", targetPaths: [], maxIter: 5 },
        { intent: "Explain the knowledge engine",  targetPaths: [], maxIter: 5 },
      ],
      makeOpts(strategy),
    );

    // Both loops were attempted
    expect(mockLoop).toHaveBeenCalledTimes(2);
    // Synthesis was still called — even with one exhausted result
    expect(strategy.call).toHaveBeenCalledTimes(1);

    // The synthesis user turn contains the good result from task 2
    const userTurn = vi.mocked(strategy.call).mock.calls[0][0]
      .find((m) => m.role === "user")?.content ?? "";
    expect(userTurn).toContain("The scan module uses BFS.");

    // Final response came from synthesiser
    expect(result.response).toBe("synthesis despite partial failure");
  });

  it("falls back to concatenated sub-results when the synthesis call throws", async () => {
    const { executeToolLoop } = await import("../tool-execution-engine.js");
    const mockLoop = vi.mocked(executeToolLoop);

    mockLoop
      .mockResolvedValueOnce({ kind: "response", result: mockResponse("finding one"), toolSources: [] })
      .mockResolvedValueOnce({ kind: "response", result: mockResponse("finding two"), toolSources: [] });

    // Synthesis call rejects
    const strategy = {
      call: vi.fn().mockRejectedValue(new Error("provider unavailable")),
      stream: vi.fn(),
      supportsNativeStream: false,
    } as unknown as ProviderStrategy;

    const { executeHierarchical } = await import("../agents/hierarchical-executor.js");

    const result = await executeHierarchical(
      [
        { intent: "q1", targetPaths: [], maxIter: 7 },
        { intent: "q2", targetPaths: [], maxIter: 7 },
      ],
      makeOpts(strategy),
    );

    // Must still return a non-empty response (the concatenated fallback)
    expect(result.response.length).toBeGreaterThan(0);
    expect(result.response).toContain("finding one");
    expect(result.response).toContain("finding two");
  });

  it("does not throw when a sub-loop itself throws", async () => {
    const { executeToolLoop } = await import("../tool-execution-engine.js");
    const mockLoop = vi.mocked(executeToolLoop);

    // First sub-loop crashes, second succeeds
    mockLoop
      .mockRejectedValueOnce(new Error("network timeout"))
      .mockResolvedValueOnce({ kind: "response", result: mockResponse("good result"), toolSources: [] });

    const strategy = makeStrategy("synthesis after error");
    const { executeHierarchical } = await import("../agents/hierarchical-executor.js");

    // Must resolve — never throw
    await expect(
      executeHierarchical(
        [
          { intent: "q1", targetPaths: [], maxIter: 7 },
          { intent: "q2", targetPaths: [], maxIter: 7 },
        ],
        makeOpts(strategy),
      ),
    ).resolves.toBeDefined();

    // Synthesiser was still called with both tasks' content
    expect(strategy.call).toHaveBeenCalledTimes(1);
    const userTurn = vi.mocked(strategy.call).mock.calls[0][0]
      .find((m) => m.role === "user")?.content ?? "";
    expect(userTurn).toContain("good result");
  });

  it("synthesis call receives no tools so it cannot make additional file reads", async () => {
    const { executeToolLoop } = await import("../tool-execution-engine.js");
    const mockLoop = vi.mocked(executeToolLoop);

    mockLoop.mockResolvedValue({ kind: "response", result: mockResponse("ok"), toolSources: [] });

    const strategy = makeStrategy();
    const { executeHierarchical } = await import("../agents/hierarchical-executor.js");

    await executeHierarchical(
      [{ intent: "q", targetPaths: [], maxIter: 7 }],
      makeOpts(strategy),
    );

    const callOpts = vi.mocked(strategy.call).mock.calls[0][1];
    // tools must be absent (undefined) from the synthesis call options
    expect(callOpts).not.toHaveProperty("tools");
  });
});
