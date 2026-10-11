/**
 * Provider circuit-breaker compatibility exports are retained, but provider
 * calls are no longer blocked based on local failure counts or cooldowns.
 * Provider-supplied model Retry-After values remain tracked separately.
 */

const _modelCooldowns = new Map<string, { coolingUntil: number }>();

function modelKey(provider: string, model: string): string {
  return `${provider}:${model}`;
}

/** Provider calls are never locally blocked by a consecutive-failure count. */
export function isCircuitOpen(_provider: string): boolean {
  return false;
}

/** Compatibility no-op: provider health does not create a local cooldown. */
export function recordCircuitFailure(_provider: string): void {}

/** Compatibility no-op: no local provider circuit state is retained. */
export function recordCircuitSuccess(_provider: string): void {}

/**
 * Model-scoped admission used for throttled or temporarily unavailable
 * OpenRouter slugs. This deliberately does not open the provider circuit:
 * another model may still be healthy under the same credential.
 */
export function isModelCoolingDown(provider: string, model: string): boolean {
  const key = modelKey(provider, model);
  const state = _modelCooldowns.get(key);
  if (!state) return false;
  if (state.coolingUntil <= Date.now()) {
    _modelCooldowns.delete(key);
    return false;
  }
  return true;
}

export function getModelCooldownRemainingMs(provider: string, model: string): number | null {
  const key = modelKey(provider, model);
  const state = _modelCooldowns.get(key);
  if (!state) return null;
  const remaining = state.coolingUntil - Date.now();
  if (remaining <= 0) {
    _modelCooldowns.delete(key);
    return null;
  }
  return remaining;
}

/**
 * Restore a still-active shared cooldown into this process without extending
 * its server-owned expiry time.
 */
export function rememberModelCooldownUntil(
  provider: string,
  model: string,
  remainingMs: number,
): void {
  if (!Number.isFinite(remainingMs) || remainingMs <= 0) return;
  const key = modelKey(provider, model);
  const coolingUntil = Date.now() + Math.floor(remainingMs);
  const previous = _modelCooldowns.get(key);
  if (previous && previous.coolingUntil >= coolingUntil) return;
  _modelCooldowns.set(key, {
    coolingUntil,
  });
}

export function recordModelFailure(
  provider: string,
  model: string,
  retryAfterMs?: number,
): void {
  const key = modelKey(provider, model);
  if (!Number.isFinite(retryAfterMs) || retryAfterMs! <= 0) {
    console.info(JSON.stringify({
      scope: "circuit-breaker",
      code: "MODEL_COOLDOWN_SKIPPED",
      provider,
      model,
      reason: Number.isFinite(retryAfterMs) ? "provider_retry_after_zero" : "provider_retry_after_missing",
    }));
    return;
  }
  const cooldownMs = Math.floor(retryAfterMs!);
  if (cooldownMs <= 0) return;
  const state = {
    coolingUntil: Date.now() + cooldownMs,
  };
  _modelCooldowns.set(key, state);
  console.warn(JSON.stringify({
    scope: "circuit-breaker",
    code: "MODEL_COOLDOWN",
    provider,
    model,
    cooldownMs,
  }));
}

export function recordModelSuccess(provider: string, model: string): void {
  _modelCooldowns.delete(modelKey(provider, model));
}

/**
 * Return the current circuit state for a provider.
 * Used by /api/ai/metrics to expose runtime health.
 */
export function getCircuitState(provider: string): {
  open: boolean;
  halfOpen: boolean;
  consecutiveFailures: number;
  cooldownRemainingMs: number | null;
} {
  void provider;
  return {
    open: false,
    halfOpen: false,
    consecutiveFailures: 0,
    cooldownRemainingMs: null,
  };
}

/** Force-reset all circuit state (test helper only). */
export function _resetCircuitsForTest(): void {
  _modelCooldowns.clear();
}
