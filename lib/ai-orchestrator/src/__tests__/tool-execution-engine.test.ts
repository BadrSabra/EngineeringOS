/**
 * Unit tests for ToolExecutionEngine — PR-005
 *
 * Exercises each engine contract independently of a full chat() call:
 *   - executeSingleTool: registry routing, source labels, unknown-tool error
 *   - executeToolLoop:   budget exhaustion, cache hits, tool dispatch, exhausted iterations
 *
 * Strategy: mock executeFileTool and executeGitTool at the module boundary so
 * executeSingleTool and executeToolLoop never touch the real filesystem.  The
 * ProviderStrategy is supplied as a plain object that satisfies the interface.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type { ProviderStrategy } from "../provider-strategy.js";
import type { PendingChange } from "../schemas/chat.schema.js";
import type { RawMessage, RawGroqResponse } from "../groq-client.js";

// ── Module mocks ──────────────────────────────────────────────────────────────
// Module-level vi.mock hoisted by Vitest so every import of the real modules
// gets the mock instead.  clearAllMocks() in beforeEach resets call counts
// and return values between tests without disturbing the mock structure itself.

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const FILE_TOOL_MOCK = vi.fn<any>();
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const GIT_TOOL_MOCK  = vi.fn<any>();

vi.mock("../tools/file-tools.js", async () => {
  const actual = await vi.importActual<typeof import("../tools/file-tools.js")>("../tools/file-tools.js");
  return {
    ...actual,
    executeFileTool: FILE_TOOL_MOCK,
  };
});

vi.mock("../tools/git-tools.js", async () => {
  const actual = await vi.importActual<typeof import("../tools/git-tools.js")>("../tools/git-tools.js");
  return {
    ...actual,
    executeGitTool: GIT_TOOL_MOCK,
  };
});

// ── Helpers ───────────────────────────────────────────────────────────────────

function makeResponse(content: string, toolCalls?: RawGroqResponse["toolCalls"]): RawGroqResponse {
  return { content, toolCalls: toolCalls ?? null, model: "test-model", usage: { promptTokens: 0, completionTokens: 0 } };
}

function makeToolCall(id: string, name: string, args: Record<string, string>) {
  return { id, type: "function" as const, function: { name, arguments: JSON.stringify(args) } };
}

function makeStrategy(responses: RawGroqResponse[]): ProviderStrategy {
  let callIndex = 0;
  return {
    providerId: "test",
    supportsNativeStream: false,
    call: vi.fn(async () => {
      const res = responses[callIndex];
      if (!res) throw new Error(`Unexpected call index ${callIndex}`);
      callIndex++;
      return res;
    }),
    stream: async function* () { yield ""; },
  };
}

function makeMessages(): RawMessage[] {
  return [{ role: "user", content: "hello" }];
}

// ── executeSingleTool ─────────────────────────────────────────────────────────

describe("executeSingleTool", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    FILE_TOOL_MOCK.mockResolvedValue("file output");
    GIT_TOOL_MOCK.mockResolvedValue("git output");
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it("dispatches read_file to executeFileTool and returns source", async () => {
    const { executeSingleTool } = await import("../tool-execution-engine.js");
    const result = await executeSingleTool({
      name: "read_file",
      args: { path: "src/foo.ts" },
      rootPath: "/project",
      pendingChanges: [],
    });

    expect(result.kind).toBe("ok");
    if (result.kind === "ok") {
      expect(result.output).toBe("file output");
      expect(result.source).toBe("src/foo.ts");
    }
    expect(FILE_TOOL_MOCK).toHaveBeenCalledWith("read_file", { path: "src/foo.ts" }, "/project", []);
    expect(GIT_TOOL_MOCK).not.toHaveBeenCalled();
  });

  it("dispatches list_directory to executeFileTool and produces directory source label", async () => {
    const { executeSingleTool } = await import("../tool-execution-engine.js");
    const result = await executeSingleTool({
      name: "list_directory",
      args: { path: "src" },
      rootPath: "/project",
      pendingChanges: [],
    });

    expect(result.kind).toBe("ok");
    if (result.kind === "ok") {
      expect(result.source).toBe("directory: src");
    }
    expect(FILE_TOOL_MOCK).toHaveBeenCalledWith("list_directory", { path: "src" }, "/project", []);
  });

  it("dispatches search_code to executeFileTool and produces search source label", async () => {
    const { executeSingleTool } = await import("../tool-execution-engine.js");
    const result = await executeSingleTool({
      name: "search_code",
      args: { pattern: "useAuth" },
      rootPath: "/project",
      pendingChanges: [],
    });

    expect(result.kind).toBe("ok");
    if (result.kind === "ok") {
      expect(result.source).toBe("search: useAuth");
    }
  });

  it("dispatches git_status to executeGitTool and produces git source label", async () => {
    const { executeSingleTool } = await import("../tool-execution-engine.js");
    const result = await executeSingleTool({
      name: "git_status",
      args: {},
      rootPath: "/project",
      pendingChanges: [],
    });

    expect(result.kind).toBe("ok");
    if (result.kind === "ok") {
      expect(result.output).toBe("git output");
      expect(result.source).toBe("git:status");
    }
    expect(GIT_TOOL_MOCK).toHaveBeenCalledWith("git_status", {}, "/project");
    expect(FILE_TOOL_MOCK).not.toHaveBeenCalled();
  });

  it("dispatches git_diff to executeGitTool with path-qualified source label", async () => {
    const { executeSingleTool } = await import("../tool-execution-engine.js");
    const result = await executeSingleTool({
      name: "git_diff",
      args: { path: "src/auth.ts" },
      rootPath: "/project",
      pendingChanges: [],
    });

    expect(result.kind).toBe("ok");
    if (result.kind === "ok") {
      expect(result.source).toBe("git:diff:src/auth.ts");
    }
  });

  it("dispatches git_log to executeGitTool with git:log source label", async () => {
    const { executeSingleTool } = await import("../tool-execution-engine.js");
    const result = await executeSingleTool({
      name: "git_log",
      args: {},
      rootPath: "/project",
      pendingChanges: [],
    });

    expect(result.kind).toBe("ok");
    if (result.kind === "ok") {
      expect(result.source).toBe("git:log");
    }
  });

  it("returns no source for write_file (produces a pending change instead)", async () => {
    const { executeSingleTool } = await import("../tool-execution-engine.js");
    const pending: PendingChange[] = [];
    FILE_TOOL_MOCK.mockImplementation(async (_name: unknown, _args: unknown, _root: unknown, changes: PendingChange[]) => {
      changes.push({
        path: "src/foo.ts",
        absolutePath: "/project/src/foo.ts",
        newContent: "x",
        originalContent: null,
        reason: "test write",
      });
      return "queued";
    });

    const result = await executeSingleTool({
      name: "write_file",
      args: { path: "src/foo.ts", content: "x" },
      rootPath: "/project",
      pendingChanges: pending,
    });

    expect(result.kind).toBe("ok");
    if (result.kind === "ok") {
      expect(result.source).toBeUndefined();
    }
    expect(pending).toHaveLength(1);
  });

  it("returns unknown_tool for an unregistered tool name", async () => {
    const { executeSingleTool } = await import("../tool-execution-engine.js");
    const result = await executeSingleTool({
      name: "delete_database",
      args: {},
      rootPath: "/project",
      pendingChanges: [],
    });

    expect(result.kind).toBe("unknown_tool");
    if (result.kind === "unknown_tool") {
      expect(result.errorMessage).toContain("delete_database");
      expect(result.errorMessage).toContain("not registered");
    }
    expect(FILE_TOOL_MOCK).not.toHaveBeenCalled();
    expect(GIT_TOOL_MOCK).not.toHaveBeenCalled();
  });
});

// ── toolCacheKey ──────────────────────────────────────────────────────────────

describe("toolCacheKey", () => {
  it("produces the same key regardless of argument key order", async () => {
    const { toolCacheKey } = await import("../tool-execution-engine.js");
    const k1 = toolCacheKey("read_file", { path: "a", encoding: "utf8" });
    const k2 = toolCacheKey("read_file", { encoding: "utf8", path: "a" });
    expect(k1).toBe(k2);
  });

  it("produces different keys for different tool names", async () => {
    const { toolCacheKey } = await import("../tool-execution-engine.js");
    const k1 = toolCacheKey("read_file", { path: "a" });
    const k2 = toolCacheKey("list_directory", { path: "a" });
    expect(k1).not.toBe(k2);
  });

  it("produces different keys for different argument values", async () => {
    const { toolCacheKey } = await import("../tool-execution-engine.js");
    const k1 = toolCacheKey("read_file", { path: "a" });
    const k2 = toolCacheKey("read_file", { path: "b" });
    expect(k1).not.toBe(k2);
  });
});

// ── executeToolLoop ───────────────────────────────────────────────────────────

describe("executeToolLoop", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    FILE_TOOL_MOCK.mockResolvedValue("file content");
    GIT_TOOL_MOCK.mockResolvedValue("git output");
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it("returns kind:response immediately when model emits no tool calls", async () => {
    const { executeToolLoop } = await import("../tool-execution-engine.js");
    const strategy = makeStrategy([makeResponse("final answer")]);
    const messages = makeMessages();

    const result = await executeToolLoop({
      messages,
      strategy,
      model: "fast",
      powerModel: "powerful",
      provider: "test",
      tools: undefined,
      rootPath: "",
      pendingChanges: [],
    });

    expect(result.kind).toBe("response");
    if (result.kind === "response") {
      expect(result.result.content).toBe("final answer");
      expect(result.toolSources).toEqual([]);
    }
    expect(strategy.call).toHaveBeenCalledTimes(1);
  });

  it("executes a tool call and loops back for the final response", async () => {
    const { executeToolLoop } = await import("../tool-execution-engine.js");
    const strategy = makeStrategy([
      // Iteration 1: model requests read_file
      makeResponse("", [makeToolCall("tc1", "read_file", { path: "src/auth.ts" })]),
      // Iteration 2: model gives final answer
      makeResponse("final answer"),
    ]);
    const messages = makeMessages();

    const result = await executeToolLoop({
      messages,
      strategy,
      model: "fast",
      powerModel: "powerful",
      provider: "test",
      tools: [{ type: "function", function: { name: "read_file", description: "", parameters: {} } }],
      rootPath: "/project",
      pendingChanges: [],
    });

    expect(result.kind).toBe("response");
    if (result.kind === "response") {
      expect(result.toolSources).toContain("src/auth.ts");
    }
    expect(FILE_TOOL_MOCK).toHaveBeenCalledWith("read_file", { path: "src/auth.ts" }, "/project", []);
    expect(strategy.call).toHaveBeenCalledTimes(2);
  });

  it("serves cached result for a duplicate tool call without re-executing", async () => {
    const { executeToolLoop } = await import("../tool-execution-engine.js");
    const strategy = makeStrategy([
      // Iteration 1: model requests read_file twice (same args)
      makeResponse("", [
        makeToolCall("tc1", "read_file", { path: "src/auth.ts" }),
        makeToolCall("tc2", "read_file", { path: "src/auth.ts" }), // duplicate
      ]),
      // Iteration 2: final answer
      makeResponse("done"),
    ]);
    const messages = makeMessages();

    const result = await executeToolLoop({
      messages,
      strategy,
      model: "fast",
      powerModel: "powerful",
      provider: "test",
      tools: [{ type: "function", function: { name: "read_file", description: "", parameters: {} } }],
      rootPath: "/project",
      pendingChanges: [],
    });

    expect(result.kind).toBe("response");
    // executeFileTool was called only once — the second call was cached.
    expect(FILE_TOOL_MOCK).toHaveBeenCalledTimes(1);
    // The source should only appear once (not duplicated).
    if (result.kind === "response") {
      const authSources = result.toolSources.filter((s) => s === "src/auth.ts");
      expect(authSources).toHaveLength(1);
    }
  });

  it("serves cached result when the cache was pre-seeded (simulates prefetch)", async () => {
    const { executeToolLoop, toolCacheKey } = await import("../tool-execution-engine.js");
    const strategy = makeStrategy([
      // Iteration 1: model requests the already-cached file
      makeResponse("", [makeToolCall("tc1", "read_file", { path: "src/auth.ts" })]),
      // Iteration 2: final answer
      makeResponse("done"),
    ]);
    const messages = makeMessages();
    const cache = new Map<string, string>();
    cache.set(toolCacheKey("read_file", { path: "src/auth.ts" }), "pre-fetched content");

    const result = await executeToolLoop({
      messages,
      strategy,
      model: "fast",
      powerModel: "powerful",
      provider: "test",
      tools: [{ type: "function", function: { name: "read_file", description: "", parameters: {} } }],
      rootPath: "/project",
      pendingChanges: [],
      cache,
    });

    expect(result.kind).toBe("response");
    // The file tool should never have been called — cache hit.
    expect(FILE_TOOL_MOCK).not.toHaveBeenCalled();
  });

  it("serves budget-exhausted message when maxToolCalls is reached", async () => {
    const { executeToolLoop } = await import("../tool-execution-engine.js");
    // Model requests 3 read_file calls on different paths (unique → no cache hit)
    const strategy = makeStrategy([
      makeResponse("", [
        makeToolCall("tc1", "read_file", { path: "a.ts" }),
        makeToolCall("tc2", "read_file", { path: "b.ts" }),
        makeToolCall("tc3", "read_file", { path: "c.ts" }),
      ]),
      makeResponse("answer from context"),
    ]);
    const messages = makeMessages();

    const result = await executeToolLoop({
      messages,
      strategy,
      model: "fast",
      powerModel: "powerful",
      provider: "test",
      tools: [{ type: "function", function: { name: "read_file", description: "", parameters: {} } }],
      rootPath: "/project",
      pendingChanges: [],
      maxToolCalls: 2, // Budget of 2: first two execute, third gets budget message
    });

    expect(result.kind).toBe("response");
    // Only 2 real tool calls should have been made.
    expect(FILE_TOOL_MOCK).toHaveBeenCalledTimes(2);
    // The third should have received a budget message (visible in the messages array).
    const toolMessages = messages.filter((m) => m.role === "tool");
    const budgetMessage = toolMessages.find(
      (m) => m.role === "tool" && m.content.startsWith("Tool call budget exhausted"),
    );
    expect(budgetMessage).toBeDefined();
  });

  it("returns kind:exhausted when maxIterations is reached with no text response", async () => {
    const { executeToolLoop } = await import("../tool-execution-engine.js");
    // Model always requests a tool call — never gives a text response.
    FILE_TOOL_MOCK.mockResolvedValue("file content");
    const alwaysToolCall = makeResponse("", [makeToolCall("tc1", "read_file", { path: "a.ts" })]);
    const strategy = makeStrategy(Array.from({ length: 3 }, () => alwaysToolCall));
    // Provide a fresh tc id each iteration so no cache hit
    let callCount = 0;
    (strategy.call as ReturnType<typeof vi.fn>).mockImplementation(async () => {
      callCount++;
      return makeResponse("", [makeToolCall(`tc${callCount}`, "read_file", { path: `file${callCount}.ts` })]);
    });

    const messages = makeMessages();

    const result = await executeToolLoop({
      messages,
      strategy,
      model: "fast",
      powerModel: "powerful",
      provider: "test",
      tools: [{ type: "function", function: { name: "read_file", description: "", parameters: {} } }],
      rootPath: "/project",
      pendingChanges: [],
      maxIterations: 3, // Only allow 3 iterations
      maxToolCalls: 100, // High enough to not be the limiting factor
    });

    expect(result.kind).toBe("exhausted");
    // toolSources should have accumulated the sources from all iterations.
    if (result.kind === "exhausted") {
      expect(result.toolSources.length).toBeGreaterThan(0);
    }
  });

  it("rejects unknown tool names with an error message without consuming budget", async () => {
    const { executeToolLoop } = await import("../tool-execution-engine.js");
    const strategy = makeStrategy([
      // Model requests an unknown tool, then a known one
      makeResponse("", [
        makeToolCall("tc1", "delete_everything", {}),
        makeToolCall("tc2", "read_file", { path: "src/app.ts" }),
      ]),
      makeResponse("done"),
    ]);
    const messages = makeMessages();

    const result = await executeToolLoop({
      messages,
      strategy,
      model: "fast",
      powerModel: "powerful",
      provider: "test",
      tools: [{ type: "function", function: { name: "read_file", description: "", parameters: {} } }],
      rootPath: "/project",
      pendingChanges: [],
      maxToolCalls: 1, // Budget of 1: unknown tool should NOT consume it
    });

    expect(result.kind).toBe("response");
    // The known tool should have been executed (budget was not consumed by unknown tool).
    expect(FILE_TOOL_MOCK).toHaveBeenCalledWith("read_file", { path: "src/app.ts" }, "/project", []);
    // The error message for the unknown tool should appear in messages.
    const toolMessages = messages.filter((m) => m.role === "tool");
    const errorMsg = toolMessages.find(
      (m) => m.role === "tool" && m.content.includes("not registered"),
    );
    expect(errorMsg).toBeDefined();
  });

  it("accumulates toolSources for multiple different file reads", async () => {
    const { executeToolLoop } = await import("../tool-execution-engine.js");
    const strategy = makeStrategy([
      makeResponse("", [
        makeToolCall("tc1", "read_file", { path: "src/a.ts" }),
        makeToolCall("tc2", "read_file", { path: "src/b.ts" }),
      ]),
      makeResponse("done"),
    ]);
    const messages = makeMessages();

    const result = await executeToolLoop({
      messages,
      strategy,
      model: "fast",
      powerModel: "powerful",
      provider: "test",
      tools: [{ type: "function", function: { name: "read_file", description: "", parameters: {} } }],
      rootPath: "/project",
      pendingChanges: [],
    });

    expect(result.kind).toBe("response");
    if (result.kind === "response") {
      expect(result.toolSources).toContain("src/a.ts");
      expect(result.toolSources).toContain("src/b.ts");
    }
  });

  it("accumulates toolSources across multiple iterations", async () => {
    const { executeToolLoop } = await import("../tool-execution-engine.js");
    const strategy = makeStrategy([
      makeResponse("", [makeToolCall("tc1", "read_file", { path: "iter1.ts" })]),
      makeResponse("", [makeToolCall("tc2", "read_file", { path: "iter2.ts" })]),
      makeResponse("final"),
    ]);
    const messages = makeMessages();

    const result = await executeToolLoop({
      messages,
      strategy,
      model: "fast",
      powerModel: "powerful",
      provider: "test",
      tools: [{ type: "function", function: { name: "read_file", description: "", parameters: {} } }],
      rootPath: "/project",
      pendingChanges: [],
    });

    expect(result.kind).toBe("response");
    if (result.kind === "response") {
      expect(result.toolSources).toContain("iter1.ts");
      expect(result.toolSources).toContain("iter2.ts");
    }
  });
});

// ── _stripOrphanedToolMessages ────────────────────────────────────────────────

describe("_stripOrphanedToolMessages", () => {
  it("passes through a well-formed assistant → tool chain unchanged", async () => {
    const { _stripOrphanedToolMessages } = await import("../tool-execution-engine.js");
    const messages: RawMessage[] = [
      { role: "system", content: "sys" },
      { role: "user", content: "q" },
      {
        role: "assistant",
        content: null,
        tool_calls: [makeToolCall("id-1", "read_file", { path: "a.ts" })],
      },
      { role: "tool", tool_call_id: "id-1", content: "file content" } as RawMessage,
    ];

    const result = _stripOrphanedToolMessages(messages);
    expect(result).toHaveLength(4);
    expect(result[3]).toMatchObject({ role: "tool", tool_call_id: "id-1" });
  });

  it("drops a tool message whose id is absent from the preceding assistant turn", async () => {
    const { _stripOrphanedToolMessages } = await import("../tool-execution-engine.js");
    const messages: RawMessage[] = [
      { role: "system", content: "sys" },
      // Tool result with no preceding assistant turn at all
      { role: "tool", tool_call_id: "ghost-id", content: "orphan" } as RawMessage,
      { role: "user", content: "q" },
    ];

    const result = _stripOrphanedToolMessages(messages);
    expect(result).toHaveLength(2);
    expect(result.every((m) => m.role !== "tool")).toBe(true);
  });

  it("drops a tool message that references an id from a NON-adjacent (earlier) assistant turn", async () => {
    const { _stripOrphanedToolMessages } = await import("../tool-execution-engine.js");
    // The tool result references id-1, but the PRECEDING assistant turn only has id-2.
    // id-1 exists earlier in history — the sequential check must still reject it.
    const messages: RawMessage[] = [
      {
        role: "assistant",
        content: null,
        tool_calls: [makeToolCall("id-1", "read_file", { path: "a.ts" })],
      },
      { role: "tool", tool_call_id: "id-1", content: "result-1" } as RawMessage,
      { role: "user", content: "follow-up" },
      {
        role: "assistant",
        content: null,
        tool_calls: [makeToolCall("id-2", "read_file", { path: "b.ts" })],
      },
      // This should be DROPPED — id-1 belongs to the first assistant turn, not this one.
      { role: "tool", tool_call_id: "id-1", content: "stale-orphan" } as RawMessage,
      { role: "tool", tool_call_id: "id-2", content: "result-2" } as RawMessage,
    ];

    const result = _stripOrphanedToolMessages(messages);
    expect(result).toHaveLength(5);
    expect(result.find((m) => (m as { tool_call_id?: string }).tool_call_id === "id-1" && m.role === "tool" && (m as { content?: string }).content === "stale-orphan")).toBeUndefined();
    expect(result.find((m) => (m as { tool_call_id?: string }).tool_call_id === "id-2")).toBeDefined();
  });

  it("resets the valid-id set after a user message (tool results after user are always orphans)", async () => {
    const { _stripOrphanedToolMessages } = await import("../tool-execution-engine.js");
    const messages: RawMessage[] = [
      {
        role: "assistant",
        content: null,
        tool_calls: [makeToolCall("id-1", "read_file", { path: "a.ts" })],
      },
      { role: "user", content: "interruption" },
      // Tool result after a user message — orphan regardless of id
      { role: "tool", tool_call_id: "id-1", content: "should be dropped" } as RawMessage,
    ];

    const result = _stripOrphanedToolMessages(messages);
    expect(result).toHaveLength(2);
    expect(result.every((m) => m.role !== "tool")).toBe(true);
  });
});
