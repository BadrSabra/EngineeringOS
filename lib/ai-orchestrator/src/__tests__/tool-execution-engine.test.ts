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
import type { AgentStep } from "../tool-execution-engine.js";
import { GroqClientError } from "../errors.js";
import { createExecutionLedger } from "../execution-ledger.js";
import {
  _resetBehavioralScorecardForTest,
  getBehavioralScorecard,
} from "../behavioral-scorecard.js";

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

function makeResponse(
  content: string,
  toolCalls?: RawGroqResponse["toolCalls"],
  finishReason?: RawGroqResponse["finishReason"],
): RawGroqResponse {
  return {
    content,
    toolCalls: toolCalls ?? null,
    model: "test-model",
    usage: { promptTokens: 0, completionTokens: 0 },
    ...(finishReason ? { finishReason } : {}),
  };
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

  it("forces complete=true for uncached forensic reads", async () => {
    const { executeSingleTool } = await import("../tool-execution-engine.js");
    await executeSingleTool({
      name: "read_file",
      args: { path: "src/large.ts" },
      rootPath: "/tmp",
      pendingChanges: [],
      completeReads: true,
    });

    expect(FILE_TOOL_MOCK).toHaveBeenCalledWith(
      "read_file",
      { path: "src/large.ts", complete: "true" },
      "/tmp",
      [],
    );
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

  it("does not return ok when an analysis runner is unavailable", async () => {
    const { executeSingleTool } = await import("../tool-execution-engine.js");
    const result = await executeSingleTool({
      name: "query_knowledge_graph",
      args: { operation: "search" },
      rootPath: "/project",
      pendingChanges: [],
      analysisToolRunner: async () => ({
        status: "unavailable",
        output: "safe unavailable diagnostic",
      }),
      analysisCorrelation: {
        operationId: "operation-a",
        projectId: "project-a",
        projectRevision: "revision-1",
        rootAvailable: true,
        evidenceProvenance: "persisted-graph-search",
      },
    });

    expect(result).toEqual({
      kind: "failed",
      failureKind: "unavailable",
      diagnosticCode: "TOOL_UNAVAILABLE",
      safeMessage: "Analysis tool \"query_knowledge_graph\" was unavailable; the operation did not complete.",
    });
  });

  it("does not return ok when an analysis runner fails", async () => {
    const { executeSingleTool } = await import("../tool-execution-engine.js");
    const result = await executeSingleTool({
      name: "query_knowledge_graph",
      args: { operation: "search" },
      rootPath: "/project",
      pendingChanges: [],
      analysisToolRunner: async () => ({
        status: "failed",
        output: "safe failure diagnostic",
      }),
      analysisCorrelation: {
        operationId: "operation-a",
        projectId: "project-a",
        projectRevision: "revision-1",
        rootAvailable: true,
        evidenceProvenance: "persisted-graph-search",
      },
    });

    expect(result).toEqual({
      kind: "failed",
      failureKind: "execution",
      diagnosticCode: "TOOL_EXECUTION_FAILED",
      safeMessage: "Analysis tool \"query_knowledge_graph\" failed; the operation did not complete.",
    });
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
    const result = await executeToolLoop({
      messages: makeMessages(),
      strategy,
      model: "fast",
      powerModel: "powerful",
      provider: "test",
      tools: undefined,
      rootPath: "/project",
      pendingChanges: [],
      maxIterations: 1,
    });
    expect(result.kind).toBe("response");
  });

  it("returns an authoritative incomplete result when a declared claim is open", async () => {
    const { executeToolLoop } = await import("../tool-execution-engine.js");
    const result = await executeToolLoop({
      messages: makeMessages(),
      strategy: makeStrategy([makeResponse("unsupported claim")]),
      model: "fast",
      powerModel: "powerful",
      provider: "test",
      tools: undefined,
      rootPath: "/project",
      pendingChanges: [],
      maxIterations: 1,
      objective: {
        goal: "verify the requested claim",
        requiredClaims: [{ claimId: "claim-1" }],
      },
    });

    expect(result.kind).toBe("incomplete");
    if (result.kind === "incomplete") {
      expect(result.reason).toBe("claim_unclosed");
      expect(result.objectiveState?.claims).toEqual([
        { claimId: "claim-1", status: "PENDING", evidenceRefs: [] },
      ]);
    }
  });

  it("closes a declared claim only from its server-owned evidence path", async () => {
    const { executeToolLoop } = await import("../tool-execution-engine.js");
    const result = await executeToolLoop({
      messages: makeMessages(),
      strategy: makeStrategy([
        makeResponse("", [makeToolCall("read-1", "read_file", { path: "src/proof.ts" })]),
        makeResponse("verified"),
      ]),
      model: "fast",
      powerModel: "powerful",
      provider: "test",
      tools: [{ type: "function", function: { name: "read_file", description: "", parameters: {} } }],
      rootPath: "/project",
      pendingChanges: [],
      maxIterations: 2,
      objective: {
        goal: "verify the requested claim",
        requiredClaims: [{ claimId: "claim-1", requiredEvidencePaths: ["src/proof.ts"] }],
      },
    });

    expect(result.kind).toBe("response");
    expect(result.objectiveState?.claims[0]?.status).toBe("PROVEN");
  });

  it("rejects a tool emitted outside the server-owned phase", async () => {
    const { executeToolLoop } = await import("../tool-execution-engine.js");
    const diagnostics: AgentStep[] = [];
    const strategy = makeStrategy([
      makeResponse("", [makeToolCall("phase-1", "write_file", {
        path: "src/example.ts",
        content: "unsafe",
      })]),
      makeResponse("phase stopped"),
    ]);
    const result = await executeToolLoop({
      messages: makeMessages(),
      strategy,
      model: "fast",
      powerModel: "powerful",
      provider: "test",
      tools: [{
        type: "function",
        function: { name: "write_file", description: "", parameters: {} },
      }],
      rootPath: "/project",
      pendingChanges: [],
      phase: "evidence",
      maxIterations: 2,
      onStep: (step) => diagnostics.push(step),
    });

    expect(result.kind).toBe("response");
    expect(FILE_TOOL_MOCK).not.toHaveBeenCalled();
    expect(diagnostics).toContainEqual(expect.objectContaining({
      kind: "diagnostic",
      code: "EXECUTION_PHASE_TOOL_REJECTED",
      phase: "evidence",
      tool: "write_file",
      details: ["write_file is not allowed in evidence"],
    }));
    expect(JSON.stringify(diagnostics)).not.toContain("unsafe");
  });

  it("returns a cancelled result when AbortSignal interrupts the provider turn", async () => {
    const { executeToolLoop } = await import("../tool-execution-engine.js");
    const controller = new AbortController();
    const steps: AgentStep[] = [];
    const strategy: ProviderStrategy = {
      providerId: "test",
      supportsNativeStream: false,
      call: vi.fn((_messages, options) =>
        new Promise<RawGroqResponse>((_resolve, reject) => {
          options.signal?.addEventListener("abort", () => {
            reject(new DOMException("The operation was aborted", "AbortError"));
          }, { once: true });
        }),
      ),
      stream: async function* () { yield ""; },
    };

    const pending = executeToolLoop({
      messages: makeMessages(),
      strategy,
      model: "fast",
      powerModel: "powerful",
      provider: "test",
      tools: undefined,
      rootPath: "/project",
      pendingChanges: [],
      initialFileContents: new Map([["src/already-read.ts", "const value = 1;"]]),
      maxIterations: 2,
      signal: controller.signal,
      onStep: (step) => steps.push(step),
    });
    controller.abort();
    const result = await pending;

    expect(result.kind).toBe("cancelled");
    expect(result.fileContents?.get("src/already-read.ts")).toBe("const value = 1;");
    expect(steps.some((step) => step.kind === "done" && step.stopReason === "cancelled")).toBe(true);
  });

  it("blocks an objective read outside scope and records the failure telemetry", async () => {
    const { executeToolLoop } = await import("../tool-execution-engine.js");
    const diagnostics: AgentStep[] = [];
    const strategy = makeStrategy([
      makeResponse("", [makeToolCall("scope-1", "read_file", { path: "src/unrelated.ts" })]),
      makeResponse("blocked"),
    ]);
    const result = await executeToolLoop({
      messages: makeMessages(),
      strategy,
      model: "fast",
      powerModel: "powerful",
      provider: "test",
      tools: [{ type: "function", function: { name: "read_file", description: "", parameters: {} } }],
      rootPath: "/project",
      pendingChanges: [],
      maxIterations: 2,
      objectiveScopePolicy: {
        primaryPaths: ["src/target.ts"],
        allowedExpansionPaths: ["src/caller.ts"],
        forbiddenPaths: ["src/__tests__"],
      },
      onStep: (step) => {
        if (step.kind === "diagnostic") diagnostics.push(step);
      },
    });

    expect(result.kind).toBe("response");
    expect(FILE_TOOL_MOCK).not.toHaveBeenCalled();
    expect(result.sourceRetrieval?.scopeExpansions).toEqual([{
      kind: "UNJUSTIFIED_SCOPE_EXPANSION",
      path: "src/unrelated.ts",
    }]);
    expect(diagnostics.some((step) => step.kind === "diagnostic" && step.code === "UNJUSTIFIED_SCOPE_EXPANSION"))
      .toBe(true);
  });

  it("records an allowed caller read as a justified scope expansion", async () => {
    const { executeToolLoop } = await import("../tool-execution-engine.js");
    FILE_TOOL_MOCK.mockResolvedValue("File: src/caller.ts\n```\nreturn target();\n```");
    const strategy = makeStrategy([
      makeResponse("", [makeToolCall("scope-2", "read_file", { path: "src/caller.ts" })]),
      makeResponse("done"),
    ]);
    const result = await executeToolLoop({
      messages: makeMessages(),
      strategy,
      model: "fast",
      powerModel: "powerful",
      provider: "test",
      tools: [{ type: "function", function: { name: "read_file", description: "", parameters: {} } }],
      rootPath: "/project",
      pendingChanges: [],
      maxIterations: 2,
      objectiveScopePolicy: {
        primaryPaths: ["src/target.ts"],
        allowedExpansionPaths: ["src/caller.ts"],
        forbiddenPaths: [],
      },
    });

    expect(result.kind).toBe("response");
    expect(FILE_TOOL_MOCK).toHaveBeenCalledTimes(1);
    expect(result.sourceRetrieval?.scopeExpansions).toEqual([{
      kind: "JUSTIFIED_SCOPE_EXPANSION",
      path: "src/caller.ts",
      matchedPolicyPath: "src/caller.ts",
    }]);
  });

  it("reruns the same validation profile after each repair and blocks attempt four", async () => {
    const { executeToolLoop } = await import("../tool-execution-engine.js");
    const strategy = makeStrategy([
      makeResponse("", [makeToolCall("validation-1", "run_validation", { profile: "workspace-typecheck" })]),
      makeResponse("", [makeToolCall("read-1", "read_file", { path: "src/example-1.ts" })]),
      makeResponse("", [makeToolCall("validation-2", "run_validation", { profile: "workspace-typecheck" })]),
      makeResponse("", [makeToolCall("read-2", "read_file", { path: "src/example-2.ts" })]),
      makeResponse("", [makeToolCall("validation-3", "run_validation", { profile: "workspace-typecheck" })]),
      makeResponse("", [makeToolCall("read-3", "read_file", { path: "src/example-3.ts" })]),
      makeResponse("", [makeToolCall("validation-4", "run_validation", { profile: "workspace-typecheck" })]),
      makeResponse("BLOCKED"),
    ]);
    FILE_TOOL_MOCK.mockResolvedValue("File: src/example.ts\n```\nconst value = 1;\n```");
    const validationRunner = vi.fn(async () => ({
      status: "failed" as const,
      profile: "workspace-typecheck",
      command: "pnpm run typecheck",
      exitCode: 1,
      stdout: "FAIL src/example.test.ts",
      stderr: "",
      failedTests: ["FAIL src/example.test.ts"],
      affectedFiles: ["src/example.ts"],
      detail: "typecheck failed",
    }));
    const validationSteps: Array<Extract<AgentStep, { kind: "validation" }>> = [];
    const repairStates: Array<Extract<AgentStep, { kind: "repair_state" }>> = [];

    const result = await executeToolLoop({
      messages: makeMessages(),
      strategy,
      model: "fast",
      powerModel: "powerful",
      provider: "test",
      tools: [{ type: "function", function: { name: "run_validation", description: "", parameters: {} } }],
      rootPath: "/project",
      pendingChanges: [],
      initialFileContents: new Map([["src/example.ts", "const value = 1;"]]),
      maxIterations: 12,
      maxToolCalls: 7,
      allowExecutionTools: true,
      validationRunner,
      validationTargetPaths: ["src/example.ts"],
      maxValidationAttempts: 3,
      onStep: (step) => {
        if (step.kind === "validation") validationSteps.push(step);
        if (step.kind === "repair_state") repairStates.push(step);
      },
    });

    expect(result.kind).toBe("response");
    expect(validationRunner).toHaveBeenCalledTimes(3);
    expect(validationSteps.map((step) => [step.status, step.repairState, step.attempt])).toEqual([
      ["failed", "REPAIRING", 1],
      ["failed", "REPAIRING", 2],
      ["failed", "BLOCKED", 3],
      ["blocked", "BLOCKED", 4],
    ]);
    expect(validationSteps[2]?.failedTests).toEqual(["FAIL src/example.test.ts"]);
    expect(repairStates.map((step) => step.state)).toEqual([
      "VALIDATING", "REPAIRING",
      "VALIDATING", "REPAIRING",
      "VALIDATING", "BLOCKED",
      "BLOCKED",
    ]);
  });

  it("drives a provider response from diagnosis through pending patch and validation", async () => {
    const { executeToolLoop } = await import("../tool-execution-engine.js");
    const pendingChanges: PendingChange[] = [];
    FILE_TOOL_MOCK.mockImplementation(async (
      name: string,
      args: Record<string, string>,
      _rootPath: string,
      changes: PendingChange[],
    ) => {
      if (name === "read_file") {
        return "File: src/example.ts\n```\nconst value = 1;\n```";
      }
      if (name === "write_file") {
        changes.push({
          path: args.path,
          absolutePath: `/project/${args.path}`,
          newContent: args.content,
          originalContent: "const value = 1;\n",
          reason: args.reason ?? "Provider-proposed repair",
        });
        return "Pending change created; approval is still required.";
      }
      return "unsupported file tool";
    });
    const strategy = makeStrategy([
      makeResponse("", [makeToolCall("read-1", "read_file", { path: "src/example.ts" })]),
      makeResponse("", [makeToolCall("write-1", "write_file", {
        path: "src/example.ts",
        content: "const value = 2;\n",
        reason: "Fix the failing value.",
      })]),
      makeResponse("", [makeToolCall("validation-1", "run_validation", { profile: "workspace-typecheck" })]),
      makeResponse("Validated pending repair; ready for review."),
    ]);
    const validationRunner = vi.fn(async (
      _profile: string,
      _targetPaths: string[],
      _signal?: AbortSignal,
      changes?: readonly PendingChange[],
    ) => ({
      status: changes?.[0]?.newContent === "const value = 2;\n" ? "passed" as const : "failed" as const,
      profile: "workspace-typecheck",
      command: "pnpm run typecheck",
      exitCode: changes?.[0]?.newContent === "const value = 2;\n" ? 0 : 1,
      detail: "Pending workspace validation completed.",
    }));
    const steps: AgentStep[] = [];

    const result = await executeToolLoop({
      messages: makeMessages(),
      strategy,
      model: "fast",
      powerModel: "powerful",
      provider: "test",
      tools: [
        { type: "function", function: { name: "read_file", description: "", parameters: {} } },
        { type: "function", function: { name: "write_file", description: "", parameters: {} } },
        { type: "function", function: { name: "run_validation", description: "", parameters: {} } },
      ],
      rootPath: "/project",
      pendingChanges,
      initialFileContents: new Map([["src/example.ts", "const value = 1;\n"]]),
      maxIterations: 8,
      maxToolCalls: 4,
      allowExecutionTools: true,
      validationRunner,
      validationTargetPaths: ["src/example.ts"],
      onStep: (step) => steps.push(step),
    });

    expect(result.kind).toBe("response");
    expect(pendingChanges).toHaveLength(1);
    expect(validationRunner).toHaveBeenCalledWith(
      "workspace-typecheck",
      ["src/example.ts"],
      undefined,
      pendingChanges,
    );
    expect(steps.filter((step) => step.kind === "repair_state").map((step) => step.state)).toEqual([
      "VALIDATING",
      "READY_FOR_REVIEW",
    ]);
    expect(steps.find((step) => step.kind === "validation")).toMatchObject({
      status: "passed",
      repairState: "READY_FOR_REVIEW",
    });
  });

  it("emits a compact repair-attempt diff when a later patch is validated", async () => {
    const { executeToolLoop } = await import("../tool-execution-engine.js");
    const pendingChanges: PendingChange[] = [];
    FILE_TOOL_MOCK.mockImplementation(async (
      name: string,
      args: Record<string, string>,
      _rootPath: string,
      changes: PendingChange[],
    ) => {
      if (name === "write_file") {
        changes.push({
          path: args.path,
          absolutePath: `/project/${args.path}`,
          newContent: args.content,
          originalContent: "const value = 1;\n",
          reason: args.reason ?? "Provider-proposed repair",
        });
        return "Pending change created; approval is still required.";
      }
      return "unsupported file tool";
    });
    const strategy = makeStrategy([
      makeResponse("", [makeToolCall("write-1", "write_file", {
        path: "src/example.ts",
        content: "const value = 2;\n",
        reason: "First repair attempt.",
      })]),
      makeResponse("", [makeToolCall("validation-1", "run_validation", { profile: "workspace-typecheck" })]),
      makeResponse("", [makeToolCall("write-2", "write_file", {
        path: "src/example.ts",
        content: "const value = 3;\n",
        reason: "Address the failed validation.",
      })]),
      makeResponse("", [makeToolCall("validation-2", "run_validation", { profile: "workspace-typecheck" })]),
      makeResponse("Repair remains blocked."),
    ]);
    const validationRunner = vi.fn(async (
      _profile: string,
      _targetPaths: string[],
      _signal?: AbortSignal,
      changes?: readonly PendingChange[],
    ) => ({
      status: "failed" as const,
      profile: "workspace-typecheck",
      command: "pnpm run typecheck",
      exitCode: 1,
      stdout: "FAIL src/example.test.ts",
      stderr: "",
      failedTests: ["FAIL src/example.test.ts"],
      changedFiles: changes?.map((change) => change.path) ?? [],
      detail: "typecheck failed",
    }));
    const steps: AgentStep[] = [];

    await executeToolLoop({
      messages: makeMessages(),
      strategy,
      model: "fast",
      powerModel: "powerful",
      provider: "test",
      tools: [
        { type: "function", function: { name: "write_file", description: "", parameters: {} } },
        { type: "function", function: { name: "run_validation", description: "", parameters: {} } },
      ],
      rootPath: "/project",
      pendingChanges,
      maxIterations: 8,
      maxToolCalls: 6,
      executionMode: "repair_plan",
      allowExecutionTools: true,
      validationRunner,
      validationTargetPaths: ["src/example.ts"],
      onStep: (step) => steps.push(step),
    });

    const diffStep = steps.find(
      (step): step is Extract<AgentStep, { kind: "diagnostic" }> =>
        step.kind === "diagnostic" && step.code === "REPAIR_ATTEMPT_DIFF",
    );
    expect(diffStep).toBeDefined();
    expect(diffStep?.details?.[0]).toBe("attempt 2 vs 1");
    expect(diffStep?.details?.[1]).toContain("--- attempt-N-1/src/example.ts");
    expect(diffStep?.details?.[1]).toContain("+++ attempt-N/src/example.ts");
    expect(diffStep?.details?.[1]).toContain("-const value = 2;");
    expect(diffStep?.details?.[1]).toContain("+const value = 3;");
  });

  it("links a successful execution read to the model claim that preceded it", async () => {
    const { executeToolLoop } = await import("../tool-execution-engine.js");
    FILE_TOOL_MOCK.mockResolvedValue("File: src/auth.ts\n```\nreturn verifyScope(token);\n```");
    const steps: AgentStep[] = [];

    await executeToolLoop({
      messages: makeMessages(),
      strategy: makeStrategy([
        makeResponse(
          "I am reading src/auth.ts because the repair must verify the token scope.",
          [makeToolCall("read-1", "read_file", { path: "src/auth.ts" })],
        ),
        makeResponse("The read supplied the required repair evidence."),
      ]),
      model: "fast",
      powerModel: "powerful",
      provider: "test",
      tools: [{ type: "function", function: { name: "read_file", description: "", parameters: {} } }],
      rootPath: "/project",
      pendingChanges: [],
      maxIterations: 3,
      maxToolCalls: 2,
      executionMode: "repair_plan",
      onStep: (step) => steps.push(step),
    });

    const linkStep = steps.find(
      (step): step is Extract<AgentStep, { kind: "diagnostic" }> =>
        step.kind === "diagnostic" && step.code === "READ_EVIDENCE_LINKED",
    );
    expect(linkStep).toBeDefined();
    expect(linkStep?.details).toEqual([
      "src/auth.ts",
      "claim: I am reading src/auth.ts because the repair must verify the token scope.",
    ]);
  });

  it("does not link read evidence during forensic runs", async () => {
    const { executeToolLoop } = await import("../tool-execution-engine.js");
    FILE_TOOL_MOCK.mockResolvedValue("File: src/auth.ts\n```\nreturn verifyScope(token);\n```");
    const steps: AgentStep[] = [];

    await executeToolLoop({
      messages: makeMessages(),
      strategy: makeStrategy([
        makeResponse(
          "This source read is part of the audit evidence.",
          [makeToolCall("read-1", "read_file", { path: "src/auth.ts" })],
        ),
        makeResponse("Audit evidence collected."),
      ]),
      model: "fast",
      powerModel: "powerful",
      provider: "test",
      tools: [{ type: "function", function: { name: "read_file", description: "", parameters: {} } }],
      rootPath: "/project",
      pendingChanges: [],
      maxIterations: 3,
      maxToolCalls: 2,
      executionMode: "forensic",
      onStep: (step) => steps.push(step),
    });

    expect(steps.some((step) => step.kind === "diagnostic" && step.code === "READ_EVIDENCE_LINKED")).toBe(false);
  });

  it("retries a length-truncated final response before returning partial text", async () => {
    const { executeToolLoop } = await import("../tool-execution-engine.js");
    const strategy = makeStrategy([
      makeResponse("The answer was cut off…", undefined, "length"),
      makeResponse("The complete answer."),
    ]);

    const result = await executeToolLoop({
      messages: makeMessages(),
      strategy,
      model: "fast",
      powerModel: "powerful",
      provider: "openrouter",
      tools: undefined,
      rootPath: "/project",
      pendingChanges: [],
      maxIterations: 1,
    });

    expect(result.kind).toBe("response");
    if (result.kind === "response") {
      expect(result.result.content).toBe("The complete answer.");
    }
    expect(strategy.call).toHaveBeenCalledTimes(2);
    expect(strategy.call).toHaveBeenLastCalledWith(
      expect.any(Array),
      expect.objectContaining({ maxTokens: 8_192 }),
    );
  });

  it("identifies a truncated read and prevents the redundant full re-read (SR-001/SR-002/SR-007)", async () => {
    const { executeToolLoop } = await import("../tool-execution-engine.js");
    const TRUNCATED =
      "File: src/big.ts\n```\nconst a = 1;\n[... output truncated at 128 KB by the read tool; this is a display limit, not evidence that the file is incomplete or corrupted...]\n```";
    FILE_TOOL_MOCK.mockResolvedValue(TRUNCATED);
    FILE_TOOL_MOCK.mockClear();

    // Model tries the SAME full read twice. The engine must block the second
    // one (redundant) instead of re-serving another truncated/complete body.
    const strategy = makeStrategy([
      makeResponse("", [makeToolCall("tc1", "read_file", { path: "src/big.ts" })]),
      makeResponse("", [makeToolCall("tc2", "read_file", { path: "src/big.ts" })]),
      makeResponse("final"),
    ]);
    const result = await executeToolLoop({
      messages: makeMessages(),
      strategy,
      model: "fast",
      powerModel: "powerful",
      provider: "test",
      tools: [{ type: "function", function: { name: "read_file", description: "", parameters: {} } }],
      rootPath: "/project",
      pendingChanges: [],
      maxIterations: 4,
      maxToolCalls: 10,
    });

    expect(result.kind).toBe("response");
    if (result.kind === "response") {
      const tel = result.sourceRetrieval;
      // Truncated body must NOT become COMPLETE source evidence.
      expect(result.fileContents?.get("src/big.ts")).toBeUndefined();
      expect(tel).toBeDefined();
      // Exactly one serviced read attempt (the first) which was truncated;
      // the repeated full read is blocked up front, not re-served.
      expect(tel?.readAttempts).toBe(1);
      expect(tel?.truncatedReads).toBe(1);
      expect(tel?.redundantReads).toBe(1);
      // No complete evidence window from a truncated body.
      expect(tel?.evidenceWindows ?? 0).toBe(0);
    }
  });

  it("classifies a targeted window read as READ_TARGETED evidence (SR-003/SR-008)", async () => {
    const { classifyReadStatus } = await import("../tool-execution-engine.js");
    expect(classifyReadStatus("read_file_range", "File: src/a.ts\n```\nline\n```\n")).toBe("READ_TARGETED");
    // A non-read tool is always treated as a complete-read (not a source read).
    expect(classifyReadStatus("search_code", "foo.ts:1:const x = 1;")).toBe("READ_COMPLETE");
  });

  it("retains a successful read_file_range body in the canonical file evidence map", async () => {
    const { executeToolLoop } = await import("../tool-execution-engine.js");
    FILE_TOOL_MOCK.mockResolvedValue("File: src/a.ts\n```\nexport const value = 1;\n```\n");
    const strategy = makeStrategy([
      makeResponse("", [
        makeToolCall("range-1", "read_file_range", {
          path: "src/a.ts",
          startLine: "1",
          endLine: "5",
        }),
      ]),
      makeResponse("final"),
    ]);

    const result = await executeToolLoop({
      messages: makeMessages(),
      strategy,
      model: "fast",
      powerModel: "powerful",
      provider: "test",
      tools: [{
        type: "function",
        function: { name: "read_file_range", description: "", parameters: {} },
      }],
      rootPath: "/project",
      pendingChanges: [],
      maxIterations: 3,
      maxToolCalls: 3,
    });

    expect(result.kind).toBe("response");
    if (result.kind === "response") {
      expect(result.fileContents?.get("src/a.ts")).toContain("export const value = 1");
      expect(result.sourceRetrieval?.targetedReads).toBe(1);
      expect(result.sourceRetrieval?.uniqueReads).toBe(1);
    }
  });

  it("classifies truncation markers as READ_TRUNCATED, never READ_COMPLETE (SR-001 gate)", async () => {
    const { classifyReadStatus } = await import("../tool-execution-engine.js");
    const truncated =
      "File: src/big.ts\n```\nconst a = 1;\n[... output truncated at 128 KB by the read tool ...]\n```";
    expect(classifyReadStatus("read_file", truncated)).toBe("READ_TRUNCATED");
    expect(classifyReadStatus("read_file", "File: src/ok.ts\n```\nexport const ok = 1;\n```\n")).toBe("READ_COMPLETE");
    expect(classifyReadStatus("read_file", 'Error reading "x.ts"')).toBe("READ_FAILED");
  });

  it("runs one no-tools JSON synthesis pass after forensic prefetch", async () => {
    const { executeToolLoop, toolCacheKey } = await import("../tool-execution-engine.js");
    const strategy = makeStrategy([
      makeResponse("## 1) Executive Verdict\n## 2) Evidence Map\n## 3) Findings\n## 4) Repair Plan\n## 5) Validation Checklist\n## 6) Final Judgment"),
      makeResponse('{"response":"structured report","sources":[]}'),
    ]);
    const prefetched = new Map([["src/forensic.ts", "export function inspected() { return true; }\n"]]);
    const cache = new Map([
      [toolCacheKey("read_file", { path: "src/forensic.ts" }), prefetched.get("src/forensic.ts")!],
    ]);

    const result = await executeToolLoop({
      messages: makeMessages(),
      strategy,
      model: "fast",
      powerModel: "powerful",
      provider: "openrouter",
      tools: [{ type: "function", function: { name: "read_file", description: "", parameters: {} } }],
      rootPath: "/project",
      pendingChanges: [],
      initialFileContents: prefetched,
      cache,
      executionMode: "forensic",
      responseFormat: { type: "json_object" },
      maxIterations: 4,
    });

    expect(result.kind).toBe("response");
    if (result.kind === "response") {
      expect(result.result.content).toBe('{"response":"structured report","sources":[]}');
    }
    expect(strategy.call).toHaveBeenCalledTimes(2);
    const synthesisOptions = (strategy.call as ReturnType<typeof vi.fn>).mock.calls[1]?.[1] as Record<string, unknown>;
    expect(synthesisOptions).toMatchObject({
      responseFormat: { type: "json_object" },
    });
    expect(synthesisOptions).not.toHaveProperty("tools");
  });

  it("falls back when no-tools synthesis returns tool calls without text", async () => {
    const { executeToolLoop } = await import("../tool-execution-engine.js");
    const strategy = makeStrategy([
      makeResponse("initial evidence summary"),
      makeResponse("", [makeToolCall("unexpected", "read_file", { path: "not-executed.ts" })]),
      makeResponse('{"response":"fallback forensic report","sources":[]}'),
    ]);
    const prefetched = new Map([["src/forensic.ts", "export const inspected = true;\n"]]);
    const cache = new Map<string, string>();

    const result = await executeToolLoop({
      messages: makeMessages(),
      strategy,
      model: "initial-model",
      powerModel: "powerful-model",
      provider: "openrouter",
      tools: [{ type: "function", function: { name: "read_file", description: "", parameters: {} } }],
      rootPath: "/project",
      pendingChanges: [],
      initialFileContents: prefetched,
      cache,
      executionMode: "forensic",
      responseFormat: { type: "json_object" },
      maxIterations: 4,
    });

    expect(result.kind).toBe("response");
    if (result.kind === "response") {
      expect(result.result.content).toBe('{"response":"fallback forensic report","sources":[]}');
    }
    expect(FILE_TOOL_MOCK).not.toHaveBeenCalled();
    expect(strategy.call).toHaveBeenCalledTimes(3);
    const fallbackOptions = (strategy.call as ReturnType<typeof vi.fn>).mock.calls[2]?.[1] as Record<string, unknown>;
    expect(fallbackOptions).toMatchObject({
      model: "powerful-model",
      responseFormat: { type: "json_object" },
    });
    expect(fallbackOptions).not.toHaveProperty("tools");
  });

  it("bounds synthesis tool bodies without mutating the complete evidence messages", async () => {
    const { _compactSynthesisMessages } = await import("../tool-execution-engine.js");
    const source = "A".repeat(12_000);
    const messages = [
      { role: "system" as const, content: "system" },
      {
        role: "tool" as const,
        tool_call_id: "read-1",
        content: source,
      },
    ];

    const compacted = _compactSynthesisMessages(messages);

    expect(messages[1].content).toBe(source);
    expect(typeof compacted[1].content).toBe("string");
    if (typeof compacted[1].content === "string") {
      expect(compacted[1].content.length).toBeLessThan(source.length);
      expect(compacted[1].content).toContain("complete source read remains available");
    }
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
      expect(result.fileContents?.get("src/auth.ts")).toBe("file content");
    }
    expect(FILE_TOOL_MOCK).toHaveBeenCalledWith("read_file", { path: "src/auth.ts" }, "/project", []);
    expect(strategy.call).toHaveBeenCalledTimes(2);
  });

  it("retries one empty provider response within the same iteration", async () => {
    const { executeToolLoop } = await import("../tool-execution-engine.js");
    const strategy = makeStrategy([]);
    (strategy.call as ReturnType<typeof vi.fn>)
      .mockRejectedValueOnce(
        new GroqClientError("EMPTY_RESPONSE", "provider returned neither content nor tool calls"),
      )
      .mockResolvedValueOnce(makeResponse("recovered answer"));

    const result = await executeToolLoop({
      messages: makeMessages(),
      strategy,
      model: "fast",
      powerModel: "powerful",
      provider: "openrouter",
      tools: undefined,
      rootPath: "",
      pendingChanges: [],
      maxIterations: 1,
    });

    expect(result.kind).toBe("response");
    if (result.kind === "response") {
      expect(result.result.content).toBe("recovered answer");
    }
    expect(strategy.call).toHaveBeenCalledTimes(2);
  });

  it("records the model returned by a successful fallback response", async () => {
    const { executeToolLoop } = await import("../tool-execution-engine.js");
    const strategy = makeStrategy([]);
    (strategy.call as ReturnType<typeof vi.fn>)
      .mockRejectedValueOnce(new GroqClientError("TIMEOUT", "initial model timed out"))
      .mockResolvedValueOnce({
        ...makeResponse("fallback answer"),
        model: "actual-fallback-model",
      });
    const steps: AgentStep[] = [];

    const result = await executeToolLoop({
      messages: makeMessages(),
      strategy,
      model: "initial-model",
      powerModel: "fallback-model",
      provider: "openrouter",
      tools: undefined,
      rootPath: "",
      pendingChanges: [],
      maxIterations: 1,
      onStep: (step) => steps.push(step),
    });

    expect(result.kind).toBe("response");
    expect(steps).toContainEqual({
      kind: "model_call",
      model: "actual-fallback-model",
      provider: "openrouter",
    });
    expect(steps).not.toContainEqual(expect.objectContaining({ model: "initial-model" }));
  });

  it("preserves the full authorized manifest when a fallback executes a narrowed tool list", async () => {
    const { executeToolLoop } = await import("../tool-execution-engine.js");
    const readTool = { type: "function" as const, function: { name: "read_file", description: "", parameters: {} } };
    const searchTool = { type: "function" as const, function: { name: "search_code", description: "", parameters: {} } };
    const strategy = makeStrategy([]);
    (strategy.call as ReturnType<typeof vi.fn>)
      .mockRejectedValueOnce(new GroqClientError("TIMEOUT", "initial model timed out"))
      .mockResolvedValueOnce(makeResponse("", [makeToolCall("search-1", "search_code", { pattern: "search_code" })]))
      .mockResolvedValueOnce(makeResponse("fallback completed"));

    const result = await executeToolLoop({
      messages: makeMessages(),
      strategy,
      model: "initial-model",
      powerModel: "fallback-model",
      provider: "openrouter",
      tools: [readTool, searchTool],
      executionMode: "repair_plan",
      executionTargetPaths: ["src/auth.ts"],
      initialFileContents: new Map([["src/auth.ts", "export const auth = true;"]]),
      cache: new Map([["read_file:{\"path\":\"src/auth.ts\"}", "cached"]]),
      rootPath: "/project",
      pendingChanges: [],
      maxIterations: 2,
    });

    expect(result.kind).toBe("response");
    expect(FILE_TOOL_MOCK).toHaveBeenCalledWith(
      "search_code",
      { pattern: "search_code" },
      "/project",
      [],
    );
    const fallbackOptions = (strategy.call as ReturnType<typeof vi.fn>).mock.calls[1]?.[1] as Record<string, unknown>;
    expect(fallbackOptions).toMatchObject({
      model: "fallback-model",
      tools: [searchTool],
      toolManifest: [readTool, searchTool],
    });
  });

  it("terminalizes an invalid provider tool call without dispatching or retrying it", async () => {
    const { executeToolLoop } = await import("../tool-execution-engine.js");
    const steps: AgentStep[] = [];
    const strategy = makeStrategy([]);
    (strategy.call as ReturnType<typeof vi.fn>).mockRejectedValue(
      new GroqClientError(
        "INVALID_TOOL_CALL",
        'Provider returned invalid tool-call output: tool "search_code" is not in request manifest.',
      ),
    );

    const result = await executeToolLoop({
      messages: makeMessages(),
      strategy,
      model: "fast",
      powerModel: "powerful",
      provider: "openrouter",
      tools: [{ type: "function", function: { name: "read_file", description: "", parameters: {} } }],
      rootPath: "/project",
      pendingChanges: [],
      maxIterations: 2,
      onStep: (step) => steps.push(step),
    });

    expect(result).toMatchObject({
      kind: "failed",
      tool: "search_code",
      failureKind: "unavailable",
      diagnosticCode: "TOOL_UNAVAILABLE",
    });
    expect(strategy.call).toHaveBeenCalledTimes(1);
    expect(FILE_TOOL_MOCK).not.toHaveBeenCalled();
    expect(steps).toContainEqual(expect.objectContaining({
      kind: "tool_result",
      tool: "search_code",
      resultKind: "unavailable",
      diagnosticCode: "TOOL_UNAVAILABLE",
    }));
    expect(steps).toContainEqual(expect.objectContaining({
      kind: "done",
      stopReason: "tool_failure",
      diagnosticCodes: ["TOOL_UNAVAILABLE"],
    }));
    expect(steps.some((step) =>
      step.kind === "diagnostic" && step.details?.some((detail) => detail.includes("Provider returned")),
    )).toBe(false);
  });

  it("terminalizes an invalid tool call during the deliberate no-tools synthesis phase", async () => {
    const { executeToolLoop } = await import("../tool-execution-engine.js");
    const strategy = makeStrategy([]);
    (strategy.call as ReturnType<typeof vi.fn>).mockRejectedValue(
      new GroqClientError(
        "INVALID_TOOL_CALL",
        'Provider returned invalid tool-call output: tool "search_code" is not in request manifest.',
      ),
    );

    const result = await executeToolLoop({
      messages: makeMessages(),
      strategy,
      model: "fast",
      powerModel: "powerful",
      provider: "openrouter",
      tools: [{ type: "function", function: { name: "search_code", description: "", parameters: {} } }],
      rootPath: "/project",
      pendingChanges: [],
      maxIterations: 2,
      toolCallsDisabledAfter: 0,
    });

    expect(result).toMatchObject({
      kind: "failed",
      tool: "search_code",
      failureKind: "unavailable",
      diagnosticCode: "TOOL_UNAVAILABLE",
    });
    expect(strategy.call).toHaveBeenCalledTimes(1);
    expect(FILE_TOOL_MOCK).not.toHaveBeenCalled();
  });

  it("emits a bounded provider diagnostic for a Repair Plan timeout", async () => {
    const { executeToolLoop } = await import("../tool-execution-engine.js");
    const strategy = makeStrategy([]);
    (strategy.call as ReturnType<typeof vi.fn>).mockRejectedValue(
      new GroqClientError("TIMEOUT", "provider timed out with internal details"),
    );
    const steps: AgentStep[] = [];

    await expect(executeToolLoop({
      messages: makeMessages(),
      strategy,
      model: "initial-model",
      powerModel: "fallback-model",
      provider: "openrouter",
      tools: undefined,
      rootPath: "/project",
      pendingChanges: [],
      executionMode: "repair_plan",
      maxIterations: 1,
      onStep: (step) => steps.push(step),
    })).rejects.toThrow("provider timed out with internal details");

    expect(steps).toContainEqual({
      kind: "diagnostic",
      code: "EXECUTION_PROVIDER_FAILURE",
      details: ["fallback provider failure code: TIMEOUT"],
    });
    expect(steps.some((step) =>
      step.kind === "diagnostic" && step.details?.some((detail) => detail.includes("internal details")),
    )).toBe(false);
  });

  it("stops after the bounded empty-response retry also fails", async () => {
    const { executeToolLoop } = await import("../tool-execution-engine.js");
    const strategy = makeStrategy([]);
    (strategy.call as ReturnType<typeof vi.fn>).mockRejectedValue(
      new GroqClientError("EMPTY_RESPONSE", "provider returned neither content nor tool calls"),
    );

    const result = await executeToolLoop({
      messages: makeMessages(),
      strategy,
      model: "fast",
      powerModel: "powerful",
      provider: "openrouter",
      tools: undefined,
      rootPath: "",
      pendingChanges: [],
      maxIterations: 1,
    });

    expect(result.kind).toBe("exhausted");
    if (result.kind === "exhausted") {
      expect(result.reason).toBe("empty_response");
    }
    expect(strategy.call).toHaveBeenCalledTimes(2);
  });

  it("returns a recoverable partial result when forensic synthesis is empty", async () => {
    const { executeToolLoop } = await import("../tool-execution-engine.js");
    const strategy = makeStrategy([]);
    (strategy.call as ReturnType<typeof vi.fn>)
      .mockResolvedValueOnce(
        makeResponse("", [makeToolCall("read-1", "read_file", { path: "src/forensic.ts" })]),
      )
      .mockRejectedValue(
        new GroqClientError("EMPTY_RESPONSE", "provider returned neither content nor tool calls"),
      );

    const result = await executeToolLoop({
      messages: makeMessages(),
      strategy,
      model: "fast",
      powerModel: "powerful",
      provider: "openrouter",
      tools: [{ type: "function", function: { name: "read_file", description: "", parameters: {} } }],
      rootPath: "/project",
      pendingChanges: [],
      maxIterations: 2,
      maxToolCalls: 10,
      toolCallsDisabledAfter: 1,
      executionMode: "forensic",
    });

    expect(result.kind).toBe("partial");
    if (result.kind === "partial") {
      expect(result.reason).toBe("empty_response");
      expect(result.result.content).toBe("");
      expect(result.fileContents?.get("src/forensic.ts")).toBe("file content");
    }
    expect(FILE_TOOL_MOCK).toHaveBeenCalledTimes(1);
    expect(strategy.call).toHaveBeenCalledTimes(3);
  });

  it("preserves forensic reads when EMPTY_RESPONSE happens before synthesis starts", async () => {
    const { executeToolLoop } = await import("../tool-execution-engine.js");
    const strategy = makeStrategy([]);
    (strategy.call as ReturnType<typeof vi.fn>)
      .mockResolvedValueOnce(
        makeResponse("", [makeToolCall("read-1", "read_file", { path: "src/forensic.ts" })]),
      )
      .mockRejectedValue(
        new GroqClientError("EMPTY_RESPONSE", "provider returned neither content nor tool calls"),
      );

    const result = await executeToolLoop({
      messages: makeMessages(),
      strategy,
      model: "fast",
      powerModel: "powerful",
      provider: "openrouter",
      tools: [{ type: "function", function: { name: "read_file", description: "", parameters: {} } }],
      rootPath: "/project",
      pendingChanges: [],
      maxIterations: 4,
      maxToolCalls: 10,
      executionMode: "forensic",
    });

    expect(result.kind).toBe("partial");
    if (result.kind === "partial") {
      expect(result.reason).toBe("empty_response");
      expect(result.result.content).toBe("");
      expect(result.fileContents?.get("src/forensic.ts")).toBe("file content");
    }
    expect(FILE_TOOL_MOCK).toHaveBeenCalledTimes(1);
    expect(strategy.call).toHaveBeenCalledTimes(3);
  });

  it("keeps prefetched forensic evidence available after an empty response", async () => {
    const { executeToolLoop } = await import("../tool-execution-engine.js");
    const strategy = makeStrategy([]);
    (strategy.call as ReturnType<typeof vi.fn>).mockRejectedValue(
      new GroqClientError("EMPTY_RESPONSE", "provider returned neither content nor tool calls"),
    );
    const prefetched = new Map([["src/prefetched.ts", "export const verified = true;"]]);

    const result = await executeToolLoop({
      messages: makeMessages(),
      strategy,
      model: "fast",
      powerModel: "powerful",
      provider: "openrouter",
      tools: [{ type: "function", function: { name: "read_file", description: "", parameters: {} } }],
      rootPath: "/project",
      pendingChanges: [],
      initialFileContents: prefetched,
      maxIterations: 1,
      executionMode: "forensic",
    });

    expect(result.kind).toBe("partial");
    if (result.kind === "partial") {
      expect(result.reason).toBe("empty_response");
      expect(result.fileContents?.get("src/prefetched.ts")).toBe("export const verified = true;");
    }
    expect(strategy.call).toHaveBeenCalledTimes(2);
  });

  it("keeps a completed read when the shared ledger rejects the next retry", async () => {
    const { executeToolLoop } = await import("../tool-execution-engine.js");
    const controller = new AbortController();
    const ledger = createExecutionLedger({
      signal: controller.signal,
      budget: { deadlineMs: 10_000, modelCalls: 8 },
    });
    FILE_TOOL_MOCK.mockImplementationOnce(async () => {
      controller.abort();
      return "verified source evidence";
    });
    const strategy = makeStrategy([
      makeResponse("", [makeToolCall("read-1", "read_file", { path: "src/verified.ts" })]),
    ]);

    const result = await executeToolLoop({
      messages: makeMessages(),
      strategy,
      model: "fast",
      powerModel: "powerful",
      provider: "openrouter",
      tools: [{ type: "function", function: { name: "read_file", description: "", parameters: {} } }],
      rootPath: "/project",
      pendingChanges: [],
      maxIterations: 4,
      executionMode: "forensic",
      executionLedger: ledger,
    });

    expect(result.kind).toBe("partial");
    if (result.kind === "partial") {
      expect(result.reason).toBe("provider_timeout");
      expect(result.fileContents?.get("src/verified.ts")).toBe("verified source evidence");
      expect(result.sourceRetrieval?.uniqueReads).toBe(1);
    }
    expect(ledger.snapshot().terminalReason).toBe("cancelled");
  });

  it("does not record a failed read as a source or file content", async () => {
    const { executeToolLoop } = await import("../tool-execution-engine.js");
    FILE_TOOL_MOCK.mockResolvedValueOnce(
      'Error reading "queries.js": ENOENT: no such file or directory',
    );
    const strategy = makeStrategy([
      makeResponse("", [makeToolCall("missing", "read_file", { path: "queries.js" })]),
      makeResponse("final answer"),
    ]);

    const result = await executeToolLoop({
      messages: makeMessages(),
      strategy,
      model: "fast",
      powerModel: "powerful",
      provider: "test",
      tools: [{ type: "function", function: { name: "read_file", description: "", parameters: {} } }],
      rootPath: "/project",
      pendingChanges: [],
    });

    expect(result.kind).toBe("response");
    expect(result.toolSources).not.toContain("queries.js");
    expect(result.fileContents?.has("queries.js")).toBe(false);
  });

  it("requires a tool only on the first execution turn", async () => {
    const { executeToolLoop } = await import("../tool-execution-engine.js");
    const strategy = makeStrategy([
      makeResponse("", [makeToolCall("tc-required", "read_file", { path: "src/auth.ts" })]),
      makeResponse("final answer"),
    ]);

    await executeToolLoop({
      messages: makeMessages(),
      strategy,
      model: "fast",
      powerModel: "powerful",
      provider: "openrouter",
      tools: [{ type: "function", function: { name: "read_file", description: "", parameters: {} } }],
      rootPath: "/project",
      pendingChanges: [],
      toolChoice: "required",
    });

    const calls = vi.mocked(strategy.call).mock.calls;
    expect(calls[0]?.[1]).toMatchObject({ toolChoice: "required" });
    expect(calls[1]?.[1]).not.toHaveProperty("toolChoice");
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

  it("does NOT count repeated CACHED search_code calls as progress: force fires and out-of-set cached searches are rejected (FEG-008)", async () => {
    const { executeToolLoop } = await import("../tool-execution-engine.js");
    // A cached/replayed duplicate search is NO_PROGRESS under the same
    // usable+novel predicate the fresh path uses, so a planner cannot sidestep
    // the forced-evidence gate purely by re-issuing an identical search. Two
    // such consecutive replayed calls trip the force, and a further repeated
    // cached search is then REJECTED at dispatch (the separate search-duplicate
    // escalation ladder still surfaces guidance, but FEG-008 wins first).
    FILE_TOOL_MOCK.mockResolvedValue("src/chat-agent.ts:42: match");
    const repeatedSearch = (id: string) =>
      makeToolCall(id, "search_code", { pattern: "onStep" });
    const strategy = makeStrategy([
      makeResponse("", [makeToolCall("fresh", "search_code", { pattern: "onStep" })]),
      makeResponse("", [repeatedSearch("duplicate-1")]),
      makeResponse("", [repeatedSearch("duplicate-2")]),
      makeResponse("", [repeatedSearch("duplicate-3")]),
      makeResponse("synthesized"),
    ]);
    const messages = makeMessages();
    const steps: AgentStep[] = [];

    const result = await executeToolLoop({
      messages,
      strategy,
      model: "fast",
      powerModel: "powerful",
      provider: "test",
      tools: [
        { type: "function", function: { name: "search_code", description: "", parameters: {} } },
        { type: "function", function: { name: "read_file", description: "", parameters: {} } },
      ],
      rootPath: "/project",
      pendingChanges: [],
      maxIterations: 8,
      onStep: (step) => void steps.push(step),
    });

    expect(result.kind).toBe("response");
    expect(steps.some(
      (s) => s.kind === "diagnostic" && s.code === "FORCE_PRIMARY_EVIDENCE_ACTION",
    )).toBe(true);
    expect(result.sourceRetrieval?.progressForced).toBe(true);
    const calls = vi.mocked(strategy.call).mock.calls;
    // The fresh search ran exactly once; each later identical search is a cache
    // hit (never re-dispatched).
    expect(FILE_TOOL_MOCK).toHaveBeenCalledTimes(1);
    // The repeated-cached reach of the search-duplicate guidance still surfaces
    // before the force preempts further replayed searches.
    expect(calls[2]?.[0].some((message) =>
      String(message.content).includes("DUPLICATE SEARCH") &&
      String(message.content).includes("matching line 42"),
    )).toBe(true);
    // A further cached search under forced-evidence mode is rejected at dispatch
    // rather than served from cache.
    expect(calls[4]?.[0].some((message) =>
      String(message.content).includes("Forced-evidence mode"))).toBe(true);
  });

  it("does NOT count repeated CACHED list_directory calls as progress: force rejects the next cached listing (FEG-008)", async () => {
    const { executeToolLoop } = await import("../tool-execution-engine.js");
    // Identical replay of a directory listing is NO_PROGRESS (the replayed
    // result is not new evidence), so a model cannot reset the streak by
    // re-issuing the same list_directory. Two replay turns trip the force and a
    // further cached listing is rejected at dispatch until a real read lands.
    FILE_TOOL_MOCK.mockResolvedValue("src/components/\nsrc/libs/");
    const repeatedList = (id: string) =>
      makeToolCall(id, "list_directory", { path: "src" });
    const strategy = makeStrategy([
      makeResponse("", [makeToolCall("fresh", "list_directory", { path: "src" })]),
      makeResponse("", [repeatedList("dup-list-1")]),
      makeResponse("", [repeatedList("dup-list-2")]),
      makeResponse("", [makeToolCall("read", "read_file", { path: "src/libs/hooks.ts" })]),
      makeResponse("done"),
    ]);
    const steps: AgentStep[] = [];

    const result = await executeToolLoop({
      messages: makeMessages(),
      strategy,
      model: "fast",
      powerModel: "powerful",
      provider: "test",
      tools: [
        { type: "function", function: { name: "list_directory", description: "", parameters: {} } },
        { type: "function", function: { name: "read_file", description: "", parameters: {} } },
      ],
      rootPath: "/project",
      pendingChanges: [],
      maxIterations: 8,
      onStep: (step) => void steps.push(step),
    });

    expect(result.kind).toBe("response");
    expect(steps.some(
      (s) => s.kind === "diagnostic" && s.code === "FORCE_PRIMARY_EVIDENCE_ACTION",
    )).toBe(true);
    expect(result.sourceRetrieval?.progressForced).toBe(true);
    // fresh listing + the read = 2 real dispatches; both replays served from cache.
    expect(FILE_TOOL_MOCK).toHaveBeenCalledTimes(2);
  });

  it("does NOT count duplicate-result fresh searches as progress: force fires and out-of-set searches are rejected (FEG-008)", async () => {
    const { executeToolLoop } = await import("../tool-execution-engine.js");
    // Distinct search patterns all returning the SAME result are not NEW
    // evidence: the first is novel (progress) but every identical follow-up is
    // NO_PROGRESS. Two consecutive such turns force a primary-evidence action
    // and then REJECT further fresh searches at dispatch, so a planner cannot
    // orbit by re-searching the same (or duplicated) result forever.
    FILE_TOOL_MOCK.mockResolvedValue("src/chat-agent.ts:42: same match");
    const searches = ["onStep", "onDelta", "relayAgentStep", "toolSources", "fileContents"];
    const strategy = makeStrategy([
      ...searches.map((pattern, index) =>
        makeResponse("", [makeToolCall(`dup-${index}`, "search_code", { pattern })]),
      ),
      makeResponse("done"),
    ]);
    const steps: AgentStep[] = [];

    const result = await executeToolLoop({
      messages: makeMessages(),
      strategy,
      model: "fast",
      powerModel: "powerful",
      provider: "test",
      tools: [
        { type: "function", function: { name: "search_code", description: "", parameters: {} } },
        { type: "function", function: { name: "read_file", description: "", parameters: {} } },
      ],
      rootPath: "/project",
      pendingChanges: [],
      maxIterations: 8,
      searchNoveltyBudget: 4,
      onStep: (step) => void steps.push(step),
    });

    expect(result.kind).toBe("response");
    expect(steps.some(
      (s) => s.kind === "diagnostic" && s.code === "FORCE_PRIMARY_EVIDENCE_ACTION",
    )).toBe(true);
    expect(result.sourceRetrieval?.progressForced).toBe(true);
    // Only the first novel search plus two duplicate NO_PROGRESS searches
    // execute; each later fresh duplicate is rejected at dispatch before it
    // reaches the file tool.
    expect(FILE_TOOL_MOCK).toHaveBeenCalledTimes(3);
    // A duplicate search attempted while forced surfaced a forced-evidence
    // instruction to the model instead of being silently served.
    expect(vi.mocked(strategy.call).mock.calls
      .find(([messages]) => messages.some((m) =>
        String(m.content).includes("Forced-evidence mode")))).toBeDefined();
  });

  it("counts a genuinely new fresh search as progress but forces on its duplicates (FEG-008)", async () => {
    const { executeToolLoop } = await import("../tool-execution-engine.js");
    // The "new-result" pattern yields a NOVEL result (a real progress boundary);
    // once later searches return an already-seen result they are NO_PROGRESS
    // and force primary evidence instead of circulating forever.
    FILE_TOOL_MOCK.mockImplementation(async (_name: string, args: Record<string, string>) =>
      args.pattern === "new-result" ? "src/other.ts:7: new match" : "src/chat-agent.ts:42: same match",
    );
    const patterns = ["initial", "new-result", "repeat-1", "repeat-2", "repeat-3"];
    const strategy = makeStrategy([
      ...patterns.map((pattern, index) =>
        makeResponse("", [makeToolCall(`mix-${index}`, "search_code", { pattern })]),
      ),
      makeResponse("done"),
    ]);
    const steps: AgentStep[] = [];

    const result = await executeToolLoop({
      messages: makeMessages(),
      strategy,
      model: "fast",
      powerModel: "powerful",
      provider: "test",
      tools: [
        { type: "function", function: { name: "search_code", description: "", parameters: {} } },
        { type: "function", function: { name: "read_file", description: "", parameters: {} } },
      ],
      rootPath: "/project",
      pendingChanges: [],
      maxIterations: 8,
      searchNoveltyBudget: 4,
      onStep: (step) => void steps.push(step),
    });

    expect(result.kind).toBe("response");
    expect(steps.some(
      (s) => s.kind === "diagnostic" && s.code === "FORCE_PRIMARY_EVIDENCE_ACTION",
    )).toBe(true);
    // A duplicate search attempted while forced is rejected at dispatch.
    expect(vi.mocked(strategy.call).mock.calls
      .find(([messages]) => messages.some((m) =>
        String(m.content).includes("Forced-evidence mode")))).toBeDefined();
  });

  it("does NOT count empty fresh searches as progress: force fires and out-of-set calls rejected (FEG-008)", async () => {
    const { executeToolLoop } = await import("../tool-execution-engine.js");
    // Two empty fresh searches (real handler shape `No matches found.`) are
    // NO_PROGRESS, tripping the force; a third attempted search is then rejected
    // at dispatch. Only a real read provides the evidence to advance.
    FILE_TOOL_MOCK.mockResolvedValue("No matches found.");
    const strategy = makeStrategy([
      makeResponse("", [makeToolCall("f1", "search_code", { pattern: "x" })]),
      makeResponse("", [makeToolCall("f2", "search_code", { pattern: "y" })]),
      makeResponse("", [makeToolCall("f3", "search_code", { pattern: "z" })]),
      makeResponse("", [makeToolCall("read", "read_file", { path: "src/ev.ts" })]),
      makeResponse("done"),
    ]);
    const steps: AgentStep[] = [];

    const result = await executeToolLoop({
      messages: makeMessages(),
      strategy,
      model: "fast",
      powerModel: "powerful",
      provider: "test",
      tools: [
        { type: "function", function: { name: "search_code", description: "", parameters: {} } },
        { type: "function", function: { name: "read_file", description: "", parameters: {} } },
      ],
      rootPath: "/project",
      pendingChanges: [],
      maxIterations: 8,
      onStep: (step) => void steps.push(step),
    });

    expect(result.kind).toBe("response");
    expect(steps.some(
      (s) => s.kind === "diagnostic" && s.code === "FORCE_PRIMARY_EVIDENCE_ACTION",
    )).toBe(true);
    expect(result.sourceRetrieval?.progressForced).toBe(true);
    // f1 + f2 (failed searches) + the eventual read = 3 tool executions; the
    // third failed search (f3) is rejected at dispatch and never runs.
    expect(FILE_TOOL_MOCK).toHaveBeenCalledTimes(3);
    expect(vi.mocked(strategy.call).mock.calls
      .find(([messages]) => messages.some((m) =>
        String(m.content).includes("Forced-evidence mode")))).toBeDefined();
  });

  it("does NOT count empty list_directory as progress: force fires, out-of-set rejected (FEG-008)", async () => {
    const { executeToolLoop } = await import("../tool-execution-engine.js");
    // Each empty listing uses the REAL handler shape `Contents of "...":\n(empty)`.
    // Even though every wrapper embeds a distinct directory path (fresh hash),
    // an empty directory carries no evidence, so distinct empty listings are
    // NO_PROGRESS: two such turns force primary evidence and a further listing
    // attempt is rejected at dispatch, preserving the read-mandate. This closes
    // the loop where a model lists distinct empty dirs forever.
    FILE_TOOL_MOCK.mockImplementation(async (_name: string, args: Record<string, string>) =>
      `Contents of "${args.path}":\n(empty)`);
    const strategy = makeStrategy([
      makeResponse("", [makeToolCall("l1", "list_directory", { path: "src/a" })]),
      makeResponse("", [makeToolCall("l2", "list_directory", { path: "src/b" })]),
      makeResponse("", [makeToolCall("l3", "list_directory", { path: "src/c" })]),
      makeResponse("", [makeToolCall("read", "read_file", { path: "src/ev.ts" })]),
      makeResponse("done"),
    ]);
    const steps: AgentStep[] = [];

    const result = await executeToolLoop({
      messages: makeMessages(),
      strategy,
      model: "fast",
      powerModel: "powerful",
      provider: "test",
      tools: [
        { type: "function", function: { name: "list_directory", description: "", parameters: {} } },
        { type: "function", function: { name: "read_file", description: "", parameters: {} } },
      ],
      rootPath: "/project",
      pendingChanges: [],
      maxIterations: 8,
      onStep: (step) => void steps.push(step),
    });

    expect(result.kind).toBe("response");
    expect(steps.some(
      (s) => s.kind === "diagnostic" && s.code === "FORCE_PRIMARY_EVIDENCE_ACTION",
    )).toBe(true);
    expect(result.sourceRetrieval?.progressForced).toBe(true);
    // l1 + l2 (failed listings) + the eventual read = 3 tool executions; the
    // third listing (l3) is rejected at dispatch and never runs.
    expect(FILE_TOOL_MOCK).toHaveBeenCalledTimes(3);
    expect(vi.mocked(strategy.call).mock.calls
      .find(([messages]) => messages.some((m) =>
        String(m.content).includes("Forced-evidence mode")))).toBeDefined();
  });

  it("OR-accumulates progress across multiple tool calls in one turn: a novel call is not erased by a duplicate (FEG-008)", async () => {
    const { executeToolLoop } = await import("../tool-execution-engine.js");
    // In a SINGLE model turn the model issues a NOVEL search plus an empty
    // (neutral) search. Progress is OR-accumulated per call, so the novel
    // result must be credited and the iteration must NOT trigger the force —
    // otherwise a stray empty/duplicate call in the same batch would cause an
    // unwarranted forced-evidence action.
    FILE_TOOL_MOCK.mockImplementation(async (_name: string, args: Record<string, string>) =>
      args.pattern === "onStep" ? "src/chat-agent.ts:42: match" : "No matches found.",
    );
    const strategy = makeStrategy([
      makeResponse("", [
        makeToolCall("novel", "search_code", { pattern: "onStep" }),
        makeToolCall("empty", "search_code", { pattern: "nothing" }),
      ]),
      makeResponse("", [makeToolCall("read", "read_file", { path: "src/ev.ts" })]),
      makeResponse("done"),
    ]);
    const steps: AgentStep[] = [];

    const result = await executeToolLoop({
      messages: makeMessages(),
      strategy,
      model: "fast",
      powerModel: "powerful",
      provider: "test",
      tools: [
        { type: "function", function: { name: "search_code", description: "", parameters: {} } },
        { type: "function", function: { name: "read_file", description: "", parameters: {} } },
      ],
      rootPath: "/project",
      pendingChanges: [],
      maxIterations: 8,
      onStep: (step) => void steps.push(step),
    });

    expect(result.kind).toBe("response");
    // The novel search made progress that turn, so no force should fire.
    expect(result.sourceRetrieval?.progressForced).toBe(false);
    expect(steps.some(
      (s) => s.kind === "diagnostic" && s.code === "FORCE_PRIMARY_EVIDENCE_ACTION",
    )).toBe(false);
  });

  it("does not suppress search_code when there are no duplicates", async () => {
    const { executeToolLoop } = await import("../tool-execution-engine.js");
    FILE_TOOL_MOCK.mockResolvedValue("src/chat-agent.ts:42: match");
    const strategy = makeStrategy([
      makeResponse("", [makeToolCall("search", "search_code", { pattern: "onStep" })]),
      makeResponse("done"),
    ]);

    const result = await executeToolLoop({
      messages: makeMessages(),
      strategy,
      model: "fast",
      powerModel: "powerful",
      provider: "test",
      tools: [
        { type: "function", function: { name: "search_code", description: "", parameters: {} } },
        { type: "function", function: { name: "read_file", description: "", parameters: {} } },
      ],
      rootPath: "/project",
      pendingChanges: [],
      maxIterations: 4,
    });

    expect(result.kind).toBe("response");
    const secondCallTools = vi.mocked(strategy.call).mock.calls[1]?.[1].tools;
    expect(secondCallTools?.map((tool) => tool.function.name)).toEqual(["search_code", "read_file"]);
  });

  it("preserves the read source on cached tool results for persisted traces", async () => {
    const { executeToolLoop } = await import("../tool-execution-engine.js");
    const strategy = makeStrategy([
      makeResponse("", [
        makeToolCall("fresh-read", "read_file", { path: "src/auth.ts" }),
        makeToolCall("cached-read", "read_file", { path: "src/auth.ts" }),
      ]),
      makeResponse("done"),
    ]);
    const steps: AgentStep[] = [];

    const result = await executeToolLoop({
      messages: makeMessages(),
      strategy,
      model: "fast",
      powerModel: "powerful",
      provider: "test",
      tools: [{ type: "function", function: { name: "read_file", description: "", parameters: {} } }],
      rootPath: "/project",
      pendingChanges: [],
      onStep: (step) => steps.push(step),
    });

    expect(result.kind).toBe("response");
    expect(steps).toContainEqual(expect.objectContaining({
      kind: "tool_result",
      tool: "read_file",
      source: "src/auth.ts",
      cached: true,
    }));
  });

  it("records every cached duplicate tool call in the model scorecard", async () => {
    const { executeToolLoop } = await import("../tool-execution-engine.js");
    const model = "duplicate-read-scorecard-model";
    _resetBehavioralScorecardForTest();
    FILE_TOOL_MOCK.mockResolvedValue("file output");
    const first = makeResponse("", [
      makeToolCall("fresh-scorecard-read", "read_file", { path: "src/auth.ts" }),
      makeToolCall("duplicate-scorecard-read", "read_file", { path: "src/auth.ts" }),
    ]);
    first.model = model;
    const final = makeResponse("done");
    final.model = model;
    const strategy = makeStrategy([first, final]);

    const result = await executeToolLoop({
      messages: makeMessages(),
      strategy,
      model,
      powerModel: "powerful",
      provider: "test",
      tools: [{ type: "function", function: { name: "read_file", description: "", parameters: {} } }],
      rootPath: "/project",
      pendingChanges: [],
    });

    expect(result.kind).toBe("response");
    expect(getBehavioralScorecard(model)).toMatchObject({
      sampleCount: 2,
      loopCount: 1,
      duplicateToolCallCount: 1,
      duplicateToolCallRate: 0.5,
    });
    _resetBehavioralScorecardForTest();
  });

  it("escalates repeated cached read_file calls in ordinary task chat", async () => {
    const { executeToolLoop } = await import("../tool-execution-engine.js");
    FILE_TOOL_MOCK.mockResolvedValue("file content");
    const strategy = makeStrategy([
      makeResponse("", [makeToolCall("ordinary-read-1", "read_file", { path: "src/auth.ts" })]),
      makeResponse("", [makeToolCall("ordinary-read-2", "read_file", { path: "src/auth.ts" })]),
      makeResponse("", [makeToolCall("ordinary-read-3", "read_file", { path: "src/auth.ts" })]),
      makeResponse("", [makeToolCall("ordinary-read-4", "read_file", { path: "src/auth.ts" })]),
      makeResponse("done"),
    ]);

    const result = await executeToolLoop({
      messages: makeMessages(),
      strategy,
      model: "fast",
      powerModel: "powerful",
      provider: "test",
      tools: [{ type: "function", function: { name: "read_file", description: "", parameters: {} } }],
      rootPath: "/project",
      pendingChanges: [],
    });

    expect(result.kind).toBe("response");
    expect(FILE_TOOL_MOCK).toHaveBeenCalledTimes(1);
    const calls = vi.mocked(strategy.call).mock.calls;
    expect(calls[3]?.[1].tools).toEqual([]);
    expect(calls).toHaveLength(5);
  });

  it("stops Repair Plan execution after repeated cached tool calls", async () => {
    const { executeToolLoop } = await import("../tool-execution-engine.js");
    FILE_TOOL_MOCK.mockResolvedValue("file content");
    const strategy = makeStrategy([]);
    let callCount = 0;
    (strategy.call as ReturnType<typeof vi.fn>).mockImplementation(async () => {
      callCount++;
      return makeResponse("", [
        makeToolCall(`repeat-${callCount}`, "read_file", { path: "src/auth.ts" }),
      ]);
    });

    const steps: AgentStep[] = [];
    const result = await executeToolLoop({
      messages: makeMessages(),
      strategy,
      model: "fast",
      powerModel: "powerful",
      provider: "test",
      tools: [{ type: "function", function: { name: "read_file", description: "", parameters: {} } }],
      rootPath: "/project",
      pendingChanges: [],
      executionMode: "repair_plan",
      maxIterations: 40,
      onStep: (step) => steps.push(step),
    });

    expect(result).toMatchObject({
      kind: "stopped",
      reason: "repeated_tool_call",
      tool: "read_file",
    });
    expect(callCount).toBe(5);
    expect(FILE_TOOL_MOCK).toHaveBeenCalledTimes(1);
    expect(steps).toContainEqual(expect.objectContaining({
      kind: "execution_guard",
      code: "REPEATED_TOOL_CALL",
      tool: "read_file",
    }));
  });

  it("blocks repeated failed validation when the pending patch has not changed", async () => {
    const { executeToolLoop } = await import("../tool-execution-engine.js");
    const strategy = makeStrategy([
      makeResponse("", [makeToolCall("validate-1", "run_validation", { profile: "workspace-typecheck" })]),
      makeResponse("", [makeToolCall("validate-2", "run_validation", { profile: "workspace-typecheck" })]),
      makeResponse("BLOCKED: validation made no progress."),
    ]);
    const validationRunner = vi.fn(async () => ({
      status: "failed" as const,
      profile: "workspace-typecheck",
      command: "pnpm run typecheck",
      exitCode: 1,
      failedTests: ["the same failure remains"],
      affectedFiles: ["src/example.ts"],
      detail: "The pending change still fails typecheck.",
    }));
    const steps: AgentStep[] = [];

    const result = await executeToolLoop({
      messages: makeMessages(),
      strategy,
      model: "fast",
      powerModel: "powerful",
      provider: "test",
      tools: [{
        type: "function",
        function: { name: "run_validation", description: "", parameters: {} },
      }],
      rootPath: "/project",
      pendingChanges: [{
        path: "src/example.ts",
        absolutePath: "/project/src/example.ts",
        newContent: "const value: string = 1;",
        originalContent: "const value: string = 'ok';",
        reason: "test repair",
      }],
      executionMode: "repair_plan",
      allowExecutionTools: true,
      validationRunner,
      validationTargetPaths: ["src/example.ts"],
      onStep: (step) => steps.push(step),
    });

    expect(result.kind).toBe("response");
    expect(validationRunner).toHaveBeenCalledTimes(1);
    expect(steps).toContainEqual(expect.objectContaining({
      kind: "validation",
      status: "failed",
      attempt: 1,
      repairState: "REPAIRING",
    }));
    expect(steps).toContainEqual(expect.objectContaining({
      kind: "validation",
      status: "blocked",
      attempt: 2,
      repairState: "BLOCKED",
      detail: expect.stringContaining("pending changes are identical"),
    }));
  });

  it("caps an oversized repair budget at three validation attempts", async () => {
    const { executeToolLoop } = await import("../tool-execution-engine.js");
    const strategy = makeStrategy([
      makeResponse("", [makeToolCall("write-1", "write_file", {
        path: "src/example.ts",
        content: "const value = 1;",
        reason: "first repair",
      })]),
      makeResponse("", [makeToolCall("validate-1", "run_validation", { profile: "workspace-typecheck" })]),
      makeResponse("", [makeToolCall("write-2", "write_file", {
        path: "src/example.ts",
        content: "const value = 2;",
        reason: "second repair",
      })]),
      makeResponse("", [makeToolCall("validate-2", "run_validation", { profile: "workspace-typecheck" })]),
      makeResponse("", [makeToolCall("write-3", "write_file", {
        path: "src/example.ts",
        content: "const value = 3;",
        reason: "third repair",
      })]),
      makeResponse("", [makeToolCall("validate-3", "run_validation", { profile: "workspace-typecheck" })]),
      makeResponse("", [makeToolCall("write-4", "write_file", {
        path: "src/example.ts",
        content: "const value = 4;",
        reason: "fourth repair",
      })]),
      makeResponse("", [makeToolCall("validate-4", "run_validation", { profile: "workspace-typecheck" })]),
      makeResponse("", [makeToolCall("write-5", "write_file", {
        path: "src/example.ts",
        content: "const value = 5;",
        reason: "fifth repair",
      })]),
      makeResponse("", [makeToolCall("validate-5", "run_validation", { profile: "workspace-typecheck" })]),
      makeResponse("", [makeToolCall("validate-6", "run_validation", { profile: "workspace-typecheck" })]),
      makeResponse("BLOCKED: the repair attempt budget was exhausted."),
    ]);
    let writeCount = 0;
    FILE_TOOL_MOCK.mockImplementation(async (
      _name: unknown,
      args: { path?: string; content?: string },
      _root: unknown,
      changes: PendingChange[],
    ) => {
      writeCount += 1;
      changes.push({
        path: args.path ?? "src/example.ts",
        absolutePath: "/project/src/example.ts",
        newContent: args.content ?? "",
        originalContent: "const value = 0;",
        reason: `repair ${writeCount}`,
      });
      return `queued repair ${writeCount}`;
    });
    const validationRunner = vi.fn(async () => ({
      status: "failed" as const,
      profile: "workspace-typecheck",
      command: "pnpm run typecheck",
      exitCode: 1,
      failedTests: ["the same typecheck failure remains"],
      affectedFiles: ["src/example.ts"],
      detail: "The repair still fails typecheck.",
    }));
    const steps: AgentStep[] = [];

    const result = await executeToolLoop({
      messages: makeMessages(),
      strategy,
      model: "fast",
      powerModel: "powerful",
      provider: "test",
      tools: [
        { type: "function", function: { name: "write_file", description: "", parameters: {} } },
        { type: "function", function: { name: "run_validation", description: "", parameters: {} } },
      ],
      rootPath: "/project",
      pendingChanges: [],
      executionMode: "repair_plan",
      allowExecutionTools: true,
      validationRunner,
      validationTargetPaths: ["src/example.ts"],
      maxValidationAttempts: 99,
      onStep: (step) => steps.push(step),
    });

    expect(result.kind).toBe("response");
    expect(validationRunner).toHaveBeenCalledTimes(3);
    expect(steps.filter((step) => step.kind === "validation" && step.status === "failed"))
      .toHaveLength(3);
    expect(steps).toContainEqual(expect.objectContaining({
      kind: "validation",
      status: "blocked",
       attempt: 4,
       maxAttempts: 3,
      repairState: "BLOCKED",
      detail: expect.stringContaining("attempt limit"),
    }));
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

  it("reports total tool-call telemetry across prefetch, cached results, and synthesis escalation", async () => {
    const { executeToolLoop, toolCacheKey } = await import("../tool-execution-engine.js");
    const prefetched = new Map([["src/auth.ts", "pre-fetched content"]]);
    const cache = new Map<string, string>([
      [toolCacheKey("read_file", { path: "src/auth.ts" }), "pre-fetched content"],
    ]);
    const strategy = makeStrategy([
      makeResponse("", [makeToolCall("cached-1", "read_file", { path: "src/auth.ts" })]),
      makeResponse("", [makeToolCall("cached-2", "read_file", { path: "src/auth.ts" })]),
      makeResponse("", [makeToolCall("cached-3", "read_file", { path: "src/auth.ts" })]),
      makeResponse("synthesized"),
    ]);
    const steps: AgentStep[] = [
      {
        kind: "tool_call",
        tool: "read_file",
        args: { path: "src/auth.ts" },
        cached: false,
        prefetched: true,
      },
      {
        kind: "tool_result",
        tool: "read_file",
        source: "src/auth.ts",
        cached: false,
        prefetched: true,
        outputLength: "pre-fetched content".length,
      },
    ];

    const result = await executeToolLoop({
      messages: makeMessages(),
      strategy,
      model: "fast",
      powerModel: "powerful",
      provider: "test",
      tools: [{ type: "function", function: { name: "read_file", description: "", parameters: {} } }],
      rootPath: "/project",
      pendingChanges: [],
      cache,
      initialFileContents: prefetched,
      onStep: (step) => steps.push(step),
    });

    expect(result.kind).toBe("response");
    const done = [...steps].reverse().find((step): step is Extract<AgentStep, { kind: "done" }> => step.kind === "done");
    expect(done).toMatchObject({
      toolCalls: 4,
      prefetchToolCalls: 1,
      loopToolCalls: 3,
      synthesisStarted: true,
    });
    expect(steps.filter((step) => step.kind === "tool_call")).toHaveLength(4);
    expect(steps.filter((step) => step.kind === "tool_call" && step.cached)).toHaveLength(3);
  });

  it("forces forensic synthesis after a cached source read", async () => {
    const { executeToolLoop, toolCacheKey } = await import("../tool-execution-engine.js");
    const strategy = makeStrategy([]);
    const calls: Array<{ tools?: unknown }> = [];
    (strategy.call as ReturnType<typeof vi.fn>).mockImplementation(
      async (_messages: unknown, options: { tools?: unknown }) => {
        calls.push(options);
        return calls.length === 1
          ? makeResponse("", [makeToolCall("cached-read", "read_file", { path: "src/auth.ts" })])
          : makeResponse("forensic report");
      },
    );
    const cache = new Map<string, string>([
      [toolCacheKey("read_file", { path: "src/auth.ts" }), "pre-fetched content"],
    ]);

    const result = await executeToolLoop({
      messages: makeMessages(),
      strategy,
      model: "fast",
      powerModel: "powerful",
      provider: "test",
      tools: [{ type: "function", function: { name: "read_file", description: "", parameters: {} } }],
      rootPath: "/project",
      pendingChanges: [],
      cache,
      executionMode: "forensic",
      maxIterations: 8,
    });

    expect(result.kind).toBe("response");
    if (result.kind === "response") {
      expect(result.result.content).toBe("forensic report");
    }
    expect(calls).toHaveLength(2);
    expect(calls[1]?.tools).toEqual([]);
    expect(FILE_TOOL_MOCK).not.toHaveBeenCalled();
  });

  it("terminates synthesis when a provider emits tool calls with tools disabled", async () => {
    const { executeToolLoop, toolCacheKey } = await import("../tool-execution-engine.js");
    const strategy = makeStrategy([]);
    const calls: Array<{ tools?: unknown }> = [];
    (strategy.call as ReturnType<typeof vi.fn>).mockImplementation(
      async (_messages: unknown, options: { tools?: unknown }) => {
        calls.push(options);
        return calls.length === 1
          ? makeResponse("", [makeToolCall("cached-read", "read_file", { path: "src/auth.ts" })])
          : makeResponse("", [makeToolCall("ignored-read", "read_file", { path: "src/auth.ts" })]);
      },
    );
    const cache = new Map<string, string>([
      [toolCacheKey("read_file", { path: "src/auth.ts" }), "pre-fetched content"],
    ]);

    const result = await executeToolLoop({
      messages: makeMessages(),
      strategy,
      model: "fast",
      powerModel: "powerful",
      provider: "test",
      tools: [{ type: "function", function: { name: "read_file", description: "", parameters: {} } }],
      rootPath: "/project",
      pendingChanges: [],
      cache,
      executionMode: "forensic",
      maxIterations: 8,
    });

    expect(result).toMatchObject({
      kind: "partial",
      reason: "empty_response",
    });
    expect(calls).toHaveLength(2);
    expect(calls[1]?.tools).toEqual([]);
    expect(FILE_TOOL_MOCK).not.toHaveBeenCalled();
  });

  it("stops the rest of a forensic tool batch after cached evidence", async () => {
    const { executeToolLoop, toolCacheKey } = await import("../tool-execution-engine.js");
    const strategy = makeStrategy([]);
    const messages = makeMessages();
    const calls: Array<{ tools?: unknown }> = [];
    (strategy.call as ReturnType<typeof vi.fn>).mockImplementation(
      async (_messages: unknown, options: { tools?: unknown }) => {
        calls.push(options);
        return calls.length === 1
          ? makeResponse("", [
              makeToolCall("cached-read", "read_file", { path: "src/auth.ts" }),
              makeToolCall("fresh-read", "read_file", { path: "src/other.ts" }),
            ])
          : makeResponse("forensic report");
      },
    );
    const cache = new Map<string, string>([
      [toolCacheKey("read_file", { path: "src/auth.ts" }), "pre-fetched content"],
    ]);

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
      executionMode: "forensic",
      maxIterations: 8,
    });

    expect(result.kind).toBe("response");
    expect(calls).toHaveLength(2);
    expect(calls[1]?.tools).toEqual([]);
    expect(FILE_TOOL_MOCK).not.toHaveBeenCalled();
    expect(result.toolSources).not.toContain("src/other.ts");
    expect(messages.some((message) =>
      message.role === "tool" &&
      String(message.content).startsWith("Forensic collection stopped."),
    )).toBe(true);
  });

  it("hides read_file after all Repair Plan targets are prefetched", async () => {
    const { executeToolLoop, toolCacheKey } = await import("../tool-execution-engine.js");
    const strategy = makeStrategy([
      // A provider that ignores the narrowed schema must receive an explicit
      // tool-result guard instead of another copy of the cached file.
      makeResponse("", [makeToolCall("stale-read", "read_file", { path: "src/auth.ts" })]),
      makeResponse("ready for the edit"),
    ]);
    const cache = new Map<string, string>([
      [toolCacheKey("read_file", { path: "src/auth.ts" }), "pre-fetched content"],
    ]);
    const pendingChanges: PendingChange[] = [];

    const result = await executeToolLoop({
      messages: makeMessages(),
      strategy,
      model: "fast",
      powerModel: "powerful",
      provider: "test",
      tools: [
        { type: "function", function: { name: "read_file", description: "", parameters: {} } },
        { type: "function", function: { name: "replace_text", description: "", parameters: {} } },
        { type: "function", function: { name: "write_file", description: "", parameters: {} } },
      ],
      rootPath: "/project",
      pendingChanges,
      cache,
      executionMode: "repair_plan",
      executionTargetPaths: ["src/auth.ts"],
    });

    expect(result.kind).toBe("response");
    const firstCallOptions = (strategy.call as ReturnType<typeof vi.fn>).mock.calls[0]?.[1] as {
      tools?: Array<{ function: { name: string } }>;
    };
    expect(firstCallOptions.tools?.map((tool) => tool.function.name)).toEqual([
      "replace_text",
      "write_file",
    ]);
    expect(FILE_TOOL_MOCK).not.toHaveBeenCalled();
    expect((strategy.call as ReturnType<typeof vi.fn>)).toHaveBeenCalledTimes(2);
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

  it("disables real tool execution during the reserved synthesis window", async () => {
    const { executeToolLoop } = await import("../tool-execution-engine.js");
    let callCount = 0;
    const strategy = makeStrategy([]);
    (strategy.call as ReturnType<typeof vi.fn>).mockImplementation(async (messages, options) => {
      callCount++;
      if (callCount === 1) {
        expect(options.tools).toBeDefined();
        expect(options.tools).not.toHaveLength(0);
      } else {
        expect(options.tools).toEqual([]);
      }
      return makeResponse("", [
        makeToolCall(`synthesis-${callCount}`, "read_file", {
          path: `synthesis-${callCount}.ts`,
        }),
      ]);
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
      maxIterations: 3,
      maxToolCalls: 100,
      toolCallsDisabledAfter: 1,
    });

    expect(result.kind).toBe("partial");
    if (result.kind === "partial") {
      expect(result.reason).toBe("empty_response");
      expect(result.result.content).toBe("");
    }
    expect(FILE_TOOL_MOCK).toHaveBeenCalledTimes(1);
    expect(messages.filter((message) => message.role === "tool").map((message) => message.content)).toHaveLength(1);
    expect(messages.find((message) => message.role === "tool")?.content).toContain("file content");
  });

  it("marks a text-bearing soft-limit stop as partial instead of success", async () => {
    const { executeToolLoop } = await import("../tool-execution-engine.js");
    const strategy = makeStrategy([]);
    let callCount = 0;
    (strategy.call as ReturnType<typeof vi.fn>).mockImplementation(async () => {
      callCount++;
      return makeResponse(
        callCount === 3 ? "I still need to continue" : "",
        [makeToolCall(`soft-${callCount}`, "read_file", { path: `file-${callCount}.ts` })],
      );
    });

    const result = await executeToolLoop({
      messages: makeMessages(),
      strategy,
      model: "fast",
      powerModel: "powerful",
      provider: "test",
      tools: [{ type: "function", function: { name: "read_file", description: "", parameters: {} } }],
      rootPath: "/project",
      pendingChanges: [],
      maxIterations: 4,
      maxToolCalls: 100,
    });

    expect(result.kind).toBe("partial");
    if (result.kind === "partial") {
      expect(result.reason).toBe("soft_limit");
      expect(result.result.content).toBe("I still need to continue");
    }
  });

  it("stops task execution at soft limit without a synthesis model call", async () => {
    const { executeToolLoop } = await import("../tool-execution-engine.js");
    const strategy = makeStrategy([]);
    let callCount = 0;
    (strategy.call as ReturnType<typeof vi.fn>).mockImplementation(async () => {
      callCount++;
      return makeResponse(
        "",
        [makeToolCall(`deterministic-soft-${callCount}`, "read_file", { path: `file-${callCount}.ts` })],
      );
    });

    const result = await executeToolLoop({
      messages: makeMessages(),
      strategy,
      model: "fast",
      powerModel: "powerful",
      provider: "test",
      taskType: "task_execution",
      deterministicTaskExecution: true,
      tools: [{ type: "function", function: { name: "read_file", description: "", parameters: {} } }],
      rootPath: "/project",
      pendingChanges: [],
      maxIterations: 4,
      maxToolCalls: 100,
    });

    expect(result.kind).toBe("partial");
    if (result.kind === "partial") {
      expect(result.reason).toBe("soft_limit");
    }
    // Iterations 0, 1, and 2 ran; iteration 3 stopped before another model call.
    expect(callCount).toBe(3);
    expect(strategy.call).not.toHaveBeenCalledWith(
      expect.arrayContaining([
        expect.objectContaining({
          content: expect.stringContaining("You have gathered enough information"),
        }),
      ]),
      expect.anything(),
    );
  });

  it("fails closed for unknown tool names without consuming execution budget", async () => {
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

    expect(result.kind).toBe("failed");
    if (result.kind === "failed") {
      expect(result.diagnosticCode).toBe("TOOL_UNAVAILABLE");
      expect(result.tool).toBe("delete_everything");
    }
    expect(FILE_TOOL_MOCK).not.toHaveBeenCalled();
    const toolMessages = messages.filter((m) => m.role === "tool");
    const errorMsg = toolMessages.find(
      (m) => m.role === "tool" && m.content.includes("did not complete"),
    );
    expect(errorMsg).toBeDefined();
  });

  it("fails closed with a bounded diagnostic when a file tool throws", async () => {
    const { executeToolLoop } = await import("../tool-execution-engine.js");
    FILE_TOOL_MOCK.mockRejectedValueOnce(new Error("/secret/workspace/private.txt leaked"));
    const steps: AgentStep[] = [];
    const messages = makeMessages();
    const result = await executeToolLoop({
      messages,
      strategy: makeStrategy([
        makeResponse("", [makeToolCall("tc1", "read_file", { path: "src/app.ts" })]),
      ]),
      model: "fast",
      powerModel: "powerful",
      provider: "test",
      tools: [{ type: "function", function: { name: "read_file", description: "", parameters: {} } }],
      rootPath: "/project",
      pendingChanges: [],
      onStep: (step) => steps.push(step),
    });

    expect(result.kind).toBe("failed");
    expect(JSON.stringify(messages)).not.toContain("private.txt");
    expect(steps).toContainEqual(expect.objectContaining({
      kind: "diagnostic",
      code: "TOOL_EXECUTION_FAILED",
    }));
    expect(steps).toContainEqual(expect.objectContaining({
      kind: "done",
      stopReason: "tool_failure",
    }));
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

  it("tracks iterationsUntilFirstSourceRead when the loop reads a source (FEG-007/008)", async () => {
    const { executeToolLoop } = await import("../tool-execution-engine.js");
    // Model reads on the FIRST iteration, then synthesizes.
    const strategy = makeStrategy([
      makeResponse("", [makeToolCall("read1", "read_file", { path: "src/executor.ts" })]),
      makeResponse("final answer"),
    ]);
    const steps: AgentStep[] = [];

    const result = await executeToolLoop({
      messages: makeMessages(),
      strategy,
      model: "fast",
      powerModel: "powerful",
      provider: "test",
      tools: [{ type: "function", function: { name: "read_file", description: "", parameters: {} } }],
      rootPath: "/project",
      pendingChanges: [],
      maxIterations: 6,
      onStep: (step) => void steps.push(step),
    });

    expect(result.kind).toBe("response");
    // First read happened on iteration 0; surfaced in telemetry.
    expect(result.sourceRetrieval?.iterationsUntilFirstSourceRead).toBe(0);
    expect(result.sourceRetrieval?.investigationStartSla).toBeUndefined();
    // No approachable-planning failure emitted.
    expect(steps.some((s) => s.kind === "diagnostic" && s.code === "INVESTIGATION_START_FAILURE")).toBe(false);
    expect(steps.some((s) => s.kind === "diagnostic" && s.code === "FORCE_PRIMARY_EVIDENCE_ACTION")).toBe(false);
  });

  it("splits source reads into prefetch/targeted/dependency/duplicate buckets and exposes firstEvidenceAcquired (FEG-015)", async () => {
    const { executeToolLoop } = await import("../tool-execution-engine.js");
    // Iteration 0 reads the primary target; iteration 1 reads a NEW dependency
    // file; iteration 2 re-reads the already-read primary (a duplicate); then
    // the model synthesizes. This exercises every first-evidence bucket.
    const strategy = makeStrategy([
      makeResponse("", [makeToolCall("r1", "read_file", { path: "src/executor.ts" })]),
      makeResponse("", [makeToolCall("r2", "read_file", { path: "src/helper.ts" })]),
      makeResponse("", [makeToolCall("r3", "read_file", { path: "src/executor.ts" })]),
      makeResponse("final answer"),
    ]);
    FILE_TOOL_MOCK.mockImplementation(
      async (_name: unknown, args: { path?: string }) =>
        `// contents of ${args.path ?? "unknown"}\nexport const value = 1;\n`,
    );
    const steps: AgentStep[] = [];

    const result = await executeToolLoop({
      messages: makeMessages(),
      strategy,
      model: "fast",
      powerModel: "powerful",
      provider: "test",
      tools: [{ type: "function", function: { name: "read_file", description: "", parameters: {} } }],
      rootPath: "/project",
      pendingChanges: [],
      maxIterations: 6,
      onStep: (step) => void steps.push(step),
    });

    expect(result.kind).toBe("response");
    const sr = result.sourceRetrieval;
    // The primary read lands on iteration 0: first evidence acquired then.
    expect(sr?.firstEvidenceAcquired).toBe(true);
    expect(sr?.iterationsUntilFirstRead).toBe(0);
    expect(sr?.iterationsWithoutEvidence).toBe(0);
    // After the first read, a NEW path is a dependency read, and re-reading the
    // already-read primary is a duplicate read.
    expect(sr?.uniqueReads).toBe(2);
    expect(sr?.dependencyReads).toBe(1);
    expect(sr?.duplicateReads).toBe(1);
    expect(sr?.prefetchReads).toBe(0);
    expect(sr?.prefetchBeforeFirstRead).toBe(false);
    // No gather tool was used, so no cross-file queries before the first read.
    expect(sr?.crossFileQueriesBeforeFirstRead).toBe(0);
    // Iterations 0 and 1 landed NEW evidence (primary + dependency); the
    // iteration-2 duplicate re-read is NOT new evidence and must be accounted
    // as planning, never as an evidence iteration (FEG-015).
    expect(sr?.evidenceIterations).toBe(2);
    expect(sr?.planningIterations).toBe(1);
  });

  it("classifies a zero-read provider_timeout run and streams sourceRetrieval on the done step (FEG-015)", async () => {
    const { executeToolLoop } = await import("../tool-execution-engine.js");
    // Planning-only run (a gather call, never a source read) whose next model
    // call times out. It must classify as incomplete-before-evidence and the
    // done step must carry the retrieval telemetry, not drop it.
    const timeoutErr = new GroqClientError("TIMEOUT", "Provider request timed out");
    let callCount = 0;
    const strategy: ProviderStrategy = {
      providerId: "test",
      supportsNativeStream: false,
      // Same model for both so the TIMEOUT reaches the partial branch directly
      // (totalToolCalls is already 1 after the search_code call).
      call: vi.fn(async () => {
        callCount++;
        if (callCount === 1) {
          return makeResponse("", [makeToolCall("p1", "search_code", { pattern: "a" })]);
        }
        throw timeoutErr;
      }),
      stream: async function* () { yield ""; },
    };
    FILE_TOOL_MOCK.mockImplementation(async () => "src/match.ts:1: hit");
    const steps: AgentStep[] = [];

    const result = await executeToolLoop({
      messages: makeMessages(),
      strategy,
      model: "same-model",
      powerModel: "same-model",
      provider: "openrouter",
      tools: [{ type: "function", function: { name: "search_code", description: "", parameters: {} } }],
      rootPath: "/project",
      pendingChanges: [],
      onStep: (step) => void steps.push(step),
    });

    expect(result.kind).toBe("partial");
    // Iteration 0 was the gather call; iteration 1 was the timed-out call.
    expect(result.sourceRetrieval?.firstEvidenceAcquired).toBe(false);
    expect(result.sourceRetrieval?.incompleteBeforeEvidence).toBe(true);
    expect(result.sourceRetrieval?.iterationsWithoutEvidence).toBe(2);

    const done = [...steps].reverse().find((step): step is Extract<AgentStep, { kind: "done" }> => step.kind === "done");
    expect(done).toBeDefined();
    expect(done?.stopReason).toBe("provider_timeout");
    expect(done?.sourceRetrieval?.firstEvidenceAcquired).toBe(false);
    expect(done?.sourceRetrieval?.incompleteBeforeEvidence).toBe(true);
    expect(done?.sourceRetrieval?.iterationsWithoutEvidence).toBe(2);
  });

  it("marks firstEvidenceAcquired=false and counts starving iterations on a zero-read run (FEG-015)", async () => {
    const { executeToolLoop } = await import("../tool-execution-engine.js");
    // The model only issues gather calls (no source reads) until the soft limit.
    const searchCalls = Array.from({ length: 12 }, (_, i) =>
      makeResponse("", [makeToolCall(`plan-${i}`, "search_code", { pattern: `needle-${i}` })]),
    );
    FILE_TOOL_MOCK.mockImplementation(
      async (_name: unknown, args: { pattern?: string }) =>
        `src/match-${args.pattern ?? "x"}.ts:1: hit`,
    );
    const strategy = makeStrategy([...searchCalls, makeResponse("final")]);

    const result = await executeToolLoop({
      messages: makeMessages(),
      strategy,
      model: "fast",
      powerModel: "powerful",
      provider: "test",
      tools: [{ type: "function", function: { name: "search_code", description: "", parameters: {} } }],
      rootPath: "/project",
      pendingChanges: [],
      maxIterations: 12,
    });

    const sr = result.sourceRetrieval;
    expect(sr?.firstEvidenceAcquired).toBe(false);
    expect(sr?.iterationsUntilFirstRead).toBeNull();
    expect(sr?.incompleteBeforeEvidence).toBe(true);
    // Every elapsed iteration had no source evidence, and each gather call that
    // happened before any read counts as a cross-file query.
    expect(sr?.iterationsWithoutEvidence).toBeGreaterThan(0);
    expect(sr?.crossFileQueriesBeforeFirstRead).toBeGreaterThan(0);
  });

  it("reports the actual elapsed iteration count on an EARLY zero-read final response, in both the result and the done step (FEG-015)", async () => {
    const { executeToolLoop } = await import("../tool-execution-engine.js");
    // The model does a couple of planning-only turns (no source reads) and then
    // returns a final response well before the budget. Starvation must reflect
    // the iterations that ACTUALLY elapsed, not the full maxIterations budget.
    const strategy = makeStrategy([
      makeResponse("", [makeToolCall("p1", "search_code", { pattern: "a" })]),
      makeResponse("final answer"),
    ]);
    FILE_TOOL_MOCK.mockImplementation(
      async (_name: unknown, args: { pattern?: string }) => `src/match.ts:1: hit`,
    );
    const steps: AgentStep[] = [];

    const result = await executeToolLoop({
      messages: makeMessages(),
      strategy,
      model: "fast",
      powerModel: "powerful",
      provider: "test",
      tools: [{ type: "function", function: { name: "search_code", description: "", parameters: {} } }],
      rootPath: "/project",
      pendingChanges: [],
      maxIterations: 30,
      onStep: (step) => void steps.push(step),
    });

    // The run ended after 2 iterations with zero source reads.
    expect(result.kind).toBe("response");
    const sr = result.sourceRetrieval;
    expect(sr?.firstEvidenceAcquired).toBe(false);
    expect(sr?.incompleteBeforeEvidence).toBe(true);
    expect(sr?.iterationsWithoutEvidence).toBe(2);
    // The configured budget is much larger; we must never report it as the
    // elapsed starvation count.
    expect(sr?.iterationsWithoutEvidence).not.toBe(30);

    // The SSE done step must serialize the SAME classified values, not the
    // pre-classification defaults (budget / 0 / absent inbox fields).
    const done = [...steps].reverse().find((step): step is Extract<AgentStep, { kind: "done" }> => step.kind === "done");
    expect(done).toBeDefined();
    expect(done?.stopReason).toBe("response");
    expect(done?.iterations).toBe(2);
    expect(done?.sourceRetrieval?.firstEvidenceAcquired).toBe(false);
    expect(done?.sourceRetrieval?.incompleteBeforeEvidence).toBe(true);
    expect(done?.sourceRetrieval?.iterationsWithoutEvidence).toBe(2);
  });

  it("counts a truncated read → range-read recovery as evidence, then the next path as a dependency (FEG-015)", async () => {
    const { executeToolLoop } = await import("../tool-execution-engine.js");
    // Iteration 0 reads src/executor.ts whole and it comes back TRUNCATED (no
    // usable source body). Iteration 1 recovers the SAME path via
    // read_file_range, which is its real first successful acquisition — a
    // duplicate of a previous attempt, NOT of completed evidence. Iteration 2
    // then reads a NEW file (helper.ts), which must classify as a dependency
    // because evidence now exists.
    const strategy = makeStrategy([
      makeResponse("", [makeToolCall("r0", "read_file", { path: "src/executor.ts" })]),
      makeResponse("", [makeToolCall("r1", "read_file_range", { path: "src/executor.ts", startLine: "1", endLine: "10" })]),
      makeResponse("", [makeToolCall("r2", "read_file", { path: "src/helper.ts" })]),
      makeResponse("final answer"),
    ]);
    FILE_TOOL_MOCK.mockImplementation(
      async (name: unknown, args: { path?: string }) => {
        if (name === "read_file_range") {
          return `File: ${args.path}\n\`\`\`\nexport const ev = true;\n\`\`\`\n`;
        }
        // The whole-file read comes back truncated (no usable source body).
        if (args.path === "src/executor.ts") {
          return `File: src/executor.ts\n\`\`\`\n[... output truncated\n\`\`\`\n`;
        }
        return `// contents of ${args.path}\nexport const value = 1;\n`;
      },
    );

    const result = await executeToolLoop({
      messages: makeMessages(),
      strategy,
      model: "fast",
      powerModel: "powerful",
      provider: "test",
      tools: [{ type: "function", function: { name: "read_file", description: "", parameters: {} } }],
      rootPath: "/project",
      pendingChanges: [],
      maxIterations: 6,
    });

    expect(result.kind).toBe("response");
    const sr = result.sourceRetrieval;
    expect(sr?.firstEvidenceAcquired).toBe(true);
    expect(sr?.truncatedReads).toBe(1);
    // The range-recovery read is the completed path's first successful read: it
    // is never a duplicate, and it establishes unique evidence.
    expect(sr?.duplicateReads).toBe(0);
    expect(sr?.uniqueReads).toBe(2);
    expect(sr?.readPaths).toContain("src/executor.ts");
    expect(sr?.readPaths).toContain("src/helper.ts");
    // helper.ts is read AFTER evidence existed, so it is a dependency read.
    expect(sr?.dependencyReads).toBe(1);
    expect(sr?.targetedReads).toBe(1);
  });

  it("counts a CACHED usable range read as the path's first evidence after a truncated full read (FEG-015)", async () => {
    const { executeToolLoop, toolCacheKey } = await import("../tool-execution-engine.js");
    // Iteration 0 does a FRESH full read_file of src/executor.ts that comes back
    // TRUNCATED (recording READ_TRUNCATED in readStatusByPath but acquiring no
    // usable source body). Iteration 1 re-issues the recovery window as a
    // read_file_range that HITS the cache with usable content. A prior TRUNCATED
    // attempt is NOT completed evidence, so this cached result is the path's real
    // first acquisition and must count as an evidence iteration (and reset the
    // no-progress streak) — judged by completed-evidence status, not bare map
    // presence of the attempted path.
    const cache = new Map<string, string>();
    cache.set(
      toolCacheKey("read_file_range", { path: "src/executor.ts", startLine: "1", endLine: "10" }),
      `File: src/executor.ts\n\`\`\`\nexport const ev = true;\n\`\`\`\n`,
    );
    const strategy = makeStrategy([
      makeResponse("", [makeToolCall("r0", "read_file", { path: "src/executor.ts" })]),
      makeResponse("", [makeToolCall("r1", "read_file_range", { path: "src/executor.ts", startLine: "1", endLine: "10" })]),
      makeResponse("final answer"),
    ]);
    FILE_TOOL_MOCK.mockImplementation(
      async (_name: unknown, args: { path?: string }) => {
        if (args.path === "src/executor.ts") {
          // Whole-file read comes back truncated (no usable source body).
          return `File: src/executor.ts\n\`\`\`\n[... output truncated\n\`\`\`\n`;
        }
        return `// contents of ${args.path}\nexport const value = 1;\n`;
      },
    );

    const result = await executeToolLoop({
      messages: makeMessages(),
      strategy,
      model: "fast",
      powerModel: "powerful",
      provider: "test",
      tools: [{ type: "function", function: { name: "read_file", description: "", parameters: {} } }],
      rootPath: "/project",
      pendingChanges: [],
      cache,
      maxIterations: 6,
    });

    expect(result.kind).toBe("response");
    const sr = result.sourceRetrieval;
    expect(sr?.firstEvidenceAcquired).toBe(true);
    expect(sr?.iterationsUntilFirstRead).toBe(1);
    expect(sr?.truncatedReads).toBe(1);
    // The cached range-recovery read is the path's first COMPLETED evidence, so
    // it is neither a duplicate nor suppressible by the prior truncated attempt.
    expect(sr?.duplicateReads).toBe(0);
    expect(sr?.uniqueReads).toBe(1);
    expect(sr?.readPaths).toContain("src/executor.ts");
    // Iteration 1 acquired the evidence; it is an evidence iteration, not
    // planning, so the no-progress streak was correctly reset at that point.
    expect(sr?.evidenceIterations).toBe(1);
  });

  it("emits INVESTIGATION_START_FAILURE when the soft limit fires with zero source reads (FEG-007)", async () => {
    const { executeToolLoop } = await import("../tool-execution-engine.js");
    // The model keeps planning via search calls (no source reads at all) for
    // longer than the search-novelty window, so the soft limit (75% of budget
    // = iter 9) fires before any source read. Each search returns distinct
    // output so it stays "new" (avoids premature force-synthesis).
    const searchCalls = Array.from({ length: 12 }, (_, i) =>
      makeResponse("", [makeToolCall(`plan-${i}`, "search_code", { pattern: `needle-${i}` })]),
    );
    FILE_TOOL_MOCK.mockImplementation(
      async (_name: unknown, args: { pattern?: string }) =>
        `src/match-${args.pattern ?? "x"}.ts:1: hit`,
    );
    const strategy = makeStrategy([...searchCalls, makeResponse("final")]);
    const steps: AgentStep[] = [];

    const result = await executeToolLoop({
      messages: makeMessages(),
      strategy,
      model: "fast",
      powerModel: "powerful",
      provider: "test",
      tools: [{ type: "function", function: { name: "search_code", description: "", parameters: {} } }],
      rootPath: "/project",
      pendingChanges: [],
      maxIterations: 12,
      onStep: (step) => void steps.push(step),
    });

    expect(steps.some(
      (s) => s.kind === "diagnostic" && s.code === "INVESTIGATION_START_FAILURE",
    )).toBe(true);
    // Never read a source: telemetry stays null and the SLA classifies failure.
    expect(result.sourceRetrieval?.iterationsUntilFirstSourceRead).toBeNull();
    expect(result.sourceRetrieval?.investigationStartSla).toBe("soft_limit_with_zero_reads");
  });

  it("does NOT zero-read-flag a run whose evidence was usable prefetch crossing the soft limit (FEG-007 prefetch)", async () => {
    const { executeToolLoop } = await import("../tool-execution-engine.js");
    // Same soft-limit-crossing search plan as the zero-read test above, but the
    // run ALREADY acquired usable source evidence via initialFileContents (the
    // eager first-evidence/prefetch path in chat-agent). Prefetch satisfies the
    // investigation-start SLA, so crossing the soft limit here is a normal
    // evidence-bearing run, not INVESTIGATION_START_FAILURE /
    // soft_limit_with_zero_reads.
    const searchCalls = Array.from({ length: 12 }, (_, i) =>
      makeResponse("", [makeToolCall(`plan-${i}`, "search_code", { pattern: `prefetch-${i}` })]),
    );
    FILE_TOOL_MOCK.mockImplementation(
      async (_name: unknown, args: { pattern?: string }) =>
        `src/match-${args.pattern ?? "x"}.ts:1: hit`,
    );
    const strategy = makeStrategy([...searchCalls, makeResponse("final")]);
    const steps: AgentStep[] = [];
    const prefetched = new Map([["src/evidence.ts", "export const ev = true;\n"]]);

    const result = await executeToolLoop({
      messages: makeMessages(),
      strategy,
      model: "fast",
      powerModel: "powerful",
      provider: "test",
      tools: [{ type: "function", function: { name: "search_code", description: "", parameters: {} } }],
      rootPath: "/project",
      pendingChanges: [],
      initialFileContents: prefetched,
      maxIterations: 12,
      onStep: (step) => void steps.push(step),
    });

    // No start-failure diagnostic even though the soft limit fired.
    expect(steps.some(
      (s) => s.kind === "diagnostic" && s.code === "INVESTIGATION_START_FAILURE",
    )).toBe(false);
    // First evidence is recorded as prefetched (pre-loop sentinel), never zero.
    expect(result.sourceRetrieval?.iterationsUntilFirstSourceRead).not.toBeNull();
    expect(result.sourceRetrieval?.investigationStartSla).not.toBe("soft_limit_with_zero_reads");
    // Prefetch-seeded evidence means the run is NOT a zero-read terminal, so it
    // must never be classified INCOMPLETE_BEFORE_EVIDENCE (FEG-010).
    expect(result.sourceRetrieval?.incompleteBeforeEvidence).toBeFalsy();
    expect(steps.some(
      (s) => s.kind === "diagnostic" && s.code === "INCOMPLETE_BEFORE_EVIDENCE",
    )).toBe(false);
  });

  it("forces a first evidence read when cumulative PLANNING consumption hits its allocation with zero reads (FEG-009)", async () => {
    const { executeToolLoop, splitRunBudget } = await import("../tool-execution-engine.js");
    // Each search returns distinct, USABLE output, so every turn makes progress
    // and the FEG-008 consecutive no-progress guard NEVER fires. But cumulative
    // planning spending must still be capped: once the planning allocation is
    // consumed with zero source reads, the protected-evidence guard forces a
    // first read so planning cannot exhaust the evidence budget. A read tool is
    // configured so an evidence route genuinely exists.
    const searchCalls = Array.from({ length: 6 }, (_, i) =>
      makeResponse("", [makeToolCall(`plan-${i}`, "search_code", { pattern: `needle-${i}` })]),
    );
    // Distinct, usable output per search so each turn is NOVEL (avoids the
    // FEG-008 consecutive no-progress force) and only cumulative planning is
    // what trips the protected-evidence guard.
    FILE_TOOL_MOCK.mockImplementation(
      async (_name: unknown, args: { pattern?: string }) =>
        `src/find-${args.pattern ?? "x"}.ts:1: export const hit = true;`,
    );
    const strategy = makeStrategy([
      ...searchCalls,
      makeResponse("", [makeToolCall("read", "read_file", { path: "src/ev.ts" })]),
      makeResponse("final answer"),
    ]);
    const steps: AgentStep[] = [];

    const result = await executeToolLoop({
      messages: makeMessages(),
      strategy,
      model: "fast",
      powerModel: "powerful",
      provider: "test",
      tools: [
        { type: "function", function: { name: "search_code", description: "", parameters: {} } },
        { type: "function", function: { name: "read_file", description: "", parameters: {} } },
      ],
      rootPath: "/project",
      pendingChanges: [],
      maxIterations: 12,
      onStep: (step) => void steps.push(step),
    });

    expect(result.kind).toBe("response");
    // maxIterations 12 -> planning allocation = floor(12*0.4) = 4.
    expect(splitRunBudget(12).planning).toBe(4);
    // Budget split telemetry surfaces the protected allocations.
    expect(result.sourceRetrieval?.budgetAllocation).toEqual({
      planning: 4,
      evidence: 3,
      reasoning: 2,
    });
    // The planning-budget guard forced a first read (distinct from the FEG-008
    // consecutive-streak force: this run made novel progress every turn, so
    // only the protected cumulative-planning allocation could trip the force).
    const forceDiagnostic = steps.find(
      (s): s is Extract<AgentStep, { kind: "diagnostic" }> =>
        s.kind === "diagnostic" && s.code === "FORCE_PRIMARY_EVIDENCE_ACTION",
    );
    expect(forceDiagnostic?.kind).toBe("diagnostic");
    expect(forceDiagnostic?.details?.[0]).toContain("planning budget exhausted");
    expect(result.sourceRetrieval?.progressForced).toBe(true);
    // The forced read actually landed (bounded redirect, not just a flag).
    expect(FILE_TOOL_MOCK).toHaveBeenCalledWith("read_file", { path: "src/ev.ts" }, "/project", []);
    expect(result.sourceRetrieval?.iterationsUntilFirstSourceRead).not.toBeNull();
    // Because a source read landed before the terminal, this is NOT a zero-read
    // INCOMPLETE_BEFORE_EVIDENCE terminal (FEG-010 stays quiet).
    expect(result.sourceRetrieval?.incompleteBeforeEvidence).toBeFalsy();
  });

  it("classifies a zero-read budget-exhaustion run as INCOMPLETE_BEFORE_EVIDENCE (FEG-010)", async () => {
    const { executeToolLoop } = await import("../tool-execution-engine.js");
    // A run that exhausts the iteration budget with ZERO source reads and no
    // evidence route (only a search tool, no read tool, no primary target) never
    // acquires anything to weigh. It must be classified INCOMPLETE_BEFORE_EVIDENCE
    // — flagged as incomplete-before-evidence, not mistaken for a normal terminal.
    const searchCalls = Array.from({ length: 8 }, (_, i) =>
      makeResponse("", [makeToolCall(`plan-${i}`, "search_code", { pattern: `x-${i}` })]),
    );
    FILE_TOOL_MOCK.mockImplementation(
      async (_name: unknown, args: { pattern?: string }) =>
        `src/match-${args.pattern ?? "x"}.ts:1: hit`,
    );
    const strategy = makeStrategy([...searchCalls, makeResponse("final")]);
    const steps: AgentStep[] = [];

    const result = await executeToolLoop({
      messages: makeMessages(),
      strategy,
      model: "fast",
      powerModel: "powerful",
      provider: "test",
      tools: [{ type: "function", function: { name: "search_code", description: "", parameters: {} } }],
      rootPath: "/project",
      pendingChanges: [],
      maxIterations: 5,
      onStep: (step) => void steps.push(step),
    });

    // No source read happened anywhere in the run.
    expect(result.sourceRetrieval?.iterationsUntilFirstSourceRead).toBeNull();
    // The run was classified INCOMPLETE_BEFORE_EVIDENCE...
    expect(result.sourceRetrieval?.incompleteBeforeEvidence).toBe(true);
    expect(steps.some(
      (s) => s.kind === "diagnostic" && s.code === "INCOMPLETE_BEFORE_EVIDENCE",
    )).toBe(true);
    // ...and still reports the investigation-start SLA failure from the soft limit.
    expect(result.sourceRetrieval?.investigationStartSla).toBe("soft_limit_with_zero_reads");
  });


  it("forces primary evidence after two NO_PROGRESS iterations and REJECTS continued planning at dispatch (FEG-008)", async () => {
    const { executeToolLoop } = await import("../tool-execution-engine.js");
    // Two planning iterations issue non-evidence tool calls (git_status), so
    // neither produces NEW_SOURCE_READ/NEW_SYMBOL/NEW_DEPENDENCY/CLAIM_CLOSED.
    // After the second, the guard must FORCE_PRIMARY_EVIDENCE_ACTION and then
    // REJECT a raw (non-cached) third git_status at dispatch — not merely hide
    // it from the provider's tool definitions — so the model cannot resume
    // orbiting around the evidence requirement.
    const strategy = makeStrategy([
      makeResponse("", [makeToolCall("plan-1", "git_status", {})]),
      makeResponse("", [makeToolCall("plan-2", "git_log", {})]),
      makeResponse("", [makeToolCall("plan-3", "git_diff", {})]),
      makeResponse("", [makeToolCall("read", "read_file", { path: "src/executor.ts" })]),
      makeResponse("final answer"),
    ]);
    const steps: AgentStep[] = [];

    const result = await executeToolLoop({
      messages: makeMessages(),
      strategy,
      model: "fast",
      powerModel: "powerful",
      provider: "test",
      tools: [
        { type: "function", function: { name: "git_status", description: "", parameters: {} } },
        { type: "function", function: { name: "git_log", description: "", parameters: {} } },
        { type: "function", function: { name: "git_diff", description: "", parameters: {} } },
        { type: "function", function: { name: "read_file", description: "", parameters: {} } },
      ],
      rootPath: "/project",
      pendingChanges: [],
      maxIterations: 8,
      onStep: (step) => void steps.push(step),
    });

    expect(steps.some(
      (s) => s.kind === "diagnostic" && s.code === "FORCE_PRIMARY_EVIDENCE_ACTION",
    )).toBe(true);
    expect(result.sourceRetrieval?.progressForced).toBe(true);
    // The first two planning calls (git_status, git_log) executed and tripped
    // the guard. The THIRD planning call (git_diff) is a fresh, non-cached call
    // that must be REJECTED at dispatch — so it never reaches executeGitTool.
    // Only git_status + git_log reach the mock, NOT git_diff.
    expect(GIT_TOOL_MOCK).toHaveBeenCalledTimes(2);
    expect(GIT_TOOL_MOCK).not.toHaveBeenCalledWith("git_diff", expect.anything(), expect.anything());
    // The rejected plan-3 call surfaces a "forced-evidence mode" instruction to
    // the model instead of silently dropping it.
    const gitDiffTurn = vi.mocked(strategy.call).mock.calls
      .find(([messages]) => messages.some((m) =>
        String(m.content).includes("Forced-evidence mode")));
    expect(gitDiffTurn).toBeDefined();
    // The forced evidence read still lands afterwards.
    const forceIdx = steps.findIndex(
      (s) => s.kind === "diagnostic" && s.code === "FORCE_PRIMARY_EVIDENCE_ACTION",
    );
    const readResult = steps.slice(forceIdx).find((s) => s.kind === "tool_call" && s.tool === "read_file");
    expect(readResult?.kind).toBe("tool_call");
  });

  it("does not let repeated cached reads of the same path count as evidence (FEG-008)", async () => {
    const { executeToolLoop } = await import("../tool-execution-engine.js");
    // First read is NEW evidence; the two following reads are cached replays of
    // the SAME path, which must NOT reset the no-progress streak. So the guard
    // must still force primary evidence despite the cached duplicates.
    FILE_TOOL_MOCK.mockResolvedValue("export const x = 1;");
    const strategy = makeStrategy([
      makeResponse("", [makeToolCall("r1", "read_file", { path: "src/a.ts" })]),
      makeResponse("", [makeToolCall("r2", "read_file", { path: "src/a.ts" })]),
      makeResponse("", [makeToolCall("r3", "read_file", { path: "src/a.ts" })]),
      makeResponse("", [makeToolCall("read", "read_file", { path: "src/b.ts" })]),
      makeResponse("final answer"),
    ]);
    const steps: AgentStep[] = [];

    const result = await executeToolLoop({
      messages: makeMessages(),
      strategy,
      model: "fast",
      powerModel: "powerful",
      provider: "test",
      tools: [{ type: "function", function: { name: "read_file", description: "", parameters: {} } }],
      rootPath: "/project",
      pendingChanges: [],
      maxIterations: 8,
      onStep: (step) => void steps.push(step),
    });

    expect(result.sourceRetrieval?.progressForced).toBe(true);
    expect(steps.some(
      (s) => s.kind === "diagnostic" && s.code === "FORCE_PRIMARY_EVIDENCE_ACTION",
    )).toBe(true);
  });

  it("does NOT gate a read when dependency proof is not required (no-op path)", async () => {
    const { executeToolLoop } = await import("../tool-execution-engine.js");
    // requireDependencyProof defaults to false. A planner may read several new
    // files without proof and nothing is blocked.
    FILE_TOOL_MOCK.mockResolvedValue("export const x = 1;");
    const strategy = makeStrategy([
      makeResponse("", [makeToolCall("r1", "read_file", { path: "src/a.ts" })]),
      makeResponse("", [makeToolCall("r2", "read_file", { path: "src/b.ts" })]),
      makeResponse("final answer"),
    ]);
    const steps: AgentStep[] = [];

    const result = await executeToolLoop({
      messages: makeMessages(),
      strategy,
      model: "fast",
      powerModel: "powerful",
      provider: "test",
      tools: [{ type: "function", function: { name: "read_file", description: "", parameters: {} } }],
      rootPath: "/project",
      pendingChanges: [],
      maxIterations: 8,
      onStep: (step) => void steps.push(step),
    });

    expect(result.kind).toBe("response");
    expect(FILE_TOOL_MOCK).toHaveBeenCalledWith("read_file", { path: "src/a.ts" }, "/project", []);
    expect(FILE_TOOL_MOCK).toHaveBeenCalledWith("read_file", { path: "src/b.ts" }, "/project", []);
    expect(steps.some((s) => s.kind === "diagnostic" && s.code === "READ_BLOCKED_NO_DEPENDENCY_PROOF")).toBe(false);
  });

  it("does NOT gate the very FIRST source read even when dependency proof is required (FEG-005/006)", async () => {
    const { executeToolLoop } = await import("../tool-execution-engine.js");
    FILE_TOOL_MOCK.mockResolvedValue("export const x = 1;");
    const strategy = makeStrategy([
      makeResponse("", [makeToolCall("r1", "read_file", { path: "src/primary.ts" })]),
      makeResponse("final answer"),
    ]);
    const steps: AgentStep[] = [];

    const result = await executeToolLoop({
      messages: makeMessages(),
      strategy,
      model: "fast",
      powerModel: "powerful",
      provider: "test",
      tools: [{ type: "function", function: { name: "read_file", description: "", parameters: {} } }],
      rootPath: "/project",
      pendingChanges: [],
      maxIterations: 8,
      requireDependencyProof: true,
      firstEvidenceTargetPath: "src/primary.ts",
      onStep: (step) => void steps.push(step),
    });

    expect(result.kind).toBe("response");
    // The first read reached the mock — it was NOT blocked even though proof is required.
    expect(FILE_TOOL_MOCK).toHaveBeenCalledWith("read_file", { path: "src/primary.ts" }, "/project", []);
    expect(
      steps.filter((s) => s.kind === "diagnostic" && s.code === "READ_BLOCKED_NO_DEPENDENCY_PROOF").length,
    ).toBe(0);
    expect(result.sourceRetrieval?.iterationsUntilFirstSourceRead).toBe(0);
  });

  it("BLOCKS an unproven read of a NEW dependency file after the first read and reports READ_BLOCKED_NO_DEPENDENCY_PROOF (FEG-005/006)", async () => {
    const { executeToolLoop } = await import("../tool-execution-engine.js");
    FILE_TOOL_MOCK.mockResolvedValue("export const x = 1;");
    // r1 reads the primary. r2 then tries to read a DIFFERENT file (a new
    // dependency) WITHOUT carrying proof — that must be rejected at dispatch.
    const strategy = makeStrategy([
      makeResponse("", [makeToolCall("r1", "read_file", { path: "src/primary.ts" })]),
      makeResponse("", [makeToolCall("r2", "read_file", { path: "src/dep.ts" })]),
      makeResponse("final answer"),
    ]);
    const steps: AgentStep[] = [];

    const result = await executeToolLoop({
      messages: makeMessages(),
      strategy,
      model: "fast",
      powerModel: "powerful",
      provider: "test",
      tools: [{ type: "function", function: { name: "read_file", description: "", parameters: {} } }],
      rootPath: "/project",
      pendingChanges: [],
      maxIterations: 8,
      requireDependencyProof: true,
      firstEvidenceTargetPath: "src/primary.ts",
      onStep: (step) => void steps.push(step),
    });

    expect(result.kind).toBe("response");
    // The FIRST read (primary) ran; the SECOND (dep without proof) did NOT.
    expect(FILE_TOOL_MOCK).toHaveBeenCalledTimes(1);
    expect(FILE_TOOL_MOCK).not.toHaveBeenCalledWith("read_file", { path: "src/dep.ts" }, "/project", []);
    // The gate surfaced the diagnostic — the block was reported, not silent.
    expect(
      steps.filter((s) => s.kind === "diagnostic" && s.code === "READ_BLOCKED_NO_DEPENDENCY_PROOF").length,
    ).toBe(1);
  });

  it("ALLOWS a subsequent read whose dependency proof is grounded in acquired evidence (FEG-005/006)", async () => {
    const { executeToolLoop } = await import("../tool-execution-engine.js");
    // The primary file's content actually references the dependency via an
    // import line, so a proof citing that exact line is grounded in evidence.
    FILE_TOOL_MOCK.mockImplementation(
      async (_name: unknown, args: { path?: string }) => {
        const p = typeof args.path === "string" ? args.path : "";
        if (p === "src/primary.ts") {
          return "import { run } from './dep';\nexport const answer = run();";
        }
        return "export const dep = 1;";
      },
    );
    const strategy = makeStrategy([
      makeResponse("", [makeToolCall("r1", "read_file", { path: "src/primary.ts" })]),
      makeResponse("", [makeToolCall("r2", "read_file", {
        path: "src/dep.ts",
        from_file: "src/primary.ts",
        from_symbol: "run",
        reference: "import { run } from './dep'",
        why_required: "verify how run's dependency is defined",
      })]),
      makeResponse("final answer"),
    ]);
    const steps: AgentStep[] = [];

    const result = await executeToolLoop({
      messages: makeMessages(),
      strategy,
      model: "fast",
      powerModel: "powerful",
      provider: "test",
      tools: [{ type: "function", function: { name: "read_file", description: "", parameters: {} } }],
      rootPath: "/project",
      pendingChanges: [],
      maxIterations: 8,
      requireDependencyProof: true,
      firstEvidenceTargetPath: "src/primary.ts",
      onStep: (step) => void steps.push(step),
    });

    expect(result.kind).toBe("response");
    // The proof-carrying dependency read reached the mock, and both reads ran.
    expect(FILE_TOOL_MOCK).toHaveBeenCalledTimes(2);
    expect(FILE_TOOL_MOCK).toHaveBeenCalledWith(
      "read_file",
      expect.objectContaining({ path: "src/dep.ts", from_file: "src/primary.ts" }),
      "/project",
      [],
    );
    expect(
      steps.filter((s) => s.kind === "diagnostic" && s.code === "READ_BLOCKED_NO_DEPENDENCY_PROOF").length,
    ).toBe(0);
  });

  it("BLOCKS a proof whose from_file was never successfully read (fabricated provenance) (FEG-005/006)", async () => {
    const { executeToolLoop } = await import("../tool-execution-engine.js");
    const primaryBody = "export const answer = compute();";
    FILE_TOOL_MOCK.mockImplementation(
      async (_name: unknown, args: { path?: string }) => {
        const p = typeof args.path === "string" ? args.path : "";
        if (p === "src/primary.ts") return primaryBody;
        return "export const dep = 1;";
      },
    );
    // The model supplies a full "proof" but from_file points at a file it never
    // read this run — the reference is fabricated, so the dependency read must
    // still be BLOCKED even though all four strings are syntactically present.
    const strategy = makeStrategy([
      makeResponse("", [makeToolCall("r1", "read_file", { path: "src/primary.ts" })]),
      makeResponse("", [makeToolCall("r2", "read_file", {
        path: "src/dep.ts",
        from_file: "src/never_read.ts",
        from_symbol: "compute",
        reference: "import { run } from './never_read'",
        why_required: "verify compute",
      })]),
      makeResponse("final answer"),
    ]);
    const steps: AgentStep[] = [];

    const result = await executeToolLoop({
      messages: makeMessages(),
      strategy,
      model: "fast",
      powerModel: "powerful",
      provider: "test",
      tools: [{ type: "function", function: { name: "read_file", description: "", parameters: {} } }],
      rootPath: "/project",
      pendingChanges: [],
      maxIterations: 8,
      requireDependencyProof: true,
      firstEvidenceTargetPath: "src/primary.ts",
      onStep: (step) => void steps.push(step),
    });

    expect(result.kind).toBe("response");
    expect(FILE_TOOL_MOCK).toHaveBeenCalledTimes(1); // only primary; dep blocked
    expect(FILE_TOOL_MOCK).not.toHaveBeenCalledWith("read_file", expect.objectContaining({ path: "src/dep.ts" }), "/project", []);
    expect(
      steps.filter((s) => s.kind === "diagnostic" && s.code === "READ_BLOCKED_NO_DEPENDENCY_PROOF").length,
    ).toBe(1);
  });

  it("BLOCKS a proof whose reference does not occur in the from_file's retained evidence (FEG-005/006)", async () => {
    const { executeToolLoop } = await import("../tool-execution-engine.js");
    // primary is read, but its content does NOT contain the claimed reference line.
    FILE_TOOL_MOCK.mockImplementation(
      async (_name: unknown, args: { path?: string }) => {
        const p = typeof args.path === "string" ? args.path : "";
        if (p === "src/primary.ts") return "export const answer = compute();";
        return "export const dep = 1;";
      },
    );
    const strategy = makeStrategy([
      makeResponse("", [makeToolCall("r1", "read_file", { path: "src/primary.ts" })]),
      makeResponse("", [makeToolCall("r2", "read_file", {
        path: "src/dep.ts",
        from_file: "src/primary.ts",
        from_symbol: "run",
        reference: "import { run } from './dep'",
        why_required: "verify run",
      })]),
      makeResponse("final answer"),
    ]);
    const steps: AgentStep[] = [];

    const result = await executeToolLoop({
      messages: makeMessages(),
      strategy,
      model: "fast",
      powerModel: "powerful",
      provider: "test",
      tools: [{ type: "function", function: { name: "read_file", description: "", parameters: {} } }],
      rootPath: "/project",
      pendingChanges: [],
      maxIterations: 8,
      requireDependencyProof: true,
      firstEvidenceTargetPath: "src/primary.ts",
      onStep: (step) => void steps.push(step),
    });

    expect(result.kind).toBe("response");
    expect(FILE_TOOL_MOCK).toHaveBeenCalledTimes(1); // dep blocked despite valid from_file
    expect(
      steps.filter((s) => s.kind === "diagnostic" && s.code === "READ_BLOCKED_NO_DEPENDENCY_PROOF").length,
    ).toBe(1);
  });

  it("applies the grounded proof gate to read_file_range dependency reads (FEG-005/006)", async () => {
    const { executeToolLoop } = await import("../tool-execution-engine.js");
    // r1 reads primary via read_file_range and its output DOES contain the
    // import line. r2 then requests a NEW dependency via read_file_range WITHOUT
    // proof — must be blocked. r3 requests it WITH evidence-grounded proof — must
    // be allowed.
    FILE_TOOL_MOCK.mockImplementation(
      async (_name: unknown, args: { path?: string }) => {
        const p = typeof args.path === "string" ? args.path : "";
        if (p === "src/primary.ts") {
          return "import { run } from './dep';\nexport const answer = run();";
        }
        return "export const dep = 1;";
      },
    );
    const strategy = makeStrategy([
      makeResponse("", [makeToolCall("r1", "read_file_range", { path: "src/primary.ts", start: "1", end: "20" })]),
      // unproven range read of a NEW path — blocked
      makeResponse("", [makeToolCall("r2", "read_file_range", { path: "src/dep.ts", start: "1", end: "5" })]),
      // evidence-grounded range read of the same NEW path — allowed
      makeResponse("", [makeToolCall("r3", "read_file_range", {
        path: "src/dep.ts",
        start: "1",
        end: "5",
        from_file: "src/primary.ts",
        from_symbol: "run",
        reference: "import { run } from './dep'",
        why_required: "verify run",
      })]),
      makeResponse("final answer"),
    ]);
    const steps: AgentStep[] = [];

    const result = await executeToolLoop({
      messages: makeMessages(),
      strategy,
      model: "fast",
      powerModel: "powerful",
      provider: "test",
      tools: [{ type: "function", function: { name: "read_file_range", description: "", parameters: {} } }],
      rootPath: "/project",
      pendingChanges: [],
      maxIterations: 12,
      requireDependencyProof: true,
      firstEvidenceTargetPath: "src/primary.ts",
      onStep: (step) => void steps.push(step),
    });

    expect(result.kind).toBe("response");
    // r1 (primary) and r3 (grounded dep) execute; r2 (unproven dep) is blocked.
    expect(FILE_TOOL_MOCK).toHaveBeenCalledTimes(2);
    expect(
      steps.filter((s) => s.kind === "diagnostic" && s.code === "READ_BLOCKED_NO_DEPENDENCY_PROOF").length,
    ).toBe(1);
  });

  it("grounds from_file through a normalized-path alias of an actually-read file (FEG-005/006)", async () => {
    const { executeToolLoop } = await import("../tool-execution-engine.js");
    FILE_TOOL_MOCK.mockImplementation(
      async (_name: unknown, args: { path?: string }) => {
      const p = typeof args.path === "string" ? args.path : "";
      if (p === "src/primary.ts" || p === "./src/primary.ts") {
        return "import { run } from './dep';\nexport const answer = run();";
      }
      return "export const dep = 1;";
    });
    const strategy = makeStrategy([
      makeResponse("", [makeToolCall("r1", "read_file", { path: "src/primary.ts" })]),
      // from_file uses a "./"-prefixed alias of the read path; canonicalization
      // must still ground it in the retained evidence.
      makeResponse("", [makeToolCall("r2", "read_file", {
        path: "src/dep.ts",
        from_file: "./src/primary.ts",
        from_symbol: "run",
        reference: "import { run } from './dep'",
        why_required: "verify run",
      })]),
      makeResponse("final answer"),
    ]);
    const steps: AgentStep[] = [];

    const result = await executeToolLoop({
      messages: makeMessages(),
      strategy,
      model: "fast",
      powerModel: "powerful",
      provider: "test",
      tools: [{ type: "function", function: { name: "read_file", description: "", parameters: {} } }],
      rootPath: "/project",
      pendingChanges: [],
      maxIterations: 8,
      requireDependencyProof: true,
      firstEvidenceTargetPath: "src/primary.ts",
      onStep: (step) => void steps.push(step),
    });

    expect(result.kind).toBe("response");
    // The alias-grounded dependency read was allowed.
    expect(FILE_TOOL_MOCK).toHaveBeenCalledWith(
      "read_file",
      expect.objectContaining({ path: "src/dep.ts" }),
      "/project",
      [],
    );
    expect(
      steps.filter((s) => s.kind === "diagnostic" && s.code === "READ_BLOCKED_NO_DEPENDENCY_PROOF").length,
    ).toBe(0);
  });

  it("does not let a FAILED source read clear the force or count as progress (FEG-008)", async () => {
    const { executeToolLoop } = await import("../tool-execution-engine.js");
    // Two NO_PROGRESS git calls trip the force. Then a read_file that resolves
    // to an ERROR body must NOT satisfy the mandate: it must neither clear
    // forced-evidence mode nor set first-read telemetry, so a subsequently
    // orbiting git call is still rejected at dispatch.
    FILE_TOOL_MOCK.mockImplementation(
      async (_name: string, args?: { path?: string }) =>
        String(args?.path).includes("missing") ? "Error: no such file" : "file output",
    );
    const strategy = makeStrategy([
      makeResponse("", [makeToolCall("p1", "git_status", {})]),
      makeResponse("", [makeToolCall("p2", "git_log", {})]),
      makeResponse("", [makeToolCall("bad", "read_file", { path: "src/missing.ts" })]),
      makeResponse("", [makeToolCall("p3", "git_diff", {})]),
      makeResponse("", [makeToolCall("read", "read_file", { path: "src/executor.ts" })]),
      makeResponse("final answer"),
    ]);
    const steps: AgentStep[] = [];

    const result = await executeToolLoop({
      messages: makeMessages(),
      strategy,
      model: "fast",
      powerModel: "powerful",
      provider: "test",
      tools: [
        { type: "function", function: { name: "git_status", description: "", parameters: {} } },
        { type: "function", function: { name: "git_log", description: "", parameters: {} } },
        { type: "function", function: { name: "git_diff", description: "", parameters: {} } },
        { type: "function", function: { name: "read_file", description: "", parameters: {} } },
      ],
      rootPath: "/project",
      pendingChanges: [],
      maxIterations: 8,
      onStep: (step) => void steps.push(step),
    });

    expect(steps.some(
      (s) => s.kind === "diagnostic" && s.code === "FORCE_PRIMARY_EVIDENCE_ACTION",
    )).toBe(true);
    // The failed read did not clear the force: the git_diff after it is still
    // rejected, so only p1+p2 reach the git mock (p3 is blocked).
    expect(GIT_TOOL_MOCK).toHaveBeenCalledTimes(2);
    // The failed read did not set first-read telemetry. The failed read runs at
    // iteration 2; only the successful src/executor.ts read (iteration 4)
    // records the first source read, so iterationsUntilFirstSourceRead is >= 4
    // and is never the failed read's iteration.
    expect(result.sourceRetrieval?.iterationsUntilFirstSourceRead).toBeGreaterThanOrEqual(4);
  });

  it("clears forced mode when a permitted CACHED read satisfies the mandate (FEG-008)", async () => {
    const { executeToolLoop } = await import("../tool-execution-engine.js");
    // r1 reads the target fresh (cache hit on a later replay). After two
    // NO_PROGRESS git calls trip the force, a replayed (cached) read of the
    // same path must clear forced-evidence mode — so a following git call is
    // NOT rejected.
    const strategy = makeStrategy([
      makeResponse("", [makeToolCall("r1", "read_file", { path: "src/executor.ts" })]),
      makeResponse("", [makeToolCall("p1", "git_status", {})]),
      makeResponse("", [makeToolCall("p2", "git_log", {})]),
      makeResponse("", [makeToolCall("r2", "read_file", { path: "src/executor.ts" })]),
      makeResponse("", [makeToolCall("p3", "git_diff", {})]),
      makeResponse("final answer"),
    ]);
    const steps: AgentStep[] = [];

    const result = await executeToolLoop({
      messages: makeMessages(),
      strategy,
      model: "fast",
      powerModel: "powerful",
      provider: "test",
      tools: [
        { type: "function", function: { name: "git_status", description: "", parameters: {} } },
        { type: "function", function: { name: "git_log", description: "", parameters: {} } },
        { type: "function", function: { name: "git_diff", description: "", parameters: {} } },
        { type: "function", function: { name: "read_file", description: "", parameters: {} } },
      ],
      rootPath: "/project",
      pendingChanges: [],
      maxIterations: 8,
      onStep: (step) => void steps.push(step),
    });

    expect(steps.some(
      (s) => s.kind === "diagnostic" && s.code === "FORCE_PRIMARY_EVIDENCE_ACTION",
    )).toBe(true);
    // The cached permitted read cleared the force, so p3 (git_diff) executes.
    expect(GIT_TOOL_MOCK).toHaveBeenCalledTimes(3);
    // The cached read is recorded as a cached read, and the run progressed.
    expect(result.sourceRetrieval?.cachedReads).toBeGreaterThanOrEqual(1);
  });

  it("re-forces primary evidence after a CACHED read clears forced mode (reusable cached force lifecycle, FEG-008)", async () => {
    const { executeToolLoop } = await import("../tool-execution-engine.js");
    // The cached-read force-clear must ALSO re-arm the one-run fire latch, not
    // just the fresh-read path. Sequence:
    //   r1     read executor.ts fresh (cache it)
    //   p1,p2  git (NO_PROGRESS x2)            → force #1
    //   c1     replayed (CACHED) read target   → clears force (and re-arms)
    //   p3,p4  git (NO_PROGRESS x2)            → force #2
    //   p5     git_status (should be REJECTED)
    //   r2     read other.ts fresh             → clears force again
    FILE_TOOL_MOCK.mockResolvedValue("export const x = 1;");
    const strategy = makeStrategy([
      makeResponse("", [makeToolCall("r1", "read_file", { path: "src/executor.ts" })]),
      makeResponse("", [makeToolCall("p1", "git_status", {})]),
      makeResponse("", [makeToolCall("p2", "git_log", { branch: "a" })]),
      makeResponse("", [makeToolCall("c1", "read_file", { path: "src/executor.ts" })]),
      makeResponse("", [makeToolCall("p3", "git_diff", { file: "x.ts" })]),
      makeResponse("", [makeToolCall("p4", "git_diff", { file: "y.ts" })]),
      makeResponse("", [makeToolCall("p5", "git_status", {})]),
      makeResponse("", [makeToolCall("r2", "read_file", { path: "src/other.ts" })]),
      makeResponse("final answer"),
    ]);
    const steps: AgentStep[] = [];

    const result = await executeToolLoop({
      messages: makeMessages(),
      strategy,
      model: "fast",
      powerModel: "powerful",
      provider: "test",
      tools: [
        { type: "function", function: { name: "git_status", description: "", parameters: {} } },
        { type: "function", function: { name: "git_log", description: "", parameters: {} } },
        { type: "function", function: { name: "git_diff", description: "", parameters: {} } },
        { type: "function", function: { name: "read_file", description: "", parameters: {} } },
      ],
      rootPath: "/project",
      pendingChanges: [],
      maxIterations: 10,
      onStep: (step) => void steps.push(step),
    });

    // Force fired at least twice after the cached clear re-armed the latch.
    const forceCodes = steps.filter(
      (s) => s.kind === "diagnostic" && s.code === "FORCE_PRIMARY_EVIDENCE_ACTION",
    );
    expect(forceCodes.length).toBeGreaterThanOrEqual(2);
    // Only the four pre-rejection planning calls (p1..p4) reached the git mock;
    // p5 was rejected at dispatch after the second (re-entered) forced state.
    expect(GIT_TOOL_MOCK).toHaveBeenCalledTimes(4);
    expect(result.sourceRetrieval?.cachedReads).toBeGreaterThanOrEqual(1);
    expect(result.sourceRetrieval?.progressForced).toBe(true);
  });

  it("does not let a range read with No-content/empty window clear the force or count as progress (FEG-008)", async () => {
    const { executeToolLoop } = await import("../tool-execution-engine.js");
    // Two NO_PROGRESS git calls trip the force. A read_file_range that comes
    // back with an out-of-range "No content in lines …" answer — a NON-error but
    // evidence-less result — must NOT satisfy the mandate: it must neither clear
    // forced-evidence mode nor set first-read telemetry, so a subsequently
    // orbiting git call is still rejected.
    FILE_TOOL_MOCK.mockImplementation(
      async (name: string, args?: { path?: string }) =>
        name === "read_file_range"
          ? `No content in lines 1-5 of "${args?.path}" (file has 2 lines).`
          : "file output",
    );
    const strategy = makeStrategy([
      makeResponse("", [makeToolCall("p1", "git_status", {})]),
      makeResponse("", [makeToolCall("p2", "git_log", {})]),
      makeResponse("", [makeToolCall("bad", "read_file_range", { path: "src/a.ts", startLine: "1", endLine: "5" })]),
      makeResponse("", [makeToolCall("p3", "git_diff", {})]),
      makeResponse("", [makeToolCall("read", "read_file", { path: "src/executor.ts" })]),
      makeResponse("final answer"),
    ]);
    const steps: AgentStep[] = [];

    const result = await executeToolLoop({
      messages: makeMessages(),
      strategy,
      model: "fast",
      powerModel: "powerful",
      provider: "test",
      tools: [
        { type: "function", function: { name: "git_status", description: "", parameters: {} } },
        { type: "function", function: { name: "git_log", description: "", parameters: {} } },
        { type: "function", function: { name: "git_diff", description: "", parameters: {} } },
        { type: "function", function: { name: "read_file_range", description: "", parameters: {} } },
        { type: "function", function: { name: "read_file", description: "", parameters: {} } },
      ],
      rootPath: "/project",
      pendingChanges: [],
      maxIterations: 8,
      onStep: (step) => void steps.push(step),
    });

    // The empty-window range result did not clear the force: the git_diff after
    // it is still rejected at dispatch, so only p1+p2 reach the git mock.
    expect(GIT_TOOL_MOCK).toHaveBeenCalledTimes(2);
    expect(steps.some(
      (s) => s.kind === "diagnostic" && s.code === "FORCE_PRIMARY_EVIDENCE_ACTION",
    )).toBe(true);
    // The empty-window range result did not set first-read telemetry; the later
    // successful full read of src/executor.ts is the one that records it.
    expect(result.sourceRetrieval?.iterationsUntilFirstSourceRead).toBeGreaterThanOrEqual(4);
  });

  it("counts a valid non-target read as FIRST source read, independent of the forced-target (FEG-008)", async () => {
    const { executeToolLoop } = await import("../tool-execution-engine.js");
    // When a primary evidence target is named, a successful read of a DIFFERENT
    // valid permitted path is still real source acquisition: it must set
    // first-read telemetry and count as progress. First-read accounting is NOT
    // coupled to the stricter forced-target dispatch predicate.
    FILE_TOOL_MOCK.mockImplementation(async (name: string, args?: { path?: string }) =>
      name === "read_file" ? "export const x = 1;" : "file output");
    const strategy = makeStrategy([
      makeResponse("", [makeToolCall("r", "read_file", { path: "src/other.ts" })]),
      makeResponse("final answer"),
    ]);
    const steps: AgentStep[] = [];

    const result = await executeToolLoop({
      messages: makeMessages(),
      strategy,
      model: "fast",
      powerModel: "powerful",
      provider: "test",
      tools: [{ type: "function", function: { name: "read_file", description: "", parameters: {} } }],
      rootPath: "/project",
      pendingChanges: [],
      maxIterations: 6,
      firstEvidenceTargetPath: "src/target.ts",
      onStep: (step) => void steps.push(step),
    });

    // The read of src/other.ts is a valid permitted source read, so first-read
    // telemetry records iteration 0 even though the named target was different.
    expect(result.sourceRetrieval?.iterationsUntilFirstSourceRead).toBe(0);
    // No FEG-007 start failure, no forced progress.
    expect(result.sourceRetrieval?.investigationStartSla).toBeUndefined();
    expect(result.sourceRetrieval?.progressForced).toBe(false);
  });

  it("re-forces primary evidence after an intervening successful read (reusable force lifecycle, FEG-008)", async () => {
    const { executeToolLoop } = await import("../tool-execution-engine.js");
    // The force must NOT be one-shot: after a successful read clears forced
    // mode, a NEW pair of no-progress planning iterations must re-enter
    // dispatch-enforced forced mode and again reject a following out-of-set
    // call. Sequence:
    //   p1,p2 git (NO_PROGRESS x2)         → force #1
    //   r1   read executor.ts (success)    → clears force
    //   p3,p4 git (NO_PROGRESS x2)         → force #2
    //   p5   git_status (should be REJECTED)
    //   r2   read other.ts (success)       → clears force
    FILE_TOOL_MOCK.mockResolvedValue("export const x = 1;");
    const strategy = makeStrategy([
      makeResponse("", [makeToolCall("p1", "git_status", {})]),
      makeResponse("", [makeToolCall("p2", "git_log", { branch: "a" })]),
      makeResponse("", [makeToolCall("r1", "read_file", { path: "src/executor.ts" })]),
      makeResponse("", [makeToolCall("p3", "git_diff", { file: "x.ts" })]),
      makeResponse("", [makeToolCall("p4", "git_diff", { file: "y.ts" })]),
      makeResponse("", [makeToolCall("p5", "git_status", {})]),
      makeResponse("", [makeToolCall("r2", "read_file", { path: "src/other.ts" })]),
      makeResponse("final answer"),
    ]);
    const steps: AgentStep[] = [];

    const result = await executeToolLoop({
      messages: makeMessages(),
      strategy,
      model: "fast",
      powerModel: "powerful",
      provider: "test",
      tools: [
        { type: "function", function: { name: "git_status", description: "", parameters: {} } },
        { type: "function", function: { name: "git_log", description: "", parameters: {} } },
        { type: "function", function: { name: "git_diff", description: "", parameters: {} } },
        { type: "function", function: { name: "read_file", description: "", parameters: {} } },
      ],
      rootPath: "/project",
      pendingChanges: [],
      maxIterations: 10,
      onStep: (step) => void steps.push(step),
    });

    // Force fired at least twice (initial pair + re-entered pair).
    const forceCodes = steps.filter(
      (s) => s.kind === "diagnostic" && s.code === "FORCE_PRIMARY_EVIDENCE_ACTION",
    );
    expect(forceCodes.length).toBeGreaterThanOrEqual(2);
    // Only the four pre-rejection planning calls reached the git mock; the p5
    // re-forced call was rejected at dispatch.
    expect(GIT_TOOL_MOCK).toHaveBeenCalledTimes(4);
    // Telemetry reflects the guard (progressForced true) after re-entry.
    expect(result.sourceRetrieval?.progressForced).toBe(true);
  });
});

describe("bounded synthesis budget", () => {
  it("enforces a real bounded synthesis timeout and preserves operator telemetry", async () => {
    const { executeToolLoop } = await import("../tool-execution-engine.js");
    const steps: AgentStep[] = [];
    const strategy: ProviderStrategy = {
      providerId: "test",
      supportsNativeStream: false,
      call: vi.fn((_messages, options) =>
        new Promise<RawGroqResponse>((_resolve, reject) => {
          options.signal?.addEventListener("abort", () => {
            reject(new GroqClientError("TIMEOUT", "bounded synthesis timeout"));
          }, { once: true });
        }),
      ),
      stream: async function* () { yield ""; },
    };

    const result = await executeToolLoop({
      messages: makeMessages(),
      strategy,
      model: "fast",
      powerModel: "fast",
      provider: "test",
      tools: undefined,
      rootPath: "",
      pendingChanges: [],
      maxIterations: 1,
      toolCallsDisabledAfter: 0,
      synthesisTimeoutMs: 1_000,
      synthesisMaxAttempts: 1,
      onStep: (step) => steps.push(step),
    });

    expect(result.kind).toBe("partial");
    if (result.kind === "partial") {
      expect(result.reason).toBe("provider_timeout");
      expect(result.sourceRetrieval).toMatchObject({
        synthesisAttempts: 1,
        synthesisMaxAttempts: 1,
        synthesisTimeoutMs: 1_000,
        synthesisTimedOut: true,
      });
    }
    expect(strategy.call).toHaveBeenCalledTimes(1);
    expect(steps).toEqual(expect.arrayContaining([
      expect.objectContaining({
        kind: "done",
        stopReason: "provider_timeout",
        synthesisAttempts: 1,
        synthesisMaxAttempts: 1,
        synthesisTimeoutMs: 1_000,
        synthesisTimedOut: true,
      }),
    ]));
  });

  it("keeps synthesis fallback within its independent attempt budget", async () => {
    const { executeToolLoop } = await import("../tool-execution-engine.js");
    const strategy = makeStrategy([]);
    (strategy.call as ReturnType<typeof vi.fn>)
      .mockRejectedValueOnce(new GroqClientError("TIMEOUT", "fixture synthesis timeout"))
      .mockResolvedValueOnce(makeResponse("fallback report"));

    const result = await executeToolLoop({
      messages: makeMessages(),
      strategy,
      model: "fast",
      powerModel: "powerful",
      provider: "test",
      tools: undefined,
      rootPath: "",
      pendingChanges: [],
      maxIterations: 1,
      toolCallsDisabledAfter: 0,
      synthesisTimeoutMs: 5_000,
      synthesisMaxAttempts: 2,
    });

    expect(result.kind).toBe("response");
    if (result.kind === "response") {
      expect(result.result.content).toBe("fallback report");
      expect(result.sourceRetrieval?.synthesisAttempts).toBe(2);
      expect(result.sourceRetrieval?.synthesisMaxAttempts).toBe(2);
      expect(result.sourceRetrieval?.synthesisTimeoutMs).toBe(5_000);
    }
    expect(strategy.call).toHaveBeenCalledTimes(2);
    expect((strategy.call as ReturnType<typeof vi.fn>).mock.calls[0]?.[1]).toMatchObject({
      timeoutMs: 5_000,
    });
    expect((strategy.call as ReturnType<typeof vi.fn>).mock.calls[0]?.[1].signal).toBeInstanceOf(
      AbortSignal,
    );
  });

  it("does not retry synthesis after the shared deadline is exhausted", async () => {
    const { executeToolLoop } = await import("../tool-execution-engine.js");
    const strategy = makeStrategy([]);
    (strategy.call as ReturnType<typeof vi.fn>).mockRejectedValue(
      new GroqClientError("TIMEOUT", "fixture synthesis timeout"),
    );

    const result = await executeToolLoop({
      messages: makeMessages(),
      strategy,
      model: "fast",
      powerModel: "powerful",
      provider: "test",
      tools: undefined,
      rootPath: "",
      pendingChanges: [],
      maxIterations: 1,
      toolCallsDisabledAfter: 0,
      synthesisTimeoutMs: 1_000,
      synthesisMaxAttempts: 1,
    });

    expect(result.kind).toBe("partial");
    expect(strategy.call).toHaveBeenCalledTimes(1);
    if (result.kind === "partial") {
      expect(result.sourceRetrieval?.synthesisAttempts).toBe(1);
      expect(result.sourceRetrieval?.synthesisMaxAttempts).toBe(1);
    }
  });
});

// ── TIMEOUT → kind:"partial"/"provider_timeout" degradation ──────────────────

describe("executeToolLoop — TIMEOUT degradation (task #67)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    FILE_TOOL_MOCK.mockResolvedValue("file content");
    GIT_TOOL_MOCK.mockResolvedValue("git output");
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it("returns kind:partial/provider_timeout when primary model times out after a tool call (totalToolCalls > 0)", async () => {
    // model === powerModel so the TIMEOUT goes straight to the else branch (no
    // inner fallback retry).  totalToolCalls is 1 at that point so evidence
    // has been collected and the engine must NOT rethrow.
    const { executeToolLoop } = await import("../tool-execution-engine.js");
    const timeoutErr = new GroqClientError("TIMEOUT", "Provider request timed out");

    let callCount = 0;
    const strategy: ProviderStrategy = {
      providerId: "test",
      supportsNativeStream: false,
      call: vi.fn(async () => {
        callCount++;
        if (callCount === 1) {
          // First call: request a tool call so totalToolCalls increments.
          return makeResponse("", [makeToolCall("tc-1", "read_file", { path: "src/index.ts" })]);
        }
        // Second call (synthesis): provider times out.
        throw timeoutErr;
      }),
      stream: async function* () { yield ""; },
    };

    const steps: AgentStep[] = [];
    const result = await executeToolLoop({
      messages: makeMessages(),
      strategy,
      // Use the same model for both so TIMEOUT reaches the else branch directly.
      model: "same-model",
      powerModel: "same-model",
      provider: "openrouter",
      tools: [{ type: "function", function: { name: "read_file", description: "", parameters: {} } }],
      rootPath: "/project",
      pendingChanges: [],
      onStep: (step) => steps.push(step),
    });

    // Engine must degrade to partial, not throw.
    expect(result.kind).toBe("partial");
    if (result.kind === "partial") {
      expect(result.reason).toBe("provider_timeout");
    }

    // The done event must be emitted with the correct stopReason.
    const done = steps.find((s): s is Extract<AgentStep, { kind: "done" }> => s.kind === "done");
    expect(done).toBeDefined();
    expect(done?.stopReason).toBe("provider_timeout");
  });

  it("returns kind:partial/provider_timeout when both primary and fallback time out after a tool call", async () => {
    // primary !== powerModel so the inner fallback retry path is taken.
    // Both time out.  totalToolCalls is 1 so evidence exists and the engine
    // must NOT rethrow after the fallback also fails.
    const { executeToolLoop } = await import("../tool-execution-engine.js");
    const timeoutErr = new GroqClientError("TIMEOUT", "Provider request timed out");

    let callCount = 0;
    const strategy: ProviderStrategy = {
      providerId: "test",
      supportsNativeStream: false,
      call: vi.fn(async () => {
        callCount++;
        if (callCount === 1) {
          return makeResponse("", [makeToolCall("tc-2", "read_file", { path: "src/util.ts" })]);
        }
        // Both primary (call 2) and powerModel retry (call 3) time out.
        throw timeoutErr;
      }),
      stream: async function* () { yield ""; },
    };

    const steps: AgentStep[] = [];
    const result = await executeToolLoop({
      messages: makeMessages(),
      strategy,
      model: "fast-model",
      powerModel: "power-model",
      provider: "openrouter",
      tools: [{ type: "function", function: { name: "read_file", description: "", parameters: {} } }],
      rootPath: "/project",
      pendingChanges: [],
      onStep: (step) => steps.push(step),
    });

    expect(result.kind).toBe("partial");
    if (result.kind === "partial") {
      expect(result.reason).toBe("provider_timeout");
    }

    const done = steps.find((s): s is Extract<AgentStep, { kind: "done" }> => s.kind === "done");
    expect(done?.stopReason).toBe("provider_timeout");
  });

  it("propagates TIMEOUT as an error when no tool calls or evidence exist yet", async () => {
    // At iter=0 with no prior tool calls, totalToolCalls=0.
    // With model===powerModel (else branch), TIMEOUT should still be rethrown.
    const { executeToolLoop } = await import("../tool-execution-engine.js");
    const timeoutErr = new GroqClientError("TIMEOUT", "Immediate timeout");

    const strategy: ProviderStrategy = {
      providerId: "test",
      supportsNativeStream: false,
      call: vi.fn(async () => { throw timeoutErr; }),
      stream: async function* () { yield ""; },
    };

    await expect(
      executeToolLoop({
        messages: makeMessages(),
        strategy,
        model: "same-model",
        powerModel: "same-model",
        provider: "openrouter",
        tools: undefined,
        rootPath: "",
        pendingChanges: [],
      }),
    ).rejects.toThrow("Immediate timeout");
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
