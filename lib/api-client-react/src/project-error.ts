/**
 * Project-loading error classification.
 *
 * Translates raw fetch errors (ApiError, TypeError, etc.) into a typed
 * { kind, message, status } record so every UI surface shows the root cause
 * instead of a generic "session may have expired" fallback.
 *
 * Kept in @workspace/api-client-react (alongside ApiError) so it can be
 * imported by any artifact — dashboard, mobile, or tests — without a
 * circular dependency.
 */

import { ApiError } from "./custom-fetch.js";

// ─── Types ────────────────────────────────────────────────────────────────────

export type ProjectErrorKind =
  | "session_expired"   // 401  — Clerk session missing or expired
  | "permission_denied" // 403  — authenticated but no access
  | "not_found"         // 404  — endpoint not registered / wrong URL
  | "server_error"      // 5xx  — API or DB fault
  | "network_error"     // fetch failed before a response arrived
  | "unknown";          // anything else (parse errors, unexpected status, …)

export interface ProjectLoadFailure {
  kind: ProjectErrorKind;
  /** Human-readable message safe to display directly in the UI. */
  message: string;
  /** HTTP status code, when available. */
  status?: number;
}

// ─── Classifier ───────────────────────────────────────────────────────────────

/**
 * Maps any thrown value from a `GET /api/projects` call into a
 * `ProjectLoadFailure` with a specific kind and display message.
 *
 * The caller is responsible for mapping each kind to the appropriate UX
 * (toast, inline banner, redirect to sign-in, etc.).
 */
export function classifyProjectError(error: unknown): ProjectLoadFailure {
  if (error instanceof ApiError) {
    switch (error.status) {
      case 401:
        return {
          kind: "session_expired",
          message: "Session expired. Please sign in again.",
          status: 401,
        };
      case 403:
        return {
          kind: "permission_denied",
          message: "You don't have permission to access these projects.",
          status: 403,
        };
      case 404:
        return {
          kind: "not_found",
          message: "Projects endpoint unavailable.",
          status: 404,
        };
      case 500:
      case 502:
      case 503:
      case 504:
        return {
          kind: "server_error",
          message: "Internal server error. Try refreshing the page.",
          status: error.status,
        };
      default:
        return {
          kind: "unknown",
          message: `Unexpected error (HTTP ${error.status}). Try refreshing the page.`,
          status: error.status,
        };
    }
  }

  // TypeError is thrown by the Fetch API when the network request itself
  // fails (no DNS, connection refused, CORS pre-flight blocked, etc.) —
  // i.e. no HTTP response was received at all.
  if (error instanceof TypeError) {
    return {
      kind: "network_error",
      message: "Cannot reach server. Check your connection.",
    };
  }

  return {
    kind: "unknown",
    message: "Could not load projects. Try refreshing the page.",
  };
}

// ─── Retry predicate ─────────────────────────────────────────────────────────

/**
 * Returns true when the error is worth retrying automatically.
 *
 * - 401  → never retry (the session is gone; a retry will get another 401)
 * - 403  → never retry (permission won't change between attempts)
 * - 5xx  → retry up to `maxCount` times (transient server fault)
 * - network → retry up to `maxCount` times (transient connectivity blip)
 * - unknown → retry once (conservative)
 */
export function isRetryableProjectError(
  error: unknown,
  failureCount: number,
  maxCount = 2,
): boolean {
  if (failureCount >= maxCount) return false;

  if (error instanceof ApiError) {
    // Auth/permission failures are permanent — never retry.
    if (error.status === 401 || error.status === 403) return false;
    // Retryable server faults.
    return [500, 502, 503, 504].includes(error.status);
  }

  // Network errors (TypeError) are retryable.
  if (error instanceof TypeError) return true;

  return false;
}

// ─── Telemetry ────────────────────────────────────────────────────────────────

export interface ProjectLoadFailedContext {
  userId?: string;
  /** Wall-clock milliseconds from request start to error. */
  duration?: number;
  /** X-Request-Id header value from the failed response, when present. */
  requestId?: string;
}

/**
 * Emits a structured `ProjectLoadFailed` telemetry event.
 *
 * Currently writes to `console.warn` so it appears in browser DevTools and
 * server-side log aggregators without requiring an analytics SDK. Replace
 * the body with your analytics provider call (Amplitude, PostHog, etc.)
 * when you add one.
 */
export function emitProjectLoadFailed(
  error: unknown,
  context: ProjectLoadFailedContext = {},
): void {
  const failure = classifyProjectError(error);
  const status = error instanceof ApiError ? error.status : undefined;
  const requestId =
    context.requestId ??
    (error instanceof ApiError ? (error.headers.get("x-request-id") ?? undefined) : undefined);

  // eslint-disable-next-line no-console
  console.warn("[telemetry] ProjectLoadFailed", {
    event: "ProjectLoadFailed",
    reason: failure.kind,
    status,
    requestId,
    userId: context.userId,
    duration: context.duration,
    timestamp: new Date().toISOString(),
  });
}
