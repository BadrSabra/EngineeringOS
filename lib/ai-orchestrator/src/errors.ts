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
 *   TIMEOUT           AbortController fired before the model responded.
 *   NETWORK_ERROR     Transport-level failure: DNS, ECONNRESET, no HTTP status.
 *
 * HTTP — classified from the numeric status code
 *   AUTH_ERROR        401 or 403: API key missing, invalid, or lacks permission.
 *   RATE_LIMITED      429: per-minute quota exhausted; retryable after back-off.
 *   QUOTA             402/429-credits: billing quota / credits exhausted.
 *   SERVER_ERROR      5xx: provider infrastructure failure; retryable.
 *   NON_200           Any other non-200 status (e.g. 400 bad request).
 *
 * Model availability
 *   MODEL_NOT_FOUND   404/402: model permanently discontinued or requires payment.
 *   MODEL_UNAVAILABLE 422/410: model temporarily offline or being retired.
 *
 * Response
 *   EMPTY_RESPONSE    Response received but contained no content or tool calls.
 *
 * Configuration
 *   INVALID_CONFIG    GROQ_API_KEY is absent or empty at startup.
 */

export type AgentErrorCode = "EMPTY_MODEL_RESPONSE" | "MALFORMED_JSON" | "SCHEMA_VALIDATION_FAILED";

export type GroqErrorCode =
  // transport
  | "TIMEOUT"
  | "NETWORK_ERROR"
  // HTTP — split by semantics
  | "AUTH_ERROR"
  | "RATE_LIMITED"
  | "QUOTA"           // billing quota / credits exhausted (PR-008)
  | "SERVER_ERROR"
  | "NON_200"
  // model availability — distinct from each other (PR-008)
  | "MODEL_NOT_FOUND"     // 404/402 — model discontinued or requires payment
  | "MODEL_UNAVAILABLE"   // 422/410 — model temporarily offline (PR-008)
  // response
  | "EMPTY_RESPONSE"
  // configuration
  | "INVALID_CONFIG";

/** PR-007: structured fields carried alongside the error message. */
export type ProviderErrorContext = {
  /** Raw HTTP status code from the provider. */
  providerStatus?: number;
  /** Provider-specific error code extracted from the response body. */
  providerCode?: string;
  /** Provider-specific error message extracted from the response body. */
  providerMessage?: string;
  /** Provider name (e.g. "OpenRouter", "Groq"). */
  providerName?: string;
  /** Model slug that was attempted when the error occurred. */
  providerModel?: string;
};

export class GroqClientError extends Error {
  readonly code: GroqErrorCode;

  // PR-007: structured provider context preserved all the way to the caller
  readonly providerStatus?: number;
  readonly providerCode?: string;
  readonly providerMessage?: string;
  readonly providerName?: string;
  readonly providerModel?: string;

  constructor(
    code: GroqErrorCode,
    message: string,
    options?: { cause?: unknown; context?: ProviderErrorContext },
  ) {
    super(message, { cause: options?.cause });
    this.name = "GroqClientError";
    this.code = code;
    if (options?.context) {
      this.providerStatus  = options.context.providerStatus;
      this.providerCode    = options.context.providerCode;
      this.providerMessage = options.context.providerMessage;
      this.providerName    = options.context.providerName;
      this.providerModel   = options.context.providerModel;
    }
  }

  /** PR-007: serialise to a plain object suitable for SSE / JSON responses. */
  toProviderContext(): ProviderErrorContext {
    return {
      providerStatus:  this.providerStatus,
      providerCode:    this.providerCode,
      providerMessage: this.providerMessage,
      providerName:    this.providerName,
      providerModel:   this.providerModel,
    };
  }
}
