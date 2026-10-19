---
name: Vitest generated-schema import cost
description: Slow Vitest startup when API tests pull the generated schema graph through AI Orchestrator.
---

When API integration tests import `@workspace/ai-orchestrator`, Vitest can spend several minutes transforming and importing the generated API-schema graph before any test body runs. This import time is distinct from each test's timeout. A nested process-recovery test that launches a second Vitest for the same large file also pays a separate cold-import cost, which needs its own signal-wait budget.

**Why:** On the current workspace, one GitHub delivery race file took over six minutes total, with about 407 seconds in import and one database case timing out after 23 seconds. In a nested process-recovery test, the child produced only its `RUN` startup line and no stderr before signal waits of 60 and 180 seconds expired; it never reached database assertions. The cause was not established.

**How to apply:** Group related API test files and selected test-name patterns into one Vitest process when safe. Treat nested child startup as its own budget and distinguish import/wait timeouts from product assertions. Prefer a lighter child harness over repeated timeout increases; after repeated no-signal failures, stop and leave that boundary **PARTIAL**.

For post-commit HTTP-loss coverage that must exercise operational startup, a standalone `node:test` runner using the already-built API entrypoint reached the route and passed its PostgreSQL-backed recovery assertions after nested Vitest children produced no signal. The final selected case passed in about 22 seconds; this confirms a workable harness, not the root cause of the earlier Vitest stalls.

**How to apply:** Build once, then run a standalone Node child against the built API with a fresh loopback-only disposable database, an ephemeral port, a per-run `WORKSPACE_PATH`, and a local provider fixture that blocks all unapproved egress. Read the committed acceptance from PostgreSQL before SIGKILL; do not infer acceptance from an HTTP status or increase timeouts to make the test appear covered.
