/**
 * PR-012 — Regression tests for the OpenAI-compatible client.
 *
 * Covers:
 *   • Gemini preserves response_format and translates tools to native function calling
 *   • 400 invalid model id → MODEL_NOT_FOUND + fallback (existing)
 *   • 404 → MODEL_NOT_FOUND + fallback (PR-003)
 *   • 410 → MODEL_UNAVAILABLE + fallback (PR-003)
 *   • 422 → MODEL_UNAVAILABLE + fallback (PR-003)
 *   • 429 rate-limit → RATE_LIMITED
 *   • 429 quota/credits body → QUOTA (PR-008)
 *   • 401/403 credential failures → AUTH_ERROR
 *   • 403 agent-harness restriction → MODEL_UNAVAILABLE + fallback
 *   • 5xx → SERVER_ERROR
 *   • All fallback candidates exhausted → throws MODEL_NOT_FOUND
 *   • Provider error context preserved on error (PR-007)
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  geminiCompleteRaw,
  openrouterCompleteRaw,
  openrouterCompleteStream,
  openrouterCompleteWithFallback,
  oacCompleteRaw,
  oacCompleteStream,
  validateGeminiDefaultModels,
} from "../openai-compatible-client.js";
import { GroqClientError } from "../errors.js";
import { FREE_MODELS } from "../openrouter/model-catalog.js";
import {
  _resetModelContractAcceptanceForTest,
  getModelContractAvailabilityWeight,
  MODEL_TASK_CONTRACTS,
} from "../openrouter/model-contract-acceptance.js";
import {
  getFreeModelLaneRotationPlan,
  resolveFallbackChain,
  resolveFallbackChainUnrotated,
} from "../openrouter/model-resolver.js";
import { _resetForTest } from "../openrouter/dynamic-catalog.js";
import {
  _resetCircuitsForTest,
  isModelCoolingDown,
} from "../openrouter/circuit-breaker.js";
import {
  _resetLocalAdaptiveModelCooldownsForTest,
  _setModelCooldownPersistenceForTest,
} from "../openrouter/model-cooldown-store.js";
import type { ModelLaneCursorPersistence } from "../openrouter/model-lane-cursor-store.js";
import {
  _resetOpenRouterCredentialCooldownsForTest,
  assertOpenRouterCredentialAvailable,
  recordOpenRouterCredentialCooldown,
} from "../openrouter/credential-cooldown.js";
import { createExecutionLedger } from "../execution-ledger.js";

const baseMessages = [{ role: "user", content: "hello" } as const];
const cataloguedFreeModel = FREE_MODELS[0]!.id;
const toolCapableFreeModel = FREE_MODELS.find((model) => model.supportsTools)!.id;
let persistedCooldownWrites: Array<{ provider: string; model: string; cooldownMs: number }> = [];
let persistedCooldownClears: Array<{ provider: string; model: string }> = [];

function jsonResponse(body: unknown, status = 200, headers?: Record<string, string> | Headers): Response {
  return new Response(JSON.stringify(body), { status, headers });
}

function textResponse(body: string, status: number, headers?: Record<string, string> | Headers): Response {
  return new Response(body, { status, headers });
}

beforeEach(() => {
  _resetForTest(); // ensure dynamic catalog does not interfere
  _resetCircuitsForTest(); // clear provider and model admission state
  _resetLocalAdaptiveModelCooldownsForTest();
  _resetModelContractAcceptanceForTest();
  _resetOpenRouterCredentialCooldownsForTest();
  persistedCooldownWrites = [];
  persistedCooldownClears = [];
  _setModelCooldownPersistenceForTest({
    readActive: async () => [],
    write: async (provider, model, cooldownMs) => {
      persistedCooldownWrites.push({ provider, model, cooldownMs });
    },
    clear: async (provider, model) => {
      persistedCooldownClears.push({ provider, model });
    },
  });
});

afterEach(() => {
  _resetLocalAdaptiveModelCooldownsForTest();
  _resetOpenRouterCredentialCooldownsForTest();
  _setModelCooldownPersistenceForTest(undefined);
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

// ── Gemini transport behavior ──────────────────────────────────────────────────

describe("geminiCompleteRaw", () => {
  it("preserves response_format for no-tool Gemini requests", async () => {
    let captured: Record<string, unknown> | undefined;
    vi.stubGlobal("fetch", vi.fn(async (_url: string | URL, init?: RequestInit) => {
      captured = JSON.parse(String(init?.body ?? "{}")) as Record<string, unknown>;
      return jsonResponse({
          choices: [{ message: { content: '{"response":"ok","sources":[]}' } }],
          model: "gemini-2.0-flash",
          usage: { prompt_tokens: 1, completion_tokens: 1 },
        });
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
      return jsonResponse({
          candidates: [{
            content: {
              role: "model",
              parts: [{ functionCall: { name: "read_file", args: { path: "src/auth.ts" } } }],
            },
            finishReason: "STOP",
          }],
          usageMetadata: { promptTokenCount: 4, candidatesTokenCount: 3 },
        });
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

  it("replays Gemini thought signatures on the next native tool round", async () => {
    const captured: Array<Record<string, unknown>> = [];
    let requestCount = 0;
    vi.stubGlobal("fetch", vi.fn(async (_url: string | URL, init?: RequestInit) => {
      captured.push(JSON.parse(String(init?.body ?? "{}")) as Record<string, unknown>);
      requestCount += 1;
      return jsonResponse(requestCount === 1
          ? {
              candidates: [{
                content: {
                  role: "model",
                  parts: [{
                    functionCall: { name: "read_file", args: { path: "src/auth.ts" } },
                    thoughtSignature: "signature-round-1",
                  }],
                },
                finishReason: "STOP",
              }],
              usageMetadata: { promptTokenCount: 4, candidatesTokenCount: 3 },
            }
          : {
              candidates: [{
                content: {
                  role: "model",
                  parts: [{ text: "done" }],
                },
                finishReason: "STOP",
              }],
            });
    }));

    const options = {
      apiKey: "test-key",
      model: "gemini-3-flash-preview",
      tools: [{
        type: "function" as const,
        function: {
          name: "read_file",
          description: "Read a file",
          parameters: { type: "object", properties: { path: { type: "string" } } },
        },
      }],
      toolChoice: "auto" as const,
    };
    const first = await geminiCompleteRaw(baseMessages as any, options);
    const firstCall = first.toolCalls?.[0];
    expect(firstCall).toMatchObject({
      providerMetadata: { gemini: { thoughtSignature: "signature-round-1" } },
    });

    await geminiCompleteRaw([
      ...baseMessages,
      { role: "assistant", content: null, tool_calls: first.toolCalls ?? [] },
      {
        role: "tool",
        tool_call_id: firstCall!.id,
        content: '{"result":"source"}',
      },
    ] as any, options);

    expect(captured[1]).toHaveProperty(
      "contents.1.parts.0.thoughtSignature",
      "signature-round-1",
    );
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

describe("OpenAI-compatible outbound metadata", () => {
  it("does not forward Gemini metadata to OpenRouter", async () => {
    let captured: Record<string, unknown> | undefined;
    vi.stubGlobal("fetch", vi.fn(async (_url: string | URL, init?: RequestInit) => {
      captured = JSON.parse(String(init?.body ?? "{}")) as Record<string, unknown>;
      return jsonResponse({
          choices: [{ message: { content: "ok" } }],
          model: cataloguedFreeModel,
          usage: { prompt_tokens: 1, completion_tokens: 1 },
        });
    }));

    await oacCompleteRaw([
      { role: "user", content: "read the file" },
      {
        role: "assistant",
        content: null,
        tool_calls: [{
          id: "gemini-call",
          type: "function",
          function: { name: "read_file", arguments: '{"path":"src/a.ts"}' },
          providerMetadata: { gemini: { thoughtSignature: "must-not-leak" } },
        }],
      },
      { role: "tool", tool_call_id: "gemini-call", content: '{"result":"source"}' },
    ] as any, {
      apiKey: "test-key",
      model: cataloguedFreeModel,
      providerName: "OpenRouter",
      baseUrl: "https://openrouter.example/v1",
    });

    expect(captured).toBeDefined();
    expect(captured).not.toHaveProperty(
      "messages.1.tool_calls.0.providerMetadata",
    );
  });
});

describe("validateGeminiDefaultModels", () => {
  const defaults = {
    fast: "gemini-fast-fixture",
    powerful: "gemini-powerful-fixture",
  };

  it("reports retired defaults from Google's model catalog without exposing the key", async () => {
    const fetchMock = vi.fn(async (_url: string | URL, _init?: RequestInit) => jsonResponse({
        models: [
          {
            name: "models/gemini-fast-fixture",
            supportedGenerationMethods: ["generateContent"],
          },
        ],
      }));
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
    vi.stubGlobal("fetch", vi.fn(async () =>
      textResponse("temporary provider outage", 503)));

    await expect(validateGeminiDefaultModels("valid-gemini-key", defaults))
      .rejects.toMatchObject({ code: "SERVER_ERROR" });
  });

  it("confirms both defaults when the provider catalog supports generation", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => jsonResponse({
        models: [
          { name: "models/gemini-fast-fixture" },
          { name: "gemini-powerful-fixture" },
        ],
      })));

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
  it("clears persisted cooldown history after a successful response", async () => {
    const model = FREE_MODELS[0]!.id;
    vi.stubGlobal("fetch", vi.fn(async () => jsonResponse({
      choices: [{ message: { content: "success" } }],
      model,
      usage: {},
    })));

    const result = await openrouterCompleteWithFallback(baseMessages as any, {
      apiKey: "test-key",
      model,
      maxFallbackModels: 1,
    });

    expect(result.content).toBe("success");
    expect(persistedCooldownClears).toContainEqual({ provider: "openrouter", model });
  });

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

describe("OpenRouter shared free-lane scheduling", () => {
  it("rotates unpinned requests using the shared cursor adapter", async () => {
    const resolveOptions = { capability: "chat" as const, quality: "fast" as const };
    const baseline = resolveFallbackChainUnrotated(resolveOptions).map((model) => model.id);
    const slots: number[] = [];
    const adapter: ModelLaneCursorPersistence = {
      async reserveSlot(_cursorKey, _candidateSetHash, slotCount) {
        const slot = slots.length % slotCount;
        slots.push(slot);
        return slot;
      },
    };
    const requestedModels: string[] = [];
    vi.stubGlobal("fetch", vi.fn(async (_url: string | URL, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body ?? "{}")) as { model?: string };
      requestedModels.push(String(body.model));
      return jsonResponse({
        choices: [{ message: { content: "completed" } }],
        model: body.model,
        usage: {},
      });
    }));

    for (let request = 0; request < 2; request += 1) {
      await openrouterCompleteWithFallback(baseMessages as any, {
        apiKey: "test-key",
        capability: "chat",
        quality: "fast",
        modelLaneCursorPersistence: adapter,
      });
    }

    const expectedPlan = getFreeModelLaneRotationPlan(baseline, resolveOptions);
    expect(expectedPlan).not.toBeNull();
    expect(requestedModels).toEqual([
      expectedPlan!.candidateIds[0],
      expectedPlan!.candidateIds[1],
    ]);
    expect(new Set(requestedModels).size).toBe(2);
    expect(slots).toEqual([0, 1]);
  });

  it("treats a resolver-selected model as a hint only when the shared lane flag is set", async () => {
    const resolveOptions = { capability: "chat" as const, quality: "fast" as const };
    const baseline = resolveFallbackChainUnrotated(resolveOptions).map((model) => model.id);
    const plan = getFreeModelLaneRotationPlan(baseline, resolveOptions);
    const requestedModels: string[] = [];
    const cursor: ModelLaneCursorPersistence = {
      async reserveSlot() {
        return 1;
      },
    };
    vi.stubGlobal("fetch", vi.fn(async (_url: string | URL, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body ?? "{}")) as { model?: string };
      requestedModels.push(String(body.model));
      return jsonResponse({
        choices: [{ message: { content: "completed" } }],
        model: body.model,
        usage: {},
      });
    }));

    await openrouterCompleteWithFallback(baseMessages as any, {
      apiKey: "test-key",
      model: baseline[0],
      capability: "chat",
      quality: "fast",
      useSharedLaneCursor: true,
      modelLaneCursorPersistence: cursor,
    });

    expect(plan).not.toBeNull();
    expect(requestedModels[0]).toBe(plan!.candidateIds[1]);
  });

  it("excludes actively cooling models before it reserves a lane slot", async () => {
    const baseline = resolveFallbackChainUnrotated({
      capability: "chat",
      quality: "fast",
    }).map((model) => model.id);
    const coolingModel = baseline[0]!;
    const eligible = baseline.filter((model) => model !== coolingModel);
    const expectedPlan = getFreeModelLaneRotationPlan(eligible, {
      capability: "chat",
      quality: "fast",
    });
    let reservedSlotCount = 0;
    const cursor: ModelLaneCursorPersistence = {
      async reserveSlot(_cursorKey, _candidateSetHash, slotCount) {
        reservedSlotCount = slotCount;
        return 0;
      },
    };
    const requestedModels: string[] = [];
    vi.stubGlobal("fetch", vi.fn(async (_url: string | URL, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body ?? "{}")) as { model?: string };
      requestedModels.push(String(body.model));
      return jsonResponse({
        choices: [{ message: { content: "completed" } }],
        model: body.model,
        usage: {},
      });
    }));
    const cooldowns = {
      readActive: async () => [{ model: coolingModel, remainingMs: 30_000 }],
      write: async () => undefined,
      clear: async () => undefined,
    };

    await openrouterCompleteWithFallback(baseMessages as any, {
      apiKey: "test-key",
      capability: "chat",
      quality: "fast",
      modelCooldownPersistence: cooldowns,
      modelLaneCursorPersistence: cursor,
    });

    expect(expectedPlan).not.toBeNull();
    expect(reservedSlotCount).toBe(expectedPlan!.candidateIds.length);
    expect(requestedModels[0]).not.toBe(coolingModel);
  });
});

describe("openrouterCompleteWithFallback — error classification", () => {
  const primaryModel = FREE_MODELS[0]!.id;

  it("accepts a free model for its requested capability instead of defaulting to chat", async () => {
    const codingModel = FREE_MODELS.find(
      (candidate) => candidate.quality === "powerful" && candidate.capabilities.includes("coding"),
    )?.id;
    expect(codingModel).toBeDefined();
    const fetchMock = vi.fn(async (_url: string | URL, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body ?? "{}")) as Record<string, unknown>;
      return jsonResponse({
          choices: [{ message: { content: '{"response":"ok"}' } }],
          model: body.model,
          usage: { prompt_tokens: 1, completion_tokens: 1 },
        });
    });
    vi.stubGlobal("fetch", fetchMock);

    const result = await openrouterCompleteWithFallback(baseMessages as any, {
      apiKey: "test-key",
      model: codingModel,
      capability: "coding",
      quality: "powerful",
    });

    expect(result.content).toBe('{"response":"ok"}');
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const requestBody = JSON.parse(String(fetchMock.mock.calls[0]![1]?.body)) as Record<string, unknown>;
    expect(requestBody.model).toBe(codingModel);
  });

  it("400 with invalid-model body → MODEL_NOT_FOUND → triggers fallback", async () => {
    let callCount = 0;
    vi.stubGlobal("fetch", vi.fn(async (_url: string | URL, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body ?? "{}")) as Record<string, unknown>;
      callCount++;
      if (callCount === 1) {
        // First call: primary model → 400 invalid model
        return textResponse(
          `{"error":{"message":"${String(body.model)} is not a valid model ID"}}`,
          400,
        );
      }
      // Fallback call: success
      return jsonResponse({
          choices: [{ message: { content: '{"response":"fallback-ok"}' } }],
          model: String(body.model),
          usage: { prompt_tokens: 1, completion_tokens: 1 },
        });
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
        return textResponse(
          '{"error":{"message":"unsupported parameter: response_format"}}',
          400,
        );
      }
      return jsonResponse({
          choices: [{ message: { content: '{"response":"fallback-after-400"}' } }],
          model: String(body.model),
          usage: { prompt_tokens: 1, completion_tokens: 1 },
        });
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
        return textResponse('{"error":{"message":"model not found"}}', 404);
      }
      return jsonResponse({ choices: [{ message: { content: "ok" } }], model: "m", usage: {} });
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
        return textResponse('{"error":{"message":"model retired"}}', 410);
      }
      return jsonResponse({ choices: [{ message: { content: "ok-after-410" } }], model: "m", usage: {} });
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
        return textResponse('{"error":{"message":"selected model unavailable"}}', 422);
      }
      return jsonResponse({ choices: [{ message: { content: "ok-after-422" } }], model: "m", usage: {} });
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
        return jsonResponse({
            choices: [{ message: { content: null, tool_calls: [] } }],
            model: String(body.model),
            usage: {},
          });
      }
      return jsonResponse({
          choices: [{ message: { content: "ok-after-empty" } }],
          model: String(body.model),
          usage: {},
        });
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

  it("limits the default EMPTY_RESPONSE fallback to one free alternative", async () => {
    const seenModels: string[] = [];
    vi.stubGlobal("fetch", vi.fn(async (_url: string | URL, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body ?? "{}")) as Record<string, unknown>;
      seenModels.push(String(body.model));
      if (seenModels.length <= 2) {
        return jsonResponse({
          choices: [{ message: { content: null, tool_calls: [] } }],
          model: String(body.model),
          usage: {},
        });
      }
      return jsonResponse({
        choices: [{ message: { content: "third-model-should-not-run" } }],
        model: String(body.model),
        usage: {},
      });
    }));

    await expect(openrouterCompleteWithFallback(baseMessages as any, {
      apiKey: "test-key",
      model: primaryModel,
      maxTokens: 10,
    })).rejects.toMatchObject({ code: "EMPTY_RESPONSE" });

    expect(seenModels).toHaveLength(2);
    expect(new Set(seenModels).size).toBe(2);
  });

  it("does not let an explicit fallback count exceed the per-request ceiling", async () => {
    const seenModels: string[] = [];
    vi.stubGlobal("fetch", vi.fn(async (_url: string | URL, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body ?? "{}")) as Record<string, unknown>;
      seenModels.push(String(body.model));
      if (seenModels.length <= 2) {
        return jsonResponse({
          choices: [{ message: { content: null, tool_calls: [] } }],
          model: String(body.model),
          usage: {},
        });
      }
      return jsonResponse({
        choices: [{ message: { content: "over-limit-model-should-not-run" } }],
        model: String(body.model),
        usage: {},
      });
    }));

    await expect(openrouterCompleteWithFallback(baseMessages as any, {
      apiKey: "test-key",
      model: primaryModel,
      maxTokens: 10,
      maxFallbackModels: 9,
    })).rejects.toMatchObject({ code: "EMPTY_RESPONSE" });

    expect(seenModels).toHaveLength(2);
    expect(new Set(seenModels).size).toBe(2);
  });

  it("classifies a successful provider response with no choices as EMPTY_RESPONSE", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => jsonResponse({ model: primaryModel, usage: {} })));

    await expect(openrouterCompleteWithFallback(baseMessages as any, {
      apiKey: "test-key",
      model: primaryModel,
      maxTokens: 10,
      maxFallbackModels: 1,
    })).rejects.toMatchObject({ code: "EMPTY_RESPONSE" });
  });

  it("learns repeated empty output only for the exact attempted model and task contract", async () => {
    const contract = MODEL_TASK_CONTRACTS.PROJECT_QUERY_NO_TOOLS_SYNTHESIS;
    const targetModel = resolveFallbackChain({
      capability: "chat",
      quality: "fast",
      taskContract: contract,
    })[0]!.id;
    const excludedModels = FREE_MODELS
      .map((model) => model.id)
      .filter((model) => model !== targetModel);
    vi.stubGlobal("fetch", vi.fn(async () =>
      jsonResponse({ model: targetModel, usage: {} }),
    ));

    for (let attempt = 0; attempt < 5; attempt += 1) {
      await expect(openrouterCompleteWithFallback(baseMessages as any, {
        apiKey: "test-key",
        maxTokens: 10,
        taskContract: contract,
        excludeModels: excludedModels,
        maxFallbackModels: 1,
      })).rejects.toMatchObject({
        code: "EMPTY_RESPONSE",
        providerModel: targetModel,
      });
    }

    expect(getModelContractAvailabilityWeight(targetModel, contract)).toBe(1);
    expect(getModelContractAvailabilityWeight("unattempted-model", contract)).toBeNull();
  });

  it("INVALID_TOOL_CALL → advances to the next model candidate", async () => {
    let callCount = 0;
    const seenModels: string[] = [];
    vi.stubGlobal("fetch", vi.fn(async (_url: string | URL, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body ?? "{}")) as { model?: string };
      callCount++;
      seenModels.push(String(body.model));
      if (callCount === 1) {
        return jsonResponse({
            choices: [{
              message: {
                content: null,
                tool_calls: [{
                  id: "bad-tool",
                  type: "function",
                  function: {
                    name: "push",
                    arguments: "{}",
                  },
                }],
              },
            }],
            model: body.model,
            usage: {},
          });
      }
      return jsonResponse({
          choices: [{ message: { content: "ok-after-invalid-tool" } }],
          model: body.model,
          usage: {},
        });
    }));

    const result = await openrouterCompleteWithFallback(baseMessages as any, {
      apiKey: "test-key",
      model: primaryModel,
      maxTokens: 10,
      tools: [{
        type: "function",
        function: {
          name: "read_file",
          description: "read a file",
          parameters: { type: "object", properties: {} },
        },
      }],
    });

    expect(result.content).toBe("ok-after-invalid-tool");
    expect(callCount).toBe(2);
    expect(seenModels[1]).not.toBe(seenModels[0]);
  });

  it("network errors with transient retries disabled → advances to the next model candidate", async () => {
    let callCount = 0;
    const seenModels: string[] = [];
    vi.stubGlobal("fetch", vi.fn(async (_url: string | URL, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body ?? "{}")) as { model?: string };
      callCount++;
      seenModels.push(String(body.model));
      if (callCount === 1) {
        throw new Error("socket closed");
      }
      return jsonResponse({
          choices: [{ message: { content: "ok-after-network-error" } }],
          model: body.model,
          usage: {},
        });
    }));

    const result = await openrouterCompleteWithFallback(baseMessages as any, {
      apiKey: "test-key",
      model: primaryModel,
      maxTokens: 10,
      timeoutMs: 5,
      retryTransient: false,
      maxFallbackModels: 3,
    });

    expect(result.content).toBe("ok-after-network-error");
    expect(callCount).toBe(2);
    expect(new Set(seenModels).size).toBe(2);
  });

  it("429 with no quota keywords → RATE_LIMITED (not fallback-worthy)", async () => {
    vi.stubGlobal("fetch", vi.fn(async () =>
      textResponse('{"error":{"message":"too many requests"}}', 429)));

    await expect(
      openrouterCompleteWithFallback(baseMessages as any, { apiKey: "test-key", model: primaryModel, maxTokens: 10 }),
    ).rejects.toSatisfy((err: unknown) => err instanceof GroqClientError && err.code === "RATE_LIMITED");
  });

  it("holds the credential when an upstream pool cannot be mapped without Retry-After", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => textResponse(JSON.stringify({
        error: {
          code: 429,
          message: "Provider returned error",
          metadata: {
            limit_source: "upstream_provider_shared_pool",
            provider_name: "Poolside",
          },
        },
      }), 429)));

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
        err.rateLimitScope === "upstream_shared_pool" &&
        err.upstreamProvider === "Poolside",
    );
    expect(isModelCoolingDown("openrouter", primaryModel)).toBe(false);
    await expect(assertOpenRouterCredentialAvailable("test-key")).rejects.toSatisfy(
      (error: unknown) =>
        error instanceof GroqClientError &&
        error.code === "RATE_LIMITED" &&
        error.providerCode === "CREDENTIAL_RETRY_AFTER" &&
        error.rateLimitScope === "unknown" &&
        error.retryAfterMs !== undefined &&
        error.retryAfterMs > 0 &&
        error.retryAfterMs <= 30_000,
    );
    expect(persistedCooldownWrites).toEqual([]);
  });

  it("holds the credential when a retry window names an unmapped upstream pool", async () => {
    const attemptedModels: string[] = [];
    const fetchMock = vi.fn(async (_url: string | URL, init?: RequestInit) => {
      const model = String(
        (JSON.parse(String(init?.body ?? "{}")) as { model?: string }).model,
      );
      attemptedModels.push(model);
      if (attemptedModels.length === 1) {
        return textResponse(JSON.stringify({
            error: {
              message: "Provider returned error",
              metadata: {
                limit_source: "upstream_provider_shared_pool",
                provider_name: "Poolside",
              },
            },
          }), 429, new Headers({ "Retry-After": "120" }));
      }
      return jsonResponse({
          choices: [{ message: { content: "recovered" } }],
          model,
          usage: { prompt_tokens: 1, completion_tokens: 1 },
        });
    });
    vi.stubGlobal("fetch", fetchMock);

    const options = {
      apiKey: "test-key",
      model: primaryModel,
      maxTokens: 10,
      maxFallbackModels: 1,
      retryTransient: false,
    };

    await expect(
      openrouterCompleteWithFallback(baseMessages as any, options),
    ).rejects.toMatchObject({
      code: "RATE_LIMITED",
      rateLimitScope: "upstream_shared_pool",
    });
    expect(isModelCoolingDown("openrouter", attemptedModels[0]!)).toBe(false);
    await expect(assertOpenRouterCredentialAvailable("test-key")).rejects.toSatisfy(
      (error: unknown) =>
        error instanceof GroqClientError &&
        error.code === "RATE_LIMITED" &&
        error.providerCode === "CREDENTIAL_RETRY_AFTER" &&
        error.rateLimitScope === "unknown" &&
        error.retryAfterMs !== undefined &&
        error.retryAfterMs > 0 &&
        error.retryAfterMs <= 120_000,
    );
    await expect(openrouterCompleteWithFallback(baseMessages as any, options)).rejects.toMatchObject({
      code: "RATE_LIMITED",
      providerCode: "CREDENTIAL_RETRY_AFTER",
    });
    expect(attemptedModels).toHaveLength(1);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(persistedCooldownWrites).toEqual([]);
  });

  it("cools matching upstream-provider siblings but leaves unrelated free vendors available", async () => {
    const sharedPoolModel = "thinkingmachines/inkling:free";
    const sharedPoolSibling = "thinkingmachines/inkling-small:free";
    const unrelatedModel = "liquid/lfm-2.5-2.6b:free";
    const attemptedModels: string[] = [];
    const fetchMock = vi.fn(async (_url: string | URL, init?: RequestInit) => {
      const model = String((JSON.parse(String(init?.body ?? "{}")) as { model?: string }).model);
      attemptedModels.push(model);
      if (model.startsWith("thinkingmachines/")) {
        return textResponse(JSON.stringify({
          error: {
            message: "Provider returned error",
            metadata: {
              limit_source: "upstream_provider_shared_pool",
              provider_name: "Thinking Machines",
            },
          },
        }), 429, new Headers({ "Retry-After": "120" }));
      }
      return jsonResponse({
        choices: [{ message: { content: "unrelated vendor remains available" } }],
        model,
        usage: { prompt_tokens: 1, completion_tokens: 1 },
      });
    });
    vi.stubGlobal("fetch", fetchMock);

    const pinnedOptions = {
      apiKey: "test-key",
      maxFallbackModels: 1,
      maxTokens: 10,
      retryTransient: false,
    };
    await expect(
      openrouterCompleteWithFallback(baseMessages as any, {
        ...pinnedOptions,
        model: sharedPoolModel,
      }),
    ).rejects.toMatchObject({
      code: "RATE_LIMITED",
      rateLimitScope: "upstream_shared_pool",
    });

    expect(isModelCoolingDown("openrouter", "__upstream_pool__:thinkingmachines")).toBe(true);
    expect(isModelCoolingDown("openrouter", "__upstream_pool__:liquid")).toBe(false);
    expect(persistedCooldownWrites).toContainEqual({
      provider: "openrouter",
      model: "__upstream_pool__:thinkingmachines",
      cooldownMs: 120_000,
    });

    const recoveredResult = await openrouterCompleteWithFallback(baseMessages as any, {
      ...pinnedOptions,
      model: sharedPoolSibling,
    });
    expect(recoveredResult.content).toBe("unrelated vendor remains available");
    expect(attemptedModels).toEqual([sharedPoolModel, unrelatedModel]);
    expect(attemptedModels).not.toContain(sharedPoolSibling);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("fails closed across the credential when a missing-header pool is unmapped", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => textResponse(JSON.stringify({
      error: {
        message: "Provider returned error",
        metadata: { limit_source: "upstream_provider_shared_pool" },
      },
    }), 429)));

    await expect(
      openrouterCompleteWithFallback(baseMessages as any, {
        apiKey: "test-key",
        model: primaryModel,
        maxTokens: 10,
        maxFallbackModels: 1,
        retryTransient: false,
      }),
    ).rejects.toMatchObject({ code: "RATE_LIMITED", rateLimitScope: "upstream_shared_pool" });

    expect(isModelCoolingDown("openrouter", primaryModel)).toBe(false);
    await expect(assertOpenRouterCredentialAvailable("test-key")).rejects.toMatchObject({
      code: "RATE_LIMITED",
      providerCode: "CREDENTIAL_RETRY_AFTER",
      rateLimitScope: "unknown",
    });
    expect(persistedCooldownWrites).toEqual([]);
  });

  it.each([
    [
      "provider credential",
      JSON.stringify({
        error: {
          message: "Provider returned error",
          metadata: { limit_source: "provider_rate_limit" },
        },
      }),
      "RATE_LIMITED",
      "provider_credential",
    ],
    [
      "account quota",
      JSON.stringify({ error: { message: "quota exceeded" } }),
      "QUOTA",
      "account_quota",
    ],
  ] as const)(
    "does not cool an individual model for a %s limit",
    async (_scope, responseBody, expectedCode, expectedScope) => {
      vi.stubGlobal("fetch", vi.fn(async () =>
        textResponse(
          responseBody,
          429,
          new Headers({ "Retry-After": "120" }),
        )));

      await expect(
        openrouterCompleteWithFallback(baseMessages as any, {
          apiKey: "test-key",
          model: primaryModel,
          maxTokens: 10,
          retryTransient: false,
        }),
      ).rejects.toMatchObject({
        code: expectedCode,
        rateLimitScope: expectedScope,
      });
      expect(isModelCoolingDown("openrouter", primaryModel)).toBe(false);
      expect(persistedCooldownWrites).toEqual([]);
    },
  );

  it.each([
    [
      "provider credential",
      JSON.stringify({
        error: {
          message: "Provider returned error",
          metadata: { limit_source: "provider_rate_limit" },
        },
      }),
      "RATE_LIMITED",
      "provider_credential",
    ],
    [
      "account quota",
      JSON.stringify({ error: { message: "quota exceeded" } }),
      "QUOTA",
      "account_quota",
    ],
  ] as const)(
    "blocks every model lane for the same %s credential until its Retry-After expires",
    async (_scope, responseBody, expectedCode, expectedScope) => {
      vi.useFakeTimers();
      vi.setSystemTime(new Date("2026-10-29T20:00:00.000Z"));
      try {
        const apiKey = "fixture-openrouter-credential-a";
        const otherApiKey = "fixture-openrouter-credential-b";
        const successResponse = () => jsonResponse({
          choices: [{ message: { role: "assistant", content: "fixture response" } }],
          model: primaryModel,
          usage: { prompt_tokens: 1, completion_tokens: 1 },
        });
        const fetchMock = vi.fn()
          .mockResolvedValueOnce(textResponse(
            responseBody,
            429,
            new Headers({ "Retry-After": "5" }),
          ))
          .mockImplementation(async () => successResponse());
        vi.stubGlobal("fetch", fetchMock);
        const complete = (key: string, model = primaryModel) =>
          openrouterCompleteWithFallback(baseMessages as any, {
            apiKey: key,
            model,
            maxTokens: 10,
            maxFallbackModels: 1,
            retryTransient: false,
          });

        await expect(complete(apiKey)).rejects.toMatchObject({
          code: expectedCode,
          rateLimitScope: expectedScope,
          retryAfterMs: 5_000,
        });
        await expect(complete(apiKey, FREE_MODELS[1]!.id)).rejects.toMatchObject({
          code: expectedCode,
          rateLimitScope: expectedScope,
          retryAfterMs: 5_000,
        });
        const drainStream = async () => {
          for await (const _chunk of openrouterCompleteStream(baseMessages as any, {
            apiKey,
            model: FREE_MODELS[1]!.id,
            maxTokens: 10,
          })) {
            // A blocked stream must fail before yielding or issuing a fetch.
          }
        };
        await expect(drainStream()).rejects.toMatchObject({
          code: expectedCode,
          rateLimitScope: expectedScope,
          retryAfterMs: 5_000,
        });
        expect(fetchMock).toHaveBeenCalledTimes(1);

        await complete(otherApiKey);
        expect(fetchMock).toHaveBeenCalledTimes(2);

        await vi.advanceTimersByTimeAsync(5_001);
        await complete(apiKey);
        expect(fetchMock).toHaveBeenCalledTimes(3);
      } finally {
        vi.useRealTimers();
      }
    },
  );

  it("applies a local credential hold when a credential 429 omits Retry-After", async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(textResponse(
        JSON.stringify({
          error: {
            message: "Provider returned error",
            metadata: { limit_source: "provider_rate_limit" },
          },
        }),
        429,
      ))
      .mockResolvedValue(jsonResponse({
        choices: [{ message: { role: "assistant", content: "fixture response" } }],
        model: primaryModel,
        usage: { prompt_tokens: 1, completion_tokens: 1 },
      }));
    vi.stubGlobal("fetch", fetchMock);
    const options = {
      apiKey: "fixture-openrouter-credential-no-retry-after",
      model: primaryModel,
      maxTokens: 10,
      maxFallbackModels: 1,
      retryTransient: false,
    };

    await expect(openrouterCompleteWithFallback(baseMessages as any, options))
      .rejects.toSatisfy((error: unknown) =>
        error instanceof GroqClientError
        && error.code === "RATE_LIMITED"
        && error.rateLimitScope === "provider_credential"
        && error.providerCode === "LOCAL_ADAPTIVE_CREDENTIAL_COOLDOWN"
        && Number.isSafeInteger(error.retryAfterMs)
        && (error.retryAfterMs ?? 0) > 0
        && (error.retryAfterMs ?? Infinity) <= 30_000,
      );
    await expect(openrouterCompleteWithFallback(baseMessages as any, options)).rejects.toMatchObject({
      code: "RATE_LIMITED",
      providerCode: "CREDENTIAL_RETRY_AFTER",
      rateLimitScope: "provider_credential",
      retryAfterMs: expect.any(Number),
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("returns a 429 with Retry-After instead of retrying within the request", async () => {
    const fetchMock = vi.fn(async () =>
      textResponse('{"error":{"message":"temporarily rate limited"}}', 429, new Headers({ "Retry-After": "120" })));
    vi.stubGlobal("fetch", fetchMock);
    const executionLedger = createExecutionLedger({
      budget: { deadlineMs: 90_000 },
    });

    const completion = oacCompleteRaw(baseMessages as any, {
      apiKey: "test-key",
      model: primaryModel,
      maxTokens: 10,
      timeoutMs: 180_000,
      executionLedger,
      baseUrl: "https://example.test/v1",
      providerName: "OpenRouter",
    });
    let rejection: unknown;
    const result = await Promise.race([
      completion.then(
        () => "resolved" as const,
        (error: unknown) => {
          rejection = error;
          return "rejected" as const;
        },
      ),
      new Promise<"still-waiting">((resolve) => setTimeout(() => resolve("still-waiting"), 100)),
    ]);
    expect(result).toBe("rejected");
    expect(rejection).toMatchObject({ code: "RATE_LIMITED", retryAfterMs: 120_000 });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    executionLedger.setTerminal("completed");
  });

  it("does not opt a product fallback request into an in-request 429 retry", async () => {
    const fetchMock = vi.fn(async () =>
      textResponse('{"error":{"message":"temporarily rate limited"}}', 429, new Headers({ "Retry-After": "1" })));
    vi.stubGlobal("fetch", fetchMock);

    await expect(openrouterCompleteWithFallback(baseMessages as any, {
      apiKey: "fixture-openrouter-credential-no-in-request-retry",
      model: primaryModel,
      maxTokens: 10,
      maxFallbackModels: 1,
      retryTransient: false,
      waitOnRateLimit: true,
    } as any)).rejects.toMatchObject({ code: "RATE_LIMITED" });

    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("fails closed for an unknown-scope 429 with a Retry-After", async () => {
    const fetchMock = vi.fn(async () =>
      textResponse('{"error":{"message":"temporarily rate limited"}}', 429, new Headers({ "Retry-After": "1" })));
    vi.stubGlobal("fetch", fetchMock);
    const executionLedger = createExecutionLedger({
      budget: { deadlineMs: 10_000 },
    });

    await expect(oacCompleteRaw(baseMessages as any, {
      apiKey: "test-key",
      model: primaryModel,
      maxTokens: 10,
      executionLedger,
      baseUrl: "https://example.test/v1",
      providerName: "OpenRouter",
    })).rejects.toMatchObject({ code: "RATE_LIMITED", rateLimitScope: "unknown" });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    executionLedger.setTerminal("failed");
  });

  it("does not retry an upstream shared-pool 429 within the request", async () => {
    const fetchMock = vi.fn(async () => textResponse(JSON.stringify({
        error: {
          message: "Provider returned error",
          metadata: {
            limit_source: "upstream_provider_shared_pool",
          },
        },
      }), 429, new Headers({ "Retry-After": "120" })));
    vi.stubGlobal("fetch", fetchMock);
    const executionLedger = createExecutionLedger();

    await expect(
      oacCompleteRaw(baseMessages as any, {
        apiKey: "test-key",
        model: primaryModel,
        maxTokens: 10,
        executionLedger,
        baseUrl: "https://example.test/v1",
        providerName: "OpenRouter",
      }),
    ).rejects.toSatisfy(
      (err: unknown) =>
        err instanceof GroqClientError &&
        err.code === "RATE_LIMITED" &&
        err.rateLimitScope === "upstream_shared_pool" &&
        err.retryAfterMs === 120_000,
    );
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(executionLedger.snapshot().events).toContainEqual(expect.objectContaining({
      kind: "provider_attempt",
      status: "failed",
      reason: "RATE_LIMITED",
      rateLimitScope: "upstream_shared_pool",
      retryAfterMs: 120_000,
    }));
  });

  it("returns a bounded local adaptive delay for a mapped pool 429 without Retry-After", async () => {
    const fetchMock = vi.fn(async () => textResponse(JSON.stringify({
      error: {
        message: "Provider returned error",
        metadata: {
          limit_source: "upstream_provider_shared_pool",
          provider_name: "Thinking Machines",
        },
      },
    }), 429));
    vi.stubGlobal("fetch", fetchMock);

    await expect(openrouterCompleteWithFallback(baseMessages as any, {
      apiKey: "fixture-openrouter-adaptive-pool",
      model: "thinkingmachines/inkling:free",
      maxTokens: 10,
      maxFallbackModels: 0,
      retryTransient: false,
    })).rejects.toSatisfy((error: unknown) =>
      error instanceof GroqClientError
      && error.code === "RATE_LIMITED"
      && error.providerCode === "LOCAL_ADAPTIVE_MODEL_COOLDOWN"
      && error.rateLimitScope === "upstream_shared_pool"
      && Number.isSafeInteger(error.retryAfterMs)
      && (error.retryAfterMs ?? 0) > 0
      && (error.retryAfterMs ?? Infinity) <= 30_000,
    );
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it.each([
    ["upstream shared pool", "upstream_provider_shared_pool", "upstream_shared_pool"],
    ["provider credential", "provider_rate_limit", "provider_credential"],
  ] as const)(
    "does not retry a %s 429 by default",
    async (_scopeName, limitSource, expectedScope) => {
      const fetchMock = vi.fn(async () => textResponse(JSON.stringify({
          error: {
            message: "Provider returned error",
            metadata: { limit_source: limitSource },
          },
        }), 429));
      vi.stubGlobal("fetch", fetchMock);

      await expect(
        openrouterCompleteRaw(baseMessages as any, {
          apiKey: "test-key",
          model: primaryModel,
          maxTokens: 10,
        }),
      ).rejects.toSatisfy(
        (err: unknown) =>
          err instanceof GroqClientError &&
          err.code === "RATE_LIMITED" &&
          err.rateLimitScope === expectedScope,
      );
      expect(fetchMock).toHaveBeenCalledTimes(1);
    },
  );

  it("429 stops same-provider fallback when transient retry is disabled", async () => {
    let callCount = 0;
    const seenModels: string[] = [];
    vi.stubGlobal("fetch", vi.fn(async (_url: string | URL, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body ?? "{}")) as { model?: string };
      callCount++;
      seenModels.push(String(body.model));
      return textResponse('{"error":{"message":"temporarily rate-limited upstream"}}', 429);
    }));

    await expect(
      openrouterCompleteWithFallback(baseMessages as any, {
        apiKey: "test-key",
        model: primaryModel,
        maxTokens: 10,
        maxFallbackModels: 2,
        retryTransient: false,
      }),
    ).rejects.toSatisfy(
      (err: unknown) =>
        err instanceof GroqClientError &&
        err.code === "RATE_LIMITED" &&
        JSON.stringify(err.providerAttemptedModels) === JSON.stringify([seenModels[0]]),
    );
    expect(callCount).toBe(1);
    await expect(assertOpenRouterCredentialAvailable("test-key")).rejects.toSatisfy(
      (error: unknown) =>
        error instanceof GroqClientError &&
        error.code === "RATE_LIMITED" &&
        error.providerCode === "CREDENTIAL_RETRY_AFTER" &&
        error.rateLimitScope === "unknown" &&
        error.retryAfterMs !== undefined &&
        error.retryAfterMs > 0 &&
        error.retryAfterMs <= 30_000,
    );
  });

  it("preserves Retry-After and avoids retrying the same model", async () => {
    const fetchMock = vi.fn(async () =>
      textResponse('{"error":{"message":"temporarily rate limited"}}', 429, new Headers({ "Retry-After": "120" })));
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
        err.retryAfterMs === 120_000,
    );
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("preserves provider Retry-After hints longer than six hours", async () => {
    vi.stubGlobal("fetch", vi.fn(async () =>
      textResponse(
        '{"error":{"message":"temporarily rate limited"}}',
        429,
        new Headers({ "Retry-After": String(7 * 60 * 60) }),
      )));

    await expect(
      oacCompleteRaw(baseMessages as any, {
        apiKey: "test-key",
        model: primaryModel,
        maxTokens: 10,
        retryTransient: false,
        baseUrl: "https://example.test/v1",
        providerName: "OpenRouter",
      }),
    ).rejects.toSatisfy(
      (err: unknown) =>
        err instanceof GroqClientError &&
        err.code === "RATE_LIMITED" &&
        err.retryAfterMs === 7 * 60 * 60_000,
    );
  });

  it("keeps a short Retry-After hint precise for fallback callers", async () => {
    vi.stubGlobal("fetch", vi.fn(async () =>
      textResponse('{"error":{"message":"temporarily rate limited"}}', 429, new Headers({ "Retry-After": "2" }))));

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

  it("parses an HTTP-date Retry-After hint without an artificial six-hour cap", async () => {
    const retryAt = new Date(Date.now() + 7 * 60 * 60_000).toUTCString();
    vi.stubGlobal("fetch", vi.fn(async () =>
      textResponse('{"error":{"message":"temporarily rate limited"}}', 429, new Headers({ "Retry-After": retryAt }))));

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
        err.retryAfterMs > 6 * 60 * 60_000 &&
        err.retryAfterMs <= 7 * 60 * 60_000,
    );
  });

  it("does not cascade rate limits across same-provider models", async () => {
    let callCount = 0;
    const seenModels: string[] = [];
    vi.stubGlobal("fetch", vi.fn(async () => {
      callCount++;
      seenModels.push(String(callCount));
      return textResponse('{"error":{"message":"temporarily rate limited"}}', 429);
    }));

    await expect(
      openrouterCompleteWithFallback(baseMessages as any, {
        apiKey: "test-key",
        model: primaryModel,
        maxTokens: 10,
        retryTransient: false,
      }),
    ).rejects.toSatisfy((err: unknown) => err instanceof GroqClientError && err.code === "RATE_LIMITED");
    expect(callCount).toBe(1);
    expect(new Set(seenModels).size).toBe(1);
  });

  it("serializes concurrent same-model completions and rechecks cooldown before the queued call", async () => {
    let resolveProviderResponse!: (response: Response) => void;
    let notifyProviderStarted!: () => void;
    const providerStarted = new Promise<void>((resolve) => {
      notifyProviderStarted = resolve;
    });
    const pendingResponse = new Promise<Response>((resolve) => {
      resolveProviderResponse = resolve;
    });
    const fetchMock = vi.fn(async () => {
      notifyProviderStarted();
      return pendingResponse;
    });
    vi.stubGlobal("fetch", fetchMock);

    const options = {
      apiKey: "test-key",
      model: primaryModel,
      maxFallbackModels: 1,
      maxTokens: 10,
      retryTransient: false,
    } as const;
    const first = openrouterCompleteWithFallback(baseMessages as any, options);
    await providerStarted;
    const second = openrouterCompleteWithFallback(baseMessages as any, options);
    await Promise.resolve();
    expect(fetchMock).toHaveBeenCalledTimes(1);

    resolveProviderResponse(
      textResponse('{"error":{"message":"temporarily rate limited"}}', 429),
    );

    await expect(first).rejects.toSatisfy(
      (error: unknown) => error instanceof GroqClientError && error.code === "RATE_LIMITED",
    );
    await expect(second).rejects.toSatisfy(
      (error: unknown) =>
        error instanceof GroqClientError &&
        error.code === "RATE_LIMITED" &&
        error.providerCode === "CREDENTIAL_RETRY_AFTER" &&
        error.rateLimitScope === "unknown" &&
        error.retryAfterMs !== undefined &&
        error.retryAfterMs > 0 &&
        error.retryAfterMs <= 30_000,
    );
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it.each([
    {
      label: "one credential across different model publishers",
      firstModel: primaryModel,
      secondModel: FREE_MODELS.find(
        (candidate) => candidate.id.split("/", 1)[0] !== primaryModel.split("/", 1)[0],
      )!.id,
      firstApiKey: "shared-test-key",
      secondApiKey: "shared-test-key",
    },
    {
      label: "one publisher across different credentials",
      firstModel: "thinkingmachines/inkling-small:free",
      secondModel: "thinkingmachines/inkling:free",
      firstApiKey: "first-test-key",
      secondApiKey: "second-test-key",
    },
  ])("serializes $label before provider send", async ({
    firstModel,
    secondModel,
    firstApiKey,
    secondApiKey,
  }) => {
    let resolveFirstResponse!: (response: Response) => void;
    let notifyFirstStarted!: () => void;
    const firstStarted = new Promise<void>((resolve) => {
      notifyFirstStarted = resolve;
    });
    const firstResponse = new Promise<Response>((resolve) => {
      resolveFirstResponse = resolve;
    });
    const seenModels: string[] = [];
    const fetchMock = vi.fn(async (_url: string | URL, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body ?? "{}")) as Record<string, unknown>;
      seenModels.push(String(body.model));
      if (seenModels.length === 1) {
        notifyFirstStarted();
        return firstResponse;
      }
      return jsonResponse({
        choices: [{ message: { content: "second response" }, finish_reason: "stop" }],
        model: body.model,
        usage: { prompt_tokens: 1, completion_tokens: 1 },
      });
    });
    vi.stubGlobal("fetch", fetchMock);

    const first = openrouterCompleteWithFallback(baseMessages as any, {
      apiKey: firstApiKey,
      model: firstModel,
      maxFallbackModels: 0,
      maxTokens: 10,
      retryTransient: false,
    });
    await firstStarted;
    const second = openrouterCompleteWithFallback(baseMessages as any, {
      apiKey: secondApiKey,
      model: secondModel,
      maxFallbackModels: 0,
      maxTokens: 10,
      retryTransient: false,
    });
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(fetchMock).toHaveBeenCalledTimes(1);

    resolveFirstResponse(jsonResponse({
      choices: [{ message: { content: "first response" }, finish_reason: "stop" }],
      model: firstModel,
      usage: { prompt_tokens: 1, completion_tokens: 1 },
    }));
    await Promise.all([first, second]);

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(seenModels).toEqual([firstModel, secondModel]);
  });

  it("serializes concurrent same-model streams and does not send a queued request after a 429", async () => {
    let resolveProviderResponse!: (response: Response) => void;
    let notifyProviderStarted!: () => void;
    const providerStarted = new Promise<void>((resolve) => {
      notifyProviderStarted = resolve;
    });
    const pendingResponse = new Promise<Response>((resolve) => {
      resolveProviderResponse = resolve;
    });
    const fetchMock = vi.fn(async () => {
      notifyProviderStarted();
      return pendingResponse;
    });
    vi.stubGlobal("fetch", fetchMock);

    const options = {
      apiKey: "test-key",
      model: primaryModel,
      maxFallbackModels: 1,
      maxTokens: 10,
      retryTransient: false,
    } as const;
    const consume = async (stream: AsyncGenerator<string>) => {
      for await (const _chunk of stream) {
        // A 429 should occur before any chunks are emitted.
      }
    };
    const first = consume(openrouterCompleteStream(baseMessages as any, options));
    await providerStarted;
    const second = consume(openrouterCompleteStream(baseMessages as any, options));
    await Promise.resolve();
    expect(fetchMock).toHaveBeenCalledTimes(1);

    resolveProviderResponse(
      textResponse('{"error":{"message":"temporarily rate limited"}}', 429),
    );

    await expect(first).rejects.toSatisfy(
      (error: unknown) => error instanceof GroqClientError && error.code === "RATE_LIMITED",
    );
    await expect(second).rejects.toSatisfy(
      (error: unknown) =>
        error instanceof GroqClientError &&
        error.code === "RATE_LIMITED" &&
        error.providerCode === "CREDENTIAL_RETRY_AFTER" &&
        error.rateLimitScope === "unknown" &&
        error.retryAfterMs !== undefined &&
        error.retryAfterMs > 0 &&
        error.retryAfterMs <= 30_000,
    );
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("caps an EMPTY_RESPONSE stream at the primary and one free alternative", async () => {
    const seenModels: string[] = [];
    const fetchMock = vi.fn(async (_url: string | URL, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body ?? "{}")) as Record<string, unknown>;
      seenModels.push(String(body.model));
      return new Response("data: [DONE]\n\n", {
        headers: { "content-type": "text/event-stream" },
      });
    });
    vi.stubGlobal("fetch", fetchMock);
    const consume = async (stream: AsyncGenerator<string>) => {
      for await (const _chunk of stream) {
        // Empty stream output is not accepted as task completion.
      }
    };

    await expect(
      consume(openrouterCompleteStream(baseMessages as any, {
        apiKey: "test-key",
        model: primaryModel,
        maxTokens: 10,
      })),
    ).rejects.toMatchObject({ code: "EMPTY_RESPONSE" });

    expect(seenModels).toHaveLength(2);
    expect(new Set(seenModels).size).toBe(2);
  });

  it("fails locally without contacting OpenRouter when the distributed lease is unavailable", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const modelCooldownPersistence = {
      readActive: async () => [],
      write: async () => {},
      clear: async () => {},
      acquireAttemptLease: async () => undefined,
    };

    await expect(
      openrouterCompleteWithFallback(baseMessages as any, {
        apiKey: "test-key",
        model: primaryModel,
        maxFallbackModels: 1,
        modelCooldownPersistence,
      }),
    ).rejects.toSatisfy(
      (error: unknown) =>
        error instanceof GroqClientError &&
        error.code === "MODEL_ATTEMPT_BUSY" &&
        error.providerCode === "MODEL_ATTEMPT_LOCK_BUSY",
    );
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("reserves credential, publisher, and exact-model lanes before sending", async () => {
    const acquiredModels: string[] = [];
    const releasedModels: string[] = [];
    const fetchMock = vi.fn(async (_url: string | URL, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body ?? "{}")) as Record<string, unknown>;
      return jsonResponse({
        choices: [{ message: { content: "bounded response" }, finish_reason: "stop" }],
        model: body.model,
        usage: { prompt_tokens: 1, completion_tokens: 1 },
      });
    });
    vi.stubGlobal("fetch", fetchMock);
    const modelCooldownPersistence = {
      readActive: async () => [],
      write: async () => {},
      clear: async () => {},
      acquireAttemptLease: async (_provider: string, leaseKey: string) => {
        acquiredModels.push(leaseKey);
        return { release: async () => { releasedModels.push(leaseKey); } };
      },
    };

    await openrouterCompleteWithFallback(baseMessages as any, {
      apiKey: "test-key",
      model: primaryModel,
      maxFallbackModels: 0,
      modelCooldownPersistence,
    });

    expect(acquiredModels).toHaveLength(3);
    expect(acquiredModels[0]).toMatch(/^__openrouter_credential_attempt_lane__:[a-f0-9]{64}$/);
    expect(acquiredModels[0]).not.toContain("test-key");
    expect(acquiredModels[1]).toMatch(/^__publisher_attempt_lane__:/);
    expect(acquiredModels[2]).toBe(primaryModel);
    expect(releasedModels).toEqual([...acquiredModels].reverse());
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("fails closed across the free candidate chain when lease persistence throws", async () => {
    let leaseCalls = 0;
    const fetchMock = vi.fn(async (_url: string | URL, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body ?? "{}")) as Record<string, unknown>;
      return jsonResponse({
        choices: [{ message: { content: "response must not be reached" }, finish_reason: "stop" }],
        model: body.model,
        usage: { prompt_tokens: 1, completion_tokens: 1 },
      });
    });
    vi.stubGlobal("fetch", fetchMock);
    const modelCooldownPersistence = {
      readActive: async () => [],
      write: async () => {},
      clear: async () => {},
      acquireAttemptLease: async () => {
        leaseCalls += 1;
        if (leaseCalls === 1) throw new Error("fixture lease store failure");
        return { release: async () => {} };
      },
    };

    await expect(
      openrouterCompleteWithFallback(baseMessages as any, {
        apiKey: "test-key",
        model: primaryModel,
        maxFallbackModels: 2,
        modelCooldownPersistence,
      }),
    ).rejects.toSatisfy(
      (error: unknown) =>
        error instanceof GroqClientError &&
        error.code === "MODEL_ATTEMPT_BUSY" &&
        error.providerCode === "MODEL_ATTEMPT_LOCK_UNAVAILABLE",
    );
    expect(leaseCalls).toBe(1);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("fails closed on lease persistence errors before starting a stream", async () => {
    let leaseCalls = 0;
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const modelCooldownPersistence = {
      readActive: async () => [],
      write: async () => {},
      clear: async () => {},
      acquireAttemptLease: async () => {
        leaseCalls += 1;
        if (leaseCalls === 1) throw new Error("fixture lease store failure");
        return { release: async () => {} };
      },
    };
    const consume = async (stream: AsyncGenerator<string>) => {
      for await (const _chunk of stream) {
        // A lease-store failure must happen before any provider bytes exist.
      }
    };

    await expect(
      consume(
        openrouterCompleteStream(baseMessages as any, {
          apiKey: "test-key",
          model: primaryModel,
          maxFallbackModels: 2,
          modelCooldownPersistence,
        }),
      ),
    ).rejects.toSatisfy(
      (error: unknown) =>
        error instanceof GroqClientError &&
        error.code === "MODEL_ATTEMPT_BUSY" &&
        error.providerCode === "MODEL_ATTEMPT_LOCK_UNAVAILABLE",
    );
    expect(leaseCalls).toBe(1);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("does not immediately retry a 429 whose rate-limit scope is unknown", async () => {
    let callCount = 0;
    vi.stubGlobal("fetch", vi.fn(async () => {
      callCount++;
      if (callCount === 1) {
        return textResponse('{"error":{"message":"temporarily rate limited"}}', 429);
      }
      return jsonResponse({
        choices: [{ message: { content: "response after retry" }, finish_reason: "stop" }],
        model: primaryModel,
        usage: { prompt_tokens: 1, completion_tokens: 1 },
      });
    }));

    await expect(
      openrouterCompleteWithFallback(baseMessages as any, {
        apiKey: "test-key",
        model: primaryModel,
        maxTokens: 10,
      }),
    ).rejects.toSatisfy(
      (error: unknown) =>
        error instanceof GroqClientError &&
        error.code === "RATE_LIMITED" &&
        error.rateLimitScope === "unknown",
    );
    expect(callCount).toBe(1);
  });

  it("traces each OpenRouter request in one execution without logging prompt or credential", async () => {
    const priorTraceSetting = process.env.ENGINEERINGOS_OPENROUTER_ATTEMPT_TRACE;
    process.env.ENGINEERINGOS_OPENROUTER_ATTEMPT_TRACE = "1";
    const infoSpy = vi.spyOn(console, "info").mockImplementation(() => {});
    let callCount = 0;
    vi.stubGlobal("fetch", vi.fn(async () => {
      callCount += 1;
      if (callCount === 1) {
        return textResponse(JSON.stringify({
          error: {
            message: "shared pool limit",
            metadata: {
              limit_source: "upstream_provider_shared_pool",
              provider_name: "Thinking Machines",
            },
          },
        }), 429);
      }
      return jsonResponse({
        choices: [{ message: { content: "accepted response" }, finish_reason: "stop" }],
        model: primaryModel,
        usage: { prompt_tokens: 2, completion_tokens: 3 },
      });
    }));

    const executionLedger = createExecutionLedger({ id: "private-execution-id" });
    const requestOptions = {
      apiKey: "private-provider-credential",
      model: "thinkingmachines/inkling:free",
      maxTokens: 10,
      maxFallbackModels: 1,
      retryTransient: false,
      executionLedger,
    } as const;

    try {
      await expect(
        openrouterCompleteWithFallback(
          [{ role: "user", content: "private prompt marker" }] as any,
          { ...requestOptions, operation: "tool_loop" },
        ),
      ).rejects.toSatisfy(
        (error: unknown) =>
          error instanceof GroqClientError &&
          error.code === "RATE_LIMITED" &&
          error.rateLimitScope === "upstream_shared_pool",
      );

      const accepted = await openrouterCompleteWithFallback(
        [{ role: "user", content: "private prompt marker" }] as any,
        {
          ...requestOptions,
          model: "liquid/lfm-2.5-2.6b:free",
          operation: "project_query_no_tools_synthesis",
        },
      );
      expect(accepted.content).toBe("accepted response");
      expect(callCount).toBe(2);

      const trace = infoSpy.mock.calls
        .map(([value]) => {
          try {
            return JSON.parse(String(value)) as Record<string, unknown>;
          } catch {
            return undefined;
          }
        })
        .filter((entry) => entry?.scope === "openrouter-attempt-trace");
      expect(trace).toHaveLength(4);
      expect(trace.map((entry) => [entry?.action, entry?.sequence, entry?.operation, entry?.status]))
        .toEqual([
          ["started", 1, "tool_loop", undefined],
          ["completed", 1, "tool_loop", "failed"],
          ["started", 2, "project_query_no_tools_synthesis", undefined],
          ["completed", 2, "project_query_no_tools_synthesis", "completed"],
        ]);
      expect(trace[0]?.execution).toMatch(/^[a-f0-9]{16}$/u);
      expect(trace.every((entry) => entry?.execution === trace[0]?.execution)).toBe(true);
      expect(trace[1]).toMatchObject({
        errorCode: "RATE_LIMITED",
        rateLimitScope: "upstream_shared_pool",
      });
      const serializedTrace = JSON.stringify(trace);
      expect(serializedTrace).not.toContain("private-execution-id");
      expect(serializedTrace).not.toContain("private-provider-credential");
      expect(serializedTrace).not.toContain("private prompt marker");
    } finally {
      if (priorTraceSetting === undefined) {
        delete process.env.ENGINEERINGOS_OPENROUTER_ATTEMPT_TRACE;
      } else {
        process.env.ENGINEERINGOS_OPENROUTER_ATTEMPT_TRACE = priorTraceSetting;
      }
    }
  });

  it("bounds provider-owned fallback candidates for short recovery calls", async () => {
    let callCount = 0;
    const seenModels: string[] = [];
    vi.stubGlobal("fetch", vi.fn(async (_url: string | URL, init?: RequestInit) => {
      callCount++;
      const body = JSON.parse(String(init?.body ?? "{}")) as { model?: string };
      seenModels.push(String(body.model));
      return textResponse('{"error":{"message":"temporarily rate limited"}}', 429);
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
    expect(callCount).toBe(1);
    expect(new Set(seenModels).size).toBe(1);
  });

  it("keeps the requested model on reasoning-only EMPTY_RESPONSE", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => jsonResponse({
        choices: [{
          finish_reason: "stop",
          message: {
            content: null,
            reasoning_content: "private reasoning without a final answer",
          },
        }],
        model: primaryModel,
        usage: { prompt_tokens: 1, completion_tokens: 1 },
      })));

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

  it("keeps the requested model when the caller cancels a pending response body", async () => {
    vi.stubGlobal("fetch", vi.fn(async (_url: string | URL, init?: RequestInit) =>
      new Response(new ReadableStream<Uint8Array>({
        start(controller) {
          const signal = init?.signal;
          const abort = () => controller.error(new DOMException("The operation was aborted", "AbortError"));
          if (signal?.aborted) abort();
          else signal?.addEventListener("abort", abort, { once: true });
        },
      }), { status: 200 })));

    const callerController = new AbortController();
    const completion = oacCompleteRaw(baseMessages as any, {
      apiKey: "test-key",
      model: primaryModel,
      baseUrl: "https://openrouter.ai/api/v1",
      providerName: "OpenRouter",
      signal: callerController.signal,
      maxTokens: 10,
    });
    setTimeout(() => callerController.abort(), 25);
    await expect(
      completion,
    ).rejects.toSatisfy(
      (err: unknown) =>
        err instanceof GroqClientError &&
        err.code === "TIMEOUT" &&
        err.providerModel === primaryModel,
    );
  });

  it("429 with 'quota' in body → QUOTA (PR-008)", async () => {
    vi.stubGlobal("fetch", vi.fn(async () =>
      textResponse('{"error":{"message":"billing quota exceeded for this month"}}', 429)));

    await expect(
      openrouterCompleteWithFallback(baseMessages as any, { apiKey: "test-key", model: primaryModel, maxTokens: 10 }),
    ).rejects.toSatisfy((err: unknown) => err instanceof GroqClientError && err.code === "QUOTA");
    expect(isModelCoolingDown("openrouter", primaryModel)).toBe(false);
    expect(persistedCooldownWrites).toEqual([]);
  });

  it("429 with 'credits' in body → QUOTA (PR-008)", async () => {
    vi.stubGlobal("fetch", vi.fn(async () =>
      textResponse('{"error":{"message":"insufficient credits"}}', 429)));

    await expect(
      openrouterCompleteWithFallback(baseMessages as any, { apiKey: "test-key", model: primaryModel, maxTokens: 10 }),
    ).rejects.toSatisfy((err: unknown) => err instanceof GroqClientError && err.code === "QUOTA");
  });

  it("401 → AUTH_ERROR (not fallback-worthy)", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => textResponse("", 401)));

    await expect(
      openrouterCompleteWithFallback(baseMessages as any, { apiKey: "bad-key", model: primaryModel, maxTokens: 10 }),
    ).rejects.toSatisfy((err: unknown) => err instanceof GroqClientError && err.code === "AUTH_ERROR");
  });

  it("403 agent-harness restriction → MODEL_UNAVAILABLE → triggers fallback", async () => {
    let callCount = 0;
    const seenModels: string[] = [];
    vi.stubGlobal("fetch", vi.fn(async (_url: string | URL, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body ?? "{}")) as Record<string, unknown>;
      callCount++;
      seenModels.push(String(body.model));
      if (callCount === 1) {
        return textResponse(
          '{"error":{"message":"This model is only available through an agent harness."}}',
          403,
        );
      }
      return jsonResponse({
          choices: [{ message: { content: "ok-after-agent-harness-restriction" } }],
          model: String(body.model),
          usage: {},
        });
    }));

    const result = await openrouterCompleteWithFallback(baseMessages as any, {
      apiKey: "test-key",
      model: primaryModel,
      maxTokens: 10,
    });

    expect(result.content).toBe("ok-after-agent-harness-restriction");
    expect(callCount).toBeGreaterThanOrEqual(2);
    expect(seenModels[0]).toBe(primaryModel);
    expect(seenModels[1]).not.toBe(primaryModel);
  });

  it("500 → SERVER_ERROR", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => textResponse("internal error", 500)));

    await expect(
      openrouterCompleteWithFallback(baseMessages as any, { apiKey: "test-key", model: primaryModel, maxTokens: 10 }),
    ).rejects.toSatisfy((err: unknown) => err instanceof GroqClientError && err.code === "SERVER_ERROR");
  });

  it("all candidates exhausted → throws MODEL_NOT_FOUND", async () => {
    vi.stubGlobal("fetch", vi.fn(async () =>
      textResponse('{"error":{"message":"model not found"}}', 404)));

    await expect(
      openrouterCompleteWithFallback(baseMessages as any, { apiKey: "test-key", model: primaryModel, maxTokens: 10 }),
    ).rejects.toSatisfy((err: unknown) => err instanceof GroqClientError && err.code === "MODEL_NOT_FOUND");
  });

  it("shares provider-attempt budget across fallback candidates", async () => {
    const requestOrder: string[] = [];
    const fetchMock = vi.fn(async () => {
      requestOrder.push(`fetch:${fetchMock.mock.calls.length}`);
      return textResponse('{"error":{"message":"model not found"}}', 404, new Headers());
    });
    vi.stubGlobal("fetch", fetchMock);
    const reserve = vi.fn(async ({ sequence }: { sequence: number }) => {
      requestOrder.push(`reserve:${sequence}`);
      return `request:${sequence}`;
    });
    const reconcile = vi.fn(async ({ reservationId }: { reservationId: string }) => {
      requestOrder.push(`reconcile:${reservationId}`);
    });
    const ledger = createExecutionLedger({
      budget: { providerAttempts: 2, deadlineMs: 10_000 },
      providerRequestBudget: { reserve, reconcile },
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
    expect(reserve).toHaveBeenCalledTimes(2);
    expect(reconcile).toHaveBeenCalledTimes(2);
    expect(requestOrder).toEqual([
      "reserve:1",
      "fetch:1",
      "reconcile:request:1",
      "reserve:2",
      "fetch:2",
      "reconcile:request:2",
    ]);
    expect(ledger.snapshot().counts.provider_attempt).toBe(2);
    expect(ledger.snapshot().providers).toContain("OpenRouter");
    expect(ledger.snapshot().events).toEqual(expect.arrayContaining([
      expect.objectContaining({ reservationId: "request:1", status: "failed" }),
      expect.objectContaining({ reservationId: "request:2", status: "failed" }),
    ]));
  });

  it("attributes bounded no-tools provider attempts to their recovery phase", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => jsonResponse({
        choices: [{ message: { content: "plain answer" }, finish_reason: "stop" }],
        model: primaryModel,
        usage: { prompt_tokens: 23, completion_tokens: 7 },
      })));
    const ledger = createExecutionLedger();

    await oacCompleteRaw(baseMessages as any, {
      apiKey: "test-key",
      baseUrl: "https://openrouter.ai/api/v1",
      providerName: "OpenRouter",
      model: primaryModel,
      operation: "project_query_no_tools_synthesis",
      executionLedger: ledger,
    });

    expect(ledger.snapshot().events).toEqual(expect.arrayContaining([
      expect.objectContaining({
        kind: "provider_attempt",
        operation: "project_query_no_tools_synthesis",
        status: "completed",
        usage: { promptTokens: 23, completionTokens: 7, usageStatus: "known" },
      }),
    ]));
  });
});

describe("OpenAI-compatible stream timeout", () => {
  it("aborts a stream that never yields a response within its configured deadline", async () => {
    vi.useFakeTimers();
    let notifyFetchStarted!: () => void;
    const fetchStarted = new Promise<void>((resolve) => {
      notifyFetchStarted = resolve;
    });
    vi.stubGlobal("fetch", vi.fn((_url: string | URL, init?: RequestInit) => {
      notifyFetchStarted();
      return new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener(
          "abort",
          () => reject(new Error("request aborted")),
          { once: true },
        );
      });
    }));

    const consume = async () => {
      for await (const _chunk of oacCompleteStream(baseMessages as any, {
        apiKey: "test-key",
        baseUrl: "https://openrouter.ai/api/v1",
        providerName: "OpenRouter",
        model: FREE_MODELS[0]!.id,
        timeoutMs: 25,
      })) {
        // The mocked provider never sends content.
      }
    };
    const request = consume();
    const expectedTimeout = expect(request).rejects.toSatisfy(
      (error: unknown) =>
        error instanceof GroqClientError && error.code === "TIMEOUT",
    );
    try {
      await fetchStarted;
      await vi.advanceTimersByTimeAsync(25);
      await expectedTimeout;
    } finally {
      vi.useRealTimers();
    }
  });
});

describe("stream usage accounting", () => {
  it("records usage from a final OpenAI-compatible SSE chunk", async () => {
    const reconcile = vi.fn(async () => undefined);
    const ledger = createExecutionLedger({
      providerRequestBudget: {
        reserve: async () => "openrouter-stream:usage",
        reconcile,
      },
    });
    const streamBody = [
      'data: {"choices":[{"delta":{"content":"answer"}}]}',
      "",
      'data: {"choices":[],"usage":{"prompt_tokens":17,"completion_tokens":6}}',
      "",
      "data: [DONE]",
      "",
    ].join("\n");
    vi.stubGlobal("fetch", vi.fn(async () => new Response(streamBody, {
      headers: { "content-type": "text/event-stream" },
    })));

    const chunks: string[] = [];
    for await (const chunk of oacCompleteStream(baseMessages as any, {
      apiKey: "fixture-key",
      baseUrl: "https://example.test/v1",
      providerName: "OpenRouter",
      model: cataloguedFreeModel,
      executionLedger: ledger,
    })) {
      chunks.push(chunk);
    }

    expect(chunks.join("")).toBe("answer");
    expect(reconcile).toHaveBeenCalledWith(expect.objectContaining({
      reservationId: "openrouter-stream:usage",
      status: "completed",
      usage: { promptTokens: 17, completionTokens: 6, usageStatus: "known" },
    }));
    expect(ledger.snapshot().events).toContainEqual(expect.objectContaining({
      kind: "provider_attempt",
      status: "completed",
      usage: { promptTokens: 17, completionTokens: 6, usageStatus: "known" },
    }));
  });
});

describe("Gemini native usage accounting", () => {
  it("records token usage metadata from tool-enabled Gemini responses", async () => {
    const reconcile = vi.fn(async () => undefined);
    const ledger = createExecutionLedger({
      providerRequestBudget: {
        reserve: async () => "gemini-request:usage",
        reconcile,
      },
    });
    vi.stubGlobal("fetch", vi.fn(async () => jsonResponse({
      candidates: [{
        finishReason: "STOP",
        content: { parts: [{ text: "answer" }] },
      }],
      usageMetadata: {
        promptTokenCount: 4,
        candidatesTokenCount: 3,
        thoughtsTokenCount: 2,
      },
    })));

    await geminiCompleteRaw(baseMessages as any, {
      apiKey: "fixture-key",
      model: "gemini-3-flash-preview",
      tools: [{
        type: "function",
        function: {
          name: "fixture_tool",
          description: "Fixture tool",
          parameters: { type: "object", properties: {} },
        },
      }] as any,
      executionLedger: ledger,
    });

    expect(reconcile).toHaveBeenCalledWith(expect.objectContaining({
      reservationId: "gemini-request:usage",
      status: "completed",
      usage: { promptTokens: 4, completionTokens: 3, usageStatus: "known" },
    }));
    expect(ledger.snapshot().events).toContainEqual(expect.objectContaining({
      kind: "provider_attempt",
      status: "completed",
      usage: { promptTokens: 4, completionTokens: 3, usageStatus: "known" },
    }));
  });
});

describe("OpenRouter tool selection", () => {
  it("forwards required tool choice for an explicit execution handoff", async () => {
    let captured: Record<string, unknown> | undefined;
    vi.stubGlobal("fetch", vi.fn(async (_url: string | URL, init?: RequestInit) => {
      captured = JSON.parse(String(init?.body ?? "{}")) as Record<string, unknown>;
      return jsonResponse({
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
          model: toolCapableFreeModel,
          usage: { prompt_tokens: 1, completion_tokens: 1 },
        });
    }));

    await oacCompleteRaw(baseMessages as any, {
      apiKey: "test-key",
      baseUrl: "https://example.test/v1",
      providerName: "OpenRouter",
      model: toolCapableFreeModel,
      tools: [{
        type: "function",
        function: { name: "read_file", description: "Read a file", parameters: {} },
      }],
      toolChoice: "required",
    });

    expect(captured?.tool_choice).toBe("required");
  });

  it("forces no tool choice for explicit no-tool synthesis", async () => {
    let captured: Record<string, unknown> | undefined;
    vi.stubGlobal("fetch", vi.fn(async (_url: string | URL, init?: RequestInit) => {
      captured = JSON.parse(String(init?.body ?? "{}")) as Record<string, unknown>;
      return jsonResponse({
          choices: [{ message: { content: "plain prose" } }],
          model: cataloguedFreeModel,
          usage: { prompt_tokens: 1, completion_tokens: 1 },
        });
    }));

    await oacCompleteRaw(baseMessages as any, {
      apiKey: "test-key",
      baseUrl: "https://example.test/v1",
      providerName: "OpenRouter",
      model: cataloguedFreeModel,
      toolChoice: "none",
    });

    expect(captured?.tool_choice).toBe("none");
    expect(captured).not.toHaveProperty("tools");
  });
});

describe("OpenRouter inference admission", () => {
  it("checks credential-wide cooldown before direct transport can send", async () => {
    _resetOpenRouterCredentialCooldownsForTest();
    vi.stubEnv("AI_PROVIDER_EGRESS_DISABLED", "0");
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const persistence = {
      readActive: async () => null,
      write: async () => {},
    };
    await recordOpenRouterCredentialCooldown(
      "synthetic-openrouter-key",
      new GroqClientError("RATE_LIMITED", "fixture cooldown", {
        context: {
          retryAfterMs: 60_000,
          rateLimitScope: "account_quota",
        },
      }),
      persistence as any,
    );

    try {
      await expect(oacCompleteRaw(baseMessages as any, {
        apiKey: "synthetic-openrouter-key",
        baseUrl: "https://example.test/v1",
        providerName: "OpenRouter",
        model: cataloguedFreeModel,
        credentialCooldownPersistence: persistence as any,
      })).rejects.toMatchObject({
        code: "RATE_LIMITED",
        providerCode: "CREDENTIAL_RETRY_AFTER",
      });
      expect(fetchMock).not.toHaveBeenCalled();
    } finally {
      _resetOpenRouterCredentialCooldownsForTest();
    }
  });

  it("rejects a caller-forged permit before transport can send", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    await expect(oacCompleteRaw(baseMessages as any, {
      apiKey: "test-key",
      baseUrl: "https://example.test/v1",
      providerName: "OpenRouter",
      model: cataloguedFreeModel,
      admissionPermit: { model: cataloguedFreeModel } as any,
    })).rejects.toMatchObject({ code: "INVALID_CONFIG" });

    expect(fetchMock).not.toHaveBeenCalled();
  });
});

// ── PR-007: provider error context preservation ───────────────────────────────

describe("GroqClientError — provider context (PR-007)", () => {
  it("preserves providerStatus, providerCode, providerMessage from 404", async () => {
    vi.stubGlobal("fetch", vi.fn(async () =>
      textResponse('{"error":{"code":"model_not_found","message":"The model has been discontinued"}}', 404)));

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
    vi.stubGlobal("fetch", vi.fn(async () => textResponse(body, 400)));

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

  it("includes the classified rate-limit scope in provider telemetry", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const body = JSON.stringify({
      error: {
        code: "rate_limit_exceeded",
        message: "rate limited",
        metadata: { limit_source: "upstream_provider_shared_pool" },
      },
    });
    vi.stubGlobal("fetch", vi.fn(async () => textResponse(body, 429)));

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
      err.code === "RATE_LIMITED" &&
      err.rateLimitScope === "upstream_shared_pool"
    );

    const classificationLog = warn.mock.calls
      .map(([entry]) => {
        try {
          return JSON.parse(String(entry)) as Record<string, unknown>;
        } catch {
          return null;
        }
      })
      .find((entry) => entry?.action === "classify_status");
    expect(classificationLog).toMatchObject({
      providerStatus: 429,
      rateLimitScope: "upstream_shared_pool",
    });
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

  it("rejects finish_reason=error before normalized tool calls can be returned", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => jsonResponse({
        choices: [{
          finish_reason: "error",
          message: {
            content: "provider error details",
            tool_calls: [{
              id: "should-not-run",
              type: "function",
              function: { name: "read_file", arguments: '{"path":"src/secret.ts"}' },
            }],
          },
        }],
        model: "test-model",
      })));

    await expect(
      oacCompleteRaw(baseMessages as any, {
        apiKey: "test-key",
        model: FREE_MODELS[0]!.id,
        baseUrl: "https://openrouter.ai/api/v1",
        providerName: "OpenRouter",
        tools: [{
          type: "function",
          function: { name: "read_file", description: "Read a file", parameters: {} },
        }],
      }),
    ).rejects.toSatisfy((err: unknown) =>
      err instanceof GroqClientError
      && err.code === "INVALID_PROVIDER_RESPONSE"
      && err.providerCode === "FINISH_REASON_ERROR"
    );
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
