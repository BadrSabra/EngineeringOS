/**
 * Tests for the ChatOutputSchema validation in the chat agent (PR-06).
 *
 * Strategy: mock groq-sdk to return a canned final response (no tool calls),
 * then verify that the returned ChatOutput shape is correct. For the
 * invalid-absolutePath test we mock file-tools to inject a malformed
 * PendingChange and confirm the agent drops it via ChatOutputSchema validation.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { ChatOutputSchema } from "../schemas/chat.schema.js";
import type { ProjectContext } from "../context-builder.js";

// ── ChatOutputSchema unit tests ───────────────────────────────────────────────

describe("ChatOutputSchema — runtime validation (unit)", () => {
  const validChange = {
    path: "src/foo.ts",
    absolutePath: "/home/project/src/foo.ts",
    newContent: "export const x = 1;",
    originalContent: null,
    reason: "Add export",
  };

  it("accepts a well-formed output with no pending changes", () => {
    expect(
      ChatOutputSchema.safeParse({ response: "done", sources: [], pendingChanges: [] }).success,
    ).toBe(true);
  });

  it("accepts a well-formed output with valid pending changes", () => {
    expect(
      ChatOutputSchema.safeParse({
        response: "done",
        sources: [],
        pendingChanges: [validChange],
      }).success,
    ).toBe(true);
  });

  it("rejects a pending change with a relative absolutePath", () => {
    const bad = { ...validChange, absolutePath: "relative/path/src/foo.ts" };
    expect(
      ChatOutputSchema.safeParse({ response: "done", sources: [], pendingChanges: [bad] }).success,
    ).toBe(false);
  });

  it("rejects a pending change with an empty reason", () => {
    const bad = { ...validChange, reason: "" };
    expect(
      ChatOutputSchema.safeParse({ response: "done", sources: [], pendingChanges: [bad] }).success,
    ).toBe(false);
  });

  it("defaults pendingChanges to [] when omitted", () => {
    const result = ChatOutputSchema.safeParse({ response: "hi", sources: [] });
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.pendingChanges).toEqual([]);
  });
});

// ── Integration: chat agent returns correct ChatOutput shape ─────────────────

const originalApiKey = process.env.GROQ_API_KEY;

/** Minimal valid ProjectContext for the chat function. */
function makeContext(): ProjectContext {
  return {
    project: "test | test project",
    workflows: "No workflows defined yet",
    recentTasks: "",
    latestMetrics: "",
    graphSummary: "",
    recentEvents: "",
    metricsVerified: false,
  };
}

