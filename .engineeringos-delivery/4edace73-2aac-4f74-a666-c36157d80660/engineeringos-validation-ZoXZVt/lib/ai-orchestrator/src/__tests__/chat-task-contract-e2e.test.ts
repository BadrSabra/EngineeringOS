import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ProjectContext } from "../context-builder.js";
import type { AgentStep } from "../tool-execution-engine.js";
import type { ForensicTaskType } from "../task-contracts.js";

const originalApiKey = process.env.GROQ_API_KEY;

function makeContext(): ProjectContext {
  return {
    project: "test | task contract e2e",
    workflows: "No workflows defined yet",
    recentTasks: "",
    latestMetrics: "",
    graphSummary: "",
    recentEvents: "",
    metricsVerified: false,
  };
}

const cases: Array<{
  name: string;
  taskType: ForensicTaskType;
  message: string;
  response: string;
  expectedResultKind:
    | "CODE_EXTRACTION_RESULT"
    | "BEHAVIOR_ANSWER_RESULT"
    | "FINDING_RESULT"
    | "FORENSIC_REPORT_RESULT"
    | "REPAIR_RESULT"
    | undefined;
}> = [
  {
    name: "code extraction",
    taskType: "CODE_EXTRACTION",
    message: "Extract Branch A and Branch B only from executeToolLoop.",
    response: "```ts\nreturn partial;\n```",
    expectedResultKind: "CODE_EXTRACTION_RESULT",
  },
  {
    name: "behavior query",
    taskType: "BEHAVIOR_QUERY",
    // "Does X always Y?" is an explicit behavior query, so isExplicitBehaviorQueryRequest
    // returns true and buildSemanticBehaviorAnswer is called → BEHAVIOR_ANSWER_RESULT.
    // Absent only for non-explicit queries (implementation / summary tasks) routed as BEHAVIOR_QUERY.
    message: "Does maxIterations always lead to exhausted?",
    response: "NOT PROVEN",
    expectedResultKind: "BEHAVIOR_ANSWER_RESULT",
  },
  {
    name: "finding analysis",
    taskType: "FINDING_ANALYSIS",
    message: "Find and prove any behavioral defect in executeToolLoop.",
    response: "NOT PROVEN",
    expectedResultKind: "FINDING_RESULT",
  },
  {
    name: "full forensic audit",
    taskType: "FULL_FORENSIC_AUDIT",
    message: "Perform a full forensic audit of executeToolLoop.",
    response: "NOT PROVEN",
    expectedResultKind: "FORENSIC_REPORT_RESULT",
  },
  {
    name: "repair analysis",
    taskType: "REPAIR_ANALYSIS",
    message: "Create a repair plan for the proven defect.",
    response: "BLOCKED — no proven defect",
    expectedResultKind: "REPAIR_RESULT",
  },
];

describe("chat() task-contract end-to-end routing", () => {
  beforeEach(() => {
    vi.resetModules();
    process.env.GROQ_API_KEY = "test-key";
    vi.doMock("groq-sdk", () => ({
      default: class {
        chat = {
          completions: {
            create: vi.fn().mockImplementation(async (request: { messages?: unknown[] }) => {
              const userMessage = Array.isArray(request.messages)
                ? [...request.messages].reverse().find(
                    (item): item is { role: string; content: string } =>
                      typeof item === "object" &&
                      item !== null &&
                      (item as { role?: unknown }).role === "user" &&
                      typeof (item as { content?: unknown }).content === "string",
                  )
                : undefined;
              const match = cases.find((item) => item.message === userMessage?.content);
              return {
                choices: [{
                  message: {
                    content: JSON.stringify({
                      response: match?.response ?? "NOT PROVEN",
                      sources: [],
                    }),
                  },
                }],
                model: "mock-task-contract-model",
                usage: {},
              };
            }),
          },
        };
      },
    }));
  });

  afterEach(() => {
    vi.doUnmock("groq-sdk");
    if (originalApiKey === undefined) delete process.env.GROQ_API_KEY;
    else process.env.GROQ_API_KEY = originalApiKey;
  });

  it.each(cases)(
    "routes and verifies the $name task",
    async ({ taskType, message, expectedResultKind }) => {
      const { chat } = await import("../agents/chat-agent.js");
      const steps: AgentStep[] = [];
      const result = await chat({
        message,
        history: [],
        projectContext: makeContext(),
        apiKey: "test-key",
        provider: "groq",
        onStep: (step) => steps.push(step),
      });

      const decision = [...steps]
        .reverse()
        .find((step): step is Extract<AgentStep, { kind: "decision_trace" }> =>
          step.kind === "decision_trace",
        );

      expect(decision?.trace.taskType).toBe(taskType);
      expect(result.response.trim().length).toBeGreaterThan(0);
      expect(steps.some((step) => step.kind === "verification")).toBe(true);

      // AI-008: assert discriminated taskResult for each task type
      if (expectedResultKind === undefined) {
        // BEHAVIOR_QUERY without SemanticBehaviorAnswer: taskResult is absent
        expect(result.taskResult).toBeUndefined();
      } else {
        expect(result.taskResult).toBeDefined();
        expect(result.taskResult?.kind).toBe(expectedResultKind);
      }
    },
  );
});

