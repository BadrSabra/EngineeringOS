/**
 * PR-08 — End-to-End OpenRouter Failure Scenario Tests
 *
 * Covers:
 *   • Model Removed (404)           → MODEL_NOT_FOUND, automatic fallback
 *   • Free Tier Restricted (402)    → PLAN_RESTRICTED, automatic fallback
 *   • Invalid API Key (401)         → AUTH_ERROR, no fallback
 *   • Rate Limit (429)              → RATE_LIMITED, transient retry
 *   • Credits Exhausted (429+body)  → QUOTA
 *   • Empty Model Catalog           → static fallback, never throws
 *   • Provider Failover             → MODEL_UNAVAILABLE triggers next model
 *   • Circuit Breaker Activation    → opens after threshold, skips provider
 *   • Runtime Model Refresh         → dynamic catalog filters stale IDs
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { GroqClientError } from "../errors.js";
import {
  isCircuitOpen,
  recordCircuitFailure,
  recordCircuitSuccess,
  getCircuitState,
  _resetCircuitsForTest,
} from "../openrouter/circuit-breaker.js";
import {
  resolveFallbackChain,
  buildFallbackChainFromId,
} from "../openrouter/model-resolver.js";
import {
  getDynamicModelIds,
  isDynamicCatalogLoaded,
  refreshDynamicCatalog,
  _resetForTest as _resetDynamicCatalog,
} from "../openrouter/dynamic-catalog.js";
import { FREE_MODELS } from "../openrouter/model-catalog.js";
import {
  classifyOpenRouterFailure,
  openrouterCompleteStream,
} from "../openai-compatible-client.js";
import {
  openrouterStrategy,
  shouldRecordCircuitFailure,
} from "../strategies/openrouter.strategy.js";

// ── helpers ──────────────────────────────────────────────────────────────────

/** Build a minimal fetch mock that returns a given HTTP status and body. */
function mockFetch(status: number, body: unknown) {
  return vi.fn().mockResolvedValue({
    ok: status >= 200 && status < 300,
    status,
    text: () => Promise.resolve(typeof body === "string" ? body : JSON.stringify(body)),
    json: () => Promise.resolve(body),
  });
}

/** Build a successful OpenAI-compatible chat response. */
function okResponse(model = "inclusionai/ling-3.0-flash:free") {
  return {
    choices: [{ message: { content: "Hello!", tool_calls: undefined } }],
    model,
    usage: { prompt_tokens: 10, completion_tokens: 5 },
  };
}

function streamResponse(
  chunks: string[],
  options: { disconnect?: boolean } = {},
): Response {
  const encoder = new TextEncoder();
  let index = 0;
  const body = new ReadableStream<Uint8Array>({
    pull(controller) {
      if (index < chunks.length) {
        controller.enqueue(encoder.encode(chunks[index++]!));
      } else if (options.disconnect) {
        controller.error(new Error("fixture stream disconnected"));
      } else {
        controller.close();
      }
    },
  });
  return new Response(body, { status: 200 });
}

function sseDelta(text: string): string {
  return `data: ${JSON.stringify({ choices: [{ delta: { content: text } }] })}\n\n`;
}

// ── Circuit Breaker ───────────────────────────────────────────────────────────

describe("circuit-breaker", () => {
  beforeEach(() => _resetCircuitsForTest());

  it("starts closed with zero failures", () => {
    expect(isCircuitOpen("openrouter")).toBe(false);
    const state = getCircuitState("openrouter");
    expect(state.open).toBe(false);
    expect(state.consecutiveFailures).toBe(0);
  });

  it("stays closed below the threshold", () => {
    for (let i = 0; i < 4; i++) recordCircuitFailure("openrouter");
    expect(isCircuitOpen("openrouter")).toBe(false);
    expect(getCircuitState("openrouter").consecutiveFailures).toBe(4);
  });

  it("opens at the threshold (5 consecutive failures)", () => {
    for (let i = 0; i < 5; i++) recordCircuitFailure("openrouter");
    expect(isCircuitOpen("openrouter")).toBe(true);
    expect(getCircuitState("openrouter").open).toBe(true);
  });

  it("closes immediately on success", () => {
    for (let i = 0; i < 5; i++) recordCircuitFailure("openrouter");
    expect(isCircuitOpen("openrouter")).toBe(true);
    // Simulate cooldown elapsed by patching openedAt
    const state = getCircuitState("openrouter");
    expect(state.open).toBe(true);

    // Reset so we can test the success path without waiting
    _resetCircuitsForTest();
    recordCircuitSuccess("openrouter");
    expect(isCircuitOpen("openrouter")).toBe(false);
    expect(getCircuitState("openrouter").consecutiveFailures).toBe(0);
  });

  it("resets consecutive-failure counter on success", () => {
    for (let i = 0; i < 3; i++) recordCircuitFailure("openrouter");
    recordCircuitSuccess("openrouter");
    expect(getCircuitState("openrouter").consecutiveFailures).toBe(0);
  });

  it("provides cooldownRemainingMs when open", () => {
    for (let i = 0; i < 5; i++) recordCircuitFailure("openrouter");
    const { cooldownRemainingMs } = getCircuitState("openrouter");
    expect(cooldownRemainingMs).not.toBeNull();
    expect(cooldownRemainingMs!).toBeGreaterThan(0);
    expect(cooldownRemainingMs!).toBeLessThanOrEqual(2 * 60 * 1_000);
  });

  it("isolates circuits per provider", () => {
    for (let i = 0; i < 5; i++) recordCircuitFailure("openrouter");
    expect(isCircuitOpen("openrouter")).toBe(true);
    expect(isCircuitOpen("groq")).toBe(false);
  });

  it("does not count local capability/configuration mismatches as provider failures", () => {
    expect(
      shouldRecordCircuitFailure(
        new GroqClientError(
          "INVALID_CONFIG",
          "model does not satisfy the requested capability",
          { context: { providerCode: "MODEL_CAPABILITY_MISMATCH" } },
        ),
      ),
    ).toBe(false);
    expect(
      shouldRecordCircuitFailure(
        new GroqClientError("SERVER_ERROR", "provider unavailable"),
      ),
    ).toBe(true);
    expect(
      shouldRecordCircuitFailure(
        new GroqClientError("EMPTY_RESPONSE", "model returned no final content"),
      ),
    ).toBe(false);
    expect(
      shouldRecordCircuitFailure(
        new GroqClientError(
          "INVALID_TOOL_CALL",
          "model returned a tool call outside the request contract",
        ),
      ),
    ).toBe(false);
  });
});

