/**
 * ProviderStrategy — the contract every AI provider must satisfy.
 *
 * Each provider wraps its specific client(s) behind this interface so
 * `chat()` (and any other agent) never imports client code directly.
 * Adding a new provider requires only:
 *   1. A new strategy file in `strategies/`.
 *   2. An entry in the `STRATEGY_MAP` in `provider-registry.ts`.
 *   3. A new entry in `PROVIDER_REGISTRY` and `PROVIDER_PRIORITY`.
 *
 * Nothing inside `chat()` changes.
 */
import type { RawMessage, ToolDefinition, RawGroqResponse } from "./groq-client.js";

export type { RawMessage, ToolDefinition, RawGroqResponse };

// ─── Option types ──────────────────────────────────────────────────────────────

/** Options for a non-streaming (tool-calling) completion call. */
export type StrategyCallOptions = {
  model?: string;
  maxTokens?: number;
  timeoutMs?: number;
  /** Per-user API key. Required for all providers except Groq (which falls back to env). */
  apiKey?: string;
  tools?: ToolDefinition[];
  responseFormat?: { type: "json_object" };
};

/** Options for a streaming (SSE) completion call. No tool support. */
export type StrategyStreamOptions = {
  model?: string;
  maxTokens?: number;
  timeoutMs?: number;
  apiKey?: string;
};

// ─── Interface ────────────────────────────────────────────────────────────────

export interface ProviderStrategy {
  /**
   * Identifier matching the ProviderId literal — used for log attribution.
   * Typed as `string` to keep provider-strategy.ts free of circular imports.
   */
  readonly providerId: string;

  /** Non-streaming chat completion. Supports tool calls. */
  call(messages: RawMessage[], opts: StrategyCallOptions): Promise<RawGroqResponse>;

  /**
   * Streaming chat completion — yields raw content delta strings.
   * Only used for the final synthesis step (no tools in the request).
   */
  stream(messages: RawMessage[], opts: StrategyStreamOptions): AsyncGenerator<string>;

  /**
   * `true`  — provider supports native SSE streaming (Groq, DeepSeek).
   *           The agent makes a fresh streaming call for the final response.
   * `false` — provider does not support reliable SSE streaming (OpenRouter, Gemini).
   *           The agent re-emits the already-received content word-by-word.
   */
  readonly supportsNativeStream: boolean;
}
