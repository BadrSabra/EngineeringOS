import { describe, expect, it } from "vitest";
import { GroqClientError } from "../errors.js";
import {
  createBoundedProviderFetch,
  MAX_PROVIDER_ERROR_BODY_BYTES,
  isProviderResponseTooLargeError,
  ProviderResponseTooLargeError,
  readBoundedProviderResponseJson,
  readBoundedProviderResponseText,
} from "../provider-response-limits.js";

function chunkedResponse(chunks: string[]): Response {
  const encoder = new TextEncoder();
  return new Response(new ReadableStream<Uint8Array>({
    start(controller) {
      for (const chunk of chunks) controller.enqueue(encoder.encode(chunk));
      controller.close();
    },
  }));
}

describe("provider response byte limits", () => {
  it("rejects an oversized chunked JSON body without Content-Length before JSON parsing", async () => {
    const response = chunkedResponse(['{"value":"1234', '567890"}']);
    await expect(
      readBoundedProviderResponseJson(response, {
        providerName: "fixture-provider",
        model: "fixture-model",
      }, 8),
    ).rejects.toMatchObject({
      code: "INVALID_PROVIDER_RESPONSE",
      providerName: "fixture-provider",
      providerModel: "fixture-model",
      providerCode: "RESPONSE_TOO_LARGE",
    });
  });

  it("accepts a valid response within the byte cap", async () => {
    const response = chunkedResponse(['{"value":', "42}"]);
    await expect(
      readBoundedProviderResponseJson<{ value: number }>(
        response,
        { providerName: "fixture-provider", model: "fixture-model" },
        32,
      ),
    ).resolves.toEqual({ value: 42 });
  });

  it("cancels response bodies rejected by their declared Content-Length", async () => {
    let readerBodyCancelled = false;
    const readerResponse = new Response(new ReadableStream<Uint8Array>({
      cancel() {
        readerBodyCancelled = true;
      },
    }), { headers: { "content-length": "100" } });
    await expect(readBoundedProviderResponseText(readerResponse, 10))
      .rejects.toBeInstanceOf(ProviderResponseTooLargeError);
    expect(readerBodyCancelled).toBe(true);

    let fetchBodyCancelled = false;
    const boundedFetch = createBoundedProviderFetch(async () => new Response(
      new ReadableStream<Uint8Array>({
        cancel() {
          fetchBodyCancelled = true;
        },
      }),
      { headers: { "content-length": "100" } },
    ), 10);
    await expect(boundedFetch("https://provider.invalid/"))
      .rejects.toBeInstanceOf(ProviderResponseTooLargeError);
    expect(fetchBodyCancelled).toBe(true);
  });

  it("bounds SDK fetch responses as they stream and preserves the size signal through causes", async () => {
    const boundedFetch = createBoundedProviderFetch(
      async () => chunkedResponse(["1234", "5678"]),
      6,
    );
    const response = await boundedFetch("https://provider.invalid/");
    await expect(response.text()).rejects.toBeInstanceOf(ProviderResponseTooLargeError);
    expect(isProviderResponseTooLargeError(
      new Error("SDK wrapper", { cause: new ProviderResponseTooLargeError(6) }),
    )).toBe(true);
    expect(isProviderResponseTooLargeError(new GroqClientError(
      "NETWORK_ERROR",
      "ordinary network failure",
    ))).toBe(false);
  });

  it("applies the smaller error-body cap to SDK responses", async () => {
    const oversizedErrorBody = chunkedResponse([
      "x".repeat(32_000),
      "x".repeat(32_000),
      "x".repeat(1),
    ]);
    const baseFetch: typeof fetch = async () => new Response(oversizedErrorBody.body, {
      status: 429,
    });
    const boundedFetch = createBoundedProviderFetch(baseFetch);
    const response = await boundedFetch("https://provider.invalid/");

    await expect(response.text()).rejects.toMatchObject({
      name: "ProviderResponseTooLargeError",
      maxBytes: MAX_PROVIDER_ERROR_BODY_BYTES,
    });
  });
});