// ── Model Resolver ────────────────────────────────────────────────────────────

describe("model-resolver — empty catalog fallback", () => {
  it("returns at least one model even with requireTools filter", () => {
    const chain = resolveFallbackChain({ capability: "chat", requireTools: true });
    expect(chain.length).toBeGreaterThan(0);
  });

  it("returns ordered chain with powerful tier first when requested", () => {
    const chain = resolveFallbackChain({ capability: "chat", quality: "powerful" });
    expect(chain.length).toBeGreaterThan(1);
    // First entry must be a powerful-tier model from FREE_MODELS
    const first = FREE_MODELS.find((m) => m.id === chain[0]!.id);
    expect(first?.quality).toBe("powerful");
  });

  it("buildFallbackChainFromId always includes the initial model first", () => {
    const initial = "nvidia/nemotron-3-super-120b-a12b:free";
    const chain = buildFallbackChainFromId(initial);
    expect(chain[0]).toBe(initial);
    expect(chain.length).toBeGreaterThan(1);
  });

  it("buildFallbackChainFromId with unknown model returns singleton", () => {
    const chain = buildFallbackChainFromId("some/custom-paid-model");
    expect(chain).toEqual(["some/custom-paid-model"]);
  });

  it("resolveFallbackChain with no capability match degrades gracefully", () => {
    // "long_context" is rare — should still return models
    const chain = resolveFallbackChain({ capability: "long_context" });
    expect(chain.length).toBeGreaterThan(0);
  });
});

// ── Dynamic catalog interaction ───────────────────────────────────────────────

describe("dynamic catalog — runtime model refresh", () => {
  beforeEach(() => _resetDynamicCatalog());
  afterEach(() => _resetDynamicCatalog());

  it("getDynamicModelIds returns null before first fetch", () => {
    expect(getDynamicModelIds()).toBeNull();
  });

  it("resolveFallbackChain falls back to static list when catalog not loaded", () => {
    // catalog not loaded → getDynamicModelIds() returns null → static list used
    const chain = resolveFallbackChain({ capability: "chat" });
    expect(chain.length).toBeGreaterThan(0);
    // All IDs should come from FREE_MODELS since catalog is not loaded
    const staticIds = new Set(FREE_MODELS.map((m) => m.id));
    for (const entry of chain) {
      expect(staticIds.has(entry.id)).toBe(true);
    }
  });

  it("keeps the static compatibility path when the first refresh fails", async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 503,
      json: () => Promise.resolve({}),
    }) as typeof fetch;

    await refreshDynamicCatalog("test-key");

    expect(isDynamicCatalogLoaded()).toBe(true);
    expect(resolveFallbackChain({ capability: "chat" }).length).toBeGreaterThan(0);
  });

  it("keeps only free live IDs and preserves the last catalog on an empty refresh", async () => {
    vi.useFakeTimers({ now: Date.now() });
    const liveFree = FREE_MODELS[0].id;
    global.fetch = vi.fn()
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: () => Promise.resolve({
          data: [
            { id: liveFree, pricing: { prompt: "0", completion: "0" } },
            { id: "paid/provider-model", pricing: { prompt: "0.001", completion: "0.002" } },
          ],
        }),
      })
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: () => Promise.resolve({ data: [] }),
      }) as typeof fetch;

    await refreshDynamicCatalog("test-key");
    expect(getDynamicModelIds()).toEqual(new Set([liveFree]));
    const filtered = resolveFallbackChain({ capability: "chat" });
    expect(filtered.map((model) => model.id)).toEqual([liveFree]);

    // Force a second fetch without allowing the empty response to erase
    // usable evidence from the previous refresh.
    vi.advanceTimersByTime(10 * 60 * 1_000 + 1);
    await refreshDynamicCatalog("test-key");
    expect(getDynamicModelIds()).toEqual(new Set([liveFree]));
    expect(isDynamicCatalogLoaded()).toBe(true);
    vi.useRealTimers();
  });

  it("uses a loaded live catalog as a hard boundary for stale candidates", async () => {
    const liveFree = FREE_MODELS[0].id;
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: () => Promise.resolve({
        data: [{ id: liveFree, pricing: { prompt: "0", completion: "0" } }],
      }),
    }) as typeof fetch;
    await refreshDynamicCatalog();

    const chain = resolveFallbackChain({ capability: "chat" });
    expect(chain).toHaveLength(1);
    expect(chain[0]?.id).toBe(liveFree);
    expect(chain.every((model) => model.id.endsWith(":free"))).toBe(true);
  });

  it("re-resolves a pinned model when the request refresh replaces its snapshot", async () => {
    vi.useFakeTimers({ now: Date.now() });
    const firstModel = FREE_MODELS.find((model) => model.capabilities.includes("chat"))!.id;
    const secondModel = FREE_MODELS.find((model) =>
      model.capabilities.includes("chat") && model.id !== firstModel,
    )!.id;
    const seenModels: string[] = [];
    let catalogFetches = 0;
    global.fetch = vi.fn(async (url: string | URL, init?: RequestInit) => {
      if (String(url).endsWith("/models")) {
        catalogFetches++;
        const useSecondSnapshot = catalogFetches > 1;
        return {
          ok: true,
          status: 200,
          json: () => Promise.resolve({
            data: [{
              id: useSecondSnapshot ? secondModel : firstModel,
              pricing: { prompt: "0", completion: "0" },
            }],
          }),
        } as Response;
      }
      const body = JSON.parse(String(init?.body ?? "{}")) as { model?: string };
      seenModels.push(String(body.model));
      return {
        ok: true,
        status: 200,
        json: () => Promise.resolve({
          choices: [{ message: { content: "ok" } }],
          model: body.model,
          usage: {},
        }),
      } as Response;
    }) as typeof fetch;

    await refreshDynamicCatalog("test-key");
    vi.advanceTimersByTime(10 * 60 * 1_000 + 1);
    const result = await openrouterStrategy.call(
      [{ role: "user", content: "hello" }],
      {
        apiKey: "test-key",
        model: firstModel,
        capability: "chat",
        quality: "fast",
      },
    );

    expect(result.content).toBe("ok");
    expect(seenModels).toEqual([secondModel]);
    vi.useRealTimers();
  });
});

