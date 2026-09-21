---
name: OpenRouter throttling and campaign checkpoints
description: Durable policy for model-scoped throttling, Retry-After waits, and empirical campaign persistence.
---

Model-scoped throttling must remain separate from the provider circuit. A single OpenRouter slug can be cooling down while another slug under the same credential remains eligible. Provider Retry-After waits are opt-in, bounded by the request ledger, and must leave recovery reserve instead of consuming the full deadline.

**Why:** Provider-wide opening on one model's 429 unnecessarily removes healthy fallback candidates, while unbounded waiting caused live campaigns to outlast their request budget.

**How to apply:** Record model cooldown only for provider-scoped throttling, filter cooled models before building the existing fallback chain, and persist empirical scorecards after every completed case. JSON repair must remain structural and bounded; schema validation stays authoritative.