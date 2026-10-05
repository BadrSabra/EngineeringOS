---
name: Recovery test isolation
description: Automatic recovery tests share a database with other API fixtures and need an explicit project scope to avoid cross-test dispatch.
---

Automatic recovery dispatch supports an optional project scope for deterministic integration tests; production callers omit it and reconcile globally. Recovery fixtures also need owner-scoped cleanup of child rows before their project rows are removed.

**Why:** A shared test database can contain failed executions from unrelated Mission and chat tests. An unscoped dispatcher can legitimately schedule those rows, and `executeTaskLifecycle` also returns before best-effort observation materialization settles. Deleting fixture episode/execution rows during that background transaction can cause PostgreSQL deadlocks. Mission route and recipe-recovery files also time out cleanup when Vitest runs them concurrently against that database.

**How to apply:** Scope dispatch to the fixture project; in nested lifecycle handoff tests, drain tracked post-acceptance materialization before simulating the prior worker's terminal path, then drain again before cleanup and delete dependent rows in order. Run DB-backed lifecycle, EffectObserver, Mission route, and recipe-recovery suites sequentially when they share the test database.