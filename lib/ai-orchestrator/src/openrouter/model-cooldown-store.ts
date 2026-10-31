import {
  getModelCooldownRemainingMs,
  rememberModelCooldownUntil,
} from "./circuit-breaker.js";

const UPSTREAM_POOL_COOLDOWN_PREFIX = "__upstream_pool__:";
const LOCAL_ADAPTIVE_COOLDOWN_PREFIX = "__local_adaptive_model__:";
const LOCAL_ADAPTIVE_BASE_MS = 30_000;
const LOCAL_ADAPTIVE_MAX_MS = 10 * 60_000;
const LOCAL_ADAPTIVE_HISTORY_MS = 60 * 60_000;

export type ModelCooldownSource = "provider" | "local_adaptive";
export type ModelCooldown = {
  remainingMs: number;
  source: ModelCooldownSource;
};

const localAdaptiveHistory = new Map<
  string,
  { cooldownMs: number; recordedAt: number }
>();
const localAdaptiveActiveUntil = new Map<string, number>();

function normalizeProviderNamespace(value: string): string {
  return value.trim().toLowerCase().replace(/[^a-z0-9]/g, "");
}

function modelNamespace(model: string): string | undefined {
  const namespace = model.split("/", 1)[0];
  const normalized = namespace ? normalizeProviderNamespace(namespace) : "";
  return normalized || undefined;
}

function upstreamPoolCooldownKey(namespace: string): string {
  return `${UPSTREAM_POOL_COOLDOWN_PREFIX}${namespace}`;
}

function localAdaptiveCooldownKey(model: string): string {
  return `${LOCAL_ADAPTIVE_COOLDOWN_PREFIX}${encodeURIComponent(model)}`;
}

function modelFromLocalAdaptiveCooldownKey(key: string): string | undefined {
  if (!key.startsWith(LOCAL_ADAPTIVE_COOLDOWN_PREFIX)) return undefined;
  try {
    return decodeURIComponent(key.slice(LOCAL_ADAPTIVE_COOLDOWN_PREFIX.length));
  } catch {
    return undefined;
  }
}

function cooldownStateKey(provider: string, model: string): string {
  return `${provider}\u0000${model}`;
}

export function isUpstreamPoolCooldownKey(value: string): boolean {
  return value.startsWith(UPSTREAM_POOL_COOLDOWN_PREFIX);
}

/**
 * Scope a shared-pool cooldown only when OpenRouter's upstream provider name
 * exactly matches the model namespace. Unknown mappings stay model-local.
 */
export function upstreamPoolCooldownKeyForModel(
  model: string,
  upstreamProvider: string | undefined,
): string | undefined {
  if (!upstreamProvider) return undefined;
  const namespace = modelNamespace(model);
  const provider = normalizeProviderNamespace(upstreamProvider);
  if (!namespace || !provider || namespace !== provider) return undefined;
  return upstreamPoolCooldownKey(namespace);
}

export type PersistedModelCooldown = {
  model: string;
  remainingMs: number;
};

export type ModelCooldownPersistence = {
  readActive(provider: string, models: string[]): Promise<PersistedModelCooldown[]>;
  write(provider: string, model: string, cooldownMs: number): Promise<void>;
  clear(provider: string, model: string): Promise<void>;
  readRecentCooldownMs?(
    provider: string,
    model: string,
    maxAgeMs: number,
  ): Promise<number | undefined>;
};

const PERSISTENCE_WARNING_INTERVAL_MS = 60_000;

