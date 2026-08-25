/**
 * Gemini provider strategy.
 *
 * Wraps `geminiCompleteRaw` and `geminiCompleteStream` from
 * openai-compatible-client.ts behind the `ProviderStrategy` interface.
 *
 * `supportsNativeStream: false` — the Gemini shim strips tools and
 * responseFormat, and the free-tier endpoint is not reliable for SSE.
 * The agent re-emits the non-streaming response word-by-word.
 *
 * Tool payloads are stripped inside `geminiCompleteRaw` (the Gemini
 * OpenAI-compatible shim currently returns 404 with tools attached).
 */
import {
  geminiCompleteRaw,
  geminiCompleteStream,
} from "../openai-compatible-client.js";
import { GroqClientError } from "../errors.js";
import type { RawMessage } from "../groq-client.js";
import type {
  ProviderStrategy,
  StrategyCallOptions,
  StrategyStreamOptions,
} from "../provider-strategy.js";

export const geminiStrategy: ProviderStrategy = {
  providerId: "gemini",
  supportsNativeStream: false,

  call(messages: RawMessage[], opts: StrategyCallOptions) {
    if (!opts.apiKey) {
      throw new GroqClientError(
        "INVALID_CONFIG",
        "Gemini requires an API key — save one in the AI settings panel",
      );
    }
    // geminiCompleteRaw already strips tools and responseFormat internally.
    return geminiCompleteRaw(messages, { ...opts, apiKey: opts.apiKey });
  },

  stream(messages: RawMessage[], opts: StrategyStreamOptions): AsyncGenerator<string> {
    if (!opts.apiKey) {
      throw new GroqClientError(
        "INVALID_CONFIG",
        "Gemini requires an API key — save one in the AI settings panel",
      );
    }
    return geminiCompleteStream(messages, { ...opts, apiKey: opts.apiKey });
  },
};