describe("chat() taskResult discriminant payloads", () => {
  beforeEach(() => {
    vi.resetModules();
    process.env.GROQ_API_KEY = "test-key";
    vi.doMock("groq-sdk", () => ({
      default: class {
        chat = {
          completions: {
            create: vi.fn().mockImplementation(async (request: { messages?: unknown[] }) => {
              const userMessage = Array.isArray(request.messages)
                ? [...request.messages].reverse().find(
                    (item): item is { role: string; content: string } =>
                      typeof item === "object" &&
                      item !== null &&
                      (item as { role?: unknown }).role === "user" &&
                      typeof (item as { content?: unknown }).content === "string",
                  )
                : undefined;
              const content = typeof userMessage?.content === "string" ? userMessage.content : "";
              return {
                choices: [{
                  message: {
                    content: JSON.stringify({ response: `response for: ${content}`, sources: [] }),
                  },
                }],
                model: "mock-payload-model",
                usage: {},
              };
            }),
          },
        };
      },
    }));
  });

  afterEach(() => {
    vi.doUnmock("groq-sdk");
    if (originalApiKey === undefined) delete process.env.GROQ_API_KEY;
    else process.env.GROQ_API_KEY = originalApiKey;
  });

  it("CODE_EXTRACTION_RESULT has extractedCode string", async () => {
    const { chat } = await import("../agents/chat-agent.js");
    const result = await chat({
      message: "Extract Branch A and Branch B only from executeToolLoop.",
      history: [],
      projectContext: makeContext(),
      apiKey: "test-key",
      provider: "groq",
    });
    expect(result.taskResult?.kind).toBe("CODE_EXTRACTION_RESULT");
    if (result.taskResult?.kind === "CODE_EXTRACTION_RESULT") {
      expect(typeof result.taskResult.extractedCode).toBe("string");
    }
  });

  it("FINDING_RESULT has finding object with severity", async () => {
    const { chat } = await import("../agents/chat-agent.js");
    const result = await chat({
      message: "Find and prove any behavioral defect in executeToolLoop.",
      history: [],
      projectContext: makeContext(),
      apiKey: "test-key",
      provider: "groq",
    });
    expect(result.taskResult?.kind).toBe("FINDING_RESULT");
    if (result.taskResult?.kind === "FINDING_RESULT") {
      expect(typeof result.taskResult.finding.finding).toBe("string");
      expect(result.taskResult.finding.finding.length).toBeGreaterThan(0);
      expect(["LOW", "MEDIUM", "HIGH", "CRITICAL", "NOT_PROVEN"]).toContain(
        result.taskResult.finding.severity,
      );
    }
  });

  it("FORENSIC_REPORT_RESULT has report string", async () => {
    const { chat } = await import("../agents/chat-agent.js");
    const result = await chat({
      message: "Perform a full forensic audit of executeToolLoop.",
      history: [],
      projectContext: makeContext(),
      apiKey: "test-key",
      provider: "groq",
    });
    expect(result.taskResult?.kind).toBe("FORENSIC_REPORT_RESULT");
    if (result.taskResult?.kind === "FORENSIC_REPORT_RESULT") {
      expect(typeof result.taskResult.report).toBe("string");
      expect(result.taskResult.report.length).toBeGreaterThan(0);
      expect(Array.isArray(result.taskResult.evidence)).toBe(true);
    }
  });

  it("REPAIR_RESULT has phases array and readiness", async () => {
    const { chat } = await import("../agents/chat-agent.js");
    const result = await chat({
      message: "Create a repair plan for the proven defect.",
      history: [],
      projectContext: makeContext(),
      apiKey: "test-key",
      provider: "groq",
    });
    expect(result.taskResult?.kind).toBe("REPAIR_RESULT");
    if (result.taskResult?.kind === "REPAIR_RESULT") {
      expect(Array.isArray(result.taskResult.phases)).toBe(true);
      expect(["READY", "BLOCKED", "NOT_PROVEN"]).toContain(result.taskResult.readiness);
    }
  });
});

