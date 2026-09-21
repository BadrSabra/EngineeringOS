---
name: OpenRouter throttling and campaign checkpoints
description: Durable policy for model-scoped throttling, Retry-After waits, and empirical campaign persistence.
---

Model-scoped throttling must remain separate from the provider circuit, but an OpenRouter 429 identified as an upstream shared-pool or credential/window limit must not cascade to another same-provider free slug inside the same call. Provider Retry-After waits are opt-in, bounded by the request ledger, and must leave recovery reserve instead of consuming the full deadline.

**Why:** Provider-wide opening on one model's 429 unnecessarily removes healthy fallback candidates, while unbounded waiting caused live campaigns to outlast their request budget. The September 22, 2026 disposable run confirmed that OpenRouter free candidates can independently return upstream shared-pool 429s even when catalog startup is healthy.

**How to apply:** Classify the 429 once at the HTTP boundary where headers and provider metadata exist, carry only the bounded scope through health/telemetry, and let the Airlock quarantine all lanes for a shared provider-pool hit. Keep same-provider fallback ownership in the OpenRouter strategy/client, do not add a route-level or recovery-level second chain, and use provider/strategy quarantine for later executions rather than changing a rate limit into MODEL_UNAVAILABLE. Preserve bounded probe candidate iteration only for model/capability failures, and persist empirical scorecards after every completed case. JSON repair must remain structural and bounded; schema validation stays authoritative.