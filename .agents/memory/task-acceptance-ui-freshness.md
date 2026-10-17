---
name: Task execution UI freshness
description: Keep cached Task acceptance and execution results from appearing current during refetch or resume.
---

Task acceptance and receipt API projections can be bound to the Task's current correlation, execution, and attempt while the Dashboard still has cached results from an earlier attempt. Hide cached acceptance panels, list badges and filters, execution receipts, and verification results while the list query is refetching, a resume mutation is pending, or the Task is actively running. Hide the Mission capsule during a pending resume or while a running Task/execution query refreshes. Keep server identity checks as well; client-side freshness gates are presentation-only.

**Why:** Query invalidation and server-side identity binding do not erase already-rendered client cache values; those values can show an old outcome, answer receipt, verification result, or recovery action as if it were current.

**How to apply:** When changing Task result projections, test detail/execution-query `isFetching`, list-query `isRefetching`, resume mutation `isPending`, and a running Task with cached prior results separately from the API's current-correlation/current-attempt resolvers.