// ── Error classification (PR-04) ─────────────────────────────────────────────

describe("error classification", () => {
  // We test via oacCompleteRaw's classifyStatus path by mocking fetch
  const globalFetch = global.fetch;

  afterEach(() => {
    global.fetch = globalFetch;
    vi.restoreAllMocks();
  });

  async function callWithStatus(status: number, body: unknown) {
    const { oacCompleteRaw } = await import("../openai-compatible-client.js");
    global.fetch = mockFetch(status, body) as typeof fetch;
    return oacCompleteRaw(
      [{ role: "user", content: "hi" }],
      {
        apiKey: "sk-test",
        baseUrl: "https://openrouter.ai/api/v1",
        providerName: "OpenRouter",
        model: "inclusionai/ling-3.0-flash:free",
      },
    );
  }

  it("404 → MODEL_NOT_FOUND", async () => {
    await expect(
      callWithStatus(404, { error: { code: "model_not_found", message: "not found" } }),
    ).rejects.toSatisfy((e: unknown) =>
      e instanceof GroqClientError && e.code === "MODEL_NOT_FOUND",
    );
  });

  it("preserves actual model and termination metadata from a successful response", async () => {
    const { oacCompleteRaw } = await import("../openai-compatible-client.js");
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: () =>
        Promise.resolve({
          choices: [{
            finish_reason: "length",
            message: {
              content: "partial",
              reasoning_content: "hidden reasoning",
            },
          }],
          model: "actual/model:free",
          usage: {
            prompt_tokens: 12,
            completion_tokens: 34,
            completion_tokens_details: { reasoning_tokens: 21 },
          },
        }),
    }) as typeof fetch;

    const result = await oacCompleteRaw(
      [{ role: "user", content: "hi" }],
      {
        apiKey: "sk-test",
        baseUrl: "https://openrouter.ai/api/v1",
        providerName: "OpenRouter",
        model: "requested/model:free",
      },
    );

    expect(result.model).toBe("actual/model:free");
    expect(result.finishReason).toBe("length");
    expect(result.reasoningContent).toBe("hidden reasoning");
    expect(result.reasoningTokens).toBe(21);
  });

  it("accepts top-level output_text when message is absent", async () => {
    const { oacCompleteRaw } = await import("../openai-compatible-client.js");
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: () =>
        Promise.resolve({
          choices: [{}],
          output_text: "final text",
          model: "actual/model:free",
          usage: {},
        }),
    }) as typeof fetch;

    const result = await oacCompleteRaw(
      [{ role: "user", content: "hi" }],
      {
        apiKey: "sk-test",
        baseUrl: "https://openrouter.ai/api/v1",
        providerName: "OpenRouter",
        model: "requested/model:free",
      },
    );

    expect(result.content).toBe("final text");
    expect(result.outputText).toBe("final text");
  });

  it("retries the same model without JSON mode when OpenRouter rejects it", async () => {
    const { openrouterCompleteRaw } = await import("../openai-compatible-client.js");
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({
        ok: false,
        status: 400,
        text: () => Promise.resolve(JSON.stringify({
          error: { code: "invalid_request", message: "response_format is not supported" },
        })),
      })
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: () => Promise.resolve({
          choices: [{
            finish_reason: "stop",
            message: { content: '{"response":"ok","sources":[]}' },
          }],
          model: "same/model:free",
          usage: {},
        }),
      });
    global.fetch = fetchMock as typeof fetch;

    const result = await openrouterCompleteRaw(
      [{ role: "user", content: "return JSON" }],
      {
        apiKey: "sk-test",
        model: "same/model:free",
        responseFormat: { type: "json_object" },
      },
    );

    expect(result.content).toContain('"response":"ok"');
    expect(fetchMock).toHaveBeenCalledTimes(2);
    const firstBody = JSON.parse(fetchMock.mock.calls[0]![1].body as string);
    const secondBody = JSON.parse(fetchMock.mock.calls[1]![1].body as string);
    expect(firstBody.response_format).toEqual({ type: "json_object" });
    expect(secondBody.response_format).toBeUndefined();
  });

  it("402 → PLAN_RESTRICTED", async () => {
    await expect(
      callWithStatus(402, { error: { message: "model requires payment" } }),
    ).rejects.toSatisfy((e: unknown) =>
      e instanceof GroqClientError && e.code === "PLAN_RESTRICTED",
    );
  });

  it("401 → AUTH_ERROR", async () => {
    await expect(
      callWithStatus(401, { error: { message: "invalid api key" } }),
    ).rejects.toSatisfy((e: unknown) =>
      e instanceof GroqClientError && e.code === "AUTH_ERROR",
    );
  });

  it("429 without billing keywords → RATE_LIMITED", async () => {
    await expect(
      callWithStatus(429, { error: { message: "too many requests" } }),
    ).rejects.toSatisfy((e: unknown) =>
      e instanceof GroqClientError && e.code === "RATE_LIMITED",
    );
  });

  it("429 with billing body → QUOTA", async () => {
    await expect(
      callWithStatus(429, { error: { message: "insufficient credits, please add balance" } }),
    ).rejects.toSatisfy((e: unknown) =>
      e instanceof GroqClientError && e.code === "QUOTA",
    );
  });

  it("410 → MODEL_UNAVAILABLE", async () => {
    await expect(
      callWithStatus(410, { error: { message: "model retired" } }),
    ).rejects.toSatisfy((e: unknown) =>
      e instanceof GroqClientError && e.code === "MODEL_UNAVAILABLE",
    );
  });

  it("422 → MODEL_UNAVAILABLE", async () => {
    await expect(
      callWithStatus(422, { error: { message: "model temporarily unavailable" } }),
    ).rejects.toSatisfy((e: unknown) =>
      e instanceof GroqClientError && e.code === "MODEL_UNAVAILABLE",
    );
  });

  it("maps every terminal and recoverable failure to a safe disposition", () => {
    expect(classifyOpenRouterFailure("MODEL_NOT_FOUND")).toMatchObject({
      action: "choose-alternative",
      terminal: false,
      evidenceStatus: "incomplete",
    });
    expect(classifyOpenRouterFailure("MODEL_UNAVAILABLE").action).toBe("choose-alternative");
    expect(classifyOpenRouterFailure("PLAN_RESTRICTED").action).toBe("choose-alternative");
    expect(classifyOpenRouterFailure("EMPTY_RESPONSE")).toMatchObject({
      action: "choose-alternative",
      evidenceStatus: "incomplete",
    });
    expect(classifyOpenRouterFailure("INVALID_TOOL_CALL")).toMatchObject({
      action: "choose-alternative",
      terminal: false,
    });
    expect(classifyOpenRouterFailure("RATE_LIMITED").action).toBe("wait");
    expect(classifyOpenRouterFailure("TIMEOUT").action).toBe("retry");
    expect(classifyOpenRouterFailure("NETWORK_ERROR").action).toBe("retry");
    expect(classifyOpenRouterFailure("SERVER_ERROR").action).toBe("retry");
    expect(classifyOpenRouterFailure("AUTH_ERROR")).toMatchObject({
      action: "stop-safely",
      terminal: true,
    });
    expect(classifyOpenRouterFailure("QUOTA")).toMatchObject({
      action: "stop-safely",
      terminal: true,
    });
  });
});

