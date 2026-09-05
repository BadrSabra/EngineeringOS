/**
 * Tests for the ChatOutputSchema validation in the chat agent (PR-06).
 *
 * Strategy: mock groq-sdk to return a canned final response (no tool calls),
 * then verify that the returned ChatOutput shape is correct. For the
 * invalid-absolutePath test we mock file-tools to inject a malformed
 * PendingChange and confirm the agent drops it via ChatOutputSchema validation.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { promises as fs } from "node:fs";
import path from "node:path";
import { tmpdir } from "node:os";
import { ChatOutputSchema } from "../schemas/chat.schema.js";
import type { ProjectContext } from "../context-builder.js";
import { GroqClientError } from "../errors.js";
import type { AgentStep } from "../tool-execution-engine.js";
import {
  assertArabicForensicFixture,
  assertArabicFixtureResponse,
  takeFixture,
} from "./fixture-guards.js";

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

/**
 * Provider payloads observed for an otherwise successful completion with no
 * final text. Keep these fixtures deliberately provider-shaped: the strategy
 * adapter below is the only normalization boundary, so this regression test
 * does not need either provider's credentials or network.
 */
const emptyFinalResponseFixtures = [
  {
    provider: "openrouter" as const,
    payload: {
      choices: [{ message: { content: null }, finish_reason: "stop" }],
    },
  },
  {
    provider: "gemini" as const,
    payload: {
      candidates: [{ content: { parts: [] }, finishReason: "STOP" }],
    },
  },
] as const;

