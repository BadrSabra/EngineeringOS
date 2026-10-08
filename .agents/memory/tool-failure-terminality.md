---
name: Tool failure terminality
description: The contract for handling agent tool failures across orchestration, persistence, and UI.
---

Failures that make requested work untrustworthy must remain typed and terminal, with stable diagnostic codes and only bounded safe context exposed to the model; raw exceptions belong in server logs. A read-only path-scope rejection is a narrow retryable exception: it records a failed attempt without retaining evidence, so the model may try another server-authorized path without gaining scope.

**Why:** Treating execution failures as ordinary tool text let the model continue and produce plausible but unsupported completion claims. A path rejection is different: it is an authorization boundary, not an execution result, and withholding its content preserves evidence integrity while allowing a bounded correction.

**How to apply:** Preserve execution failure kinds and diagnostic codes through the agent trace, API/SSE boundary, persisted execution summary, and dashboard terminal state. Retry only typed read-path scope rejections after server-side validation; keep actual executor failures and cancellation incomplete, never successful.