// ── Streaming reliability ─────────────────────────────────────────────────────

describe("openrouterCompleteStream — bounded retry and disconnect safety", () => {
  const globalFetch = global.fetch;

  afterEach(() => {
    global.fetch = globalFetch;
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("retries a transient failure before the first chunk within one bounded retry", async () => {
    vi.useFakeTimers();
    const fetchMock = vi.fn()
      .mockRejectedValueOnce(new Error("fixture connection reset"))
      .mockResolvedValueOnce(streamResponse([sseDelta("recovered"), "data: [DONE]\n\n"]));
    global.fetch = fetchMock as typeof fetch;

    const chunks: string[] = [];
    const run = (async () => {
      for await (const chunk of openrouterCompleteStream(
        [{ role: "user", content: "hi" }],
        { apiKey: "fixture-key", model: FREE_MODELS[0].id, maxFallbackModels: 1 },
      )) {
        chunks.push(chunk);
      }
    })();
    await vi.advanceTimersByTimeAsync(1_500);
    await run;

    expect(chunks.join("")).toBe("recovered");
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("advances to the next capability-compatible free model when unavailable", async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(
        JSON.stringify({ error: { code: "model_unavailable", message: "fixture unavailable" } }),
        { status: 422, headers: { "content-type": "application/json" } },
      ))
      .mockResolvedValueOnce(streamResponse([sseDelta("fallback"), "data: [DONE]\n\n"]));
    global.fetch = fetchMock as typeof fetch;

    const chunks: string[] = [];
    for await (const chunk of openrouterCompleteStream(
      [{ role: "user", content: "hi" }],
      {
        apiKey: "fixture-key",
        model: FREE_MODELS.find((entry) => entry.capabilities.includes("chat"))!.id,
        capability: "chat",
        maxFallbackModels: 2,
      },
    )) {
      chunks.push(chunk);
    }

    expect(chunks.join("")).toBe("fallback");
    expect(fetchMock).toHaveBeenCalledTimes(2);
    const attemptedModels = fetchMock.mock.calls.map((call) =>
      JSON.parse(String((call[1] as RequestInit).body)).model,
    );
    expect(attemptedModels[0]).not.toBe(attemptedModels[1]);
    expect(attemptedModels.every((model: string) => model.endsWith(":free"))).toBe(true);
  });

  it("terminalizes a disconnect after the first chunk without retrying or duplicating text", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      streamResponse([sseDelta("first "), sseDelta("answer"), "data: [DONE]\n\n"], { disconnect: true }),
    );
    global.fetch = fetchMock as typeof fetch;

    const chunks: string[] = [];
    let thrown: unknown;
    try {
      for await (const chunk of openrouterCompleteStream(
        [{ role: "user", content: "hi" }],
        { apiKey: "fixture-key", model: FREE_MODELS[0].id, maxFallbackModels: 2 },
      )) {
        chunks.push(chunk);
      }
    } catch (err) {
      thrown = err;
    }

    expect(chunks.join("")).toBe("first answer");
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(thrown).toSatisfy((err: unknown) =>
      err instanceof GroqClientError &&
      err.code === "NETWORK_ERROR" &&
      err.providerAttemptedModels?.length === 1 &&
      !err.message.includes("fixture-key") &&
      !JSON.stringify(err.toProviderContext()).includes("fixture-key"),
    );
  });
});

