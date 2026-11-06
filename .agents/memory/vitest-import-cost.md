---
name: Vitest generated-schema import cost
description: Cold Vitest imports of large API and AI modules can consume per-test timeouts before the test body finishes.
---

When API integration tests import `@workspace/ai-orchestrator`, Vitest can spend several minutes transforming and importing the generated API-schema graph before any test body runs. This import time is distinct from each test's timeout. A nested process-recovery test that launches a second Vitest for the same large file also pays a separate cold-import cost, which needs its own signal-wait budget.

**Why:** On the current workspace, one GitHub delivery race file took over six minutes total, with about 407 seconds in import and one database case timing out after 23 seconds. In a nested process-recovery test, the child produced only its `RUN` startup line and no stderr before signal waits of 60 and 180 seconds expired; it never reached database assertions. The cause was not established.

**How to apply:** Group related API test files and selected test-name patterns into one Vitest process when safe. Treat nested child startup as its own budget and distinguish import/wait timeouts from product assertions. Prefer a lighter child harness over repeated timeout increases; after repeated no-signal failures, stop and leave that boundary **PARTIAL**.

In a multi-process race test launched from the large task-lifecycle integration file, each child Vitest cold-import took roughly 30–40 seconds before its test body ran. A 30-second database-lock wait expired before the children reached the intended barrier; a measured 90-second targeted wait passed.

**Why:** A parent-side timeout can begin while child processes are still transforming and importing the shared test graph, so a missing lock observation is not by itself evidence that the dispatcher path failed.

**How to apply:** Prefer an explicit child-ready signal when available. Otherwise size only the first child-observation wait to include measured cold imports, and include child output plus database activity in timeout diagnostics.

For post-commit HTTP-loss coverage that must exercise operational startup, a standalone `node:test` runner using the already-built API entrypoint reached the route and passed its PostgreSQL-backed recovery assertions after nested Vitest children produced no signal. The final selected case passed in about 22 seconds; this confirms a workable harness, not the root cause of the earlier Vitest stalls.

**How to apply:** Build once, then run a standalone Node child against the built API with a fresh loopback-only disposable database, an ephemeral port, a per-run `WORKSPACE_PATH`, and a local provider fixture that blocks all unapproved egress. Read the committed acceptance from PostgreSQL before SIGKILL; do not infer acceptance from an HTTP status or increase timeouts to make the test appear covered.

In `ai-orchestrator`, a cold dynamic import of `chat-agent` from a test that exercises a pure helper can take several seconds, while the helper itself may finish in milliseconds. A five-second default test timeout can therefore fail before the invariant assertions complete.

**Why:** The project-query incomplete-response fixture timed out both in a large suite and when run alone; direct timing separated a 3.5-second cold module import from a sub-4ms helper call.

**How to apply:** Before changing code or relaxing timeouts, time the import and pure function separately. If the test intentionally imports the large agent module, give only that test an evidence-based timeout margin; do not raise the suite-wide timeout. Prefer a focused helper module when extraction is warranted.
