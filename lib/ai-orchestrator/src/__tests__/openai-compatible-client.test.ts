/**
 * Regression tests for the OpenAI-compatible client.
 *
 * Gemini's OpenAI-compatible shim should not receive tool payloads or
 * response_format hints — those requests have been observed to fail with 404s
 * when those fields are present.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { geminiCompleteRaw } from "../openai-compatible-client.js";

const baseMessages = [{ role: "user", content: "hello" } as const];

describe("geminiCompleteRaw", () => {
  beforeEach(() => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_url: string | URL, init?: RequestInit) => {
        const body = JSON.parse(String(init?.body ?? "{}")) as Record<string, unknown>;
        (globalThis as unknown as { __capturedGeminiBody?: Record<string, unknown> }).__capturedGeminiBody = body;
        return {
          ok: true,
          status: 200,
          json: async () => ({
            choices: [{ message: { content: '{"response":"ok","sources":[]}' } }],
            model: "gemini-2.0-flash",
            usage: { prompt_tokens: 1, completion_tokens: 1 },
          }),
          text: async () => "",
        } as Response;
      }),
    );
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    delete (globalThis as unknown as { __capturedGeminiBody?: Record<string, unknown> }).__capturedGeminiBody;
    vi.restoreAllMocks();
  });

  it("strips tools and response_format from Gemini requests", async () => {
    const result = await geminiCompleteRaw(baseMessages as any, {
      apiKey: "test-key",
      maxTokens: 1,
      model: "gemini-2.0-flash",
      tools: [
        {
          type: "function",
          function: {
            name: "read_file",
            description: "Read a file",
            parameters: { type: "object", properties: {}, required: [] },
          },
        },
      ],
      responseFormat: { type: "json_object" },
    });

    expect(result.content).toBe('{"response":"ok","sources":[]}');

    const body = (globalThis as unknown as { __capturedGeminiBody?: Record<string, unknown> }).__capturedGeminiBody;
    expect(body).toBeDefined();
    expect(body).not.toHaveProperty("tools");
    expect(body).not.toHaveProperty("tool_choice");
    expect(body).not.toHaveProperty("response_format");
  });
});
