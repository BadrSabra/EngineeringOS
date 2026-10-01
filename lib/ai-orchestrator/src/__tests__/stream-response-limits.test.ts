import { afterEach, describe, expect, it, vi } from "vitest";
import { deepseekCompleteStream } from "../deepseek-client.js";
import { oacCompleteStream } from "../openai-compatible-client.js";
import { MAX_PROVIDER_RESPONSE_BYTES } from "../provider-response-limits.js";

afterEach(() => {
  vi.unstubAllGlobals();
});

function oversizedStreamResponse(): Response {
  return new Response("data: [DONE]\n\n", {
    status: 200,
    headers: {
      "content-length": String(MAX_PROVIDER_RESPONSE_BYTES + 1),
      "content-type": "text/event-stream",
    },
  });
}

describe("provider SSE response limits", () => {
  it("maps an oversized DeepSeek stream to INVALID_PROVIDER_RESPONSE", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => oversizedStreamResponse()));
    const stream = deepseekCompleteStream(
      [{ role: "user", content: "hello" }],
      { apiKey: "fixture-key" },
    );

    await expect(stream.next()).rejects.toMatchObject({
      code: "INVALID_PROVIDER_RESPONSE",
      providerName: "DeepSeek",
      providerCode: "RESPONSE_TOO_LARGE",
    });
  });

  it("maps an oversized OpenAI-compatible stream to INVALID_PROVIDER_RESPONSE", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => oversizedStreamResponse()));
    const stream = oacCompleteStream(
      [{ role: "user", content: "hello" }],
      {
        apiKey: "fixture-key",
        baseUrl: "https://provider.invalid/v1",
        providerName: "Fixture",
        model: "fixture-model",
      },
    );

    await expect(stream.next()).rejects.toMatchObject({
      code: "INVALID_PROVIDER_RESPONSE",
      providerName: "Fixture",
      providerModel: "fixture-model",
      providerCode: "RESPONSE_TOO_LARGE",
    });
  });

  it.each([
    {
      providerName: "DeepSeek",
      start: (signal: AbortSignal) => deepseekCompleteStream(
        [{ role: "user", content: "hello" }],
        { apiKey: "fixture-key", signal, timeoutMs: 5_000 },
      ),
    },
    {
      providerName: "OpenAI-compatible",
      start: (signal: AbortSignal) => oacCompleteStream(
        [{ role: "user", content: "hello" }],
        {
          apiKey: "fixture-key",
          baseUrl: "https://provider.invalid/v1",
          providerName: "Fixture",
          model: "fixture-model",
          signal,
          timeoutMs: 5_000,
        },
      ),
    },
  ])("preserves caller cancellation for $providerName streams", async ({ start }) => {
    const caller = new AbortController();
    let transportSignal: AbortSignal | undefined;
    vi.stubGlobal("fetch", vi.fn(async (_url: string | URL, init?: RequestInit) => {
      transportSignal = init?.signal as AbortSignal | undefined;
      return new Response(new ReadableStream<Uint8Array>({
        start(controller) {
          const abortStream = () => controller.error(new Error("Provider stream aborted"));
          if (transportSignal?.aborted) abortStream();
          else transportSignal?.addEventListener("abort", abortStream, { once: true });
        },
      }));
    }));

    const pending = start(caller.signal).next();
    await vi.waitFor(() => expect(transportSignal).toBeDefined());
    caller.abort();

    await expect(pending).rejects.toMatchObject({ code: "TIMEOUT" });
  });

  it.each([
    {
      providerName: "DeepSeek",
      start: () => deepseekCompleteStream(
        [{ role: "user", content: "hello" }],
        { apiKey: "fixture-key" },
      ),
    },
    {
      providerName: "OpenAI-compatible",
      start: () => oacCompleteStream(
        [{ role: "user", content: "hello" }],
        {
          apiKey: "fixture-key",
          baseUrl: "https://provider.invalid/v1",
          providerName: "Fixture",
          model: "fixture-model",
        },
      ),
    },
  ])("continues parsing normal SSE from $providerName", async ({ start }) => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(
      'data: {"choices":[{"delta":{"content":"ok"}}]}\n\ndata: [DONE]\n\n',
      { headers: { "content-type": "text/event-stream" } },
    )));
    let result = "";
    for await (const text of start()) result += text;
    expect(result).toBe("ok");
  });
});