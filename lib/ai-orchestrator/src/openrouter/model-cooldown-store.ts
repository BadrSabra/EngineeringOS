import {
  getModelCooldownRemainingMs,
  MODEL_COOLDOWN_MS,
  rememberModelCooldownUntil,
} from "./circuit-breaker.js";

export type PersistedModelCooldown = {
  model: string;
  remainingMs: number;
};

export type ModelCooldownPersistence = {
  readActive(provider: string, models: string[]): Promise<PersistedModelCooldown[]>;
  write(provider: string, model: string, cooldownMs: number): Promise<void>;
};

const PERSISTENCE_WARNING_INTERVAL_MS = 60_000;

const postgresPersistence: ModelCooldownPersistence = {
  async readActive(provider, models) {
    if (models.length === 0) return [];
    const { pool } = await import("@workspace/db");
    const result = await pool.query<{ model: string; remaining_ms: number | string }>(
      `SELECT
         model,
         CEIL(EXTRACT(EPOCH FROM (cooling_until - now())) * 1000)::integer AS remaining_ms
       FROM openrouter_model_cooldowns
       WHERE provider = $1
         AND model = ANY($2::text[])
         AND cooling_until > now()`,
      [provider, models],
    );
    return result.rows
      .map((row) => ({ model: row.model, remainingMs: Number(row.remaining_ms) }))
      .filter((row) => Number.isFinite(row.remainingMs) && row.remainingMs > 0);
  },

  async write(provider, model, cooldownMs) {
    const { pool } = await import("@workspace/db");
    await pool.query(
      `INSERT INTO openrouter_model_cooldowns
         (provider, model, cooling_until, updated_at)
       VALUES ($1, $2, now() + ($3::double precision * interval '1 millisecond'), now())
       ON CONFLICT (provider, model) DO UPDATE
       SET cooling_until = GREATEST(
             openrouter_model_cooldowns.cooling_until,
             EXCLUDED.cooling_until
           ),
           updated_at = now()`,
      [provider, model, cooldownMs],
    );
    // Cooldown records are keyed by provider/model, so expiry cleanup is
    // bounded by the number of distinct historical model IDs.
    await pool.query(
      "DELETE FROM openrouter_model_cooldowns WHERE cooling_until <= now()",
    );
  },
};

let persistence: ModelCooldownPersistence = postgresPersistence;
let lastPersistenceWarningAt = Number.NEGATIVE_INFINITY;

function logPersistenceUnavailable(operation: "read" | "write"): void {
  const now = Date.now();
  if (now - lastPersistenceWarningAt < PERSISTENCE_WARNING_INTERVAL_MS) return;
  lastPersistenceWarningAt = now;
  console.warn(JSON.stringify({
    scope: "openrouter-model-cooldown",
    code: "SHARED_STORE_UNAVAILABLE",
    operation,
  }));
}

/**
 * Reads the shared cooldown state for candidate models and merges it with the
 * process-local cache. Database failure retains local protection and is
 * reported without converting an upstream 429 into a second failure.
 */
export async function readModelCooldowns(
  provider: string,
  models: string[],
): Promise<Map<string, number>> {
  const cooldowns = new Map<string, number>();
  const uniqueModels = [...new Set(models)];
  const unresolvedModels: string[] = [];

  for (const model of uniqueModels) {
    const remainingMs = getModelCooldownRemainingMs(provider, model);
    if (remainingMs !== null) cooldowns.set(model, remainingMs);
    else unresolvedModels.push(model);
  }

  if (unresolvedModels.length === 0) return cooldowns;

  try {
    const persisted = await persistence.readActive(provider, unresolvedModels);
    for (const entry of persisted) {
      if (!unresolvedModels.includes(entry.model) || entry.remainingMs <= 0) continue;
      const remainingMs = Math.floor(entry.remainingMs);
      cooldowns.set(entry.model, remainingMs);
      rememberModelCooldownUntil(provider, entry.model, remainingMs);
    }
  } catch {
    logPersistenceUnavailable("read");
  }

  return cooldowns;
}

/**
 * Persists only the exact model that received an upstream shared-pool limit.
 * The in-memory circuit-breaker state is recorded by the caller first, so a
 * database outage still protects requests handled by this process.
 */
export async function persistSharedPoolModelCooldown(
  provider: string,
  model: string,
): Promise<void> {
  try {
    await persistence.write(provider, model, MODEL_COOLDOWN_MS);
  } catch {
    logPersistenceUnavailable("write");
  }
}

/** Test seam for deterministic multi-process cooldown tests. */
export function _setModelCooldownPersistenceForTest(
  next: ModelCooldownPersistence | undefined,
): void {
  persistence = next ?? postgresPersistence;
  lastPersistenceWarningAt = Number.NEGATIVE_INFINITY;
}