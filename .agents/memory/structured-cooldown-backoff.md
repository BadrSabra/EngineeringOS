---
name: Structured cooldown backoff
description: Structured provider rate limits without Retry-After use bounded adaptive admission windows and retain the source of the retry estimate.
---

When a structured provider rate-limit response has no explicit Retry-After, start with the server default and exponentially increase the admission window for repeated recent failures, capped at a bounded maximum. Preserve explicit provider and project-limiter durations unchanged, and persist the source beside retryAt.

**Why:** Upstream shared pools can remain unavailable after a nominal 30-second wait; a fixed local retryAt caused another provider failure immediately after the gate expired.

**How to apply:** Keep provider Retry-After authoritative, keep project limiter durations separate, and treat adaptive windows as admission protection rather than proof that the provider has recovered.