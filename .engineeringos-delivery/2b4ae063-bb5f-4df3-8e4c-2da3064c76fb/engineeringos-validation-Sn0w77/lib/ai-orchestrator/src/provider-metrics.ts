/**
 * PR-05 / PR-011 — Provider Metrics
 *
 * In-memory counters for provider reliability monitoring.
 * Exposed via getProviderMetrics() and surfaced through /api/ai/metrics.
 *
 * Counters:
 *   provider_requests_total    — total calls attempted per provider
 *   provider_failures_total    — total hard failures (after retries) per provider
 *   fallback_success_total     — times fallback to next provider succeeded
 *   invalid_model_total        — MODEL_NOT_FOUND + MODEL_UNAVAILABLE per provider
 *   provider_latency_ms        — rolling last-100 latency samples per provider
 *
 * Health fields (PR-05):
 *   lastSuccessAt              — Date of most recent successful call
 *   lastFailureAt              — Date of most recent failure
 *   consecutiveFailures        — failure streak (reset on any success)
 */

import type { ProviderId } from "./provider-registry.js";

export type ProviderMetricsSnapshot = {
  provider: ProviderId;
  requests: number;
  failures: number;
  fallbackSuccesses: number;
  invalidModels: number;
  p50LatencyMs: number | null;
  p95LatencyMs: number | null;
  avgLatencyMs: number | null;
  /** PR-05: health fields */
  successRate: number | null;      // 0–1; null when no requests recorded
  lastSuccessAt: string | null;    // ISO-8601
  lastFailureAt: string | null;    // ISO-8601
  consecutiveFailures: number;
};

const MAX_LATENCY_SAMPLES = 100;

type ProviderCounters = {
  requests:          number;
  failures:          number;
  fallbackSuccesses: number;
  invalidModels:     number;
  latencySamples:    number[];
  /** PR-05 */
  lastSuccessAt:     Date | null;
  lastFailureAt:     Date | null;
  consecutiveFailures: number;
};

const _counters = new Map<ProviderId, ProviderCounters>();

function getOrCreate(provider: ProviderId): ProviderCounters {
  let c = _counters.get(provider);
  if (!c) {
    c = {
      requests:           0,
      failures:           0,
      fallbackSuccesses:  0,
      invalidModels:      0,
      latencySamples:     [],
      lastSuccessAt:      null,
      lastFailureAt:      null,
      consecutiveFailures: 0,
    };
    _counters.set(provider, c);
  }
  return c;
}

export function recordRequest(provider: ProviderId): void {
  getOrCreate(provider).requests += 1;
}

export function recordFailure(provider: ProviderId): void {
  const c = getOrCreate(provider);
  c.failures += 1;
  c.consecutiveFailures += 1;
  c.lastFailureAt = new Date();
}

/** PR-05: record a successful provider response. */
export function recordSuccess(provider: ProviderId): void {
  const c = getOrCreate(provider);
  c.consecutiveFailures = 0;
  c.lastSuccessAt = new Date();
}

export function recordFallbackSuccess(provider: ProviderId): void {
  getOrCreate(provider).fallbackSuccesses += 1;
}

export function recordInvalidModel(provider: ProviderId): void {
  getOrCreate(provider).invalidModels += 1;
}

export function recordLatency(provider: ProviderId, ms: number): void {
  const c = getOrCreate(provider);
  c.latencySamples.push(ms);
  if (c.latencySamples.length > MAX_LATENCY_SAMPLES) {
    c.latencySamples.shift();
  }
}

function percentile(sorted: number[], p: number): number | null {
  if (sorted.length === 0) return null;
  const idx = Math.max(0, Math.ceil((p / 100) * sorted.length) - 1);
  return sorted[idx] ?? null;
}

export function getProviderMetrics(): ProviderMetricsSnapshot[] {
  const results: ProviderMetricsSnapshot[] = [];
  for (const [provider, c] of _counters) {
    const sorted = [...c.latencySamples].sort((a, b) => a - b);
    const avg = sorted.length > 0
      ? Math.round(sorted.reduce((s, v) => s + v, 0) / sorted.length)
      : null;
    const successes = c.requests - c.failures;
    const successRate = c.requests > 0 ? successes / c.requests : null;

    results.push({
      provider,
      requests:           c.requests,
      failures:           c.failures,
      fallbackSuccesses:  c.fallbackSuccesses,
      invalidModels:      c.invalidModels,
      p50LatencyMs:       percentile(sorted, 50),
      p95LatencyMs:       percentile(sorted, 95),
      avgLatencyMs:       avg,
      successRate,
      lastSuccessAt:      c.lastSuccessAt?.toISOString() ?? null,
      lastFailureAt:      c.lastFailureAt?.toISOString() ?? null,
      consecutiveFailures: c.consecutiveFailures,
    });
  }
  // Sort by most active provider first
  return results.sort((a, b) => b.requests - a.requests);
}

/** Reset all counters (test helper only). */
export function _resetMetricsForTest(): void {
  _counters.clear();
}