const postgresPersistence: ModelCooldownPersistence = {
  async readActive(provider, models) {
    if (models.length === 0) return [];
    const { pool } = await import("@workspace/db");
    const result = await pool.query<{ model: string; remaining_ms: number | string }>(
      `SELECT
         model,
         CEIL(EXTRACT(EPOCH FROM (cooling_until - now())) * 1000)::numeric AS remaining_ms
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
       SET cooling_until = now() + ($3::double precision * interval '1 millisecond'),
           updated_at = now()`,
      [provider, model, cooldownMs],
     );
  },

  async readRecentCooldownMs(provider, model, maxAgeMs) {
    const { pool } = await import("@workspace/db");
    const result = await pool.query<{
      cooldown_ms: number | string;
      age_ms: number | string;
    }>(
      `SELECT
         CEIL(EXTRACT(EPOCH FROM (cooling_until - updated_at)) * 1000)::numeric AS cooldown_ms,
         CEIL(EXTRACT(EPOCH FROM (now() - updated_at)) * 1000)::numeric AS age_ms
       FROM openrouter_model_cooldowns
       WHERE provider = $1
         AND model = $2
       LIMIT 1`,
      [provider, model],
    );
    const row = result.rows[0];
    if (!row) return undefined;
    const cooldownMs = Number(row.cooldown_ms);
    const ageMs = Number(row.age_ms);
    if (
      Number.isFinite(cooldownMs)
      && cooldownMs > 0
      && Number.isFinite(ageMs)
      && ageMs >= 0
      && ageMs <= maxAgeMs
    ) {
      return Math.floor(cooldownMs);
    }
    if (Number.isFinite(ageMs) && ageMs > maxAgeMs) {
      await pool.query(
        `DELETE FROM openrouter_model_cooldowns
         WHERE provider = $1
           AND model = $2
           AND cooling_until <= now()`,
        [provider, model],
      );
    }
    return undefined;
  },

  async clear(provider, model) {
    const { pool } = await import("@workspace/db");
    await pool.query(
      "DELETE FROM openrouter_model_cooldowns WHERE provider = $1 AND model = $2",
      [provider, model],
    );
  },
};

let persistence: ModelCooldownPersistence = postgresPersistence;
let lastPersistenceWarningAt = Number.NEGATIVE_INFINITY;

function logPersistenceUnavailable(operation: "read" | "write" | "clear"): void {
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
  persistenceOverride?: ModelCooldownPersistence,
): Promise<Map<string, ModelCooldown>> {
  const cooldowns = new Map<string, ModelCooldown>();
  const uniqueModels = [...new Set(models)];
  const unresolvedModels: string[] = [];
  const poolKeysByModel = new Map<string, string>();
  const setCooldown = (
    model: string,
    remainingMs: number,
    source: ModelCooldownSource,
  ) => {
    if (!Number.isFinite(remainingMs) || remainingMs <= 0) return;
    const previous = cooldowns.get(model);
    if (!previous || remainingMs > previous.remainingMs) {
      cooldowns.set(model, { remainingMs, source });
    }
  };

  for (const model of uniqueModels) {
    const namespace = modelNamespace(model);
    if (namespace) poolKeysByModel.set(model, upstreamPoolCooldownKey(namespace));
  }

  for (const model of uniqueModels) {
    const remainingMs = getModelCooldownRemainingMs(provider, model);
    if (remainingMs !== null) {
      const stateKey = cooldownStateKey(provider, model);
      const adaptiveUntil = localAdaptiveActiveUntil.get(stateKey);
      const source: ModelCooldownSource =
        adaptiveUntil !== undefined && adaptiveUntil > Date.now()
          ? "local_adaptive"
          : "provider";
      if (adaptiveUntil !== undefined && adaptiveUntil <= Date.now()) {
        localAdaptiveActiveUntil.delete(stateKey);
      }
      setCooldown(model, remainingMs, source);
    } else {
      unresolvedModels.push(model, localAdaptiveCooldownKey(model));
    }
  }

  for (const poolKey of new Set(poolKeysByModel.values())) {
    const remainingMs = getModelCooldownRemainingMs(provider, poolKey);
    if (remainingMs !== null) {
      setCooldown(poolKey, remainingMs, "provider");
      for (const [model, candidateKey] of poolKeysByModel) {
        if (candidateKey !== poolKey) continue;
        setCooldown(model, remainingMs, "provider");
      }
    } else {
      unresolvedModels.push(poolKey);
    }
  }

  const modelsToRead = [...new Set(unresolvedModels)];
  if (modelsToRead.length === 0) return cooldowns;

  try {
    const persisted = await (persistenceOverride ?? persistence).readActive(provider, modelsToRead);
    for (const entry of persisted) {
      if (!modelsToRead.includes(entry.model) || entry.remainingMs <= 0) continue;
      const remainingMs = Math.floor(entry.remainingMs);
      const adaptiveModel = modelFromLocalAdaptiveCooldownKey(entry.model);
      if (adaptiveModel && uniqueModels.includes(adaptiveModel)) {
        const stateKey = cooldownStateKey(provider, adaptiveModel);
        setCooldown(adaptiveModel, remainingMs, "local_adaptive");
        localAdaptiveActiveUntil.set(stateKey, Date.now() + remainingMs);
        rememberModelCooldownUntil(provider, adaptiveModel, remainingMs);
      } else if (isUpstreamPoolCooldownKey(entry.model)) {
        setCooldown(entry.model, remainingMs, "provider");
        for (const [model, poolKey] of poolKeysByModel) {
          if (poolKey !== entry.model) continue;
          setCooldown(model, remainingMs, "provider");
        }
      } else if (uniqueModels.includes(entry.model)) {
        setCooldown(entry.model, remainingMs, "provider");
        rememberModelCooldownUntil(provider, entry.model, remainingMs);
      }
    }
  } catch {
    logPersistenceUnavailable("read");
  }

  return cooldowns;
}

