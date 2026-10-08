---
name: Tool failure terminality
description: The contract for handling agent tool failures across orchestration, persistence, and UI.
---

Failures that make requested work untrustworthy must remain typed and terminal, with stable diagnostic codes and only bounded safe context exposed to the model; raw exceptions belong in server logs. A read-only path-scope rejection is a narrow retryable exception: it records a failed attempt without retaining evidence, so the model may try another server-authorized path without gaining scope.

**Why:** Treating execution failures as ordinary tool text let the model continue and produce plausible but unsupported completion claims. A path rejection is different: it is an authorization boundary, not an execution result, and withholding its content preserves evidence integrity while allowing a bounded correction.

**How to apply:** Preserve execution failure kinds and diagnostic codes through the agent trace, API/SSE boundary, persisted execution summary, and dashboard terminal state. Retry only typed read-path scope rejections after server-side validation; keep actual executor failures and cancellation incomplete, never successful.

A tool invocation has one immutable terminal phase. Mark the terminal callback attempt before awaiting it; if its acknowledgement is uncertain, do not emit a different terminal phase from error handling. The durable episode ledger accepts exact-payload retries, enforces requested → started → terminal ordering (with failed/cancelled allowed before start), and rejects any conflicting terminal or later phase.

**Why:** A completion event can commit while its acknowledgement is lost. Emitting a fallback failure afterward would create contradictory lifecycle history for one tool call, even though the tool output must remain withheld.

**How to apply:** Bind each lifecycle phase to the same invocation identity and serialize writes under the episode owner lock. Treat callback uncertainty as incomplete work; lifecycle history is provenance and does not satisfy Canonical Proof.