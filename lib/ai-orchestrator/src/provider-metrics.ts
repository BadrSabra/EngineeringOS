/**
 * PR-011 — Provider Metrics
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
};

const MAX_LATENCY_SAMPLES = 100;

type ProviderCounters = {
  requests:         number;
  failures:         number;
  fallbackSuccesses: number;
  invalidModels:    number;
  latencySamples:   number[];
};

const _counters = new Map<ProviderId, ProviderCounters>();

function getOrCreate(provider: ProviderId): ProviderCounters {
  let c = _counters.get(provider);
  if (!c) {
    c = { requests: 0, failures: 0, fallbackSuccesses: 0, invalidModels: 0, latencySamples: [] };
    _counters.set(provider, c);
  }
  return c;
}

export function recordRequest(provider: ProviderId): void {
  getOrCreate(provider).requests += 1;
}

export function recordFailure(provider: ProviderId): void {
  getOrCreate(provider).failures += 1;
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
    results.push({
      provider,
      requests:          c.requests,
      failures:          c.failures,
      fallbackSuccesses: c.fallbackSuccesses,
      invalidModels:     c.invalidModels,
      p50LatencyMs:      percentile(sorted, 50),
      p95LatencyMs:      percentile(sorted, 95),
      avgLatencyMs:      avg,
    });
  }
  // Sort by most active provider first
  return results.sort((a, b) => b.requests - a.requests);
}

/** Reset all counters (test helper only). */
export function _resetMetricsForTest(): void {
  _counters.clear();
}
