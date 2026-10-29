import { createHash } from "node:crypto";
import { GroqClientError } from "../errors.js";

type CredentialLimitCode = "RATE_LIMITED" | "QUOTA";
type CredentialLimitScope = "provider_credential" | "account_quota";

type CredentialCooldown = {
  coolingUntil: number;
  code: CredentialLimitCode;
  scope: CredentialLimitScope;
};

const COOLDOWN_SWEEP_INTERVAL_MS = 60_000;
const credentialCooldowns = new Map<string, CredentialCooldown>();
let lastSweepAt = 0;

function credentialFingerprint(apiKey: string): string {
  return createHash("sha256").update(apiKey, "utf8").digest("hex");
}

function sweepExpired(now: number): void {
  if (now - lastSweepAt < COOLDOWN_SWEEP_INTERVAL_MS) return;
  for (const [fingerprint, cooldown] of credentialCooldowns) {
    if (cooldown.coolingUntil <= now) credentialCooldowns.delete(fingerprint);
  }
  lastSweepAt = now;
}

/**
 * Keeps an exact provider-supplied credential/account Retry-After in this
 * process only. The API key is represented only by a SHA-256 fingerprint and
 * is never logged or persisted.
 */
export function recordOpenRouterCredentialCooldown(
  apiKey: string | undefined,
  error: unknown,
): void {
  if (
    !apiKey ||
    !(error instanceof GroqClientError) ||
    (error.code !== "RATE_LIMITED" && error.code !== "QUOTA") ||
    (error.rateLimitScope !== "provider_credential" && error.rateLimitScope !== "account_quota") ||
    !Number.isSafeInteger(error.retryAfterMs) ||
    error.retryAfterMs! <= 0
  ) {
    return;
  }

  const now = Date.now();
  const coolingUntil = now + error.retryAfterMs!;
  if (!Number.isSafeInteger(coolingUntil)) return;
  sweepExpired(now);

  const fingerprint = credentialFingerprint(apiKey);
  const previous = credentialCooldowns.get(fingerprint);
  credentialCooldowns.set(fingerprint, {
    coolingUntil: Math.max(previous?.coolingUntil ?? 0, coolingUntil),
    code: error.code,
    scope: error.rateLimitScope,
  });
}

/** Rejects all OpenRouter model lanes for this credential until Retry-After. */
export function assertOpenRouterCredentialAvailable(apiKey: string | undefined): void {
  if (!apiKey) return;
  const now = Date.now();
  sweepExpired(now);

  const fingerprint = credentialFingerprint(apiKey);
  const cooldown = credentialCooldowns.get(fingerprint);
  if (!cooldown) return;

  const retryAfterMs = Math.ceil(cooldown.coolingUntil - now);
  if (retryAfterMs <= 0) {
    credentialCooldowns.delete(fingerprint);
    return;
  }

  throw new GroqClientError(
    cooldown.code,
    cooldown.code === "QUOTA"
      ? "OpenRouter account quota is still within the provider retry window"
      : "OpenRouter credential is still within the provider retry window",
    {
      context: {
        providerName: "OpenRouter",
        providerCode: "CREDENTIAL_RETRY_AFTER",
        rateLimitScope: cooldown.scope,
        retryAfterMs,
      },
    },
  );
}

/** Test seam for deterministic process-local credential cooldown checks. */
export function _resetOpenRouterCredentialCooldownsForTest(): void {
  credentialCooldowns.clear();
  lastSweepAt = 0;
}