describe("chat agent — ChatOutputSchema validation", () => {
  beforeEach(() => {
    vi.resetModules();
    process.env.GROQ_API_KEY = "test-key";
  });

  afterEach(() => {
    vi.doUnmock("groq-sdk");
    vi.doUnmock("../tools/file-tools.js");
    if (originalApiKey === undefined) delete process.env.GROQ_API_KEY;
    else process.env.GROQ_API_KEY = originalApiKey;
  });

  it("returns valid pendingChanges unchanged when all fields are correct", async () => {
    // Mock Groq to return a plain text final response with no tool calls.
    vi.doMock("groq-sdk", () => ({
      default: class {
        chat = {
          completions: {
            create: vi.fn().mockResolvedValue({
              choices: [{ message: { content: '{"response":"done","sources":[]}' } }],
              model: "m",
              usage: {},
            }),
          },
        };
      },
    }));

    const { chat } = await import("../agents/chat-agent.js");
    const result = await chat({
      message: "hello",
      history: [],
      projectContext: makeContext(),
    });

    expect(result.response).toBeDefined();
    expect(Array.isArray(result.pendingChanges)).toBe(true);
    // No pending changes were queued, so the array should be empty.
    expect(result.pendingChanges).toEqual([]);
  });

  it("drops pendingChanges when the assembled output fails ChatOutputSchema", async () => {
    // Mock Groq: first call emits a write_file tool call, second is the final response.
    vi.doMock("groq-sdk", () => ({
      default: class {
        chat = {
          completions: {
            create: vi
              .fn()
              .mockResolvedValueOnce({
                choices: [
                  {
                    message: {
                      content: "",
                      tool_calls: [
                        {
                          id: "tc1",
                          type: "function",
                          function: { name: "write_file", arguments: '{"path":"src/foo.ts","content":"x"}' },
                        },
                      ],
                    },
                  },
                ],
                model: "m",
                usage: {},
              })
              .mockResolvedValueOnce({
                choices: [{ message: { content: '{"response":"done","sources":[]}' } }],
                model: "m",
                usage: {},
              }),
          },
        };
      },
    }));

    // Override executeFileTool to push a PendingChange with an invalid absolutePath.
    vi.doMock("../tools/file-tools.js", async () => {
      const actual = await vi.importActual<typeof import("../tools/file-tools.js")>("../tools/file-tools.js");
      return {
        ...actual,
        executeFileTool: vi.fn(
          async (
            _name: string,
            _args: unknown,
            _root: string,
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            pendingChanges: Array<any>,
          ) => {
            pendingChanges.push({
              path: "src/foo.ts",
              absolutePath: "relative/bad/path", // invalid — not absolute
              newContent: "x",
              originalContent: null,
              reason: "injected bad change",
            });
            return "wrote file";
          },
        ),
      };
    });

    const { chat } = await import("../agents/chat-agent.js");
    const result = await chat({
      message: "write foo",
      history: [],
      projectContext: makeContext(),
      rootPath: "/home/project",
    });

    expect(result.response).toBeDefined();
    // Every surviving pendingChange must have a valid absolute path.
    const changes = result.pendingChanges ?? [];
    for (const c of changes) {
      expect(c.absolutePath.startsWith("/")).toBe(true);
    }
  });
});

// ── AI-03: OpenRouter streaming normalisation ─────────────────────────────────
// These tests verify that the OpenRouter direct-content path (AI-01) never
// exposes a raw JSON envelope to the caller, and that onDelta receives only
// clean prose — never a wrapper JSON object.

