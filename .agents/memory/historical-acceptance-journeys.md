---
name: Historical acceptance journeys
description: Browser journey guidance for verifying durable acceptance state after audit reloads and reselection.
---

Historical audit journeys should validate the public acceptance snapshot and redacted disposition through both execution-history and execution-detail responses after reload and explicit reselection. Use the restored proof panel for the visible safe-action assertion, but do not make the post-reselection check depend on the chat message cache being re-rendered.

**Why:** The audit selection can remain durable while same-session reselection clears a cached conversation view. Route-owned acceptance fields are the authoritative regression signal and avoid coupling the acceptance contract to unrelated message hydration behavior.

**How to apply:** Keep assertions limited to `acceptance`, `acceptanceDisposition`, and safe action fields such as `START_NEW_PROBE` or `START_NEW_RUN`; never assert raw provider diagnostics, internal paths, or execution identifiers as user-facing evidence.