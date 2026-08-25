/**
 * Groq provider strategy.
 *
 * Wraps `completeRaw` (non-streaming, tool-capable) and `completeStream`
 * (SSE generator) from groq-client.ts behind the `ProviderStrategy` interface.
 * Groq supports native SSE streaming.
 */
import { completeRaw, completeStream } from "../groq-client.js";
import type { RawMessage } from "../groq-client.js";
import type {
  ProviderStrategy,
  StrategyCallOptions,
  StrategyStreamOptions,
} from "../provider-strategy.js";

export const groqStrategy: ProviderStrategy = {
  providerId: "groq",
  supportsNativeStream: true,

  call(messages: RawMessage[], opts: StrategyCallOptions) {
    return completeRaw(messages, opts);
  },

  stream(messages: RawMessage[], opts: StrategyStreamOptions): AsyncGenerator<string> {
    return completeStream(messages, opts);
  },
};