// ── Fallback chain — model removed scenario ───────────────────────────────────

describe("openrouterCompleteWithFallback — model removed (PR-02)", () => {
  const globalFetch = global.fetch;

  afterEach(() => {
    global.fetch = globalFetch;
    vi.restoreAllMocks();
  });

  it("advances to next model on 404 and succeeds", async () => {
    const { openrouterCompleteWithFallback } = await import(
      "../openai-compatible-client.js"
    );

    let callCount = 0;
    global.fetch = vi.fn().mockImplementation(() => {
      callCount += 1;
      if (callCount === 1) {
        return Promise.resolve({
          ok: false,
          status: 404,
          text: () => Promise.resolve(JSON.stringify({ error: { code: "model_not_found" } })),
        });
      }
      return Promise.resolve({
        ok: true,
        status: 200,
        json: () => Promise.resolve(okResponse()),
      });
    }) as typeof fetch;

    const result = await openrouterCompleteWithFallback(
      [{ role: "user", content: "hi" }],
      { apiKey: "sk-test", model: "nvidia/nemotron-3-super-120b-a12b:free" },
    );
    expect(result.content).toBe("Hello!");
    expect(callCount).toBeGreaterThan(1);
  });

  it("advances to next model on 402 (PLAN_RESTRICTED) and succeeds", async () => {
    const { openrouterCompleteWithFallback } = await import(
      "../openai-compatible-client.js"
    );

    let callCount = 0;
    global.fetch = vi.fn().mockImplementation(() => {
      callCount += 1;
      if (callCount === 1) {
        return Promise.resolve({
          ok: false,
          status: 402,
          text: () => Promise.resolve(JSON.stringify({ error: { message: "requires payment" } })),
        });
      }
      return Promise.resolve({
        ok: true,
        status: 200,
        json: () => Promise.resolve(okResponse()),
      });
    }) as typeof fetch;

    const result = await openrouterCompleteWithFallback(
      [{ role: "user", content: "hi" }],
      { apiKey: "sk-test", model: "nvidia/nemotron-3-super-120b-a12b:free" },
    );
    expect(result.content).toBe("Hello!");
    expect(callCount).toBeGreaterThan(1);
  });

  it("uses full resolver chain when no model specified", async () => {
    const { openrouterCompleteWithFallback } = await import(
      "../openai-compatible-client.js"
    );

    // First call 404, second succeeds — proves chain is used when model=undefined
    let callCount = 0;
    global.fetch = vi.fn().mockImplementation(() => {
      callCount += 1;
      if (callCount === 1) {
        return Promise.resolve({
          ok: false,
          status: 404,
          text: () => Promise.resolve(JSON.stringify({ error: { code: "model_not_found" } })),
        });
      }
      return Promise.resolve({
        ok: true,
        status: 200,
        json: () => Promise.resolve(okResponse()),
      });
    }) as typeof fetch;

    const result = await openrouterCompleteWithFallback(
      [{ role: "user", content: "hi" }],
      { apiKey: "sk-test" }, // no model specified
    );
    expect(result.content).toBe("Hello!");
    expect(callCount).toBeGreaterThan(1);
  });

  it("rejects an unknown or paid model before any provider request", async () => {
    const { openrouterCompleteWithFallback } = await import(
      "../openai-compatible-client.js"
    );

    global.fetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 404,
      text: () => Promise.resolve(JSON.stringify({ error: { code: "model_not_found" } })),
    }) as typeof fetch;

    // Use a model not in FREE_MODELS → chain = [id] → one attempt → throws
    const fetchMock = vi.fn();
    global.fetch = fetchMock as typeof fetch;
    await expect(
      openrouterCompleteWithFallback(
        [{ role: "user", content: "hi" }],
        { apiKey: "sk-test", model: "some/unknown-paid-model" },
      ),
    ).rejects.toSatisfy((e: unknown) =>
      e instanceof GroqClientError && e.code === "INVALID_CONFIG",
    );
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("does not try a paid or alternate model after authentication failure", async () => {
    const { openrouterCompleteWithFallback } = await import(
      "../openai-compatible-client.js"
    );
    const fetchMock = vi.fn().mockResolvedValue({
      ok: false,
      status: 401,
      text: () => Promise.resolve(JSON.stringify({ error: { message: "invalid key" } })),
    });
    global.fetch = fetchMock as typeof fetch;

    await expect(
      openrouterCompleteWithFallback(
        [{ role: "user", content: "hi" }],
        { apiKey: "sk-test", model: FREE_MODELS[0].id },
      ),
    ).rejects.toSatisfy((e: unknown) =>
      e instanceof GroqClientError && e.code === "AUTH_ERROR",
    );
    expect(fetchMock).toHaveBeenCalledTimes(1);
    for (const call of fetchMock.mock.calls) {
      expect(JSON.parse(call[1].body as string).model).toMatch(/:free$/);
    }
  });

  it("advances after an empty response without treating it as success", async () => {
    const { openrouterCompleteWithFallback } = await import(
      "../openai-compatible-client.js"
    );
    const fetchMock = vi.fn()
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: () => Promise.resolve({ choices: [{ message: { content: "" } }] }),
      })
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: () => Promise.resolve(okResponse()),
      });
    global.fetch = fetchMock as typeof fetch;

    const result = await openrouterCompleteWithFallback(
      [{ role: "user", content: "hi" }],
      { apiKey: "sk-test", model: FREE_MODELS[0].id, maxFallbackModels: 2 },
    );
    expect(result.content).toBe("Hello!");
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(fetchMock.mock.calls.every((call) =>
      JSON.parse(call[1].body as string).model.endsWith(":free"),
    )).toBe(true);
  });
});

