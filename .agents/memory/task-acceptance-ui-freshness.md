---
name: Task acceptance UI freshness
description: Keep cached Task acceptance projections from appearing current during refetch or resume.
---

Task acceptance API projections can be bound to the Task's current correlation, execution, and attempt while the Dashboard still has a cached response from an earlier attempt. Hide cached acceptance panels, list badges, and acceptance-based filtering while the relevant query is refetching, a resume mutation is pending, or the Task is actively running. Render acceptance again only after the fresh current projection arrives.

**Why:** Query invalidation and server-side attempt binding do not erase already-rendered client cache values; those values can show an old outcome or recovery action as if it were current.

**How to apply:** When changing Task acceptance paths, test detail-query `isFetching`, list-query `isRefetching`, resume mutation `isPending`, and a running Task with a cached prior acceptance separately from the API's exact-attempt resolver.