/**
 * Record a bounded, exact-model admission cooldown when a 429 has no usable
 * provider Retry-After. Reserved-key history makes the escalation survive API
 * process restarts without widening the cooldown to sibling free models.
 */
export async function recordLocalAdaptiveModelCooldown(
  provider: string,
  model: string,
  persistenceOverride?: ModelCooldownPersistence,
): Promise<number> {
  const store = persistenceOverride ?? persistence;
  const stateKey = cooldownStateKey(provider, model);
  const now = Date.now();
  const inMemoryPrevious = localAdaptiveHistory.get(stateKey);
  let previousCooldownMs =
    inMemoryPrevious && now - inMemoryPrevious.recordedAt <= LOCAL_ADAPTIVE_HISTORY_MS
      ? inMemoryPrevious.cooldownMs
      : 0;
  try {
    const persistedPrevious = await store.readRecentCooldownMs?.(
      provider,
      localAdaptiveCooldownKey(model),
      LOCAL_ADAPTIVE_HISTORY_MS,
    );
    if (persistedPrevious && persistedPrevious > previousCooldownMs) {
      previousCooldownMs = persistedPrevious;
    }
  } catch {
    logPersistenceUnavailable("read");
  }

  const cooldownMs = previousCooldownMs > 0
    ? Math.min(LOCAL_ADAPTIVE_MAX_MS, Math.max(LOCAL_ADAPTIVE_BASE_MS, previousCooldownMs * 2))
    : LOCAL_ADAPTIVE_BASE_MS;
  localAdaptiveHistory.set(stateKey, { cooldownMs, recordedAt: now });
  localAdaptiveActiveUntil.set(stateKey, now + cooldownMs);
  rememberModelCooldownUntil(provider, model, cooldownMs);

  try {
    await store.write(provider, localAdaptiveCooldownKey(model), cooldownMs);
  } catch {
    logPersistenceUnavailable("write");
  }
  console.warn(JSON.stringify({
    scope: "openrouter-model-cooldown",
    code: "LOCAL_ADAPTIVE_MODEL_COOLDOWN",
    provider,
    model,
    cooldownMs,
  }));
  return cooldownMs;
}

/**
 * Persists one exact model or reserved upstream-namespace cooldown key.
 * The in-memory circuit-breaker state is recorded by the caller first, so a
 * database outage still protects requests handled by this process.
 */
export async function persistSharedPoolModelCooldown(
  provider: string,
  model: string,
  retryAfterMs?: number,
  persistenceOverride?: ModelCooldownPersistence,
): Promise<void> {
  try {
    if (!Number.isFinite(retryAfterMs) || retryAfterMs! <= 0) return;
    const providerRetryAfter = Math.floor(retryAfterMs!);
    if (providerRetryAfter <= 0) return;
    await (persistenceOverride ?? persistence).write(provider, model, providerRetryAfter);
  } catch {
    logPersistenceUnavailable("write");
  }
}

/**
 * A successful response ends the persisted failure streak for this exact
 * model. Persistence is best-effort: a database outage must not turn a
 * successful provider response into a failed AI operation.
 */
export async function clearSharedPoolModelCooldown(
  provider: string,
  model: string,
  persistenceOverride?: ModelCooldownPersistence,
): Promise<void> {
  const store = persistenceOverride ?? persistence;
  const stateKey = cooldownStateKey(provider, model);
  localAdaptiveHistory.delete(stateKey);
  localAdaptiveActiveUntil.delete(stateKey);
  for (const key of [model, localAdaptiveCooldownKey(model)]) {
    try {
      await store.clear(provider, key);
    } catch {
      logPersistenceUnavailable("clear");
    }
  }
}

/** Test seam for deterministic multi-process cooldown tests. */
export function _setModelCooldownPersistenceForTest(
  next: ModelCooldownPersistence | undefined,
): void {
  persistence = next ?? postgresPersistence;
  lastPersistenceWarningAt = Number.NEGATIVE_INFINITY;
}

export function _resetLocalAdaptiveModelCooldownsForTest(): void {
  localAdaptiveHistory.clear();
  localAdaptiveActiveUntil.clear();
}