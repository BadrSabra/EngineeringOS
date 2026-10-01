import { afterEach, describe, expect, it, vi } from "vitest";
import { deepseekCompleteRaw } from "../deepseek-client.js";
import { MAX_PROVIDER_RESPONSE_BYTES } from "../provider-response-limits.js";

afterEach(() => {
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
});