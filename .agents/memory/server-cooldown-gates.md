---
name: Server cooldown gates
description: Provider cooldown enforcement between durable acceptance and creation of a new AI execution.
---

When a provider failure persists a retryAt, the API must reject a new execution before reserving durable execution state or calling the provider. Dashboard checks and acceptance projections are advisory only.

**Why:** A stale or unloaded client acceptance allowed repeated structured executions during the same provider cooldown, producing multiple provider rate-limit calls even though each prior execution correctly stored RETRY_AFTER_RATE_LIMIT.

**How to apply:** Put the cooldown lookup at the new-execution boundary, return the server-owned retryAt/retryAfterMs, and test that blocked retries create neither a new execution nor a usage event. Keep explicit resume paths separate from new retries.