---
name: Benchmark smoke database environment
description: Avoid false provider-outage results when running benchmark smoke scripts without production database access.
---

The live OpenRouter smoke imports `@workspace/ai-orchestrator`, whose dependency graph requires `DATABASE_URL` during module evaluation even though catalog refresh and provider-health probing do not query the database. If the variable is unset, the CLI can collapse the import failure into a generic `provider_unavailable` result, which is not evidence of a provider outage.

**Why:** A missing database URL was mistaken for a failed provider catalog refresh and led to redundant live checks. Separately, a shell-level hard timeout terminated a live benchmark before its `finally` cleanup ran, leaving that run's temporary candidate root behind.

**How to apply:** For smoke or benchmark commands that should not access a database, provide a loopback-only dummy `DATABASE_URL` and unset inherited PostgreSQL variables. If the operation genuinely needs persistence, use a disposable local database with the required schema. Never pass the production URL just to satisfy module initialization. After an outer command timeout, confirm the exact benchmark process has exited and remove only that run's identified disposable root; do not glob-delete shared temporary roots.