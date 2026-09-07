---
name: Historical acceptance journeys
description: Browser journey guidance for verifying durable acceptance state after audit reloads and reselection.
---

Historical audit journeys should validate the public acceptance snapshot and redacted disposition through both execution-history and execution-detail responses after reload and explicit reselection. Same-session reselection must rehydrate the linked messages from the session cache and refresh them from the server so the visible proof/disposition panel does not fall into the empty-chat branch. Use route-owned acceptance fields as the durable contract assertion as well as the restored proof panel for the visible safe-action assertion.

**Why:** The audit selection can remain durable while same-session reselection clears a cached conversation view; route-owned acceptance fields remain authoritative, but operators also need the linked evidence and disposition visibly restored in the current chat.

**How to apply:** Assert `acceptance`, `acceptanceDisposition`, and safe action fields such as `START_NEW_PROBE` or `START_NEW_RUN` through history/detail responses, then assert the rehydrated panel. Never assert raw provider diagnostics, internal paths, or execution identifiers as user-facing evidence.