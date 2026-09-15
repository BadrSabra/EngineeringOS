---
name: General task planning
description: Durable rules for coordinating existing task, query, and capability plans without creating competing execution state.
---

The general planning layer is an adapter and decision point, not a fourth planner or execution engine. A durable execution plan has priority over a persisted project-query scope, which has priority over a provider-created query plan. Reuse requires the current workspace revision to match; otherwise create a new plan or remain read-only until scope is resolved.

**Why:** Multiple planning systems already own different responsibilities. Replanning during resume or execution handoff can create conflicting scopes, duplicate work, or make an old revision appear current. Planning completion is never execution success and cannot authorize mutation.

**How to apply:** Keep one request budget and execution ledger. Emit a bounded plan/reuse trace without provider reasoning. Let existing execution nodes, recipe compilation, coordinators, approval gates, validation, and acceptance remain authoritative.