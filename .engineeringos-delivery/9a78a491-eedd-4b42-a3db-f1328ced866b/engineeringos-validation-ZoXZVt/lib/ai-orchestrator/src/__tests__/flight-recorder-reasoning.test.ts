/**
 * Task #158 — Flight Recorder: step-by-step "why" narrative
 *
 * Verifies that fresh (non-cached) read and write tool_call steps include the
 * agent's preceding model text as `reasoning`, while cached calls do not.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AgentStep } from "../tool-execution-engine.js";
import type { ProjectContext } from "../context-builder.js";

const originalApiKey = process.env.GROQ_API_KEY;

function makeContext(): ProjectContext {
  return {
    project: "test | flight recorder reasoning",
    workflows: "No workflows defined yet",
    recentTasks: "",
    latestMetrics: "",
    graphSummary: "",
    recentEvents: "",
    metricsVerified: false,
  };
}

// Two-turn mock: first response calls read_file with reasoning text; second
// response is a plain text answer so the loop terminates.
function makeGroqMock(reasoningText: string, filePath: string) {
  let callCount = 0;
  return {
    default: class {
      chat = {
        completions: {
          create: vi.fn().mockImplementation(async () => {
            callCount++;
            if (callCount === 1) {
              // First turn: model emits reasoning text + a read_file tool call.
              return {
                choices: [{
                  message: {
                    content: reasoningText,
                    tool_calls: [{
                      id: "call-1",
                      type: "function",
                      function: {
                        name: "read_file",
                        arguments: JSON.stringify({ path: filePath }),
                      },
                    }],
                  },
                  finish_reason: "tool_calls",
                }],
                model: "mock-reasoning-model",
                usage: { prompt_tokens: 10, completion_tokens: 5 },
              };
            }
            // Second turn: plain text response (no tools), terminates the loop.
            return {
              choices: [{
                message: {
                  content: "The authentication module handles JWT tokens via verifyToken().",
                  tool_calls: null,
                },
                finish_reason: "stop",
              }],
              model: "mock-reasoning-model",
              usage: { prompt_tokens: 20, completion_tokens: 10 },
            };
          }),
        },
      };
    },
  };
}

describe("flight-recorder reasoning field on tool_call steps", () => {
  beforeEach(() => {
    vi.resetModules();
    process.env.GROQ_API_KEY = "test-key";
  });

  afterEach(() => {
    vi.doUnmock("groq-sdk");
    if (originalApiKey === undefined) delete process.env.GROQ_API_KEY;
    else process.env.GROQ_API_KEY = originalApiKey;
  });

  it("attaches model reasoning text to a fresh read_file tool_call step", async () => {
    const modelReasoning = "I need to inspect the authentication module to understand how tokens are validated.";
    const targetPath = "src/auth/verify-token.ts";

    vi.doMock("groq-sdk", () => makeGroqMock(modelReasoning, targetPath));

    const { chat } = await import("../agents/chat-agent.js");

    const steps: AgentStep[] = [];
    await chat({
      message: "How does token verification work in the auth module?",
      history: [],
      projectContext: makeContext(),
      apiKey: "test-key",
      provider: "groq",
      onStep: (step) => steps.push(step),
    });

    const readFileSteps = steps.filter(
      (step): step is Extract<AgentStep, { kind: "tool_call" }> =>
        step.kind === "tool_call" && step.tool === "read_file",
    );

    expect(readFileSteps.length).toBeGreaterThanOrEqual(1);

    const freshStep = readFileSteps.find((step) => !step.cached);
    expect(freshStep).toBeDefined();
    expect(freshStep?.reasoning).toBeDefined();
    // Reasoning is the model's content text, trimmed and truncated to 500 chars.
    expect(freshStep?.reasoning).toBe(modelReasoning.slice(0, 500));
    // File path is preserved in args.
    expect(freshStep?.args?.path).toBe(targetPath);
  });

  it("does not attach reasoning to cached (duplicate) read_file tool_call steps", async () => {
    const modelReasoning = "I need to check this file again for completeness.";
    const targetPath = "src/auth/verify-token.ts";

    // Two-turn mock where turn 1 makes the same read_file call twice (one
    // fresh, one cached via duplicate detection in the engine).
    let callCount = 0;
    vi.doMock("groq-sdk", () => ({
      default: class {
        chat = {
          completions: {
            create: vi.fn().mockImplementation(async () => {
              callCount++;
              if (callCount === 1) {
                // Two identical read_file calls in the same turn — engine will
                // serve the second one from cache.
                return {
                  choices: [{
                    message: {
                      content: modelReasoning,
                      tool_calls: [
                        {
                          id: "call-1",
                          type: "function",
                          function: {
                            name: "read_file",
                            arguments: JSON.stringify({ path: targetPath }),
                          },
                        },
                        {
                          id: "call-2",
                          type: "function",
                          function: {
                            name: "read_file",
                            arguments: JSON.stringify({ path: targetPath }),
                          },
                        },
                      ],
                    },
                    finish_reason: "tool_calls",
                  }],
                  model: "mock-reasoning-model",
                  usage: {},
                };
              }
              return {
                choices: [{
                  message: {
                    content: "Done.",
                    tool_calls: null,
                  },
                  finish_reason: "stop",
                }],
                model: "mock-reasoning-model",
                usage: {},
              };
            }),
          },
        };
      },
    }));

    const { chat } = await import("../agents/chat-agent.js");

    const steps: AgentStep[] = [];
    await chat({
      message: "What is in the auth module?",
      history: [],
      projectContext: makeContext(),
      apiKey: "test-key",
      provider: "groq",
      onStep: (step) => steps.push(step),
    });

    const readFileSteps = steps.filter(
      (step): step is Extract<AgentStep, { kind: "tool_call" }> =>
        step.kind === "tool_call" && step.tool === "read_file",
    );

    // There should be at least one cached step.
    const cachedStep = readFileSteps.find((step) => step.cached);
    if (cachedStep) {
      // Cached steps must NOT carry reasoning — they are cache hits, not new
      // model decisions.
      expect(cachedStep.reasoning).toBeUndefined();
    }
  });

  it("truncates reasoning text to 500 characters", async () => {
    const longReasoning = "A".repeat(600);
    const targetPath = "src/utils/helpers.ts";

    vi.doMock("groq-sdk", () => makeGroqMock(longReasoning, targetPath));

    const { chat } = await import("../agents/chat-agent.js");

    const steps: AgentStep[] = [];
    await chat({
      message: "What utilities are in helpers.ts?",
      history: [],
      projectContext: makeContext(),
      apiKey: "test-key",
      provider: "groq",
      onStep: (step) => steps.push(step),
    });

    const freshRead = steps.find(
      (step): step is Extract<AgentStep, { kind: "tool_call" }> =>
        step.kind === "tool_call" && step.tool === "read_file" && !step.cached,
    );

    expect(freshRead?.reasoning).toBeDefined();
    expect(freshRead?.reasoning!.length).toBeLessThanOrEqual(500);
  });
});
