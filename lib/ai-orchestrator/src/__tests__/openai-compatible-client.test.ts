/**
 * PR-012 — Regression tests for the OpenAI-compatible client.
 *
 * Covers:
 *   • Gemini strips tools but preserves response_format for structured output
 *   • 400 invalid model id → MODEL_NOT_FOUND + fallback (existing)
 *   • 404 → MODEL_NOT_FOUND + fallback (PR-003)
 *   • 410 → MODEL_UNAVAILABLE + fallback (PR-003)
 *   • 422 → MODEL_UNAVAILABLE + fallback (PR-003)
 *   • 429 rate-limit → RATE_LIMITED
 *   • 429 quota/credits body → QUOTA (PR-008)
 *   • 401/403 → AUTH_ERROR
 *   • 5xx → SERVER_ERROR
 *   • All fallback candidates exhausted → throws MODEL_NOT_FOUND
 *   • Provider error context preserved on error (PR-007)
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  geminiCompleteRaw,
  openrouterCompleteWithFallback,
  oacCompleteRaw,
  validateGeminiDefaultModels,
} from "../openai-compatible-client.js";
import { GroqClientError } from "../errors.js";
import { FREE_MODELS } from "../openrouter/model-catalog.js";
import { _resetForTest } from "../openrouter/dynamic-catalog.js";
import { createExecutionLedger } from "../execution-ledger.js";

const baseMessages = [{ role: "user", content: "hello" } as const];


beforeEach(() => {
  _resetForTest(); // ensure dynamic catalog does not interfere
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

// ── Gemini transport behavior ──────────────────────────────────────────────────

describe("geminiCompleteRaw", () => {
  it("preserves response_format for no-tool Gemini requests", async () => {
    let captured: Record<string, unknown> | undefined;
    vi.stubGlobal("fetch", vi.fn(async (_url: string | URL, init?: RequestInit) => {
      captured = JSON.parse(String(init?.body ?? "{}")) as Record<string, unknown>;
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
    }));

    const result = await geminiCompleteRaw(baseMessages as any, {
      apiKey: "test-key",
      maxTokens: 1,
      model: "gemini-2.0-flash",
      responseFormat: { type: "json_object" },
    });

    expect(result.content).toBe('{"response":"ok","sources":[]}');
    expect(captured).toHaveProperty("response_format", { type: "json_object" });
    expect(captured).not.toHaveProperty("tools");
  });

  it("translates tools to Gemini native function calling", async () => {
    let capturedUrl = "";
    let captured: Record<string, unknown> | undefined;
    vi.stubGlobal("fetch", vi.fn(async (url: string | URL, init?: RequestInit) => {
      capturedUrl = String(url);
      captured = JSON.parse(String(init?.body ?? "{}")) as Record<string, unknown>;
      return {
        ok: true,
        status: 200,
        json: async () => ({
          candidates: [{
            content: {
              role: "model",
              parts: [{ functionCall: { name: "read_file", args: { path: "src/auth.ts" } } }],
            },
            finishReason: "STOP",
          }],
          usageMetadata: { promptTokenCount: 4, candidatesTokenCount: 3 },
        }),
        text: async () => "",
      } as Response;
    }));

    const result = await geminiCompleteRaw(baseMessages as any, {
      apiKey: "test-key",
      model: "gemini-3-flash-preview",
      tools: [{
        type: "function",
        function: {
          name: "read_file",
          description: "Read a file",
          parameters: { type: "object", properties: { path: { type: "string" } }, required: ["path"] },
        },
      }],
      toolChoice: "auto",
    });

    expect(capturedUrl).toContain("/v1beta/models/gemini-3-flash-preview:generateContent");
    expect(captured).toHaveProperty("tools.0.functionDeclarations.0.name", "read_file");
    expect(captured).toHaveProperty("toolConfig.functionCallingConfig.mode", "AUTO");
    expect(captured).not.toHaveProperty("response_format");
    expect(result.toolCalls?.[0]).toMatchObject({
      type: "function",
      function: { name: "read_file", arguments: '{"path":"src/auth.ts"}' },
    });
  });

  it("redacts credential-like transport failures while retaining NETWORK_ERROR", async () => {
    const secret = "AIzaSyFixtureTransportSecret_1234567890";
    vi.stubGlobal("fetch", vi.fn(async () => {
      throw new Error(`fetch failed for https://generativelanguage.googleapis.com?key=${secret}`);
    }));

    const result = geminiCompleteRaw(baseMessages as any, {
      apiKey: "test-key",
      model: "gemini-2.0-flash",
    });
    await expect(result).rejects.toMatchObject({ code: "NETWORK_ERROR" });
    await result.catch((error: GroqClientError) => {
      expect(error.message).not.toContain(secret);
      expect(error.message).toContain("[redacted]");
      expect(JSON.stringify(error.toProviderContext())).not.toContain(secret);
    });
  });
});

describe("validateGeminiDefaultModels", () => {
  const defaults = {
    fast: "gemini-fast-fixture",
    powerful: "gemini-powerful-fixture",
  };

  it("reports retired defaults from Google's model catalog without exposing the key", async () => {
    const fetchMock = vi.fn(async (url: string | URL, init?: RequestInit) => ({
      ok: true,
      status: 200,
      json: async () => ({
        models: [
          {
            name: "models/gemini-fast-fixture",
            supportedGenerationMethods: ["generateContent"],
          },
        ],
      }),
      text: async () => "",
    }) as Response);
    vi.stubGlobal("fetch", fetchMock);

    const result = await validateGeminiDefaultModels("valid-gemini-key", defaults);

    expect(result).toMatchObject({
      valid: false,
      missing: ["powerful"],
      checkedModels: defaults,
    });
    expect(result.reason).toContain("gemini-powerful-fixture");
    expect(fetchMock).toHaveBeenCalledWith(
      "https://generativelanguage.googleapis.com/v1beta/models",
      expect.objectContaining({
        method: "GET",
        headers: expect.objectContaining({
          "x-goog-api-key": "valid-gemini-key",
        }),
      }),
    );
    expect(String(fetchMock.mock.calls[0]?.[0])).not.toContain("valid-gemini-key");
  });

  it("classifies a transient provider response without treating it as model drift", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => ({
      ok: false,
      status: 503,
      json: async () => ({ error: { message: "temporary provider outage" } }),
      text: async () => "temporary provider outage",
    }) as Response));

    await expect(validateGeminiDefaultModels("valid-gemini-key", defaults))
      .rejects.toMatchObject({ code: "SERVER_ERROR" });
  });

  it("confirms both defaults when the provider catalog supports generation", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => ({
        models: [
          { name: "models/gemini-fast-fixture" },
          { name: "gemini-powerful-fixture" },
        ],
      }),
    }) as Response));

    await expect(validateGeminiDefaultModels("valid-gemini-key", defaults))
      .resolves.toMatchObject({
        valid: true,
        missing: [],
        checkedModels: defaults,
      });
  });
});

// ── OpenRouter fallback ────────────────────────────────────────────────────────

describe("OpenRouter transport-error redaction", () => {
  it("redacts provider credentials after the bounded transient retry", async () => {
    const secret = "sk-or-v1-fixture-transport-secret";
    const fetchMock = vi.fn(async () => {
      throw new Error(`OpenRouter request failed: Authorization: Bearer ${secret}`);
    });
    vi.stubGlobal("fetch", fetchMock);

    const result = openrouterCompleteWithFallback(baseMessages as any, {
      apiKey: "test-key",
      model: FREE_MODELS[0]!.id,
      maxFallbackModels: 1,
    });
    await expect(result).rejects.toMatchObject({ code: "NETWORK_ERROR" });
    expect(fetchMock).toHaveBeenCalledTimes(2);
    await result.catch((error: GroqClientError) => {
      expect(error.message).not.toContain(secret);
      expect(error.message).toContain("[redacted]");
      expect(error.code).toBe("NETWORK_ERROR");
      expect(JSON.stringify(error.toProviderContext())).not.toContain(secret);
    });
  });
});

describe("openrouterCompleteWithFallback — error classification", () => {
  const primaryModel = FREE_MODELS[0]!.id;

  it("accepts a free model for its requested capability instead of defaulting to chat", async () => {
    const codingOnlyModel = "cohere/north-mini-code:free";
    const fetchMock = vi.fn(async (_url: string | URL, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body ?? "{}")) as Record<string, unknown>;
      return {
        ok: true,
        status: 200,
        json: async () => ({
          choices: [{ message: { content: '{"response":"ok"}' } }],
          model: body.model,
          usage: { prompt_tokens: 1, completion_tokens: 1 },
        }),
        text: async () => "",
      } as Response;
    });
    vi.stubGlobal("fetch", fetchMock);

    const result = await openrouterCompleteWithFallback(baseMessages as any, {
      apiKey: "test-key",
      model: codingOnlyModel,
      capability: "coding",
      quality: "powerful",
    });

    expect(result.content).toBe('{"response":"ok"}');
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const requestBody = JSON.parse(String(fetchMock.mock.calls[0]![1]?.body)) as Record<string, unknown>;
    expect(requestBody.model).toBe(codingOnlyModel);
  });

  it("400 with invalid-model body → MODEL_NOT_FOUND → triggers fallback", async () => {
    let callCount = 0;
    vi.stubGlobal("fetch", vi.fn(async (_url: string | URL, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body ?? "{}")) as Record<string, unknown>;
      callCount++;
      if (callCount === 1) {
        // First call: primary model → 400 invalid model
        return {
          ok: false, status: 400,
          json: async () => ({}),
          text: async () => `{"error":{"message":"${String(body.model)} is not a valid model ID"}}`,
        } as Response;
      }
      // Fallback call: success
      return {
        ok: true, status: 200,
        json: async () => ({
          choices: [{ message: { content: '{"response":"fallback-ok"}' } }],
          model: String(body.model),
          usage: { prompt_tokens: 1, completion_tokens: 1 },
        }),
        text: async () => "",
      } as Response;
    }));

    const result = await openrouterCompleteWithFallback(baseMessages as any, {
      apiKey: "test-key",
      model: primaryModel,
      maxTokens: 10,
    });

    expect(result.content).toBe('{"response":"fallback-ok"}');
    expect(callCount).toBeGreaterThanOrEqual(2);
  });

  it("400 with unsupported response_format body → MODEL_UNAVAILABLE → triggers fallback", async () => {
    let callCount = 0;
    vi.stubGlobal("fetch", vi.fn(async (_url: string | URL, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body ?? "{}")) as Record<string, unknown>;
      callCount++;
      if (callCount === 1) {
        return {
          ok: false,
          status: 400,
          json: async () => ({}),
          text: async () => '{"error":{"message":"unsupported parameter: response_format"}}',
        } as Response;
      }
      return {
        ok: true,
        status: 200,
        json: async () => ({
          choices: [{ message: { content: '{"response":"fallback-after-400"}' } }],
          model: String(body.model),
          usage: { prompt_tokens: 1, completion_tokens: 1 },
        }),
        text: async () => "",
      } as Response;
    }));

    const result = await openrouterCompleteWithFallback(baseMessages as any, {
      apiKey: "test-key",
      model: primaryModel,
      maxTokens: 10,
    });

    expect(result.content).toBe('{"response":"fallback-after-400"}');
    expect(callCount).toBeGreaterThanOrEqual(2);
  });

  it("404 → MODEL_NOT_FOUND → triggers fallback (PR-003)", async () => {
    let callCount = 0;
    vi.stubGlobal("fetch", vi.fn(async () => {
      callCount++;
      if (callCount === 1) {
        return { ok: false, status: 404, json: async () => ({}), text: async () => '{"error":{"message":"model not found"}}' } as Response;
      }
      return {
        ok: true, status: 200,
        json: async () => ({ choices: [{ message: { content: "ok" } }], model: "m", usage: {} }),
        text: async () => "",
      } as Response;
    }));

    const result = await openrouterCompleteWithFallback(baseMessages as any, {
      apiKey: "test-key", model: primaryModel, maxTokens: 10,
    });
    expect(result.content).toBe("ok");
    expect(callCount).toBeGreaterThanOrEqual(2);
  });

  it("410 → MODEL_UNAVAILABLE → triggers fallback (PR-003)", async () => {
    let callCount = 0;
    vi.stubGlobal("fetch", vi.fn(async () => {
      callCount++;
      if (callCount === 1) {
        return { ok: false, status: 410, json: async () => ({}), text: async () => '{"error":{"message":"model retired"}}' } as Response;
      }
      return {
        ok: true, status: 200,
        json: async () => ({ choices: [{ message: { content: "ok-after-410" } }], model: "m", usage: {} }),
        text: async () => "",
      } as Response;
    }));

    const result = await openrouterCompleteWithFallback(baseMessages as any, {
      apiKey: "test-key", model: primaryModel, maxTokens: 10,
    });
    expect(result.content).toBe("ok-after-410");
  });

  it("422 → MODEL_UNAVAILABLE → triggers fallback (PR-003)", async () => {
    let callCount = 0;
    vi.stubGlobal("fetch", vi.fn(async () => {
      callCount++;
      if (callCount === 1) {
        return { ok: false, status: 422, json: async () => ({}), text: async () => '{"error":{"message":"selected model unavailable"}}' } as Response;
      }
      return {
        ok: true, status: 200,
        json: async () => ({ choices: [{ message: { content: "ok-after-422" } }], model: "m", usage: {} }),
        text: async () => "",
      } as Response;
    }));

    const result = await openrouterCompleteWithFallback(baseMessages as any, {
      apiKey: "test-key", model: primaryModel, maxTokens: 10,
    });
    expect(result.content).toBe("ok-after-422");
  });

  it("EMPTY_RESPONSE → advances to the next model candidate", async () => {
    let callCount = 0;
    const seenModels: string[] = [];
    vi.stubGlobal("fetch", vi.fn(async (_url: string | URL, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body ?? "{}")) as Record<string, unknown>;
      callCount++;
      seenModels.push(String(body.model));
      if (callCount === 1) {
        return {
          ok: true,
          status: 200,
          json: async () => ({
            choices: [{ message: { content: null, tool_calls: [] } }],
            model: String(body.model),
            usage: {},
          }),
          text: async () => "",
        } as Response;
      }
      return {
        ok: true,
        status: 200,
        json: async () => ({
          choices: [{ message: { content: "ok-after-empty" } }],
          model: String(body.model),
          usage: {},
        }),
        text: async () => "",
      } as Response;
    }));

    const result = await openrouterCompleteWithFallback(baseMessages as any, {
      apiKey: "test-key",
      model: primaryModel,
      maxTokens: 10,
    });

    expect(result.content).toBe("ok-after-empty");
    expect(callCount).toBe(2);
    expect(seenModels[1]).not.toBe(seenModels[0]);
  });

  it("429 with no quota keywords → RATE_LIMITED (not fallback-worthy)", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => ({
      ok: false, status: 429,
      json: async () => ({}),
      text: async () => '{"error":{"message":"too many requests"}}',
    } as Response)));

    await expect(
      openrouterCompleteWithFallback(baseMessages as any, { apiKey: "test-key", model: primaryModel, maxTokens: 10 }),
    ).rejects.toSatisfy((err: unknown) => err instanceof GroqClientError && err.code === "RATE_LIMITED");
  });

  it("preserves a bounded Retry-After hint and avoids retrying the same model", async () => {
    const fetchMock = vi.fn(async () => ({
      ok: false,
      status: 429,
      headers: new Headers({ "Retry-After": "120" }),
      json: async () => ({}),
      text: async () => '{"error":{"message":"temporarily rate limited"}}',
    } as Response));
    vi.stubGlobal("fetch", fetchMock);

    await expect(
      oacCompleteRaw(baseMessages as any, {
        apiKey: "test-key",
        model: primaryModel,
        maxTokens: 10,
        retryTransient: true,
        baseUrl: "https://example.test/v1",
        providerName: "OpenRouter",
      }),
    ).rejects.toSatisfy(
      (err: unknown) =>
        err instanceof GroqClientError &&
        err.code === "RATE_LIMITED" &&
        err.retryAfterMs === 60_000,
    );
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("keeps a short Retry-After hint precise for fallback callers", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => ({
      ok: false,
      status: 429,
      headers: new Headers({ "Retry-After": "2" }),
      json: async () => ({}),
      text: async () => '{"error":{"message":"temporarily rate limited"}}',
    } as Response)));

    await expect(
      openrouterCompleteWithFallback(baseMessages as any, {
        apiKey: "test-key",
        model: primaryModel,
        maxTokens: 10,
        retryTransient: false,
      }),
    ).rejects.toSatisfy(
      (err: unknown) =>
        err instanceof GroqClientError &&
        err.code === "RATE_LIMITED" &&
        err.retryAfterMs === 2_000,
    );
  });

  it("parses an HTTP-date Retry-After hint and keeps it bounded", async () => {
    const retryAt = new Date(Date.now() + 5_000).toUTCString();
    vi.stubGlobal("fetch", vi.fn(async () => ({
      ok: false,
      status: 429,
      headers: new Headers({ "Retry-After": retryAt }),
      json: async () => ({}),
      text: async () => '{"error":{"message":"temporarily rate limited"}}',
    } as Response)));

    await expect(
      openrouterCompleteWithFallback(baseMessages as any, {
        apiKey: "test-key",
        model: primaryModel,
        maxTokens: 10,
        retryTransient: false,
      }),
    ).rejects.toSatisfy(
      (err: unknown) =>
        err instanceof GroqClientError &&
        err.code === "RATE_LIMITED" &&
        typeof err.retryAfterMs === "number" &&
        err.retryAfterMs > 0 &&
        err.retryAfterMs <= 60_000,
    );
  });

  it("skips transient retry when the caller owns bounded fallback", async () => {
    let callCount = 0;
    const seenModels: string[] = [];
    vi.stubGlobal("fetch", vi.fn(async () => {
      callCount++;
      // The bounded caller should advance through candidates without retrying
      // the same model. The static catalog is used because this test resets
      // the dynamic catalog before each case.
      seenModels.push(String(callCount));
      return {
        ok: false,
        status: 429,
        json: async () => ({}),
        text: async () => '{"error":{"message":"temporarily rate limited"}}',
      } as Response;
    }));

    await expect(
      openrouterCompleteWithFallback(baseMessages as any, {
        apiKey: "test-key",
        model: primaryModel,
        maxTokens: 10,
        retryTransient: false,
      }),
    ).rejects.toSatisfy((err: unknown) => err instanceof GroqClientError && err.code === "RATE_LIMITED");
    expect(callCount).toBeGreaterThan(1);
    expect(new Set(seenModels).size).toBe(callCount);
  });

  it("bounds provider-owned fallback candidates for short recovery calls", async () => {
    let callCount = 0;
    const seenModels: string[] = [];
    vi.stubGlobal("fetch", vi.fn(async (_url: string | URL, init?: RequestInit) => {
      callCount++;
      const body = JSON.parse(String(init?.body ?? "{}")) as { model?: string };
      seenModels.push(String(body.model));
      return {
        ok: false,
        status: 429,
        json: async () => ({}),
        text: async () => '{"error":{"message":"temporarily rate limited"}}',
      } as Response;
    }));

    let thrown: unknown;
    try {
      await openrouterCompleteWithFallback(baseMessages as any, {
        apiKey: "test-key",
        quality: "powerful",
        capability: "reasoning",
        retryTransient: false,
        maxFallbackModels: 2,
        maxTokens: 10,
      });
    } catch (err) {
      thrown = err;
    }

    expect(thrown).toSatisfy(
      (err: unknown) =>
        err instanceof GroqClientError &&
        err.code === "RATE_LIMITED" &&
        err.providerModel === seenModels.at(-1) &&
        JSON.stringify(err.providerAttemptedModels) === JSON.stringify(seenModels),
    );
    expect(callCount).toBe(2);
    expect(new Set(seenModels).size).toBe(2);
  });

  it("keeps the requested model on reasoning-only EMPTY_RESPONSE", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => ({
        choices: [{
          finish_reason: "stop",
          message: {
            content: null,
            reasoning_content: "private reasoning without a final answer",
          },
        }],
        model: primaryModel,
        usage: { prompt_tokens: 1, completion_tokens: 1 },
      }),
      text: async () => "",
    } as Response)));

    await expect(
      oacCompleteRaw(baseMessages as any, {
        apiKey: "test-key",
        model: primaryModel,
        baseUrl: "https://openrouter.ai/api/v1",
        providerName: "OpenRouter",
        maxTokens: 10,
      }),
    ).rejects.toSatisfy(
      (err: unknown) =>
        err instanceof GroqClientError &&
        err.code === "EMPTY_RESPONSE" &&
        err.providerModel === primaryModel,
    );
  });

  it("keeps the requested model when the response body times out", async () => {
    vi.stubGlobal("fetch", vi.fn(async (_url: string | URL, init?: RequestInit) => ({
      ok: true,
      status: 200,
      json: () =>
        new Promise<never>((_resolve, reject) => {
          const signal = init?.signal;
          if (signal?.aborted) {
            reject(new DOMException("The operation was aborted", "AbortError"));
            return;
          }
          signal?.addEventListener(
            "abort",
            () => reject(new DOMException("The operation was aborted", "AbortError")),
            { once: true },
          );
        }),
      text: async () => "",
    } as unknown as Response)));

    await expect(
      oacCompleteRaw(baseMessages as any, {
        apiKey: "test-key",
        model: primaryModel,
        baseUrl: "https://openrouter.ai/api/v1",
        providerName: "OpenRouter",
        timeoutMs: 5,
        maxTokens: 10,
      }),
    ).rejects.toSatisfy(
      (err: unknown) =>
        err instanceof GroqClientError &&
        err.code === "TIMEOUT" &&
        err.providerModel === primaryModel,
    );
  });

  it("429 with 'quota' in body → QUOTA (PR-008)", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => ({
      ok: false, status: 429,
      json: async () => ({}),
      text: async () => '{"error":{"message":"billing quota exceeded for this month"}}',
    } as Response)));

    await expect(
      openrouterCompleteWithFallback(baseMessages as any, { apiKey: "test-key", model: primaryModel, maxTokens: 10 }),
    ).rejects.toSatisfy((err: unknown) => err instanceof GroqClientError && err.code === "QUOTA");
  });

  it("429 with 'credits' in body → QUOTA (PR-008)", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => ({
      ok: false, status: 429,
      json: async () => ({}),
      text: async () => '{"error":{"message":"insufficient credits"}}',
    } as Response)));

    await expect(
      openrouterCompleteWithFallback(baseMessages as any, { apiKey: "test-key", model: primaryModel, maxTokens: 10 }),
    ).rejects.toSatisfy((err: unknown) => err instanceof GroqClientError && err.code === "QUOTA");
  });

  it("401 → AUTH_ERROR (not fallback-worthy)", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => ({
      ok: false, status: 401, json: async () => ({}), text: async () => "",
    } as Response)));

    await expect(
      openrouterCompleteWithFallback(baseMessages as any, { apiKey: "bad-key", model: primaryModel, maxTokens: 10 }),
    ).rejects.toSatisfy((err: unknown) => err instanceof GroqClientError && err.code === "AUTH_ERROR");
  });

  it("500 → SERVER_ERROR", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => ({
      ok: false, status: 500, json: async () => ({}), text: async () => "internal error",
    } as Response)));

    await expect(
      openrouterCompleteWithFallback(baseMessages as any, { apiKey: "test-key", model: primaryModel, maxTokens: 10 }),
    ).rejects.toSatisfy((err: unknown) => err instanceof GroqClientError && err.code === "SERVER_ERROR");
  });

  it("all candidates exhausted → throws MODEL_NOT_FOUND", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => ({
      ok: false, status: 404, json: async () => ({}), text: async () => '{"error":{"message":"model not found"}}',
    } as Response)));

    await expect(
      openrouterCompleteWithFallback(baseMessages as any, { apiKey: "test-key", model: primaryModel, maxTokens: 10 }),
    ).rejects.toSatisfy((err: unknown) => err instanceof GroqClientError && err.code === "MODEL_NOT_FOUND");
  });

  it("shares provider-attempt budget across fallback candidates", async () => {
    const fetchMock = vi.fn(async () => ({
      ok: false,
      status: 404,
      headers: new Headers(),
      json: async () => ({}),
      text: async () => '{"error":{"message":"model not found"}}',
    } as Response));
    vi.stubGlobal("fetch", fetchMock);
    const ledger = createExecutionLedger({
      budget: { providerAttempts: 2, deadlineMs: 10_000 },
    });

    await expect(
      openrouterCompleteWithFallback(baseMessages as any, {
        apiKey: "test-key",
        model: primaryModel,
        maxFallbackModels: 2,
        executionLedger: ledger,
      }),
    ).rejects.toMatchObject({ code: "MODEL_NOT_FOUND" });

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(ledger.snapshot().counts.provider_attempt).toBe(2);
    expect(ledger.snapshot().providers).toContain("OpenRouter");
  });
});

describe("OpenRouter tool selection", () => {
  it("forwards required tool choice for an explicit execution handoff", async () => {
    let captured: Record<string, unknown> | undefined;
    vi.stubGlobal("fetch", vi.fn(async (_url: string | URL, init?: RequestInit) => {
      captured = JSON.parse(String(init?.body ?? "{}")) as Record<string, unknown>;
      return {
        ok: true,
        status: 200,
        json: async () => ({
          choices: [{
            message: {
              content: null,
              tool_calls: [{
                id: "tc-required",
                type: "function",
                function: { name: "read_file", arguments: '{"path":"src/auth.ts"}' },
              }],
            },
          }],
          model: "test-model",
          usage: { prompt_tokens: 1, completion_tokens: 1 },
        }),
        text: async () => "",
      } as Response;
    }));

    await oacCompleteRaw(baseMessages as any, {
      apiKey: "test-key",
      baseUrl: "https://example.test/v1",
      providerName: "OpenRouter",
      model: "test-model",
      tools: [{
        type: "function",
        function: { name: "read_file", description: "Read a file", parameters: {} },
      }],
      toolChoice: "required",
    });

    expect(captured?.tool_choice).toBe("required");
  });
});

// ── PR-007: provider error context preservation ───────────────────────────────

describe("GroqClientError — provider context (PR-007)", () => {
  it("preserves providerStatus, providerCode, providerMessage from 404", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => ({
      ok: false, status: 404,
      json: async () => ({}),
      text: async () => '{"error":{"code":"model_not_found","message":"The model has been discontinued"}}',
    } as Response)));

    let caught: GroqClientError | null = null;
    try {
      await oacCompleteRaw(baseMessages as any, {
        apiKey: "test-key",
        model: FREE_MODELS[0]!.id,
        baseUrl: "https://openrouter.ai/api/v1",
        providerName: "OpenRouter",
        maxTokens: 10,
      });
    } catch (err) {
      if (err instanceof GroqClientError) caught = err;
    }

    expect(caught).not.toBeNull();
    expect(caught!.code).toBe("MODEL_NOT_FOUND");
    expect(caught!.providerStatus).toBe(404);
    expect(caught!.providerCode).toBe("model_not_found");
    expect(caught!.providerMessage).toContain("discontinued");
    expect(caught!.providerName).toBe("OpenRouter");
  });

  it("toProviderContext() returns a plain serialisable object (PR-007)", async () => {
    const err = new GroqClientError("MODEL_NOT_FOUND", "test", {
      context: { providerStatus: 404, providerCode: "not_found", providerMessage: "gone", providerName: "OpenRouter", providerModel: "m/m:free" },
    });
    const ctx = err.toProviderContext();
    expect(ctx).toEqual({
      providerStatus: 404,
      providerCode: "not_found",
      providerMessage: "gone",
      providerName: "OpenRouter",
      providerModel: "m/m:free",
    });
    // Must be JSON-serialisable
    expect(() => JSON.stringify(ctx)).not.toThrow();
  });
});

// ── Non-string provider code regression ──────────────────────────────────────

describe("classifyStatus — non-string provider code does not crash (runtime type guard)", () => {
  const primaryModel = FREE_MODELS[0]!.id;

  it.each([
    {
      name: "string provider code",
      body: '{"error":{"code":"model_not_found","message":"provider code only"}}',
      expectedProviderCode: "model_not_found",
    },
    {
      name: "object provider code",
      body: '{"error":{"code":{"kind":"model_not_found"},"message":"model not found"}}',
      expectedProviderCode: undefined,
    },
    {
      name: "missing provider code",
      body: '{"error":{"message":"model not found"}}',
      expectedProviderCode: undefined,
    },
  ])("400 $name does not crash and still classifies as MODEL_NOT_FOUND", async ({ body, expectedProviderCode }) => {
    vi.stubGlobal("fetch", vi.fn(async () => ({
      ok: false,
      status: 400,
      json: async () => ({}),
      text: async () => body,
    } as Response)));

    await expect(
      oacCompleteRaw(baseMessages as any, {
        apiKey: "test-key",
        model: primaryModel,
        maxTokens: 10,
        baseUrl: "https://openrouter.ai/api/v1",
        providerName: "OpenRouter",
      }),
    ).rejects.toSatisfy((err: unknown) =>
      err instanceof GroqClientError &&
      err.code === "MODEL_NOT_FOUND" &&
      err.providerCode === expectedProviderCode
    );
  });
});

// ── PR-008: error code completeness ──────────────────────────────────────────

describe("GroqErrorCode completeness (PR-008)", () => {
  it("MODEL_UNAVAILABLE is a valid GroqErrorCode", () => {
    const err = new GroqClientError("MODEL_UNAVAILABLE", "test");
    expect(err.code).toBe("MODEL_UNAVAILABLE");
  });

  it("QUOTA is a valid GroqErrorCode", () => {
    const err = new GroqClientError("QUOTA", "test");
    expect(err.code).toBe("QUOTA");
  });
});

// ── _trimMessagesForOpenRouter / _groupMessages — tool-call-aware trim ────────

import type { RawMessage } from "../groq-client.js";
import { _trimMessagesForOpenRouter, _groupMessages } from "../openai-compatible-client.js";

function makeAssistantWithTools(ids: string[]): RawMessage {
  return {
    role: "assistant",
    content: null,
    tool_calls: ids.map((id) => ({
      id,
      type: "function" as const,
      function: { name: "read_file", arguments: JSON.stringify({ path: "x.ts" }) },
    })),
  };
}

function makeToolResult(id: string): RawMessage {
  return { role: "tool", tool_call_id: id, content: `result-${id}` } as RawMessage;
}

// ── _groupMessages ─────────────────────────────────────────────────────────

describe("_groupMessages", () => {
  it("wraps a user message as a single group", () => {
    const groups = _groupMessages([{ role: "user", content: "hi" }]);
    expect(groups).toHaveLength(1);
    expect(groups[0].kind).toBe("single");
  });

  it("wraps an assistant-with-tool_calls + its tool results as one tool_group", () => {
    const groups = _groupMessages([
      makeAssistantWithTools(["id-1"]),
      makeToolResult("id-1"),
    ]);
    expect(groups).toHaveLength(1);
    expect(groups[0].kind).toBe("tool_group");
    if (groups[0].kind === "tool_group") {
      expect(groups[0].messages).toHaveLength(2);
    }
  });

  it("stops absorbing tool results when tool_call_id does not match the current assistant turn", () => {
    // assistant(id-1) → tool(id-1) → tool(id-2-from-future) should produce:
    //   tool_group[assistant(id-1), tool(id-1)], single[tool(id-2)]
    const messages: RawMessage[] = [
      makeAssistantWithTools(["id-1"]),
      makeToolResult("id-1"),
      makeToolResult("id-2"),   // id-2 is NOT in the preceding assistant's declared ids
    ];
    const groups = _groupMessages(messages);
    expect(groups).toHaveLength(2);
    expect(groups[0].kind).toBe("tool_group");
    if (groups[0].kind === "tool_group") {
      expect(groups[0].messages).toHaveLength(2);
    }
    // The stray tool result falls through as a single group
    expect(groups[1].kind).toBe("single");
  });

  it("handles two consecutive tool_groups correctly", () => {
    const messages: RawMessage[] = [
      makeAssistantWithTools(["a"]),
      makeToolResult("a"),
      { role: "user", content: "next" },
      makeAssistantWithTools(["b"]),
      makeToolResult("b"),
    ];
    const groups = _groupMessages(messages);
    expect(groups).toHaveLength(3);
    expect(groups[0].kind).toBe("tool_group");
    expect(groups[1].kind).toBe("single");
    expect(groups[2].kind).toBe("tool_group");
  });
});

// ── _trimMessagesForOpenRouter ─────────────────────────────────────────────

describe("_trimMessagesForOpenRouter — atomic-group context trim", () => {
  it("removes empty assistant turns before the fast path", () => {
    const result = _trimMessagesForOpenRouter([
      { role: "system", content: "system" },
      { role: "user", content: "inspect the files" },
      { role: "assistant", content: null },
      { role: "user", content: "now synthesize" },
    ]);

    expect(result).toEqual([
      { role: "system", content: "system" },
      { role: "user", content: "inspect the files" },
      { role: "user", content: "now synthesize" },
    ]);
    expect(
      result.some(
        (message) =>
          message.role === "assistant" &&
          !message.content &&
          (!message.tool_calls || message.tool_calls.length === 0),
      ),
    ).toBe(false);
  });

  it("drops orphaned tool results after removing an empty assistant turn", () => {
    const result = _trimMessagesForOpenRouter([
      { role: "system", content: "system" },
      { role: "assistant", content: null },
      makeToolResult("orphaned"),
      { role: "user", content: "continue" },
    ]);

    expect(result).toEqual([
      { role: "system", content: "system" },
      { role: "user", content: "continue" },
    ]);
  });

  it("returns the full array unchanged when within the 20-message limit", () => {
    const messages: RawMessage[] = [
      { role: "system", content: "sys" },
      { role: "user", content: "hello" },
    ];
    expect(_trimMessagesForOpenRouter(messages)).toHaveLength(2);
  });

  it("preserves the system message and keeps the most-recent turns", () => {
    // 22 user messages → only 20 most recent survive, system is always kept
    const messages: RawMessage[] = [
      { role: "system", content: "sys" },
      ...Array.from({ length: 22 }, (_, i) => ({
        role: "user" as const,
        content: `msg-${i}`,
      })),
    ];
    const result = _trimMessagesForOpenRouter(messages);
    expect(result).toHaveLength(21); // system + 20 user
    expect(result[0]).toMatchObject({ role: "system" });
    expect(result[result.length - 1]).toMatchObject({ content: "msg-21" });
  });

  it("drops the whole tool_group when the assistant fits but budget runs out — window starts with tool result", () => {
    // Regression: the critical case where a naive slice(-20) would retain the
    // tool result at the start of the window while cutting its parent assistant turn.
    //
    // rest = [assistant(cut-id), tool(cut-id), user-0 … user-18] = 21 entries
    // groups: tool_group(2) + 19 singles — total 21 non-system messages
    // budget = 20: walk backward, absorb 19 singles (budget → 1), then the
    // tool_group costs 2 which exceeds the remaining budget → dropped whole.
    //
    // Result: system + 19 user messages (no tool result in window start).
    const messages: RawMessage[] = [
      { role: "system", content: "sys" },
      makeAssistantWithTools(["cut-id"]),   // will be outside the kept window
      makeToolResult("cut-id"),             // would be orphaned in a naive slice
      ...Array.from({ length: 19 }, (_, i) => ({
        role: "user" as const,
        content: `filler-${i}`,
      })),
    ];
    const result = _trimMessagesForOpenRouter(messages);
    // Neither the assistant nor the tool result should appear
    expect(result.every((m) => {
      const tm = m as { tool_call_id?: string; tool_calls?: unknown[] };
      return !tm.tool_call_id && !(Array.isArray(tm.tool_calls) && tm.tool_calls.length > 0);
    })).toBe(true);
    expect(result[0]).toMatchObject({ role: "system" });
  });

  it("keeps a complete tool_group when it fits atomically within the window", () => {
    // 18 user messages + 1 assistant + 1 tool result = 20 non-system → fits exactly
    const messages: RawMessage[] = [
      { role: "system", content: "sys" },
      ...Array.from({ length: 18 }, (_, i) => ({
        role: "user" as const,
        content: `msg-${i}`,
      })),
      makeAssistantWithTools(["keep-id"]),
      makeToolResult("keep-id"),
    ];
    const result = _trimMessagesForOpenRouter(messages);
    expect(result).toHaveLength(21); // system + 20
    expect(result.some((m) => (m as { tool_call_id?: string }).tool_call_id === "keep-id")).toBe(true);
  });

  it("discards an oversized tool_group that exceeds the budget rather than forwarding it whole", () => {
    // Overflow policy: a group larger than the budget is ALWAYS discarded.
    // Here the only non-system content is a single oversized tool_group (26 messages).
    // The trimmer must not forward it; the result is just [system].
    const messages: RawMessage[] = [
      { role: "system", content: "sys" },
      makeAssistantWithTools(Array.from({ length: 25 }, (_, i) => `id-${i}`)),
      ...Array.from({ length: 25 }, (_, i) => makeToolResult(`id-${i}`)),
    ];
    const result = _trimMessagesForOpenRouter(messages);
    // Only the system message survives — the oversized group is dropped
    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({ role: "system" });
    // Non-system count ≤ 20 (it is 0 here, still within budget)
    const nonSystem = result.filter((m) => m.role !== "system");
    expect(nonSystem.length).toBeLessThanOrEqual(20);
  });

  it("works correctly when there is no system message — does not treat the first user message as system", () => {
    // 22 user messages, no system message.
    // Old threshold (≤ 21) would have returned all 22 unchanged, exceeding the 20-message budget.
    const messages: RawMessage[] = Array.from({ length: 22 }, (_, i) => ({
      role: "user" as const,
      content: `msg-${i}`,
    }));
    const result = _trimMessagesForOpenRouter(messages);
    // Should keep exactly 20 most-recent user messages (no system message to preserve)
    expect(result).toHaveLength(20);
    expect(result[0]).toMatchObject({ content: "msg-2" });
    expect(result[result.length - 1]).toMatchObject({ content: "msg-21" });
    expect(result.every((m) => m.role === "user")).toBe(true);
  });

  it("never returns more than 20 non-system messages for any input (integration bound check)", () => {
    // Build a history with mixed single messages and a multi-tool group, 30 non-system total.
    const messages: RawMessage[] = [
      { role: "system", content: "sys" },
      ...Array.from({ length: 10 }, (_, i) => ({ role: "user" as const, content: `early-${i}` })),
      makeAssistantWithTools(["a", "b", "c"]),
      makeToolResult("a"),
      makeToolResult("b"),
      makeToolResult("c"),
      ...Array.from({ length: 15 }, (_, i) => ({ role: "user" as const, content: `recent-${i}` })),
    ];
    const result = _trimMessagesForOpenRouter(messages);

    // Structural validity: no tool result should be an orphan
    const assistantIds = new Set<string>();
    let lastAssistantIds = new Set<string>();
    for (const m of result) {
      if (m.role === "assistant" && Array.isArray(m.tool_calls)) {
        lastAssistantIds = new Set(
          m.tool_calls.map((tc: { id?: string }) => tc.id).filter((id): id is string => !!id),
        );
        m.tool_calls.forEach((tc: { id?: string }) => { if (tc.id) assistantIds.add(tc.id); });
      } else if (m.role === "tool") {
        const id = (m as { tool_call_id?: string }).tool_call_id;
        // Every tool result must reference an id from the immediately preceding assistant
        expect(id && lastAssistantIds.has(id)).toBe(true);
      } else {
        lastAssistantIds = new Set(); // reset on non-tool non-assistant
      }
    }

    // Budget enforcement: at most 20 non-system messages
    const nonSystem = result.filter((m) => m.role !== "system");
    expect(nonSystem.length).toBeLessThanOrEqual(20);
  });
});