// ── Streaming (onDelta) paths ──────────────────────────────────────────────────
// Verifies that taskResult is populated on both non-native (OpenRouter direct-
// content) and native SSE (Groq accumulated) streaming paths.

describe("chat() taskResult via onDelta streaming (non-native OpenRouter path)", () => {
  beforeEach(() => {
    vi.resetModules();
    process.env.GROQ_API_KEY = "test-key";
    // Non-native streaming: openrouterCompleteRaw returns direct content;
    // the agent emits it word-by-word via onDelta and returns early.
    vi.doMock("../openai-compatible-client.js", () => ({
      openrouterCompleteRaw: vi.fn().mockResolvedValue({
        content: "Extracted code: return partial;",
        toolCalls: [],
        model: "mock-or-model",
        usage: {},
      }),
      openrouterCompleteWithFallback: vi.fn().mockResolvedValue({
        content: "Extracted code: return partial;",
        toolCalls: [],
        model: "mock-or-model",
        usage: {},
      }),
      openrouterCompleteStream: vi.fn(),
      geminiCompleteRaw: vi.fn(),
      geminiCompleteStream: vi.fn(),
    }));
  });

  afterEach(() => {
    vi.doUnmock("../openai-compatible-client.js");
    vi.doUnmock("../provider-registry.js");
    vi.doUnmock("../model-selection/decision-engine.js");
    vi.doUnmock("../model-selection/provider-strategy.js");
    vi.doUnmock("../model-selection/model-resolver.js");
    vi.doUnmock("../forensic-recovery.js");
    if (originalApiKey === undefined) delete process.env.GROQ_API_KEY;
    else process.env.GROQ_API_KEY = originalApiKey;
  });

  it("CODE_EXTRACTION_RESULT via non-native onDelta streaming has extractedCode", async () => {
    const deltas: string[] = [];
    const { chat } = await import("../agents/chat-agent.js");
    const result = await chat({
      message: "Extract Branch A and Branch B only from executeToolLoop.",
      history: [],
      projectContext: makeContext(),
      provider: "openrouter",
      apiKey: "test-or-key",
      onDelta: (chunk) => deltas.push(chunk),
    });

    // Streaming deltas should have been emitted
    expect(deltas.join("").length).toBeGreaterThan(0);
    // taskResult must be present with the correct kind
    expect(result.taskResult?.kind).toBe("CODE_EXTRACTION_RESULT");
    if (result.taskResult?.kind === "CODE_EXTRACTION_RESULT") {
      expect(typeof result.taskResult.extractedCode).toBe("string");
      expect(result.taskResult.extractedCode.length).toBeGreaterThan(0);
    }
  });

  it("BEHAVIOR_ANSWER_RESULT via non-native onDelta streaming matches non-streaming shape", async () => {
    const deltas: string[] = [];
    const { chat } = await import("../agents/chat-agent.js");
    const result = await chat({
      // "Does X always Y?" triggers isExplicitBehaviorQueryRequest → BEHAVIOR_ANSWER_RESULT
      message: "Does maxIterations always lead to exhausted?",
      history: [],
      projectContext: makeContext(),
      provider: "openrouter",
      apiKey: "test-or-key",
      onDelta: (chunk) => deltas.push(chunk),
    });

    expect(deltas.join("").length).toBeGreaterThan(0);
    // Streaming path must return the same result kind as the non-streaming path
    expect(result.taskResult?.kind).toBe("BEHAVIOR_ANSWER_RESULT");
    if (result.taskResult?.kind === "BEHAVIOR_ANSWER_RESULT") {
      expect(typeof result.taskResult.answer.answer).toBe("string");
    }
  });
});

