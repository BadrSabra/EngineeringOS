/**
 * Gemini provider strategy.
 *
 * Wraps `geminiCompleteRaw` and `geminiCompleteStream` from
 * openai-compatible-client.ts behind the `ProviderStrategy` interface.
 *
 * `supportsNativeStream: false` — Gemini's native tool path is non-streaming
 * and the free-tier endpoint is not reliable for SSE.
 * The agent re-emits the non-streaming response word-by-word.
 *
 * Tool payloads are translated to Gemini's native generateContent function
 * calling API inside `geminiCompleteRaw`; no-tool calls retain the
 * OpenAI-compatible JSON-mode path.
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
