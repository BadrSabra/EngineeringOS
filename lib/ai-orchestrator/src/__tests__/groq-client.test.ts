import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const originalApiKey = process.env.GROQ_API_KEY;

describe("groq-client", () => {
  beforeEach(() => {
    vi.resetModules();
    process.env.GROQ_API_KEY = "test-key";
  });

  afterEach(() => {
    vi.doUnmock("groq-sdk");
    if (originalApiKey === undefined) delete process.env.GROQ_API_KEY;
    else process.env.GROQ_API_KEY = originalApiKey;
  });

  it("throws INVALID_CONFIG when GROQ_API_KEY is not set", async () => {
    delete process.env.GROQ_API_KEY;
    const { complete } = await import("../groq-client.js");
    await expect(complete([{ role: "user", content: "hi" }])).rejects.toMatchObject({ code: "INVALID_CONFIG" });
  });

  it("returns structured content/model/usage on success", async () => {
    vi.doMock("groq-sdk", () => ({
      default: class {
        chat = {
          completions: {
            create: vi.fn().mockResolvedValue({
              choices: [{ message: { content: '{"ok":true}' } }],
              model: "llama-3.3-70b-versatile",
              usage: { prompt_tokens: 10, completion_tokens: 5 },
            }),
          },
        };
      },
    }));
    const { complete } = await import("../groq-client.js");
    const result = await complete([{ role: "user", content: "hi" }]);
    expect(result).toEqual({
      content: '{"ok":true}',
      model: "llama-3.3-70b-versatile",
      usage: { promptTokens: 10, completionTokens: 5 },
    });
  });

  it("throws EMPTY_RESPONSE when the model returns no content", async () => {
    vi.doMock("groq-sdk", () => ({
      default: class {
        chat = {
          completions: {
            create: vi.fn().mockResolvedValue({ choices: [{ message: {} }], model: "m", usage: {} }),
          },
        };
      },
    }));
    const { complete } = await import("../groq-client.js");
    await expect(complete([{ role: "user", content: "hi" }])).rejects.toMatchObject({ code: "EMPTY_RESPONSE" });
  });

  it("classifies an SDK error with a numeric status as NON_200", async () => {
    vi.doMock("groq-sdk", () => ({
      default: class {
        chat = {
          completions: {
            create: vi.fn().mockRejectedValue(Object.assign(new Error("bad request"), { status: 400 })),
          },
        };
      },
    }));
    const { complete } = await import("../groq-client.js");
    await expect(complete([{ role: "user", content: "hi" }], { maxRetries: 0 })).rejects.toMatchObject({
      code: "NON_200",
    });
  });

  it("retries a transient network error up to maxRetries, then succeeds", async () => {
    const create = vi
      .fn()
      .mockRejectedValueOnce(new Error("ECONNRESET"))
      .mockResolvedValueOnce({
        choices: [{ message: { content: '{"ok":true}' } }],
        model: "m",
        usage: {},
      });
    vi.doMock("groq-sdk", () => ({
      default: class {
        chat = { completions: { create } };
      },
    }));
    const { complete } = await import("../groq-client.js");
    const result = await complete([{ role: "user", content: "hi" }], { maxRetries: 1 });
    expect(result.content).toBe('{"ok":true}');
    expect(create).toHaveBeenCalledTimes(2);
  });

  it("gives up after maxRetries transient failures with NETWORK_ERROR", async () => {
    const create = vi.fn().mockRejectedValue(new Error("ECONNRESET"));
    vi.doMock("groq-sdk", () => ({
      default: class {
        chat = { completions: { create } };
      },
    }));
    const { complete } = await import("../groq-client.js");
    await expect(complete([{ role: "user", content: "hi" }], { maxRetries: 2 })).rejects.toMatchObject({
      code: "NETWORK_ERROR",
    });
    expect(create).toHaveBeenCalledTimes(3);
  });
});
