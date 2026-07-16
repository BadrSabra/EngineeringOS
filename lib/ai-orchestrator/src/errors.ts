/**
 * Unified error model for the ai-orchestrator package.
 *
 * Two families of errors:
 * - `AgentErrorCode` — non-fatal issues turning a model response into a typed
 *   result (parsing/validation). Agents never throw these; they log the code
 *   and fall back to a safe default so a single bad LLM response can't crash
 *   a request. See `parsing.ts`.
 * - `GroqClientError` — failures talking to the model provider itself
 *   (timeout, network, non-200, empty response, missing config). These DO
 *   throw, because there is no safe per-agent fallback for "we couldn't
 *   reach the model at all" — callers (routes) handle it as a hard failure.
 */

export type AgentErrorCode = "EMPTY_MODEL_RESPONSE" | "MALFORMED_JSON" | "SCHEMA_VALIDATION_FAILED";

export type GroqErrorCode = "TIMEOUT" | "NETWORK_ERROR" | "NON_200" | "EMPTY_RESPONSE" | "INVALID_CONFIG";

export class GroqClientError extends Error {
  readonly code: GroqErrorCode;

  constructor(code: GroqErrorCode, message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = "GroqClientError";
    this.code = code;
  }
}
