---
name: OpenRouter free-only routing
description: Product-level constraint for model selection, fallback, and rate-limit behavior.
---

The long-term product goal is zero paid AI API calls, with graceful pause/resume when no eligible free route exists. Current product routing remains OpenRouter-free-only; enabling another cloud or local route requires its own verified eligibility, capability, privacy, and operational gates. Paid and unknown-cost routes must fail closed. A 429 or QUOTA response ends same-request model advancement; local adaptive cooldowns are admission estimates, never provider retry ETAs.

Use a shared lane cursor only for fair starting-model selection: filter active model cooldowns before reserving a slot, and persist hashes of server-owned lane dimensions and candidate IDs/weights only. PostgreSQL allocation supports cross-worker fairness; a local fallback preserves availability but not cross-worker fairness. Neither mechanism creates provider capacity.

**Why:** OpenRouter is the currently authorized product route, but the stated long-term goal now includes independence from any single free tier without permitting paid fallback. Cloud free quotas remain provider-owned and cannot be guaranteed by local routing.

**How to apply:** preserve OpenRouter-free-only product behavior until the shared no-paid gate and route admission tests pass. Treat provider registrations and secrets as configuration, not permission to route. Disabled-provider status reads must remain local and must not validate keys or refresh catalogs over the network; allow removal of old keys, but reject adding or editing disabled-provider credentials. Before activating any additional route, require fresh account- and model-scoped free eligibility, exact capability/contract validation, and data-handling approval. On 429, preserve scope; on missing `Retry-After`, use only the bounded exact-model local adaptive cooldown. On exhaustion, checkpoint and pause rather than retrying indefinitely or promoting to paid. Never let cursor advancement authorize a retry or an unverified route; do not store prompts, credentials, project IDs, or user identity in scheduler state.
