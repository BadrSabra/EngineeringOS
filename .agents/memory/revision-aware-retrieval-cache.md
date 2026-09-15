---
name: Revision-aware retrieval cache
description: Identity and invalidation rules for hierarchical retrieval plan reuse.
---

Cache graph-derived retrieval plans only when the key includes project/workspace revision, index revision, parser version, and the bounded query shape. Rehydrate operation identity on cache hits.

**Why:** graph bytes, parser behavior, and the workspace candidate can change independently; reusing a plan across any of those boundaries produces plausible but stale evidence.

**How to apply:** keep Git history reads outside the graph-plan cache because Git revision is an independent identity and should be refreshed per operation.