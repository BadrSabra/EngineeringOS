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
import type { ModelCapability } from "./openrouter/model-catalog.js";
import type { TaskType } from "./quality/task-profile.js";

export type { RawMessage, ToolDefinition, RawGroqResponse };

// ─── Option types ──────────────────────────────────────────────────────────────

/** Options for a non-streaming (tool-calling) completion call. */
export type StrategyCallOptions = {
  model?: string;
  /**
   * OpenRouter-only hints used when the caller intentionally wants the
   * provider to resolve a fresh live fallback chain instead of pinning a
   * single model. Other providers ignore these fields.
   */
  quality?: "fast" | "powerful";
  capability?: ModelCapability;
  /** Behavioral routing is currently scoped to task execution. */
  taskType?: TaskType;
  maxTokens?: number;
  timeoutMs?: number;
  /** Let bounded callers skip provider-level transient retries. */
  retryTransient?: boolean;
  /**
   * Cap the number of provider-owned fallback candidates for this call.
   * Used by bounded forensic Recovery; ordinary calls leave it unset.
   */
  maxFallbackModels?: number;
  /** Per-user API key. Required for all providers except Groq (which falls back to env). */
  apiKey?: string;
  /** Caller-owned cancellation signal for the active provider request. */
  signal?: AbortSignal;
  tools?: ToolDefinition[];
  /** Full authorized execution manifest used to validate stale per-iteration calls. */
  toolManifest?: ToolDefinition[];
  /**
   * Tool selection policy for agentic execution. `required` is used only for
   * an explicit repair-plan handoff that has concrete files to modify.
   */
  toolChoice?: "auto" | "required";
  responseFormat?: { type: "json_object" };
};

/** Options for a streaming (SSE) completion call. No tool support. */
export type StrategyStreamOptions = {
  model?: string;
  quality?: "fast" | "powerful";
  capability?: ModelCapability;
  taskType?: TaskType;
  retryTransient?: boolean;
  maxFallbackModels?: number;
  maxTokens?: number;
  timeoutMs?: number;
  apiKey?: string;
  /** Caller-owned cancellation signal for the active provider stream. */
  signal?: AbortSignal;
};

// ─── Interface ────────────────────────────────────────────────────────────────

export interface ProviderStrategy {
  /**
   * Identifier matching the ProviderId literal — used for log attribution.
   * Typed as `string` to keep provider-strategy.ts free of circular imports.
   */
  readonly providerId: string;

  /**
   * When true, the strategy owns model fallback for a call. The agent must not
   * layer a second fallback chain on top of it.
   */
  readonly ownsModelFallback?: boolean;

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