function normalizeEmptyFinalFixture(
  fixture: (typeof emptyFinalResponseFixtures)[number],
): { content: string; toolCalls: [] } {
  if (fixture.provider === "openrouter") {
    expect(fixture.payload.choices[0]?.message.content).toBeNull();
  } else {
    expect(fixture.payload.candidates[0]?.content.parts).toEqual([]);
  }
  return { content: "", toolCalls: [] };
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

  it("identifies an English-only Arabic fixture by name", () => {
    expect(() =>
      assertArabicFixtureResponse(
        "The provider returned an English-only response.",
        "chat-agent-arabic-response",
      ),
    ).toThrow(
      "[AI fixture:chat-agent-arabic-response] expected an Arabic response, but the fixture is English-only",
    );
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

  it("keeps an Arabic greeting out of the tool loop when a project root is present", async () => {
    const decisionCalls: Array<{ scope: string; opts: Record<string, unknown> }> = [];
    const steps: AgentStep[] = [];

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
      resolveExecutionModel: vi.fn(() => ({
        model: "llama-3.1-8b-instant",
        powerModel: "llama-3.3-70b-versatile",
      })),
    }));
    vi.doMock("groq-sdk", () => ({
      default: class {
        chat = {
          completions: {
            create: vi.fn().mockResolvedValue({
              choices: [{ message: { content: '{"response":"أهلًا بك!","sources":[]}' } }],
              model: "m",
              usage: {},
            }),
          },
        };
      },
    }));

    const { chat } = await import("../agents/chat-agent.js");
    const result = await chat({
      message: "مرحبا",
      history: [],
      projectContext: makeContext(),
      rootPath: "/tmp/project",
      onStep: (step) => steps.push(step),
    });

    expect(decisionCalls).toHaveLength(1);
    expect(decisionCalls[0]?.scope).toBe("chat");
    expect(decisionCalls[0]?.opts).toMatchObject({ hasTools: false, requireTools: false });
    expect(steps.filter((step) => step.kind === "tool_call")).toHaveLength(0);
    expect(steps.find((step) => step.kind === "done")).toMatchObject({ toolCalls: 0 });
    expect(steps.some(
      (step) => step.kind === "diagnostic" && step.code === "INCOMPLETE_BEFORE_EVIDENCE",
    )).toBe(false);
    expect(result.response).toBe("أهلًا بك!");
  });

  it("enables project tools for orientation questions and hides raw provenance sources", async () => {
    const toolCalls: AgentStep[] = [];
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
      resolveExecutionModel: vi.fn(() => ({
        model: "llama-3.1-8b-instant",
        powerModel: "llama-3.3-70b-versatile",
      })),
    }));
    vi.doMock("groq-sdk", () => ({
      default: class {
        chat = {
          completions: {
            create: vi.fn().mockResolvedValue({
              choices: [{
                message: {
                  content: JSON.stringify({
                    response: "This is the project workspace.",
                    sources: ["directory: .", "git:status", "search:project"],
                  }),
                },
              }],
              model: "m",
              usage: {},
            }),
          },
        };
      },
    }));

    const { chat } = await import("../agents/chat-agent.js");
    const result = await chat({
      message: "What is this project?",
      history: [],
      projectContext: makeContext(),
      rootPath: "/tmp/project",
      onStep: (step) => toolCalls.push(step),
    });

    expect(decisionCalls[0]).toMatchObject({
      scope: "tool_chat",
      opts: { hasTools: true, requireTools: true },
    });
    expect(toolCalls.filter((step) => step.kind === "tool_call")).toHaveLength(0);
    expect(result.sources).toEqual([]);
    expect(result.response).toBe("This is the project workspace.");
  });

  it("emits a proven production trace only from runtime-observed links", async () => {
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
    const withoutRuntimeLinks: AgentStep[] = [];
    const withoutRuntimeResult = await chat({
      message: "hello",
      history: [],
      projectContext: makeContext(),
      apiKey: "test-key",
      provider: "groq",
      onStep: (step) => withoutRuntimeLinks.push(step),
    });
    expect(withoutRuntimeLinks.some((step) => step.kind === "production_trace")).toBe(false);
    expect(withoutRuntimeResult.productionReachability).toBeUndefined();

    const withRuntimeLinks: AgentStep[] = [];
    const withRuntimeResult = await chat({
      message: "hello",
      history: [],
      projectContext: makeContext(),
      apiKey: "test-key",
      provider: "groq",
      productionTraceLinks: [{
        from: {
          id: "route:test",
          name: "test route",
          path: "artifacts/api-server/src/routes/ai/chat.ts",
          stage: "API_ROUTE",
        },
        to: {
          id: "orchestrator:chat",
          name: "chat()",
          path: "lib/ai-orchestrator/src/agents/chat-agent.ts",
          stage: "ORCHESTRATOR",
        },
        relation: "invokes",
        source: "artifacts/api-server/src/routes/ai/chat.ts",
        evidence: "test runtime dispatch",
        runtimeObserved: true,
      }],
      onStep: (step) => withRuntimeLinks.push(step),
    });

    const traceStep = withRuntimeLinks.find(
      (step): step is Extract<AgentStep, { kind: "production_trace" }> =>
        step.kind === "production_trace",
    );
    expect(traceStep?.trace.status).toBe("PROVEN");
    expect(traceStep?.trace.edges).toHaveLength(3);
    expect(traceStep?.trace.edges.every((edge) => edge.runtimeObserved)).toBe(true);
    expect(withRuntimeResult.productionReachability?.status).toBe("PROVEN");
    expect(withRuntimeResult.productionReachability?.edges).toHaveLength(3);
  });

  it("carries the runtime trace into the semantic behavior answer", async () => {
    vi.doMock("groq-sdk", () => ({
      default: class {
        chat = {
          completions: {
            create: vi.fn().mockResolvedValue({
              choices: [{
                message: {
                  content: JSON.stringify({
                    response: "The behavior depends on the `maxIterations` control flow.",
                    sources: [],
                  }),
                },
              }],
              model: "m",
              usage: {},
            }),
          },
        };
      },
    }));

    const { chat } = await import("../agents/chat-agent.js");
    const result = await chat({
      message: "What happens when maxIterations is reached?",
      history: [],
      projectContext: makeContext(),
      apiKey: "test-key",
      provider: "groq",
      productionTraceLinks: [{
        from: {
          id: "route:test",
          name: "test route",
          stage: "API_ROUTE",
        },
        to: {
          id: "orchestrator:chat",
          name: "chat()",
          stage: "ORCHESTRATOR",
        },
        relation: "invokes",
        evidence: "runtime behavior-answer dispatch",
        runtimeObserved: true,
      }],
    });

    expect(result.behaviorAnswer?.productionReachability?.status).toBe("PROVEN");
    expect(result.behaviorAnswer?.answer).toContain("maxIterations");
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

describe("chat agent — provider empty-final response contract", () => {
  beforeEach(() => {
    vi.resetModules();
    process.env.GROQ_API_KEY = "test-key";
  });

  afterEach(() => {
    vi.doUnmock("../provider-registry.js");
    vi.doUnmock("../model-selection/decision-engine.js");
    vi.doUnmock("../model-selection/provider-strategy.js");
    vi.doUnmock("../model-selection/model-resolver.js");
    if (originalApiKey === undefined) delete process.env.GROQ_API_KEY;
    else process.env.GROQ_API_KEY = originalApiKey;
  });

  it.each(emptyFinalResponseFixtures)(
    "fails closed for $provider after a completed read",
    async (fixture) => {
      const rootPath = await fs.mkdtemp(path.join(tmpdir(), `eos-empty-final-${fixture.provider}-`));
      const relativeFile = "src/provider-empty-fixture.ts";
      await fs.mkdir(path.dirname(path.join(rootPath, relativeFile)), { recursive: true });
      await fs.writeFile(
        path.join(rootPath, relativeFile),
        "export function completedRead() { return true; }\n",
        "utf8",
      );

      let calls = 0;
      const steps: AgentStep[] = [];
      const fakeStrategy = {
        providerId: fixture.provider,
        // Use the non-native path so the test exercises the common buffered
        // empty-final handling used by both provider adapters.
        supportsNativeStream: false,
        call: vi.fn(async () => {
          calls += 1;
          if (calls === 1) {
            return {
              content: "",
              toolCalls: [{
                id: `read-${fixture.provider}`,
                type: "function" as const,
                function: {
                  name: "read_file",
                  arguments: JSON.stringify({ path: relativeFile }),
                },
              }],
              model: "fixture-model",
              usage: {},
            };
          }
          // The normalized result came from the provider-shaped fixture above.
          return {
            ...normalizeEmptyFinalFixture(fixture),
            model: "fixture-model",
            usage: {},
          };
        }),
        stream: vi.fn(),
      };

      vi.doMock("../provider-registry.js", async () => {
        const actual = await vi.importActual("../provider-registry.js") as Record<string, unknown>;
        return { ...actual, getStrategy: vi.fn(() => fakeStrategy) };
      });
      vi.doMock("../model-selection/decision-engine.js", () => ({
        resolveExecutionDecision: vi.fn((scope: string) => ({ taskProfile: { taskType: scope } })),
      }));
      vi.doMock("../model-selection/provider-strategy.js", () => ({
        resolveExecutionProvider: vi.fn((_, provider: string) => ({ providerId: provider })),
      }));
      vi.doMock("../model-selection/model-resolver.js", () => ({
        resolveExecutionModel: vi.fn(() => ({
          model: "fixture-model",
          powerModel: "fixture-model",
        })),
      }));

      try {
        const { chat } = await import("../agents/chat-agent.js");
        const result = await chat({
          message:
            `Perform a forensic audit of exactly ${relativeFile}. ` +
            "Read the file first, then return an empty final response.",
          history: [],
          projectContext: makeContext(),
          rootPath,
          provider: fixture.provider,
          apiKey: `${fixture.provider}-fixture-key`,
          onStep: (step) => steps.push(step),
        });

        expect(result.response).toContain("ANALYSIS_INCOMPLETE");
        expect(result.response).toContain(relativeFile);
        expect(result.response).toMatch(/Retry or narrow the question|No Repair Plan is executable/);
        expect(result.response).not.toContain("NO_VERIFIED_FINDING");
        expect(result.response).not.toContain("EMPTY_MODEL_RESPONSE");
        expect(result.response).not.toContain("providerMessage");
        expect(result.response).not.toContain(`${fixture.provider}-fixture-key`);
        expect(result.sources).toContain(relativeFile);
        expect(
          steps.some(
            (step) =>
              step.kind === "tool_result" &&
              step.tool === "read_file" &&
              step.source === relativeFile,
          ),
        ).toBe(true);
      } finally {
        await fs.rm(rootPath, { recursive: true, force: true });
        expect(await fs.access(rootPath).then(() => true).catch(() => false)).toBe(false);
      }
    },
  );
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
    vi.doUnmock("../provider-registry.js");
    vi.doUnmock("../forensic-recovery.js");
    vi.doUnmock("../model-selection/decision-engine.js");
    vi.doUnmock("../model-selection/provider-strategy.js");
    vi.doUnmock("../model-selection/model-resolver.js");
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

  it("uses a soft JSON correction path for OpenRouter without response_format", async () => {
    const calls: Array<{ responseFormat?: unknown }> = [];

    const fakeStrategy = {
      providerId: "openrouter",
      supportsNativeStream: false,
      call: vi.fn(async (_messages: unknown, opts: { responseFormat?: unknown }) => {
        calls.push({ responseFormat: opts.responseFormat });
        if (calls.length === 1) {
          return { content: "not valid JSON at first", toolCalls: [], model: "m", usage: {} };
        }
        return { content: '{"response":"corrected","sources":[]}', toolCalls: [], model: "m", usage: {} };
      }),
      stream: vi.fn(),
    };

    vi.doMock("../provider-registry.js", async () => {
      const actual = await vi.importActual("../provider-registry.js") as Record<string, unknown>;
      return { ...actual, getStrategy: vi.fn(() => fakeStrategy) };
    });

    vi.doMock("../model-selection/decision-engine.js", () => ({
      resolveExecutionDecision: vi.fn((scope: string) => ({ taskProfile: { taskType: scope } })),
    }));

    vi.doMock("../model-selection/provider-strategy.js", () => ({
      resolveExecutionProvider: vi.fn((_, provider: string) => ({ providerId: provider })),
    }));

    vi.doMock("../model-selection/model-resolver.js", () => ({
      resolveExecutionModel: vi.fn(() => ({ model: "llama-3.1-8b-instant", powerModel: "llama-3.3-70b-versatile" })),
    }));

    const { chat } = await import("../agents/chat-agent.js");
    const result = await chat({
      message: "hello",
      history: [],
      projectContext: makeContext(),
      provider: "openrouter",
      apiKey: "test-or-key",
    });

    expect(calls).toHaveLength(2);
    expect(calls[1]?.responseFormat).toBeUndefined();
    expect(result.response).toBe("corrected");
  });

  it("skips forensic recovery when no completed source read exists", async () => {
    const calls: Array<{ tools?: unknown; timeoutMs?: number; maxTokens?: number }> = [];
    const invalidForensic = [
      "هذه نتيجة أولية باللغة العربية، لكنها تفتقد تنسيق التقرير المطلوب.",
      "1) Executive Verdict",
      "No verified findings identified.",
      "2) Evidence Map",
      "No verified evidence map was produced.",
      "3) Findings",
      "No verified finding identified from inspected source code.",
      "4) Repair Plan",
      "No repair phases identified.",
      "5) Validation Checklist",
      "No validation scenario available.",
      "6) Final Judgment",
      "NOT PROVEN — insufficient evidence.",
    ].join("\n");
    assertArabicFixtureResponse(invalidForensic, "chat-agent-invalid-forensic-arabic");
    const validForensic = [
      "تمت مراجعة الأدلة المتاحة، ولم يُثبت وجود عيب بسبب نقص القراءة المصدرية.",
      "1) Executive Verdict",
      "No verified findings identified from inspected source code.",
      "2) Evidence Map",
      "No verified evidence map was produced.",
      "3) Findings",
      "No verified finding identified from inspected source code.",
      "4) Repair Plan",
      "No repair phase is executable until a valid forensic report is produced.",
      "5) Validation Checklist",
      "No validation scenario available.",
      "6) Final Judgment",
      "NOT PROVEN — insufficient evidence.",
    ].join("\n");
    assertArabicFixtureResponse(validForensic, "chat-agent-valid-forensic-arabic");

    const fakeStrategy = {
      providerId: "openrouter",
      supportsNativeStream: false,
      call: vi.fn(async (_messages: unknown, opts: { tools?: unknown; timeoutMs?: number; maxTokens?: number }) => {
        calls.push({ tools: opts.tools, timeoutMs: opts.timeoutMs, maxTokens: opts.maxTokens });
        return {
          content: calls.length === 1
            ? JSON.stringify({ response: invalidForensic, sources: [] })
            : validForensic,
          toolCalls: [],
          model: "m",
          usage: {},
        };
      }),
      stream: vi.fn(),
    };

    vi.doMock("../provider-registry.js", async () => {
      const actual = await vi.importActual("../provider-registry.js") as Record<string, unknown>;
      return { ...actual, getStrategy: vi.fn(() => fakeStrategy) };
    });
    vi.doMock("../model-selection/decision-engine.js", () => ({
      resolveExecutionDecision: vi.fn((scope: string) => ({ taskProfile: { taskType: scope } })),
    }));
    vi.doMock("../model-selection/provider-strategy.js", () => ({
      resolveExecutionProvider: vi.fn((_, provider: string) => ({ providerId: provider })),
    }));
    vi.doMock("../model-selection/model-resolver.js", () => ({
      resolveExecutionModel: vi.fn(() => ({
        model: "llama-3.1-8b-instant",
        powerModel: "llama-3.3-70b-versatile",
      })),
    }));

    const { chat } = await import("../agents/chat-agent.js");
    const result = await chat({
      message: [
        "أنت وكيل تحليل هندسي جنائي.",
        "أخرج الأقسام الستة التالية بالترتيب.",
        "## 1) Executive Verdict",
        "## 2) Evidence Map",
        "## 3) Findings",
        "## 4) Repair Plan",
        "## 5) Validation Checklist",
        "## 6) Final Judgment",
      ].join("\n"),
      history: [],
      projectContext: makeContext(),
      provider: "openrouter",
      apiKey: "test-or-key",
    });

    expect(calls).toHaveLength(1);
    expect(result.response).toContain("## 1) Executive Verdict");
    expect(result.response).toContain("## 6) Final Judgment");
    expect(result.response).toContain("NOT PROVEN");
  });

  it("preserves the Arabic incomplete forensic report when AbortSignal fires during synthesis", async () => {
    const rootPath = await fs.mkdtemp(path.join(tmpdir(), "eos-arabic-forensic-cancel-"));
    await fs.mkdir(path.join(rootPath, "src"), { recursive: true });
    await fs.writeFile(path.join(rootPath, "src", "target.ts"), "export const target = true;\n", "utf8");
    const controller = new AbortController();

    const fakeStrategy = {
      providerId: "openrouter",
      supportsNativeStream: false,
      call: vi.fn(async (
        _messages: unknown,
        _opts: { signal?: AbortSignal },
      ) => {
        controller.abort();
        throw new Error("simulated synthesis cancellation");
      }),
      stream: vi.fn(),
    };

    vi.doMock("../provider-registry.js", async () => {
      const actual = await vi.importActual("../provider-registry.js") as Record<string, unknown>;
      return { ...actual, getStrategy: vi.fn(() => fakeStrategy) };
    });
    vi.doMock("../model-selection/decision-engine.js", () => ({
      resolveExecutionDecision: vi.fn((scope: string) => ({ taskProfile: { taskType: scope } })),
    }));
    vi.doMock("../model-selection/provider-strategy.js", () => ({
      resolveExecutionProvider: vi.fn((_, provider: string) => ({ providerId: provider })),
    }));
    vi.doMock("../model-selection/model-resolver.js", () => ({
      resolveExecutionModel: vi.fn(() => ({
        model: "llama-3.1-8b-instant",
        powerModel: "llama-3.3-70b-versatile",
      })),
    }));

    try {
      const { chat } = await import("../agents/chat-agent.js");
      const result = await chat({
        message: [
          "أنت وكيل تدقيق جنائي. Perform a structured forensic audit باللغة العربية على الملف src/target.ts.",
          "أخرج الأقسام الستة للتقرير بالترتيب، مع Executive Verdict وRepair Plan.",
        ].join("\n"),
        history: [],
        projectContext: makeContext(),
        rootPath,
        provider: "openrouter",
        apiKey: "test-or-key",
        signal: controller.signal,
      });

      expect(controller.signal.aborted).toBe(true);
      expect(result.response).toContain("## 1) Executive Verdict");
      expect(result.response).toContain("## 6) Final Judgment");
      expect(result.response).toContain("ANALYSIS_INCOMPLETE");
      expect(result.response).toContain("Recovery needed");
      expect(result.response).toContain("Blocked by");
      expect(result.response).not.toContain("NO_VERIFIED_FINDING");
      expect(result.response).not.toContain("تعذر عرض الاستجابة لأنها لم تلتزم بلغة الطلب");
    } finally {
      await fs.rm(rootPath, { recursive: true, force: true });
    }
  });

  it("emits FIRST_EVIDENCE_UNAVAILABLE instead of the generic skip when a 0-read run has an unreadable primary target", async () => {
    // Task #54 (FEG-013/014): a structured forensic run that ends with ZERO
    // source reads and names a single explicit file as its DIRECT_READ primary
    // evidence target must attempt a FIRST_EVIDENCE recovery read of that one
    // file. When even that focused read fails (target missing on disk), the
    // terminal must surface FIRST_EVIDENCE_UNAVAILABLE with the true reason
    // instead of the flat FORENSIC_CONTRACT_RECOVERY_SKIPPED_NO_EVIDENCE.
    const rootPath = await fs.mkdtemp(path.join(tmpdir(), "eos-first-evidence-unavailable-"));
    // NOTE: the file is deliberately NOT created — the primary target does not
    // exist on disk, so both the eager pre-read and the recovery read fail.

    const validForensic = [
      "تمت مراجعة الأدلة المتاحة، ولم يُثبت وجود عيب بسبب نقص القراءة المصدرية.",
      "## 1) Executive Verdict",
      "No verified findings identified from inspected source code.",
      "## 2) Evidence Map",
      "No verified evidence map was produced because no completed source-file read was available.",
      "## 3) Findings",
      "No verified finding identified from inspected source code.",
      "## 4) Repair Plan",
      "No repair phase is executable until a valid forensic report is produced.",
      "## 5) Validation Checklist",
      "No validation scenario available.",
      "## 6) Final Judgment",
      "NOT PROVEN — insufficient evidence.",
    ].join("\n");
    assertArabicFixtureResponse(validForensic, "chat-agent-recovery-forensic-arabic");

    const fakeStrategy = {
      providerId: "openrouter",
      supportsNativeStream: false,
      call: vi.fn(async () => ({
        content: JSON.stringify({ response: validForensic, sources: [] }),
        toolCalls: [],
        model: "m",
        usage: {},
      })),
      stream: vi.fn(),
    };

    vi.doMock("../provider-registry.js", async () => {
      const actual = await vi.importActual("../provider-registry.js") as Record<string, unknown>;
      return { ...actual, getStrategy: vi.fn(() => fakeStrategy) };
    });
    vi.doMock("../model-selection/decision-engine.js", () => ({
      resolveExecutionDecision: vi.fn((scope: string) => ({ taskProfile: { taskType: scope } })),
    }));
    vi.doMock("../model-selection/provider-strategy.js", () => ({
      resolveExecutionProvider: vi.fn((_, provider: string) => ({ providerId: provider })),
    }));
    vi.doMock("../model-selection/model-resolver.js", () => ({
      resolveExecutionModel: vi.fn(() => ({
        model: "llama-3.1-8b-instant",
        powerModel: "llama-3.3-70b-versatile",
      })),
    }));

    const { chat } = await import("../agents/chat-agent.js");
    let steps: AgentStep[] = [];
    try {
      const result = await chat({
        message: "Perform a forensic audit of src/executor.ts and prove any behavioral defect with direct evidence from the file.",
        history: [],
        projectContext: makeContext(),
        rootPath,
        provider: "openrouter",
        apiKey: "test-or-key",
        onStep: (step) => void steps.push(step),
      });

      const unavailable = steps.find(
        (s) => s.kind === "diagnostic" && s.code === "FIRST_EVIDENCE_UNAVAILABLE",
      );
      expect(unavailable?.kind).toBe("diagnostic");
      const skipped = steps.find(
        (s) => s.kind === "diagnostic" && s.code === "FORENSIC_CONTRACT_RECOVERY_SKIPPED_NO_EVIDENCE",
      );
      expect(skipped).toBeUndefined();
      // The terminal must still complete with a structured NOT PROVEN verdict.
      expect(result.response).toContain("## 6) Final Judgment");
      expect(result.response).toContain("NOT PROVEN");
    } finally {
      await fs.rm(rootPath, { recursive: true, force: true });
    }
  });

  it("skips recovery after malformed synthesis and correction when no evidence exists", async () => {
    const calls: Array<{ tools?: unknown; timeoutMs?: number; maxTokens?: number }> = [];
    const validForensic = [
      "تمت مراجعة الأدلة المتاحة، ولم يُثبت وجود عيب بسبب نقص القراءة المصدرية.",
      "## 1) Executive Verdict",
      "No verified findings identified from inspected source code.",
      "## 2) Evidence Map",
      "No verified evidence map was produced because no completed source-file read was available.",
      "## 3) Findings",
      "No verified finding identified from inspected source code.",
      "## 4) Repair Plan",
      "No repair phase is executable until a valid forensic report is produced.",
      "## 5) Validation Checklist",
      "No validation scenario available.",
      "## 6) Final Judgment",
      "NOT PROVEN — insufficient evidence.",
    ].join("\n");
    assertArabicFixtureResponse(validForensic, "chat-agent-structured-forensic-arabic");

    const fakeStrategy = {
      providerId: "openrouter",
      supportsNativeStream: false,
      call: vi.fn(async (
        _messages: unknown,
        opts: { tools?: unknown; timeoutMs?: number; maxTokens?: number },
      ) => {
        calls.push({
          tools: opts.tools,
          timeoutMs: opts.timeoutMs,
          maxTokens: opts.maxTokens,
        });
        return {
          content:
            calls.length === 1
              ? "plain synthesis without the JSON envelope"
              : calls.length === 2
                ? JSON.stringify({ response: validForensic, sources: [] })
                : validForensic,
          toolCalls: [],
          model: "m",
          usage: {},
        };
      }),
      stream: vi.fn(),
    };

    vi.doMock("../provider-registry.js", async () => {
      const actual = await vi.importActual("../provider-registry.js") as Record<string, unknown>;
      return { ...actual, getStrategy: vi.fn(() => fakeStrategy) };
    });
    vi.doMock("../model-selection/decision-engine.js", () => ({
      resolveExecutionDecision: vi.fn((scope: string) => ({ taskProfile: { taskType: scope } })),
    }));
    vi.doMock("../model-selection/provider-strategy.js", () => ({
      resolveExecutionProvider: vi.fn((_, provider: string) => ({ providerId: provider })),
    }));
    vi.doMock("../model-selection/model-resolver.js", () => ({
      resolveExecutionModel: vi.fn(() => ({
        model: "llama-3.1-8b-instant",
        powerModel: "llama-3.3-70b-versatile",
      })),
    }));

    const { chat } = await import("../agents/chat-agent.js");
    const result = await chat({
      message: [
        "أنت وكيل تحليل هندسي جنائي.",
        "أخرج الأقسام الستة التالية بالترتيب.",
        "## 1) Executive Verdict",
        "## 2) Evidence Map",
        "## 3) Findings",
        "## 4) Repair Plan",
        "## 5) Validation Checklist",
        "## 6) Final Judgment",
      ].join("\n"),
      history: [],
      projectContext: makeContext(),
      provider: "openrouter",
      apiKey: "test-or-key",
    });

    expect(calls).toHaveLength(2);
    expect(calls[1]?.tools).toBeUndefined();
    expect(result.response).toContain("## 1) Executive Verdict");
    expect(result.response).toContain("## 6) Final Judgment");
    expect(result.response).toContain("NOT PROVEN");
  });

  it("preserves complete evidence when provider recovery returns EMPTY_RESPONSE", async () => {
    const rootPath = await fs.mkdtemp(path.join(tmpdir(), "eos-forensic-recovery-"));
    await fs.writeFile(
      path.join(rootPath, "verified.ts"),
      "export function verifiedRead() { return true; }\n",
      "utf8",
    );

    const calls: Array<{ tools?: unknown; maxTokens?: number; model?: string }> = [];
    const diagnostics: Array<{ code: string; details?: string[] }> = [];
    const fakeStrategy = {
      providerId: "openrouter",
      supportsNativeStream: false,
      call: vi.fn(async (
        _messages: unknown,
        opts: { tools?: Array<{ function: { name: string } }>; maxTokens?: number; model?: string },
      ) => {
        calls.push({ tools: opts.tools, maxTokens: opts.maxTokens, model: opts.model });
        if (calls.length === 1) {
          return {
            content: "",
            toolCalls: [{
              id: "read-verified",
              type: "function" as const,
              function: {
                name: "read_file",
                arguments: JSON.stringify({ path: "verified.ts" }),
              },
            }],
            model: "m",
            usage: {},
          };
        }
        if (calls.length < 4) {
          return { content: "not valid JSON", toolCalls: [], model: "m", usage: {} };
        }
        if (calls.length === 4) {
          throw new GroqClientError("EMPTY_RESPONSE", "provider returned neither content nor tool calls");
        }
        // Recovery must not remain pinned to the failed synthesis model. The
        // first fallback candidate returns a six-section report with a stale
        // Evidence Map. That must not be mistaken for a successful recovery:
        // the guard rebuilds an Evidence-only response and marks it as such.
        if (calls.length === 5 && calls[4]?.model === "fallback-model") {
          return {
            content: [
              "## 1) Executive Verdict",
              "NOT PROVEN — the available evidence is insufficient.",
              "## 2) Evidence Map",
              "File: `stale.ts`",
              "Role: implementation source",
              "Evidence: `const stale = true`",
              "Risk: NOT PROVEN",
              "Notes: stale provider path",
              "## 3) Findings",
              "No verified finding identified from inspected source code.",
              "## 4) Repair Plan",
              "No repair phases identified.",
            ].join("\n"),
            toolCalls: [],
            model: "fallback-model",
            usage: {},
          };
        }
        // The next live candidate also fails. The final result must remain
        // evidence-only rather than exposing a misleading provider failure.
        if (calls[5]?.model === "final-model") {
          throw new TypeError("provider recovery transport crashed");
        }
        throw new GroqClientError("EMPTY_RESPONSE", "provider returned neither content nor tool calls");
      }),
      stream: vi.fn(),
    };

    vi.doMock("../provider-registry.js", async () => {
      const actual = await vi.importActual("../provider-registry.js") as Record<string, unknown>;
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
        model: "llama-3.1-8b-instant",
        powerModel: "llama-3.3-70b-versatile",
        fallbackChain: ["llama-3.1-8b-instant", "fallback-model", "final-model"],
      })),
    }));

    try {
      const { chat } = await import("../agents/chat-agent.js");
      const result = await chat({
        message: [
          "You are a forensic auditor. Perform a behavioral defect assessment from the completed source reads and return exactly these sections.",
          "## 1) Executive Verdict",
          "## 2) Evidence Map",
          "## 3) Findings",
          "## 4) Repair Plan",
          "## 5) Validation Checklist",
          "## 6) Final Judgment",
        ].join("\n"),
        history: [],
        projectContext: makeContext(),
        rootPath,
        provider: "openrouter",
        apiKey: "test-or-key",
        onStep: (step) => {
          if (step.kind === "diagnostic") {
            diagnostics.push({ code: step.code, details: step.details });
          }
        },
      });

      expect(result.response).toContain("## 2) Evidence Map");
      expect(result.response).toContain("No verified finding identified from inspected source code.");
      expect(result.response).toContain("NO_VERIFIED_FINDING");
      expect(result.response).toContain(
        "Basis: verified.ts contains `export function verifiedRead() { return true; }`",
      );
      expect(result.pendingChanges).toEqual([]);
      expect(result.sources).toContain("verified.ts");
      expect(calls[0]?.model).toBe("llama-3.1-8b-instant");
      // Recovery now pins the first agent-owned candidate instead of letting
      // OpenRouter silently re-resolve from the catalog head.
      expect(calls[3]?.model).toBe("llama-3.1-8b-instant");
      expect(calls[4]?.model).toBe("fallback-model");
      // The Recovery chain now allows up to three bounded candidates, so the
      // final-model fail-through is exercised instead of being skipped. It
      // still throws EMPTY_RESPONSE, so the result stays evidence-only.
      expect(calls[5]?.model).toBe("final-model");
      expect(diagnostics.map((diagnostic) => diagnostic.code))
        .not.toContain("FORENSIC_CONTRACT_RECOVERY_FAILED");
      expect(diagnostics.map((diagnostic) => diagnostic.code))
        .toContain("FORENSIC_DETERMINISTIC_NO_FINDING");
      expect(diagnostics.map((diagnostic) => diagnostic.code))
        .not.toContain("FORENSIC_CONTRACT_RECOVERY_REJECTED");
      const deterministicNoFindingDetails =
        diagnostics.find((diagnostic) => diagnostic.code === "FORENSIC_DETERMINISTIC_NO_FINDING")?.details ?? [];
      expect(deterministicNoFindingDetails.join(" ")).toContain("provider failure codes: EMPTY_RESPONSE");
      expect(deterministicNoFindingDetails.join(" ")).toContain("TypeError");
    } finally {
      await fs.rm(rootPath, { recursive: true, force: true });
    }
  });

  it("continues to the next forensic packet after a timeout and merges its proven Finding", async () => {
    const rootPath = await fs.mkdtemp(path.join(tmpdir(), "eos-multi-root-recovery-"));
    await fs.mkdir(path.join(rootPath, "root-a"), { recursive: true });
    await fs.mkdir(path.join(rootPath, "root-b", "lib", "ai-orchestrator", "src"), { recursive: true });
    await fs.writeFile(
      path.join(rootPath, "root-a", "context.ts"),
      "export const contextOnly = true;\n",
      "utf8",
    );
    await fs.writeFile(
      path.join(rootPath, "root-b", "lib", "ai-orchestrator", "src", "verified.ts"),
      "export function unsafe(input: string) { return eval(input); }\n",
      "utf8",
    );

    const calls: Array<{ tools?: unknown; model?: string }> = [];
    const packets: Array<{
      root?: string;
      packetIndex?: number;
      status?: string;
      reason?: string;
    }> = [];
    const fakeStrategy = {
      providerId: "openrouter",
      supportsNativeStream: false,
      ownsModelFallback: true,
      call: vi.fn(async (
        _messages: unknown,
        opts: { tools?: unknown; model?: string },
      ) => {
        calls.push({ tools: opts.tools, model: opts.model });
        if (calls.length === 1) {
          return {
            content: JSON.stringify({
              response: "The initial synthesis did not satisfy the forensic report contract.",
              sources: [],
            }),
            toolCalls: [],
            model: "initial-model",
            usage: {},
          };
        }
        if (calls.length === 2) {
          throw new GroqClientError("TIMEOUT", "first forensic packet timed out");
        }
        return {
          content: JSON.stringify({
            verdict: "FINDING_PROVEN",
            findings: [{
              id: "F-01",
              title: "Dynamic evaluation executes input",
              files: ["root-b/lib/ai-orchestrator/src/verified.ts"],
              evidence: "`return eval(input);`",
              whyItMatters: "Caller-controlled input reaches executable evaluation.",
              rootCause: "The implementation evaluates the input directly.",
              fix: "Replace dynamic evaluation with an allow-listed parser.",
            }],
            repairPlan: [{
              findingId: "F-01",
              steps: ["Replace dynamic evaluation and add a focused regression test."],
            }],
            validationChecklist: ["Run the focused behavior and security tests."],
          }),
          toolCalls: [],
          model: opts.model ?? "recovery-model",
          usage: {},
        };
      }),
      stream: vi.fn(),
    };

    vi.doMock("../provider-registry.js", async () => {
      const actual = await vi.importActual("../provider-registry.js") as Record<string, unknown>;
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
        fallbackChain: ["initial-model", "recovery-model"],
      })),
    }));
    vi.doMock("../openrouter/model-resolver.js", () => ({
      resolveFallbackChain: vi.fn(() => [{ id: "recovery-model" }]),
      isCatalogFreeModelForCapability: vi.fn(() => true),
    }));

    try {
      const { chat } = await import("../agents/chat-agent.js");
      const result = await chat({
        message: [
          "Perform a forensic audit only inside ./root-a then ./root-b, in this order.",
          "Read all source files before analysis and return the six forensic sections.",
        ].join("\n"),
        history: [],
        projectContext: makeContext(),
        rootPath,
        provider: "openrouter",
        apiKey: "test-or-key",
        onStep: (step) => {
          if (step.kind === "forensic_packet") {
            packets.push({
              root: step.root,
              packetIndex: step.packetIndex,
              status: step.status,
              reason: step.reason,
            });
          }
        },
      });

      expect(calls).toHaveLength(3);
      expect(packets).toEqual(expect.arrayContaining([
        expect.objectContaining({
          root: "root-a",
          packetIndex: 0,
          status: "FAILED",
          reason: "TIMEOUT",
        }),
        expect.objectContaining({
          root: "root-b",
          packetIndex: 1,
          status: "ACCEPTED",
        }),
      ]));
      expect(
        packets.findIndex((packet) => packet.root === "root-a" && packet.status === "FAILED"),
      ).toBeLessThan(
        packets.findIndex((packet) => packet.root === "root-b" && packet.status === "ACCEPTED"),
      );
      expect(result.response).toContain("ID: F-1 · Dynamic evaluation executes input");
      expect(result.response).toContain("`return eval(input);`");
      expect(result.response).toContain("FINDING PROVEN");
      expect(result.response).toContain("Phase 1 (F-1):");
      expect(result.response).not.toContain("No verified forensic verdict was produced");
      expect(result.sources).toContain("root-b/lib/ai-orchestrator/src/verified.ts");
      expect(result.pendingChanges).toEqual([]);
    } finally {
      await fs.rm(rootPath, { recursive: true, force: true });
    }
  });

  it("keeps an earlier packet Finding when a later packet crashes during processing", async () => {
    const rootPath = await fs.mkdtemp(path.join(tmpdir(), "eos-multi-root-processing-crash-"));
    await fs.mkdir(path.join(rootPath, "root-a", "lib", "ai-orchestrator", "src"), { recursive: true });
    await fs.mkdir(path.join(rootPath, "root-b", "lib", "ai-orchestrator", "src"), { recursive: true });
    await fs.writeFile(
      path.join(rootPath, "root-a", "lib", "ai-orchestrator", "src", "first.ts"),
      "export const first = true;\n",
      "utf8",
    );
    await fs.writeFile(
      path.join(rootPath, "root-b", "lib", "ai-orchestrator", "src", "second.ts"),
      "export const second = true;\n",
      "utf8",
    );

    const calls: Array<{ model?: string }> = [];
    const packets: Array<{
      root?: string;
      packetIndex?: number;
      status?: string;
      reason?: string;
    }> = [];
    const fakeStrategy = {
      providerId: "openrouter",
      supportsNativeStream: false,
      ownsModelFallback: true,
      call: vi.fn(async (
        _messages: unknown,
        opts: { model?: string },
      ) => {
        calls.push({ model: opts.model });
        if (calls.length === 1) {
          return {
            content: JSON.stringify({
              response: "The initial synthesis did not satisfy the forensic report contract.",
              sources: [],
            }),
            toolCalls: [],
            model: "initial-model",
            usage: {},
          };
        }
        const isFirstPacket = calls.length === 2;
        return {
          content: JSON.stringify({
            verdict: "FINDING_PROVEN",
            findings: [{
              id: "F-01",
              title: isFirstPacket ? "First packet finding" : "Second packet finding",
              files: [
                isFirstPacket
                  ? "root-a/lib/ai-orchestrator/src/first.ts"
                  : "root-b/lib/ai-orchestrator/src/second.ts",
              ],
              evidence: isFirstPacket
                ? "`export const first = true;`"
                : "`export const second = true;`",
              whyItMatters: "The retained source must remain traceable to its packet.",
              rootCause: "The packet contains the directly observed implementation.",
              fix: "Keep the verified source evidence linked to the final report.",
            }],
            repairPlan: [{
              findingId: "F-01",
              steps: [
                isFirstPacket
                  ? "Replace the implementation in root-a/lib/ai-orchestrator/src/first.ts with a verified safe implementation."
                  : "Replace the implementation in root-b/lib/ai-orchestrator/src/second.ts with a verified safe implementation.",
              ],
            }],
            validationChecklist: ["Run the focused packet-isolation regression test."],
          }),
          toolCalls: [],
          model: opts.model ?? "recovery-model",
          usage: {},
        };
      }),
      stream: vi.fn(),
    };

    vi.doMock("../provider-registry.js", async () => {
      const actual = await vi.importActual("../provider-registry.js") as Record<string, unknown>;
      return { ...actual, getStrategy: vi.fn(() => fakeStrategy) };
    });
    vi.doMock("../forensic-recovery.js", async () => {
      const actual = await vi.importActual<typeof import("../forensic-recovery.js")>(
        "../forensic-recovery.js",
      );
      return {
        ...actual,
        validateStructuredForensicRecovery: vi.fn((
          ...args: Parameters<typeof actual.validateStructuredForensicRecovery>
        ) => {
          const packetEvidence = args[1];
          const packetFiles = [...packetEvidence.fileContents.keys()];
          if (
            packetFiles.length > 0 &&
            packetFiles.every((file) =>
              file.endsWith("root-b/lib/ai-orchestrator/src/second.ts"),
            )
          ) {
            throw new TypeError("simulated packet processing crash");
          }
          return actual.validateStructuredForensicRecovery(...args);
        }),
      };
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
      resolveFallbackChain: vi.fn(() => []),
      isCatalogFreeModelForCapability: vi.fn(() => true),
    }));

    try {
      const { chat } = await import("../agents/chat-agent.js");
      const result = await chat({
        message: [
          "Perform a forensic audit only inside ./root-a then ./root-b, in this order.",
          "Read all source files before analysis and return the six forensic sections.",
        ].join("\n"),
        history: [],
        projectContext: makeContext(),
        rootPath,
        provider: "openrouter",
        apiKey: "test-or-key",
        onStep: (step) => {
          if (step.kind === "forensic_packet") {
            packets.push({
              root: step.root,
              packetIndex: step.packetIndex,
              status: step.status,
              reason: step.reason,
            });
          }
        },
      });

      expect(calls).toHaveLength(3);
      expect(packets).toEqual(expect.arrayContaining([
        expect.objectContaining({
          root: "root-a",
          packetIndex: 0,
          status: "ACCEPTED",
        }),
        expect.objectContaining({
          root: "root-b",
          packetIndex: 1,
          status: "FAILED",
          reason: expect.stringContaining("simulated packet processing crash"),
        }),
      ]));
      expect(result.response).toContain("ID: F-1 · First packet finding");
      expect(result.response).toContain("`export const first = true;`");
      expect(result.response).toContain("FINDING PROVEN");
      expect(result.response).not.toContain("No verified forensic verdict was produced");
       expect(result.sources).toContain("root-a/lib/ai-orchestrator/src/first.ts");
      expect(result.pendingChanges).toEqual([]);
    } finally {
      await fs.rm(rootPath, { recursive: true, force: true });
    }
  });

  it("preserves a first-packet Finding when the final packet exhausts its model chain", async () => {
    // Regression for task-49: when packet 0 is accepted and packet 1 fails all
    // its recovery attempts (here: parse failure with no fallback model),
    // finalizeMergedRecovery() must be called before the loop breaks so the
    // surviving first-packet Finding reaches the final response.
    const rootPath = await fs.mkdtemp(path.join(tmpdir(), "eos-multi-root-surviving-packet-"));
    await fs.mkdir(path.join(rootPath, "root-a", "lib", "ai-orchestrator", "src"), { recursive: true });
    await fs.mkdir(path.join(rootPath, "root-b"), { recursive: true });
    await fs.writeFile(
      path.join(rootPath, "root-a", "lib", "ai-orchestrator", "src", "verified.ts"),
      "export function unsafeEval(input: string) { return eval(input); }\n",
      "utf8",
    );
    await fs.writeFile(
      path.join(rootPath, "root-b", "safe.ts"),
      "export const safeValue = true;\n",
      "utf8",
    );

    const calls: Array<{ tools?: unknown; model?: string }> = [];
    const packets: Array<{ root?: string; packetIndex?: number; status?: string }> = [];
    const fakeStrategy = {
      providerId: "openrouter",
      supportsNativeStream: false,
      ownsModelFallback: true,
      call: vi.fn(async (
        _messages: unknown,
        opts: { tools?: unknown; model?: string },
      ) => {
        calls.push({ tools: opts.tools, model: opts.model });
        if (calls.length === 1) {
          // Initial synthesis — fails the forensic contract, triggering recovery.
          return {
            content: JSON.stringify({
              response: "The initial synthesis did not satisfy the forensic report contract.",
              sources: [],
            }),
            toolCalls: [],
            model: "initial-model",
            usage: {},
          };
        }
        if (calls.length === 2) {
          // Packet 0 (root-a) recovery — returns a valid structured envelope.
          return {
            content: JSON.stringify({
              verdict: "FINDING_PROVEN",
              findings: [{
                id: "F-01",
                title: "Dynamic evaluation executes input",
                files: ["root-a/lib/ai-orchestrator/src/verified.ts"],
                evidence: "`return eval(input);`",
                whyItMatters: "Caller-controlled input reaches executable evaluation.",
                rootCause: "The implementation evaluates the input string directly.",
                fix: "Replace dynamic evaluation with an allow-listed parser.",
              }],
              repairPlan: [{
                findingId: "F-01",
                steps: ["Replace dynamic evaluation and add a focused regression test."],
              }],
              validationChecklist: ["Run the focused behavior and security tests."],
            }),
            toolCalls: [],
            model: "initial-model",
            usage: {},
          };
        }
        // Packet 1 (root-b) recovery — returns unparseable content.
        // With a single-model chain, this exhausts all recovery attempts for
        // packet 1 and triggers finalizeMergedRecovery() before the loop breaks.
        return {
          content: "not valid JSON for packet 1",
          toolCalls: [],
          model: "initial-model",
          usage: {},
        };
      }),
      stream: vi.fn(),
    };

    vi.doMock("../provider-registry.js", async () => {
      const actual = await vi.importActual("../provider-registry.js") as Record<string, unknown>;
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
        // Single-model chain: no fallback, so packet 1 exhausts after one attempt.
        fallbackChain: ["initial-model"],
      })),
    }));
    vi.doMock("../openrouter/model-resolver.js", () => ({
      // No fallback models: packet 1's failure is terminal after one attempt.
      resolveFallbackChain: vi.fn(() => []),
      isCatalogFreeModelForCapability: vi.fn(() => true),
    }));

    try {
      const { chat } = await import("../agents/chat-agent.js");
      const result = await chat({
        message: [
          "Perform a forensic audit only inside ./root-a then ./root-b, in this order.",
          "Read all source files before analysis and return the six forensic sections.",
        ].join("\n"),
        history: [],
        projectContext: makeContext(),
        rootPath,
        provider: "openrouter",
        apiKey: "test-or-key",
        onStep: (step) => {
          if (step.kind === "forensic_packet") {
            packets.push({
              root: step.root,
              packetIndex: step.packetIndex,
              status: step.status,
            });
          }
        },
      });

      // The final packet (root-b) must have been emitted as REJECTED (parse
      // failure) after exhausting its single-model chain.
      expect(packets).toEqual(expect.arrayContaining([
        expect.objectContaining({ root: "root-a", packetIndex: 0, status: "ACCEPTED" }),
        expect.objectContaining({ root: "root-b", packetIndex: 1, status: "REJECTED" }),
      ]));
      // The first-packet Finding must appear in the merged result — the core
      // regression: finalizeMergedRecovery() must be called before the break.
      expect(result.response).toContain("ID: F-1 · Dynamic evaluation executes input");
      expect(result.response).toContain("`return eval(input);`");
      expect(result.response).toContain("FINDING PROVEN");
      expect(result.response).not.toContain("No verified forensic verdict was produced");
       expect(result.sources).toContain("root-a/lib/ai-orchestrator/src/verified.ts");
      expect(result.pendingChanges).toEqual([]);
    } finally {
      await fs.rm(rootPath, { recursive: true, force: true });
    }
  });

  it("keeps a complete packet Finding visible while blocking repair under partial global coverage", async () => {
    const rootPath = await fs.mkdtemp(path.join(tmpdir(), "eos-partial-scope-finding-"));
    await fs.mkdir(path.join(rootPath, "root-a", "lib", "ai-orchestrator", "src"), { recursive: true });
    await fs.mkdir(path.join(rootPath, "root-b"), { recursive: true });
    await fs.writeFile(
      path.join(rootPath, "root-a", "lib", "ai-orchestrator", "src", "verified.ts"),
      "export function unsafeEval(input: string) { return eval(input); }\n",
      "utf8",
    );
    // The ordered forensic prefetch has a bounded shared budget. More files
    // than the raised budget make root-b partial while root-a remains complete.
    for (let index = 0; index < 280; index += 1) {
      await fs.writeFile(
        path.join(rootPath, "root-b", `source-${index}.ts`),
        `export const source${index} = ${index};\n`,
        "utf8",
      );
    }

    const calls: Array<{ model?: string }> = [];
    const diagnostics: Array<{ code: string; details?: string[] }> = [];
    const fakeStrategy = {
      providerId: "openrouter",
      supportsNativeStream: false,
      ownsModelFallback: true,
      call: vi.fn(async (
        _messages: unknown,
        opts: { model?: string },
      ) => {
        calls.push({ model: opts.model });
        if (calls.length === 1) {
          return {
            content: JSON.stringify({
              response: "The initial synthesis did not satisfy the forensic report contract.",
              sources: [],
            }),
            toolCalls: [],
            model: "initial-model",
            usage: {},
          };
        }
        if (calls.length === 2) {
          return {
            content: JSON.stringify({
              verdict: "FINDING_PROVEN",
              findings: [{
                id: "F-01",
                title: "Dynamic evaluation executes input",
                files: ["root-a/lib/ai-orchestrator/src/verified.ts"],
                evidence: "`return eval(input);`",
                whyItMatters: "Caller-controlled input reaches executable evaluation.",
                rootCause: "The implementation evaluates the input string directly.",
                fix: "Replace dynamic evaluation with an allow-listed parser.",
              }],
              repairPlan: [{
                findingId: "F-01",
                steps: ["Replace dynamic evaluation and add a focused regression test."],
              }],
              validationChecklist: ["Run the focused behavior and security tests."],
            }),
            toolCalls: [],
            model: opts.model ?? "recovery-model",
            usage: {},
          };
        }
        // The later packet is deliberately unparseable. finalizeMergedRecovery
        // must still retain the already accepted root-a Finding.
        return {
          content: "not valid JSON for the partial packet",
          toolCalls: [],
          model: opts.model ?? "recovery-model",
          usage: {},
        };
      }),
      stream: vi.fn(),
    };

    vi.doMock("../provider-registry.js", async () => {
      const actual = await vi.importActual("../provider-registry.js") as Record<string, unknown>;
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
      resolveFallbackChain: vi.fn(() => []),
      isCatalogFreeModelForCapability: vi.fn(() => true),
    }));

    try {
      const { chat } = await import("../agents/chat-agent.js");
      const result = await chat({
        message: [
          "Perform a forensic audit only inside ./root-a then ./root-b, in this order.",
          "Read all source files before analysis and return the six forensic sections.",
        ].join("\n"),
        history: [],
        projectContext: makeContext(),
        rootPath,
        provider: "openrouter",
        apiKey: "test-or-key",
        onStep: (step) => {
          if (step.kind === "diagnostic") {
            diagnostics.push({ code: step.code, details: step.details });
          }
        },
      });

      expect(calls).toHaveLength(3);
      expect(result.response).toContain("ID: F-1 · Dynamic evaluation executes input");
      expect(result.response).toContain("`return eval(input);`");
      expect(result.response).toContain("NOT PROVEN");
      expect(result.response).not.toContain("Phase 1 (F-1):");
      expect(result.response).not.toMatch(/\bNO FINDING\b/);
      expect(result.pendingChanges).toEqual([]);
      expect(diagnostics.map((diagnostic) => diagnostic.code)).toContain(
        "FORENSIC_PARTIAL_SCOPE_FINDING",
      );
      const partialDetails = diagnostics.find(
        (diagnostic) => diagnostic.code === "FORENSIC_PARTIAL_SCOPE_FINDING",
      )?.details?.join(" ") ?? "";
      expect(partialDetails).toContain("PARTIAL");
      expect(partialDetails).toContain("BLOCKED");
    } finally {
      await fs.rm(rootPath, { recursive: true, force: true });
    }
  });

  it("keeps the global judgment NOT PROVEN when every forensic packet has no Finding", async () => {
    const rootPath = await fs.mkdtemp(path.join(tmpdir(), "eos-multi-root-no-finding-"));
    await fs.mkdir(path.join(rootPath, "root-a"), { recursive: true });
    await fs.mkdir(path.join(rootPath, "root-b"), { recursive: true });
    await fs.writeFile(
      path.join(rootPath, "root-a", "first.ts"),
      "export const first = true;\n",
      "utf8",
    );
    await fs.writeFile(
      path.join(rootPath, "root-b", "second.ts"),
      "export const second = true;\n",
      "utf8",
    );

    const calls: Array<{ tools?: unknown; model?: string }> = [];
    const packets: Array<{ root?: string; status?: string }> = [];
    const fakeStrategy = {
      providerId: "openrouter",
      supportsNativeStream: false,
      ownsModelFallback: true,
      call: vi.fn(async (
        _messages: unknown,
        opts: { tools?: unknown; model?: string },
      ) => {
        calls.push({ tools: opts.tools, model: opts.model });
        if (calls.length === 1) {
          return {
            content: JSON.stringify({
              response: "The initial synthesis needs forensic contract recovery.",
              sources: [],
            }),
            toolCalls: [],
            model: "initial-model",
            usage: {},
          };
        }
        return {
          content: JSON.stringify({
            verdict: "NO_FINDING",
            findings: [],
            repairPlan: [],
            validationChecklist: [],
          }),
          toolCalls: [],
          model: opts.model ?? "recovery-model",
          usage: {},
        };
      }),
      stream: vi.fn(),
    };

    vi.doMock("../provider-registry.js", async () => {
      const actual = await vi.importActual("../provider-registry.js") as Record<string, unknown>;
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
        fallbackChain: ["initial-model", "recovery-model"],
      })),
    }));
    vi.doMock("../openrouter/model-resolver.js", () => ({
      resolveFallbackChain: vi.fn(() => [{ id: "recovery-model" }]),
      isCatalogFreeModelForCapability: vi.fn(() => true),
    }));

    try {
      const { chat } = await import("../agents/chat-agent.js");
      const result = await chat({
        message: [
          "Perform a forensic audit only inside ./root-a then ./root-b, in this order.",
          "Read all source files before analysis and return the six forensic sections.",
        ].join("\n"),
        history: [],
        projectContext: makeContext(),
        rootPath,
        provider: "openrouter",
        apiKey: "test-or-key",
        onStep: (step) => {
          if (step.kind === "forensic_packet") {
            packets.push({ root: step.root, status: step.status });
          }
        },
      });

      expect(calls).toHaveLength(3);
      expect(packets).toEqual(expect.arrayContaining([
        expect.objectContaining({ root: "root-a", status: "ACCEPTED" }),
        expect.objectContaining({ root: "root-b", status: "ACCEPTED" }),
      ]));
      expect(result.response).toContain("## 6) Final Judgment");
      expect(result.response).toContain("ANALYSIS_INCOMPLETE — no verified defect was established");
      expect(result.response).not.toContain("NO FINDING — no verified defect was established");
      expect(result.response).toContain("No repair phases identified");
      expect(result.pendingChanges).toEqual([]);
    } finally {
      await fs.rm(rootPath, { recursive: true, force: true });
    }
  });

  it(
    "proves a fixture-local Finding when a capability audit provider returns no Finding",
    async () => {
    const rootPath = await fs.mkdtemp(path.join(tmpdir(), "eos-behavioral-recovery-"));
      const fixturePath = path.join(rootPath, "lib", "ai-orchestrator", "src", "__tests__", "fixtures", "known-defect.ts");
     await fs.mkdir(path.dirname(fixturePath), { recursive: true });
    const fixture = "export function evaluateUserExpression(expression: string): unknown {\n  return eval(expression);\n}\n";
    await fs.writeFile(fixturePath, fixture, "utf8");

    const initialReport = [
      "تم فحص الملف وإثبات العيب محليًا فقط، ولا يثبت ذلك قابلية الوصول في الإنتاج.",
      "## 1) Executive Verdict",
      "No verified Finding was established from the completed source reads.",
      "## 2) Evidence Map",
       "File: `lib/ai-orchestrator/src/__tests__/fixtures/known-defect.ts`",
       "Role: fixture source",
      "Evidence: `return eval(expression);`",
      "Risk: NOT PROVEN",
      "Notes: FACT",
      "## 3) Findings",
      "No verified finding identified from inspected source code.",
      "## 4) Repair Plan",
      "No repair phases identified because no executable Finding was accepted.",
      "## 5) Validation Checklist",
      "No validation scenario available.",
      "## 6) Final Judgment",
      "NO FINDING — no verified defect was established, so no Repair Plan is executable.",
    ].join("\n");
    assertArabicForensicFixture(
      "اختبر قدرة التحليل الجنائي على هذا الملف فقط",
      initialReport,
      "chat-agent-fixture-capability-arabic-report",
    );
    const calls: Array<{ tools?: unknown; model?: string }> = [];
    const providerResponses = [
      {
        content: "",
        toolCalls: [{
          id: "read-known-defect",
          type: "function" as const,
          function: {
            name: "read_file",
            arguments: JSON.stringify({ path: "lib/ai-orchestrator/src/__tests__/fixtures/known-defect.ts" }),
          },
        }],
        model: "initial-model",
        usage: {},
      },
      {
        content: JSON.stringify({ response: initialReport, sources: ["lib/ai-orchestrator/src/__tests__/fixtures/known-defect.ts"] }),
        toolCalls: [],
        model: "initial-model",
        usage: {},
      },
      {
        content: JSON.stringify({
          verdict: "NO_FINDING",
          findings: [],
          repairPlan: [],
          validationChecklist: [],
        }),
        toolCalls: [],
        model: "recovery-model",
        usage: {},
      },
    ];
    const fakeStrategy = {
      providerId: "openrouter",
      supportsNativeStream: false,
      ownsModelFallback: true,
      call: vi.fn(async (
        _messages: unknown,
        opts: { tools?: unknown; model?: string },
      ) => {
        calls.push({ tools: opts.tools, model: opts.model });
        return takeFixture(providerResponses, "chat-agent-fixture-capability-provider-turn");
      }),
      stream: vi.fn(),
    };

    vi.doMock("../provider-registry.js", async () => {
      const actual = await vi.importActual("../provider-registry.js") as Record<string, unknown>;
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
        fallbackChain: ["initial-model", "recovery-model"],
      })),
    }));
    vi.doMock("../openrouter/model-resolver.js", () => ({
      resolveFallbackChain: vi.fn(() => [
        { id: "recovery-model" },
        { id: "final-model" },
      ]),
      isCatalogFreeModelForCapability: vi.fn(() => true),
    }));

    try {
      const { chat } = await import("../agents/chat-agent.js");
      const result = await chat({
         message: [
           "اختبر قدرة التحليل الجنائي على هذا الملف فقط:",
           "lib/ai-orchestrator/src/__tests__/fixtures/known-defect.ts",
         ].join("\n"),
        history: [],
        projectContext: makeContext(),
        rootPath,
        provider: "openrouter",
        apiKey: "test-or-key",
      });

      expect(result.response).toContain("## 2) Evidence Map");
      expect(result.response).toContain("known-defect.ts");
       expect(result.response).toContain("ID: F-01 · FIXTURE-LOCAL: التقييم الديناميكي ينفذ نص المصدر أثناء التشغيل");
      expect(result.response).toContain("`return eval(expression);`");
       expect(result.response).toContain("الوصول إلى production غير مُثبت");
       expect(result.response).toContain("لا توجد مراحل إصلاح مصرح بها ضمن نطاق هذا التدقيق");
       expect(result.response).not.toContain("Phase 1 (F-01):");
      expect(result.response).not.toContain("NO FINDING — no verified defect was established");
      expect(result.pendingChanges).toEqual([]);
       expect(result.sources).toContain("lib/ai-orchestrator/src/__tests__/fixtures/known-defect.ts");
      expect(calls.length).toBeGreaterThanOrEqual(3);
    } finally {
      await fs.rm(rootPath, { recursive: true, force: true });
    }
    },
  );

  it("emits FIXTURE_LOCAL audit scope with NOT_PROVEN reachability for an explicit fixture audit", async () => {
    // Task #43: a fixture capability audit must surface its proof as
    // source-local. The forensic_status event must carry auditScope
    // FIXTURE_LOCAL and productionReachability NOT_PROVEN, and the fixture
    // file must be left unmodified with no executable repair phase.
    const rootPath = await fs.mkdtemp(path.join(tmpdir(), "eos-fixture-local-"));
    const fixturePath = path.join(rootPath, "__tests__", "fixtures", "known-defect.ts");
    await fs.mkdir(path.dirname(fixturePath), { recursive: true });
    const fixtureSrc = "export function evaluateUserExpression(expression: string): unknown {\n  return eval(expression);\n}\n";
    await fs.writeFile(fixturePath, fixtureSrc, "utf8");

    // Provider returns a six-section report that names the fixture as the
    // proven source — the structured path drives emitForensicStatus.
    const initialReport = [
      "تم فحص الدليل المتاح، لكن لم يُثبت وجود عيب قابل للتنفيذ.",
      "## 1) Executive Verdict",
      "Fixture-local Finding proven in known-defect.ts.",
      "## 2) Evidence Map",
      "File: `__tests__/fixtures/known-defect.ts`",
      "Role: fixture source read during the forensic scan",
      "Evidence: `return eval(expression);`",
      "Risk: FIXTURE-LOCAL only",
      "Notes: FACT",
      "## 3) Findings",
      "* ID: F-01 · Fixture-local — Dynamic evaluation executes source text at runtime",
      "* File(s): `__tests__/fixtures/known-defect.ts`",
      "* Evidence: `return eval(expression);`",
      "* Why it matters: Production reachability is NOT PROVEN.",
      "* Root cause: eval on untrusted input",
      "* Fix: Do not modify this fixture.",
      "## 4) Repair Plan",
      "No executable repair phase is authorized for a fixture-local Finding.",
      "## 5) Validation Checklist",
      "- pass: fixture file unchanged",
      "## 6) Final Judgment",
      "FIXTURE-LOCAL — the Finding is proven only inside the fixture.",
    ].join("\n");
    assertArabicFixtureResponse(initialReport, "chat-agent-fixture-local-arabic-report");

    const calls: Array<{ model?: string }> = [];
    const fakeStrategy = {
      providerId: "openrouter",
      supportsNativeStream: false,
      ownsModelFallback: true,
      call: vi.fn(async (
        _messages: unknown,
        opts: { model?: string },
      ) => {
        calls.push({ model: opts.model });
        return {
          content: JSON.stringify({ response: initialReport, sources: ["__tests__/fixtures/known-defect.ts"] }),
          toolCalls: [],
          model: opts.model ?? "initial-model",
          usage: {},
        };
      }),
      stream: vi.fn(),
    };

    vi.doMock("../provider-registry.js", async () => {
      const actual = await vi.importActual("../provider-registry.js") as Record<string, unknown>;
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
        fallbackChain: ["initial-model", "recovery-model"],
      })),
    }));
    vi.doMock("../openrouter/model-resolver.js", () => ({
      resolveFallbackChain: vi.fn(() => [
        { id: "recovery-model" },
        { id: "final-model" },
      ]),
      isCatalogFreeModelForCapability: vi.fn(() => true),
    }));

    try {
      const { chat } = await import("../agents/chat-agent.js");
      const forensicStatuses: Array<Record<string, unknown>> = [];
      const result = await chat({
        // Arabic phrase that the classifier routes to an explicit fixture
        // capability audit (single file, fixture-local proof only).
        message: [
          "اختبر قدرة التحليل الجنائي لملف واحد فقط — fixture معروف العيب:",
          "__tests__/fixtures/known-defect.ts",
          "أثبت العيب محليًا فقط، ولا تدّعِ قابلية الوصول في الإنتاج.",
        ].join("\n"),
        history: [],
        projectContext: makeContext(),
        rootPath,
        provider: "openrouter",
        apiKey: "test-or-key",
        onStep: (step) => {
          if (step.kind === "forensic_status") {
            forensicStatuses.push({
              auditScope: step.auditScope,
              productionReachability: step.productionReachability,
              sourceCoverage: step.sourceCoverage,
              findingStatus: step.findingStatus,
              repairReadiness: step.repairReadiness,
            });
          }
        },
      });

      expect(forensicStatuses.length).toBeGreaterThan(0);
      expect(forensicStatuses.every((s) => s.auditScope === "FIXTURE_LOCAL")).toBe(true);
      expect(forensicStatuses.every((s) => s.productionReachability === "NOT_PROVEN")).toBe(true);

      // The fixture file is never modified and no repair change is proposed.
      const after = await fs.readFile(fixturePath, "utf8");
      expect(after).toBe(fixtureSrc);
      expect(result.pendingChanges).toEqual([]);
    } finally {
      await fs.rm(rootPath, { recursive: true, force: true });
    }
  });

  it("emits FIXTURE_LOCAL when Finding File(s) is fixture-only even though an incidental production file was also read", async () => {
    // Task #43 correctness regression: fixture-locality must come from the
    // File(s) paths listed in the Findings section of the gated report, NOT
    // from the union of all files read during the session.  An incidental
    // production read must not mask a fixture-only verdict.
    const rootPath = await fs.mkdtemp(path.join(tmpdir(), "eos-mixed-read-"));
    const fixturePath = path.join(rootPath, "__tests__", "fixtures", "known-defect.ts");
    const productionPath = path.join(rootPath, "src", "main.ts");
    await fs.mkdir(path.dirname(fixturePath), { recursive: true });
    await fs.mkdir(path.dirname(productionPath), { recursive: true });
    await fs.writeFile(
      fixturePath,
      "export function evaluateUserExpression(expression: string): unknown {\n  return eval(expression);\n}\n",
      "utf8",
    );
    await fs.writeFile(productionPath, "export function main() {}\n", "utf8");

    // The mock report cites only the fixture file in the Evidence Map and
    // Findings section.  The free-form `sources` JSON array also includes
    // `src/main.ts` (simulating a model that over-reports its reads).
    // After the fix, `extractFindingFilePaths` extracts only the fixture path
    // from the Findings section — `src/main.ts` appearing in `sources` must
    // not affect the FIXTURE_LOCAL verdict.
    const report = [
      "## 1) Executive Verdict",
      "Fixture-local Finding proven in known-defect.ts.",
      "## 2) Evidence Map",
      "File: `__tests__/fixtures/known-defect.ts`",
      "Role: fixture source — the proven defect lives here",
      "Evidence: `return eval(expression);`",
      "Risk: FIXTURE-LOCAL",
      "Notes: FACT",
      "## 3) Findings",
      "* ID: F-01 · Fixture-local — Dynamic evaluation executes source text at runtime",
      "* File(s): `__tests__/fixtures/known-defect.ts`",
      "* Evidence: `return eval(expression);`",
      "* Why it matters: Production reachability is NOT PROVEN.",
      "* Root cause: eval on untrusted input",
      "* Fix: Do not modify this fixture.",
      "## 4) Repair Plan",
      "No executable repair phase is authorized for a fixture-local Finding.",
      "## 5) Validation Checklist",
      "- pass: fixture file unchanged",
      "## 6) Final Judgment",
      "FIXTURE-LOCAL — the Finding is proven only inside the fixture.",
    ].join("\n");

    const fakeStrategy = {
      providerId: "openrouter",
      supportsNativeStream: false,
      ownsModelFallback: true,
      call: vi.fn(async (_messages: unknown, opts: { model?: string }) => ({
        content: JSON.stringify({
          response: report,
          sources: [
            "__tests__/fixtures/known-defect.ts",
            "src/main.ts",   // incidental production source in free-form array
          ],
        }),
        toolCalls: [],
        model: opts.model ?? "initial-model",
        usage: {},
      })),
      stream: vi.fn(),
    };

    vi.doMock("../provider-registry.js", async () => {
      const actual = await vi.importActual("../provider-registry.js") as Record<string, unknown>;
      return { ...actual, getStrategy: vi.fn(() => fakeStrategy) };
    });
    vi.doMock("../agents/query-planner.js", () => ({ planQuery: vi.fn().mockResolvedValue(null) }));
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
      isCatalogFreeModelForCapability: vi.fn(() => true),
    }));

    try {
      const { chat } = await import("../agents/chat-agent.js");
      const forensicStatuses: Array<Record<string, unknown>> = [];
      await chat({
        // Same phrase as the fixture-audit test — "لملف واحد فقط" is the
        // classifier trigger for singleFileForensicMode / structuredOutputMode.
        message: [
          "اختبر قدرة التحليل الجنائي لملف واحد فقط — fixture مع سياق إنتاجي:",
          "__tests__/fixtures/known-defect.ts",
          "أثبت العيب محليًا فقط، ولا تدّعِ قابلية الوصول في الإنتاج.",
        ].join("\n"),
        history: [],
        projectContext: makeContext(),
        rootPath,
        provider: "openrouter",
        apiKey: "test-or-key",
        onStep: (step) => {
          if (step.kind === "forensic_status") {
            forensicStatuses.push({
              auditScope: step.auditScope,
              productionReachability: step.productionReachability,
              repairReadiness: step.repairReadiness,
            });
          }
        },
      });

      expect(forensicStatuses.length).toBeGreaterThan(0);
      // Despite src/main.ts appearing in the free-form sources array, the
      // Findings section only cites the fixture file → FIXTURE_LOCAL must win.
      expect(forensicStatuses.every((s) => s.auditScope === "FIXTURE_LOCAL")).toBe(true);
      expect(forensicStatuses.every((s) => s.productionReachability === "NOT_PROVEN")).toBe(true);
      expect(forensicStatuses.every((s) => s.repairReadiness === "BLOCKED")).toBe(true);
    } finally {
      await fs.rm(rootPath, { recursive: true, force: true });
    }
  });

  it("emits PRODUCTION + NOT_PROVEN for a non-fixture isolated Finding with no explicit reachability evidence", async () => {
    // Task #43: a production Finding in a non-fixture file must NOT claim
    // production reachability PROVEN — there is no dedicated evidence contract
    // for caller or input-path proof, so productionReachability must remain
    // NOT_PROVEN even when the Finding is in a production source file.
    const rootPath = await fs.mkdtemp(path.join(tmpdir(), "eos-prod-no-reach-"));
    const sourcePath = path.join(rootPath, "src", "query.ts");
    await fs.mkdir(path.dirname(sourcePath), { recursive: true });
    await fs.writeFile(
      sourcePath,
      "export function buildQuery(input: string): string { return `SELECT * WHERE id = ${input}`; }\n",
      "utf8",
    );

    const report = [
      "## 1) Executive Verdict",
      "A SQL-injection defect was proven in a production source file.",
      "## 2) Evidence Map",
      "File: `src/query.ts`",
      "Role: implementation source",
      "Evidence: `SELECT * WHERE id = ${input}`",
      "Risk: HIGH",
      "Notes: FACT",
      "## 3) Findings",
      "* ID: F-01 · SQL injection via string interpolation",
      "* File(s): `src/query.ts`",
      "* Evidence: `return \\`SELECT * WHERE id = ${input}\\`;`",
      "* Why it matters: Untrusted user input reaches the SQL query builder.",
      "* Root cause: Unparameterised query construction",
      "* Fix: Use parameterised queries.",
      "## 4) Repair Plan",
      "Phase 1 (F-01): replace string interpolation with a parameterised query in src/query.ts",
      "## 5) Validation Checklist",
      "- Add test: parameterised query rejects injection payloads",
      "## 6) Final Judgment",
      "PROVEN — a verified defect was found; see Repair Plan.",
    ].join("\n");

    const fakeStrategy = {
      providerId: "openrouter",
      supportsNativeStream: false,
      ownsModelFallback: true,
      call: vi.fn(async (_messages: unknown, opts: { model?: string }) => ({
        content: JSON.stringify({ response: report, sources: ["src/query.ts"] }),
        toolCalls: [],
        model: opts.model ?? "initial-model",
        usage: {},
      })),
      stream: vi.fn(),
    };

    vi.doMock("../provider-registry.js", async () => {
      const actual = await vi.importActual("../provider-registry.js") as Record<string, unknown>;
      return { ...actual, getStrategy: vi.fn(() => fakeStrategy) };
    });
    vi.doMock("../agents/query-planner.js", () => ({ planQuery: vi.fn().mockResolvedValue(null) }));
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
      isCatalogFreeModelForCapability: vi.fn(() => true),
    }));

    try {
      const { chat } = await import("../agents/chat-agent.js");
      const forensicStatuses: Array<Record<string, unknown>> = [];
      await chat({
        // Message format matches the fixture-audit test so the classifier
        // routes this as a single-file forensic scan (structuredOutputMode=true).
        message: [
          "اختبر قدرة التحليل الجنائي لملف واحد فقط — ملف إنتاجي:",
          "src/query.ts",
          "ابحث عن ثغرات الحقن وأثبت وجود العيب.",
        ].join("\n"),
        history: [],
        projectContext: makeContext(),
        rootPath,
        provider: "openrouter",
        apiKey: "test-or-key",
        onStep: (step) => {
          if (step.kind === "forensic_status") {
            forensicStatuses.push({
              auditScope: step.auditScope,
              productionReachability: step.productionReachability,
            });
          }
        },
      });

      expect(forensicStatuses.length).toBeGreaterThan(0);
      // Finding is in a production file → auditScope must be PRODUCTION.
      expect(forensicStatuses.every((s) => s.auditScope === "PRODUCTION")).toBe(true);
      // No dedicated caller/input-path reachability contract → always NOT_PROVEN.
      expect(forensicStatuses.every((s) => s.productionReachability === "NOT_PROVEN")).toBe(true);
    } finally {
      await fs.rm(rootPath, { recursive: true, force: true });
    }
  });

  it("runs recovery when the initial contract only rebuilt the Evidence Map", async () => {
    const rootPath = await fs.mkdtemp(path.join(tmpdir(), "eos-forensic-map-recovery-"));
    await fs.writeFile(
      path.join(rootPath, "verified.ts"),
      "export function verifiedRead() { return true; }\n",
      "utf8",
    );

    const calls: Array<{
      tools?: unknown;
      model?: string;
      maxTokens?: number;
      messages?: unknown;
    }> = [];
    const recoveredReport = [
      "## 1) Executive Verdict",
      "The inspected source was read successfully; no verified defect was identified.",
      "## 2) Evidence Map",
      "File: `verified.ts`",
      "Role: implementation source",
      "Evidence: `export function verifiedRead() { return true; }`",
      "Risk: NOT PROVEN",
      "Notes: The available read supports only the verified statement above.",
      "## 3) Findings",
      "No verified finding identified from inspected source code.",
      "## 4) Repair Plan",
      "No repair phases identified because no executable Finding was accepted.",
      "## 5) Validation Checklist",
      "No validation scenario available.",
      "## 6) Final Judgment",
      "NOT PROVEN — no verified defect was established.",
    ].join("\n");
    const staleSynthesis = JSON.stringify({
      response: [
        "## 1) Executive Verdict",
        "NOT PROVEN — the available evidence is insufficient.",
        "## 2) Evidence Map",
        "File: `stale.ts`",
        "Role: implementation source",
        "Evidence: `const stale = true`",
        "Risk: NOT PROVEN",
        "Notes: FACT",
        "## 3) Findings",
        "No verified finding identified from inspected source code.",
        "## 4) Repair Plan",
        "No repair phases identified.",
        "## 5) Validation Checklist",
        "No validation scenario available.",
        "## 6) Final Judgment",
        "NOT PROVEN — insufficient evidence.",
        "## 2) Evidence Map",
      ].join("\n"),
      sources: ["stale.ts"],
    });
    const fakeStrategy = {
      providerId: "openrouter",
      supportsNativeStream: false,
      ownsModelFallback: true,
      call: vi.fn(async (
        _messages: unknown,
        opts: { tools?: unknown; model?: string; maxTokens?: number },
      ) => {
        calls.push({
          tools: opts.tools,
          model: opts.model,
          maxTokens: opts.maxTokens,
          messages: _messages,
        });
        if (calls.length === 1) {
          return {
            content: "",
            toolCalls: [{
              id: "read-verified",
              type: "function" as const,
              function: {
                name: "read_file",
                arguments: JSON.stringify({ path: "verified.ts" }),
              },
            }],
            model: "initial-model",
            usage: {},
          };
        }
        if (calls.length === 2) {
          return {
            content: staleSynthesis,
            toolCalls: [],
            model: "initial-model",
            usage: {},
          };
        }
        if (calls.length === 3) {
          return {
            content: JSON.stringify({
              response: [
                "## 1) Executive Verdict",
                "The codebase is robust and comprehensive.",
                "## 2) Evidence Map",
                "File: `verified.ts`",
                "Role: implementation source",
                "Evidence: `export function verifiedRead() { return true; }`",
                "Risk: NOT PROVEN",
                "Notes: FACT",
                "## 2) Evidence Map",
                "## 3) Findings",
                "No verified finding identified from inspected source code.",
                "## 4) Repair Plan",
                "No repair phases identified.",
                "## 5) Validation Checklist",
                "No validation scenario available.",
                "## 6) Final Judgment",
                "NOT PROVEN — insufficient evidence.",
              ].join("\n"),
              sources: ["verified.ts"],
            }),
            toolCalls: [],
            model: "recovery-model",
            usage: {},
          };
        }
        return {
          content: [
            JSON.stringify({ response: "Recovery summary only", sources: ["verified.ts"] }),
            recoveredReport,
          ].join("\n"),
          toolCalls: [],
          model: "final-model",
          usage: {},
        };
      }),
      stream: vi.fn(),
    };

    vi.doMock("../provider-registry.js", async () => {
      const actual = await vi.importActual("../provider-registry.js") as Record<string, unknown>;
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
        fallbackChain: ["initial-model", "recovery-model", "final-model"],
      })),
    }));
    vi.doMock("../openrouter/model-resolver.js", () => ({
      resolveFallbackChain: vi.fn(() => [
        { id: "recovery-model" },
        { id: "final-model" },
      ]),
      isCatalogFreeModelForCapability: vi.fn(() => true),
    }));

    try {
      const { chat } = await import("../agents/chat-agent.js");
      const result = await chat({
        message: [
          "You are a forensic auditor. Perform a structured forensic audit and return exactly these sections.",
          "## 1) Executive Verdict",
          "## 2) Evidence Map",
          "## 3) Findings",
          "## 4) Repair Plan",
          "## 5) Validation Checklist",
          "## 6) Final Judgment",
        ].join("\n"),
        history: [],
        projectContext: makeContext(),
        rootPath,
        provider: "openrouter",
        apiKey: "test-or-key",
      });

      expect(calls).toHaveLength(4);
      expect(calls[0]?.tools).toBeDefined();
      expect(calls[1]?.tools).toBeDefined();
      // Recovery is now read-capable: the recovery model may re-read the actual
      // source to ground a disputed claim, so it is supplied read tools (never
      // write_file / replace_text). This replaces the old no-tools formatting pass.
      const recoveryToolNames = [calls[2], calls[3]].flatMap((call) =>
        Array.isArray(call?.tools)
          ? call.tools.map((tool) => (tool as { function?: { name?: string } }).function?.name)
          : [],
      );
      expect(calls[2]?.tools).toBeDefined();
      expect(calls[3]?.tools).toBeDefined();
      expect(recoveryToolNames.length).toBeGreaterThan(0);
      expect(recoveryToolNames).not.toContain("write_file");
      expect(recoveryToolNames).not.toContain("replace_text");
      expect(calls[2]?.maxTokens).toBe(4096);
      expect(calls[3]?.maxTokens).toBe(4096);
      const retryPrompt = JSON.stringify(calls[3]?.messages);
      expect(retryPrompt).toContain("duplicate required section: ## 2) Evidence Map");
      expect(retryPrompt).toContain("unverified broad quality or completeness claim");
      expect(result.response).toContain("File: `verified.ts`");
      expect(result.response).toContain("## 1) Executive Verdict");
      expect(result.response).toContain("## 6) Final Judgment");
      expect(result.response).not.toContain("Recovery summary only");
      expect(result.response).not.toContain("Completed source reads were preserved");
      expect(result.response).not.toContain("stale.ts");
      // The recovery request is pinned to the first candidate in the same
      // chain used by the subsequent fallback assertion.
      expect(calls[2]?.model).toBe("recovery-model");
      expect(calls[3]?.model).toBe("final-model");
    } finally {
      await fs.rm(rootPath, { recursive: true, force: true });
    }
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
    vi.doUnmock("../agents/query-planner.js");
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
              choices: [{ message: { content: '{"response":"تم","sources":[]}' } }],
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
    expect(result.response).toBe("تم");
  });

  it("returns a deterministic partial report for malformed task JSON without correction retry", async () => {
    const create = vi.fn().mockResolvedValue({
      choices: [{ message: { content: "The provider stopped before producing JSON." } }],
      model: "m",
      usage: {},
    });
    vi.doMock("groq-sdk", () => ({
      default: class {
        chat = { completions: { create } };
      },
    }));

    const { chat } = await import("../agents/chat-agent.js");
    const result = await chat({
      message: [
        "Please implement this task.",
        "Done looks like",
        "- Read `src/task.ts`.",
        "- Run the targeted tests.",
      ].join("\n"),
      history: [],
      projectContext: makeContext(),
      rootPath: "/tmp/project",
    });

    // One call is the bounded query planner; the second is the tool-loop
    // response. A malformed JSON correction would create a third call.
    expect(create).toHaveBeenCalledTimes(2);
    expect(result.response).toContain("Status: PARTIALLY_COMPLETE");
    expect(result.response).toContain("Trigger: MALFORMED_JSON");
    expect(result.response).toContain("Model consulted for this report: NO");
    expect(result.response).toContain("Read the required source file before continuing");
  });

  it("does not re-plan a short execution follow-up when a repair plan is present", async () => {
    const planQuery = vi.fn().mockRejectedValue(new Error("query planner must not run"));
    const decisionCalls: string[] = [];

    vi.doMock("../agents/query-planner.js", () => ({
      planQuery,
    }));

    vi.doMock("../model-selection/decision-engine.js", () => ({
      resolveExecutionDecision: vi.fn((scope: string) => {
        decisionCalls.push(scope);
        return { taskProfile: { taskType: scope } };
      }),
    }));

    vi.doMock("../model-selection/provider-strategy.js", () => ({
      resolveExecutionProvider: vi.fn((_, provider: string) => ({ providerId: provider })),
    }));

    vi.doMock("../model-selection/model-resolver.js", () => ({
      resolveExecutionModel: vi.fn(() => ({
        model: "llama-3.1-8b-instant",
        powerModel: "llama-3.3-70b-versatile",
      })),
    }));

    vi.doMock("groq-sdk", () => ({
      default: class {
        chat = {
          completions: {
            create: vi.fn().mockResolvedValue({
              choices: [{ message: { content: '{"response":"execution ready","sources":[]}' } }],
              model: "m",
              usage: {},
            }),
          },
        };
      },
    }));

    const { chat } = await import("../agents/chat-agent.js");
    const result = await chat({
      message: "نفذ الخطة",
      history: [
        { role: "user", content: "راجع الكود" },
        {
          role: "assistant",
          content: [
            "## Findings",
            "* ID: F-01 · HIGH",
            "* File(s): `lib/knowledge-engine/src/inference.ts`",
            "* Evidence: `const value = true`",
            "* Why it matters: the branch may be unsafe",
            "* Root cause: missing guard",
            "* Fix: add the guard",
            "## Repair Plan",
            "Phase 1 (F-01): update `lib/knowledge-engine/src/inference.ts`",
          ].join("\n"),
        },
      ],
      projectContext: makeContext(),
      rootPath: "/tmp",
    });

    expect(planQuery).not.toHaveBeenCalled();
    expect(decisionCalls).toEqual(["task_execution"]);
    expect(result.response).toContain("لم يتم إنشاء أي تغيير مقترح");
    expect(result.response).toContain("لم تُعدّل الملفات على القرص");
  });

  it("refuses a Repair Plan handoff when the prior audit is not in session history", async () => {
    vi.doMock("groq-sdk", () => ({
      default: class {
        chat = { completions: { create: vi.fn() } };
      },
    }));

    const { chat } = await import("../agents/chat-agent.js");
    const result = await chat({
      message: "نفذ Repair Plan",
      history: [],
      projectContext: makeContext(),
      rootPath: "/tmp/project",
    });

    expect(result.response).toMatch(/لم أجد خطة إصلاح سابقة|No prior Repair Plan/i);
    expect(result.pendingChanges).toEqual([]);
  });

  it("does not execute a recovered Repair Plan that contains validation-only phases", async () => {
    const create = vi.fn();
    vi.doMock("groq-sdk", () => ({
      default: class {
        chat = { completions: { create } };
      },
    }));

    const { chat } = await import("../agents/chat-agent.js");
    const result = await chat({
      message: "نفذ Repair Plan",
      history: [
        {
          role: "assistant",
          content: [
            "4) Repair Plan",
            "Phase 1 (F-01): Verify provenance edge cases — `lib/knowledge-engine/src/queries.ts`",
            "Phase 2 (F-02): Test semantic tags — `lib/knowledge-engine/src/__tests__/queries.test.ts`",
          ].join("\n"),
        },
      ],
      projectContext: makeContext(),
      rootPath: "/tmp/project",
    });

    expect(result.response).toMatch(/تم حظر تنفيذ خطة الإصلاح|execution.*blocked/i);
    expect(result.response).toMatch(/لم تُشغّل أدوات|No tools were run/i);
    expect(result.pendingChanges).toEqual([]);
    expect(create).not.toHaveBeenCalled();
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

  it("appends deterministic unfinished items after provider parse failure", async () => {
    const malformed = { content: "The provider stopped before producing JSON.", toolCalls: [] };
    vi.doMock("../openai-compatible-client.js", () => ({
      openrouterCompleteRaw: vi.fn().mockResolvedValue(malformed),
      openrouterCompleteWithFallback: vi.fn().mockResolvedValue(malformed),
      openrouterCompleteStream: vi.fn(),
      geminiCompleteRaw: vi.fn(),
      geminiCompleteStream: vi.fn(),
    }));

    const { chat } = await import("../agents/chat-agent.js");
    const result = await chat({
      message: [
        "Task #65 — Make task replies show which items were finished.",
        "Done looks like",
        "- Run the targeted tests.",
        "Relevant files",
        "- lib/ai-orchestrator/src/agents/chat-agent.ts",
      ].join("\n"),
      history: [],
      projectContext: makeContext(),
      provider: "openrouter",
      apiKey: "test-or-key",
    });

    expect(result.response).toContain("The provider stopped before producing JSON.");
    expect(result.response).toContain("## Deterministic task completion checklist");
    expect(result.response).toContain("### Unfinished items");
    expect(result.response).toContain("- Run the targeted tests.");
    expect(result._parseError?.code).toBeDefined();
  });
});