describe("chat() taskResult via onDelta streaming (native Groq accumulated path)", () => {
  beforeEach(() => {
    vi.resetModules();
    process.env.GROQ_API_KEY = "test-key";

    // Native Groq streaming: mock the SDK to return an async iterable.
    // The agent accumulates chunks via `for await` and returns the result.
    vi.doMock("groq-sdk", () => ({
      default: class {
        chat = {
          completions: {
            create: vi.fn().mockImplementation(async (opts: { stream?: boolean }) => {
              if (opts?.stream) {
                // Return an async iterable of streaming chunks.
                const chunks = [
                  "Extracted ",
                  "code: ",
                  "return ",
                  "partial;",
                ];
                return {
                  [Symbol.asyncIterator]: async function* () {
                    for (const text of chunks) {
                      yield { choices: [{ delta: { content: text } }] };
                    }
                  },
                };
              }
              // Non-streaming fallback (used in synthesis/correction calls).
              return {
                choices: [{
                  message: {
                    content: JSON.stringify({ response: "Extracted code: return partial;", sources: [] }),
                  },
                }],
                model: "mock-groq-native-model",
                usage: {},
              };
            }),
          },
        };
      },
    }));
  });

  afterEach(() => {
    vi.doUnmock("groq-sdk");
    if (originalApiKey === undefined) delete process.env.GROQ_API_KEY;
    else process.env.GROQ_API_KEY = originalApiKey;
  });

  it("CODE_EXTRACTION_RESULT via native Groq onDelta streaming has extractedCode", async () => {
    const deltas: string[] = [];
    const { chat } = await import("../agents/chat-agent.js");
    const result = await chat({
      message: "Extract Branch A and Branch B only from executeToolLoop.",
      history: [],
      projectContext: makeContext(),
      provider: "groq",
      apiKey: "test-key",
      onDelta: (chunk) => deltas.push(chunk),
    });

    // The agent must have streamed at least some content
    expect(deltas.join("").length).toBeGreaterThan(0);
    // taskResult must carry the CODE_EXTRACTION_RESULT kind
    expect(result.taskResult?.kind).toBe("CODE_EXTRACTION_RESULT");
    if (result.taskResult?.kind === "CODE_EXTRACTION_RESULT") {
      expect(typeof result.taskResult.extractedCode).toBe("string");
      expect(result.taskResult.extractedCode.length).toBeGreaterThan(0);
    }
  });

  it("BEHAVIOR_ANSWER_RESULT via native Groq onDelta streaming matches non-streaming shape", async () => {
    const deltas: string[] = [];
    const { chat } = await import("../agents/chat-agent.js");
    const result = await chat({
      // "Does X always Y?" triggers isExplicitBehaviorQueryRequest → BEHAVIOR_ANSWER_RESULT
      message: "Does maxIterations always lead to exhausted?",
      history: [],
      projectContext: makeContext(),
      provider: "groq",
      apiKey: "test-key",
      onDelta: (chunk) => deltas.push(chunk),
    });

    expect(deltas.join("").length).toBeGreaterThan(0);
    // Native SSE path must return the same result kind as the non-streaming path
    expect(result.taskResult?.kind).toBe("BEHAVIOR_ANSWER_RESULT");
    if (result.taskResult?.kind === "BEHAVIOR_ANSWER_RESULT") {
      expect(typeof result.taskResult.answer.answer).toBe("string");
    }
  });
});
