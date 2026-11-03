import { GroqClientError } from "@workspace/ai-orchestrator";

const SAFE_RATE_LIMIT_SCOPES = new Set([
  "upstream_shared_pool",
  "provider_credential",
  "account_quota",
  "unknown",
]);

/**
 * Project provider failures to bounded operational metadata. Never return the
 * error message, providerMessage, response body, cause, or stack.
 */
export function safeProviderFailureLogFields(error: unknown): Record<string, unknown> {
  if (!(error instanceof GroqClientError)) {
    return { errorKind: "unexpected" };
  }

  const retryAfterMs = typeof error.retryAfterMs === "number"
    && Number.isSafeInteger(error.retryAfterMs)
    && error.retryAfterMs > 0
    ? error.retryAfterMs
    : undefined;
  const rateLimitScope = typeof error.rateLimitScope === "string"
    && SAFE_RATE_LIMIT_SCOPES.has(error.rateLimitScope)
    ? error.rateLimitScope
    : undefined;

  return {
    errorKind: "provider",
    code: /^[A-Z][A-Z0-9_]{2,79}$/.test(error.code) ? error.code : "AI_PROVIDER_FAILURE",
    ...(typeof error.providerStatus === "number" && Number.isInteger(error.providerStatus)
      ? { providerStatus: error.providerStatus }
      : {}),
    ...(rateLimitScope ? { rateLimitScope } : {}),
    ...(retryAfterMs ? { retryAfterMs } : {}),
  };
}
