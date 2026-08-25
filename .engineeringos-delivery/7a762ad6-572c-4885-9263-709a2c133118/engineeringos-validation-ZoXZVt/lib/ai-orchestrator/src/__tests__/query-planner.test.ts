/**
 * Tests for knowledge-graph enrichment in the query planner.
 *
 * Covers:
 *  1. Graph-sourced paths appear in the final plan's targetFiles when
 *     searchNodes/getNeighborhood return matching entities with paths.
 *  2. A timeout in the graph call still returns the original LLM plan
 *     (graceful degradation).
 *  3. Enrichment is skipped when metricsVerified = false.
 *  4. Enrichment is skipped when targetEntities is empty.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

// ── vi.hoisted: shared mock state ─────────────────────────────────────────────
const { mockSearchNodes, mockGetNeighborhood, mockFindFileEntities } = vi.hoisted(() => {
  const mockSearchNodes = vi.fn();
  const mockGetNeighborhood = vi.fn();
  const mockFindFileEntities = vi.fn();
  return { mockSearchNodes, mockGetNeighborhood, mockFindFileEntities };
});

vi.mock("@workspace/db", () => ({
  db: {},
}));

vi.mock("@workspace/knowledge-engine", () => ({
  searchNodes: mockSearchNodes,
  getNeighborhood: mockGetNeighborhood,
  findFileEntities: mockFindFileEntities,
}));

// Minimal provider strategy mock — returns a canned LLM JSON response.
function makeMockStrategy(planOverrides: Record<string, unknown> = {}) {
  const plan = {
    targetFiles: ["src/auth.ts"],
    targetEntities: ["AuthService"],
    scopeEstimate: "narrow",
    suggestedIterations: 8,
    requiresToolUse: true,
    subQueries: [],
    ...planOverrides,
  };
  return {
    call: vi.fn().mockResolvedValue({
      content: JSON.stringify(plan),
      model: "mock-model",
      usage: {},
    }),
  };
}

function makeContext(metricsVerified = true) {
  return {
    project: "test | test project",
    workflows: "No workflows defined yet",
    recentTasks: "No tasks yet",
    latestMetrics: "No metrics yet",
    graphSummary: "AuthService — src/auth.ts",
    recentEvents: "No events",
    metricsVerified,
  };
}

describe("query-planner — knowledge-graph enrichment", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("merges graph-sourced paths into targetFiles", async () => {
    // searchNodes finds the AuthService entity
    mockSearchNodes.mockResolvedValue([
      { id: "entity-1", name: "AuthService", path: "src/auth.ts", projectId: "proj-1" },
    ]);
    // getNeighborhood returns one neighbour with a different path
    mockGetNeighborhood.mockResolvedValue({
      root: { id: "entity-1", name: "AuthService", path: "src/auth.ts" },
      entities: [
        { id: "entity-2", name: "TokenService", path: "src/token.service.ts" },
        { id: "entity-3", name: "UserRepository", path: "src/user.repository.ts" },
      ],
      relationships: [],
    });

    const { planQuery } = await import("../agents/query-planner.js");
    const result = await planQuery({
      message: "What calls AuthService?",
      projectContext: makeContext(true),
      model: "mock-model",
      strategy: makeMockStrategy() as never,
      projectId: "proj-1",
    });

    // Original file should still be present
    expect(result.targetFiles).toContain("src/auth.ts");
    // Graph-discovered files should be added
    expect(result.targetFiles).toContain("src/token.service.ts");
    expect(result.targetFiles).toContain("src/user.repository.ts");
    expect(mockSearchNodes).toHaveBeenCalledWith(
      expect.anything(),
      "proj-1",
      expect.arrayContaining(["AuthService"]),
    );
  });

  it("returns the original plan when the graph call times out", async () => {
    // Simulate a hung graph query — never resolves within 2 s
    mockSearchNodes.mockImplementation(
      () =>
        new Promise<never>(() => {
          // intentionally never resolves
        }),
    );
    mockGetNeighborhood.mockResolvedValue({ root: null, entities: [], relationships: [] });

    const { planQuery } = await import("../agents/query-planner.js");

    vi.useFakeTimers();
    const planPromise = planQuery({
      message: "What calls AuthService?",
      projectContext: makeContext(true),
      model: "mock-model",
      strategy: makeMockStrategy() as never,
      projectId: "proj-1",
    });

    // Advance past the 2-second graph enrichment timeout
    await vi.advanceTimersByTimeAsync(3_000);
    const result = await planPromise;
    vi.useRealTimers();

    // Should still return a valid plan (original, not enriched)
    expect(result.targetFiles).toEqual(["src/auth.ts"]);
    expect(result.targetEntities).toEqual(["AuthService"]);
    // Graph search was attempted
    expect(mockSearchNodes).toHaveBeenCalled();
    // Neighbourhood should NOT have been called (searchNodes never resolved)
    expect(mockGetNeighborhood).not.toHaveBeenCalled();
  });

  it("skips graph enrichment when metricsVerified is false", async () => {
    const { planQuery } = await import("../agents/query-planner.js");
    const result = await planQuery({
      message: "What calls AuthService?",
      projectContext: makeContext(false), // not scanned
      model: "mock-model",
      strategy: makeMockStrategy() as never,
      projectId: "proj-1",
    });

    expect(mockSearchNodes).not.toHaveBeenCalled();
    expect(result.targetFiles).toEqual(["src/auth.ts"]);
  });

  it("skips graph enrichment when targetEntities is empty", async () => {
    const { planQuery } = await import("../agents/query-planner.js");
    const result = await planQuery({
      message: "List all files",
      projectContext: makeContext(true),
      model: "mock-model",
      strategy: makeMockStrategy({ targetEntities: [], targetFiles: [] }) as never,
      projectId: "proj-1",
    });

    expect(mockSearchNodes).not.toHaveBeenCalled();
    expect(result.targetEntities).toEqual([]);
  });

  it("caps total targetFiles at 15 even when the graph returns many paths", async () => {
    // LLM already returned 10 files
    const llmFiles = Array.from({ length: 10 }, (_, i) => `src/file-${i}.ts`);
    mockSearchNodes.mockResolvedValue([
      { id: "entity-1", name: "AuthService", path: llmFiles[0], projectId: "proj-1" },
    ]);
    // Neighbourhood returns 20 more entities with unique paths
    const neighbourEntities = Array.from({ length: 20 }, (_, i) => ({
      id: `entity-extra-${i}`,
      name: `Extra${i}`,
      path: `src/extra-${i}.ts`,
    }));
    mockGetNeighborhood.mockResolvedValue({
      root: { id: "entity-1", name: "AuthService", path: llmFiles[0] },
      entities: neighbourEntities,
      relationships: [],
    });

    const { planQuery } = await import("../agents/query-planner.js");
    const result = await planQuery({
      message: "Review auth system",
      projectContext: makeContext(true),
      model: "mock-model",
      strategy: makeMockStrategy({ targetFiles: llmFiles, targetEntities: ["AuthService"] }) as never,
      projectId: "proj-1",
    });

    expect(result.targetFiles.length).toBeLessThanOrEqual(15);
  });

  it("resolves mentioned files and plans only their direct graph neighbours", async () => {
    mockFindFileEntities.mockResolvedValue([
      {
        id: "file-chat",
        type: "file",
        name: "chat.ts",
        path: "src/chat.ts",
        projectId: "proj-1",
        provenance: {
          evidence: [{ file: "src/chat.ts", line: 12, kind: "heuristic" }],
        },
      },
      {
        id: "file-stream",
        type: "file",
        name: "use-ai-chat-stream.ts",
        path: "src/use-ai-chat-stream.ts",
        projectId: "proj-1",
      },
    ]);
    mockGetNeighborhood
      .mockResolvedValueOnce({
        root: { id: "file-chat", path: "src/chat.ts" },
        entities: [
          {
            id: "on-step",
            type: "function",
            name: "onStep",
            path: "src/chat.ts",
            provenance: {
              evidence: [{ file: "src/chat.ts", line: 932, kind: "function-definition" }],
            },
          },
          {
            id: "unrelated",
            type: "file",
            name: "queries.ts",
            path: "src/queries.ts",
          },
        ],
        relationships: [
          {
            id: "edge-on-step",
            sourceId: "file-chat",
            targetId: "on-step",
            relation: "contains",
            relationType: "uses",
            evidenceJson: [{
              file: "src/chat.ts",
              line: 932,
              column: 11,
              snippet: "function onStep(step) {",
              kind: "function-definition",
            }],
          },
        ],
      })
      .mockResolvedValueOnce({
        root: { id: "file-stream", path: "src/use-ai-chat-stream.ts" },
        entities: [],
        relationships: [],
      });

    const { buildMentionedFileGraphGuidance } = await import("../agents/query-planner.js");
    const result = await buildMentionedFileGraphGuidance({
      message: "Inspect `chat.ts` and `use-ai-chat-stream.ts`",
      projectId: "proj-1",
    });

    expect(mockFindFileEntities).toHaveBeenCalledWith(
      expect.anything(),
      "proj-1",
      ["chat.ts", "use-ai-chat-stream.ts"],
    );
    expect(mockGetNeighborhood).toHaveBeenNthCalledWith(1, expect.anything(), "file-chat", 1);
    expect(mockGetNeighborhood).toHaveBeenNthCalledWith(2, expect.anything(), "file-stream", 1);
    expect(result?.prefetchFiles).toEqual([
      "src/chat.ts",
      "src/use-ai-chat-stream.ts",
    ]);
    expect(result?.prefetchFiles).not.toContain("src/queries.ts");
    expect(result?.promptHint).toContain("onStep");
    expect(result?.promptHint).toContain("src/chat.ts:932");
    expect(result?.crossFileTraces).toHaveLength(1);
    expect(result?.crossFileTraces[0]).toMatchObject({
      status: "PROVEN",
      edges: [{
        sourceSpan: {
          file: "src/chat.ts",
          line: 932,
          column: 11,
          snippet: "function onStep(step) {",
        },
      }],
    });
  });

  it("falls back when explicit mentions cannot be resolved in the graph", async () => {
    mockFindFileEntities.mockResolvedValue([]);

    const { buildMentionedFileGraphGuidance } = await import("../agents/query-planner.js");
    const result = await buildMentionedFileGraphGuidance({
      message: "Inspect `missing-file.ts`",
      projectId: "proj-1",
    });

    expect(result).toBeNull();
    expect(mockGetNeighborhood).not.toHaveBeenCalled();
  });
});
