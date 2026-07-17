/**
 * Unified error model for the ai-orchestrator package.
 *
 * Two families:
 *
 * AgentErrorCode — non-fatal issues turning a model response into a typed
 * result (parsing/validation). Agents never throw these; they log the code
 * and fall back to a safe default so a single bad LLM response cannot crash
 * a request. See `parsing.ts`.
 *
 *   EMPTY_MODEL_RESPONSE      Raw text from the model was empty.
 *   MALFORMED_JSON            Raw text could not be parsed as JSON.
 *   SCHEMA_VALIDATION_FAILED  Parsed JSON did not satisfy the Zod schema.
 *
 * GroqErrorCode — failures talking to the model provider. These DO throw,
 * because there is no safe per-agent fallback for "we could not reach the
 * model at all". Routes handle them as hard failures.
 *
 * Transport
 *   TIMEOUT        AbortController fired before the model responded.
 *   NETWORK_ERROR  Transport-level failure: DNS, ECONNRESET, no HTTP status.
 *
 * HTTP — classified from the numeric status code
 *   AUTH_ERROR     401 or 403: API key missing, invalid, or lacks permission.
 *   RATE_LIMITED   429: quota exhausted; retryable after back-off.
 *   SERVER_ERROR   5xx: Groq infrastructure failure; retryable.
 *   NON_200        Any other non-200 status (e.g. 400 bad request).
 *
 * Response
 *   EMPTY_RESPONSE Response received but contained no content or tool calls.
 *
 * Configuration
 *   INVALID_CONFIG GROQ_API_KEY is absent or empty at startup.
 */

export type AgentErrorCode = "EMPTY_MODEL_RESPONSE" | "MALFORMED_JSON" | "SCHEMA_VALIDATION_FAILED";

export type GroqErrorCode =
  // transport
  | "TIMEOUT"
  | "NETWORK_ERROR"
  // HTTP — split from the former NON_200 bucket
  | "AUTH_ERROR"
  | "RATE_LIMITED"
  | "SERVER_ERROR"
  | "NON_200"
  // response
  | "EMPTY_RESPONSE"
  // configuration
  | "INVALID_CONFIG";

export class GroqClientError extends Error {
  readonly code: GroqErrorCode;

  constructor(code: GroqErrorCode, message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = "GroqClientError";
    this.code = code;
  }
}