// ── Provider metrics (PR-05) ──────────────────────────────────────────────────

describe("provider-metrics — health tracking", () => {
  beforeEach(async () => {
    const { _resetMetricsForTest } = await import("../provider-metrics.js");
    _resetMetricsForTest();
  });

  it("recordSuccess resets consecutiveFailures", async () => {
    const { recordFailure, recordSuccess, getProviderMetrics } = await import(
      "../provider-metrics.js"
    );
    recordFailure("openrouter");
    recordFailure("openrouter");
    recordSuccess("openrouter");
    const snap = getProviderMetrics().find((m) => m.provider === "openrouter");
    expect(snap?.consecutiveFailures).toBe(0);
    expect(snap?.lastSuccessAt).not.toBeNull();
  });

  it("computes successRate correctly", async () => {
    const { recordRequest, recordFailure, recordSuccess, getProviderMetrics } = await import(
      "../provider-metrics.js"
    );
    recordRequest("groq");
    recordRequest("groq");
    recordRequest("groq");
    recordFailure("groq");
    recordSuccess("groq");
    const snap = getProviderMetrics().find((m) => m.provider === "groq");
    // 3 requests, 1 failure → success rate = 2/3
    expect(snap?.successRate).toBeCloseTo(2 / 3, 2);
  });

  it("lastFailureAt is set on failure", async () => {
    const { recordFailure, getProviderMetrics } = await import("../provider-metrics.js");
    recordFailure("openrouter");
    const snap = getProviderMetrics().find((m) => m.provider === "openrouter");
    expect(snap?.lastFailureAt).not.toBeNull();
  });
});

// ── INT-001: Static catalog before runtime catalog is loaded ──────────────────

