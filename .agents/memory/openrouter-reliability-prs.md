---
name: OpenRouter Reliability PR Batch
description: 13-PR AI provider reliability hardening — completed 2026-08-02.
---

## What was done

**PR-001**: Removed hardcoded `google/gemma-4-31b-it:free` default from
`openai-compatible-client.ts`. Default now derived from `FREE_MODELS[0]` at
module load, so it is always a real catalog entry.

**PR-002**: `lib/ai-orchestrator/src/openrouter/dynamic-catalog.ts` — fetches
`GET /models` from OpenRouter at startup with 10-min TTL; `resolveFallbackChain`
and `buildFallbackChainFromId` now filter candidates against the live catalog.

**PR-003**: `classifyStatus()` in `openai-compatible-client.ts` — 410 → MODEL_UNAVAILABLE,
422 → MODEL_UNAVAILABLE, 429 with "quota/credits/billing" body → QUOTA.
`openrouterCompleteWithFallback` now advances fallback on both MODEL_NOT_FOUND
and MODEL_UNAVAILABLE (instead of only MODEL_NOT_FOUND).

**PR-006**: `lib/ai-orchestrator/src/startup-validator.ts` — validates all provider
keys and refreshes the dynamic catalog at server startup. Called in
`artifacts/api-server/src/index.ts` (fire-and-forget, never blocks startup).

**PR-007**: `GroqClientError` extended with `ProviderErrorContext` (providerStatus,
providerCode, providerMessage, providerName, providerModel) and `toProviderContext()`.
`classifyStatus()` now threads all provider HTTP context into every thrown error.

**PR-008**: `MODEL_UNAVAILABLE` and `QUOTA` added to `GroqErrorCode` union in `errors.ts`.

**PR-009**: SSE stream error events in `chat.ts` enriched with `providerContext`,
`retryable: boolean`, and `suggestedFix: string` for each error code.

**PR-010**: `done` SSE event includes `telemetry: { latencyMs, provider }`.

**PR-011**: `lib/ai-orchestrator/src/provider-metrics.ts` — in-memory counters
(requests, failures, fallbacks, invalid models, p50/p95 latency). Exposed via
`GET /api/ai/metrics`. Chat route wires `recordRequest`, `recordFailure`,
`recordLatency`, `recordFallbackSuccess`, `recordInvalidModel`.

**PR-012**: `lib/ai-orchestrator/src/__tests__/openai-compatible-client.test.ts` —
regression tests for 400/404/410/422/quota/rate-limit/auth/fallback-exhaustion/provider-context.

**PR-013**: Stale default model cleaned up by PR-001 (no separate work needed).

## Key file locations
- `lib/ai-orchestrator/src/openrouter/dynamic-catalog.ts` — new
- `lib/ai-orchestrator/src/openrouter/model-resolver.ts` — updated (PR-002 filter)
- `lib/ai-orchestrator/src/openrouter/index.ts` — updated exports
- `lib/ai-orchestrator/src/openai-compatible-client.ts` — PR-001/003/007
- `lib/ai-orchestrator/src/errors.ts` — PR-007/008
- `lib/ai-orchestrator/src/startup-validator.ts` — new (PR-006)
- `lib/ai-orchestrator/src/provider-metrics.ts` — new (PR-011)
- `artifacts/api-server/src/routes/ai/providers.ts` — GET /api/ai/metrics
- `artifacts/api-server/src/routes/ai/chat.ts` — PR-009/010/011 wiring
- `lib/ai-orchestrator/src/__tests__/openai-compatible-client.test.ts` — PR-012

## Important: dynamic catalog at startup
`validateAiProvidersAtStartup()` is called fire-and-forget in `index.ts`. If
OPENROUTER_API_KEY is set, it fetches the live model list. Until that resolves,
`getDynamicModelIds()` returns null and `resolveFallbackChain` falls back to
the full static list — so startup is never blocked.

**Why:** Prevents the resolver from selecting models that OpenRouter has retired.
