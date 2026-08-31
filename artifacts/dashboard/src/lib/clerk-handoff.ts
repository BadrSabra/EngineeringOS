/**
 * Clerk has returned both a bare array and a paginated `{ data }` envelope
 * for user collection endpoints. Keep that provider-specific compatibility
 * at the handoff boundary so the browser journey can validate it separately.
 */
export function parseClerkUserLookupResponse(payload: unknown): string | undefined {
  const users = Array.isArray(payload)
    ? payload
    : isRecord(payload) && Array.isArray(payload.data)
      ? payload.data
      : undefined;

  if (!users) {
    throw new Error(
      "Clerk user lookup response shape changed: expected an array or an object with a data array.",
    );
  }

  const firstUser = users[0];
  if (!isRecord(firstUser) || typeof firstUser.id !== "string") {
    if (users.length === 0) return undefined;
    throw new Error(
      "Clerk user lookup response shape changed: expected each user to include a string id.",
    );
  }

  return firstUser.id;
}

export function parseCreatedClerkUserResponse(payload: unknown): string | undefined {
  if (!isRecord(payload) || typeof payload.id !== "string") {
    throw new Error(
      "Clerk user creation response shape changed: expected an object with a string id.",
    );
  }
  return payload.id;
}

export function parseClerkSignInTokenResponse(payload: unknown): string {
  if (!isRecord(payload) || typeof payload.token !== "string" || !payload.token) {
    throw new Error(
      "Clerk sign-in-token response shape changed: expected an object with a non-empty token.",
    );
  }
  return payload.token;
}

/**
 * Clerk consumes a sign-in ticket by replacing the handoff document with the
 * application route. Playwright can report that expected replacement as
 * `net::ERR_ABORTED` when it is waiting for the original document to finish
 * loading. Keep this check at the handoff boundary so unrelated navigation
 * failures are still surfaced by the browser journey.
 */
export function isClerkHandoffNavigationAbort(error: unknown): boolean {
  const message =
    error instanceof Error
      ? error.message
      : typeof error === "string"
        ? error
        : "";
  return /\bERR_ABORTED\b/.test(message);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
