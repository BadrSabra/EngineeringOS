---
name: Conversation runtime boundaries
description: Pointers for chat routing, project-query acceptance, tool loops, recovery, and evidence continuity
---

- [Unified AI turn routing](ai-turn-routing.md) — resolve raw-message intent once and carry it through provider, tools, evidence, persistence, and UI state.
- [Chat turn lifecycle contracts](chat-turn-lifecycle-index.md) — persistence, cancellation, reconnect, provenance, and terminal response/acceptance boundaries.
- [Recovery terminal success](chat-recovery-terminal-success.md) — internal SSE HTTP 200 does not prove recovery succeeded; reload the durable execution attempt and terminal status.
- [Chat recovery binding equality](chat-recovery-binding-equality.md) — compare structured request contracts by value, not JSON key order.
- [Project-query planning and proof](project-query-acceptance-index.md) — target-aware reads, retained evidence, claims, recovery, and response parity.
- [Chat rate-limit retry](chat-rate-limit-retry.md) — same-execution 429 retry requires server-owned scope and positive Retry-After.
- [Recovery telemetry semantics](recovery-telemetry-semantics.md) — provider fallback, forensic recovery, and resume are separate layers.
- [AI boundary redaction](chat-export-redaction.md) — sanitize provider-derived fields before user-facing or persisted output.
- [AI fixture determinism](ai-fixture-determinism.md) — injected AI tests fail closed without weakening lease checks.
- [Tool failure terminality](tool-failure-terminality.md) — tool failures stay terminal; diagnostics are not evidence or permission.
- [Analysis deadline race](analysis-deadline-race.md) — classify timeout expiry from a timer-owned flag.
- [Reliable Tool Agent scope](reliable-tool-agent-scope.md) — preserve delegation and approval boundaries.
- [Tool I/O resource bounds](tool-input-resource-bounds.md) — cap provider inputs and fail closed on oversized outputs before proof.
- [Retained-read reachability proof](retained-read-reachability-proof.md) — recognize syntax-derived retained-read edges in final-answer validation.
- [Forensic resume contract](forensic-resume-contract.md) — persist task intent, scope, revision, and identities before provider work.
- [Recovery candidate binding](recovery-candidate-binding.md) — bind acceptances to the current attempt and preserve revision-safe partial recovery.