describe("chat agent — OpenRouter streaming normalisation (AI-03)", () => {
  beforeEach(() => {
    vi.resetModules();
    process.env.GROQ_API_KEY = "test-key";
  });

  afterEach(() => {
    vi.doUnmock("groq-sdk");
    vi.doUnmock("../openai-compatible-client.js");
    if (originalApiKey === undefined) delete process.env.GROQ_API_KEY;
    else process.env.GROQ_API_KEY = originalApiKey;
  });

  it("strips JSON envelope from OpenRouter direct-content response", async () => {
    // Simulate an OpenRouter model that returns a JSON envelope as its
    // final content instead of plain prose. The AI-01 fix must normalise
    // this before it reaches onDelta or the return value.
    const envelope = JSON.stringify({ response: "Here is the answer", sources: ["src/index.ts"] });

    // Mock the openai-compatible-client that the openrouter callRaw uses.
    vi.doMock("../openai-compatible-client.js", () => ({
      openrouterCompleteRaw: vi.fn().mockResolvedValue({ content: envelope, toolCalls: [] }),
      openrouterCompleteWithFallback: vi.fn().mockResolvedValue({ content: envelope, toolCalls: [] }),
      openrouterCompleteStream: vi.fn(),
      geminiCompleteRaw: vi.fn(),
      geminiCompleteStream: vi.fn(),
    }));

    const deltas: string[] = [];
    const { chat } = await import("../agents/chat-agent.js");

    const result = await chat({
      message: "hello",
      history: [],
      projectContext: makeContext(),
      provider: "openrouter",
      apiKey: "test-or-key",
      onDelta: (chunk) => deltas.push(chunk),
    });

    // The final response must not be the raw JSON envelope.
    expect(result.response).not.toMatch(/^\{/);
    expect(result.response).not.toContain('"response"');
    // The actual prose must be present.
    expect(result.response).toContain("Here is the answer");

    // onDelta must not have emitted wrapper JSON characters.
    const allDeltas = deltas.join("");
    expect(allDeltas).not.toContain('"response":');
    // The clean text must have been streamed.
    expect(allDeltas).toContain("Here is the answer");

    // Sources should be preserved from the envelope.
    expect(Array.isArray(result.sources)).toBe(true);
  });

  it("passes plain prose through onDelta without modification", async () => {
    const plainProse = "This is a plain text answer with no JSON wrapper.";

    // Mock the openai-compatible-client to return plain prose.
    vi.doMock("../openai-compatible-client.js", () => ({
      openrouterCompleteRaw: vi.fn().mockResolvedValue({ content: plainProse, toolCalls: [] }),
      openrouterCompleteWithFallback: vi.fn().mockResolvedValue({ content: plainProse, toolCalls: [] }),
      openrouterCompleteStream: vi.fn(),
      geminiCompleteRaw: vi.fn(),
      geminiCompleteStream: vi.fn(),
    }));

    const deltas: string[] = [];
    const { chat } = await import("../agents/chat-agent.js");

    const result = await chat({
      message: "hello",
      history: [],
      projectContext: makeContext(),
      provider: "openrouter",
      apiKey: "test-or-key",
      onDelta: (chunk) => deltas.push(chunk),
    });

    // Plain prose must come through — check the joined deltas contain key words.
    const allDeltas = deltas.join("");
    expect(allDeltas).toContain("plain");
    expect(result.response).toContain("plain");
    // Must not have been wrapped in JSON.
    expect(result.response).not.toMatch(/^\{/);
  });

  it("does not regress Groq behaviour — groq never uses the openrouter early-return path", async () => {
    // Groq provider should still go through the SSE streaming path (Strategy 2),
    // not the directContent early-return path.
    const envelope = JSON.stringify({ response: "Groq answer", sources: [] });

    let streamCalled = false;
    vi.doMock("groq-sdk", () => ({
      default: class {
        chat = {
          completions: {
            create: vi.fn().mockImplementation(async (opts: { stream?: boolean }) => {
              if (opts.stream) {
                streamCalled = true;
                // Return an async iterable of chunks
                return (async function* () {
                  yield { choices: [{ delta: { content: "Groq " } }] };
                  yield { choices: [{ delta: { content: "answer" } }] };
                })();
              }
              return { choices: [{ message: { content: envelope } }], model: "llama3", usage: {} };
            }),
          },
        };
      },
    }));

    const deltas: string[] = [];
    const { chat } = await import("../agents/chat-agent.js");

    const result = await chat({
      message: "hello",
      history: [],
      projectContext: makeContext(),
      // No provider override — defaults to "groq"
      onDelta: (chunk) => deltas.push(chunk),
    });

    // Groq must have used the streaming path.
    expect(streamCalled).toBe(true);
    // The response must not contain a raw envelope.
    expect(result.response).not.toMatch(/^\{/);
  });

  it("disables tool payloads for Gemini and still returns a response from context", async () => {
    vi.resetModules();
    process.env.GROQ_API_KEY = "test-key";

    let capturedTools: unknown = "unset";
    const mockGemini = vi.fn(async (_messages: unknown, opts: { tools?: unknown[] }) => {
      capturedTools = opts.tools;
      return {
        content: "Gemini context-only answer",
        toolCalls: [],
      };
    });

    vi.doMock("../openai-compatible-client.js", () => ({
      geminiCompleteRaw: mockGemini,
      geminiCompleteStream: vi.fn(),
      openrouterCompleteRaw: vi.fn(),
      openrouterCompleteWithFallback: vi.fn(),
      openrouterCompleteStream: vi.fn(),
    }));

    const { chat } = await import("../agents/chat-agent.js");
    const result = await chat({
      message: "Please analyze this project and explain the architecture.",
      history: [],
      projectContext: makeContext(),
      rootPath: "/home/project",
      provider: "gemini",
      apiKey: "test-gemini-key",
    });

    expect(capturedTools).toBeUndefined();
    expect(result.response).toContain("Gemini context-only answer");
  });

  it("keeps git tool schemas non-empty so stricter providers can accept them", async () => {
    const { GIT_TOOL_DEFINITIONS } = await import("../tools/git-tools.js");
    const statusTool = GIT_TOOL_DEFINITIONS.find((tool) => tool.function.name === "git_status");
    const logTool = GIT_TOOL_DEFINITIONS.find((tool) => tool.function.name === "git_log");

    expect(statusTool?.function.parameters).toMatchObject({
      type: "object",
      properties: {},
    });
    expect(logTool?.function.parameters).toMatchObject({
      type: "object",
      properties: {},
    });
    expect(statusTool?.function.parameters).not.toHaveProperty("required");
    expect(logTool?.function.parameters).not.toHaveProperty("required");
  });
});


describe("chat agent — Arabic execution intent detection", () => {
  beforeEach(() => {
    vi.resetModules();
    process.env.GROQ_API_KEY = "test-key";
  });

  afterEach(() => {
    vi.doUnmock("../model-selection/decision-engine.js");
    vi.doUnmock("../model-selection/provider-strategy.js");
    vi.doUnmock("../model-selection/model-resolver.js");
    vi.doUnmock("groq-sdk");
    if (originalApiKey === undefined) delete process.env.GROQ_API_KEY;
    else process.env.GROQ_API_KEY = originalApiKey;
  });

  it("routes Arabic write/execute requests through task_execution", async () => {
    const decisionCalls: Array<{ scope: string; opts: Record<string, unknown> }> = [];

    vi.doMock("../model-selection/decision-engine.js", () => ({
      resolveExecutionDecision: vi.fn((scope: string, opts: Record<string, unknown>) => {
        decisionCalls.push({ scope, opts });
        return { taskProfile: { taskType: scope } };
      }),
    }));

    vi.doMock("../model-selection/provider-strategy.js", () => ({
      resolveExecutionProvider: vi.fn((_, provider: string) => ({ providerId: provider })),
    }));

    vi.doMock("../model-selection/model-resolver.js", () => ({
      resolveExecutionModel: vi.fn(() => ({ model: "llama-3.1-8b-instant", powerModel: "llama-3.3-70b-versatile" })),
    }));

    vi.doMock("groq-sdk", () => ({
      default: class {
        chat = {
          completions: {
            create: vi.fn().mockResolvedValue({
              choices: [{ message: { content: '{"response":"ok","sources":[]}' } }],
              model: "m",
              usage: {},
            }),
          },
        };
      },
    }));

    const { chat } = await import("../agents/chat-agent.js");
    const result = await chat({
      message: "اكتب ملفات الاختبار المطلوبة وقم بتنفيذها",
      history: [],
      projectContext: makeContext(),
      rootPath: "/tmp/project",
    });

    expect(decisionCalls).toHaveLength(1);
    expect(decisionCalls[0]?.scope).toBe("task_execution");
    expect(decisionCalls[0]?.opts).toMatchObject({ hasTools: true, requireTools: true });
    expect(result.response).toBe("ok");
  });
});

describe("chat agent — fallback output normalization", () => {
  beforeEach(() => {
    vi.resetModules();
    process.env.GROQ_API_KEY = "test-key";
  });

  afterEach(() => {
    vi.doUnmock("../openai-compatible-client.js");
    if (originalApiKey === undefined) delete process.env.GROQ_API_KEY;
    else process.env.GROQ_API_KEY = originalApiKey;
  });

  it("strips markdown fences and normalizes fallback text", async () => {
    vi.doMock("../openai-compatible-client.js", () => ({
      openrouterCompleteRaw: vi.fn().mockResolvedValue({ content: "```text\n  Hello   world  \n```", toolCalls: [] }),
      openrouterCompleteWithFallback: vi.fn().mockResolvedValue({ content: "```text\n  Hello   world  \n```", toolCalls: [] }),
      openrouterCompleteStream: vi.fn(),
      geminiCompleteRaw: vi.fn(),
      geminiCompleteStream: vi.fn(),
    }));

    const { chat } = await import("../agents/chat-agent.js");
    const result = await chat({
      message: "hello",
      history: [],
      projectContext: makeContext(),
      provider: "openrouter",
      apiKey: "test-or-key",
    });

    expect(result.response).toBe("Hello world");
  });
});
