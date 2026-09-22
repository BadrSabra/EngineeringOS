---
name: Recovery test isolation
description: Automatic recovery tests share a database with other API fixtures and need an explicit project scope to avoid cross-test dispatch.
---

Automatic recovery dispatch supports an optional project scope for deterministic integration tests; production callers omit it and reconcile globally. Recovery fixtures also need owner-scoped cleanup of child rows before their project rows are removed.

**Why:** A shared test database can contain failed executions from unrelated Mission and chat tests. An unscoped dispatcher then legitimately schedules those rows, making duplicate-dispatch assertions fail even when queue deduplication is correct.

**How to apply:** When testing one recovery fixture, pass its project ID to the dispatcher and clean its acceptances, messages, executions, tasks, sessions, and project in dependency order.