import { createHash, createHmac } from "node:crypto";
import { GroqClientError } from "../errors.js";

type CredentialLimitCode = "RATE_LIMITED" | "QUOTA";
type CredentialLimitScope = "provider_credential" | "account_quota" | "unknown";

type CredentialCooldown = {
  coolingUntil: number;
  code: CredentialLimitCode;
  scope: CredentialLimitScope;
};

type PersistedCredentialCooldown = {
  remainingMs: number;
  code: CredentialLimitCode;
  scope: CredentialLimitScope;
};

export type CredentialCooldownPersistence = {
  readActive(fingerprint: string): Promise<PersistedCredentialCooldown | null>;
  write(fingerprint: string, cooldown: CredentialCooldown): Promise<void>;
};

const COOLDOWN_SWEEP_INTERVAL_MS = 60_000;
const PERSISTENCE_WARNING_INTERVAL_MS = 60_000;
const credentialCooldowns = new Map<string, CredentialCooldown>();
let lastSweepAt = 0;
let lastPersistenceWarningAt = Number.NEGATIVE_INFINITY;

function credentialFingerprint(apiKey: string): string {
  return createHash("sha256").update(apiKey, "utf8").digest("hex");
}

function persistentCredentialFingerprint(apiKey: string): string | null {
  const encryptionKey = process.env.AI_CREDENTIALS_ENCRYPTION_KEY;
  if (!encryptionKey || !/^[a-f0-9]{64}$/i.test(encryptionKey)) return null;
  return createHmac("sha256", Buffer.from(encryptionKey, "hex"))
    .update("openrouter-credential-cooldown:v1\0", "utf8")
    .update(apiKey, "utf8")
    .digest("hex");
}

const postgresPersistence: CredentialCooldownPersistence = {
  async readActive(fingerprint) {
    const { pool } = await import("@workspace/db");
    const result = await pool.query<{
      remaining_ms: number | string;
      error_code: CredentialLimitCode;
      scope: CredentialLimitScope;
    }>(
      `SELECT
         CEIL(EXTRACT(EPOCH FROM (cooling_until - now())) * 1000)::numeric AS remaining_ms,
         error_code,
         scope
       FROM openrouter_credential_cooldowns
       WHERE credential_fingerprint = $1
         AND cooling_until > now()
       LIMIT 1`,
      [fingerprint],
    );
    const row = result.rows[0];
    if (!row) return null;
    const remainingMs = Number(row.remaining_ms);
    if (!Number.isSafeInteger(remainingMs) || remainingMs <= 0) return null;
    if (row.error_code !== "RATE_LIMITED" && row.error_code !== "QUOTA") return null;
    if (
      row.scope !== "provider_credential" &&
      row.scope !== "account_quota" &&
      row.scope !== "unknown"
    ) return null;
    return { remainingMs, code: row.error_code, scope: row.scope };
  },

  async write(fingerprint, cooldown) {
    const { pool } = await import("@workspace/db");
    await pool.query(
      `INSERT INTO openrouter_credential_cooldowns
         (credential_fingerprint, cooling_until, error_code, scope, updated_at)
       VALUES ($1, to_timestamp($2::double precision / 1000.0), $3, $4, now())
       ON CONFLICT (credential_fingerprint) DO UPDATE
       SET cooling_until = GREATEST(
             openrouter_credential_cooldowns.cooling_until,
             EXCLUDED.cooling_until
           ),
           error_code = CASE
             WHEN EXCLUDED.cooling_until >= openrouter_credential_cooldowns.cooling_until
               THEN EXCLUDED.error_code
             ELSE openrouter_credential_cooldowns.error_code
           END,
           scope = CASE
             WHEN EXCLUDED.cooling_until >= openrouter_credential_cooldowns.cooling_until
               THEN EXCLUDED.scope
             ELSE openrouter_credential_cooldowns.scope
           END,
           updated_at = now()`,
      [fingerprint, cooldown.coolingUntil, cooldown.code, cooldown.scope],
    );
    await pool.query(
      "DELETE FROM openrouter_credential_cooldowns WHERE cooling_until <= now()",
    );
  },
};

let persistence: CredentialCooldownPersistence = postgresPersistence;

