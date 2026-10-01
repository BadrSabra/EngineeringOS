import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  geminiCompleteRaw,
  oacCompleteRaw,
  oacCompleteStream,
  validateGeminiDefaultModels,
} from "../openai-compatible-client.js";
import {
  deepseekCompleteRaw,
  deepseekCompleteStream,
  validateDeepSeekDefaultModels,
} from "../deepseek-client.js";
import {
  _resetForTest as resetCatalog,
  refreshDynamicCatalog,
} from "../openrouter/dynamic-catalog.js";

const messages = [{ role: "user", content: "fixture" }] as const;
const guardedEnv = {
  AI_PROVIDER_EGRESS_DISABLED: "1",
  RUN_CONTROLLED_RELEASE_VALIDATION: "1",
  DASHBOARD_E2E_TEST_MODE: "fixture",
  NODE_ENV: "test",
};

function enableGuard(): void {
  Object.assign(process.env, guardedEnv);
}

function disableGuard(): void {
  for (const key of Object.keys(guardedEnv)) delete process.env[key];
}

function response(body: unknown): Response {
  return new Response(JSON.stringify(body), { status: 200 });
}

beforeEach(() => {
  disableGuard();
  resetCatalog();
});

afterEach(() => {
  disableGuard();
  resetCatalog();
  vi.unstubAllGlobals();
  vi.resetModules();
  vi.doUnmock("groq-sdk");
});

describe("OpenAI-compatible transport guard", () => {
  it("blocks raw and streaming requests while allowing the default path", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      response({
        choices: [{ message: { content: "ok" } }],
        model: "fixture-model",
        usage: {},
      }),
    );
    vi.stubGlobal("fetch", fetchMock);

    enableGuard();
    await expect(oacCompleteRaw(messages as any, {
      apiKey: "fixture-key",
      baseUrl: "https://provider.invalid/v1",
      providerName: "Fixture",
    })).rejects.toBeDefined();
    const stream = oacCompleteStream(messages as any, {
      apiKey: "fixture-key",
      baseUrl: "https://provider.invalid/v1",
      providerName: "Fixture",
    });
    await expect(stream.next()).rejects.toBeDefined();
    expect(fetchMock).not.toHaveBeenCalled();

    disableGuard();
    await expect(oacCompleteRaw(messages as any, {
      apiKey: "fixture-key",
      baseUrl: "https://provider.invalid/v1",
      providerName: "Fixture",
    })).resolves.toMatchObject({ content: "ok" });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("blocks Gemini model checks and native tool completion", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      response({
        models: [{ name: "models/gemini-fixture", supportedGenerationMethods: ["generateContent"] }],
        candidates: [{ content: { parts: [{ text: "ok" }] } }],
      }),
    );
    vi.stubGlobal("fetch", fetchMock);
    enableGuard();

    await expect(validateGeminiDefaultModels("fixture-key", {
      fast: "gemini-fixture",
      powerful: "gemini-fixture",
    })).rejects.toBeDefined();
    await expect(geminiCompleteRaw(messages as any, {
      apiKey: "fixture-key",
      model: "gemini-fixture",
      tools: [{
        type: "function",
        function: { name: "noop", description: "noop", parameters: { type: "object" } },
      }],
    })).rejects.toBeDefined();
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe("DeepSeek transport guard", () => {
  it("blocks model checks and both completion transports", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      response({
        choices: [{ message: { content: "ok" } }],
        model: "deepseek-chat",
        usage: {},
      }),
    );
    vi.stubGlobal("fetch", fetchMock);
    enableGuard();

    await expect(validateDeepSeekDefaultModels("fixture-key", {
      fast: "deepseek-chat",
      powerful: "deepseek-chat",
    })).rejects.toBeDefined();
    await expect(deepseekCompleteRaw(messages as any, {
      apiKey: "fixture-key",
    })).rejects.toBeDefined();
    const stream = deepseekCompleteStream(messages as any, { apiKey: "fixture-key" });
    await expect(stream.next()).rejects.toBeDefined();
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe("Groq transport guard", () => {
  it("blocks model list and both SDK completion paths", async () => {
    const list = vi.fn().mockResolvedValue({ data: [{ id: "fixture-model" }] });
    const create = vi.fn().mockResolvedValue({
      choices: [{ message: { content: "ok" } }],
      model: "fixture-model",
      usage: {},
    });
    vi.doMock("groq-sdk", () => ({
      default: class {
        models = { list };
        chat = { completions: { create } };
      },
    }));
    const { completeRaw, completeStream, validateGroqDefaultModels } =
      await import("../groq-client.js");
    enableGuard();

    await expect(validateGroqDefaultModels("fixture-key", {
      fast: "fixture-model",
      powerful: "fixture-model",
    })).rejects.toBeDefined();
    await expect(completeRaw(messages as any, {
      apiKey: "fixture-key",
      maxRetries: 0,
    })).rejects.toBeDefined();
    const stream = completeStream(messages as any, { apiKey: "fixture-key" });
    await expect(stream.next()).rejects.toBeDefined();
    expect(list).not.toHaveBeenCalled();
    expect(create).not.toHaveBeenCalled();
  });
});

describe("OpenRouter dynamic catalog transport guard", () => {
  it("keeps its non-throwing contract and does not fetch when disabled", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    enableGuard();

    await expect(refreshDynamicCatalog("fixture-key")).resolves.toBeUndefined();
    expect(fetchMock).not.toHaveBeenCalled();
  });
});