---
name: Chat turn lifecycle index
description: Navigation to durable chat-turn persistence, cancellation, reconnect, provenance, and terminal acceptance contracts.
---

These references cover separate contracts across a chat turn's persistence, execution, transport, and presentation layers. Load the narrow note that matches the failure rather than replacing one layer's rules with generic session handling.

- [Analysis failure replay](analysis-failure-replay.md) — incomplete analysis remains visible after reconnect and reload.
- [AI cancellation checkpoint handling](ai-cancellation-checkpoint.md) — expected lease rejection after cancellation preserves the incomplete report.
- [AI provenance response parity](ai-provenance-response-parity.md) — JSON, SSE, persistence, and history share one public provenance projection.
- [Cancellation content precedence](cancellation-content-precedence.md) — cancellation owns final persisted content.
- [Cancellation registration race](cancellation-registration-race.md) — cancellation is rechecked after worker-controller registration.
- [Chat SSE fixture lifecycle](chat-sse-fixture-lifecycle.md) — stream tests expose execution state and reset cancellation.
- [Chat terminal response barrier](chat-terminal-response-barrier.md) — settle lifecycle before JSON and require canonical objectives for evidence-gated queries.
- [Dashboard proof fixtures](dashboard-proof-fixtures.md) — proof-required fixtures retain their requirement through terminal state and reload.
- [Dashboard stream reconnect](dashboard-stream-reconnect.md) — reconnect the same durable execution; terminal state remains authoritative.
- [Durable provisional messages](durable-acceptance-provisional.md) — execution-backed assistant rows stay provisional until acceptance.
- [Resumable chat idempotency](resumable-chat-idempotency.md) — resume preserves one user turn while auditing assistant outcomes separately.
- [Session state concurrency](session-state-concurrency.md) — qualify resumable writes by turn timestamp to survive row-lock waits.
- [SSE recovery authority](sse-recovery-authority.md) — transport keepalive is not lease ownership; durable status and acceptance govern recovery.
- [Terminal outcome refinement](terminal-outcome-refinement.md) — refine one assistant identity from provisional failure to authoritative result, never downgrade it.
- [Terminal projection identity](terminal-projection-identity.md) — bind terminal outcomes consistently to execution, attempt, message, and session.

**Why:** Chat lifecycle failures often cross persistence, cancellation, stream recovery, and UI projection boundaries; grouped navigation reduces index pressure without dropping the edge-specific contracts.

**How to apply:** Identify the failing layer and load its detailed note. Transport completion is not acceptance, and cancellation must never appear as success.