/**
 * PR-012 — Regression tests for the OpenAI-compatible client.
 *
 * Covers:
 *   • Gemini strips tools / response_format (existing)
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
import { geminiCompleteRaw, openrouterCompleteWithFallback, oacCompleteRaw } from "../openai-compatible-client.js";
import { GroqClientError } from "../errors.js";
import { FREE_MODELS } from "../openrouter/model-catalog.js";
import { _resetForTest } from "../openrouter/dynamic-catalog.js";

const baseMessages = [{ role: "user", content: "hello" } as const];


beforeEach(() => {
  _resetForTest(); // ensure dynamic catalog does not interfere
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

// ── Gemini tool stripping ──────────────────────────────────────────────────────

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
    delete (globalThis as unknown as { __capturedGeminiBody?: Record<string, unknown> }).__capturedGeminiBody;
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

// ── OpenRouter fallback ────────────────────────────────────────────────────────

describe("openrouterCompleteWithFallback — error classification", () => {
  const primaryModel = FREE_MODELS[0]!.id;

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
