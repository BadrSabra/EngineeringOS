---
name: Provider failure objective handoff
description: A provider failure after all required reads can still be recoverable through objective finalization.
---

When a proof-required objective has retained all required source reads, a later provider failure must return control to objective claim materialization and bounded no-tools synthesis instead of throwing directly into route-level provider-failure terminalization.

**Why:** A real session showed complete source reads stranded in a PARTIAL snapshot because the recovery helper only dispatched a read when a missing path existed; the same evidence succeeded on a fresh retry.

**How to apply:** Preserve the provider diagnostic and usage telemetry, but use a typed partial/provider-incomplete handoff so the chat agent can close server-owned claims or emit a truthful incomplete acceptance. Cover direct JSON, SSE, persistence, history, and acceptance snapshots.