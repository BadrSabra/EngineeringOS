import { afterEach, describe, expect, it, vi } from "vitest";
import {
  deepseekCompleteRaw,
  deepseekCompleteStream,
  validateDeepSeekDefaultModels,
} from "../deepseek-client.js";
import { createExecutionLedger } from "../execution-ledger.js";
import { MAX_PROVIDER_RESPONSE_BYTES } from "../provider-response-limits.js";

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("DeepSeek response limits", () => {
  it("rejects an oversized completion before parsing its JSON body", async () => {
    const fetchMock = vi.fn(async () => new Response("{}", {
      status: 200,
      headers: { "content-length": String(MAX_PROVIDER_RESPONSE_BYTES + 1) },
    }));
    vi.stubGlobal("fetch", fetchMock);

    await expect(deepseekCompleteRaw(
      [{ role: "user", content: "hi" }],
      { apiKey: "fixture-key", timeoutMs: 5_000 },
    )).rejects.toMatchObject({
      code: "INVALID_PROVIDER_RESPONSE",
      providerName: "DeepSeek",
      providerCode: "RESPONSE_TOO_LARGE",
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("keeps the reservation attached until response validation finishes", async () => {
    const requestOrder: string[] = [];
    const reserve = vi.fn(async () => {
      requestOrder.push("reserve");
      return "deepseek-request:1";
    });
    const reconcile = vi.fn(async () => {
      requestOrder.push("reconcile");
    });
    const ledger = createExecutionLedger({
      providerRequestBudget: {
        reserve,
        reconcile,
      },
    });
    const fetchMock = vi.fn(async () => {
      requestOrder.push("fetch");
      return new Response(JSON.stringify({
        choices: [],
        model: "deepseek-chat",
      }), { status: 200 });
    });
    vi.stubGlobal("fetch", fetchMock);

    await expect(deepseekCompleteRaw(
      [{ role: "user", content: "hi" }],
      { apiKey: "fixture-key", timeoutMs: 5_000, executionLedger: ledger },
    )).rejects.toMatchObject({ code: "EMPTY_RESPONSE" });

    expect(reconcile).toHaveBeenCalledWith(expect.objectContaining({
      reservationId: "deepseek-request:1",
      status: "failed",
    }));
    expect(requestOrder).toEqual(["reserve", "fetch", "reconcile"]);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(ledger.snapshot().events).toContainEqual(expect.objectContaining({
      kind: "provider_attempt",
      status: "failed",
      reservationId: "deepseek-request:1",
    }));
  });

  it("forwards valid response usage to the completed request event", async () => {
    const reconcile = vi.fn(async () => undefined);
    const ledger = createExecutionLedger({
      providerRequestBudget: {
        reserve: async () => "deepseek-request:usage",
        reconcile,
      },
    });
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({
      choices: [{ message: { content: "answer" } }],
      model: "deepseek-chat",
      usage: { prompt_tokens: 13, completion_tokens: 5 },
    }), { status: 200 })));

    await deepseekCompleteRaw(
      [{ role: "user", content: "hi" }],
      { apiKey: "fixture-key", timeoutMs: 5_000, executionLedger: ledger },
    );

    expect(reconcile).toHaveBeenCalledWith(expect.objectContaining({
      reservationId: "deepseek-request:usage",
      status: "completed",
      usage: { promptTokens: 13, completionTokens: 5, usageStatus: "known" },
    }));
    expect(ledger.snapshot().events).toContainEqual(expect.objectContaining({
      kind: "provider_attempt",
      status: "completed",
      reservationId: "deepseek-request:usage",
      usage: { promptTokens: 13, completionTokens: 5, usageStatus: "known" },
    }));
  });

  it("aborts a stalled completion when timeoutMs elapses", async () => {
    vi.useFakeTimers();
    let requestSignal: AbortSignal | null | undefined;
    const fetchMock = vi.fn((_input: RequestInfo | URL, init?: RequestInit) =>
      new Promise<Response>((_resolve, reject) => {
        requestSignal = init?.signal;
        requestSignal?.addEventListener(
          "abort",
          () => reject(new DOMException("The request was aborted", "AbortError")),
          { once: true },
        );
      }),
    );
    vi.stubGlobal("fetch", fetchMock);
    const pending = deepseekCompleteRaw(
      [{ role: "user", content: "hi" }],
      { apiKey: "fixture-key", timeoutMs: 25 },
    );

    await vi.advanceTimersByTimeAsync(25);
    await expect(pending).rejects.toMatchObject({ code: "TIMEOUT" });
    expect(requestSignal?.aborted).toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });


  it("aborts a stalled stream when timeoutMs elapses", async () => {
    vi.useFakeTimers();
    let requestSignal: AbortSignal | null | undefined;
    const fetchMock = vi.fn((_input: RequestInfo | URL, init?: RequestInit) =>
      new Promise<Response>((_resolve, reject) => {
        requestSignal = init?.signal;
        requestSignal?.addEventListener(
          "abort",
          () => reject(new DOMException("The stream was aborted", "AbortError")),
          { once: true },
        );
      }),
    );
    vi.stubGlobal("fetch", fetchMock);
    const pending = (async () => {
      for await (const chunk of deepseekCompleteStream(
        [{ role: "user", content: "hi" }],
        { apiKey: "fixture-key", timeoutMs: 25 },
      )) {
        expect(chunk).toBeDefined();
      }
    })();

    await vi.advanceTimersByTimeAsync(25);
    await expect(pending).rejects.toMatchObject({ code: "TIMEOUT" });
    expect(requestSignal?.aborted).toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });


  it("aborts a stalled model-catalog probe at its configured timeout", async () => {
    vi.useFakeTimers();
    let requestSignal: AbortSignal | null | undefined;
    const fetchMock = vi.fn((_input: RequestInfo | URL, init?: RequestInit) =>
      new Promise<Response>((_resolve, reject) => {
        requestSignal = init?.signal;
        requestSignal?.addEventListener(
          "abort",
          () => reject(new DOMException("The catalog request was aborted", "AbortError")),
          { once: true },
        );
      }),
    );
    vi.stubGlobal("fetch", fetchMock);
    const pending = validateDeepSeekDefaultModels(
      "fixture-key",
      { fast: "deepseek-chat", powerful: "deepseek-chat" },
      25,
    );

    await vi.advanceTimersByTimeAsync(25);
    await expect(pending).rejects.toMatchObject({ code: "TIMEOUT" });
    expect(requestSignal?.aborted).toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

});