function logPersistenceUnavailable(operation: "read" | "write", reason?: string): void {
  const now = Date.now();
  if (now - lastPersistenceWarningAt < PERSISTENCE_WARNING_INTERVAL_MS) return;
  lastPersistenceWarningAt = now;
  console.warn(JSON.stringify({
    scope: "openrouter-credential-cooldown",
    code: "SHARED_STORE_UNAVAILABLE",
    operation,
    ...(reason ? { reason } : {}),
  }));
}

function sweepExpired(now: number): void {
  if (now - lastSweepAt < COOLDOWN_SWEEP_INTERVAL_MS) return;
  for (const [fingerprint, cooldown] of credentialCooldowns) {
    if (cooldown.coolingUntil <= now) credentialCooldowns.delete(fingerprint);
  }
  lastSweepAt = now;
}

/**
 * Keeps exact provider-supplied Retry-After windows local and in the shared
 * store. Persistent identity is an HMAC; the raw API key is never logged or
 * persisted. Unknown scopes remain explicitly unknown.
 */
export async function recordOpenRouterCredentialCooldown(
  apiKey: string | undefined,
  error: unknown,
): Promise<void> {
  if (
    !apiKey ||
    !(error instanceof GroqClientError) ||
    (error.code !== "RATE_LIMITED" && error.code !== "QUOTA") ||
    error.rateLimitScope === "upstream_shared_pool" ||
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
  const cooldown: CredentialCooldown = previous && previous.coolingUntil > coolingUntil
    ? previous
    : {
        coolingUntil,
        code: error.code,
        scope:
          error.rateLimitScope === "provider_credential" ||
          error.rateLimitScope === "account_quota"
            ? error.rateLimitScope
            : "unknown",
      };
  credentialCooldowns.set(fingerprint, cooldown);

  const persistentFingerprint = persistentCredentialFingerprint(apiKey);
  if (!persistentFingerprint) {
    logPersistenceUnavailable("write", "encryption_key_unavailable");
    return;
  }
  try {
    await persistence.write(persistentFingerprint, cooldown);
  } catch {
    logPersistenceUnavailable("write");
  }
}

/**
 * Rejects all OpenRouter model lanes for this credential until Retry-After.
 * Reads shared state on every admission so another API process can extend the
 * exact provider-supplied window while this process is still running.
 */
export async function assertOpenRouterCredentialAvailable(
  apiKey: string | undefined,
): Promise<void> {
  if (!apiKey) return;
  const now = Date.now();
  sweepExpired(now);

  const fingerprint = credentialFingerprint(apiKey);
  let cooldown = credentialCooldowns.get(fingerprint);
  const persistentFingerprint = persistentCredentialFingerprint(apiKey);
  if (!persistentFingerprint) {
    logPersistenceUnavailable("read", "encryption_key_unavailable");
  } else {
    try {
      const persisted = await persistence.readActive(persistentFingerprint);
      if (
        persisted &&
        persisted.remainingMs > 0 &&
        Number.isSafeInteger(persisted.remainingMs)
      ) {
        const persistedCooldown: CredentialCooldown = {
          coolingUntil: Date.now() + persisted.remainingMs,
          code: persisted.code,
          scope: persisted.scope,
        };
        if (!cooldown || persistedCooldown.coolingUntil > cooldown.coolingUntil) {
          cooldown = persistedCooldown;
          credentialCooldowns.set(fingerprint, cooldown);
        }
      }
    } catch {
      logPersistenceUnavailable("read");
    }
  }

  if (!cooldown) return;

  const retryAfterMs = Math.ceil(cooldown.coolingUntil - Date.now());
  if (retryAfterMs <= 0) {
    credentialCooldowns.delete(fingerprint);
    return;
  }

  throw new GroqClientError(
    cooldown.code,
    cooldown.scope === "account_quota"
      ? "OpenRouter account quota is still within the provider retry window"
      : cooldown.scope === "provider_credential"
        ? "OpenRouter credential is still within the provider retry window"
        : "OpenRouter is still within a provider retry window with unknown scope",
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
  lastPersistenceWarningAt = Number.NEGATIVE_INFINITY;
}

/** Test seam for deterministic shared-store and cross-process simulations. */
export function _setOpenRouterCredentialCooldownPersistenceForTest(
  next: CredentialCooldownPersistence | undefined,
): void {
  persistence = next ?? postgresPersistence;
  lastPersistenceWarningAt = Number.NEGATIVE_INFINITY;
}
