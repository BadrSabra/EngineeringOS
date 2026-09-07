---
name: Terminal projection identity
description: Durable AI terminal outcomes must stay bound to one execution attempt and its exact assistant message across every public surface.
---

Every terminal AI outcome needs one server-owned identity envelope containing execution ID, attempt, session ID, assistant message ID, acceptance ID, and correlation ID. History must join acceptance by message ID, while SSE and status responses must expose the same envelope instead of reconstructing identity from mutable client state or the latest acceptance for an execution.

**Why:** A failed execution followed by recovery can contain multiple assistant rows and acceptance attempts. Selecting the newest acceptance for every message, or emitting a provider error before durable failure persistence without execution/session identity, makes reloads and live Dashboard state display the wrong outcome or lose the affected execution.

**How to apply:** Persist the terminal acceptance/message/execution transition first, then emit one terminal SSE frame with the committed public projection. Keep the original bounded provider/validation error code on the assistant row while using the acceptance reason code for the projection. Make detail, history, reconnect, and Dashboard invalidation consume that projection; add tests for failed-then-resumed attempts, provider failure, lease expiry, and duplicate terminal frames.