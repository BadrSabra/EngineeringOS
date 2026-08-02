/**
 * OpenRouter provider strategy.
 *
 * Wraps `openrouterCompleteRaw` and `openrouterCompleteStream` from
 * openai-compatible-client.ts behind the `ProviderStrategy` interface.
 *
 * `supportsNativeStream: false` — OpenRouter free-tier models often
 * include the final answer in the non-streaming tool-loop response, so the
 * agent re-emits that content word-by-word instead of making a second SSE
 * call (which is slow and unreliable on free tiers).
 */
import {
  openrouterCompleteRaw,
  openrouterCompleteStream,
} from "../openai-compatible-client.js";
import { GroqClientError } from "../errors.js";
import type { RawMessage } from "../groq-client.js";
import type {
  ProviderStrategy,
  StrategyCallOptions,
  StrategyStreamOptions,
} from "../provider-strategy.js";

export const openrouterStrategy: ProviderStrategy = {
  providerId: "openrouter",
  supportsNativeStream: false,

  call(messages: RawMessage[], opts: StrategyCallOptions) {
    if (!opts.apiKey) {
      throw new GroqClientError(
        "INVALID_CONFIG",
        "OpenRouter requires an API key — save one in the AI settings panel",
      );
    }
    return openrouterCompleteRaw(messages, { ...opts, apiKey: opts.apiKey });
  },

  stream(messages: RawMessage[], opts: StrategyStreamOptions): AsyncGenerator<string> {
    if (!opts.apiKey) {
      throw new GroqClientError(
        "INVALID_CONFIG",
        "OpenRouter requires an API key — save one in the AI settings panel",
      );
    }
    return openrouterCompleteStream(messages, { ...opts, apiKey: opts.apiKey });
  },
};
