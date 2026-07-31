/**
 * Shared API fetch helpers for the dashboard.
 *
 * All requests use cookie-based Clerk auth (same-origin). Do NOT add
 * Bearer/getToken or Authorization headers — Clerk session cookies are sent
 * automatically by the browser for same-origin requests.
 *
 * PR-06: extracted from AiChat.tsx and GitPanel.tsx to eliminate the
 * duplicated `apiFetch` implementations and align error-handling behaviour.
 */

/**
 * Structured error from any /api/* endpoint.
 * Preserves the server's `error`, `hint`, and `code` fields so callers can
 * display a precise message rather than a generic "Request failed".
 */
export class ApiError extends Error {
  constructor(
    public readonly status: number,
    public readonly errorMessage: string,
    public readonly hint?: string,
    public readonly code?: string,
  ) {
    super(errorMessage);
    this.name = 'ApiError';
  }
}

/**
 * Core fetch wrapper. Throws `ApiError` on non-OK responses.
 * Preserves structured JSON error bodies from the server.
 */
export async function apiFetch<T>(
  method: string,
  path: string,
  body?: unknown,
): Promise<T> {
  const res = await fetch(path, {
    method,
    headers: body !== undefined ? { 'Content-Type': 'application/json' } : undefined,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) {
    let parsed: { error?: string; hint?: string; code?: string } = {};
    try {
      parsed = (await res.json()) as typeof parsed;
    } catch {
      /* body may not be JSON */
    }
    throw new ApiError(
      res.status,
      parsed.error ?? `Request failed (${res.status})`,
      parsed.hint,
      parsed.code,
    );
  }
  return res.json() as Promise<T>;
}

/** Convenience wrappers matching the pattern used across the dashboard. */
export const apiPost   = <T,>(path: string, body: unknown) => apiFetch<T>('POST',   path, body);
export const apiGet    = <T,>(path: string)                 => apiFetch<T>('GET',    path);
export const apiPut    = <T,>(path: string, body: unknown)  => apiFetch<T>('PUT',    path, body);
export const apiDelete = <T,>(path: string)                 => apiFetch<T>('DELETE', path);