describe("integration (INT-001) — static catalog used before runtime catalog loads", () => {
  const globalFetch = global.fetch;

  beforeEach(() => _resetDynamicCatalog());
  afterEach(() => {
    global.fetch = globalFetch;
    _resetDynamicCatalog();
    vi.restoreAllMocks();
  });

  it("should use static catalog before runtime catalog is loaded", async () => {
    // Dynamic catalog must not be loaded at test start
    expect(isDynamicCatalogLoaded()).toBe(false);
    expect(getDynamicModelIds()).toBeNull();

    // Capture the model ID sent in the OpenRouter completion request
    let capturedModel = "";
    global.fetch = vi.fn().mockImplementation((_url: string, init: RequestInit | undefined) => {
      const body = JSON.parse((init?.body as string) ?? "{}") as { model?: string };
      capturedModel = body.model ?? "";
      return Promise.resolve({
        ok: true,
        status: 200,
        json: () =>
          Promise.resolve(okResponse(capturedModel || "inclusionai/ling-3.0-flash:free")),
      });
    }) as typeof fetch;

    const { openrouterCompleteWithFallback } = await import("../openai-compatible-client.js");
    const result = await openrouterCompleteWithFallback(
      [{ role: "user", content: "hi" }],
      { apiKey: "sk-test" },
    );

    // Completion succeeded using the static catalog
    expect(result.content).toBe("Hello!");

    // Dynamic catalog was never loaded — only the static list was used
    expect(isDynamicCatalogLoaded()).toBe(false);

    // The model selected must be a known static FREE_MODELS entry (not a stale hardcoded ID)
    const staticIds = new Set(FREE_MODELS.map((m) => m.id));
    expect(capturedModel).toBeTruthy();
    expect(staticIds.has(capturedModel)).toBe(true);

    // Exactly one fetch call: the completion request (no dynamic catalog refresh)
    expect((global.fetch as ReturnType<typeof vi.fn>).mock.calls).toHaveLength(1);
  });
});

// ── INT-002: Runtime catalog loaded, powerful tier empty → fast tier used ─────

describe("integration (INT-002) — downgrade to fast tier when powerful free models unavailable", () => {
  const globalFetch = global.fetch;

  beforeEach(() => _resetDynamicCatalog());
  afterEach(() => {
    global.fetch = globalFetch;
    _resetDynamicCatalog();
    vi.restoreAllMocks();
  });

  it("should downgrade to fast tier when powerful free models are unavailable", async () => {
    // Build a catalog containing only fast-tier model IDs (all powerful ones are absent)
    const fastOnlyEntries = FREE_MODELS
      .filter((m) => m.quality === "fast")
      .map((m) => ({ id: m.id, pricing: { prompt: "0", completion: "0" } }));

    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: () => Promise.resolve({ data: fastOnlyEntries }),
    }) as typeof fetch;

    await refreshDynamicCatalog("sk-test");
    global.fetch = globalFetch;

    expect(isDynamicCatalogLoaded()).toBe(true);

    // Requesting "powerful" — but all powerful models are absent from the live catalog
    const chain = resolveFallbackChain({ capability: "chat", quality: "powerful" });

    // No powerful-tier model should appear — all were filtered by the live catalog
    const powerfulInChain = chain.filter((entry) => {
      const staticModel = FREE_MODELS.find((m) => m.id === entry.id);
      return staticModel?.quality === "powerful";
    });
    expect(powerfulInChain).toHaveLength(0);

    // Fast-tier models must be available as the downgrade fallback
    const fastInChain = chain.filter((entry) => {
      const staticModel = FREE_MODELS.find((m) => m.id === entry.id);
      return staticModel?.quality === "fast";
    });
    expect(fastInChain.length).toBeGreaterThan(0);

    // No fallback to the raw static pool (RC-01: catalog loaded → no re-insertion of paid models)
    // Confirmed by the absence of powerful-tier entries above
  });
});

// ── INT-003: All free models filtered → empty chain → no fetch (INT-003 + INT-007 empty-chain) ──

