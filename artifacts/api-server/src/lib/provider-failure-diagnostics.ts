/**
 * Server-owned, user-safe classification for provider failures.
 *
 * Provider messages and payloads are evidence for server logs only. Public
 * callers receive one of these bounded categories, derived from typed fields.
 */
export const PROVIDER_FAILURE_CATEGORIES = [
  "TIMEOUT",
  "MODEL_REJECTED",
  "MODEL_UNAVAILABLE",
  "RATE_LIMITED",
  "FALLBACK_EXHAUSTED",
  "TRANSPORT_FAILURE",
  "MALFORMED_RESPONSE",
  "UNKNOWN",
] as const;

export type ProviderFailureCategory = (typeof PROVIDER_FAILURE_CATEGORIES)[number];

export type ProviderFailureClassificationInput = {
  code?: unknown;
  providerCode?: unknown;
  providerStatus?: unknown;
  cancelled?: boolean;
  fallbackExhausted?: boolean;
};

export function isProviderFailureCategory(value: unknown): value is ProviderFailureCategory {
  return typeof value === "string"
    && (PROVIDER_FAILURE_CATEGORIES as readonly string[]).includes(value);
}

/**
 * Classify only typed provider outcome fields. `undefined` means cancellation
 * is authoritative and the normal terminal CANCELLATION contract must win.
 */
export function classifyProviderFailure(
  input: ProviderFailureClassificationInput,
): ProviderFailureCategory | undefined {
  if (input.cancelled) return undefined;

  const code = typeof input.code === "string" ? input.code : "";
  const providerCode = typeof input.providerCode === "string"
    ? input.providerCode.toUpperCase()
    : "";
  const status = typeof input.providerStatus === "number" ? input.providerStatus : undefined;

  // Specific typed causes always beat the generic fallback outcome.
  if (code === "RATE_LIMITED" || status === 429 || providerCode === "RATE_LIMITED") {
    return "RATE_LIMITED";
  }
  if (
    code === "MODEL_UNAVAILABLE"
    || status === 410
    || status === 422
    || providerCode === "UNAVAILABLE"
    || providerCode === "SERVICE_UNAVAILABLE"
    || (status === 503 && providerCode === "MODEL_UNAVAILABLE")
  ) {
    return "MODEL_UNAVAILABLE";
  }
  if (
    code === "MODEL_NOT_FOUND"
    || code === "PLAN_RESTRICTED"
    || code === "AUTH_ERROR"
    || code === "QUOTA"
    || (code === "NON_200" && status !== undefined && status >= 400 && status < 500)
  ) {
    return "MODEL_REJECTED";
  }
  if (code === "TIMEOUT") return "TIMEOUT";
  if (code === "EMPTY_RESPONSE" || code === "INVALID_TOOL_CALL") {
    return "MALFORMED_RESPONSE";
  }
  if (code === "NETWORK_ERROR" || code === "SERVER_ERROR") {
    return "TRANSPORT_FAILURE";
  }
  if (input.fallbackExhausted || providerCode === "FALLBACK_EXHAUSTED") {
    return "FALLBACK_EXHAUSTED";
  }
  return "UNKNOWN";
}