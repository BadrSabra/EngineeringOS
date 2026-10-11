import { describe, expect, it } from "vitest";
import { PROVIDER_PRIORITY } from "../provider-registry.js";
import { resolveFallbackChain } from "../openrouter/model-resolver.js";

describe("free-only AI provider policy", () => {
  it("never selects a provider outside OpenRouter", () => {
    expect(PROVIDER_PRIORITY).toEqual(["openrouter"]);
  });

  it("builds model fallback chains from the free catalog only", () => {
    const chain = resolveFallbackChain({
      capability: "chat",
      quality: "powerful",
    });

    expect(chain.length).toBeGreaterThan(0);
    expect(chain.every((model) => model.free)).toBe(true);
  });
});
