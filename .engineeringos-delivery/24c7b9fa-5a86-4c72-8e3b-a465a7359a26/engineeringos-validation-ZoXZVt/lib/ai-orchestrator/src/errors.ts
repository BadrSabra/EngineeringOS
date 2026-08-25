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
 *   MODEL_NOT_FOUND    404: model permanently discontinued.
 *   PLAN_RESTRICTED    402: model requires paid tier / free-tier restriction.
 *   MODEL_UNAVAILABLE  422/410: model temporarily offline or being retired.
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
  | "QUOTA"             // billing quota / credits exhausted (PR-008)
  | "SERVER_ERROR"
  | "NON_200"
  // model availability — distinct from each other (PR-004 / PR-008)
  | "MODEL_NOT_FOUND"     // 404 — model permanently discontinued
  | "PLAN_RESTRICTED"     // 402 — model requires paid plan / free-tier restriction
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
  /** Bounded provider retry hint, in milliseconds, when supplied by HTTP. */
  retryAfterMs?: number;
  /** Every provider-owned fallback model attempted before this error surfaced. */
  providerAttemptedModels?: string[];
  /** Safe OpenRouter catalog diagnostics for model-resolution failures. */
  catalogLoaded?: boolean;
  catalogUsable?: boolean;
  catalogStatus?: "never" | "success" | "failed" | "empty";
  catalogError?: string;
};

/**
 * Provider SDKs and HTTP clients sometimes include credentials in otherwise
 * useful transport errors (for example, a URL query string or an echoed
 * Authorization header). Keep the internal error available for server logs,
 * but make every message/context serialization safe for user-facing output.
 */
export function redactProviderErrorText(value: string): string {
  return value
    .replace(/((?:authorization|x-api-key|api[_-]?key|access[_-]?token|token|key)\s*[=:]\s*)([^\s,;)"']+)/gi, "$1[redacted]")
    .replace(/(Bearer\s+)([A-Za-z0-9._~+/=-]+)/gi, "$1[redacted]")
    .replace(/\bsk-or-v1-[A-Za-z0-9_-]+\b/gi, "[redacted]")
    .replace(/\bAIza[A-Za-z0-9_-]{20,}\b/g, "[redacted]");
}

function redactProviderContext(context: ProviderErrorContext): ProviderErrorContext {
  return {
    ...context,
    providerCode: context.providerCode ? redactProviderErrorText(context.providerCode) : context.providerCode,
    providerMessage: context.providerMessage ? redactProviderErrorText(context.providerMessage) : context.providerMessage,
    providerName: context.providerName ? redactProviderErrorText(context.providerName) : context.providerName,
    providerModel: context.providerModel ? redactProviderErrorText(context.providerModel) : context.providerModel,
    providerAttemptedModels: context.providerAttemptedModels?.map(redactProviderErrorText),
    catalogLoaded: context.catalogLoaded,
    catalogUsable: context.catalogUsable,
    catalogStatus: context.catalogStatus,
    catalogError: context.catalogError ? redactProviderErrorText(context.catalogError) : context.catalogError,
  };
}

export class GroqClientError extends Error {
  readonly code: GroqErrorCode;

  // PR-007: structured provider context preserved all the way to the caller
  readonly providerStatus?: number;
  readonly providerCode?: string;
  readonly providerMessage?: string;
  readonly providerName?: string;
  readonly providerModel?: string;
  readonly retryAfterMs?: number;
  readonly providerAttemptedModels?: string[];
  readonly catalogLoaded?: boolean;
  readonly catalogUsable?: boolean;
  readonly catalogStatus?: ProviderErrorContext["catalogStatus"];
  readonly catalogError?: string;

  constructor(
    code: GroqErrorCode,
    message: string,
    options?: { cause?: unknown; context?: ProviderErrorContext },
  ) {
    super(redactProviderErrorText(message), { cause: options?.cause });
    this.name = "GroqClientError";
    this.code = code;
    if (options?.context) {
      this.providerStatus  = options.context.providerStatus;
      this.providerCode    = options.context.providerCode;
      this.providerMessage = options.context.providerMessage;
      this.providerName    = options.context.providerName;
      this.providerModel   = options.context.providerModel;
      this.retryAfterMs    = options.context.retryAfterMs;
      this.providerAttemptedModels = options.context.providerAttemptedModels;
      this.catalogLoaded = options.context.catalogLoaded;
      this.catalogUsable = options.context.catalogUsable;
      this.catalogStatus = options.context.catalogStatus;
      this.catalogError = options.context.catalogError;
    }
  }

  /** PR-007: serialise to a plain object suitable for SSE / JSON responses. */
  toProviderContext(): ProviderErrorContext {
    return redactProviderContext({
      providerStatus:  this.providerStatus,
      providerCode:    this.providerCode,
      providerMessage: this.providerMessage,
      providerName:    this.providerName,
      providerModel:   this.providerModel,
      retryAfterMs:    this.retryAfterMs,
      providerAttemptedModels: this.providerAttemptedModels,
    });
  }
}
