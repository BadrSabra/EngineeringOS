---
name: Live provider validation boundary
description: Live dashboard validation needs an intent that requires proof and a disposable Git-backed project; ordinary audit wording may remain CHAT.
---

Live-provider mission checks must use a prompt that deterministically enters the proof-required project-query or forensic objective path. A generic audit sentence can be classified as ordinary CHAT with `proofRequired=false`, while a proof-required run may correctly emit an `error` terminal when evidence is incomplete rather than a `done` frame. Public execution checkpoints may redact nested operation/project IDs, so receipt binding must use the execution-scoped endpoint plus validator status and workspace revision.

**Why:** The live harness validates accepted evidence and validation, not merely provider output. Confusing ordinary chat completion or a safe incomplete terminal with accepted analysis produces misleading failures; matching redacted nested IDs would also reject valid proof.

**How to apply:** Use an isolated disposable project containing the declared evidence scope and initialized Git history. Interpret `EXECUTION_ACCEPTANCE_INCOMPLETE`, model-budget exhaustion, and missing evidence as non-acceptance; do not treat provider success or HTTP 200 as proof. For a fetched execution, accept a receipt only when it is `PROVEN`, has a valid validator ID, and matches the execution's workspace revision.

A failed or cancelled execution is terminal for the current attempt even when `resumable=true`; resumability means a later retry is possible, not that this attempt is still active. A model-catalog request alone does not prove that a completion request reached the provider.

**Why:** A live rate-limited attempt remained resumable, so the browser test kept polling until timeout and hid the provider failure; the fixture lifecycle also logged model discovery without a completion call.

**How to apply:** Stop browser polling on `failed` or `cancelled` regardless of resumability. Report the sanitized provider category, rate-limit scopes, retry delay, and resumable state; count a provider check only after observing an actual completion/stream response.