---
name: OpenRouter Reliability Hardening
description: PRs 01-08 implementing runtime model resolution, fallback chain, error classification, health monitoring, circuit breaker, UI sync, and e2e tests.
---

## Rules

**PR-01** — When `openrouterCompleteWithFallback` receives no `opts.model`, use `resolveFallbackChain({ capability: "chat", quality: "fast" })` not bare `openrouterCompleteRaw`. Also fire-and-forget `refreshDynamicCatalog(apiKey)` on every call from the strategy.

**PR-04** — 402 responses from OpenRouter → `PLAN_RESTRICTED` (not `MODEL_NOT_FOUND`). 404 → `MODEL_NOT_FOUND`. Both are now in `isModelUnavailableError()` so fallback chain advances past them.

**PR-03** — `FALLBACK_TRIGGER_CODES` in `ai-route-helpers.ts` must include `MODEL_UNAVAILABLE`, `PLAN_RESTRICTED`, and `QUOTA` or cross-provider failover never fires for these errors.

**PR-05** — `provider-metrics.ts` now has `recordSuccess()`, `lastSuccessAt`, `lastFailureAt`, `consecutiveFailures`, `successRate`. Call `recordSuccess(effectiveProvider)` on every chat success in `chat.ts`.

**PR-07** — Circuit breaker lives in `lib/ai-orchestrator/src/openrouter/circuit-breaker.ts`. Threshold = 5 consecutive failures, cooldown = 2 min. `isCircuitOpen(provider)` must be checked in BOTH `openrouter.strategy.ts` (before the fetch) and `collectAvailableProviders` in `ai-route-helpers.ts` (to skip the provider entirely from the chain).

**Why:** Checking only in the strategy leaves the provider in the chain; `collectAvailableProviders` skips it at the chain-building level which is cleaner.

**PR-06 UI** — `GET /api/ai/metrics` now returns merged metrics + circuit state per provider (uses `PROVIDER_PRIORITY` so all providers appear even with zero requests). `AiChat.tsx` polls this every 30 s and renders `ProviderRuntimeBadge` in each provider card.

## Key file locations
- `lib/ai-orchestrator/src/openrouter/circuit-breaker.ts` — circuit breaker
- `lib/ai-orchestrator/src/openrouter/index.ts` — re-exports circuit breaker
- `lib/ai-orchestrator/src/index.ts` — re-exports `recordSuccess`, `isCircuitOpen`, etc.
- `lib/ai-orchestrator/src/__tests__/openrouter-reliability.test.ts` — PR-08 tests (291 all pass)
- `artifacts/api-server/src/lib/ai-route-helpers.ts` — `FALLBACK_TRIGGER_CODES`, `collectAvailableProviders` (circuit check)
- `artifacts/api-server/src/routes/ai/providers.ts` — enriched `GET /api/ai/metrics`
- `artifacts/dashboard/src/pages/AiChat.tsx` — `ProviderRuntimeBadge`, `metricsMap` query
