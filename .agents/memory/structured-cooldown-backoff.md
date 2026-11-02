---
name: Structured cooldown backoff
description: Structured provider rate limits without Retry-After use bounded adaptive admission windows and retain the source of the retry estimate.
---

Structured rate limits keep the provider's explicit `providerRetryAfterMs` separate from effective `retryAfterMs`; local adaptive backpressure uses `local_adaptive`, and local admission waits use `local_admission`. Accept only explicitly sourced provider/local/project waits as actionable retry directives. Preserve `adaptive_default` for legacy reads, but never treat it as an authoritative wait.

**Why:** Upstream shared pools can remain unavailable after a nominal 30-second wait; a fixed local retryAt caused another provider failure immediately after the gate expired.

**How to apply:** Keep provider Retry-After authoritative, keep project limiter durations separate, and treat adaptive windows as admission protection rather than proof that the provider has recovered. Persist both source and effective retry time with acceptance; never infer the original provider value from a local duration. Update server and client source parsers together when adding a source.