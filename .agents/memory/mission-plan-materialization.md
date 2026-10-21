---
name: Mission plan materialization
description: Durable Mission plans materialize typed steps into Goals while runtime owns dependency gating and wake-up.
---

The Mission planning adapter materializes each server-owned plan step as its own Goal and Task, binds every row to the same plan revision, and persists dependency edges through the existing dependency table. Initial dispatch includes only dependency roots; `runMissionGoal` and durable reconciliation remain the source of truth for readiness and downstream wake-up.

**Why:** Dispatching every step from the adapter would duplicate dependency/state-machine behavior and could let a downstream step race its predecessor. Keeping readiness in the existing runtime preserves idempotency, leases, and failure handling. Plan materialization may leave descendants already queued, so a wake scan limited to waiting Goals can strand a completed Mission successor.

**How to apply:** When adding plan entry points or replans, create immutable step rows and dependency edges in one transaction, then dispatch roots only. The existing wake path must consider both dependency-waiting Goals and queued descendants whose dependencies are complete, then re-enter `runMissionGoal` for proof, revision, and ownership checks. Do not add a second planner, executor, or dependency scheduler.