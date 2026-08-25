/**
 * Structured error from any /api/* endpoint.
 *
 * The generated API client handles dashboard requests. This class remains
 * available for translating structured SSE errors into the same UI format.
 */
export class ApiError extends Error {
  constructor(
    public readonly status: number,
    public readonly errorMessage: string,
    public readonly hint?: string,
    public readonly code?: string,
    /** Provider context forwarded from the API for diagnostic display. */
    public readonly providerContext?: Record<string, unknown>,
  ) {
    super(errorMessage);
    this.name = 'ApiError';
  }
}