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
