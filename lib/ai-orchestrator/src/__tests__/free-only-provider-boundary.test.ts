import { afterEach, describe, expect, it, vi } from "vitest";
import { agentComplete, validateProviderKey } from "../agent-complete.js";
import {
  openrouterCompleteRaw,
  openrouterCompleteStream,
  openrouterCompleteWithFallback,
} from "../openai-compatible-client.js";
import { resolveExecutionDecision } from "../model-selection/decision-engine.js";
import { resolveExecutionProvider } from "../model-selection/provider-strategy.js";
import { selectCapabilityRecoveryCandidates } from "../agents/capability-recovery-provider-policy.js";
import {
  assertProductProviderEnabled,
  isProductProviderEnabled,
} from "../provider-registry.js";

const messages = [{ role: "user", content: "synthetic boundary test" }] as const;

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe("free-only provider inference boundary", () => {
  it("keeps automatic discovery on the single enabled product provider", () => {
    const plan = resolveExecutionDecision("chat-agent", {
      contextIntensityOverride: "normal",
    });

    const decision = resolveExecutionProvider(plan);

    expect(decision.providerId).toBe("openrouter");
    expect(decision.candidates).toEqual(["openrouter"]);
  });

  it.each(["groq", "gemini", "deepseek"] as const)(
    "keeps explicit %s selection outside the product route allowlist",
    (provider) => {
      const plan = resolveExecutionDecision("chat-agent");
      const fetchMock = vi.fn();
      vi.stubGlobal("fetch", fetchMock);

      expect(isProductProviderEnabled(provider)).toBe(false);
      expect(() => assertProductProviderEnabled(provider)).toThrow(
        expect.objectContaining({ providerCode: "FREE_ROUTE_NOT_VERIFIED" }),
      );
      expect(resolveExecutionProvider(plan, provider).providerId).toBe(provider);
      expect(fetchMock).not.toHaveBeenCalled();
    },
  );

  it("does not cross-provider fallback from OpenRouter when its credential is absent", () => {
    const candidates = selectCapabilityRecoveryCandidates(
      { provider: "openrouter", model: "liquid/lfm-2.5-2.6b:free" },
      [
        { provider: "groq", model: "llama-3.1-8b-instant" },
        { provider: "openrouter", model: "nvidia/nemotron-3.5-lightning:free" },
        { provider: "openrouter", model: "liquid/lfm-2.5-2.6b:free" },
      ],
    );

    expect(candidates).toEqual([
      { provider: "openrouter", model: "liquid/lfm-2.5-2.6b:free" },
      { provider: "openrouter", model: "nvidia/nemotron-3.5-lightning:free" },
    ]);
  });

  it.each(["groq", "gemini", "deepseek"] as const)(
    "refuses to probe or save an unverified %s credential",
    async (provider) => {
      const fetchMock = vi.fn();
      vi.stubGlobal("fetch", fetchMock);

      await expect(validateProviderKey(provider, "synthetic-test-credential"))
        .resolves.toEqual({
          valid: false,
          reason: "provider_not_enabled_for_free_route",
        });
      expect(fetchMock).not.toHaveBeenCalled();
    },
  );

  it.each(["groq", "gemini", "deepseek"] as const)(
    "rejects direct agentComplete inference through unverified %s before network",
    async (provider) => {
      const fetchMock = vi.fn();
      vi.stubGlobal("fetch", fetchMock);

      await expect(agentComplete(messages as any, {
        provider,
        apiKey: "synthetic-test-credential",
      })).rejects.toMatchObject({
        code: "INVALID_CONFIG",
        providerCode: "FREE_ROUTE_NOT_VERIFIED",
      });

      expect(fetchMock).not.toHaveBeenCalled();
    },
  );

  it("blocks paid and unknown model IDs at each OpenRouter inference entrypoint", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const options = {
      apiKey: "synthetic-test-credential",
      model: "fixture/not-in-the-free-catalog",
    };

    await expect(openrouterCompleteRaw(messages as any, options))
      .rejects.toMatchObject({
        code: "INVALID_CONFIG",
        providerCode: "FREE_MODEL_REQUIRED",
      });

    await expect(openrouterCompleteWithFallback(messages as any, options))
      .rejects.toMatchObject({
        code: "INVALID_CONFIG",
        providerCode: "FREE_MODEL_REQUIRED",
      });

    const stream = (async () => {
      for await (const _chunk of openrouterCompleteStream(messages as any, options)) {
        // No response is expected for a rejected model.
      }
    })();
    await expect(stream).rejects.toMatchObject({
      code: "INVALID_CONFIG",
      providerCode: "FREE_MODEL_REQUIRED",
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
