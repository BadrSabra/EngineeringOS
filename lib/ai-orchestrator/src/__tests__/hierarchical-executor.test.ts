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
import {
  validateCompoundSynthesis,
  type HierarchicalTask,
  type SourceEvidence,
} from "../agents/hierarchical-executor.js";

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
    chat:           { maxIterations: 30, maxToolCalls: 80 },
    tool_chat:      { maxIterations: 48, maxToolCalls: 140 },
    analysis:       { maxIterations: 72, maxToolCalls: 240 },
    task_execution: { maxIterations: 96, maxToolCalls: 300 },
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

  it("runs read-only sub-tasks in bounded parallel waves", async () => {
    const { executeToolLoop } = await import("../tool-execution-engine.js");
    const mockLoop = vi.mocked(executeToolLoop);
    let active = 0;
    let maxActive = 0;
    mockLoop.mockImplementation(async () => {
      active += 1;
      maxActive = Math.max(maxActive, active);
      await new Promise((resolve) => setTimeout(resolve, 10));
      active -= 1;
      return { kind: "response", result: mockResponse("ok"), toolSources: [] };
    });

    const strategy = makeStrategy();
    const { executeHierarchical } = await import("../agents/hierarchical-executor.js");
    await executeHierarchical(
      [
        { intent: "q1", targetPaths: [], maxIter: 7, readOnly: true },
        { intent: "q2", targetPaths: [], maxIter: 7, readOnly: true },
        { intent: "q3", targetPaths: [], maxIter: 7, readOnly: true },
      ],
      { ...makeOpts(strategy), maxParallelTasks: 2 },
    );

    expect(maxActive).toBe(2);
    expect(mockLoop).toHaveBeenCalledTimes(3);
  });

  it("keeps overlapping write scopes out of the same scheduling wave", async () => {
    const { executeToolLoop } = await import("../tool-execution-engine.js");
    const mockLoop = vi.mocked(executeToolLoop);
    let active = 0;
    let maxActive = 0;
    mockLoop.mockImplementation(async () => {
      active += 1;
      maxActive = Math.max(maxActive, active);
      await new Promise((resolve) => setTimeout(resolve, 10));
      active -= 1;
      return { kind: "response", result: mockResponse("ok"), toolSources: [] };
    });

    const strategy = makeStrategy();
    const { executeHierarchical } = await import("../agents/hierarchical-executor.js");
    await executeHierarchical(
      [
        { intent: "writes A", targetPaths: ["src/a.ts"], maxIter: 7 },
        { intent: "writes B", targetPaths: ["src/b.ts"], maxIter: 7 },
        { intent: "writes A again", targetPaths: ["src/a.ts"], maxIter: 7 },
      ],
      { ...makeOpts(strategy), maxParallelTasks: 2 },
    );

    expect(maxActive).toBe(2);
    expect(mockLoop).toHaveBeenCalledTimes(3);
  });

  it("removes write and validation tools from read-only sub-tasks", async () => {
    const { executeToolLoop } = await import("../tool-execution-engine.js");
    const mockLoop = vi.mocked(executeToolLoop);
    mockLoop.mockResolvedValue({ kind: "response", result: mockResponse("ok"), toolSources: [] });

    const strategy = makeStrategy();
    const { executeHierarchical } = await import("../agents/hierarchical-executor.js");
    const tools = [
      { type: "function", function: { name: "read_file", description: "", parameters: {} } },
      { type: "function", function: { name: "write_file", description: "", parameters: {} } },
      { type: "function", function: { name: "replace_text", description: "", parameters: {} } },
      { type: "function", function: { name: "run_validation", description: "", parameters: {} } },
    ];
    await executeHierarchical(
      [{ intent: "read only", targetPaths: [], maxIter: 7, readOnly: true }],
      { ...makeOpts(strategy), tools: tools as never },
    );

    expect(mockLoop.mock.calls[0][0].tools).toEqual([
      tools[0],
    ]);
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

  it("passes each sub-task's configured maxIter to the tool loop", async () => {
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

  it("returns cancelled receipts without starting queued tasks", async () => {
    const { executeToolLoop } = await import("../tool-execution-engine.js");
    const mockLoop = vi.mocked(executeToolLoop);
    const controller = new AbortController();
    controller.abort();
    const strategy = makeStrategy();
    const { executeHierarchical } = await import("../agents/hierarchical-executor.js");

    const result = await executeHierarchical(
      [
        { intent: "q1", targetPaths: [], maxIter: 7 },
        { intent: "q2", targetPaths: [], maxIter: 7 },
      ],
      { ...makeOpts(strategy), signal: controller.signal },
    );

    expect(mockLoop).not.toHaveBeenCalled();
    expect(strategy.call).not.toHaveBeenCalled();
    expect(result.status).toBe("cancelled");
    expect(result.synthesisStatus).toBe("skipped");
    expect(result.receipts.map((receipt) => receipt.status)).toEqual(["cancelled", "cancelled"]);
  });
});

describe("compound synthesis evidence contract", () => {
  const parts = [
    { id: "features", kind: "FEATURES" as const, question: "What exists?", requiresCitation: true },
    { id: "gaps", kind: "GAPS" as const, question: "What is missing?", requiresCitation: true },
    { id: "priorities", kind: "PRIORITIES" as const, question: "What are the top priorities?", requiredCount: 3, requiresCitation: true },
  ];
  const evidence: SourceEvidence[] = [{
    file: "src/current.ts",
    excerpt: "export const feature = true;",
    startLine: 1,
    endLine: 1,
  }];

  it("rejects a planned source that was never returned by a completed read", () => {
    const result = validateCompoundSynthesis(
      "FEATURES: fact from `src/planned.ts`.",
      parts,
      evidence,
    );
    expect(result.valid).toBe(false);
    expect(result.invalidCitations).toEqual(["src/planned.ts"]);
    expect(result.missingPartIds).toEqual(["gaps", "priorities"]);
  });

  it("requires every compound part and a citation to completed evidence", () => {
    const result = validateCompoundSynthesis(
      "FEATURES: FACT from src/current.ts. GAPS: NOT PROVEN. PRIORITIES: NOT PROVEN.",
      parts,
      evidence,
    );
    expect(result.valid).toBe(true);
    expect(result.missingPartIds).toEqual([]);
  });

  it("fails closed when no source body was actually read", () => {
    const result = validateCompoundSynthesis(
      "FEATURES: FACT. GAPS: INFERENCE. PRIORITIES: PROPOSAL.",
      parts,
      [],
    );
    expect(result.valid).toBe(false);
    expect(result.violations).toContain("compound claims have no completed source evidence");
  });
});