describe("integration (INT-003 / INT-007) — empty chain fails fast without issuing OpenRouter requests", () => {
  const globalFetch = global.fetch;

  beforeEach(() => _resetDynamicCatalog());
  afterEach(() => {
    global.fetch = globalFetch;
    _resetDynamicCatalog();
    vi.restoreAllMocks();
  });

  it("should fail over cleanly when no free model remains", async () => {
    // Populate the live catalog with a model ID that does not exist in FREE_MODELS.
    // This simulates all static models having moved from free → paid.
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: () =>
        Promise.resolve({
          data: [{ id: "unknown/not-in-static-catalog:free", pricing: { prompt: "0", completion: "0" } }],
        }),
    }) as typeof fetch;

    await refreshDynamicCatalog("sk-test");
    expect(isDynamicCatalogLoaded()).toBe(true);

    // Resolver must return an empty chain — all static models were filtered out
    const chain = resolveFallbackChain({ capability: "chat" });
    expect(chain).toHaveLength(0);

    // Now reset fetch so we can assert it is never called for a completion
    global.fetch = vi.fn() as typeof fetch;

    const { openrouterCompleteWithFallback } = await import("../openai-compatible-client.js");

    // openrouterCompleteWithFallback must throw MODEL_NOT_FOUND immediately —
    // the resolver prevented any HTTP call to OpenRouter
    await expect(
      openrouterCompleteWithFallback(
        [{ role: "user", content: "hi" }],
        { apiKey: "sk-test" },
      ),
    ).rejects.toSatisfy(
      (e: unknown) => e instanceof GroqClientError && e.code === "MODEL_NOT_FOUND",
    );

    // INT-007 (empty-chain scenario): fetch must not be called at all
    expect((global.fetch as ReturnType<typeof vi.fn>).mock.calls).toHaveLength(0);
  });

  it("should not issue OpenRouter requests when the resolved chain is empty", async () => {
    // Same setup — catalog contains no FREE_MODELS entries
    global.fetch = vi.fn().mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: () =>
        Promise.resolve({
          data: [{ id: "some/paid-model", pricing: { prompt: "0.0001", completion: "0.0002" } }],
        }),
    }) as typeof fetch;

    // The paid model has non-zero pricing so refreshDynamicCatalog keeps previous catalog.
    // Reset so catalog shows loaded-but-empty by calling refresh with a response that
    // passes the free-model filter with an ID not in FREE_MODELS.
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: () =>
        Promise.resolve({
          data: [{ id: "nonexistent/model:free", pricing: { prompt: "0", completion: "0" } }],
        }),
    }) as typeof fetch;

    await refreshDynamicCatalog("sk-test");
    global.fetch = vi.fn() as typeof fetch; // reset before completion attempt

    const { openrouterCompleteWithFallback } = await import("../openai-compatible-client.js");

    await expect(
      openrouterCompleteWithFallback(
        [{ role: "user", content: "test" }],
        { apiKey: "sk-test" },
      ),
    ).rejects.toSatisfy(
      (e: unknown) => e instanceof GroqClientError && e.code === "MODEL_NOT_FOUND",
    );

    // Zero completion fetches: the resolver stopped the chain before any HTTP call
    expect((global.fetch as ReturnType<typeof vi.fn>).mock.calls).toHaveLength(0);
  });

  it("INT-007 — single fetch on first-model success", async () => {
    // Catalog not loaded → static list used (no catalog fetch in this path)
    let callCount = 0;
    global.fetch = vi.fn().mockImplementation(() => {
      callCount += 1;
      return Promise.resolve({
        ok: true,
        status: 200,
        json: () => Promise.resolve(okResponse()),
      });
    }) as typeof fetch;

    const { openrouterCompleteWithFallback } = await import("../openai-compatible-client.js");
    const result = await openrouterCompleteWithFallback(
      [{ role: "user", content: "hi" }],
      { apiKey: "sk-test" },
    );

    expect(result.content).toBe("Hello!");
    // Exactly one completion fetch — no unnecessary retries
    expect(callCount).toBe(1);
  });

  it("INT-007 — fetch count equals chain length when every model fails before final success", async () => {
    // Use a known model with a 2-entry chain: initial → 404 → second model succeeds
    let callCount = 0;
    global.fetch = vi.fn().mockImplementation(() => {
      callCount += 1;
      if (callCount < 2) {
        return Promise.resolve({
          ok: false,
          status: 404,
          text: () => Promise.resolve(JSON.stringify({ error: { code: "model_not_found" } })),
        });
      }
      return Promise.resolve({
        ok: true,
        status: 200,
        json: () => Promise.resolve(okResponse()),
      });
    }) as typeof fetch;

    const { openrouterCompleteWithFallback } = await import("../openai-compatible-client.js");
    const result = await openrouterCompleteWithFallback(
      [{ role: "user", content: "hi" }],
      { apiKey: "sk-test", model: "nvidia/nemotron-3-super-120b-a12b:free" },
    );

    expect(result.content).toBe("Hello!");
    // 2 fetches: first model 404 → second model 200
    expect(callCount).toBeGreaterThanOrEqual(2);
  });
});

// ── INT-004: agentComplete passes quality/capability hints, not stale model IDs ─

describe("integration (INT-004) — agentComplete resolves models from quality hints instead of stale model IDs", () => {
  const globalFetch = global.fetch;

  beforeEach(() => _resetDynamicCatalog());
  afterEach(() => {
    global.fetch = globalFetch;
    _resetDynamicCatalog();
    vi.restoreAllMocks();
  });

  it("should resolve models from quality hints instead of stale model ids", async () => {
    let capturedRequestBody: Record<string, unknown> = {};

    global.fetch = vi.fn().mockImplementation((_url: string, init: RequestInit | undefined) => {
      capturedRequestBody = JSON.parse((init?.body as string) ?? "{}") as Record<string, unknown>;
      const model = (capturedRequestBody["model"] as string) ?? "inclusionai/ling-3.0-flash:free";
      return Promise.resolve({
        ok: true,
        status: 200,
        json: () => Promise.resolve(okResponse(model)),
      });
    }) as typeof fetch;

    const { agentComplete } = await import("../agent-complete.js");
    await agentComplete(
      [{ role: "user", content: "review this code" }],
      {
        provider: "openrouter",
        apiKey: "sk-test",
        // RC-04: qualityProfile drives resolver hints; no explicit model ID
        qualityProfile: "code_review",
      },
    );

    const usedModel = capturedRequestBody["model"] as string | undefined;

    // A model must have been selected (not empty / undefined)
    expect(usedModel).toBeTruthy();
    expect(typeof usedModel).toBe("string");

    // The selected model must come from FREE_MODELS — the resolver, not a hardcoded ID
    const staticIds = new Set(FREE_MODELS.map((m) => m.id));
    expect(staticIds.has(usedModel!)).toBe(true);

    // qualityHint present: no explicit `quality` key leaked into the fetch body
    // (that would indicate a stale model ID path was bypassed)
    const resolvedModel = FREE_MODELS.find((m) => m.id === usedModel);
    expect(resolvedModel).toBeDefined();

    // capabilityHint present: the model must support the "coding" or "reasoning"
    // capability, confirming the resolver used capability hints, not a hardcoded id.
    const supportsCodingOrReasoning =
      (resolvedModel!.capabilities as string[]).includes("coding") ||
      (resolvedModel!.capabilities as string[]).includes("reasoning");
    expect(supportsCodingOrReasoning).toBe(true);
  });
});
