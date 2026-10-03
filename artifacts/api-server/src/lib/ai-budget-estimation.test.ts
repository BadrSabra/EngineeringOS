import { describe, expect, it } from "vitest";
import { Buffer } from "node:buffer";
import {
  AI_BUDGET_PROVIDER_RESERVATION_TOKENS,
  estimateAiProviderReservationTokens,
} from "./ai-budget.js";

describe("AI provider reservation estimates", () => {
  it("includes serialized request bytes above the conservative baseline", () => {
    const payload = { message: "hi" };
    expect(estimateAiProviderReservationTokens(payload)).toBe(
      AI_BUDGET_PROVIDER_RESERVATION_TOKENS
        + Buffer.byteLength(JSON.stringify(payload), "utf8"),
    );
  });

  it("scales with serialized UTF-8 request bytes and the completion reserve", () => {
    const payload = { prompt: "ع".repeat(5_000) };
    const expected = Math.max(
      AI_BUDGET_PROVIDER_RESERVATION_TOKENS,
      Buffer.byteLength(JSON.stringify(payload), "utf8") + 8_192,
    );
    expect(estimateAiProviderReservationTokens(payload)).toBe(expected);
    expect(expected).toBeGreaterThan(AI_BUDGET_PROVIDER_RESERVATION_TOKENS);
  });

  it("fails explicitly for invalid completion limits or non-serializable payloads", () => {
    expect(() => estimateAiProviderReservationTokens({ prompt: "hi" }, -1)).toThrow();
    expect(() => estimateAiProviderReservationTokens(undefined)).toThrow();
    expect(() => estimateAiProviderReservationTokens({ token: 1n })).toThrow();
  });

  it("reserves an explicit provider output-token limit", () => {
    const estimate = estimateAiProviderReservationTokens({
      messages: [{ role: "user", content: "hi" }],
      max_tokens: 24_000,
    });
    expect(estimate).toBeGreaterThan(24_000 + 4_096);
  });
});