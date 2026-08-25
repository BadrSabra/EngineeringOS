/**
 * DeepSeek provider strategy.
 *
 * Wraps `deepseekCompleteRaw` and `deepseekCompleteStream` from
 * deepseek-client.ts behind the `ProviderStrategy` interface.
 * DeepSeek supports native SSE streaming for the final synthesis step.
 *
 * Both `call` and `stream` require a non-empty `apiKey` — DeepSeek has no
 * server-side env fallback (unlike Groq). A missing key throws
 * `GroqClientError("INVALID_CONFIG", ...)` before the network request.
 */
import { deepseekCompleteRaw, deepseekCompleteStream } from "../deepseek-client.js";
import { GroqClientError } from "../errors.js";
import type { RawMessage } from "../groq-client.js";
import type {
  ProviderStrategy,
  StrategyCallOptions,
  StrategyStreamOptions,
} from "../provider-strategy.js";

export const deepseekStrategy: ProviderStrategy = {
  providerId: "deepseek",
  supportsNativeStream: true,

  call(messages: RawMessage[], opts: StrategyCallOptions) {
    if (!opts.apiKey) {
      throw new GroqClientError(
        "INVALID_CONFIG",
        "DeepSeek requires an API key — save one in the AI settings panel",
      );
    }
    return deepseekCompleteRaw(messages, { ...opts, apiKey: opts.apiKey });
  },

  stream(messages: RawMessage[], opts: StrategyStreamOptions): AsyncGenerator<string> {
    if (!opts.apiKey) {
      throw new GroqClientError(
        "INVALID_CONFIG",
        "DeepSeek requires an API key — save one in the AI settings panel",
      );
    }
    return deepseekCompleteStream(messages, { ...opts, apiKey: opts.apiKey });
  },
};
