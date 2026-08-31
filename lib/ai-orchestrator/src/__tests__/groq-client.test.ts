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
              model: "openai/gpt-oss-20b",
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
      model: "openai/gpt-oss-20b",
      usage: { promptTokens: 10, completionTokens: 5 },
    });
  });

  it("confirms both configured defaults against Groq's live model catalog", async () => {
    const list = vi.fn().mockResolvedValue({
      object: "list",
      data: [
        { id: "fast-model" },
        { id: "powerful-model" },
      ],
    });
    vi.doMock("groq-sdk", () => ({
      default: class {
        models = { list };
      },
    }));
    const { validateGroqDefaultModels } = await import("../groq-client.js");

    await expect(
      validateGroqDefaultModels("test-key", {
        fast: "fast-model",
        powerful: "powerful-model",
      }),
    ).resolves.toMatchObject({
      valid: true,
      missing: [],
      checkedModels: {
        fast: "fast-model",
        powerful: "powerful-model",
      },
    });
    expect(list).toHaveBeenCalledTimes(1);
  });

  it("reports retired defaults without treating the credential as the failure", async () => {
    vi.doMock("groq-sdk", () => ({
      default: class {
        models = {
          list: vi.fn().mockResolvedValue({
            object: "list",
            data: [{ id: "fast-model" }],
          }),
        };
      },
    }));
    const { validateGroqDefaultModels } = await import("../groq-client.js");
    const result = await validateGroqDefaultModels("secret-key", {
      fast: "fast-model",
      powerful: "retired-model",
    });

    expect(result).toMatchObject({
      valid: false,
      missing: ["powerful"],
      checkedModels: {
        fast: "fast-model",
        powerful: "retired-model",
      },
    });
    expect(result.reason).toContain('powerful="retired-model"');
    expect(result.reason).not.toContain("secret-key");
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

  it("classifies a Groq 404 as MODEL_NOT_FOUND so the lane can be repaired", async () => {
    vi.doMock("groq-sdk", () => ({
      default: class {
        chat = {
          completions: {
            create: vi.fn().mockRejectedValue(
              Object.assign(new Error("model not found"), {
                status: 404,
                error: { error: { message: "The model does not exist" } },
              }),
            ),
          },
        };
      },
    }));
    const { complete } = await import("../groq-client.js");
    await expect(complete([{ role: "user", content: "hi" }], { maxRetries: 0 })).rejects.toMatchObject({
      code: "MODEL_NOT_FOUND",
      providerStatus: 404,
      providerName: "Groq",
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

  it("cancels retry backoff immediately and records only the attempted request", async () => {
    vi.useFakeTimers();
    const randomSpy = vi.spyOn(Math, "random").mockReturnValue(0.5);
    try {
      const create = vi.fn().mockRejectedValue(new Error("ECONNRESET"));
      vi.doMock("groq-sdk", () => ({
        default: class {
          chat = { completions: { create } };
        },
      }));
      const { complete } = await import("../groq-client.js");
      const controller = new AbortController();
      const { createExecutionLedger } = await import("../execution-ledger.js");
      const ledger = createExecutionLedger({
        signal: controller.signal,
        budget: { deadlineMs: 10_000, providerAttempts: 8 },
      });
      const pending = complete(
        [{ role: "user", content: "hi" }],
        { maxRetries: 3, executionLedger: ledger },
      );

      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
      controller.abort();
      await expect(pending).rejects.toMatchObject({ code: "TIMEOUT" });
      expect(create).toHaveBeenCalledTimes(1);
      expect(ledger.snapshot().counts.provider_attempt).toBe(1);
    } finally {
      randomSpy.mockRestore();
      vi.useRealTimers();
    }
  });

  it("rejects a provider attempt after the shared deadline without sending it", async () => {
    vi.useFakeTimers();
    try {
      const create = vi.fn();
      vi.doMock("groq-sdk", () => ({
        default: class {
          chat = { completions: { create } };
        },
      }));
      const { complete } = await import("../groq-client.js");
      const { createExecutionLedger } = await import("../execution-ledger.js");
      const ledger = createExecutionLedger({
        budget: { deadlineMs: 1_000, providerAttempts: 8 },
      });
      vi.advanceTimersByTime(1_000);

      await expect(
        complete([{ role: "user", content: "hi" }], {
          maxRetries: 3,
          executionLedger: ledger,
        }),
      ).rejects.toMatchObject({ code: "TIMEOUT" });
      expect(create).not.toHaveBeenCalled();
      expect(ledger.snapshot().events.at(-1)).toMatchObject({
        kind: "provider_attempt",
        status: "rejected",
        reason: "deadline",
      });
    } finally {
      vi.useRealTimers();
    }
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

  it("classifies a 401 status as AUTH_ERROR and does not retry", async () => {
    const create = vi.fn().mockRejectedValue(Object.assign(new Error("Unauthorized"), { status: 401 }));
    vi.doMock("groq-sdk", () => ({
      default: class {
        chat = { completions: { create } };
      },
    }));
    const { complete } = await import("../groq-client.js");
    await expect(complete([{ role: "user", content: "hi" }], { maxRetries: 3 })).rejects.toMatchObject({
      code: "AUTH_ERROR",
    });
    // Auth failures are not retried — the credential error is deterministic.
    expect(create).toHaveBeenCalledTimes(1);
  });

  it("classifies a 403 status as AUTH_ERROR without retry", async () => {
    const create = vi.fn().mockRejectedValue(Object.assign(new Error("Forbidden"), { status: 403 }));
    vi.doMock("groq-sdk", () => ({
      default: class {
        chat = { completions: { create } };
      },
    }));
    const { complete } = await import("../groq-client.js");
    await expect(complete([{ role: "user", content: "hi" }], { maxRetries: 3 })).rejects.toMatchObject({
      code: "AUTH_ERROR",
    });
    expect(create).toHaveBeenCalledTimes(1);
  });

  it("retries a 429 rate-limit error up to maxRetries", async () => {
    // Pin Math.random to 0 so retryDelayMs always returns 0 ms regardless of
    // the RATE_LIMITED base (2 000 ms × jitter).  Without this the test is
    // flaky: at attempt 1 the jitter window is [0, 4 000 ms] and the default
    // test timeout is 5 000 ms — a bad roll causes a spurious timeout failure.
    const randomSpy = vi.spyOn(Math, "random").mockReturnValue(0);
    try {
      const create = vi.fn().mockRejectedValue(Object.assign(new Error("Too Many Requests"), { status: 429 }));
      vi.doMock("groq-sdk", () => ({
        default: class {
          chat = { completions: { create } };
        },
      }));
      const { complete } = await import("../groq-client.js");
      await expect(complete([{ role: "user", content: "hi" }], { maxRetries: 2 })).rejects.toBeDefined();
      // Should have retried (called more than once).
      expect(create.mock.calls.length).toBeGreaterThan(1);
    } finally {
      randomSpy.mockRestore();
    }
  });

  it("retries a 5xx server error up to maxRetries", async () => {
    const create = vi
      .fn()
      .mockRejectedValueOnce(Object.assign(new Error("Internal Server Error"), { status: 500 }))
      .mockRejectedValueOnce(Object.assign(new Error("Bad Gateway"), { status: 502 }))
      .mockResolvedValueOnce({
        choices: [{ message: { content: "recovered" } }],
        model: "m",
        usage: {},
      });
    vi.doMock("groq-sdk", () => ({
      default: class {
        chat = { completions: { create } };
      },
    }));
    const { complete } = await import("../groq-client.js");
    const result = await complete([{ role: "user", content: "hi" }], { maxRetries: 2 });
    expect(result.content).toBe("recovered");
    expect(create).toHaveBeenCalledTimes(3);
  });

  it("uses per-user apiKey over env var when both are present", async () => {
    let capturedKey: string | undefined;
    vi.doMock("groq-sdk", () => ({
      default: class {
        constructor(opts: { apiKey?: string }) {
          capturedKey = opts.apiKey;
        }
        chat = {
          completions: {
            create: vi.fn().mockResolvedValue({
              choices: [{ message: { content: "ok" } }],
              model: "m",
              usage: {},
            }),
          },
        };
      },
    }));
    process.env.GROQ_API_KEY = "env-key";
    const { complete } = await import("../groq-client.js");
    await complete([{ role: "user", content: "hi" }], { apiKey: "per-user-key" });
    expect(capturedKey).toBe("per-user-key");
  });

  it("falls back to env GROQ_API_KEY when no per-user key is provided", async () => {
    let capturedKey: string | undefined;
    vi.doMock("groq-sdk", () => ({
      default: class {
        constructor(opts: { apiKey?: string }) {
          capturedKey = opts.apiKey;
        }
        chat = {
          completions: {
            create: vi.fn().mockResolvedValue({
              choices: [{ message: { content: "ok" } }],
              model: "m",
              usage: {},
            }),
          },
        };
      },
    }));
    process.env.GROQ_API_KEY = "env-fallback-key";
    const { complete } = await import("../groq-client.js");
    await complete([{ role: "user", content: "hi" }]);
    expect(capturedKey).toBe("env-fallback-key");
  });
});
