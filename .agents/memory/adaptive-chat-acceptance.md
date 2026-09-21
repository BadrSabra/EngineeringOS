---
name: Adaptive chat acceptance
description: Durable acceptance rules for fallback planner and sub-query evidence tests.
---

Adaptive planning acceptance must exercise the real `chat()` path, not only `scheduleSubQueries()` or `planQuery()`. The test must observe the server-owned fallback status, verify that each scheduled sub-query produces a bounded read in its own scope, force a missing read through the same execution path, and assert that incomplete claims remain blocked rather than becoming `PROVEN`.

**Why:** Planner-only tests can pass while chat skips hierarchical execution, reuses an unintended prefetch cache, or lets a provider's synthesis claim outrun missing evidence.

**How to apply:** Use disposable filesystem fixtures and deterministic provider strategies. Keep prefetch isolated when asserting sub-query reads, assert both bounded attempt counts and the final objective/diagnostic projection, and verify that dependent sub-queries are skipped when a prerequisite fails.