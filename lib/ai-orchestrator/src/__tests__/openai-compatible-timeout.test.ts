import { afterEach, describe, expect, it, vi } from "vitest";
import { oacCompleteRaw } from "../openai-compatible-client.js";

const requestOptions = {
  apiKey: "fixture-key",
  model: "fixture-model",
  baseUrl: "https://provider.example/v1",
  providerName: "Fixture",
  maxTokens: 1,
  timeoutMs: 25,
} as const;

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("OpenAI-compatible non-stream request deadline", () => {
  it("aborts a provider request that never returns response headers", async () => {
    let requestSignal: AbortSignal | null | undefined;
    const fetchMock = vi.fn(async (_input: string | URL | Request, init?: RequestInit) => {
      requestSignal = init?.signal;
      return await new Promise<Response>((_resolve, reject) => {
        const signal = init?.signal;
        if (!signal) {
          reject(new Error("missing request abort signal"));
          return;
        }
        const abort = () => reject(new DOMException("The request was aborted", "AbortError"));
        if (signal.aborted) abort();
        else signal.addEventListener("abort", abort, { once: true });
      });
    });
    vi.stubGlobal("fetch", fetchMock);

    await expect(oacCompleteRaw(
      [{ role: "user", content: "hello" }],
      requestOptions,
    )).rejects.toMatchObject({
      code: "TIMEOUT",
      providerModel: "fixture-model",
    });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(requestSignal?.aborted).toBe(true);
  });

  it("preserves TIMEOUT when a non-2xx response body stalls after headers", async () => {
    let requestSignal: AbortSignal | null | undefined;
    const fetchMock = vi.fn(async (_input: string | URL | Request, init?: RequestInit) => {
      requestSignal = init?.signal;
      const signal = init?.signal;
      const body = new ReadableStream<Uint8Array>({
        start(controller) {
          if (!signal) {
            controller.error(new Error("missing request abort signal"));
            return;
          }
          const abort = () => controller.error(
            new DOMException("The response body was aborted", "AbortError"),
          );
          if (signal.aborted) abort();
          else signal.addEventListener("abort", abort, { once: true });
        },
      });
      return new Response(body, { status: 503 });
    });
    vi.stubGlobal("fetch", fetchMock);

    await expect(oacCompleteRaw(
      [{ role: "user", content: "hello" }],
      requestOptions,
    )).rejects.toMatchObject({
      code: "TIMEOUT",
      providerModel: "fixture-model",
    });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(requestSignal?.aborted).toBe(true);
  });
});