// ── TIMEOUT degradation: partial report instead of generic error ──────────────
// These tests verify chat-agent.ts handles kind:"partial"/reason:"provider_timeout"
// returned by executeToolLoop and produces a useful report rather than throwing.
describe("chat agent — TIMEOUT degradation (task #67)", () => {
  beforeEach(() => {
    vi.resetModules();
    process.env.GROQ_API_KEY = "test-key";
  });

  afterEach(() => {
    vi.doUnmock("../tool-execution-engine.js");
    vi.doUnmock("../openai-compatible-client.js");
    vi.doUnmock("../model-selection/decision-engine.js");
    vi.doUnmock("../model-selection/provider-strategy.js");
    vi.doUnmock("../model-selection/model-resolver.js");
    if (originalApiKey === undefined) delete process.env.GROQ_API_KEY;
    else process.env.GROQ_API_KEY = originalApiKey;
  });

  it("returns a partial report for task messages when the loop returns provider_timeout", async () => {
    // Simulate the engine having collected evidence (tool calls ran) but then
    // timing out during synthesis. The engine returns kind:"partial" with
    // reason:"provider_timeout". Chat-agent must build a deterministic partial
    // report rather than propagating a thrown error.
    vi.doMock("../openai-compatible-client.js", () => ({
      openrouterCompleteRaw: vi.fn(),
      openrouterCompleteWithFallback: vi.fn(),
      openrouterCompleteStream: vi.fn(),
      geminiCompleteRaw: vi.fn(),
      geminiCompleteStream: vi.fn(),
    }));

    vi.doMock("../tool-execution-engine.js", async () => {
      const actual = await vi.importActual("../tool-execution-engine.js") as Record<string, unknown>;
      return {
        ...actual,
        executeToolLoop: vi.fn(async () => ({
          kind: "partial",
          reason: "provider_timeout",
          result: {
            content: "",
            toolCalls: null,
            model: "llama-3.1-8b-instant",
            usage: { promptTokens: 120, completionTokens: 0 },
          },
          toolSources: ["src/index.ts"],
          fileContents: new Map([["src/index.ts", "export const x = 1;"]]),
        })),
      };
    });

    vi.doMock("../model-selection/decision-engine.js", () => ({
      resolveExecutionDecision: vi.fn((scope: string) => ({ taskProfile: { taskType: scope } })),
    }));
    vi.doMock("../model-selection/provider-strategy.js", () => ({
      resolveExecutionProvider: vi.fn((_, provider: string) => ({ providerId: provider })),
    }));
    vi.doMock("../model-selection/model-resolver.js", () => ({
      resolveExecutionModel: vi.fn(() => ({
        model: "llama-3.1-8b-instant",
        powerModel: "llama-3.3-70b-versatile",
      })),
    }));

    const { chat } = await import("../agents/chat-agent.js");
    const result = await chat({
      message: [
        "Task #67 — Implement the timeout degradation path.",
        "Done looks like",
        "- Run the targeted tests for src/index.ts.",
        "Relevant files",
        "- src/index.ts",
      ].join("\n"),
      history: [],
      projectContext: makeContext(),
      provider: "openrouter",
      apiKey: "test-or-key",
      rootPath: "/tmp/project",
    });

    // Must return a partial report, not throw.
    expect(result.response).toContain("## Task Execution Partial Report");
    expect(result.response).toContain("PROVIDER_TIMEOUT");
    // Stop reason must be visible in bilingual phrasing.
    expect(result.response).toContain("timed out");
    // Files read during evidence collection must be listed.
    expect(result.response).toContain("src/index.ts");
    // Unproven checklist items must remain visible — not silently marked done.
    expect(result.response).not.toMatch(/\[x\].*Run the targeted tests/i);
    // pendingChanges must be a valid array (never undefined).
    expect(Array.isArray(result.pendingChanges)).toBe(true);
  });

  it("surfaces partial text when the loop times out after producing prior text", async () => {
    // Simulate the engine returning kind:"partial" / reason:"provider_timeout"
    // WITH prior text content in result (lastTextSeen was captured before timeout).
    vi.doMock("../openai-compatible-client.js", () => ({
      openrouterCompleteRaw: vi.fn(),
      openrouterCompleteWithFallback: vi.fn(),
      openrouterCompleteStream: vi.fn(),
      geminiCompleteRaw: vi.fn(),
      geminiCompleteStream: vi.fn(),
    }));

    vi.doMock("../tool-execution-engine.js", async () => {
      const actual = await vi.importActual("../tool-execution-engine.js") as Record<string, unknown>;
      return {
        ...actual,
        executeToolLoop: vi.fn(async () => ({
          kind: "partial",
          reason: "provider_timeout",
          result: {
            content: "Here is some partial analysis of the codebase.",
            toolCalls: null,
            model: "llama-3.1-8b-instant",
            usage: { promptTokens: 120, completionTokens: 40 },
          },
          toolSources: [],
          fileContents: new Map(),
        })),
      };
    });

    vi.doMock("../model-selection/decision-engine.js", () => ({
      resolveExecutionDecision: vi.fn((scope: string) => ({ taskProfile: { taskType: scope } })),
    }));
    vi.doMock("../model-selection/provider-strategy.js", () => ({
      resolveExecutionProvider: vi.fn((_, provider: string) => ({ providerId: provider })),
    }));
    vi.doMock("../model-selection/model-resolver.js", () => ({
      resolveExecutionModel: vi.fn(() => ({
        model: "llama-3.1-8b-instant",
        powerModel: "llama-3.3-70b-versatile",
      })),
    }));

    const { chat } = await import("../agents/chat-agent.js");
    const result = await chat({
      message: "What does this codebase do?",
      history: [],
      projectContext: makeContext(),
      provider: "openrouter",
      apiKey: "test-or-key",
    });

    // The prior text must be surfaced — not a generic error message.
    expect(result.response).toContain("partial analysis");
    expect(Array.isArray(result.pendingChanges)).toBe(true);
  });
});
