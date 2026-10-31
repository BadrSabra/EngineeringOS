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

For live empty-response checks, bind the verdict to both a completed, scope-matching source read and the final provider response's zero user-visible output. An `ANALYSIS_INCOMPLETE` result or a successful provider status alone does not prove the empty-response path; a rate-limit failure is a separate outcome.

**Why:** A live model returned no user-visible text before the required source read had completed, while a later correctly scoped run was stopped by an upstream shared-pool rate limit. Without both bindings, the test can misclassify either case as an empty-response success.

**How to apply:** Record safe response metadata for the final completion and the accepted read lifecycle; fail closed if either is absent, and report `RATE_LIMITED` separately from `EMPTY_RESPONSE`.

A live campaign process exit of zero may mean only that its redacted receipt passed format and privacy checks. The campaign is not successful unless the receipt itself reports a complete, accepted result with the required evidence.

**Why:** A valid `terminal-incomplete` receipt can be emitted and validated after a live provider rate limit, while the wrapper still exits successfully.

**How to apply:** Judge campaign outcomes from `outcomeClass`, `terminalStatus`, `accepted`, and `evidence`, not from the process exit code alone.

An OpenRouter catalog entry, including a free-priced model, does not prove its inference route is available. Preserve only bounded HTTP status and classified failure in campaign receipts; never retain provider bodies or messages.

**Why:** Live free-model requests returned HTTP 404 despite catalog eligibility, while other attempts reached an upstream shared-pool 429; catalog metadata cannot distinguish those runtime outcomes.

**How to apply:** Validate actual completion requests separately from catalog refreshes, and use the sanitized status to distinguish model-route availability from rate limiting without exposing provider payloads.

Exact-model live campaigns must bound both provider fallback and agent-level retries; a pinned model must also bypass the shared lane cursor.

**Why:** A campaign configured with one OpenRouter fallback still made four free-model attempts because the agent retried and the shared lane cursor ignored the requested model.

**How to apply:** For a single-model measurement, stop after the first model response, cap the provider chain at one, disable shared-lane rotation, and verify the receipt's attempted-model list before interpreting the result.

An `upstream_shared_pool` cooldown may extend to sibling model IDs only when the provider's metadata matches their namespace; do not block every OpenRouter free model from one upstream error.

**Why:** OpenRouter can name a specific upstream provider in the 429 metadata, while other providers may remain healthy; a global pause would suppress usable free capacity.

**How to apply:** Use only the exact provider-supplied Retry-After, persist a provider-namespace cooldown when the namespace match is exact, and otherwise cool only the failed model.

JSON-object support is not proof of JSON-Schema support. Strict structured tasks must filter the primary model and every fallback against live `structured_outputs` metadata, in addition to the server-owned free-model allowlist.

**Why:** A JSON-object-capable free model was selected for a JSON-Schema code-review contract, then silently ignored in favor of a different model; its catalog ID existed, but its schema capability was not verified.

**How to apply:** Pass the requested response-format contract through model resolution, fallback construction, and campaign preflight. Keep `requestedModel` separate from actual attempted models, bind it to a timestamped catalog fingerprint, and never accept a single-model receipt unless exactly that model was attempted.