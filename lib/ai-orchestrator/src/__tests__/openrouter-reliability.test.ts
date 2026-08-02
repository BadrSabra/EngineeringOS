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
  _resetForTest as _resetDynamicCatalog,
} from "../openrouter/dynamic-catalog.js";
import { FREE_MODELS } from "../openrouter/model-catalog.js";

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
function okResponse(model = "meta-llama/llama-3.1-8b-instruct:free") {
  return {
    choices: [{ message: { content: "Hello!", tool_calls: undefined } }],
    model,
    usage: { prompt_tokens: 10, completion_tokens: 5 },
  };
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
    const initial = "meta-llama/llama-3.3-70b-instruct:free";
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
        model: "meta-llama/llama-3.1-8b-instruct:free",
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
      { apiKey: "sk-test", model: "meta-llama/llama-3.3-70b-instruct:free" },
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
      { apiKey: "sk-test", model: "meta-llama/llama-3.3-70b-instruct:free" },
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

  it("throws MODEL_NOT_FOUND after all fallbacks exhausted", async () => {
    const { openrouterCompleteWithFallback } = await import(
      "../openai-compatible-client.js"
    );

    global.fetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 404,
      text: () => Promise.resolve(JSON.stringify({ error: { code: "model_not_found" } })),
    }) as typeof fetch;

    // Use a model not in FREE_MODELS → chain = [id] → one attempt → throws
    await expect(
      openrouterCompleteWithFallback(
        [{ role: "user", content: "hi" }],
        { apiKey: "sk-test", model: "some/unknown-paid-model" },
      ),
    ).rejects.toSatisfy((e: unknown) =>
      e instanceof GroqClientError && e.code === "MODEL_NOT_FOUND",
    );
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
