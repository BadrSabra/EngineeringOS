/**
 * Regression tests for provider-aware tool gating in the chat agent.
 */
import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";

const capturedCalls: Array<{ provider: string; opts: Record<string, unknown> }> = [];

vi.mock("../groq-client.js", () => ({
  completeRaw: vi.fn(),
  completeStream: vi.fn(),
  MODEL_POWERFUL: "llama-3.3-70b-versatile",
  MODEL_FAST: "llama-3.1-8b-instant",
}));

vi.mock("../deepseek-client.js", () => ({
  deepseekCompleteRaw: vi.fn(),
  deepseekCompleteStream: vi.fn(),
  DEEPSEEK_MODEL_FAST: "deepseek-chat",
  DEEPSEEK_MODEL_POWERFUL: "deepseek-chat",
}));

vi.mock("../openai-compatible-client.js", () => ({
  openrouterCompleteRaw: vi.fn(),
  openrouterCompleteStream: vi.fn(),
  geminiCompleteRaw: vi.fn(async (_messages: unknown, opts: Record<string, unknown>) => {
    capturedCalls.push({ provider: "gemini", opts });
    return {
      content: '{"response":"ok","sources":[]}',
      toolCalls: null,
      model: "gemini-2.0-flash",
      usage: { promptTokens: 1, completionTokens: 1 },
    };
  }),
  geminiCompleteStream: vi.fn(),
}));

function makeContext() {
  return {
    project: "test | project",
    workflows: "No workflows defined yet",
    recentTasks: "",
    latestMetrics: "",
    graphSummary: "",
    recentEvents: "",
    metricsVerified: false,
  };
}

describe("chat agent provider tool gating", () => {
  beforeEach(() => {
    vi.resetModules();
    capturedCalls.length = 0;
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it("does not pass tools to Gemini when the provider is tools-disabled", async () => {
    const { chat } = await import("../agents/chat-agent.js");

    const result = await chat({
      // Keep this test focused on provider tool gating. Broad workspace-review
      // language intentionally enters the evidence-backed forensic contract.
      message: "hello",
      history: [],
      projectContext: makeContext() as any,
      rootPath: "/tmp/project",
      provider: "gemini",
      apiKey: "test-key",
    });

    expect(result.response).toBe("ok");
    expect(capturedCalls).toHaveLength(1);
    expect(capturedCalls[0]?.provider).toBe("gemini");
    expect(capturedCalls[0]?.opts).not.toHaveProperty("tools");
  });
});
